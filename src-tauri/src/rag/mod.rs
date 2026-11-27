//! Ask the book, built into the app: no Python, no separate service, no extra key.
//!
//! - `pdf`: a PDF's text per page (in a helper process, so a bad PDF can't close the app)
//! - `chunk`: the same 500/100 chunks as the Python service
//! - `models`: MiniLM embeddings + a cross-encoder grader, downloaded on first use, run on the CPU
//! - `store`: chunks and vectors in the app's SQLite file; search is a dot product per chunk
//! - `index`: the background indexing queue and its status
//! - `answer`: Self-RAG (grade, route/rewrite, ground) through the reader's own AI from Settings
//!
//! `PAGETURN_ASK_ENGINE=service` sends Ask to the Python rag-service instead (and starts it
//! with the app), for experimenting with the Python version inside the app.
pub mod answer;
pub mod chunk;
pub mod index;
pub mod models;
#[cfg(test)]
mod parity;
pub mod pdf;
pub mod store;

pub fn use_service() -> bool {
    std::env::var("PAGETURN_ASK_ENGINE").as_deref() == Ok("service")
}
