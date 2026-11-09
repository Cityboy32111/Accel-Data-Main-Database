// Regression checks for the five claim-support failures found in the 2026-11-08
// review. They run against the committed version-2 retest fixtures, so they
// fail loudly if a future prompt or schema change reintroduces the pattern.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every committed retest of the regression pages must satisfy these checks, so a
// later extractor version cannot quietly reintroduce an earlier failure.
const root = new URL("../../fixtures/equitybuild/", import.meta.url);
const retestDirs = readdirSync(root).filter((d) => /^retest-\d{4}-\d{2}-\d{2}/.test(d)).sort();
const EMPTY = { page_kind: "missing", assertions: [], output: { parties: [], creditors: [], related_lawsuits: [] }, warnings: [] };
const NON_OUTCOME = new Set(["proposed", "requested", "recommended", "alleged", "argued", "index_reference"]);

for (const d of retestDirs) {
const dir = new URL(`${d}/`, root);
const have = (name: string) => existsSync(new URL(name, dir));
// describe.skipIf still collects the suite body, so a missing fixture must not throw here.
const load = (name: string) => (have(name) ? JSON.parse(readFileSync(new URL(name, dir), "utf8")) : EMPTY);

describe.skipIf(!have("dkt-1938-p002.json"))(`${d} / Dkt. 1938 page 2: the $30,000 Pennington settlement`, () => {
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

describe.skipIf(!have("dkt-1967-p003.json"))(`${d} / Dkt. 1967 page 3: contents-page treatment headings`, () => {
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

// The date and creditor rules apply to versions from 2026-11-08.3 onward; the
// 2026-11-08.2 retest is kept as the record of the failures it exposed.
const creditorRuleApplies = (b: { schema_version?: string }) => (b.schema_version ?? "") >= "2026-11-08.3";
const authorityRuleApplies = (b: { schema_version?: string }) => (b.schema_version ?? "") >= "2026-11-09.1";
const mainCaseRuleApplies = (b: { postprocess_version?: string }) => (b.postprocess_version ?? "") >= "2026-11-09.3";

describe.skipIf(!have("appointment-order-p001.json") || !creditorRuleApplies(load("appointment-order-p001.json")))(`${d} / Dkt. 16 page 1: document date is not the case date`, () => {
  const bundle = load("appointment-order-p001.json");
  it("never records an unflagged case-level filed_on with a bare date", () => {
    for (const a of bundle.assertions) {
      const bareDate = typeof a.object_value !== "string" || /^\d{4}-\d{2}-\d{2}$/.test(a.object_value);
      const caseFiledOn = a.subject_type === "case" && /^(filed_on|filing_date|filed)$/i.test(a.predicate) && bareDate;
      expect(caseFiledOn && !a.needs_review).toBe(false);
    }
  });
  it("records the ECF header, if at all, as the document's filing", () => {
    for (const a of bundle.assertions) {
      if (/Document\s*#?:?\s*\d+\s+Filed:/i.test(a.quote) && a.subject_type === "case") {
        expect(/document|dkt|order/i.test(String(a.object_value)) || a.needs_review).toBe(true);
      }
    }
  });
});

describe.skipIf(!have("dkt-1806-p003.json") || !creditorRuleApplies(load("dkt-1806-p003.json")))(`${d} / Dkt. 1806 page 3: objecting lenders stay creditors`, () => {
  const bundle = load("dkt-1806-p003.json");
  const creditorNames = () => bundle.output.creditors.map((c: { party_key: string }) => bundle.output.parties.find((p: { key: string }) => p.key === c.party_key)?.canonical_name.toLowerCase() ?? "").join(" | ");
  it("lists BMO, Citibank and Sabal as creditors although their role on the page is objector", () => {
    for (const n of ["bmo", "citibank", "sabal"]) expect(creditorNames()).toContain(n);
  });
  it("reports no lender declared without a creditor entry", () => {
    expect(bundle.warnings.filter((w: string) => w.startsWith("lender_not_creditor"))).toEqual([]);
  });
});

describe.skipIf(!have("dkt-1806-p001.json") || !creditorRuleApplies(load("dkt-1806-p001.json")))(`${d} / Dkt. 1806 page 1: footnoted Group 6 lenders are creditors`, () => {
  const bundle = load("dkt-1806-p001.json");
  it("lists Midland and UBS under creditors", () => {
    const names = bundle.output.creditors.map((c: { party_key: string }) => bundle.output.parties.find((p: { key: string }) => p.key === c.party_key)?.canonical_name.toLowerCase() ?? "").join(" | ");
    for (const n of ["midland", "ubs"]) expect(names).toContain(n);
  });
});

describe.skipIf(!have("dkt-1806-p004.json") || !authorityRuleApplies(load("dkt-1806-p004.json")))(`${d} / Dkt. 1806 page 4: a precedent is never an unflagged related proceeding`, () => {
  const bundle = load("dkt-1806-p004.json");
  it("5201 Washington is absent, an authority, or a related lawsuit held for review", () => {
    const listed = bundle.output.related_lawsuits.filter((r: { caption: string }) => /5201/.test(r.caption));
    const asAuthority = (bundle.output.authorities ?? []).some((a: { citation: string }) => /5201/.test(a.citation));
    const flagged = (bundle.reclassified ?? []).some((m: { caption: string }) => /5201/.test(m.caption));
    expect(listed.length === 0 || asAuthority || flagged).toBe(true);
    for (const a of bundle.assertions) {
      if (a.subject_type === "related_lawsuit" && /5201/.test(a.subject_label)) expect(a.needs_review).toBe(true);
    }
  });
  it("never lists a non-estate precedent as a related lawsuit", () => {
    for (const r of bundle.output.related_lawsuits) expect(/equitybuild|cohen|duff|receiver|calumet|wpd|shatar|bc57|amark/i.test(r.caption)).toBe(true);
  });
});

describe.skipIf(!have("dkt-1967-p005.json") || !authorityRuleApplies(load("dkt-1967-p005.json")))(`${d} / Dkt. 1967 page 5: appeals from this receivership stay proceedings, other precedents do not`, () => {
  const bundle = load("dkt-1967-p005.json");
  it("never lists a non-estate precedent as a related lawsuit", () => {
    for (const r of bundle.output.related_lawsuits) {
      expect(/equitybuild|cohen|duff|receiver/i.test(r.caption)).toBe(true);
    }
  });
  it.skipIf(!mainCaseRuleApplies(bundle))("keeps the main case's own June 20, 2024 order out of related lawsuits", () => {
    const asProceeding = bundle.output.related_lawsuits.some((r: { docket_number: string | null; caption: string }) => /3069682/.test(`${r.docket_number} ${r.caption}`));
    const asAuthority = (bundle.output.authorities ?? []).some((a: { citation: string }) => /3069682/.test(a.citation));
    expect(asProceeding).toBe(false);
    expect(asAuthority).toBe(true);
  });
  it.skipIf(!mainCaseRuleApplies(bundle))("still lists both Seventh Circuit appeals as related lawsuits held for review", () => {
    for (const cite of ["101 F.4th 526", "161 F.4th 1020"]) {
      expect(bundle.output.related_lawsuits.some((r: { docket_number: string | null }) => (r.docket_number ?? "").includes(cite))).toBe(true);
      expect((bundle.reclassified ?? []).some((m: { to: string; key: string }) => m.to.includes("review") && bundle.output.related_lawsuits.some((r: { key: string; docket_number: string | null }) => r.key === m.key && (r.docket_number ?? "").includes(cite)))).toBe(true);
    }
  });
});

describe.skipIf(!have("dkt-1967-p012.json") || !mainCaseRuleApplies(load("dkt-1967-p012.json")))(`${d} / Dkt. 1967 page 12: a Seventh Circuit holding is never an unflagged party position`, () => {
  const bundle = load("dkt-1967-p012.json");
  it("flags the Ponzi-scheme holding for review when stored as a party position", () => {
    const holdings = bundle.assertions.filter((a: { object_value: unknown; quote: string }) => /ponzi/i.test(`${a.object_value} ${a.quote}`));
    expect(holdings.length).toBeGreaterThan(0);
    for (const a of holdings) {
      if (a.predicate === "party_position") expect(a.needs_review).toBe(true);
    }
  });
  it("grounds the August 17, 2018 appointment despite split words in the text layer", () => {
    expect(bundle.assertions.some((a: { predicate: string; object_value: unknown }) => a.predicate === "appointed_on" && String(a.object_value).startsWith("2018-08-17"))).toBe(true);
  });
});
}
