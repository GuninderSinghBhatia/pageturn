"""Graph RAG: merging, matching, scoring, the retriever switch and the fallbacks. No Neo4j or LLM needed."""

import ask
from graph import build
from graph import retrieve as g
from graph.extract import parse_json_answer


def chunk(page, text="x"):
    return {"text": text, "metadata": {"page": page}}


# ---- G1: one bad edge must not throw the chunk away ----


def test_parse_drops_incomplete_edges_but_keeps_the_rest():
    raw = '{"nodes":[{"name":"LoRA"},{"name":"QLoRA"},{}],"edges":[' \
          '{"source":"QLoRA","relation":"is a version of","target":"LoRA"},{"source":"LoRA","relation":"x"}]}'
    result = parse_json_answer(raw)
    assert [n.name for n in result.nodes] == ["LoRA", "QLoRA"]
    assert len(result.edges) == 1


# ---- G2: one node per real thing ----


def test_node_key_merges_spellings():
    assert build.node_key("Low-Rank Adaptation (LoRA)") == "lora"
    assert build.node_key("LoRA") == "lora"
    assert build.node_key("the weight matrices") == "weight matrix"


def test_merge_keeps_evidence_and_folds_acronyms():
    records = [
        {"id": "book1-1", "page": 10, "nodes": ["RAG"], "edges": []},
        {"id": "book1-2", "page": 12, "nodes": ["retrieval augmented generation", "vector database"],
         "edges": [["retrieval augmented generation", "uses", "vector database"]]},
    ]
    nodes, edges = build.merge(records)
    rag = next(n for n in nodes if n["key"] == "rag")
    assert rag["pages"] == [10, 12] and rag["chunk_ids"] == ["book1-1", "book1-2"]
    assert edges == [{"source": "rag", "relation": "uses", "target": "vector database",
                      "pages": [12], "chunk_ids": ["book1-2"]}]


# ---- G3: question -> start nodes -> scored chunks ----


def test_match_keys_prefers_the_longest_name():
    keys = ["lora", "qlora", "low rank", "low rank adaptation", "data"]
    assert g.match_keys("How are QLoRA and low-rank adaptation related?", keys) == ["low rank adaptation", "qlora"]


def test_edge_between_two_question_nodes_scores_highest():
    start_rows = [{"key": "lora", "chunk_ids": ["c1"]}]
    edges = [
        {"source_key": "qlora", "target_key": "lora", "chunk_ids": ["c2"]},   # both ends asked: 5
        {"source_key": "lora", "target_key": "peft", "chunk_ids": ["c3"]},    # one end asked: 2
        {"source_key": "peft", "target_key": "adapter", "chunk_ids": ["c4"]},  # one step out: 1
    ]
    scores = g.score_evidence(["lora", "qlora"], start_rows, edges)
    assert [c for c, _ in scores.most_common()] == ["c2", "c3", "c1", "c4"]


# ---- G5: the switch, merging and fallbacks ----


def test_retrieve_switch_reaches_the_graph(monkeypatch):
    monkeypatch.setattr(g, "retrieve_graph_or_vector", lambda q, k, max_page: ["graph", max_page])
    monkeypatch.setattr(g, "retrieve_combined", lambda q, k, max_page: ["both", max_page])
    assert ask.retrieve("q", mode="graph", max_page=7) == ["graph", 7]
    assert ask.retrieve("q", mode="vector+graph") == ["both", None]


def test_graph_mode_falls_back_to_vector_when_neo4j_is_down(monkeypatch):
    def down(*a, **kw):
        raise ConnectionError("Neo4j not running")

    monkeypatch.setattr(g, "graph_retrieve", down)
    monkeypatch.setattr(ask, "retrieve", lambda q, **kw: [chunk(5, "vector")])
    assert g.retrieve_graph_or_vector("q") == [chunk(5, "vector")]
    assert g.retrieve_combined("q") == [chunk(5, "vector")]


def test_merge_results_takes_turns_and_skips_repeats():
    vector = [chunk(1, "a"), chunk(2, "b"), chunk(3, "c")]
    graph = [chunk(2, "b"), chunk(9, "z")]
    assert [r["metadata"]["page"] for r in g.merge_results(vector, graph, 3)] == [1, 2, 9]


# ---- G6: related terms obey Spoiler Shield ----


def test_related_terms_hide_pages_past_the_reader(monkeypatch):
    class FakeDb:
        def query(self, *a, **kw):
            return [
                {"name": "QLoRA", "relation": "is a version of", "pages": [661, 662], "direction": "in"},
                {"name": "PEFT", "relation": "is a", "pages": [645], "direction": "out"},
                {"name": "Guanaco", "relation": "finetuned with", "pages": [700], "direction": "in"},
            ]

    monkeypatch.setattr(g.store, "connect", lambda: FakeDb())
    related = g.related_terms("LoRA", max_page=661)
    assert [r["name"] for r in related] == ["PEFT", "QLoRA"]
    assert related[1]["pages"] == [661]


def test_related_terms_empty_when_neo4j_is_down(monkeypatch):
    def down():
        raise ConnectionError

    monkeypatch.setattr(g.store, "connect", down)
    assert g.related_terms("LoRA") == []
