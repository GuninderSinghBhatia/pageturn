//! Ask the book and Who is this?, with Self-RAG checks, answered by the reader's own AI.
//!
//! The Python service's flow (rag-service/selfrag), reordered because search here is local
//! and free:
//!
//!   Spoiler Shield → search (8 chunks, up to the reader's page) → grade (cross-encoder)
//!     ├ kept some → answer → ground ─ unsupported claims? → answer once more, told what to drop
//!     └ kept none → ONE LLM call: chat reply, or a rewritten query
//!                     ├ chat → reply, no pages
//!                     └ query → search → grade → kept none → "I don't know"
//!
//! Routing first would cost an LLM call on every question to save a search that costs nothing,
//! so routing only happens when grading found nothing. Every loop runs at most once.
use super::{models, store};
use crate::commands::ai;
use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::Arc;

pub const NOT_YET: &str = "You haven't got there yet.";
pub const REFUSAL: &str = "I don't know. I couldn't find this in the book.";
const CANDIDATES: usize = 8;
const KEEP: usize = 3;
/// Cross-encoder logits: above 0 means "more likely relevant than not".
const RERANK_MIN: f32 = 0.0;
const WHO_MAX_MENTIONS: usize = 8;
const WHO_RELATED: usize = 3;

const SYSTEM: &str = "You answer questions about a book the reader has open, using only the \
excerpts you are given. You never reveal anything from later in the book.";

fn fail(error: impl Into<String>) -> Value {
    json!({ "ok": false, "error": error.into() })
}

/// The first {...} object in a reply (models sometimes wrap JSON in prose or ``` fences).
pub fn parse_json(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then(|| serde_json::from_str(&text[start..=end]).ok()).flatten()
}

fn excerpts(book: &store::BookIndex, ids: &[usize]) -> String {
    ids.iter()
        .map(|&i| format!("Page {}: {}", book.chunks[i].page, book.chunks[i].text))
        .collect::<Vec<_>>()
        .join("\n")
}

fn numbered(book: &store::BookIndex, ids: &[usize]) -> String {
    ids.iter()
        .enumerate()
        .map(|(n, &i)| format!("[{}] (page {}) {}", n + 1, book.chunks[i].page, book.chunks[i].text))
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub fn answer_prompt(question: &str, context: &str, avoid: &[String]) -> String {
    let mut p = format!(
        "Rules:\n\
         1. Use only the context to answer the question and do not make anything up.\n\
         2. If the context does not contain the answer, respond with 'I don't know'.\n\
         3. After each fact, provide the page number in parentheses.\n\n\
         Context:\n{context}\n\nQuestion: {question}\n\nAnswer:"
    );
    if !avoid.is_empty() {
        let listed: Vec<String> = avoid.iter().map(|c| format!("- {c}")).collect();
        p.push_str(&format!(
            "\n\nYour previous answer said these things, which the context does not support. \
             Leave them out:\n{}",
            listed.join("\n")
        ));
    }
    p
}

pub fn route_or_rewrite_prompt(question: &str) -> String {
    format!(
        "A reader typed this into \"Ask the book\", and a search of the book found nothing useful.\n\n\
         If it needs no facts at all (a greeting, thanks, small talk, a question about you), reply \
         with JSON {{\"route\": \"chat\", \"reply\": \"<one or two kind sentences, no facts>\"}}.\n\
         Otherwise rewrite it as one short search query using the words a book on the topic would \
         use, and reply with JSON {{\"route\": \"book\", \"query\": \"...\"}}.\n\n\
         Message: {question}\n\nReply with JSON only."
    )
}

pub fn ground_prompt(chunks: &str, answer: &str) -> String {
    format!(
        "You check an answer against the excerpts it was written from.\n\n\
         A claim is one single fact stated in the answer. List every claim that NO excerpt \
         supports. Page numbers in parentheses, and \"I don't know\", are not claims.\n\n\
         Excerpts:\n{chunks}\n\nAnswer:\n{answer}\n\n\
         Reply with JSON only: {{\"unsupported\": [\"claim\", ...]}} (an empty list if every \
         claim is supported)."
    )
}

/// What one LLM call says when it can't be read: route → search again with the question;
/// ground → trust the answer. A broken reply never makes Ask worse than plain RAG.
pub enum Route {
    Chat(String),
    Query(String),
}

pub fn read_route(reply: &str, question: &str) -> Route {
    let v = parse_json(reply).unwrap_or(Value::Null);
    match v.get("route").and_then(Value::as_str) {
        Some("chat") => match v.get("reply").and_then(Value::as_str) {
            Some(r) if !r.trim().is_empty() => Route::Chat(r.trim().to_string()),
            _ => Route::Query(question.to_string()),
        },
        _ => {
            let q = v.get("query").and_then(Value::as_str).unwrap_or("").trim();
            Route::Query(if q.is_empty() || q.chars().count() > 500 { question } else { q }.to_string())
        }
    }
}

pub fn read_unsupported(reply: &str) -> Vec<String> {
    parse_json(reply)
        .and_then(|v| v.get("unsupported").cloned())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|c| c.as_str().map(str::trim).filter(|c| !c.is_empty()).map(str::to_string))
        .collect()
}

async fn llm(state: &AppState, user: &str) -> Result<String, Value> {
    ai::complete(state, SYSTEM, user)
        .await
        .map_err(|e| json!({"ok": false, "error": e.message, "kind": e.kind}))
}

async fn embed(state: &AppState, text: &str) -> Result<Vec<f32>, Value> {
    let dir = state.data_dir.clone();
    let text = text.to_string();
    tokio::task::spawn_blocking(move || {
        let e = models::embedder(&dir)?;
        e.embed(&[text]).map(|mut v| v.remove(0))
    })
    .await
    .map_err(|e| fail(e.to_string()))?
    .map_err(fail)
}

/// Each chunk's best score over all the texts it was graded against, kept above RERANK_MIN,
/// best first, at most KEEP. `scores[t][c]` = chunk `found[c]` against text `t`.
pub fn keep_best(scores: &[Vec<f32>], found: &[usize]) -> Vec<usize> {
    let mut ranked: Vec<(f32, usize)> = found
        .iter()
        .enumerate()
        .map(|(c, &i)| (scores.iter().map(|s| s[c]).fold(f32::NEG_INFINITY, f32::max), i))
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    ranked.into_iter().filter(|(s, _)| *s > RERANK_MIN).map(|(_, i)| i).take(KEEP).collect()
}

/// The chunks worth answering from, best first: the cross-encoder's picks above RERANK_MIN.
/// `query` is the rewritten search on a retry: a chunk then counts if it answers the question
/// or the rewrite (the better of both scores). Short questions score low on their own ("What
/// is a tokenizer?": best chunk -0.42), so grading the retry on the question alone threw away
/// what the rewrite found (+5.17). Without the reranker (first use, offline) the top KEEP by
/// vector are used, like plain RAG.
async fn grade(
    state: &AppState,
    book: &Arc<store::BookIndex>,
    question: &str,
    query: Option<&str>,
    found: &[usize],
) -> Vec<usize> {
    let dir = state.data_dir.clone();
    if !models::is_downloaded(&dir, &models::RERANKER) {
        let d = dir.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = models::ensure(&d, &models::RERANKER, &|_, _| {}).await {
                log::warn!("Ask: grader model not downloaded: {e}");
            }
        });
        return found.iter().copied().take(KEEP).collect();
    }
    let texts: Vec<String> = found.iter().map(|&i| book.chunks[i].text.clone()).collect();
    let mut against = vec![question.to_string()];
    if let Some(q) = query.filter(|q| *q != question) {
        against.push(q.to_string());
    }
    let scores = tokio::task::spawn_blocking(move || {
        let r = models::reranker(&dir)?;
        against.iter().map(|t| r.score(t, &texts)).collect::<Result<Vec<_>, String>>()
    })
    .await;
    match scores {
        Ok(Ok(scores)) => keep_best(&scores, found),
        _ => found.iter().copied().take(KEEP).collect(),
    }
}

fn open_index(state: &AppState, book_id: &str) -> Result<Arc<store::BookIndex>, Value> {
    state
        .with_db(|c| Ok(store::book(c, book_id)?))
        .map_err(|e| fail(e.to_string()))
}

fn reply(answer: &str, book: &store::BookIndex, kept: &[usize], checks: Value) -> Value {
    let mut pages: Vec<i64> = kept.iter().map(|&i| book.chunks[i].page).collect();
    pages.sort_unstable();
    pages.dedup();
    json!({ "ok": true, "answer": answer, "pages": pages, "checks": checks })
}

pub async fn ask(state: &AppState, book_id: &str, question: &str, current_page: i64) -> Value {
    match ask_inner(state, book_id, question, current_page).await {
        Ok(v) | Err(v) => v,
    }
}

async fn ask_inner(state: &AppState, book_id: &str, question: &str, page: i64) -> Result<Value, Value> {
    let book = open_index(state, book_id)?;
    let q = embed(state, question).await?;

    // Spoiler Shield: the single best match over the whole book decides (as in the service).
    if let Some(&(best, _)) = store::search(&book, &q, 1, None).first() {
        if book.chunks[best].page > page {
            return Ok(reply(NOT_YET, &book, &[], json!({"spoiler": true})));
        }
    }

    let ids = |hits: Vec<(usize, f32)>| hits.into_iter().map(|h| h.0).collect::<Vec<_>>();
    let mut kept = grade(state, &book, question, None, &ids(store::search(&book, &q, CANDIDATES, Some(page)))).await;
    let mut query = question.to_string();
    if kept.is_empty() {
        match read_route(&llm(state, &route_or_rewrite_prompt(question)).await?, question) {
            Route::Chat(text) => return Ok(reply(&text, &book, &[], json!({"route": "chat"}))),
            Route::Query(rewritten) => {
                query = rewritten;
                let q2 = embed(state, &query).await?;
                kept = grade(state, &book, question, Some(query.as_str()), &ids(store::search(&book, &q2, CANDIDATES, Some(page)))).await;
            }
        }
        if kept.is_empty() {
            return Ok(reply(REFUSAL, &book, &[], json!({"route": "book", "query": query, "kept": 0})));
        }
    }

    let context = excerpts(&book, &kept);
    let mut answer = llm(state, &answer_prompt(question, &context, &[])).await?;
    let mut unsupported = read_unsupported(&llm(state, &ground_prompt(&numbered(&book, &kept), &answer)).await?);
    let rewritten = !unsupported.is_empty();
    if rewritten {
        answer = llm(state, &answer_prompt(question, &context, &unsupported)).await?;
        unsupported = read_unsupported(&llm(state, &ground_prompt(&numbered(&book, &kept), &answer)).await?);
    }
    Ok(reply(
        &answer,
        &book,
        &kept,
        json!({"route": "book", "query": query, "kept": kept.len(),
               "rewritten_answer": rewritten, "grounded": unsupported.is_empty()}),
    ))
}

/// At most n items picked evenly across the list (the history covers the whole range).
pub fn spread<T: Copy>(items: &[T], n: usize) -> Vec<T> {
    if items.len() <= n {
        return items.to_vec();
    }
    if n < 2 {
        return items.iter().copied().take(n).collect();
    }
    // round_ties_even: Python's round(), so the same mentions are picked as in the service.
    (0..n)
        .map(|i| items[((i * (items.len() - 1)) as f64 / (n - 1) as f64).round_ties_even() as usize])
        .collect()
}

fn who_prompt(name: &str, context: &str) -> String {
    format!(
        "Rules:\n\
         1. Use only the excerpts below. Do not make anything up and do not add what happens later.\n\
         2. Say who or what \"{name}\" is, then what the excerpts tell about it, in page order.\n\
         3. After each fact, give the page number in parentheses.\n\
         4. Keep it short: a few sentences.\n\n\
         Excerpts:\n{context}\n\nWho or what is {name}?\n\nAnswer:"
    )
}

/// Spoiler-safe history of a name: every mention up to the reader's page (keyword search)
/// plus a few related passages (vector search), never anything later.
pub async fn who(state: &AppState, book_id: &str, name: &str, page: i64) -> Value {
    let run = async {
        let book = open_index(state, book_id)?;
        let mentions = store::mentions(&book, name, page);
        if mentions.is_empty() {
            let later = !store::mentions(&book, name, i64::MAX).is_empty();
            let text = if later {
                format!("You haven't got to {name} yet.")
            } else {
                format!("I can't find {name} in this book.")
            };
            return Ok(json!({"ok": true, "answer": text, "pages": [], "related": []}));
        }
        let mut ids = spread(&mentions, WHO_MAX_MENTIONS);
        let q = embed(state, &format!("Who or what is {name}?")).await?;
        for (i, _) in store::search(&book, &q, WHO_RELATED, Some(page)) {
            if !ids.contains(&i) {
                ids.push(i);
            }
        }
        ids.sort_by_key(|&i| (book.chunks[i].page, i));
        let answer = llm(state, &who_prompt(name, &excerpts(&book, &ids))).await?;
        let mut v = reply(&answer, &book, &ids, Value::Null);
        v["related"] = json!([]);
        v.as_object_mut().map(|o| o.remove("checks"));
        Ok::<Value, Value>(v)
    };
    match run.await {
        Ok(v) | Err(v) => v,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chunk_keeps_its_better_score_from_question_or_rewrite() {
        // "What is a tokenizer?" and its rewrite on three chunks (scores from the eval book)
        let question = vec![-0.42, -4.95, -3.5];
        let rewrite = vec![2.29, 5.17, -0.2];
        assert_eq!(keep_best(&[question.clone()], &[10, 20, 30]), Vec::<usize>::new());
        assert_eq!(keep_best(&[question, rewrite], &[10, 20, 30]), vec![20, 10]);
    }

    #[test]
    fn keep_best_caps_at_keep() {
        assert_eq!(keep_best(&[vec![1.0, 4.0, 3.0, 2.0]], &[1, 2, 3, 4]), vec![2, 3, 4]);
    }

    #[test]
    fn parses_json_wrapped_in_prose_or_fences() {
        assert_eq!(parse_json("```json\n{\"a\": 1}\n```").unwrap()["a"], 1);
        assert_eq!(parse_json("Sure! {\"a\": [1]} hope it helps").unwrap()["a"][0], 1);
        assert!(parse_json("no json here").is_none());
    }

    #[test]
    fn route_falls_back_to_searching_with_the_question() {
        assert!(matches!(read_route("nonsense", "q"), Route::Query(ref s) if s == "q"));
        assert!(matches!(read_route(r#"{"route":"chat","reply":""}"#, "q"), Route::Query(_)));
        assert!(matches!(read_route(r#"{"route":"chat","reply":"Hi!"}"#, "q"), Route::Chat(ref s) if s == "Hi!"));
        assert!(matches!(read_route(r#"{"route":"book","query":"low-rank adaptation"}"#, "q"),
            Route::Query(ref s) if s == "low-rank adaptation"));
    }

    #[test]
    fn unreadable_ground_check_trusts_the_answer() {
        assert!(read_unsupported("not json").is_empty());
        assert_eq!(read_unsupported(r#"{"unsupported": ["x", " ", 3]}"#), vec!["x"]);
    }

    #[test]
    fn second_answer_is_told_what_to_leave_out() {
        let p = answer_prompt("q", "Page 1: text", &["LoRA was invented in 1990".into()]);
        assert!(p.contains("Leave them out") && p.contains("LoRA was invented in 1990"));
        assert!(!answer_prompt("q", "ctx", &[]).contains("Leave them out"));
    }

    #[test]
    fn spread_picks_evenly_and_keeps_short_lists() {
        assert_eq!(spread(&[1, 2, 3], 8), vec![1, 2, 3]);
        assert_eq!(spread(&(0..100).collect::<Vec<_>>(), 3), vec![0, 50, 99]);
    }
}
