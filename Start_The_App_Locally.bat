@echo off
echo Starting React RAG App...

:: Start backend in a new window
start "RAG Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && uvicorn main:app --reload --port 8000"

:: Start frontend in a new window
start "RAG Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Both servers are starting in separate windows.
