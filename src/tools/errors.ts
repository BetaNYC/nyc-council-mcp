/**
 * Every tool failure as one isError answer (#92): a plain sentence saying what went wrong and
 * what to try, no stack trace, an upstream body cut to 500 characters, and the Legistar token
 * removed wherever it might appear (#87). Built on toolError from the shared module.
 */

import { ZodError } from "zod";
import { toolError, type ToolResult } from "../betanyc-tools.js";
import { LegistarError } from "../legistar.js";
import { unknownParamMessage } from "./unknown-param.js";

type ToolDefLike = Parameters<typeof unknownParamMessage>[2][number];

function legistarHint(status: number | null): string {
  if (status === 401 || status === 403) return "Check that LEGISTAR_TOKEN is a valid Legistar API token.";
  if (status === 400 || status === 404) return "Check the id or file number, then try again.";
  if (status === 429) return "Legistar is limiting requests: try again in a minute.";
  return "Try again in a minute. If it keeps failing, the local-index tools (search_legislation, get_matter, get_bill_history) still work.";
}

export function failure(
  err: unknown,
  toolName: string,
  defs: readonly ToolDefLike[],
  token: string | null = null
): ToolResult {
  const secrets = [token];
  const unknown = unknownParamMessage(err, toolName, defs);
  if (unknown) return toolError(unknown, { secrets });
  if (err instanceof ZodError) {
    const what = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return toolError(`${toolName} got arguments it cannot use (${what}). Check the arguments and try again.`, { secrets });
  }
  if (err instanceof LegistarError) {
    return toolError(`${err.message} ${legistarHint(err.status)}`, { upstreamBody: err.body, secrets });
  }
  // Only the first line: toolError (shared module 1.5.1) passes the message on as written, and
  // the lines after it can be a stack trace.
  const message = (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0];
  return toolError(message, { secrets });
}
