// Regression checks for the five claim-support failures found in the 2026-11-08
// review. They run against the committed version-2 retest fixtures, so they
// fail loudly if a future prompt or schema change reintroduces the pattern.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../fixtures/equitybuild/retest-2026-11-08/", import.meta.url);
const have = (name: string) => existsSync(new URL(name, dir));
const EMPTY = { page_kind: "missing", assertions: [], output: { parties: [], creditors: [], related_lawsuits: [] } };
// describe.skipIf still collects the suite body, so a missing fixture must not throw here.
const load = (name: string) => (have(name) ? JSON.parse(readFileSync(new URL(name, dir), "utf8")) : EMPTY);

const NON_OUTCOME = new Set(["proposed", "requested", "recommended", "alleged", "argued", "index_reference"]);

describe.skipIf(!have("dkt-1938-p002.json"))("Dkt. 1938 page 2: the $30,000 Pennington settlement", () => {
  const bundle = load("dkt-1938-p002.json");
  const money = bundle.assertions.filter((a: { quote: string; object_value: unknown }) => /30,000|30000|thirty thousand/i.test(`${a.quote} ${JSON.stringify(a.object_value)}`));

  it("is extracted at all", () => {
    expect(money.length).toBeGreaterThan(0);
  });

  it("is never a completed or ordered payment, and never attached to the main case without a flag", () => {
    for (const a of money) {
      expect(NON_OUTCOME.has(a.modality) || a.needs_review).toBe(true);
      const onMainCase = a.subject_type === "case" && a.proceeding?.scope !== "related_lawsuit";
      expect(onMainCase && !a.needs_review).toBe(false);
    }
  });

  it("names the related Pennington action as the proceeding and keeps the court-approval condition", () => {
    const good = money.filter((a: { proceeding?: { scope: string }; proceeding_label: string; conditions: string | null }) =>
      a.proceeding?.scope === "related_lawsuit" && /pennington|2021 L 010115|circuit court/i.test(a.proceeding_label) && /approv/i.test(a.conditions ?? ""));
    expect(good.length).toBeGreaterThan(0);
  });

  it("declares the Circuit Court Action as a related lawsuit with its docket number", () => {
    const rl = bundle.output.related_lawsuits.find((r: { docket_number: string | null; caption: string }) => /2021 L 010115/.test(r.docket_number ?? "") || /pennington/i.test(r.caption));
    expect(rl).toBeDefined();
  });
});

describe.skipIf(!have("dkt-1967-p003.json"))("Dkt. 1967 page 3: contents-page treatment headings", () => {
  const bundle = load("dkt-1967-p003.json");

  it("classifies the page as a table of contents", () => {
    expect(bundle.page_kind).toBe("table_of_contents");
  });

  it("never turns 'Should Be Excluded' or 'Is Appropriate' into a finding", () => {
    for (const a of bundle.assertions) {
      expect(a.modality).toBe("index_reference");
      expect(a.needs_review).toBe(true);
      expect(a.final_confidence).toBeLessThanOrEqual(0.6);
      if (typeof a.object_value === "string") {
        expect(/\b(recommend|propos|request|should|argu|alleg|seek|index)/i.test(a.object_value) || !/\b(excluded|subordinated)\b/i.test(a.object_value)).toBe(true);
      }
    }
  });

  it("still names the claimants from the headings (Allred, Mora, Shatar, Terada) as creditors so recall is not sacrificed", () => {
    const names = bundle.output.parties.map((p: { canonical_name: string }) => p.canonical_name.toLowerCase()).join(" | ");
    for (const n of ["allred", "mora", "shatar", "terada"]) expect(names).toContain(n);
    expect(bundle.output.creditors.length).toBeGreaterThanOrEqual(4);
  });

  it("points each index reference at a substantive page", () => {
    for (const a of bundle.assertions) expect(a.referenced_page === null || a.referenced_page > 3).toBe(true);
  });
});
