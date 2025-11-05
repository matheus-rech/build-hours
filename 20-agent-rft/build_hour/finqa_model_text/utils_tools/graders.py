import json
from typing import Dict, Any
from .openai_client import client

# Model grader spec
GRADER_OBJECT: dict = {
   "type": "score_model",
   "name": "gpt41_score_model_1",
   "input": [
        {
            "role": "system",
            "content": """## System Prompt — Numerical Grader

You will be provided with the following information:
- the Reference Answer
- a value containing the Model's Answer.

Your job is to score the Model's Answer.

### Scoring Rules

Return a score of 1 if both are true:
- Model's Answer contains only the final numeric answer (no extra words)
- The numeric value matches the Reference Answer within slight unit differences

Unit/format variations that still count as correct:
- Currency symbols (e.g., $, USD)
- Magnitude suffixes (e.g., M, million, K)
- Percent formats (e.g., 7% vs 0.07)
- Commas and whitespace differences

Return a score of 0.5 if the Model's Answer is very close to the Reference Answer, but is off by a tenth of a percent or less or appears to be a true rounding error.

Return a score of 0 in all other cases.

Please only return the numerical score, and nothing else."""
        },
        {
            "role": "user",
            "content": """- Reference Answer: {{item.reference_answer}}.
- Model's Answer: {{sample.output_text}}."""
        }
   ],
   "pass_threshold": 0.75,
   "model": "gpt-4.1-2025-04-14",
   "range": [0, 1],
   "sampling_params": {
       "temperature": 0,
   },
}

response_format = {
  "type": "json_schema",
  "name": "float_score_classification",
  "strict": True,
  "schema": {
    "type": "object",
    "properties": {
      "steps": {
        "type": "array",
        "description": "A sequence of steps outlining the reasoning process.",
        "items": {
          "type": "object",
          "properties": {
            "description": {
              "type": "string",
              "description": "Detailed description of the reasoning in this step."
            },
            "conclusion": {
              "type": "string",
              "description": "The conclusion of the reasoning in this step."
            }
          },
          "required": ["description", "conclusion"],
          "additionalProperties": False
        }
      },
      "result": {
        "type": "number",
        "description": "The float score assigned to the response. This should be in inclusive range RANGE_MIN to RANGE_MAX."
      }
    },
    "required": ["steps", "result"],
    "additionalProperties": False
  }
}


# Adapted python_model_grader to match the other graders' interface
def python_model_grader(sample, item, trace_id=None, model_grader=GRADER_OBJECT):
    """
    Calls an OpenAI model to grade the model output against the reference answer.
    Expects sample to have "output_text", item to have "reference_answer".
    Returns a float score (parsed from the model's JSON response).
    """
    # Prepare the prompt as the grader expects
    system_prompt = model_grader["input"][0]["content"]
    user_prompt = model_grader["input"][1]["content"]
    user_prompt_filled = user_prompt.replace("{{item.reference_answer}}", item["reference_answer"]).replace("{{sample.output_text}}", sample["output_text"])
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt_filled}
    ]

    # Call the OpenAI API with the grader's model
    response = client.responses.create(
        model=model_grader["model"],
        input=messages,
        temperature=model_grader.get("sampling_params", {}).get("temperature", 0),
        text={"format": response_format},
    )

    # Parse the float score from the model's JSON response
    parsed = json.loads(response.output[0].content[0].text)
    return float(parsed["result"])

GRADERS: Dict[str, Any] = {
    "model_grader": python_model_grader,
}