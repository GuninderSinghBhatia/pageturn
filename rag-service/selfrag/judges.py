"""The judge: a small, cheap LLM that answers each Self-RAG check as JSON.

It has its own model (RAG_JUDGE_MODEL, default gpt-oss-20b) and its own token budget, because
Groq's free-tier limits are per model: judges and answers don't slow each other down.
"""
import json
import os
import re

from dotenv import load_dotenv
from langchain_groq import ChatGroq

from tree import TokenBudget, invoke_paced

load_dotenv()

JUDGE_MODEL = os.getenv("RAG_JUDGE_MODEL", "openai/gpt-oss-20b")
judge_llm = ChatGroq(
    model=JUDGE_MODEL,
    api_key=os.getenv("GROQ_API_KEY"),
    reasoning_effort="low",
    temperature=0,
)
JUDGE_BUDGET = TokenBudget()

# Tokens and calls spent since the last reset (evals read and reset these per question).
USAGE = {"judge_tokens": 0, "judge_calls": 0, "answer_tokens": 0, "answer_calls": 0}


def reset_usage() -> None:
    for key in USAGE:
        USAGE[key] = 0


def tokens_of(reply) -> int:
    return (getattr(reply, "usage_metadata", None) or {}).get("total_tokens", 0)


def parse_json(text: str) -> dict:
    """The first {...} object in the reply. Models sometimes wrap JSON in prose or ``` fences."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"no JSON object in judge reply: {text[:200]!r}")
    return json.loads(match.group(0))


def ask_json(prompt: str) -> dict:
    """Runs one check. Raises ValueError when the reply isn't JSON (callers pick a safe default)."""
    reply = invoke_paced(judge_llm, prompt, JUDGE_BUDGET)
    USAGE["judge_tokens"] += tokens_of(reply)
    USAGE["judge_calls"] += 1
    return parse_json(reply.content)


def ask_text(prompt: str) -> str:
    """A free-text reply from the judge model (used for chat replies, which need no book)."""
    reply = invoke_paced(judge_llm, prompt, JUDGE_BUDGET)
    USAGE["judge_tokens"] += tokens_of(reply)
    USAGE["judge_calls"] += 1
    return reply.content.strip()
