from __future__ import annotations

import json
import os
from pathlib import Path
from typing import AsyncIterator, List, Optional

import aiofiles
from docx import Document as DocxDocument
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

from chunker import DEFAULT_CHUNK_METHOD, chunk_text, list_chunk_methods
from vectordb import (
    build_embeddings,
    delete_file_chunks,
    get_collection,
    get_file_chunk_count,
    list_chunks,
    search_chunks,
    upsert_file_chunks,
)

# ── Load .env from workspace root (one level above backend/) ──────────────────
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
TEXT_DIR = BASE_DIR / "texts"
CHROMA_DIR = BASE_DIR / "chroma_db"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
TEXT_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="React RAG Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

collection = get_collection(CHROMA_DIR)

# ── OpenAI client (lazy – only initialised when /chat is used) ────────────────
_openai_client: AsyncOpenAI | None = None
_ollama_client: AsyncOpenAI | None = None

DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1"


def get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set")
        _openai_client = AsyncOpenAI(api_key=api_key)
    return _openai_client


def get_ollama_client(base_url: str = DEFAULT_OLLAMA_BASE_URL) -> AsyncOpenAI:
    """Return an AsyncOpenAI client pointed at the Ollama OpenAI-compatible API."""
    global _ollama_client
    if _ollama_client is None or _ollama_client.base_url != base_url:
        _ollama_client = AsyncOpenAI(api_key="ollama", base_url=base_url)
    return _ollama_client


# ── Chat configuration defaults (edit these to reconfigure the chatbot) ───────
CHAT_DEFAULTS = {
    "provider": "openai",             # "openai" | "ollama"
    "ollama_base_url": DEFAULT_OLLAMA_BASE_URL,  # Ollama server URL
    "model": "gpt-4o-mini",           # OpenAI model to use
    "temperature": 0.3,               # 0 = deterministic, 1 = creative
    "max_tokens": 1024,               # Max tokens in the completion
    "top_k": 5,                       # Number of RAG chunks to retrieve
    "rag_enabled": True,              # Toggle RAG retrieval on/off
    "system_prompt": (
        "You are a helpful, knowledgeable assistant. "
        "When relevant context is provided from the knowledge base, use it to answer accurately. "
        "Always cite the source document name when drawing from retrieved context. "
        "If the context does not contain an answer, say so clearly and answer from general knowledge if possible. "
        "Format your responses in clear, readable Markdown."
    ),
}


class BulkSelection(BaseModel):
    filenames: List[str]


class EmbedRequest(BaseModel):
    filenames: List[str]
    chunk_size: int = 800
    overlap: int = 120
    chunk_method: str = DEFAULT_CHUNK_METHOD


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    filename: Optional[str] = None


class ChatMessage(BaseModel):
    role: str   # "user" | "assistant" | "system"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []
    # Per-request config overrides (fall back to CHAT_DEFAULTS)
    provider: Optional[str] = None
    ollama_base_url: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_k: Optional[int] = None
    rag_enabled: Optional[bool] = None
    filename_filter: Optional[str] = None
    system_prompt: Optional[str] = None


def normalize_relative_path(raw_value: str) -> str:
    normalized = (raw_value or "").replace("\\", "/").strip().lstrip("/")
    if not normalized:
        raise HTTPException(status_code=400, detail="Invalid empty file path")

    parts = [part for part in normalized.split("/") if part not in ("", ".")]
    if not parts or any(part == ".." for part in parts):
        raise HTTPException(status_code=400, detail="Invalid file path")

    return "/".join(parts)


def safe_join(base: Path, relative_path: str) -> Path:
    resolved_base = base.resolve()
    candidate = (resolved_base / relative_path).resolve()
    try:
        candidate.relative_to(resolved_base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Path traversal is not allowed") from exc
    return candidate


def text_cache_path(relative_path: str) -> Path:
    return safe_join(TEXT_DIR, f"{relative_path}.txt")


def extract_text(file_path: Path) -> str:
    extension = file_path.suffix.lower()

    if extension == ".pdf":
        try:
            import fitz
        except ModuleNotFoundError as exc:
            raise HTTPException(
                status_code=500,
                detail="PDF extraction dependency missing. Install PyMuPDF.",
            ) from exc

        document = fitz.open(str(file_path))
        try:
            return "\n".join(page.get_text() for page in document)
        finally:
            document.close()

    if extension in {".doc", ".docx"}:
        document = DocxDocument(str(file_path))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)

    return file_path.read_text(encoding="utf-8", errors="ignore")


async def save_upload(file: UploadFile, relative_path: str) -> str:
    normalized_path = normalize_relative_path(relative_path)
    destination = safe_join(UPLOAD_DIR, normalized_path)
    destination.parent.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    async with aiofiles.open(destination, "wb") as output_file:
        await output_file.write(content)

    extracted_text = extract_text(destination)
    cache_path = text_cache_path(normalized_path)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(cache_path, "w", encoding="utf-8") as output_file:
        await output_file.write(extracted_text)

    return normalized_path


def iterate_uploaded_files() -> List[str]:
    files: List[str] = []
    for path in UPLOAD_DIR.rglob("*"):
        if path.is_file():
            files.append(path.relative_to(UPLOAD_DIR).as_posix())
    return sorted(files)


def delete_local_file(relative_path: str) -> None:
    target = safe_join(UPLOAD_DIR, relative_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {relative_path}")

    target.unlink()

    cache_path = text_cache_path(relative_path)
    if cache_path.exists():
        cache_path.unlink()

    delete_file_chunks(collection, relative_path)


def build_chunks_for_text(text: str, chunk_size: int, overlap: int, chunk_method: str) -> List[str]:
    embed_fn = build_embeddings if chunk_method == "semantic" else None
    return chunk_text(
        text,
        chunk_size=chunk_size,
        overlap=overlap,
        method=chunk_method,
        embed_texts=embed_fn,
    )


@app.post("/files")
async def upload_file(file: UploadFile = File(...)):
    stored_path = await save_upload(file, file.filename)
    return {"uploaded": [{"filename": stored_path}]}


@app.post("/files/batch")
async def upload_files_batch(files: List[UploadFile] = File(...), relative_paths: List[str] = Form(default=[])):
    uploaded = []
    for index, upload in enumerate(files):
        provided_path = relative_paths[index] if index < len(relative_paths) and relative_paths[index] else upload.filename
        stored_path = await save_upload(upload, provided_path)
        uploaded.append({"filename": stored_path})
    return {"uploaded": uploaded}


@app.get("/files")
def list_files_endpoint():
    output = []
    for filename in iterate_uploaded_files():
        chunk_count = get_file_chunk_count(collection, filename)
        output.append(
            {
                "filename": filename,
                "chunk_count": chunk_count,
                "embed_status": "embedded" if chunk_count > 0 else "not_embedded",
            }
        )
    return output


@app.get("/chunkers")
def list_chunkers_endpoint():
    return {"default": DEFAULT_CHUNK_METHOD, "items": list_chunk_methods()}


@app.get("/files/{filename:path}/content")
async def get_content(filename: str):
    normalized = normalize_relative_path(filename)
    raw_path = safe_join(UPLOAD_DIR, normalized)

    if not raw_path.exists() or not raw_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {normalized}")

    cache_path = text_cache_path(normalized)
    if cache_path.exists():
        async with aiofiles.open(cache_path, "r", encoding="utf-8") as input_file:
            return {"content": await input_file.read()}

    extracted = extract_text(raw_path)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(cache_path, "w", encoding="utf-8") as output_file:
        await output_file.write(extracted)

    return {"content": extracted}


@app.patch("/files/{filename:path}")
def rename_file(filename: str, new_name: str = Query(...)):
    original = normalize_relative_path(filename)
    renamed = normalize_relative_path(new_name)

    old_path = safe_join(UPLOAD_DIR, original)
    new_path = safe_join(UPLOAD_DIR, renamed)

    if not old_path.exists() or not old_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {original}")

    if new_path.exists():
        raise HTTPException(status_code=409, detail=f"Target already exists: {renamed}")

    new_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.rename(new_path)

    old_cache = text_cache_path(original)
    new_cache = text_cache_path(renamed)
    if old_cache.exists():
        new_cache.parent.mkdir(parents=True, exist_ok=True)
        old_cache.rename(new_cache)

    delete_file_chunks(collection, original)
    return {"filename": renamed}


@app.delete("/files/{filename:path}")
def delete_file(filename: str):
    normalized = normalize_relative_path(filename)
    delete_local_file(normalized)
    return {"deleted": normalized}


@app.post("/files/bulk-delete")
def bulk_delete_files(request: BulkSelection):
    deleted = []
    for filename in request.filenames:
        normalized = normalize_relative_path(filename)
        delete_local_file(normalized)
        deleted.append(normalized)
    return {"deleted": deleted}


@app.post("/files/{filename:path}/chunks")
def preview_chunks(
    filename: str,
    chunk_size: int = Query(800, ge=50),
    overlap: int = Query(120, ge=0),
    chunk_method: str = Query(DEFAULT_CHUNK_METHOD),
):
    normalized = normalize_relative_path(filename)
    source = safe_join(UPLOAD_DIR, normalized)

    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {normalized}")

    try:
        chunks = build_chunks_for_text(
            extract_text(source),
            chunk_size=chunk_size,
            overlap=overlap,
            chunk_method=chunk_method,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "filename": normalized,
        "chunk_method": chunk_method,
        "chunk_count": len(chunks),
        "chunks": chunks,
    }


@app.post("/files/embed")
def embed_files(request: EmbedRequest):
    embedded_files = []
    total_chunks = 0

    for filename in request.filenames:
        normalized = normalize_relative_path(filename)
        source = safe_join(UPLOAD_DIR, normalized)

        if not source.exists() or not source.is_file():
            raise HTTPException(status_code=404, detail=f"File not found: {normalized}")

        try:
            chunks = build_chunks_for_text(
                extract_text(source),
                chunk_size=request.chunk_size,
                overlap=request.overlap,
                chunk_method=request.chunk_method,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        delete_file_chunks(collection, normalized)
        chunk_count = upsert_file_chunks(collection, normalized, chunks, chunk_method=request.chunk_method)
        embedded_files.append({"filename": normalized, "chunks": chunk_count, "status": "success"})
        total_chunks += chunk_count

    return {
        "chunk_method": request.chunk_method,
        "embedded_files": embedded_files,
        "total_chunks": total_chunks,
    }


@app.post("/search")
def search(request: SearchRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query must not be empty")

    normalized_filename = normalize_relative_path(request.filename) if request.filename else None
    matches = search_chunks(collection, query=query, top_k=max(1, request.top_k), filename=normalized_filename)

    return {"query": query, "matches": matches, "count": len(matches)}


@app.get("/chunks")
def get_chunks(
    filename: Optional[str] = Query(default=None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    normalized_filename = normalize_relative_path(filename) if filename else None
    result = list_chunks(collection, filename=normalized_filename, limit=limit, offset=offset)
    return {
        "items": result["items"],
        "count": result["count"],
        "limit": limit,
        "offset": offset,
    }


# ── Chat endpoints ─────────────────────────────────────────────────────────────

@app.get("/chat/config")
def get_chat_config():
    """Return the default chat configuration so the frontend can seed its settings UI."""
    return CHAT_DEFAULTS


@app.get("/chat/ollama-models")
async def list_ollama_models(base_url: str = DEFAULT_OLLAMA_BASE_URL):
    """Return the list of models available in the running Ollama instance."""
    import httpx
    from urllib.parse import urlparse
    try:
        parsed = urlparse(base_url)
        tags_url = f"{parsed.scheme}://{parsed.netloc}/api/tags"
        async with httpx.AsyncClient(timeout=5.0) as http:
            resp = await http.get(tags_url)
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"models": models}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not reach Ollama: {exc}") from exc


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Stream an LLM response via Server-Sent Events.

    SSE event types emitted:
      • {"type": "sources", "sources": [...]}   – RAG chunks retrieved (first event)
      • {"type": "token",   "content": "..."}   – partial LLM text
      • {"type": "done"}                         – stream complete
      • {"type": "error",  "message": "..."}    – on failure
    """
    # Merge per-request overrides with CHAT_DEFAULTS
    provider      = request.provider      or CHAT_DEFAULTS["provider"]
    ollama_base_url = request.ollama_base_url or CHAT_DEFAULTS["ollama_base_url"]
    model         = request.model         or CHAT_DEFAULTS["model"]
    temperature   = request.temperature   if request.temperature is not None else CHAT_DEFAULTS["temperature"]
    max_tokens    = request.max_tokens    if request.max_tokens   is not None else CHAT_DEFAULTS["max_tokens"]
    top_k         = request.top_k         if request.top_k        is not None else CHAT_DEFAULTS["top_k"]
    rag_enabled   = request.rag_enabled   if request.rag_enabled  is not None else CHAT_DEFAULTS["rag_enabled"]
    system_prompt = request.system_prompt or CHAT_DEFAULTS["system_prompt"]

    filename_filter = (
        normalize_relative_path(request.filename_filter)
        if request.filename_filter
        else None
    )

    async def event_stream() -> AsyncIterator[str]:
        def sse(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        try:
            # 1. RAG retrieval
            sources: list = []
            context_block = ""
            if rag_enabled:
                matches = search_chunks(
                    collection,
                    query=request.message,
                    top_k=max(1, top_k),
                    filename=filename_filter,
                )
                sources = [
                    {
                        "id": m["id"],
                        "filename": m["filename"],
                        "chunk_index": m["chunk_index"],
                        "document": m["document"],
                        "distance": m["distance"],
                    }
                    for m in matches
                ]
                if sources:
                    context_parts = []
                    for s in sources:
                        context_parts.append(
                            f'[Source: {s["filename"]}, chunk {s["chunk_index"]}]\n{s["document"]}'
                        )
                    context_block = (
                        "## Relevant context from knowledge base\n\n"
                        + "\n\n---\n\n".join(context_parts)
                        + "\n\n---\n\n"
                    )

            yield sse({"type": "sources", "sources": sources})

            # 2. Build messages
            messages = [{"role": "system", "content": system_prompt}]
            for msg in request.history:
                if msg.role in {"user", "assistant", "system"}:
                    messages.append({"role": msg.role, "content": msg.content})

            user_content = (context_block + request.message) if context_block else request.message
            messages.append({"role": "user", "content": user_content})

            # 3. Stream from OpenAI or Ollama
            if provider == "ollama":
                client = get_ollama_client(ollama_base_url)
            else:
                client = get_openai_client()
            stream = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )

            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yield sse({"type": "token", "content": delta.content})

            yield sse({"type": "done"})

        except Exception as exc:  # noqa: BLE001
            yield sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
