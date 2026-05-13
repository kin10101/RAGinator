from __future__ import annotations

import math
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import chromadb
from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

# MiniLM-L6-v2 running locally via onnxruntime — no PyTorch required.
COLLECTION_NAME = "rag_documents_v5"  # v5: cosine distance metric
MIN_RELEVANCE_SCORE = 0.20  # Drop chunks below this similarity threshold (0-1)

_embedding_fn: ONNXMiniLM_L6_V2 | None = None
_cross_encoder = None


def _get_embedding_fn() -> ONNXMiniLM_L6_V2:
    global _embedding_fn
    if _embedding_fn is None:
        _embedding_fn = ONNXMiniLM_L6_V2()
    return _embedding_fn


def build_embedding(text: str) -> List[float]:
    return [float(x) for x in _get_embedding_fn()([text])[0]]


def build_embeddings(texts: List[str]) -> List[List[float]]:
    return [[float(x) for x in row] for row in _get_embedding_fn()(texts)]


def _tokenize(text: str) -> List[str]:
    return [token for token in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(token) > 1]


def _safe_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _safe_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def _score_to_distance(score: float) -> float:
    return max(0.0, 1.0 - score)


def _get_cross_encoder():
    global _cross_encoder
    use_cross_encoder = os.getenv("RAG_USE_CROSS_ENCODER", "0").strip().lower() in {"1", "true", "yes", "on"}
    if not use_cross_encoder:
        return None

    if _cross_encoder is not None:
        return _cross_encoder

    try:
        from sentence_transformers import CrossEncoder  # type: ignore

        _cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        return _cross_encoder
    except Exception:
        return None


def get_collection(persist_dir: Path):
    client = chromadb.PersistentClient(path=str(persist_dir))
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def upsert_file_chunks(collection, filename: str, chunks: List[str], chunk_method: str = "fixed") -> int:
    non_empty = [c for c in chunks if c and c.strip()]
    if not non_empty:
        return 0

    ids = [f"{filename}:{index}" for index in range(len(non_empty))]
    metadatas = [
        {
            "filename": filename,
            "filename_lower": filename.lower(),
            "chunk_index": index,
            "chunk_method": chunk_method,
            "chunk_length": len(non_empty[index]),
        }
        for index in range(len(non_empty))
    ]
    embeddings = build_embeddings(non_empty)

    collection.upsert(ids=ids, documents=non_empty, metadatas=metadatas, embeddings=embeddings)
    return len(non_empty)


def delete_file_chunks(collection, filename: str) -> None:
    collection.delete(where={"filename": filename})


def get_file_chunk_count(collection, filename: str) -> int:
    result = collection.get(where={"filename": filename}, include=["metadatas"])
    return len(result.get("metadatas", []))


def _build_where(
    filename: Optional[str] = None,
    filenames: Optional[List[str]] = None,
    chunk_method: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    clauses: List[Dict[str, Any]] = []

    if filename:
        clauses.append({"filename": filename})

    valid_filenames = [name for name in (filenames or []) if isinstance(name, str) and name.strip()]
    if valid_filenames:
        clauses.append({"filename": {"$in": valid_filenames}})

    normalized_method = (chunk_method or "").strip().lower()
    if normalized_method:
        clauses.append({"chunk_method": normalized_method})

    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


def _dense_candidates(
    collection,
    query: str,
    where: Optional[Dict[str, Any]],
    candidate_k: int,
) -> List[Dict[str, Any]]:
    results = collection.query(
        query_embeddings=[build_embedding(query)],
        n_results=max(1, candidate_k),
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    ids = (results.get("ids") or [[]])[0]
    docs = (results.get("documents") or [[]])[0]
    metadatas = (results.get("metadatas") or [[]])[0]
    distances = (results.get("distances") or [[]])[0]

    candidates: List[Dict[str, Any]] = []
    for idx, chunk_id in enumerate(ids):
        metadata = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
        raw_dist = _safe_float(distances[idx] if idx < len(distances) else 1.0, 1.0)
        dense_score = max(0.0, 1.0 - raw_dist)
        candidates.append(
            {
                "id": chunk_id,
                "filename": metadata.get("filename", ""),
                "chunk_index": metadata.get("chunk_index", idx),
                "chunk_method": metadata.get("chunk_method", "fixed"),
                "chunk_length": metadata.get("chunk_length"),
                "document": docs[idx] if idx < len(docs) else "",
                "dense_distance": raw_dist,
                "dense_score": round(dense_score, 6),
            }
        )

    return candidates


def _lexical_bm25_candidates(
    collection,
    query: str,
    where: Optional[Dict[str, Any]],
    candidate_k: int,
    max_scan: int,
) -> Dict[str, Any]:
    count_payload = collection.get(where=where, include=[])
    total_available = len(count_payload.get("ids", []))
    scan_limit = min(total_available, max(1, max_scan))

    payload = collection.get(
        where=where,
        include=["documents", "metadatas"],
        limit=scan_limit,
        offset=0,
    )

    ids = payload.get("ids", [])
    docs = payload.get("documents", [])
    metadatas = payload.get("metadatas", [])

    query_tokens = _tokenize(query)
    if not query_tokens:
        return {"items": [], "pool_size": len(ids), "total_available": total_available}

    tokenized_docs: List[List[str]] = []
    doc_lengths: List[int] = []
    doc_freq: Dict[str, int] = {}

    for doc in docs:
        tokens = _tokenize(doc)
        tokenized_docs.append(tokens)
        doc_lengths.append(len(tokens))
        for token in set(tokens):
            doc_freq[token] = doc_freq.get(token, 0) + 1

    n_docs = len(tokenized_docs)
    avgdl = sum(doc_lengths) / n_docs if n_docs else 0.0
    k1 = 1.5
    b = 0.75

    scored: List[Dict[str, Any]] = []
    for idx, chunk_id in enumerate(ids):
        tokens = tokenized_docs[idx] if idx < len(tokenized_docs) else []
        if not tokens:
            continue

        tf: Dict[str, int] = {}
        for token in tokens:
            tf[token] = tf.get(token, 0) + 1

        score = 0.0
        doc_len = doc_lengths[idx] if idx < len(doc_lengths) else len(tokens)
        for token in query_tokens:
            freq = tf.get(token, 0)
            if freq <= 0:
                continue
            df = doc_freq.get(token, 0)
            idf = math.log(1.0 + (n_docs - df + 0.5) / (df + 0.5)) if n_docs else 0.0
            denom = freq + k1 * (1.0 - b + b * (doc_len / avgdl if avgdl > 0 else 1.0))
            score += idf * ((freq * (k1 + 1.0)) / denom)

        if score <= 0:
            continue

        metadata = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
        scored.append(
            {
                "id": chunk_id,
                "filename": metadata.get("filename", ""),
                "chunk_index": metadata.get("chunk_index", idx),
                "chunk_method": metadata.get("chunk_method", "fixed"),
                "chunk_length": metadata.get("chunk_length"),
                "document": docs[idx] if idx < len(docs) else "",
                "lexical_score": round(score, 6),
            }
        )

    scored.sort(key=lambda item: item["lexical_score"], reverse=True)
    return {
        "items": scored[: max(1, candidate_k)],
        "pool_size": len(ids),
        "total_available": total_available,
    }


def _fuse_ranks(
    dense_candidates: List[Dict[str, Any]],
    lexical_candidates: List[Dict[str, Any]],
    fused_k: int,
) -> List[Dict[str, Any]]:
    rrf_k = 60.0
    by_id: Dict[str, Dict[str, Any]] = {}

    for rank, item in enumerate(dense_candidates, start=1):
        chunk_id = item.get("id")
        if not chunk_id:
            continue
        merged = dict(item)
        merged["fusion_score"] = 1.0 / (rrf_k + rank)
        merged["dense_rank"] = rank
        merged["lexical_rank"] = None
        if "lexical_score" not in merged:
            merged["lexical_score"] = 0.0
        by_id[chunk_id] = merged

    for rank, item in enumerate(lexical_candidates, start=1):
        chunk_id = item.get("id")
        if not chunk_id:
            continue
        if chunk_id not in by_id:
            merged = dict(item)
            merged.setdefault("dense_score", 0.0)
            merged.setdefault("dense_distance", None)
            merged["fusion_score"] = 0.0
            merged["dense_rank"] = None
            merged["lexical_rank"] = rank
            by_id[chunk_id] = merged
        else:
            by_id[chunk_id]["lexical_score"] = item.get("lexical_score", 0.0)
            by_id[chunk_id]["lexical_rank"] = rank

        by_id[chunk_id]["fusion_score"] += 1.0 / (rrf_k + rank)

    fused = list(by_id.values())
    fused.sort(key=lambda item: _safe_float(item.get("fusion_score"), 0.0), reverse=True)
    return fused[: max(1, fused_k)]


def _rerank_candidates(
    query: str,
    candidates: List[Dict[str, Any]],
    rerank_enabled: bool,
) -> Dict[str, Any]:
    if not candidates:
        return {
            "items": [],
            "backend": "none",
            "enabled": rerank_enabled,
        }

    if not rerank_enabled:
        ranked = []
        for item in candidates:
            next_item = dict(item)
            next_item["rerank_score"] = _safe_float(next_item.get("fusion_score"), 0.0)
            next_item["score"] = round(_safe_float(next_item.get("rerank_score"), 0.0), 4)
            next_item["distance"] = _score_to_distance(_safe_float(next_item.get("score"), 0.0))
            ranked.append(next_item)
        ranked.sort(key=lambda item: _safe_float(item.get("rerank_score"), 0.0), reverse=True)
        return {"items": ranked, "backend": "fusion-only", "enabled": rerank_enabled}

    cross_encoder = _get_cross_encoder()
    if cross_encoder is not None:
        pairs = [[query, item.get("document", "")] for item in candidates]
        try:
            raw_scores = cross_encoder.predict(pairs)
            ranked = []
            for index, item in enumerate(candidates):
                normalized = _sigmoid(_safe_float(raw_scores[index], 0.0))
                next_item = dict(item)
                next_item["rerank_score"] = round(normalized, 6)
                next_item["score"] = round(normalized, 4)
                next_item["distance"] = _score_to_distance(normalized)
                ranked.append(next_item)
            ranked.sort(key=lambda row: _safe_float(row.get("rerank_score"), 0.0), reverse=True)
            return {"items": ranked, "backend": "cross-encoder", "enabled": rerank_enabled}
        except Exception:
            pass

    query_tokens = set(_tokenize(query))
    ranked = []
    for item in candidates:
        doc_tokens = set(_tokenize(item.get("document", "")))
        intersection = len(query_tokens & doc_tokens)
        union = len(query_tokens | doc_tokens)
        overlap_score = (intersection / union) if union > 0 else 0.0
        fusion_score = _safe_float(item.get("fusion_score"), 0.0)
        fusion_norm = max(0.0, min(1.0, fusion_score * 40.0))
        normalized = max(0.0, min(1.0, 0.45 * overlap_score + 0.55 * fusion_norm))
        next_item = dict(item)
        next_item["rerank_score"] = round(normalized, 6)
        next_item["score"] = round(normalized, 4)
        next_item["distance"] = _score_to_distance(normalized)
        ranked.append(next_item)
    ranked.sort(key=lambda row: _safe_float(row.get("rerank_score"), 0.0), reverse=True)
    return {"items": ranked, "backend": "token-overlap", "enabled": rerank_enabled}


def search_chunks(
    collection,
    query: str,
    top_k: int = 5,
    filename: Optional[str] = None,
    filenames: Optional[List[str]] = None,
    min_relevance_score: float = MIN_RELEVANCE_SCORE,
    retrieval_mode: str = "hybrid",
    rerank_enabled: bool = True,
    dense_candidate_k: Optional[int] = None,
    lexical_candidate_k: Optional[int] = None,
    rerank_candidate_k: Optional[int] = None,
    lexical_max_scan: int = 5000,
) -> List[Dict[str, Any]]:
    payload = search_chunks_with_diagnostics(
        collection=collection,
        query=query,
        top_k=top_k,
        filename=filename,
        filenames=filenames,
        min_relevance_score=min_relevance_score,
        retrieval_mode=retrieval_mode,
        rerank_enabled=rerank_enabled,
        dense_candidate_k=dense_candidate_k,
        lexical_candidate_k=lexical_candidate_k,
        rerank_candidate_k=rerank_candidate_k,
        lexical_max_scan=lexical_max_scan,
    )
    return payload["matches"]


def search_chunks_with_diagnostics(
    collection,
    query: str,
    top_k: int = 5,
    filename: Optional[str] = None,
    filenames: Optional[List[str]] = None,
    min_relevance_score: float = MIN_RELEVANCE_SCORE,
    retrieval_mode: str = "hybrid",
    rerank_enabled: bool = True,
    dense_candidate_k: Optional[int] = None,
    lexical_candidate_k: Optional[int] = None,
    rerank_candidate_k: Optional[int] = None,
    lexical_max_scan: int = 5000,
) -> Dict[str, Any]:
    where = _build_where(filename=filename, filenames=filenames)

    mode = (retrieval_mode or "hybrid").strip().lower()
    if mode not in {"dense", "hybrid"}:
        mode = "hybrid"

    effective_dense_k = max(1, _safe_int(dense_candidate_k, max(top_k * 3, top_k + 12)))
    effective_lexical_k = max(1, _safe_int(lexical_candidate_k, max(top_k * 3, top_k + 12)))
    effective_rerank_k = max(1, _safe_int(rerank_candidate_k, max(top_k * 2, top_k + 8)))

    dense_items = _dense_candidates(
        collection=collection,
        query=query,
        where=where,
        candidate_k=effective_dense_k,
    )

    lexical_payload = {"items": [], "pool_size": 0, "total_available": 0}
    lexical_items: List[Dict[str, Any]] = []
    if mode == "hybrid":
        lexical_payload = _lexical_bm25_candidates(
            collection=collection,
            query=query,
            where=where,
            candidate_k=effective_lexical_k,
            max_scan=max(1, lexical_max_scan),
        )
        lexical_items = lexical_payload["items"]

    if mode == "dense":
        fused_items = dense_items[: max(1, effective_rerank_k)]
        for rank, item in enumerate(fused_items, start=1):
            item["dense_rank"] = rank
            item["lexical_rank"] = None
            item["fusion_score"] = item.get("dense_score", 0.0)
            item.setdefault("lexical_score", 0.0)
    else:
        fused_items = _fuse_ranks(
            dense_candidates=dense_items,
            lexical_candidates=lexical_items,
            fused_k=effective_rerank_k,
        )

    rerank_payload = _rerank_candidates(
        query=query,
        candidates=fused_items,
        rerank_enabled=rerank_enabled,
    )
    reranked_items = rerank_payload["items"]

    thresholded: List[Dict[str, Any]] = []
    dropped_below_score = 0
    for item in reranked_items:
        score = _safe_float(item.get("score"), 0.0)
        if score < min_relevance_score:
            dropped_below_score += 1
            continue
        thresholded.append(item)

    selected_raw = thresholded[: max(1, top_k)]
    selected: List[Dict[str, Any]] = []
    for index, item in enumerate(selected_raw):
        selected.append(
            {
                "id": item.get("id"),
                "filename": item.get("filename", ""),
                "chunk_index": item.get("chunk_index", index),
                "chunk_method": item.get("chunk_method", "fixed"),
                "chunk_length": item.get("chunk_length"),
                "document": item.get("document", ""),
                "distance": item.get("distance"),
                "score": round(_safe_float(item.get("score"), 0.0), 4),
                "dense_score": round(_safe_float(item.get("dense_score"), 0.0), 4),
                "lexical_score": round(_safe_float(item.get("lexical_score"), 0.0), 4),
                "fusion_score": round(_safe_float(item.get("fusion_score"), 0.0), 6),
                "rerank_score": round(_safe_float(item.get("rerank_score"), 0.0), 4),
            }
        )

    diagnostics = {
        "query": query,
        "retrieval_mode": mode,
        "rerank_enabled": rerank_enabled,
        "top_k": top_k,
        "dense_candidate_k": effective_dense_k,
        "lexical_candidate_k": effective_lexical_k,
        "rerank_candidate_k": effective_rerank_k,
        "min_relevance_score": min_relevance_score,
        "candidate_count": len(reranked_items),
        "dropped_below_score": dropped_below_score,
        "kept_count": len(thresholded),
        "returned_count": len(selected),
        "filters": {
            "filename": filename,
            "filenames": filenames or [],
        },
        "rerank_backend": rerank_payload.get("backend"),
        "stages": {
            "dense": {
                "requested_k": effective_dense_k,
                "returned": len(dense_items),
            },
            "lexical": {
                "enabled": mode == "hybrid",
                "requested_k": effective_lexical_k if mode == "hybrid" else 0,
                "returned": len(lexical_items),
                "pool_size": lexical_payload.get("pool_size", 0),
                "total_available": lexical_payload.get("total_available", 0),
            },
            "fusion": {
                "input_dense": len(dense_items),
                "input_lexical": len(lexical_items),
                "output": len(fused_items),
            },
            "rerank": {
                "enabled": rerank_enabled,
                "backend": rerank_payload.get("backend"),
                "input": len(fused_items),
                "output": len(reranked_items),
            },
            "threshold": {
                "min_relevance_score": min_relevance_score,
                "before": len(reranked_items),
                "after": len(thresholded),
                "dropped": dropped_below_score,
            },
        },
        "selected_ids": [item["id"] for item in selected],
    }
    return {"matches": selected, "diagnostics": diagnostics}


def list_chunks(
    collection,
    filename: Optional[str] = None,
    filenames: Optional[List[str]] = None,
    chunk_method: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> Dict[str, Any]:
    where = _build_where(filename=filename, filenames=filenames, chunk_method=chunk_method)
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
                "chunk_length": metadata.get("chunk_length"),
                "document": docs[idx] if idx < len(docs) else "",
            }
        )

    items.sort(key=lambda chunk: (chunk["filename"], int(chunk["chunk_index"])))

    if where is None:
        total_count = collection.count()
    else:
        count_payload = collection.get(where=where, include=[])
        total_count = len(count_payload.get("ids", []))

    return {"items": items, "count": total_count}
