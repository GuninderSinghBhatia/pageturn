//! The two small models Ask runs on this computer, downloaded the first time they're needed
//! (the installer doesn't carry them) and kept in `<data>/models/`.
//!
//! - all-MiniLM-L6-v2: turns text into a 384-number vector (same model as the Python service,
//!   so the same chunks get the same vectors).
//! - ms-marco-MiniLM-L6-v2: a cross-encoder that reads question and chunk together and scores
//!   how well the chunk answers the question (Self-RAG's grade check, with no LLM call).
//!
//! Both run with candle (pure Rust, on the CPU). Files come from Hugging Face at a pinned
//! revision; the weights are checked against their SHA-256 before use.
use candle_core::{DType, Device, Tensor};
use candle_nn::{Linear, Module, VarBuilder};
use candle_transformers::models::bert::{BertModel, Config};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};
use tokio::io::AsyncWriteExt;

pub struct Spec {
    pub name: &'static str,
    repo: &'static str,
    rev: &'static str,
    weights_sha256: &'static str,
    max_len: usize,
}

pub const EMBEDDER: Spec = Spec {
    name: "all-MiniLM-L6-v2",
    repo: "sentence-transformers/all-MiniLM-L6-v2",
    rev: "1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
    weights_sha256: "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db",
    max_len: 256, // sentence-transformers' max_seq_length for this model
};

pub const RERANKER: Spec = Spec {
    name: "ms-marco-MiniLM-L6-v2",
    repo: "cross-encoder/ms-marco-MiniLM-L6-v2",
    rev: "233902d25c440f23af6f7d6e94d2946bac0bee0a",
    weights_sha256: "821d1aa69520101d6e0737f78a042ae25b19e5cb9160701909d10434f4aeb0ae",
    max_len: 512,
};

const FILES: [&str; 3] = ["config.json", "tokenizer.json", "model.safetensors"];

/// The installer's copy of the models: `<install folder>/models/<name>/`, set once at startup.
static BUNDLED: OnceLock<PathBuf> = OnceLock::new();

pub fn set_bundled_dir(dir: PathBuf) {
    let _ = BUNDLED.set(dir);
}

/// Where a model is downloaded when the installer's copy is missing (dev builds, or files
/// deleted from the install folder).
pub fn models_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

fn complete(dir: &Path) -> bool {
    FILES.iter().all(|f| dir.join(f).exists())
}

/// The installer's copy when it is complete, else the download folder.
fn dir_of(data_dir: &Path, spec: &Spec) -> PathBuf {
    pick_dir(BUNDLED.get().map(PathBuf::as_path), data_dir, spec)
}

fn pick_dir(bundled: Option<&Path>, data_dir: &Path, spec: &Spec) -> PathBuf {
    match bundled.map(|b| b.join(spec.name)) {
        Some(dir) if complete(&dir) => dir,
        _ => models_dir(data_dir).join(spec.name),
    }
}

pub fn is_downloaded(data_dir: &Path, spec: &Spec) -> bool {
    complete(&dir_of(data_dir, spec))
}

/// One download at a time per model, so two books starting at once don't fetch it twice.
fn download_lock(spec: &Spec) -> &'static tokio::sync::Mutex<()> {
    static EMB: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    static RR: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let cell = if spec.name == EMBEDDER.name { &EMB } else { &RR };
    cell.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Downloads the model's missing files. `progress(done_bytes, total_bytes)` follows the weights.
pub async fn ensure(
    data_dir: &Path,
    spec: &Spec,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<PathBuf, String> {
    let _one_at_a_time = download_lock(spec).lock().await;
    let dir = dir_of(data_dir, spec);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let client = reqwest::Client::builder()
        .user_agent("PageTurn")
        .build()
        .map_err(|e| e.to_string())?;
    for file in FILES {
        let dest = dir.join(file);
        if dest.exists() {
            continue;
        }
        let url = format!("https://huggingface.co/{}/resolve/{}/{file}", spec.repo, spec.rev);
        let res = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("could not download the Ask model ({file}): {e}"))?;
        if !res.status().is_success() {
            return Err(format!("could not download the Ask model ({file}): HTTP {}", res.status()));
        }
        let total = res.content_length().unwrap_or(0);
        let part = dir.join(format!("{file}.part"));
        let mut out = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut done = 0u64;
        let mut body = res.bytes_stream();
        while let Some(piece) = body.next().await {
            let piece = piece.map_err(|e| format!("download interrupted ({file}): {e}"))?;
            hasher.update(&piece);
            out.write_all(&piece).await.map_err(|e| e.to_string())?;
            done += piece.len() as u64;
            if file == "model.safetensors" {
                progress(done, total);
            }
        }
        out.flush().await.map_err(|e| e.to_string())?;
        drop(out);
        if file == "model.safetensors" && hex::encode(hasher.finalize()) != spec.weights_sha256 {
            let _ = tokio::fs::remove_file(&part).await;
            return Err("the downloaded Ask model was damaged; it will be downloaded again".into());
        }
        tokio::fs::rename(&part, &dest).await.map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

struct Loaded {
    bert: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

fn load(dir: &Path, spec: &Spec) -> Result<(Loaded, VarBuilder<'static>), String> {
    let device = Device::Cpu;
    let config: Config = serde_json::from_str(
        &std::fs::read_to_string(dir.join("config.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("model config: {e}"))?;
    let mut tokenizer =
        Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|e| format!("tokenizer: {e}"))?;
    tokenizer.with_padding(Some(PaddingParams::default())); // pad to the longest in the batch
    tokenizer
        .with_truncation(Some(TruncationParams {
            max_length: spec.max_len,
            ..Default::default()
        }))
        .map_err(|e| format!("tokenizer: {e}"))?;
    // Safety: the file is ours, fully written and checked before it is renamed into place.
    let vb = unsafe {
        VarBuilder::from_mmaped_safetensors(&[dir.join("model.safetensors")], DType::F32, &device)
    }
    .map_err(|e| format!("model weights: {e}"))?;
    let bert = BertModel::load(vb.clone(), &config).map_err(|e| format!("model: {e}"))?;
    Ok((Loaded { bert, tokenizer, device }, vb))
}

fn ids_tensors(
    l: &Loaded,
    encodings: &[tokenizers::Encoding],
) -> candle_core::Result<(Tensor, Tensor, Tensor)> {
    let rows = |f: &dyn Fn(&tokenizers::Encoding) -> &[u32]| -> candle_core::Result<Tensor> {
        let v: Vec<Tensor> = encodings
            .iter()
            .map(|e| Tensor::new(f(e), &l.device))
            .collect::<candle_core::Result<_>>()?;
        Tensor::stack(&v, 0)
    };
    Ok((
        rows(&|e| e.get_ids())?,
        rows(&|e| e.get_type_ids())?,
        rows(&|e| e.get_attention_mask())?,
    ))
}

/// Text → 384-number unit vectors (mean of the token vectors, like sentence-transformers).
pub struct Embedder(Loaded);

impl Embedder {
    pub fn load(dir: &Path) -> Result<Self, String> {
        Ok(Self(load(dir, &EMBEDDER)?.0))
    }

    pub fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let l = &self.0;
        let enc = l
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| format!("tokenizer: {e}"))?;
        let run = || -> candle_core::Result<Vec<Vec<f32>>> {
            let (ids, types, mask) = ids_tensors(l, &enc)?;
            let out = l.bert.forward(&ids, &types, Some(&mask))?; // [batch, tokens, 384]
            let mask = mask.to_dtype(DType::F32)?.unsqueeze(2)?;
            let summed = out.broadcast_mul(&mask)?.sum(1)?;
            let counts = mask.sum(1)?;
            let mean = summed.broadcast_div(&counts)?;
            let norm = mean.sqr()?.sum_keepdim(1)?.sqrt()?;
            mean.broadcast_div(&norm)?.to_vec2::<f32>()
        };
        run().map_err(|e| format!("embedding: {e}"))
    }

    /// A whole book's chunks, in the same order as `texts`. Faster than `embed` batch by batch:
    /// - chunks of similar length go in the same batch, so little time goes on padding
    ///   (sentence-transformers does the same);
    /// - several batches run at once: candle multiplies matrices on every core, but runs the
    ///   other steps (GELU, layer norm, adds) on one thread, so one batch at a time leaves
    ///   most cores idle.
    ///
    /// `progress(done)` is called with the number of chunks embedded so far.
    pub fn embed_all(
        &self,
        texts: &[String],
        progress: &(dyn Fn(usize) + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        let workers = std::thread::available_parallelism().map_or(4, |n| (n.get() / 4).clamp(1, 6));
        self.embed_all_with(texts, EMBED_BATCH, workers, progress)
    }

    pub(crate) fn embed_all_with(
        &self,
        texts: &[String],
        batch: usize,
        workers: usize,
        progress: &(dyn Fn(usize) + Sync),
    ) -> Result<Vec<Vec<f32>>, String> {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Mutex;

        let mut order: Vec<usize> = (0..texts.len()).collect();
        order.sort_by_key(|&i| texts[i].len());
        let batches: Vec<&[usize]> = order.chunks(batch.max(1)).collect();
        let next = AtomicUsize::new(0);
        let done = AtomicUsize::new(0);
        let out: Mutex<Vec<Vec<f32>>> = Mutex::new(vec![Vec::new(); texts.len()]);
        let failed: Mutex<Option<String>> = Mutex::new(None);

        std::thread::scope(|s| {
            for _ in 0..workers.max(1) {
                s.spawn(|| loop {
                    let b = next.fetch_add(1, Ordering::Relaxed);
                    let Some(ids) = batches.get(b) else { break };
                    if failed.lock().unwrap_or_else(|e| e.into_inner()).is_some() {
                        break;
                    }
                    let group: Vec<String> = ids.iter().map(|&i| texts[i].clone()).collect();
                    match self.embed(&group) {
                        Ok(vecs) => {
                            let mut out = out.lock().unwrap_or_else(|e| e.into_inner());
                            for (&i, v) in ids.iter().zip(vecs) {
                                out[i] = v;
                            }
                            drop(out);
                            progress(done.fetch_add(ids.len(), Ordering::Relaxed) + ids.len());
                        }
                        Err(e) => {
                            *failed.lock().unwrap_or_else(|e| e.into_inner()) = Some(e);
                            break;
                        }
                    }
                });
            }
        });
        if let Some(e) = failed.into_inner().unwrap_or_else(|e| e.into_inner()) {
            return Err(e);
        }
        Ok(out.into_inner().unwrap_or_else(|e| e.into_inner()))
    }
}

/// Chunks per batch when embedding a book (16 beat 32 and 64 in the embedding_speed benchmark).
pub const EMBED_BATCH: usize = 16;

/// Scores (question, chunk) pairs; above 0 means "more likely relevant than not".
pub struct Reranker {
    m: Loaded,
    pooler: Linear,
    classifier: Linear,
}

impl Reranker {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let (m, vb) = load(dir, &RERANKER)?;
        let hidden = 384;
        let pooler = candle_nn::linear(hidden, hidden, vb.pp("bert.pooler.dense"))
            .map_err(|e| format!("reranker: {e}"))?;
        let classifier =
            candle_nn::linear(hidden, 1, vb.pp("classifier")).map_err(|e| format!("reranker: {e}"))?;
        Ok(Self { m, pooler, classifier })
    }

    pub fn score(&self, question: &str, passages: &[String]) -> Result<Vec<f32>, String> {
        if passages.is_empty() {
            return Ok(vec![]);
        }
        let pairs: Vec<(String, String)> =
            passages.iter().map(|p| (question.to_string(), p.clone())).collect();
        let enc = self
            .m
            .tokenizer
            .encode_batch(pairs, true)
            .map_err(|e| format!("tokenizer: {e}"))?;
        let run = || -> candle_core::Result<Vec<f32>> {
            let (ids, types, mask) = ids_tensors(&self.m, &enc)?;
            let out = self.m.bert.forward(&ids, &types, Some(&mask))?;
            let cls = out.narrow(1, 0, 1)?.squeeze(1)?; // the [CLS] token
            let pooled = self.pooler.forward(&cls)?.tanh()?;
            self.classifier.forward(&pooled)?.squeeze(1)?.to_vec1::<f32>()
        };
        run().map_err(|e| format!("reranking: {e}"))
    }
}

/// Loaded once, then shared (each is about 90 MB in memory).
pub fn embedder(data_dir: &Path) -> Result<Arc<Embedder>, String> {
    static E: OnceLock<std::sync::Mutex<Option<Arc<Embedder>>>> = OnceLock::new();
    let cell = E.get_or_init(|| std::sync::Mutex::new(None));
    let mut slot = cell.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(e) = slot.as_ref() {
        return Ok(e.clone());
    }
    let e = Arc::new(Embedder::load(&dir_of(data_dir, &EMBEDDER))?);
    *slot = Some(e.clone());
    Ok(e)
}

pub fn reranker(data_dir: &Path) -> Result<Arc<Reranker>, String> {
    static R: OnceLock<std::sync::Mutex<Option<Arc<Reranker>>>> = OnceLock::new();
    let cell = R.get_or_init(|| std::sync::Mutex::new(None));
    let mut slot = cell.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(r) = slot.as_ref() {
        return Ok(r.clone());
    }
    let r = Arc::new(Reranker::load(&dir_of(data_dir, &RERANKER))?);
    *slot = Some(r.clone());
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_files(dir: &Path, files: &[&str]) {
        std::fs::create_dir_all(dir).unwrap();
        for f in files {
            std::fs::write(dir.join(f), b"x").unwrap();
        }
    }

    #[test]
    fn the_installers_copy_is_used_when_complete() {
        let tmp = tempfile::tempdir().unwrap();
        let (install, data) = (tmp.path().join("install/models"), tmp.path().join("data"));
        with_files(&install.join(EMBEDDER.name), &FILES);
        with_files(&install.join(RERANKER.name), &["config.json"]); // damaged: weights deleted

        assert_eq!(pick_dir(Some(&install), &data, &EMBEDDER), install.join(EMBEDDER.name));
        assert_eq!(pick_dir(Some(&install), &data, &RERANKER), data.join("models").join(RERANKER.name));
        assert_eq!(pick_dir(None, &data, &EMBEDDER), data.join("models").join(EMBEDDER.name));
    }

    /// The installer's models come from scripts/fetch-models.mjs, which reads the Spec
    /// constants from this file: keep them in the shape its parser expects.
    #[test]
    fn fetch_models_can_read_these_specs() {
        let src = include_str!("models.rs");
        let consts = src.lines().filter(|l| l.starts_with("pub const ") && l.ends_with(": Spec = Spec {"));
        assert_eq!(consts.count(), 2);
        for spec in [&EMBEDDER, &RERANKER] {
            for value in [spec.name, spec.repo, spec.rev, spec.weights_sha256] {
                assert!(src.contains(&format!("\"{value}\"")), "{value} must be a plain string literal");
            }
        }
    }
}
