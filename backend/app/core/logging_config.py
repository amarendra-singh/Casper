"""
Casper Logging Configuration
─────────────────────────────
4 log files, all linked by request_id:

  logs/app.log     — startup, general events, info
  logs/access.log  — every HTTP request: method, path, status, duration
  logs/error.log   — all ERROR+ from every logger (full traceback)
  logs/pnl.log     — PnL uploads, parsing, SKU matching, variance

Format:
  2026-04-12 14:32:01 | INFO  | [a3f9c1b2] | casper.pnl | Uploaded report id=1, matched=69
  2026-04-12 14:32:01 | ERROR | [a3f9c1b2] | casper.app | Unhandled exception ...
"""

import logging
import logging.handlers
import os
from contextvars import ContextVar
from pathlib import Path

# ── Request ID context (set per-request by middleware) ───────────────────────
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


# ── Custom filter: injects request_id into every log record ─────────────────
class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get("-")
        return True


# ── Log format ───────────────────────────────────────────────────────────────
LOG_FORMAT = "%(asctime)s | %(levelname)-5s | [%(request_id)s] | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)
_req_filter = RequestIdFilter()


def _make_handler(path: str, level: int = logging.DEBUG) -> logging.handlers.RotatingFileHandler:
    """Create a rotating file handler (5 MB max, 3 backups)."""
    handler = logging.handlers.RotatingFileHandler(
        path,
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=3,
        encoding="utf-8",
    )
    handler.setLevel(level)
    handler.setFormatter(_formatter)
    handler.addFilter(_req_filter)
    return handler


def _make_console_handler(level: int = logging.DEBUG) -> logging.StreamHandler:
    handler = logging.StreamHandler()
    handler.setLevel(level)
    handler.setFormatter(_formatter)
    handler.addFilter(_req_filter)
    return handler


def setup_logging(log_dir: str = "logs", dev: bool = True) -> None:
    """
    Call once at app startup.
    dev=True  → also prints to console
    dev=False → file only
    """
    Path(log_dir).mkdir(parents=True, exist_ok=True)

    # ── Root casper logger (parent of all casper.*) ──────────────────────────
    root = logging.getLogger("casper")
    root.setLevel(logging.DEBUG)
    root.propagate = False  # don't bubble up to Python root logger

    # error.log — catches ERROR+ from every casper.* logger
    root.addHandler(_make_handler(os.path.join(log_dir, "error.log"), logging.ERROR))

    if dev:
        root.addHandler(_make_console_handler(logging.INFO))

    # ── casper.app → app.log ─────────────────────────────────────────────────
    app_log = logging.getLogger("casper.app")
    app_log.addHandler(_make_handler(os.path.join(log_dir, "app.log"), logging.INFO))

    # ── casper.access → access.log ───────────────────────────────────────────
    access_log = logging.getLogger("casper.access")
    access_log.addHandler(_make_handler(os.path.join(log_dir, "access.log"), logging.INFO))

    # ── casper.pnl → pnl.log ─────────────────────────────────────────────────
    pnl_log = logging.getLogger("casper.pnl")
    pnl_log.addHandler(_make_handler(os.path.join(log_dir, "pnl.log"), logging.DEBUG))


# ── Named loggers (import these in other modules) ───────────────────────────
app_logger    = logging.getLogger("casper.app")
access_logger = logging.getLogger("casper.access")
pnl_logger    = logging.getLogger("casper.pnl")
