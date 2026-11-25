import chromadb
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")

q_vector = model.encode("What is a tokenizer?",show_progress_bar=True)
client = chromadb.PersistentClient(path="data/chroma")
collection = client.get_or_create_collection("books")

results = collection.query(
    query_embeddings=[q_vector], n_results=3) 

print(results["documents"][0])