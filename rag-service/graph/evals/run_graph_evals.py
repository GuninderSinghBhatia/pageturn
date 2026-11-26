"""G4: score vector, graph and vector+graph retrieval on two question sets.

Run from rag-service/ (Neo4j must be running):   python -m graph.evals.run_graph_evals [label]

Question sets
  relation    graph/evals/questions.json: "how are A and B related" questions about chapter 7,
              the only chapter in the graph so far
  regression  evals/questions.json: the 25 answerable lookup questions from M4 (whole book)
  regr-ch7    the regression questions whose page is inside the graph's pages (594-693)

Retrievers
  vector         plain Chroma search (the M4 baseline)
  graph-only     graph walk with no fallback: shows what the graph alone finds
  graph          RAG_RETRIEVER=graph: graph walk, vector search when the graph finds nothing
  vector+graph   RAG_RETRIEVER=vector+graph: both lists merged

hit@3 = one of the 3 returned chunks is on an expected page. No LLM is called for retrieval,
so tokens are 0 for every retriever here. Results are appended to graph/evals/results.csv.
"""

import csv
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import ask
from graph import retrieve as g

HERE = Path(__file__).parent
GRAPH_PAGES = (594, 693)
RETRIEVERS = {
    "vector": lambda q: ask.retrieve(q, mode="vector"),
    "graph-only": lambda q: g.graph_retrieve(q),
    "graph": lambda q: g.retrieve_graph_or_vector(q),
    "vector+graph": lambda q: g.retrieve_combined(q),
}


def load_sets() -> dict[str, list[dict]]:
    relation = json.loads((HERE / "questions.json").read_text(encoding="utf-8"))["questions"]
    m4 = json.loads((HERE.parent.parent / "evals" / "questions.json").read_text(encoding="utf-8"))["questions"]
    regression = [{"id": q["id"], "question": q["question"], "pages": [q["page"]]} for q in m4 if q["answerable"]]
    in_graph = [q for q in regression if GRAPH_PAGES[0] <= q["pages"][0] <= GRAPH_PAGES[1]]
    return {"relation": relation, "regression": regression, "regr-ch7": in_graph}


def score(retriever, questions: list[dict]) -> dict:
    hits = near = empty = 0
    seconds = []
    misses = []
    for q in questions:
        started = time.perf_counter()
        results = retriever(q["question"])
        seconds.append(time.perf_counter() - started)
        pages = [r["metadata"]["page"] for r in results]
        empty += not pages
        hit = any(p in q["pages"] for p in pages)
        hits += hit
        near += any(abs(p - e) <= 1 for p in pages for e in q["pages"])
        if not hit:
            misses.append(q["id"])
    n = len(questions)
    return {"n": n, "hit": hits / n, "near": near / n, "empty": empty,
            "seconds": sum(seconds) / n, "misses": misses}


def main(label: str) -> None:
    sets = load_sets()
    for retriever in RETRIEVERS.values():  # warm-up: model load + node-name embeddings
        retriever("LoRA")
    rows = []
    print(f"{'set':<11} {'retriever':<13} {'hit@3':>6} {'±1 page':>8} {'empty':>6} {'sec':>6}  misses")
    for set_name, questions in sets.items():
        for name, retriever in RETRIEVERS.items():
            s = score(retriever, questions)
            print(f"{set_name:<11} {name:<13} {s['hit']:>6.0%} {s['near']:>8.0%} {s['empty']:>6} "
                  f"{s['seconds']:>6.2f}  {s['misses']}", flush=True)
            rows.append([datetime.now().isoformat(timespec="seconds"), label, set_name, name, s["n"],
                         f"{s['hit']:.3f}", f"{s['near']:.3f}", s["empty"], f"{s['seconds']:.3f}", 0,
                         " ".join(map(str, s["misses"]))])

    results = HERE / "results.csv"
    new_file = not results.exists()
    with open(results, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["time", "label", "set", "retriever", "questions", "hit_rate", "within_1_page",
                             "empty", "avg_retrieval_s", "avg_retrieval_tokens", "missed_ids"])
        writer.writerows(rows)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1] if len(sys.argv) > 1 else "")
