import json
import pathlib
from typing import Dict, Any
import hashlib

# Base cache location under repo-root/data
_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
_DEFAULT_CACHE_DIR = _REPO_ROOT / "data"

# Default cache path (global cache if no project provided)
_CACHE_PATH = _DEFAULT_CACHE_DIR / "file_cache.json"

def count_jsonl_lines(file_path):
    """Count the number of lines (samples) in a jsonl file."""
    with open(file_path, "r") as f:
        num_lines = sum(1 for _ in f)
    return num_lines

def sample_jsonl_file(input_path, output_path, n=10, seed: int | None = None):
    """Sample n lines from a jsonl file and write to output_path.

    Uses a deterministic random selection if a seed is provided; preserves
    the original order of sampled lines for readability.
    """
    import random

    with open(input_path, "r") as fin:
        lines = fin.readlines()

    total = len(lines)
    n = min(n, total)

    if seed is None or n == total:
        # Deterministic without randomness: head selection or full copy
        sampled_lines = lines[:n]
    else:
        rng = random.Random(seed)
        indices = rng.sample(range(total), n)
        indices.sort()  # keep original file order in the output
        sampled_lines = [lines[i] for i in indices]

    with open(output_path, "w") as fout:
        fout.writelines(sampled_lines)
    print(f"Sampled {len(sampled_lines)} lines from {input_path} to {output_path}")
    print(f"Original file {input_path} had {total} samples.")

def _load_cache(cache_path: pathlib.Path | None = None) -> Dict[str, Any]:
    """Return cache mapping from absolute path -> {"hash": str, "file_id": str}

    If cache_path is provided, use it; otherwise fall back to global _CACHE_PATH.
    """

    path = cache_path or _CACHE_PATH
    if path.exists():
        try:
            data = json.loads(path.read_text())
            # Backwards-compat: old format was {path: file_id}
            if data and isinstance(next(iter(data.values())), str):
                data = {k: {"hash": None, "file_id": v} for k, v in data.items()}
            return data
        except json.JSONDecodeError:
            # Corrupt cache → start fresh
            return {}
    return {}


def _save_cache(cache: Dict[str, Any], cache_path: pathlib.Path | None = None) -> None:
    path = cache_path or _CACHE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=2))


def _cache_path_for(customer: str | None, project: str | None) -> pathlib.Path:
    """Return cache path under <project>/data/ when provided.

    Falls back to global repo-level data/ if not provided.
    """
    if project:
        base = _REPO_ROOT / "build_hour" / project / "data"
    else:
        base = _DEFAULT_CACHE_DIR
    return base / "file_cache.json"


def get_or_upload_file(
    client,
    path: pathlib.Path,
    *,
    purpose: str = "evals",
    customer: str | None = None,
    project: str | None = None,
    debug: bool = False,
    debug_n: int = 15,
    debug_seed: int = 42,
) -> str:
    """Return OpenAI file_id for *path*; upload if not cached.

    Caches are stored under <project>/data/file_cache.json when project is provided,
    otherwise under data/file_cache.json.
    """

    # If debug sampling requested for JSONL, create a deterministic sampled file
    upload_path = path
    if debug and str(path).endswith(".jsonl"):
        sampled_path = path.with_name(path.stem + f"_debug{debug_n}.jsonl")
        sample_jsonl_file(str(path), str(sampled_path), n=debug_n, seed=debug_seed)
        upload_path = sampled_path

    cache_path = _cache_path_for("build_hour", project)
    cache = _load_cache(cache_path)
    fname = str(upload_path.resolve())

    # Compute SHA-256 of current file
    hasher = hashlib.sha256()
    with upload_path.open("rb") as f_bin:
        while True:
            chunk = f_bin.read(8192)
            if not chunk:
                break
            hasher.update(chunk)
    current_hash = hasher.hexdigest()

    entry = cache.get(fname)

    if entry and entry.get("hash") == current_hash and entry.get("file_id"):
        file_id = entry["file_id"]
        print(f"[dataset] Reusing cached file_id {file_id} for {upload_path.name}")
        return file_id

    # Need to upload (new file or content changed)
    if entry:
        print(f"[dataset] Content changed – uploading new version of {upload_path.name} …")
    else:
        print(f"[dataset] Uploading {upload_path.name} → OpenAI Files API …")

    file_obj = client.files.create(file=upload_path, purpose=purpose)
    file_id = file_obj.id
    cache[fname] = {"hash": current_hash, "file_id": file_id}
    _save_cache(cache, cache_path)
    return file_id