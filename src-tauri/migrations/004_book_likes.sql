-- Home page: books can be liked (heart on the card).
ALTER TABLE books ADD COLUMN liked INTEGER NOT NULL DEFAULT 0;
