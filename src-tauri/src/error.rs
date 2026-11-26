//! One error type for every command. It reaches the UI as a plain string, so `invoke`
//! rejects with the message (PageTurn 1.x rejected with an Error of the same text).

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error("Not available in the Tauri build yet: {0}")]
    NotImplemented(&'static str),
    #[error("Unknown book")]
    UnknownBook,
    #[error("Book file is missing: {0}")]
    BookMissing(String),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Rejects a payload that fails validation (the zod schemas' job in PageTurn 1.x).
pub fn invalid(what: impl std::fmt::Display) -> AppError {
    AppError::Msg(format!("Invalid input: {what}"))
}
