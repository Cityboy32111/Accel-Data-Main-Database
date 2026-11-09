# Ingestion Report: EquityBuild Pilot Loaded

Status: 2026-11-07. Project `jsfdewizzkyvbqziniou`.

## 1. Credential mechanism (replaces the earlier proxy-header approach)

The service-role key is now held only as a Supabase-managed secret inside the
`pipeline-ingest` Edge Function (`supabase/functions/pipeline-ingest/`).
Nothing else holds it: not the worker, not the development environment, not
the repository, not Base44, and it is never written to logs.

| Component | Credential it holds | Scope |
| --- | --- | --- |
| Edge Function `pipeline-ingest` | `SUPABASE_SERVICE_ROLE_KEY` (platform-managed), `PIPELINE_WORKER_TOKEN`, `PIPELINE_WORKER_FIRM_ID`, `ANTHROPIC_API_KEY` (pending) | Runs only inside Supabase |
| Pipeline worker | `PIPELINE_WORKER_TOKEN` only | A 64-hex random token minted in the session, kept in the session scratchpad, never committed |
| Base44 dashboard | User JWTs only | Row Level Security applies |

How the function constrains a caller:

- Every request must carry the worker token in `x-worker-token`; the comparison is constant-time and the function refuses to start work if the token is shorter than 32 characters or the firm binding is missing.
- The token is bound to one firm (`PIPELINE_WORKER_FIRM_ID`). Every action resolves the case and refuses any case outside that firm (verified: a foreign case id returns 403).
- Uploaded bytes are re-hashed server-side and must match the declared SHA-256 and start with the PDF magic bytes.
- Page text for extraction is read from the database by the function, never accepted from the caller, so a leaked worker token cannot spend model tokens on arbitrary input. Models are allow-listed.
- Rotating `PIPELINE_WORKER_TOKEN` revokes the pipeline without touching the service-role key.

The two network-secret entries created earlier for the project host (apikey
header) should be deleted from the "Accel Case Intelligence" environment in
Claude settings; they are no longer used and one of them never worked. I cannot
remove them from the session.

## 2. Ingestion results (all 39 pilot documents)

| Check | Result |
| --- | --- |
| Documents stored | 39 of 39, 0 failures, 0 duplicates |
| Documents outside the demo firm or pilot case | 0 |
| Page rows written | 1,191, all with a text layer (0 need OCR) |
| Pages with personal identifiers masked before storage | 24 |
| Storage objects in `source-documents` | 39, all under `<demo firm>/<pilot case>/<sha256>.pdf`, each matching a document row; 28.9 MB |
| Documents halted by restriction screening | 0 (one "sealed bids" false positive eliminated by the refined screener) |
| Audit rows for document inserts | 39 |
| Review tasks opened | 0 |
| Coverage statement | "Derived from 0 of 822 publicly posted filings in SEC v. EquityBuild, Inc., et al. (N.D. Ill. 1:18-cv-05587). Not a claims register. Not complete." (processed count rises as documents are structured) |

By category: 15 orders, 6 status reports, 13 claims-process filings, 5 other pleadings.

## 3. Access control re-verified after loading

- pgTAP suite: 13 of 13 pass against the populated database, including cross-tenant isolation across 19 tables and views.
- Anonymous download of a stored object: HTTP 400 (no credentials); public-URL form: HTTP 400 (bucket is private).
- Anonymous REST read of `document_pages`: HTTP 401.
- Edge Function without the worker token: HTTP 401; with the token but a foreign case id: HTTP 403.

## 4. Extraction (Milestone 3) status

Implemented and unit-tested, not yet run against the model:

- `extract_page` action in the Edge Function calls the Anthropic Messages API with a forced tool call whose schema covers parties, creditors, attorneys, properties, related lawsuits and page-cited assertions. The system prompt forbids outside knowledge, requires verbatim quotes, distinguishes extracted from inferred, treats page text as untrusted content, and excludes the court, the SEC and the receiver from creditors.
- The worker grounds every assertion against the stored page text (exact, whitespace-normalized, or bigram-similarity above 0.9 with a confidence penalty), drops assertions whose subject the model did not declare, caps machine confidence at 0.95, and only then calls `ingest_extraction`, which matches entities within the case by normalized name and writes assertions with document, page and quote.
- Default model `claude-sonnet-5-5`. Estimated cost for the five-document sample (about 100 pages): under two dollars.

Blocker: the `ANTHROPIC_API_KEY` Edge Function secret is not set. The secure
prompt to enter it in the Supabase dashboard timed out without an answer. Set
it under Edge Functions, Secrets, in the Supabase dashboard (or ask me to
re-issue the prompt), then run:

```bash
NODE_USE_ENV_PROXY=1 npm run worker -- extract --dockets 1967,1806,1938 --titles "Order Appointing Receiver|First Status Report"
```

Planned five-document sample: Order Appointing Receiver (2018-08-17), Receiver's
First Status Report (Dkt. 107), Receiver's Motion To Approve Group 10
Distribution Plan (Dkt. 1967), SEC's Response To Group 7 Position Statements of
BMO, Citibank and Sabal (Dkt. 1806), Receiver's Motion To Approve Settlement Of
State Court Action (Dkt. 1938).

## 5. Spending

No paid services were used beyond the Supabase project itself. Lead Ocean
remains registered and disabled; no credits were purchased and no enrichment
was run. Model usage will begin only when the key above is configured, and the
first run is limited to the five-document sample.
