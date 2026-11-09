# Review of the Five-Document Extraction Sample

Status: 2026-11-08. Read-only review of the Milestone 3 sample against the
original PDFs stored in the private bucket (local copies under
`fixtures/equitybuild/downloads/`). No extraction was rerun, no stored row was
changed, Lead Ocean and all enrichment stayed on hold. This is an AI-assisted
review; Section 6 lists what still needs a human signature.

## 1. The flagged $30,000 settlement (priority-1 review task)

**Document.** Receiver's Motion To Approve Settlement Of State Court Action,
filed 2026-01-05, Dkt. 1938, 8 pages. Reviewed PDF pages 1 through 3.

**What the filing says.** Page 1, paragraph 1: on October 14, 2021, Jerrine
Pennington, as Special Administrator for the Estate of Valerie Pennington,
Deceased, filed a complaint in the Law Division of the Circuit Court of Cook
County captioned *Jerrine Pennington as Special Administrator of the Estate of
Valerie Pennington, Deceased v. 4533-47 Calumet LLC, 4533-37 S Calumet LLC, and
WPD Management, LLC*, Case No. 2021 L 010115 (the "Circuit Court Action"),
alleging that the decedent, a tenant at 4533-47 S Calumet Avenue (Property
No. 2), died as a result of the defendants' alleged negligence. Page 2,
paragraph 4: the Receiver and Pennington "entered into the settlement
agreement attached hereto as Exhibit A (the 'Settlement Agreement'), subject
to Court approval." Page 2, paragraph 5: "Pursuant to the proposed Settlement
Agreement, and with the Court's approval," (a) Pennington will move to dismiss
the Circuit Court Action with prejudice within seven days of an approval
order, and (b) "within seven (7) days of entry of an order dismissing the
Circuit Court Action with prejudice, the Receiver will pay thirty thousand
dollars ($30,000) from the Receiver's account, by check payable to Jerrine
Pennington on behalf of the Estate of Valerie Pennington, Deceased, and
Keating Law Offices, P.C., in full settlement of their claims." Page 3,
paragraph 5(c) and (d): no admission of liability; all claims between the
Receiver, the Receivership Estate, WPD and Pennington released, and
Pennington "will receive nothing further."

| Element | Evidence |
| --- | --- |
| Proceeding | Pennington v. 4533-47 Calumet LLC, 4533-37 S Calumet LLC and WPD Management, LLC, No. 2021 L 010115, Circuit Court of Cook County, Law Division (a wrongful-death action against estate entities and the property manager) |
| Parties to the settlement | Kevin B. Duff as Receiver for the Receivership Estate; Jerrine Pennington as Special Administrator; WPD released as well |
| Amount | $30,000, paid from the Receiver's account to Pennington on behalf of the Estate of Valerie Pennington and Keating Law Offices, P.C. |
| Status in this filing | **Proposed.** The motion asks the Court to approve it; payment is conditioned on an approval order and then an order dismissing the Circuit Court Action with prejudice. The filing does not describe the settlement as approved or paid. |

**Stored assertion.** Subject: the main case, SEC v. EquityBuild, Inc., et
al.; predicate `settlement_amount`; value 30000; origin `extracted`;
confidence 0.95; cited to Dkt. 1938 page 2 with the quote "the Receiver will
pay thirty thousand dollars ($30,000)"; status `unverified`.

**Verdict.** The quote is on the cited page and the amount is right, but the
assertion is unsupported as written. It names the wrong proceeding (the SEC
enforcement case rather than the related Circuit Court Action), drops the
modality (proposed and conditional, not agreed-final or paid), and omits the
payees. Read from the dashboard it would say the SEC case settled for $30,000,
which the page does not say. The two independent reviewers on 2026-11-08
reached the same conclusion.

**Recommended correction** (for a human reviewer to enter through the
correction workflow, which supersedes the old row and keeps it for audit):

- Subject: the related proceeding *Pennington v. 4533-47 Calumet LLC et al.*,
  No. 2021 L 010115, Circuit Court of Cook County (already present as a
  related-lawsuit entity from this document).
- Predicate: `proposed_settlement_amount`, or `settlement_amount` with a
  modality of `proposed` once the schema carries that field.
- Value: 30000 USD, with qualifiers: payable by the Receiver within seven
  days of an order dismissing the Circuit Court Action with prejudice;
  conditioned on this Court's approval; payees Jerrine Pennington on behalf
  of the Estate of Valerie Pennington, Deceased, and Keating Law Offices,
  P.C.; no admission of liability.
- Citation: Dkt. 1938, page 2, paragraph 5(b), same quote.

Context outside this sample, not reviewed here: the 39 ingested documents
include a later order granting this motion (Dkt. 1946, 2026-01-21), which is
where the status would move from proposed to approved.

The stored assertion and its `unverified` status were left unchanged, as
instructed.

## 2. Page selection

Rule fixed before any extraction output was inspected: for each document,
page 1 (caption, parties and counsel) plus the densest processed page after
page 2 by PDF text length; for Dkt. 1938 the flagged settlement page replaces
the densest page. Page 1 was chosen because it concentrates named parties and
counsel; the densest body page because it carries the most substantive
content per page.

| # | Document | PDF page | Rationale |
| --- | --- | --- | --- |
| 1 | Order Appointing Receiver, Dkt. 16 | 1 | caption and parties |
| 2 | Order Appointing Receiver, Dkt. 16 | 5 | densest body page (2,777 characters) |
| 3 | Receiver's First Status Report, Dkt. 107 | 1 | caption and parties |
| 4 | Receiver's First Status Report, Dkt. 107 | 22 | densest body page (2,569 characters) |
| 5 | SEC's Response To Group 7 Position Statements, Dkt. 1806 | 1 | caption and parties |
| 6 | SEC's Response To Group 7 Position Statements, Dkt. 1806 | 3 | densest body page (2,152 characters) |
| 7 | Receiver's Motion To Approve Settlement Of State Court Action, Dkt. 1938 | 1 | caption and parties |
| 8 | Receiver's Motion To Approve Settlement Of State Court Action, Dkt. 1938 | 2 | flagged settlement page (mandated) |
| 9 | Receiver's Motion To Approve Group 10 Distribution Plan, Dkt. 1967 | 1 | caption and parties |
| 10 | Receiver's Motion To Approve Group 10 Distribution Plan, Dkt. 1967 | 3 | densest body page after the contents page (2,854 characters) |

Method: each page was labeled from the PDF page image and text layer by a
labeler that had no access to the extraction output; a separate scorer then
compared those labels with the saved per-page output and checked every
stored assertion cited to the page. Matching treated name variants of the
same real-world entity as a match, counted generic role words and
placeholders as false positives, and counted precedent citations recorded as
related proceedings as false positives.

## 3. Entity scorecard (10 pages)

Counts are summed over the 10 pages. Precision is TP / (TP + FP); recall is
TP / (TP + FN). A category with a zero denominator is marked N/A rather than
scored, and the counts are shown so sparse categories stay visible.

| Entity type | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| Creditors | 15 | 0 | 7 | 1.000 (15/15) | 0.682 (15/22) |
| Attorneys | 2 | 0 | 0 | 1.000 (2/2) | 1.000 (2/2) |
| Organizations | 29 | 2 | 10 | 0.935 (29/31) | 0.744 (29/39) |
| Properties / assets | 5 | 0 | 6 | 1.000 (5/5) | 0.455 (5/11) |
| Related proceedings | 5 | 0 | 12 | 1.000 (5/5) | 0.294 (5/17) |

Per page (TP/FP/FN per type, then citation checks):

| Page | Creditors | Attorneys | Organizations | Properties | Related proc. | Quote on page | Claim supported |
| --- | --- | --- | --- | --- | --- | --- | --- |
| appointment-order p1 | 0/0/0 | 0/0/0 | 3/0/0 | 0/0/0 | 0/0/1 | 6/6 | 6/6 |
| appointment-order p5 | 0/0/0 | 0/0/0 | 0/1/0 | 0/0/0 | 0/0/0 | 1/1 | 1/1 |
| status-report-1 p1 | 0/0/0 | 0/0/0 | 3/0/0 | 0/0/0 | 0/0/1 | 5/5 | 5/5 |
| status-report-1 p22 | 0/0/3 | 0/0/0 | 3/0/3 | 0/0/0 | 2/0/5 | 2/2 | 2/2 |
| dkt-1806 p1 | 3/0/2 | 0/0/0 | 5/0/2 | 3/0/0 | 0/0/2 | 3/3 | 3/3 |
| dkt-1806 p3 | 3/0/1 | 0/0/0 | 4/0/3 | 1/0/3 | 1/0/1 | 3/3 | 3/3 |
| dkt-1938 p1 | 1/0/0 | 0/0/0 | 5/0/1 | 1/0/0 | 1/0/1 | 4/4 | 4/4 |
| dkt-1938 p2 | 1/0/1 | 0/0/0 | 1/0/0 | 0/0/1 | 1/0/0 | 3/3 | 2/3 |
| dkt-1967 p1 | 0/0/0 | 2/0/0 | 2/0/1 | 0/0/0 | 0/0/1 | 4/4 | 4/4 |
| dkt-1967 p3 | 7/0/0 | 0/0/0 | 3/1/0 | 0/0/2 | 0/0/0 | 5/5 | 1/5 |

**What is behind the numbers.**

- The two organization false positives are a generic role term
  ("Receivership Defendants", Dkt. 16 p. 5) and "Shatar" typed as an
  organization from a table-of-contents heading that gives only a surname-like
  short name (Dkt. 1967 p. 3).
- Creditor misses: the Group 6 lenders Midland and UBS named only in a
  footnote (Dkt. 1806 p. 1); DLP named only inside a quoted prior ruling
  (Dkt. 1806 p. 3); Fireshark Enterprises, Markwell and the City of Chicago as
  litigation and regulatory claimants (Dkt. 107 p. 22); Keating Law Offices
  as co-payee of the settlement check (Dkt. 1938 p. 2).
- Property misses: receiver Properties 69, 70 and 73 mentioned in running
  prose (Dkt. 1806 p. 3); two addresses inside a contents heading (Dkt. 1967
  p. 3); the "Receiver's account" as a funding source (Dkt. 1938 p. 2), which
  is arguably a placeholder rather than an asset.
- Related-proceeding misses are dominated by two labeling conventions. Five
  of the 12 are the receivership action itself, which the extraction schema
  explicitly excludes ("not the main case itself"), so under the project's
  own convention they are not misses. Five more are aggregated, un-numbered
  groups of City of Chicago housing-court and administrative matters on Dkt.
  107 p. 22 (for example "approximately twelve Buildings Department
  proceedings"), which no page-level extractor could record as discrete
  proceedings. The remaining two are a short-form "Id." citation to the
  Seventh Circuit appeal and a generic reference to prior appeals.

| Related proceedings, recall under each convention | FN | Recall |
| --- | --- | --- |
| As scored by the labelers | 12 | 5/17 = 0.294 |
| Excluding the main case (matches the schema) | 7 | 0.417 (5/12) |
| Also excluding aggregated municipal matters | 2 | 0.714 (5/7) |

Precision is unchanged under every convention because no related proceeding
on these pages was a false positive; the case-law-as-proceeding problem
noted in the earlier report did not occur on the 10 selected pages.

## 4. Citation accuracy (36 stored assertions on the 10 pages)

| Check | Numerator / denominator | Rate |
| --- | --- | --- |
| Quote is on the cited PDF page | 36 / 36 | 1.000 |
| Claim supported as written (right proceeding, parties, qualifiers) | 31 / 36 | 0.861 |
| **Citation accurate (both checks pass)** | **31 / 36** | **0.861** |

Every quote was found on its cited page, so the grounding check is doing its
job. All five failures are claim-support failures of one kind, modality:

1. Dkt. 1938 p. 2, the $30,000 settlement (Section 1): wrong proceeding and
   proposed stated as settled.
2. to 5. Dkt. 1967 p. 3, four "treatment" assertions for Allred, Mora, Shatar
   and the Teradas whose object values read "excluded" or "subordinated"
   where the page, a table of contents, says the Receiver argues the claim
   "Should Be Excluded" or that subordination "Is Appropriate". The
   recommendation of a movant was stored as the court's disposition.

## 5. Gates

| Gate | Result | Decision |
| --- | --- | --- |
| Citation accuracy at least 95% | 86.1% (31/36) | **Not met.** The miss is systematic (modality), not random. |
| Precision at least 85%, creditors | 100% (15/15) | Met |
| Precision at least 85%, organizations | 93.5% (29/31) | Met |
| Precision at least 85%, attorneys | 100% (2/2) | **Too little evidence**: two predictions on 10 pages |
| Precision at least 85%, properties | 100% (5/5) | Met on thin evidence; recall is the problem (45%) |
| Precision at least 85%, related proceedings | 100% (5/5) | Met on thin evidence; recall depends on convention (29% to 71%) |

Recall has no gate in the plan, but at 45% for properties and under 70% for
creditors the directory would miss claimants a lawyer expects to see, and the
coverage statement on every view is what keeps that honest in the meantime.

## 6. Recommendation and human sign-off

**Recommendation: fix and retest within the same five documents before
entity resolution.** The citation gate fails on a single, well-understood
cause that a prompt and schema change addresses: a required `modality` field
(ordered, proposed, recommended, alleged, argued) and an instruction never to
state a movant's request as a disposition, plus treating table-of-contents
pages as index material rather than evidence. The same pass should take the
recall fixes that the misses point to: read footnotes, record receiver
property numbers in prose, record law firms as organizations when they
appear in a counsel block, and type litigation and regulatory claimants as
creditors. Then re-extract these five documents and re-score the same 10
pages against the same labels, which costs about $1.20 of model usage and a
few minutes. Entity resolution (BMO vs BMO Bank N.A., Citibank variants,
Property 2 vs its address) can be designed in parallel, but running it on
assertions that are about to be superseded would only have to be repeated.

Findings that need a human signature before anything changes:

1. The settlement correction in Section 1, entered through the correction
   workflow by a reviewer with the right role. I did not change the row.
2. The four Dkt. 1967 p. 3 treatment assertions: reject or correct to
   "proposed" treatment.
3. Labeling conventions the scorecard depends on: whether the main case
   counts as a related proceeding (the schema says no), whether aggregated
   municipal matters count, whether City departments are separate
   organizations, whether parties named only in a cited decision's caption
   or a quoted prior ruling count, whether Keating Law Offices is a creditor,
   and whether the "Receiver's account" is an asset.
4. The "Shatar" typing and the Terada single-party treatment.
5. Approval to spend about $1.20 on the re-extraction once the prompt and
   schema changes are in.

Everything in this report was produced by AI reviewers reading the PDFs; the
page labels, the matching decisions and the claim-support judgments have not
been checked by a person.

