"""Retrieve with the graph (G3): question -> chunks, same shape as ask.retrieve().

Steps:
  1. find start nodes: node names that appear in the question; if none do, the nodes whose
     names are closest to the question by embedding
  2. walk 1-2 steps along edges from them (Cypher)
  3. the edges and nodes carry chunk ids (their evidence); score and rank those chunks
  4. Spoiler Shield: drop chunks past max_page
  5. fetch the chunk texts from Chroma and return [{"text", "metadata"}, ...]
"""

import re
from collections import Counter

import numpy as np

import ask
from graph import store
from graph.build import node_key

MIN_SIMILARITY = 0.5  # fallback: how close a node name must be to the question
_name_cache: dict = {}  # node names + their embeddings, built once per process


def match_keys(question: str, all_keys: list[str]) -> list[str]:
    """Node keys whose name appears in the question, longest match first.

    The question is cut into words and each word goes through node_key, so "LLMs",
    "low-rank" and "matrices" are compared the same way the graph names were.
    """
    words = [node_key(w) for w in re.findall(r"[A-Za-z0-9]+", question)]
    text = f" {' '.join(w for w in words if w)} "
    found = [k for k in all_keys if len(k) >= 3 and f" {k} " in text]
    # "low rank" is dropped when "low rank adaptation" also matched
    return [k for k in sorted(found, key=len, reverse=True)
            if not any(k != other and f" {k} " in f" {other} " for other in found)]


def score_evidence(start_keys: list[str], start_rows: list[dict], edge_rows: list[dict]) -> Counter:
    """chunk id -> score. More links to the question's nodes means a higher score.

    start node's own chunks: 1.  edge touching a start node: 2 (5 if both ends are start
    nodes, that is the direct answer to "how are A and B related").  edge one step further out: 1.
    """
    start = set(start_keys)
    scores: Counter = Counter()
    for row in start_rows:
        for chunk_id in row["chunk_ids"]:
            scores[chunk_id] += 1
    for row in edge_rows:
        ends = {row["source_key"], row["target_key"]}
        if len(ends & start) == 2:
            weight = 5
        elif ends & start:
            weight = 2
        else:
            weight = 1
        for chunk_id in row["chunk_ids"]:
            scores[chunk_id] += weight
    return scores


def _node_names(db) -> dict:
    if not _name_cache:
        rows = db.query("MATCH (t:Term) RETURN t.key AS key, t.name AS name")
        _name_cache["keys"] = [r["key"] for r in rows]
        _name_cache["vectors"] = ask.model.encode([r["name"] for r in rows], show_progress_bar=False,
                                                  normalize_embeddings=True)
    return _name_cache


def find_start_keys(question: str, db, top: int = 3) -> list[str]:
    names = _node_names(db)
    if not names["keys"]:
        return []
    keys = match_keys(question, names["keys"])
    if keys:
        return keys
    # Fallback: no node name appears in the question, so use the closest names.
    q = ask.model.encode(question, show_progress_bar=False, normalize_embeddings=True)
    sims = names["vectors"] @ q
    best = np.argsort(-sims)[:top]
    return [names["keys"][i] for i in best if sims[i] >= MIN_SIMILARITY]


def walk(db, keys: list[str], hops: int = 2) -> tuple[list[dict], list[dict]]:
    """Start nodes, and the edges within `hops` steps of them (direction ignored)."""
    start_rows = db.query("MATCH (t:Term) WHERE t.key IN $keys RETURN t.key AS key, t.chunk_ids AS chunk_ids",
                          params={"keys": keys})
    edge_rows = db.query(
        """
        MATCH (s:Term)-[r:RELATES]-(:Term) WHERE s.key IN $keys
        WITH DISTINCT r
        RETURN startNode(r).key AS source_key, endNode(r).key AS target_key,
               startNode(r).name AS source, r.relation AS relation, endNode(r).name AS target,
               r.chunk_ids AS chunk_ids
        """,
        params={"keys": keys},
    )
    if hops >= 2:
        edge_rows += db.query(
            """
            MATCH (s:Term)-[:RELATES]-(m:Term)-[r:RELATES]-(:Term)
            WHERE s.key IN $keys AND NOT m.key IN $keys
            WITH DISTINCT r
            RETURN startNode(r).key AS source_key, endNode(r).key AS target_key,
                   startNode(r).name AS source, r.relation AS relation, endNode(r).name AS target,
                   r.chunk_ids AS chunk_ids
            LIMIT 1000
            """,
            params={"keys": keys},
        )
    return start_rows, edge_rows


def graph_retrieve(question: str, k: int = 3, max_page: int | None = None, hops: int = 2) -> list[dict]:
    """Top-k chunks found by walking the graph. Same shape as ask.retrieve().

    max_page: Spoiler Shield, no chunk after this page is returned. Needs Neo4j running.
    """
    db = store.connect()
    keys = find_start_keys(question, db)
    if not keys:
        return []
    start_rows, edge_rows = walk(db, keys, hops)
    scores = score_evidence(keys, start_rows, edge_rows)
    if not scores:
        return []

    ranked = [c for c, _ in scores.most_common()]
    found = ask.collection.get(ids=ranked, include=["documents", "metadatas"])
    by_id = {i: (d, m) for i, d, m in zip(found["ids"], found["documents"], found["metadatas"])}

    results = []
    for chunk_id in ranked:
        if chunk_id not in by_id:
            continue  # chunk was re-indexed since the graph was built
        text, metadata = by_id[chunk_id]
        if max_page is not None and metadata["page"] > max_page:
            continue  # Spoiler Shield
        results.append({"text": text, "metadata": {**metadata, "chunk_id": chunk_id}})
        if len(results) == k:
            break
    return results


# ---------- G5: the RAG_RETRIEVER switch uses these ----------


def graph_available() -> bool:
    """True when Neo4j answers. /ask must keep working when it is not running."""
    try:
        store.connect().query("RETURN 1")
        return True
    except Exception:
        return False


def retrieve_graph_or_vector(question: str, k: int = 3, max_page: int | None = None) -> list[dict]:
    """RAG_RETRIEVER=graph. Falls back to vector search when Neo4j is down or the graph
    knows none of the question's terms, so the reader always gets an answer."""
    try:
        results = graph_retrieve(question, k=k, max_page=max_page)
    except Exception as error:  # Neo4j not running, wrong password, ...
        print(f"graph retrieve failed, using vector: {str(error)[:120]}")
        results = []
    return results or ask.retrieve(question, mode="vector", k=k, max_page=max_page)


def merge_results(first: list[dict], second: list[dict], k: int) -> list[dict]:
    """Take turns from the two lists (first[0], second[0], first[1], ...), skip repeated
    chunks, stop at k. Vector goes first: it is the stronger one on plain lookups."""
    merged, seen = [], set()
    for i in range(max(len(first), len(second))):
        for results in (first, second):
            if i < len(results):
                item = results[i]
                key = (item["metadata"].get("page"), item["text"][:80])
                if key not in seen:
                    seen.add(key)
                    merged.append(item)
    return merged[:k]


_covered: dict = {}  # first and last page the graph has evidence for, read once per process


def covered_pages(db) -> tuple[int, int] | None:
    if "range" not in _covered:
        row = db.query("MATCH (t:Term) UNWIND t.pages AS p RETURN min(p) AS lo, max(p) AS hi")[0]
        _covered["range"] = (row["lo"], row["hi"]) if row["lo"] is not None else None
    return _covered["range"]


def retrieve_combined(question: str, k: int = 3, max_page: int | None = None) -> list[dict]:
    """RAG_RETRIEVER=vector+graph: vector and graph results merged, repeats removed.

    The graph is only asked when vector's best match lies inside the pages the graph was built
    from: for a question about another chapter the graph can only add wrong pages (the first
    eval run lost 2 whole-book lookups that way).
    """
    vector = ask.retrieve(question, mode="vector", k=k, max_page=max_page)
    try:
        span = covered_pages(store.connect())
        if not vector or span is None or not span[0] <= vector[0]["metadata"]["page"] <= span[1]:
            return vector
        graph = graph_retrieve(question, k=k, max_page=max_page)
    except Exception as error:
        print(f"graph retrieve failed, vector only: {str(error)[:120]}")
        graph = []
    return merge_results(vector, graph, k)


# ---------- G6: what a term connects to (for the app) ----------


def related_terms(name: str, max_page: int | None = None, limit: int = 8) -> list[dict]:
    """Neighbours of the node called `name`, strongest first, with their pages.

    [{"name", "relation", "direction" ("out": name -> other, "in": other -> name), "pages"}]
    Spoiler Shield: only pages up to max_page are listed, and a link with none left is dropped.
    Returns [] when the term is not in the graph or Neo4j is not running.
    """
    key = node_key(name)
    if not key:
        return []
    try:
        rows = store.connect().query(
            """
            MATCH (t:Term {key: $key})-[r:RELATES]-(o:Term)
            RETURN o.name AS name, r.relation AS relation, r.pages AS pages,
                   CASE WHEN startNode(r) = t THEN 'out' ELSE 'in' END AS direction
            """,
            params={"key": key},
        )
    except Exception:
        return []
    related = []
    for row in rows:
        pages = sorted(p for p in row["pages"] if max_page is None or p <= max_page)
        if pages:
            related.append({"name": row["name"], "relation": row["relation"],
                            "direction": row["direction"], "pages": pages})
    related.sort(key=lambda r: (-len(r["pages"]), r["pages"][0]))
    return related[:limit]
