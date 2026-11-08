// Eligibility, deduplication, provenance and audit controls around any
// provider call. Pure functions over plain inputs so they can be tested with
// fixtures and run as a dry run without a database connection.

import type { NormalizedOrganization, ProviderRequest } from "./provider.js";

export interface CandidateSubject {
  subject_type: "party" | "creditor";
  subject_id: string;
  legal_name: string;
  kind: "person" | "organization";
  is_individual: boolean;
  enrichment_allowed: boolean;
  /** Count of confirmed court-record assertions naming this entity. */
  confirmed_assertions: number;
  /** Reviewer-confirmed domain, or null. */
  domain: string | null;
  firm_id: string;
  case_id: string;
}

export interface ProviderState {
  provider_key: string;
  enabled: boolean;
  credential_configured: boolean;
  daily_cap: number;
  used_today: number;
  allowed_entity_kinds: string[];
}

export interface PriorLookup {
  provider_key: string;
  domain: string;
  retrieved_at: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export const DEDUP_WINDOW_DAYS = 30;

export function checkEligibility(s: CandidateSubject, p: ProviderState, priors: PriorLookup[], now = new Date()): EligibilityResult {
  const reasons: string[] = [];
  if (s.kind !== "organization" || s.is_individual) reasons.push("subject is an individual; individuals are never enriched");
  if (!p.allowed_entity_kinds.includes("organization")) reasons.push("provider is not configured for organizations");
  if (!s.enrichment_allowed) reasons.push("creditor row has enrichment_allowed = false (opt-in required)");
  if (s.confirmed_assertions < 1) reasons.push("no reviewer-confirmed court-record assertion names this organization yet");
  if (!s.domain) reasons.push("no reviewer-confirmed domain; name-only lookups are not sent");
  if (!p.enabled) reasons.push(`provider ${p.provider_key} is disabled`);
  if (!p.credential_configured) reasons.push(`provider credential ${p.provider_key} is not configured`);
  if (p.used_today >= p.daily_cap) reasons.push(`daily cap reached (${p.used_today}/${p.daily_cap})`);
  if (s.domain) {
    const cutoff = now.getTime() - DEDUP_WINDOW_DAYS * 86400000;
    const dup = priors.find((x) => x.provider_key === p.provider_key && x.domain === s.domain!.toLowerCase() && new Date(x.retrieved_at).getTime() >= cutoff);
    if (dup) reasons.push(`duplicate: ${s.domain} was looked up on ${dup.retrieved_at.slice(0, 10)} (within ${DEDUP_WINDOW_DAYS} days); reuse the stored result`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export interface ProvenanceRecord {
  enrichment_result: {
    firm_id: string; subject_type: string; subject_id: string; provider_key: string;
    raw_response: unknown; normalized: NormalizedOrganization; provider_confidence: number | null; retrieved_at: string;
  };
  assertions: {
    firm_id: string; case_id: string; subject_type: string; subject_id: string; predicate: string; object_value: unknown;
    origin: "enriched"; confidence: number; verification_status: "unverified";
  }[];
  audit_event: { firm_id: string; action: string; table_name: string; row_id: string; details: Record<string, unknown> };
}

/** Everything a provider result becomes: a raw+normalized result row, enriched assertions that can never be auto-confirmed, and an audit event naming the exact request. */
export function buildProvenance(s: CandidateSubject, request: ProviderRequest, raw: unknown, normalized: NormalizedOrganization, retrievedAt: string): ProvenanceRecord {
  const conf = normalized.provider_confidence ?? 0.5;
  const facts: [string, unknown][] = [
    ["domain", normalized.domain], ["website", normalized.website], ["industry", normalized.industry],
    ["headcount", normalized.headcount], ["headquarters", normalized.headquarters], ["linkedin_url", normalized.linkedin_url],
    ["founded_year", normalized.founded_year],
  ];
  return {
    enrichment_result: { firm_id: s.firm_id, subject_type: s.subject_type, subject_id: s.subject_id, provider_key: request.provider_key, raw_response: raw, normalized, provider_confidence: normalized.provider_confidence, retrieved_at: retrievedAt },
    assertions: facts.filter(([, v]) => v !== null && v !== undefined).map(([predicate, object_value]) => ({
      firm_id: s.firm_id, case_id: s.case_id, subject_type: s.subject_type, subject_id: s.subject_id, predicate, object_value,
      origin: "enriched" as const, confidence: Math.min(0.9, conf), verification_status: "unverified" as const,
    })),
    audit_event: {
      firm_id: s.firm_id, action: "enrichment.lookup", table_name: "enrichment_results", row_id: s.subject_id,
      details: { provider: request.provider_key, endpoint: request.endpoint, payload: request.payload, units: request.estimated_units },
    },
  };
}
