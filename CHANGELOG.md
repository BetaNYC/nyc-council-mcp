# Changelog

All notable changes to `@betanyc/nyc-council-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dates are npm publish dates (`npm view @betanyc/nyc-council-mcp time`).

## [2.8.0] - 2026-11-13

### Added
- **`about_data`: ask where the data comes from
  ([#48](https://github.com/BetaNYC/nyc-council-mcp/issues/48)).** A new tool, available in
  every mode, answers "where does this come from?", "how current is it?" and "who made
  this?". It names BetaNYC and the Fund for the City of New York, the repo, the license and
  how to send a correction. For each kind of data it gives the source, whether the data is
  official or curated by BetaNYC, how it was gathered, and its date on this server (index
  build time, district snapshot, curated check dates). The server's MCP
  `instructions` tell AI apps to call it when someone asks about sources. A test fails if a
  new tool ships without a documented source.
- **`about_data` now runs on BetaNYC's shared module and `DATA-SOURCES.json`.** The
  sources are listed once, in [`DATA-SOURCES.json`](DATA-SOURCES.json), and the tool and a
  DCAT-US 3.0 catalog, [`data.json`](data.json), are both made from it; both ship in the
  package. Each source now also gives its publisher, what BetaNYC changed, terms of use and a
  credit line, where to check a figure and where to report an error. `topic` is a kind of
  data or a tool name (`get_council_member` covers everything about a member). CI checks the
  file, the catalog, and that every tool has a source.
- **Committees, chairs, caucuses and delegations for every member
  ([#28](https://github.com/BetaNYC/nyc-council-mcp/issues/28), first of its four
  layers).** The indexer now keeps each person's Legistar `OfficeRecords` (6,027 rows over
  171 bodies), sorted into committees, caucuses, party conferences, borough delegations and
  task forces, each with a role (chair, vice chair, leader, member) and start/end dates. Two
  new local tools: **`get_member_roles`** ("which committees does she chair?") and
  **`committee_roster`** ("who sits on Technology?"), each for today, a past date, or the
  whole history. Answers name their source. A conference or caucus is reported as a
  membership only: party is never inferred from it.
- **Party, Wikidata/Wikipedia and office social accounts, curated
  ([#28](https://github.com/BetaNYC/nyc-council-mcp/issues/28) layers 3 and 4,
  [#37](https://github.com/BetaNYC/nyc-council-mcp/issues/37)).** Three hand-checked files in
  `data/` cover the 51 sitting members, joined on person ID. `get_council_member` and
  `get_member_roles` return them in a `curated` block labeled "not an official record".
  - **Party** is every ballot line the member won on, copied from Board of Elections
    certified results. NYC has fusion voting: 30 of 51 won on two lines. Party is never
    taken from a caucus or from Wikidata.
  - **Wikidata and Wikipedia:** every row was re-checked, and District 3 now has Carl Wilson.
  - **Social accounts** are office accounts only, on Bluesky (14), Instagram (34), Threads (19)
    and LinkedIn (none found). An account linked from council.nyc.gov or listed in the Council's
    Bluesky starter pack is "verified". One identified only by its own bio is "likely".
  - Each fact keeps its source and check date. A blank stays null. Rules: `data/README.md`.
- **Council districts and terms
  ([#28](https://github.com/BetaNYC/nyc-council-mcp/issues/28), second layer).** The
  package now ships a dated copy of NYC Open Data
  [`uvw5-9znb`](https://data.cityofnewyork.us/d/uvw5-9znb) (558 terms, 215 people, 1999 to
  now) in `data/council-member-terms.json`. The indexer loads it offline, with no token. It
  joins on Legistar's person ID, never on names. New local tool **`district_member`**: who held
  a district on a date. A seat nobody held that day is `vacant`, with the last member as
  `previous`, never as current. `get_member_roles` now returns `district` and every term, and
  in hybrid mode `get_council_member` does too. When a seat looks vacant, the answer also names
  anyone Legistar lists as a Council Member who is missing from the City's file. On 2026-11-12
  that is Carl Wilson, from 2026-05-13, in a file last updated 2026-04-10. A monthly workflow
  re-fetches the file and opens a PR when the City's rows change. The version guard now
  counts the snapshot as shipped code.
- **Search the full text and summaries of legislation; Local Law numbers, versions and
  attachments ([#31](https://github.com/BetaNYC/nyc-council-mcp/issues/31)).** Local search
  now covers each matter's summary and full text, not only its title and sponsors. A title
  hit still ranks above a body hit. Search rows carry `version` (`*` is the original text)
  and `local_law` (null unless enacted). New local tool **`get_matter`**: one matter by file
  number or Local Law number, with its summary, version, Local Law number, attachments
  (`[]` when none) and, on request, its full text. No token needed.
  - **Size, on the record:** a full build of the 2026-11-11 archive goes from 954 MB to
    1,024 MB (+70 MB). The search index grows from 7 MB to 46 MB, and the new attachments
    table (161,711 rows) takes 28 MB. The text is not stored twice: `text`, `summary`,
    `version` and `local_law` are virtual generated columns over the stored source JSON.
  - **Schema v6.** The next `index` run rebuilds the corpus in full by itself (about 25
    seconds on the real archive). Until then, an index built by older code keeps working:
    search returns null `version`/`local_law`, and `get_matter` says to re-index.
- **`get_bill_attachments`** (live, needs `LEGISTAR_TOKEN`): the files attached to a
  matter, from the documented `GET /matters/{MatterId}/attachments` endpoint
  ([#45](https://github.com/BetaNYC/nyc-council-mcp/issues/45)). Each row has a name
  and a direct download link. Checked 2026-11-12: Res 0551-2026 returns the same 7
  files its website page lists, and the files match byte for byte.

### Fixed
- **Fixes from an independent review of this release (2026-11-12,
  [#48](https://github.com/BetaNYC/nyc-council-mcp/issues/48)).**
  - `district_member` no longer calls a seat vacant when the City's file lists someone serving
    that day with no district (52 rows). The seat is now `unknown`, with those people listed.
    Overlapping terms are all shown. An index with no terms loaded is an error.
  - `get_member_roles` and `committee_roster` on an index not yet rebuilt now say "re-run the
    indexer" instead of answering that a member sits on nothing.
  - `upcoming_events` no longer reports meetings as missing from the index when they were only
    past `limit`.
  - `get_matter` finds a Local Law however it is written ("2009/1", "Local Law 1 of 2009").
  - The `curated` block now shows each fact's `status` and `second_check`.
  - `get_voting_record` rows carry `person_name`.
  - Vote and history times are New York local time, without the archive's false "Z".
  - Impossible dates such as 2026-02-30 are rejected.
  - A server started on an old index notices the nightly rebuild without a restart.
  - CI and the version guard now cover every shipped data file. The monthly terms refresh starts
    CI on its own PR and never reuses a branch name.
- **Empty answers now say why (full pre-release test run, 2026-11-13,
  [#48](https://github.com/BetaNYC/nyc-council-mcp/issues/48)).**
  - A member the City's terms file does not list (Carl Wilson, District 3, on 2026-11-13) gets a
    `terms_note` in `get_council_member` and `get_member_roles` instead of a bare empty list.
  - `get_council_member` with no match adds a note that it searches active members only.
  - A `LEGISTAR_DB_PATH` that points to a missing file is named at startup, instead of "No data
    source configured".
  - `search_legislation_live` answers a bad argument or a Legistar failure with an error
    message, not an MCP protocol error.
  - `index` adds an "Index now holds" line with the rows stored. The "Indexed" line counts
    records read, which can be higher when the archive holds one matter in two files.
- **Retired the Maloney profile-link override
  ([#38](https://github.com/BetaNYC/nyc-council-mcp/issues/38)).** The Council fixed the
  record upstream: on 2026-11-12 the Legistar API returned Council Member Maloney's own
  profile page, so the 2.7.0 workaround is removed. The override mechanism stays, with an
  empty list, for the next upstream error.
- **`upcoming_events` no longer shows a called-off meeting as on
  ([#42](https://github.com/BetaNYC/nyc-council-mcp/issues/42)).** Legistar changed event
  22725 to Deferred without updating its last-modified time, so the archive kept "Final".
  On 2026-11-12, 10 of 658 meetings in 2026 differed this way. With `LEGISTAR_TOKEN` set,
  `upcoming_events` now checks each meeting's status with one live request
  (`status_checked_live`, plus `agenda_status_index` when they differ), and a note lists
  meetings the index does not have yet. If the live call fails, the index's answer stands
  and the note says so.
- **Local answers say how old their data is
  ([#25](https://github.com/BetaNYC/nyc-council-mcp/issues/25)).** Every answer from the
  local index ends with a source line: when the index was built and which archive commit
  it came from. The indexer now records `archive_commit` and `archive_commit_date`. With no
  token, the line also says the answer was not checked live, and that an empty answer
  means "not in this index". The hard-coded "may be 1–7 days stale" guess is gone.
- **`get_voting_record` says when each vote happened
  ([#41](https://github.com/BetaNYC/nyc-council-mcp/issues/41)).** Rows now carry
  `vote_date`, `vote_action` and `vote_body` from the matter's history, and are ordered
  by vote date, not by the bill's intro date. Before, a 2024 bill voted on in 2026 read
  like an old vote. The future `intro_date` in the report came from Legistar itself
  (MatterIntroDate), which has since been corrected upstream.
- **Member names match the way people type them
  ([#40](https://github.com/BetaNYC/nyc-council-mcp/issues/40)).** `get_council_member`,
  `get_voting_record` and `co_sponsors` found nobody for "Carmen De La Rosa", because
  Legistar stores "Carmen N. De La Rosa". About 30 of 181 active Legistar people have a
  middle initial, a trailing or double space, or an accent ("Amanda C. Farías"). Names
  now match word by word, in any order, ignoring case, accents, middle initials and
  extra spaces. Every word you type must match, so "Carmen De La Rosa" no longer
  matches "John LaRosa". `get_council_member` now fetches the active members and
  matches in code, because Legistar's search cannot ignore accents.
- **`legistar_url` now works for every matter type, not just Introductions
  ([#45](https://github.com/BetaNYC/nyc-council-mcp/issues/45)).** Resolutions, Land
  Use, M, T and the rest were always `null`. The link is now
  `https://legistar.council.nyc.gov/gateway.aspx?M=L&ID={MatterId}`, which redirects
  from the WebAPI id to the right `LegislationDetail.aspx` page. Checked live on five
  Resolutions/T-items and an Introduction. `gateway.aspx` is not in Granicus's API
  docs; the README says so.

### Changed
- **Dependencies: zod 4 and MCP SDK 1.32.2 or later; `npm audit` reports 0 vulnerabilities.**
  The 2.7.1 lockfile pinned SDK 1.29.0 and zod 3.25.76, and `npm audit` flagged 9 issues. Most sat
  in the SDK's HTTP transports, which this stdio server does not use. zod had a memory-exhaustion
  advisory fixed only in zod 4 (GHSA-mrhx-c7xc-m3w5).
- **The copyright line names BetaNYC as a project of the Fund for the City of New York**
  (LICENSE and README), BetaNYC's standard wording. The license itself is unchanged (MIT).
- **README follows the shared BetaNYC MCP layout
  ([#35](https://github.com/BetaNYC/nyc-council-mcp/issues/35), this repo only).** What it
  does and a quick start come first; setup, configuration, tools, how it works, known
  traps, testing and releases follow in the same order as the other servers will use.
  New: badges, a "What it does" section with corpus counts, a "Notes and limitations"
  section, and a "Testing and CI" section. No content was removed.
- **`search_legislation` is now the main name, and `search_bills` the alias
  ([#21](https://github.com/BetaNYC/nyc-council-mcp/issues/21)).** The tool returns every
  matter type, not only bills, so the old main name misdescribed it. Both names still work
  and return the same results; the alias's definition is now built from the main one, so
  the two cannot drift.
- **Cleanup carried over from the stale PR #7
  ([#36](https://github.com/BetaNYC/nyc-council-mcp/issues/36)).** The archive is walked
  with a plain directory read instead of `fast-glob`, so that dependency is gone. On the
  real archive it finds the same files (254 people, 21,803 matters, 17,532 events). Paths
  are never parsed as patterns, so the Windows and "(x86)" path bugs from #12 cannot come
  back. The 21 copied answer wrappers are one shared helper. Still supports Node 18.
- **`get_event_bills` is paged
  ([#29](https://github.com/BetaNYC/nyc-council-mcp/issues/29)).** It now returns
  `{ event_id, total, offset, limit, items }` instead of a bare array, 50 items per page by
  default (max 500). One stated meeting (event 22592) has 178 items; the first page is
  now about 28 KB instead of about 85 KB, and `total` says there is more.
- **`get_upcoming_hearings` returns a short shape by default
  ([#22](https://github.com/BetaNYC/nyc-council-mcp/issues/22)).** Per meeting: date, time,
  body, location, agenda status and links. Per agenda item: its id (the one `get_votes`
  takes), matter file, name, type and status, `legistar_url`, and a title cut at 300
  characters (`EventItemTitleTruncated: true` when cut). Null fields are dropped. On
  2026-11-12 the next 14 days came to 161 KB instead of 470 KB. `detail: "full"` returns the
  old payload unchanged.
- Introductions now link through `gateway.aspx` too, not intro.nyc, so one rule
  covers every type.
- `get_bill_hearings`, `get_event_bills` and `get_voting_record` rows now include
  `matter_id`, the id the link is built from.

## [2.7.1] - 2026-11-09

### Added
- **Listing in the official MCP Registry as `io.github.BetaNYC/nyc-council-mcp`.**
  `package.json` carries `mcpName`, which the registry checks on the published npm
  package, so this release exists to put it there. `server.json` is the listing; a new
  `publish-mcp.yml` workflow publishes it after the Release workflow succeeds, logging in
  with GitHub OIDC (no stored secret). The Release workflow now fails if `server.json`
  and `package.json` disagree on version or name.
- **`glama.json`** names the maintainer so the Glama listing can be claimed.

No change to the server's behavior or tools.

## [2.7.0] - 2026-10-11

### Fixed
- **Fixes the empty index on Windows
  ([#12](https://github.com/BetaNYC/nyc-council-mcp/issues/12)); covered by a new
  windows-latest CI job.** Glob patterns were built
  with `path.join(archiveRoot, ...)`, which emits backslashes on Windows; fast-glob reads
  those as escape characters, so nothing matched and `index` reported
  `bills=0 events=0 people=0 errors=0` as if it had succeeded. The archive root is now
  passed as fast-glob's `cwd` with POSIX relative patterns, as fast-glob's README
  prescribes. The same bug affected archive paths containing glob syntax (`(x86)`,
  `[...]`) on every OS. Thanks to NewDestinyDan and BenWeinbergNYC for the diagnosis.
- **`index` fails loud on an empty archive.** Zero matching files across the archive now
  throws before the database is opened (exit 1, existing index untouched), and a source
  directory that exists but matches nothing is warned about on stderr.
- **`get_council_member` no longer returns another member's Legistar profile**
  ([#38](https://github.com/BetaNYC/nyc-council-mcp/issues/38)). The Council's Legistar
  record for Virginia Maloney (PersonId 7894) carries Elsie Encarnación's `PersonWWW2`.
  A dated override list (`PERSON_WWW2_OVERRIDES`) corrects known-bad upstream links, only
  while upstream still carries the bad value, and keeps the original in
  `PersonWWW2_upstream` with a `PersonWWW2_warning`. Any `PersonWWW2` shared by two people
  in one result is flagged.

### CI
- A `windows-latest` / Node 22.x job runs the full build and test suite (#12).

## [2.6.0] - unreleased

### Added
- **Roll-call votes and matter history are indexed from the archive**
  ([#30](https://github.com/BetaNYC/nyc-council-mcp/issues/30)). One traversal of each
  matter's `History[]` now populates two tables: `votes` (one row per member entry in a
  roll call, from `History[].Votes`) and a new `matter_history` (one row per action — the
  matter's timeline). Both come from the local archive, so no network and no
  `LEGISTAR_TOKEN` are involved, and indexing covers all three matter trees —
  `introduction`, `resolution`, and `land_use` (the densest vote source, ~80–98% of Land
  Use matters carry a roll call). `History[].ID` is the `EventItemId` and each
  `Votes[].ID` is the `PersonId`, both verified against the live endpoints. This resolves
  [#19](https://github.com/BetaNYC/nyc-council-mcp/issues/19) — the `votes` table is no
  longer empty, so the named-error guard shipped in 2.5.0 stops firing.
- **`get_bill_history` now has a local path** and, like every sibling tool, accepts a
  type-prefixed **file number** (e.g. `Int 1122-2024`) instead of demanding a numeric
  matter id. It answers from `matter_history` in chronological order with no token. The
  live variant remains for live-only mode and freshness.

### Changed
- **`vote_breakdown` returns roll calls grouped by event item, each with a positions-only
  tally.** A matter decided in committee and then in full Council returns both roll calls
  separately; the tally counts positions (Affirmative / Negative / Abstain) and **never**
  `COUNT(*)`s the rows, so an Absent member is not scored as a vote (the `Res 0540-2026`
  committee roll call tallies 14–1 across 17 recorded entries). `vote_breakdown` and
  `get_voting_record` now join `votes.matter_id` to `bills.matter_id` instead of
  `event_items.file_number` (NULL in every row), removing the dependency on #26. A bare
  file number that matches both an `Int` and a `Res` is rejected, naming each (as #27 did
  for `get_bill`).
- **`SCHEMA_VERSION` is now 5.** The `votes` primary key changed from a source-less
  `vote_id` to the natural `(event_item_id, person_id)` (unique within a roll call, and
  idempotent on re-index). A full rebuild now drops and recreates the data tables before
  indexing, so the new DDL is actually applied to an existing corpus — `CREATE TABLE IF NOT
  EXISTS` alone would have silently kept the old `votes` table. A corpus built under schema
  4 is detected as stale and rebuilt automatically on the next index run.

### Fixed
- **`get_bill` with a bare file number no longer hides matters of another type**
  ([#27](https://github.com/BetaNYC/nyc-council-mcp/issues/27)). Legistar's `MatterFile`
  values are type-prefixed, so a bare `NNNN-YYYY` was probed against `Int`, `Res`, `LU` in
  order and the **first** hit was returned. A number that exists as more than one type
  resolved to whichever prefix was tried first: `0540-2026` returned `Int 0540-2026` (an
  Introduction still in committee) and silently hid `Res 0540-2026` (the *adopted* FY2027
  contract-budget resolution) — the wrong matter, with nothing signalling the other exists.
  A bare number now probes every prefix in parallel; a single match returns that matter,
  and an ambiguous one (more than one match) is **rejected** with an error naming every
  match, so the caller re-calls with the exact type-prefixed file number. A type-prefixed
  input is unambiguous and still costs exactly one request. The success shape is unchanged
  from before this fix (a single matter object); only the previously-wrong ambiguous case
  now errors instead of silently returning one — so this is not a breaking change.

## [2.5.0] - 2026-07-22

npm went straight from 2.3.0 to 2.5.0; the same-day `2.4.0` release commit was bumped but never published, so its change is folded in here.

### Fixed
- **Unknown tool parameters are rejected instead of silently dropped**
  ([#20](https://github.com/BetaNYC/nyc-council-mcp/issues/20)). Every advertised
  `inputSchema` now sets `additionalProperties: false`, and every zod object that parses
  tool arguments is `.strict()`. Previously
  `search_legislation(query="broadband", bogus_unknown_param="x")` returned a normal
  result row: real, correctly-sourced data answering a *different* question, with nothing
  signalling that a filter had been dropped. The refusal names the offending key and lists
  the parameters that tool does accept.
- **Vote tools raise a named error for the unpopulated `votes` table**
  ([#19](https://github.com/BetaNYC/nyc-council-mcp/issues/19)) — the interim guard. An
  empty array from `vote_breakdown` / `get_voting_record` is indistinguishable from "this
  member cast no votes," so both fail with a named error instead of returning `[]`. Fully
  resolved in 2.6.0, where #30 populates the table from the archive.

## [2.3.0] - 2026-07-17

Merged in [#13](https://github.com/BetaNYC/nyc-council-mcp/pull/13); this release ships it
(the PR landed without a version bump, so 2.2.0 on npm predates the feature).

### Added
- **`legistar_url` on matter/legislation records** — a link a person can actually open.
  Populated only for Introductions via the [intro.nyc](https://intro.nyc) redirector
  (`https://intro.nyc/{NNNN-YYYY}`); `null` for every other type. Hand-building
  `LegislationDetail.aspx?ID={MatterId}&GUID={MatterGuid}` does not work — NYC runs two
  Legistar backends and the OData ids are not the public site's ids ("Invalid parameters!").
  intro.nyc keys on the bare number and assumes Introduction, so non-Int types get no link
  rather than a wrong one. Applied via one shared `legistarUrl()` helper across live tools
  (`get_bill`, `search_legislation_live`, `list_recent_legislation`) and local index tools
  (`search_bills`/`search_legislation`, `recent_bills`, `get_voting_record`,
  `get_bill_hearings`, `get_event_bills`). README documents the two-backends trap.

## [2.2.0] - 2026-07-07

Surfaced by real-world use searching for historical NYC budget legislation
(Section 254 capital-program resolutions and discretionary-funding
designations): multi-word searches returned nothing and resolutions were
undiscoverable without an exact file number.

### Fixed

- **Local index was missing every Resolution and Land Use matter.** The
  indexer walked only the archive's `introduction/` directory, so ~40% of all
  matters — 6,030 Resolutions and 2,497 Land Use Applications — were never
  indexed, even though the README advertised "all bills and resolutions".
  Full-text search for words that appear only in resolutions (e.g.
  "designation", "CAPITAL PROGRAM FOR THE ENSUING THREE YEARS") returned
  nothing. The indexer now walks `introduction/`, `resolution/`, and
  `land_use/` (21,396 matters total, up from ~12,900). `resubmit/` is
  intentionally excluded — it is a cross-session mapping, not matter data.
  This also fixes `search_bills`/`search_legislation` needing an exact
  `Res ####-YYYY` file number to find a resolution: they are now full-text
  searchable. **Re-run the index** (`npx @betanyc/nyc-council-mcp index …`) to
  pick up the newly-covered matters.
- **`search_legislation_live` multi-word queries matched almost nothing.** The
  whole query was sent as one `substringof` (a contiguous-substring match), so
  "section 254 capital budget" required that exact phrase in a title. The query
  is now tokenized into AND-ed `(title OR name)` groups per word (OData v3
  `substringof`/`and`/`or`), so a matter containing all the words in any order
  matches. Quote a `"phrase"` to require adjacency. An empty query now returns
  `[]` instead of matching every matter.

### Added

- `search_legislation_live` gains an optional `order` parameter
  (`date_desc` default, `date_asc`). Legistar's OData API has no full-text
  relevance ranking, so results are ordered by introduction date; `date_asc`
  surfaces the oldest matches first, the way to reach historical legislation
  without a very high `limit`. Documented as an upstream limitation in the tool
  description.

## [2.1.1] - 2026-07-06

### Fixed

- Double-encoding broke multi-word live searches: `encodeURIComponent` inside
  `$filter` was encoded again by `URLSearchParams`. New `odataString()` helper
  handles OData quote escaping with a single encoding pass. Affected
  `search_legislation_live`, `get_council_member`, `get_committee`, `get_bill`.
- `get_bill` never matched bare file numbers (Legistar `MatterFile` is
  type-prefixed); it now retries `NNNN-YYYY` with `Int`/`Res`/`LU` prefixes.
- `search_bills` `agency` parameter now actually filters results (WHERE on
  title/sponsors) instead of only decorating snippets.
- FTS queries are tokenized into AND-ed quoted terms via `buildFtsQuery()` —
  no more forced exact-phrase matching, and FTS operator characters can no
  longer crash `MATCH`.
- Date windows are built in America/New_York via shared `nyDateString()`
  (`src/dates.ts`), fixing off-by-one-day windows after 8pm ET.
- `get_votes` description corrected to EventItemId (from
  `/events/{EventId}/eventitems`), not `MatterHistoryEventId`.
- MCP server version is read from `package.json` instead of a hardcoded
  string that had drifted (`2.0.0`).

### Documentation

- README: removed the unread `LEGISTAR_LINK_BILLS` env var; added a caveat
  that `vote_breakdown`, `get_voting_record`, and `get_bill_hearings`
  currently return empty results (local index lacks vote/event-item data,
  pending a data-source decision), with a live-path workaround.

## [2.1.0] - 2026-07-01

### Added

- Hearing agenda items populated in `get_upcoming_hearings` (#5).
- CI build & test gate on a Node 20.x/22.x matrix (#6).

### Fixed

- Resolved a high-severity transitive advisory in `hono`.
- Synced `package-lock.json` self-version to `package.json`.

### Documentation

- Clear API-key subsection in the README (#4).
- Documented the `LEGISTAR_LINK_BILLS` env var and token cost note; corrected
  its URL format.

## [2.0.0] - 2026-05-26

### Changed

- **Breaking:** v2 hybrid mode — local SQLite index plus live Legistar API,
  replacing the v1 live-only design.

## [1.0.1] - 2026-05-22

### Added

- npm keywords for discoverability.
- MIT LICENSE file and full license text in the README.

## [1.0.0] - 2026-05-19

### Added

- Initial public release: MCP server for NYC Council legislative data via the
  Legistar API — bills, hearings, votes, committees, and council members.

[Unreleased]: https://github.com/BetaNYC/nyc-council-mcp/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/BetaNYC/nyc-council-mcp/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/BetaNYC/nyc-council-mcp/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/BetaNYC/nyc-council-mcp/compare/v1.0.0...v2.1.0
[2.0.0]: https://github.com/BetaNYC/nyc-council-mcp/commit/6dc18f7
[1.0.1]: https://github.com/BetaNYC/nyc-council-mcp/commit/c6f4de0
[1.0.0]: https://github.com/BetaNYC/nyc-council-mcp/releases/tag/v1.0.0

<!-- 2.0.0 and 1.0.1 were published before this repo started tagging releases,
so their links point at the version-bump commits rather than tags. -->

