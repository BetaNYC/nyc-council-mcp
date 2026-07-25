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

// One member's entry in a roll call. vote_value is a position (Affirmative /
// Negative / Abstain) OR a non-position reason for not casting one (Absent,
// Excused, Medical, …) — see CONTEXT.md. Stored faithfully; only tallies filter.
export interface VoteRow {
  person_id: number | null;
  person_name: string | null;
  vote_value: string | null;
  event_item_id: number;
  matter_id: number;
}

// A tally counts positions ONLY. Never COUNT(*) the rows — an Absent entry is a
// row but not a vote cast (issue #30 acceptance: the Res 0540-2026 committee
// roll call is 14–1, not 17).
export interface Tally {
  affirmative: number;
  negative: number;
  abstain: number;
}

// The complete set of member entries for one event item — one roll call.
export interface RollCall {
  event_item_id: number;
  body_name: string | null;   // acting body — full Council vs a committee
  action_name: string | null;
  date: string | null;
  recorded: number;           // total entries (positions + non-positions)
  tally: Tally;               // positions only
  votes: VoteRow[];           // every entry, faithfully — positions AND non-positions
}

// vote_breakdown result: a matter can be decided in more than one roll call
// (e.g. committee then full Council), so roll calls are first-class rather than
// flattened into one list where committee and Council entries blur together.
export interface VoteBreakdownResult {
  file_number: string;
  matter_id: number | null;
  roll_calls: RollCall[];
}

// One action in a matter's timeline, for get_bill_history (local path).
export interface MatterHistoryRow {
  action_name: string | null;
  action_date: string | null;
  body_name: string | null;
  event_id: number | null;
  event_item_id: number | null;
  passed_flag: string | null;
}

export interface BillHistoryResult {
  file_number: string;
  matter_id: number | null;
  history: MatterHistoryRow[];
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
// votes table guard (issue #19)
// ---------------------------------------------------------------------------

/**
 * Guidance returned when a vote tool is asked a question the local corpus
 * cannot answer because the `votes` table is empty.
 *
 * An empty array from a tool named `get_voting_record` is indistinguishable
 * from a true negative — a caller reads `[]` as "this member cast no votes." In
 * a transparency tool that is the worst available failure mode, so the query
 * functions stop and explain the gap rather than answer with `[]`.
 *
 * Provenance, corrected by issue #30: per-member positions ARE in the archive —
 * each matter's `History[].Votes[]` carries Affirmative / Negative / Abstain
 * alongside non-position reasons (Absent, Excused, Medical, …). They are indexed
 * by the current schema (>= 5). An empty table therefore means the corpus was
 * built before vote indexing and needs a rebuild — not that the data is missing.
 */
export const VOTES_NOT_INDEXED_MESSAGE =
  "Vote data is not indexed in this corpus: the 'votes' table is empty, so " +
  "vote_breakdown and get_voting_record have nothing to read. They stop here rather " +
  "than return an empty list, which is indistinguishable from a member who cast no " +
  "votes. Per-member positions ARE in the source archive — each matter's History[] " +
  "carries the roll call — so this corpus predates vote indexing (schema < 5). Fix: " +
  "rebuild the local index (nyc-council-mcp index --archive <path> --db <path>), which " +
  "populates votes and matter_history from History[]. For live data without a rebuild, " +
  "get_votes returns per-member positions for an EventItemId from the Legistar API " +
  "(requires LEGISTAR_TOKEN).";

// ponytail: only the populated result is cached, so an empty table is re-checked
// (a LIMIT 1 probe, not a COUNT) and a later re-index starts working without a
// server restart. WeakSet so a closed db is not retained.
const votesKnownPopulated = new WeakSet<Database.Database>();

function assertVotesIndexed(db: Database.Database): void {
  if (votesKnownPopulated.has(db)) return;
  if (!db.prepare("SELECT 1 FROM votes LIMIT 1").get()) {
    throw new Error(VOTES_NOT_INDEXED_MESSAGE);
  }
  votesKnownPopulated.add(db);
}

// ---------------------------------------------------------------------------
// File-number → matter resolution (shared by the file-number tools)
// ---------------------------------------------------------------------------

/**
 * Resolve a file number to a single matter, or throw naming the ambiguity.
 *
 * `bills.file_number` is type-prefixed ("Int 0540-2026", "Res 0540-2026"), so a
 * bare "0540-2026" is NOT unique — it matches both. Silently returning one
 * type's data for a query that matches both is the #27 defect class. A
 * type-prefixed input matches exactly one matter (exact match); a bare number
 * suffix-matches every prefix, and >1 match is rejected with every file number
 * named so the caller re-asks with the prefix.
 *
 * Returns null when nothing matches (an unknown file number, not an error).
 */
function resolveMatter(
  db: Database.Database,
  fileNumber: string
): { matter_id: number; file_number: string } | null {
  const trimmed = fileNumber.trim();
  // Suffix match: "% 0540-2026" catches "Int 0540-2026"/"Res 0540-2026" but not
  // a mid-string coincidence (the leading space anchors it). Escape LIKE
  // metacharacters in user input so a stray % cannot widen the match.
  const suffix = "% " + trimmed.replace(/[\\%_]/g, (c) => "\\" + c);
  const rows = db
    .prepare(
      `SELECT DISTINCT matter_id, file_number FROM bills
       WHERE file_number = ? OR file_number LIKE ? ESCAPE '\\'`
    )
    .all(trimmed, suffix) as { matter_id: number; file_number: string }[];

  if (rows.length === 0) return null;
  if (rows.length > 1) {
    const files = rows.map((r) => r.file_number).join(", ");
    throw new Error(
      `Ambiguous file number "${fileNumber}": it matches ${rows.length} matters — ${files}. ` +
        `Re-call with the exact type-prefixed file number (e.g. "${rows[0].file_number}").`
    );
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// vote_breakdown
// ---------------------------------------------------------------------------

/**
 * Every roll call for a matter, grouped by event item. A matter can be decided
 * more than once (committee, then full Council), so each roll call is returned
 * separately with its own position-only tally — never a flat list where the two
 * blur together, and never a COUNT(*) that would score an Absent as a vote.
 */
export function voteBreakdown(db: Database.Database, fileNumber: string): VoteBreakdownResult {
  assertVotesIndexed(db);
  const matter = resolveMatter(db, fileNumber);
  if (!matter) return { file_number: fileNumber, matter_id: null, roll_calls: [] };

  // Roll-call context (body, action, date) comes from matter_history keyed on
  // (matter_id, event_item_id) — the SAME History[] row that carried the votes.
  // No event_items join, so this is unaffected by #26's NULL file_number linkage.
  const rows = db
    .prepare(
      `
      SELECT v.person_id, v.person_name, v.vote_value, v.event_item_id, v.matter_id,
             mh.body_name, mh.action_name, mh.action_date
      FROM votes v
      LEFT JOIN matter_history mh
        ON mh.matter_id = v.matter_id AND mh.event_item_id = v.event_item_id
      WHERE v.matter_id = ?
      ORDER BY mh.action_date, v.event_item_id, v.vote_value, v.person_name
    `
    )
    .all(matter.matter_id) as Array<
      VoteRow & { body_name: string | null; action_name: string | null; action_date: string | null }
    >;

  const byRollCall = new Map<number, RollCall>();
  for (const r of rows) {
    let rc = byRollCall.get(r.event_item_id);
    if (!rc) {
      rc = {
        event_item_id: r.event_item_id,
        body_name: r.body_name,
        action_name: r.action_name,
        date: r.action_date,
        recorded: 0,
        tally: { affirmative: 0, negative: 0, abstain: 0 },
        votes: [],
      };
      byRollCall.set(r.event_item_id, rc);
    }
    rc.votes.push({
      person_id: r.person_id,
      person_name: r.person_name,
      vote_value: r.vote_value,
      event_item_id: r.event_item_id,
      matter_id: r.matter_id,
    });
    rc.recorded++;
    if (r.vote_value === "Affirmative") rc.tally.affirmative++;
    else if (r.vote_value === "Negative") rc.tally.negative++;
    else if (r.vote_value === "Abstain") rc.tally.abstain++;
  }

  return { file_number: matter.file_number, matter_id: matter.matter_id, roll_calls: [...byRollCall.values()] };
}

// ---------------------------------------------------------------------------
// get_voting_record
// ---------------------------------------------------------------------------

export function getVotingRecord(
  db: Database.Database,
  memberName: string,
  opts: { limit?: number } = {}
): PersonVoteRow[] {
  assertVotesIndexed(db);
  const limit = opts.limit ?? 50;
  // votes → bills on matter_id (columns that are populated), NOT event_items on
  // file_number (NULL in every row until #26). person_name is the recorded name,
  // so historical members resolve even if absent from the people table (#30).
  const rows = db
    .prepare(
      `
      SELECT b.file_number, b.title, b.intro_date, v.vote_value, v.event_item_id
      FROM votes v
      JOIN bills b ON v.matter_id = b.matter_id
      WHERE v.person_name LIKE ?
      ORDER BY b.intro_date DESC
      LIMIT ?
    `
    )
    .all(`%${memberName}%`, limit) as Omit<PersonVoteRow, "legistar_url">[];
  return rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.file_number) }));
}

// ---------------------------------------------------------------------------
// get_bill_history (local path — answers from matter_history, no token)
// ---------------------------------------------------------------------------

/**
 * A matter's action timeline from the local corpus, chronological (oldest
 * first). Accepts a file number like its sibling tools and disambiguates a bare
 * number the same way vote_breakdown does. No votes guard: a matter legitimately
 * has history with no roll calls.
 */
export function getBillHistoryLocal(db: Database.Database, fileNumber: string): BillHistoryResult {
  const matter = resolveMatter(db, fileNumber);
  if (!matter) return { file_number: fileNumber, matter_id: null, history: [] };
  const history = db
    .prepare(
      `
      SELECT action_name, action_date, body_name, event_id, event_item_id, passed_flag
      FROM matter_history
      WHERE matter_id = ?
      ORDER BY action_date ASC, rowid ASC
    `
    )
    .all(matter.matter_id) as MatterHistoryRow[];
  return { file_number: matter.file_number, matter_id: matter.matter_id, history };
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
