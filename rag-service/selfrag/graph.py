"""Self-RAG as a LangGraph state machine.

    route ──chat──> chat ──> END
      │book
    spoiler ──ahead──> END ("You haven't got there yet.")
      │
    search ──> grade ──none kept, no retry yet──> rewrite ──> search
                 │ none kept after the retry ──> refuse ──> END ("I don't know ...")
                 │kept
              answer ──> ground ──unsupported claims, first time──> answer (told what to leave out)
                           │ grounded, or already rewritten once ──> END

Every loop runs at most once (MAX_RETRIES, MAX_REWRITES). Every search passes max_page, so a
rewritten query can't reach past the reader either.
"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

import ask
from selfrag import checks, judges
from tree import invoke_paced

CANDIDATES = 8   # chunks searched before grading; grading keeps the good ones
KEEP = 3         # chunks given to the answer step (same as plain mode)
MAX_RETRIES = 1  # rewrites of the search query
MAX_REWRITES = 1 # new answers after the ground check finds unsupported claims

REFUSAL = "I don't know. I couldn't find this in the book."
NOT_YET = "You haven't got there yet."


class State(TypedDict, total=False):
    question: str
    current_page: int | None
    book_id: str
    route: str
    query: str              # what was searched (the question, or its rewrite)
    retries: int
    candidates: list[dict]
    kept: list[dict]
    answer: str
    unsupported: list[str]  # from the last ground check
    rewrites: int
    done: bool              # a final answer was set before the answer step (chat, spoiler, refusal)


# ---------------------------------------------------------------- nodes

def route_node(s: State) -> State:
    return {"route": checks.route(s["question"]), "query": s["question"], "retries": 0, "rewrites": 0}


def chat_node(s: State) -> State:
    return {"answer": checks.chat_reply(s["question"]), "kept": [], "done": True}


def spoiler_node(s: State) -> State:
    page = s.get("current_page")
    if page is not None and ask.is_ahead(
        ask.retrieve(s["question"], mode="vector", k=1, book_id=s["book_id"]), page
    ):
        return {"answer": NOT_YET, "kept": [], "done": True}
    return {}


def search_node(s: State) -> State:
    found = ask.retrieve(
        s["query"], mode="vector", k=CANDIDATES, max_page=s.get("current_page"), book_id=s["book_id"]
    )
    return {"candidates": found}


def grade_node(s: State) -> State:
    return {"kept": checks.grade(s["question"], s["candidates"], query=s["query"])[:KEEP]}


def rewrite_node(s: State) -> State:
    return {"query": checks.rewrite(s["question"]), "retries": s["retries"] + 1}


def refuse_node(s: State) -> State:
    return {"answer": REFUSAL, "kept": [], "done": True}


def answer_prompt(question: str, kept: list[dict], avoid: list[str]) -> str:
    prompt = ask.build_prompt(question, kept)
    if avoid:
        # Second try after the ground check: name the claims the excerpts don't back.
        listed = "\n".join(f"- {c}" for c in avoid)
        prompt += f"\nYour previous answer said these things, which the context does not support. Leave them out:\n{listed}\n"
    return prompt


def answer_node(s: State) -> State:
    avoid = s.get("unsupported") or []
    reply = invoke_paced(ask.llm, answer_prompt(s["question"], s["kept"], avoid))
    judges.USAGE["answer_tokens"] += judges.tokens_of(reply)
    judges.USAGE["answer_calls"] += 1
    return {"answer": reply.content, "rewrites": s["rewrites"] + (1 if avoid else 0)}


def ground_node(s: State) -> State:
    return {"unsupported": checks.unsupported_claims(s["answer"], s["kept"])}


# ---------------------------------------------------------------- edges

def after_route(s: State) -> str:
    return "chat" if s["route"] == "chat" else "spoiler"


def after_spoiler(s: State) -> str:
    return END if s.get("done") else "search"


def after_grade(s: State) -> str:
    if s["kept"]:
        return "answer"
    return "rewrite" if s["retries"] < MAX_RETRIES else "refuse"


def after_ground(s: State) -> str:
    return "answer" if s["unsupported"] and s["rewrites"] < MAX_REWRITES else END


def build():
    g = StateGraph(State)
    for name, fn in [("route", route_node), ("chat", chat_node), ("spoiler", spoiler_node),
                     ("search", search_node), ("grade", grade_node), ("rewrite", rewrite_node),
                     ("refuse", refuse_node), ("answer", answer_node), ("ground", ground_node)]:
        g.add_node(name, fn)
    g.add_edge(START, "route")
    g.add_conditional_edges("route", after_route, ["chat", "spoiler"])
    g.add_edge("chat", END)
    g.add_conditional_edges("spoiler", after_spoiler, ["search", END])
    g.add_edge("search", "grade")
    g.add_conditional_edges("grade", after_grade, ["answer", "rewrite", "refuse"])
    g.add_edge("rewrite", "search")
    g.add_edge("refuse", END)
    g.add_edge("answer", "ground")
    g.add_conditional_edges("ground", after_ground, ["answer", END])
    return g.compile()


GRAPH = build()


def ask_self(question: str, current_page: int | None = None, book_id: str = ask.DEFAULT_BOOK) -> dict:
    """Same reply shape as ask.ask_question, plus `checks` (what each check decided)."""
    s = GRAPH.invoke({"question": question, "current_page": current_page, "book_id": book_id})
    kept = s.get("kept") or []
    return {
        "answer": s["answer"],
        "context_pages": [c["metadata"]["page"] for c in kept],
        "checks": {
            "route": s.get("route"),
            "query": s.get("query"),
            "retried": s.get("retries", 0) > 0,
            "kept": len(kept),
            "rewritten_answer": s.get("rewrites", 0) > 0,
            "grounded": not s.get("unsupported"),
        },
    }
