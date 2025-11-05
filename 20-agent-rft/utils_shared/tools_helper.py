import os, json, requests

def build_tool_function(
    tool_name,
    endpoint_url,
    default_auth_bearer=None,
    timeout=300,
    default_forwarded_headers: dict | None = None,
    default_payload_extra: dict | None = None,
):
    """
    Factory that returns a callable tool function, parameterized by name, URL, and default auth token.

    The resulting function signature matches the prior tools and also supports an optional
    auth_bearer kwarg to override at call-time. If not provided, it falls back to the
    default_auth_bearer, then environment variables CAPYBARA_TOOLS_BEARER or CAPYBARA_API_TOKEN.
    """

    def tool_func(
        item=None,
        trace_id=None,
        user_id=None,
        call_id=None,
        verbose=False,
        **kwargs,
    ):
        """
        Invoke the tool via OpenAI's tool/run API, which forwards to the provided server_url.

        Requires OPENAI_API_KEY in the environment; OPENAI_PROJECT is optional.
        """

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set for tool/run call.")

        # Headers that OpenAI will forward to the tool endpoint
        forwarded_headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if default_forwarded_headers:
            forwarded_headers.update(default_forwarded_headers)
        # Back-compat: if only a bearer was provided, honor it unless already set
        if default_auth_bearer and "Authorization" not in forwarded_headers:
            forwarded_headers["Authorization"] = f"Bearer {default_auth_bearer}"

        # Allow per-call overrides/extensions
        auth_bearer = kwargs.pop("auth_bearer", None)
        if auth_bearer:
            forwarded_headers["Authorization"] = f"Bearer {auth_bearer}"
        per_call_headers = kwargs.pop("headers", None)
        if per_call_headers and isinstance(per_call_headers, dict):
            forwarded_headers.update(per_call_headers)

        payload = {
            "type": "function_call",
            "name": tool_name,
            "server_url": endpoint_url,
            "headers": forwarded_headers,
            "arguments": json.dumps(kwargs),
            "item": item or {},
            "trace_id": trace_id,
            "id": user_id,
            "call_id": call_id,
        }
        # Include any default/extra fields the caller wants to persist (e.g., rate limits)
        if default_payload_extra:
            payload.update(default_payload_extra)
        per_call_payload_extra = kwargs.pop("payload_extra", None)
        if per_call_payload_extra and isinstance(per_call_payload_extra, dict):
            payload.update(per_call_payload_extra)

        openai_headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        project = os.environ.get("OPENAI_PROJECT")
        if project:
            openai_headers["OpenAI-Project"] = project

        resp = requests.post(
            "https://api.openai.com/v1/fine_tuning/alpha/tool/run",
            headers=openai_headers,
            json=payload,
            timeout=timeout,
        )
        if verbose:
            print("RESP", resp.status_code, resp.text)
        try:
            resp.raise_for_status()
        except Exception as e:
            raise RuntimeError(f"tool/run error {resp.status_code}: {resp.text}") from e
        return resp.json()

    tool_func.__name__ = tool_name
    return tool_func

def tools_completions_to_responses(tools_completions):
    """
    Convert a list of tool definitions in the completions format to the responses format.
    """
    responses = []
    for tool in tools_completions:
        if tool.get("type") == "function" and "function" in tool:
            func = tool["function"]
            parameters = dict(func.get("parameters", {}))
            parameters.pop("strict", None)
            responses.append({
                "type": "function",
                "name": func.get("name"),
                "description": func.get("description"),
                "parameters": parameters,
            })
    return responses


def build_tool_function_from_spec(spec: dict):
    """Create a tool function from a JOB_LEVEL_TOOLS-style spec.

    spec expects keys: name, server_url, headers (optional), and any other extra fields.
    Returns (name, function).
    """
    name = spec.get("name")
    url = spec.get("server_url")
    if not name or not url:
        raise ValueError("Tool spec must include 'name' and 'server_url'")
    headers = spec.get("headers", {})
    extra = {k: v for k, v in spec.items() if k not in {"name", "server_url", "headers"}}
    func = build_tool_function(
        tool_name=name,
        endpoint_url=url,
        default_forwarded_headers=headers,
        default_payload_extra=extra,
    )
    return name, func


def iter_tools_entries_from_jsonl(path: str):
    """Yield tool entries from a JSONL dataset file where each line may include a top-level 'tools' list.

    The function is tolerant of malformed lines and will skip them.
    """
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            tools = obj.get("tools") or []
            for tool in tools:
                yield tool


def load_tools_completions_from_project_data(project_dir: str) -> list:
    """Load tool definitions in completions format from {project}_train.jsonl and {project}_val.jsonl.

    - project_dir: Absolute path to the project directory (the parent of its 'utils_tools' and 'data' dirs).
    - Returns: list of tool dicts (completions format), de-duplicated and filtered to function tools.
    """
    project_name = os.path.basename(os.path.abspath(project_dir))
    data_dir = os.path.join(project_dir, "data")

    dataset_files = [
        os.path.join(data_dir, f"{project_name}_train.jsonl"),
        os.path.join(data_dir, f"{project_name}_val.jsonl"),
    ]
    dataset_files = [p for p in dataset_files if os.path.exists(p)]

    seen: set[str] = set()
    tools_out: list[dict] = []

    for path in dataset_files:
        if not path.endswith(".jsonl"):
            continue
        for tool in iter_tools_entries_from_jsonl(path):
            if not isinstance(tool, dict):
                continue
            if tool.get("type") != "function" or "function" not in tool:
                continue
            # Normalize: ensure strict=True and additionalProperties=False
            func = tool.get("function", {})
            if "strict" not in func:
                func["strict"] = True
            params = func.get("parameters")
            if not isinstance(params, dict):
                params = {"type": "object", "properties": {}, "required": []}
                func["parameters"] = params
            if "additionalProperties" not in params:
                params["additionalProperties"] = False
            key = json.dumps(tool, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            tools_out.append(tool)

    return tools_out
