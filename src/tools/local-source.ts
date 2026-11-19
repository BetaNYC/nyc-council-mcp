/**
 * Where a local answer came from (#25), and live status for upcoming meetings (#42).
 */

import type Database from "better-sqlite3";
import type { EventRow } from "../db/queries.js";
import type { LegistarEvent } from "../legistar.js";
import { nyDateString } from "../dates.js";
import { errorSummary, provenance } from "../betanyc-tools.js";
import { SOURCE_LINK, LIVE_SOURCE } from "./source-links.js";
import { CURATED_SOURCE_LINE, termsSourceLine } from "./member-terms.js";

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function state(db: Database.Database): Record<string, string> {
  try {
    const rows = db.prepare("SELECT key, value FROM index_state").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}

const COUNCIL = "New York City Council";

/** The official record behind each local tool's answer: the DATA-SOURCES.json source_name and
 * source_url of the topic that lists the tool (a test checks they agree). */
const OFFICIAL_RECORD: Readonly<Record<string, string>> = {
  [SOURCE_LINK.search_legislation]: "NYC Council Legistar: Legislation",
  [SOURCE_LINK.search_events]: "NYC Council Legistar: Calendar",
  [SOURCE_LINK.list_committees]: "NYC Council Legistar: Committees",
  [SOURCE_LINK.district_member]: "City Council Members (1999 to Present)",
};

export function officialRecord(tool: string | undefined): { sourceName: string; sourceUrl: string } {
  const url = (tool && SOURCE_LINK[tool]) || SOURCE_LINK.search_legislation;
  return { sourceName: OFFICIAL_RECORD[url] ?? OFFICIAL_RECORD[SOURCE_LINK.search_legislation], sourceUrl: url };
}

/** What the index build changes (src/db/indexer.ts), as DATA-SOURCES.json says for the local
 * topics. The upstream mirror is named, with its commit, as where the copy came from. */
function indexDetail(s: Record<string, string>): string {
  const mirror = s.archive_commit
    ? `jehiah/nyc_legislation@${s.archive_commit}` + (s.archive_commit_date ? ` (archive commit ${s.archive_commit_date})` : "")
    : "a clone of jehiah/nyc_legislation (commit unknown)";
  return (
    `it built this local index from ${mirror}, an unofficial mirror of the Council's Legistar records; ` +
    "the build trims committee names and role titles, leaves out rows with no ID, and cuts dates to the day " +
    "(history dates keep their New York time and lose a trailing Z); about_data lists every change"
  );
}

/**
 * The source block that ends every local answer (#25, #84): what BetaNYC did to the data (the
 * shared module's provenance with changedByBetanyc "modified-by-betanyc", as about_data says for
 * the local topics), when the index was built, the mirror and commit it was built from, and the
 * official record with a link a person can open. More lines follow when they apply: the council
 * terms file (district_member, get_member_roles), the curated block (get_member_roles), the live
 * agenda status (upcoming_events in hybrid mode, #42), and, without a token, that nothing was
 * checked live.
 */
export function sourceNote(
  db: Database.Database,
  opts: { hasLive: boolean; empty: boolean; tool?: string; liveCheckedAt?: Date | null },
  now: Date = new Date()
): string {
  const s = state(db);
  const { sourceName, sourceUrl } = officialRecord(opts.tool);
  const lines = [
    provenance(
      {
        sourceName,
        publisher: COUNCIL,
        sourceUrl,
        kind: "snapshot",
        asOf: s.last_indexed_at ?? null,
        changedByBetanyc: { kind: "modified-by-betanyc", detail: indexDetail(s) },
      },
      now
    ).text,
  ];
  // district_member and get_member_roles also answer from the City's council terms file,
  // which has its own date (#85).
  if (opts.tool === "district_member" || opts.tool === "get_member_roles") {
    lines.push(termsSourceLine(s.member_terms_fetched_at ?? null, now));
  }
  // get_member_roles adds BetaNYC's curated block, which is not an official record.
  if (opts.tool === "get_member_roles") lines.push(CURATED_SOURCE_LINE);
  // upcoming_events in hybrid mode takes agenda_status from the live API (#42).
  if (opts.liveCheckedAt) {
    const live = provenance(
      { sourceName: LIVE_SOURCE.sourceName, publisher: LIVE_SOURCE.publisher, sourceUrl: SOURCE_LINK.get_upcoming_hearings, kind: "live" },
      opts.liveCheckedAt
    ).text;
    lines.push(`agenda_status is the live Legistar value, not the index's (the index's value is kept in agenda_status_index where they differ). ${live}`);
  }
  if (!opts.hasLive) {
    let unchecked =
      "It was not checked against the live Legistar API, because no LEGISTAR_TOKEN is set" +
      " (register at https://council.nyc.gov/legislation/api/).";
    if (opts.empty) unchecked += " An empty answer means it is not in this index, not that it does not exist.";
    lines.push(unchecked);
  }
  return lines.join("\n");
}

/** Add the source note as the last content item. The JSON in the first item is untouched. */
export function withSourceNote(
  res: ToolResult,
  db: Database.Database,
  opts: { hasLive: boolean; tool?: string; liveCheckedAt?: Date | null }
): ToolResult {
  if (res.isError) return res;
  const first = res.content[0]?.text?.trim() ?? "";
  const empty = first === "[]" || /"(items|results|history|roll_calls)":\s*\[\]/.test(first);
  return {
    ...res,
    content: [
      ...res.content,
      { type: "text", text: sourceNote(db, { hasLive: opts.hasLive, empty, tool: opts.tool, liveCheckedAt: opts.liveCheckedAt }) },
    ],
  };
}

/** A message with a secret (the Legistar token) removed, as is and URL-encoded. */
function scrub(text: string, secret: string | null | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]").split(encodeURIComponent(secret)).join("[redacted]");
}

export type CheckedEventRow = EventRow & {
  agenda_status_index?: string | null;
  status_checked_live: boolean;
};

/**
 * Take each upcoming meeting's agenda status from the live API (#42). The
 * archive can keep a stale status: Legistar changed 22725 to "Deferred"
 * without bumping EventLastModifiedUtc, so the archive never re-fetched it.
 * When the two differ, the index's value is kept in agenda_status_index.
 * `missing` lists live meetings in the window that the index does not have.
 */
export function overlayLiveEventStatus(
  rows: EventRow[],
  live: Pick<LegistarEvent, "EventId" | "EventDate" | "EventAgendaStatusName" | "EventBodyName">[]
): { rows: CheckedEventRow[]; missing: typeof live } {
  const byId = new Map(live.map((e) => [e.EventId, e]));
  const out = rows.map((r) => {
    const l = byId.get(r.event_id);
    if (!l) return { ...r, status_checked_live: false };
    if (l.EventAgendaStatusName === r.agenda_status) return { ...r, status_checked_live: true };
    return {
      ...r,
      agenda_status: l.EventAgendaStatusName,
      agenda_status_index: r.agenda_status,
      status_checked_live: true,
    };
  });
  const have = new Set(rows.map((r) => r.event_id));
  return { rows: out, missing: live.filter((e) => !have.has(e.EventId)) };
}

type StatusFetcher = (
  from: string,
  to: string
) => Promise<Pick<LegistarEvent, "EventId" | "EventDate" | "EventAgendaStatusName" | "EventBodyName">[]>;

/**
 * Hybrid mode only: check an upcoming_events answer against the live API with
 * one request covering the same window (today to today + days, NY dates, as
 * upcomingEvents uses). If the live call fails, the local answer stands and a
 * note says it was not checked.
 */
export async function checkUpcomingLive(
  res: ToolResult,
  days: number,
  fetchStatuses: StatusFetcher,
  /** Which of these event ids the index has. The answer is cut at `limit`, so absence from it proves nothing. */
  inIndex?: (ids: number[]) => Set<number>,
  token?: string | null
): Promise<ToolResult> {
  return (await checkUpcomingLiveReport(res, days, fetchStatuses, inIndex, token)).res;
}

/** checkUpcomingLive, plus when the live statuses were fetched (null when they were not), so the
 * source line can name the live API and its fetch time (#42). */
export async function checkUpcomingLiveReport(
  res: ToolResult,
  days: number,
  fetchStatuses: StatusFetcher,
  inIndex?: (ids: number[]) => Set<number>,
  token?: string | null
): Promise<{ res: ToolResult; checkedAt: Date | null }> {
  if (res.isError) return { res, checkedAt: null };
  const rows = JSON.parse(res.content[0].text) as EventRow[];
  const from = nyDateString();
  const to = nyDateString(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  let live;
  try {
    live = await fetchStatuses(from, to);
  } catch (err) {
    // One plain line (shared module 1.5.2), never a stack frame, and never the token.
    const why = scrub(errorSummary(err), token);
    return {
      res: {
        ...res,
        content: [
          ...res.content,
          { type: "text", text: `Agenda status could not be checked against the live API (${why}); it is the index's.` },
        ],
      },
      checkedAt: null,
    };
  }
  const checkedAt = new Date();
  const overlay = overlayLiveEventStatus(rows, live);
  const checked = overlay.rows;
  const known = inIndex ? inIndex(overlay.missing.map((e) => e.EventId)) : new Set<number>();
  const missing = overlay.missing.filter((e) => !known.has(e.EventId));
  // Keep every block after the JSON (such as "more are available", #86).
  const content = [{ type: "text", text: JSON.stringify(checked, null, 2) }, ...res.content.slice(1)];
  if (missing.length > 0) {
    const list = missing
      .map((e) => `${e.EventId} (${e.EventDate.slice(0, 10)}, ${e.EventBodyName})`)
      .join("; ");
    content.push({
      type: "text",
      text:
        `${missing.length} upcoming meeting${missing.length === 1 ? " is" : "s are"} in Legistar but not in the local index yet: ` +
        `${list}. Use get_upcoming_hearings for them.`,
    });
  }
  return { res: { ...res, content }, checkedAt };
}
