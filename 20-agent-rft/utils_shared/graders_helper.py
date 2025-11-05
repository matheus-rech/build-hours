import inspect
import re
import textwrap
import os
import json
import requests

def build_python_grader_payload(grader_fn):
    """Build a payload for a python grader with signature def grade(sample, item): and no annotations."""
    src = inspect.getsource(grader_fn)
    src = textwrap.dedent(src)
    # 1) Rename function to grade
    src = re.sub(r'^def\s+\w+\s*\(', 'def grade(', src, count=1, flags=re.M)
    # 2) Drop return type annotations
    src = re.sub(r'\)\s*->[^:]+:', '):', src, count=1)
    # 3) Normalize arguments to (sample, item)
    def _rewrite_signature(m):
        args_str = m.group(1)
        args = [a.strip() for a in args_str.split(',') if a.strip()]
        # Remove any trace_id arg
        args = [a for a in args if not a.startswith('trace_id')]
        # Keep only first two args
        if len(args) >= 2:
            new_args = f"{args[0]}, {args[1]}"
        else:
            new_args = ", ".join(args)
        return f"def grade({new_args}):"
    src = re.sub(r'^def\s+grade\s*\((.*?)\)\s*:', _rewrite_signature, src, count=1, flags=re.M)
    return {"type": "python", "source": src}


def build_endpoint_grader_function(
    name: str,
    url: str,
    *,
    default_headers: dict | None = None,
    timeout: int = 300,
    default_payload_extra: dict | None = None,
):
    """Factory that returns a callable that invokes graders/run with an endpoint grader spec.

    The callable matches a simple signature: grader(sample, item=None, trace_id=None, verbose=False, **kwargs)
    - Will read OPENAI_API_KEY and optional OPENAI_PROJECT from environment
    - Merges default_headers with any per-call headers provided via headers kwarg
    - Allows adding extra fields to the grader object via default_payload_extra or per-call payload_extra
    - Builds model_sample from sample["output_text"] or JSON-encoded sample["output_json"], else JSON of sample
    """

    def grader_func(sample=None, item=None, trace_id=None, verbose=False, **kwargs):
        if sample is None:
            sample = {}
        if item is None:
            item = {}

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set for graders/run call.")

        # Build grader object
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if default_headers:
            headers.update(default_headers)
        per_call_headers = kwargs.pop("headers", None)
        if isinstance(per_call_headers, dict):
            headers.update(per_call_headers)

        grader_obj = {"type": "endpoint", "url": url, "headers": headers, "name": name}
        if default_payload_extra:
            grader_obj.update(default_payload_extra)
        per_call_payload_extra = kwargs.pop("payload_extra", None)
        if isinstance(per_call_payload_extra, dict):
            grader_obj.update(per_call_payload_extra)

        # Model sample formatting
        if isinstance(sample.get("output_text"), str):
            model_sample_str = sample["output_text"]
        elif sample.get("output_json") is not None:
            model_sample_str = json.dumps(sample["output_json"], separators=(",", ":"))
        else:
            model_sample_str = json.dumps(sample, separators=(",", ":"))

        payload = {
            "grader": grader_obj,
            "item": item,
            "model_sample": model_sample_str,
            "trace_id": trace_id,
        }

        headers_openai = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        project = os.environ.get("OPENAI_PROJECT")
        if project:
            headers_openai["OpenAI-Project"] = project

        resp = requests.post(
            "https://api.openai.com/v1/fine_tuning/alpha/graders/run",
            headers=headers_openai,
            json=payload,
            timeout=timeout,
        )
        if verbose:
            print("RESP", resp.status_code, resp.text)
        resp.raise_for_status()
        return resp.json()

    grader_func.__name__ = name
    return grader_func


def build_endpoint_grader_function_from_spec(spec: dict):
    """Create an endpoint grader callable from a spec.

    Returns (name, grader_callable)
    """
    obj = dict(spec)
    obj.setdefault("type", "endpoint")
    if obj.get("type") != "endpoint":
        raise ValueError("Endpoint grader spec must have type='endpoint'")
    if not obj.get("url"):
        raise ValueError("Endpoint grader spec requires 'url'")

    name = obj.get("name") or "endpoint_grader"
    headers = obj.get("headers", {})
    extra = {k: v for k, v in obj.items() if k not in {"type", "url", "headers", "name"}}

    grader_callable = build_endpoint_grader_function(
        name=name,
        url=obj["url"],
        default_headers=headers,
        default_payload_extra=extra,
    )
    return name, grader_callable