//! A PDF's text, one string per page (page 1 first), read in pure Rust.
//!
//! The reading runs in a short-lived helper: PageTurn starts itself again with
//! `--pageturn-extract-pdf <path>`, and the helper prints the pages as JSON. Release builds
//! abort on a panic, and a PDF library can panic on an unusual file; in a helper that only
//! fails this one book instead of closing the app.
use std::path::Path;
use std::process::{Command, Stdio};

pub const EXTRACT_FLAG: &str = "--pageturn-extract-pdf";

/// One line break per line and one space between words, like PyMuPDF's text (what the Python
/// service chunks). pdf-extract leaves a blank line after every line when lines are widely
/// spaced; the splitter cuts at blank lines first, so its chunks came out different.
pub fn tidy(page: &str) -> String {
    let mut out = String::with_capacity(page.len());
    for c in page.chars() {
        let last = out.chars().next_back();
        match c {
            '\n' if matches!(last, None | Some('\n')) => {}
            ' ' if matches!(last, None | Some(' ') | Some('\n')) => {}
            '\n' if last == Some(' ') => {
                out.pop();
                out.push('\n');
            }
            _ => out.push(c),
        }
    }
    out
}

/// In the helper process: prints the pages of `path` as a JSON array of strings.
pub fn run_helper(path: &str) -> i32 {
    match pdf_extract::extract_text_by_pages(path) {
        Ok(pages) => {
            let pages: Vec<String> = pages.iter().map(|p| tidy(p)).collect();
            println!("{}", serde_json::to_string(&pages).unwrap_or_else(|_| "[]".into()));
            0
        }
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}

pub fn page_texts(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Err(format!("the book's file is missing: {}", path.display()));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.arg(EXTRACT_FLAG)
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("could not read the PDF: {e}"))?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr);
        let why = why.lines().last().unwrap_or("unsupported PDF").trim();
        return Err(format!("could not read the PDF's text ({why})"));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("could not read the PDF's text: {e}"))
}

#[cfg(test)]
mod tests {
    use pdf_extract::{Dictionary, Document, Object, Stream};

    fn name(n: &str) -> Object {
        Object::Name(n.as_bytes().to_vec())
    }

    const TO_UNICODE: &str = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n\
        /CMapName /Test def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\n\
        endcodespacerange\n2 beginbfchar\n<0001> <0061>\n<0002> <0062>\nendbfchar\nendcmap\n\
        CMapName currentdict /CMap defineresource pop\nend\nend\n";

    /// One page that draws "ab" one glyph at a time (as many converted books do), in a CID
    /// font whose width for "a" is given as a range (`1 1 500`) and for "b" as a list.
    fn page_with_range_width() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let to_unicode = doc.add_object(Stream::new(Dictionary::new(), TO_UNICODE.into()));
        let mut descriptor = Dictionary::new();
        descriptor.set("Type", name("FontDescriptor"));
        descriptor.set("FontName", name("Test"));
        let descriptor = doc.add_object(descriptor);

        let mut cid = Dictionary::new();
        cid.set("Type", name("Font"));
        cid.set("Subtype", name("CIDFontType2"));
        cid.set("BaseFont", name("Test"));
        cid.set("FontDescriptor", descriptor);
        cid.set("DW", Object::Integer(0));
        let int = Object::Integer;
        cid.set("W", vec![int(1), int(1), int(500), int(2), Object::Array(vec![int(500)])]);
        let cid = doc.add_object(cid);

        let mut font = Dictionary::new();
        font.set("Type", name("Font"));
        font.set("Subtype", name("Type0"));
        font.set("BaseFont", name("Test"));
        font.set("Encoding", name("Identity-H"));
        font.set("DescendantFonts", vec![Object::Reference(cid)]);
        font.set("ToUnicode", to_unicode);
        let font = doc.add_object(font);

        // "a" at x=10 is 0.5 em = 5 wide at size 10, so "b" starts right where "a" ends.
        let content = b"BT /F1 10 Tf 1 0 0 1 10 700 Tm <0001> Tj 5 0 Td <0002> Tj ET".to_vec();
        let content = doc.add_object(Stream::new(Dictionary::new(), content));
        let mut fonts = Dictionary::new();
        fonts.set("F1", font);
        let mut resources = Dictionary::new();
        resources.set("Font", fonts);

        let pages = doc.new_object_id();
        let mut page = Dictionary::new();
        page.set("Type", name("Page"));
        page.set("Parent", pages);
        page.set("MediaBox", vec![int(0), int(0), int(612), int(792)]);
        page.set("Resources", resources);
        page.set("Contents", content);
        let page = doc.add_object(page);
        let mut tree = Dictionary::new();
        tree.set("Type", name("Pages"));
        tree.set("Kids", vec![Object::Reference(page)]);
        tree.set("Count", int(1));
        doc.objects.insert(pages, Object::Dictionary(tree));
        let mut catalog = Dictionary::new();
        catalog.set("Type", name("Catalog"));
        catalog.set("Pages", pages);
        let catalog = doc.add_object(catalog);
        doc.trailer.set("Root", catalog);

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn tidy_keeps_one_break_per_line_and_one_space_per_gap() {
        assert_eq!(super::tidy("\n\nLet’s say  the\n\nmodel \n\n\nhas"), "Let’s say the\nmodel\nhas");
        assert_eq!(super::tidy(""), "");
    }

    /// pdf-extract 0.9.0 ignored widths given as a range, so it put a space after "a" here
    /// ("dif ferent" across a whole book). Guards the patch in vendor/pdf-extract.
    #[test]
    fn widths_given_as_a_range_keep_words_whole() {
        let pages = pdf_extract::extract_text_from_mem_by_pages(&page_with_range_width()).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].trim(), "ab");
    }
}
