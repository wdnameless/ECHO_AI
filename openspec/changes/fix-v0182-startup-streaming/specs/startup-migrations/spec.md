## ADDED Requirements

### Requirement: Database Migrations Checksum & LF Invariance
The SQLite database migration scripts (versions 1 through 4) MUST maintain byte-level consistency regardless of filesystem host line endings (CRLF vs LF). Checksums expected by `tauri-plugin-sql` MUST match the deployed migrations.

#### Scenario: Existing DB with migration 4 launches without data loss
- **Given** an existing `pluely.db` SQLite database already at migration version 4 with populated system prompts, chat history, RAG contexts, and self-evolution records
- **When** the application starts and initializes the database connection
- **Then** the database migrations check passes with 0 pending migrations
- **And** all existing tables and data rows remain intact without truncation or loss

#### Scenario: SQL LF/checksum lock prevents mismatch errors
- **Given** migration SQL files in `src-tauri/src/db/migrations/`
- **When** files are compiled into the binary
- **Then** line endings are normalized to LF (`\n`) and match the recorded schema checksums
