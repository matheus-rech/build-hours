import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Callable
from uuid import uuid4

from tqdm import tqdm
import threading

from openai import OpenAI

@dataclass
class RunIds:
    eval_id: str
    run_id: str

@dataclass
class EvalParams:
    project: str
    run_name: str
    model: str
    reasoning_effort: str
    graders: dict
    text: dict
    tools: list
    tool_name_to_func: dict

def generate_ids(explicit_eval_id: Optional[str]) -> RunIds:
    eval_id = explicit_eval_id or f"eval_{uuid4().hex}"
    run_id = f"evalrun_{uuid4().hex}"
    return RunIds(eval_id=eval_id, run_id=run_id)


def ensure_output_dir(base_dir: Path, ids: RunIds) -> Path:
    run_dir = base_dir / ids.eval_id / ids.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def process_single_item(
    item_index: int,
    item: Dict[str, Any],
    model: str,
    reasoning_effort: str,
    graders: Optional[Dict[str, Callable[..., Any]]] = None,
    text: Optional[Dict[str, Any]] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_name_to_func: Optional[Dict[str, Callable[..., Any]]] = None,
    client: Optional[OpenAI] = None,
    verbose: bool = False,
) -> Dict[str, Any]:
    """Run the tool-call loop for one item and return a JSON-serializable record with the full trace and metrics."""

    trace_events: List[Dict[str, Any]] = []
    trace_id = f"trace_{uuid4().hex}"
    if verbose:
        print(f"trace_id: {trace_id}")
    context: List[Dict[str, Any]] = deepcopy(item["messages"])
    final_message_text: Optional[str] = None
    error: Optional[str] = None
    metrics: Dict[str, Any] = {}
    grading_duration_seconds: Optional[float] = None
    grader_durations: Dict[str, float] = {}
    duration_seconds: Optional[float] = None

    # Start timing
    start_perf = time.perf_counter()
    # Token usage accumulators across the whole trajectory
    cum_input_tokens: int = 0
    cum_output_tokens: int = 0
    cum_reasoning_tokens: int = 0
    cum_total_tokens: int = 0
    # Token snapshots at the moment the model emits final answer
    usage_total_tokens_at_final: Optional[int] = None
    usage_input_tokens_at_final: Optional[int] = None
    usage_output_tokens_at_final: Optional[int] = None
    usage_reasoning_tokens_at_final: Optional[int] = None
    try:
        outer_break = False
        model_tool_calls: List[Dict[str, Any]] = []
        if verbose:
            print(f"Entering tool-call loop.")
        while not outer_break:
            response = client.responses.create(
                model=model,
                input=context,
                tools=tools,
                tool_choice="auto",
                reasoning={"effort": reasoning_effort},
                store=False,
                include=["reasoning.encrypted_content"],
                parallel_tool_calls=True,
                text=text
            )
            # Accumulate API-reported usage tokens for this step
            try:
                usage = getattr(response, "usage", None)
                if usage is not None:
                    # Support both Responses and potential dict-like usage
                    def get_field(obj, name):
                        return getattr(obj, name, None) if hasattr(obj, name) else (obj.get(name, None) if isinstance(obj, dict) else None)

                    it = get_field(usage, "input_tokens")
                    ot = get_field(usage, "output_tokens")
                    rt = get_field(usage, "reasoning_tokens")
                    tt = get_field(usage, "total_tokens")
                    cached = get_field(usage, "cached_input_tokens")
                    # Some models report reasoning tokens under output_tokens_details.reasoning_tokens
                    otd = get_field(usage, "output_tokens_details")
                    otd_rt = get_field(otd, "reasoning_tokens") if isinstance(otd, (dict, object)) else None

                    it_i = int(it) if isinstance(it, (int, float)) else 0
                    ot_i = int(ot) if isinstance(ot, (int, float)) else 0
                    rt_i = int(rt) if isinstance(rt, (int, float)) else 0
                    if rt_i == 0 and isinstance(otd_rt, (int, float)):
                        rt_i = int(otd_rt)
                    tt_i = int(tt) if isinstance(tt, (int, float)) else 0
                    cached_i = int(cached) if isinstance(cached, (int, float)) else 0

                    # Derive output tokens if missing or zero but totals available
                    if ot_i == 0 and tt_i > 0 and (it_i > 0 or rt_i > 0 or cached_i > 0):
                        derived_ot = tt_i - it_i - rt_i - cached_i
                        if derived_ot < 0:
                            derived_ot = 0
                        ot_i = derived_ot

                    cum_input_tokens += it_i
                    cum_output_tokens += ot_i
                    cum_reasoning_tokens += rt_i
                    cum_total_tokens += tt_i
            except Exception:
                pass
            outputs = response.output
            context += outputs

            # First pass: collect tool calls and other events in order; defer execution
            tool_calls: List[Dict[str, Any]] = []
            num_outputs = len(outputs)
            for idx, output in enumerate(outputs):
                otype = getattr(output, "type", None)
                if otype == "function_call":
                    tool_name = getattr(output, "name", None)
                    tool_args_text = getattr(output, "arguments", "{}") or "{}"
                    call_id = getattr(output, "call_id", None)

                    # Validate availability and record the call; execution deferred
                    if not tool_name_to_func or tool_name not in tool_name_to_func:
                        raise KeyError(f"Tool not found: {tool_name}")
                    trace_events.append({
                        "event": "tool_call",
                        "name": tool_name,
                        "arguments": tool_args_text,
                        "call_id": call_id,
                    })
                    model_tool_calls.append({
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": tool_args_text,
                        },
                    })
                    args_obj = json.loads(tool_args_text)
                    tool_calls.append({
                        "order": len(tool_calls),
                        "name": tool_name,
                        "args_obj": args_obj,
                        "call_id": call_id,
                    })
                    if verbose:
                        print(f"Queued tool {tool_name} with args {args_obj}")

                elif otype == "message":
                    next_type = outputs[idx + 1].type if idx + 1 < num_outputs else None
                    msg_text = None
                    content = getattr(output, "content", [])
                    if content and isinstance(content, list):
                        first = content[0]
                        msg_text = getattr(first, "text", None)
                    if next_type == "function_call":
                        trace_events.append({"event": "preamble_message", "text": msg_text})
                    else:
                        final_message_text = msg_text
                        trace_events.append({"event": "final_message", "text": final_message_text})
                        usage_total_tokens_at_final = cum_total_tokens
                        usage_input_tokens_at_final = cum_input_tokens
                        usage_output_tokens_at_final = cum_output_tokens
                        usage_reasoning_tokens_at_final = cum_reasoning_tokens
                        outer_break = True

                elif otype == "reasoning":
                    trace_events.append({"event": "reasoning_summary", "summary": getattr(output, "summary", None)})

            # If the model produced a final message, stop before executing any tools
            if outer_break:
                break

            # Execute all scheduled tool calls in parallel (if any), then append outputs in order
            if tool_calls:
                def _run_tool(tc: Dict[str, Any]):
                    try:
                        result = tool_name_to_func[tc["name"]](
                            item=item,
                            trace_id=trace_id,
                            user_id="tmp_user_id",
                            call_id=tc["call_id"],
                            verbose=verbose,
                            **tc["args_obj"],
                        )
                        try:
                            out_val = result["output"]
                        except Exception:
                            out_val = result.get("result", {}).get("output")
                        return tc["order"], {
                            "type": "function_call_output",
                            "call_id": tc["call_id"],
                            "output": out_val,
                        }, None, tc["name"]
                    except Exception as e:
                        return tc["order"], None, str(e), tc["name"]

                parallel_errors: List[str] = []
                results_parallel: List[Any] = []
                with ThreadPoolExecutor(max_workers=min(len(tool_calls), 8)) as pool:
                    futures = [pool.submit(_run_tool, tc) for tc in tool_calls]
                    for f in futures:
                        results_parallel.append(f.result())

                # Append outputs in call order; record errors
                results_parallel.sort(key=lambda x: x[0])
                for _, function_output_record, err_text, tool_name in results_parallel:
                    if err_text is not None:
                        # Record error event; defer stop until after processing all results
                        trace_events.append({
                            "event": "tool_error",
                            "name": tool_name,
                            "error": err_text,
                        })
                        parallel_errors.append(err_text)
                    else:
                        context.append(function_output_record)
                        trace_events.append({"event": "tool_result", **function_output_record})

                # If any error occurred among parallel tools, stop after recording
                if parallel_errors:
                    error = "; ".join(parallel_errors)
                    outer_break = True
        duration_seconds = time.perf_counter() - start_perf

        # Metrics
        if verbose:
            print("final_message_text", final_message_text)
        try:
            if final_message_text is not None:
                # Build sample payload for graders per endpoint grader docs
                try:
                    parsed_json = json.loads(final_message_text)
                except Exception:
                    parsed_json = None

                sample_payload = {
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": final_message_text,
                                "tool_calls": [],
                            },
                            "finish_reason": "stop",
                        }
                    ],
                    "output_text": final_message_text,
                    "output_json": parsed_json,
                    "output_tools": model_tool_calls,
                }

                if graders:
                    if verbose:
                        print(f"Grading with {graders.keys()}")
                    grading_start = time.perf_counter()
                    for grader_name, grader_fn in graders.items():
                        single_start = time.perf_counter()
                        value = grader_fn(sample_payload, item, trace_id)
                        grader_durations[grader_name] = time.perf_counter() - single_start
                        metrics[grader_name] = value
                    grading_duration_seconds = time.perf_counter() - grading_start
                    if verbose:
                        print(f"Grading with {graders.keys()} done.")
            # If we encountered an error (e.g., tool/run failure) and have no metrics yet,
            # assign a default negative reward so the run is recorded with failure signal.
            if error is not None and not metrics:
                metrics = {"reward": -1}
        except Exception as e:
            print("ERROR", e)
            # Leave metrics empty if graders are unavailable or error
            pass

    except Exception as exc:  # Capture any failure and return trace so far
        error = str(exc)
        print("ERROR", error)
        # Ensure we still have a persisted failure signal and partial trace
        trace_events.append({"event": "runtime_error", "error": error})
        metrics = {"reward": -1}
        duration_seconds = None

    return {
        "sample_index": item_index,
        "input_item": item,
        "trace": trace_events,
        "final_message_text": final_message_text,
        "metrics": metrics,
        "grader_durations": grader_durations,
        "error": error,
        "duration_seconds": duration_seconds,
        "grading_duration_seconds": grading_duration_seconds,
        # Usage tokens from Responses API
        "usage_cumulative": {
            "input_tokens": cum_input_tokens,
            "output_tokens": cum_output_tokens,
            "reasoning_tokens": cum_reasoning_tokens,
            "total_tokens": cum_total_tokens,
        },
        # Snapshot at final answer (if any)
        "usage_at_final": {
            "input_tokens": usage_input_tokens_at_final,
            "output_tokens": usage_output_tokens_at_final,
            "reasoning_tokens": usage_reasoning_tokens_at_final,
            "total_tokens": usage_total_tokens_at_final,
        },
    }


def write_manifest(manifest_path: Path, manifest: Dict[str, Any]) -> None:
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))


def append_jsonl_line(file_path: Path, obj: Dict[str, Any], lock: Lock) -> None:
    line = json.dumps(obj, ensure_ascii=False)
    with lock:
        with file_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def process_and_save(output_jsonl, idx, item, model, reasoning_effort, graders, text, tools, tool_name_to_func, client, lock, verbose=False):
    result = process_single_item(
        item_index=idx,
        item=item,
        model=model,
        reasoning_effort=reasoning_effort,
        graders=graders,
        text=text,
        tools=tools,
        tool_name_to_func=tool_name_to_func,
        client=client,
        verbose=verbose,
    )
    append_jsonl_line(output_jsonl, result, lock)
    return (idx, result["metrics"], result["duration_seconds"])

def run_tool_eval(
        items,
        eval_params,
        client=None,
        verbose=False,
        max_workers: Optional[int] = None,
    ):

    # Unpack eval_params
    project = eval_params.project
    run_name = eval_params.run_name
    model = eval_params.model
    reasoning_effort = eval_params.reasoning_effort
    graders = eval_params.graders
    text = eval_params.text
    tools = eval_params.tools
    tool_name_to_func = eval_params.tool_name_to_func

    # Create a lock for the output file
    lock = threading.Lock()

    # Generate unique run IDs and output directory for this run
    run_ids = generate_ids(run_name)
    print(f"Run IDs: {run_ids}", "project", project, "run_name", run_name)
    output_dir = ensure_output_dir(Path(f"build_hour/{project}/tool_evals"), run_ids)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_jsonl = output_dir / "results.jsonl"

    # Run the tool evaluation
    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(
            process_and_save,
            output_jsonl,
            idx,
            item,
            model,
            reasoning_effort,
            graders,
            text,
            tools,
            tool_name_to_func,
            client,
            lock,
            verbose,
        ) for idx, item in enumerate(items)]
        for future in tqdm(as_completed(futures), total=len(futures), desc=f"Processing items (run: {run_ids.run_id})"):
            idx, metrics, duration = future.result()
            results.append((idx, metrics, duration))
    print(f"Results for run {run_ids.run_id} saved to {output_jsonl}")
    return results, output_jsonl
