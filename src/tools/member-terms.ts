/**
 * Add council district and terms to a live get_council_member answer (#28).
 * Legistar's Persons records carry no district; the local index has the
 * City's terms snapshot, joined on PersonId (the same number as the City's
 * council_member_id). Used only when the server has both a token and an index.
 */

import type Database from "better-sqlite3";
import { termsFor } from "../db/queries.js";
import { nyDateString } from "../dates.js";

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
