// Adapter for a receiver-published document index page (EquityBuild pilot).
// Parses the public index into typed document listings. No network here: the
// fetcher hands in HTML and this module stays unit-testable against a fixture.

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

export type DocumentCategory =
  | "order"
  | "status_report"
  | "claims_process"
  | "pleading"
  | "exhibit"
  | "upload"
  | "other";

export interface DocumentListing {
  url: string;
  fileName: string;
  title: string;
  category: DocumentCategory;
  section: string;
  /** District court docket entry number when stated in the link text. */
  docketNumber: string | null;
  /** "appeal" when the entry is an appellate docket number. */
  docketSuffix: string | null;
  /** ISO date (YYYY-MM-DD) when stated in the link text. */
  filedDate: string | null;
  /** True when the title says exhibits were omitted from the posted copy. */
  exhibitsOmitted: boolean;
  /** Stable id for dedupe before the file is downloaded and hashed. */
  listingKey: string;
}

const SECTION_MAP: Record<string, { section: string; category: DocumentCategory }> = {
  orders: { section: "Orders", category: "order" },
  status: { section: "Status Reports", category: "status_report" },
  claims: { section: "Claims Process", category: "claims_process" },
  other: { section: "Other Pleadings", category: "pleading" },
};

// "(11/04/2026, Dkt. 1992)", "(09/04/19)", and the occasional typo "(08/18, 2025, Dkt. No. 1912)".
const DATE_RE = /\((\d{1,2})\/(\d{1,2})(?:\/|,\s*)(\d{2,4})(?:,|\)|\s)/;
// "Dkt. 1992", "Dkt. No. 1956", "Appeal Dkt. No. 49", "App. Ct. Dkt. No. 28"
const DOCKET_RE = /(Appeal\s+|App\.\s*Ct\.\s*)?Dkt\.?\s*(?:No\.?\s*)?(\d+)/i;

export function normalizeTitle(raw: string): string {
  return raw
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseListingText(text: string): Pick<
  DocumentListing,
  "docketNumber" | "docketSuffix" | "filedDate" | "exhibitsOmitted"
> {
  const dateMatch = DATE_RE.exec(text);
  let filedDate: string | null = null;
  if (dateMatch) {
    const [, m, d, yRaw] = dateMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    filedDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const docketMatch = DOCKET_RE.exec(text);
  const docketNumber = docketMatch ? docketMatch[2] : null;
  const docketSuffix = docketMatch && docketMatch[1] ? "appeal" : null;
  const exhibitsOmitted = /not included/i.test(text);
  return { docketNumber, docketSuffix, filedDate, exhibitsOmitted };
}

export function parseReceiverSiteIndex(html: string, baseUrl = "https://rdaplaw.net/"): DocumentListing[] {
  const $ = cheerio.load(html);
  const listings: DocumentListing[] = [];
  const seen = new Set<string>();

  // Section anchors (#orders, #status, #claims, #other) mark the start of each
  // list. Every PDF link after an anchor and before the next belongs to it.
  let current: { section: string; category: DocumentCategory } | null = null;
  $("body *").each((_, el) => {
    const id = $(el).attr("id");
    if (id && SECTION_MAP[id]) {
      current = SECTION_MAP[id];
      return;
    }
    if (el.tagName !== "a") return;
    const href = $(el).attr("href");
    if (!href || !/\.pdf(\?|$)/i.test(href)) return;
    const url = new URL(href, baseUrl).toString();
    if (seen.has(url)) return;
    seen.add(url);
    const title = normalizeTitle($(el).text());
    if (!title) return;
    const meta = parseListingText(title);
    const fileName = decodeURIComponent(url.split("/").pop() ?? "");
    listings.push({
      url,
      fileName,
      title,
      section: current?.section ?? "Unsectioned",
      category: current?.category ?? "other",
      ...meta,
      listingKey: createHash("sha256").update(url).digest("hex").slice(0, 32),
    });
  });
  return listings;
}

export function summarizeBySection(listings: DocumentListing[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of listings) out[l.section] = (out[l.section] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------
// Pilot subset selection: rules are data so the choice is reviewable.
// ---------------------------------------------------------------------------
export interface SubsetRule {
  name: string;
  category?: DocumentCategory;
  /** Case-insensitive regex tested against the title. */
  titlePattern?: string;
  /** Explicit district docket numbers. */
  docketNumbers?: string[];
  /** Take the first N after sorting by filedDate in this order. */
  take?: number;
  order?: "newest" | "oldest";
}

export interface SubsetPlan {
  rules: SubsetRule[];
}

export interface SubsetSelection extends DocumentListing {
  matchedRule: string;
}

export function selectSubset(listings: DocumentListing[], plan: SubsetPlan): SubsetSelection[] {
  const chosen = new Map<string, SubsetSelection>();
  for (const rule of plan.rules) {
    let pool = listings.filter((l) => !chosen.has(l.url));
    if (rule.category) pool = pool.filter((l) => l.category === rule.category);
    if (rule.titlePattern) {
      const re = new RegExp(rule.titlePattern, "i");
      pool = pool.filter((l) => re.test(l.title));
    }
    if (rule.docketNumbers) {
      const want = new Set(rule.docketNumbers);
      pool = pool.filter((l) => l.docketNumber !== null && l.docketSuffix === null && want.has(l.docketNumber));
    }
    pool.sort((a, b) => {
      const da = a.filedDate ?? "";
      const db = b.filedDate ?? "";
      return rule.order === "oldest" ? da.localeCompare(db) : db.localeCompare(da);
    });
    const picked = rule.take ? pool.slice(0, rule.take) : pool;
    for (const l of picked) chosen.set(l.url, { ...l, matchedRule: rule.name });
  }
  return [...chosen.values()];
}
