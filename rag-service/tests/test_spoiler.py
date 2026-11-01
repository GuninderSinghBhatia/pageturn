import retrievers
from ask import is_ahead

NODES = [
    {"id": 1, "level": 1, "start": 1, "end": 100, "title": "Early", "summary": ""},
    {"id": 2, "level": 1, "start": 101, "end": 300, "title": "Middle", "summary": ""},
    {"id": 3, "level": 1, "start": 301, "end": 500, "title": "Late", "summary": ""},
    {"id": 4, "level": 2, "start": 101, "end": 200, "title": "Middle A", "summary": ""},
    {"id": 5, "level": 2, "start": 201, "end": 300, "title": "Middle B", "summary": ""},
]


def results(pages):
    return [{"metadata": {"page": p}} for p in pages]


def test_is_ahead_needs_most_results_past_the_reader():
    assert is_ahead(results([594, 596, 103]), 200)
    assert not is_ahead(results([103, 99, 594]), 200)


def test_a_result_on_the_current_page_is_not_ahead():
    assert not is_ahead(results([200]), 200)


def test_tree_never_shows_the_llm_nodes_past_the_reader(monkeypatch):
    seen = []

    def fake_choose(question, candidates, how_many, what):
        seen.append([n["id"] for n in candidates])
        return candidates[:how_many]

    monkeypatch.setattr(retrievers, "get_tree", lambda: NODES)
    monkeypatch.setattr(retrievers, "choose", fake_choose)
    retrievers.select_nodes("q", max_page=150)
    assert seen == [[1, 2], [4]]  # chapter 3 and section "Middle B" start after page 150


def test_tree_cuts_a_section_that_runs_past_the_reader(monkeypatch):
    monkeypatch.setattr(retrievers, "select_nodes", lambda q, max_page=None: [NODES[3]])
    monkeypatch.setattr(retrievers, "node_text", lambda node, max_page=None: "text")
    [found] = retrievers.retrieve_tree("q", max_page=150)
    assert (found["metadata"]["start"], found["metadata"]["end"]) == (101, 150)
