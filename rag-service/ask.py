from dotenv import load_dotenv
import chromadb
from sentence_transformers import SentenceTransformer
load_dotenv()
import os
from pathlib import Path
from langchain_groq import ChatGroq
from tree import invoke_paced
from typing import List

# Anchored to this file, so the same index is used wherever the service is started from.
client = chromadb.PersistentClient(path=str(Path(__file__).parent / "data" / "chroma"))
collection = client.get_or_create_collection("books")

model = SentenceTransformer("all-MiniLM-L6-v2")

llm = ChatGroq(model=os.getenv("RAG_ANSWER_MODEL", "openai/gpt-oss-120b"), api_key=os.getenv("GROQ_API_KEY"))

def retrieve(question: str, mode: str | None = None, where: dict | None = None, k: int = 3, max_page: int | None = None):
    """Top-k passages for a question.

    mode: "vector" (similarity search), "tree" (an LLM picks sections from the table of contents)
    or "hybrid" (tree narrows the page range, then vector search inside it). Defaults to the
    RAG_RETRIEVER setting, then "vector". where: optional Chroma metadata filter.
    max_page: Spoiler Shield, nothing after this page is returned (any mode).
    """
    mode = mode or os.getenv("RAG_RETRIEVER", "vector")
    if mode != "vector":
        import retrievers  # imported here: retrievers imports this module too

        if mode == "tree":
            return retrievers.retrieve_tree(question, k, max_page)
        return retrievers.retrieve_hybrid(question, k, max_page)
    if max_page is not None and where is None:
        where = {"page": {"$lte": max_page}}
    embed= model.encode(question,show_progress_bar=False)
    results = collection.query(
        query_embeddings=[embed], n_results=k, where=where
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



def is_ahead(results : List ,current_page :int ) -> bool :
   ahead = 0
   for i in results :
       if i['metadata']['page'] > current_page :
           ahead += 1
   return ahead > len(results) / 2


def ask_question(question : str, current_page : int | None = None) -> dict :
    """
    Asks a question to the LLM using the provided context.
    current_page: Spoiler Shield. Only text up to this page is used; if the best matches are
    past it, the reader is told they haven't got there yet.
    """
    if current_page is not None:
        # Only the single best match decides: when a topic appears both early and late in the
        # book, a majority vote of the top 3 would refuse questions the reader can already answer.
        # Vector search is used for the check in every mode: it is free, the tree costs LLM tokens.
        if is_ahead(retrieve(question, mode="vector", k=1), current_page):
            return {"answer": "You haven't got there yet.", "context_pages": []}
    context = retrieve(question, max_page=current_page)
    prompt = build_prompt(question, context)
    response = invoke_paced(llm, prompt)
    pages = [item['metadata']['page'] for item in context]
    return {"answer": response.content, "context_pages": pages}


WHO_MAX_KEYWORD_CHUNKS = 8  # mentions sent to the LLM, spread evenly over the pages read so far
WHO_VECTOR_CHUNKS = 3       # related passages that may not contain the exact name ("she", "the model")


def find_mentions(name: str, max_page: int) -> list[dict]:
    """Every chunk up to max_page whose text contains `name` exactly (keyword search), by page."""
    found = collection.get(
        where={"page": {"$lte": max_page}}, where_document={"$contains": name}, include=["documents", "metadatas"]
    )
    mentions = [{"text": t, "metadata": m} for t, m in zip(found["documents"], found["metadatas"])]
    return sorted(mentions, key=lambda c: c["metadata"]["page"])


def spread(items: list, n: int) -> list:
    """At most n items picked evenly across the list, so the history covers the whole range."""
    if len(items) <= n:
        return items
    return [items[round(i * (len(items) - 1) / (n - 1))] for i in range(n)]


def build_who_prompt(name: str, context: list) -> str:
    context_text = "\n".join(f"Page {c['metadata']['page']}: {c['text']}" for c in context)
    return f"""
    rules :
        1. Use only the excerpts below. Do not make anything up and do not add what happens later.
        2. Say who or what "{name}" is, then what the excerpts tell about it, in page order.
        3. After each fact, give the page number in parentheses.
        4. Keep it short: a few sentences.

    Excerpts:\n{context_text}\n\nWho or what is {name}?\n\nAnswer:
    """


def who_is(name: str, current_page: int) -> dict:
    """Spoiler-safe history of a name: everything up to current_page, nothing after.

    Keyword search finds every mention; vector search adds passages about it that never use the name.
    """
    mentions = find_mentions(name, current_page)
    if not mentions:
        # Nothing yet: say whether the name shows up later, without revealing anything about it.
        later = find_mentions(name, 10**6)
        text = f"You haven't got to {name} yet." if later else f"I can't find {name} in this book."
        return {"answer": text, "context_pages": []}
    context = spread(mentions, WHO_MAX_KEYWORD_CHUNKS)
    for c in retrieve(f"Who or what is {name}?", mode="vector", k=WHO_VECTOR_CHUNKS, max_page=current_page):
        if not any(c["text"] == m["text"] for m in context):
            context.append(c)
    context.sort(key=lambda c: c["metadata"]["page"])
    response = invoke_paced(llm, build_who_prompt(name, context))
    return {"answer": response.content, "context_pages": [c["metadata"]["page"] for c in context]}


if __name__ == "__main__":
    print(ask_question("What is a tokenizer?"))
