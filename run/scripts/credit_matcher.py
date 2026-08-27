#!/usr/bin/env python3
"""Credit-phrase matcher for CoStar User Identification.

Implements the phrase set from spec section 7 and the exclusion/negation
rules from spec section 10 (rejected nearby language, wrong-vendor
collisions, security-filing false positives).

CLI:  credit_matcher.py < text_file        -> prints JSON verdict
API:  from credit_matcher import match
"""
import json
import sys

CREDIT_PHRASES = [
    "source: costar",
    "source: costar group",
    "according to costar",
    "costar data",
    "data from costar",
    "per costar",
    "provided by costar",
    "compiled from costar",
    "courtesy of costar",
    "as reported by costar",
    "copyright costar",
    "costar realty information",
    "costar suite",
    "costar market report",
    "market data from costar",
]

# Section 10: "Rejected nearby language, the documented false positive mode."
NEGATION_PATTERNS = [
    "we are not costar",
    "not affiliated with costar",
    "competitors like costar",
    "competitor to costar",
    "versus costar",
    "vs costar",
    "vs. costar",
    "unlike costar",
    "costar alternative",
    "switched from costar",
    "switching from costar",
    "instead of costar",
]

# Section 10: "Wrong vendor collisions, all previously encountered."
WRONG_VENDOR_PATTERNS = [
    "costar computer systems",
    "costar technologies",
    "corning costar",
    "costa rica",
    "costar brewing",
    "ecostar",
    "cobolimab",
]

# Section 10: "Any board, acquisition, ticker, CUSIP or proxy reference to
# CoStar Group as a security."
SECURITY_FILING_PATTERNS = [
    "cusip",
    "proxy statement",
    "shares of costar group",
    "csgp",
    "mutual fund",
    "outstanding shares",
]

NEGATION_WINDOW = 200  # chars scanned on either side of a matched phrase


def _find_all(haystack, needle):
    positions = []
    start = 0
    while True:
        idx = haystack.find(needle, start)
        if idx == -1:
            break
        positions.append(idx)
        start = idx + 1
    return positions


def match(text):
    if not text:
        return {"credited": False, "matched_phrase": None, "excerpt": None, "reject_reason": "empty_text"}

    lower = text.lower()

    for pat in WRONG_VENDOR_PATTERNS:
        if pat in lower:
            return {"credited": False, "matched_phrase": None, "excerpt": None, "reject_reason": f"wrong_vendor:{pat}"}

    for phrase in CREDIT_PHRASES:
        for pos in _find_all(lower, phrase):
            window_start = max(0, pos - NEGATION_WINDOW)
            window_end = min(len(lower), pos + len(phrase) + NEGATION_WINDOW)
            window = lower[window_start:window_end]

            if any(neg in window for neg in NEGATION_PATTERNS):
                continue
            if any(sp in window for sp in SECURITY_FILING_PATTERNS):
                continue

            excerpt_start = max(0, pos - 80)
            excerpt_end = min(len(text), pos + len(phrase) + 80)
            excerpt = text[excerpt_start:excerpt_end].strip()

            return {
                "credited": True,
                "matched_phrase": phrase,
                "excerpt": excerpt,
                "reject_reason": None,
            }

    return {"credited": False, "matched_phrase": None, "excerpt": None, "reject_reason": "no_phrase_match"}


if __name__ == "__main__":
    data = sys.stdin.read()
    print(json.dumps(match(data), indent=2))
