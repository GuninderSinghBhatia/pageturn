-- Reader redesign: highlights gain a style (highlight / underline / wavy / note).
ALTER TABLE highlights ADD COLUMN style TEXT NOT NULL DEFAULT 'highlight';
