#!/usr/bin/env node
// Entity resolution, stage 3: apply adjudicated decisions reversibly.
//
// What "apply" writes (and nothing else):
//   - one entity_resolution_decisions row per pair (rule, decision, decider, model, rationale, score);
//   - for merges, a same_as entity_link from the duplicate to the canonical row and, for parties,
//     parties.resolution_cluster_id set to the canonical id on both rows;
//   - a review_tasks row for every merge that was not an exact rule (so a human confirms it).
// No row is deleted or renamed. Assertions, creditors and citations stay on the
// original rows; readers group by cluster or follow same_as links.
//
//   node scripts/resolve-apply.mjs --candidates c.json --adjudicated a.json --dry-run
//   node scripts/resolve-apply.mjs --candidates c.json --adjudicated a.json --apply
//   node scripts/resolve-apply.mjs --undo <decision_id>            (reverts one merge)

import { readFile } from "node:fs/promises";
import { runSql, sqlLiteral as L } from "./supabase-management.mjs";

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const FIRM = "0f000000-0000-4000-8000-000000000001";
const CASE = "0c000000-0000-4000-8000-000000000001";
const ADJUDICATOR_MODEL = "claude session review agents (paralegal + steward), 2026-11-08";

if (flag("--undo")) {
  const id = flag("--undo");
  const [d] = await runSql(`select * from public.entity_resolution_decisions where id = ${L(id)}`);
  if (!d) throw new Error("decision not found");
  const sql = `
    begin;
    delete from public.entity_links where from_type = ${L(d.entity_type)} and predicate = 'same_as'
      and ((from_id = ${L(d.right_id)} and to_id = ${L(d.left_id)}) or (from_id = ${L(d.left_id)} and to_id = ${L(d.right_id)}));
    ${d.entity_type === "party" ? `update public.parties set resolution_cluster_id = null where id in (${L(d.left_id)}, ${L(d.right_id)});` : ""}
    update public.entity_resolution_decisions set decision = 'distinct', rationale = coalesce(rationale, '') || ' | reverted ' || now()::text, decided_at = now() where id = ${L(id)};
    update public.review_tasks set status = 'dismissed', resolution = 'reverted', resolved_at = now() where resolution_decision_id = ${L(id)} and status in ('open','in_progress');
    commit;`;
  await runSql(sql);
  console.log(`reverted decision ${id} (${d.entity_type} ${d.left_id} / ${d.right_id})`);
  process.exit(0);
}

const candidates = JSON.parse(await readFile(flag("--candidates"), "utf8")).candidates;
const adjudicated = flag("--adjudicated") ? JSON.parse(await readFile(flag("--adjudicated"), "utf8")).decisions : [];
const adjMap = new Map(adjudicated.map((d) => [`${d.left_id}|${d.right_id}`, d]));
const apply = args.includes("--apply");

// Canonical = earliest-created row in each cluster (union-find over merges).
const parent = new Map();
const find = (x) => { while (parent.get(x) && parent.get(x) !== x) x = parent.get(x); return x; };
const union = (a, b, created) => { const ra = find(a) ?? a, rb = find(b) ?? b; if (ra === rb) return; const keep = created.get(ra) <= created.get(rb) ? ra : rb; const drop = keep === ra ? rb : ra; parent.set(drop, keep); parent.set(keep, keep); };
const createdRows = await runSql(`select id, created_at from public.parties where case_id = ${L(CASE)} union all select id, created_at from public.properties where case_id = ${L(CASE)} union all select id, created_at from public.related_lawsuits where case_id = ${L(CASE)}`);
const created = new Map(createdRows.map((r) => [r.id, r.created_at]));
for (const id of created.keys()) parent.set(id, id);

const plan = [];
for (const c of candidates) {
  const adj = adjMap.get(`${c.left_id}|${c.right_id}`);
  let decision, decided_by, model = null, rationale, score, needsReview;
  if (c.proposal === "merge") { decision = "merge"; decided_by = "rule"; rationale = `${c.rule}: ${c.rationale}`; score = c.score; needsReview = c.score < 1; }
  else if (c.proposal === "distinct") { decision = "distinct"; decided_by = "rule"; rationale = `${c.rule}: ${c.rationale}`; score = 1 - c.score; needsReview = false; }
  else if (adj && adj.agreed && adj.decision !== "undecided") { decision = adj.decision; decided_by = "llm"; model = ADJUDICATOR_MODEL; rationale = `${c.rule}; paralegal: ${adj.paralegal.rationale} | steward: ${adj.steward?.rationale ?? ""}`; score = Math.min(adj.paralegal.confidence, adj.steward?.confidence ?? 0); needsReview = true; }
  else { decision = "undecided"; decided_by = "llm"; model = ADJUDICATOR_MODEL; rationale = `${c.rule}; adjudicators disagreed or were unsure: ${adj ? `paralegal=${adj.paralegal.decision}, steward=${adj.steward?.decision}` : "no adjudication"}`; score = null; needsReview = true; }
  if (decision === "merge") union(c.left_id, c.right_id, created);
  plan.push({ ...c, decision, decided_by, model, rationale, score, needsReview });
}

const summary = {};
for (const p of plan) summary[`${p.entity_type}:${p.decision}:${p.decided_by}`] = (summary[`${p.entity_type}:${p.decision}:${p.decided_by}`] ?? 0) + 1;
console.log("plan:", summary);
for (const p of plan) console.log(`  ${p.decision.padEnd(9)} ${p.decided_by.padEnd(4)} ${String(p.score ?? "-").slice(0, 4).padEnd(4)} ${p.entity_type.padEnd(15)} ${p.left_label.slice(0, 34).padEnd(34)} | ${p.right_label.slice(0, 34)}`);

const statements = [];
for (const p of plan) {
  const did = `gen_random_uuid()`;
  statements.push(`
    with d as (
      insert into public.entity_resolution_decisions (id, firm_id, case_id, entity_type, left_id, right_id, blocking_rule, decision, decided_by, model, rationale, score, decided_at)
      values (${did}, ${L(FIRM)}, ${L(CASE)}, ${L(p.entity_type)}, ${L(p.left_id)}, ${L(p.right_id)}, ${L(p.rule)}, ${L(p.decision)}, ${L(p.decided_by)}, ${p.model ? L(p.model) : "null"}, ${L(p.rationale)}, ${p.score === null ? "null" : p.score}, now())
      returning id
    )
    ${p.decision === "merge" ? `, l as (
      insert into public.entity_links (firm_id, case_id, from_type, from_id, predicate, to_type, to_id, link_origin, confidence)
      values (${L(FIRM)}, ${L(CASE)}, ${L(p.entity_type)}, ${L(find(p.left_id) === p.left_id ? p.right_id : p.left_id)}, 'same_as', ${L(p.entity_type)}, ${L(find(p.left_id))}, ${p.decided_by === "rule" ? "'extracted'" : "'inferred'"}, ${p.score ?? 0.5})
      on conflict (from_type, from_id, predicate, to_type, to_id) do nothing
      returning id
    )` : ""}
    ${p.needsReview ? `, t as (
      insert into public.review_tasks (firm_id, case_id, task_type, priority, title, details, resolution_decision_id)
      select ${L(FIRM)}, ${L(CASE)}, 'entity_resolution', ${p.decision === "undecided" ? 2 : 3},
             ${L(`Confirm ${p.decision}: ${p.left_label.slice(0, 40)} / ${p.right_label.slice(0, 40)}`)},
             ${L(JSON.stringify({ rule: p.rule, decided_by: p.decided_by, score: p.score, rationale: p.rationale.slice(0, 500) }))}::jsonb, d.id from d
      returning id
    )` : ""}
    select id from d;`);
}
const clusterUpdates = [];
for (const [id, par] of parent) { const root = find(id); if (root !== id && created.has(id)) clusterUpdates.push(`update public.parties set resolution_cluster_id = ${L(root)} where id in (${L(id)}, ${L(root)}) and case_id = ${L(CASE)};`); }

if (!apply) {
  console.log(`\nDRY RUN: ${statements.length} decision statements, ${clusterUpdates.length} cluster updates. Re-run with --apply to write.`);
  process.exit(0);
}
await runSql(`begin;\n${statements.join("\n")}\n${clusterUpdates.join("\n")}\ncommit;`);
const [after] = await runSql(`select (select count(*) from public.entity_resolution_decisions where case_id = ${L(CASE)}) decisions, (select count(*) from public.entity_links where case_id = ${L(CASE)} and predicate = 'same_as') same_as_links, (select count(distinct coalesce(resolution_cluster_id, id)) from public.parties where case_id = ${L(CASE)}) party_clusters, (select count(*) from public.parties where case_id = ${L(CASE)}) party_rows, (select count(*) from public.review_tasks where case_id = ${L(CASE)} and task_type = 'entity_resolution' and status = 'open') open_resolution_tasks`);
console.log("applied:", after);
