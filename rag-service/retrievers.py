"""Tree and hybrid retrieval (M5).

tree:   an LLM walks the table-of-contents tree (chapters, then sections) using each node's
        summary and picks the sections that should hold the answer.
hybrid: the same pick, then vector search restricted to the picked sections' pages.
"""
import json
import re

import pymupdf

import ask
import tree
from tree import invoke_paced

USAGE = {"tokens": 0, "calls": 0}  # LLM tokens spent choosing sections; reset by the eval script

MAX_CHAPTERS = 2
MAX_SECTIONS = 3
TREE_TEXT_CHARS = 1500

_tree: list[dict] | None = None
_doc = None


def get_tree() -> list[dict]:
    global _tree
    if _tree is None:
        loaded = tree.load_tree()
        if len(loaded) != len(tree.build_nodes(str(tree.BOOK))):
            raise RuntimeError("data/tree.json is incomplete: run `python tree.py` to finish it")
        _tree = loaded
    return _tree


def parse_ids(text: str, valid: set[int]) -> list[int]:
    """The node ids ("n34") in the first JSON list of an LLM reply, in order, without repeats or
    unknown ids. Bare numbers are ignored on purpose: chapter titles start with numbers ("2. ..."),
    and a model answering [2, 3] may mean chapters 2 and 3, not nodes 2 and 3."""
    match = re.search(r"\[[^\]]*\]", text)
    if not match:
        return []
    try:
        items = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    picked: list[int] = []
    for item in items:
        found = re.fullmatch(r"n(\d+)", item.strip()) if isinstance(item, str) else None
        if found and int(found.group(1)) in valid and int(found.group(1)) not in picked:
            picked.append(int(found.group(1)))
    return picked


def page_filter(ranges: list[tuple[int, int]]) -> dict:
    """Chroma `where` filter matching chunks whose page is inside any (start, end) range."""
    clauses = [{"$and": [{"page": {"$gte": start}}, {"page": {"$lte": end}}]} for start, end in ranges]
    return clauses[0] if len(clauses) == 1 else {"$or": clauses}


def outline(nodes: list[dict]) -> str:
    return "\n".join(f"n{n['id']} | pages {n['start']}-{n['end']} | {n['title']}: {n['summary']}" for n in nodes)


def choose(question: str, candidates: list[dict], how_many: int, what: str) -> list[dict]:
    """Asks the LLM which candidates most likely hold the answer; returns them best first."""
    prompt = f"""You decide where in a book to look for the answer to a question.
Below are the book's {what} (id | pages | title: summary).
Reply with a JSON list of the ids (the "nNN" at the start of each line, not any number in a title) of the {how_many} {what} most likely to contain the answer, best first, for example ["n4", "n9"].
The summaries only describe the opening of each part, so also judge by the titles and the topics a part would naturally cover.
Always pick the {how_many} best ids even if you are unsure; never reply with an empty list. Reply with the JSON list only.

{what.capitalize()}:
{outline(candidates)}

Question: {question}"""
    reply = invoke_paced(tree.llm, prompt)
    usage = reply.usage_metadata or {}
    USAGE["tokens"] += usage.get("total_tokens", 0)
    USAGE["calls"] += 1
    by_id = {n["id"]: n for n in candidates}
    return [by_id[i] for i in parse_ids(reply.content, set(by_id))][:how_many]


def select_nodes(question: str, max_page: int | None = None) -> list[dict]:
    """Two-step tree descent: pick chapters from the top level, then sections inside them.

    max_page (Spoiler Shield): nodes that start after it are pruned before the LLM sees them."""
    nodes = get_tree()
    if max_page is not None:
        nodes = [n for n in nodes if n["start"] <= max_page]
    chapters = choose(question, [n for n in nodes if n["level"] == 1], MAX_CHAPTERS, "chapters")
    if not chapters:
        return []
    sections = [
        n for n in nodes
        if n["level"] == 2 and any(c["start"] <= n["start"] and n["end"] <= c["end"] for c in chapters)
    ]
    if not sections:  # chapters without sections (e.g. the Epilogue): use the chapters themselves
        return chapters[:MAX_SECTIONS]
    return choose(question, sections, MAX_SECTIONS, "sections")


def node_text(node: dict, max_page: int | None = None) -> str:
    global _doc
    if _doc is None:
        _doc = pymupdf.open(tree.BOOK)
    text = ""
    for page in range(node["start"] - 1, node["end"] if max_page is None else min(node["end"], max_page)):
        text += _doc[page].get_text("text")
        if len(text) >= TREE_TEXT_CHARS:
            break
    return text[:TREE_TEXT_CHARS]


def retrieve_tree(question: str, k: int = 3, max_page: int | None = None) -> list[dict]:
    """The start of each picked section. Cannot tell where inside a section the answer is.
    With max_page, a section that runs past it is cut off there."""
    return [
        {
            "text": node_text(n, max_page),
            "metadata": {
                "book_id": "book1", "page": n["start"], "start": n["start"],
                "end": n["end"] if max_page is None else min(n["end"], max_page), "title": n["title"],
            },
        }
        for n in select_nodes(question, max_page)[:k]
    ]


def retrieve_hybrid(question: str, k: int = 3, max_page: int | None = None) -> list[dict]:
    """Tree narrows the pages, vector search finds the passages inside them."""
    picked = select_nodes(question, max_page)
    if picked:
        ranges = [(n["start"], n["end"] if max_page is None else min(n["end"], max_page)) for n in picked]
        found = ask.retrieve(question, mode="vector", where=page_filter(ranges), k=k)
        if found:
            return found
    return ask.retrieve(question, mode="vector", k=k, max_page=max_page)  # tree found nothing: plain vector search
