from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

from ask import ask_question, who_is
from graph.retrieve import related_terms

app = FastAPI()


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    current_page: int | None = Field(default=None, ge=1)


class WhoRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    current_page: int = Field(ge=1)


@app.get("/health")
def handle_health_check():
    return {"status": "healthy"}


@app.post("/ask")
def handle_ask(req: AskRequest):
    return ask_question(req.question, req.current_page)


@app.post("/who")
def handle_who(req: WhoRequest):
    name = req.name.strip()
    # Graph RAG (G6): also list what this term connects to. Empty when Neo4j is not running.
    return {**who_is(name, req.current_page), "related": related_terms(name, req.current_page)}


@app.get("/graph/node")
def handle_graph_node(name: str = Query(min_length=1, max_length=100),
                      current_page: int | None = Query(default=None, ge=1)):
    return {"name": name, "related": related_terms(name, current_page, limit=20)}
