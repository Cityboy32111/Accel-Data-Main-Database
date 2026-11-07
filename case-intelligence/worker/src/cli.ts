#!/usr/bin/env node
// Worker CLI.
//   npm run worker -- plan [--offline]      parse index (or fixture), show sections and pilot subset
//   npm run worker -- download [--limit N]  download, screen, extract the subset locally (no database)
//   npm run worker -- acquire [--limit N]   store the downloaded subset through the pipeline-ingest Edge Function
//   npm run worker -- extract --sample [--dockets 1967,1806] [--titles "a|b"] [--max-pages N] [--model m]
//   npm run worker -- status                counts and coverage for the pilot case
//
// acquire/status/plan need PIPELINE_WORKER_TOKEN (scoped token for the Edge Function).

import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { PoliteFetcher } from "./acquire/fetcher.js";
import type { SubsetPlan } from "./acquire/receiver-site.js";
import { acquireFromManifest, downloadSubset, planAcquisition, recordKnownDocuments } from "./pipeline/acquire-pilot.js";
import { IngestClient } from "./ingest-client.js";
import { extractDocuments, type DocumentSummary } from "./structure/extract-documents.js";

async function main(): Promise<void> {
  const [command = "plan", ...rest] = process.argv.slice(2);
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(a.slice(2), next);
      i++;
    } else flags.set(a.slice(2), true);
  }
  const cfg = loadConfig();
  const plan = JSON.parse(await readFile("fixtures/equitybuild/pilot-subset.json", "utf8")) as SubsetPlan;
  const fetcher = new PoliteFetcher({ userAgent: cfg.PIPELINE_USER_AGENT, minDelayMs: cfg.PIPELINE_MIN_DELAY_MS });

  if (command === "plan" && flags.get("offline")) {
    const html = await readFile("fixtures/equitybuild/index.html", "utf8");
    const source = {
      id: cfg.PIPELINE_SOURCE_ID, firm_id: cfg.PIPELINE_FIRM_ID, kind: "public_web",
      base_url: "https://rdaplaw.net/equitybuild-receivership/", status: "validated",
      restriction_markers: [], min_delay_ms: cfg.PIPELINE_MIN_DELAY_MS, store_copy: true,
    };
    const result = await planAcquisition(fetcher, source, plan, html);
    printPlan(result.sections, result.listings.length, result.subset);
    return;
  }

  if (command === "download") {
    const source = {
      id: cfg.PIPELINE_SOURCE_ID, firm_id: cfg.PIPELINE_FIRM_ID, kind: "public_web",
      base_url: "https://rdaplaw.net/equitybuild-receivership/", status: "validated",
      restriction_markers: undefined as unknown as string[], min_delay_ms: cfg.PIPELINE_MIN_DELAY_MS, store_copy: true,
    };
    const result = await planAcquisition(fetcher, source, plan);
    const limit = flags.has("limit") ? Number(flags.get("limit")) : undefined;
    console.log(`downloading ${limit ?? result.subset.length} of ${result.subset.length} pilot documents with ${cfg.PIPELINE_MIN_DELAY_MS} ms between requests`);
    const { downloads, failed } = await downloadSubset(cfg, fetcher, result.subset, undefined, { limit });
    console.log(JSON.stringify({ downloaded: downloads.length, failed }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }

  const client = new IngestClient(cfg);
  const source = {
    id: cfg.PIPELINE_SOURCE_ID, firm_id: cfg.PIPELINE_FIRM_ID, kind: "public_web",
    base_url: "https://rdaplaw.net/equitybuild-receivership/", status: "validated",
    restriction_markers: undefined as unknown as string[], min_delay_ms: cfg.PIPELINE_MIN_DELAY_MS, store_copy: true,
  };

  if (command === "plan") {
    const result = await planAcquisition(fetcher, source, plan);
    await recordKnownDocuments(client, cfg, result.listings.length);
    printPlan(result.sections, result.listings.length, result.subset);
    return;
  }

  if (command === "acquire") {
    const limit = flags.has("limit") ? Number(flags.get("limit")) : undefined;
    const report = await acquireFromManifest(client, cfg, undefined, { limit });
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length) process.exitCode = 1;
    return;
  }

  if (command === "extract") {
    const { documents } = await client.json<{ documents: DocumentSummary[] & { docket_number: string | null }[] }>({ action: "list_documents", case_id: cfg.PIPELINE_CASE_ID });
    const wantDockets = String(flags.get("dockets") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const wantTitles = String(flags.get("titles") ?? "").split("|").map((s) => s.trim()).filter(Boolean);
    const sample = flags.has("sample")
      ? (JSON.parse(await readFile(String(flags.get("sample") === true ? "fixtures/equitybuild/extraction-sample.json" : flags.get("sample")), "utf8")) as {
          documents: { docket_number?: string; title_prefix?: string; title_contains?: string }[];
        }).documents
      : [];
    const matchesSample = (d: DocumentSummary & { docket_number: string | null }) =>
      sample.some((s) =>
        (s.docket_number && d.docket_number === s.docket_number) ||
        (s.title_prefix && d.title.toLowerCase().startsWith(s.title_prefix.toLowerCase())) ||
        (s.title_contains && d.title.toLowerCase().includes(s.title_contains.toLowerCase())));
    const targets = documents.filter((d) =>
      matchesSample(d) ||
      (wantDockets.length > 0 && d.docket_number !== null && wantDockets.includes(d.docket_number)) ||
      wantTitles.some((t) => d.title.toLowerCase().includes(t.toLowerCase())));
    if (!targets.length) throw new Error("no documents matched --sample / --dockets / --titles");
    const model = String(flags.get("model") ?? "claude-sonnet-5-5");
    const maxPages = flags.has("max-pages") ? Number(flags.get("max-pages")) : undefined;
    console.log(`extracting ${targets.length} documents with ${model}${maxPages ? `, first ${maxPages} pages each` : ""}`);
    for (const t of targets) console.log(`  - [${t.docket_number ?? "-"}] ${t.title.slice(0, 100)} (${t.page_count} pages)`);
    const report = await extractDocuments(client, cfg, targets, { model, maxPagesPerDocument: maxPages });
    console.log(JSON.stringify(report, null, 2));
    if (report.documents.some((d) => d.failures.length)) process.exitCode = 1;
    return;
  }

  if (command === "status" || command === "coverage") {
    console.log(JSON.stringify(await client.status(cfg.PIPELINE_CASE_ID), null, 2));
    return;
  }

  throw new Error(`unknown command ${command}`);
}
function printPlan(sections: Record<string, number>, total: number, subset: { matchedRule: string; filedDate: string | null; docketNumber: string | null; category: string; title: string }[]): void {
  console.log(`documents known at source: ${total}`);
  console.log(sections);
  console.log(`pilot subset: ${subset.length}`);
  for (const s of subset) {
    console.log(`  ${s.filedDate ?? "----------"}  dkt ${(s.docketNumber ?? "-").padStart(5)}  ${s.category.padEnd(14)} ${s.title.slice(0, 95)}  [${s.matchedRule}]`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
