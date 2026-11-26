import os

from dotenv import load_dotenv

from langchain_core.documents import Document
from langchain_text_splitters import CharacterTextSplitter
from langchain_community.document_loaders import TextLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_neo4j import Neo4jGraph, Neo4jVector

load_dotenv()

url = os.getenv("NEO4J_URI")
username = os.getenv("NEO4J_USERNAME")
password = os.getenv("NEO4J_PASSWORD")

# Same model the rest of rag-service uses (index_book.py, ask.py).
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# A few small test documents, one fact each.
docs = [
    Document(page_content="PageTurn is built with Electron.", metadata={"page": 1}),
    Document(page_content="rag-service stores text in Chroma.", metadata={"page": 2}),
    Document(page_content="PageTurn calls rag-service.", metadata={"page": 3}),
]

db = Neo4jVector.from_documents(
    docs, embeddings, url=url, username=username, password=password
)

# Check: the closest document to this question should be the Electron one.
for hit in db.similarity_search("What is PageTurn built with?", k=2):
    print(hit.metadata, hit.page_content)