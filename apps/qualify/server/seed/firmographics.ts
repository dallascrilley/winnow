/**
 * Deterministic synthetic firmographics — 200 plausible B2B companies with a
 * mid-market-heavy size distribution, generated from a seeded PRNG so every
 * environment produces the identical dataset. A few hand-authored rows at the
 * top give the eval suite (U6) stable high/low-fit fixtures.
 */

export interface FirmographicRow {
  domain: string;
  companyName: string;
  industry: string;
  employees: number;
  revenueBand: string;
  hq: string;
}

export const HAND_AUTHORED: FirmographicRow[] = [
  {
    domain: "meridianops.com",
    companyName: "Meridian Ops",
    industry: "Software",
    employees: 240,
    revenueBand: "10-50M",
    hq: "Austin, TX",
  },
  {
    domain: "blueharboragency.com",
    companyName: "Blue Harbor Agency",
    industry: "Marketing Services",
    employees: 85,
    revenueBand: "1-10M",
    hq: "Dallas, TX",
  },
  {
    domain: "crestpointmfg.com",
    companyName: "Crestpoint Manufacturing",
    industry: "Manufacturing",
    employees: 1200,
    revenueBand: "50-250M",
    hq: "Cleveland, OH",
  },
  {
    domain: "oaklinedental.com",
    companyName: "Oakline Dental",
    industry: "Healthcare",
    employees: 14,
    revenueBand: "<1M",
    hq: "Plano, TX",
  },
];

const PREFIXES = [
  "North",
  "Blue",
  "Apex",
  "Summit",
  "Iron",
  "Clear",
  "Prime",
  "Red",
  "Silver",
  "True",
  "West",
  "Bright",
  "Cedar",
  "Delta",
  "Ever",
  "First",
  "Gold",
  "High",
  "Keystone",
  "Lakes",
  "Metro",
  "Noble",
  "Pacific",
  "Quantum",
  "Ridge",
  "Stone",
  "Swift",
  "Union",
  "Vista",
  "Zenith",
  "Atlas",
  "Beacon",
  "Copper",
  "Ember",
  "Falcon",
  "Granite",
  "Harbor",
  "Juniper",
  "Kodiak",
  "Lantern",
  "Magnet",
];

const ROOTS = [
  "wind",
  "field",
  "bridge",
  "point",
  "line",
  "ware",
  "works",
  "path",
  "mark",
  "stone",
  "flow",
  "craft",
  "shift",
  "stack",
  "wise",
  "spark",
  "beam",
  "gate",
  "well",
  "core",
];

const SUFFIXES: Array<[string, string]> = [
  ["Systems", "Software"],
  ["Labs", "Software"],
  ["Group", "Professional Services"],
  ["Partners", "Professional Services"],
  ["Advisors", "Financial Services"],
  ["Capital", "Financial Services"],
  ["Legal", "Legal Services"],
  ["Health", "Healthcare"],
  ["Realty", "Real Estate"],
  ["Logistics", "Logistics"],
  ["Industries", "Manufacturing"],
  ["Builders", "Construction"],
  ["Media", "Marketing Services"],
  ["Creative", "Marketing Services"],
  ["Retail", "Retail"],
  ["Learning", "Education"],
];

const CITIES = [
  "Dallas, TX",
  "Austin, TX",
  "Plano, TX",
  "Atlanta, GA",
  "Denver, CO",
  "Chicago, IL",
  "Phoenix, AZ",
  "Nashville, TN",
  "Charlotte, NC",
  "Columbus, OH",
  "Kansas City, MO",
  "Raleigh, NC",
  "Tampa, FL",
  "Salt Lake City, UT",
  "Minneapolis, MN",
  "Portland, OR",
];

const TLDS = ["com", "com", "com", "com", "io", "co"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function revenueBandFor(employees: number): string {
  if (employees < 10) return "<1M";
  if (employees < 50) return "1-10M";
  if (employees < 500) return "10-50M";
  if (employees < 2000) return "50-250M";
  return "250M+";
}

function employeesFor(rand: () => number): number {
  const roll = rand();
  if (roll < 0.55) return 50 + Math.floor(rand() * 450); // mid-market heavy
  if (roll < 0.8) return 5 + Math.floor(rand() * 45); // smb
  return 500 + Math.floor(rand() * 4500); // enterprise tail
}

export function generateFirmographics(
  count = 200,
  seed = 20260717,
): FirmographicRow[] {
  const rand = mulberry32(seed);
  const rows = new Map<string, FirmographicRow>();
  for (const row of HAND_AUTHORED) rows.set(row.domain, row);

  let guard = 0;
  while (rows.size < count && guard < count * 50) {
    guard++;
    const prefix = PREFIXES[Math.floor(rand() * PREFIXES.length)];
    const root = ROOTS[Math.floor(rand() * ROOTS.length)];
    const [suffix, industry] = SUFFIXES[Math.floor(rand() * SUFFIXES.length)];
    const name = `${prefix}${root} ${suffix}`;
    const tld = TLDS[Math.floor(rand() * TLDS.length)];
    const domain = `${prefix.toLowerCase()}${root}.${tld}`;
    if (rows.has(domain)) continue;
    const employees = employeesFor(rand);
    rows.set(domain, {
      domain,
      companyName: name,
      industry,
      employees,
      revenueBand: revenueBandFor(employees),
      hq: CITIES[Math.floor(rand() * CITIES.length)],
    });
  }

  return [...rows.values()];
}
