#!/usr/bin/env node
// Pull a stratified sample of assertions with their cited page text for an
// independent verification pass. Reads through the Management API (read-only
// SQL) and writes JSON to the path given as the first argument.
//
//   node scripts/sample-assertions.mjs out.json [perDocument=8]

import { writeFile } from "node:fs/promises";
import { runSql } from "./supabase-management.mjs";

const out = process.argv[2];
const perDocument = Number(process.argv[3] ?? 8);
if (!out) throw new Error("usage: sample-assertions.mjs <out.json> [perDocument]");

const rows = await runSql(`
  with ranked as (
    select a.id, a.subject_type, a.subject_id, a.predicate, a.object_value, a.origin, a.confidence,
           a.page_number, a.quote, a.source_document_id, d.title as document_title, d.docket_number,
           row_number() over (partition by a.source_document_id, a.origin order by md5(a.id::text)) as rn
    from public.assertions a
    join public.source_documents d on d.id = a.source_document_id
    where a.case_id = '0c000000-0000-4000-8000-000000000001'
  )
  select r.*,
         coalesce(p.canonical_name, cr_p.canonical_name, at.full_name, pr.address, rl.caption, c.caption) as subject_label,
         pg.text as page_text
  from ranked r
  left join public.parties p on r.subject_type = 'party' and p.id = r.subject_id
  left join public.creditors cr on r.subject_type = 'creditor' and cr.id = r.subject_id
  left join public.parties cr_p on cr_p.id = cr.party_id
  left join public.attorneys at on r.subject_type = 'attorney' and at.id = r.subject_id
  left join public.properties pr on r.subject_type = 'property' and pr.id = r.subject_id
  left join public.related_lawsuits rl on r.subject_type = 'related_lawsuit' and rl.id = r.subject_id
  left join public.cases c on r.subject_type = 'case' and c.id = r.subject_id
  join public.document_pages pg on pg.document_id = r.source_document_id and pg.page_number = r.page_number
  where r.rn <= ${Math.ceil(perDocument / 2)}
  order by r.document_title, r.page_number;
`);
await writeFile(out, JSON.stringify(rows, null, 2));
console.log(`${rows.length} assertions sampled to ${out}`);
