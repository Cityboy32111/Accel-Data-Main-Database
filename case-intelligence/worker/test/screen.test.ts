import { describe, expect, it } from "vitest";
import { detectPii, maskPii, screenText } from "../src/screen/restrictions.js";

describe("restriction screening", () => {
  it("halts on a sealed caption marker", () => {
    const r = screenText("UNITED STATES DISTRICT COURT\nFILED UNDER SEAL\nORDER");
    expect(r.flags).toContain("sealed_marker");
    expect(r.halting).toEqual(["sealed_marker"]);
  });

  it("does not halt on lowercase prose mentions deep in the document", () => {
    const body = "x".repeat(2000) + " the envelope was sealed by the clerk.";
    const r = screenText(body);
    expect(r.halting).toEqual([]);
  });

  it("flags protective order references without halting", () => {
    const r = screenText("Pursuant to the Protective Order entered on May 1, the parties exchanged documents.");
    expect(r.flags).toContain("protective_order_reference");
    expect(r.halting).toEqual([]);
  });

  it("flags redactions and personal data", () => {
    const r = screenText("Claimant SSN 123-45-6789 [REDACTED] account no. 1234 5678 9012");
    expect(r.flags).toContain("redaction_present");
    expect(r.flags).toContain("pii_detected");
  });
});

describe("pii masking", () => {
  it("masks social security numbers, account numbers and dates of birth", () => {
    const input = "SSN 123-45-6789, Account No. 4000-1234-5678-9010, DOB: 01/02/1970, claim $1,000.";
    const { text, counts } = maskPii(input);
    expect(counts).toEqual({ ssn: 1, accountNumber: 1, dateOfBirth: 1, total: 3 });
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("4000-1234-5678-9010");
    expect(text).not.toContain("01/02/1970");
    expect(text).toContain("claim $1,000.");
  });

  it("leaves docket numbers and dollar amounts alone", () => {
    const input = "Dkt. No. 1992, 11/04/2026, distribution of $12,345,678.90 to Group 10.";
    expect(detectPii(input).total).toBe(0);
    expect(maskPii(input).text).toBe(input);
  });
});
