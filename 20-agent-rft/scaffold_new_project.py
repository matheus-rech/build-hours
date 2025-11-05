"""
Scaffold a new project folder using the redacted template under template_project.

Creates the following structure in the target project directory:

- data/
- tool_evals/
- utils_tools/
  - graders.py
  - openai_client.py
  - text_format.py
  - tools.py

Notes:
- The target project directory must NOT already exist under the repo root.
- File contents are copied from template_project:
  - URLs -> "your_url_here"
  - Authorization keys -> "your_key_here"
  - OpenAI project id -> "your_project_id_here"
- All original comments are preserved (notably in text_format.py).
"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
import sys
from typing import Dict


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scaffold a new project directory from a redacted template.")
    # Positional (optional) or flag usage
    parser.add_argument("project", nargs="?", help="Project name (must not already exist under the repo root)")
    # Flags (short and long)
    parser.add_argument("-p", "--project", dest="project_opt", help="Project name (must not already exist under the repo root)")
    return parser.parse_args()


def get_repo_root(start: Path) -> Path:
    # Script lives at repo root; use its directory as the repo root
    return start.resolve().parent


def ensure_directories(project_dir: Path) -> None:
    subdirs = ["data", "tool_evals", "utils_tools"]
    for subdir in subdirs:
        (project_dir / subdir).mkdir(parents=True, exist_ok=True)


def read_source_files(source_dir: Path) -> Dict[str, str]:
    files = ["graders.py", "openai_client.py", "text_format.py", "tools.py"]
    contents: Dict[str, str] = {}
    for filename in files:
        src = source_dir / filename
        if not src.exists():
            raise FileNotFoundError(f"Missing source file: {src}")
        contents[filename] = src.read_text(encoding="utf-8")
    return contents


def sanitize_content(filename: str, content: str) -> str:
    # Replace explicit URLs in fields like "url" and "server_url" only
    content = re.sub(r'("url"\s*:\s*")https?://[^\"]+(\")', r'\1your_url_here\2', content)
    content = re.sub(r'("server_url"\s*:\s*")https?://[^\"]+(\")', r'\1your_url_here\2', content)

    # Replace Authorization: Bearer <token>
    content = re.sub(r'("Authorization"\s*:\s*"Bearer\s+)[^\"]+(\")', r'\1your_key_here\2', content)

    # Replace OpenAI project id assignment
    content = re.sub(r'(OPENAI_PROJECT_ID\s*=\s*\")[^\"]+(\")', r'\1your_project_id_here\2', content)

    # Ensure trailing newline
    if not content.endswith("\n"):
        content += "\n"
    return content


def write_files(project_dir: Path, contents: Dict[str, str]) -> None:
    utils_dir = project_dir / "utils_tools"
    utils_dir.mkdir(parents=True, exist_ok=True)

    for filename, raw in contents.items():
        sanitized = sanitize_content(filename, raw)
        dst = utils_dir / filename
        if dst.exists():
            print(f"[error] File already exists and overwrite is disabled: {dst}")
            sys.exit(1)
        dst.write_text(sanitized, encoding="utf-8")
        print(f"[write] {dst}")


def main() -> None:
    args = parse_args()
    repo_root = get_repo_root(Path(__file__))

    # Resolve inputs: flags take precedence over positional
    project = args.project_opt or args.project

    if not project:
        print("[error] Missing inputs. Usage: python scaffold_new_project.py PROJECT or --project PROJECT")
        sys.exit(2)

    project_dir = repo_root / project

    # Disallow project directory existence
    if project_dir.exists():
        print(f"[error] Target project directory already exists: {project_dir}")
        sys.exit(1)

    # Create the empty project directory and required subdirectories
    project_dir.mkdir(parents=True, exist_ok=False)
    ensure_directories(project_dir)

    source_dir = repo_root / "template_project" / "utils_tools"
    sources = read_source_files(source_dir)

    write_files(project_dir, sources)
    print(f"Done. Created project at: {project_dir}")


if __name__ == "__main__":
    main()


