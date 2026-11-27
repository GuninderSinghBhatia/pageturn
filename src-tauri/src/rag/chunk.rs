//! Splits page text into chunks exactly like the Python service: LangChain's
//! `RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)` with its defaults
//! (separators "\n\n", "\n", " ", "", separator kept at the start of the next piece, whitespace
//! stripped, length counted in characters). Same chunks means the Python evals still describe
//! the app. `testdata/splitter_cases.json` holds LangChain's own output for comparison.

pub const CHUNK_SIZE: usize = 500;
pub const CHUNK_OVERLAP: usize = 100;
const SEPARATORS: [&str; 4] = ["\n\n", "\n", " ", ""];

fn len(s: &str) -> usize {
    s.chars().count()
}

/// Splits on `sep`, keeping each separator at the start of the piece after it; drops empties.
fn split_keep_start(text: &str, sep: &str) -> Vec<String> {
    if sep.is_empty() {
        return text.chars().map(String::from).collect();
    }
    let mut parts = text.split(sep);
    let mut out: Vec<String> = parts.next().map(str::to_string).into_iter().collect();
    out.extend(parts.map(|p| format!("{sep}{p}")));
    out.retain(|s| !s.is_empty());
    out
}

fn join(docs: &[String]) -> Option<String> {
    // The separator is "" because it was kept on the pieces; Python's str.strip() trims.
    let text = docs.concat();
    let t = text.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// Packs small pieces into chunks up to CHUNK_SIZE, carrying up to CHUNK_OVERLAP characters
/// from the end of one chunk into the next.
fn merge(splits: &[String]) -> Vec<String> {
    let mut docs = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut total = 0usize;
    for d in splits {
        let n = len(d);
        if total + n > CHUNK_SIZE {
            if !current.is_empty() {
                if let Some(doc) = join(&current) {
                    docs.push(doc);
                }
                while total > CHUNK_OVERLAP || (total + n > CHUNK_SIZE && total > 0) {
                    total -= len(&current[0]);
                    current.remove(0);
                }
            }
        }
        current.push(d.clone());
        total += n;
    }
    if let Some(doc) = join(&current) {
        docs.push(doc);
    }
    docs
}

fn split_recursive(text: &str, separators: &[&str]) -> Vec<String> {
    let mut separator = *separators.last().unwrap_or(&"");
    let mut rest: &[&str] = &[];
    for (i, s) in separators.iter().enumerate() {
        if s.is_empty() {
            separator = s;
            break;
        }
        if text.contains(s) {
            separator = s;
            rest = &separators[i + 1..];
            break;
        }
    }
    let mut chunks = Vec::new();
    let mut good: Vec<String> = Vec::new();
    for s in split_keep_start(text, separator) {
        if len(&s) < CHUNK_SIZE {
            good.push(s);
            continue;
        }
        if !good.is_empty() {
            chunks.extend(merge(&good));
            good.clear();
        }
        if rest.is_empty() {
            chunks.push(s);
        } else {
            chunks.extend(split_recursive(&s, rest));
        }
    }
    if !good.is_empty() {
        chunks.extend(merge(&good));
    }
    chunks
}

/// The chunks of one page's text.
pub fn split_text(text: &str) -> Vec<String> {
    split_recursive(text, &SEPARATORS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        name: String,
        text: String,
        chunks: Vec<String>,
    }

    #[test]
    fn matches_langchain_on_every_case() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("testdata/splitter_cases.json")).unwrap();
        assert!(cases.len() > 10);
        for c in cases {
            assert_eq!(split_text(&c.text), c.chunks, "case {:?}", c.name);
        }
    }

    #[test]
    fn chunks_overlap_and_stay_under_the_size() {
        let text = "word ".repeat(400);
        let chunks = split_text(&text);
        assert!(chunks.len() > 3);
        assert!(chunks.iter().all(|c| c.chars().count() <= CHUNK_SIZE));
        let end_of_first: String = chunks[0].chars().rev().take(20).collect();
        let end_of_first: String = end_of_first.chars().rev().collect();
        assert!(chunks[1].contains(end_of_first.trim()));
    }
}
