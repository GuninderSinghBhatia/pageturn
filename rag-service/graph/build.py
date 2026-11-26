"""Build the graph from the book's chunks (G2).

Three separate commands, run from rag-service/:

  python -m graph.build extract [--start 0 --count 40]   read chunks (no flags = whole book) with the LLM (costs tokens)
  python -m graph.build extract --pages 594-693        only the chunks on these pages (one chapter)
  python -m graph.build load                           merge duplicates + write into Neo4j
  python -m graph.build stats                          node count, edge count, top 10 nodes

`extract` appends one line per chunk to data/graph/extractions.jsonl and skips chunks that
are already there, so a stop (or a Groq limit) never loses work. Run it again to continue.
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

from ask import collection
from graph import store
from graph.extract import ExtractionFailed, extract

BOOK_ID = "book1"
EXTRACTIONS = Path(__file__).resolve().parent.parent / "data" / "graph" / "extractions.jsonl"


# ---------- 1. extract, with saved progress ----------


def read_done() -> dict[str, dict]:
    """chunk id -> saved record, for every chunk already extracted."""
    if not EXTRACTIONS.exists():
        return {}
    done = {}
    for line in EXTRACTIONS.read_text(encoding="utf-8").splitlines():
        if line.strip():
            record = json.loads(line)
            done[record["id"]] = record
    return done


def is_daily_limit(error: str) -> bool:
    """Groq says 'tokens per day (TPD)' when the daily bucket is empty."""
    return "per day" in error or "TPD" in error


def ids_on_pages(first: int, last: int) -> list[str]:
    """Chunk ids whose page is in [first, last], in book order."""
    found = collection.get(where={"$and": [{"page": {"$gte": first}}, {"page": {"$lte": last}}]}, include=[])
    return sorted(found["ids"], key=lambda i: int(i.rsplit("-", 1)[1]))


def run_extract(start: int, count: int | None, pages: tuple[int, int] | None = None) -> None:
    EXTRACTIONS.parent.mkdir(parents=True, exist_ok=True)
    done = read_done()
    if pages:
        ids = ids_on_pages(*pages)
    else:
        end = collection.count() if count is None else start + count
        ids = [f"{BOOK_ID}-{i}" for i in range(start, end)]
    todo = [i for i in ids if i not in done]
    print(f"{len(ids)} chunks asked, {len(ids) - len(todo)} already done, {len(todo)} to do")

    for n, chunk_id in enumerate(todo, 1):
        found = collection.get(ids=[chunk_id], include=["documents", "metadatas"])
        if not found["ids"]:
            continue
        text, page = found["documents"][0], found["metadatas"][0]["page"]
        try:
            result = extract(text)
        except ExtractionFailed as error:
            if is_daily_limit(str(error)):
                print(f"STOP: Groq daily token limit reached at {chunk_id}. Run the same command again later.")
                return
            print(f"{chunk_id}: failed, not saved (will be retried next run)")
            continue
        record = {
            "id": chunk_id,
            "page": page,
            "nodes": [node.name for node in result.nodes],
            "edges": [[e.source, e.relation, e.target] for e in result.edges],
        }
        # Append right away: this line is the saved progress.
        with EXTRACTIONS.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(f"[{n}/{len(todo)}] {chunk_id} page {page}: {len(record['nodes'])} nodes, {len(record['edges'])} edges")


# ---------- 2. merge duplicates ----------


def node_key(name: str) -> str:
    """One key per real thing: 'LoRA', 'lora', 'Low-Rank Adaptation (LoRA)' -> 'lora'.

    Rules, in order: use the short one-word form inside brackets (same first letter as the
    long form, or its initials); lowercase; hyphens and punctuation become spaces; drop a leading
    'the'; cut a plural 's'.
    """
    name = name.strip()
    bracket = re.match(r"^(.+?)\s*\(([^)]+)\)$", name)
    if bracket:
        long_form, short = bracket.group(1), bracket.group(2).strip()
        initials = "".join(w[0] for w in re.split(r"[\s\-]+", long_form) if w).lower()
        if " " not in short and len(short) <= 10 and short[0].lower() == long_form.strip()[0].lower() or short.lower().replace(" ", "") == initials:
            name = short
        else:
            name = long_form
    name = re.sub(r"[^a-z0-9 ]+", " ", name.lower().replace("-", " "))
    words = name.split()
    if words and words[0] in ("the", "a", "an"):
        words = words[1:]
    # "weight matrix W" and "weight matrix" are the same thing: drop a lone trailing letter.
    if len(words) >= 3 and len(words[-1]) == 1:
        words = words[:-1]
    if words:
        last = words[-1]
        if last in IRREGULAR_PLURALS:
            words[-1] = IRREGULAR_PLURALS[last]
        elif len(last) > 3 and last.endswith("s") and not last.endswith(("ss", "us", "is")):
            words[-1] = last[:-1]
    return " ".join(words)


IRREGULAR_PLURALS = {"matrices": "matrix", "matrice": "matrix", "indices": "index", "analyses": "analysis"}


def acronym_map(keys: list[str]) -> dict[str, str]:
    """Map a long key to its acronym key when both exist: 'retrieval augmented generation' -> 'rag'."""
    keyset = set(keys)
    mapping = {}
    for key in keys:
        words = key.split()
        if len(words) >= 2:
            initials = "".join(w[0] for w in words)
            if len(initials) >= 3 and initials in keyset:
                mapping[key] = initials
    return mapping


def merge(records: list[dict]) -> tuple[list[dict], list[dict]]:
    """Group the per-chunk answers into one node per key and one edge per (a, relation, b)."""
    nodes: dict[str, dict] = {}
    edges: dict[tuple, dict] = {}

    def add_node(name: str, record: dict) -> str | None:
        key = node_key(name)
        if not key:
            return None
        n = nodes.setdefault(key, {"names": Counter(), "pages": set(), "chunk_ids": set()})
        n["names"][name.strip()] += 1
        n["pages"].add(record["page"])
        n["chunk_ids"].add(record["id"])
        return key

    for record in records:
        for name in record["nodes"]:
            add_node(name, record)
        for source, relation, target in record["edges"]:
            a, b = add_node(source, record), add_node(target, record)
            if not a or not b or a == b:
                continue
            relation = " ".join(relation.lower().split())
            e = edges.setdefault((a, relation, b), {"pages": set(), "chunk_ids": set()})
            e["pages"].add(record["page"])
            e["chunk_ids"].add(record["id"])

    # Second pass: fold long forms into their acronym ("retrieval augmented generation" -> "rag").
    remap = acronym_map(list(nodes))
    for long_key, short_key in remap.items():
        n, target = nodes.pop(long_key), nodes[short_key]
        target["names"].update(n["names"])
        target["pages"] |= n["pages"]
        target["chunk_ids"] |= n["chunk_ids"]
    merged_edges: dict[tuple, dict] = {}
    for (a, relation, b), e in edges.items():
        a, b = remap.get(a, a), remap.get(b, b)
        if a == b:
            continue
        m = merged_edges.setdefault((a, relation, b), {"pages": set(), "chunk_ids": set()})
        m["pages"] |= e["pages"]
        m["chunk_ids"] |= e["chunk_ids"]
    edges = merged_edges

    node_list = [
        {
            "key": key,
            "name": n["names"].most_common(1)[0][0],  # the spelling used most often
            "aliases": sorted(n["names"]),
            "pages": sorted(n["pages"]),
            "chunk_ids": sorted(n["chunk_ids"]),
        }
        for key, n in nodes.items()
    ]
    edge_list = [
        {
            "source": a,
            "relation": relation,
            "target": b,
            "pages": sorted(e["pages"]),
            "chunk_ids": sorted(e["chunk_ids"]),
        }
        for (a, relation, b), e in edges.items()
    ]
    return node_list, edge_list


# ---------- 3. write into Neo4j ----------


def run_load() -> None:
    records = list(read_done().values())
    node_list, edge_list = merge(records)
    print(f"{len(records)} chunks -> {len(node_list)} nodes, {len(edge_list)} edges after merging")
    db = store.connect()
    store.clear_terms(db)
    store.write_graph(db, node_list, edge_list)
    print("written to Neo4j")


def run_stats() -> None:
    s = store.stats(store.connect())
    print(f"nodes: {s['nodes']}   edges: {s['edges']}")
    for row in s["top"]:
        print(f"  {row['links']:>3} links  {row['name']}  ({row['pages']} pages)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("extract")
    p.add_argument("--start", type=int, default=0)
    p.add_argument("--count", type=int, default=None, help="how many chunks; omit for all")
    p.add_argument("--pages", default=None, help="page range like 594-693 (overrides --start/--count)")
    sub.add_parser("load")
    sub.add_parser("stats")
    args = parser.parse_args()
    if args.command == "extract":
        pages = tuple(int(x) for x in args.pages.split("-")) if args.pages else None
        run_extract(args.start, args.count, pages)
    elif args.command == "load":
        run_load()
    else:
        run_stats()
