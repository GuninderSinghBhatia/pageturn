"""Background indexing queue (indexer.py), with a fake index function: no model, no Chroma."""
import pytest

import indexer


@pytest.fixture
def fake(monkeypatch, tmp_path):
    """Indexed books live in a set; the fake index 'embeds' in two progress steps."""
    indexed = set()
    calls = []

    def index_fn(book_id, path, progress):
        calls.append(book_id)
        if "scan" in path:
            raise ValueError("no text found")
        progress(5, 10)
        progress(10, 10)
        indexed.add(book_id)
        return 10

    monkeypatch.setattr(indexer, "FAILED_FILE", tmp_path / "failed.json")
    monkeypatch.setattr(indexer, "is_indexed", lambda b: b in indexed)
    monkeypatch.setattr(indexer, "index_fn", index_fn)
    monkeypatch.setattr(indexer, "_start_worker", lambda: None)  # tests drive run_one()
    monkeypatch.setattr(indexer, "_status", {})
    monkeypatch.setattr(indexer, "_jobs", indexer.queue.Queue())

    def pdf(name):
        p = tmp_path / f"{name}.pdf"
        p.write_bytes(b"%PDF-1.4")
        return str(p)

    return indexed, calls, pdf


def test_new_book_is_queued_then_indexed(fake):
    indexed, calls, pdf = fake
    assert indexer.status("b1")["state"] == "missing"
    assert indexer.enqueue("b1", pdf("b1"))["state"] == "queued"
    assert indexer.enqueue("b1", pdf("b1"))["state"] == "queued"  # not queued twice
    assert indexer.run_one(timeout=0) is True
    assert indexer.run_one(timeout=0) is False
    assert calls == ["b1"]
    assert indexer.status("b1") == {"state": "done", "done": 10, "total": 10, "error": None}


def test_indexed_book_is_skipped(fake):
    indexed, calls, pdf = fake
    indexed.add("old")
    assert indexer.enqueue("old", pdf("old"))["state"] == "done"
    assert indexer.run_one(timeout=0) is False
    assert calls == []


def test_failure_is_remembered_until_retry_or_new_path(fake):
    indexed, calls, pdf = fake
    scan = pdf("scan")
    indexer.enqueue("s", scan)
    indexer.run_one(timeout=0)
    assert indexer.status("s")["state"] == "failed"
    assert "no text" in indexer.status("s")["error"]

    indexer._status.clear()  # a restarted service still knows it failed
    assert indexer.status("s")["state"] == "failed"
    assert indexer.enqueue("s", scan)["state"] == "failed"  # not retried at every start
    assert indexer.run_one(timeout=0) is False
    assert indexer.enqueue("s", scan, retry=True)["state"] == "queued"
    indexer.run_one(timeout=0)
    assert calls == ["s", "s"]

    good = pdf("fixed")  # the same book at a new path is tried again, and succeeds
    assert indexer.enqueue("s", good)["state"] == "queued"
    indexer.run_one(timeout=0)
    assert indexer.status("s")["state"] == "done"
    assert "s" not in indexer._failed()


def test_missing_file_is_not_remembered_as_failed(fake, tmp_path):
    r = indexer.enqueue("gone", str(tmp_path / "unplugged-drive.pdf"))
    assert r["state"] == "failed" and "not found" in r["error"]
    assert indexer._failed() == {}
