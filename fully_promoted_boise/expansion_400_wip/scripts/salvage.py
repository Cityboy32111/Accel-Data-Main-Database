"""Salvage verify/audit results from stopped workflows, separating trustworthy decisions from ones
made after the workflow WebSearch cap was hit."""
import json, os, re, sys
from collections import Counter
FP = '/tmp/claude-0/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/scratchpad/fp'
WF = '/root/.claude/projects/-home-user-Accel-Data-Main-Database/48198617-04f7-5b2f-b5a7-8b3cda4aedc2/subagents/workflows'
sys.path.insert(0, FP)
from assemble import norm_name

DIRS = ['wf_a470e5da-455', 'wf_791840ee-eeb', 'wf_dae942fb-de1', 'wf_793bfa65-c36', 'wf_db41656b-965',
        'wf_ed3fc375-b3d', 'wf_ca740d49-649', 'wf_6b53bbd5-59d', 'wf_461cee92-db7', 'wf_b131df7f-002']
HARD = re.compile(r'^(parent_in_input|duplicate|staffing|government|public_|national_franchise|franchise|out_of_scope|'
                  r'closed|fr_ppe|not_operating|vertical_mismatch|remote_only|out_of_state)')
CAP = '200 of 200'


def capped(d, agent_id):
    p = f'{WF}/{d}/agent-{agent_id}.jsonl'
    return os.path.exists(p) and CAP in open(p).read()


verify = {}   # (shard, batch) -> (results, capped)
audit = {}    # (shard, batch) -> (verdicts, capped)
for d in DIRS:
    labels = {}
    for line in open(f'{WF}/{d}/journal.jsonl'):
        l = json.loads(line)
        if l['type'] == 'started':
            labels[l['key']] = l['label']
        elif l['type'] == 'result':
            lab = labels.get(l['key'], '')
            kind, shard, b = lab.split(':')
            b = int(b[1:]) - 1
            if kind == 'verify':
                verify[(shard, b)] = ((l['result'] or {}).get('results') or [], capped(d, l['agentId']))
            else:
                audit[(shard, b)] = ((l['result'] or {}).get('verdicts') or [], capped(d, l['agentId']))

trusted_accept, unaudited, trusted_reject, requeue = [], [], [], []
stats = Counter()
shards = {}
for (shard, b), (results, vcap) in verify.items():
    vert = results[0]['vertical'] if results else None
    sf = shards.setdefault(shard, json.load(open(f'{FP}/shard_{shard}.json')))
    cands = sf[b * 4:(b + 1) * 4]
    got = {norm_name(r['company_name']) for r in results}
    for c in cands:
        if norm_name(c['company_name']) not in got:
            requeue.append(c); stats['missing_from_results'] += 1
    verdicts, acap = audit.get((shard, b), (None, None))
    vmap = {norm_name(v['company_name']): v for v in (verdicts or [])}
    for r in results:
        r['_shard'] = shard
        cand = next((c for c in cands if norm_name(c['company_name']) == norm_name(r['company_name'])), None)
        if r['decision'] == 'accept':
            v = vmap.get(norm_name(r['company_name']))
            if v and not acap:
                if v['verdict'] == 'fail':
                    trusted_reject.append({'company': r['company_name'], 'city': r.get('city', ''),
                                           'vertical': r['vertical'],
                                           'reason': 'audit_fail: ' + (v.get('fail_reason') or v.get('issues') or '')})
                    stats['audit_fail'] += 1
                else:
                    r['_audit'] = v['verdict'] + ': ' + (v.get('issues') or '')
                    r['_corrections'] = v.get('corrections') or {}
                    trusted_accept.append(r); stats['accept_audited'] += 1
            else:
                unaudited.append(r); stats['accept_unaudited'] += 1
        else:
            reason = r.get('reject_reason') or ''
            if vcap and not HARD.match(reason):
                if cand:
                    requeue.append(cand)
                stats['reject_requeued_cap'] += 1
            else:
                trusted_reject.append({'company': r['company_name'], 'city': r.get('city', ''), 'vertical': r['vertical'],
                                       'reason': 'verification: ' + reason})
                stats['reject_trusted'] += 1

# candidates never started (batches not reached)
done = {(s, b) for (s, b) in verify}
for shard in ['h1', 'h2', 'h3', 'c1', 'c2', 'c3', 'c4', 'a1', 'a2', 'a3']:
    sf = shards.setdefault(shard, json.load(open(f'{FP}/shard_{shard}.json')))
    for b in range(15):
        if (shard, b) not in done:
            requeue.extend(sf[b * 4:(b + 1) * 4]); stats['never_verified'] += len(sf[b * 4:(b + 1) * 4])

json.dump(trusted_accept, open(f'{FP}/salv_accept.json', 'w'), indent=1)
json.dump(unaudited, open(f'{FP}/salv_unaudited.json', 'w'), indent=1)
json.dump(trusted_reject, open(f'{FP}/salv_reject.json', 'w'), indent=1)
json.dump(requeue, open(f'{FP}/salv_requeue.json', 'w'), indent=1)
print(stats)
print('accept', Counter(r['vertical'] for r in trusted_accept), 'unaudited', Counter(r['vertical'] for r in unaudited))
print('requeue', len(requeue), Counter(c['vertical'] for c in requeue))
print('trusted rejects', Counter(x['reason'].split(':')[1].strip()[:45] for x in trusted_reject).most_common(15))
