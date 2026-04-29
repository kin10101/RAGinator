from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import chromadb
from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

# MiniLM-L6-v2 running locally via onnxruntime — no PyTorch required.
COLLECTION_NAME = "rag_documents_v4"

_embedding_fn: ONNXMiniLM_L6_V2 | None = None


def _get_embedding_fn() -> ONNXMiniLM_L6_V2:
    global _embedding_fn
    if _embedding_fn is None:
        _embedding_fn = ONNXMiniLM_L6_V2()
    return _embedding_fn


def build_embedding(text: str) -> List[float]:
    return [float(x) for x in _get_embedding_fn()([text])[0]]


def build_embeddings(texts: List[str]) -> List[List[float]]:
    return [[float(x) for x in row] for row in _get_embedding_fn()(texts)]


def get_collection(persist_dir: Path):
    client = chromadb.PersistentClient(path=str(persist_dir))
    return client.get_or_create_collection(name=COLLECTION_NAME)


def upsert_file_chunks(collection, filename: str, chunks: List[str], chunk_method: str = "fixed") -> int:
    non_empty = [c for c in chunks if c and c.strip()]
    if not non_empty:
        return 0

    ids = [f"{filename}:{index}" for index in range(len(non_empty))]
    metadatas = [{"filename": filename, "chunk_index": index, "chunk_method": chunk_method} for index in range(len(non_empty))]
    embeddings = build_embeddings(non_empty)

    collection.upsert(ids=ids, documents=non_empty, metadatas=metadatas, embeddings=embeddings)
    return len(non_empty)


def delete_file_chunks(collection, filename: str) -> None:
    collection.delete(where={"filename": filename})


def get_file_chunk_count(collection, filename: str) -> int:
    result = collection.get(where={"filename": filename}, include=["metadatas"])
    return len(result.get("metadatas", []))


def search_chunks(collection, query: str, top_k: int = 5, filename: Optional[str] = None) -> List[Dict[str, Any]]:
    where = {"filename": filename} if filename else None
    results = collection.query(
        query_embeddings=[build_embedding(query)],
        n_results=top_k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    ids = (results.get("ids") or [[]])[0]
    docs = (results.get("documents") or [[]])[0]
    metadatas = (results.get("metadatas") or [[]])[0]
    distances = (results.get("distances") or [[]])[0]

    matches: List[Dict[str, Any]] = []
    for idx, chunk_id in enumerate(ids):
        metadata = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
        matches.append(
            {
                "id": chunk_id,
                "filename": metadata.get("filename", ""),
                "chunk_index": metadata.get("chunk_index", idx),
                "document": docs[idx] if idx < len(docs) else "",
                "distance": distances[idx] if idx < len(distances) else None,
            }
        )

    return matches


def list_chunks(collection, filename: Optional[str] = None, limit: int = 200, offset: int = 0) -> Dict[str, Any]:
    where = {"filename": filename} if filename else None
    payload = collection.get(where=where, include=["documents", "metadatas"], limit=limit, offset=offset)

    ids = payload.get("ids", [])
    docs = payload.get("documents", [])
    metadatas = payload.get("metadatas", [])

    items: List[Dict[str, Any]] = []
    for idx, chunk_id in enumerate(ids):
        metadata = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
        items.append(
            {
                "id": chunk_id,
                "filename": metadata.get("filename", ""),
                "chunk_index": metadata.get("chunk_index", idx),
                "chunk_method": metadata.get("chunk_method", "fixed"),
                "document": docs[idx] if idx < len(docs) else "",
            }
        )

    items.sort(key=lambda chunk: (chunk["filename"], int(chunk["chunk_index"])))
    return {"items": items, "count": collection.count()}
