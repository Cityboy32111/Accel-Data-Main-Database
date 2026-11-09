# Regression Retest: Version-2 Extractor on the Same 10 Pages

Status: 2026-11-08. Project `jsfdewizzkyvbqziniou`. Baseline: the review in
[07-extraction-review.md](07-extraction-review.md). Lead Ocean and all
enrichment stayed on hold. Production was kept out of this pass: the
`pipeline-ingest` function is still at version 6, the 224 stored assertions
are untouched and all still `unverified`, the 31 open review tasks are
unchanged, and the baseline fixtures are preserved under
`fixtures/equitybuild/review-2026-11-08/`.

## 1. Changes

**Extractor schema and prompt, version 2026-11-08.2**
(`supabase/functions/pipeline-extract-test/extract-v2.ts`), deployed only as
the read-only test function `pipeline-extract-test`, which shares the
worker-token authentication and firm binding of the production function but
has no write actions.

- Every assertion carries a required `modality`: `ordered`, `approved`,
  `completed`, `reported`, `proposed`, `requested`, `recommended`,
  `alleged`, `argued` or `index_reference`. The prompt gives one example of
  each and says never to turn a request, proposal, recommendation,
  allegation or argument into an outcome.
- `conditions` preserves qualifiers verbatim ("subject to Court approval",
  "within seven days of an order dismissing the action with prejudice").
- `proceeding` names the proceeding the passage is about; a settlement,
  payment, claim or ruling in a named other action must be declared as a
  related lawsuit and attached to it, never to the main case by default.
- `page_kind` classifies the page. A table of contents yields only
  `index_reference` assertions that restate the heading as the movant's
  argument, carry the page number the heading points to, and are capped at
  confidence 0.6 so they always enter review.
- `authorities` holds case-law and statutes so they are never recorded as
  related proceedings.
- Recall rules: footnoted lenders, receiver property numbers in prose, law
  firms in counsel blocks as organizations, and litigation and regulatory
  claimants as creditors. A new `litigation_claimant` creditor type.

**Deterministic modality lint** (`worker/src/structure/modality-lint.ts`),
run after grounding and before anything would be stored. It never repairs
silently; it downgrades confidence and flags for review when: an outcome
modality sits on a sentence with request or proposal signals ("should be",
"proposed", "subject to Court approval", "will pay", "moves for",
"alleged", "contends"); an object value states an outcome word under a
non-outcome modality; a factual modality appears on a contents page (forced
to `index_reference`); a quote contains a qualifier but `conditions` is
null; or the subject is the main case while `proceeding.scope` says related
lawsuit.

**Regression checks** (`worker/test/modality-lint.test.ts`,
`worker/test/retest-regressions.test.ts`): 8 lint tests on the known
sentence patterns, and 8 fixture-based tests that read the committed retest
output and fail if the Dkt. 1938 $30,000 payment is ever a completed or
ordered payment, is attached to the main case without a flag, loses the
court-approval condition or the Pennington proceeding, or if any Dkt. 1967
contents-page assertion is anything but a flagged `index_reference` that
names the claimants and points past page 3. All 16 pass. The full suite is
48 unit tests plus the 13 database tests.

**Pending, not applied** (`supabase/pending/20261108000200_assertion_modality.sql`):
the columns the production table needs for modality, conditions, proceeding,
as-of date, referenced page and lint flags, with a constraint that an index
reference can never be confirmed as a fact.

## 2. The retest

Exactly the 10 baseline pages, same five documents, same model
`claude-sonnet-5-5`, run once through the test function with results written
to `fixtures/equitybuild/retest-2026-11-08/` and nothing written to the
database. Scoring used the baseline page labels unchanged
(`review-2026-11-08/page-labels.json`), the same matching rules, and the
original PDFs, with one convention made explicit this time: the main
receivership case is never a related proceeding, which the schema already
said. Baseline figures below are restated under that same convention where
it matters, and the raw baseline figure is shown alongside.

### 2.1 Five known failures

| Failure | Baseline | Retest | Resolved |
| --- | --- | --- | --- |
| Dkt. 1938 p. 2, $30,000 | `settlement_amount` 30000 on the main case, no modality | `proposed` "proposed payment of $30,000" on the related Pennington Circuit Court Action, conditions "subject to Court approval; within seven days of entry of an order dismissing the Circuit Court Action with prejudice", confidence 0.93 | Yes |
| Dkt. 1967 p. 3, Allred | "excluded" | `index_reference` "Receiver argues Allred's unsecured claim should be excluded", referenced page 26, confidence 0.33, flagged | Yes |
| Dkt. 1967 p. 3, Mora | "excluded" | same form, referenced page 27, flagged | Yes |
| Dkt. 1967 p. 3, Shatar | "subordinated" | "Receiver argues subordination of Shatar's unsecured claims is appropriate", referenced page 30, flagged | Yes |
| Dkt. 1967 p. 3, Terada | "excluded due to failure of documentation" | "Receiver argues Terada unsecured claim 940-551 should be excluded for failure of documentation", referenced page 29, flagged | Yes |

The page was classified `table_of_contents`; all seven of its assertions are
index references held for review, and the claimants named in the headings
are still declared as creditors, so the recall the baseline had there was
not sacrificed.

### 2.2 Citation accuracy, side by side

| Check | Baseline | Retest |
| --- | --- | --- |
| Assertions on the 10 pages | 36 | 34 |
| Quote on the cited PDF page | 36 / 36 (100%) | 34 / 34 (100%) |
| Claim supported as written | 31 / 36 (86.1%) | 33 / 34 (97.1%) |
| **Citation accurate (both)** | **31 / 36 (86.1%)** | **33 / 34 (97.1%)** |
| Modality correct | not recorded | 34 / 34 |
| Proceeding correct | not recorded | 34 / 34 |
| Flagged for review | 0 | 9 (7 index references, 1 modality conflict, 1 lint false positive) |
| Flagged and unsupported | n/a | 0 |

The one remaining failure is new and is not a modality error: on Dkt. 16
page 1 the extractor recorded "case filed_on 2018-08-17" from the ECF
header, which dates the Order (Document 16), not the case. Counsel would
read it as the case filing date. It was not flagged by the lint. Fix for the
next version: a `filed_on` fact taken from an ECF header belongs to the
document, not the case, and the lint should flag any `case` subject with a
`filed_on` predicate and a bare date.

### 2.3 Entity scorecard, side by side

Precision = TP / (TP + FP). Recall = TP / (TP + FN). N/A where a denominator
is zero. Baseline related-proceeding counts are shown both as originally
scored and restated without the five main-case items, which is the
convention the retest used.

| Type | Baseline TP/FP/FN | Baseline precision | Baseline recall | Retest TP/FP/FN | Retest precision | Retest recall |
| --- | --- | --- | --- | --- | --- | --- |
| Creditors | 15 / 0 / 7 | 1.000 (15/15) | 0.682 (15/22) | 15 / 0 / 8 | 1.000 (15/15) | 0.652 (15/23) |
| Attorneys | 2 / 0 / 0 | 1.000 (2/2) | 1.000 (2/2) | 2 / 0 / 0 | 1.000 (2/2) | 1.000 (2/2) |
| Organizations | 29 / 2 / 10 | 0.935 (29/31) | 0.744 (29/39) | 34 / 2 / 5 | 0.944 (34/36) | 0.872 (34/39) |
| Properties / assets | 5 / 0 / 6 | 1.000 (5/5) | 0.455 (5/11) | 10 / 0 / 1 | 1.000 (10/10) | 0.909 (10/11) |
| Related proceedings, as scored | 5 / 0 / 12 | 1.000 (5/5) | 0.294 (5/17) | 5 / 0 / 7 | 1.000 (5/5) | 0.417 (5/12) |
| Related proceedings, main case excluded | 5 / 0 / 7 | 1.000 (5/5) | 0.417 (5/12) | 5 / 0 / 7 | 1.000 (5/5) | 0.417 (5/12) |

Small denominators: attorneys has two predictions and two labels on these
pages, which is not enough to decide anything; related proceedings has five
predictions. Creditors (23 labeled) and organizations (36 predicted, 39
labeled) carry the evidence.

What moved and why:

- **Properties** recovered the receiver property numbers in prose
  (Properties 69, 70, 73 on Dkt. 1806 p. 3) and the two addresses in the
  Dkt. 1967 contents headings. The one miss is the "Receiver's account" on
  Dkt. 1938 p. 2, which the labels treat as an asset and the extractor
  treats as a payment source; a convention to confirm.
- **Organizations** gained Midland and UBS from the footnote, the law firm
  from the counsel block, and 4533-47 Calumet LLC from the state-court
  caption. The two false positives are the court recorded as an
  organization party (Dkt. 16 p. 1, a convention question) and "Shatar"
  typed as an organization from a short name on the contents page (same as
  baseline). "Receivership Defendants" is no longer created as a party.
- **Creditors did not improve, and regressed on one page.** On Dkt. 1806
  p. 3 the baseline had BMO, Citibank and Sabal as creditors; the retest
  declared them as parties with role `objector` and left `creditors` empty,
  and did the same for Midland and UBS (role `lender`) on p. 1. Gains
  elsewhere (City of Chicago on Dkt. 107 p. 22, Keating Law Offices on Dkt.
  1938 p. 2, the Teradas split into two creditor rows) kept the total at 15
  true positives, but the net is one more miss than baseline. Fix for the
  next version: a party the page describes as a lender, mortgagee or holder
  of an interest in estate property is a creditor on every page where it
  appears in that capacity, whatever its procedural role on that page.
- **Related proceedings** are unchanged under the same convention. The
  remaining misses are the aggregated City of Chicago matters on Dkt. 107
  p. 22 (five un-numbered groups), a short-form "Id." cite and a generic
  Seventh Circuit reference. Nothing was recorded as a proceeding that was
  not one.

### 2.4 Coverage and dropped facts

The retest produced 34 assertions against the baseline's 36. Every baseline
assertion was checked for survival:

| Baseline assertions compared | 36 |
| --- | --- |
| Baseline facts that were supported and are absent from the retest | 2 |
| Baseline facts now carried as entity roles rather than assertions | 10 (caption "has_role" facts such as "EquityBuild, Inc. is a defendant", now `party_roles` on the party) |
| Baseline facts that were unsupported and are gone | 5 (the five known failures, replaced by the corrected forms above) |

The two dropped supported facts: the main-case civil action number
"18-cv-5587" from the caption of Dkt. 107 p. 1 (a document-level fact the
pipeline already holds on the case record), and the Receiver's "Rising Tide
over Net Loss" recommended methodology from a Dkt. 1967 contents heading
(section V.D, page 44), which the version-2 contents rule did not restate as
an index reference because the heading names no claimant or property. The
second is a real loss worth recovering: contents headings that state a
recommendation should become index references too.

Seven of the nine flagged assertions are the contents-page index references
working as designed. One flag is a lint false positive ("respectfully
submits" matched the request pattern on Dkt. 107 p. 1); one is a genuine
modality conflict on Dkt. 1938 p. 2, where "entered into the settlement
agreement, subject to Court approval" was marked `completed`, which the
scorer accepted as defensible (the signing is complete, the settlement is
not) and the lint correctly held for a human.

## 3. Model usage and cost

| Run | Pages | Input tokens | Output tokens | Cost at list price |
| --- | --- | --- | --- | --- |
| Baseline, version 1 (2026-11-08) | 88 | 297,063 | 58,754 | $1.18 |
| Smoke tests during setup | 3 | about 11,000 | about 2,500 | $0.05 |
| Retest, version 2 | 10 | 54,308 | 15,054 | $0.26 |
| **Total model usage to date** | | | | **about $1.49** |

Version 2 uses about 60% more input tokens per page than version 1 because
of the longer prompt and schema. A full re-extraction of the five documents
would cost about $1.90. No Lead Ocean or other paid service was used.

## 4. Decision

**Targets.** Combined citation accuracy 97.1% (33 of 34) meets the 95%
target. Precision meets 85% in every type where there is evidence: creditors
100% (15/15), organizations 94.4% (34/36), properties 100% (10/10); related
proceedings 100% on five predictions and attorneys 100% on two are too thin
to decide and should not be read as passing.

**Five known failures.** All five are resolved, confirmed by the fixture
regression tests and by the independent scorer. The settlement is now a
proposed payment in the Pennington action with its conditions; the four
contents-page claims are flagged index references that preserve the
movant's "should be".

**What still requires lawyer review.** The settlement correction itself must
be entered by a reviewer with the right role through the correction
workflow; the retest only shows that the extractor now gets it right. The
seven Dkt. 1967 index references need a reader to open pages 26 to 30 and
confirm or reject the Receiver's recommendations. The one new citation
failure (case versus document filing date) and the Dkt. 1938 "entered into"
modality flag need a decision. The conventions that move the scorecard need
a ruling: courts as organizations, City departments as separate
organizations, aggregated municipal matters as proceedings, caption-only
parties of cited decisions, Keating Law Offices as creditor, the Receiver's
account as an asset, and the Shatar and Terada entity treatments.

**Fix and retest, or proceed to entity resolution?** This retest is an
in-sample regression check: the 10 pages were used to design the fixes, so a
clean result on them is necessary but not evidence of generalization. The
recommendation is to do both, in this order, within the same five documents:

1. Make three small follow-up changes to version 2 without a new design
   round: lenders and mortgagees are creditors regardless of procedural role
   on the page; `filed_on` from an ECF header attaches to the document; and
   contents headings that state a recommendation become index references.
2. Validate that version 2.1 on a fresh page set before anything goes to
   production (next section). Only then apply the pending migration, port
   version 2.1 into `pipeline-ingest`, and re-extract the five documents
   (about $1.90), superseding the version-1 assertions rather than deleting
   them.
3. Start entity resolution design now on the current data (BMO vs BMO Bank
   N.A., Citibank variants, Property 2 vs its address, Jerome H. Cohen vs
   Jerry Cohen); its rules do not depend on which extraction version
   produced the mentions, and running it after the re-extraction avoids
   doing the work twice.

## 5. Recommended fresh pages for the next quality check

Chosen by a stated rule, excluding the 10 pages already used and the
caption pages: for each document, the processed page whose text length is
closest to that document's median body page, and the page with the most
digits (amounts, docket numbers, dates) among the rest. Saved in
`fixtures/equitybuild/review-2026-11-08/next-fresh-pages.json`.

| Document | Page | Why |
| --- | --- | --- |
| Order Appointing Receiver, Dkt. 16 | 12 | median-length body page |
| Order Appointing Receiver, Dkt. 16 | 18 | most digits |
| Receiver's First Status Report, Dkt. 107 | 13 | median-length body page |
| Receiver's First Status Report, Dkt. 107 | 3 | most digits (retention dates and rates) |
| SEC's Response, Dkt. 1806 | 5 | median-length body page |
| SEC's Response, Dkt. 1806 | 4 | most digits |
| Settlement motion, Dkt. 1938 | 3 | median-length body page (release terms, authorities) |
| Settlement motion, Dkt. 1938 | 4 | most digits (signature block, service) |
| Group 10 motion, Dkt. 1967 | 15 | median-length body page |
| Group 10 motion, Dkt. 1967 | 5 | most digits (claim figures) |

Label these from the PDF first, as before, then score version 2.1 on them.
A broader rollout to the remaining 34 ingested documents should wait for
that result.

Everything in this report was produced by AI reviewers reading the PDFs and
the fixtures; the labels, matches and claim-support judgments have not been
checked by a person.
