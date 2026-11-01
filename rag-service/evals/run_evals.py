"""Scores a retriever against evals/questions.json.

Run from rag-service/:   python -m evals.run_evals <vector|tree|hybrid> [label]

hit rate   the expected page is inside one of the 3 returned passages' page ranges. For vector and
           hybrid a passage is one page; for tree it is a whole section, so tree gets an easier
           test (see avg pages covered, which shows how wide the answer it returns is).
Results are appended to evals/results.csv.
"""
import csv
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

mode = sys.argv[1] if len(sys.argv) > 1 else "vector"
label = sys.argv[2] if len(sys.argv) > 2 else ""
os.environ["RAG_RETRIEVER"] = mode  # ask_question reads this when it retrieves

import retrievers  # noqa: E402
import tree  # noqa: E402
from ask import ask_question, retrieve  # noqa: E402

EVALS = Path(__file__).parent
data = json.load(open(EVALS / "questions.json", encoding='utf-8'))
questions = data["questions"]


def page_range(item: dict) -> tuple[int, int]:
    md = item["metadata"]
    return md.get("start", md["page"]), md.get("end", md["page"])


hits = 0        # expected page is inside a returned range
near = 0        # ... or within 1 page of one
answerable = 0
covered = []    # pages covered by the 3 returned passages, per question
latencies = []  # seconds spent retrieving
tokens = []     # LLM tokens spent retrieving (0 for plain vector search)

for question in questions:
    if question["answerable"]:
        retrievers.USAGE["tokens"] = 0
        tree.BUDGET.slept = 0.0
        started = time.perf_counter()
        result = retrieve(question['question'], mode=mode)
        # Time the retriever really worked, without the pauses that keep us under the API's rate limit.
        latencies.append(time.perf_counter() - started - tree.BUDGET.slept)
        tokens.append(retrievers.USAGE["tokens"])

        ranges = [page_range(item) for item in result]
        expected = question['page']
        answerable += 1
        hit = any(start <= expected <= end for start, end in ranges)
        close = any(start - 1 <= expected <= end + 1 for start, end in ranges)
        hits += hit
        near += close
        covered.append(sum(end - start + 1 for start, end in ranges))
        shown = [f"{s}" if s == e else f"{s}-{e}" for s, e in ranges]
        print(question['id'], expected, shown, "HIT" if hit else ("near" if close else "MISS"), flush=True)

# Questions the book can't answer: the right behaviour is "I don't know".
unanswerable = [q for q in questions if not q["answerable"]]
refused = 0
for question in unanswerable:
    answer = ask_question(question['question'])['answer']
    said_unknown = "don't know" in answer.lower().replace("’", "'")
    refused += said_unknown
    print(question['id'], "refused" if said_unknown else f"ANSWERED: {answer[:80]}", flush=True)

avg = lambda xs: sum(xs) / len(xs)
print()
print(f"mode:                {mode}")
print(f"hit rate:            {hits}/{answerable} = {hits / answerable:.0%}")
print(f"within 1 page:       {near}/{answerable} = {near / answerable:.0%}")
print(f"refused off-topic:   {refused}/{len(unanswerable)}")
print(f"avg pages covered:   {avg(covered):.0f}")
print(f"avg retrieval time:  {avg(latencies):.2f} s")
print(f"avg retrieval tokens:{avg(tokens):.0f}")

HEADER = ["time", "label", "mode", "hit_rate", "within_1_page", "refused_offtopic",
          "avg_pages_covered", "avg_retrieval_s", "avg_retrieval_tokens"]
results = EVALS / "results.csv"
new_file = not results.exists()
with open(results, "a", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    if new_file:
        writer.writerow(HEADER)
    writer.writerow([datetime.now().isoformat(timespec="seconds"), label, mode,
                     f"{hits / answerable:.3f}", f"{near / answerable:.3f}",
                     f"{refused}/{len(unanswerable)}", f"{avg(covered):.1f}",
                     f"{avg(latencies):.2f}", f"{avg(tokens):.0f}"])
