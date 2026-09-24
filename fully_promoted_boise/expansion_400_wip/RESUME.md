# Fully Promoted Boise expansion (400 companies): resumable state

Status: sourcing is done and deduped, verification is not. The run stopped because the session's research tools ran out:
Bright Data lost its authentication mid run, the container's egress policy blocks direct page loads (WebFetch and curl),
and the Claude Code WebSearch cap (`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`, default 200) was used up by the
subagents. No delivery rows have been written yet, because nothing has passed verification and adversarial audit.

## What is here

| Path | Contents |
| --- | --- |
| `exclusions.json` | Dedupe index: the 73 delivered companies, their domains and parents, plus known sister brands and subsidiaries |
| `candidates/candidates.json` | 774 unique candidates after dedupe (288 construction_industrial, 243 healthcare, 243 adjacent_verticals), with lead URL, date and note |
| `candidates/queue/v001.json` … `v097.json` | 576 candidates queued for verification, 6 per batch, verticals interleaved |
| `candidates/reserve_*.json` | 174 lower priority candidates held back (48 construction, 63 healthcare, 63 adjacent) |
| `candidates/accepted_unaudited_22.json` | 22 records a verifier accepted before the cap hit (12 healthcare, 5 construction, 5 adjacent); they still need the adversarial audit |
| `rejected_candidates_so_far.csv` | 583 rejects logged so far (581 screened out at sourcing, 2 at verification) with reasons |
| `instructions/` | `SPEC.md` (rules), `EXAMPLE_RECORD.json` (output shape), `VERIFY_AGENT.md`, `AUDIT_AGENT.md` |
| `scripts/` | `assemble.py` (77 column assembly and QA gate), `prep_candidates.py`, `salvage.py`, `collect.py` |

The input file `Fully_Promoted_Boise_delivery_complete_so_far.csv` is not committed because it holds personal
contact data. Upload it again when resuming; `assemble.py` reads it for the column order.

## Before resuming

1. Reconnect Bright Data at https://claude.ai/customize/connectors, then start a new session.
2. In the cloud environment settings, add `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` set to about 6000. Allow broader
   network access too if possible, so careers pages and ATS boards can be loaded directly.

## Resume steps

1. Copy this folder to the scratchpad and update the base paths in `instructions/*.md` and `scripts/*.py`.
2. Run the verifier on each `queue/vNNN.json`, then run the auditor on the accepted records and on
   `accepted_unaudited_22.json`.
3. If a vertical falls short of its count (160 / 120 / 120), draw from `reserve_*.json`, then backfill from the other
   verticals.
4. Assemble with `assemble.py` (it forces the contact, compliance and CRM fields blank, builds evidence_json and
   missing_fields_json, and cleans the prose), then run the QA gate and write the two CSVs.
