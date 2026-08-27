#!/usr/bin/env python3
import json
import sys
sys.path.insert(0, "run/scripts")
from write_gate import validate_row

BASE_GOOD = {
    "Entity Legal Name": "Example Realty Advisors LLC",
    "Primary Domain": "examplerealtyadvisors.com",
    "Source URL": "https://www.examplerealtyadvisors.com/research/q2-2026-market-report",
    "Evidence Excerpt": "Source: CoStar. Vacancy fell 40 basis points in the second quarter.",
    "Evidence Date": "2026-07-15",
    "Evidence Date Method": "visible_date",
    "Evidence Label": "Attributed",
    "Callable": "Yes",
    "Trigger Event": "Opened new office in Austin, TX",
    "Trigger Date": "2026-06-10",
    "Trigger Date Method": "visible_date",
    "Trigger Source URL": "https://www.examplerealtyadvisors.com/news/austin-office-opening",
}

cases = []

# Control: should PASS
cases.append(("control_should_pass", dict(BASE_GOOD), True, []))

# 1. Placeholder entity name
row = dict(BASE_GOOD)
row["Entity Legal Name"] = "N/A"
cases.append(("placeholder_name", row, False, ["entity_name_placeholder"]))

# 2. CoStar-owned host as source
row = dict(BASE_GOOD)
row["Source URL"] = "https://www.costar.com/article/some-market-report"
cases.append(("costar_owned_host", row, False, ["source_url_costar_owned_host"]))

# 3. LinkedIn source URL
row = dict(BASE_GOOD)
row["Source URL"] = "https://www.linkedin.com/posts/example-realty_q2-market-report"
cases.append(("linkedin_source", row, False, ["source_url_linkedin"]))

# 4. Missing Evidence Date
row = dict(BASE_GOOD)
row["Evidence Date"] = ""
row["Evidence Date Method"] = ""
cases.append(("missing_evidence_date", row, False, ["evidence_date_missing", "evidence_date_method_unapproved"]))

# 5. Callable=Yes but missing Trigger fields
row = dict(BASE_GOOD)
row["Trigger Event"] = ""
row["Trigger Date"] = ""
row["Trigger Date Method"] = ""
row["Trigger Source URL"] = ""
cases.append(("callable_missing_trigger", row, False, [
    "trigger_event_missing", "trigger_date_missing",
    "trigger_date_method_unapproved", "trigger_source_url_invalid",
]))

results = []
all_correct = True
for name, row, expect_accept, expect_reasons in cases:
    accepted, reasons = validate_row(row)
    correct = (accepted == expect_accept) and (not expect_accept or True)
    if not expect_accept:
        # every expected reason must appear
        correct = correct and all(r in reasons for r in expect_reasons)
    all_correct = all_correct and correct
    results.append({
        "case": name,
        "expected_accept": expect_accept,
        "actual_accept": accepted,
        "actual_reasons": reasons,
        "correct": correct,
    })

print(json.dumps({"all_correct": all_correct, "cases": results}, indent=2))
