import { describe, expect, it } from "vitest";
import { diceSimilarity, groundQuote } from "../src/structure/grounding.js";

const page = `IT IS HEREBY ORDERED that Kevin B. Duff is appointed Receiver for the
Receivership Defendants. The Receiver shall take custody of all real property,
including 7749-59 S. Yates Boulevard, Chicago, Illinois. BMO Harris Bank N.A.
holds a first mortgage on the property. Entered: August 17, 2018.`;

describe("grounding", () => {
  it("accepts an exact quote", () => {
    const r = groundQuote(page, "Kevin B. Duff is appointed Receiver");
    expect(r.ok).toBe(true);
    expect(r.method).toBe("exact");
    expect(r.penalty).toBe(1);
  });

  it("accepts a quote that differs only in whitespace, case and quote marks", () => {
    const r = groundQuote(page, "the receiver shall take custody of all real property, including 7749-59 S. Yates Boulevard");
    expect(r.ok).toBe(true);
    expect(r.method).toBe("normalized");
  });

  it("accepts a near-verbatim quote with a small OCR-style difference at a penalty", () => {
    const r = groundQuote(page, "BMO Harris Bank N.A. holds a first mortgage on the properly. Entered: August 17, 2018");
    expect(r.ok).toBe(true);
    expect(r.method).toBe("fuzzy");
    expect(r.penalty).toBe(0.85);
  });

  it("accepts a verbatim quote when the text layer splits words with stray spaces", () => {
    const split = "O n August 17, 2018, this C ourt appointed a r eceiver for the assets of the R eceivership Defendants.";
    const r = groundQuote(split, "On August 17, 2018, this Court appointed a receiver for the assets of the Receivership Defendants.");
    expect(r.ok).toBe(true);
    expect(r.method).toBe("spaceless");
    expect(r.penalty).toBe(1);
    expect(split.slice(r.char_start!, r.char_end!)).toMatch(/^O n August.*Defendants\.$/);
  });

  it("rejects a fabricated quote", () => {
    const r = groundQuote(page, "Citibank, N.A. holds a second mortgage and is owed $4,200,000");
    expect(r.ok).toBe(false);
    expect(r.penalty).toBe(0);
  });

  it("rejects empty quotes", () => {
    expect(groundQuote(page, "   ").ok).toBe(false);
  });

  it("dice similarity is symmetric and bounded", () => {
    expect(diceSimilarity("night", "nacht")).toBeCloseTo(0.25, 2);
    expect(diceSimilarity("abc", "abc")).toBe(1);
  });
});
