#!/usr/bin/env python3
"""Write gate for run/hits.csv rows, per spec section 11.

validate_row(row: dict) -> (accepted: bool, reasons: list[str])

Dedup (registrable domain / normalized name+state) is enforced at the
file-append layer, not per-row, since it needs whole-file context.
"""
import json
import sys
from urllib.parse import urlparse

COSTAR_OWNED_HOSTS = {
    "costar.com", "www.costar.com",
    "loopnet.com", "www.loopnet.com",
    "apartments.com", "www.apartments.com",
    "str.com", "www.str.com",
    "ten-x.com", "www.ten-x.com",
    "tenx.com", "www.tenx.com",
    "homes.com", "www.homes.com",
    "bizbuysell.com", "www.bizbuysell.com",
    "landsofamerica.com", "www.landsofamerica.com",
    "costarpowerbrokers.com", "www.costarpowerbrokers.com",
    "matterport.com", "www.matterport.com",
    "apartmentfinder.com", "www.apartmentfinder.com",
    "forrent.com", "www.forrent.com",
    "landandfarm.com", "www.landandfarm.com",
    "cityfeet.com", "www.cityfeet.com",
    "costargroup.com", "www.costargroup.com",
}

PLACEHOLDER_NAMES = {"", "data", "www", "n/a", "na", "vendor", "unknown", "tbd", "none"}

EXCLUDED_ENTITIES = {
    "lee & associates", "lee and associates", "lucatia",
    "jll", "cbre", "colliers international", "colliers",
    "crexi", "reonomy", "compstak", "placer", "moody's analytics",
}

APPROVED_DATE_METHODS = {"visible_date", "http_last_modified", "pdf_metadata"}


def _host(url):
    try:
        return urlparse(url or "").netloc.lower()
    except Exception:
        return ""


def validate_row(row):
    reasons = []

    name = (row.get("Entity Legal Name") or "").strip().lower()
    if name in PLACEHOLDER_NAMES:
        reasons.append("entity_name_placeholder")
    if name in EXCLUDED_ENTITIES:
        reasons.append("excluded_entity")

    src = row.get("Source URL") or ""
    if not src.startswith("https://"):
        reasons.append("source_url_not_https")
    host = _host(src)
    if host in COSTAR_OWNED_HOSTS:
        reasons.append("source_url_costar_owned_host")
    if "linkedin.com" in host:
        reasons.append("source_url_linkedin")
    if "brightdata" in src.lower() or "luminati" in src.lower() or ".proxy." in host:
        reasons.append("source_url_is_proxy")

    excerpt = row.get("Evidence Excerpt") or ""
    if not excerpt.strip():
        reasons.append("evidence_excerpt_missing")

    ev_date = (row.get("Evidence Date") or "").strip()
    ev_method = row.get("Evidence Date Method") or ""
    if not ev_date or ev_date.lower() == "not found":
        reasons.append("evidence_date_missing")
    if ev_method not in APPROVED_DATE_METHODS:
        reasons.append("evidence_date_method_unapproved")

    callable_flag = str(row.get("Callable", "")).strip().lower() in ("yes", "true", "1")
    evidence_label = (row.get("Evidence Label") or "").strip().lower()

    if evidence_label == "declared" and callable_flag:
        reasons.append("declared_row_marked_callable")

    if callable_flag:
        tr_event = row.get("Trigger Event") or ""
        tr_date = (row.get("Trigger Date") or "").strip()
        tr_method = row.get("Trigger Date Method") or ""
        tr_src = row.get("Trigger Source URL") or ""

        if not tr_event.strip():
            reasons.append("trigger_event_missing")
        if not tr_date or tr_date.lower() == "not found":
            reasons.append("trigger_date_missing")
        if tr_method not in APPROVED_DATE_METHODS:
            reasons.append("trigger_date_method_unapproved")
        if not tr_src.startswith("https://"):
            reasons.append("trigger_source_url_invalid")
        tr_host = _host(tr_src)
        if tr_host in COSTAR_OWNED_HOSTS or "linkedin.com" in tr_host:
            reasons.append("trigger_source_url_excluded_host")

    return (len(reasons) == 0, reasons)


if __name__ == "__main__":
    row = json.loads(sys.stdin.read())
    ok, reasons = validate_row(row)
    print(json.dumps({"accepted": ok, "reasons": reasons}, indent=2))
