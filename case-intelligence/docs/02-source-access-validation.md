# Source-Access Validation Plan

Status: proposed, awaiting approval. Version 0.1, 2026-11-07.

The pipeline ingests nothing from a source until that source has passed the
checklist below and a `sources` row exists with `status = validated`. The
checklist results are stored on the row, so every document can be traced back
to the authorization that permitted its acquisition.

## 1. Source classes

| Class | Definition | Examples | MVP status |
| --- | --- | --- | --- |
| Receiver-published public record | Documents the court-appointed receiver posts publicly to notify claimants and the public, typically under the appointment order | EquityBuild receivership site (rdaplaw.net) | Pilot source |
| Public court mirror | Free public archives of court filings | CourtListener RECAP (Free Law Project), GovInfo | Secondary source, token required |
| Fee-based court system | Systems that charge per page and have usage terms | PACER | Excluded from MVP. Future use only through the firm's own account, with fee acknowledgement and explicit written authorization. |
| State court portals | Varies by state; many prohibit automated access or require registration | Cook County Clerk, state e-filing systems | Excluded from MVP |
| Authorized upload | PDFs a firm user uploads with an attestation of authority | Client-provided filings, discovery the firm is entitled to hold | Supported with attestation |

## 2. Validation checklist (per source)

Each item records a result, a timestamp, the reviewer, and an evidence link.

1. **Legal basis.** Is the material a public record, published by an
   authorized party, or provided under an attestation? Record the basis.
2. **Terms of use review.** Read the site's terms and any API terms. Record
   the URL, the review date, and any clauses that constrain use: rate limits,
   redistribution, commercial use, attribution, credential sharing, FCRA.
3. **Robots and technical courtesy.** Fetch `robots.txt`, record the result,
   and set a per-source rate limit at or below any stated limit, defaulting to
   one request every three seconds with a single connection and a
   descriptive `User-Agent`.
4. **Access test.** Fetch one index page and one document without any
   credentials. Record the HTTP status, content type, and whether any
   interstitial, CAPTCHA, or login appeared. Any of those three fails the
   source. The system never attempts to solve a CAPTCHA or reuse a session.
5. **Restriction screening rules.** Define which markers in the source's
   listings or documents indicate sealed, restricted, or confidential
   material, and confirm the screening stage detects them on a sample.
6. **Redistribution posture.** Decide whether the firm stores a copy (private
   bucket, firm-scoped) or links out only. Default: store a private copy for
   citation stability, link to the original URL, never republish publicly.
7. **Data sensitivity.** Note whether the source routinely contains personal
   data about individuals (investor lists, addresses) and set the screening
   and masking rules accordingly.
8. **Approval.** A firm admin approves the source in the dashboard. The
   approval is an audit event.

A source is re-validated every 90 days or whenever a fetch returns an
unexpected status, a terms-change notice, or a new interstitial.

## 3. Pilot source findings (completed 2026-11-07)

### 3.1 EquityBuild Receivership document site

- URL: `https://rdaplaw.net/equitybuild-receivership/`
- Case: SEC v. EquityBuild, Inc., et al., No. 18-cv-5587 (N.D. Ill.), Judge
  Manish S. Shah (previously Judge John Z. Lee). Receiver: Kevin B. Duff,
  Rachlis Duff & Peel, LLC.
- Legal basis: the receiver publishes filings so that claimants can follow
  the case. The page states, "You may access documents filed in the lawsuit by
  clicking on the links below." No login, no fee, no interstitial.
- Robots: `robots.txt` disallows only `/wp-admin/`. Document PDFs under
  `/wp-content/uploads/` are allowed.
- Access test: index page returned HTTP 200 with 816 links, of which 809 are
  PDFs. Documents are grouped into four sections with docket numbers and
  filing dates in the link text, which gives us structured metadata without
  guessing:

  | Section | Documents |
  | --- | --- |
  | Orders | 472 |
  | Claims Process | 249 |
  | Other Pleadings | 52 |
  | Status Reports | 50 |

- Content fit: the record covers an estate of more than one hundred Chicago
  properties, institutional lenders who objected to fee applications and
  distribution plans (for example BMO, Citibank, Sabal Capital), investor
  lenders organized into claim groups, settlements with third parties, a
  state court action, and Seventh Circuit appeals. This gives every entity
  table in the data model something real to hold.
- Restriction markers: none observed in the link titles. Some fee
  applications state that certain exhibits are "Not Included", which the
  screening stage records as a gap rather than treating as a complete
  document.
- Sensitivity: claims process documents include names of individual
  investor-claimants. These are public filings, but the individuals are
  retail victims. The default policy excludes individuals from enrichment and
  export (Architecture, Section 6).
- Rate limit chosen: one request every three seconds, single connection,
  downloads scheduled outside business hours in Central Time where possible.
- Pilot subset: approximately 40 documents chosen to exercise every entity
  type rather than the full 809. Candidates: the order appointing the
  receiver, the four most recent quarterly status reports plus two early
  ones, the claims process orders for two property groups, institutional
  lender objections, three settlement motions, the state court settlement
  motion, and the Seventh Circuit opinion. The remaining documents can be
  queued after the pilot proves the extraction quality.

### 3.2 CourtListener RECAP (secondary)

- Terms reviewed at `https://www.courtlistener.com/terms/` (redirects to the
  Free Law Project wiki; last modified 2026-08-05).
- Relevant clauses: API access requires an account token; rate limits apply
  per access level and may not be circumvented with multiple accounts or
  credential rotation; credentials may not be shared or pooled, and a product
  or team is asked to arrange a commercial agreement; data may not be used
  for any FCRA purpose; republished data must not imply Free Law Project
  endorsed an AI-generated analysis.
- Decision: use RECAP in the MVP only to cross-check docket metadata for the
  pilot case using a single token the firm registers, within the published
  limits. Before any multi-firm or production use, open a conversation with
  Free Law Project about a commercial agreement. The search for the pilot
  case returned 88 RECAP results, so coverage exists.
- Attribution: any dashboard view that shows RECAP-derived metadata names
  CourtListener as the source and shows the system's own confidence and
  verification labels, so no analysis is attributed to Free Law Project.

### 3.3 PACER (excluded)

PACER's published guidance asks automated users to limit large pulls to
6 p.m. to 6 a.m. Central Time, warns that courts may suspend access for
operational disruption, and bars sharing material obtained under a fee
exemption. The MVP does not touch PACER. A future integration would use the
firm's own account, the official authentication and Case Locator APIs, the
firm's explicit written authorization, and a per-case fee budget.

## 4. Authorized uploads

Uploads are the only path for documents that are not from a validated public
source. The upload flow:

1. The user selects a case and a file.
2. The user accepts an attestation: they are authorized to possess the
   document and to have it processed for this matter; it is not sealed; no
   protective order bars this use; and they indicate whether it is privileged.
3. The attestation is stored with the user's identity, timestamp, and the
   attestation text version.
4. Only then is a signed upload URL issued. The screening stage runs on the
   file regardless of the attestation; a sealed marker halts processing and
   opens a review task.
5. Privileged uploads are excluded from enrichment and from any cross-case
   entity resolution.

## 5. What the system refuses to do

- Solve or route around CAPTCHAs, rate-limit challenges, or login walls.
- Use credentials other than those the firm registered for its own use.
- Ingest any document whose listing or first pages carry a sealed or
  restricted marker, until a reviewer clears it with a documented basis.
- Enrich or export individuals.
- Describe any creditor list as complete, or omit the coverage statement.
- Present an enriched or inferred fact as confirmed.

## 6. Environment prerequisites for implementation

This session's cloud environment ("Accel Outbound") currently allows no
external hosts beyond package registries and MCP servers. Direct fetches of
`rdaplaw.net` and `www.courtlistener.com` failed with name resolution errors
for that reason, while the same pages were reachable through the Firecrawl
connector, which is how the findings above were gathered. Before Milestone 2,
the environment needs these hosts allowed:

- `rdaplaw.net` (pilot source)
- `www.courtlistener.com` and `storage.courtlistener.com` (secondary source)
- the Supabase project host, `<project-ref>.supabase.co`
- `api.anthropic.com` is already reachable

A request to add them will be made at the start of Milestone 2 so you can
approve it with the context in front of you.
