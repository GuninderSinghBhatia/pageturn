"""Scores the search against evals/questions.json.

Run from rag-service/:   python -m evals.run_evals [label]
The optional label (e.g. "chunk500") is saved with the score in evals/results.csv.
"""
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

from ask import ask_question, retrieve

EVALS = Path(__file__).parent
data = json.load(open(EVALS / "questions.json", encoding = 'utf-8'))
questions = data["questions"]

hits = 0       # expected page is among the 3 retrieved pages
near = 0       # a retrieved page is within 1 page of the expected one (hit or not)
answerable = 0

for question in questions :
    if question["answerable"] == True :

        result = retrieve(question['question'])
        pages = [item['metadata']['page'] for item in result]

        answerable += 1
        hit = question['page'] in pages
        close = any(abs(p - question['page']) <= 1 for p in pages)
        hits += hit
        near += close
        print(question['id'],question['page'],pages, "HIT" if hit else ("near" if close else "MISS"))

# Questions the book can't answer: the right behaviour is "I don't know".
unanswerable = [q for q in questions if not q["answerable"]]
refused = 0
for question in unanswerable :
    answer = ask_question(question['question'])['answer']
    said_unknown = "don't know" in answer.lower().replace("’", "'")
    refused += said_unknown
    print(question['id'], "refused" if said_unknown else f"ANSWERED: {answer[:80]}")

print()
print(f"hit rate @3:        {hits}/{answerable} = {hits / answerable:.0%}")
print(f"within 1 page:      {near}/{answerable} = {near / answerable:.0%}")
print(f"refused off-topic:  {refused}/{len(unanswerable)}")

label = sys.argv[1] if len(sys.argv) > 1 else ""
results = EVALS / "results.csv"
new_file = not results.exists()
with open(results, "a", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    if new_file:
        writer.writerow(["time", "label", "hit_rate_at_3", "within_1_page", "refused_offtopic"])
    writer.writerow([datetime.now().isoformat(timespec="seconds"), label,
                     f"{hits / answerable:.3f}", f"{near / answerable:.3f}",
                     f"{refused}/{len(unanswerable)}"])
