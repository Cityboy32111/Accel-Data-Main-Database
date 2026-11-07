import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseListingText,
  parseReceiverSiteIndex,
  selectSubset,
  summarizeBySection,
} from "../src/acquire/receiver-site.js";

const html = readFileSync(new URL("../../fixtures/equitybuild/index.html", import.meta.url), "utf8");
const listings = parseReceiverSiteIndex(html);

describe("receiver site index parser", () => {
  it("finds every PDF link once", () => {
    expect(listings.length).toBeGreaterThan(800);
    expect(new Set(listings.map((l) => l.url)).size).toBe(listings.length);
  });

  it("assigns every listing to one of the four sections", () => {
    const sections = summarizeBySection(listings);
    expect(Object.keys(sections).sort()).toEqual(["Claims Process", "Orders", "Other Pleadings", "Status Reports"]);
    expect(sections["Orders"]).toBeGreaterThan(400);
    expect(sections["Status Reports"]).toBeGreaterThan(40);
  });

  it("extracts docket numbers and filing dates from link text", () => {
    const first = listings.find((l) => l.fileName.endsWith("-1992.pdf"));
    expect(first).toBeDefined();
    expect(first!.docketNumber).toBe("1992");
    expect(first!.filedDate).toBe("2026-11-04");
    expect(first!.category).toBe("order");
    expect(first!.docketSuffix).toBeNull();
  });

  it("marks appellate docket numbers and omitted exhibits", () => {
    expect(parseListingText("Panel's Opinion Affirming (12/04/2025, Appeal Dkt. No. 44)")).toEqual({
      docketNumber: "44",
      docketSuffix: "appeal",
      filedDate: "2025-12-04",
      exhibitsOmitted: false,
    });
    expect(parseListingText("Fee App (05/15/2025, Dkt. No. 1878) - Exhibits K & L Not Included").exhibitsOmitted).toBe(true);
    expect(parseListingText("Minute Entry (06/03/2020)")).toMatchObject({ docketNumber: null, filedDate: "2020-06-03" });
  });

  it("never reports a listing without a title or url", () => {
    for (const l of listings) {
      expect(l.title.length).toBeGreaterThan(3);
      expect(l.url).toMatch(/^https:\/\/rdaplaw\.net\/wp-content\/uploads\/.*\.pdf$/i);
    }
  });
});

describe("pilot subset selection", () => {
  it("applies rules in order without duplicates", () => {
    const picked = selectSubset(listings, {
      rules: [
        { name: "latest status reports", category: "status_report", titlePattern: "Status Report \\(", take: 2, order: "newest" },
        { name: "any status report", category: "status_report", take: 3, order: "newest" },
      ],
    });
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((p) => p.url)).size).toBe(5);
    expect(picked.filter((p) => p.matchedRule === "latest status reports")).toHaveLength(2);
  });

  it("matches explicit district docket numbers but not appellate ones", () => {
    const picked = selectSubset(listings, { rules: [{ name: "by docket", docketNumbers: ["1992", "44"] }] });
    expect(picked.map((p) => p.docketNumber)).toContain("1992");
    expect(picked.every((p) => p.docketSuffix === null)).toBe(true);
  });

  it("uses the committed pilot plan and stays small", () => {
    const plan = JSON.parse(readFileSync(new URL("../../fixtures/equitybuild/pilot-subset.json", import.meta.url), "utf8"));
    const picked = selectSubset(listings, plan);
    expect(picked.length).toBeGreaterThanOrEqual(30);
    expect(picked.length).toBeLessThanOrEqual(50);
    const cats = new Set(picked.map((p) => p.category));
    expect(cats.has("order")).toBe(true);
    expect(cats.has("status_report")).toBe(true);
    expect(cats.has("claims_process")).toBe(true);
    expect(cats.has("pleading")).toBe(true);
  });
});
