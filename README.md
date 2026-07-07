# nyc-council-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for NYC Council legislative data. Version 2 adds a **hybrid mode**: a local SQLite index for sub-second search and exploration, plus the live [NYC Legistar API](https://council.nyc.gov/legislation/api/) for authoritative real-time data.

Built by [BetaNYC](https://beta.nyc) with [Claude](https://claude.ai).

---

## API key

A free API key is **optional** — it unlocks the live Legistar API tools, but the server also runs in local-only mode without one.

- **Live tools** (`get_bill` current status, `get_upcoming_hearings`, confirmation queries) require a free **Legistar API key**. Register at [council.nyc.gov/legislation/api](https://council.nyc.gov/legislation/api/) — you'll receive a token by email — and set it as the `LEGISTAR_TOKEN` environment variable.
- **Local fast-path tools** (search, browse, voting history, aggregation) need no key — they read the local SQLite index at `LEGISTAR_DB_PATH`.

You must set at least one of `LEGISTAR_TOKEN` or `LEGISTAR_DB_PATH`; set both for full hybrid mode. Example (live tools):

```bash
export LEGISTAR_TOKEN="your-legistar-token"
```

See [Setup](#setup) and [Environment variables](#environment-variables) for full details.

---

## Two-speed design

| Path | Speed | Data | Use for |
|---|---|---|---|
| **Local index** (SQLite) | < 1 second | 1–7 days fresh | Search, browse, voting history, aggregation |
| **Live API** (Legistar) | 1–5 seconds | Real-time | Current status, upcoming hearings, confirmation |

Use both together for the best experience. Search locally to explore; confirm with the live API when accuracy matters.

---

## Tools

### Fast-path tools (local SQLite index)

These require `LEGISTAR_DB_PATH` and a built index (see [Setup](#setup)).

| Tool | Description |
|---|---|
| `search_bills` | Full-text search across all bills and resolutions |
| `search_legislation` | Alias for `search_bills` |
| `search_events` | Full-text search across committee hearings |
| `list_committees` | All committees with bill and event counts |
| `recent_bills` | Bills introduced in the last N days |
| `upcoming_events` | Scheduled events in the next N days |
| `aggregate_bills` | Count bills grouped by status, type, committee, or year |
| `vote_breakdown` | Every member's vote on a specific bill — **currently returns empty; see caveat under [Local tools](#vote_breakdown)** |
| `get_voting_record` | All votes cast by a named council member — **currently returns empty; see caveat** |
| `co_sponsors` | Members who most often co-sponsor with a given member |
| `get_bill_hearings` | Events where a bill appeared on the agenda — **currently returns empty; see caveat** |
| `get_event_bills` | Bills on a specific event's agenda |

### Confirm-path tools (live Legistar API)

These require `LEGISTAR_TOKEN`.

| Tool | Description |
|---|---|
| `get_bill` | Current status and record for a specific bill |
| `get_bill_history` | Authoritative action trail — hearings, referrals, votes |
| `get_upcoming_hearings` | Real-time upcoming committee hearings and Stated meetings, each with its agenda items (bills/matters) in `EventItems` |
| `get_council_member` | Current contact info and active status for a council member |
| `get_committee` | Current membership count and details for a committee |
| `get_votes` | Per-item vote breakdown by event item ID |
| `list_recent_legislation` | Most recently introduced legislation (catches bills since last index) |
| `search_legislation_live` | Live Legistar search (slower than local, always current). Multi-word queries match all words in any order; quote a `"phrase"` for adjacency. No relevance ranking upstream — results are ordered by intro date (`order='date_asc'` for oldest-first). |

---

## Prerequisites

- Node.js 18 or later
- **For live tools:** a free Legistar API key — [register here](https://council.nyc.gov/legislation/api/)
- **For local tools:** the `jehiah/nyc_legislation` archive (~700 MB, one-time clone)

---

## Setup

### Recommended: hybrid mode (both data sources)

**Step 1 — Get a Legistar API key**

Register at [council.nyc.gov/legislation/api](https://council.nyc.gov/legislation/api/). You'll receive a token by email.

**Step 2 — Clone the legislation archive**

```bash
git clone --depth 1 https://github.com/jehiah/nyc_legislation.git ~/legistar/nyc_legislation
```

This is about 700 MB and takes a few minutes. It only needs to be done once.

**Step 3 — Build the local index**

```bash
npx @betanyc/nyc-council-mcp index \
  --archive ~/legistar/nyc_legislation \
  --db ~/legistar/legistar.db \
  --verbose
```

This takes about 80 seconds the first time and produces a `legistar.db` file (~100–200 MB).

**Step 4 — Configure your MCP client**

Add both environment variables to your MCP config. See [Configuration](#configuration) below.

---

### Live-only mode (no local index)

If you only want the live Legistar API tools and don't need local search, just set `LEGISTAR_TOKEN` and skip the archive clone.

---

### Local-only mode (no API key)

If you only want fast local search (no real-time data), set `LEGISTAR_DB_PATH` and skip the API key. Note: `get_upcoming_hearings`, `get_bill` (current status), and similar live tools will be unavailable.

---

## Keeping your index fresh

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

> **Note:** The local index may be 1–7 days behind live Legistar depending on when you last updated. For current status and upcoming hearings, use the live API tools (`get_bill`, `get_upcoming_hearings`).

---

## Configuration

### Claude Code (recommended)

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

### Build from source

```bash
git clone https://github.com/BetaNYC/nyc-council-mcp.git
cd nyc-council-mcp
npm install && npm run build
LEGISTAR_TOKEN=your_token LEGISTAR_DB_PATH=./legistar.db node dist/index.js serve
```

---

## Index CLI reference

```
nyc-council-mcp index [options]

Options:
  --archive <path>    Path to jehiah/nyc_legislation clone (required)
  --db <path>         SQLite output path (default: $LEGISTAR_DB_PATH or ./legistar.db)
  --full              Full rebuild (default: incremental)
  --verbose           Print progress to stderr
  --help              Show help
```

---

## Tool reference

### `search_bills` / `search_legislation`

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

### `aggregate_bills`

Count bills grouped by a dimension.

| Parameter | Type | Required | Options |
|---|---|---|---|
| `group_by` | string | yes | `status`, `type`, `committee`, `year` |

```
aggregate_bills(group_by="status")
aggregate_bills(group_by="year")
```

> **⚠️ Caveat: `vote_breakdown`, `get_voting_record`, and `get_bill_hearings` currently return empty results.**
> The local index does not yet ingest vote or event-item data (the `votes` and `event_items` tables are empty pending a data-source decision), so these three tools always return `[]`.
> Worked example: `vote_breakdown("Int 0743-2024")` returns `[]` from the local index, even though the live Legistar API has the full 2024-06-06 Stated Meeting roll call at `GET /eventitems/409436/votes` (51 member votes).
> Until this is resolved, get vote data from the live path: `get_upcoming_hearings` (or `GET /events/{EventId}/eventitems`) → take an `EventItemId` → `get_votes(event_item_id)`.

### `vote_breakdown`

Every council member's vote on a specific bill.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_number` | string | yes | Bill file number, e.g. `0042-2024` |

### `get_voting_record`

All votes cast by a council member.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `member_name` | string | yes | — | Full or partial name |
| `limit` | number | no | 50 | Max results |

### `co_sponsors`

Members who most frequently co-sponsor bills with a given member.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `member_name` | string | yes | — | Full or partial name |
| `limit` | number | no | 20 | Top N co-sponsors |

---

## Common workflows

### Explore a topic, then confirm

```
1. search_bills("e-bike")              → sub-second results from local index
2. get_bill("0042-2024")               → authoritative current status from live API
3. get_bill_history(matter_id)         → full action trail from live API
4. get_votes(event_item_id)            → how each member voted
```

### Analyze a council member's record

```
1. get_voting_record("Nurse")          → all votes cast
2. co_sponsors("Nurse")               → frequent co-sponsors
3. search_bills("bicycle", committee="Transportation")  → bills in their area
```

### Track upcoming hearings

```
1. upcoming_events(days=14)            → from local index (may be 1–7 days stale)
2. get_upcoming_hearings()             → from live API (real-time)
```

`get_upcoming_hearings` populates each event's `EventItems` array with the agenda
items (the bills/matters on that hearing's agenda), fetched per event from the
Legistar `/events/{EventId}/eventitems` endpoint. The `/events` list endpoint
itself always returns `EventItems` empty and ignores `$expand`, so the follow-up
call is required. Pass `include_agenda=false` to skip it and return the hearing
schedule faster with `EventItems` empty.

---

## Agency snippets

When you pass `agency` to `search_bills`, results include a role-context snippet showing HOW the agency appears in the bill — whether it is directed, consulted, or reporting. This helps distinguish bills that merely mention an agency from those that grant or restrict its authority.

Supported agency keys: `DEP`, `DOT`, `NYPD`, `FDNY`, `DOB`, `HPD`, `HRA`, `DSS`, `ACS`, `DOHMH`, `DHS`, `DCAS`, `DSNY`, `DPR`, `DCP`, `FINANCE`, `LAW`, `MAYOR`, `COMPTROLLER`, `MTA`, `EDC`, `SBS`, `DCWP`, `DYCD`, `DFTA`, `DOE`, `CUNY`, and more.

You can also pass a full name: `agency="department of transportation"` or `agency="sanitation"`.

---

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `LEGISTAR_TOKEN` | Live API tools | Register at [council.nyc.gov/legislation/api](https://council.nyc.gov/legislation/api/) |
| `LEGISTAR_DB_PATH` | Local SQLite tools | Path to your built `legistar.db` |
Do not commit tokens to version control.

---

## Data sources

- **Live tools:** [NYC Council Legistar API](https://council.nyc.gov/legislation/api/), provided by [Granicus](https://granicus.com/)
- **Local index:** [jehiah/nyc_legislation](https://github.com/jehiah/nyc_legislation) archive — has been mirroring Legistar since 2018, updated most weekdays

---

## Acknowledgments

This project builds on the foundational work of [@jehiah](https://github.com/jehiah), whose [nyc_legislation](https://github.com/jehiah/nyc_legislation) project has been mirroring NYC Council legislative data since 2018 and powers [intro.nyc](https://intro.nyc/).

The local SQLite index and agency snippet approach are adapted from [WillHsiaoNYC/legistar-mcp](https://github.com/WillHsiaoNYC/legistar-mcp), which introduced the two-speed architecture and role-context snippet design that v2 implements in TypeScript.

Thank you to Nathan Storey for including this project in the [Civic AI Tools Directory](https://www.civicaitools.org/directory).

---

## Releases

Publishing is automated. To cut a release:

1. Bump `version` in `package.json` in a PR (with a matching [CHANGELOG.md](CHANGELOG.md) entry).
2. Merge the PR.
3. Push the matching tag: `git tag v<version> && git push origin v<version>`.
4. The [release workflow](.github/workflows/release.yml) runs tests, verifies the tag matches `package.json`, publishes to npm with provenance, and creates a GitHub Release.

Prerequisite: the `NPM_TOKEN` org secret (an npm automation token with publish rights on `@betanyc`) must be configured. Do not run `npm publish` by hand.

---

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp).

---

## Support our work

Freedom isn't free. [Support BetaNYC](https://beta.nyc/donate/).

## License

MIT License — Copyright (c) 2026 BetaNYC

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
