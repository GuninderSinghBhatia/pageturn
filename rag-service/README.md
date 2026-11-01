# rag-service

The Python service that adds RAG features to Page Turn. The app calls it over HTTP on
`localhost:8000`. Milestones and learning plan: see MENTOR.md.

## Setup (once)

```
cd rag-service
uv venv --python 3.12 .venv
uv pip install --python .venv -r requirements.txt
```

## Every session

Activate the environment (PowerShell):

```
.venv\Scripts\Activate.ps1
```

(Git Bash: `source .venv/Scripts/activate`.) Then run the server with uvicorn, pointing it at
your FastAPI app object, with auto-reload while you develop. Tests: `pytest`.

## Not committed

`.venv/` (the environment), `data/` (the Chroma index on disk) and `.env` (API keys).
