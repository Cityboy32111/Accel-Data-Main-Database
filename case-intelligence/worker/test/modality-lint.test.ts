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
