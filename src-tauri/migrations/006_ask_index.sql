-- Ask the book, built into the app: one row per indexed book, one row per chunk.
-- Removing a book removes its index (foreign keys are on).
CREATE TABLE ask_books (
  book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  state      TEXT NOT NULL,          -- done | failed
  chunks     INTEGER NOT NULL DEFAULT 0,
  path       TEXT NOT NULL,          -- the file that was indexed (a moved book is indexed again)
  model      TEXT NOT NULL,          -- embedding model (a new model means indexing again)
  error      TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ask_chunks (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx     INTEGER NOT NULL,          -- order in the book
  page    INTEGER NOT NULL,          -- 1-based PDF page
  text    TEXT NOT NULL,
  vec     BLOB NOT NULL,             -- 384 little-endian f32, length 1 (so a dot product = cosine)
  PRIMARY KEY (book_id, idx)
);
