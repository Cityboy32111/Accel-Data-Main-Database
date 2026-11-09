# Extraction Report: Five-Document Sample

Status: 2026-11-08. Project `jsfdewizzkyvbqziniou`, pilot case SEC v.
EquityBuild, Inc., et al. (N.D. Ill. 1:18-cv-05587). Model `claude-sonnet-5-5`,
prompt version 2026-11-08.1, schema version 2026-11-07.1.

## 1. What ran

| Document | Pages extracted | Grounded assertions | Rejected by grounding | Tokens in / out |
| --- | --- | --- | --- | --- |
| Order Appointing Receiver (2018-08-17) | 29 of 29 | 70 | 0 | 97,504 / 17,075 |
| Receiver's First Status Report, Q3 2018 (Dkt. 107) | 25 of 46 (exhibits deferred) | 73 | 1 | 85,061 / 18,400 |
| SEC's Response To Group 7 Position Statements of BMO, Citibank and Sabal (Dkt. 1806) | 6 of 6 | 17 | 0 | 20,152 / 5,984 |
| Receiver's Motion To Approve Settlement Of State Court Action (Dkt. 1938) | 8 of 8 | 11 | 0 | 24,103 / 4,298 |
| Receiver's Motion To Approve Group 10 Distribution Plan (Dkt. 1967) | 20 of 273 (exhibits deferred) | 53 | 4 | 70,243 / 12,997 |
| **Total** | **88** | **224** | **5** | **297,063 / 58,754** |

Model cost at list prices: about $1.18 (input $0.59, output $0.59). No
other paid service was used. Lead Ocean remains disabled.

Every one of the 224 stored assertions carries a document id, a page number
and a verbatim quote that the grounding check located on that page (exact,
whitespace-normalized, or bigram similarity above 0.9 with a confidence
penalty). All 224 are `unverified`; nothing is confirmed until a reviewer
acts. Origin split: 222 `extracted`, 2 `inferred`. Average confidence 0.85.

The five rejections: one quote about SVN Chicago Commercial on page 11 of
the first status report could not be located within the similarity threshold
(a conservative miss, the fact is real), and four assertions on page 10 of the
Group 10 motion referenced entity keys the model had not declared and were
dropped as unanchored.

## 2. What was extracted

| Entity type | Count | Notes |
| --- | --- | --- |
| Parties | 65 (45 organizations, 20 individuals) after merging 19 exact-name duplicates | Includes the receiver, the SEC, the EquityBuild entities, the Cohens, affiliate LLCs, retained professionals (BrookWeiner, Whitley Penn, SVN), institutional lenders, claimants |
| Creditors | 18 (7 institutional lenders, 4 investor lenders, 1 trade creditor, 1 taxing authority, 5 other) | 5 flagged `is_individual` and therefore excluded from enrichment and export: the Teradas, Pennington (wrongful-death claimant), Allred, Mora |
| Attorneys | 4 | Kevin B. Duff and Michael Rachlis and Jodi Rosen Wine of Rachlis Duff & Peel; Benjamin J. Hanauer of the SEC |
| Properties | 8 | 4533-47 S Calumet Avenue (Property 2), Properties 69, 70, 73, the Naples and Plano properties |
| Related lawsuits | 19 | Eleven Cook County and Texas state-court actions with docket numbers (Byrd, Fireshark, Markwell, Michigan Shores, Reymone, Stewart, Watson, Pennington, 5201 Wash. Invs.), the Seventh Circuit appeals, City of Chicago building-code enforcement |
| Review tasks | 31 open: 22 `low_confidence_assertion` (threshold 0.75 from the firm's settings) plus 9 `manual` from the verification pass in Section 3 | |

Institutional lenders named as Group 7 and Group 1 or 2 creditors: BMO Bank
N.A., Citibank N.A., Sabal Capital Operations, LLC, BC57, Direct Lending
Partners. Investor lenders named: 5001 South Drexel Blvd Fund II LLC, 6951
South Merrill Fund I LLC, Capital Investors, LLC.

The coverage statement now reads: "Derived from 5 of 822 publicly posted
filings in SEC v. EquityBuild, Inc., et al. (N.D. Ill. 1:18-cv-05587). Not a
claims register. Not complete."

## 3. Independent verification

A stratified sample of 27 stored assertions (5 to 7 per document, both
origins represented) was re-checked by two independent reviewers per
assertion, each reading the full cited page: a skeptic instructed to refute
the fact, and a provenance reviewer checking the quote, the origin label and
the subject entity. A third pass reconciled the 54 verdicts.

| Call | Count | Meaning |
| --- | --- | --- |
| Confirmed | 25 | Both reviewers found the fact supported by the page with no major issue |
| Disputed | 1 | Reviewers disagreed on whether the subject was right (attorney/client direction inverted) |
| Unsupported | 1 | Both reviewers marked a major error |
| **Precision estimate** | **0.926** | 25 of 27 |

The unsupported assertion attached a $30,000 settlement payment to the main
SEC case when the page describes it as the proposed settlement of the
related Pennington wrongful-death action in the Circuit Court of Cook County,
contingent on court approval. That is exactly the kind of error the
confirmed/inferred distinction exists to catch: the row remains `unverified`
and now carries a priority-1 review task.

Nine assertions were sent to the review queue with the reviewers' notes
verbatim (one priority 1, one priority 2, seven priority 3 for minor
imprecision). Recurring patterns the reviewers identified, each with a
concrete fix for the next prompt and schema version:

1. **Dropped qualifiers.** Object values omit "subject to", "except" and
   "provided that" clauses from the same sentence. Fix: a required
   `qualifiers` field.
2. **Proposed stated as done.** Recommendations, proposed settlements and
   complaint allegations were recorded as established facts. Fix: an
   enumerated `modality` field (ordered, proposed, recommended, alleged,
   argued) set from signal words.
3. **Related-action facts attached to the main case.** Fix: forbid defaulting
   the subject to the document's case; require the specific proceeding named
   in the passage.
4. **Predicate direction.** `represented_by` was used with the attorney as
   subject; `status` was used for a litigation position. Fix: define
   subject and object direction per predicate in a controlled vocabulary.
5. **Abbreviated names and dropped identifiers.** "WPD Management" for
   "WPD Property Management LLC"; a claim number and an as-of date dropped.
   Fix: verbatim entity names and optional `identifier` and `as_of_date`
   fields.
6. **Table-of-contents citations.** One fact cited the contents page rather
   than the page where it is argued. Fix: skip index pages as evidence.

These are prompt and schema changes for the next extraction version, not
data repairs; the stored evidence stays as extracted so the before and after
can be measured on the same pages.

## 4. Defects found and fixed during the run

- **Forced tool choice rejected.** Claude Sonnet 5.5 returns 400 for
  `tool_choice: tool`. The call now steers the tool from the prompt under
  `auto` with one retry, and unwraps the `parameters` envelope the model
  places around its arguments.
- **Duplicate entities.** The normalized-name generated columns kept a
  trailing space for names ending in punctuation, so within-case matching
  never found existing rows and "EquityBuild, Inc." was created 14 times. The
  columns are trimmed (migration 20261108000100), lookups take the earliest
  match, and `app.merge_duplicate_parties` folded 19 duplicates while
  recording each merge as a rule-based resolution decision.

## 5. Quality observations for Milestone 3 tuning (not yet changed)

1. **Role words recorded as parties.** "Receiver", "Commission",
   "Receivership Defendants" and "Outside vendor retained by EquityBuild's
   DC-based counsel" were created as organizations. The prompt should direct
   generic references to the named entity and forbid descriptive placeholders.
2. **Short-name variants.** BMO vs BMO Bank N.A., Citibank vs Citibank N.A.,
   Jerome Cohen vs Jerome H. Cohen vs Jerry Cohen, Property 2 vs 4533-47 S
   Calumet Avenue. These are the Milestone 4 entity-resolution cases; the
   data is intact for it.
3. **Case-law citations as related lawsuits.** SEC v. Huber and SEC v. Wealth
   Mgmt. are precedents cited in a brief, not proceedings involving the
   estate. The schema needs a `citation` relationship or an instruction to
   exclude authorities.
4. **Caption boilerplate.** Seven low-confidence `docket_number` assertions
   repeat the main case number from page captions. Captions after page one
   should be skipped.
5. **Free-form predicates.** 37 distinct predicates such as
   `receipts_as_of_2018-09-30`. A controlled vocabulary with an `other`
   escape hatch will make the dashboard timeline and filters tractable.

## 6. Remaining blockers

None for extraction. The Base44 dashboard (Milestone 6) still needs its
sign-in URL configured in Supabase Auth, and Lead Ocean (Milestone 5) needs
an API key, requested through the secure form only when you approve that
spend.
