# Fully Promoted Boise expansion: research spec (read fully before working)

Client: Fully Promoted Boise sells standard branded apparel and promotional products (never FR or PPE certified gear).
Goal: net new COMPANY records (no people, no contacts) for Ada and Canyon counties, Idaho.
The observation date is the DATE PART of the Pacific timestamp from `TZ=America/Los_Angeles date` (so it matches accessed_at). Timestamps use the format `2026-09-23T16:21:06-07:00`; get the real
current time for every source you check by running Bash: `TZ=America/Los_Angeles date +%Y-%m-%dT%H:%M:%S%:z`.

## Geography (hard rule)
Cities in scope ONLY: Boise, Meridian, Nampa, Caldwell, Eagle, Garden City, Kuna, Star, Middleton (state ID).
The company must have a physical local presence in one of those cities (facility, office, clinic, plant, branch
or active jobsite). Remote only firms and out of state firms with no local site are OUT. Mountain Home, Emmett,
Twin Falls, Ontario OR, Payette, Fruitland, Parma, Wilder, Homedale, Melba etc. are OUT.
`city` = the in scope city of the local site you document.

## Exclusions (reject with reason)
- Already delivered: any company, parent, subsidiary, sister brand or alternate spelling listed in
  `/tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/scratchpad/fp/exclusions.json`
  (names + domains). If a candidate's parent is on that list, reject as `duplicate_of_input_parent_or_subsidiary`.
- Franchise units of national chains where apparel is centrally supplied (fast food and QSR, coffee chains, big box
  retail, national hotel flags, national fitness franchises such as Planet Fitness, Orangetheory, Anytime Fitness,
  F45, Crunch, Club Pilates). Home care franchises and auto dealership franchises are allowed.
- Staffing agencies, recruiters, job boards, PEOs.
- Government agencies, cities, counties, highway districts, state agencies, public universities and colleges
  (Boise State, CWI), public school districts and public charter schools.
- Companies whose only apparel need is FR or PPE.
- company_status other than operating (closed, acquired and folded in, dissolved).

## Evidence date rule (hard rule)
Every qualifying signal must be dated 2026-03-01 or later. NOTHING with a published date before 2026-03-01 may appear
anywhere in the record, not even as a supporting source: leave such sources out entirely.
Undated careers pages / ATS boards count only if the postings are live on the observation date; then
signal_published_date = signal_event_date = observation date (today, YYYY-MM-DD) and set `signal_date_is_observation = true`.
Undated official pages (contact, about, locations) may be used for presence and status, with accessed_at recorded.
For ATS boards that show posting dates, count ONLY postings dated 2026-03-01 or later (or undated and live).

## Qualifying signals (need at least one; signal_type must be exactly one of these five)
- `active_hiring`: two or more open LOCAL roles (in scope cities) on an official careers page or ATS
  (BambooHR, Paylocity, ADP, UKG, iCIMS, Workday, Greenhouse, Lever, ApplyToJob, Indeed Hire pages hosted by the
  employer, etc.), or a dated company hiring post (LinkedIn/Facebook company post dated >= 2026-03-01).
  Count the distinct local postings in local_job_postings_observed (integer as string) and list the titles.
  Third party job boards (Indeed, ZipRecruiter) can be supporting sources only, not the hiring_evidence_url.
- `facility_expansion_opening`: new location, ribbon cutting, groundbreaking, relocation, square footage growth
  (dated news, chamber post, city permit/planning notice, company announcement).
- `market_expansion_hiring`: entering or scaling the Boise market with named roles.
- `observed_recurring_need`: documented crew, staff or event program implying repeat apparel or merchandise
  (uniformed field teams, onboarding cohorts, community events, sponsorships, races, tournaments, team days), dated.
- `project_relationship`: named local project with the company's confirmed role (GC, sub, engineer, supplier), dated.

## Evidence standard
- Minimum two independent sources, three preferred. Independent = distinct origin_group (distinct publisher or
  domain). At least one source must be hosted off the company's own website (ATS host, LinkedIn company page,
  chamber, news, association directory, Idaho SOS, city permit, BBB, Google Maps listing, etc.).
- Confirm every cited fact yourself through the tools below. Cite ONLY URLs that a search result actually returned
  to you (or that you loaded); never construct or guess URLs, dates, counts or titles. A lead from the sourcing stage
  is a hint, not evidence: re-find it.
- Liveness of undated careers/ATS postings: the posting must appear in the CURRENT search index as open (e.g. the job
  URL is returned with apply/open wording or a recent "posted N days ago"), and your outreach_caveat must say
  "live status confirmed via search index on <Mon D, YYYY>". If you cannot confirm two live local postings, do not
  use active_hiring; look for another qualifying signal or reject.
- Each source: `{id, source_type, url, publisher, origin_group, published_date (YYYY-MM-DD or null), accessed_at, supporting_text}`.
  source_type vocabulary: official_company_site, official_employer_careers, official_employer_job, official_hiring_board,
  company_social_post, press_release, independent_reporting, local_news, trade_press, trade_directory, chamber_post,
  government_record, business_registry, professional_profile, official_event_page.
  supporting_text = short factual paraphrase of what the page shows (named roles, dates, addresses).
- `field_sources` maps field names to source ids (company_name, street_address, company_phone, local_presence_type,
  company_status, signal_summary, hiring_evidence_url, project_relationship_status as applicable).

## Tools (IMPORTANT: page loading is restricted in this environment)
- Bright Data is NOT available (its auth expired). Do not call it.
- WebFetch and curl are blocked by the network egress policy for almost every host; do not rely on them
  (one quick try is fine, but expect EGRESS_BLOCKED).
- Use WebSearch as the primary research tool. Run many targeted queries, e.g.
  `"Company Name" careers Boise`, `"Company Name" Nampa jobs 2026`, `"Company Name" ribbon cutting 2026`,
  and use `allowed_domains` to pin a site: e.g. allowed_domains ["companydomain.com"] to read its careers/contact
  content, ["bamboohr.com"], ["applytojob.com"], ["paylocity.com"], ["linkedin.com"], ["boisechamber.org"],
  ["idahobusinessreview.com"], ["boisedev.com"], ["idahopress.com"], ["idahostatesman.com"], ["ktvb.com"],
  ["nampa.com","growthzoneapp.com"] (chamber event calendars). The WebSearch answer text summarizes what those pages
  say; use it together with the returned URLs, and only cite URLs that were returned.
- Apollo: ONLY `apollo_organizations_lookup` (free) for company discovery or domain confirmation. Do NOT call any
  Apollo enrich, people, contact, reveal or match tool (they consume credits).
- Good dated sources: Idaho Business Review, Idaho Statesman, BoiseDev, KTVB, Idaho Press, Boise Metro Chamber and its
  LinkedIn, Meridian, Nampa, Caldwell, Eagle chambers (growthzoneapp event pages carry dates), city planning and
  building permit notices, company LinkedIn and Facebook posts.
- Record accessed_at (from `date`) at the time you ran the query that surfaced each source.

## Field conventions (match the existing delivered file)
- vertical: `construction_industrial`, `healthcare`, `adjacent_verticals`.
- subsegment (lowercase underscore slugs):
  - construction_industrial: commercial_civil_gc, specialty_trades, specialty_trades_plumbing_hvac,
    industrial_manufacturing, industrial_vendors, heavy_equipment_dealer_service_parts,
    civil_engineering_land_development, engineering_surveying, construction_materials_testing_geotechnical
  - healthcare: multi_clinic_primary_care, medical_specialty_groups, care_rehabilitation, dental_orthodontic,
    outpatient_therapy, behavioral_health, home_health_hospice, hospital_health_system
  - adjacent_verticals: logistics_distribution, auto_equipment_dealers, fitness_recreation, hospitality_breweries,
    private_schools_youth_sports, nonprofit_staff_events, property_management_landscaping, banks_credit_unions
- local_presence_type: local_facility, local_office, headquarters_office, multi_site_local, active_local_project,
  local_hq_multi_clinic, local_branch, project_site.
- buying_unit_key: lowercase underscore, e.g. `steed_construction_eagle`.
- buying_unit_scope: local_facility, local_headquarters, company_hq_idaho, regional_operating_office, local_branch,
  local_project_unit, multi_site_local, local_practice_group, multi_clinic_practice, local_operating_company, local_office.
- company_status: `operating` (source: live official site or dated news).
- employee_count_or_band: only if a loaded source states it (then employee_count_scope says which, e.g.
  company_website_stated, company_linkedin_band); otherwise blank with a blank_field_reason.
- local_site_count: integer string of in scope local sites you can document.
- buyer_department (the recommended seat for the eventual contact), existing vocabulary: operations,
  executive_administration, talent_hr, practice_administration, ownership_operations, regional_operations,
  human_resources, executive_operations, branch_operations, project_operations, field_operations, plant_operations,
  clinical_operations, site_operations, market_operations, administration, construction_operations.
- hiring_count_scope examples: distinct_open_requisitions_observed_boise, distinct_open_requisitions_observed_meridian,
  distinct_open_requisitions_observed_ada_canyon, distinct_open_requisitions_observed_boise_bamboohr,
  roles_listed_boise_on_careers_page, distinct_hiring_posts_observed.
- project_relationship_status examples: owner_operator, general_contractor, confirmed_current_contractor_role,
  owners_representative, engineer_of_record, announced_new_market. project_phase examples: opened_operating,
  groundbreaking_construction_underway, active_construction_support, opening_announced, operating_hiring.
- procurement_route: `unknown` or a descriptive slug like unknown_local_vs_corporate, unknown_owner_vs_office,
  practice_administrator, local_operations_likely.
- recommended_purchase_window: `confirm_timing`, unless the signal names a dated upcoming or current event, then
  `during_<mon>_2026_<event_slug>` e.g. `during_oct_2026_grand_opening`, `during_nov_2026_turkey_trot`.

## Written fields (same voice and specificity as the delivered rows)
reason_to_contact, recommended_offer, suggested_opening_line, next_question, signal_summary,
purchase_use_case_evidence, outreach_caveat, research_notes, and every supporting_text:
- Name the roles, dates, projects and locations. Example voice:
  signal_summary: "Steed Construction careers page (observed Sep 23, 2026) lists Senior Project Manager, Project Manager,
  Project Engineer, Superintendent, Senior Estimator and Estimator roles for Boise alongside Utah openings."
  suggested_opening_line: "I saw Steed Construction listing six Boise project and estimating roles on your careers page.
  Who coordinates crew apparel and new hire kits out of the Eagle office?"
  recommended_offer: "Crew and office staff apparel plus new hire onboarding kits for commercial GC project teams."
  next_question: "Does operations own field apparel decisions, or does project administration buy for the crews?"
- ABSOLUTELY NO hyphens, en dashes or em dashes in these fields (write "new hire", "multi clinic", "full time",
  "Sep 23, 2026" not "2026-09-23"; drop hyphens inside company names in prose, e.g. "Morrison Maierle"; no URLs in prose).
- Never use the words: real, really, genuinely, genuine, honestly, clearly, impressive.
- Standard branded apparel only: never offer FR or PPE gear. Offers are commercial hypotheses, not confirmed demand.
- No contact names in reason_to_contact/opening line (companies only pass); refer to the seat ("operations lead").
- suggested_opening_line starts with a concrete observation ("I saw ...") then a practical question.

## Fields that must stay blank (do not return values for them)
primary_contact_full_name, primary_contact_title, work_email, work_email_status, mobile_phone, mobile_identity_status,
contact_linkedin_url, contact_employment_source_url, contact_employment_checked_at, work_email_source_url,
email_validation_checked_at, mobile_source_url, mobile_line_type, mobile_checked_at, buyer_authority_status,
contact_route, dnc_status, dnc_checked_at, suppression_status, crm_match_status, crm_company_id, crm_contact_id,
crm_last_engagement_at.

## blank_field_reasons
For any other field you leave blank (company_phone, street_address, postal_code, employee_count_or_band, project fields,
procurement_source_url, parent_company_name, local_job_postings_observed when not hiring, etc.) give a reason slug:
not_published, not_found, not_stated, not_applicable, not_applicable_independent, not_applicable_no_named_project,
jobsite_not_published, apollo_enrichment_not_run_firmographic_not_stated.
