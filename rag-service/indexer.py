"""Background indexing: the app sends every book it adds, and they are indexed one at a time.

The app calls POST /index for each book after an import and again at every start (so books added
while this service was off get indexed too). Books that are already indexed are skipped. A book
that fails (for example a scanned PDF with no text layer) is remembered in data/index_failed.json
so it is not retried at every start, unless its path changes or the app asks to retry.

State lives in this process: "queued" / "indexing" while it runs, then "done" or "failed".
"""
import json
import queue
import threading
from pathlib import Path

FAILED_FILE = Path(__file__).parent / "data" / "index_failed.json"

_lock = threading.Lock()
_jobs: "queue.Queue[tuple[str, str]]" = queue.Queue()
_status: dict[str, dict] = {}  # book id -> {"state", "done", "total", "error"?}
_worker: threading.Thread | None = None


def _default_is_indexed(book_id: str) -> bool:
    import ask

    return ask.resolve_book(book_id) is not None


def _default_index(book_id: str, path: str, progress) -> int:
    import ask
    from index_book import index_book

    return index_book(book_id, path, ask.collection, ask.model, progress=progress)


# Replaceable in tests (no model, no Chroma).
is_indexed = _default_is_indexed
index_fn = _default_index


def _failed() -> dict:
    try:
        return json.loads(FAILED_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_failed(data: dict) -> None:
    FAILED_FILE.parent.mkdir(parents=True, exist_ok=True)
    FAILED_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _set(book_id: str, **fields) -> None:
    with _lock:
        _status[book_id] = {**_status.get(book_id, {}), **fields}


def status(book_id: str) -> dict:
    """{"state": "missing" | "queued" | "indexing" | "done" | "failed", "done", "total", "error"?}"""
    with _lock:
        live = _status.get(book_id)
        if live:
            return dict(live)
    if is_indexed(book_id):
        return {"state": "done", "done": 0, "total": 0}
    failed = _failed().get(book_id)
    if failed:
        return {"state": "failed", "done": 0, "total": 0, "error": failed["error"]}
    return {"state": "missing", "done": 0, "total": 0}


def enqueue(book_id: str, path: str, retry: bool = False) -> dict:
    """Queues a book unless it is indexed, already queued, or failed before (same file)."""
    with _lock:
        live = _status.get(book_id)
        if live and live["state"] in ("queued", "indexing"):
            return dict(live)
    if is_indexed(book_id):
        return status(book_id)
    failed = _failed().get(book_id)
    if failed and failed.get("path") == path and not retry:
        return status(book_id)
    if not Path(path).is_file():
        # Not remembered as a failure: the drive may just be disconnected right now.
        return {"state": "failed", "done": 0, "total": 0, "error": "The book's file was not found."}
    _set(book_id, state="queued", done=0, total=0, error=None)
    _jobs.put((book_id, path))
    _start_worker()
    return status(book_id)


def run_one(timeout: float | None = None) -> bool:
    """Indexes the next queued book; False when the queue stayed empty."""
    try:
        book_id, path = _jobs.get(timeout=timeout)
    except queue.Empty:
        return False
    _set(book_id, state="indexing")
    try:
        n = index_fn(book_id, path, lambda done, total: _set(book_id, done=done, total=total))
        _set(book_id, state="done", done=n, total=n)
        failed = _failed()
        if failed.pop(book_id, None) is not None:
            _save_failed(failed)
    except Exception as e:  # any failure is reported to the app, never crashes the worker
        message = str(e) or type(e).__name__
        _set(book_id, state="failed", error=message)
        failed = _failed()
        failed[book_id] = {"path": path, "error": message}
        _save_failed(failed)
    finally:
        _jobs.task_done()
    return True


def _loop() -> None:
    while True:
        run_one()


def _start_worker() -> None:
    global _worker
    with _lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_loop, name="indexer", daemon=True)
            _worker.start()
