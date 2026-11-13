/**
 * SQL query functions for all SQLite-backed tools.
 * All functions take a better-sqlite3 Database and return plain objects.
 */

import type Database from "better-sqlite3";
import { resolveAgencyPhrases, extractSnippet } from "../agencies.js";
import { nyDateString } from "../dates.js";
import { legistarUrl } from "../legistar.js";
import { nameMatches, normalizeName } from "../names.js";
import { classifyBody, ROLE_ORDER, type Role } from "../roles.js";
export { classifyBody };

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
  // Human-openable Legistar link (any matter type; null with no matter id) — see legistarUrl.
  legistar_url: string | null;
  // #31: "*" is the original text, "A"/"B"… an amended version. local_law is
  // set only for enacted legislation (e.g. "2025/153"), otherwise null.
  version?: string | null;
  local_law?: string | null;
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
  matter_id: number | null;
  file_number: string | null;
  title: string | null;
  // The bill's introduction date (Legistar MatterIntroDate), NOT the vote date.
  intro_date: string | null;
  vote_value: string | null;
  event_item_id: number;
  // When, where and what the vote was: the matter_history action this roll
  // call belongs to (#41). Full ISO timestamp.
  vote_date: string | null;
  vote_action: string | null;
  vote_body: string | null;
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
  matter_id: number | null;
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

  const v6 = hasMatterAttributes(db);
  let sql = `
    SELECT b.matter_id, b.file_number, b.title, b.type_name, b.status_name,
           b.body_name, b.intro_date, b.passed_date, b.sponsor_names,
           ${v6 ? "b.version, b.local_law," : "NULL AS version, NULL AS local_law,"}
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

  // #31 widened the index to summary and full text. Weight the columns so a
  // title or file-number hit still outranks a word buried in a long body text,
  // and queries that worked before keep their order: file_number, title,
  // sponsor_names, summary, text.
  sql += v6 ? " ORDER BY bm25(bills_fts, 10.0, 10.0, 5.0, 2.0, 1.0) LIMIT ?" : " ORDER BY rank LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as (BillRow & { source_json: string })[];

  return rows.map((row) => {
    let snippet: string | null = null;
    if (agencyPhrases.length > 0) {
      const text = titleFromJson(row.source_json) || row.title;
      snippet = extractSnippet(text, agencyPhrases);
    }
    const { source_json: _src, ...rest } = row;
    return { ...rest, legistar_url: legistarUrl(rest.matter_id), snippet };
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
  return rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.matter_id) }));
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
  // Match the typed name against each distinct recorded name in code, so middle
  // initials, odd spacing and accents don't hide a member (#40; see names.ts).
  const names = (db.prepare("SELECT DISTINCT person_name FROM votes").all() as { person_name: string | null }[])
    .map((r) => r.person_name)
    .filter((n): n is string => nameMatches(memberName, n));
  if (names.length === 0) return [];
  const rows = db
    .prepare(
      `
      SELECT b.matter_id, b.file_number, b.title, b.intro_date, v.vote_value, v.event_item_id,
             mh.action_date AS vote_date, mh.action_name AS vote_action, mh.body_name AS vote_body
      FROM votes v
      JOIN bills b ON v.matter_id = b.matter_id
      LEFT JOIN matter_history mh
        ON mh.matter_id = v.matter_id AND mh.event_item_id = v.event_item_id
      WHERE v.person_name IN (SELECT value FROM json_each(?))
      -- Newest VOTE first (#41). Was the bill's intro date, which put a 2024
      -- bill voted on in 2026 among the old votes.
      ORDER BY mh.action_date DESC, b.intro_date DESC
      LIMIT ?
    `
    )
    .all(JSON.stringify(names), limit) as Omit<PersonVoteRow, "legistar_url">[];
  return rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.matter_id) }));
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
  // Name matched in code, not with LIKE: see names.ts (#40).
  const person = (db.prepare("SELECT person_id, full_name FROM people ORDER BY person_id").all() as {
    person_id: number;
    full_name: string;
  }[]).find((p) => nameMatches(memberName, p.full_name));

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
      SELECT ei.event_item_id, ei.event_id, ei.matter_id, ei.file_number, ei.title, ei.action_name,
             e.date, e.body_name
      FROM event_items ei
      JOIN events e ON ei.event_id = e.event_id
      WHERE ei.file_number = ?
      ORDER BY e.date DESC
    `
    )
    .all(fileNumber) as Omit<EventItemRow, "legistar_url">[];
  return rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.matter_id) }));
}

// ---------------------------------------------------------------------------
// get_event_bills
// ---------------------------------------------------------------------------

export interface EventBillRow {
  event_item_id: number;
  matter_id: number | null;
  file_number: string | null;
  title: string | null;
  action_name: string | null;
  status_name: string | null;
  legistar_url: string | null;
}

export interface EventBillsPage {
  event_id: number;
  total: number;
  offset: number;
  limit: number;
  items: EventBillRow[];
}

// Paged (#29): one stated meeting has ~178 agenda items (~85 KB), so the
// default page is 50 and the total says whether there is more.
export function getEventBills(
  db: Database.Database,
  eventId: number,
  opts: { limit?: number; offset?: number } = {}
): EventBillsPage {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const { total } = db
    .prepare("SELECT COUNT(*) AS total FROM event_items WHERE event_id = ?")
    .get(eventId) as { total: number };
  const rows = db
    .prepare(
      `
      SELECT ei.event_item_id, ei.matter_id, ei.file_number, ei.title, ei.action_name,
             b.status_name
      FROM event_items ei
      LEFT JOIN bills b ON ei.matter_id = b.matter_id
      WHERE ei.event_id = ?
      ORDER BY ei.event_item_id
      LIMIT ? OFFSET ?
    `
    )
    .all(eventId, limit, offset) as Omit<EventBillRow, "legistar_url">[];
  return {
    event_id: eventId,
    total,
    offset,
    limit,
    items: rows.map((r) => ({ ...r, legistar_url: legistarUrl(r.matter_id) })),
  };
}

// ---------------------------------------------------------------------------
// Matter attributes (#31): schema check and get_matter
// ---------------------------------------------------------------------------

const matterAttrsKnown = new WeakMap<Database.Database, boolean>();

/**
 * True when the corpus was built under schema v6 (bills has the generated
 * columns). A corpus built by older code keeps working until the next index
 * run rebuilds it: search returns null version/local_law, and get_matter says
 * to re-index.
 */
export function hasMatterAttributes(db: Database.Database): boolean {
  const known = matterAttrsKnown.get(db);
  if (known !== undefined) return known;
  const cols = db.prepare("PRAGMA table_xinfo(bills)").all() as { name: string }[];
  const ok = cols.some((c) => c.name === "local_law");
  matterAttrsKnown.set(db, ok);
  return ok;
}

export const MATTER_ATTRS_NOT_INDEXED_MESSAGE =
  "This index was built before matter text, summaries, Local Law numbers and attachments " +
  "were indexed (schema v6). Re-run `nyc-council-mcp index`; it rebuilds in full automatically.";

export interface MatterAttachmentRow {
  attachment_id: number;
  name: string | null;
  link: string | null;
  sort: number | null;
  last_modified: string | null;
}

export interface MatterRecord {
  matter_id: number;
  file_number: string;
  title: string;
  type_name: string | null;
  status_name: string | null;
  body_name: string | null;
  intro_date: string | null;
  passed_date: string | null;
  enact_date: string | null;
  sponsor_names: string | null;
  version: string | null;
  local_law: string | null;
  summary: string | null;
  legistar_url: string | null;
  attachments: MatterAttachmentRow[];
  text?: string | null;
}

/** One matter with its attributes and attachments, by file number or Local Law number. */
export function getMatter(
  db: Database.Database,
  opts: { file_number?: string; local_law?: string; include_text?: boolean }
): MatterRecord | null {
  if (!hasMatterAttributes(db)) throw new Error(MATTER_ATTRS_NOT_INDEXED_MESSAGE);
  let matterId: number | null = null;
  if (opts.file_number) {
    matterId = resolveMatter(db, opts.file_number)?.matter_id ?? null;
  } else if (opts.local_law) {
    const row = db
      .prepare("SELECT matter_id FROM bills WHERE local_law = ? LIMIT 1")
      .get(opts.local_law.trim()) as { matter_id: number } | undefined;
    matterId = row?.matter_id ?? null;
  }
  if (matterId == null) return null;
  const m = db
    .prepare(
      `SELECT matter_id, file_number, title, type_name, status_name, body_name,
              intro_date, passed_date, enact_date, sponsor_names,
              version, local_law, summary${opts.include_text ? ", text" : ""}
       FROM bills WHERE matter_id = ?`
    )
    .get(matterId) as Omit<MatterRecord, "attachments" | "legistar_url">;
  const attachments = db
    .prepare(
      `SELECT attachment_id, name, link, sort, last_modified
       FROM matter_attachments WHERE matter_id = ? ORDER BY sort, attachment_id`
    )
    .all(matterId) as MatterAttachmentRow[];
  return { ...m, legistar_url: legistarUrl(m.matter_id), attachments };
}

// ---------------------------------------------------------------------------
// Member roles and committee rosters (#28, tier 1: Legistar OfficeRecords)
// ---------------------------------------------------------------------------

export const ROLES_SOURCE = "Legistar archive (people/*.json OfficeRecords)";

export interface RoleRow {
  body_name: string;
  role: Role;
  title: string | null;
  start: string | null;
  end: string | null;
}

export interface MemberRoles {
  person_id: number;
  full_name: string;
  as_of: string | null;
  council_terms: RoleRow[];
  chairs: RoleRow[];
  committees: RoleRow[];
  caucuses: RoleRow[];
  conferences: RoleRow[];
  delegations: RoleRow[];
  task_forces: RoleRow[];
  other: RoleRow[];
  source: string;
  /** Council district on as_of (latest term with include_past); null if none. */
  district: number | null;
  /** Every council term, newest first (#28, tier 2). */
  terms: TermRow[];
  terms_source: string;
  terms_fetched_at: string | null;
}

type RoleOpts = { as_of?: string; include_past?: boolean };

/** The date filter both tools share: active on as_of (default today, NY), or everything. */
function activeClause(opts: RoleOpts): { sql: string; params: string[]; asOf: string | null } {
  if (opts.include_past) return { sql: "", params: [], asOf: null };
  const asOf = opts.as_of ?? nyDateString();
  return {
    sql: " AND (start IS NULL OR start <= ?) AND (end IS NULL OR end >= ?)",
    params: [asOf, asOf],
    asOf,
  };
}

const byRoleThenName = (a: RoleRow, b: RoleRow) =>
  ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.body_name.localeCompare(b.body_name);

/**
 * A member's committees (chairs separately), caucuses, party conferences,
 * borough delegations and task forces, active on a date or across their whole
 * history. Party is never derived from any of these (#28).
 */
export function memberRoles(db: Database.Database, memberName: string, opts: RoleOpts = {}): MemberRoles[] {
  const people = (db.prepare("SELECT person_id, full_name FROM people ORDER BY person_id").all() as {
    person_id: number;
    full_name: string;
  }[]).filter((p) => nameMatches(memberName, p.full_name));
  const active = activeClause(opts);
  const stmt = db.prepare(
    `SELECT body_name, body_kind, role, title, start, end FROM office_records
     WHERE person_id = ?${active.sql} ORDER BY start, body_name`
  );
  return people.map((p) => {
    const rows = stmt.all(p.person_id, ...active.params) as (RoleRow & { body_kind: string })[];
    const pick = (kind: string) =>
      rows
        .filter((r) => r.body_kind === kind)
        .map(({ body_kind: _k, ...r }) => r)
        .sort(byRoleThenName);
    const committees = pick("committee");
    return {
      person_id: p.person_id,
      full_name: p.full_name.trim(),
      as_of: active.asOf,
      council_terms: pick("council"),
      chairs: committees.filter((c) => c.role === "chair"),
      committees,
      caucuses: pick("caucus"),
      conferences: pick("conference"),
      delegations: pick("delegation"),
      task_forces: pick("task_force"),
      other: pick("other"),
      source: ROLES_SOURCE,
      ...termsFor(db, p.person_id, active.asOf),
    };
  });
}

// ---------------------------------------------------------------------------
// Council terms and districts (#28, tier 2: NYC Open Data uvw5-9znb, vendored)
// ---------------------------------------------------------------------------

export const TERMS_SOURCE =
  "NYC Open Data uvw5-9znb, City Council Members (1999 to Present): a snapshot shipped with this server";

export interface TermRow {
  office_id: number;
  district: number | null;
  term_start: string | null;
  term_end: string | null;
}

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function stateValue(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM index_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** A term is current on a date when term_start <= date <= term_end. */
const onDate = (t: { term_start: string | null; term_end: string | null }, date: string) =>
  (t.term_start == null || t.term_start <= date) && (t.term_end == null || t.term_end >= date);

/** A person's council terms and their district on a date (or latest, if date is null). */
export function termsFor(
  db: Database.Database,
  personId: number,
  date: string | null
): Pick<MemberRoles, "district" | "terms" | "terms_source" | "terms_fetched_at"> {
  const terms = hasTable(db, "member_terms")
    ? (db
        .prepare(
          `SELECT office_id, district, term_start, term_end FROM member_terms
           WHERE person_id = ? ORDER BY term_start DESC, office_id DESC`
        )
        .all(personId) as TermRow[])
    : [];
  const term = date == null ? terms[0] : terms.find((t) => onDate(t, date));
  return {
    district: term?.district ?? null,
    terms,
    terms_source: TERMS_SOURCE,
    terms_fetched_at: stateValue(db, "member_terms_fetched_at"),
  };
}

export interface DistrictHolder {
  person_id: number;
  full_name: string;
  office_id: number;
  term_start: string | null;
  term_end: string | null;
}

export interface DistrictMember {
  district: number;
  as_of: string;
  status: "filled" | "vacant";
  member: DistrictHolder | null;
  /** On a vacant seat, the last member before as_of. Never reported as current. */
  previous: DistrictHolder | null;
  source: string;
  snapshot_fetched_at: string | null;
  /**
   * On a vacant seat: people Legistar lists as Council Members on as_of who
   * have no term in the City's file on that date. One may hold this seat; the
   * district is not guessed.
   */
  unlisted_council_members?: { person_id: number; full_name: string; start: string | null; end: string | null }[];
  note?: string;
  warning?: string;
}

/**
 * Who held a council district on a date. A seat nobody held on that date is
 * "vacant" with member null, even if someone held it the day before (#28).
 */
export function districtMember(db: Database.Database, district: number, asOf?: string): DistrictMember {
  const date = asOf ?? nyDateString();
  const rows = hasTable(db, "member_terms")
    ? (db
        .prepare(
          `SELECT t.person_id, TRIM(COALESCE(p.full_name, t.name)) AS full_name, t.office_id, t.term_start, t.term_end
           FROM member_terms t LEFT JOIN people p ON p.person_id = t.person_id
           WHERE t.district = ? ORDER BY t.term_start DESC, t.office_id DESC`
        )
        .all(district) as DistrictHolder[])
    : [];
  const member = rows.find((r) => onDate(r, date)) ?? null;
  const previous = member ? null : rows.find((r) => r.term_end != null && r.term_end < date) ?? null;
  const fetched = stateValue(db, "member_terms_fetched_at");
  const out: DistrictMember = {
    district,
    as_of: date,
    status: member ? "filled" : "vacant",
    member,
    previous,
    source: TERMS_SOURCE,
    snapshot_fetched_at: fetched,
  };
  if (!member && hasTable(db, "office_records")) {
    // Legistar's own membership records can be newer than the City's file
    // (2026-11-12: Carl Wilson from 2026-05-13, file last updated 2026-04-10).
    const unlisted = db
      .prepare(
        `SELECT DISTINCT o.person_id, TRIM(p.full_name) AS full_name, o.start, o.end
         FROM office_records o JOIN people p ON p.person_id = o.person_id
         WHERE o.body_kind = 'council' AND o.member_type = 'PRIMARY COUNCIL MEMBERS'
           AND (o.start IS NULL OR o.start <= ?) AND (o.end IS NULL OR o.end >= ?)
           AND NOT EXISTS (SELECT 1 FROM member_terms t WHERE t.person_id = o.person_id
                           AND (t.term_start IS NULL OR t.term_start <= ?) AND (t.term_end IS NULL OR t.term_end >= ?))
         ORDER BY o.start, o.person_id`
      )
      .all(date, date, date, date) as NonNullable<DistrictMember["unlisted_council_members"]>;
    if (unlisted.length) {
      out.unlisted_council_members = unlisted;
      out.note =
        "Legistar lists these people as Council Members on this date, but they are not in the City's terms file " +
        "for that date. One of them may hold this seat. Check council.nyc.gov before saying the seat is empty.";
    }
  }
  if (rows.length === 0) {
    out.warning = "No council terms in this index. Re-run the indexer to load the shipped snapshot.";
  } else if (fetched && date > fetched.slice(0, 10)) {
    out.warning =
      `This date is after the snapshot was fetched (${fetched.slice(0, 10)}). ` +
      "A seat filled since then will show as vacant, and a term that ended early may still show.";
  }
  return out;
}

export interface CommitteeRoster {
  body_name: string;
  as_of: string | null;
  members: { person_id: number; full_name: string; role: Role; title: string | null; start: string | null; end: string | null }[];
  source: string;
}

/** Who sits on a committee (chair first), on a date or across its history. */
export function committeeRoster(db: Database.Database, committee: string, opts: RoleOpts = {}): CommitteeRoster[] {
  const want = normalizeName(committee);
  const bodies = (db
    .prepare("SELECT DISTINCT body_name FROM office_records WHERE body_kind = 'committee' ORDER BY body_name")
    .all() as { body_name: string }[])
    .map((b) => b.body_name)
    .filter((name) => want && normalizeName(name).includes(want));
  const active = activeClause(opts);
  const stmt = db.prepare(
    `SELECT o.person_id, TRIM(p.full_name) AS full_name, o.role, o.title, o.start, o.end
     FROM office_records o JOIN people p ON p.person_id = o.person_id
     WHERE o.body_name = ?${active.sql.replace(/\b(start|end)\b/g, "o.$1")}`
  );
  return bodies.map((body_name) => {
    const members = (stmt.all(body_name, ...active.params) as CommitteeRoster["members"]).sort(
      (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.full_name.localeCompare(b.full_name)
    );
    return { body_name, as_of: active.asOf, members, source: ROLES_SOURCE };
  })
    // On a date, a committee nobody sat on (defunct, or not yet formed) is left
    // out rather than listed empty. include_past keeps every match.
    .filter((r) => opts.include_past || r.members.length > 0);
}
