# Verifier instructions (Fully Promoted Boise expansion)

You verify candidate companies and write delivery records for the Fully Promoted Boise territory database
(branded apparel and promotional products; companies only, no contacts).

Base dir: /tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/scratchpad/fp

1. Read fully: `SPEC.md` (rules), `EXAMPLE_RECORD.json` (exact output shape of one accepted record),
   `exclusions.json` (already delivered companies, parents, brands).
2. Read your batch file (path given in your task). Its candidates are sourcing hints only: lead URLs and notes may be
   wrong, stale or from aggregators. Re-verify everything yourself.
3. For EACH candidate decide:
   - Exclusions: not in or owned by anything in the exclusion index; not staffing, government, public school or public
     college, national chain franchise unit with central apparel, FR/PPE only, closed. Identify any parent company.
   - Geography: a physical site in Boise, Meridian, Nampa, Caldwell, Eagle, Garden City, Kuna, Star or Middleton,
     with a source (address on official site, chamber listing, news, ATS posting location).
   - Status: operating, with a source.
   - A qualifying signal dated 2026-03-01 or later (or live undated postings as of the observation date) per the spec;
     pick the strongest as signal_type. For active_hiring you need two or more distinct LOCAL open roles on the
     employer's official careers page or ATS (or a dated company hiring post); list titles in job_titles_observed and
     the count in local_job_postings_observed. Never count postings dated before 2026-03-01.
   - At least two independent sources (distinct publishers/domains, one hosted off the company website), three
     preferred. Leave out any source published before 2026-03-01.
   - All checks hold: decision "accept", fill every field as in the example (buyer_department = recommended seat;
     no contact names anywhere). Written fields name roles, dates, projects and locations and contain NO hyphens or
     dashes, no ISO dates, no URLs, none of the banned words (real, really, genuinely, genuine, honestly, clearly,
     impressive).
   - Any check fails: decision "reject" with a reject_reason slug plus a short explanation, e.g.
     "no_signal_on_or_after_2026_03_01: careers page shows one Boise role", "out_of_scope_city: only site is Emmett",
     "national_franchise_unit", "staffing_agency", "parent_in_input_file: owned by The Pennant Group",
     "under_two_independent_sources".
4. Tools: WebSearch is the primary tool (many targeted queries; use allowed_domains to pin a site, e.g. the company
   domain, its ATS host, linkedin.com, boisechamber.org, idahobusinessreview.com, boisedev.com, growthzoneapp.com).
   Only cite URLs that search results returned. Free `mcp__Apollo_io__apollo_organizations_lookup` is allowed for
   domain confirmation (load via ToolSearch). Never call any other Apollo tool, and never Bright Data.
   WebFetch/curl are blocked by egress policy for most hosts. Timestamps: Bash
   `TZ=America/Los_Angeles date +%Y-%m-%dT%H:%M:%S%:z` (use as accessed_at; the observation date is its date part).
   Budget about 10 to 18 searches per candidate. Be strict: fewer solid records beat padded ones.
5. If WebSearch ever answers "Web search was not performed ... budget", STOP researching. Mark every candidate you
   have not finished as decision "reject", reject_reason "unverified_search_budget_exhausted", write the file, and
   say so in your reply.
6. Output: write ONE JSON file (path given in your task) containing
   `{"batch_id": "<id>", "results": [ <one record object per candidate, in order> ]}`
   Every result has company_name, decision, city, vertical, and for accepts all example fields.
   After writing, validate with Bash: `python3 -c "import json;json.load(open('<path>'))"` and fix until it parses.
7. Final reply: a single line like `v001: 3 accepted, 3 rejected` (plus a note if search budget ran out).
