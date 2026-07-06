/**
 * SQLite schema for the nyc-council-mcp local index.
 * Adapted from WillHsiaoNYC/legistar-mcp schema.sql (SCHEMA_VERSION = 4).
 *
 * Uses FTS5 contentless indexes for compact storage (~100-200MB vs 300MB+).
 * Snippets are built at query-time by reading source JSON from the bills/events tables.
 */

// v5: dropped the events_fts FTS5 table + its triggers — searchEvents now uses
// a plain body_name LIKE filter. Existing local DBs keep working (the stale
// events_fts objects are simply unused); re-run `index --full` to rebuild clean.
export const SCHEMA_VERSION = 5;

export const CREATE_TABLES = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS index_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
  rowid        INTEGER PRIMARY KEY,
  matter_id    INTEGER NOT NULL UNIQUE,
  file_number  TEXT NOT NULL,
  title        TEXT NOT NULL,
  type_name    TEXT,
  status_name  TEXT,
  body_name    TEXT,
  intro_date   TEXT,
  passed_date  TEXT,
  enact_date   TEXT,
  sponsor_names TEXT,
  source_json  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS bills_intro_date ON bills (intro_date);
CREATE INDEX IF NOT EXISTS bills_body_name  ON bills (body_name);
CREATE INDEX IF NOT EXISTS bills_status     ON bills (status_name);

CREATE VIRTUAL TABLE IF NOT EXISTS bills_fts USING fts5(
  file_number,
  title,
  sponsor_names,
  content     = 'bills',
  content_rowid = 'rowid',
  tokenize    = 'porter ascii'
);

CREATE TRIGGER IF NOT EXISTS bills_ai AFTER INSERT ON bills BEGIN
  INSERT INTO bills_fts (rowid, file_number, title, sponsor_names)
    VALUES (new.rowid, new.file_number, new.title, new.sponsor_names);
END;

CREATE TRIGGER IF NOT EXISTS bills_ad AFTER DELETE ON bills BEGIN
  INSERT INTO bills_fts (bills_fts, rowid, file_number, title, sponsor_names)
    VALUES ('delete', old.rowid, old.file_number, old.title, old.sponsor_names);
END;

CREATE TRIGGER IF NOT EXISTS bills_au AFTER UPDATE ON bills BEGIN
  INSERT INTO bills_fts (bills_fts, rowid, file_number, title, sponsor_names)
    VALUES ('delete', old.rowid, old.file_number, old.title, old.sponsor_names);
  INSERT INTO bills_fts (rowid, file_number, title, sponsor_names)
    VALUES (new.rowid, new.file_number, new.title, new.sponsor_names);
END;

CREATE TABLE IF NOT EXISTS events (
  rowid         INTEGER PRIMARY KEY,
  event_id      INTEGER NOT NULL UNIQUE,
  date          TEXT NOT NULL,
  time          TEXT,
  body_name     TEXT,
  location      TEXT,
  agenda_status TEXT,
  source_json   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_date      ON events (date);
CREATE INDEX IF NOT EXISTS events_body_name ON events (body_name);

CREATE TABLE IF NOT EXISTS event_items (
  event_item_id INTEGER PRIMARY KEY,
  event_id      INTEGER NOT NULL,
  matter_id     INTEGER,
  file_number   TEXT,
  title         TEXT,
  action_name   TEXT,
  FOREIGN KEY (event_id) REFERENCES events (event_id)
);

CREATE INDEX IF NOT EXISTS event_items_event   ON event_items (event_id);
CREATE INDEX IF NOT EXISTS event_items_matter  ON event_items (matter_id);

CREATE TABLE IF NOT EXISTS people (
  person_id  INTEGER PRIMARY KEY,
  full_name  TEXT NOT NULL,
  first_name TEXT,
  last_name  TEXT,
  active_flag INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sponsors (
  matter_id  INTEGER NOT NULL,
  person_id  INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (matter_id, person_id)
);

CREATE INDEX IF NOT EXISTS sponsors_person ON sponsors (person_id);

CREATE TABLE IF NOT EXISTS votes (
  vote_id       INTEGER PRIMARY KEY,
  event_item_id INTEGER NOT NULL,
  person_id     INTEGER,
  person_name   TEXT,
  vote_value    TEXT,
  matter_id     INTEGER
);

CREATE INDEX IF NOT EXISTS votes_event_item ON votes (event_item_id);
CREATE INDEX IF NOT EXISTS votes_person     ON votes (person_id);
CREATE INDEX IF NOT EXISTS votes_matter     ON votes (matter_id);
`;

export const SET_SCHEMA_VERSION = `
  INSERT OR REPLACE INTO index_state (key, value) VALUES ('schema_version', ?)
`;

export const SET_ARCHIVE_ROOT = `
  INSERT OR REPLACE INTO index_state (key, value) VALUES ('archive_root', ?)
`;

export const GET_LAST_INDEXED = `
  SELECT value FROM index_state WHERE key = 'last_indexed_at'
`;

export const SET_LAST_INDEXED = `
  INSERT OR REPLACE INTO index_state (key, value) VALUES ('last_indexed_at', ?)
`;
