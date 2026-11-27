//! The LLM provider layer. Explain (and its follow-ups) generates only through
//! [`Provider::stream`]; which provider runs is the reader's choice in Settings. Ask the book and
//! Who is this? still generate inside the RAG service; moving their generation here (the service
//! returning only the retrieved passages) is the next step. Retrieval stays in the RAG service.
//!
//! Providers:
//! - API key (`commands::ai::ApiKeyProvider`): Anthropic, OpenAI or Gemini with the reader's own
//!   key, kept encrypted on this computer.
//! - Claude plan ([`claude_code::ClaudeCodeProvider`]): the reader's own installed Claude Code
//!   CLI, signed in with their Claude subscription. PageTurn never sees that sign-in: it runs
//!   the official CLI and reads its output.
//! - ChatGPT plan ([`chatgpt::ChatGptProvider`]): OpenAI's "Sign in with ChatGPT" plan usage for
//!   open-source local apps; PageTurn holds the OAuth tokens, encrypted like API keys.
pub mod chatgpt;
pub mod claude_code;

use crate::commands::ai::{ChatMessage, ProviderErr};
use futures_util::future::BoxFuture;
use std::time::Duration;

/// Receives each piece of text as it arrives.
pub type OnToken<'a> = &'a mut (dyn FnMut(&str) + Send);

/// What to generate from: instructions plus the conversation so far (last message = the ask).
#[derive(Debug, Clone)]
pub struct Prompt {
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

pub trait Provider: Send + Sync {
    /// Streams the reply to `prompt`, calling `on_token` with each piece of text. Dropping the
    /// returned future cancels the request.
    fn stream<'a>(
        &'a self,
        prompt: &'a Prompt,
        on_token: OnToken<'a>,
    ) -> BoxFuture<'a, Result<(), ProviderErr>>;

    /// The longest one reply may take before the run is reported as timed out.
    fn timeout(&self) -> Duration {
        Duration::from_secs(30)
    }
}
