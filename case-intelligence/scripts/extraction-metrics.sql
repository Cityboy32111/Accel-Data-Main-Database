-- Extraction metrics for the pilot case (read-only). Run through the Management API.
with c as (select '0c000000-0000-4000-8000-000000000001'::uuid as id)
select 'documents structured' as metric, count(*)::text as value from public.source_documents, c where case_id = c.id and processing_status = 'structured'
union all select 'extraction calls', count(*)::text from public.extractions e join public.source_documents d on d.id = e.document_id, c where d.case_id = c.id
union all select 'input tokens', sum(input_tokens)::text from public.extractions e join public.source_documents d on d.id = e.document_id, c where d.case_id = c.id
union all select 'output tokens', sum(output_tokens)::text from public.extractions e join public.source_documents d on d.id = e.document_id, c where d.case_id = c.id
union all select 'grounded assertions (per extractor)', sum(grounded_count)::text from public.extractions e join public.source_documents d on d.id = e.document_id, c where d.case_id = c.id
union all select 'rejected by grounding check', sum(rejected_count)::text from public.extractions e join public.source_documents d on d.id = e.document_id, c where d.case_id = c.id
union all select 'assertions stored', count(*)::text from public.assertions, c where case_id = c.id
union all select 'assertions by origin', string_agg(origin || ':' || n, ', ') from (select origin, count(*) n from public.assertions, c where case_id = c.id group by 1) s
union all select 'assertions by verification_status', string_agg(verification_status || ':' || n, ', ') from (select verification_status, count(*) n from public.assertions, c where case_id = c.id group by 1) s
union all select 'assertions with page + quote', count(*)::text from public.assertions, c where case_id = c.id and page_number is not null and quote is not null
union all select 'avg confidence', round(avg(confidence), 3)::text from public.assertions, c where case_id = c.id
union all select 'parties', count(*)::text from public.parties, c where case_id = c.id
union all select 'parties (organizations)', count(*)::text from public.parties, c where case_id = c.id and kind = 'organization'
union all select 'parties (individuals)', count(*)::text from public.parties, c where case_id = c.id and kind = 'person'
union all select 'creditors', count(*)::text from public.creditors, c where case_id = c.id
union all select 'creditors by type', string_agg(creditor_type || ':' || n, ', ') from (select creditor_type, count(*) n from public.creditors, c where case_id = c.id group by 1) s
union all select 'creditors flagged individual', count(*)::text from public.creditors, c where case_id = c.id and is_individual
union all select 'attorneys', count(*)::text from public.attorneys, c where case_id = c.id
union all select 'properties', count(*)::text from public.properties, c where case_id = c.id
union all select 'related lawsuits', count(*)::text from public.related_lawsuits, c where case_id = c.id
union all select 'review tasks open', count(*)::text from public.review_tasks, c where case_id = c.id and status = 'open'
union all select 'review tasks by type', string_agg(task_type || ':' || n, ', ') from (select task_type, count(*) n from public.review_tasks, c where case_id = c.id group by 1) s
union all select 'top predicates', string_agg(predicate || ':' || n, ', ') from (select predicate, count(*) n from public.assertions, c where case_id = c.id group by 1 order by 2 desc limit 12) s
union all select 'coverage statement', app.coverage_statement(c.id) from c;
