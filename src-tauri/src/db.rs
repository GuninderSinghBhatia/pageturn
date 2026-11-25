//! SQLite connection and migrations. The migration files are the SAME ones the Electron
//! build uses (`src/main/db/migrations`); each NNN_name.sql moves `user_version` to NNN.

use rusqlite::Connection;
use std::path::Path;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../src/main/db/migrations/001_init.sql")),
    (
        2,
        include_str!("../../src/main/db/migrations/002_annotations.sql"),
    ),
    (
        3,
        include_str!("../../src/main/db/migrations/003_reader_redesign.sql"),
    ),
    (
        4,
        include_str!("../../src/main/db/migrations/004_book_likes.sql"),
    ),
    (
        5,
        include_str!("../../src/main/db/migrations/005_note_tags.sql"),
    ),
];

/// Opens (creating if needed) the database and brings it up to the latest migration.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(path)?;
    prepare(conn)
}

/// In-memory database with all migrations applied (tests).
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    prepare(Connection::open_in_memory()?)
}

fn prepare(mut conn: Connection) -> rusqlite::Result<Connection> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    let current: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (version, sql) in MIGRATIONS {
        if *version <= current {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_every_migration_including_fts5() {
        let conn = open_in_memory().unwrap();
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 5);
        conn.execute(
            "INSERT INTO books (id, path, added_at) VALUES ('b', 'x.pdf', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, book_id, page, anchor_json, body, created_at, updated_at)
             VALUES ('n', 'b', 1, '{}', 'hello world', 1, 1)",
            [],
        )
        .unwrap();
        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM notes_fts WHERE notes_fts MATCH 'hello'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }

    #[test]
    fn reopening_does_not_rerun_migrations() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.db");
        open(&p).unwrap();
        open(&p).unwrap();
    }
}
