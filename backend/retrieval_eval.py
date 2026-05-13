from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from main import CHROMA_DIR
from vectordb import get_collection, search_chunks_with_diagnostics


def _reciprocal_rank(matches: List[Dict[str, Any]], expected_filenames: set[str]) -> float:
    for index, item in enumerate(matches, start=1):
        if item.get("filename") in expected_filenames:
            return 1.0 / index
    return 0.0


def _hit_at_k(matches: List[Dict[str, Any]], expected_filenames: set[str]) -> int:
    for item in matches:
        if item.get("filename") in expected_filenames:
            return 1
    return 0


def _evaluate_item(
    collection,
    item: Dict[str, Any],
    default_top_k: int,
    default_min_score: float,
    retrieval_mode: str,
    rerank_enabled: bool,
    dense_candidate_k: int,
    lexical_candidate_k: int,
    rerank_candidate_k: int,
) -> Tuple[Dict[str, Any], int, float]:
    query = str(item.get("query", "")).strip()
    if not query:
        raise ValueError("Each dataset row must include a non-empty 'query'")

    expected = item.get("expected_filenames") or []
    if not isinstance(expected, list) or not expected:
        raise ValueError("Each dataset row must include non-empty 'expected_filenames'")
    expected_set = {str(name) for name in expected}

    top_k = int(item.get("top_k", default_top_k))
    min_score = float(item.get("min_relevance_score", default_min_score))
    filename = item.get("filename")
    filenames = item.get("filenames")

    payload = search_chunks_with_diagnostics(
        collection=collection,
        query=query,
        top_k=max(1, top_k),
        filename=filename,
        filenames=filenames,
        min_relevance_score=min_score,
        retrieval_mode=retrieval_mode,
        rerank_enabled=rerank_enabled,
        dense_candidate_k=dense_candidate_k,
        lexical_candidate_k=lexical_candidate_k,
        rerank_candidate_k=rerank_candidate_k,
    )

    matches = payload["matches"]
    diagnostics = payload["diagnostics"]

    hit = _hit_at_k(matches, expected_set)
    rr = _reciprocal_rank(matches, expected_set)

    return {
        "query": query,
        "expected_filenames": sorted(expected_set),
        "hit@k": hit,
        "rr": round(rr, 4),
        "retrieval_mode": retrieval_mode,
        "rerank_enabled": rerank_enabled,
        "matches": [
            {
                "filename": m.get("filename"),
                "chunk_index": m.get("chunk_index"),
                "score": m.get("score"),
            }
            for m in matches
        ],
        "diagnostics": diagnostics,
    }, hit, rr


def _evaluate_strategy(
    collection,
    rows: List[Dict[str, Any]],
    default_top_k: int,
    default_min_score: float,
    retrieval_mode: str,
    rerank_enabled: bool,
    dense_candidate_k: int,
    lexical_candidate_k: int,
    rerank_candidate_k: int,
) -> Dict[str, Any]:
    evaluated_rows: List[Dict[str, Any]] = []
    total_hits = 0
    total_rr = 0.0

    for row in rows:
        evaluated, hit, rr = _evaluate_item(
            collection=collection,
            item=row,
            default_top_k=default_top_k,
            default_min_score=default_min_score,
            retrieval_mode=retrieval_mode,
            rerank_enabled=rerank_enabled,
            dense_candidate_k=dense_candidate_k,
            lexical_candidate_k=lexical_candidate_k,
            rerank_candidate_k=rerank_candidate_k,
        )
        evaluated_rows.append(evaluated)
        total_hits += hit
        total_rr += rr

    n = len(evaluated_rows)
    recall_at_k = total_hits / n if n else 0.0
    mrr = total_rr / n if n else 0.0
    return {
        "summary": {
            "queries": n,
            "recall_at_k": round(recall_at_k, 4),
            "mrr": round(mrr, 4),
            "top_k_default": default_top_k,
            "min_score_default": default_min_score,
            "retrieval_mode": retrieval_mode,
            "rerank_enabled": rerank_enabled,
            "dense_candidate_k": dense_candidate_k,
            "lexical_candidate_k": lexical_candidate_k,
            "rerank_candidate_k": rerank_candidate_k,
        },
        "rows": evaluated_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate retrieval quality on a gold query set")
    parser.add_argument(
        "--dataset",
        type=Path,
        required=True,
        help="Path to JSON dataset with query rows",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Default top_k when row does not specify one",
    )
    parser.add_argument(
        "--min-score",
        type=float,
        default=0.20,
        help="Default min relevance score when row does not specify one",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional output path for detailed JSON report",
    )
    parser.add_argument(
        "--dense-candidate-k",
        type=int,
        default=20,
        help="Dense retriever candidate pool size",
    )
    parser.add_argument(
        "--lexical-candidate-k",
        type=int,
        default=20,
        help="Lexical retriever candidate pool size",
    )
    parser.add_argument(
        "--rerank-candidate-k",
        type=int,
        default=16,
        help="Candidates sent to reranker before top-k/threshold",
    )
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Run side-by-side comparison: dense baseline vs hybrid + rerank",
    )
    parser.add_argument(
        "--retrieval-mode",
        choices=["dense", "hybrid"],
        default="hybrid",
        help="Single-run retrieval mode when --compare is not used",
    )
    parser.add_argument(
        "--rerank-enabled",
        action="store_true",
        help="Enable reranker for single-run mode",
    )
    args = parser.parse_args()

    rows = json.loads(args.dataset.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        raise ValueError("Dataset must be a non-empty JSON array")

    collection = get_collection(CHROMA_DIR)

    if args.compare:
        dense_report = _evaluate_strategy(
            collection=collection,
            rows=rows,
            default_top_k=args.top_k,
            default_min_score=args.min_score,
            retrieval_mode="dense",
            rerank_enabled=False,
            dense_candidate_k=max(1, args.dense_candidate_k),
            lexical_candidate_k=max(1, args.lexical_candidate_k),
            rerank_candidate_k=max(1, args.rerank_candidate_k),
        )
        hybrid_report = _evaluate_strategy(
            collection=collection,
            rows=rows,
            default_top_k=args.top_k,
            default_min_score=args.min_score,
            retrieval_mode="hybrid",
            rerank_enabled=True,
            dense_candidate_k=max(1, args.dense_candidate_k),
            lexical_candidate_k=max(1, args.lexical_candidate_k),
            rerank_candidate_k=max(1, args.rerank_candidate_k),
        )

        dense_summary = dense_report["summary"]
        hybrid_summary = hybrid_report["summary"]
        delta_recall = round(hybrid_summary["recall_at_k"] - dense_summary["recall_at_k"], 4)
        delta_mrr = round(hybrid_summary["mrr"] - dense_summary["mrr"], 4)

        print("=== Retrieval Evaluation Comparison ===")
        print(f"queries: {dense_summary['queries']}")
        print(f"dense    Recall@k={dense_summary['recall_at_k']} MRR={dense_summary['mrr']}")
        print(f"hybrid+r Recall@k={hybrid_summary['recall_at_k']} MRR={hybrid_summary['mrr']}")
        print(f"delta    Recall@k={delta_recall:+} MRR={delta_mrr:+}")

        report = {
            "comparison": {
                "dense": dense_report,
                "hybrid_rerank": hybrid_report,
                "delta": {
                    "recall_at_k": delta_recall,
                    "mrr": delta_mrr,
                },
            }
        }
    else:
        single_report = _evaluate_strategy(
            collection=collection,
            rows=rows,
            default_top_k=args.top_k,
            default_min_score=args.min_score,
            retrieval_mode=args.retrieval_mode,
            rerank_enabled=args.rerank_enabled,
            dense_candidate_k=max(1, args.dense_candidate_k),
            lexical_candidate_k=max(1, args.lexical_candidate_k),
            rerank_candidate_k=max(1, args.rerank_candidate_k),
        )
        summary = single_report["summary"]

        print("=== Retrieval Evaluation ===")
        print(f"queries: {summary['queries']}")
        print(f"mode: {summary['retrieval_mode']} | rerank: {summary['rerank_enabled']}")
        print(f"Recall@k: {summary['recall_at_k']}")
        print(f"MRR: {summary['mrr']}")

        for row in single_report["rows"]:
            status = "HIT" if row["hit@k"] else "MISS"
            first = row["matches"][0] if row["matches"] else None
            first_label = f"{first['filename']}#{first['chunk_index']}" if first else "none"
            print(f"- {status} | rr={row['rr']} | top={first_label} | query={row['query']}")

        report = single_report

    if args.output:
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Detailed report saved to: {args.output}")


if __name__ == "__main__":
    main()
