/**
 * Archive walker and SQLite indexer.
 * Adapted from WillHsiaoNYC/legistar-mcp bulk.py and build.py.
 *
 * Walks jehiah/nyc_legislation archive directories:
 *   introduction/{year}/*.json  → bills
 *   events/{year}/*.json        → events + event_items + votes
 *   people/*.json               → people + sponsors
 *
 * Supports incremental (default) and full rebuild modes.
 */

import Sqlite from "better-sqlite3";
import fg from "fast-glob";
import { readFileSync, statSync } from "fs";
import { join, basename } from "path";
import {
  CREATE_TABLES,
  SCHEMA_VERSION,
  SET_SCHEMA_VERSION,
  SET_ARCHIVE_ROOT,
  SET_LAST_INDEXED,
  GET_LAST_INDEXED,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Types matching jehiah/nyc_legislation JSON shape
// ---------------------------------------------------------------------------

interface MatterJson {
  MatterId?: number;
  MatterFile?: string;
  MatterName?: string;
  MatterTitle?: string;
  MatterTypeName?: string;
  MatterStatusName?: string;
  MatterBodyName?: string;
  MatterIntroDate?: string | null;
  MatterPassedDate?: string | null;
  MatterEnactmentDate?: string | null;
  MatterSponsorNames?: string | null;
  // Sponsors may be embedded as an array
  Sponsors?: Array<{
    MatterSponsorNameId?: number;
    MatterSponsorName?: string;
    MatterSponsorSequence?: number;
  }>;
}

interface EventJson {
  EventId?: number;
  EventDate?: string;
  EventTime?: string;
  EventBodyName?: string;
  EventLocation?: string;
  EventAgendaStatusName?: string;
  EventItems?: Array<{
    EventItemId?: number;
    EventItemMatterId?: number | null;
    EventItemMatterFile?: string | null;
    EventItemMatterName?: string | null;
    EventItemActionName?: string | null;
    EventItemPassedFlagName?: string | null;
    Votes?: Array<{
      VoteId?: number;
      VotePersonId?: number;
      VotePersonName?: string;
      VoteValueName?: string;
    }>;
  }>;
}

interface PersonJson {
  PersonId?: number;
  PersonFullName?: string;
  PersonFirstName?: string;
  PersonLastName?: string;
  PersonActiveFlag?: number;
}

// ---------------------------------------------------------------------------
// Index statistics returned to caller
// ---------------------------------------------------------------------------

export interface IndexStats {
  bills: number;
  events: number;
  people: number;
  skipped: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Open / initialise database
// ---------------------------------------------------------------------------

export function openDatabase(dbPath: string): Sqlite.Database {
  const db = new Sqlite(dbPath);
  db.exec(CREATE_TABLES);
  db.prepare(SET_SCHEMA_VERSION).run(String(SCHEMA_VERSION));
  return db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeRead(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function safeParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function isoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Legistar dates arrive as "2024-01-15T00:00:00" or "2024-01-15"
  return raw.slice(0, 10) || null;
}

// ---------------------------------------------------------------------------
// Index bills (introduction/{year}/*.json)
// ---------------------------------------------------------------------------

function indexBills(
  db: Sqlite.Database,
  archiveRoot: string,
  since: Date | null,
  stats: IndexStats
): void {
  const upsert = db.prepare(`
    INSERT INTO bills
      (matter_id, file_number, title, type_name, status_name, body_name,
       intro_date, passed_date, enact_date, sponsor_names, source_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (matter_id) DO UPDATE SET
      file_number   = excluded.file_number,
      title         = excluded.title,
      type_name     = excluded.type_name,
      status_name   = excluded.status_name,
      body_name     = excluded.body_name,
      intro_date    = excluded.intro_date,
      passed_date   = excluded.passed_date,
      enact_date    = excluded.enact_date,
      sponsor_names = excluded.sponsor_names,
      source_json   = excluded.source_json
  `);

  const upsertSponsor = db.prepare(`
    INSERT OR IGNORE INTO sponsors (matter_id, person_id, is_primary) VALUES (?, ?, ?)
  `);

  const insertBillBatch = db.transaction((files: string[]) => {
    for (const filePath of files) {
      if (since) {
        try {
          const mtime = statSync(filePath).mtime;
          if (mtime <= since) {
            stats.skipped++;
            continue;
          }
        } catch {
          // Stat failed; process anyway
        }
      }

      const raw = safeRead(filePath);
      if (!raw) {
        stats.errors++;
        continue;
      }

      const matter = safeParse<MatterJson>(raw);
      if (!matter || !matter.MatterId) {
        stats.errors++;
        continue;
      }

      try {
        upsert.run(
          matter.MatterId,
          matter.MatterFile ?? basename(filePath, ".json"),
          matter.MatterTitle || matter.MatterName || "",
          matter.MatterTypeName ?? null,
          matter.MatterStatusName ?? null,
          matter.MatterBodyName ?? null,
          isoDate(matter.MatterIntroDate),
          isoDate(matter.MatterPassedDate),
          isoDate(matter.MatterEnactmentDate),
          matter.MatterSponsorNames ?? null,
          raw
        );

        // Index inline sponsors if present
        if (Array.isArray(matter.Sponsors)) {
          for (const sponsor of matter.Sponsors) {
            if (sponsor.MatterSponsorNameId) {
              upsertSponsor.run(
                matter.MatterId,
                sponsor.MatterSponsorNameId,
                sponsor.MatterSponsorSequence === 1 ? 1 : 0
              );
            }
          }
        }

        stats.bills++;
      } catch {
        stats.errors++;
      }
    }
  });

  const pattern = join(archiveRoot, "introduction", "**", "*.json");
  const files = fg.sync(pattern, { absolute: true });

  // Process in chunks to avoid holding too many file handles
  const CHUNK = 500;
  for (let i = 0; i < files.length; i += CHUNK) {
    insertBillBatch(files.slice(i, i + CHUNK));
  }
}

// ---------------------------------------------------------------------------
// Index events (events/{year}/*.json)
// ---------------------------------------------------------------------------

function indexEvents(
  db: Sqlite.Database,
  archiveRoot: string,
  since: Date | null,
  stats: IndexStats
): void {
  const upsertEvent = db.prepare(`
    INSERT INTO events
      (event_id, date, time, body_name, location, agenda_status, source_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (event_id) DO UPDATE SET
      date          = excluded.date,
      time          = excluded.time,
      body_name     = excluded.body_name,
      location      = excluded.location,
      agenda_status = excluded.agenda_status,
      source_json   = excluded.source_json
  `);

  const upsertItem = db.prepare(`
    INSERT OR REPLACE INTO event_items
      (event_item_id, event_id, matter_id, file_number, title, action_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const upsertVote = db.prepare(`
    INSERT OR IGNORE INTO votes
      (vote_id, event_item_id, person_id, person_name, vote_value, matter_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertEventBatch = db.transaction((files: string[]) => {
    for (const filePath of files) {
      if (since) {
        try {
          const mtime = statSync(filePath).mtime;
          if (mtime <= since) {
            stats.skipped++;
            continue;
          }
        } catch {}
      }

      const raw = safeRead(filePath);
      if (!raw) {
        stats.errors++;
        continue;
      }

      const event = safeParse<EventJson>(raw);
      if (!event || !event.EventId) {
        stats.errors++;
        continue;
      }

      try {
        upsertEvent.run(
          event.EventId,
          isoDate(event.EventDate) ?? "",
          event.EventTime ?? null,
          event.EventBodyName ?? null,
          event.EventLocation ?? null,
          event.EventAgendaStatusName ?? null,
          raw
        );

        if (Array.isArray(event.EventItems)) {
          for (const item of event.EventItems) {
            if (!item.EventItemId) continue;
            upsertItem.run(
              item.EventItemId,
              event.EventId,
              item.EventItemMatterId ?? null,
              item.EventItemMatterFile ?? null,
              item.EventItemMatterName ?? null,
              item.EventItemActionName ?? null
            );

            if (Array.isArray(item.Votes)) {
              for (const vote of item.Votes) {
                if (!vote.VoteId) continue;
                upsertVote.run(
                  vote.VoteId,
                  item.EventItemId,
                  vote.VotePersonId ?? null,
                  vote.VotePersonName ?? null,
                  vote.VoteValueName ?? null,
                  item.EventItemMatterId ?? null
                );
              }
            }
          }
        }

        stats.events++;
      } catch {
        stats.errors++;
      }
    }
  });

  const pattern = join(archiveRoot, "events", "**", "*.json");
  const files = fg.sync(pattern, { absolute: true });

  const CHUNK = 200;
  for (let i = 0; i < files.length; i += CHUNK) {
    insertEventBatch(files.slice(i, i + CHUNK));
  }
}

// ---------------------------------------------------------------------------
// Index people (people/*.json)
// ---------------------------------------------------------------------------

function indexPeople(
  db: Sqlite.Database,
  archiveRoot: string,
  stats: IndexStats
): void {
  const upsert = db.prepare(`
    INSERT INTO people (person_id, full_name, first_name, last_name, active_flag)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (person_id) DO UPDATE SET
      full_name   = excluded.full_name,
      first_name  = excluded.first_name,
      last_name   = excluded.last_name,
      active_flag = excluded.active_flag
  `);

  const insertPeopleBatch = db.transaction((files: string[]) => {
    for (const filePath of files) {
      const raw = safeRead(filePath);
      if (!raw) continue;
      const person = safeParse<PersonJson>(raw);
      if (!person?.PersonId) continue;

      try {
        upsert.run(
          person.PersonId,
          person.PersonFullName ?? "",
          person.PersonFirstName ?? null,
          person.PersonLastName ?? null,
          person.PersonActiveFlag ?? 1
        );
        stats.people++;
      } catch {
        stats.errors++;
      }
    }
  });

  const pattern = join(archiveRoot, "people", "*.json");
  const files = fg.sync(pattern, { absolute: true });
  insertPeopleBatch(files);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface IndexOptions {
  archiveRoot: string;
  dbPath: string;
  full?: boolean;
  verbose?: boolean;
}

export async function buildIndex(opts: IndexOptions): Promise<IndexStats> {
  const stats: IndexStats = { bills: 0, events: 0, people: 0, skipped: 0, errors: 0 };

  const db = openDatabase(opts.dbPath);

  // Determine incremental cutoff
  let since: Date | null = null;
  if (!opts.full) {
    const row = db.prepare(GET_LAST_INDEXED).get() as { value: string } | undefined;
    if (row?.value) {
      since = new Date(row.value);
      if (opts.verbose) {
        console.error(`Incremental mode: processing files modified after ${row.value}`);
      }
    }
  }

  if (opts.verbose) {
    console.error(
      since
        ? `Running incremental index (since ${since.toISOString()})…`
        : "Running full index…"
    );
  }

  // Record archive root
  db.prepare(SET_ARCHIVE_ROOT).run(opts.archiveRoot);

  // Mark start time before indexing so we don't miss concurrent writes
  const startedAt = new Date().toISOString();

  // Index in order: people first (needed for sponsor FK integrity), then bills, then events
  if (opts.verbose) process.stderr.write("Indexing people… ");
  indexPeople(db, opts.archiveRoot, stats);
  if (opts.verbose) console.error(`${stats.people} people`);

  if (opts.verbose) process.stderr.write("Indexing bills… ");
  indexBills(db, opts.archiveRoot, since, stats);
  if (opts.verbose) console.error(`${stats.bills} bills`);

  if (opts.verbose) process.stderr.write("Indexing events… ");
  indexEvents(db, opts.archiveRoot, since, stats);
  if (opts.verbose) console.error(`${stats.events} events`);

  // Update last_indexed_at
  db.prepare(SET_LAST_INDEXED).run(startedAt);

  db.close();
  return stats;
}
