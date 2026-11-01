from dotenv import load_dotenv
import chromadb
from sentence_transformers import SentenceTransformer
load_dotenv()
import os
from pathlib import Path
from langchain_groq import ChatGroq

# Anchored to this file, so the same index is used wherever the service is started from.
client = chromadb.PersistentClient(path=str(Path(__file__).parent / "data" / "chroma"))
collection = client.get_or_create_collection("books")

model = SentenceTransformer("all-MiniLM-L6-v2")

llm = ChatGroq(model="openai/gpt-oss-120b", api_key=os.getenv("GROQ_API_KEY"))  # Replace with

def retrieve(question:str) : 
    embed= model.encode(question,show_progress_bar=True)
    results = collection.query(
        query_embeddings=[embed], n_results=3
    )
    final = []
    for text , metadata in zip(results["documents"][0],results["metadatas"][0]) : 
        final.append({"text":text,"metadata":metadata})
    return final




def build_prompt(question :str, context :list) -> str : 
    """
    Builds a prompt for the LLM using the question and context.
    """
    context_text = "\n".join([f"Page {item['metadata']['page']}: {item['text']}" for item in context])
    prompt = f"""
    rules : 
        1. Use only  the context to answer the question and do not make anything up.
        2. If the context does not contain the answer, respond with 'I don't know'.
        3. after each fact , provide the page number in parentheses.

    Answer the following question based on the provided context:\n\nContext:\n{context_text}\n\nQuestion: {question}\n\nAnswer:

     
    """
    return prompt



def ask_question(question : str) -> dict : 
    """
    Asks a question to the LLM using the provided context.
    """
    context = retrieve(question)
    prompt = build_prompt(question, context)
    response = llm.invoke(prompt)
    pages = [item['metadata']['page'] for item in context]
    return {"answer": response.content, "context_pages": pages}


if __name__ == "__main__":
    print(ask_question("What is a tokenizer?"))
