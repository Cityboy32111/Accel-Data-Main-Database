// Lead Ocean adapter. The REST shape mirrors the Lead Ocean MCP surface the
// account already has (leadocean_get_company: one company by website domain,
// returning a leadocean.company.v1 record and costing one record). The base
// URL and auth header are configuration; until the live pilot is authorized
// the only transport is the dry-run one, which records requests and never
// sends them.

import { assertMinimumIdentifiers, type EnrichmentProvider, type NormalizedOrganization, type OrganizationIdentifiers, type ProviderRequest, type ProviderResponse } from "./provider.js";

export interface LeadOceanConfig {
  baseUrl: string;
  /** Name of the secret holding the key; the value is injected by the transport, never read here. */
  credentialSecretName: string;
}

export interface Transport {
  mode: "dry_run" | "live";
  fetchJson(url: string, init: { headers: Record<string, string> }): Promise<unknown>;
}

export class DryRunTransport implements Transport {
  mode = "dry_run" as const;
  recorded: { url: string; headers: Record<string, string> }[] = [];
  constructor(private readonly fixtures: Record<string, unknown> = {}) {}
  async fetchJson(url: string, init: { headers: Record<string, string> }): Promise<unknown> {
    this.recorded.push({ url, headers: { ...init.headers, authorization: "<redacted-in-dry-run>" } });
    const domain = new URL(url).searchParams.get("domain") ?? "";
    if (!(domain in this.fixtures)) throw new Error(`dry run: no fixture for ${domain}; no live request was sent`);
    return this.fixtures[domain];
  }
}

export class LeadOceanAdapter implements EnrichmentProvider {
  key = "leadocean";
  displayName = "Lead Ocean";
  constructor(private readonly cfg: LeadOceanConfig, private readonly transport: Transport) {}

  buildRequest(org: OrganizationIdentifiers): ProviderRequest {
    if (!org.domain) {
      throw new Error(`Lead Ocean company lookup needs a reviewer-confirmed domain for "${org.legal_name}"; name-only lookups are not sent`);
    }
    const payload = { domain: org.domain.toLowerCase() };
    assertMinimumIdentifiers(payload);
    return {
      provider_key: this.key,
      endpoint: `${this.cfg.baseUrl}/v1/companies/enrich`,
      payload,
      estimated_units: 1,
    };
  }

  async send(request: ProviderRequest): Promise<ProviderResponse> {
    const url = `${request.endpoint}?${new URLSearchParams(request.payload).toString()}`;
    const raw = await this.transport.fetchJson(url, {
      headers: { authorization: `Bearer <${this.cfg.credentialSecretName}>`, accept: "application/json" },
    });
    return { request, raw, normalized: this.normalize(raw), units_charged: this.transport.mode === "live" ? 1 : 0, retrieved_at: new Date().toISOString() };
  }

  normalize(raw: unknown): NormalizedOrganization {
    const r = (raw ?? {}) as { company_data?: Record<string, unknown>; company_metrics?: Record<string, unknown> };
    const d = r.company_data ?? {};
    const hq = (d.company_headquarters ?? d.headquarters ?? null) as Record<string, string> | null;
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
    const score = num(r.company_metrics?.completion_score);
    return {
      legal_name: (d.company_name as string) ?? null,
      domain: (d.company_domain as string) ?? null,
      website: (d.company_website as string) ?? (d.website as string) ?? null,
      industry: (d.company_industry as string) ?? (d.industry as string) ?? null,
      headcount: num(d.company_employees),
      headquarters: hq ? { city: hq.city ?? null, state: hq.state ?? null, country: hq.country ?? null } : null,
      linkedin_url: (d.company_linkedin_url as string) ?? null,
      founded_year: num(d.company_founded_year ?? d.founded_year),
      provider_confidence: score !== null ? Math.min(1, score / 100) : null,
    };
  }
}
