// Enrichment provider framework. Providers see only the minimum approved
// organization identifiers (legal name, website domain when a reviewer has
// confirmed it); nothing about the matter, the case, the claim or the filing
// ever enters a provider request. Individuals are never enrichment targets.

export interface OrganizationIdentifiers {
  /** Internal id, never sent to a provider. */
  subject_id: string;
  subject_type: "party" | "creditor";
  legal_name: string;
  /** Website domain confirmed by a reviewer; providers prefer it. */
  domain: string | null;
}

export interface ProviderRequest {
  provider_key: string;
  endpoint: string;
  /** The exact payload that would leave the system. Must contain only approved identifiers. */
  payload: Record<string, string>;
  /** Provider units consumed by this request (Lead Ocean meters "records"). */
  estimated_units: number;
}

export interface NormalizedOrganization {
  legal_name: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  headcount: number | null;
  headquarters: { city: string | null; state: string | null; country: string | null } | null;
  linkedin_url: string | null;
  founded_year: number | null;
  provider_confidence: number | null;
}

export interface ProviderResponse {
  request: ProviderRequest;
  raw: unknown;
  normalized: NormalizedOrganization;
  units_charged: number;
  retrieved_at: string;
}

export interface EnrichmentProvider {
  key: string;
  displayName: string;
  /** Build the outbound request without sending it. */
  buildRequest(org: OrganizationIdentifiers): ProviderRequest;
  /** Send a previously built request. Throws in dry-run transports. */
  send(request: ProviderRequest): Promise<ProviderResponse>;
  /** Map a raw provider record to the normalized shape. */
  normalize(raw: unknown): NormalizedOrganization;
}

export const FORBIDDEN_PAYLOAD_KEYS = /case|docket|claim|matter|filing|receiver|court|amount|plaintiff|defendant|lender|note|comment|person|individual|email|phone/i;

/** Static guard: a provider payload may carry only name and domain style identifiers. */
export function assertMinimumIdentifiers(payload: Record<string, string>): void {
  const allowed = new Set(["name", "domain", "linkedin_url", "website"]);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key) || FORBIDDEN_PAYLOAD_KEYS.test(key)) {
      throw new Error(`provider payload key not allowed: ${key}`);
    }
    if (FORBIDDEN_PAYLOAD_KEYS.test(payload[key] ?? "") && key === "name" && /\b(case|docket|claim)\b/i.test(payload[key])) {
      throw new Error(`provider payload value looks like matter data: ${key}`);
    }
  }
}
