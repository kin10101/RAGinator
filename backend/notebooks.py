from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


DEFAULT_NOTEBOOK_COLOR = "#4f7cff"
DEFAULT_NOTEBOOK_VISIBILITY = "private"
_ALLOWED_VISIBILITY = {"public", "private"}
DEFAULT_NOTEBOOK_SOURCE_TYPE = "manual"
_ALLOWED_SOURCE_TYPES = {"manual", "google_drive", "github_repo"}


class NotebookManager:
    def __init__(self, storage_path: Path):
        self.storage_path = storage_path
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.storage_path.exists():
            self._write({"notebooks": []})

    def _read(self) -> Dict[str, Any]:
        try:
            payload = json.loads(self.storage_path.read_text(encoding="utf-8"))
            notebooks = payload.get("notebooks", [])
            if not isinstance(notebooks, list):
                notebooks = []
            return {"notebooks": notebooks}
        except (json.JSONDecodeError, FileNotFoundError):
            return {"notebooks": []}

    def _write(self, payload: Dict[str, Any]) -> None:
        notebooks = payload.get("notebooks", [])
        if not isinstance(notebooks, list):
            notebooks = []
        self.storage_path.write_text(json.dumps({"notebooks": notebooks}, indent=2), encoding="utf-8")

    def _normalize_visibility(self, visibility: Optional[str]) -> str:
        value = (visibility or DEFAULT_NOTEBOOK_VISIBILITY).strip().lower()
        if value not in _ALLOWED_VISIBILITY:
            raise ValueError("visibility must be 'public' or 'private'")
        return value

    def _normalize_source_type(self, source_type: Optional[str]) -> str:
        value = (source_type or DEFAULT_NOTEBOOK_SOURCE_TYPE).strip().lower()
        if value not in _ALLOWED_SOURCE_TYPES:
            raise ValueError("source_type must be one of: manual, google_drive, github_repo")
        return value

    def _normalize_notebook(self, notebook: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(notebook)
        normalized["filenames"] = [str(name) for name in normalized.get("filenames", []) if isinstance(name, str)]
        normalized["source_type"] = self._normalize_source_type(normalized.get("source_type"))
        normalized["source_url"] = str(normalized.get("source_url") or "").strip()
        normalized["sync_status"] = str(normalized.get("sync_status") or "idle")
        normalized["synced_at"] = normalized.get("synced_at")
        normalized["last_sync_error"] = str(normalized.get("last_sync_error") or "")
        raw_stats = normalized.get("last_sync_stats")
        normalized["last_sync_stats"] = raw_stats if isinstance(raw_stats, dict) else {}
        normalized["connector_filenames"] = [
            str(name) for name in normalized.get("connector_filenames", []) if isinstance(name, str)
        ]
        return normalized

    def _normalize_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        notebooks = payload.get("notebooks", [])
        if not isinstance(notebooks, list):
            notebooks = []
        return {"notebooks": [self._normalize_notebook(notebook) for notebook in notebooks if isinstance(notebook, dict)]}

    def list_notebooks(self) -> List[Dict[str, Any]]:
        payload = self._normalize_payload(self._read())
        notebooks = payload.get("notebooks", [])
        return sorted(notebooks, key=lambda item: (item.get("name", "").lower(), item.get("created_at", "")))

    def get_notebook(self, notebook_id: str) -> Optional[Dict[str, Any]]:
        for notebook in self._normalize_payload(self._read()).get("notebooks", []):
            if notebook.get("id") == notebook_id:
                return notebook
        return None

    def create_notebook(
        self,
        name: str,
        description: str = "",
        color: str = DEFAULT_NOTEBOOK_COLOR,
        visibility: str = DEFAULT_NOTEBOOK_VISIBILITY,
        owner_id: Optional[str] = None,
        source_type: str = DEFAULT_NOTEBOOK_SOURCE_TYPE,
        source_url: str = "",
    ) -> Dict[str, Any]:
        trimmed_name = (name or "").strip()
        if not trimmed_name:
            raise ValueError("name is required")

        payload = self._normalize_payload(self._read())
        notebooks = payload.get("notebooks", [])
        if any((item.get("name", "").strip().lower() == trimmed_name.lower()) for item in notebooks):
            raise ValueError("notebook name already exists")

        created = {
            "id": uuid.uuid4().hex,
            "name": trimmed_name,
            "description": (description or "").strip(),
            "color": (color or DEFAULT_NOTEBOOK_COLOR).strip() or DEFAULT_NOTEBOOK_COLOR,
            "filenames": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "visibility": self._normalize_visibility(visibility),
            "owner_id": owner_id,
            "source_type": self._normalize_source_type(source_type),
            "source_url": (source_url or "").strip(),
            "sync_status": "idle",
            "synced_at": None,
            "last_sync_error": "",
            "last_sync_stats": {},
            "connector_filenames": [],
        }
        notebooks.append(created)
        payload["notebooks"] = notebooks
        self._write(payload)
        return created

    def update_notebook(
        self,
        notebook_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        color: Optional[str] = None,
        visibility: Optional[str] = None,
        owner_id: Optional[str] = None,
        source_type: Optional[str] = None,
        source_url: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        payload = self._normalize_payload(self._read())
        notebooks = payload.get("notebooks", [])

        target_notebook: Optional[Dict[str, Any]] = None
        for notebook in notebooks:
            if notebook.get("id") == notebook_id:
                target_notebook = notebook
                break

        if target_notebook is None:
            return None

        if name is not None:
            trimmed_name = name.strip()
            if not trimmed_name:
                raise ValueError("name must not be empty")
            if any(
                item.get("id") != notebook_id and item.get("name", "").strip().lower() == trimmed_name.lower()
                for item in notebooks
            ):
                raise ValueError("notebook name already exists")
            target_notebook["name"] = trimmed_name

        if description is not None:
            target_notebook["description"] = description.strip()

        if color is not None:
            target_notebook["color"] = color.strip() or DEFAULT_NOTEBOOK_COLOR

        if visibility is not None:
            target_notebook["visibility"] = self._normalize_visibility(visibility)

        if owner_id is not None:
            target_notebook["owner_id"] = owner_id

        if source_type is not None:
            target_notebook["source_type"] = self._normalize_source_type(source_type)

        if source_url is not None:
            target_notebook["source_url"] = source_url.strip()

        self._write(payload)
        return target_notebook

    def update_sync_state(
        self,
        notebook_id: str,
        *,
        sync_status: Optional[str] = None,
        synced_at: Optional[str] = None,
        last_sync_error: Optional[str] = None,
        last_sync_stats: Optional[Dict[str, Any]] = None,
        connector_filenames: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        payload = self._normalize_payload(self._read())
        notebooks = payload.get("notebooks", [])

        target_notebook: Optional[Dict[str, Any]] = None
        for notebook in notebooks:
            if notebook.get("id") == notebook_id:
                target_notebook = notebook
                break

        if target_notebook is None:
            return None

        if sync_status is not None:
            target_notebook["sync_status"] = sync_status
        if synced_at is not None:
            target_notebook["synced_at"] = synced_at
        if last_sync_error is not None:
            target_notebook["last_sync_error"] = last_sync_error
        if last_sync_stats is not None:
            target_notebook["last_sync_stats"] = last_sync_stats
        if connector_filenames is not None:
            target_notebook["connector_filenames"] = connector_filenames

        self._write(payload)
        return target_notebook

    def delete_notebook(self, notebook_id: str) -> bool:
        payload = self._normalize_payload(self._read())
        notebooks = payload.get("notebooks", [])
        next_notebooks = [notebook for notebook in notebooks if notebook.get("id") != notebook_id]
        if len(next_notebooks) == len(notebooks):
            return False

        payload["notebooks"] = next_notebooks
        self._write(payload)
        return True

    def add_files(self, notebook_id: str, filenames: List[str]) -> Optional[Dict[str, Any]]:
        payload = self._normalize_payload(self._read())
        notebooks = payload.get("notebooks", [])

        target_notebook: Optional[Dict[str, Any]] = None
        for notebook in notebooks:
            if notebook.get("id") == notebook_id:
                target_notebook = notebook
                break

        if target_notebook is None:
            return None

        existing = set(target_notebook.get("filenames", []))
        for name in filenames:
            if name not in existing:
                target_notebook.setdefault("filenames", []).append(name)
                existing.add(name)

        self._write(payload)
        return target_notebook

    def remove_files(self, notebook_id: str, filenames: List[str]) -> Optional[Dict[str, Any]]:
        payload = self._normalize_payload(self._read())
        notebooks = payload.get("notebooks", [])

        target_notebook: Optional[Dict[str, Any]] = None
        for notebook in notebooks:
            if notebook.get("id") == notebook_id:
                target_notebook = notebook
                break

        if target_notebook is None:
            return None

        remove_set = set(filenames)
        target_notebook["filenames"] = [name for name in target_notebook.get("filenames", []) if name not in remove_set]
        self._write(payload)
        return target_notebook

    def remove_filename_everywhere(self, filename: str) -> None:
        payload = self._normalize_payload(self._read())
        changed = False
        for notebook in payload.get("notebooks", []):
            before = notebook.get("filenames", [])
            after = [name for name in before if name != filename]
            if len(after) != len(before):
                notebook["filenames"] = after
                changed = True

        if changed:
            self._write(payload)

    def rename_filename_everywhere(self, old_filename: str, new_filename: str) -> None:
        payload = self._normalize_payload(self._read())
        changed = False
        for notebook in payload.get("notebooks", []):
            files = notebook.get("filenames", [])
            if old_filename not in files:
                continue

            next_files: List[str] = []
            seen = set()
            for current in files:
                candidate = new_filename if current == old_filename else current
                if candidate in seen:
                    continue
                seen.add(candidate)
                next_files.append(candidate)

            notebook["filenames"] = next_files
            changed = True

        if changed:
            self._write(payload)
