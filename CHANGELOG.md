# Changelog

All notable changes to `@betanyc/nyc-council-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dates are npm publish dates (`npm view @betanyc/nyc-council-mcp time`).

## [2.5.0] - unreleased

### Fixed
- **`vote_breakdown` and `get_voting_record` no longer answer a vote question with `[]`**
  ([#19](https://github.com/BetaNYC/nyc-council-mcp/issues/19)). The `votes` table is never
  populated, so both returned an empty array for every member, including four-year
  incumbents — indistinguishable from a true negative, and read by a caller as "this member
  cast no votes." Both now raise a named error naming the gap and the live-API path that
  does have per-member positions. One guard in `src/db/queries.ts` covers both callers and
  any future one; it fires only while the table is genuinely empty, so a later re-index
  works normally without a restart. Indexing the archive's `RollCall` data is deliberately
  **not** done here: it is attendance (Present / Absent / Excused / Medical / Conflict),
  not aye/nay, and whether it belongs in a table called `votes` is an open naming decision.

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

