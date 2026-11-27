from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

import indexer
from ask import DEFAULT_BOOK, ask_question, resolve_book, who_is
from graph.retrieve import related_terms

app = FastAPI()


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    current_page: int | None = Field(default=None, ge=1)
    book_id: str | None = Field(default=None, max_length=200)  # the app's id for the open book


class WhoRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    current_page: int = Field(ge=1)
    book_id: str | None = Field(default=None, max_length=200)


NOT_INDEXED = {"answer": "This book isn't set up for Ask yet.", "context_pages": [], "not_indexed": True}


class IndexRequest(BaseModel):
    book_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")
    path: str = Field(min_length=5, max_length=1000, pattern=r"(?i)\.pdf$")
    retry: bool = False  # try again a book that failed before


@app.post("/index")
def handle_index(req: IndexRequest):
    """Queues the book for background indexing (skips books already indexed)."""
    return indexer.enqueue(req.book_id, req.path, req.retry)


@app.get("/index/status")
def handle_index_status(book_id: str = Query(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")):
    return indexer.status(book_id)


@app.get("/health")
def handle_health_check():
    return {"status": "healthy"}


@app.post("/ask")
def handle_ask(req: AskRequest):
    book = resolve_book(req.book_id)
    if book is None:
        return NOT_INDEXED
    return ask_question(req.question, req.current_page, book)


@app.post("/who")
def handle_who(req: WhoRequest):
    name = req.name.strip()
    book = resolve_book(req.book_id)
    if book is None:
        return {**NOT_INDEXED, "related": []}
    # Graph RAG (G6): also list what this term connects to. Empty when Neo4j is not running.
    # The graph was built from book1 only.
    related = related_terms(name, req.current_page) if book == DEFAULT_BOOK else []
    return {**who_is(name, req.current_page, book), "related": related}


@app.get("/graph/node")
def handle_graph_node(name: str = Query(min_length=1, max_length=100),
                      current_page: int | None = Query(default=None, ge=1)):
    return {"name": name, "related": related_terms(name, current_page, limit=20)}
