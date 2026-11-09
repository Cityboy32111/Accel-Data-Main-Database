import { describe, expect, it } from "vitest";
import { lintAssertion } from "../src/structure/modality-lint.js";

const base = { conditions: null as string | null, page_kind: "body", subject_type: "party", proceeding: { scope: "main_case", related_lawsuit_key: null } };

describe("modality lint: requests and proposals are never outcomes", () => {
  it("flags a completed/ordered modality on a 'will pay ... with the Court's approval' sentence (Dkt. 1938 p. 2 pattern)", () => {
    const r = lintAssertion({ ...base, modality: "completed", quote: "Pursuant to the proposed Settlement Agreement, and with the Court's approval: the Receiver will pay thirty thousand dollars ($30,000)", object_value: 30000, subject_type: "case", proceeding: { scope: "related_lawsuit", related_lawsuit_key: "rl1" } });
    expect(r.flags.some((f) => f.startsWith("modality_conflict"))).toBe(true);
    expect(r.flags.some((f) => f.startsWith("proceeding_mismatch"))).toBe(true);
    expect(r.needs_review).toBe(true);
    expect(r.confidence_factor).toBeLessThanOrEqual(0.5);
  });

  it("accepts the same sentence when modality is proposed, conditions are captured and the subject is the related action", () => {
    const r = lintAssertion({ ...base, modality: "proposed", quote: "the Receiver will pay thirty thousand dollars ($30,000)", object_value: "proposed payment of $30,000", conditions: "subject to Court approval; within seven days of an order dismissing the Circuit Court Action with prejudice", subject_type: "related_lawsuit", proceeding: { scope: "related_lawsuit", related_lawsuit_key: "rl1" } });
    expect(r.flags).toEqual([]);
    expect(r.needs_review).toBe(false);
    expect(r.confidence_factor).toBe(1);
  });

  it("flags 'Should Be Excluded' stored as an excluded outcome (Dkt. 1967 p. 3 pattern)", () => {
    const r = lintAssertion({ ...base, modality: "ordered", quote: "Allred's Unsecured Claim Should Be Excluded", object_value: "excluded" });
    expect(r.flags.some((f) => f.startsWith("modality_conflict"))).toBe(true);
    expect(r.needs_review).toBe(true);
  });

  it("flags an outcome word in the object value even under a recommended modality", () => {
    const r = lintAssertion({ ...base, modality: "recommended", quote: "Subordination of Shatar's Unsecured Claims Is Appropriate", object_value: "subordinated" });
    expect(r.flags.some((f) => f.startsWith("object_states_outcome"))).toBe(true);
  });

  it("accepts a recommendation phrased as a recommendation", () => {
    const r = lintAssertion({ ...base, modality: "recommended", quote: "Mora's Unsecured Claim Should Be Excluded.", object_value: "Receiver recommends exclusion of the unsecured claim" });
    expect(r.flags).toEqual([]);
  });

  it("downgrades any factual modality on a table-of-contents page to index_reference and keeps it in review", () => {
    const r = lintAssertion({ ...base, modality: "reported", page_kind: "table_of_contents", quote: "Allred's Unsecured Claim Should Be Excluded ..... 27", object_value: "Receiver argues exclusion" });
    expect(r.modality).toBe("index_reference");
    expect(r.needs_review).toBe(true);
    expect(r.confidence_factor).toBeLessThanOrEqual(0.6);
  });

  it("flags a dropped qualifier", () => {
    const r = lintAssertion({ ...base, modality: "ordered", quote: "the Receiver is authorized, subject to the requirement in Section VI that leave of this Court is required, to engage professionals", object_value: "may engage professionals" });
    expect(r.flags.some((f) => f.startsWith("conditions_missing"))).toBe(true);
  });

  it("leaves a plain court order alone", () => {
    const r = lintAssertion({ ...base, modality: "ordered", quote: "IT IS HEREBY ORDERED that Kevin B. Duff is appointed Receiver", object_value: "receiver" });
    expect(r.flags).toEqual([]);
    expect(r.needs_review).toBe(false);
  });
});

describe("modality lint: ECF header dates", () => {
  it("flags a case-level filed_on with a bare date taken from the ECF header", () => {
    const r = lintAssertion({ ...base, modality: "completed", predicate: "filed_on", subject_type: "case", quote: "Case: 1:18-cv-05587 Document #: 16 Filed: 08/17/18 Page 1 of 29", object_value: "2018-08-17" });
    expect(r.flags.some((f) => f.startsWith("document_date_as_case_date"))).toBe(true);
    expect(r.flags.some((f) => f.startsWith("ecf_header_quote"))).toBe(true);
    expect(r.needs_review).toBe(true);
  });
  it("accepts the same header recorded as the document's filing", () => {
    const r = lintAssertion({ ...base, modality: "completed", predicate: "document_filed", subject_type: "case", quote: "Case: 1:18-cv-05587 Document #: 16 Filed: 08/17/18", object_value: "Order Appointing Receiver, Dkt. 16" });
    expect(r.flags).toEqual([]);
  });
});

describe("authority versus proceeding", () => {
  const estate = ["equitybuild", "cohen", "duff", "receiver"];
  it("moves a precedent with a reporter citation and no estate party to authorities", async () => {
    const { classifyLawsuit } = await import("../src/structure/modality-lint.js");
    expect(classifyLawsuit({ key: "r1", caption: "5201 Wash. Invs. LLC v. Other Party, Inc.", docket_number: "2024 IL App (1st) 231403-U", court: "Illinois Appellate Court" }, estate).classification).toBe("authority");
    expect(classifyLawsuit({ key: "r2", caption: "Gordon v. Dadante", docket_number: "336 Fed. Appx. 540", court: "6th Cir." }, estate).classification).toBe("authority");
    expect(classifyLawsuit({ key: "r3", caption: "SEC v. Wealth Mgmt., LLC", docket_number: "628 F.3d 323", court: "7th Cir." }, estate).classification).toBe("authority");
  });
  it("keeps an appeal from this receivership but flags the reporter citation for review", async () => {
    const { classifyLawsuit } = await import("../src/structure/modality-lint.js");
    const c = classifyLawsuit({ key: "r4", caption: "SEC v. EquityBuild, Inc. (EquityBuild I)", docket_number: "101 F.4th 526", court: "7th Cir." }, estate);
    expect(c.classification).toBe("proceeding_review");
    // A state-court appeal that names an estate entity but is cited as precedent is kept and flagged, not dropped.
    const w = classifyLawsuit({ key: "r6", caption: "5201 Wash. Invs. LLC v. Equitybuild, Inc.", docket_number: "2024 IL App (1st) 231403-U", court: "Illinois Appellate Court" }, estate);
    expect(w.classification).toBe("proceeding_review");
  });
  it("keeps a docketed state-court action as a proceeding", async () => {
    const { classifyLawsuit } = await import("../src/structure/modality-lint.js");
    expect(classifyLawsuit({ key: "r5", caption: "Fireshark Enterprises, LLC v. EquityBuild, Inc.", docket_number: "2018 L 9026", court: "Circuit Court of Cook County" }, estate).classification).toBe("proceeding");
  });
  it("reclassification moves the row, drops its assertions as authority facts, and records the move", async () => {
    const { reclassifyLawsuits, processOutput, coerceOutput } = await import("../src/retest/retest-pages.js");
    const output = coerceOutput({
      page_kind: "body",
      related_lawsuits: [
        { key: "r1", caption: "Gordon v. Dadante", docket_number: "336 Fed. Appx. 540", court: "6th Cir.", relationship: "other" },
        { key: "r2", caption: "Fireshark Enterprises, LLC v. EquityBuild, Inc.", docket_number: "2018 L 9026", court: "Circuit Court of Cook County", relationship: "state_court_action" },
      ],
      assertions: [
        { subject_type: "related_lawsuit", subject_key: "r1", predicate: "status", object_value: "held that a receiver's settlement is reviewed for fairness", object_type: null, object_key: null, modality: "reported", conditions: null, proceeding: { scope: "related_lawsuit", related_lawsuit_key: "r1" }, as_of_date: null, referenced_page: null, quote: "Gordon v. Dadante", confidence: 0.8, origin: "extracted" },
        { subject_type: "related_lawsuit", subject_key: "r2", predicate: "status", object_value: "stayed", object_type: null, object_key: null, modality: "reported", conditions: null, proceeding: { scope: "related_lawsuit", related_lawsuit_key: "r2" }, as_of_date: null, referenced_page: null, quote: "Fireshark Enterprises, LLC v. EquityBuild, Inc. was stayed", confidence: 0.8, origin: "extracted" },
      ],
    });
    const moves = reclassifyLawsuits(output, ["cohen", "duff", "receiver"]);
    expect(moves.map((m) => m.to)).toEqual(["authority"]);
    expect(output.related_lawsuits.map((r) => r.key)).toEqual(["r2"]);
    expect(output.authorities[0].citation).toMatch(/Gordon v\. Dadante/);
    const { assertions, dropped } = processOutput(output, "Gordon v. Dadante, 336 Fed. Appx. 540. Fireshark Enterprises, LLC v. EquityBuild, Inc. was stayed", moves);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toMatch(/cited authority/);
    expect(assertions).toHaveLength(1);
  });
});

describe("holding recorded as a party position", () => {
  it("flags a court's holding stored under party_position", async () => {
    const { lintAssertion } = await import("../src/structure/modality-lint.js");
    const r = lintAssertion({ modality: "argued", predicate: "party_position", subject_type: "party", page_kind: "body", conditions: null,
      object_value: "Seventh Circuit recognized the Cohens ran a Ponzi scheme through EquityBuild, Inc.",
      quote: "the Cohens ran a Ponzi scheme through their real estate companies" });
    expect(r.flags.some((f) => f.startsWith("holding_as_position"))).toBe(true);
    expect(r.needs_review).toBe(true);
  });
  it("leaves a genuine party position alone", async () => {
    const { lintAssertion } = await import("../src/structure/modality-lint.js");
    const r = lintAssertion({ modality: "argued", predicate: "party_position", subject_type: "party", page_kind: "body", conditions: null,
      object_value: "SEC argues BMO's release was never recorded", quote: "The facts are worse for BMO than they were for DLP" });
    expect(r.flags.some((f) => f.startsWith("holding_as_position"))).toBe(false);
  });
});
