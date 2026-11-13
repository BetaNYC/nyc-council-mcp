/**
 * Member roles from Legistar OfficeRecords (#28, tier 1).
 *
 * The archive's people/*.json carry OfficeRecords[]: one row per body a person
 * sat on, with a Title, a MemberType and start/end dates. 171 distinct bodies
 * (checked 2026-11-12). These helpers sort them into kinds and roles.
 *
 * Party is deliberately NOT derived here. The "Democratic Conference" and
 * "Minority (Republican) Conference" are reported as conference memberships,
 * and caucuses as caucuses. #28: "Any code path that populates party from
 * caucus is a defect."
 */

export type BodyKind =
  | "council"
  | "committee"
  | "caucus"
  | "conference"
  | "delegation"
  | "task_force"
  | "other";

export function classifyBody(name: string): BodyKind {
  const n = name.trim();
  if (/^city council$/i.test(n)) return "council";
  if (/^caucus\s*-/i.test(n) || /\bcaucus\b/i.test(n)) return "caucus";
  if (/\bconference of the council\b/i.test(n)) return "conference";
  if (/\bdelegation\b/i.test(n)) return "delegation";
  if (/\btask ?force\b/i.test(n)) return "task_force";
  if (/\b(sub)?committee\b/i.test(n)) return "committee";
  return "other";
}

export type Role = "chair" | "vice_chair" | "leader" | "member";

export function roleOf(title: string | null | undefined, memberType: string | null | undefined): Role {
  const t = (title ?? "").trim();
  if (/vice/i.test(t)) return "vice_chair";
  if (/^chairperson$|^co-chair$|^chair$/i.test(t)) return "chair";
  if (/leader/i.test(t)) return "leader";
  if (/^chair$/i.test((memberType ?? "").trim())) return "chair";
  return "member";
}

export const ROLE_ORDER: Record<Role, number> = { chair: 0, vice_chair: 1, leader: 2, member: 3 };
