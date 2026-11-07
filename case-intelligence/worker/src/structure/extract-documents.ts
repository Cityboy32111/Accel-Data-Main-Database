// Structure stage: page-by-page LLM extraction through the Edge Function, a
// grounding check on every assertion, then persistence with citations.

import type { WorkerConfig } from "../config.js";
import type { IngestClient } from "../ingest-client.js";
import { groundQuote } from "./grounding.js";

export interface PageExtractionOutput {
  parties?: { key: string; kind: "person" | "organization"; canonical_name: string; party_roles: string[]; aliases: string[] }[];
  creditors?: { party_key: string; creditor_type: string; claim_amount_asserted: number | null; claim_group: string | null; treatment_summary: string | null }[];
  attorneys?: { key: string; full_name: string; law_firm: string | null; represents_party_keys: string[] }[];
  properties?: { key: string; address: string; city: string | null; state: string | null; receiver_property_number: string | null; disposition: string }[];
  related_lawsuits?: { key: string; caption: string; court: string | null; docket_number: string | null; relationship: string }[];
  assertions?: {
    subject_type: "case" | "party" | "creditor" | "attorney" | "property" | "related_lawsuit";
    subject_key: string;
    predicate: string;
    object_value: unknown;
    object_type?: string | null;
    object_key?: string | null;
    quote: string;
    confidence: number;
    origin: "extracted" | "inferred";
  }[];
}

export interface ExtractPageResponse {
  output: PageExtractionOutput | null;
  skipped?: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  model: string;
  prompt_version: string;
  schema_version: string;
  stop_reason: string;
  page_text: string;
  document_title: string;
}

export interface GroundedPayload {
  grounded: number;
  rejected: number;
  rejectedQuotes: string[];
  assertions: (NonNullable<PageExtractionOutput["assertions"]>[number] & { page_number: number })[];
}

/**
 * Keep only assertions whose quote is found on the page. Confidence is capped
 * at 0.95 for machine output and scaled by the grounding penalty. Assertions
 * about entities the model did not declare are dropped as well.
 */
export function groundPageOutput(output: PageExtractionOutput, pageText: string, pageNumber: number): GroundedPayload {
  const declared = new Set<string>(["case:case"]);
  for (const p of output.parties ?? []) declared.add(`party:${p.key}`);
  for (const c of output.creditors ?? []) declared.add(`creditor:${c.party_key}`);
  for (const a of output.attorneys ?? []) declared.add(`attorney:${a.key}`);
  for (const pr of output.properties ?? []) declared.add(`property:${pr.key}`);
  for (const rl of output.related_lawsuits ?? []) declared.add(`related_lawsuit:${rl.key}`);

  const kept: GroundedPayload["assertions"] = [];
  const rejectedQuotes: string[] = [];
  for (const a of output.assertions ?? []) {
    const subjectKey = a.subject_type === "case" ? "case:case" : `${a.subject_type}:${a.subject_key}`;
    if (!declared.has(subjectKey)) {
      rejectedQuotes.push(`[undeclared subject ${subjectKey}] ${a.quote}`);
      continue;
    }
    if (a.object_type && a.object_key && !declared.has(`${a.object_type}:${a.object_key}`)) {
      a.object_type = null;
      a.object_key = null;
    }
    const g = groundQuote(pageText, a.quote ?? "");
    if (!g.ok) {
      rejectedQuotes.push(a.quote ?? "");
      continue;
    }
    const confidence = Math.min(0.95, Math.max(0, Number(a.confidence) || 0)) * g.penalty;
    kept.push({ ...a, confidence: Math.round(confidence * 10000) / 10000, page_number: pageNumber, quote: (a.quote ?? "").slice(0, 500) });
  }
  return { grounded: kept.length, rejected: rejectedQuotes.length, rejectedQuotes, assertions: kept };
}

export interface DocumentSummary {
  id: string;
  title: string;
  docket_number: string | null;
  page_count: number;
  processing_status: string;
}

export interface ExtractReport {
  documents: { id: string; title: string; pages_attempted: number; pages_skipped: number; grounded: number; rejected: number; input_tokens: number; output_tokens: number; failures: string[] }[];
  totals: { pages: number; grounded: number; rejected: number; input_tokens: number; output_tokens: number };
}

export async function extractDocuments(
  client: IngestClient,
  cfg: WorkerConfig,
  docs: DocumentSummary[],
  opts: { model: string; maxPagesPerDocument?: number; perDocumentMaxPages?: Map<string, number | undefined>; log?: (line: string) => void },
): Promise<ExtractReport> {
  const log = opts.log ?? ((l) => console.log(l));
  const report: ExtractReport = { documents: [], totals: { pages: 0, grounded: 0, rejected: 0, input_tokens: 0, output_tokens: 0 } };
  for (const doc of docs) {
    const entry = { id: doc.id, title: doc.title, pages_attempted: 0, pages_skipped: 0, grounded: 0, rejected: 0, input_tokens: 0, output_tokens: 0, failures: [] as string[] };
    const pages = Math.min(doc.page_count, opts.perDocumentMaxPages?.get(doc.id) ?? opts.maxPagesPerDocument ?? doc.page_count);
    for (let page = 1; page <= pages; page++) {
      try {
        const res = await client.json<ExtractPageResponse>({
          action: "extract_page",
          case_id: cfg.PIPELINE_CASE_ID,
          document_id: doc.id,
          page_number: page,
          model: opts.model,
        });
        if (!res.output) {
          entry.pages_skipped++;
          continue;
        }
        entry.pages_attempted++;
        entry.input_tokens += res.input_tokens;
        entry.output_tokens += res.output_tokens;
        const grounded = groundPageOutput(res.output, res.page_text, page);
        entry.grounded += grounded.grounded;
        entry.rejected += grounded.rejected;
        const result = await client.json<{ extraction_id: string; assertions_written: number; failures: string[] }>({
          action: "ingest_extraction",
          case_id: cfg.PIPELINE_CASE_ID,
          document_id: doc.id,
          model: res.model,
          prompt_version: res.prompt_version,
          schema_version: res.schema_version,
          page_from: page,
          page_to: page,
          input_tokens: res.input_tokens,
          output_tokens: res.output_tokens,
          latency_ms: res.latency_ms,
          raw_output: res.output,
          grounded_count: grounded.grounded,
          rejected_count: grounded.rejected,
          error: null,
          entities: {
            parties: res.output.parties ?? [],
            creditors: res.output.creditors ?? [],
            attorneys: res.output.attorneys ?? [],
            properties: res.output.properties ?? [],
            related_lawsuits: res.output.related_lawsuits ?? [],
          },
          assertions: grounded.assertions,
        });
        if (result.failures.length) entry.failures.push(...result.failures.map((f) => `p${page}: ${f}`));
        log(`  ${doc.title.slice(0, 60)} p${page}/${pages}: ${grounded.grounded} grounded, ${grounded.rejected} rejected, ${result.assertions_written} written (${res.input_tokens}+${res.output_tokens} tok)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        entry.failures.push(`p${page}: ${message}`);
        log(`  FAILED ${doc.title.slice(0, 60)} p${page}: ${message}`);
        if (/not configured|503/.test(message)) {
          report.documents.push(entry);
          return finalize(report);
        }
      }
    }
    report.documents.push(entry);
  }
  return finalize(report);
}

function finalize(report: ExtractReport): ExtractReport {
  for (const d of report.documents) {
    report.totals.pages += d.pages_attempted;
    report.totals.grounded += d.grounded;
    report.totals.rejected += d.rejected;
    report.totals.input_tokens += d.input_tokens;
    report.totals.output_tokens += d.output_tokens;
  }
  return report;
}
