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
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";
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

async function loadLocalPdf(cfg: WorkerConfig, listingKey: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path.join(cfg.PIPELINE_DOWNLOAD_DIR, `${listingKey}.pdf`)));
  } catch {
    return null;
  }
}

export async function loadValidatedSource(db: SupabaseClient, cfg: WorkerConfig): Promise<SourceRow> {
  const { data, error } = await db
    .from("sources")
    .select("id, firm_id, kind, base_url, status, restriction_markers, min_delay_ms, store_copy")
    .eq("id", cfg.PIPELINE_SOURCE_ID)
    .single();
  if (error) throw new Error(`loading source: ${error.message}`);
  if (data.status !== "validated") {
    throw new Error(`source ${data.id} is ${data.status}; ingestion requires a validated source`);
  }
  if (data.firm_id !== cfg.PIPELINE_FIRM_ID) throw new Error("source belongs to another firm");
  if (!data.base_url) throw new Error("source has no base_url");
  return data as SourceRow;
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

export async function recordKnownDocuments(db: SupabaseClient, cfg: WorkerConfig, known: number): Promise<void> {
  const { error } = await db.rpc("recompute_case_coverage", { p_case_id: cfg.PIPELINE_CASE_ID, p_documents_known: known });
  if (error) throw new Error(`recompute_case_coverage: ${error.message}`);
}

export async function acquireSubset(
  db: SupabaseClient,
  cfg: WorkerConfig,
  fetcher: PoliteFetcher,
  source: SourceRow,
  subset: SubsetSelection[],
  opts: { limit?: number; log?: (line: string) => void } = {},
): Promise<AcquireReport> {
  const log = opts.log ?? ((l) => console.log(l));
  const report: AcquireReport = { attempted: 0, stored: 0, skippedExisting: 0, halted: 0, failed: [] };
  const targets = opts.limit ? subset.slice(0, opts.limit) : subset;
  await mkdir(cfg.PIPELINE_DOWNLOAD_DIR, { recursive: true });

  for (const item of targets) {
    report.attempted++;
    try {
      // Skip by URL first (cheap), then by content hash after download.
      const { data: byUrl } = await db
        .from("source_documents")
        .select("id")
        .eq("case_id", cfg.PIPELINE_CASE_ID)
        .eq("original_url", item.url)
        .maybeSingle();
      if (byUrl) {
        report.skippedExisting++;
        log(`skip (already acquired) ${item.fileName}`);
        continue;
      }

      const local = await loadLocalPdf(cfg, item.listingKey);
      const pdf = local
        ? { bytes: local, sha256: createHash("sha256").update(local).digest("hex") }
        : await fetcher.getPdf(item.url);
      if (local) log(`using local copy of ${item.fileName}`);
      const { data: byHash } = await db
        .from("source_documents")
        .select("id")
        .eq("case_id", cfg.PIPELINE_CASE_ID)
        .eq("sha256", pdf.sha256)
        .maybeSingle();
      if (byHash) {
        report.skippedExisting++;
        log(`skip (same content already acquired) ${item.fileName}`);
        continue;
      }

      if (!local) await writeFile(path.join(cfg.PIPELINE_DOWNLOAD_DIR, `${item.listingKey}.pdf`), pdf.bytes);

      const extracted = await extractPdfText(pdf.bytes);
      const headText = extracted.pages.slice(0, 3).map((p) => p.text).join("\n");
      const screen = screenText(headText, source.restriction_markers);
      const halted = screen.halting.length > 0;

      const storagePath = `${cfg.PIPELINE_FIRM_ID}/${cfg.PIPELINE_CASE_ID}/${pdf.sha256}.pdf`;
      if (source.store_copy) {
        const up = await db.storage.from("source-documents").upload(storagePath, pdf.bytes, {
          contentType: "application/pdf",
          upsert: false,
        });
        if (up.error && !/already exists/i.test(up.error.message)) {
          throw new Error(`storage upload: ${up.error.message}`);
        }
      }

      const { data: doc, error: docErr } = await db
        .from("source_documents")
        .insert({
          firm_id: cfg.PIPELINE_FIRM_ID,
          case_id: cfg.PIPELINE_CASE_ID,
          source_id: source.id,
          original_url: item.url,
          storage_path: source.store_copy ? storagePath : null,
          sha256: pdf.sha256,
          byte_size: pdf.bytes.length,
          title: item.title,
          document_category: item.category,
          docket_number: item.docketNumber,
          docket_suffix: item.docketSuffix,
          filed_date: item.filedDate,
          page_count: extracted.pageCount,
          processing_status: halted ? "halted_restricted" : "text_extracted",
          restriction_flags: screen.flags,
          screening_notes: [
            item.exhibitsOmitted ? "Posted copy omits some exhibits." : null,
            screen.matches.length ? `markers: ${screen.matches.map((m) => m.marker).join(", ")}` : null,
          ]
            .filter(Boolean)
            .join(" "),
          processed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (docErr) throw new Error(`insert source_documents: ${docErr.message}`);

      if (!halted) {
        const rows = extracted.pages.map((p) => {
          const masked = maskPii(p.text);
          return {
            firm_id: cfg.PIPELINE_FIRM_ID,
            document_id: doc.id,
            page_number: p.pageNumber,
            text: masked.text,
            text_method: p.textMethod,
            pii_masked: masked.counts.total > 0,
          };
        });
        for (let i = 0; i < rows.length; i += 200) {
          const { error: pageErr } = await db
            .from("document_pages")
            .upsert(rows.slice(i, i + 200), { onConflict: "document_id,page_number" });
          if (pageErr) throw new Error(`insert document_pages: ${pageErr.message}`);
        }
      } else {
        report.halted++;
      }
      report.stored++;
      const noText = extracted.pages.filter((p) => p.textMethod === "none").length;
      log(
        `stored ${item.fileName} (${extracted.pageCount} pages${noText ? `, ${noText} need OCR` : ""}${halted ? ", HALTED: restriction marker" : ""})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ url: item.url, error: message });
      log(`FAILED ${item.fileName}: ${message}`);
    }
  }
  return report;
}
