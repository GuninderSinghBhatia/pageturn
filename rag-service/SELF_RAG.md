# Self-RAG roadmap

Two parts:

- **Part 1 (S0–S7): Self-RAG in Python.** You write it. Same rules as Graph RAG: one small step,
  run it, look at the output, then the next step. Claude reviews and runs it.
- **Part 2 (A1–A5): RAG inside the app.** Claude writes it in Rust, copying the design you
  finish in Part 1. You only read the concepts, so you can explain how it works.

## Why Self-RAG

Today Ask does the same three things for every question: search the book, give the chunks to
the LLM, answer. That goes wrong in three ways:

1. **It searches when it shouldn't.** "Thanks!" or "Summarise what you just said" still runs a search.
2. **It trusts bad chunks.** If the search returns three chunks that don't help, the LLM answers
   from them anyway (or from its own memory, which looks like the book but isn't).
3. **Nobody checks the answer.** If the answer says something no chunk supports, the reader
   can't tell.

Self-RAG adds a check before each of those steps. The model asks itself:

| Check | Question the model asks | What happens on "no" |
|---|---|---|
| **route** | Do I need the book for this? | Answer without searching, or refuse |
| **grade** | Is this chunk useful for this question? | Drop the chunk; if none are left, rewrite the question and search again |
| **ground** | Is every claim in my answer backed by a chunk? | Write the answer again, or cut the claim |

### Our version vs the paper

The Self-RAG paper *trains* a model to write special "reflection tokens" (`Retrieve`, `ISREL`,
`ISSUP`, `ISUSE`). We can't train a model on Groq's free tier. We do what most people do in
practice: **ask an LLM each check as a separate yes/no question** ("LLM as a judge"). The LangChain
blog post below shows the same approach.

## Words used in this file (one word, one meaning)

- **check** = one yes/no decision the system makes about itself (route, grade, ground).
- **judge** = the LLM call that makes a check. Usually a small, cheap model.
- **chunk** = the 500-character pieces already stored in Chroma.
- **claim** = one single fact inside an answer ("LoRA trains fewer weights").
- **grounded** = every claim in the answer is backed by at least one chunk.
- **loop** = going back to an earlier step (for example: rewrite the question, search again).
- **plain mode** = how Ask works today. **self mode** = with the checks.

## Reading list (in order)

Read the item before the milestone it unlocks. Don't read everything up front.

| # | Read | What to get from it | For |
|---|---|---|---|
| R1 | LangChain blog: [Self-Reflective RAG with LangGraph](https://www.langchain.com/blog/agentic-rag-with-langgraph) (6 min) | The big picture: checks + loops as a state machine; Self-RAG and CRAG side by side | S0 |
| R2 | Self-RAG paper: [project page](https://selfrag.github.io/) first, then [arXiv 2310.11511](https://arxiv.org/abs/2310.11511): intro + method + the reflection-token table | The four reflection tokens and what each one decides. Skip the training details | S0 |
| R3 | Adaptive-RAG: [arXiv 2403.14403](https://arxiv.org/abs/2403.14403), abstract + intro | Route by question type: no search / one search / several searches | S1 |
| R4 | LLM-as-a-judge: [arXiv 2306.05685](https://arxiv.org/abs/2306.05685), the section on judge types and the one on biases | Why judges work, and their biases (position, length, favouring themselves) | S1–S2 |
| R5 | Sentence-Transformers: [Retrieve & Re-Rank](https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) | Bi-encoder (what you use now) vs cross-encoder (a reranker). A cheaper way to grade chunks | S2 |
| R6 | CRAG paper: [arXiv 2401.15884](https://arxiv.org/abs/2401.15884), abstract + method overview figure | What to do when the chunks are bad: correct, rewrite, search again | S3 |
| R7 | RAGAS: [Faithfulness metric](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness) | Split the answer into claims, check each one, score = supported ÷ total | S4, S7 |
| R8 | LangGraph docs: [Build a custom RAG agent](https://docs.langchain.com/oss/python/langgraph/agentic-rag) | State, nodes, edges, conditional edges; a working grade → rewrite loop | S6 |

Check the installed LangChain / LangGraph versions before using any name from these pages.

## Milestones, Part 1: Self-RAG in Python (you write it)

Each one has a **done when** line. Do them in order.

### S0: Understand and decide (no code)
Read R1 and R2. Then answer in your own words:
- What are the four reflection tokens, and which of our three checks matches each?
- Which check do you expect to help our book most, and why?
- Baseline to beat (from `evals/results.csv`): vector hit@3 = 80%, off-topic refused 4/4.

**Done when:** you can explain Self-RAG in 3 sentences without looking.

### S1: route (do I need the book?)
Concepts: routing, question types, structured output (the LLM returns `{"route": "book"}`
instead of free text, through Pydantic + `with_structured_output`). Read R3, R4.
Write `selfrag/route.py`. Three routes: **book** (search), **chat** ("thanks", "explain that
simpler": answer without searching), **off_topic** (refuse, like today).
Add about 8 new questions to `evals/questions.json` for **chat** and **off_topic**.

**Done when:** the router puts at least 90% of eval questions on the right route, and you
know how many tokens one route call costs.

### S2: grade (is this chunk useful?)
Concepts: relevance vs similarity (a chunk can *sound like* the question and still not answer
it), bi-encoder vs cross-encoder, the cost of one LLM call per chunk. Read R5.
Build it **two ways** and compare: (a) an LLM judge says yes/no per chunk, (b) a cross-encoder
reranker gives each chunk a score and you keep the chunks above a threshold.

**Done when:** you have a table: hit@3, time per question, tokens per question, for plain
vs (a) vs (b), and you have picked one with a reason.

### S3: correct (when every chunk is bad)
Concepts: query rewriting, loops with a hard limit (max 1 retry), knowing when to stop and
say "the book doesn't cover this". Read R6. Note: CRAG falls back to web search; we don't,
because Ask only answers from the book.

**Done when:** for questions where the first search misses, the rewrite fixes some of them
(count how many), and nothing loops more than once.

### S4: ground (is every claim backed?)
Concepts: hallucination, faithfulness, splitting an answer into claims, checking each
claim against the chunks. Read R7.
If a claim isn't backed: write the answer again once, then cut what's still unbacked.

**Done when:** you have a faithfulness score for plain mode and for self mode on all 25
answerable questions.

### S5: Spoiler Shield still holds
Concepts: rules that must survive every loop. The `max_page` filter has to apply to the
search after a rewrite too, and the grade check must never "rescue" a chunk past `max_page`.

**Done when:** `tests/test_spoiler.py` passes in self mode, plus one new test where the
rewritten question would have found a page ahead of the reader.

### S6: Wire it together (LangGraph)
Concepts: state (what each step can read and write), nodes, edges, conditional edges. Read R8.
One graph: route → search → grade → (rewrite → search)? → answer → ground. A flag
`RAG_MODE=plain|self` picks the old or new flow, same as `RAG_RETRIEVER`.

**Done when:** `/ask` works in both modes, and the app needs no change.

### S7: Evals and resume numbers (yours to write)
Run both modes on every question. Columns: hit@3, right route, refusals, faithfulness,
seconds per question, tokens per question. Append to `evals/results.csv`.

**Done when:** you have written your resume bullet from the table yourself.

## Milestones, Part 2: RAG inside the app (Claude builds it)

Goal: Ask works in the installed app with no Python, no separate service and no Groq key. The
installer stays the same size, and the app doesn't start any slower.

| # | What Claude builds | Concepts for you to read |
|---|---|---|
| A1 | Chunking in Rust, same 500/100 split, same 1-based `page` numbers | Nothing new: it's your M1 |
| A2 | Embeddings in the app: the same all-MiniLM-L6-v2 model, downloaded the first time someone uses Ask (installer unchanged). Built with candle (pure Rust) on the original safetensors weights instead of ONNX: no onnxruntime DLL to ship, and no quantization, so the vectors are the same as Python's | ONNX (one model format any language can run: [onnxruntime.ai](https://onnxruntime.ai/)); int8 quantization (smaller and faster, slightly less accurate), the road not taken |
| A3 | Vectors stored in the app's own SQLite file; search compares the question with every chunk of the open book | Brute-force search vs an index like HNSW: with a few thousand chunks per book, comparing everything takes milliseconds, so no index needed |
| A4 | Your 25 eval questions run against the Rust version | Parity: the Rust hit@3 must match Python's before anything ships |
| A5 | Your S1–S4 checks, running through the AI options the app already has (Claude plan, ChatGPT plan, API key) | Nothing new: it's your Part 1 design |

## Known traps

- **Token budget.** Each check is another LLM call. Groq free tier: 8,000 tokens a minute,
  200,000 a day per model. Grade all chunks in **one** call, not one call each. Use the small
  model (`gpt-oss-20b`, its own daily bucket) for judges and the big one for answers.
- **Slow answers.** Plain mode takes about 1 LLM call; self mode can take 4 or 5. Measure seconds per
  question in S7. A slower answer has to be noticeably more correct to be worth it.
- **Judges agree with themselves.** The same model judging its own answer is too kind (R4).
  If S4 scores look too good, try a different model as the judge.
- **Endless loops.** Every loop has a hard cap of 1 retry. Write the cap before the loop.
- **Spoilers through the back door.** A rewritten question can find pages ahead of the reader
  if `max_page` isn't passed on. That's why S5 exists.

## Progress

- [ ] S0 · [x] S1 · [x] S2 · [x] S3 · [x] S4 · [x] S5 · [x] S6 · [ ] S7
- [x] A1 · [x] A2 · [x] A3 · [x] A4 · [x] A5

### Part 1 status (2026-11-27)

Code: `selfrag/` (checks, judges, LangGraph graph), `RAG_MODE=plain|self` (default `self`),
tests in `tests/test_selfrag.py`. First end-to-end run (`evals/selfrag_results.csv`, label
`s7_first_run`):

| mode | hit@3 | answered | faithful | off-topic refused | chat skipped search | spoiler leaks | s/question | tokens/question |
|---|---|---|---|---|---|---|---|---|
| plain | 20/25 | 22/25 | 19/22 | 8/8 | 0/5 | 0 | 1.21 | 661 |
| self (rerank grader) | 21/25 | 24/25 | 22/24 | 8/8 | 5/5 | 0 | 1.91 | 1,189 |
| self (rerank grader), 2nd run | 21/25 | 24/25 | 20/24 | 8/8 | 5/5 | 0 | 2.00 | 1,155 |
| self (LLM-judge grader) | 21/25 | 24/25 | 20/24 | 8/8 | 5/5 | 0 | 2.75 | 2,200 |

The faithful score moved 22 → 20 between two identical runs: the eval judge varies by about
2 answers, so faithfulness differences smaller than that mean nothing.

Results for the open items (2026-11-27, evening):
- **S1**: route accuracy 13/13 on the chat and off-topic questions; one route call costs about
  **208 tokens** (8 calls, gpt-oss-20b). "Can you explain that more simply?" goes to `book`:
  the router has no chat history, so it can't know what "that" is.
- **S2**: (a) LLM judge and (b) cross-encoder tie on every quality column (21/25, 24/25, 20/24),
  but (b) takes 2.00 s and 1,155 tokens per question against 2.75 s and 2,200. The data favours
  (b): same quality, half the tokens, and no LLM call (the app uses it). Your call to confirm.
- **S3**: the rewrite fired on 1 of 25 questions (q12) and fixed 0. Why: **grading after the
  rewrite still scores the chunks against the original question** (`grade_node` uses
  `s["question"]`). Short questions score low on the cross-encoder ("What is a tokenizer?":
  best chunk −0.42, under the 0 threshold), so the retry throws away what the rewrite found
  (the rewritten query puts p.36 at +5.17). Open design question: grade the retry against the
  rewritten query, or against the better of the two scores. The app copies this behaviour.
- **S0**, **S7**: yours (explain Self-RAG without looking; write the resume bullet).

### Part 2 status (2026-11-27)

Code: `src-tauri/src/rag/` (pdf, chunk, models, store, index, answer). Ask runs in the app
by default; `PAGETURN_ASK_ENGINE=service` sends it to this Python service instead.

**A4 parity** (`cargo test --release --lib rag::parity -- --ignored --nocapture`, eval book,
release build, same machine):

| | Python | Rust |
|---|---|---|
| MiniLM vectors (3 sentences) | reference | cosine 1.000000 |
| chunks | 2,990 | 2,986 |
| hit@3, plain vector search | 20/25 | 19/25 |
| hit@3, graded (cross-encoder, what Ask uses) | 21/25 | 21/25 |
| read the PDF | 5 s | 11 s |
| embed the book | 32 s | 55 s (was 162 s) |

The one plain-search difference is a near-tie: q4's 3rd result is p.192 in Rust, p.191 in
Python (the two PDF readers break a few lines differently).

What it took to get there:
- **pdf-extract bug.** CID font widths given as a range (`c_first c_last w`) were dropped,
  so about 2% of words came out split ("dif ferent", "Sa mpling"). Fixed in a patched copy,
  `src-tauri/vendor/pdf-extract` (still unfixed upstream in 0.12.1); split words went from
  2% to 0.01%.
- **Line breaks.** pdf-extract left a blank line after every line, so the splitter cut
  chunks in different places than with PyMuPDF. `rag/pdf.rs::tidy` keeps one break per line.
- **Embedding speed.** candle multiplies matrices on every core but runs GELU, layer norm and
  adds on one thread. `Embedder::embed_all` runs 6 batches at once and batches chunks of
  similar length: 2.6x faster, same vectors.

**A5**: done. `rag::parity::a5_with_claude_plan` runs the in-app Self-RAG through the
reader's Claude plan (Claude Code CLI) on the eval book: answers cite the right pages (36; 189
and 191), off-topic gets "I don't know", "thanks!" gets a chat reply without a search, the
Spoiler Shield blocks LoRA at p.300, 2 to 9 s per answer. It also showed the S3 flaw: "What is
a tokenizer?" at p.300 got "I don't know" although p.36 answers it.

**Models in the installer**: `scripts/fetch-models.mjs` (runs before every `tauri build`)
puts both models in `resources/models/`, shipped as `<install folder>/models/` with a
README.txt. The app uses that copy; it only downloads them if the folder is missing.
