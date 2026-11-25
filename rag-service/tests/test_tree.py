import pytest

import tree
from retrievers import page_filter, parse_ids

needs_book = pytest.mark.skipif(not tree.BOOK.exists(), reason="book PDF not in rag-service/docs")


def test_parse_ids_reads_the_first_json_list():
    assert parse_ids('["n3", "n7"]', {3, 7, 9}) == [3, 7]
    assert parse_ids('Sure! The best are ["n9", "n3"].', {3, 7, 9}) == [9, 3]


def test_parse_ids_ignores_bare_numbers_which_may_mean_chapter_numbers():
    assert parse_ids("[2, 3]", {2, 3}) == []
    assert parse_ids('["n2", 3]', {2, 3}) == [2]


def test_parse_ids_drops_unknown_and_duplicate_ids():
    assert parse_ids('["n3", "n3", "n99", "x", "n7"]', {3, 7}) == [3, 7]


def test_parse_ids_survives_garbage():
    assert parse_ids("I think chapter 3", {3}) == []
    assert parse_ids('["n3", ', {3}) == []
    assert parse_ids("[]", {3}) == []


def test_page_filter_single_range_and_several_ranges():
    one = page_filter([(10, 20)])
    assert one == {"$and": [{"page": {"$gte": 10}}, {"page": {"$lte": 20}}]}
    two = page_filter([(10, 20), (50, 60)])
    assert list(two) == ["$or"] and len(two["$or"]) == 2


def test_child_titles_are_the_direct_children_only():
    nodes = [
        {"level": 1, "title": "Ch 1", "start": 1, "end": 20},
        {"level": 2, "title": "A", "start": 2, "end": 10},
        {"level": 3, "title": "A.1", "start": 3, "end": 5},
        {"level": 2, "title": "B", "start": 11, "end": 20},
        {"level": 1, "title": "Ch 2", "start": 21, "end": 30},
    ]
    assert tree.child_titles(nodes, 0) == ["A", "B"]
    assert tree.child_titles(nodes, 1) == ["A.1"]
    assert tree.child_titles(nodes, 4) == []


@needs_book
def test_build_nodes_page_ranges_match_the_book():
    nodes = {(n["title"], n["start"]): n for n in tree.build_nodes(str(tree.BOOK))}
    assert nodes[("6. RAG and Agents", 494)]["end"] == 593  # runs to the next chapter
    assert nodes[("RAG", 495)]["end"] == 534                # runs to the next section
    assert all(n["start"] <= n["end"] for n in nodes.values())
