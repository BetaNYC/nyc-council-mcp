#!/usr/bin/env node
// SHA-256 checksums of the data files that ship in the package (#90), in data/SHA256SUMS
// (the `sha256sum` format, so `cd data && shasum -a 256 -c SHA256SUMS` checks them too).
//
//   node scripts/data-checksums.mjs           rewrite data/SHA256SUMS
//   node scripts/data-checksums.mjs --check   exit 1 if a file and its checksum disagree
//
// refresh-member-terms.mjs rewrites it after each refresh. After editing a curated file by hand,
// run this and commit both. test/data-provenance.test.mjs fails when they disagree.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
export const SUMS = `${DATA_DIR}SHA256SUMS`;

export function dataFiles() {
  return readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();
}

// Hashed with LF line endings, as committed, so a Windows checkout that turns them into CRLF
// still matches (CI runs on Windows too).
export function sumsText() {
  return dataFiles()
    .map((f) => `${createHash("sha256").update(readFileSync(DATA_DIR + f, "utf8").replace(/\r\n/g, "\n")).digest("hex")}  ${f}\n`)
    .join("");
}

export function writeSums() {
  writeFileSync(SUMS, sumsText());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const ok = readFileSync(SUMS, "utf8").replace(/\r\n/g, "\n") === sumsText();
    console.error(ok ? "data/SHA256SUMS matches the data files." : "data/SHA256SUMS does not match: run node scripts/data-checksums.mjs");
    process.exit(ok ? 0 : 1);
  }
  writeSums();
  console.error(`Wrote ${SUMS}`);
}
