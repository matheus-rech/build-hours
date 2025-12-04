"""Compacting session implementation for OpenAI Agents SDK demo."""

# CompactingSession for OpenAI Agents SDK
# ---------------------------------------
# Behavior
# - When trigger is exceeded (by turns), begin compacting the OLDEST user turns first (chronological order),
#   preserving the most recent `keep` turns intact.
# - Compaction clears tool RESULTS by default, replacing their payloads
#   with a placeholder string so the model knows context was removed.
# - If clear_tool_inputs=True, it also clears tool CALL arguments.
# - Tools listed in exclude_tools are never compacted (both inputs & outputs).
#
# "Turn" definition:
#   One user message + everything that follows (assistant, reasoning,
#   tool calls, tool results) until the next user message.
#
# Integration:
#   session = CompactingSession("my_session", trigger={"turns": 20}, keep=2)
#   result = await Runner.run(agent, "Hello", session=session)

from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Union
from dataclasses import dataclass, field
import math
import copy

# Import your SDK interfaces; shown here as type comments to avoid hard deps.
# from agents.memory.session import SessionABC
# from agents.items import TResponseInputItem

try:
    from agents.memory.session import SessionABC  # type: ignore
except Exception:
    # Minimal shim so this file can be imported outside the SDK for testing.
    class SessionABC:  # type: ignore
        async def get_items(self, limit: int | None = None): ...
        async def add_items(self, items: List[dict]) -> None: ...
        async def pop_item(self): ...
        async def clear_session(self) -> None: ...

TResponseInputItem = Dict[str, Any]

# ----------------------------
# Utilities & type inspectors
# ----------------------------


def _lower_set(xs: Optional[Iterable[str]]) -> set[str]:
    return set(x.lower() for x in (xs or []))


def _get_message_type(item: TResponseInputItem) -> Optional[str]:
    """Best-effort detection of the item's message type."""

    # Common locations: top-level messageType or type
    mt = item.get("messageType")
    if mt:
        return mt

    top_level_type = item.get("type")
    if top_level_type:
        return top_level_type

    raw = item.get("raw") or {}
    return raw.get("type")


def _get_role(item: TResponseInputItem) -> Optional[str]:
    raw = item.get("raw") or {}
    role = raw.get("role")
    # Some items carry role at top-level for convenience
    if role:
        return role
    # Assistant "message" items often have role at raw.role
    return item.get("role")


def _is_user(item: TResponseInputItem) -> bool:
    mt = _get_message_type(item)
    role = _get_role(item)
    if mt == "user" or role == "user":
        return True
    # Fallback: top-level signature sometimes: {"role": "user", "content": "..."}
    if item.get("role") == "user":
        return True
    return False


def _count_user_turns(items: Iterable[TResponseInputItem]) -> int:
    if not items:
        return 0
    return sum(1 for item in items if _is_user(item))


def _is_tool_call(item: TResponseInputItem) -> bool:
    mt = _get_message_type(item)
    if mt == "function_call":
        return True
    raw = item.get("raw") or {}
    return raw.get("type") == "function_call"


def _is_tool_result(item: TResponseInputItem) -> bool:
    mt = _get_message_type(item)
    if mt == "function_call_output":
        return True
    raw = item.get("raw") or {}
    return raw.get("type") == "function_call_output"


def _get_call_id(item: TResponseInputItem) -> Optional[str]:
    raw = item.get("raw") or {}
    # Both tool call and result often carry call_id
    return (
        item.get("call_id")
        or raw.get("call_id")
        or raw.get("id")
        or item.get("id")
    )


def _get_tool_name_from_call(item: TResponseInputItem) -> Optional[str]:
    # For function_call items the tool name is typically raw["name"]
    raw = item.get("raw") or {}
    return raw.get("name") or item.get("name")


def _stringify_content_field(item: TResponseInputItem) -> str:
    """
    Extracts a best-effort textual representation from diverse item shapes to estimate tokens.
    """
    text_chunks: List[str] = []

    # 1) Top-level content may be a string
    content = item.get("content")
    if isinstance(content, str):
        text_chunks.append(content)

    # 2) Top-level content may be a list of dicts with {"type": "...", "text": "..."}
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict):
                if "text" in c and isinstance(c["text"], str):
                    text_chunks.append(c["text"])

    # 3) raw payloads often carry arguments, output, content, etc.
    raw = item.get("raw") or {}

    # handle top-level arguments/output (common for agents SDK)
    args = item.get("arguments")
    if isinstance(args, str):
        text_chunks.append(args)
    elif isinstance(args, dict):
        text_chunks.append(str(args))

    out = item.get("output")
    if isinstance(out, str):
        text_chunks.append(out)
    elif isinstance(out, (dict, list)):
        text_chunks.append(str(out))

    # arguments (tool inputs)
    args = raw.get("arguments")
    if isinstance(args, str):
        text_chunks.append(args)
    elif isinstance(args, dict):
        text_chunks.append(str(args))

    # output (tool results)
    out = raw.get("output")
    if isinstance(out, str):
        text_chunks.append(out)
    elif isinstance(out, dict) or isinstance(out, list):
        text_chunks.append(str(out))

    # message content inside raw
    raw_content = raw.get("content")
    if isinstance(raw_content, str):
        text_chunks.append(raw_content)
    elif isinstance(raw_content, list):
        for c in raw_content:
            if isinstance(c, dict) and "text" in c and isinstance(c["text"], str):
                text_chunks.append(c["text"])

    # assistant message payloads sometimes live as raw["content"][...]
    return "\n".join(text_chunks).strip()


def _default_token_counter(item: TResponseInputItem) -> int:
    """
    Cheap token estimator. Roughly chars/4 with a floor.
    You can supply a better tokenizer via token_counter in CompactingSession.
    """
    text = _stringify_content_field(item)
    if not text:
        return 1
    return max(1, math.ceil(len(text) / 4))


def _build_call_index(items: List[TResponseInputItem]) -> Dict[str, Dict[str, Any]]:
    """
    Map call_id -> {"name": str | None, "index": int}
    for quick lookup of the tool name from results.
    """
    index: Dict[str, Dict[str, Any]] = {}
    for i, it in enumerate(items):
        if _is_tool_call(it):
            cid = _get_call_id(it)
            if cid:
                index[cid] = {"name": _get_tool_name_from_call(it), "index": i}
    return index


# ----------------------------
# Compaction configuration
# ----------------------------


@dataclass
class CompactionTrigger:
    """
    Compaction runs when the number of user-anchored turns exceeds `turns`.
    """

    turns: Optional[int] = None


@dataclass
class CompactingSession(SessionABC):
    """
    A Session that compacts the oldest tool interactions when configured thresholds are exceeded.

    Args:
        session_id: Identifier for this session.
        trigger: CompactionTrigger; compaction runs if ANY threshold is exceeded.
        keep: Number of most recent user turns to keep fully intact once compaction starts.
        exclude_tools: Tool names (case-insensitive) that should never be compacted.
        clear_tool_inputs: If True, compact both tool RESULTS and tool CALL arguments.
                           If False (default), compact only tool RESULTS.
        token_counter: Optional callable(item)->int for input token estimation.
        placeholder_template: Template used when replacing compacted items.
                              Receives kwargs: kind ("result"|"call"), name, call_id, reason.
    """

    session_id: str
    trigger: CompactionTrigger = field(
        default_factory=lambda: CompactionTrigger(turns=None)
    )
    keep: int = 1
    exclude_tools: Iterable[str] = field(default_factory=list)
    clear_tool_inputs: bool = False
    token_counter: Optional[Callable[[TResponseInputItem], int]] = None
    placeholder_template: str = (
        "⟦removed: tool {kind} for {name} (call_id={call_id}); reason=context_compaction⟧"
    )

    # internal buffer
    _items: List[TResponseInputItem] = field(default_factory=list)
    internal_turn_counter: int = field(default=0, init=False)

    # --------------
    # SessionABC API
    # --------------

    @property
    def internalTurnCounter(self) -> int:  # noqa: N802 - camelCase required for UI contract
        return self.internal_turn_counter

    @internalTurnCounter.setter
    def internalTurnCounter(self, value: int) -> None:  # noqa: N802 - camelCase setter
        try:
            numeric = int(value)
        except (TypeError, ValueError):
            numeric = 0
        self.internal_turn_counter = max(0, numeric)

    def _increment_internal_turn_counter(self, items: Iterable[TResponseInputItem]) -> None:
        if not items:
            return
        delta = _count_user_turns(items)
        if delta <= 0:
            return
        try:
            current = int(self.internal_turn_counter)
        except (TypeError, ValueError):
            current = 0
        self.internal_turn_counter = max(0, current + delta)

    def _reset_internal_turn_counter(self, value: Optional[int] = None) -> None:
        if value is None:
            value = 0
        try:
            numeric = int(value)
        except (TypeError, ValueError):
            numeric = 0
        self.internal_turn_counter = max(0, numeric)

    async def get_items(self, limit: int | None = None) -> List[TResponseInputItem]:
        self._normalize_compacted_items()
        if limit is None or limit >= len(self._items):
            items = copy.deepcopy(self._items)
        else:
            items = copy.deepcopy(self._items[-limit:])
        for item in items:
            self._normalize_item(item, for_storage=False)
        return items

    async def add_items(self, items: List[TResponseInputItem]) -> None:
        # Append and then compact if needed.
        self._items.extend(self._safe_copy_items(items))
        self._increment_internal_turn_counter(items)
        self._maybe_compact()

    async def pop_item(self) -> TResponseInputItem | None:
        if not self._items:
            return None
        item = self._items.pop()
        sanitized = copy.deepcopy(item)
        self._normalize_item(sanitized, for_storage=False)
        return sanitized

    async def clear_session(self) -> None:
        self._items.clear()
        self._reset_internal_turn_counter()

    # --------------
    # Core logic
    # --------------

    def _maybe_compact(self) -> None:
        if not self._items:
            return

        self._normalize_compacted_items()

        # Check if thresholds are exceeded
        exceeds = self._exceeds_trigger()
        if not exceeds:
            return

        # Build turn map and call index for pairing results->calls
        turns, user_turn_ids = self._group_by_user_turns()
        protected_turn_ids = set(user_turn_ids[-max(0, self.keep):])  # keep most recent K turns intact

        call_index = _build_call_index(self._items)
        excluded = _lower_set(self.exclude_tools)

        # Iterate from oldest user turns towards newer (excluding protected)
        for turn_id in user_turn_ids:
            if turn_id in protected_turn_ids:
                continue

            # Collect indices inside this turn that we MAY compact
            turn_indices = turns[turn_id]

            # 1) Compact tool RESULTS first (oldest to newest)
            for idx in turn_indices:
                item = self._items[idx]
                if not _is_tool_result(item):
                    continue
                # Determine tool name via call_id lookup
                cid = _get_call_id(item)
                tname = None
                if cid and cid in call_index:
                    tname = call_index[cid]["name"]

                if tname and tname.lower() in excluded:
                    continue

                self._compact_tool_result(idx, tool_name=tname, call_id=cid)

                # After each compaction, check if now under threshold
                if not self._exceeds_trigger():
                    return

            # 2) If still over threshold and clear_tool_inputs=True, compact tool CALLS
            if self.clear_tool_inputs:
                for idx in turn_indices:
                    item = self._items[idx]
                    if not _is_tool_call(item):
                        continue
                    tname = _get_tool_name_from_call(item)
                    if tname and tname.lower() in excluded:
                        continue

                    cid = _get_call_id(item)
                    self._compact_tool_call(idx, tool_name=tname, call_id=cid)

                    if not self._exceeds_trigger():
                        return

        # If we reach here and are still over threshold, we did everything we can
        # (older turns compacted). Newest `keep` turns remain intact by contract.

    def _exceeds_trigger(self) -> bool:
        trig = self.trigger or CompactionTrigger()
        if trig.turns is None:
            return False
        return self.internal_turn_counter > trig.turns

    def _group_by_user_turns(self) -> Tuple[Dict[int, List[int]], List[int]]:
        """
        Returns:
            turns: dict(turn_id -> list of item indices in that turn)
            user_turn_ids: list of turn_ids that are anchored by a user message, in chronological order
        Notes:
            - We create a synthetic "prelude" turn (id=-1) for any items before the first user msg.
            - Only turns with a user anchor are considered for keep/exclusion logic.
        """
        turns: Dict[int, List[int]] = {}
        current_turn_id = -1
        turns[current_turn_id] = []

        user_turn_ids: List[int] = []

        for i, item in enumerate(self._items):
            if _is_user(item):
                # Start a new turn anchored by a user message.
                current_turn_id = i  # use the user item's index as a unique turn id
                turns[current_turn_id] = [i]
                user_turn_ids.append(current_turn_id)
            else:
                turns.setdefault(current_turn_id, []).append(i)

        return turns, user_turn_ids

    def _placeholder(self, *, kind: str, name: Optional[str], call_id: Optional[str]) -> str:
        return self.placeholder_template.format(
            kind=kind,
            name=name or "unknown",
            call_id=call_id or "unknown",
            reason="context_compaction",
        )

    def _normalize_compacted_items(self) -> None:
        if not self._items:
            return
        for item in self._items:
            self._normalize_item(item, for_storage=True)

    def _normalize_item(self, item: TResponseInputItem, *, for_storage: bool) -> None:
        raw_obj = item.get("raw")
        if not isinstance(raw_obj, dict):
            raw_obj = {}
            if for_storage:
                item["raw"] = raw_obj

        message_type = item.get("messageType")
        item_type = item.get("type")
        raw_type = raw_obj.get("type")

        compacted_markers = {"compacted_tool_call", "compacted_tool_result"}
        is_compacted = (
            item.get("compacted")
            or raw_obj.get("compacted")
            or message_type in compacted_markers
            or item_type in compacted_markers
            or raw_type in compacted_markers
        )

        if is_compacted:
            item["messageType"] = "function_call_output"
            item["type"] = "function_call_output"
            if for_storage:
                raw_obj["type"] = "function_call_output"
                raw_obj["compacted"] = True
                item["compacted"] = True
                if "output" not in item and "output" in raw_obj:
                    item["output"] = raw_obj["output"]
        else:
            if for_storage:
                item.pop("compacted", None)
                raw_obj.pop("compacted", None)

        # Drop any legacy bookkeeping fields.
        item.pop("compacted_original_type", None)
        item.pop("compacted_original_messageType", None)

        if not for_storage:
            if item.get("type") == "function_call_output":
                if "output" not in item:
                    output_val = raw_obj.get("output")
                    if output_val is not None:
                        item["output"] = output_val
                item.pop("content", None)
                item.pop("arguments", None)
            item.pop("compacted", None)
            item.pop("raw", None)
            item.pop("messageType", None)

        # Ensure placeholders remain strings/lists without compacted labels.
        self._strip_compacted_labels(item.get("content"))

    def _strip_compacted_labels(self, obj: Any) -> None:
        if isinstance(obj, dict):
            for key, value in list(obj.items()):
                if isinstance(value, str):
                    if value == "compacted_tool_result":
                        obj[key] = "function_call_output"
                    elif value == "compacted_tool_call":
                        obj[key] = "function_call"
                elif isinstance(value, (dict, list)):
                    self._strip_compacted_labels(value)
        elif isinstance(obj, list):
            for idx, value in enumerate(obj):
                if isinstance(value, str):
                    if value == "compacted_tool_result":
                        obj[idx] = "function_call_output"
                    elif value == "compacted_tool_call":
                        obj[idx] = "function_call"
                elif isinstance(value, (dict, list)):
                    self._strip_compacted_labels(value)

    def _compact_tool_result(self, idx: int, *, tool_name: Optional[str], call_id: Optional[str]) -> None:
        """
        Replace tool result payload with a compact placeholder but keep the item in place.
        """
        item = self._items[idx]
        ph = self._placeholder(kind="result", name=tool_name, call_id=call_id)

        # Mark as compacted in a model-visible way:
        # - If there is a string-bearing "content", replace with the placeholder.
        # - Also null out or overwrite raw["output"].
        raw = item.get("raw")
        if not isinstance(raw, dict):
            raw = {}
        raw["output"] = ph
        raw["compacted"] = True
        raw["type"] = "function_call_output"
        item["output"] = ph
        item["raw"] = raw
        item["messageType"] = "function_call_output"
        item["type"] = "function_call_output"

        # Top-level content may be None; ensure something visible exists:
        if item.get("content") is None:
            # Some SDK shapes accept a list of {type:"output_text", text:"..."}
            item["content"] = ph
        elif isinstance(item.get("content"), list):
            # If list, inject an output_text element
            item["content"] = [{"type": "output_text", "text": ph}]
        elif isinstance(item.get("content"), str):
            item["content"] = ph

        # Tag the item for downstream logic if needed
        item["compacted"] = True
        self._normalize_item(item, for_storage=True)
        self._reset_internal_turn_counter(value=self.keep)

    def _compact_tool_call(self, idx: int, *, tool_name: Optional[str], call_id: Optional[str]) -> None:
        """
        Replace tool call arguments with a compact placeholder while keeping the tool name.
        """
        item = self._items[idx]
        ph = self._placeholder(kind="call", name=tool_name, call_id=call_id)
        raw = item.get("raw")
        if not isinstance(raw, dict):
            raw = {}
        raw["arguments"] = ph
        raw["output"] = ph
        raw["compacted"] = True
        raw["type"] = "function_call_output"
        item["output"] = ph
        item["raw"] = raw
        item["messageType"] = "function_call_output"
        item["type"] = "function_call_output"

        # If content exists, make it reflect compaction
        if item.get("content") is None:
            item["content"] = ph
        elif isinstance(item.get("content"), list):
            item["content"] = [{"type": "output_text", "text": ph}]
        elif isinstance(item.get("content"), str):
            item["content"] = ph

        item["compacted"] = True
        self._normalize_item(item, for_storage=True)
        self._reset_internal_turn_counter(value=self.keep)

    def _safe_copy_items(self, items: Iterable[TResponseInputItem]) -> List[TResponseInputItem]:
        copied: List[TResponseInputItem] = []
        for it in items:
            clone = copy.deepcopy(it)
            self._normalize_item(clone, for_storage=True)
            copied.append(clone)
        return copied


# Example Usage:
#
# agent = Agent(name="Assistant")  # from Agents SDK
#
# session = CompactingSession(
#     session_id="compacting_demo",
#     trigger=CompactionTrigger(
#         turns=25,          # start compacting once the conversation exceeds 25 user turns
#     ),
#     keep=2,                        # always keep last 2 user turns intact
#     exclude_tools=["GetOrder"],    # never compact these tool uses/results
#     clear_tool_inputs=False,       # only compact results by default
#     # token_counter=my_token_counter  # optional: plug your own tokenizer
# )
#
# result = await Runner.run(
#     agent,
#     "Hello",
#     session=session
# )


