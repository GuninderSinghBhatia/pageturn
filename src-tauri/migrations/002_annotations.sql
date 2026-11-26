-- Annotations (spec §6). Coordinates are normalized 0..1 page units.
CREATE TABLE highlights (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER, rects_json TEXT, text TEXT, color TEXT, note_id TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE notes (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER, anchor_json TEXT, body TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE ink_strokes (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER, points_blob BLOB, color TEXT, width REAL, tool TEXT, created_at INTEGER);
CREATE TABLE bookmarks (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  page INTEGER, label TEXT, created_at INTEGER);
CREATE INDEX idx_hl_book_page ON highlights(book_id, page);
CREATE INDEX idx_notes_book_page ON notes(book_id, page);
CREATE INDEX idx_ink_book_page ON ink_strokes(book_id, page);
CREATE INDEX idx_bm_book ON bookmarks(book_id);

-- Full-text index over note bodies (external content), kept in sync by triggers.
CREATE VIRTUAL TABLE notes_fts USING fts5(body, content='notes', content_rowid='rowid');
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO notes_fts(rowid, body) VALUES (new.rowid, new.body);
END;

-- "Remove from library" without deleting annotations hides the book; re-import un-hides it.
ALTER TABLE books ADD COLUMN removed_at INTEGER;
