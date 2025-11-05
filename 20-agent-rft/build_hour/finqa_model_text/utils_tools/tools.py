import os
from utils_shared.tools_helper import (
    tools_completions_to_responses,
    build_tool_function_from_spec,
    load_tools_completions_from_project_data,
)

TOOL_BEARER_TOKEN = os.getenv("TOOL_BEARER_TOKEN", "").strip()
DEFAULT_HEADERS = {"Authorization": f"Bearer {TOOL_BEARER_TOKEN}"} if TOOL_BEARER_TOKEN else {}

# Job-level tools format for RFT API
JOB_LEVEL_TOOLS = [
    { "name": "search", "server_url": "https://theophile--finqa-tool-server-fastapi-app.modal.run/search", "headers": DEFAULT_HEADERS },
    { "name": "list", "server_url": "https://theophile--finqa-tool-server-fastapi-app.modal.run/list", "headers": DEFAULT_HEADERS },
    { "name": "cat", "server_url": "https://theophile--finqa-tool-server-fastapi-app.modal.run/cat", "headers": DEFAULT_HEADERS }
]

# Auto-create concrete tool functions from JOB_LEVEL_TOOLS
for _spec in JOB_LEVEL_TOOLS:   
    _name, _func = build_tool_function_from_spec(_spec)
    globals()[_name] = _func


# Tools in the completions format, dynamically sourced from dataset files
here = os.path.dirname(__file__)
project_dir = os.path.abspath(os.path.join(here, os.pardir))
TOOLS_COMPLETIONS = load_tools_completions_from_project_data(project_dir)

# tools in the responses format
TOOLS_RESPONSES = tools_completions_to_responses(TOOLS_COMPLETIONS)

# build a dictionary of tool names to functions
TOOL_NAME_TO_FUNC = {
    entry["function"]["name"]: globals()[entry["function"]["name"]]
    for entry in TOOLS_COMPLETIONS
    if entry.get("type") == "function"
    and entry.get("function", {}).get("name") in globals()
}