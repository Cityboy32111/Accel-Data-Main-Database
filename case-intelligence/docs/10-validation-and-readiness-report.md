# Validation and Readiness Report

Status: 2026-11-08. Project `jsfdewizzkyvbqziniou`. Scope: extractor fixes
and regression (checkpoint 1), fresh-page validation (checkpoint 2), entity
alias resolution (checkpoint 3), Base44 handoff (checkpoint 4), enrichment
readiness (checkpoint 5). Production function `pipeline-ingest` was not
redeployed; the 224 version-1 assertions and all review statuses are
untouched; Lead Ocean stayed off and no provider request was sent.

## 1. Checkpoint 1: fixes and regression

Extractor version 2026-11-08.3 (test function only):

- **Document date versus case date.** An ECF header now yields
  `document_filed` with the document named in the value and the date as
  `as_of_date`; the lint flags any `case` subject with `filed_on` and a bare
  date or an ECF-header quote. On Dkt. 16 page 1 the output is now
  "Order Appointing Receiver, Dkt. 16" filed, as of 2018-08-17.
- **Lenders stay creditors.** A party the page describes as a lender,
  mortgagee or holder of an estate interest is a creditor on every page
  where it appears in that capacity, whatever its procedural role, including
  lenders named in footnotes. Dkt. 1806 page 3 now lists BMO, Citibank and
  Sabal as creditors; page 1 lists them plus Midland and UBS. A page-level
  `lender_not_creditor` warning catches any slip.
- **Contents headings that state a recommendation** become index references
  too (the "Rising Tide over Net Loss" miss).

Regression: the suite now runs against every committed retest directory
with version gates, so the five earlier fixes are checked on the version
2.1 output as well. Result on the original 10 pages with version 2.1: all
five earlier checks hold, both new checks pass, 38 assertions, 7 flagged
(all contents-page index references). Model usage 57,638 input and 16,340
output tokens, about $0.28. Full unit suite: 80 passed, 18 skipped by
version gate; database suite 13 of 13.

## 2. Checkpoint 2: fresh-page validation

Ten fresh pages, two per filing, chosen by a stated rule (closest to the
document's median body-page length, and most digits among the rest),
excluding every page used before. They were labeled blind from the PDFs
before extraction and the labels frozen in
`fixtures/equitybuild/review-2026-11-08/fresh-page-labels.json`. The
version-2.1 run on those pages produced 43 assertions, none dropped by
grounding, none flagged, for 57,548 input and 14,337 output tokens, about
$0.26.

### 2.1 Citation accuracy (fresh pages, version 2.1)

| Check | Count | Rate |
| --- | --- | --- |
| Quote on the cited PDF page | 43 / 43 | 1.000 |
| Claim supported as written (modality, conditions, proceeding) | 43 / 43 | 1.000 |
| **Combined citation accuracy** | **43 / 43** | **1.000** |
| Modality correct | 43 / 43 | 1.000 |
| Proceeding correct | 43 / 43 | 1.000 |
| Flagged for review | 0 | |
| Material citation failures | 0 | |

Side by side with the earlier runs on the original 10 pages: version 1
31/36 (86.1%), version 2 33/34 (97.1%), version 2.1 on fresh pages
43/43 (100%). The fresh result is out of sample: the pages were chosen by
rule, labeled blind, and not used to design any fix.

### 2.2 Entity scorecard (fresh pages)

| Type | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| Creditors | 6 | 0 | 2 | 1.000 (6/6) | 0.750 (6/8) |
| Attorneys | 3 | 0 | 0 | 1.000 (3/3) | 1.000 (3/3) |
| Organizations | 14 | 0 | 7 | 1.000 (14/14) | 0.667 (14/21) |
| Properties / assets | 4 | 0 | 4 | 1.000 (4/4) | 0.500 (4/8) |
| Related proceedings | 1 | 1 | 2 | 0.500 (1/2) | 0.333 (1/3) |

Per page (citations accurate / total, key facts captured / labeled):

| Page | Citations | Key facts |
| --- | --- | --- |
| appointment-order p12 | 5/5 | 6/6 |
| appointment-order p18 | 4/4 | 4/6 |
| status-report-1 p13 | 4/4 | 4/6 |
| status-report-1 p3 | 9/9 | 6/8 |
| dkt-1806 p5 | 4/4 | 4/6 |
| dkt-1806 p4 | 4/4 | 5/7 |
| dkt-1938 p3 | 4/4 | 4/5 |
| dkt-1938 p4 | 5/5 | 4/7 |
| dkt-1967 p15 | 3/3 | 6/7 |
| dkt-1967 p5 | 1/1 | 3/5 |

Key-fact recall, a new measure for this run: 46 of 63
lawyer-salient facts (73%) were captured, and every captured fact
kept its legal status (46 of 46).

**Small denominators.** Related proceedings has two predictions and three
labels; attorneys three; properties four predictions and eight labels. Only
creditors (8 labeled) and organizations (21 labeled) carry real evidence.

**What is behind the misses.** Organization misses are mostly entities that
appear only inside a cited case caption or a footnote citation (the SEC and
EquityBuild in "SEC v. EquityBuild" precedent cites on Dkt. 1967 p. 5 and
Dkt. 107 p. 3), which the extractor correctly files under authorities, plus
the SEC consenting in a paragraph on Dkt. 1938 p. 4. Property misses are
aggregate or generic assets the labels counted ("Receivership Funds",
"89 properties encumbered by 24 loans", "real property in the estate"),
which are not identifiable assets. Creditor misses are "Group 7 investors"
as an unnamed collective and Pennington on Dkt. 1938 p. 3, where the page
releases her claims without naming her as a claimant (she is a creditor on
pages 1 and 2 of the same filing). Key-fact misses are second-order
qualifications (the receiver's fiduciary status, notice by website posting,
what a position statement does not argue) rather than operative facts.

**Material errors found (two).**

1. Dkt. 1806 p. 4: *5201 Washington*, 2024 IL App (1st) 231403-U, a
   precedent cited in a footnote, was saved as a related proceeding with
   relationship `appeal`. This is the authority-versus-proceeding error
   noted in the first review, now recurring, and it is the one related
   proceedings false positive. Fix queued: a lint rule that any related
   lawsuit whose docket field matches a reporter citation pattern (F.4th,
   WL, IL App, N.E.3d) and names no estate party is moved to authorities and
   flagged. Not fixed in this pass.
2. Dkt. 1938 p. 3: Pennington omitted from creditors on a page that
   releases her claims. Recall, not precision; the entity exists as a
   creditor from the other pages.

### 2.3 Gate decision

| Target | Result | Decision |
| --- | --- | --- |
| Combined citation accuracy at least 95% | 100% (43/43), out of sample | **Met** |
| Precision at least 85%, creditors | 100% (6/6) | Met |
| Precision at least 85%, organizations | 100% (14/14) | Met |
| Precision at least 85%, properties | 100% (4/4) | Met on thin evidence |
| Precision at least 85%, attorneys | 100% (3/3) | Too little evidence |
| Precision at least 85%, related proceedings | 50% (1/2) | **Too little evidence to decide, and the one miss is a known pattern** |

The gate passes for citation accuracy and for every entity type with
sufficient evidence. Related proceedings is not cleared: before any broader
rollout the authority-versus-proceeding rule above must be in place and
measured on pages that actually contain related proceedings. The fresh set
had almost none, which is itself a lesson for the next page-selection rule.


## 3. Checkpoint 3: entity alias resolution

Applied after the gate, within the five-document sample, on the existing
production rows, with nothing deleted or renamed. Method: deterministic
blocking rules (`worker/src/resolve/blocking.ts`: exact core name after legal
suffixes, alias match, token subset, person name variants with nicknames and
middle initials, surname-only references, receiver property numbers, docket
numbers with reporter citations excluded) proposed 54 candidate pairs; 18
ambiguous pairs went to two independent adjudicators with different
instructions (a paralegal and a skeptical steward), each required to give a
rationale, and all 18 agreed; `scripts/resolve-apply.mjs` wrote the result.

| Written | Count |
| --- | --- |
| `entity_resolution_decisions` rows this pass (plus 19 from the earlier exact-duplicate merge) | 54 (73 total): 37 rule merges, 11 adjudicated merges, 18 rule distinct, 7 adjudicated distinct |
| `entity_links` with predicate `same_as` (duplicate row to canonical row) | 23 |
| Party rows | 65 before, 65 after (none deleted) |
| Distinct party clusters | 45 |
| Assertions | 224 before, 224 after |
| Review tasks of type `entity_resolution` opened | 31, one for every decision that was not an exact rule |
| Audit rows for the decisions | 73 |

Clusters formed: the SEC (five name forms including "Commission"), the
Cohens' name variants (Jerome H. / Jerome / Jerry; Shaun D. / Shaun), Kevin
B. Duff with the role term "Receiver", BMO, Citibank, Direct Lending
Partners, EquityBuild Finance, BrookWeiner, Whitley Penn, SVN, WPD,
Prometheum, the Rachlis Duff firm with its initialism, Jerrine Pennington
with her surname-only and administrator forms, Property 2 with its address,
the Naples property, and the Pennington Circuit Court Action with its
descriptive duplicate. Kept distinct by decision, with rationale: EquityBuild,
Inc. versus EquityBuild Finance, LLC (parent and subsidiary); "Receivership
Defendants" and "The Cohens" (collectives); Valerie Pennington (decedent)
versus the administrator; the two Michigan Shores actions (different
dockets).

Reversibility: `scripts/resolve-apply.mjs --undo <decision_id>` removes the
same_as link, clears the cluster ids for the pair, marks the decision
distinct with a timestamped note and dismisses its review task. The path was
exercised inside a transaction that was rolled back, so the data is
unchanged, and the counts before and after matched.

Left for a human: the Seventh Circuit appeal rows (EquityBuild I, EquityBuild
II, the 23-1870 docket and the 101 F.4th 526 citation) were not linked,
because the only evidence is reporter citations, which the rules refuse to
treat as docket numbers; they sit in the review queue as undecided. The 31
open `entity_resolution` tasks are the adjudicated merges and the
non-exact rule merges, each with its rationale.

## 4. Checkpoint 4: Base44 handoff

Written as [09-base44-handoff.md](09-base44-handoff.md): connection with the
publishable key only, invite-only sign-in, firm membership and roles, the
read model (views that carry origin, status, confidence, citation and
coverage), ten-minute signed URLs for private PDFs made with the user's own
token, the review and audit RPCs, what the dashboard must not do, and the
three items that need the dashboard owner (Site URL and redirect URLs,
first reviewer invite, review-queue scope).

## 5. Checkpoint 5: enrichment readiness

**What exists.** The provider framework in `worker/src/enrich/`:

- `provider.ts`: a provider sees only `name`, `domain`, `linkedin_url` or
  `website`; any other payload key is rejected by `assertMinimumIdentifiers`.
  Internal ids, case, docket, claim and matter data never enter a request.
- `leadocean.ts`: the Lead Ocean adapter mirrors the account's existing MCP
  surface (one company by website domain, one record per lookup). It refuses
  name-only lookups. The only transport implemented is the dry run, which
  records the request with the credential redacted and returns a local
  fixture; it fails closed when no fixture exists.
- `controls.ts`: eligibility requires an organization (never an individual),
  the creditor's `enrichment_allowed` opt-in, at least one reviewer-confirmed
  court-record assertion naming it, a reviewer-confirmed domain, the provider
  enabled and keyed, and headroom under the daily cap; deduplication refuses
  a second lookup of the same domain within 30 days; provenance turns a result
  into an `enrichment_results` row (raw and normalized), `enriched` assertions
  capped at confidence 0.9 that can never be auto-confirmed, and an audit
  event naming the exact endpoint and payload.
- Tests: 11 cases over fixtures, including individuals refused, missing
  opt-in or confirmation refused, 30-day deduplication, redaction in dry
  run, and the payload guard.

**Dry run against the pilot case** (`scripts/enrichment-dry-run.mjs`, read
only, no provider request): seven institutional-lender creditor rows exist
(BC57, BMO, BMO Bank N.A., Citibank, Citibank N.A., Direct Lending Partners,
Sabal Capital Operations, LLC). None is eligible today, each for the same
five reasons: no opt-in, no reviewer-confirmed assertion, no confirmed
domain, provider disabled, credential missing.

**Credential availability.** The Edge Function secrets contain no
`LEADOCEAN_API_KEY`; the "Accel Case Intelligence" environment holds no Lead
Ocean network secret; the `leadocean` provider row is disabled. A Lead Ocean
connector is attached to this Claude account, which means the account has
Lead Ocean access, but the pipeline needs its own API key held as an Edge
Function secret, and nothing in this session has called that connector.

**Expected cost.** Lead Ocean meters usage in records: one company lookup
is one record. The proposed pilot is three lookups, three records, with the
30-day deduplication preventing repeats. The dollar value of a record
depends on the account's plan; the account-status call that would report it
is itself a provider request and was not made.

**Proposed first live pilot.** Up to three institutional organizations named
as lenders in the court record, chosen because they carry the most
court-record evidence in the sample: BMO Bank N.A., Citibank N.A., and Sabal
Capital Operations, LLC (BMO and Citibank each have a short-name alias row
that resolution links to the canonical row). Individuals are excluded by
rule, and the request for each would contain exactly one field, the
reviewer-confirmed website domain.

**What is needed to authorize the live pilot**, in order:

1. A reviewer confirms at least one court-record assertion for each of the
   three organizations (for example BMO's Group 7 position statement on
   Dkt. 1806) through the confirm RPC.
2. A reviewer records the website domain for each as a confirmed fact (a
   manual, confirmed assertion with predicate `domain`), since the filings
   do not state domains and the adapter will not guess them.
3. A firm admin sets `enrichment_allowed = true` on those three creditor
   rows and `enabled = true` on the `leadocean` provider row.
4. The Lead Ocean API key is entered as the Edge Function secret
   `LEADOCEAN_API_KEY` through the secure prompt or the dashboard, and the
   live transport is added behind an explicit `--live` flag that is off by
   default.
5. Written approval of the three-record spend and of the provider's terms.

Nothing in this list has been done; the stop point is before any live
request.

## 6. Model usage and cost to date

| Run | Input tokens | Output tokens | Cost |
| --- | --- | --- | --- |
| Version 1, five documents (88 pages) | 297,063 | 58,754 | $1.18 |
| Smoke tests | about 11,000 | about 2,500 | $0.05 |
| Version 2 regression (10 pages) | 54,308 | 15,054 | $0.26 |
| Version 2.1 regression (10 pages) | 57,638 | 16,340 | $0.28 |
| Version 2.1 fresh pages (10 pages) | 57,548 | 14,337 | $0.26 |
| **Total** | | | **about $2.03** |

No paid service other than Supabase and the model was used.
