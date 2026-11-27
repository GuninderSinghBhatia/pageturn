"""Plain mode vs Self-RAG, end to end (S7).

Run from rag-service/:   python -m evals.run_selfrag_evals [plain|self|both] [label]

Per mode, over questions.json + selfrag_questions.json:
  hit@3          answerable: the expected page is among the cited pages
  answered       answerable: the reply is not "I don't know"
  faithful       answerable + answered: share of answers with no unsupported claim, judged by a
                 DIFFERENT model from the Self-RAG judge (RAG_EVAL_JUDGE), so it can't grade its own work
  off-topic ok   refused, or cited no pages
  chat ok        cited no pages (no book search shown for "thanks!")
  spoiler leaks  cited pages past current_page (must be 0)
  seconds        per question, without the pauses that keep us under Groq's rate limit
  tokens         per question, answer model + judge model
Appends one row per mode to evals/selfrag_results.csv.
"""
import csv
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from langchain_groq import ChatGroq

import ask
import tree
from selfrag import checks, judges
from selfrag.graph import ask_self

EVALS = Path(__file__).parent
which = sys.argv[1] if len(sys.argv) > 1 else "both"
label = sys.argv[2] if len(sys.argv) > 2 else ""
modes = ["plain", "self"] if which == "both" else [which]

base = json.load(open(EVALS / "questions.json", encoding="utf-8"))["questions"]
extra = json.load(open(EVALS / "selfrag_questions.json", encoding="utf-8"))
by_id = {q["id"]: q for q in base}
READER_AT_END = 10**6  # reader has finished the book: Spoiler Shield on, nothing filtered

# Count plain mode's answer tokens too (ask.py calls invoke_paced without counting).
_paced = ask.invoke_paced


def counted(model, prompt, budget=None):
    reply = _paced(model, prompt, budget)
    judges.USAGE["answer_tokens"] += judges.tokens_of(reply)
    judges.USAGE["answer_calls"] += 1
    return reply


ask.invoke_paced = counted

# The eval judge: another model family, with its own Groq bucket and its own pacing.
# Qwen, because the Self-RAG checks use gpt-oss; its thinking is hidden so the reply is just JSON.
eval_llm = ChatGroq(model=os.getenv("RAG_EVAL_JUDGE", "qwen/qwen3.8-27b"),
                    api_key=os.getenv("GROQ_API_KEY"), temperature=0, reasoning_format="hidden")
EVAL_BUDGET = tree.TokenBudget(per_minute=5000)


def faithful(answer: str, pages_text: list[dict]) -> bool:
    prompt = checks.GROUND_PROMPT.format(chunks=checks.number_chunks(pages_text), answer=answer)
    try:
        reply = judges.parse_json(tree.invoke_paced(eval_llm, prompt, EVAL_BUDGET).content)
    except ValueError:
        return True
    return not reply.get("unsupported")


def context_for(question: str, pages: list[int], current_page: int) -> list[dict]:
    """The chunks behind the cited pages (re-searched, since replies carry pages, not text)."""
    found = ask.retrieve(question, mode="vector", k=8, max_page=current_page)
    return [c for c in found if c["metadata"]["page"] in pages] or found[:3]


def said_unknown(answer: str) -> bool:
    return "don't know" in answer.lower().replace("’", "'")


def run(mode: str, question: str, current_page: int) -> tuple[dict, float, int]:
    judges.reset_usage()
    tree.BUDGET.slept = judges.JUDGE_BUDGET.slept = 0.0
    started = time.perf_counter()
    if mode == "self":
        reply = ask_self(question, current_page)
    else:
        reply = ask.ask_question(question, current_page)
    secs = time.perf_counter() - started - tree.BUDGET.slept - judges.JUDGE_BUDGET.slept
    return reply, secs, judges.USAGE["answer_tokens"] + judges.USAGE["judge_tokens"]


def evaluate(mode: str) -> list:
    s = {"hit": 0, "answered": 0, "faithful": 0, "faith_n": 0, "off_ok": 0, "chat_ok": 0, "leaks": 0}
    secs, toks = [], []
    answerable = [q for q in base if q["answerable"]]
    off_topic = [q["question"] for q in base if not q["answerable"]] + extra["off_topic"]

    for q in answerable:
        reply, t, n = run(mode, q["question"], READER_AT_END)
        secs.append(t); toks.append(n)
        pages = reply["context_pages"]
        hit = q["page"] in pages
        s["hit"] += hit
        line = f"{mode} q{q['id']:>2} p{q['page']:<4} {'HIT ' if hit else 'miss'} pages={pages}"
        if not said_unknown(reply["answer"]):
            s["answered"] += 1
            ok = faithful(reply["answer"], context_for(q["question"], pages, READER_AT_END))
            s["faithful"] += ok; s["faith_n"] += 1
            line += " faithful" if ok else " UNSUPPORTED"
        else:
            line += " (I don't know)"
        print(line, f"{t:.1f}s {n}tok", reply.get("checks", ""), flush=True)

    for question in off_topic:
        reply, t, n = run(mode, question, READER_AT_END)
        secs.append(t); toks.append(n)
        ok = said_unknown(reply["answer"]) or not reply["context_pages"]
        s["off_ok"] += ok
        print(f"{mode} off-topic {'ok ' if ok else 'BAD'} {question[:50]!r} -> {reply['answer'][:70]!r}", flush=True)

    for question in extra["chat"]:
        reply, t, n = run(mode, question, READER_AT_END)
        secs.append(t); toks.append(n)
        ok = not reply["context_pages"]
        s["chat_ok"] += ok
        print(f"{mode} chat {'ok ' if ok else 'BAD'} {question!r} -> {reply['answer'][:70]!r}", flush=True)

    for case in extra["spoiler"]:
        q = by_id[case["id"]]
        reply, t, n = run(mode, q["question"], case["current_page"])
        leaked = [p for p in reply["context_pages"] if p > case["current_page"]]
        s["leaks"] += bool(leaked)
        print(f"{mode} spoiler q{q['id']} at p{case['current_page']} {'LEAK ' + str(leaked) if leaked else 'safe'}"
              f" -> {reply['answer'][:60]!r}", flush=True)

    avg = lambda xs: sum(xs) / len(xs)
    row = [datetime.now().isoformat(timespec="seconds"), label, mode,
           os.getenv("RAG_GRADER", "rerank") if mode == "self" else "",
           f"{s['hit']}/{len(answerable)}", f"{s['answered']}/{len(answerable)}",
           f"{s['faithful']}/{s['faith_n']}", f"{s['off_ok']}/{len(off_topic)}",
           f"{s['chat_ok']}/{len(extra['chat'])}", s["leaks"], f"{avg(secs):.2f}", f"{avg(toks):.0f}"]
    print("\n" + " | ".join(map(str, row)) + "\n", flush=True)
    return row


HEADER = ["time", "label", "mode", "grader", "hit_at_3", "answered", "faithful", "off_topic_ok",
          "chat_ok", "spoiler_leaks", "avg_s", "avg_tokens"]
results = EVALS / "selfrag_results.csv"
for mode in modes:
    row = evaluate(mode)
    new_file = not results.exists()
    with open(results, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(HEADER)
        w.writerow(row)
