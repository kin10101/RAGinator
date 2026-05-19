from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List
from urllib.parse import urlparse


class GitHubSyncError(Exception):
    pass


_EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "venv",
    ".venv",
    "__pycache__",
}

_MAX_FILE_BYTES = 5 * 1024 * 1024
_ALLOWED_BINARY_EXTENSIONS = {".pdf", ".doc", ".docx"}


def _normalize_repo_url(repo_url: str) -> str:
    value = (repo_url or "").strip()
    if not value:
        raise GitHubSyncError("GitHub repository URL is required")

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise GitHubSyncError("GitHub repository URL must start with http:// or https://")
    if parsed.netloc.lower() != "github.com":
        raise GitHubSyncError("Only github.com repository URLs are supported")

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise GitHubSyncError("GitHub repository URL must include owner and repo name")

    owner = parts[0]
    repo = parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]

    if not owner or not repo:
        raise GitHubSyncError("Invalid GitHub repository URL")

    return f"https://github.com/{owner}/{repo}.git"


def _is_supported_repo_file(path: Path) -> bool:
    if not path.is_file():
        return False

    if any(part in _EXCLUDED_DIRS for part in path.parts):
        return False

    try:
        size = path.stat().st_size
    except OSError:
        return False

    if size <= 0 or size > _MAX_FILE_BYTES:
        return False

    suffix = path.suffix.lower()
    if suffix in _ALLOWED_BINARY_EXTENSIONS:
        return True

    try:
        head = path.read_bytes()[:4096]
    except OSError:
        return False

    if b"\x00" in head:
        return False

    return True


def download_github_repo(repo_url: str) -> List[Dict[str, object]]:
    clone_url = _normalize_repo_url(repo_url)

    with tempfile.TemporaryDirectory(prefix="github_sync_") as temp_dir:
        output_root = Path(temp_dir) / "repo"

        try:
            result = subprocess.run(
                ["git", "clone", "--depth", "1", clone_url, str(output_root)],
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
        except FileNotFoundError as exc:
            raise GitHubSyncError("git is required for GitHub sync but was not found on PATH") from exc
        except subprocess.TimeoutExpired as exc:
            raise GitHubSyncError("GitHub repository download timed out") from exc

        if result.returncode != 0:
            details = (result.stderr or result.stdout or "").strip()
            raise GitHubSyncError(details or "Failed to clone GitHub repository")

        artifacts: List[Dict[str, object]] = []
        for path in sorted(output_root.rglob("*")):
            if not _is_supported_repo_file(path):
                continue
            relative_path = path.relative_to(output_root).as_posix()
            artifacts.append(
                {
                    "relative_path": relative_path,
                    "filename": path.name,
                    "content": path.read_bytes(),
                }
            )

        if not artifacts:
            raise GitHubSyncError("No supported files were found in the GitHub repository")

        return artifacts
