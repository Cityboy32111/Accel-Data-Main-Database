import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProvenance, checkEligibility, type CandidateSubject, type ProviderState } from "../src/enrich/controls.js";
import { DryRunTransport, LeadOceanAdapter } from "../src/enrich/leadocean.js";
import { assertMinimumIdentifiers } from "../src/enrich/provider.js";

const fixtures = JSON.parse(readFileSync(new URL("../../fixtures/enrichment/leadocean-company-sample.json", import.meta.url), "utf8"));
delete fixtures.$comment;

const org: CandidateSubject = {
  subject_type: "creditor", subject_id: "c1", legal_name: "Example Lender, N.A.", kind: "organization", is_individual: false,
  enrichment_allowed: true, confirmed_assertions: 2, domain: "example-lender.test", firm_id: "f1", case_id: "k1",
};
const provider: ProviderState = { provider_key: "leadocean", enabled: true, credential_configured: true, daily_cap: 100, used_today: 0, allowed_entity_kinds: ["organization"] };

describe("eligibility", () => {
  it("accepts a reviewer-confirmed, opted-in organization with a domain", () => {
    expect(checkEligibility(org, provider, [])).toEqual({ eligible: true, reasons: [] });
  });
  it("refuses individuals however they are flagged", () => {
    const r = checkEligibility({ ...org, kind: "person", is_individual: true, legal_name: "Jane Investor" }, provider, []);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/individual/);
  });
  it("refuses without opt-in, without a confirmed assertion, or without a domain", () => {
    expect(checkEligibility({ ...org, enrichment_allowed: false }, provider, []).reasons.join(" ")).toMatch(/opt-in/);
    expect(checkEligibility({ ...org, confirmed_assertions: 0 }, provider, []).reasons.join(" ")).toMatch(/confirmed/);
    expect(checkEligibility({ ...org, domain: null }, provider, []).reasons.join(" ")).toMatch(/domain/);
  });
  it("refuses when the provider is disabled, unkeyed, or capped", () => {
    expect(checkEligibility(org, { ...provider, enabled: false }, []).reasons.join(" ")).toMatch(/disabled/);
    expect(checkEligibility(org, { ...provider, credential_configured: false }, []).reasons.join(" ")).toMatch(/credential/);
    expect(checkEligibility(org, { ...provider, used_today: 100 }, []).reasons.join(" ")).toMatch(/daily cap/);
  });
  it("deduplicates lookups of the same domain within 30 days and allows them after", () => {
    const recent = [{ provider_key: "leadocean", domain: "example-lender.test", retrieved_at: new Date(Date.now() - 5 * 86400000).toISOString() }];
    expect(checkEligibility(org, provider, recent).reasons.join(" ")).toMatch(/duplicate/);
    const old = [{ provider_key: "leadocean", domain: "example-lender.test", retrieved_at: new Date(Date.now() - 45 * 86400000).toISOString() }];
    expect(checkEligibility(org, provider, old).eligible).toBe(true);
  });
});

describe("Lead Ocean adapter in dry run", () => {
  const transport = new DryRunTransport(fixtures);
  const adapter = new LeadOceanAdapter({ baseUrl: "https://api.leadocean.test", credentialSecretName: "LEADOCEAN_API_KEY" }, transport);

  it("sends only the domain and never matter data", () => {
    const req = adapter.buildRequest({ subject_id: "c1", subject_type: "creditor", legal_name: "Example Lender, N.A.", domain: "Example-Lender.test" });
    expect(req.payload).toEqual({ domain: "example-lender.test" });
    expect(JSON.stringify(req)).not.toMatch(/c1|case|docket|claim/);
    expect(req.estimated_units).toBe(1);
  });
  it("refuses a name-only lookup", () => {
    expect(() => adapter.buildRequest({ subject_id: "c2", subject_type: "creditor", legal_name: "Unknown Lender", domain: null })).toThrow(/domain/);
  });
  it("records the request without sending and charges no units", async () => {
    const res = await adapter.send(adapter.buildRequest({ subject_id: "c1", subject_type: "creditor", legal_name: "Example Lender, N.A.", domain: "example-lender.test" }));
    expect(transport.recorded).toHaveLength(1);
    expect(transport.recorded[0].headers.authorization).toBe("<redacted-in-dry-run>");
    expect(res.units_charged).toBe(0);
    expect(res.normalized).toMatchObject({ legal_name: "Example Lender, N.A.", domain: "example-lender.test", industry: "Banking", headcount: 12000 });
    expect(res.normalized.provider_confidence).toBeCloseTo(0.92, 2);
  });
  it("fails closed when no fixture exists for a domain", async () => {
    await expect(adapter.send(adapter.buildRequest({ subject_id: "c3", subject_type: "creditor", legal_name: "X", domain: "nofixture.test" }))).rejects.toThrow(/no live request was sent/);
  });
});

describe("payload guard", () => {
  it("rejects any key that could carry matter data", () => {
    expect(() => assertMinimumIdentifiers({ domain: "a.test", case_number: "18-cv-5587" })).toThrow(/not allowed/);
    expect(() => assertMinimumIdentifiers({ domain: "a.test", claim_amount: "30000" })).toThrow(/not allowed/);
    expect(() => assertMinimumIdentifiers({ name: "Example Lender" })).not.toThrow();
  });
});

describe("provenance", () => {
  it("produces enriched, unverified assertions and an audit event naming the exact request", () => {
    const transport = new DryRunTransport(fixtures);
    const adapter = new LeadOceanAdapter({ baseUrl: "https://api.leadocean.test", credentialSecretName: "LEADOCEAN_API_KEY" }, transport);
    const req = adapter.buildRequest({ subject_id: "c1", subject_type: "creditor", legal_name: "Example Lender, N.A.", domain: "example-lender.test" });
    const raw = fixtures["example-lender.test"];
    const prov = buildProvenance(org, req, raw, adapter.normalize(raw), "2026-11-08T00:00:00Z");
    expect(prov.assertions.length).toBeGreaterThan(3);
    for (const a of prov.assertions) {
      expect(a.origin).toBe("enriched");
      expect(a.verification_status).toBe("unverified");
      expect(a.confidence).toBeLessThanOrEqual(0.9);
    }
    expect(prov.audit_event.action).toBe("enrichment.lookup");
    expect(prov.audit_event.details.payload).toEqual({ domain: "example-lender.test" });
    expect(prov.enrichment_result.raw_response).toBe(raw);
  });
});
