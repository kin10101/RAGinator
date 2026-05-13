# Backend API

FastAPI backend for file upload, chunking, embedding, and retrieval with ChromaDB.

## Run

```powershell
Set-Location "C:\Users\extpedj\Desktop\RAGinator\backend"
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Smoke Test (vector helpers)

```powershell
Set-Location "C:\Users\extpedj\Desktop\RAGinator\backend"
python smoke_test.py
```

## Retrieval Evaluation

Run quality evaluation against a gold query set to track Recall@k and MRR:

```powershell
Set-Location "C:\Users\extpedj\Desktop\RAGinator\backend"
python retrieval_eval.py --dataset eval_dataset.sample.json --top-k 5 --min-score 0.2
```

Compare dense baseline vs hybrid retrieval + reranker:

```powershell
python retrieval_eval.py --dataset eval_dataset.sample.json --compare --top-k 5 --min-score 0.2
```

Optional detailed report output:

```powershell
python retrieval_eval.py --dataset eval_dataset.sample.json --output eval_report.json
```

## Key Endpoints

- `GET /files` -> list uploaded files with `chunk_count` and `embed_status`
- `POST /files/batch` -> upload multiple files/folder contents (`files`, `relative_paths`)
- `POST /files/embed` -> embed selected files into ChromaDB (`filenames`, `chunk_size`, `overlap`)
- `GET /notebooks` -> list notebooks
- `POST /notebooks` -> create notebook
- `PATCH /notebooks/{notebook_id}` -> update notebook
- `DELETE /notebooks/{notebook_id}` -> delete notebook
- `POST /notebooks/{notebook_id}/files` -> attach files to notebook
- `DELETE /notebooks/{notebook_id}/files` -> detach files from notebook
- `POST /search` -> retrieval test against vectors (`query`, `top_k`, optional `filename`, `min_relevance_score`, `include_debug`)
- `GET /chunks` -> list stored chunks as cards data (`limit`, `offset`, optional `filename`, optional `notebook_id`)
- `POST /files/bulk-delete` -> remove many files and their vectors
- `POST /chat` -> supports retrieval tuning flags (`min_relevance_score`, `retrieval_debug`, `notebook_id`)

