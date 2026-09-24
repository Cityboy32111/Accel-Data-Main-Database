"""Assemble verified Fully Promoted Boise records into the 77 column delivery schema and run QA.

Usage: python3 assemble.py records.json selection.json out_dir qa_ts
  records.json   list of verified+audited record dicts (verifier schema, audit corrections applied)
  selection.json {"quotas": {...}} optional
"""
import csv, json, re, sys, datetime
from urllib.parse import urlparse

BASE = '/tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/scratchpad/fp'
INPUT = f'{BASE}/input.csv'
with open(INPUT, encoding='utf-8-sig') as fh:
    _r = csv.DictReader(fh)
    COLUMNS = _r.fieldnames
    INPUT_ROWS = list(_r)
assert len(COLUMNS) == 77

CITIES = {'Boise', 'Meridian', 'Nampa', 'Caldwell', 'Eagle', 'Garden City', 'Kuna', 'Star', 'Middleton'}
SIGNAL_TYPES = {'active_hiring', 'facility_expansion_opening', 'market_expansion_hiring',
                'observed_recurring_need', 'project_relationship'}
VERTICALS = {'construction_industrial', 'healthcare', 'adjacent_verticals'}
CUTOFF = datetime.date(2026, 3, 1)
TODAY = datetime.date(2026, 9, 23)

CONTACT_BLANK = ['primary_contact_full_name', 'primary_contact_title', 'work_email', 'work_email_status',
                 'mobile_phone', 'mobile_identity_status', 'contact_linkedin_url', 'contact_employment_source_url',
                 'contact_employment_checked_at', 'work_email_source_url', 'email_validation_checked_at',
                 'mobile_source_url', 'mobile_line_type', 'mobile_checked_at', 'buyer_authority_status',
                 'contact_route']
COMPLIANCE_BLANK = ['dnc_status', 'dnc_checked_at', 'suppression_status']
CRM_BLANK = ['crm_match_status', 'crm_company_id', 'crm_contact_id', 'crm_last_engagement_at']
FORCED_BLANK = CONTACT_BLANK + COMPLIANCE_BLANK + CRM_BLANK
DEFAULT_REASON = {**{c: 'companies_only_pass_contact_level_deferred' for c in CONTACT_BLANK},
                  **{c: 'companies_only_pass_not_checked' for c in COMPLIANCE_BLANK},
                  **{c: 'companies_only_pass_crm_not_checked' for c in CRM_BLANK}}

PROSE = ['reason_to_contact', 'recommended_offer', 'suggested_opening_line', 'next_question', 'signal_summary',
         'purchase_use_case_evidence', 'outreach_caveat', 'research_notes']
BANNED = re.compile(r'\b(real|really|genuinely|genuine|honestly|clearly|impressive)\b', re.I)
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def norm_name(s):
    s = (s or '').lower()
    s = re.sub(r'\(.*?\)', ' ', s)
    s = s.replace('&', ' and ')
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    stop = {'inc', 'llc', 'llp', 'co', 'company', 'corp', 'corporation', 'the', 'ltd', 'pllc', 'pc', 'pa', 'of',
            'idaho', 'boise', 'group', 'and'}
    return ' '.join(w for w in s.split() if w not in stop)


def reg_domain(url_or_domain):
    s = (url_or_domain or '').strip().lower()
    if not s:
        return ''
    if '://' not in s:
        s = 'http://' + s
    host = urlparse(s).hostname or ''
    host = host[4:] if host.startswith('www.') else host
    parts = host.split('.')
    return '.'.join(parts[-2:]) if len(parts) >= 2 else host


def iso_to_prose(m):
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return f'{MONTHS[mo - 1]} {d}, {y}' if 1 <= mo <= 12 else m.group(0)


def clean_prose(t):
    t = t or ''
    t = re.sub(r'https?://\S+', '', t)
    t = re.sub(r'\b(20\d\d)-(\d\d)-(\d\d)\b', iso_to_prose, t)
    t = re.sub(r'\breal estate\b', 'property', t, flags=re.I)
    t = t.replace('\u2014', ', ').replace('\u2013', ' to ').replace('\u2012', ' ').replace('\u2011', ' ')
    t = re.sub(r'\s+-{1,2}\s+', ', ', t)
    t = re.sub(r'\bK-12\b', 'K12', t, flags=re.I)
    t = re.sub(r'(?<=[A-Za-z0-9])-(?=[A-Za-z0-9])', ' ', t)
    t = t.replace('-', ' ')
    t = re.sub(r' ,', ',', t)
    t = re.sub(r',\s*,', ',', t)
    t = re.sub(r'\s{2,}', ' ', t).strip()
    return t


def parse_date(s):
    try:
        return datetime.date.fromisoformat((s or '')[:10])
    except ValueError:
        return None


def build_index():
    ex = json.load(open(f'{BASE}/exclusions.json'))
    names = {norm_name(n) for n in ex['names'] if norm_name(n)}
    domains = {reg_domain(d) for d in ex['domains']}
    return names, domains


def build_row(rec, qa_ts):
    row = {c: '' for c in COLUMNS}
    for c in COLUMNS:
        v = rec.get(c)
        if v is None:
            continue
        if isinstance(v, bool):
            v = 'true' if v else 'false'
        row[c] = str(v).strip()
    for c in FORCED_BLANK:
        row[c] = ''
    row['state'] = 'ID'
    row['company_status'] = 'operating'
    for c in PROSE:
        row[c] = clean_prose(row[c])

    sources = []
    for s in rec.get('sources', []):
        sources.append({'id': s.get('id'), 'source_type': s.get('source_type'), 'url': s.get('url'),
                        'audit_reference': None, 'publisher': s.get('publisher'),
                        'origin_group': s.get('origin_group'), 'published_date': s.get('published_date') or None,
                        'accessed_at': s.get('accessed_at'),
                        'supporting_text': clean_prose(s.get('supporting_text', ''))})
    by_url = {}
    for s in sources:
        by_url.setdefault((s['url'] or '').rstrip('/'), s)
    all_ts = sorted(s['accessed_at'] for s in sources if s.get('accessed_at'))
    last_ts = all_ts[-1] if all_ts else qa_ts

    def ts_for(url):
        s = by_url.get((url or '').rstrip('/'))
        return (s or {}).get('accessed_at') or last_ts

    row['company_status_checked_at'] = ts_for(row['company_status_source_url'])
    row['signal_checked_at'] = ts_for(row['signal_source_url'])
    if rec.get('signal_date_is_observation'):
        # observation date must equal the date part of the Pacific accessed_at timestamp
        obs = row['signal_checked_at'][:10]
        old = parse_date(row['signal_published_date'])
        new = parse_date(obs)
        if new and old and old != new:
            fmt = lambda d: f'{MONTHS[d.month - 1]} {d.day}, {d.year}'
            for c in PROSE:
                row[c] = row[c].replace(fmt(old), fmt(new))
        if new:
            row['signal_published_date'] = row['signal_event_date'] = obs
    row['hiring_checked_at'] = ts_for(row['hiring_evidence_url']) if row['hiring_evidence_url'] else ''
    row['qa_status'] = 'pass'
    row['qa_checked_at'] = qa_ts
    row['independent_source_count'] = str(len({reg_domain(s['url']) for s in sources if s['url']}))

    derivations = {
        'recommended_offer': {'inputs': ['signal_summary', 'purchase_use_case_evidence'],
                              'method': 'commercial_hypothesis_not_confirmed_demand'},
        'suggested_opening_line': {'inputs': ['signal_summary'], 'method': 'observation_plus_practical_question'},
        'reason_to_contact': {'inputs': ['signal_summary', 'buyer_department'], 'method': 'synthesis_of_sourced_facts'},
        'buyer_department': {'inputs': ['subsegment', 'signal_type'], 'method': 'recommended_seat_no_named_contact'},
    }
    row['evidence_json'] = json.dumps({'sources': sources, 'field_sources': rec.get('field_sources') or {},
                                       'derivations': derivations}, ensure_ascii=False)

    reasons = {k: v for k, v in (rec.get('blank_field_reasons') or {}).items() if k in COLUMNS}
    missing = {}
    for c in COLUMNS:
        if row[c] == '' and c not in ('record_id',):
            missing[c] = reasons.get(c) or DEFAULT_REASON.get(c) or (
                'not_applicable_no_named_project' if c.startswith('project_') else
                'not_applicable_not_hiring_signal' if c in ('local_job_postings_observed', 'hiring_evidence_url',
                                                             'hiring_checked_at', 'hiring_count_scope') else
                'apollo_enrichment_not_run_firmographic_not_stated' if c in ('employee_count_or_band',
                                                                             'employee_count_scope') else
                'not_applicable_independent' if c == 'parent_company_name' else 'not_found')
    if rec.get('signal_date_is_observation'):
        missing['signal_published_date'] = 'observation_date_undated_page'
        missing['signal_event_date'] = 'observation_date_undated_page'
    row['missing_fields_json'] = json.dumps(missing, ensure_ascii=False)
    return row


def qa_row(row, rec):
    errs = []
    if row['city'] not in CITIES:
        errs.append(f"city_out_of_scope:{row['city']}")
    if row['vertical'] not in VERTICALS:
        errs.append(f"bad_vertical:{row['vertical']}")
    if not re.fullmatch(r'[a-z0-9_]+', row['subsegment'] or ''):
        errs.append('bad_subsegment_slug')
    if row['signal_type'] not in SIGNAL_TYPES:
        errs.append(f"bad_signal_type:{row['signal_type']}")
    for c in ('signal_published_date', 'signal_event_date'):
        d = parse_date(row[c])
        if d is None:
            errs.append(f'{c}_missing')
        elif c == 'signal_published_date' and not (CUTOFF <= d <= TODAY):
            errs.append(f'{c}_out_of_window:{row[c]}')
        elif c == 'signal_event_date' and d < CUTOFF:
            errs.append(f'{c}_before_cutoff:{row[c]}')
    if not row['signal_source_url'].startswith('http'):
        errs.append('signal_source_url_missing')
    if not row['local_presence_source_url'].startswith('http'):
        errs.append('local_presence_source_url_missing')
    if not row['company_status_source_url'].startswith('http'):
        errs.append('company_status_source_url_missing')
    if row['signal_type'] == 'active_hiring':
        try:
            n = int(re.match(r'\d+', row['local_job_postings_observed']).group(0))
        except Exception:
            n = 0
        if n < 2:
            errs.append('active_hiring_under_two_postings')
        if not row['hiring_evidence_url'].startswith('http'):
            errs.append('hiring_evidence_url_missing')
    if row['signal_type'] == 'project_relationship' and not row['project_name']:
        errs.append('project_relationship_without_project_name')
    if int(row['independent_source_count'] or 0) < 2:
        errs.append('under_two_independent_sources')
    ev = json.loads(row['evidence_json'])
    urls = {(s['url'] or '').rstrip('/') for s in ev['sources']}
    for c in ('signal_source_url', 'local_presence_source_url', 'company_status_source_url', 'hiring_evidence_url'):
        if row[c] and row[c].rstrip('/') not in urls:
            errs.append(f'{c}_not_in_evidence')
    for s in ev['sources']:
        d = parse_date(s.get('published_date'))
        if d and d < CUTOFF:
            errs.append(f"source_before_cutoff:{s['id']}:{s['published_date']}")
        if not s.get('accessed_at'):
            errs.append(f"source_missing_accessed_at:{s['id']}")
        if not re.fullmatch(r'2026-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d', s.get('accessed_at') or ''):
            errs.append(f"source_accessed_at_format:{s['id']}")
    for c in PROSE:
        if re.search(r'[-\u2012\u2013\u2014\u2015]', row[c]):
            errs.append(f'dash_in:{c}')
        if BANNED.search(row[c]):
            errs.append(f'banned_word_in:{c}:{BANNED.search(row[c]).group(0)}')
    for s in ev['sources']:
        if BANNED.search(s.get('supporting_text') or ''):
            errs.append(f"banned_word_in_supporting_text:{s['id']}")
    for c in PROSE[:6]:
        if not row[c]:
            errs.append(f'empty_prose:{c}')
    if 'FR ' in row['recommended_offer'] or 'PPE' in row['recommended_offer'].replace('not PPE', ''):
        if not re.search(r'(not|never|no)\s+(FR|PPE)', row['recommended_offer']):
            errs.append('offer_mentions_fr_ppe')
    w = row['recommended_purchase_window']
    if not (w == 'confirm_timing' or re.fullmatch(r'during_[a-z]{3}(_[a-z]{3})?_2026_[a-z0-9_]+', w)):
        errs.append(f'bad_purchase_window:{w}')
    for c in FORCED_BLANK:
        if row[c]:
            errs.append(f'forced_blank_filled:{c}')
    if not row['buyer_department']:
        errs.append('buyer_department_missing')
    return errs


def dedupe_key(rec):
    return norm_name(rec.get('company_name')), reg_domain(rec.get('company_domain') or rec.get('company_website'))


if __name__ == '__main__':
    pass
