from __future__ import annotations

from pathlib import Path

from chunker import chunk_text
from vectordb import get_collection, list_chunks, search_chunks, upsert_file_chunks


def main() -> None:
    temp_dir = Path(__file__).resolve().parent / "_smoke_chroma"
    collection = get_collection(temp_dir)

    sample_text = "FastAPI and ChromaDB can power a lightweight retrieval layer for RAG applications."
    chunks = chunk_text(sample_text, chunk_size=35, overlap=8)
    upsert_file_chunks(collection, "smoke.txt", chunks)

    all_chunks = list_chunks(collection, filename="smoke.txt", limit=20)
    matches = search_chunks(collection, query="retrieval layer", top_k=3, filename="smoke.txt")

    print(f"chunk_count={len(chunks)}")
    print(f"stored_items={len(all_chunks['items'])}")
    print(f"top_match={matches[0]['id'] if matches else 'none'}")


if __name__ == "__main__":
    main()

