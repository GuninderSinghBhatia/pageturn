"""The Self-RAG checks: route, grade, rewrite (correct) and ground.

Each one is a prompt to the judge plus a safe default when the judge's reply can't be read:
the default always falls back to plain-mode behaviour (search, keep the chunk, trust the answer),
so a broken judge can never make Ask worse than it was before.
"""
import os

from selfrag import judges

# ---------------------------------------------------------------- route

ROUTE_PROMPT = """You sort messages sent to "Ask the book", an assistant inside a book reader.

Reply with JSON only: {{"route": "book"}} or {{"route": "chat"}}.

"chat" = the message needs no facts at all: greetings, thanks, small talk, or questions about
the assistant itself ("what can you do?").
"book" = everything that asks for information, EVEN IF it looks unrelated to any book.
(A later step checks whether the book covers it. Never decide that here.)

Message: {question}
"""


def route(question: str) -> str:
    """"book" (search the book) or "chat" (reply without searching)."""
    try:
        choice = judges.ask_json(ROUTE_PROMPT.format(question=question)).get("route")
    except ValueError:
        return "book"
    return "chat" if choice == "chat" else "book"


CHAT_PROMPT = """You are "Ask the book", an assistant inside a book reader. You answer questions
about the book the reader has open, citing pages. You never reveal pages past where the reader is.

Reply briefly and kindly to this message. Don't state facts about the book or the world.

Message: {question}
"""


def chat_reply(question: str) -> str:
    return judges.ask_text(CHAT_PROMPT.format(question=question))


# ---------------------------------------------------------------- grade

GRADE_PROMPT = """You check search results for a question about a book.

A chunk is RELEVANT only if it contains information that helps answer the question.
Using the same words as the question is not enough.

Question: {question}

Chunks:
{chunks}

Reply with JSON only: {{"relevant": [the numbers of the relevant chunks]}} (an empty list if none).
"""


def number_chunks(chunks: list[dict]) -> str:
    return "\n\n".join(
        f"[{i}] (page {c['metadata']['page']}) {c['text']}" for i, c in enumerate(chunks, start=1)
    )


def grade_llm(question: str, chunks: list[dict]) -> list[dict]:
    """The chunks the judge calls relevant, in their original (search) order. One call for all."""
    if not chunks:
        return []
    try:
        reply = judges.ask_json(GRADE_PROMPT.format(question=question, chunks=number_chunks(chunks)))
        picked = {int(n) for n in reply.get("relevant", [])}
    except (ValueError, TypeError):
        return chunks
    return [c for i, c in enumerate(chunks, start=1) if i in picked]


# Cross-encoder reranker: reads question and chunk together (a bi-encoder embeds them apart).
RERANK_MODEL = "cross-encoder/ms-marco-MiniLM-L6-v2"
# ms-marco scores are logits: above 0 means "more likely relevant than not".
RERANK_MIN = float(os.getenv("RAG_RERANK_MIN", "0"))
_reranker = None


def reranker():
    global _reranker
    if _reranker is None:
        from sentence_transformers import CrossEncoder

        _reranker = CrossEncoder(RERANK_MODEL)
    return _reranker


def grade_rerank(texts: list[str], chunks: list[dict]) -> list[dict]:
    """Chunks scoring above RERANK_MIN against any of `texts` (each keeps its best score), best
    first. Free (no LLM), about 50 ms on a CPU."""
    if not chunks:
        return []
    pairs = [(t, c["text"]) for t in texts for c in chunks]
    flat = reranker().predict(pairs)
    n = len(chunks)
    scores = [max(flat[k * n + i] for k in range(len(texts))) for i in range(n)]
    ranked = sorted(zip(scores, range(n)), reverse=True)
    return [{**chunks[i], "score": float(s)} for s, i in ranked if s > RERANK_MIN]


def grade(question: str, chunks: list[dict], how: str | None = None, query: str | None = None) -> list[dict]:
    """The chunks worth answering from. After a rewrite, `query` is the rewritten search: a chunk
    counts if it answers the question OR the rewrite (the better of both scores). Short
    questions score low on their own ("What is a tokenizer?": best chunk -0.42), so grading the
    retry against the question alone threw away what the rewrite found."""
    how = how or os.getenv("RAG_GRADER", "rerank")
    texts = [question] if not query or query == question else [question, query]
    if how != "llm":
        return grade_rerank(texts, chunks)
    picked = [grade_llm(t, chunks) for t in texts]
    ids = {id(c) for p in picked for c in p}
    return [c for c in chunks if id(c) in ids]


# ---------------------------------------------------------------- correct

REWRITE_PROMPT = """A search of a book found nothing useful for this question.
Rewrite it as one short search query, using the words a textbook on the topic would use.
Keep the meaning. Don't answer it.

Question: {question}

Reply with JSON only: {{"query": "..."}}
"""


def rewrite(question: str) -> str:
    try:
        query = judges.ask_json(REWRITE_PROMPT.format(question=question)).get("query", "")
    except ValueError:
        return question
    query = str(query).strip()
    return query if 0 < len(query) <= 500 else question


# ---------------------------------------------------------------- ground

GROUND_PROMPT = """You check an answer against the excerpts it was written from.

A claim is one single fact stated in the answer. List every claim that NO excerpt supports.
Page numbers in parentheses, and "I don't know", are not claims.

Excerpts:
{chunks}

Answer:
{answer}

Reply with JSON only: {{"unsupported": ["claim", ...]}} (an empty list if every claim is supported).
"""


def unsupported_claims(answer: str, chunks: list[dict]) -> list[str]:
    """Claims in the answer that no chunk backs. [] means grounded (or the judge was unreadable)."""
    try:
        reply = judges.ask_json(GROUND_PROMPT.format(chunks=number_chunks(chunks), answer=answer))
        claims = reply.get("unsupported", [])
    except ValueError:
        return []
    return [str(c) for c in claims if str(c).strip()] if isinstance(claims, list) else []
