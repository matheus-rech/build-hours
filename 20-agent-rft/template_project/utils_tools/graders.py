from typing import Dict, Any
from utils_shared.graders_helper import build_endpoint_grader_function_from_spec

# Customer-provided endpoint grader spec (single)
GRADER_OBJECT: dict = {
    "type": "endpoint",
    "url": "your_url_here",
    "headers": {
        "Authorization": "Bearer your_key_here",
    },
}

name, grader_callable = build_endpoint_grader_function_from_spec(GRADER_OBJECT)
GRADERS: Dict[str, Any] = {name: grader_callable}


