import { readFileSync } from "fs";

// Read the version from package.json so the server never drifts from the published package
// version (it was once hardcoded and had drifted).
export const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version: string }
).version;

/** Sent on every request to an outside API (#83): names the package, its version and its repo. */
export const USER_AGENT = `@betanyc/nyc-council-mcp/${PACKAGE_VERSION} (+https://github.com/BetaNYC/nyc-council-mcp)`;
