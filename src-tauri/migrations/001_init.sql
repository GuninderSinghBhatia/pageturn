CREATE TABLE books (
  id TEXT PRIMARY KEY,          -- content hash
  path TEXT NOT NULL,
  title TEXT, author TEXT,
  num_pages INTEGER,
  last_page INTEGER DEFAULT 1,
  added_at INTEGER, last_opened_at INTEGER
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT);
