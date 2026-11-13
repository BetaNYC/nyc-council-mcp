# Data shipped with the server

Four files. Each one is a single kind of fact from a single kind of source, so where a fact came from is never mixed up with other facts. All four ship in the npm package. None needs a token or network access at run time.

| File | What | Source | Official? |
|---|---|---|---|
| `council-member-terms.json` | Every council term since 1999, with district | NYC Open Data [`uvw5-9znb`](https://data.cityofnewyork.us/d/uvw5-9znb), used as published | Yes, the City's data |
| `council-wikidata.json` | Wikidata item and English Wikipedia article for each sitting member | Wikidata and Wikipedia, checked one row at a time | **No**, curated by BetaNYC |
| `council-party.json` | Party: every ballot line the member won on | NYC Board of Elections certified results | **No**, curated by BetaNYC from official results |
| `council-social.json` | Office accounts on Bluesky, Instagram, Threads, LinkedIn | council.nyc.gov first; the Council's Bluesky starter pack (which also lists personal and campaign accounts, so those are screened out); profiles last | **No**, curated by BetaNYC |

## Rules for the curated files

- **The join key is Legistar `person_id`.** It is the same number as the City's `council_member_id`. Names are never compared.
- **Every row names its source, method and check date.** `reviewed_by` stays empty until a person has looked at the row. An agent's "verified" is not a human review.
- **A blank stays blank.** A member with no row, or a row with status `none`, gets `null`. No value is guessed from a name, a caucus or a party conference.
- **Party is every ballot line.** NYC has fusion voting, so a member can win on several lines, for example Democratic and Working Families, and represents all of them. Lines and votes are copied from the Board of Elections certified results for the election that gave the member their seat. A Council special election is nonpartisan: its lines are names the candidates chose, and the row says so.
- **Office accounts only.** Never campaign or personal accounts (BetaNYC's nonpartisanship rule). Facebook and X are out of scope.
- **Scope is the sitting Council.** These files cover the 51 members seated on the check date. Former members are not curated.

## Refreshing

- `council-member-terms.json`: `node scripts/refresh-member-terms.mjs`. A monthly workflow runs it and opens a PR.
- The curated files are refreshed by hand after an election or a change in who holds a seat. Re-check every changed row against its source, then update `checked_at`.

## History

`council-wikidata.json` began as an agent-made draft (`council-wikidata-qid-map.draft.json`, 2026-09). On 2026-11-12 every row was checked again against Wikidata and Wikipedia. District 3 was corrected: the draft still had Erik Bottcher, and the seat is now held by Carl Wilson (Q139892207). The draft's party values, taken from Wikidata, were dropped. Party now comes only from Board of Elections results.
