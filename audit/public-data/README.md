# Public business-data snapshots

These are copies of Casper's local SQLite snapshots and the pre-deletion archive. The export preserves business tables but disables every user account, replaces user names and email addresses, replaces password hashes with unusable markers, and removes token blacklist history. The original databases remain local.

Regenerate with `python audit/export_public_snapshots.py` from the repository root. `manifest.json` lists the sources and outputs. This is an intentionally public data release; do not use these files as a production authentication database.
