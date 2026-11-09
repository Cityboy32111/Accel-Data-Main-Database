import { describe, expect, it } from "vitest";
import { groundPageOutput } from "../src/structure/extract-documents.js";

const page = "The Court appoints Kevin B. Duff as Receiver. BMO Harris Bank N.A. holds a mortgage on 7749 S. Yates.";

describe("groundPageOutput", () => {
  it("keeps grounded assertions, drops fabricated ones, caps confidence", () => {
    const out = groundPageOutput(
      {
        parties: [
          { key: "p1", kind: "person", canonical_name: "Kevin B. Duff", party_roles: ["receiver"], aliases: [] },
          { key: "p2", kind: "organization", canonical_name: "BMO Harris Bank N.A.", party_roles: ["lender"], aliases: [] },
        ],
        creditors: [{ party_key: "p2", creditor_type: "secured_lender", claim_amount_asserted: null, claim_group: null, treatment_summary: null }],
        properties: [{ key: "pr1", address: "7749 S. Yates", city: null, state: null, receiver_property_number: null, disposition: "unknown" }],
        assertions: [
          { subject_type: "party", subject_key: "p1", predicate: "has_role", object_value: "receiver", quote: "appoints Kevin B. Duff as Receiver", confidence: 0.99, origin: "extracted" },
          { subject_type: "creditor", subject_key: "p2", predicate: "secured_by_property", object_value: "7749 S. Yates", object_type: "property", object_key: "pr1", quote: "BMO Harris Bank N.A. holds a mortgage on 7749 S. Yates", confidence: 0.9, origin: "inferred" },
          { subject_type: "party", subject_key: "p2", predicate: "claim_amount", object_value: 4200000, quote: "owed $4,200,000 under the note", confidence: 0.8, origin: "extracted" },
          { subject_type: "party", subject_key: "p9", predicate: "has_role", object_value: "x", quote: "appoints Kevin B. Duff", confidence: 0.8, origin: "extracted" },
        ],
      },
      page,
      3,
    );
    expect(out.grounded).toBe(2);
    expect(out.rejected).toBe(2);
    expect(out.assertions.every((a) => a.page_number === 3)).toBe(true);
    expect(out.assertions[0].confidence).toBe(0.95);
    expect(out.assertions[1].object_type).toBe("property");
    expect(out.rejectedQuotes[0]).toContain("$4,200,000");
    expect(out.rejectedQuotes[1]).toContain("undeclared subject");
  });

  it("drops object links to undeclared entities but keeps the assertion", () => {
    const out = groundPageOutput(
      {
        parties: [{ key: "p1", kind: "organization", canonical_name: "BMO Harris Bank N.A.", party_roles: ["lender"], aliases: [] }],
        assertions: [{ subject_type: "party", subject_key: "p1", predicate: "secured_by_property", object_value: "7749", object_type: "property", object_key: "missing", quote: "holds a mortgage on 7749 S. Yates", confidence: 0.7, origin: "extracted" }],
      },
      page,
      1,
    );
    expect(out.grounded).toBe(1);
    expect(out.assertions[0].object_type).toBeNull();
  });
});
