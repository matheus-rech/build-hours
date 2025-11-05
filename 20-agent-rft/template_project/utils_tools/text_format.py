# # set the response format, if any
# from pydantic import BaseModel
# from typing import Dict, Any
# from openai.lib._pydantic import to_strict_json_schema 

# # Toy example of a PII schema
# class OutputSchema(BaseModel):
#     name: str
#     email: str

# schema = to_strict_json_schema(OutputSchema)
# RESPONSE_FORMAT_RESPONSES: Dict[str, Any] = {
#     "type": "json_schema",
#     "name": OutputSchema.__name__,
#     "schema": schema,
#     "strict": True,
# }

# RESPONSE_FORMAT_COMPLETIONS: Dict[str, Any] = {
#     "type": "json_schema",
#     "json_schema": {
#         "name": OutputSchema.__name__,
#         "schema": schema,
#         "strict": True,
#     },
# }

RESPONSE_FORMAT_COMPLETIONS = None
RESPONSE_FORMAT_RESPONSES = None


