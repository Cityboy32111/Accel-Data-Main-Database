# Authority-Versus-Proceeding Rule: Proceedings-Page Retest

Status: 2026-11-09. Project `jsfdewizzkyvbqziniou`. Scope: the lint rule
queued by the validation report (`docs/10`), a retest on pages that
actually contain related proceedings, and the fixes that retest surfaced.
Everything here ran on the read-only test function `pipeline-extract-test`
and local post-processing; production function `pipeline-ingest`, the 224
version-1 assertions and all review statuses are untouched. Lead Ocean and
all enrichment stayed off. No live provider request was sent.

## 1. The rule

The fresh-page gate left one entity type open: a precedent cited in a
footnote (*5201 Washington*, 2024 IL App (1st) 231403-U) had been saved as a
related proceeding, and the fresh pages carried too few proceedings to
measure the type at all. The rule now in post-processing has three parts.

- **Reporter citation and no estate party.** A related lawsuit whose docket
  field or caption matches a reporter pattern (F.2d/3d/4th, F. Supp., U.S.,
  S. Ct., N.E.2d/3d, Fed. Appx, `YYYY WL n`, `YYYY IL App (…)`, Ill. 2d/App)
  and whose caption names none of the estate's parties is moved to
  `authorities`. Assertions whose subject was that row are dropped as
  authority facts; assertions pointing at it as their proceeding are flagged
  `proceeding_is_authority`.
- **Reporter citation with an estate party.** The row stays a related
  lawsuit, flagged `authority_check` for review (an appeal from this
  receivership identified only by its reporter cite).
- **The reverse direction.** An authority whose caption names an estate
  party and reads as a captioned case is promoted into related lawsuits,
  held for review, so the two Seventh Circuit appeals (*SEC v. EquityBuild,
  Inc.*, 101 F.4th 526 and 161 F.4th 1020) are not lost when the model files
  them as precedent. Decisions of the main case itself are excluded.

Estate names for the pilot case: EquityBuild, Cohen, Duff, Receiver,
4533-37 S Calumet, WPD Management, Shatar, BC57, Amark. The extractor
prompt (schema 2026-11-09.1) states the same distinction, so the model and
the post-processor agree on the definition and the post-processor is the
backstop. Every move is recorded in the bundle's `reclassified` list with
its reason, and `raw_output` keeps the model's original answer, so each
decision can be audited or reversed.

## 2. Page selection and labels

Pages were chosen by a stated rule: at least three proceeding or citation
signals on the page (captions with "v.", reporter cites, docket numbers,
"appeal", "Circuit Court", "stay"), two to three per filing, excluding
nothing that had been used before because the point was to hit pages with
proceedings. Ten pages: Dkt. 1967 pp. 4, 5, 6, 12; Dkt. 107 (first status
report) pp. 2, 21, 22; Dkt. 1806 pp. 2, 4; Dkt. 1938 p. 3. Six are new and
were labeled blind from the PDFs by independent labelers before the retest,
with an explicit authority-versus-proceeding line in each label; four reuse
labels frozen in the earlier reviews. Labels and selection are frozen in
`fixtures/equitybuild/review-2026-11-08/proceedings-page-{selection,labels}.json`.

Three of the pages (Dkt. 1967 pp. 4, 5, 6) are table-of-authorities pages
and two (Dkt. 107 pp. 21, 22) are lists of pending litigation, so this set
is deliberately harder on classification and lighter on assertions than the
earlier sets.

## 3. Results, first pass (post-processing 2026-11-09.2, out of sample)

The retest ran the ten pages once through the test function: 30 assertions
saved, 2 dropped by grounding, 3 flagged, for 60,799 input and 13,894
output tokens, about $0.26. The saved bundles were then scored by one
independent scorer per page against the frozen labels.

### 3.1 Authority versus proceeding

| Type | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| Related proceedings | 13 | 1 | 6 | 0.929 (13/14) | 0.684 (13/19) |
| Authorities | 49 | 0 | 5 | 1.000 (49/49) | 0.907 (49/54) |

Every stranger precedent on every page stayed an authority: all 16 on
Dkt. 1967 p. 4, all 13 on p. 6, the four on Dkt. 107 p. 2, the two on
Dkt. 1938 p. 3, and *5201 Washington* on Dkt. 1806 p. 4, which was the
original error. All eight Cook County and Harris County suits on Dkt. 107
pp. 21 and 22 stayed proceedings with their docket numbers. The model filed
both Seventh Circuit appeals as authorities on Dkt. 1806 p. 2 and Dkt. 1967
pp. 5 and 12; the promotion rule moved all five instances into related
lawsuits held for review, and the scorers confirmed each against the labels.

The one false positive is the pattern the promotion rule could not yet see:
on Dkt. 1967 p. 5 the model's citation for the June 20, 2024 district court
decision omitted the docket number ("SEC v. EquityBuild, Inc., 2024 WL
3069682 (N.D. Ill. June 20, 2024)"), so the main-case exclusion did not
fire and the order was promoted as a separate proceeding. On p. 12, where
the model kept "No. 18 CV 5587" in the cite, the same order correctly
stayed an authority. Fixed in section 4.

Related-proceeding misses are all one kind: the labels count the City of
Chicago's grouped municipal matters (seven housing court cases, about
twelve Buildings Department and twelve Streets and Sanitation
administrative proceedings, one Water Management matter, two noticed
violations) as proceedings, and the output schema, which wants a caption
and a docket, has nowhere to put uncaptioned grouped matters. On Dkt. 107
p. 22 that is five of the six misses; the sixth is the same "City of
Chicago related matters" line on p. 21. The authority misses are two
statutes the model did not save (Illinois Mortgage Act on Dkt. 1806 p. 2,
Illinois Fiduciary Obligations Act on p. 4) and the three EquityBuild
decisions on Dkt. 1967 p. 5, which the labels list under both headings and
the output saved once; two of those three are the intended outcome of the
rule and the third is the false positive above.

### 3.2 Citation accuracy

| Check | Count | Rate |
| --- | --- | --- |
| Quote on the cited PDF page | 30 / 30 | 1.000 |
| Claim supported as written | 28 / 30 | 0.933 |
| **Combined citation accuracy** | **28 / 30** | **0.933** |
| Modality correct | 28 / 30 | 0.933 |
| Proceeding correct | 29 / 30 | 0.967 |
| Flagged for review | 3 | |
| Material citation failures | 1 | |

The two unsupported claims:

1. Dkt. 1967 p. 12 (material): "Seventh Circuit recognized the Cohens ran a
   Ponzi scheme through EquityBuild, Inc. and EBF" was saved with predicate
   `party_position`, subject EquityBuild, Inc., scope main case. The quote
   is on the page and the substance is right, but a holding of the Court
   of Appeals was recorded as a litigation position, and it was not linked
   to the EquityBuild I row that the promotion rule had just created.
   Counsel could read a binding finding as advocacy. Fixed in section 4.
2. Dkt. 1806 p. 2 (not material): the `document_filed` value carried the
   full title "SEC's Response To Group 7 Position Statements Of BMO,
   Citibank, And Sabal Capital Operations, LLC", which is accurate
   document metadata but not on page 2. Earlier scorecards accepted the ECF
   header plus document metadata as support; this scorer did not. Under
   the earlier convention the combined figure is 29/30 (96.7%).

The two modality disagreements are the `toc_page` lint downgrading the ECF
header's `document_filed` from completed to index reference on
table-of-authorities pages. The downgrade is deliberate (nothing asserted
from a contents page is treated as a finding) and harmless, since the
assertion is already flagged and its confidence cut, but the scorers are
right that a filing stamp is a completed event. Left as is and noted for
the vocabulary decision below.

### 3.3 Entity scorecard and key facts

| Type | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| Creditors | 6 | 0 | 10 | 1.000 (6/6) | 0.375 (6/16) |
| Attorneys | 0 | 0 | 0 | no evidence | |
| Organizations | 17 | 0 | 10 | 1.000 (17/17) | 0.630 (17/27) |
| Properties / assets | 4 | 0 | 3 | 1.000 (4/4) | 0.571 (4/7) |

Precision held at 100% on every type with evidence. Recall fell, and the
misses are definitional rather than extraction slips:

- Nine of the ten creditor misses are litigation plaintiffs on the status
  report's pending-litigation pages (Byrd, Michigan Shores, Stewart, Watson,
  Reymone, Fireshark, Markwell, the City of Chicago) that the labels count
  as unliquidated claimants; the labelers' own notes call this a judgment
  call. The tenth is Pennington on Dkt. 1938 p. 3, saved as a person party
  rather than a creditor, the same miss as the fresh-page run.
- Organization misses are caption-only parties (the SEC and EquityBuild,
  Inc. inside "SEC v. EquityBuild" cites on three pages), BC57 on Dkt. 1806
  p. 2, City of Chicago sub-departments, and 7420 S. Colfax as a caption
  defendant.
- Property misses are the Collateral Agency and Servicing Agreements
  (documents, not property), "Group 1 properties" (a collective), and
  7420 S. Colfax.

Key facts: 36 of 57 captured (63%), 34 of the 36 with legal status
preserved. The one captured fact whose status changed is the Seventh
Circuit holding above; the other is a table-of-authorities row. Two correct
assertions were dropped by grounding because the PDF text layer splits
words ("O n August 17, 2018, this C ourt appointed a r eceiver",
"th e C ourt O rder"); the normalized and fuzzy matchers both missed them.
Fixed in section 4.

One material recall gap, not a wrong statement: Dkt. 107 p. 22's entire
City of Chicago code-violation section (open violations, housing court
matters, administrative proceedings with fines imposed on October 16,
2018) produced no assertion, so a reader of the output alone would think
the page reports two state-court suits. This is the grouped-matters schema
gap again, now showing up on the assertion side.

Per page (citations accurate / total, key facts captured / labeled,
related proceedings TP/FP/FN, authorities TP/FP/FN):

| Page | Citations | Key facts | Proceedings | Authorities |
| --- | --- | --- | --- | --- |
| dkt-1967 p4 (table of authorities) | 1/1 | 5/5 | 0/0/0 | 16/0/0 |
| dkt-1967 p6 (table of authorities) | 1/1 | 4/4 | 0/0/0 | 13/0/0 |
| dkt-1967 p12 | 2/3 | 2/6 | 2/0/0 | 0/0/0 |
| status-report-1 p21 | 7/7 | 6/7 | 6/0/1 | 0/0/0 |
| status-report-1 p2 | 2/2 | 1/4 | 0/0/0 | 4/0/0 |
| dkt-1806 p2 | 4/5 | 2/6 | 1/0/0 | 0/0/1 |
| dkt-1806 p4 | 4/4 | 5/7 | 0/0/0 | 1/0/1 |
| dkt-1967 p5 (table of authorities) | 1/1 | 5/5 | 2/1/0 | 13/0/3 |
| status-report-1 p22 | 2/2 | 2/8 | 2/0/5 | 0/0/0 |
| dkt-1938 p3 | 4/4 | 4/5 | 0/0/0 | 2/0/0 |

## 4. Fixes from the first pass (post-processing 2026-11-09.3)

Three patterns from section 3 are mechanical and were fixed in
post-processing, without another model call, then the saved bundles were
reprocessed and the three pages whose output changed were re-scored by
fresh scorers. These three pages are therefore no longer out of sample for
the fixed patterns; everything else in section 3 stands as measured.

1. **Main-case orders are never promoted.** An authority is also treated as
   a decision of the main case when its caption is *SEC v. EquityBuild* and
   its court is N.D. Ill. with no appellate reporter or circuit marker, so
   the June 20, 2024 order stays an authority whether or not the model kept
   the docket number. Dkt. 1967 p. 5 now lists exactly the two Seventh
   Circuit appeals, both held for review.
2. **A holding is not a position.** A new lint flag, `holding_as_position`,
   fires when a `party_position` assertion's text reports a court holding,
   recognizing, finding, ruling or affirming something; the assertion is
   flagged for review with its confidence cut. It does not rewrite the
   predicate, because deciding whether the fact belongs to the appeal or
   the main case is a reviewer's call.
3. **Split words in the text layer.** Grounding gains a `spaceless` method
   between the normalized and fuzzy matchers: a quote whose characters
   match the page exactly once all whitespace is removed is accepted as
   verbatim, with offsets mapped back to the page. Both dropped assertions
   are now saved (the August 17, 2018 appointment on Dkt. 1967 p. 12 and the
   Receiver's powers under Dkt. 16 on Dkt. 107 p. 2); four assertions that
   had matched fuzzily at a penalty now match verbatim.

### 4.1 Re-score of the three changed pages

Fresh scorers, same labels, same rules (scorecard
`proceedings-scorecard-postprocess-3.json`; the first pass is kept as
`proceedings-scorecard-postprocess-2.json`).

| Page | Citations before | Citations after | Proceedings after | Authorities after | Key facts after |
| --- | --- | --- | --- | --- | --- |
| dkt-1967 p5 | 1/1 | 0/1 | 2/0/0 (was 2/1/0) | 14/0/2 (was 13/0/3) | 4/5 |
| dkt-1967 p12 | 2/3 | 3/4 | 2/0/0 | 0/0/0 | 3/6 (was 2/6) |
| status-report-1 p2 | 2/2 | 3/3 | 0/0/0 | 4/0/0 | 2/4 (was 1/4) |

Merged over all ten pages after the fixes: 32 assertions, 32 quotes on
page, 29 supported as written (90.6%), 0 material failures, 4 flagged;
related proceedings 13 TP, 0 FP, 6 FN (precision 100%, recall 68.4%);
authorities 50 TP, 0 FP, 4 FN; key facts 37 of 57 captured, 36 with status
preserved. Entity totals for creditors, organizations and properties are
unchanged.

Two scorer disagreements move the headline number and should be read
with the per-item detail. On Dkt. 1967 p. 5 the second scorer counted the
`toc_page` downgrade of the ECF header's `document_filed` as "not supported
as written" where the first scorer had counted it supported with a wrong
modality; it is the same assertion, correct in substance, flagged, and
immaterial under both readings. On p. 12 the Ponzi-scheme holding is still
saved with the `party_position` predicate, now with the
`holding_as_position` flag, confidence 0.42 and `needs_review` true; the
scorer downgraded it from material to immaterial on the strength of the
flag while noting that the underlying defect is a reviewer's to resolve.
Counting the two convention items (header-plus-metadata support, contents
page downgrade) the way the earlier scorecards did, the figure is 31/32
(96.9%); strictly, 29/32 (90.6%). The two authority misses left on p. 5
are the labels' double listing of EquityBuild I and II, which the rule
intentionally saves once, under proceedings.

The recovered Dkt. 107 p. 2 assertion (the Receiver's powers under Dkt.
16) scored supported; the recovered Dkt. 1967 p. 12 appointment date
scored supported. Both scorers note that the main-case order on Dkt. 1967
p. 5 now stays an authority but loses its "aff'd 161 F.4th 1020" tail,
which is a citation-formatting loss the schema's single `citation` string
cannot express; the affirmance is captured on p. 12 as a key fact.

Regression: the suite gained unit tests for each fix and two gated
regression blocks on the proceedings bundles (the main-case order stays an
authority and both appeals stay flagged proceedings on Dkt. 1967 p. 5; the
holding is flagged and the appointment grounded on p. 12). Full run: 95
passed, 52 skipped by version gate; database suite 13 of 13. The earlier
retest directories were not reprocessed, so their recorded results stand
as historical records and their regression checks still pass.

## 5. Gate decision

| Target | First pass (out of sample) | After fixes | Decision |
| --- | --- | --- | --- |
| Combined citation accuracy at least 95% | 93.3% (28/30); 96.7% under the earlier header convention | 90.6% (29/32) strict; 96.9% (31/32) under the earlier conventions; 0 material failures | **Met under the earlier conventions, not met on strict scoring**; the one substantive defect is flagged for review |
| Precision at least 85%, related proceedings | 92.9% (13/14) | 100% (13/13) | **Met**, on 14 predictions across 7 pages |
| Precision at least 85%, authorities | 100% (49/49) | 100% | Met |
| Precision at least 85%, creditors | 100% (6/6) | 100% | Met on thin evidence |
| Precision at least 85%, organizations | 100% (17/17) | 100% | Met |
| Precision at least 85%, properties | 100% (4/4) | 100% | Met on thin evidence |

Related proceedings, the type the last gate left open, now has real
evidence: 14 predictions and 19 labeled items across seven pages, with one
false positive on the first pass and none after the main-case fix. The
rule does what it was queued to do. Recall for the type is limited by a
schema decision rather than by the extractor (grouped municipal matters
without captions), listed below.

Citation accuracy on this harder set is below the 95% target on strict
scoring and above it under the conventions the earlier scorecards used.
Every quote was on its page in both passes; the strict shortfall consists
of one substantive defect (the holding saved as a position, now flagged
with its confidence cut) and two convention items that no scorer called
misleading. The honest reading is that the target is met for
flagged-or-correct assertions and not met for unflagged correctness, and
that the next extractor prompt should state how a court's holding is
recorded (section 6, item 6) before the figure is re-measured out of
sample.

## 6. Decisions that need a human

1. **Creditor definition.** Are unliquidated litigation plaintiffs against
   estate entities (the Cook County suits, the City of Chicago) creditors?
   The labels say yes with a caveat; the extractor says no. Nine of ten
   creditor misses turn on this. The schema can carry them with
   `creditor_type` set to a litigation-claimant value and no amount; the
   prompt would change to match.
2. **Grouped proceedings without captions.** Should `related_lawsuits`
   accept a row with a court, a count and no caption or docket ("City of
   Chicago housing court, seven matters")? Six of six related-proceeding
   misses and the one material recall gap turn on this.
3. **Caption-only parties.** Whether the SEC and EquityBuild, Inc. must be
   saved as organizations on a page where they appear only inside a cite.
   The extractor's current behavior (no) is consistent and the labels
   disagree; this is a labeling convention to settle before the next set.
4. **Statutes as authorities.** Two statutes named on body pages were not
   saved; the prompt lists case law examples only. Low cost to add.
5. **`document_filed` on contents pages.** Keep the `toc_page` downgrade to
   index reference, or exempt the ECF header stamp. Harmless either way.
6. **Dkt. 1967 p. 12 holding.** Confirm the Ponzi-scheme finding as a
   `holding` of the EquityBuild I appeal (or of this Court, which the page
   also says) rather than a position of EquityBuild, Inc.

## 7. What is deployed where

| Component | Version | Where |
| --- | --- | --- |
| Extractor prompt and schema | 2026-11-09.1 | `pipeline-extract-test` only (v4) |
| Post-processing (grounding, lint, reclassification) | 2026-11-09.3 | worker, test path only |
| Production extractor (`pipeline-ingest`) | unchanged by this work | v7, deployed outside this session |

Nothing here touched production rows. Model spend for this checkpoint:
about $0.26 for the retest; the re-score and scoring ran on the session's
own agents. Cumulative extraction and retest spend since the start of the
pilot is about $2.30.

Observed outside this session and not governed by the controls in
`docs/10`: `pipeline-ingest` is at v7 (updated 2026-11-08T19:10Z), a new
Edge Function `apollo-match` exists and is being iterated (v1 at
2026-11-09T19:53Z, v3 at 20:09Z, JWT verification on), and a new secret
named "Apollo.io Key" is configured. The enrichment
eligibility, deduplication, provenance and audit controls built for Lead
Ocean do not run on that path. If `apollo-match` is meant to enrich
matter parties, it should be routed through the same `enrichment_jobs`
tables and the minimum-identifier payload guard before any live call, and
the spending limits in the user's instructions apply to it equally.
