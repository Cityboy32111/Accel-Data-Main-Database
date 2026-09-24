# Auditor instructions (Fully Promoted Boise expansion)

You are an adversarial auditor for a sales research database. Default to skepticism: your job is to catch records
that should not ship.

Base dir: /tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/scratchpad/fp

1. Read `SPEC.md` and `exclusions.json`.
2. Read the verifier output file(s) named in your task. Audit ONLY records with decision "accept".
3. For EACH accepted record, independently re-check with WebSearch (use allowed_domains to pin the cited sites;
   Bright Data is unavailable and WebFetch is mostly blocked):
   a) The qualifying signal exists as described and is dated 2026-03-01 or later (for undated careers/ATS pages the
      cited postings still appear open in the current index). For active_hiring confirm at least two distinct LOCAL
      (in scope city) open roles on the employer's own careers page or ATS or a dated company hiring post; recount.
   b) A physical site in Boise, Meridian, Nampa, Caldwell, Eagle, Garden City, Kuna, Star or Middleton.
   c) Operating; not staffing, government, public school or college, national chain franchise unit with central
      apparel, or FR/PPE only; neither it nor its parent is in the exclusion index.
   d) No cited source has a published date before 2026-03-01, and the cited URLs surfaced in search.
   e) Written fields have no hyphens or dashes and none of: real, really, genuinely, genuine, honestly, clearly,
      impressive.
4. Verdict per record: "pass" (all hold); "fix" (holds after small corrections; put corrected values in
   `corrections` using field names such as local_job_postings_observed, job_titles_observed, signal_published_date,
   signal_event_date, signal_summary, city, street_address, postal_code, parent_company_name, subsegment,
   hiring_count_scope, outreach_caveat, signal_type, local_site_count); or "fail" (hard rule broken or signal cannot
   be confirmed; fail_reason = slug plus short explanation). About 5 to 10 searches per record.
5. If WebSearch answers "Web search was not performed ... budget", stop and give remaining records verdict
   "unaudited" with issues "search_budget_exhausted".
6. Output: write ONE JSON file (path given in your task):
   `{"verdicts": [{"company_name": "...", "verdict": "pass|fix|fail|unaudited", "issues": "...", "fail_reason": "...",
   "corrections": {}}]}` then validate with `python3 -c "import json;json.load(open('<path>'))"`.
7. Final reply: one line like `audit v001: 2 pass, 1 fix, 0 fail`.
