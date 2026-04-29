# Backend API

FastAPI backend for file upload, chunking, embedding, and retrieval with ChromaDB.

## Run

```powershell
Set-Location "C:\Users\extpedj\Desktop\kin-reference-code-snippets\React-RAG-App\backend"
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Smoke Test (vector helpers)

```powershell
Set-Location "C:\Users\extpedj\Desktop\kin-reference-code-snippets\React-RAG-App\backend"
python smoke_test.py
```

## Key Endpoints

- `GET /files` -> list uploaded files with `chunk_count` and `embed_status`
- `POST /files/batch` -> upload multiple files/folder contents (`files`, `relative_paths`)
- `POST /files/embed` -> embed selected files into ChromaDB (`filenames`, `chunk_size`, `overlap`)
- `POST /search` -> retrieval test against vectors (`query`, `top_k`, optional `filename`)
- `GET /chunks` -> list stored chunks as cards data (`limit`, `offset`, optional `filename`)
- `POST /files/bulk-delete` -> remove many files and their vectors

