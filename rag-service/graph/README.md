# graph/

Graph RAG code lives here. Roadmap and milestones: `../GRAPH_RAG.md`.

- `extract.py` - chunk -> nodes + edges with the LLM (G1)
- `build.py` - chunks -> `data/graph/extractions.jsonl` -> merged graph written into Neo4j (G2)
- `store.py` - Neo4j connection, write, stats (G2)
- `retrieve.py` - question -> chunks via the graph (G3), the `graph` / `vector+graph` modes of
  `ask.retrieve` (G5), and `related_terms` for the app (G6)
- `evals/` - relation questions about chapter 7, `run_graph_evals.py`, `results.csv` (G4)

## Run it

Neo4j must be running (Docker), with `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` in `.env`.

```
python -m graph.build extract --pages 594-693   # LLM reads the chunks (costs Groq tokens, resumable)
python -m graph.build load                      # merge duplicates, write into Neo4j
python -m graph.build stats                     # node/edge counts, 10 most-linked nodes
python -m graph.evals.run_graph_evals <label>   # vector vs graph vs vector+graph
```

`extract` stops on Groq's daily token limit; run it again the next day, or set
`RAG_TREE_MODEL=openai/gpt-oss-120b` to use that model's own daily allowance.

## What the service does with it

- `RAG_RETRIEVER=graph` or `vector+graph` in `.env` makes `/ask` use the graph.
- `POST /who` also returns `related`: the terms the asked one links to, with pages
  (only pages up to `current_page`). The app shows them under the answer.
- `GET /graph/node?name=LoRA&current_page=700` returns the same list on its own.
- If Neo4j is not running, nothing breaks: `/ask` uses vector search and `related` is empty.

## Scope

Only chapter 7 (Finetuning, pages 594-693) is in the graph so far: the whole book is about
2.5M tokens of extraction, about 12 days of Groq's free daily limit.
