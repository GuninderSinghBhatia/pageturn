PageTurn: models for "Ask the book"

These two small AI models run on this computer, on the CPU. Ask uses them to search a book;
your book's text never leaves your computer for this step.

all-MiniLM-L6-v2/         https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
    Turns each passage of a book into numbers, so a question can find the passages that
    mean the same thing.

ms-marco-MiniLM-L6-v2/    https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2
    Checks which of those passages really answer the question.

Deleting this folder doesn't break PageTurn: Ask downloads the models again (about 180 MB)
the next time you use it.
