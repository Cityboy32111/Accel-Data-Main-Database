"""Merge sourcing outputs, dedupe against the input file and each other, write candidates + early rejects."""
import json, sys, re
sys.path.insert(0, '/tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/scratchpad/fp')
from assemble import norm_name, reg_domain, build_index, CITIES

TASKS = '/tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/tasks'
OUT = '/tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/scratchpad/fp'
BIG_GENERIC = {'linkedin.com', 'facebook.com', 'indeed.com', 'google.com', 'glassdoor.com', 'yelp.com',
               'ziprecruiter.com', 'instagram.com', 'bebee.com'}

files = sys.argv[1:]
ex_names, ex_domains = build_index()
seen_names, seen_domains = {}, {}
cands, rejects = [], []
order = {'construction_industrial': 0, 'healthcare': 1, 'adjacent_verticals': 2}
for f in files:
    res = json.load(open(f'{TASKS}/{f}.output'))['result']
    v = res['vertical']
    for sc in res['results']:
        for so in sc.get('screened_out') or []:
            rejects.append({'company': so.get('company_name', ''), 'city': so.get('city', ''), 'vertical': v,
                            'reason': 'sourcing_screen: ' + so.get('reason', '')})
        for c in sc.get('candidates') or []:
            c = dict(c, vertical=v, scope=sc['scope'])
            n = norm_name(c['company_name'])
            d = reg_domain(c.get('company_domain'))
            if d in BIG_GENERIC:
                d = ''
            reason = None
            if c.get('city') not in CITIES:
                reason = f"city_out_of_scope:{c.get('city')}"
            elif n in ex_names or (d and d in ex_domains):
                reason = 'duplicate_of_input_file_company_parent_or_domain'
            elif any(n and (n == e or (len(e) > 6 and re.search(r'\b' + re.escape(e) + r'\b', n))) for e in ex_names):
                reason = 'duplicate_of_input_file_name_variant_or_brand'
            elif n in seen_names or (d and d in seen_domains):
                reason = 'duplicate_within_candidate_pool'
            if reason:
                if reason != 'duplicate_within_candidate_pool':
                    rejects.append({'company': c['company_name'], 'city': c.get('city', ''), 'vertical': v, 'reason': reason})
                continue
            seen_names[n] = c
            if d:
                seen_domains[d] = c
            cands.append(c)

json.dump(cands, open(f'{OUT}/candidates.json', 'w'), indent=1)
json.dump(rejects, open(f'{OUT}/rejects_sourcing.json', 'w'), indent=1)
from collections import Counter
print('candidates', len(cands), Counter(c['vertical'] for c in cands))
print('rejects', len(rejects), Counter(r['reason'].split(':')[0] for r in rejects))
print(Counter((c['vertical'], c['lead_signal_type']) for c in cands))
