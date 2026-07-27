# NYC Council MCP

Ubiquitous language for serving New York City Council legislative data out of Legistar, via both a local SQLite corpus and the live Legistar API. Terms here are the ones that have actually produced wrong answers — general programming concepts do not belong.

## Language

### Legislative records

**Matter**:
Any record Legistar tracks — an introduction, resolution, mayoral message, oversight item, or hearing topic. `matter_id` is its only unambiguous handle.
_Avoid_: bill (when you mean any matter), record, item

**Bill**:
Informal name for a matter whose type is Introduction. Note that the corpus table named `bills` holds *every* matter type, not just introductions — the table name is narrower than its contents.
_Avoid_: using "bill" as a synonym for matter

**File number**:
The human-facing label for a matter, always including its type prefix — `Int 0540-2026`, `Res 0540-2026`, `M 0069-2026`. It is **not** unique on its own: the same number occurs under different types in the same year, so a bare number identifies nothing.
_Avoid_: bare "0540-2026"

**Matter type**:
The class of a matter — Introduction, Resolution, Mayor's Message, Oversight, Local Law. Required to resolve a file number to a single matter.

### Meetings

**Event**:
A scheduled Council or committee meeting, identified by `event_id`. Legistar's web `MeetingDetail?LEGID=` parameter carries this same id.
_Avoid_: meeting, session, hearing (a hearing is an event *type*)

**Event item**:
One line on an event's agenda, identified by `event_item_id`. This is a separate id space from `event_id`; the two are never interchangeable. Votes attach to the event item, never to the event or to the matter directly.
_Avoid_: agenda item id, item

### Positions and presence

**Roll call**:
The complete set of member entries for a single event item — one entry per member. Every entry carries a value, but not every value is a position.

**Vote**:
One member's entry in a roll call. Its value is either a position or a non-position reason for not casting one.
_Avoid_: assuming every vote row is a cast position

**Position**:
A vote value that counts toward a tally: Affirmative, Negative, or Abstain.
_Avoid_: aye/nay as a field value (fine in prose)

**Non-position**:
A vote value recording why no position was cast: Absent, Excused, Medical, Non-voting, Maternity, Parental, Paternity, Bereavement, Suspended, Conflict. These occupy the *same field* as positions, so any count must filter by value rather than count rows.
_Avoid_: attendance (implies a separate dataset; it is the same field)

**Tally**:
The aggregate of positions for one roll call. Always derived by filtering to positions and counting — Legistar's own tally field is not populated.
_Avoid_: result, score, outcome

**Matter history**:
A matter's ordered trail of actions — introduced, referred, heard, amended, approved, enacted — one entry per action. Each entry names the acting body and the event item it occurred at, and an entry that recorded a roll call is the parent of that roll call's votes.
_Avoid_: status (a matter's single current state, not its trail), timeline

### Data sources

**Corpus**:
The local SQLite index of Legistar data that the local tools read, rebuilt by the indexer.
_Avoid_: cache, database, index (ambiguous with the full-text index)

**Live path**:
A tool that queries the Legistar API at call time — authoritative and current, but slower and credentialed.
_Avoid_: remote, online

**Local path**:
A tool that answers from the corpus alone — fast and offline, but only as current as the last index build.
_Avoid_: offline mode, cached path

---

*(Terms accrue here as `/domain-modeling` resolves them. One or two sentences per term; define what it IS, not what it does.)*
