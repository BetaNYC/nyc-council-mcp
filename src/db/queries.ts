/**
 * SQL query functions for all SQLite-backed tools.
 * All functions take a better-sqlite3 Database and return plain objects.
 */

import type Database from "better-sqlite3";
import { resolveAgencyPhrases, extractSnippet } from "../agencies.js";
import { nyDateString } from "../dates.js";
import { legistarUrl } from "../legistar.js";

// ---------------------------------------------------------------------------
// Helper: build a safe FTS5 MATCH expression from user input
// ---------------------------------------------------------------------------

/**
 * Tokenize a user query into AND-ed FTS5 terms.
 *
 * - Explicit quoted phrases in the input are preserved as phrase matches.
 * - Bare words become individual quoted tokens (implicit AND in FTS5), so
 *   "public housing" matches bills containing both words — the old behavior
 *   wrapped the whole query in quotes, forcing an exact-phrase match.
 * - Every term is wrapped in double quotes (with internal quotes doubled),
 *   which neutralizes FTS5 operator/special characters so arbitrary user
 *   input can't crash MATCH.
 *
 * Returns "" for an effectively empty query — callers should short-circuit.
 */
export function buildFtsQuery(query: string): string {
  const terms: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const raw = (m[1] !== undefined ? m[1] : m[2]).trim();
    if (!raw) continue;
    terms.push(`"${raw.replace(/"/g, '""')}"`);
  }
  return terms.join(" ");
}

// ---------------------------------------------------------------------------
// Types returned by query functions
// ---------------------------------------------------------------------------

export interface BillRow {
  matter_id: number;
  file_number: string;
  title: string;
  type_name: string | null;
  status_name: string | null;
  body_name: string | null;
  intro_date: string | null;
  passed_date: string | null;
  sponsor_names: string | null;
  // Human-openable Legistar link (Introductions only; null otherwise) — see legistarUrl.
  legistar_url: string | null;
  snippet?: string | null;
}

export interface EventRow {
  event_id: number;
  date: string;
  time: string | null;
  body_name: string | null;
  location: string | null;
  agenda_status: string | null;
}

export interface CommitteeRow {
  body_name: string;
  bill_count: number;
  event_count: number;
}

export interface VoteRow {
  person_name: string | null;
  person_id: number | null;
  vote_value: string | null;
}

export interface PersonVoteRow {
  file_number: string | null;
  title: string | null;
  intro_date: string | null;
  vote_value: string | null;
  event_item_id: number;
  legistar_url: string | null;
}

export interface CoSponsorRow {
  person_name: string;
  person_id: number;
  shared_bills: number;
}

export interface EventItemRow {
  event_item_id: number;
  event_id: number;
  file_number: string | null;
  title: string | null;
  action_name: string | null;
  date: string | null;
  body_name: string | null;
  legistar_url: string | null;
}

// ---------------------------------------------------------------------------
// Helper: extract text from source_json for snippet building
// ---------------------------------------------------------------------------

function titleFromJson(sourceJson: string): string {
  try {
    const obj = JSON.parse(sourceJson) as Record<string, unknown>;
    return (obj.MatterTitle as string) || (obj.MatterName as string) || "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// search_bills / search_legislation
// ---------------------------------------------------------------------------

export function searchBills(
  db: Database.Database,
  query: string,
  opts: { limit?: number; agency?: string; status?: string; committee?: string } = {}
): BillRow[] {
  const limit = opts.limit ?? 25;
  const agencyPhrases = opts.agency ? resolveAgencyPhrases(opts.agency) : [];

  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  let sql = `
    SELECT b.matter_id, b.file_number, b.title, b.type_name, b.status_name,
           b.body_name, b.intro_date, b.passed_date, b.sponsor_names,
           b.source_json
    FROM bills_fts
    JOIN bills b ON bills_fts.rowid = b.rowid
    WHERE bills_fts MATCH ?
  `;
  const params: (string | number)[] = [ftsQuery];

  // The agency parameter filters results (as the tool description promises),
  // not just snippet decoration: keep rows whose title or sponsor list
  // mentions any of the agency's known phrases.
  if (agencyPhrases.length > 0) {
    const clause = agencyPhrases
      .map(() => "(b.title LIKE ? OR b.sponsor_names LIKE ?)")
      .join(" OR ");
    sql += ` AND (${clause})`;
    for (const phrase of agencyPhrases) {
      params.push(`%${phrase}%`, `%${phrase}%`);
    }
  }

  if (opts.status) {
    sql += " AND b.status_name LIKE ?";
    params.push(`%${opts.status}%`);
  }
  if (opts.committee) {
    sql += " AND b.body_name LIKE ?";
    params.push(`%${opts.committee}%`);
  }

  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as (BillRow & { source_json: string })[];

  return rows.map((row) => {
    let snippet: string | null = null;
    if (agencyPhrases.length > 0) {
      const text = titleFromJson(row.source_json) || row.title;
      snippet = extractSnippet(text, agencyPhrases);
    }
    const { source_json: _src, ...rest } = row;
    return { ...rest, legistar_url: legistarUrl(rest.file_number), snippet };
  });
}

// ---------------------------------------------------------------------------
// search_events
// ---------------------------------------------------------------------------

export function searchEvents(
  db: Database.Database,
  query: string,
  opts: { limit?: number; days_ahead?: number } = {}
): EventRow[] {
  const limit = opts.limit ?? 25;
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  let sql = `
    SELECT e.event_id, e.date, e.time, e.body_name, e.location, e.agenda_status
    FROM events_fts
    JOIN events e ON events_fts.rowid = e.rowid
    WHERE events_fts MATCH ?
  `;
  const params: (string | number)[] = [ftsQuery];

  if (opts.days_ahead !== undefined) {
    const cutoff = new Date(Date.now() + opts.days_ahead * 24 * 60 * 60 * 1000);
    sql += " AND e.date <= ?";
    params.push(nyDateString(cutoff));
  }

  sql += " ORDER BY e.date DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params) as EventRow[];
}

// ---------------------------------------------------------------------------
// list_committees
// ---------------------------------------------------------------------------

export function listCommittees(db: Database.Database): CommitteeRow[] {
  return db
    .prepare(
      `
      SELECT
        b.body_name,
        COUNT(DISTINCT b.matter_id) AS bill_count,
        COUNT(DISTINCT e.event_id)  AS event_count
      FROM bills b
      LEFT JOIN events e ON e.body_name = b.body_name
      WHERE b.body_name IS NOT NULL
      GROUP BY b.body_name
      ORDER BY bill_count DESC
    `
    )
    .all() as CommitteeRow[];
}

// ---------------------------------------------------------------------------
// recent_bills
// ---------------------------------------------------------------------------

export function recentBills(
  db: Database.Database,
  opts: { days?: number; limit?: number } = {}
): BillRow[] {
  const days = opts.days ?? 30;
  const limit = opts.limit ?? 50;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = db
    .prepare(
      `
      SELECT matter_id, file_number, title, type_name, status_name, body_name,
             intro_date, passed_date, sponsor_names
      FROM bills
      WHERE intro_date >= ?
      ORDER BY intro_date DESC
      LIMIT ?
    `
    )
    .all(nyDateString(cutoff), limit) as Omit<BillRow, "legistar_url">[];
  return rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.file_number) }));
}

// ---------------------------------------------------------------------------
// upcoming_events
// ---------------------------------------------------------------------------

export function upcomingEvents(
  db: Database.Database,
  opts: { days?: number; limit?: number } = {}
): EventRow[] {
  const days = opts.days ?? 14;
  const limit = opts.limit ?? 50;
  const today = nyDateString();
  const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  return db
    .prepare(
      `
      SELECT event_id, date, time, body_name, location, agenda_status
      FROM events
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
      LIMIT ?
    `
    )
    .all(today, nyDateString(future), limit) as EventRow[];
}

// ---------------------------------------------------------------------------
// aggregate_bills
// ---------------------------------------------------------------------------

export interface AggregateBillsResult {
  group_by: string;
  results: { label: string; count: number }[];
}

export function aggregateBills(
  db: Database.Database,
  groupBy: "status" | "type" | "committee" | "year"
): AggregateBillsResult {
  const colMap: Record<string, string> = {
    status: "status_name",
    type: "type_name",
    committee: "body_name",
    year: "SUBSTR(intro_date, 1, 4)",
  };

  const col = colMap[groupBy] ?? "status_name";
  const rows = db
    .prepare(
      `SELECT ${col} AS label, COUNT(*) AS count
       FROM bills
       WHERE ${col === "SUBSTR(intro_date, 1, 4)" ? "intro_date" : col} IS NOT NULL
       GROUP BY ${col}
       ORDER BY count DESC`
    )
    .all() as { label: string; count: number }[];

  return { group_by: groupBy, results: rows };
}

// ---------------------------------------------------------------------------
// vote_breakdown
// ---------------------------------------------------------------------------

export function voteBreakdown(db: Database.Database, fileNumber: string): VoteRow[] {
  return db
    .prepare(
      `
      SELECT v.person_name, v.person_id, v.vote_value
      FROM votes v
      JOIN event_items ei ON v.event_item_id = ei.event_item_id
      WHERE ei.file_number = ?
      ORDER BY v.vote_value, v.person_name
    `
    )
    .all(fileNumber) as VoteRow[];
}

// ---------------------------------------------------------------------------
// get_voting_record
// ---------------------------------------------------------------------------

export function getVotingRecord(
  db: Database.Database,
  memberName: string,
  opts: { limit?: number } = {}
): PersonVoteRow[] {
  const limit = opts.limit ?? 50;
  const rows = db
    .prepare(
      `
      SELECT ei.file_number, ei.title, b.intro_date, v.vote_value, v.event_item_id
      FROM votes v
      JOIN event_items ei ON v.event_item_id = ei.event_item_id
      LEFT JOIN bills b ON ei.matter_id = b.matter_id
      WHERE v.person_name LIKE ?
      ORDER BY b.intro_date DESC
      LIMIT ?
    `
    )
    .all(`%${memberName}%`, limit) as Omit<PersonVoteRow, "legistar_url">[];
  return rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.file_number) }));
}

// ---------------------------------------------------------------------------
// co_sponsors
// ---------------------------------------------------------------------------

export function coSponsors(
  db: Database.Database,
  memberName: string,
  opts: { limit?: number } = {}
): CoSponsorRow[] {
  const limit = opts.limit ?? 20;

  // Find the person_id first
  const person = db
    .prepare("SELECT person_id FROM people WHERE full_name LIKE ? LIMIT 1")
    .get(`%${memberName}%`) as { person_id: number } | undefined;

  if (!person) return [];

  return db
    .prepare(
      `
      SELECT p.full_name AS person_name, p.person_id, COUNT(*) AS shared_bills
      FROM sponsors s1
      JOIN sponsors s2 ON s1.matter_id = s2.matter_id AND s2.person_id != s1.person_id
      JOIN people p ON s2.person_id = p.person_id
      WHERE s1.person_id = ?
      GROUP BY s2.person_id
      ORDER BY shared_bills DESC
      LIMIT ?
    `
    )
    .all(person.person_id, limit) as CoSponsorRow[];
}

// ---------------------------------------------------------------------------
// get_bill_hearings
// ---------------------------------------------------------------------------

export function getBillHearings(
  db: Database.Database,
  fileNumber: string
): EventItemRow[] {
  const rows = db
    .prepare(
      `
      SELECT ei.event_item_id, ei.event_id, ei.file_number, ei.title, ei.action_name,
             e.date, e.body_name
      FROM event_items ei
      JOIN events e ON ei.event_id = e.event_id
      WHERE ei.file_number = ?
      ORDER BY e.date DESC
    `
    )
    .all(fileNumber) as Omit<EventItemRow, "legistar_url">[];
  return rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.file_number) }));
}

// ---------------------------------------------------------------------------
// get_event_bills
// ---------------------------------------------------------------------------

export interface EventBillRow {
  event_item_id: number;
  file_number: string | null;
  title: string | null;
  action_name: string | null;
  status_name: string | null;
  legistar_url: string | null;
}

export function getEventBills(
  db: Database.Database,
  eventId: number
): EventBillRow[] {
  const rows = db
    .prepare(
      `
      SELECT ei.event_item_id, ei.file_number, ei.title, ei.action_name,
             b.status_name
      FROM event_items ei
      LEFT JOIN bills b ON ei.matter_id = b.matter_id
      WHERE ei.event_id = ?
      ORDER BY ei.event_item_id
    `
    )
    .all(eventId) as Omit<EventBillRow, "legistar_url">[];
  return rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.file_number) }));
}
