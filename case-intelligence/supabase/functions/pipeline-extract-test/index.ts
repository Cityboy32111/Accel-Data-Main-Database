// pipeline-extract-test: isolated, read-only test path for extraction changes.
//
// Same authentication as pipeline-ingest (worker token bound to one firm), but
// this function never writes: it reads a stored page, runs the version-2
// extractor, and returns the output to the caller. The production function
// pipeline-ingest is untouched by deployments of this slug.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { extractPage, EXTRACTION_PROMPT_VERSION, EXTRACTION_SCHEMA_VERSION } from "./extract-v2.ts";

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
function db(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!WORKER_TOKEN || WORKER_TOKEN.length < 32 || !WORKER_FIRM_ID) return json({ error: "not configured" }, 503);
  if (!constantTimeEqual(req.headers.get("x-worker-token") ?? "", WORKER_TOKEN)) return json({ error: "unauthorized" }, 401);
  try {
    const body = await req.json();
    if (body.action === "version") {
      return json({ prompt_version: EXTRACTION_PROMPT_VERSION, schema_version: EXTRACTION_SCHEMA_VERSION, writes: false });
    }
    if (body.action !== "extract_page") return json({ error: `unknown action ${body.action}` }, 400);
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY secret is missing" }, 503);
    if (!ALLOWED_MODELS.has(body.model)) return json({ error: `model not allowed: ${body.model}` }, 400);
    const client = db();
    const { data: cs } = await client.from("cases").select("id, firm_id, caption").eq("id", body.case_id).maybeSingle();
    if (!cs || cs.firm_id !== WORKER_FIRM_ID) return json({ error: "case is not in the firm this worker is bound to" }, 403);
    const { data: page, error } = await client
      .from("document_pages")
      .select("text, document_id, source_documents!inner(title, case_id)")
      .eq("document_id", body.document_id)
      .eq("page_number", body.page_number)
      .single();
    if (error || !page) return json({ error: `page not found: ${error?.message ?? ""}` }, 404);
    const sd = page.source_documents as unknown as { title: string; case_id: string };
    if (sd.case_id !== body.case_id) return json({ error: "document not in case" }, 400);
    if (!page.text || page.text.length < 40) return json({ output: null, skipped: "no text layer" });
    const result = await extractPage(ANTHROPIC_API_KEY, {
      model: body.model,
      case_caption: cs.caption,
      document_title: sd.title,
      page_number: body.page_number,
      page_text: page.text,
      max_tokens: body.max_tokens,
    });
    return json({ ...result, page_text: page.text, document_title: sd.title });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
