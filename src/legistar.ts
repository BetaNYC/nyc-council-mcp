import { nyDateString } from "./dates.js";

const BASE_URL = "https://webapi.legistar.com/v1/nyc";

/**
 * Escape a string for embedding inside an OData $filter string literal.
 * Per OData, single quotes are escaped by doubling them. Do NOT
 * percent-encode here — buildUrl's URLSearchParams does the single URL
 * encoding pass. (Double-encoding was a bug: multi-word queries were sent
 * as "public%2520housing" and matched nothing.)
 */
export function odataString(value: string): string {
  return value.replace(/'/g, "''");
}

export type LegistarMatter = {
  MatterId: number;
  MatterGuid: string;
  MatterLastModifiedUtc: string;
  MatterRowVersion: string;
  MatterFile: string;
  MatterName: string;
  MatterTitle: string;
  MatterTypeId: number;
  MatterTypeName: string;
  MatterStatusId: number;
  MatterStatusName: string;
  MatterBodyId: number;
  MatterBodyName: string;
  MatterIntroDate: string | null;
  MatterAgendaDate: string | null;
  MatterPassedDate: string | null;
  MatterEnactmentDate: string | null;
  MatterEnactmentNumber: string | null;
  MatterSponsorNames: string | null;
  MatterText1: string | null;
  MatterText2: string | null;
  MatterText5: string | null;
};

// Agenda item on an event (one bill/matter, or a procedural line).
// Field shape verified live 2026-07-01 against
//   GET https://webapi.legistar.com/v1/nyc/events/{EventId}/eventitems?token=...
// (36 fields; the union of keys across sample events 22566/22525/22593 exactly
// matches the field list documented by Legistar — no extra, no missing).
// Fields that are always null for upcoming (not-yet-held) meetings — votes,
// mover/seconder, action outcome — are typed nullable accordingly.
export type LegistarEventItem = {
  EventItemId: number;
  EventItemGuid: string;
  EventItemLastModifiedUtc: string;
  EventItemRowVersion: string;
  EventItemEventId: number;
  EventItemAgendaSequence: number | null;
  EventItemMinutesSequence: number | null;
  EventItemAgendaNumber: string | null;
  EventItemVideo: number | null;
  EventItemVideoIndex: number | null;
  EventItemVersion: string | null;
  EventItemAgendaNote: string | null;
  EventItemMinutesNote: string | null;
  EventItemActionId: number | null;
  EventItemActionName: string | null;
  EventItemActionText: string | null;
  EventItemPassedFlag: number | null;
  EventItemPassedFlagName: string | null;
  EventItemRollCallFlag: number | null;
  EventItemFlagExtra: number | null;
  EventItemTitle: string | null;
  EventItemTally: string | null;
  EventItemAccelaRecordId: string | null;
  EventItemConsent: number | null;
  EventItemMoverId: number | null;
  EventItemMover: string | null;
  EventItemSeconderId: number | null;
  EventItemSeconder: string | null;
  EventItemMatterId: number | null;
  EventItemMatterGuid: string | null;
  EventItemMatterFile: string | null;
  EventItemMatterName: string | null;
  EventItemMatterType: string | null;
  EventItemMatterStatus: string | null;
  // Element shape not verified against docs — left as unknown[] rather than guessed.
  EventItemMatterAttachments: unknown[];
};

export type LegistarEvent = {
  EventId: number;
  EventGuid: string;
  EventLastModifiedUtc: string;
  EventDate: string;
  EventTime: string;
  EventVideoStatus: string;
  EventVideoPath: string | null;
  EventAgendaStatusId: number;
  EventAgendaStatusName: string;
  EventMinutesStatusId: number;
  EventMinutesStatusName: string;
  EventLocation: string;
  EventBodyId: number;
  EventBodyName: string;
  EventAgendaFile: string | null;
  EventMinutesFile: string | null;
  EventInSiteURL: string | null;
  // The /events list endpoint always returns this empty ([]); $expand=EventItems
  // is silently ignored (verified live 2026-07-01). getUpcomingHearings populates
  // it via a follow-up call to /events/{EventId}/eventitems unless agenda items
  // are explicitly excluded.
  EventItems: LegistarEventItem[];
};

export type LegistarPerson = {
  PersonId: number;
  PersonGuid: string;
  PersonLastModifiedUtc: string;
  PersonRowVersion: string;
  PersonFirstName: string;
  PersonLastName: string;
  PersonFullName: string;
  PersonActiveFlag: number;
  PersonCanViewFlag: number;
  PersonUsedSponsorFlag: number;
  PersonAddress1: string | null;
  PersonCity1: string | null;
  PersonState1: string | null;
  PersonZip1: string | null;
  PersonPhone: string | null;
  PersonFax: string | null;
  PersonEmail: string | null;
  PersonWWW: string | null;
};

export type LegistarBody = {
  BodyId: number;
  BodyGuid: string;
  BodyLastModifiedUtc: string;
  BodyRowVersion: string;
  BodyName: string;
  BodyTypeId: number;
  BodyTypeName: string;
  BodyMeetFlag: number;
  BodyActiveFlag: number;
  BodySort: number;
  BodyDescription: string | null;
  BodyContactNameId: number | null;
  BodyContactFullName: string | null;
  BodyContactPhone: string | null;
  BodyContactEmail: string | null;
  BodyNumberOfMembers: number;
  BodyUsedControlFlag: number;
  BodyNumberOfVotes: number;
  BodyUsedActingFlag: number;
  BodyUsedTargetFlag: number;
  BodyUsedSponsorFlag: number;
};

export type LegistarHistory = {
  MatterHistoryId: number;
  MatterHistoryGuid: string;
  MatterHistoryLastModifiedUtc: string;
  MatterHistoryRowVersion: string;
  MatterHistoryEventId: number | null;
  MatterHistoryAgendaSequence: number | null;
  MatterHistoryMinutesSequence: number | null;
  MatterHistoryAgendaNumber: string | null;
  MatterHistoryVideo: number | null;
  MatterHistoryVideoIndex: number | null;
  MatterHistoryVersion: string | null;
  MatterHistoryAgendaNote: string | null;
  MatterHistoryMinutesNote: string | null;
  MatterHistoryActionDate: string | null;
  MatterHistoryActionId: number | null;
  MatterHistoryActionName: string | null;
  MatterHistoryActionText: string | null;
  MatterHistoryActionBodyId: number | null;
  MatterHistoryActionBodyName: string | null;
  MatterHistoryPassedFlag: number | null;
  MatterHistoryPassedFlagName: string | null;
  MatterHistoryRollCallFlag: number | null;
  MatterHistoryFlagExtra: number | null;
  MatterHistoryTally: string | null;
  MatterHistoryAccelaRecordId: string | null;
  MatterHistoryConsent: number | null;
};

export type LegistarVote = {
  VoteId: number;
  VoteGuid: string;
  VoteLastModifiedUtc: string;
  VoteRowVersion: string;
  VotePersonId: number;
  VotePersonName: string;
  VoteValueId: number;
  VoteValueName: string;
  VoteResult: number;
  VoteEventItemId: number;
  VoteMatterStatusId: number | null;
};

function buildUrl(path: string, token: string, params: Record<string, string> = {}): string {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function legistarFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Legistar API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Build an OData v3 $filter for a free-text matter search.
 *
 * Legistar's WebAPI speaks OData v3: `substringof(substring, target)` — the
 * substring is the FIRST argument — plus the logical `and`/`or` operators and
 * parentheses for grouping (OData v3.0 URL Conventions §5.1.1.4 / §5.1.1.9,
 * https://www.odata.org/documentation/odata-version-3-0/url-conventions/; and
 * these primitives are already exercised live by getUpcomingHearings/
 * getCouncilMember in this file).
 *
 * `substringof` matches a CONTIGUOUS substring. Passing the whole multi-word
 * query as a single substringof — the pre-2.2.0 behavior — required the exact
 * phrase to appear verbatim in a title, so queries like "section 254 capital
 * budget" matched nothing while the single tokens "254" or "capital" worked.
 * Instead we tokenize the query and AND one `(title OR name)` group per term,
 * so a matter whose title contains all the words in any order is found.
 *
 * A double-quoted phrase in the input is preserved as a single
 * contiguous-substring term, for callers who do want an exact phrase.
 * Returns "" for an effectively empty query — callers should short-circuit.
 */
export function buildMatterSearchFilter(query: string): string {
  const terms: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const raw = (m[1] !== undefined ? m[1] : m[2]).trim();
    if (raw) terms.push(raw);
  }
  if (terms.length === 0) return "";
  return terms
    .map((term) => {
      const esc = odataString(term);
      return `(substringof('${esc}',MatterTitle) or substringof('${esc}',MatterName))`;
    })
    .join(" and ");
}

export type MatterSearchOrder = "date_desc" | "date_asc";

export async function searchLegislation(
  token: string,
  query: string,
  limit = 20,
  order: MatterSearchOrder = "date_desc"
): Promise<LegistarMatter[]> {
  const filter = buildMatterSearchFilter(query);
  // An empty query would otherwise build an empty $filter that matches every
  // matter; treat it as "no results" (use list_recent_legislation to browse).
  if (!filter) return [];
  const url = buildUrl("/matters", token, {
    $filter: filter,
    $top: String(limit),
    // Legistar OData has no full-text relevance ranking (substringof is a
    // boolean filter), so results are ordered by introduction date. asc
    // surfaces the OLDEST matches first — the way to reach historical
    // legislation without a very high limit.
    $orderby: `MatterIntroDate ${order === "date_asc" ? "asc" : "desc"}`,
  });
  return legistarFetch<LegistarMatter[]>(url);
}

// MatterFile values are type-prefixed in Legistar (verified live 2026-07-06:
// "Int 0349-2024", not "0349-2024" — an exact match on the bare number returns
// []). getBill first tries the string as given; if that finds nothing and the
// input looks like a bare NNNN-YYYY number, it retries with the common type
// prefixes in order.
const MATTER_FILE_PREFIXES = ["Int", "Res", "LU"];

export async function getBill(token: string, fileNumber: string): Promise<LegistarMatter[]> {
  const candidates = [fileNumber];
  if (/^\d{4}-\d{4}$/.test(fileNumber.trim())) {
    for (const prefix of MATTER_FILE_PREFIXES) {
      candidates.push(`${prefix} ${fileNumber.trim()}`);
    }
  }
  for (const candidate of candidates) {
    const url = buildUrl("/matters", token, {
      $filter: `MatterFile eq '${odataString(candidate)}'`,
      $top: "1",
    });
    const results = await legistarFetch<LegistarMatter[]>(url);
    if (results.length > 0) return results;
  }
  return [];
}

export async function getBillHistory(token: string, matterId: number): Promise<LegistarHistory[]> {
  const url = buildUrl(`/matters/${matterId}/histories`, token, {
    $orderby: "MatterHistoryActionDate desc",
  });
  return legistarFetch<LegistarHistory[]>(url);
}

// Fetch the agenda items (bills/matters on the agenda) for a single event.
// The /events list endpoint returns EventItems empty and ignores $expand
// (verified live 2026-07-01), so the agenda must be pulled from this dedicated
// endpoint per event:  GET /events/{EventId}/eventitems
export async function getEventItems(
  token: string,
  eventId: number
): Promise<LegistarEventItem[]> {
  const url = buildUrl(`/events/${eventId}/eventitems`, token);
  return legistarFetch<LegistarEventItem[]>(url);
}

export async function getUpcomingHearings(
  token: string,
  daysAhead = 14,
  includeAgenda = true
): Promise<LegistarEvent[]> {
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const from = nyDateString(now);
  const to = nyDateString(future);
  const url = buildUrl("/events", token, {
    $filter: `EventDate ge datetime'${from}' and EventDate le datetime'${to}'`,
    $orderby: "EventDate asc",
    $top: "50",
  });
  const events = await legistarFetch<LegistarEvent[]>(url);

  if (!includeAgenda) {
    return events;
  }

  // The list response caps at 50 events ($top), so this is a bounded fan-out.
  // Fetch agenda items for all events in parallel — no documented Legistar rate
  // limit, and this is a user-facing tool where latency matters. If one event's
  // /eventitems call fails, degrade gracefully: leave that event's EventItems as
  // [] and keep the rest, rather than failing the whole hearings list.
  await Promise.all(
    events.map(async (event) => {
      try {
        event.EventItems = await getEventItems(token, event.EventId);
      } catch {
        event.EventItems = [];
      }
    })
  );

  return events;
}

export async function getCouncilMember(
  token: string,
  name: string
): Promise<LegistarPerson[]> {
  const url = buildUrl("/persons", token, {
    $filter: `substringof('${odataString(name)}',PersonFullName) and PersonActiveFlag eq 1`,
    $top: "10",
  });
  return legistarFetch<LegistarPerson[]>(url);
}

export async function getCommittee(
  token: string,
  name: string
): Promise<LegistarBody[]> {
  const url = buildUrl("/bodies", token, {
    $filter: `substringof('${odataString(name)}',BodyName) and BodyActiveFlag eq 1`,
    $top: "10",
  });
  return legistarFetch<LegistarBody[]>(url);
}

export async function getVotes(
  token: string,
  eventItemId: number
): Promise<LegistarVote[]> {
  const url = buildUrl(`/eventitems/${eventItemId}/votes`, token);
  return legistarFetch<LegistarVote[]>(url);
}

export async function listRecentLegislation(
  token: string,
  limit = 25
): Promise<LegistarMatter[]> {
  const url = buildUrl("/matters", token, {
    $orderby: "MatterIntroDate desc",
    $top: String(limit),
  });
  return legistarFetch<LegistarMatter[]>(url);
}
