/** The MCP text-content envelope every tool answer uses (#36: it was copied 21 times). */
export function json(value: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
