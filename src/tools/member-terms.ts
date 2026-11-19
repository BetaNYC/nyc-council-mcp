/**
 * Add council district and terms to a live get_council_member answer (#28).
 * Legistar's Persons records carry no district; the local index has the
 * City's terms snapshot, joined on PersonId (the same number as the City's
 * council_member_id). Used only when the server has both a token and an index.
 */

import type Database from "better-sqlite3";
import { termsFor } from "../db/queries.js";
import { nyDateString } from "../dates.js";
import { isUsableAsOf } from "../betanyc-tools.js";
import { SOURCE_LINK } from "./source-links.js";

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

export function withMemberTerms(res: ToolResult, db: Database.Database, asOf: string = nyDateString()): ToolResult {
  if (res.isError || !res.content[0]) return res;
  let people: unknown;
  try {
    people = JSON.parse(res.content[0].text);
  } catch {
    return res;
  }
  if (!Array.isArray(people)) return res;
  const enriched = people.map((p) => {
    const id = (p as { PersonId?: unknown })?.PersonId;
    return typeof id === "number" ? { ...p, ...termsFor(db, id, asOf) } : p;
  });
  return { ...res, content: [{ ...res.content[0], text: JSON.stringify(enriched, null, 2) }, ...res.content.slice(1)] };
}

/** The line a get_council_member answer gets for its curated blocks. */
export const CURATED_SOURCE_LINE =
  "Each member's 'curated' block is BetaNYC's own hand-checked facts (party, Wikidata/Wikipedia, office social accounts), " +
  "not an official record; each fact names its own source and check date.";

/** The line a get_council_member answer gets for the district and terms it took from the index. */
export function termsSourceLine(fetchedAt: string | null, now: Date = new Date()): string {
  const when = fetchedAt && isUsableAsOf(fetchedAt, now) ? `fetched ${fetchedAt}` : "fetch date unknown";
  return (
    "District and terms: City Council Members (1999 to Present), New York City Council, NYC Open Data uvw5-9znb; " +
    `a copy shipped with this server (${when}), which BetaNYC joined to Legistar members by person ID. ` +
    `Link: ${SOURCE_LINK.district_member}`
  );
}

function fetchedAt(db: Database.Database): string | null {
  try {
    const row = db.prepare("SELECT value FROM index_state WHERE key = 'member_terms_fetched_at'").get() as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * A get_council_member answer holds up to three kinds of data: Legistar's record, BetaNYC's
 * curated block, and (with an index) district and terms from the City's dated file. The source
 * line, the last text block, names all of them: the live line it already has, then the terms
 * file's own source and fetch date when terms were added, then that the curated block is
 * BetaNYC's and not an official record when one is present.
 */
export function withMemberSources(res: ToolResult, db: Database.Database | null, now: Date = new Date()): ToolResult {
  if (res.isError || res.content.length < 2) return res;
  let people: unknown;
  try {
    people = JSON.parse(res.content[0].text);
  } catch {
    return res;
  }
  if (!Array.isArray(people) || people.length === 0) return res;
  const has = (key: string) => people.some((p) => p && typeof p === "object" && key in (p as object));
  const lines: string[] = [];
  if (db && has("terms")) lines.push(termsSourceLine(fetchedAt(db), now));
  if (has("curated")) lines.push(CURATED_SOURCE_LINE);
  if (lines.length === 0) return res;
  const source = res.content[res.content.length - 1];
  return {
    ...res,
    content: [...res.content.slice(0, -1), { ...source, text: [source.text, ...lines].join("\n") }],
  };
}
