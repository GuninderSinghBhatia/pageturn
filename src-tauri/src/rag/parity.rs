//! A4: the Rust Ask must find the same pages as the Python rag-service before it ships.
//!
//! Both tests are ignored by default: they download the two models (about 180 MB, kept in
//! `target/ask-test-data`) and the second needs the eval book. Run them with
//!
//!     cargo test --lib rag::parity -- --ignored --nocapture
//!
//! `PAGETURN_EVAL_PDF` overrides the book's path (default: the one in `rag-service/docs`).
use super::{chunk, models, store};
use serde_json::Value;
use std::path::PathBuf;

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn test_data() -> PathBuf {
    manifest().join("target").join("ask-test-data")
}

/// Downloads (once) and loads both models.
fn load_models() -> (models::Embedder, models::Reranker) {
    let data_dir = test_data();
    let rt = tokio::runtime::Runtime::new().unwrap();
    let emb = rt.block_on(models::ensure(&data_dir, &models::EMBEDDER, &|_, _| {})).unwrap();
    let rr = rt.block_on(models::ensure(&data_dir, &models::RERANKER, &|_, _| {})).unwrap();
    (models::Embedder::load(&emb).unwrap(), models::Reranker::load(&rr).unwrap())
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Same sentences, same model: the vectors must be the same as sentence-transformers' (the
/// reference file was written by rag-service's venv).
#[test]
#[ignore = "downloads the Ask models"]
fn minilm_vectors_match_python() {
    let (embedder, _) = load_models();
    let reference: Value = serde_json::from_str(
        &std::fs::read_to_string(manifest().join("src/rag/testdata/minilm_reference.json")).unwrap(),
    )
    .unwrap();
    let texts: Vec<String> = serde_json::from_value(reference["texts"].clone()).unwrap();
    let want: Vec<Vec<f32>> = serde_json::from_value(reference["vectors"].clone()).unwrap();
    let got = embedder.embed(&texts).unwrap();
    for (i, (g, w)) in got.iter().zip(&want).enumerate() {
        let cos = dot(g, w);
        println!("sentence {i}: cosine with Python = {cos:.6}");
        assert!(cos > 0.999, "sentence {i} differs from Python (cosine {cos})");
    }
}

/// The 25 answerable eval questions on the whole book (no Spoiler Shield), scored like
/// `python -m evals.run_evals vector`: a hit is the expected page among the 3 returned chunks.
/// Also scores the self-mode search (8 candidates, cross-encoder keeps the best 3).
#[test]
#[ignore = "downloads the Ask models and reads the 991-page eval book"]
fn hit_at_3_matches_python() {
    let rag_service = manifest().join("..").join("rag-service");
    let evals: Value = serde_json::from_str(
        &std::fs::read_to_string(rag_service.join("evals/questions.json")).unwrap(),
    )
    .unwrap();
    let pdf = std::env::var("PAGETURN_EVAL_PDF").map(PathBuf::from).unwrap_or_else(|_| {
        rag_service.join("docs/_OceanofPDF.com_AI_Engineering_Building_Applications_-_Chip_Huyen.pdf")
    });

    let (embedder, reranker) = load_models();
    let started = std::time::Instant::now();
    // Same as the app's PDF helper (pdf.rs).
    let pages: Vec<String> = pdf_extract::extract_text_by_pages(&pdf)
        .expect("could not read the eval PDF")
        .iter()
        .map(|p| super::pdf::tidy(p))
        .collect();
    // For comparing with PyMuPDF's text of the same pages.
    std::fs::write(
        test_data().join("eval_pages.json"),
        serde_json::to_string(&pages).unwrap(),
    )
    .unwrap();
    let mut chunks = Vec::new();
    for (i, text) in pages.iter().enumerate() {
        for c in chunk::split_text(text) {
            chunks.push(store::Chunk { page: i as i64 + 1, text: c });
        }
    }
    let read_s = started.elapsed().as_secs_f32();
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vecs: Vec<f32> = embedder.embed_all(&texts, &|_| {}).unwrap().into_iter().flatten().collect();
    println!(
        "{} pages, {} chunks (Python: 2,990); read {read_s:.1} s, embedded in {:.1} s",
        pages.len(),
        chunks.len(),
        started.elapsed().as_secs_f32() - read_s
    );
    let book = store::BookIndex { chunks, vecs };

    let (mut plain, mut graded, mut total) = (0, 0, 0);
    for q in evals["questions"].as_array().unwrap() {
        if q["answerable"] != true {
            continue;
        }
        total += 1;
        let question = q["question"].as_str().unwrap();
        let want = q["page"].as_i64().unwrap();
        let qv = embedder.embed(&[question.to_string()]).unwrap().remove(0);

        let top3: Vec<i64> = store::search(&book, &qv, 3, None)
            .iter()
            .map(|&(i, _)| book.chunks[i].page)
            .collect();
        let hit = top3.contains(&want);
        plain += hit as usize;

        let found = store::search(&book, &qv, 8, None);
        let texts: Vec<String> = found.iter().map(|&(i, _)| book.chunks[i].text.clone()).collect();
        let mut scored: Vec<(f32, i64)> = reranker
            .score(question, &texts)
            .unwrap()
            .into_iter()
            .zip(found.iter().map(|&(i, _)| book.chunks[i].page))
            .collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        let kept: Vec<i64> = scored.iter().filter(|s| s.0 > 0.0).take(3).map(|s| s.1).collect();
        graded += kept.contains(&want) as usize;

        println!(
            "q{:>2} want p.{want:<4} vector {:?} {} | graded {:?}",
            q["id"],
            top3,
            if hit { "hit " } else { "MISS" },
            kept
        );
    }
    println!("hit@3 vector {plain}/{total}, graded {graded}/{total} (Python: vector 20/25, rerank 21/25)");
    // Ask uses the graded search, so it must do at least as well as Python's. Plain search
    // (only used before the grader model is downloaded) may lose one near-tie: the two PDF
    // readers break a few lines differently, which can swap the 3rd result (2026-11-27: q4
    // gets p.192 where Python gets p.191).
    assert!(graded >= 21, "graded search finds fewer pages than Python's 21/25: {graded}/{total}");
    assert!(plain >= 19, "plain search is more than one below Python's 20/25: {plain}/{total}");
}

/// Embedding speed: batch by batch in book order (the old way) vs `embed_all` with several
/// worker counts, on the first 768 chunks of the eval book (needs `eval_pages.json`, written by
/// `hit_at_3_matches_python`). Run in a release build to get real numbers:
///
///     cargo test --release --lib rag::parity::embedding_speed -- --ignored --nocapture
#[test]
#[ignore = "benchmark; needs the Ask models and eval_pages.json"]
fn embedding_speed() {
    let (embedder, _) = load_models();
    let pages: Vec<String> = serde_json::from_str(
        &std::fs::read_to_string(test_data().join("eval_pages.json")).expect("run hit_at_3 first"),
    )
    .unwrap();
    let texts: Vec<String> = pages.iter().flat_map(|p| chunk::split_text(p)).take(768).collect();

    let t = std::time::Instant::now();
    let mut old = Vec::new();
    for batch in texts.chunks(32) {
        old.extend(embedder.embed(batch).unwrap());
    }
    let base = t.elapsed().as_secs_f32();
    println!("old loop (book order, one batch at a time): {base:.1} s");

    for (batch, workers) in [(32, 1), (32, 2), (32, 4), (32, 6), (32, 8), (16, 6), (64, 4)] {
        let t = std::time::Instant::now();
        let new = embedder.embed_all_with(&texts, batch, workers, &|_| {}).unwrap();
        let s = t.elapsed().as_secs_f32();
        let worst = old.iter().zip(&new).map(|(a, b)| dot(a, b)).fold(1.0f32, f32::min);
        println!("sorted, batch {batch:>2}, {workers} workers: {s:5.1} s ({:.1}x), lowest cosine vs old {worst:.6}", base / s);
        assert!(worst > 0.9999, "embed_all changed the vectors");
    }
}
