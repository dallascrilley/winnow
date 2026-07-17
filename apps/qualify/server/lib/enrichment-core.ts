/**
 * Pure enrichment logic — zero imports so unit tests never pull the core
 * server dependency chain. The DB-backed wrapper lives in enrichment.ts.
 */

export interface EnrichmentInput {
  email: string;
  companySize?: string | null;
  message?: string | null;
}

export interface EnrichmentProfile {
  domain: string;
  matched: boolean;
  personal: boolean;
  companyName: string | null;
  industry: string | null;
  industryGuessed: boolean;
  employees: number | null;
  revenueBand: string | null;
  hq: string | null;
  unverified: boolean;
  notes: string[];
}

export interface FirmographicHit {
  companyName: string;
  industry: string;
  employees: number;
  revenueBand: string;
  hq: string;
}

export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "mail.com",
]);

const INDUSTRY_HINTS: Array<[RegExp, string]> = [
  [/law|legal|attorney/i, "Legal Services"],
  [/dental|health|med|clinic|care/i, "Healthcare"],
  [/realty|homes|properties|estate/i, "Real Estate"],
  [/bank|capital|invest|fin/i, "Financial Services"],
  [/soft|dev|tech|app|data|cloud|ai/i, "Software"],
  [/market|agency|media|pr/i, "Marketing Services"],
  [/construct|build|roof|plumb/i, "Construction"],
  [/shop|store|retail|goods/i, "Retail"],
];

export function extractDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return (at === -1 ? email : email.slice(at + 1)).trim().toLowerCase();
}

function guessIndustry(domain: string): string | null {
  for (const [pattern, industry] of INDUSTRY_HINTS) {
    if (pattern.test(domain)) return industry;
  }
  return null;
}

/** Pure profile builder — unit-testable without a database. */
export function buildProfile(
  domain: string,
  hit: FirmographicHit | undefined,
): EnrichmentProfile {
  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return {
      domain,
      matched: false,
      personal: true,
      companyName: null,
      industry: null,
      industryGuessed: false,
      employees: null,
      revenueBand: null,
      hq: null,
      unverified: true,
      notes: ["free email provider — no company domain to enrich"],
    };
  }

  if (hit) {
    return {
      domain,
      matched: true,
      personal: false,
      companyName: hit.companyName,
      industry: hit.industry,
      industryGuessed: false,
      employees: hit.employees,
      revenueBand: hit.revenueBand,
      hq: hit.hq,
      unverified: false,
      notes: ["matched synthetic firmographics table"],
    };
  }

  const guessed = guessIndustry(domain);
  return {
    domain,
    matched: false,
    personal: false,
    companyName: null,
    industry: guessed,
    industryGuessed: guessed !== null,
    employees: null,
    revenueBand: null,
    hq: null,
    unverified: true,
    notes: guessed
      ? ["industry guessed from domain token — treat as weak signal"]
      : ["no firmographics match and no domain hint"],
  };
}
