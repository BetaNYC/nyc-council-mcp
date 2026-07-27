# NYC Council members → Wikidata QID map — DRAFT

**Status: NOT verified by a human. Do not consume as curated data yet.**

Starting draft for the curated `person_id` → QID mapping specified by
[#28](https://github.com/BetaNYC/nyc-council-mcp/issues/28). Machine-readable companion:
[`council-wikidata-qid-map.draft.json`](./council-wikidata-qid-map.draft.json).

This file is **not shipped in the npm package** (`package.json` `files` is `["dist"]`).
Whoever implements #28 decides whether the finished map needs to ship.

## What "verified" means here, precisely

Every one of the 51 rows was matched by an agent and confirmed against an **English
Wikipedia article that names the member's council district**, cross-checked to the district
in NYC Open Data `uvw5-9znb`. That is stronger than name-matching, and weaker than a human
looking at it.

**It is specifically not confirmed from Wikidata's own structured claims.** Two spot-checks
I ran directly against the Wikidata API:

- **D10 Carmen N. De La Rosa → `Q28131635`** — the item's only `P39` (position held) is a
  **New York State Assembly** seat, and its description still reads *"Assembly member for
  the 72nd District."* The council role exists only in the article prose. This is also the
  known trap: a second item, `Q111285952` "Carmen de la Rosa Jorge," is an unrelated
  academic in Spain.
- **D23 Linda Lee → `Q109827010`** — the item has **no `P39` and no `P102` at all.** The
  article is the sole evidence. Wikidata's own search did not return this item in its top
  10; it surfaced a British creator, a UK solicitor, a badminton player, and Bruce Lee's
  widow instead.

## Why this cannot be auto-derived (the case for curating it)

- Wikidata carries **no identifier property** linking an item to Legistar or the NYC
  Council. There is nothing to join on but names.
- Council membership is modeled **two incompatible ways**: `P39 = Q58620996` ("member of
  the New York City Council") and `P39 = Q645195` (the council body itself). Querying one
  finds 14 of 51; querying both finds ~20.
- **31 of 51 sitting members have no `P39` at all**, so SPARQL is structurally capped near
  20 regardless of how the query is written.
- Names disagree across systems: `Gale A. Brewer` vs `Gale Brewer`, diacritics in
  `Farías` / `Gutiérrez` / `Ossé` / `Cabán`, and a double space in `Althea V.  Stevens`.

**A silently wrong person→QID link is worse than a null**, which is why #28 requires review.

## Party is 15 of 51 — and is not solved by this file

Party comes only from Wikidata `P102` where present. It exists in **no** official source:
absent from Legistar person records, `OfficeRecords`, `MemberType`, and `Title`; absent from
`uvw5-9znb`; absent from every NYC Campaign Finance Board dataset. #28 therefore treats
party as a separate curated assertion with a per-row citation.

**Caucus is not a party proxy.** Of the six members who voted no on Res 0540-2026, four are
in the Common-Sense Caucus, Morano is not, and Stevens is in the Progressive and Black,
Latino and Asian caucuses.

## Known staleness

**D3 is vacant.** Erik Bottcher's term ended **2026-02-03** when he joined the NY State
Senate, so only **50 of 51** seats are currently filled. `uvw5-9znb` filtered by
`term_start >= 2026-01-01` still returns 51 rows and looks complete — that filter is wrong
for "who is serving now." #28's acceptance criteria were corrected to define *current* as
active on a query date and to require vacant seats to resolve as vacant.

## Review checklist

1. Confirm the four flagged rows first: **D10 De La Rosa**, **D23 Linda Lee**, **D34
   Jennifer Gutiérrez**, **D17 Justin E. Sanchez** — each had multiple plausible candidates.
2. Decide how to represent **D3** (vacant vs. Bottcher's stint).
3. Spot-check any row whose `party` is blank before relying on party anywhere.
4. When satisfied, move to `nyc-council-mcp` as the curated file #28 specifies, and flip
   `status:` to `active` here (or delete this draft and point at the repo copy).

## The map

`person_id` is the Legistar person id, which is **also** the `council_member_id` in NYC Open
Data `uvw5-9znb` — verified at 51/51 with zero name disagreements. It is the join key; never
join on names.

| District | Name | person_id | Wikidata | Party (P102) | Wikipedia |
|---:|---|---:|---|---|---|
| 1 | Christopher Marte | 7801 | `Q109536946` | Democratic Party | Christopher Marte |
| 2 | Harvey D. Epstein | 7893 | `Q60585653` | Democratic Party | Harvey Epstein |
| 3 | Erik D. Bottcher | 7802 | `Q107565790` | — | Erik Bottcher |
| 4 | Virginia Maloney | 7894 | `Q136602971` | — | Virginia Maloney |
| 5 | Julie Menin | 7803 | `Q6308392` | Democratic Party | Julie Menin |
| 6 | Gale A. Brewer | 5259 | `Q5518265` | Democratic Party | Gale Brewer |
| 7 | Shaun Abreu | 7804 | `Q107528143` | — | Shaun Abreu |
| 8 | Elsie Encarnación | 7895 | `Q140299738` | — | Elsie Encarnacion |
| 9 | Yusef Salaam | 7866 | `Q104419402` | — | Yusef Salaam |
| 10 | Carmen N. De La Rosa | 7806 | `Q28131635` | Democratic Party | Carmen De La Rosa |
| 11 | Eric Dinowitz | 7799 | `Q106688810` | Democratic Party | Eric Dinowitz |
| 12 | Kevin C. Riley | 7794 | `Q105200253` | Democratic Party | Kevin Riley (politician) |
| 13 | Shirley Aldebol | 7896 | `Q136713935` | — | Shirley Aldebol |
| 14 | Pierina Ana Sanchez | 7808 | `Q111527096` | — | Pierina Sanchez |
| 15 | Oswald J. Feliz | 7798 | `Q107105895` | — | Oswald Feliz |
| 16 | Althea V.  Stevens | 7809 | `Q111604042` | — | Althea Stevens |
| 17 | Justin E. Sanchez | 7897 | `Q139666227` | — | Justin Sanchez |
| 18 | Amanda C. Farías | 7810 | `Q107579470` | Democratic Party | Amanda Farías |
| 19 | Vickie Paladino | 7811 | `Q118525516` | Republican Party | Vickie Paladino |
| 20 | Sandra Ung | 7812 | `Q107708047` | — | Sandra Ung |
| 21 | Shanel Thomas-Henry | 7898 | `Q140317148` | — | Shanel Thomas-Henry |
| 22 | Tiffany L. Cabán | 7813 | `Q64831072` | Democratic Party | Tiffany Cabán |
| 23 | Linda Lee | 7814 | `Q109827010` | — | Linda Lee (politician) |
| 24 | James F. Gennaro | 5273 | `Q16230625` | Democratic Party | James F. Gennaro |
| 25 | Shekar Krishnan | 7815 | `Q109478662` | — | Shekar Krishnan |
| 26 | Julie Won | 7816 | `Q107598267` | — | Julie Won |
| 27 | Nantasha M. Williams | 7817 | `Q107674522` | — | Nantasha Williams |
| 28 | Ty Hankerson | 7899 | `Q140374824` | — | Ty Hankerson |
| 29 | Lynn C. Schulman | 7818 | `Q116730453` | — | Lynn Schulman |
| 30 | Phil Wong | 7900 | `Q137804485` | — | Phil Wong |
| 31 | Selvena N. Brooks-Powers | 7796 | `Q106725660` | — | Selvena Brooks-Powers |
| 32 | Joann Ariola | 7819 | `Q109373922` | — | Joann Ariola |
| 33 | Lincoln Restler | 7820 | `Q107669898` | — | Lincoln Restler |
| 34 | Jennifer Gutiérrez | 7821 | `Q111435198` | — | Jennifer Gutiérrez (politician) |
| 35 | Crystal Hudson | 7822 | `Q107489881` | — | Crystal Hudson |
| 36 | Chi A. Ossé | 7823 | `Q107503690` | — | Chi Ossé |
| 37 | Sandy Nurse | 7824 | `Q107657053` | — | Sandy Nurse |
| 38 | Alexa Avilés | 7825 | `Q109352000` | — | Alexa Avilés |
| 39 | Shahana K. Hanif | 7826 | `Q107558542` | — | Shahana Hanif |
| 40 | Rita C. Joseph | 7827 | `Q112082225` | — | Rita Joseph |
| 41 | Darlene Mealy | 6272 | `Q5223848` | Democratic Party | Darlene Mealy |
| 42 | Chris Banks | 7864 | `Q128304273` | — | Chris Banks (politician) |
| 43 | Susan Zhuang | 7867 | `Q127602101` | — | Susan Zhuang |
| 44 | Simcha Felder | 5289 | `Q7517469` | Democratic Party | Simcha Felder |
| 45 | Farah N. Louis | 7785 | `Q64010097` | Democratic Party | Farah Louis |
| 46 | Mercedes Narcisse | 7829 | `Q107721920` | — | Mercedes Narcisse |
| 47 | Kayla Santosuosso | 7901 | `Q136765335` | — | Kayla Santosuosso |
| 48 | Inna Vernikov | 7831 | `Q109379601` | Republican Party | Inna Vernikov |
| 49 | Kamillah Hanks | 7832 | `Q113194042` | — | Kamillah Hanks |
| 50 | David M. Carr | 7833 | `Q110146987` | — | David Carr (New York politician) |
| 51 | Frank Morano | 7887 | `Q134287645` | — | Frank Morano |
