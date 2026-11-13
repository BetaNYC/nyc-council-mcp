/**
 * Curated member facts (#28 layers 3 and 4, #37): Wikidata/Wikipedia, party,
 * and office social accounts. These are BetaNYC's hand-checked assertions, not
 * official records, and every answer carries CURATED_LABEL. Each fact keeps its
 * own source and check date.
 *
 * Three files ship in data/, one per kind of fact, so provenance stays
 * separate. They are read at runtime, not indexed, so live-only mode has them
 * too. Joined on Legistar person_id only; names are never compared.
 *
 * Party is every ballot line the member won on, from NYC Board of Elections
 * certified results. NYC has fusion voting, so a member can win on several
 * lines and represents all of them. Party is never inferred from a caucus or a
 * party conference.
 */

import { readFileSync } from "fs";

export const CURATED_LABEL =
  "Curated by BetaNYC from the sources listed, not an official record. Check the source before relying on it.";

export const DEFAULT_DATA_DIR = new URL("../data/", import.meta.url);

type Row = { person_id: number; status?: string } & Record<string, unknown>;

export interface Curated {
  wikidata: Map<number, Row>;
  party: Map<number, Row>;
  social: Map<number, Row>;
}

function load(dir: string | URL, name: string): Map<number, Row> {
  const path = typeof dir === "string" ? `${dir.replace(/\/?$/, "/")}${name}` : new URL(name, dir);
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { rows?: Row[] };
    return new Map((data.rows ?? []).map((r) => [r.person_id, r]));
  } catch {
    return new Map();
  }
}

export function loadCurated(dir: string | URL = DEFAULT_DATA_DIR): Curated {
  return {
    wikidata: load(dir, "council-wikidata.json"),
    party: load(dir, "council-party.json"),
    social: load(dir, "council-social.json"),
  };
}

let shipped: Curated | null = null;
/** The files shipped with the package, read once. */
export function shippedCurated(): Curated {
  return (shipped ??= loadCurated());
}

export interface CuratedFacts {
  label: string;
  wikidata: {
    qid: string;
    wikipedia_url: string | null;
    status: unknown;
    method: unknown;
    evidence: unknown;
    checked_at: unknown;
    second_check: unknown;
  } | null;
  party: {
    ballot_lines: { line: string; votes?: number }[];
    election: unknown;
    source_url: unknown;
    source_title: unknown;
    certified: unknown;
    status: unknown;
    checked_at: unknown;
    second_check: unknown;
    notes?: unknown;
  } | null;
  social: Record<string, unknown> | null;
}

const usable = (r: Row | undefined) => (r && r.status !== "none" ? r : undefined);

export function curatedFor(personId: number, c: Curated = shippedCurated()): CuratedFacts {
  const w = usable(c.wikidata.get(personId));
  const p = usable(c.party.get(personId));
  const s = usable(c.social.get(personId));
  const lines = Array.isArray(p?.ballot_lines) ? (p!.ballot_lines as { line: string; votes?: number }[]) : [];
  return {
    label: CURATED_LABEL,
    wikidata: w?.wikidata_qid
      ? {
          qid: String(w.wikidata_qid),
          wikipedia_url: (w.wikipedia_url as string) ?? null,
          status: w.status ?? null,
          method: w.method,
          evidence: w.evidence,
          checked_at: w.checked_at,
          second_check: w.second_check ?? null,
        }
      : null,
    party:
      p && lines.length
        ? {
            ballot_lines: lines,
            election: p.election,
            source_url: p.source_url,
            source_title: p.source_title,
            certified: p.certified,
            status: p.status ?? null,
            checked_at: p.checked_at,
            second_check: p.second_check ?? null,
            ...(p.notes ? { notes: p.notes } : {}),
          }
        : null,
    social: s?.accounts && typeof s.accounts === "object" ? (s.accounts as Record<string, unknown>) : null,
  };
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

/** Add a `curated` block to each person in a JSON array answer (PersonId or person_id). */
export function withCurated(res: ToolResult, c: Curated = shippedCurated()): ToolResult {
  if (res.isError || !res.content[0]) return res;
  let people: unknown;
  try {
    people = JSON.parse(res.content[0].text);
  } catch {
    return res;
  }
  if (!Array.isArray(people)) return res;
  const out = people.map((p) => {
    const o = p as { PersonId?: unknown; person_id?: unknown };
    const id = typeof o?.PersonId === "number" ? o.PersonId : typeof o?.person_id === "number" ? o.person_id : null;
    return id == null ? p : { ...(p as object), curated: curatedFor(id, c) };
  });
  return { ...res, content: [{ ...res.content[0], text: JSON.stringify(out, null, 2) }, ...res.content.slice(1)] };
}
