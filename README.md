# nyc-council-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for NYC Council legislative data. Version 2 adds a **hybrid mode**: a local SQLite index for sub-second search and exploration, plus the live [NYC Legistar API](https://council.nyc.gov/legislation/api/) for authoritative real-time data.

Built by [BetaNYC](https://beta.nyc) with [Claude](https://claude.ai).

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
| `vote_breakdown` | Every member's vote on a specific bill |
| `get_voting_record` | All votes cast by a named council member |
| `co_sponsors` | Members who most often co-sponsor with a given member |
| `get_bill_hearings` | Events where a bill appeared on the agenda |
| `get_event_bills` | Bills on a specific event's agenda |

### Confirm-path tools (live Legistar API)

These require `LEGISTAR_TOKEN`.

| Tool | Description |
|---|---|
| `get_bill` | Current status and record for a specific bill |
| `get_bill_history` | Authoritative action trail — hearings, referrals, votes |
| `get_upcoming_hearings` | Real-time upcoming committee hearings and Stated meetings |
| `get_council_member` | Current contact info and active status for a council member |
| `get_committee` | Current membership count and details for a committee |
| `get_votes` | Per-item vote breakdown by event item ID |
| `list_recent_legislation` | Most recently introduced legislation (catches bills since last index) |
| `search_legislation_live` | Live Legistar search (slower than local, always current) |

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

Full-text search across all bills using the local index.

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

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp).

---

## License

MIT License — Copyright (c) 2026 BetaNYC

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
