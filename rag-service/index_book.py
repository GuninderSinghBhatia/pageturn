"""Index one book for Ask: chunks -> embeddings -> data/chroma (collection "books").

    python index_book.py                                   # the first book, as "book1"
    python index_book.py --book-id <app book id> --pdf <path>

Use the app's own book id (from the app's library) so the app finds the book without an entry in
data/books.json. Re-running replaces that book's chunks: its old ones are deleted first, so a
different chunk count never leaves stale ids behind.
"""
import argparse
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

from page_number import ingest_pdf

HERE = Path(__file__).parent  # paths below don't depend on where the script is run from
DEFAULT_PDF = HERE / "docs" / "_OceanofPDF.com_AI_Engineering_Building_Applications_-_Chip_Huyen.pdf"


BATCH = 64  # chunks embedded at a time (progress is reported per batch)
WRITE_BATCH = 5000  # chunks stored per Chroma write (Chroma's limit is about 5,400)


def index_book(book_id: str, pdf: str, collection, model, progress=None) -> int:
    """Chunks, embeds and stores one book; returns the number of chunks.

    Replaces the book's old chunks (a different chunk count never leaves stale ids behind).
    progress(done, total) is called as chunks are embedded. Shared by this script and the
    service's background indexer (indexer.py).
    """
    chunks = ingest_pdf(book_id, pdf)
    text = [chunk.page_content for chunk in chunks]
    if not text:
        raise ValueError("no text found (a scanned PDF without a text layer?)")
    metadata = [chunk.metadata for chunk in chunks]
    ids = [f"{book_id}-{n}" for n in range(len(chunks))]

    embeddings = []
    for start in range(0, len(text), BATCH):
        embeddings.extend(model.encode(text[start:start + BATCH]).tolist())
        if progress:
            progress(min(start + BATCH, len(text)), len(text))

    collection.delete(where={"book_id": book_id})
    # Chroma caps one write at about 5,400 chunks; big books go in several writes.
    for start in range(0, len(ids), WRITE_BATCH):
        end = start + WRITE_BATCH
        collection.upsert(ids=ids[start:end], documents=text[start:end],
                          embeddings=embeddings[start:end], metadatas=metadata[start:end])
    return len(chunks)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--book-id", default="book1")
    parser.add_argument("--pdf", default=str(DEFAULT_PDF))
    args = parser.parse_args()

    client = chromadb.PersistentClient(path=str(HERE / "data" / "chroma"))
    collection = client.get_or_create_collection("books")
    model = SentenceTransformer("all-MiniLM-L6-v2")

    n = index_book(args.book_id, args.pdf, collection, model,
                   progress=lambda done, total: print(f"embedded {done}/{total}", end=chr(13)))
    print()
    print(f"{args.book_id}: {n} chunks; the collection now has {collection.count()}")


if __name__ == "__main__":
    main()
