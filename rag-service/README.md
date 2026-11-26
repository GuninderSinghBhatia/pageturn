# rag-service

The Python service that adds RAG features to Page Turn. The app calls it over HTTP on
`localhost:8000`. Milestones and learning plan: see MENTOR.md. Graph RAG plan: GRAPH_RAG.md.

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

## Build the indexes (once per book)

```
python index_book.py     # chunks -> embeddings -> data/chroma (vector search)
python tree.py           # table-of-contents tree + LLM summaries -> data/tree.json (~25 min)
```

`tree.py` is resumable: if it stops, run it again and it skips finished nodes. Groq's free tier
allows 8,000 tokens a minute, so every LLM call goes through `tree.invoke_paced`.

## Choosing a retriever

`RAG_RETRIEVER` (environment variable or `.env`) picks how passages are found; default `vector`.

- `vector`: similarity search over the chunks.
- `tree`: an LLM picks chapters, then sections, from the summaries; returns the start of each section.
- `hybrid`: the tree narrows the pages, then vector search runs inside them.
- `graph`: walks the Neo4j knowledge graph from the terms in the question (see `graph/README.md`);
  falls back to `vector` when Neo4j is down or the graph knows none of the terms.
- `vector+graph`: both lists merged, vector first, repeats removed.

## Evals

```
python -m evals.run_evals <vector|tree|hybrid|graph|vector+graph> [label]
python -m graph.evals.run_graph_evals [label]     # relation questions, see graph/README.md
pytest
```

Each run appends hit rate, off-topic refusals, pages covered, retrieval time and LLM tokens to
`evals/results.csv`. "Hit" means the expected page is inside a returned passage's page range, so
tree (whole sections) gets an easier test than vector and hybrid (single pages): compare it with
the "avg pages covered" column.

## Not committed

`.venv/` (the environment), `data/` (the Chroma index and the tree on disk), `docs/` (the book
PDFs) and `.env` (API keys).
