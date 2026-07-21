/**
 * Formatting for rejected unknown tool parameters (issue #20).
 *
 * zod's default strict message names the bad key but offers no alternative.
 * House style, borrowed from VENDOR_NAME_UNSUPPORTED_MESSAGE in
 * nyc-checkbook-mcp: name the limitation, then name the supported alternatives.
 * Accepted keys are derived from the tool's own advertised schema, so a tool
 * added later is covered without touching a table here.
 */

import { ZodError } from "zod";

interface ToolDefLike {
  name: string;
  inputSchema: { properties?: Record<string, unknown> };
}

/** Returns a guidance message for an unrecognized-key error, or null if `err` isn't one. */
export function unknownParamMessage(
  err: unknown,
  toolName: string,
  defs: readonly ToolDefLike[]
): string | null {
  if (!(err instanceof ZodError)) return null;
  const bad = err.issues.flatMap((i) => (i.code === "unrecognized_keys" ? i.keys : []));
  if (bad.length === 0) return null;

  const accepted = Object.keys(
    defs.find((d) => d.name === toolName)?.inputSchema.properties ?? {}
  );
  const named = bad.map((k) => `'${k}'`).join(", ");

  return (
    `${toolName} does not accept ${named}. Unrecognized parameters are rejected rather ` +
    `than silently dropped, because dropping a filter returns real data that answers a ` +
    `different question. ` +
    (accepted.length
      ? `${toolName} accepts: ${accepted.join(", ")}.`
      : `${toolName} takes no parameters.`)
  );
}
