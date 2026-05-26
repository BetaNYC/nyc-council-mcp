/**
 * NYC agency alias map for role-context snippet extraction.
 * Adapted from WillHsiaoNYC/legistar-mcp agencies.yaml.
 *
 * Each entry: canonical display name + search aliases (used for FTS query expansion).
 */

export interface AgencyEntry {
  name: string;
  aliases: string[];
}

export const AGENCIES: Record<string, AgencyEntry> = {
  DEP: {
    name: "Department of Environmental Protection",
    aliases: ["environmental protection", "DEP", "dept of environmental protection"],
  },
  DOT: {
    name: "Department of Transportation",
    aliases: ["department of transportation", "DOT", "dept of transportation"],
  },
  NYPD: {
    name: "New York City Police Department",
    aliases: ["police department", "NYPD", "police"],
  },
  FDNY: {
    name: "Fire Department of New York",
    aliases: ["fire department", "FDNY", "fire dept"],
  },
  DOB: {
    name: "Department of Buildings",
    aliases: ["department of buildings", "DOB", "buildings department"],
  },
  HPD: {
    name: "Department of Housing Preservation and Development",
    aliases: ["housing preservation", "HPD", "dept of housing"],
  },
  HRA: {
    name: "Human Resources Administration",
    aliases: ["human resources administration", "HRA", "dept of social services"],
  },
  DSS: {
    name: "Department of Social Services",
    aliases: ["social services", "DSS"],
  },
  ACS: {
    name: "Administration for Children's Services",
    aliases: ["childrens services", "ACS", "administration for children"],
  },
  DOHMH: {
    name: "Department of Health and Mental Hygiene",
    aliases: ["health and mental hygiene", "DOHMH", "dept of health", "department of health"],
  },
  DHS: {
    name: "Department of Homeless Services",
    aliases: ["homeless services", "DHS"],
  },
  DCAS: {
    name: "Department of Citywide Administrative Services",
    aliases: ["citywide administrative services", "DCAS"],
  },
  DSNY: {
    name: "Department of Sanitation",
    aliases: ["sanitation", "DSNY", "dept of sanitation"],
  },
  DPR: {
    name: "Department of Parks and Recreation",
    aliases: ["parks and recreation", "DPR", "parks department"],
  },
  DDC: {
    name: "Department of Design and Construction",
    aliases: ["design and construction", "DDC"],
  },
  DCP: {
    name: "Department of City Planning",
    aliases: ["city planning", "DCP", "dept of city planning"],
  },
  FINANCE: {
    name: "Department of Finance",
    aliases: ["dept of finance", "department of finance", "DOF"],
  },
  LAW: {
    name: "Law Department",
    aliases: ["law department", "corporation counsel"],
  },
  MAYOR: {
    name: "Office of the Mayor",
    aliases: ["mayor", "office of the mayor", "mayoral"],
  },
  COMPTROLLER: {
    name: "Office of the Comptroller",
    aliases: ["comptroller", "office of the comptroller"],
  },
  BPDR: {
    name: "Brooklyn Public Library",
    aliases: ["brooklyn public library", "BPL"],
  },
  NYPL: {
    name: "New York Public Library",
    aliases: ["new york public library", "NYPL"],
  },
  MTA: {
    name: "Metropolitan Transportation Authority",
    aliases: ["metropolitan transportation authority", "MTA", "transit"],
  },
  EDC: {
    name: "Economic Development Corporation",
    aliases: ["economic development corporation", "EDC"],
  },
  SBS: {
    name: "Department of Small Business Services",
    aliases: ["small business services", "SBS"],
  },
  DCWP: {
    name: "Department of Consumer and Worker Protection",
    aliases: ["consumer and worker protection", "DCWP", "consumer affairs", "DCA"],
  },
  DYCD: {
    name: "Department of Youth and Community Development",
    aliases: ["youth and community development", "DYCD"],
  },
  DFTA: {
    name: "Department for the Aging",
    aliases: ["dept for the aging", "DFTA", "department for the aging"],
  },
  MOPD: {
    name: "Mayor's Office for People with Disabilities",
    aliases: ["people with disabilities", "MOPD"],
  },
  CCHR: {
    name: "Commission on Human Rights",
    aliases: ["commission on human rights", "CCHR", "human rights commission"],
  },
  CCRB: {
    name: "Civilian Complaint Review Board",
    aliases: ["civilian complaint review board", "CCRB"],
  },
  COIB: {
    name: "Conflicts of Interest Board",
    aliases: ["conflicts of interest board", "COIB"],
  },
  IBO: {
    name: "Independent Budget Office",
    aliases: ["independent budget office", "IBO"],
  },
  DOE: {
    name: "Department of Education",
    aliases: ["department of education", "DOE", "public schools"],
  },
  CUNY: {
    name: "City University of New York",
    aliases: ["city university of new york", "CUNY"],
  },
};

/**
 * Resolve an agency query string to its search phrases.
 * Matches by key (e.g. "DEP"), canonical name, or alias.
 * Returns an array of phrase strings to search for in bill text.
 */
export function resolveAgencyPhrases(query: string): string[] {
  const q = query.toLowerCase().trim();

  // Exact key match (case-insensitive)
  const byKey = AGENCIES[query.toUpperCase()];
  if (byKey) return [byKey.name, ...byKey.aliases];

  // Search by name or alias
  for (const entry of Object.values(AGENCIES)) {
    if (
      entry.name.toLowerCase() === q ||
      entry.aliases.some((a) => a.toLowerCase() === q)
    ) {
      return [entry.name, ...entry.aliases];
    }
  }

  // No match — treat the raw string as the phrase
  return [query];
}

/**
 * Extract a role-context snippet from bill text.
 * Finds the first occurrence of any phrase and returns a ~120-char window
 * around it, with the match wrapped in <mark> tags.
 */
export function extractSnippet(
  text: string,
  phrases: string[],
  windowChars = 120
): string | null {
  const lower = text.toLowerCase();
  let bestIdx = -1;
  let bestPhrase = "";

  for (const phrase of phrases) {
    const idx = lower.indexOf(phrase.toLowerCase());
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
      bestPhrase = phrase;
    }
  }

  if (bestIdx === -1) return null;

  const half = Math.floor(windowChars / 2);
  const start = Math.max(0, bestIdx - half);
  const end = Math.min(text.length, bestIdx + bestPhrase.length + half);

  const before = start > 0 ? "…" + text.slice(start, bestIdx) : text.slice(0, bestIdx);
  const match = text.slice(bestIdx, bestIdx + bestPhrase.length);
  const after =
    end < text.length
      ? text.slice(bestIdx + bestPhrase.length, end) + "…"
      : text.slice(bestIdx + bestPhrase.length);

  return `${before}<mark>${match}</mark>${after}`;
}
