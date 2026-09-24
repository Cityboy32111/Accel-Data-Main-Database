"""Collect verify/audit workflow outputs into accepted records, rejects and unverified candidates.

Usage: python3 collect.py <task_id> [<task_id> ...]
Writes accepted.json, rejects_verify.json, unverified.json, unaudited.json (cumulative over given task ids).
"""
import json, sys, os, re
BASE = '/tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2'
FP = f'{BASE}/scratchpad/fp'
sys.path.insert(0, FP)
from assemble import norm_name

CORRECTABLE = {'local_job_postings_observed', 'job_titles_observed', 'signal_published_date', 'signal_event_date',
               'signal_summary', 'city', 'street_address', 'postal_code', 'parent_company_name', 'subsegment',
               'hiring_count_scope', 'outreach_caveat', 'company_phone', 'signal_type', 'local_site_count'}

accepted, rejects, unverified, unaudited = [], [], [], []
for tid in sys.argv[1:]:
    res = json.load(open(f'{BASE}/tasks/{tid}.output'))['result']
    shard, vertical = res['shard'], res['vertical']
    shard_file = json.load(open(f'{FP}/shard_{shard}.json'))
    for i, b in enumerate(res['batches']):
        if b is None:
            continue
        rng = b['candidates']
        batch_cands = shard_file[rng['start']:rng['end']]
        results = b.get('results') or []
        got = {norm_name(r['company_name']) for r in results}
        for c in batch_cands:
            if norm_name(c['company_name']) not in got and not any(
                    norm_name(c['company_name'])[:12] == g[:12] for g in got):
                unverified.append(dict(c, shard=shard))
        verdicts = b.get('verdicts')
        vmap = {norm_name(v['company_name']): v for v in (verdicts or [])}
        for r in results:
            r['vertical'] = vertical
            r['_shard'] = shard
            if r['decision'] != 'accept':
                rejects.append({'company': r['company_name'], 'city': r.get('city', ''), 'vertical': vertical,
                                'reason': 'verification: ' + (r.get('reject_reason') or 'unspecified')})
                continue
            if verdicts is None:
                unaudited.append(r)
                continue
            v = vmap.get(norm_name(r['company_name']))
            if v is None:
                unaudited.append(r)
                continue
            if v['verdict'] == 'fail':
                rejects.append({'company': r['company_name'], 'city': r.get('city', ''), 'vertical': vertical,
                                'reason': 'audit_fail: ' + (v.get('fail_reason') or v.get('issues') or '')})
                continue
            if v['verdict'] == 'fix':
                for k, val in (v.get('corrections') or {}).items():
                    if k in CORRECTABLE and val not in (None, ''):
                        r[k] = val
            r['_audit'] = v['verdict'] + ': ' + (v.get('issues') or '')
            accepted.append(r)

json.dump(accepted, open(f'{FP}/accepted.json', 'w'), indent=1)
json.dump(rejects, open(f'{FP}/rejects_verify.json', 'w'), indent=1)
json.dump(unverified, open(f'{FP}/unverified.json', 'w'), indent=1)
json.dump(unaudited, open(f'{FP}/unaudited.json', 'w'), indent=1)
from collections import Counter
print('accepted', len(accepted), Counter(r['vertical'] for r in accepted))
print('rejects', len(rejects), 'unverified', len(unverified), 'unaudited', len(unaudited))
print(Counter(r['reason'].split(':')[0] + ':' + r['reason'].split(':')[1].strip().split(' ')[0][:40] for r in rejects).most_common(25))
