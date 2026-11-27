"""Self-RAG flow and checks, with the LLM and the search replaced by fakes (no network)."""
from types import SimpleNamespace

import pytest

from selfrag import checks, graph, judges


def chunk(page, text="text"):
    return {"text": text, "metadata": {"page": page}}


class Fake:
    """Records calls and plays scripted check results."""

    def __init__(self, monkeypatch, *, route="book", grades=None, unsupported=None, ahead_page=1,
                 answer="Answer (page 5)."):
        self.searches = []   # (query, max_page) per search
        self.answers = []    # prompts sent to the answer model
        self.grades = list(grades or [[chunk(5)]])
        self.unsupported = list(unsupported or [[]])

        def retrieve(q, mode=None, k=3, max_page=None, book_id=None, where=None):
            if k == 1:  # the Spoiler Shield's single best match
                return [chunk(ahead_page)]
            self.searches.append((q, max_page))
            return [chunk(p) for p in range(1, k + 1)]

        def answer_llm(model, prompt, budget=None):
            self.answers.append(prompt)
            return SimpleNamespace(content=answer, usage_metadata={"total_tokens": 10})

        monkeypatch.setattr(graph.ask, "retrieve", retrieve)
        monkeypatch.setattr(graph, "invoke_paced", answer_llm)
        monkeypatch.setattr(checks, "route", lambda q: route)
        monkeypatch.setattr(checks, "chat_reply", lambda q: "Happy to help!")
        monkeypatch.setattr(checks, "grade", lambda q, c: self.grades.pop(0) if self.grades else [])
        monkeypatch.setattr(checks, "rewrite", lambda q: "rewritten " + q)
        monkeypatch.setattr(checks, "unsupported_claims",
                            lambda a, c: self.unsupported.pop(0) if self.unsupported else [])


# ---------------------------------------------------------------- the flow

def test_chat_messages_skip_the_search(monkeypatch):
    f = Fake(monkeypatch, route="chat")
    r = graph.ask_self("thanks!", current_page=10)
    assert r["answer"] == "Happy to help!"
    assert f.searches == [] and r["context_pages"] == []
    assert r["checks"]["route"] == "chat"


def test_good_chunks_give_a_grounded_answer_in_one_pass(monkeypatch):
    f = Fake(monkeypatch, grades=[[chunk(5), chunk(7)]])
    r = graph.ask_self("What is LoRA?", current_page=100)
    assert r["answer"] == "Answer (page 5)."
    assert r["context_pages"] == [5, 7]
    assert len(f.searches) == 1 and len(f.answers) == 1
    assert r["checks"] == {"route": "book", "query": "What is LoRA?", "retried": False, "kept": 2,
                           "rewritten_answer": False, "grounded": True}


def test_no_good_chunks_rewrites_the_query_once_then_answers(monkeypatch):
    f = Fake(monkeypatch, grades=[[], [chunk(9)]])
    r = graph.ask_self("What is LoRA?", current_page=100)
    assert [q for q, _ in f.searches] == ["What is LoRA?", "rewritten What is LoRA?"]
    assert r["context_pages"] == [9] and r["checks"]["retried"]


def test_still_nothing_after_the_rewrite_refuses_without_looping(monkeypatch):
    f = Fake(monkeypatch, grades=[[], [], [chunk(1)]])
    r = graph.ask_self("Capital of Australia?", current_page=100)
    assert len(f.searches) == 2  # one search, one retry, no more
    assert r["answer"] == graph.REFUSAL and "don't know" in r["answer"]
    assert f.answers == [] and r["context_pages"] == []


def test_unsupported_claims_get_one_new_answer_that_names_them(monkeypatch):
    f = Fake(monkeypatch, unsupported=[["LoRA was invented in 1990"], ["still wrong"]])
    r = graph.ask_self("What is LoRA?", current_page=100)
    assert len(f.answers) == 2  # never a third
    assert "LoRA was invented in 1990" in f.answers[1]
    assert r["checks"]["rewritten_answer"] and not r["checks"]["grounded"]


def test_keeps_at_most_three_chunks(monkeypatch):
    Fake(monkeypatch, grades=[[chunk(p) for p in range(1, 7)]])
    assert graph.ask_self("q", current_page=100)["context_pages"] == [1, 2, 3]


# ---------------------------------------------------------------- Spoiler Shield (S5)

def test_best_match_past_the_reader_is_refused_before_any_search(monkeypatch):
    f = Fake(monkeypatch, ahead_page=500)
    r = graph.ask_self("What happens at the end?", current_page=100)
    assert r["answer"] == graph.NOT_YET and f.searches == []


def test_every_search_including_the_rewrite_stops_at_the_reader(monkeypatch):
    f = Fake(monkeypatch, grades=[[], [chunk(9)]])
    graph.ask_self("What is LoRA?", current_page=42)
    assert [page for _, page in f.searches] == [42, 42]


def test_without_a_page_nothing_is_filtered(monkeypatch):
    f = Fake(monkeypatch)
    graph.ask_self("What is LoRA?")
    assert f.searches == [("What is LoRA?", None)]


# ---------------------------------------------------------------- the checks' safe defaults

def judge_replies(monkeypatch, reply):
    def fake(prompt):
        if isinstance(reply, Exception):
            raise reply
        return reply
    monkeypatch.setattr(judges, "ask_json", fake)


def test_route_falls_back_to_searching(monkeypatch):
    judge_replies(monkeypatch, ValueError("not json"))
    assert checks.route("hi") == "book"
    judge_replies(monkeypatch, {"route": "something else"})
    assert checks.route("hi") == "book"
    judge_replies(monkeypatch, {"route": "chat"})
    assert checks.route("hi") == "chat"


def test_llm_grade_keeps_the_picked_chunks_in_search_order(monkeypatch):
    judge_replies(monkeypatch, {"relevant": [3, 1]})
    assert [c["metadata"]["page"] for c in checks.grade_llm("q", [chunk(10), chunk(20), chunk(30)])] == [10, 30]


def test_llm_grade_keeps_everything_when_the_judge_is_unreadable(monkeypatch):
    judge_replies(monkeypatch, ValueError("not json"))
    assert len(checks.grade_llm("q", [chunk(1), chunk(2)])) == 2


def test_rerank_grade_sorts_by_score_and_drops_low_ones(monkeypatch):
    monkeypatch.setattr(checks, "_reranker", SimpleNamespace(predict=lambda pairs: [-2.0, 5.0, 1.0]))
    kept = checks.grade_rerank("q", [chunk(1), chunk(2), chunk(3)])
    assert [c["metadata"]["page"] for c in kept] == [2, 3]


def test_rewrite_keeps_the_question_when_the_reply_is_bad(monkeypatch):
    judge_replies(monkeypatch, {"query": ""})
    assert checks.rewrite("What is LoRA?") == "What is LoRA?"
    judge_replies(monkeypatch, {"query": "low-rank adaptation finetuning"})
    assert checks.rewrite("What is LoRA?") == "low-rank adaptation finetuning"


def test_ground_trusts_the_answer_when_the_judge_is_unreadable(monkeypatch):
    judge_replies(monkeypatch, ValueError("not json"))
    assert checks.unsupported_claims("answer", [chunk(1)]) == []


@pytest.mark.parametrize("text,expected", [
    ('{"route": "chat"}', {"route": "chat"}),
    ('```json\n{"relevant": [1, 2]}\n```', {"relevant": [1, 2]}),
    ('Sure! {"query": "lora"} hope that helps', {"query": "lora"}),
])
def test_parse_json_finds_the_object(text, expected):
    assert judges.parse_json(text) == expected


def test_parse_json_rejects_prose():
    with pytest.raises(ValueError):
        judges.parse_json("I think chunk 2 is relevant")
