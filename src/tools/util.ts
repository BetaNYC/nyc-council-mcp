/**
 * Shared helpers for tool handlers.
 */

/** Wrap a result in the MCP text-content envelope used by every tool. */
export function json(result: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
