from fastapi import FastAPI
from pydantic import BaseModel, Field

from ask import ask_question, who_is

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
    return who_is(req.name.strip(), req.current_page)
