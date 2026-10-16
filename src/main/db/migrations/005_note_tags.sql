-- Notes page: notes can carry tags (important / idea / review), stored as a JSON array.
ALTER TABLE notes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
