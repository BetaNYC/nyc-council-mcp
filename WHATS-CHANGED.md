# What's changed

This page lists the changes to nyc-council-mcp that a reader would notice: new tools, new data, and corrections when the server gave a wrong answer. Newest first. Dates are New York dates; CHANGELOG.md gives some releases the next day's date, in UTC.

- **History begins:** 2026-05-19, the first release. Corrections made before this date may be missing.
- **Data refresh:** The live tools ask the New York City Council's Legistar API each time. The local index is as current as the last time you built it from the jehiah/nyc_legislation archive, and every answer from it says when that was. The list of Council districts and terms ships with each release; a monthly check opens a pull request when the City changes it.

To report a bug in this server or ask for a new feature, [open an issue on GitHub](https://github.com/BetaNYC/nyc-council-mcp/issues).

## Unreleased: Two tools that explain the server and list what changed

- **Tags:** MCP
- **What changed:** Two new tools let your AI assistant answer "what changed in this server?" from this page, and "who built this?" with links to BetaNYC and to the place to report a bug in this server or ask for a new feature. This page is new too. It lists the changes a reader would notice, back to the first release.
- **MCP version:** [nyc-council-mcp 2.9.0](CHANGELOG.md)
- **More detail:** [Release notes](CHANGELOG.md) · [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/75)

## 2026-11-13: Ask the server where its data comes from

- **Tags:** MCP, Data
- **What changed:** A new tool answers "where does this come from?", "how current is it?" and "is this official?". For each kind of data it names the source and its publisher, says whether it is an official record or BetaNYC's own curation, how current it is on your copy of the server, and where to check a figure or report an error. The same list of sources is published as a data catalog.
- **MCP version:** [nyc-council-mcp 2.8.0](CHANGELOG.md#280---2026-11-13)
- **More detail:** [Where the data comes from](DATA-SOURCES.json) · [Data catalog](data.json) · [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/48) · [Release notes](CHANGELOG.md#280---2026-11-13)

## 2026-11-13: Committees, chairs, districts and party for every member

- **Tags:** MCP, Data
- **What changed:** The server can now say which committees a member chairs or sits on, who sits on a committee, and who held a Council district on any date since 1999, from the Council's own records and the City's list of Council terms. Member answers also carry party, Wikipedia links and office social accounts, checked by BetaNYC and labeled as not an official record. Party is every ballot line the member won on, copied from Board of Elections certified results.
- **Who it affects:** Anyone asking about Council members. When the City's list of terms is behind, the answer says so: on November 12, 2026 it did not list Carl Wilson, District 3, a Council Member since May 13, 2026.
- **MCP version:** [nyc-council-mcp 2.8.0](CHANGELOG.md#280---2026-11-13)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/28) · [How the curated facts were checked](data/README.md) · [Release notes](CHANGELOG.md#280---2026-11-13)

## 2026-11-13: Search the full text of legislation, and find a Local Law by its number

- **Tags:** MCP
- **What changed:** Search now reads each bill's summary and full text, not only its title and sponsors. A new tool finds one piece of legislation by its file number or Local Law number, with its attached files, and another lists a bill's attachments with download links. Every kind of legislation, not only Introductions, now comes with a link to its page on the Council's website. Every answer from the local index now says when the index was built.
- **MCP version:** [nyc-council-mcp 2.8.0](CHANGELOG.md#280---2026-11-13)
- **More detail:** [Search issue](https://github.com/BetaNYC/nyc-council-mcp/issues/31) · [Links issue](https://github.com/BetaNYC/nyc-council-mcp/issues/45) · [Index date issue](https://github.com/BetaNYC/nyc-council-mcp/issues/25) · [Release notes](CHANGELOG.md#280---2026-11-13)

## 2026-11-13: Upcoming meetings that were called off could show as still on

- **Tags:** MCP, Data, Correction
- **What changed:** Before November 13, 2026, the list of upcoming meetings from the local index could show a meeting as scheduled after the Council had deferred it. The Council's system changed event 22725 to Deferred without marking the record as updated, so the archive the index is built from kept the old status. On November 12, 2026, 10 of 658 meetings in 2026 differed this way. With a Legistar API key set, version 2.8.0 checks each upcoming meeting's status live.
- **If you used the old numbers:** If you planned around a meeting from this list before November 13, 2026, check its status on the Council's calendar at legistar.council.nyc.gov. Without an API key, the list still comes from the archive, so check a meeting's status there before you rely on it.
- **Who it affects:** People who ran the server with a local index.
- **MCP version:** [nyc-council-mcp 2.8.0](CHANGELOG.md#280---2026-11-13)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/42) · [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/52)

## 2026-11-13: Voting records did not say when each vote happened

- **Tags:** MCP, Correction
- **What changed:** From July 26 to November 13, 2026, a member's voting record listed votes in the order the bills were introduced and gave no vote date, so a 2024 bill voted on in 2026 read like an old vote. Version 2.8.0 gives each vote's date, action and body, newest vote first.
- **If you used the old numbers:** If you dated a member's vote from the bill's introduction date in that period, check the vote's date in the bill's history, on the Council's website or with the current version.
- **MCP version:** [nyc-council-mcp 2.8.0](CHANGELOG.md#280---2026-11-13)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/41) · [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/50)

## 2026-11-13: Some member names found nobody

- **Tags:** MCP, Correction
- **What changed:** Before November 13, 2026, a member's name had to match the Council's record closely. About 30 of 181 active people in the record have a middle initial, an accent or an extra space, so "Carmen De La Rosa", "Amanda Farias" and "Althea Stevens" found nobody. Version 2.8.0 matches names word by word, ignoring case, accents, middle initials and extra spaces.
- **If you used the old numbers:** If you looked up a member, their voting record or their co-sponsors before November 13, 2026, and got no member or an empty list, that did not mean the member had no record. Ask again with the current version.
- **MCP version:** [nyc-council-mcp 2.8.0](CHANGELOG.md#280---2026-11-13)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/40) · [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/49)

## 2026-10-11: An index built on Windows was empty

- **Tags:** MCP, Correction
- **What changed:** From May 26 to October 11, 2026, building the local index on Windows found no files, stored nothing, and still reported success. The same happened on any computer when the archive's folder path held characters such as brackets or "(x86)". Version 2.7.0 builds the index on Windows, and stops with an error when it finds no files. Two users diagnosed the problem.
- **If you used the old numbers:** If you built the index on Windows, or from a folder whose path had brackets or "(x86)", before October 11, 2026, it was empty, and an empty answer from it meant nothing. Rebuild the index with the current version and ask again.
- **Who it affects:** People who built a local index on Windows or from such a folder.
- **MCP version:** [nyc-council-mcp 2.7.0](CHANGELOG.md#270---2026-10-11)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/12) · [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/39)

## 2026-10-11: One member's profile link opened another member's page

- **Tags:** MCP, Data, Correction
- **What changed:** Before October 11, 2026, the Council's record for Council Member Virginia Maloney carried Council Member Elsie Encarnación's profile link, and the server passed it on. Version 2.7.0 corrected the link and flags any profile link shared by two people. The Council fixed its record later; on November 12, 2026 it gave Council Member Maloney's own page.
- **If you used the old numbers:** If you used a profile link for Council Member Maloney from this server before October 11, 2026, it pointed to Council Member Encarnación's page. Use the member pages on council.nyc.gov.
- **MCP version:** [nyc-council-mcp 2.7.0](CHANGELOG.md#270---2026-10-11)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/38) · [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/39)

## 2026-07-26: Votes and bill histories without an API key

- **Tags:** MCP, Data
- **What changed:** The local index now holds every recorded roll-call vote and each bill's history, so the vote tools work without an API key. A bill decided in committee and then by the full Council shows both roll calls, each with its own tally, and an absent member is not counted as a vote.
- **MCP version:** [nyc-council-mcp 2.6.0](CHANGELOG.md#260---2026-07-27)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/30) · [Release notes](CHANGELOG.md#260---2026-07-27)

## 2026-07-26: A bill number shared by two kinds of legislation returned only one

- **Tags:** MCP, Correction
- **What changed:** From July 6 to July 26, 2026, looking up a bill by its number without its type returned the first match and hid the others. "0540-2026" returned Int 0540-2026, an Introduction still in committee, and hid Res 0540-2026, the adopted resolution. Version 2.6.0 names every match and asks which one you mean.
- **If you used the old numbers:** If you looked up a bill by a number without "Int", "Res" or "LU" in that period, check that you got the one you meant: look it up again with its type.
- **MCP version:** [nyc-council-mcp 2.6.0](CHANGELOG.md#260---2026-07-27)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/27) · [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/33)

## 2026-07-21: Vote tools answered with an empty list

- **Tags:** MCP, Correction
- **What changed:** From May 26 to July 21, 2026, the tools for how members voted on a bill and for a member's voting record answered from the local index with an empty list, because the index held no votes. An empty list read as "no votes", which was wrong. Version 2.5.0 answered with an error naming the gap instead, and version 2.6.0, on July 26, filled the index with votes.
- **If you used the old numbers:** An empty vote list from this server in that period did not mean the member or the bill had no votes. Ask again with the current version, or check the bill on the Council's website.
- **MCP version:** [nyc-council-mcp 2.5.0](CHANGELOG.md#250---2026-07-22)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/19) · [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/24)

## 2026-07-21: Tools ignored settings they did not have, without saying so

- **Tags:** MCP, Correction
- **What changed:** From May 19 to July 21, 2026, when an AI assistant passed a setting a tool does not have, the tool dropped it without saying so. The answer looked right but could answer a different question. Version 2.5.0 refuses the call and names the settings the tool does accept.
- **If you used the old numbers:** We know of no wrong answer this caused. If you asked a question then that named something a tool could not filter on, ask it again with the current version.
- **MCP version:** [nyc-council-mcp 2.5.0](CHANGELOG.md#250---2026-07-22)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-council-mcp/issues/20) · [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/23)

## 2026-07-16: A link to each Introduction's page

- **Tags:** MCP
- **What changed:** Answers about Introductions now carry a link a person can open, through intro.nyc. Other kinds of legislation got links in version 2.8.0.
- **MCP version:** [nyc-council-mcp 2.3.0](CHANGELOG.md#230---2026-07-17)
- **More detail:** [The pull request](https://github.com/BetaNYC/nyc-council-mcp/pull/13) · [Release notes](CHANGELOG.md#230---2026-07-17)

## 2026-07-07: The local index left out every Resolution and Land Use item

- **Tags:** MCP, Data, Correction
- **What changed:** From May 26 to July 7, 2026, the local index held only Introductions, though the README said it held all bills and resolutions. About 40% of all matters, 6,030 Resolutions and 2,497 Land Use Applications, were missing, so searches for them found nothing. Live searches with several words also matched almost nothing, because they looked for the words as one exact phrase. Version 2.2.0 indexes all three kinds and matches each word in any order.
- **If you used the old numbers:** If a search in that period found no Resolution or Land Use item, that did not mean none existed. Rebuild your index with the current version and search again. Counts of legislation from the local index in that period left out Resolutions and Land Use items.
- **Who it affects:** People who built a local index, and anyone who used the live search with more than one word.
- **MCP version:** [nyc-council-mcp 2.2.0](CHANGELOG.md#220---2026-07-07)
- **More detail:** [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/10) · [Release notes](CHANGELOG.md#220---2026-07-07)

## 2026-07-06: Search filters, live searches and dates

- **Tags:** MCP, Correction
- **What changed:** Until July 6, 2026, the agency setting on the local legislation search did not filter results, live searches with several words failed, a bill number without its type found nothing, and date ranges after 8 p.m. New York time were off by one day. Version 2.1.1 fixes all four.
- **If you used the old numbers:** If you searched by agency before July 6, 2026, the results were not limited to that agency: search again. If you asked for recent or upcoming items after 8 p.m. New York time, the date range may have been a day off: ask again.
- **MCP version:** [nyc-council-mcp 2.1.1](CHANGELOG.md#211---2026-07-06)
- **More detail:** [The fix](https://github.com/BetaNYC/nyc-council-mcp/pull/8) · [Release notes](CHANGELOG.md#211---2026-07-06)

## 2026-07-01: Upcoming hearings list their agenda items

- **Tags:** MCP
- **What changed:** Each upcoming hearing now lists the bills and other items on its agenda.
- **MCP version:** [nyc-council-mcp 2.1.0](CHANGELOG.md#210---2026-07-01)
- **More detail:** [The pull request](https://github.com/BetaNYC/nyc-council-mcp/pull/5) · [Release notes](CHANGELOG.md#210---2026-07-01)

## 2026-05-26: A local index for fast search, beside the live Council data

- **Tags:** MCP
- **What changed:** Version 2 added a local index built from the jehiah/nyc_legislation archive of the Council's records, for fast search without an API key, beside the live tools that ask the Council's Legistar API.
- **MCP version:** [nyc-council-mcp 2.0.0](CHANGELOG.md#200---2026-05-26)
- **More detail:** [The pull request](https://github.com/BetaNYC/nyc-council-mcp/pull/3) · [Release notes](CHANGELOG.md#200---2026-05-26)

## 2026-05-19: First release

- **Tags:** MCP
- **What changed:** The first version of the server: bills, hearings, votes, committees and Council members, from the Council's Legistar API.
- **MCP version:** [nyc-council-mcp 1.0.0](CHANGELOG.md#100---2026-05-19)
- **More detail:** [The release on GitHub](https://github.com/BetaNYC/nyc-council-mcp/releases/tag/v1.0.0) · [Release notes](CHANGELOG.md#100---2026-05-19)
