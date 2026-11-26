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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--book-id", default="book1")
    parser.add_argument("--pdf", default=str(DEFAULT_PDF))
    args = parser.parse_args()

    client = chromadb.PersistentClient(path=str(HERE / "data" / "chroma"))
    collection = client.get_or_create_collection("books")
    model = SentenceTransformer("all-MiniLM-L6-v2")

    chunks = ingest_pdf(args.book_id, args.pdf)
    ids = [f"{args.book_id}-{n}" for n in range(len(chunks))]
    print(ids[0:3])

    text = [chunk.page_content for chunk in chunks]
    metadata = [chunk.metadata for chunk in chunks]
    print(len(text), len(metadata))

    embeddings = model.encode(text, show_progress_bar=True)
    print(embeddings.shape)

    collection.delete(where={"book_id": args.book_id})
    collection.upsert(ids=ids, documents=text, embeddings=embeddings, metadatas=metadata)
    print(collection.count())


if __name__ == "__main__":
    main()
