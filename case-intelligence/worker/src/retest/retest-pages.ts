// Bounded regression retest: run the version-2 extractor on a fixed page list
// through the read-only pipeline-extract-test function, ground and lint the
// output locally, and write everything to fixtures. Nothing is written to the
// database and the production function is not called.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkerConfig } from "../config.js";
import { groundQuote } from "../structure/grounding.js";
import { lintAssertion } from "../structure/modality-lint.js";

export interface RetestPage {
  key: string;
  page: number;
  document: string;
  title_prefix: string;
}

export interface V2Assertion {
  subject_type: string;
  subject_key: string;
  predicate: string;
  object_value: unknown;
  object_type: string | null;
  object_key: string | null;
  modality: string;
  conditions: string | null;
  proceeding: { scope: string; related_lawsuit_key: string | null };
  as_of_date: string | null;
  referenced_page: number | null;
  quote: string;
  confidence: number;
  origin: string;
}

export interface V2Output {
  page_kind: string;
  parties: { key: string; kind: string; canonical_name: string; party_roles: string[]; aliases: string[] }[];
  creditors: { party_key: string; creditor_type: string; claim_amount_asserted: number | null; claim_group: string | null; treatment_summary: string | null }[];
  attorneys: { key: string; full_name: string; law_firm: string | null; law_firm_party_key: string | null; represents_party_keys: string[] }[];
  properties: { key: string; address: string; city: string | null; state: string | null; receiver_property_number: string | null; disposition: string }[];
  related_lawsuits: { key: string; caption: string; court: string | null; docket_number: string | null; relationship: string }[];
  authorities: { citation: string }[];
  assertions: V2Assertion[];
}

export interface ProcessedAssertion extends V2Assertion {
  grounded: boolean;
  grounding_method: string;
  lint_flags: string[];
  needs_review: boolean;
  final_confidence: number;
  subject_label: string;
  proceeding_label: string;
}

export interface RetestBundle {
  key: string;
  page: number;
  document: string;
  document_id: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  page_kind: string;
  output: V2Output;
  assertions: ProcessedAssertion[];
  dropped: { quote: string; reason: string }[];
  warnings: string[];
  page_text: string;
}

/** Page-level coverage warnings that are not about a single assertion. */
export function pageWarnings(output: V2Output): string[] {
  const warnings: string[] = [];
  const creditorKeys = new Set((output.creditors ?? []).map((c) => c.party_key));
  for (const p of output.parties ?? []) {
    if (p.party_roles.includes("lender") && !creditorKeys.has(p.key)) {
      warnings.push(`lender_not_creditor: ${p.canonical_name} has role lender but no creditor entry`);
    }
  }
  return warnings;
}

export function processOutput(output: V2Output, pageText: string): { assertions: ProcessedAssertion[]; dropped: { quote: string; reason: string }[] } {
  const labels = new Map<string, string>([["case:case", "(main case)"]]);
  for (const p of output.parties ?? []) labels.set(`party:${p.key}`, p.canonical_name);
  for (const c of output.creditors ?? []) labels.set(`creditor:${c.party_key}`, labels.get(`party:${c.party_key}`) ?? c.party_key);
  for (const a of output.attorneys ?? []) labels.set(`attorney:${a.key}`, a.full_name);
  for (const pr of output.properties ?? []) labels.set(`property:${pr.key}`, pr.address);
  for (const rl of output.related_lawsuits ?? []) labels.set(`related_lawsuit:${rl.key}`, rl.caption);

  const kept: ProcessedAssertion[] = [];
  const dropped: { quote: string; reason: string }[] = [];
  for (const a of output.assertions ?? []) {
    const subjectKey = a.subject_type === "case" ? "case:case" : `${a.subject_type}:${a.subject_key}`;
    if (!labels.has(subjectKey)) {
      dropped.push({ quote: a.quote, reason: `undeclared subject ${subjectKey}` });
      continue;
    }
    const g = groundQuote(pageText, a.quote ?? "");
    if (!g.ok) {
      dropped.push({ quote: a.quote, reason: "quote not found on page" });
      continue;
    }
    const lint = lintAssertion({
      modality: a.modality, predicate: a.predicate, quote: a.quote, object_value: a.object_value, conditions: a.conditions,
      page_kind: output.page_kind, subject_type: a.subject_type, proceeding: a.proceeding,
    });
    const relatedLabel = a.proceeding?.scope === "related_lawsuit" && a.proceeding.related_lawsuit_key
      ? labels.get(`related_lawsuit:${a.proceeding.related_lawsuit_key}`) ?? a.proceeding.related_lawsuit_key
      : "(main case)";
    const base = Math.min(0.95, Math.max(0, Number(a.confidence) || 0)) * g.penalty;
    kept.push({
      ...a,
      modality: lint.modality,
      grounded: true,
      grounding_method: g.method,
      lint_flags: lint.flags,
      needs_review: lint.needs_review,
      final_confidence: Math.round(base * lint.confidence_factor * 10000) / 10000,
      subject_label: labels.get(subjectKey) ?? subjectKey,
      proceeding_label: relatedLabel,
    });
  }
  return { assertions: kept, dropped };
}

export async function runRetest(
  cfg: WorkerConfig,
  pages: { key: string; page: number; document: string; title_prefix: string }[],
  documents: { id: string; title: string }[],
  opts: { model: string; outDir: string; functionUrl: string; log?: (l: string) => void },
): Promise<{ bundles: RetestBundle[]; totals: { input_tokens: number; output_tokens: number } }> {
  const log = opts.log ?? ((l) => console.log(l));
  await mkdir(opts.outDir, { recursive: true });
  const bundles: RetestBundle[] = [];
  const totals = { input_tokens: 0, output_tokens: 0 };
  for (const p of pages) {
    const doc = documents.find((d) => d.title.startsWith(p.title_prefix));
    if (!doc) throw new Error(`document not found for ${p.key}`);
    const outPath = path.join(opts.outDir, `${p.key}-p${String(p.page).padStart(3, "0")}.json`);
    try {
      const existing = JSON.parse(await readFile(outPath, "utf8")) as RetestBundle;
      log(`cached ${p.key} p${p.page} (${existing.assertions.length} assertions)`);
      bundles.push(existing);
      continue;
    } catch { /* not cached */ }
    const res = await fetch(opts.functionUrl, {
      method: "POST",
      headers: { "x-worker-token": cfg.PIPELINE_WORKER_TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ action: "extract_page", case_id: cfg.PIPELINE_CASE_ID, document_id: doc.id, page_number: p.page, model: opts.model }),
    });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(`extract ${p.key} p${p.page}: ${body.error ?? res.status}`);
    const output = body.output as V2Output;
    const { assertions, dropped } = processOutput(output, body.page_text);
    const bundle: RetestBundle = {
      key: p.key, page: p.page, document: p.document, document_id: doc.id,
      model: body.model, prompt_version: body.prompt_version, schema_version: body.schema_version,
      input_tokens: body.input_tokens, output_tokens: body.output_tokens, latency_ms: body.latency_ms,
      page_kind: output.page_kind, output, assertions, dropped, warnings: pageWarnings(output), page_text: body.page_text,
    };
    totals.input_tokens += body.input_tokens;
    totals.output_tokens += body.output_tokens;
    await writeFile(outPath, JSON.stringify(bundle, null, 1));
    bundles.push(bundle);
    log(`${p.key} p${p.page} [${output.page_kind}]: ${assertions.length} grounded, ${dropped.length} dropped, ${assertions.filter((a) => a.needs_review).length} flagged (${body.input_tokens}+${body.output_tokens} tok)`);
  }
  return { bundles, totals };
}
