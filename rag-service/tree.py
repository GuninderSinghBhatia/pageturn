import json
import os
import time
from pathlib import Path

import pymupdf
from dotenv import load_dotenv
from langchain_groq import ChatGroq

load_dotenv()

HERE = Path(__file__).parent
BOOK = HERE / "docs" / "_OceanofPDF.com_AI_Engineering_Building_Applications_-_Chip_Huyen.pdf"
TREE_FILE = HERE / "data" / "tree.json"

# Low reasoning effort: ~6 hidden tokens instead of ~160 per call (Groq's free tier allows 8,000
# tokens a minute and 200,000 a day per model). RAG_TREE_MODEL picks the model that writes
# summaries and navigates the tree.
llm = ChatGroq(
    model=os.getenv("RAG_TREE_MODEL", "openai/gpt-oss-120b"),
    api_key=os.getenv("GROQ_API_KEY"),
    reasoning_effort="low",
)


class TokenBudget:
    """Keeps LLM usage under the provider's tokens-per-minute limit by sleeping when needed."""

    def __init__(self, per_minute: int = 6500) -> None:
        self.per_minute = per_minute
        self.spent: list[tuple[float, int]] = []  # (time, tokens)
        self.slept = 0.0  # seconds spent waiting for the limit (evals subtract it from latency)

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)
        self.slept += seconds

    def wait_for(self, tokens: int) -> None:
        while True:
            now = time.monotonic()
            self.spent = [(t, n) for t, n in self.spent if now - t < 60]
            if sum(n for _, n in self.spent) + tokens <= self.per_minute or not self.spent:
                return
            self.sleep(max(0.5, 60 - (now - self.spent[0][0])))

    def record(self, tokens: int) -> None:
        self.spent.append((time.monotonic(), tokens))


BUDGET = TokenBudget()  # shared by every LLM call in the service, so they pace each other


def invoke_paced(model, prompt: str, budget: TokenBudget | None = None, retries: int = 5):
    """llm.invoke that respects the token budget and retries on rate-limit errors."""
    budget = budget or BUDGET
    estimate = len(prompt) // 3 + 300
    for attempt in range(retries):
        budget.wait_for(estimate)
        try:
            reply = model.invoke(prompt)
        except Exception:
            if attempt == retries - 1:
                raise
            budget.sleep(15 * (attempt + 1))
            continue
        budget.record((reply.usage_metadata or {}).get("total_tokens", estimate))
        return reply


def build_nodes(pdf_path: str) -> list[dict]:
    """One node per table-of-contents entry, with its 1-based page range.

    A node ends one page before the next entry at the same or a higher level, so a chapter
    covers all of its sections. The last node runs to the end of the PDF.
    """
    doc = pymupdf.open(pdf_path)
    toc = doc.get_toc()  # [level, title, start_page]
    last = doc.page_count

    nodes = []
    for i, (level, title, start) in enumerate(toc):
        if not 1 <= start <= last:
            continue
        end = last
        for next_level, _, next_start in toc[i + 1:]:
            if next_level <= level:
                end = max(start, next_start - 1)
                break
        nodes.append({"level": level, "title": title, "start": start, "end": end})
    return nodes


def child_titles(nodes: list[dict], i: int) -> list[str]:
    """Titles of the direct children of nodes[i] (the next level down, inside its page range)."""
    parent = nodes[i]
    titles = []
    for node in nodes[i + 1:]:
        if node["level"] <= parent["level"]:
            break
        if node["level"] == parent["level"] + 1:
            titles.append(node["title"])
    return titles


def section_text(doc, node) -> str:
    text = ""
    for page_num in range(node["start"] - 1, node["end"]):
        page = doc[page_num]
        text += page.get_text("text")
        if len(text) >= 2000:
            break
    return text[0:2000]


def summary_prompt(doc, node, children: list[str]) -> str:
    parts = f"\nSub-sections: {'; '.join(children)}" if children else ""
    return f"""Summarize the section below in 1-2 short sentences.

Rules:
1. Name the specific concepts, methods and techniques the section covers, so that someone can tell from your summary which questions it answers.
2. Use only the text and sub-section titles given. Do not add anything from memory.
3. Do not start with "This section" and do not repeat the section title or its words as an opening.

Section title: {node["title"]}{parts}

Text:
{section_text(doc, node)}
"""


def summarize_node(doc, node, children: list[str] | None = None, budget: TokenBudget | None = None) -> str:
    return invoke_paced(llm, summary_prompt(doc, node, children or []), budget or TokenBudget()).content


def build_tree(out_file: Path = TREE_FILE) -> list[dict]:
    """Summarizes every node once and saves the tree. Safe to re-run: finished nodes are kept."""
    doc = pymupdf.open(BOOK)
    nodes = build_nodes(str(BOOK))
    done = {}
    if out_file.exists():
        done = {n["id"]: n for n in json.loads(out_file.read_text(encoding="utf-8"))}
    out_file.parent.mkdir(parents=True, exist_ok=True)

    budget = TokenBudget()
    tree = []
    for i, node in enumerate(nodes):
        node = {"id": i, **node}
        if i in done and done[i].get("summary"):
            node["summary"] = done[i]["summary"]
        else:
            node["summary"] = summarize_node(doc, node, child_titles(nodes, i), budget).strip()
        tree.append(node)
        out_file.write_text(json.dumps(tree, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{i + 1}/{len(nodes)} {node['title'][:50]}", flush=True)
    return tree


def load_tree() -> list[dict]:
    return json.loads(TREE_FILE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    build_tree()
