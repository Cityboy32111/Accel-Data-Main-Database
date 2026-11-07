// Acquisition pipeline for the EquityBuild pilot.
//
//   plan     parse the receiver's index, record documents_known_at_source, print the subset
//   acquire  download the subset politely, hash, screen, extract text, store privately,
//            and write source_documents + document_pages
//
// Every stage is idempotent: a document already present for (firm, case, sha256)
// is skipped, and page rows are upserted on (document_id, page_number).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { WorkerConfig } from "../config.js";
import type { IngestClient } from "../ingest-client.js";
import { PoliteFetcher } from "../acquire/fetcher.js";
import {
  parseReceiverSiteIndex,
  selectSubset,
  summarizeBySection,
  type DocumentListing,
  type SubsetPlan,
  type SubsetSelection,
} from "../acquire/receiver-site.js";
import { extractPdfText } from "../extract/pdf-text.js";
import { maskPii, screenText } from "../screen/restrictions.js";

export interface SourceRow {
  id: string;
  firm_id: string;
  kind: string;
  base_url: string | null;
  status: string;
  restriction_markers: string[];
  min_delay_ms: number;
  store_copy: boolean;
}

export interface PlanResult {
  listings: DocumentListing[];
  sections: Record<string, number>;
  subset: SubsetSelection[];
}

export interface AcquireReport {
  attempted: number;
  stored: number;
  skippedExisting: number;
  halted: number;
  failed: { url: string; error: string }[];
}

export interface LocalDownload {
  listingKey: string;
  url: string;
  fileName: string;
  title: string;
  category: string;
  docketNumber: string | null;
  docketSuffix: string | null;
  filedDate: string | null;
  sha256: string;
  byteSize: number;
  pageCount: number;
  pagesNeedingOcr: number;
  restrictionFlags: string[];
  halting: boolean;
  localPath: string;
  matchedRule: string;
}

/**
 * Download, hash, screen and text-extract the subset into PIPELINE_DOWNLOAD_DIR
 * without touching the database. Files are named <listingKey>.pdf so a later
 * `acquire` run reuses them instead of fetching again. Writes manifest.json.
 */
export async function downloadSubset(
  cfg: WorkerConfig,
  fetcher: PoliteFetcher,
  subset: SubsetSelection[],
  restrictionMarkers: string[] | undefined,
  opts: { limit?: number; log?: (line: string) => void } = {},
): Promise<{ downloads: LocalDownload[]; failed: { url: string; error: string }[] }> {
  const log = opts.log ?? ((l) => console.log(l));
  await mkdir(cfg.PIPELINE_DOWNLOAD_DIR, { recursive: true });
  const manifestPath = path.join(cfg.PIPELINE_DOWNLOAD_DIR, "manifest.json");
  const existing = await readManifest(manifestPath);
  const downloads: LocalDownload[] = [...existing];
  const failed: { url: string; error: string }[] = [];
  const targets = opts.limit ? subset.slice(0, opts.limit) : subset;
  for (const item of targets) {
    if (existing.some((d) => d.listingKey === item.listingKey)) {
      log(`have ${item.fileName}`);
      continue;
    }
    try {
      const pdf = await fetcher.getPdf(item.url);
      const localPath = path.join(cfg.PIPELINE_DOWNLOAD_DIR, `${item.listingKey}.pdf`);
      await writeFile(localPath, pdf.bytes);
      const extracted = await extractPdfText(pdf.bytes);
      const screen = screenText(extracted.pages.slice(0, 3).map((p) => p.text).join("\n"), restrictionMarkers);
      const entry: LocalDownload = {
        listingKey: item.listingKey, url: item.url, fileName: item.fileName, title: item.title,
        category: item.category, docketNumber: item.docketNumber, docketSuffix: item.docketSuffix,
        filedDate: item.filedDate, sha256: pdf.sha256, byteSize: pdf.bytes.length,
        pageCount: extracted.pageCount,
        pagesNeedingOcr: extracted.pages.filter((p) => p.textMethod === "none").length,
        restrictionFlags: screen.flags, halting: screen.halting.length > 0, localPath,
        matchedRule: item.matchedRule,
      };
      downloads.push(entry);
      await writeFile(manifestPath, JSON.stringify(downloads, null, 2));
      log(`downloaded ${item.fileName} (${entry.pageCount} pages, ${entry.pagesNeedingOcr} need OCR${entry.halting ? ", HALTING marker" : ""})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ url: item.url, error: message });
      log(`FAILED ${item.fileName}: ${message}`);
    }
  }
  return { downloads, failed };
}

async function readManifest(manifestPath: string): Promise<LocalDownload[]> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as LocalDownload[];
  } catch {
    return [];
  }
}

export async function planAcquisition(
  fetcher: PoliteFetcher,
  source: SourceRow,
  plan: SubsetPlan,
  indexHtml?: string,
): Promise<PlanResult> {
  const html = indexHtml ?? (await fetcher.getText(source.base_url!));
  const listings = parseReceiverSiteIndex(html, source.base_url!);
  return { listings, sections: summarizeBySection(listings), subset: selectSubset(listings, plan) };
}

export async function recordKnownDocuments(client: IngestClient, cfg: WorkerConfig, known: number): Promise<void> {
  await client.recomputeCoverage(cfg.PIPELINE_CASE_ID, known);
}

/**
 * Store the locally downloaded subset through the pipeline-ingest Edge
 * Function: the function verifies the worker token, re-hashes the bytes,
 * uploads to the private bucket and writes document and page rows as the
 * service role. Page text is PII-masked here before it leaves the worker.
 */
export async function acquireFromManifest(
  client: IngestClient,
  cfg: WorkerConfig,
  restrictionMarkers: string[] | undefined,
  opts: { limit?: number; log?: (line: string) => void } = {},
): Promise<AcquireReport> {
  const log = opts.log ?? ((l) => console.log(l));
  const report: AcquireReport = { attempted: 0, stored: 0, skippedExisting: 0, halted: 0, failed: [] };
  const manifest = await readManifest(path.join(cfg.PIPELINE_DOWNLOAD_DIR, "manifest.json"));
  if (manifest.length === 0) throw new Error("no local downloads; run `worker download` first");
  const targets = opts.limit ? manifest.slice(0, opts.limit) : manifest;
  for (const item of targets) {
    report.attempted++;
    try {
      const bytes = new Uint8Array(await readFile(item.localPath));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== item.sha256) throw new Error("local file hash differs from manifest");
      const extracted = await extractPdfText(bytes);
      const screen = screenText(extracted.pages.slice(0, 3).map((p) => p.text).join("\n"), restrictionMarkers);
      const halted = screen.halting.length > 0;
      const pages = extracted.pages.map((p) => {
        const masked = maskPii(p.text);
        return { page_number: p.pageNumber, text: masked.text, text_method: p.textMethod, pii_masked: masked.counts.total > 0 };
      });
      const result = await client.ingestDocument(
        {
          case_id: cfg.PIPELINE_CASE_ID,
          source_id: cfg.PIPELINE_SOURCE_ID,
          original_url: item.url,
          sha256,
          title: item.title,
          document_category: item.category,
          docket_number: item.docketNumber,
          docket_suffix: item.docketSuffix,
          filed_date: item.filedDate,
          page_count: extracted.pageCount,
          restriction_flags: screen.flags,
          halted,
          screening_notes: [
            /not included/i.test(item.title) ? "Posted copy omits some exhibits." : null,
            screen.matches.length ? `markers: ${screen.matches.map((m) => m.marker).join(", ")}` : null,
          ].filter(Boolean).join(" ") || null,
          pages: halted ? [] : pages,
        },
        bytes,
      );
      if (result.skipped) {
        report.skippedExisting++;
        log(`skip (${result.skipped}) ${item.fileName}`);
        continue;
      }
      report.stored++;
      if (halted) report.halted++;
      log(`stored ${item.fileName} (${extracted.pageCount} pages, ${result.pages_written ?? 0} page rows${halted ? ", HALTED" : ""})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ url: item.url, error: message });
      log(`FAILED ${item.fileName}: ${message}`);
    }
  }
  return report;
}
