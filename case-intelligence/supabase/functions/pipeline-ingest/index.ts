// pipeline-ingest: the only component that holds the service-role key.
//
// Runs inside Supabase Edge Functions where SUPABASE_SERVICE_ROLE_KEY is a
// managed secret. Callers authenticate with a scoped worker token
// (PIPELINE_WORKER_TOKEN secret) that is bound to one firm
// (PIPELINE_WORKER_FIRM_ID secret). Every write is therefore limited to that
// firm, the service-role key never leaves this runtime, and rotating the
// worker token revokes the pipeline without touching any other credential.
//
// Actions (POST, header x-worker-token):
//   multipart/form-data  action=ingest_document  metadata=<json>  file=<pdf>
//   application/json     { action: "recompute_coverage", case_id, documents_known }
//   application/json     { action: "ingest_extraction", ... }   (Milestone 3)
//   application/json     { action: "status", case_id }

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { extractPage } from "./extract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_TOKEN = Deno.env.get("PIPELINE_WORKER_TOKEN") ?? "";
const WORKER_FIRM_ID = Deno.env.get("PIPELINE_WORKER_FIRM_ID") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ALLOWED_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorize(req: Request): Response | null {
  if (!WORKER_TOKEN || WORKER_TOKEN.length < 32 || !WORKER_FIRM_ID) {
    return json({ error: "pipeline-ingest is not configured (worker token or firm binding missing)" }, 503);
  }
  const presented = req.headers.get("x-worker-token") ?? "";
  if (!constantTimeEqual(presented, WORKER_TOKEN)) return json({ error: "unauthorized" }, 401);
  return null;
}

function db(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;

interface PageIn {
  page_number: number;
  text: string;
  text_method: "text_layer" | "ocr" | "none";
  pii_masked: boolean;
}

interface DocumentMetadata {
  case_id: string;
  source_id: string;
  original_url: string;
  sha256: string;
  title: string;
  document_category: string;
  docket_number: string | null;
  docket_suffix: string | null;
  filed_date: string | null;
  page_count: number;
  restriction_flags: string[];
  halted: boolean;
  screening_notes: string | null;
  pages: PageIn[];
}

async function assertCaseInFirm(client: SupabaseClient, caseId: string): Promise<Response | null> {
  if (!UUID.test(caseId)) return json({ error: "case_id must be a uuid" }, 400);
  const { data, error } = await client.from("cases").select("id, firm_id").eq("id", caseId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data || data.firm_id !== WORKER_FIRM_ID) return json({ error: "case is not in the firm this worker is bound to" }, 403);
  return null;
}

async function ingestDocument(client: SupabaseClient, meta: DocumentMetadata, file: Uint8Array): Promise<Response> {
  const denied = await assertCaseInFirm(client, meta.case_id);
  if (denied) return denied;
  if (!SHA.test(meta.sha256)) return json({ error: "sha256 malformed" }, 400);
  const digest = await crypto.subtle.digest("SHA-256", file);
  const actual = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (actual !== meta.sha256) return json({ error: "sha256 does not match uploaded bytes" }, 400);
  if (!(file[0] === 0x25 && file[1] === 0x50 && file[2] === 0x44 && file[3] === 0x46)) {
    return json({ error: "file is not a PDF" }, 400);
  }

  const existing = await client
    .from("source_documents")
    .select("id")
    .eq("case_id", meta.case_id)
    .eq("sha256", meta.sha256)
    .maybeSingle();
  if (existing.error) return json({ error: existing.error.message }, 500);
  if (existing.data) return json({ document_id: existing.data.id, skipped: "already acquired" });

  const storagePath = `${WORKER_FIRM_ID}/${meta.case_id}/${meta.sha256}.pdf`;
  const up = await client.storage.from("source-documents").upload(storagePath, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (up.error && !/already exists|Duplicate/i.test(up.error.message)) {
    return json({ error: `storage: ${up.error.message}` }, 500);
  }

  const { data: doc, error: docErr } = await client
    .from("source_documents")
    .insert({
      firm_id: WORKER_FIRM_ID,
      case_id: meta.case_id,
      source_id: meta.source_id,
      original_url: meta.original_url,
      storage_path: storagePath,
      sha256: meta.sha256,
      byte_size: file.byteLength,
      title: meta.title,
      document_category: meta.document_category,
      docket_number: meta.docket_number,
      docket_suffix: meta.docket_suffix,
      filed_date: meta.filed_date,
      page_count: meta.page_count,
      processing_status: meta.halted ? "halted_restricted" : "text_extracted",
      restriction_flags: meta.restriction_flags ?? [],
      screening_notes: meta.screening_notes,
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (docErr) return json({ error: `source_documents: ${docErr.message}` }, 500);

  let pagesWritten = 0;
  if (!meta.halted && Array.isArray(meta.pages)) {
    const rows = meta.pages.map((p) => ({
      firm_id: WORKER_FIRM_ID,
      document_id: doc.id,
      page_number: p.page_number,
      text: p.text,
      text_method: p.text_method,
      pii_masked: p.pii_masked,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      const { error } = await client.from("document_pages").upsert(slice, { onConflict: "document_id,page_number" });
      if (error) return json({ error: `document_pages: ${error.message}`, document_id: doc.id }, 500);
      pagesWritten += slice.length;
    }
  }
  await client.rpc("recompute_case_coverage", { p_case_id: meta.case_id, p_documents_known: null });
  return json({ document_id: doc.id, storage_path: storagePath, pages_written: pagesWritten, halted: meta.halted });
}

interface ExtractionIn {
  case_id: string;
  document_id: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  page_from: number;
  page_to: number;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  raw_output: unknown;
  grounded_count: number;
  rejected_count: number;
  error: string | null;
  entities: {
    parties: { key: string; kind: "person" | "organization"; canonical_name: string; party_roles: string[]; aliases: string[] }[];
    creditors: { party_key: string; creditor_type: string; claim_amount_asserted: number | null; claim_group: string | null; treatment_summary: string | null }[];
    attorneys: { key: string; full_name: string; law_firm: string | null; represents_party_keys: string[] }[];
    properties: { key: string; address: string; city: string | null; state: string | null; receiver_property_number: string | null; disposition: string }[];
    related_lawsuits: { key: string; caption: string; court: string | null; docket_number: string | null; relationship: string }[];
  };
  assertions: {
    subject_type: "case" | "party" | "creditor" | "attorney" | "property" | "related_lawsuit";
    subject_key: string;
    predicate: string;
    object_value: unknown;
    object_type?: "party" | "creditor" | "attorney" | "property" | "related_lawsuit" | null;
    object_key?: string | null;
    page_number: number;
    quote: string;
    confidence: number;
    origin: "extracted" | "inferred";
  }[];
}

/**
 * Persist one extraction call: entity rows are matched within the case by
 * normalized name (so a party seen in an earlier document is reused rather than
 * duplicated), then assertions are written with their page citations. Entity
 * resolution proper (Milestone 4) refines these matches; this keeps the raw
 * evidence intact either way.
 */
async function ingestExtraction(client: SupabaseClient, body: ExtractionIn): Promise<Response> {
  const denied = await assertCaseInFirm(client, body.case_id);
  if (denied) return denied;
  const { data: doc } = await client
    .from("source_documents")
    .select("id, case_id, page_count")
    .eq("id", body.document_id)
    .maybeSingle();
  if (!doc || doc.case_id !== body.case_id) return json({ error: "document not in case" }, 400);

  const { data: extraction, error: exErr } = await client
    .from("extractions")
    .insert({
      firm_id: WORKER_FIRM_ID,
      document_id: body.document_id,
      page_from: body.page_from,
      page_to: body.page_to,
      model: body.model,
      prompt_version: body.prompt_version,
      schema_version: body.schema_version,
      input_tokens: body.input_tokens,
      output_tokens: body.output_tokens,
      latency_ms: body.latency_ms,
      raw_output: body.raw_output,
      grounded_count: body.grounded_count,
      rejected_count: body.rejected_count,
      error: body.error,
    })
    .select("id")
    .single();
  if (exErr) return json({ error: `extractions: ${exErr.message}` }, 500);

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ids = new Map<string, { type: string; id: string }>();

  // Parties
  for (const p of body.entities.parties ?? []) {
    const { data: found } = await client
      .from("parties")
      .select("id, party_roles, aliases")
      .eq("case_id", body.case_id)
      .eq("normalized_name", norm(p.canonical_name))
      .maybeSingle();
    if (found) {
      const roles = Array.from(new Set([...(found.party_roles ?? []), ...p.party_roles]));
      const aliases = Array.from(new Set([...(found.aliases ?? []), ...p.aliases]));
      await client.from("parties").update({ party_roles: roles, aliases }).eq("id", found.id);
      ids.set(`party:${p.key}`, { type: "party", id: found.id });
      continue;
    }
    const { data: created, error } = await client
      .from("parties")
      .insert({ firm_id: WORKER_FIRM_ID, case_id: body.case_id, kind: p.kind, canonical_name: p.canonical_name, party_roles: p.party_roles, aliases: p.aliases })
      .select("id")
      .single();
    if (error) return json({ error: `parties: ${error.message}` }, 500);
    ids.set(`party:${p.key}`, { type: "party", id: created.id });
  }

  // Creditors
  for (const c of body.entities.creditors ?? []) {
    const party = ids.get(`party:${c.party_key}`);
    if (!party) continue;
    const { data: found } = await client.from("creditors").select("id").eq("case_id", body.case_id).eq("party_id", party.id).maybeSingle();
    if (found) {
      ids.set(`creditor:${c.party_key}`, { type: "creditor", id: found.id });
      continue;
    }
    const { data: created, error } = await client
      .from("creditors")
      .insert({ firm_id: WORKER_FIRM_ID, case_id: body.case_id, party_id: party.id, creditor_type: c.creditor_type, claim_amount_asserted: c.claim_amount_asserted, claim_group: c.claim_group, treatment_summary: c.treatment_summary })
      .select("id")
      .single();
    if (error) return json({ error: `creditors: ${error.message}` }, 500);
    ids.set(`creditor:${c.party_key}`, { type: "creditor", id: created.id });
  }

  // Attorneys
  for (const a of body.entities.attorneys ?? []) {
    const { data: found } = await client.from("attorneys").select("id, represents_party_ids").eq("case_id", body.case_id).ilike("full_name", a.full_name).maybeSingle();
    const represents = (a.represents_party_keys ?? []).map((k) => ids.get(`party:${k}`)?.id).filter((x): x is string => !!x);
    if (found) {
      const merged = Array.from(new Set([...(found.represents_party_ids ?? []), ...represents]));
      await client.from("attorneys").update({ represents_party_ids: merged, law_firm: a.law_firm ?? undefined }).eq("id", found.id);
      ids.set(`attorney:${a.key}`, { type: "attorney", id: found.id });
      continue;
    }
    const { data: created, error } = await client
      .from("attorneys")
      .insert({ firm_id: WORKER_FIRM_ID, case_id: body.case_id, full_name: a.full_name, law_firm: a.law_firm, represents_party_ids: represents })
      .select("id")
      .single();
    if (error) return json({ error: `attorneys: ${error.message}` }, 500);
    ids.set(`attorney:${a.key}`, { type: "attorney", id: created.id });
  }

  // Properties
  for (const pr of body.entities.properties ?? []) {
    const { data: found } = await client.from("properties").select("id").eq("case_id", body.case_id).eq("normalized_address", norm(pr.address)).maybeSingle();
    if (found) {
      ids.set(`property:${pr.key}`, { type: "property", id: found.id });
      continue;
    }
    const { data: created, error } = await client
      .from("properties")
      .insert({ firm_id: WORKER_FIRM_ID, case_id: body.case_id, address: pr.address, city: pr.city, state: pr.state, receiver_property_number: pr.receiver_property_number, disposition: pr.disposition })
      .select("id")
      .single();
    if (error) return json({ error: `properties: ${error.message}` }, 500);
    ids.set(`property:${pr.key}`, { type: "property", id: created.id });
  }

  // Related lawsuits
  for (const rl of body.entities.related_lawsuits ?? []) {
    let q = client.from("related_lawsuits").select("id").eq("case_id", body.case_id);
    q = rl.docket_number ? q.eq("docket_number", rl.docket_number) : q.ilike("caption", rl.caption);
    const { data: found } = await q.maybeSingle();
    if (found) {
      ids.set(`related_lawsuit:${rl.key}`, { type: "related_lawsuit", id: found.id });
      continue;
    }
    const { data: created, error } = await client
      .from("related_lawsuits")
      .insert({ firm_id: WORKER_FIRM_ID, case_id: body.case_id, caption: rl.caption, court: rl.court, docket_number: rl.docket_number, relationship: rl.relationship })
      .select("id")
      .single();
    if (error) return json({ error: `related_lawsuits: ${error.message}` }, 500);
    ids.set(`related_lawsuit:${rl.key}`, { type: "related_lawsuit", id: created.id });
  }

  // Assertions
  let written = 0;
  const failures: string[] = [];
  for (const a of body.assertions ?? []) {
    const subject = a.subject_type === "case" ? { type: "case", id: body.case_id } : ids.get(`${a.subject_type}:${a.subject_key}`);
    if (!subject) {
      failures.push(`unknown subject ${a.subject_type}:${a.subject_key}`);
      continue;
    }
    const object = a.object_type && a.object_key ? ids.get(`${a.object_type}:${a.object_key}`) : null;
    const { error } = await client.from("assertions").insert({
      firm_id: WORKER_FIRM_ID,
      case_id: body.case_id,
      subject_type: a.subject_type,
      subject_id: subject.id,
      predicate: a.predicate,
      object_value: a.object_value,
      object_type: object ? a.object_type : null,
      object_id: object ? object.id : null,
      source_document_id: body.document_id,
      page_number: a.page_number,
      quote: a.quote.slice(0, 500),
      confidence: a.confidence,
      origin: a.origin,
      extraction_id: extraction.id,
    });
    if (error) failures.push(`${a.predicate}: ${error.message}`);
    else written++;
  }
  await client.from("source_documents").update({ processing_status: "structured", processed_at: new Date().toISOString() }).eq("id", body.document_id);
  await client.rpc("recompute_case_coverage", { p_case_id: body.case_id, p_documents_known: null });
  return json({ extraction_id: extraction.id, assertions_written: written, failures, entity_ids: Object.fromEntries(ids) });
}

async function status(client: SupabaseClient, caseId: string): Promise<Response> {
  const denied = await assertCaseInFirm(client, caseId);
  if (denied) return denied;
  const count = async (table: string) => {
    const { count: n } = await client.from(table).select("id", { count: "exact", head: true }).eq("case_id", caseId);
    return n ?? 0;
  };
  const { count: pages } = await client
    .from("document_pages")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", WORKER_FIRM_ID);
  const { data: cov } = await client.rpc("case_coverage", { p_case_id: caseId });
  return json({
    documents: await count("source_documents"),
    pages: pages ?? 0,
    parties: await count("parties"),
    creditors: await count("creditors"),
    attorneys: await count("attorneys"),
    properties: await count("properties"),
    related_lawsuits: await count("related_lawsuits"),
    assertions: await count("assertions"),
    review_tasks: await count("review_tasks"),
    coverage: cov,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const denied = authorize(req);
  if (denied) return denied;
  const client = db();
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const action = String(form.get("action") ?? "");
      if (action !== "ingest_document") return json({ error: `unknown multipart action ${action}` }, 400);
      const meta = JSON.parse(String(form.get("metadata") ?? "{}")) as DocumentMetadata;
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "file missing" }, 400);
      return await ingestDocument(client, meta, new Uint8Array(await file.arrayBuffer()));
    }
    const body = await req.json();
    switch (body.action) {
      case "recompute_coverage": {
        const denied2 = await assertCaseInFirm(client, body.case_id);
        if (denied2) return denied2;
        const { data, error } = await client.rpc("recompute_case_coverage", {
          p_case_id: body.case_id,
          p_documents_known: body.documents_known ?? null,
        });
        if (error) return json({ error: error.message }, 500);
        return json({ coverage: data });
      }
      case "ingest_extraction":
        return await ingestExtraction(client, body as ExtractionIn);
      case "extract_page": {
        if (!ANTHROPIC_API_KEY) return json({ error: "extraction is not configured: ANTHROPIC_API_KEY secret is missing" }, 503);
        const denied2 = await assertCaseInFirm(client, body.case_id);
        if (denied2) return denied2;
        if (!ALLOWED_MODELS.has(body.model)) return json({ error: `model not allowed: ${body.model}` }, 400);
        // The page text comes from the database, never from the caller, so a
        // compromised worker token cannot spend tokens on arbitrary input.
        const { data: page, error: pageErr } = await client
          .from("document_pages")
          .select("text, document_id, source_documents!inner(title, case_id)")
          .eq("document_id", body.document_id)
          .eq("page_number", body.page_number)
          .single();
        if (pageErr || !page) return json({ error: `page not found: ${pageErr?.message ?? ""}` }, 404);
        const sd = page.source_documents as unknown as { title: string; case_id: string };
        if (sd.case_id !== body.case_id) return json({ error: "document not in case" }, 400);
        if (!page.text || page.text.length < 40) return json({ output: null, skipped: "no text layer" });
        const { data: cs } = await client.from("cases").select("caption").eq("id", body.case_id).single();
        const result = await extractPage(ANTHROPIC_API_KEY, {
          model: body.model,
          case_caption: cs?.caption ?? "",
          document_title: sd.title,
          page_number: body.page_number,
          page_text: page.text,
          max_tokens: body.max_tokens,
        });
        return json({ ...result, page_text: page.text, document_title: sd.title });
      }
      case "list_documents": {
        const denied2 = await assertCaseInFirm(client, body.case_id);
        if (denied2) return denied2;
        const { data, error } = await client
          .from("source_documents")
          .select("id, title, docket_number, docket_suffix, filed_date, document_category, page_count, processing_status, restriction_flags")
          .eq("case_id", body.case_id)
          .order("filed_date", { ascending: true });
        if (error) return json({ error: error.message }, 500);
        return json({ documents: data });
      }
      case "status":
        return await status(client, body.case_id);
      default:
        return json({ error: `unknown action ${body.action}` }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
