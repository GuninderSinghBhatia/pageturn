# Graph RAG roadmap

You write this part. Vector RAG (M0–M8) stays as it is, and graph RAG is added next to it.
Same rule as before: one small step, run it, look at the output, then the next step.

## How we work

- **Teaching:** Socratic. One question or one small step at a time. You write the Python,
  Claude reviews it and runs it. No code is handed over unless you say "just do it".
- **Tools:** LangChain (same family as the rest of the service). Planned pieces:
  `LLMGraphTransformer` (chunk -> nodes + edges, G1-G2), **Neo4j** as the graph database
  (G0-G3, queried with Cypher, connected through the `langchain-neo4j` package), and the
  existing Groq model + Chroma retriever.
  Check the installed LangChain version before using any name from these notes.

## Why add a graph

Vector search finds text that *sounds like* the question. It is weak when the answer is
spread over many pages, or when the question is about how things *connect*:

- "How are LoRA, QLoRA and quantization related?"
- "Which techniques does the book use to cut inference cost?"
- "What does RLHF depend on?"

A graph stores **things** (nodes) and **links between them** (edges), each with the pages
where the book says it. You answer by walking links, then reading the pages behind them.

Words used in this file (one word, one meaning):

- **node** = one thing in the book (a term, a method, a person).
- **edge** = one link between two nodes, e.g. `QLoRA --is a version of--> LoRA`.
- **evidence** = the page numbers (and chunk ids) that back a node or an edge.
- **chunk** = the 500-character pieces already stored in Chroma.

## Folders

```
rag-service/
  graph/              <- all graph code goes here (a Python package)
    README.md           what each file does, keep it short
    __init__.py
    evals/              graph questions + results.csv for graph runs
  (the graph itself lives inside Neo4j, not in a file; Neo4j's own data folder is not in git)
  tests/              <- add test_graph_*.py here, next to the others
  GRAPH_RAG.md        <- this file
```

Suggested files inside `graph/` as you go (create them when you reach the step, not before):
`extract.py`, `build.py`, `store.py`, `retrieve.py`, `answer.py`.

Rules to keep the two systems apart:

- `graph/` may import from `ask.py` / `retrievers.py`. They must not import from `graph/`
  until G5 (when you add the switch).
- The graph stores `evidence` as the same 1-based `page` numbers and chunk ids that Chroma
  uses. Then Spoiler Shield (`max_page`) works on graph results with no new idea.

## Milestones

Each one has a **done when** line. Do them in order.

### G0 — Decide (no code)

- Storage is decided: **Neo4j**. Get a local Neo4j running (Docker is the easiest; Neo4j
  Desktop also works) and connect from Python with the address, user and password kept in
  the git-ignored `rag-service/.env`. Learn the 5 basic Cypher lines: create a node,
  create a link, find a node, find its neighbours, delete everything.
- Pick what a node is for the test book (*AI Engineering*, which has no characters):
  terms and methods such as `LoRA`, `RLHF`, `RAG`, `quantization`.
- Write 3 example edges by hand on paper, with their page numbers.

**Done when:** you can explain in 3 sentences what one node and one edge look like.

### G1 — Extract from one chunk

- Take one chunk. Ask the LLM (Groq, same as `tree.py`) to return JSON: a list of nodes
  and a list of edges, each edge as `source, relation, target`.
- Make the output strict (a schema, not free text) and handle bad JSON.
- Run it on 5 chunks by hand and read every result.

**Done when:** 5 chunks give sensible JSON, and you know the 2 most common mistakes the
model makes.

### G2 — Build the whole graph

- Run extraction over all 2,990 chunks. Mind the Groq limits (8,000 tokens/minute,
  200,000 tokens/day): save progress after every batch so a stop does not lose work,
  and try a small model first (`RAG_TREE_MODEL` style setting).
- Merge duplicates: `LoRA`, `Low-Rank Adaptation`, `lora` must become one node.
- Every node and edge keeps its `evidence` (pages + chunk ids). Write them into Neo4j (every node and link keeps its pages as properties).

**Done when:** a Cypher query returns the node count, the edge count, and the 10 nodes
with the most links, and they look right.

### G3 — Retrieve with the graph

- Given a question: find the starting nodes (match names in the question; fall back to
  vector search on node names), walk 1–2 steps along edges with a Cypher query, collect
  the `evidence` chunks.
- Apply Spoiler Shield: drop evidence past `current_page` (reuse the `max_page` idea).
- Return chunks in the same shape `retrieve()` returns, so `build_prompt` works unchanged.

**Done when:** `graph_retrieve("How are LoRA and QLoRA related?", current_page=900)` returns
sensible pages, and the same call at page 30 returns nothing.

### G4 — Graph questions and evals

- Write `graph/evals/questions.json`: about 15 questions that need links
  (relations, "what depends on", "compare") + the pages that should come back.
  Keep the 25 existing questions as the regression set.
- Run **both** retrievers (vector, graph) on **both** sets and append to a results CSV:
  hit@3, seconds, tokens.
- Expected honest result: graph may lose on plain lookup questions and win on
  relation questions. Write down which.

**Done when:** you have a table: question type × retriever, and you can say where the graph
wins and where it does not.

### G5 — Combine and wire in

- Add `RAG_RETRIEVER=graph` and `RAG_RETRIEVER=vector+graph` next to the existing
  `vector|tree|hybrid` switch (merge both result lists, remove duplicate chunks).
- Optional: a small router (relation-style question -> graph, otherwise vector).
- Claude can do the app side if the app needs a new button or label; you keep the
  Python.

**Done when:** `/ask` works with each setting, and the eval table includes `vector+graph`.

### G6 — Show the graph (optional)

- A `GET /graph/node?name=LoRA` endpoint returning neighbours + pages, and a small view in
  the app (Claude can build this part).
- Idea: extend "Who is this?" so it also lists related nodes.

**Done when:** you can click a term and see what it connects to, with page links.

### G7 — Resume numbers (yours to write)

Fill the table from the evals (vector vs graph vs combined; hit@3, speed, tokens per
question) and write the resume bullet yourself.

## Known traps

- **Duplicates** are the biggest problem in graph building. Spend real time on G2 merging.
- **Wrong edges look confident.** Always spot-check 20 random edges against the page text.
- **Neo4j must be running** before the service starts; decide what `/ask` does if it is not
  (fall back to vector).
- **Token budget.** Extraction over the whole book is the most expensive step in the
  project. Test on a few chapters first, and keep the `.env` model settings.
- **Test book.** No characters, so nodes are terms. When a novel is indexed, nodes can be
  people and places, and "Who is this?" gets much better.
- Re-ingesting chunks changes chunk ids: rebuild the graph if you re-index.

## Progress

- [x] G0  - [x] G1  - [x] G2  - [x] G3  - [x] G4  - [x] G5  - [x] G6  - [ ] G7 (your bullet)

Scope cut (2026-11-26): the graph holds chapter 7 only (Finetuning, pages 594-693). The whole
book is about 2.5M extraction tokens, ~12 days of Groq's free daily limit. To grow it, run
`python -m graph.build extract --pages <a>-<b>` for more chapters, then `load`, and add
questions for those chapters to `graph/evals/questions.json`.

How to run everything: `graph/README.md`. Eval table: `graph/evals/results.csv`.

## Results (2026-11-26, graph = chapter 7: 314 chunks -> 1,019 nodes, 1,136 links)

hit@3, `python -m graph.evals.run_graph_evals`. No LLM tokens at question time for any of these.

| question set | vector | graph only | vector+graph |
|---|---|---|---|
| 15 relation questions (ch. 7) | 80% | 53% | **87%** |
| 25 whole-book lookups (M4 set) | **80%** | 8% | 76% |
| 3 lookups inside ch. 7 | 67% | 67% | 67% |
| avg retrieval time | 0.03 s | 0.10 s | 0.15-0.21 s |

What it says:
- The graph alone is worse than vector: chunk scoring by link counts finds the right
  neighbourhood (73% within 1 page on relation questions) but not the exact page.
- Combined, it fixes one relation question vector missed (Q8, "what is LongLoRA a variant of").
- Outside the graph's pages it can only hurt, so `vector+graph` asks the graph only when
  vector's best page is inside the graph's page range. That took the whole-book loss from
  80% -> 72% down to 80% -> 76% (one question, Q4, still lost).
- Honest caveat: 15 questions, written by Claude; a one-question difference is noise-sized.

Building it cost ~0.9k Groq tokens per chunk (gpt-oss-20b / 120b, reasoning effort low).
The resume bullet (G7) is yours to write from this table.
