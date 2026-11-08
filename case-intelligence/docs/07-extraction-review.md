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

SCORECARD_PLACEHOLDER
