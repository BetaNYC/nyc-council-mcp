// Acceptance test for issue #26: the indexer must populate event_items' matter
// linkage from the archive, which does provide it.
//
// Bug: src/db/indexer.ts hardcodes NULL for matter_id, file_number, and
// action_name on every event item, under comments claiming the archive lacks
// them. Sampled archive agenda items (1999-2026) carry MatterID, MatterFile,
// and ActionName. With the join key NULL, vote_breakdown / get_voting_record /
// get_event_bills cannot resolve an agenda item back to a matter.
//
// Why the existing vote-tools-honesty "works normally" test does NOT catch
// this: it hand-inserts event_items rows with matter_id / file_number already
// populated — a shape the real indexer never produces. This test runs the REAL
// buildIndex against a fixture event and asserts the linkage survives.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { buildIndex } from "../dist/db/indexer.js";

function buildFixtureArchive() {
  const root = mkdtempSync(join(tmpdir(), "legistar-eventitems-"));
  const write = (rel, contents) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
  };
  // Event shape mirrors real archive files (jehiah/nyc_legislation
  // events/YYYY/*.json): agenda items live under "Items" and carry MatterID /
  // MatterFile / ActionName. Item 440128 is the real adoption of the FY2027
  // contract budget (Res 0540-2026, matter 79146) at the 2026-06-30 meeting.
  write(
    "events/2026/2026-06-30_stated.json",
    JSON.stringify({
      ID: 22592,
      Date: "2026-06-30T00:00:00",
      BodyName: "City Council",
      Items: [
        {
          ID: 440128,
          Title: "RESOLUTION TO ADOPT A CONTRACT BUDGET ...",
          MatterID: 79146,
          MatterFile: "Res 0540-2026",
          MatterType: "Resolution",
          ActionName: "Approved, by Council",
        },
        // A purely procedural item legitimately carries no matter.
        { ID: 439742, Title: "Roll Call" },
      ],
    })
  );
  return root;
}

test("buildIndex populates event_items matter linkage from the archive (issue #26)", async () => {
  const archiveRoot = buildFixtureArchive();
  const dbPath = join(archiveRoot, "index.db");
  try {
    await buildIndex({ archiveRoot, dbPath, full: true });
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare(
          "SELECT matter_id, file_number, action_name FROM event_items WHERE event_item_id = 440128"
        )
        .get();
      assert.ok(row, "the agenda item should be indexed");
      assert.equal(row.matter_id, 79146, "matter_id must come from the archive item's MatterID");
      assert.equal(row.file_number, "Res 0540-2026", "file_number must come from MatterFile");
      assert.equal(row.action_name, "Approved, by Council", "action_name must come from ActionName");

      // Procedural items still index, with a null matter — that is correct.
      const proc = db
        .prepare("SELECT matter_id FROM event_items WHERE event_item_id = 439742")
        .get();
      assert.equal(proc.matter_id, null, "a Roll Call item has no matter");
    } finally {
      db.close();
    }
  } finally {
    rmSync(archiveRoot, { recursive: true, force: true });
  }
});
