/**
 * Member-name matching (#40).
 *
 * Legistar's Persons records carry middle initials ("Carmen N. De La Rosa"),
 * trailing and double spaces ("Virginia Maloney ", "Althea V.  Stevens") and
 * accents ("Amanda C. Farías"). About 30 of 181 active rows had one of these
 * on 2026-11-12. A substring search for what a person types ("Carmen De La
 * Rosa", "Amanda Farias") finds nothing, and OData's substringof cannot fold
 * accents. So names are matched here, in code, not upstream.
 */

/** Lowercase, strip accents, turn punctuation into spaces, collapse spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9'-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * True when every word of `query` appears in `fullName`, in any order.
 * Words are matched as substrings, so partial names ("Malon") keep working the
 * way the old substring search did. Single-letter words (middle initials) in
 * the query are ignored unless the query has nothing else.
 */
export function nameMatches(query: string, fullName: string | null | undefined): boolean {
  if (!fullName) return false;
  const words = normalizeName(query).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const significant = words.filter((w) => w.length > 1);
  const use = significant.length > 0 ? significant : words;
  const target = normalizeName(fullName);
  return use.every((w) => target.includes(w));
}
