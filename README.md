# nyc-council-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for NYC Council legislative data, powered by the [NYC Legistar API](https://council.nyc.gov/legislation/api/).

Use this server to give AI assistants (Claude, etc.) real-time access to NYC Council legislation, hearings, council members, committees, and vote records.

Vibe coded with [Claude](https://claude.ai) by [BetaNYC](https://beta.nyc).

---

## What it does

Exposes 8 tools over MCP:

| Tool | Description |
|---|---|
| `search_legislation` | Search bills and resolutions by keyword |
| `get_bill` | Look up a specific bill by intro/file number |
| `get_bill_history` | Full legislative history — hearings, referrals, votes |
| `get_upcoming_hearings` | Committee hearings and Stated meetings in the next N days |
| `get_council_member` | Look up a council member by name |
| `get_committee` | Look up a committee by name |
| `get_votes` | Vote record for a specific agenda item |
| `list_recent_legislation` | Most recently introduced legislation |

---

## Tools reference

### `search_legislation`

Search bills and resolutions by keyword or file number.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | yes | — | Search term (title or file number) |
| `limit` | number | no | 20 | Max results to return (max 50) |

```
search_legislation("open data")
search_legislation("tenant protection", limit=50)
```

---

### `get_bill`

Fetch a specific bill by its intro/file number. Returns the full matter record.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_number` | string | yes | Bill file number, e.g. `0001-2024` |

```
get_bill("0001-2024")
get_bill("0837-2025")
```

---

### `get_bill_history`

Get the full legislative history of a bill — hearings, referrals, votes, and status changes. The `matter_id` is returned by `search_legislation` or `get_bill`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `matter_id` | number | yes | Legistar matter ID |

```
get_bill_history(12345)
```

---

### `get_upcoming_hearings`

List upcoming committee hearings and Stated meetings.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `days_ahead` | number | no | 14 | How many days ahead to look (max 90) |

```
get_upcoming_hearings()
get_upcoming_hearings(days_ahead=90)
```

---

### `get_council_member`

Look up a council member by full or partial name.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Full or partial name |

```
get_council_member("De La Rosa")
get_council_member("Justin Brannan")
```

---

### `get_committee`

Look up a committee by name. Returns jurisdiction, chair contact, member count, and active status.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Full or partial committee name |

```
get_committee("technology")
get_committee("Committee on Housing and Buildings")
```

---

### `get_votes`

Get the vote record for a specific agenda item. Shows how each member voted. The `event_item_id` is returned in bill history records as `MatterHistoryEventId`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `event_item_id` | number | yes | Event item ID |

```
get_votes(98765)
```

---

### `list_recent_legislation`

List the most recently introduced NYC Council legislation.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `limit` | number | no | 25 | Number of items to return (max 50) |

```
list_recent_legislation()
list_recent_legislation(limit=50)
```

---

## Common workflows

### Track a bill from keyword to vote record

```
1. search_legislation("e-bike")          → returns matter_id
2. get_bill_history(matter_id)           → returns event items and MatterHistoryEventId
3. get_votes(event_item_id)              → shows how each member voted
```

### Find what a committee covers and when it meets next

```
1. get_committee("technology")           → returns jurisdiction and chair contact
2. get_upcoming_hearings(days_ahead=90)  → filter results by committee name
```

### Look up recent legislation and dig into a bill

```
1. list_recent_legislation(limit=50)     → browse recent introductions
2. get_bill(file_number)                 → fetch full matter record
3. get_bill_history(matter_id)           → trace its path through committee
```

---

## Prerequisites

- Node.js 18 or later
- A free NYC Council Legistar API key — [register here](https://council.nyc.gov/legislation/api/)

---

## Installation

### Option 1 — npx (no install required)

```bash
LEGISTAR_TOKEN=your_token_here npx @betanyc/nyc-council-mcp
```

### Option 2 — global install

```bash
npm install -g @betanyc/nyc-council-mcp
LEGISTAR_TOKEN=your_token_here nyc-council-mcp
```

### Option 3 — build from source

```bash
git clone https://github.com/BetaNYC/nyc-council-mcp.git
cd nyc-council-mcp
npm install
npm run build
LEGISTAR_TOKEN=your_token_here npm start
```

---

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nyc-council": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-council-mcp"],
      "env": {
        "LEGISTAR_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "nyc-council": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-council-mcp"],
      "env": {
        "LEGISTAR_TOKEN": "your_token_here"
      }
    }
  }
}
```

---

## Getting your API key

1. Go to [council.nyc.gov/legislation/api](https://council.nyc.gov/legislation/api/)
2. Fill out the short registration form
3. You will receive a token by email
4. Set it as the `LEGISTAR_TOKEN` environment variable

Your token is for read-only access. Do not commit it to version control — use an environment variable or a secrets manager.

---

## Example usage

Once connected, you can ask your AI assistant things like:

- *"What legislation has been introduced about street vendors this year?"*
- *"What's the status of Intro 0001-2024?"*
- *"What committees are holding hearings this week?"*
- *"How did the council vote on the last zoning amendment?"*
- *"Who is on the Technology Committee?"*

---

## Data source

All data comes from the [NYC Council Legistar system](https://legistar.council.nyc.gov/), the official legislative management platform for the New York City Council. The Legistar Web API is provided by [Granicus](https://granicus.com/) and is publicly available for read access.

For the most up-to-date legislative information, also see:
- [NYC Council Legislation Portal](https://legistar.council.nyc.gov/)
- [intro.nyc](https://intro.nyc/) — community-built legislation tracker

---

## Acknowledgments

This project builds on the foundational work of [@jehiah](https://github.com/jehiah), whose [nyc_legislation](https://github.com/jehiah/nyc_legislation) project has been mirroring NYC Council legislative data since 2018 and powers [intro.nyc](https://intro.nyc/). His Go client for the Legistar API and his approach to making legislative data accessible were an early reference point for this project.

Thank you to Nathan Storey for including this project in the [Civic AI Tools Directory](https://www.civicaitools.org/directory) — a curated index of open-source tools for accessing civic and government data through AI.

---

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp).

---

## License

MIT License

Copyright (c) 2026 BetaNYC

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
