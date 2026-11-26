import json

import ask


def test_book_where_combines_book_and_page():
    assert ask.book_where("book1") == {"book_id": "book1"}
    assert ask.book_where("book1", 50) == {"$and": [{"book_id": "book1"}, {"page": {"$lte": 50}}]}
    assert ask.book_where(None, 50) == {"page": {"$lte": 50}}
    assert ask.book_where(None) is None


def test_no_book_id_means_the_first_book():
    assert ask.resolve_book(None) == "book1"
    assert ask.resolve_book("") == "book1"


def test_unknown_book_is_not_indexed(monkeypatch, tmp_path):
    monkeypatch.setattr(ask, "BOOKS_FILE", tmp_path / "missing.json")
    assert ask.resolve_book("no-such-book-anywhere") is None


def test_alias_points_an_app_id_at_an_index(monkeypatch, tmp_path):
    f = tmp_path / "books.json"
    f.write_text(json.dumps({"app-hash-123": "book1"}))
    monkeypatch.setattr(ask, "BOOKS_FILE", f)
    assert ask.resolve_book("app-hash-123") == "book1"


def test_other_books_never_use_the_book1_tree(monkeypatch):
    seen = {}

    class FakeCollection:
        def query(self, query_embeddings, n_results, where):
            seen["where"] = where
            return {"documents": [[]], "metadatas": [[]]}

    monkeypatch.setattr(ask, "collection", FakeCollection())
    ask.retrieve("q", mode="tree", max_page=10, book_id="alice")
    assert seen["where"] == {"$and": [{"book_id": "alice"}, {"page": {"$lte": 10}}]}
