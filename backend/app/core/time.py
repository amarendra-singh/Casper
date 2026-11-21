"""UTC timestamps compatible with the project's existing naive UTC columns."""

from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
