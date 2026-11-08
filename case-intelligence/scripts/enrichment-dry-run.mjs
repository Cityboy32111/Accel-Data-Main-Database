#!/usr/bin/env node
// Enrichment dry run for the pilot case. Reads candidate organizations and
// provider state (read-only), evaluates eligibility, and prints the exact
// provider payloads that WOULD be sent and the expected cost. Sends nothing.
//   node scripts/enrichment-dry-run.mjs [--limit 3]

import { runSql } from "./supabase-management.mjs";
import { checkEligibility } from "../worker/dist-resolve/enrich-controls.js";
import { DryRunTransport, LeadOceanAdapter } from "../worker/dist-resolve/enrich-leadocean.js";

const CASE = "0c000000-0000-4000-8000-000000000001";
const FIRM = "0f000000-0000-4000-8000-000000000001";
const limit = Number(process.argv[process.argv.indexOf("--limit") + 1] || 3);

const [prov] = await runSql(`select provider_key, enabled, credential_secret_name, daily_cap, allowed_entity_kinds::text[] as kinds from public.enrichment_providers where firm_id = '${FIRM}' and provider_key = 'leadocean'`);
const secretNames = JSON.parse(process.env.EDGE_SECRET_NAMES ?? "[]");
const providerState = {
  provider_key: "leadocean", enabled: prov?.enabled ?? false,
  credential_configured: secretNames.includes(prov?.credential_secret_name ?? "LEADOCEAN_API_KEY"),
  daily_cap: prov?.daily_cap ?? 0, used_today: 0, allowed_entity_kinds: prov?.kinds ?? [],
};
const rows = await runSql(`
  select cr.id as creditor_id, p.id as party_id, p.canonical_name, p.kind::text as kind, cr.is_individual, cr.enrichment_allowed, cr.creditor_type::text as creditor_type,
         (select count(*) from public.assertions a where a.subject_type in ('party','creditor') and a.subject_id in (p.id, cr.id) and a.verification_status = 'confirmed') as confirmed_assertions,
         (select count(*) from public.assertions a where a.subject_type in ('party','creditor') and a.subject_id in (p.id, cr.id)) as total_assertions
  from public.creditors cr join public.parties p on p.id = cr.party_id
  where cr.case_id = '${CASE}' and cr.creditor_type = 'institutional_lender'
  order by p.canonical_name`);
const priors = await runSql(`select ep.provider_key, er.normalized->>'domain' as domain, er.retrieved_at from public.enrichment_results er join public.enrichment_providers ep on ep.id = er.provider_id where er.firm_id = '${FIRM}'`);

console.log("provider state:", providerState);
console.log(`institutional-lender creditor rows in the pilot case: ${rows.length}`);
const adapter = new LeadOceanAdapter({ baseUrl: "https://api.leadocean.io", credentialSecretName: "LEADOCEAN_API_KEY" }, new DryRunTransport({}));
let units = 0;
for (const r of rows.slice(0, 50)) {
  const subject = { subject_type: "creditor", subject_id: r.creditor_id, legal_name: r.canonical_name, kind: r.kind, is_individual: r.is_individual, enrichment_allowed: r.enrichment_allowed, confirmed_assertions: Number(r.confirmed_assertions), domain: null, firm_id: FIRM, case_id: CASE };
  const e = checkEligibility(subject, providerState, priors.map((x) => ({ ...x, domain: x.domain ?? "" })));
  console.log(`\n${r.canonical_name}  (assertions ${r.total_assertions}, confirmed ${r.confirmed_assertions}, opt-in ${r.enrichment_allowed})`);
  console.log(`  eligible now: ${e.eligible}`);
  for (const reason of e.reasons) console.log(`   - ${reason}`);
  try {
    const req = adapter.buildRequest({ subject_id: r.creditor_id, subject_type: "creditor", legal_name: r.canonical_name, domain: null });
    console.log("  would send:", req.endpoint, req.payload);
    units += req.estimated_units;
  } catch (err) {
    console.log(`  payload: not buildable (${err.message.split(";")[0]})`);
  }
}
console.log(`\nexpected provider units for a ${limit}-organization pilot once domains are confirmed: ${limit} records (1 per company lookup); sent in this run: 0`);
