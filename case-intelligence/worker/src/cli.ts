#!/usr/bin/env node
// Worker CLI.
//   npm run worker -- plan [--offline]      parse index (or fixture), show sections and pilot subset
//   npm run worker -- download [--limit N]  download, screen, extract the subset locally (no database)
//   npm run worker -- acquire [--limit N]   store the pilot subset (reuses local downloads when present)
//   npm run worker -- coverage              print the case coverage block and statement
//
// Requires SUPABASE_SERVICE_ROLE_KEY for acquire/coverage (proxy-injected in the cloud session).

import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { PoliteFetcher } from "./acquire/fetcher.js";
import type { SubsetPlan } from "./acquire/receiver-site.js";
import { acquireSubset, downloadSubset, loadValidatedSource, planAcquisition, recordKnownDocuments } from "./pipeline/acquire-pilot.js";
import { serviceClient } from "./supabase.js";

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

  const db = serviceClient(cfg);
  const source = await loadValidatedSource(db, cfg);

  if (command === "plan") {
    const result = await planAcquisition(fetcher, source, plan);
    await recordKnownDocuments(db, cfg, result.listings.length);
    printPlan(result.sections, result.listings.length, result.subset);
    return;
  }

  if (command === "acquire") {
    const result = await planAcquisition(fetcher, source, plan);
    await recordKnownDocuments(db, cfg, result.listings.length);
    const limit = flags.has("limit") ? Number(flags.get("limit")) : undefined;
    console.log(`acquiring ${limit ?? result.subset.length} of ${result.subset.length} pilot documents with ${cfg.PIPELINE_MIN_DELAY_MS} ms between requests`);
    const report = await acquireSubset(db, cfg, fetcher, source, result.subset, { limit });
    await recordKnownDocuments(db, cfg, result.listings.length);
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length) process.exitCode = 1;
    return;
  }

  if (command === "coverage") {
    const { data, error } = await db.rpc("case_coverage", { p_case_id: cfg.PIPELINE_CASE_ID });
    if (error) throw error;
    const stmt = await db.rpc("coverage_statement", { p_case_id: cfg.PIPELINE_CASE_ID });
    console.log(JSON.stringify(data, null, 2));
    console.log(stmt.data);
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
