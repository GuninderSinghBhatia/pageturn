import ask


def chunk(page, text="x"):
    return {"text": text, "metadata": {"page": page}}


def test_spread_keeps_everything_when_there_are_few_items():
    assert ask.spread([1, 2, 3], 8) == [1, 2, 3]


def test_spread_picks_evenly_and_keeps_first_and_last():
    picked = ask.spread(list(range(100)), 5)
    assert picked == [0, 25, 50, 74, 99]


def test_who_is_never_sends_text_past_the_reader(monkeypatch):
    sent = []
    monkeypatch.setattr(ask, "find_mentions", lambda name, max_page: [chunk(p) for p in (5, 90, 150) if p <= max_page])
    monkeypatch.setattr(ask, "retrieve", lambda q, **kw: [chunk(40, "related")])
    monkeypatch.setattr(ask, "build_who_prompt", lambda name, context: sent.extend(context) or "prompt")

    class Reply:
        content = "answer"

    monkeypatch.setattr(ask, "invoke_paced", lambda llm, prompt: Reply())
    out = ask.who_is("Alice", 100)
    assert out["context_pages"] == [5, 40, 90]


def test_who_is_for_a_name_that_only_appears_later(monkeypatch):
    monkeypatch.setattr(ask, "find_mentions", lambda name, max_page: [chunk(500)] if max_page > 100 else [])
    assert ask.who_is("Alice", 100) == {"answer": "You haven't got to Alice yet.", "context_pages": []}


def test_who_is_for_a_name_that_is_not_in_the_book(monkeypatch):
    monkeypatch.setattr(ask, "find_mentions", lambda name, max_page: [])
    assert ask.who_is("Alice", 100)["answer"] == "I can't find Alice in this book."
