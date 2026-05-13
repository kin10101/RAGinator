from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Dict, List


class GoogleDriveSyncError(Exception):
    pass


def _is_supported_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.name.startswith("."):
        return False
    return True


def download_public_folder(folder_url: str) -> List[Dict[str, object]]:
    """
    Download a public Google Drive folder and return file artifacts.

    Returns a list of dicts with keys:
    - relative_path: path relative to downloaded root
    - filename: basename
    - content: raw bytes
    """
    if not folder_url or not folder_url.strip():
        raise GoogleDriveSyncError("Google Drive folder URL is required")

    try:
        import gdown
    except ModuleNotFoundError as exc:
        raise GoogleDriveSyncError(
            "Google Drive sync dependency is missing. Install with: pip install gdown"
        ) from exc

    with tempfile.TemporaryDirectory(prefix="gdrive_sync_") as temp_dir:
        output_root = Path(temp_dir)
        try:
            downloaded = gdown.download_folder(
                url=folder_url.strip(),
                output=str(output_root),
                quiet=True,
                use_cookies=False,
            )
        except Exception as exc:  # noqa: BLE001
            message = str(exc).strip() or "Failed to download files from Google Drive"
            raise GoogleDriveSyncError(message) from exc

        if not downloaded:
            raise GoogleDriveSyncError(
                "No files found. Ensure the folder URL is public and contains downloadable files."
            )

        artifacts: List[Dict[str, object]] = []
        for path in sorted(output_root.rglob("*")):
            if not _is_supported_file(path):
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
            raise GoogleDriveSyncError("No downloadable files were found in the folder")

        return artifacts
