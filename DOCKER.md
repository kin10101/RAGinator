# Docker and docker-compose for React-RAG-App

Quick instructions to build and run the project with Docker Compose.

Prereqs
- Docker Engine and Docker Compose installed.
- (Optional) Create a `.env` file at the repository root with values such as `OPENAI_API_KEY`.

Build and run (production-style)

```bash
docker compose build --pull
docker compose up -d
```

- Backend will be available at: http://localhost:8000
- Frontend will be available at: http://localhost:3000

Stopping and removing containers

```bash
docker compose down
```

Notes & tips
- The backend Dockerfile installs Python deps from `pyproject.toml`. Some packages (e.g. sentence-transformers or PyMuPDF) may require additional system packages; inspect build logs for failures and add apt packages to the backend Dockerfile if needed.
- Uploaded files and Chromadb storage are mounted as volumes from `backend/uploads`, `backend/chroma_db`, and `backend/texts` so data persists between container restarts.
- For local development using the Vite dev server, you can run the frontend with `npm run dev` inside `frontend/` instead of using the Dockerized static build.
