#!/usr/bin/env node
// Entity resolution, stage 1: read the pilot case's entities (read-only) and
// write the deterministic candidate pairs to a fixture for adjudication.
//   node scripts/resolve-candidates.mjs fixtures/equitybuild/resolution-2026-11-08/candidates.json

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runSql } from "./supabase-management.mjs";
import { blockLawsuits, blockParties, blockProperties } from "../worker/dist-resolve/blocking.js";

const CASE = "0c000000-0000-4000-8000-000000000001";
const out = process.argv[2];
if (!out) throw new Error("usage: resolve-candidates.mjs <out.json>");

const parties = await runSql(`select id, kind::text as kind, canonical_name, coalesce(aliases,'{}') as aliases, coalesce(party_roles::text[],'{}') as party_roles, created_at from public.parties where case_id = '${CASE}' order by created_at`);
const props = await runSql(`select id, address, receiver_property_number from public.properties where case_id = '${CASE}' order by created_at`);
const suits = await runSql(`select id, caption, docket_number, court from public.related_lawsuits where case_id = '${CASE}' order by created_at`);
// Evidence for adjudicators: a few quotes per party.
const quotes = await runSql(`select a.subject_id, d.docket_number, a.page_number, left(a.quote, 160) as quote from public.assertions a join public.source_documents d on d.id = a.source_document_id where a.case_id = '${CASE}' and a.subject_type = 'party' order by a.created_at`);
const quoteMap = {};
for (const q of quotes) (quoteMap[q.subject_id] ??= []).push(`[Dkt. ${q.docket_number ?? "-"} p${q.page_number}] ${q.quote}`);

const candidates = [...blockParties(parties), ...blockProperties(props), ...blockLawsuits(suits)].map((c) => ({
  ...c,
  left_evidence: (quoteMap[c.left_id] ?? []).slice(0, 3),
  right_evidence: (quoteMap[c.right_id] ?? []).slice(0, 3),
}));
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ case_id: CASE, generated_at: new Date().toISOString(), counts: { parties: parties.length, properties: props.length, related_lawsuits: suits.length }, candidates }, null, 1));
const by = {};
for (const c of candidates) by[`${c.entity_type}:${c.proposal}`] = (by[`${c.entity_type}:${c.proposal}`] ?? 0) + 1;
console.log(`${candidates.length} candidate pairs`, by);
for (const c of candidates) console.log(`  ${c.proposal.padEnd(10)} ${c.score.toFixed(2)} ${c.rule.padEnd(32)} ${c.left_label.slice(0, 38).padEnd(38)} | ${c.right_label.slice(0, 38)}`);
