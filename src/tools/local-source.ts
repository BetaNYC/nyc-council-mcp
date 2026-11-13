/**
 * Where a local answer came from (#25), and live status for upcoming meetings (#42).
 */

import type Database from "better-sqlite3";
import type { EventRow } from "../db/queries.js";
import type { LegistarEvent } from "../legistar.js";
import { nyDateString } from "../dates.js";

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function state(db: Database.Database): Record<string, string> {
  try {
    const rows = db.prepare("SELECT key, value FROM index_state").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}

/**
 * One line saying when the local index was built and from which archive
 * commit, read from index_state (written by the indexer). Replaces the old
 * hard-coded "may be 1–7 days stale" guess, which was not measured.
 */
export function sourceNote(
  db: Database.Database,
  opts: { hasLive: boolean; empty: boolean }
): string {
  const s = state(db);
  const built = s.last_indexed_at ? `local index built ${s.last_indexed_at}` : "local index (build time unknown)";
  const from = s.archive_commit
    ? ` from jehiah/nyc_legislation@${s.archive_commit}` +
      (s.archive_commit_date ? ` (archive commit ${s.archive_commit_date})` : "")
    : "";
  let note = `Source: ${built}${from}.`;
  if (!opts.hasLive) {
    note +=
      " It was not checked against the live Legistar API, because no LEGISTAR_TOKEN is set" +
      " (register at https://council.nyc.gov/legislation/api/).";
    if (opts.empty) {
      note += " An empty answer means it is not in this index, not that it does not exist.";
    }
  }
  return note;
}

/** Add the source note as a second content item. The JSON in the first item is untouched. */
export function withSourceNote(
  res: ToolResult,
  db: Database.Database,
  opts: { hasLive: boolean }
): ToolResult {
  if (res.isError) return res;
  const first = res.content[0]?.text?.trim() ?? "";
  const empty = first === "[]" || /"(items|results|history|roll_calls)":\s*\[\]/.test(first);
  return {
    ...res,
    content: [...res.content, { type: "text", text: sourceNote(db, { hasLive: opts.hasLive, empty }) }],
  };
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
  inIndex?: (ids: number[]) => Set<number>
): Promise<ToolResult> {
  if (res.isError) return res;
  const rows = JSON.parse(res.content[0].text) as EventRow[];
  const from = nyDateString();
  const to = nyDateString(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  let live;
  try {
    live = await fetchStatuses(from, to);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      ...res,
      content: [
        ...res.content,
        { type: "text", text: `Agenda status could not be checked against the live API (${why}); it is the index's.` },
      ],
    };
  }
  const overlay = overlayLiveEventStatus(rows, live);
  const checked = overlay.rows;
  const known = inIndex ? inIndex(overlay.missing.map((e) => e.EventId)) : new Set<number>();
  const missing = overlay.missing.filter((e) => !known.has(e.EventId));
  const content = [{ type: "text", text: JSON.stringify(checked, null, 2) }];
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
  return { ...res, content };
}
