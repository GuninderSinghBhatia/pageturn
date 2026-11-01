from sentence_transformers import SentenceTransformer
from page_number import ingest_pdf

import chromadb
from pathlib import Path

HERE = Path(__file__).parent  # paths below don't depend on where the script is run from
client = chromadb.PersistentClient(path=str(HERE / "data" / "chroma"))
collection = client.get_or_create_collection("books")


model = SentenceTransformer("all-MiniLM-L6-v2")

chunks = ingest_pdf("book1", str(HERE / "docs" / "_OceanofPDF.com_AI_Engineering_Building_Applications_-_Chip_Huyen.pdf"))
ids = [chunk.metadata["book_id"] for chunk in chunks]
final_ids = [f"{book_id}-{n}" for n, book_id in enumerate(ids)]
print(final_ids[0:3])

text = [chunk.page_content for chunk in chunks]
metadata = [chunk.metadata for chunk in chunks]
print(len(text), len(metadata))

embeddings = model.encode(text,show_progress_bar=True)
print(embeddings.shape)

collection.upsert(
    ids=final_ids,
    documents=text,
    embeddings=embeddings, 
    metadatas=metadata
)

print(collection.count())