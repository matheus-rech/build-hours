"""Modal-hosted FinQA tool server.

The app exposes the following endpoints:

- POST /list: Given {"path": "<dir>"}, returns {"entries": [<children>]} under that prefix
  (directories as "prefix/child", files as full paths).
- POST /cat: Given {"path": "<file>"}, returns {"document": {path, content, pre_text, post_text}}
  for the exact document path.
- POST /search: Given {"query": "..."}, embeds the query and returns {"document": {...}}
  for the most similar document by cosine similarity.

Usage
-----

1) Download the corpus locally from:

https://github.com/czyssrs/FinQA/tree/main/

2) Create the Modal secret (providing your OpenAI API key):

modal secret create finqa-tool-server OPENAI_API_KEY="<your-api-key>" TOOL_BEARER_TOKEN="<your-TOOL_BEARER_TOKEN>"

3) Deploy the server:

modal deploy tool_server_modal.py

The deployment output will include the public base URL of your tool server.

4) Sanity-check the server with a sample query:

curl -X POST https://<your-server-hostname>/search \
    -H "Authorization: Bearer <your-TOOL_BEARER_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"arguments": "{\"query\":\"what is the net change in net revenue during 2015 for entergy corporation?\"}"}'
"""

from __future__ import annotations

import json
import os
from typing import Any

import modal
import numpy as np
import numpy.typing as npt
import pandas as pd
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from openai import OpenAI

APP_NAME = "finqa-tool-server"
CORPUS_PATH = "/Users/theophile/Documents/repos/build-hours/20-agent-rft/build_hour/finqa/data/corpus.pkl"
EMBEDDING_MODEL = "text-embedding-3-small"


base_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "fastapi[standard]",
        "pandas",
        "numpy",
        "openai",
    )
    .add_local_file(CORPUS_PATH, CORPUS_PATH, copy=True)
)


app = modal.App(APP_NAME)
web = FastAPI()
client: OpenAI | None = None
corpus: pd.DataFrame | None = None

security = HTTPBearer(auto_error=False)

def verify_bearer(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> bool:
    expected = os.getenv("TOOL_BEARER_TOKEN", "").strip()
    if not expected:
        raise HTTPException(
            status_code=500,
            detail="Server misconfigured: TOOL_BEARER_TOKEN not set",
        )
    if credentials is None or (credentials.scheme or "").lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if credentials.credentials != expected:
        raise HTTPException(status_code=401, detail="Invalid bearer token")
    return True


def load_df(path: str) -> pd.DataFrame:
    path = path.strip()
    df = pd.read_pickle(path)
    df = df.set_index("path", drop=False)
    return df


def get_embedding(
    text: str, model: str = EMBEDDING_MODEL, **kwargs: Any
) -> npt.NDArray[np.float32]:
    text = text.replace("\n", " ")
    assert client is not None, "OpenAI client not initialized"
    response = client.embeddings.create(input=[text], model=model, **kwargs)
    return np.array(response.data[0].embedding, dtype=np.float32)


def cosine_similarity(a: npt.NDArray[np.float32], b: npt.NDArray[np.float32]) -> float:
    an = float(np.linalg.norm(a))
    bn = float(np.linalg.norm(b))
    if an == 0.0 or bn == 0.0:
        return 0.0
    return float(np.dot(a, b) / (an * bn))


async def extract_arguments(request: Request):
    body_bytes = await request.body()
    body_text = body_bytes.decode("utf-8", errors="replace")
    headers_dict = dict(request.headers)
    client_host = request.client.host if request.client else None
    # Print method, URL, client, headers, and raw body for full visibility
    print(f"[{APP_NAME}] {request.method} {request.url} from={client_host}")
    print(f"[{APP_NAME}] headers={headers_dict}")
    print(f"[{APP_NAME}] body={body_text}")

    if not body_text:
        raise HTTPException(
            status_code=400, detail="Request body must be JSON with an 'arguments' object"
        )

    try:
        body = json.loads(body_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Request body is not valid JSON")

    call_id = body.get("call_id", "")
    id = body.get("id", "")

    if "arguments" not in body:
        raise HTTPException(
            status_code=400, detail="Missing required 'arguments' field in request body"
        )

    arguments_raw = body["arguments"]
    if isinstance(arguments_raw, str):
        try:
            arguments = json.loads(arguments_raw)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="'arguments' string is not valid JSON")
    elif isinstance(arguments_raw, dict):
        arguments = arguments_raw
    else:
        raise HTTPException(
            status_code=400,
            detail="'arguments' must be a JSON object or JSON-encoded object string",
        )

    return arguments, call_id, id


@web.post("/list")
async def list_endpoint(request: Request, _: bool = Depends(verify_bearer)):
    arguments, call_id, id = await extract_arguments(request)
    prefix = str((arguments or {}).get("path", "")).strip()
    if prefix.endswith("/"):
        prefix = prefix.rstrip("/")

    # Validate directory: if an exact file path with no children, return error
    index: list[str] = [str(p) for p in corpus.index] if corpus is not None else []
    if prefix and (prefix in index):
        has_child = any(str(p).startswith(prefix + "/") for p in index)
        if not has_child:
            return {"output": "Error: not a valid directory", "call_id": call_id, "id": id}

    entries = set()
    for p in index:
        if prefix and not p.startswith(prefix):
            continue
        remainder = p[len(prefix) :] if prefix else p
        if prefix and remainder.startswith("/"):
            remainder = remainder[1:]
        if not remainder:
            # exact match, treat as file under itself
            entries.add(p)
            continue
        slash = remainder.find("/")
        if slash == -1:
            entries.add(p)
        else:
            child = remainder[:slash]
            entries.add(f"{prefix}/{child}" if prefix else child)
    return {"output": str(sorted(entries)), "call_id": call_id, "id": id}


@web.post("/cat")
async def cat_endpoint(request: Request, _: bool = Depends(verify_bearer)):
    arguments, call_id, id = await extract_arguments(request)
    path = str((arguments or {}).get("path", "")).strip()
    if not path:
        return {"output": "Error: path is required", "call_id": call_id, "id": id}
    if corpus is None:
        raise HTTPException(status_code=500, detail="corpus not loaded")
    try:
        row = corpus.loc[path]
    except Exception:
        return {"output": "Error: not a valid document", "call_id": call_id, "id": id}
    return {
        "output": str({k: row[k] for k in ("path", "content", "pre_text", "post_text")}),
        "call_id": call_id,
        "id": id,
    }


@web.post("/search")
async def search_endpoint(request: Request, _: bool = Depends(verify_bearer)):
    # Environment error should be HTTPException
    if corpus is None:
        raise HTTPException(status_code=500, detail="corpus not loaded")
    arguments, call_id, id = await extract_arguments(request)
    query = str((arguments or {}).get("query", "")).strip()
    if not query:
        return {"output": "Error: query is required", "call_id": call_id, "id": id}

    q = get_embedding(query, model=EMBEDDING_MODEL)
    sims = corpus["embedding"].apply(lambda v: cosine_similarity(v, q))
    best_pos = int(np.argmax(sims.to_numpy()))
    row = corpus.iloc[best_pos]
    return {
        "output": str({k: row[k] for k in ("path", "content", "pre_text", "post_text")}),
        "call_id": call_id,
        "id": id,
    }


# expose the whole FastAPI app on Modal
@app.function(image=base_image, secrets=[modal.Secret.from_name(APP_NAME)])
@modal.asgi_app()
def fastapi_app():
    global corpus, client
    corpus = load_df(CORPUS_PATH)
    client = OpenAI(max_retries=5)
    return web
