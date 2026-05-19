# nyc-council-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for NYC Council legislative data, powered by the [NYC Legistar API](https://council.nyc.gov/legislation/api/).

Use this server to give AI assistants (Claude, etc.) real-time access to NYC Council legislation, hearings, council members, committees, and vote records.

Built by [BetaNYC](https://beta.nyc).

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

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp).

---

## License

MIT © [BetaNYC](https://beta.nyc)
