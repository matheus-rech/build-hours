import os
from utils_shared.tools_helper import (
    tools_completions_to_responses,
    build_tool_function_from_spec,
    load_tools_completions_from_project_data,
)

# Job-level tools format for RFT API
JOB_LEVEL_TOOLS = [
    {
        "name": "your_tool_name_here",
        "server_url": "your_url_here",
        "headers": {
            "Authorization": "Bearer your_key_here",
        },
    },
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


