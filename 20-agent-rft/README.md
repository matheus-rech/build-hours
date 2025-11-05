# Agentic RFT – Project Template and Scaffolding

This repository provides a simple way to create projects with a consistent structure and pre-populated utility files. It includes a scaffolding script, a redacted template, and notebooks for training and inference.

## Prerequisites
- Python 3.9+
- Environment variable `OPENAI_API_KEY` set for API access

## Create a New Project
Use the scaffold script to create a new project. The script creates the folder structure and copies redacted utility files.

- Positional usage:
```bash
python scaffold_new_project.py PROJECT
```

- Flag usage:
```bash
python scaffold_new_project.py --project PROJECT
# or
python scaffold_new_project.py -p PROJECT
```

This creates the project at:
```
<repo_root>/PROJECT/
```

The script will fail if the target project directory already exists (no overwrite).

### What gets created
```
PROJECT/
  data/
  tool_evals/
  utils_tools/
    graders.py
    openai_client.py
    text_format.py
    tools.py
  README.md
```

## Data Naming Convention
Place your dataset files in the `data/` folder and name them exactly as follows:
- `{project}_train.jsonl`
- `{project}_val.jsonl`

For example, if `PROJECT` is `to_do_list`:
- `data/to_do_list_train.jsonl`
- `data/to_do_list_val.jsonl`

Data content should follow the schema/fields expected by your graders, tools, and notebooks for this project.

## Configure Utility Files
The `utils_tools/` folder contains redacted placeholders that you must replace with your real values.

- `utils_tools/graders.py`
  - `GRADER_OBJECT["url"]` → `"your_url_here"`
  - `GRADER_OBJECT["headers"]["Authorization"]` → `"Bearer your_key_here"`

- `utils_tools/tools.py`
  - For each entry in `JOB_LEVEL_TOOLS`:
    - `server_url` → `"your_url_here"`
    - `headers.Authorization` → `"Bearer your_key_here"`
  - If you have no tools, set the following to disable tools cleanly:
    ```python
    TOOLS_COMPLETIONS = None
    JOB_LEVEL_TOOLS = None
    TOOLS_RESPONSES = None
    TOOL_NAME_TO_FUNC = None
    ```

- `utils_tools/openai_client.py`
  - `OPENAI_PROJECT_ID` → `"your_project_id_here"`
  - Ensure `OPENAI_API_KEY` is set in your environment

- `utils_tools/text_format.py`
  - Contains commented examples showing how to specify a JSON schema response format. Keep comments as-is; uncomment and customize if you need a structured output format.

## Notebooks
- `Agentic_RFT_Train.ipynb`
  - Use this to train/evaluate or run project-specific workflows during development.
  - Expects data files in `PROJECT/data/` following the naming convention above.
  - Leverages the utilities in `PROJECT/utils_tools/`.

- `Agentic_RFT_Inference.ipynb`
  - Use this to run inference flows against a prepared project.
  - Also expects the utilities and configuration under `PROJECT/utils_tools/`.

Recommended first step:
- Start with the inference notebook using a base model to quickly sanity-check endpoint connectivity and establish a baseline metric before training/tuning.

### API mode and reasoning
- The notebooks use the Responses API to match the training distribution.
- Encrypted reasoning is enabled (via `include=["reasoning.encrypted_content"]`) along with `reasoning={"effort": ...}` to keep behavior consistent with training.

### Where results and traces are stored
- Inference/eval outputs are saved under:
  ```
  <project>/tool_evals/<eval_id>/<run_id>/results.jsonl
  ```
- `<eval_id>` defaults to the provided run name; the default used in the notebooks is `model-reasoning` unless you override it.
- `<run_id>` is auto-generated per execution.
- Each JSONL line contains the full trace (tool calls, messages, reasoning summary) plus metrics and timing.

## Template Source
The scaffold script copies redacted files from:
```
template_project/utils_tools/
```
Do not modify the template directly unless you intend to change the default scaffold for all future projects.

## Troubleshooting
- "Target project directory already exists": choose a new `PROJECT` name or remove the existing directory.
- "Missing source file": ensure the template exists at `template_project/utils_tools` with the four files.
- API errors: verify `OPENAI_API_KEY` is set and `OPENAI_PROJECT_ID` is configured.

## Notes
- The scaffold does not overwrite existing files or projects.
- Utility files preserve comments to make it easy to modify response formats and tool definitions.
-- Requests to external tool endpoints are egressed via the `api.openai.com` domain by default.
