/**
 * The page a person can open to check each tool's answer (#84): the Council's own Legistar pages
 * for legislation, meetings, committees and members, and the City's dataset page for the council
 * terms. Every link is also in DATA-SOURCES.json or was checked to open (People.aspx, 2026-11-18).
 * Rows carry their own record link (legistar_url) where one exists.
 */

const L = "https://legistar.council.nyc.gov";
const LEGISLATION = `${L}/Legislation.aspx`;
const CALENDAR = `${L}/Calendar.aspx`;
const COMMITTEES = `${L}/Departments.aspx`;
const PEOPLE = `${L}/People.aspx`;
const TERMS = "https://data.cityofnewyork.us/d/uvw5-9znb";

export const SOURCE_LINK: Readonly<Record<string, string>> = {
  // local index
  search_legislation: LEGISLATION, search_bills: LEGISLATION, get_matter: LEGISLATION,
  recent_bills: LEGISLATION, aggregate_bills: LEGISLATION, get_bill_history: LEGISLATION,
  co_sponsors: LEGISLATION, vote_breakdown: LEGISLATION, get_voting_record: LEGISLATION,
  search_events: CALENDAR, upcoming_events: CALENDAR, get_event_bills: CALENDAR, get_bill_hearings: CALENDAR,
  get_member_roles: COMMITTEES, committee_roster: COMMITTEES, list_committees: COMMITTEES,
  district_member: TERMS,
  // live API (get_bill_history is in both)
  get_bill: LEGISLATION, get_bill_attachments: LEGISLATION, get_votes: LEGISLATION,
  list_recent_legislation: LEGISLATION, search_legislation_live: LEGISLATION,
  get_upcoming_hearings: CALENDAR, get_committee: COMMITTEES, get_council_member: PEOPLE,
};

/** The live source, named as in DATA-SOURCES.json (topic "live"). */
export const LIVE_SOURCE = { sourceName: "NYC Council Legistar Web API (Granicus)", publisher: "New York City Council" };

/** What the live source line adds after the source's name. DATA-SOURCES.json says BetaNYC
 * modified the live data (topic "live", changes.changed), so the line must not read like the
 * untouched record: it says what was changed and that Legistar is the official record. */
export const LIVE_MODIFIED =
  "a copy BetaNYC modified (it fixes known-bad member profile links and shortens long hearing titles); " +
  "Legistar is the official record";
