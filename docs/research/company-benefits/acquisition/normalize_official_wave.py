#!/usr/bin/env python3
"""Project pinned official-source producer observations into quote-free audit metadata."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

BATCHES = ('domestic-04', 'domestic-05', 'domestic-06')
PINNED_SHA256 = {
    'domestic-04': {'observations.jsonl': '7e6de2c3c2168954206faf2c2bd7e6bbb35202cebe2c79f79a8f7c056e99b45f', 'coverage.jsonl': 'e7049a90fbfff37fbe40e60a4c26ede5fdacf66fd20f70728228f834a1d543d8', 'manifest.json': '607fecdd9ecaefbd0a63d51be7803e392e5aed4822fadd5f4fc92130e1320f99'},
    'domestic-05': {'observations.jsonl': '76d3c8949b138b8981029647271d91edeac4133fae6e7a6473d90a29c6f4075a', 'coverage.jsonl': 'ad83ef034655f1a8d6b1f7acc6eb72c4be8fc8ded326976cf296f71e7f751159', 'manifest.json': '5637c8b9f361db5569a667442f81e21f55d8f40614d9753c607a85cd1fdf19d4'},
    'domestic-06': {'observations.jsonl': '68f562bb2544d7bc87bca8c7a7dccf0a7f77b14fd5ea1ad72e0f902fdba4e4ad', 'coverage.jsonl': '7d9078535ffae682881c9a0093f18667006f612b392c59479ae8c2be3561fad4', 'manifest.json': 'ea6e3799c433443504921f70c5bfbcc0801e66933a67094325989b929c026751'},
}
EXPECTED = {'domestic-04': (404, 23, 2), 'domestic-05': (215, 17, 8), 'domestic-06': (244, 19, 6)}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def jsonl(data):
    return [json.loads(line) for line in data.decode('utf-8').splitlines() if line.strip()]


def encode(rows):
    return ''.join(json.dumps(row, ensure_ascii=False, sort_keys=True) + '\n' for row in rows)


def build(input_root, canonical_root, pinned=PINNED_SHA256):
    canonical = {row['batch_id']: row for row in jsonl((canonical_root / 'series-batches.jsonl').read_bytes())}
    companies = {row['company_id']: row['legal_name'] for row in jsonl((canonical_root / 'companies.jsonl').read_bytes())}
    leads, coverage, inventory = [], [], {}
    all_ids = set()
    for batch in BATCHES:
        raw = {}
        for filename, digest in pinned[batch].items():
            path = input_root / batch / filename
            if not path.is_file() or path.is_symlink():
                raise ValueError(f'missing/nonregular input: {batch}/{filename}')
            raw[filename] = path.read_bytes()
            if sha256(raw[filename]) != digest:
                raise ValueError(f'pinned input digest mismatch: {batch}/{filename}')
        manifest = json.loads(raw['manifest.json'])
        observations, rows = jsonl(raw['observations.jsonl']), jsonl(raw['coverage.jsonl'])
        for filename, entries in (('observations.jsonl', observations), ('coverage.jsonl', rows)):
            declared = manifest.get('files', {}).get(filename)
            if declared and (declared['sha256'] != sha256(raw[filename]) or declared['rows'] != len(entries)):
                raise ValueError(f'producer manifest mismatch: {batch}/{filename}')
            if manifest.get('sha256', {}).get(filename, sha256(raw[filename])) != sha256(raw[filename]):
                raise ValueError(f'producer manifest digest mismatch: {batch}/{filename}')
        ids = canonical[batch]['company_ids']
        selected = {row['company_id'] for row in rows}
        if len(ids) != 25 or len(rows) != 25 or selected != set(ids) or all_ids & selected:
            raise ValueError(f'canonical coverage mismatch: {batch}')
        all_ids.update(selected)
        counts = collections.Counter(row['company_id'] for row in observations)
        positive = incomplete = 0
        for row in rows:
            cid = row['company_id']
            if row['legal_name'] != companies[cid]:
                raise ValueError(f'legal name mismatch: {batch}/{cid}')
            n = counts[cid]
            if row.get('lead_count', row.get('positive_lead_count')) != n:
                raise ValueError(f'coverage lead count mismatch: {batch}/{cid}')
            if n and row['outcome'] != {'domestic-04': 'research_only_positive_leads', 'domestic-05': 'research_only_leads', 'domestic-06': 'research_leads_pending_review'}[batch]:
                raise ValueError(f'positive outcome mismatch: {batch}/{cid}')
            if not n and row['outcome'] != 'research_incomplete':
                raise ValueError(f'incomplete outcome mismatch: {batch}/{cid}')
            positive += bool(n)
            incomplete += not n
            coverage.append({'batch_id': batch, 'company_id': cid, 'legal_name': companies[cid], 'outcome': 'research_leads_pending_review' if n else 'research_incomplete', 'producer_lead_count': n, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'})
        if (len(observations), positive, incomplete) != EXPECTED[batch]:
            raise ValueError(f'producer outcome totals mismatch: {batch}')
        for number, row in enumerate(observations, 1):
            cid = row['company_id']
            if cid not in selected or row['legal_name'] != companies[cid]:
                raise ValueError(f'legal name or observation membership mismatch: {batch}:{number}')
            if row['evidence_level'] != 'research_only' or row['reviewer_needed'] is not True:
                raise ValueError(f'unreviewed status mismatch: {batch}:{number}')
            url = row['source_url']
            parsed = urlsplit(url)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError(f'unsafe source URL: {batch}:{number}')
            if not all(isinstance(row[key], str) and row[key] for key in ('statement', 'category_guess', 'eligibility_note')):
                raise ValueError(f'missing lead metadata: {batch}:{number}')
            leads.append({'batch_id': batch, 'row_number': number, 'company_id': cid, 'legal_name': companies[cid], 'source_url': url, 'category_guess': row['category_guess'],
                          'statement': f"The official URL was flagged for possible {row['category_guess'].replace('_', ' ')} support; the specific offering has not been independently reviewed.",
                          'producer_statement_sha256': sha256(row['statement'].encode('utf-8')),
                          'scope_note': row['eligibility_note'], 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'})
        inventory[batch] = {'input_sha256': dict(sorted(pinned[batch].items())), 'canonical_company_list_sha256': canonical[batch]['company_list_sha256'], 'covered_companies': 25, 'producer_leads': len(observations), 'companies_with_leads': positive, 'research_incomplete_companies': incomplete}
    if len(all_ids) != 75 or len(leads) != 863:
        raise ValueError('wave totals mismatch')
    manifest = {'authority': 'local_audit_only_not_promotion_or_publication_input', 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed', 'producer_leads': len(leads), 'covered_companies': len(coverage), 'companies_with_leads': sum(v['companies_with_leads'] for v in inventory.values()), 'research_incomplete_companies': sum(v['research_incomplete_companies'] for v in inventory.values()), 'approved_benefits': 0, 'distinct_approved_benefits': 0, 'deduplication': 'Producer rows are distinct within company only; cross-wave proposition review and deduplication not performed.', 'inventory': inventory, 'canonical_input_sha256': {name: sha256((canonical_root / name).read_bytes()) for name in ('series-batches.jsonl', 'companies.jsonl')}, 'leads_sha256': sha256(encode(leads).encode()), 'coverage_sha256': sha256(encode(coverage).encode())}
    return {'leads.jsonl': leads, 'coverage.jsonl': coverage, 'manifest.json': manifest}


def check_or_write(generated, output_dir, check=False):
    files = {name: (encode(value) if name.endswith('.jsonl') else json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n') for name, value in generated.items()}
    if not check:
        output_dir.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        target = output_dir / name
        if check:
            if not target.is_file() or target.is_symlink() or target.read_text(encoding='utf-8') != content:
                raise ValueError(f'generated artifact drift: {name}')
        else:
            target.write_text(content, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root', type=Path, required=True)
    parser.add_argument('--canonical-root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    generated = build(args.input_root, args.canonical_root)
    check_or_write(generated, Path(__file__).resolve().parent / 'official-wave', args.check)
    print(json.dumps({key: generated['manifest.json'][key] for key in ('producer_leads', 'covered_companies', 'companies_with_leads', 'research_incomplete_companies', 'approved_benefits')}, sort_keys=True))


if __name__ == '__main__':
    main()
