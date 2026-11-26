import json
import os
import re

from langchain_groq import ChatGroq
from pydantic import BaseModel, Field

from ask import collection
from tree import invoke_paced

# Small model on purpose: extraction runs over thousands of chunks later (G2),
# and Groq's free tier is limited. Same setting name tree.py uses.
llm = ChatGroq(
    model=os.getenv("RAG_TREE_MODEL", "openai/gpt-oss-20b"),
    api_key=os.getenv("GROQ_API_KEY"),
    # Pulling names out of 500 characters needs little thinking; "low" cuts the hidden
    # reasoning tokens, which were most of the cost per chunk.
    reasoning_effort=os.getenv("RAG_GRAPH_REASONING", "low"),
)


# ---- Step 3: the strict shape the model must answer in ----


class Node(BaseModel):
    name: str = Field(description="Short name of a named concept, method, technique or tool")


class Edge(BaseModel):
    source: str = Field(description="Name of a node")
    relation: str = Field(description="Short verb phrase, 1 to 4 words")
    target: str = Field(description="Name of a node")


class Extraction(BaseModel):
    nodes: list[Node]
    edges: list[Edge]


EXTRACT_PROMPT = """Read the text below from a book.
Pull out a small knowledge graph.

Nodes: only named concepts, methods, techniques or tools (like "Supervised Finetuning").
Do NOT make nodes from ordinary words (like "data", "internet", "wrong"), from
adjectives, or from vague words like "issues" or "steps".

Edges: each edge links exactly two nodes: source, relation, target.
The relation is 1 to 4 lowercase words with spaces (like "is a version of").
Only write an edge if the text states it. Never turn "is not" into a positive link.
Both source and target must also appear in the node list.
If the text has nothing worth keeping, return empty lists.

Answer with JSON only, in exactly this shape, nothing before or after it:
{{"nodes": [{{"name": "..."}}], "edges": [{{"source": "...", "relation": "...", "target": "..."}}]}}

Text:
{text}
"""

# Step 5: ask for plain JSON text (not "tool call" mode) and parse it ourselves,
# so a slightly messy answer can be repaired instead of thrown away.
json_llm = llm.bind(response_format={"type": "json_object"})


def parse_json_answer(raw: str) -> Extraction:
    """Turn the model's text into an Extraction. Raises ValueError if it cannot."""
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Repair 1: keep only the part from the first "{" to the last "}".
        first, last = raw.find("{"), raw.rfind("}")
        if first == -1 or last <= first:
            raise ValueError("no JSON object found")
        data = json.loads(raw[first : last + 1])
    # Repair 2: one edge with a missing field should not throw away the whole chunk
    # (a retry costs a full LLM call). Keep only complete edges and named nodes.
    if isinstance(data, dict):
        data["edges"] = [e for e in data.get("edges", []) if isinstance(e, dict)
                         and all(isinstance(e.get(f), str) and e[f].strip() for f in ("source", "relation", "target"))]
        data["nodes"] = [n for n in data.get("nodes", []) if isinstance(n, dict)
                         and isinstance(n.get("name"), str) and n["name"].strip()]
    return Extraction.model_validate(data)


def clean(result: Extraction) -> Extraction:
    """Drop edges that point at a node missing from the node list, and repeats."""
    names = {n.name.strip().lower() for n in result.nodes}
    seen, edges = set(), []
    for e in result.edges:
        key = (e.source.strip().lower(), e.relation.strip().lower(), e.target.strip().lower())
        if key[0] in names and key[2] in names and key not in seen:
            seen.add(key)
            edges.append(e)
    result.edges = edges
    return result


class ExtractionFailed(Exception):
    """The model never gave a usable answer (rate limit, broken JSON on every try)."""


def extract(text: str, retries: int = 2) -> Extraction:
    """Ask the model for nodes and edges, as JSON text we parse ourselves.

    A broken answer is repaired if possible, otherwise asked again `retries` times.
    If every try fails this raises ExtractionFailed: an empty list from the model
    means "nothing here", a failure means "we do not know", and callers must tell
    them apart (build.py does not save failures, so they are retried on the next run).
    """
    prompt = EXTRACT_PROMPT.format(text=text)
    last_error = None
    for attempt in range(retries + 1):
        try:
            raw = invoke_paced(json_llm, prompt).content
            return clean(parse_json_answer(raw))
        except Exception as error:
            last_error = error
            print(f"extract attempt {attempt + 1} failed: {str(error)[:200]}")
    raise ExtractionFailed(str(last_error))


def get_chunk(chunk_id: str) -> dict:
    """Fetch one chunk from Chroma by its id, e.g. "book1-500"."""
    found = collection.get(ids=[chunk_id], include=["documents", "metadatas"])
    return {
        "id": found["ids"][0],
        "text": found["documents"][0],
        "page": found["metadatas"][0]["page"],
    }


# Step 4: five chunks from different parts of the book, read every result by hand.
SAMPLE_IDS = ["book1-100", "book1-800", "book1-1500", "book1-2200", "book1-2800"]


if __name__ == "__main__":
    for chunk_id in SAMPLE_IDS:
        chunk = get_chunk(chunk_id)
        print("=" * 70)
        print(chunk["id"], "page", chunk["page"])
        print(chunk["text"])
        result = extract(chunk["text"])
        print("--- nodes ---")
        for node in result.nodes:
            print(" ", node.name)
        print("--- edges ---")
        for edge in result.edges:
            print(f"  {edge.source} -> {edge.relation} -> {edge.target}")
