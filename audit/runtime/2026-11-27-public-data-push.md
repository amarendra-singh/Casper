# Public repository release of remaining project files

## Scope and decision

- On 2026-11-27 the user requested that everything remaining be pushed to the Casper repository, and explicitly confirmed that business files may be published publicly.
- GitHub lists `amarendra-singh/Casper` as a public repository. The working tree began at `04b20e6`, with no tracked modifications and 1,006 untracked files before filtering generated caches and private database originals.
- Remaining project material included audit scripts and evidence, frontend screenshots, design assets, historical source archives, settlement spreadsheets, Majnu catalogue workbooks, and database backups.

## Data handling

- The raw SQLite databases include four users and password hashes. Original database files, the raw Majnu pre-deletion backup archive, the runtime `.env`, temporary caches, and a saved chat transcript stay local. The original files were not modified.
- `audit/export_public_snapshots.py` exported 15 public database snapshots. It preserves business tables and row counts, replaces user names and email addresses, disables every account, replaces password hashes with unusable markers, removes token blacklist history, vacuums the files, and checks SQLite integrity and foreign keys. It also replaces the database inside the pre-deletion ZIP while retaining its uploaded P&L workbooks.
- The remaining untracked files and ZIP contents were scanned for private-key markers, GitHub/AWS tokens, JWT patterns, and the local runtime secret. No matches were found in files selected for publication. This scan does not certify that business records are anonymous; public release of business files was explicitly authorized.

## Verification and push

- Staged 550 files. No non-ignored untracked files remain, and the staged set contains no runtime `.env`, raw SQLite database or backup, raw pre-deletion archive, generated cache, log, or chat transcript.
- Regenerated and verified all 15 credential-disabled database snapshots: 50 user accounts disabled across historical copies, SQLite quick checks passed, source business-table row counts matched, and the public archive retained the same three entries as the original. The exporter compiled successfully.
- The new exporter, ignore rules, release log, and tracker entry pass `git diff --check`. Older archived reports and scripts retain historical trailing whitespace; their content was preserved rather than rewritten for formatting.
- `git fetch origin main` confirmed the remote had not moved. Commit and remote hash check are pending.
- First push attempt was rejected by automatic approval review because three newly committed archived audit scripts contained a hardcoded login password. No files from that commit reached the remote. The scripts now require credentials from environment variables; the historical audit report and source archive have that password redacted. The unpublished commit is being amended before retrying.
