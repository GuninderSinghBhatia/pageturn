# graph/

Graph RAG code lives here. Roadmap and milestones: `../GRAPH_RAG.md`.

Files (add as you reach each milestone):

- `extract.py` - chunk -> nodes + edges (G1)
- `build.py` - all chunks -> saved graph in `../data/graph/` (G2)
- `store.py` - load / save / query the graph (G2-G3)
- `retrieve.py` - question -> chunks via the graph, same shape as `ask.retrieve` (G3)
- `evals/` - graph questions and results (G4)
