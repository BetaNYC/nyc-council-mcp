const BASE_URL = "https://webapi.legistar.com/v1/nyc";

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

export async function searchLegislation(
  token: string,
  query: string,
  limit = 20
): Promise<LegistarMatter[]> {
  const filter = `substringof('${encodeURIComponent(query)}',MatterTitle) or substringof('${encodeURIComponent(query)}',MatterName)`;
  const url = buildUrl("/matters", token, {
    $filter: filter,
    $top: String(limit),
    $orderby: "MatterIntroDate desc",
  });
  return legistarFetch<LegistarMatter[]>(url);
}

export async function getBill(token: string, fileNumber: string): Promise<LegistarMatter[]> {
  const url = buildUrl("/matters", token, {
    $filter: `MatterFile eq '${fileNumber}'`,
    $top: "1",
  });
  return legistarFetch<LegistarMatter[]>(url);
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
  const from = now.toISOString().split("T")[0];
  const to = future.toISOString().split("T")[0];
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
    $filter: `substringof('${encodeURIComponent(name)}',PersonFullName) and PersonActiveFlag eq 1`,
    $top: "10",
  });
  return legistarFetch<LegistarPerson[]>(url);
}

export async function getCommittee(
  token: string,
  name: string
): Promise<LegistarBody[]> {
  const url = buildUrl("/bodies", token, {
    $filter: `substringof('${encodeURIComponent(name)}',BodyName) and BodyActiveFlag eq 1`,
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
