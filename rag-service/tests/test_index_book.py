"""index_book stores big books in several Chroma writes (one write is capped at about 5,400)."""
from types import SimpleNamespace

import numpy as np

import index_book


def test_big_books_are_written_in_batches(monkeypatch):
    n = 12_000
    chunks = [SimpleNamespace(page_content=f"c{i}", metadata={"book_id": "b", "page": 1}) for i in range(n)]
    monkeypatch.setattr(index_book, "ingest_pdf", lambda book_id, pdf: chunks)
    writes = []
    collection = SimpleNamespace(delete=lambda where: None,
                                 upsert=lambda ids, documents, embeddings, metadatas: writes.append(ids))
    model = SimpleNamespace(encode=lambda texts: np.zeros((len(texts), 2)))

    assert index_book.index_book("b", "x.pdf", collection, model) == n
    assert [len(w) for w in writes] == [5000, 5000, 2000]
    assert writes[0][0] == "b-0" and writes[-1][-1] == f"b-{n - 1}"
