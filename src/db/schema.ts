/**
 * SQLite schema for the nyc-council-mcp local index.
 * Adapted from WillHsiaoNYC/legistar-mcp schema.sql (SCHEMA_VERSION = 4).
 *
 * Uses FTS5 contentless indexes for compact storage (~100-200MB vs 300MB+).
 * Snippets are built at query-time by reading source JSON from the bills/events tables.
 */

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

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  body_name,
  content     = 'events',
  content_rowid = 'rowid',
  tokenize    = 'porter ascii'
);

CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts (rowid, body_name) VALUES (new.rowid, new.body_name);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts (events_fts, rowid, body_name)
    VALUES ('delete', old.rowid, old.body_name);
END;

CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
  INSERT INTO events_fts (events_fts, rowid, body_name)
    VALUES ('delete', old.rowid, old.body_name);
  INSERT INTO events_fts (rowid, body_name) VALUES (new.rowid, new.body_name);
END;

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

-- One row per member entry in a roll call, sourced from a matter's
-- History[].Votes (issue #30). The natural key is (event_item_id, person_id):
-- unique within a roll call, and idempotent on re-index. The archive has no
-- per-vote row id — History[].Votes[].VoteID is a VALUE id (15 = Affirmative),
-- not a row id — so the previous vote_id PRIMARY KEY had no source and is gone.
-- A member appears once per roll call but across several roll calls of the same
-- matter (e.g. committee then full Council), so person_id alone is not unique.
CREATE TABLE IF NOT EXISTS votes (
  event_item_id INTEGER NOT NULL,   -- History[].ID (the Legistar EventItemId)
  person_id     INTEGER NOT NULL,   -- History[].Votes[].ID (the VotePersonId)
  person_name   TEXT,               -- FullName as recorded, for historical members
  vote_value    TEXT,               -- position OR non-position reason (see CONTEXT.md)
  matter_id     INTEGER,            -- link to bills.matter_id (no event_items dependency)
  PRIMARY KEY (event_item_id, person_id)
);

CREATE INDEX IF NOT EXISTS votes_person ON votes (person_id);
CREATE INDEX IF NOT EXISTS votes_matter ON votes (matter_id);

-- One row per action in a matter's History[] (issue #30) — the matter's
-- timeline. Most actions carry no roll call; those still get a row here with no
-- corresponding votes. event_item_id is History[].ID (nullable: a few procedural
-- actions carry none). passed_flag is History[].PassedFlagName ('Pass'/'Fail'),
-- absent on non-outcome actions (hearings, referrals) and therefore nullable.
CREATE TABLE IF NOT EXISTS matter_history (
  matter_id     INTEGER NOT NULL,
  event_item_id INTEGER,
  action_name   TEXT,
  action_date   TEXT,               -- full ISO timestamp, so same-day actions order correctly
  body_name     TEXT,               -- the acting body (Council vs a committee)
  event_id      INTEGER,
  passed_flag   TEXT,
  PRIMARY KEY (matter_id, event_item_id)
);

CREATE INDEX IF NOT EXISTS matter_history_matter ON matter_history (matter_id);
`;

// Data tables dropped-and-recreated on a full rebuild. CREATE_TABLES uses
// CREATE TABLE IF NOT EXISTS, so a DDL change to an existing table (e.g. the
// votes primary-key change in schema v5) is otherwise silently ignored on a
// corpus that already has the old table. buildIndex runs these DROPs before
// re-running CREATE_TABLES whenever it forces a full rebuild, so the current
// schema is actually applied. index_state is intentionally NOT dropped — it
// holds schema_version / indexed_sources, which the full-rebuild decision reads.
// FTS virtual tables are dropped explicitly; SQLite drops a base table's
// triggers with it.
export const DROP_DATA_TABLES = `
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS matter_history;
DROP TABLE IF EXISTS event_items;
DROP TABLE IF EXISTS sponsors;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS bills_fts;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS events_fts;
DROP TABLE IF EXISTS events;
`;

export const GET_SCHEMA_VERSION = `
  SELECT value FROM index_state WHERE key = 'schema_version'
`;

export const SET_SCHEMA_VERSION = `
  INSERT OR REPLACE INTO index_state (key, value) VALUES ('schema_version', ?)
`;

export const GET_ARCHIVE_ROOT = `
  SELECT value FROM index_state WHERE key = 'archive_root'
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

// The set of matter trees (MATTER_DIRS) that the last successful index walked,
// stored so a later run can detect that coverage widened and force a full
// rebuild (issue #32). Absent on any corpus built before this tracking existed.
export const GET_INDEXED_SOURCES = `
  SELECT value FROM index_state WHERE key = 'indexed_sources'
`;

export const SET_INDEXED_SOURCES = `
  INSERT OR REPLACE INTO index_state (key, value) VALUES ('indexed_sources', ?)
`;
