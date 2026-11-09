// Bounded regression retest: run the version-2 extractor on a fixed page list
// through the read-only pipeline-extract-test function, ground and lint the
// output locally, and write everything to fixtures. Nothing is written to the
// database and the production function is not called.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkerConfig } from "../config.js";
import { groundQuote } from "../structure/grounding.js";
import { classifyLawsuit, lintAssertion } from "../structure/modality-lint.js";

/** Estate party names used to tell appeals from this receivership apart from precedent about strangers. */
/** The receivership case itself: its docket, its caption and the court that decides it. */
export const MAIN_CASE = { docket: /18[\s-]*cv[\s-]*0?5587/i, caption: /\bsec\s+v\.\s+equitybuild/i, court: /\bn\.\s?d\.\s?ill\b/i };
/** An appellate reporter or court marker; a decision carrying one is not the district court's own order. */
export const APPELLATE_CITE = /\d+\s+f\.\s?(2d|3d|4th)\s+\d+|fed\.\s?app\'?x|\bcir\.|circuit/i;
export const ESTATE_NAMES = ["equitybuild", "cohen", "duff", "receiver", "4533-37 s calumet", "wpd management", "shatar", "bc57", "amark"];

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
  reclassified: Reclassification[];
  page_text: string;
}

/** Page-level coverage warnings that are not about a single assertion. */
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The model occasionally returns an object or null where the schema says array; coerce before use. */
export function coerceOutput(raw: Partial<V2Output> | null | undefined): V2Output {
  const o = raw ?? {};
  return {
    page_kind: typeof o.page_kind === "string" ? o.page_kind : "body",
    parties: arr(o.parties), creditors: arr(o.creditors), attorneys: arr(o.attorneys), properties: arr(o.properties),
    related_lawsuits: arr(o.related_lawsuits), authorities: arr(o.authorities), assertions: arr(o.assertions),
  };
}

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

export interface Reclassification { key: string; caption: string; from: string; to: string; reason: string }

/**
 * Move related lawsuits that are really cited authorities into output.authorities,
 * and flag appeals identified only by reporter citations. Returns the list of
 * moves so the bundle records what changed and why.
 */
export const POSTPROCESS_VERSION = "2026-11-09.3";

export function reclassifyLawsuits(output: V2Output, estateNames: string[] = ESTATE_NAMES): Reclassification[] {
  const moves: Reclassification[] = [];
  const keep: V2Output["related_lawsuits"] = [];
  // Reverse direction: an "authority" whose caption names an estate party is an appeal or
  // action from this receivership that the model filed as precedent. Promote it to a related
  // lawsuit held for review, so appeals such as SEC v. EquityBuild, 101 F.4th 526 are not lost.
  const remainingAuthorities: V2Output["authorities"] = [];
  let promoted = 0;
  for (const a of output.authorities ?? []) {
    const cite = a.citation ?? "";
    const lower = cite.toLowerCase();
    const namesEstate = estateNames.some((n) => n && lower.includes(n.toLowerCase()));
    const m = cite.match(/(\d+\s+F\.\s?(?:2d|3d|4th)\s+\d+|\d{4}\s+WL\s+\d+|No\.\s*[\w:-]+[\s\w-]*?\d)/i);
    const citeKey = (m ? m[1] : cite).replace(/\s+/g, " ").trim().toLowerCase();
    // A decision of the main case itself is not a related proceeding: its own docket number,
    // or the main-case caption decided by the receivership court with no appellate reporter
    // (SEC v. EquityBuild, Inc., 2024 WL 3069682 (N.D. Ill. June 20, 2024) is Dkt. 1679).
    const isMainCaseDecision = MAIN_CASE.docket.test(cite)
      || (MAIN_CASE.caption.test(cite) && MAIN_CASE.court.test(cite) && !APPELLATE_CITE.test(cite));
    const alreadyListed = (output.related_lawsuits ?? []).some((r) => (r.docket_number ?? "").replace(/\s+/g, " ").trim().toLowerCase() === citeKey);
    if (namesEstate && !alreadyListed && !isMainCaseDecision && /\bv\.(?=\s)/.test(lower)) {
      const key = `promoted_${++promoted}`;
      const caption = cite.split(/,\s*(?=\d)/)[0].trim();
      output.related_lawsuits.push({ key, caption, court: /7th cir|seventh circuit/i.test(cite) ? "7th Cir." : null, docket_number: m ? m[1].trim() : null, relationship: /cir\./i.test(cite) ? "appeal" : "other" });
      moves.push({ key, caption, from: "authority", to: "related_lawsuit (review)", reason: "cited as precedent but the caption names an estate party; appeal or action from this receivership" });
      continue;
    }
    remainingAuthorities.push(a);
  }
  output.authorities = remainingAuthorities;
  for (const rl of output.related_lawsuits ?? []) {
    const c = classifyLawsuit(rl, estateNames);
    if (c.classification === "authority") {
      output.authorities.push({ citation: `${rl.caption}${rl.docket_number ? ", " + rl.docket_number : ""}${rl.court ? " (" + rl.court + ")" : ""}` });
      moves.push({ key: rl.key, caption: rl.caption, from: "related_lawsuit", to: "authority", reason: c.reason });
      continue;
    }
    if (c.classification === "proceeding_review") moves.push({ key: rl.key, caption: rl.caption, from: "related_lawsuit", to: "related_lawsuit (review)", reason: c.reason });
    keep.push(rl);
  }
  output.related_lawsuits = keep;
  const seen = new Set<string>();
  return moves.filter((m) => { const k = `${m.key}|${m.to}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function processOutput(output: V2Output, pageText: string, moves: Reclassification[] = []): { assertions: ProcessedAssertion[]; dropped: { quote: string; reason: string }[] } {
  const authorityKeys = new Set(moves.filter((m) => m.to === "authority").map((m) => m.key));
  const reviewKeys = new Set(moves.filter((m) => m.to !== "authority").map((m) => m.key));
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
    if (a.subject_type === "related_lawsuit" && authorityKeys.has(a.subject_key)) {
      dropped.push({ quote: a.quote, reason: `subject is a cited authority, not a proceeding (${a.subject_key})` });
      continue;
    }
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
    const extraFlags = a.subject_type === "related_lawsuit" && reviewKeys.has(a.subject_key)
      ? [`authority_check: ${moves.find((m) => m.key === a.subject_key)?.reason ?? "review"}`] : [];
    const proceedingFlags = a.proceeding?.scope === "related_lawsuit" && a.proceeding.related_lawsuit_key && authorityKeys.has(a.proceeding.related_lawsuit_key)
      ? ["proceeding_is_authority: the proceeding this fact points at is a cited authority"] : [];
    kept.push({
      ...a,
      modality: lint.modality,
      grounded: true,
      grounding_method: g.method,
      lint_flags: [...lint.flags, ...extraFlags, ...proceedingFlags],
      needs_review: lint.needs_review || extraFlags.length > 0 || proceedingFlags.length > 0,
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
    const output = coerceOutput(body.output as Partial<V2Output> | null);
    if (!body.output) log(`  note: ${p.key} p${p.page} returned no tool output; recorded as empty`);
    const moves = reclassifyLawsuits(output);
    const { assertions, dropped } = processOutput(output, body.page_text, moves);
    const bundle: RetestBundle = {
      key: p.key, page: p.page, document: p.document, document_id: doc.id,
      model: body.model, prompt_version: body.prompt_version, schema_version: body.schema_version,
      input_tokens: body.input_tokens, output_tokens: body.output_tokens, latency_ms: body.latency_ms,
      page_kind: output.page_kind, output, assertions, dropped, warnings: pageWarnings(output), reclassified: moves, page_text: body.page_text,
    };
    totals.input_tokens += body.input_tokens;
    totals.output_tokens += body.output_tokens;
    await writeFile(outPath, JSON.stringify(bundle, null, 1));
    bundles.push(bundle);
    log(`${p.key} p${p.page} [${output.page_kind}]: ${assertions.length} grounded, ${dropped.length} dropped, ${assertions.filter((a) => a.needs_review).length} flagged (${body.input_tokens}+${body.output_tokens} tok)`);
  }
  return { bundles, totals };
}

/** Re-run post-processing (reclassification, grounding, lint) over saved bundles whose raw model output is kept. */
export async function reprocessDir(dir: string, log: (l: string) => void = console.log): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  for (const f of (await readdir(dir)).filter((x) => /-p\d{3}\.json$/.test(x)).sort()) {
    const full = path.join(dir, f);
    const b = JSON.parse(await readFile(full, "utf8")) as RetestBundle & { raw_output?: V2Output; postprocess_version?: string };
    const raw = b.raw_output ?? b.output; // first reprocess keeps the model output as raw_output
    const output = coerceOutput(JSON.parse(JSON.stringify(raw)));
    const moves = reclassifyLawsuits(output);
    const { assertions, dropped } = processOutput(output, b.page_text, moves);
    const next = { ...b, raw_output: raw, output, assertions, dropped, warnings: pageWarnings(output), reclassified: moves, postprocess_version: POSTPROCESS_VERSION };
    await writeFile(full, JSON.stringify(next, null, 1));
    log(`${f}: ${assertions.length} assertions, ${dropped.length} dropped, ${moves.length} reclassified (${moves.map((m) => m.to).join(", ")})`);
  }
}