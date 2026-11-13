# @betanyc/nyc-council-mcp

[![npm](https://img.shields.io/npm/v/@betanyc/nyc-council-mcp)](https://www.npmjs.com/package/@betanyc/nyc-council-mcp)
[![CI](https://github.com/BetaNYC/nyc-council-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/BetaNYC/nyc-council-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for NYC Council legislative data. Version 2 adds a **hybrid mode**: a local SQLite index for sub-second search and exploration, plus the live [NYC Legistar API](https://council.nyc.gov/legislation/api/) for authoritative real-time data.

Built by [BetaNYC](https://beta.nyc) with [Claude](https://claude.ai).

---

## What it does

Ask an AI assistant about New York City Council legislation and get answers grounded in the Council's own records: bills, resolutions and land use items, their full text and summaries, sponsors, hearings, votes, committee memberships and attachments.

The local index holds every matter in the [jehiah/nyc_legislation](https://github.com/jehiah/nyc_legislation) archive: on 2026-11-11 that was 21,803 matters (13,059 Introductions, 6,198 Resolutions, 2,545 Land Use items), 17,532 meetings, 517,562 individual recorded votes and 254 people. The live tools read the Council's [Legistar API](https://council.nyc.gov/legislation/api/) directly.

---

## Quick start

The recommended setup, for Claude Code:

Register at user scope so the server is available from any project:

```bash
claude mcp add nyc-council-mcp \
  --scope user \
  npx -- -y @betanyc/nyc-council-mcp serve
```

Then add your environment variables to `~/.claude.json` under the `mcpServers` entry:

```json
{
  "mcpServers": {
    "nyc-council-mcp": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-council-mcp", "serve"],
      "env": {
        "LEGISTAR_TOKEN": "your_token_here",
        "LEGISTAR_DB_PATH": "/Users/you/legistar/legistar.db"
      }
    }
  }
}
```

Set only `LEGISTAR_TOKEN` for live-only mode, or only `LEGISTAR_DB_PATH` for local-only mode.

---

## Prerequisites

- Node.js 18 or later
- **For live tools:** a free Legistar API key — [register here](https://council.nyc.gov/legislation/api/)
- **For local tools:** the `jehiah/nyc_legislation` archive (~920 MB, one-time clone)

---

## Installation

### Recommended: hybrid mode (both data sources)

**Step 1 — Get a Legistar API key**

Register at [council.nyc.gov/legislation/api](https://council.nyc.gov/legislation/api/). You'll receive a token by email.

**Step 2 — Clone the legislation archive**

```bash
git clone --depth 1 https://github.com/jehiah/nyc_legislation.git ~/legistar/nyc_legislation
```

This is about 920 MB and takes a few minutes. It only needs to be done once.

**Step 3 — Build the local index**

```bash
npx @betanyc/nyc-council-mcp index \
  --archive ~/legistar/nyc_legislation \
  --db ~/legistar/legistar.db \
  --verbose
```

This takes roughly 15 seconds and produces a `legistar.db` file of about 900 MB (it indexes ~21,500 matters, ~17,300 events, and ~509,000 roll-call vote rows).

**Step 4 — Configure your MCP client**

Add both environment variables to your MCP config. See [Configuration](#configuration) below.

---

### Live-only mode (no local index)

If you only want the live Legistar API tools and don't need local search, just set `LEGISTAR_TOKEN` and skip the archive clone.

---

### Local-only mode (no API key)

If you only want fast local search (no real-time data), set `LEGISTAR_DB_PATH` and skip the API key. Note: `get_upcoming_hearings`, `get_bill` (current status), and similar live tools will be unavailable.

### Build from source

```bash
git clone https://github.com/BetaNYC/nyc-council-mcp.git
cd nyc-council-mcp
npm install && npm run build
LEGISTAR_TOKEN=your_token LEGISTAR_DB_PATH=./legistar.db node dist/index.js serve
```

### Keeping your index fresh

The archive is updated most weekdays. Run these two commands to pull the latest data and update your index:

```bash
# Pull the latest archive files
cd ~/legistar/nyc_legislation && git pull

# Rebuild incrementally (only processes new/changed files — takes seconds after the first build)
npx @betanyc/nyc-council-mcp index \
  --archive ~/legistar/nyc_legislation \
  --db ~/legistar/legistar.db
```

You never need to wait for a BetaNYC-hosted snapshot. Incremental mode (the default) is fast enough to run manually whenever you want fresh data.

**Automated daily updates (cron):**

```bash
# Add to your crontab: daily at 6am
0 6 * * * cd ~/legistar/nyc_legislation && git pull && npx @betanyc/nyc-council-mcp index --archive ~/legistar/nyc_legislation --db ~/legistar/legistar.db
```

**Force a full rebuild:**

```bash
npx @betanyc/nyc-council-mcp index \
  --archive ~/legistar/nyc_legislation \
  --db ~/legistar/legistar.db \
  --full
```

> **Note:** The local index is only as current as your last index run — run the daily cron above and it stays about a day behind live Legistar; leave it for a month and it is a month stale. The upstream archive itself updates most weekdays. For current status and upcoming hearings, use the live API tools (`get_bill`, `get_upcoming_hearings`).
>
> Every local answer ends with a **source line**: when the index was built and which `jehiah/nyc_legislation` commit it came from, e.g. `Source: local index built 2026-11-12T11:30:07Z from jehiah/nyc_legislation@9e52935 (archive commit 2026-11-11T23:38:10Z).` It is a second text item, after the JSON. With no `LEGISTAR_TOKEN`, the line also says the answer was not checked live, and that an empty answer means "not in this index", not "does not exist".
>
> **Why upcoming meeting status is checked live:** Legistar can change a meeting's status without updating its last-modified time. Event 22725 went from Final to Deferred with its timestamp still 2026-09-10, so the archive never fetched it again. On 2026-11-12, 10 of 658 meetings in 2026 differed this way, all Final → Deferred.

---

## API key

A free API key is **optional** — it unlocks the live Legistar API tools, but the server also runs in local-only mode without one.

- **Live tools** (`get_bill` current status, `get_upcoming_hearings`, confirmation queries) require a free **Legistar API key**. Register at [council.nyc.gov/legislation/api](https://council.nyc.gov/legislation/api/) — you'll receive a token by email — and set it as the `LEGISTAR_TOKEN` environment variable.
- **Local fast-path tools** (search, browse, voting history, aggregation) need no key — they read the local SQLite index at `LEGISTAR_DB_PATH`.

You must set at least one of `LEGISTAR_TOKEN` or `LEGISTAR_DB_PATH`; set both for full hybrid mode. Example (live tools):

```bash
export LEGISTAR_TOKEN="your-legistar-token"
```

See [Setup](#installation) and [Environment variables](#environment-variables) for full details.

---

## Configuration

### Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `LEGISTAR_TOKEN` | Live API tools | Register at [council.nyc.gov/legislation/api](https://council.nyc.gov/legislation/api/) |
| `LEGISTAR_DB_PATH` | Local SQLite tools | Path to your built `legistar.db` |
Do not commit tokens to version control.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nyc-council": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-council-mcp", "serve"],
      "env": {
        "LEGISTAR_TOKEN": "your_token_here",
        "LEGISTAR_DB_PATH": "/Users/you/legistar/legistar.db"
      }
    }
  }
}
```

---

## Tools reference

### Fast-path tools (local SQLite index)

These require `LEGISTAR_DB_PATH` and a built index (see [Setup](#installation)).

| Tool | Description |
|---|---|
| `search_legislation` | Full-text search across all legislation: Introductions, Resolutions, Land Use and every other matter type. Searches titles, sponsors, summaries and the full text; a title hit ranks above a body hit. Rows carry `version` and `local_law` |
| `get_matter` | One matter by file number (`Int 1122-2024`) or Local Law number (`2025/153`): summary, version, Local Law number, attachments with download links, `legistar_url`, and the full text on request (`include_text`) |
| `get_member_roles` | A member's committees (chairs listed separately), caucuses, party conferences, borough delegations and task forces, from Legistar's own membership records. Today by default; `as_of` for a past date; `include_past` for the full history with dates. No party is inferred from caucus or conference |
| `committee_roster` | Who sits on a committee, chair first, on a date or across its history |
| `search_bills` | Alias for `search_legislation` (same tool, same results; kept so existing callers work) |
| `search_events` | Full-text search across committee hearings |
| `list_committees` | All committees with bill and event counts |
| `recent_bills` | Bills introduced in the last N days |
| `upcoming_events` | Scheduled events in the next N days. With `LEGISTAR_TOKEN` set, each meeting's `agenda_status` is checked live (`status_checked_live`; the index's value stays in `agenda_status_index` when they differ), and meetings the index doesn't have yet are listed in a note |
| `aggregate_bills` | Count bills grouped by status, type, committee, or year |
| `vote_breakdown` | Every member's vote on a bill (by type-prefixed file number), grouped by roll call — committee and full Council — each with a positions-only tally. Indexed from the archive's `History[].Votes` |
| `get_voting_record` | All votes cast by a named council member, newest vote first. Each row has `vote_date`, `vote_action` and `vote_body`; `intro_date` is the bill's, not the vote's |
| `get_bill_history` | A matter's action trail — hearings, referrals, committee/Council actions, outcomes — in chronological order, by file number. No token required |
| `co_sponsors` | Members who most often co-sponsor with a given member |
| `get_bill_hearings` | Events where a bill appeared on the agenda, with each event's date, body, and action |
| `get_event_bills` | Items on one event's agenda, paged: `{ event_id, total, offset, limit, items }`, 50 per page by default (max 500) |

### Confirm-path tools (live Legistar API)

These require `LEGISTAR_TOKEN`.

| Tool | Description |
|---|---|
| `get_bill` | Current status and record for a bill. A bare `NNNN-YYYY` number is ambiguous (it can be both an `Int` and a `Res`); an ambiguous match is rejected with an error naming every candidate, so re-call with the exact type-prefixed number |
| `get_bill_history` | *Local by default* (served from the index, no token; takes a file number). In **live-only** mode this live variant answers instead — authoritative action trail by numeric matter id |
| `get_bill_attachments` | Files attached to a matter (committee reports, resolution text, charts, transcripts), each with a direct download link. Takes the numeric matter id |
| `get_upcoming_hearings` | Real-time upcoming committee hearings and Stated meetings, each with its agenda items (bills/matters) in `EventItems`. Short shape by default (`detail: "summary"`: no null fields, titles cut at 300 characters, `legistar_url` per item); `detail: "full"` returns every Legistar field |
| `get_council_member` | Current contact info and active status for a council member. The name matches word by word, ignoring case, accents and middle initials ("Amanda Farias" finds "Amanda C. Farías"); `get_voting_record` and `co_sponsors` match names the same way. `PersonWWW2` (the Legistar profile page) is checked: a known-bad upstream link is corrected from a small dated override list (`PERSON_WWW2_OVERRIDES` in `src/legistar.ts`, with the original kept in `PersonWWW2_upstream`), and a link shared by two people in one result gets a `PersonWWW2_warning` |
| `get_committee` | Current membership count and details for a committee |
| `get_votes` | Per-item vote breakdown by event item ID |
| `list_recent_legislation` | Most recently introduced legislation (catches bills since last index) |
| `search_legislation_live` | Live Legistar search (slower than local, always current). Multi-word queries match all words in any order; quote a `"phrase"` for adjacency. No relevance ranking upstream — results are ordered by intro date (`order='date_asc'` for oldest-first). |

### Tool details

#### `search_legislation` / `search_bills`

Full-text search across the local index, which covers Introductions,
Resolutions, and Land Use Applications. Multi-word queries match matters
containing all the words in any order; quote a `"phrase"` to require adjacency.

> **Upgrading from ≤ 2.1.1:** Resolutions and Land Use matters were previously
> absent from the index. Re-run `npx @betanyc/nyc-council-mcp index …` after
> updating to pick them up.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | yes | — | Search terms |
| `limit` | number | no | 25 | Max results (max 100) |
| `agency` | string | no | — | Agency key or name for role-context snippets (e.g. `DEP`, `NYPD`) |
| `status` | string | no | — | Filter by status (e.g. `Enacted`, `Laid Over`) |
| `committee` | string | no | — | Filter by committee name |

```
search_bills("open data")
search_bills("bicycle lane", agency="DOT", status="Enacted")
search_bills("tenant protection", committee="Housing")
```

#### `aggregate_bills`

Count bills grouped by a dimension.

| Parameter | Type | Required | Options |
|---|---|---|---|
| `group_by` | string | yes | `status`, `type`, `committee`, `year` |

```
aggregate_bills(group_by="status")
aggregate_bills(group_by="year")
```

> **Roll calls are indexed locally** ([#30](https://github.com/BetaNYC/nyc-council-mcp/issues/30)).
> Each matter's `History[].Votes` is indexed into a `votes` table, so `vote_breakdown`,
> `get_voting_record`, and `get_bill_history` answer from the corpus with no token.
> A member's entry is a *position* (Affirmative / Negative / Abstain) or a *non-position*
> reason for not casting one (Absent, Excused, Medical …); both are stored, but a **tally
> counts positions only** — an Absent member is never scored as a vote.
> If the `votes` table is empty the tools still raise a named error rather than return `[]`
> (which reads as "cast no votes"); that means the corpus predates roll-call indexing and
> needs a `nyc-council-mcp index` rebuild. `get_votes` remains for live per-item positions.

#### `vote_breakdown`

Every member's vote on a matter, grouped by roll call (committee and full Council
appear separately), each with a positions-only tally. `Res 0540-2026` returns its
Council roll call (45–6, 51 recorded) and its Committee on Finance roll call (14–1,
17 recorded — the tally is 14–1, not 17).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_number` | string | yes | Type-prefixed file number, e.g. `Res 0540-2026`. A bare `NNNN-YYYY` that matches both an `Int` and a `Res` is rejected, naming each |

#### `get_bill_history`

A matter's action trail in chronological order — introduced, referred, heard, amended,
approved, enacted — one row per action, with the acting body and date. Served from the
local `matter_history` table, so it needs no token. Each action also carries the
`event_item_id` of the meeting item it happened at, which is the id `get_votes` takes if
you want to confirm a roll call against the live API.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_number` | string | yes | Type-prefixed file number, e.g. `Int 1122-2024` |

#### `get_voting_record`

All votes cast by a council member.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `member_name` | string | yes | — | Full or partial name |
| `limit` | number | no | 50 | Max results |

#### `co_sponsors`

Members who most frequently co-sponsor bills with a given member.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `member_name` | string | yes | — | Full or partial name |
| `limit` | number | no | 20 | Top N co-sponsors |

### Agency snippets

When you pass `agency` to `search_bills`, results include a role-context snippet showing HOW the agency appears in the bill — whether it is directed, consulted, or reporting. This helps distinguish bills that merely mention an agency from those that grant or restrict its authority.

Supported agency keys: `DEP`, `DOT`, `NYPD`, `FDNY`, `DOB`, `HPD`, `HRA`, `DSS`, `ACS`, `DOHMH`, `DHS`, `DCAS`, `DSNY`, `DPR`, `DCP`, `FINANCE`, `LAW`, `MAYOR`, `COMPTROLLER`, `MTA`, `EDC`, `SBS`, `DCWP`, `DYCD`, `DFTA`, `DOE`, `CUNY`, and more.

You can also pass a full name: `agency="department of transportation"` or `agency="sanitation"`.

---

## Common workflows

### Explore a topic, then confirm

```
1. search_bills("e-bike")              → sub-second results from local index
2. get_bill("Int 0042-2024")           → authoritative current status from live API
3. get_bill_history("Int 0042-2024")   → full action trail from the local index (no token)
4. vote_breakdown("Int 0042-2024")     → how each member voted, per roll call, from the local index
```

### Analyze a council member's record

```
1. get_voting_record("Nurse")          → all votes cast
2. co_sponsors("Nurse")               → frequent co-sponsors
3. search_bills("bicycle", committee="Transportation")  → bills in their area
```

### Track upcoming hearings

```
1. upcoming_events(days=14)            → from local index (as fresh as your last index run)
2. get_upcoming_hearings()             → from live API (real-time)
```

`get_upcoming_hearings` populates each event's `EventItems` array with the agenda
items (the bills/matters on that hearing's agenda), fetched per event from the
Legistar `/events/{EventId}/eventitems` endpoint. The `/events` list endpoint
itself always returns `EventItems` empty and ignores `$expand`, so the follow-up
call is required. Pass `include_agenda=false` to skip it and return the hearing
schedule faster with `EventItems` empty.

---

## How it works

### Two-speed design

| Path | Speed | Data | Use for |
|---|---|---|---|
| **Local index** (SQLite) | < 1 second | As fresh as your last index run | Search, browse, voting history, aggregation |
| **Live API** (Legistar) | 1–5 seconds | Real-time | Current status, upcoming hearings, confirmation |

Use both together for the best experience. Search locally to explore; confirm with the live API when accuracy matters.

### Index CLI reference

```
nyc-council-mcp index [options]

Options:
  --archive <path>    Path to jehiah/nyc_legislation clone (required)
  --db <path>         SQLite output path (default: $LEGISTAR_DB_PATH or ./legistar.db)
  --full              Force a full rebuild (default: incremental)
  --verbose           Print progress to stderr
  --help              Show help
```

**Incremental mode upgrades itself to a full rebuild when it has to.** Even without
`--full`, the indexer rebuilds from scratch if either has changed since your last run:

- the **schema version** — the corpus was built by an older release whose tables differ, or
- the **set of indexed sources** — the indexer now walks matter trees it did not before.

This matters because an incremental run skips files by modification time, so widening
coverage would otherwise leave older files permanently unindexed. When a trigger fires,
`--verbose` names it and the run drops and recreates the data tables before indexing.
Upgrading to 2.6.0 fires the schema trigger once, so your **first index after upgrading
takes a full rebuild** (~15 seconds) and picks up roll-call votes and matter history.

**An archive with no matching files is an error, not an empty index.** If `--archive`
points at a directory where none of `people/*.json`, `introduction/**/*.json`,
`resolution/**/*.json`, `land_use/**/*.json` or `events/**/*.json` match, `index` exits
non-zero and leaves any existing database untouched. A source directory that exists but
matches nothing is reported on stderr. The build uses portable paths (including archive
paths with spaces, parentheses or brackets) and is tested in CI on Windows as well as Linux.

---

## Notes and limitations

### `legistar_url` — the human-openable link

Bill/matter records include a `legistar_url` field: a link a person can click to
open the matter on Legistar. It works for **every matter type** (Int, Res, LU, M,
T, …) and looks like:

```
https://legistar.council.nyc.gov/gateway.aspx?M=L&ID={MatterId}
```

Why this shape, so nobody re-attempts the obvious-looking fix:

- NYC runs **two Legistar backends with different ids.** The WebAPI this server
  reads exposes `MatterId`/`MatterGuid`; the public `LegislationDetail.aspx` page
  keys on a **separate** ID/GUID that is not in the API record. So
  `LegislationDetail.aspx?ID={MatterId}` returns *"Invalid parameters!"*.
- `gateway.aspx?M=L&ID={MatterId}` takes the **API** id and redirects to the right
  `LegislationDetail.aspx` page. Checked 2026-11-12 on Res 0551, 0595, 0652 and
  0695-2026, T2026-2764 and an Introduction: each landed on its own page. An id that
  does not exist shows *"This record is currently unavailable."*
- **Caveat:** `gateway.aspx` is **not in Granicus's published API docs**. It is how
  the Legistar site links to its own records — observed behavior, not a documented
  contract. `LEGISTAR_LIVE_URL_TEST=1 npm test` re-checks the fixtures live.
- A row with no matter id (a procedural agenda line) gets `null`.
- Through 2.7.1 the link came from [intro.nyc](https://intro.nyc), which keys on the
  bare number and assumes an Introduction, so every other type got `null`
  ([#45](https://github.com/BetaNYC/nyc-council-mcp/issues/45)).

### Known traps

- **One vote row per roll call.** `get_voting_record` returns a row for each roll call a member voted in, so an item voted on in committee and then by the full Council appears twice. `vote_body` and `vote_date` tell them apart; dedupe by `file_number` to count distinct matters.
- **The archive can miss a meeting status change.** Legistar sometimes changes a meeting's status (e.g. to Deferred) without updating its last-modified time, so the archive keeps the old one. With `LEGISTAR_TOKEN` set, `upcoming_events` checks status live; without it, use `get_upcoming_hearings` before relying on a date.
- **`get_event_bills` is paged.** A stated meeting can have 170+ agenda items; read `total` and raise `offset` to get them all.
- **A caucus or conference is not a party.** `get_member_roles` reports Legistar's caucus and party-conference memberships as memberships. The server has no party field.
- **`search_bills` is an alias of `search_legislation`.** Both return every matter type, not only bills.
- **Local answers end with a source line** saying when the index was built and from which archive commit. An empty local answer means "not in this index", not "does not exist".

---

## Testing and CI

```bash
npm test                                   # builds, then runs every test offline
LEGISTAR_LIVE_URL_TEST=1 npm test         # with LEGISTAR_TOKEN set: adds the live checks (read-only GETs)
```

Tests use Node's built-in runner (`node --test test/*.test.mjs`) and never need the network unless `LEGISTAR_LIVE_URL_TEST` is set. [CI](.github/workflows/ci.yml) runs them on every pull request to `main`, on Ubuntu (Node 20 and 22) and Windows (Node 22), and a version guard fails any PR that changes shipped code without a version bump.

### Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp).

Before working on the code, read [`CONTEXT.md`](./CONTEXT.md) — the project's glossary. It
pins down the distinctions this domain punishes you for blurring: a *matter* versus a
*bill* versus a *file number* (which is not unique without its type prefix), an *event*
versus an *event item* (different id spaces), and a *position* versus a *non-position* in a
roll call (both live in the same field, so a tally must filter rather than count rows).

---

## Releases

Publishing is automated. To cut a release:

1. Bump `version` in `package.json` in a PR (with a matching [CHANGELOG.md](CHANGELOG.md) entry).
2. Merge the PR.
3. Push the matching tag: `git tag v<version> && git push origin v<version>`.
4. The [release workflow](.github/workflows/release.yml) runs tests, verifies the tag matches `package.json` and `server.json`, publishes to npm with provenance, and creates a GitHub Release.
5. When it succeeds, [publish-mcp.yml](.github/workflows/publish-mcp.yml) lists that version in the [official MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.BetaNYC/nyc-council-mcp`. Bump `version` in `server.json` (both places) together with `package.json`.

Prerequisite: the `NPM_TOKEN` org secret (an npm automation token with publish rights on `@betanyc`) must be configured. Do not run `npm publish` by hand.

---

## Data sources

- **Live tools:** [NYC Council Legistar API](https://council.nyc.gov/legislation/api/), provided by [Granicus](https://granicus.com/)
- **Local index:** [jehiah/nyc_legislation](https://github.com/jehiah/nyc_legislation) archive — has been mirroring Legistar since 2018, updated most weekdays

### Acknowledgments

This project builds on the foundational work of [@jehiah](https://github.com/jehiah), whose [nyc_legislation](https://github.com/jehiah/nyc_legislation) project has been mirroring NYC Council legislative data since 2018 and powers [intro.nyc](https://intro.nyc/).

The local SQLite index and agency snippet approach are adapted from [WillHsiaoNYC/legistar-mcp](https://github.com/WillHsiaoNYC/legistar-mcp), which introduced the two-speed architecture and role-context snippet design that v2 implements in TypeScript.

Thank you to Nathan Storey for including this project in the [Civic AI Tools Directory](https://www.civicaitools.org/directory).

---

## About BetaNYC

This project is built and maintained by [BetaNYC](https://beta.nyc), New York's
civic technology and open-data community. We work to improve lives in New York
through civic design, technology, data, and public-interest technology.

**Come do civic tech with us.** We run public events, meetups, and hands-on
data classes throughout the year — including [NYC School of Data](https://www.schoolofdata.nyc/)
and [CityCamp NYC](https://citycamp.nyc), and we host frequent civic-tech gatherings. See what's coming up on our
[events calendar](https://www.beta.nyc/events/).

**Sustain this work.** These MCP servers are free and open source. To help keep this work going and find BetaNYC's
tools, please consider [donating and becoming a Beta
Builder](https://beta.nyc/donate).

Freedom isn't free. [Support BetaNYC](https://beta.nyc/donate/).

## Related BetaNYC MCP servers

BetaNYC maintains a suite of open-source MCP servers for NYC and NYS civic data.
See the full directory, with install details for each, at
**[beta.nyc/ai-tools](https://beta.nyc/ai-tools)**.

This server pairs directly with:

- **[nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules)**: trace a bill through to the Charter, Administrative Code, and Rules text it amends.
- **[nyc-budget-mcp](https://github.com/BetaNYC/New-York-City-Budget)**: connect Council members and legislation to the discretionary funding (Schedule C) they direct.

## Building on this? Tell us!

If you build something with this project, we'd love to hear about it. We can help other New Yorkers find it. BetaNYC publishes a weekly newsletter,
*This Week in NYC's Civic Technology and Open Data*.

- **[Subscribe to the newsletter](https://beta.nyc/newsletter)** to keep up with
  NYC civic tech, open data, and public-interest technology.
- **Built something, or found a story worth sharing?** [Submit a link for the
  newsletter](https://www.beta.nyc/newsletter-inbox/) and we'll consider it for
  an upcoming issue.

---

## License

MIT License — Copyright (c) 2026 BetaNYC, a project of the Fund for the City of New York

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
