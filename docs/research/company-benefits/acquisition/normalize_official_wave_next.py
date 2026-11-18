#!/usr/bin/env python3
"""Rebuild the separate, quote-free second-wave research inventory."""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

BATCHES = ('domestic-07', 'domestic-08', 'international-04')
PINNED = {
    'domestic-07': {'manifest.json': '86d1289e75bca636c74bf1f400746b85415bfc9b51ea7562e26331b9eddc2558', 'observations.jsonl': 'c781f7e9f170a0bf8152d68407b812d743a9108065f60d6e3511ae8b84312d65', 'coverage.jsonl': '19a2c15cd6af452d19b93a4bfee176f22764aaf19582862f5840ba6546eac9f0'},
    'domestic-08': {'manifest.json': '2cbba6ed6577dc918a5680476ba39cc4b83fdf34d7262b7e42372545dd55ee66', 'observations.jsonl': '3fe61b336aa185491a3b4d8f2047c7c48b1693661058342dbc54096e89341ea4', 'coverage.jsonl': '102d5f929a277a80b9697a50273f19845ca19c345b99e39f6a0378dda16d0bf2'},
    'international-04': {'manifest.json': '9330cc2d064fca4a5e4d16d30b8b56946f3defb7887eb0b83672bb7cc39e6cd8', 'observations.jsonl': 'b7233040911aa0a0a8c33f2bca3f63595dbebe99c022699ccc39431b0171743b', 'coverage.jsonl': 'b898f92bb87006780ccf4dcdde2b6729318c15753fa591a636cd6c0acff973f1'},
}
EXPECTED = {'domestic-07': (132, 12, 13), 'domestic-08': (110, 10, 15), 'international-04': (32, 15, 10)}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rows(data):
    return [json.loads(line) for line in data.decode('utf-8').splitlines() if line.strip()]


def serialize(value):
    return ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False) + '\n' for row in value)


def safe_url(url):
    if not isinstance(url, str) or not url.startswith('https://') or any(ord(c) < 33 or ord(c) == 127 for c in url):
        raise ValueError('unsafe URL')
    authority = url.split('/', 3)[2].split('?', 1)[0].split('#', 1)[0]
    if not authority or '@' in authority or '%' in authority or '\\' in authority:
        raise ValueError('unsafe URL authority')
    parsed = urlsplit(url)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError('unsafe URL port') from exc
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None or parsed.password is not None or (port is not None and port == 0):
        raise ValueError('unsafe URL')
    if re.search(r'(?i)(?:[?&])(token|api[_-]?key|access[_-]?key|password|secret|session|auth|credential)=', url):
        raise ValueError('credential-like URL query')
    return url


def build(input_root, canonical_root, pinned=PINNED):
    canonical_raw = {n: (canonical_root / n).read_bytes() for n in ('series-batches.jsonl', 'companies.jsonl')}
    canonical = {r['batch_id']: r for r in rows(canonical_raw['series-batches.jsonl'])}
    companies = {r['company_id']: r['legal_name'] for r in rows(canonical_raw['companies.jsonl'])}
    leads, coverage, inventory, all_ids = [], [], {}, set()
    for batch in BATCHES:
        raw = {}
        for filename, sha in pinned[batch].items():
            path = input_root / batch / filename
            if not path.is_file() or path.is_symlink():
                raise ValueError(f'missing/nonregular input: {batch}/{filename}')
            raw[filename] = path.read_bytes()
            if digest(raw[filename]) != sha:
                raise ValueError(f'pinned input digest mismatch: {batch}/{filename}')
        manifest = json.loads(raw['manifest.json'])
        observations, covered = rows(raw['observations.jsonl']), rows(raw['coverage.jsonl'])
        if manifest['batch_id'] != batch:
            raise ValueError(f'producer batch mismatch: {batch}')
        for filename, records in (('observations.jsonl', observations), ('coverage.jsonl', covered)):
            declaration = manifest['files'][filename]
            declared_sha = declaration['sha256'] if isinstance(declaration, dict) else declaration
            if declared_sha != digest(raw[filename]) or (isinstance(declaration, dict) and declaration['rows'] != len(records)):
                raise ValueError(f'producer manifest mismatch: {batch}/{filename}')
        canonical_ids = canonical[batch]['company_ids']
        selected = {r['company_id'] for r in covered}
        if len(canonical_ids) != 25 or len(covered) != 25 or selected != set(canonical_ids) or selected & all_ids:
            raise ValueError(f'canonical coverage mismatch: {batch}')
        all_ids.update(selected)
        counts = collections.Counter(r['company_id'] for r in observations)
        if set(counts) - selected:
            raise ValueError(f'observation outside batch: {batch}')
        positive = incomplete = 0
        for number, row in enumerate(covered, 1):
            cid = row['company_id']
            if row['legal_name'] != companies[cid]:
                raise ValueError(f'coverage legal name mismatch: {batch}:{number}')
            count = counts[cid]
            if row.get('lead_count', row.get('positive_lead_count')) != count:
                raise ValueError(f'coverage row count mismatch: {batch}:{number}')
            expected_outcome = ('research_only_leads' if batch == 'international-04' else 'research_only_positive_leads') if count else 'research_incomplete'
            if row['outcome'] != expected_outcome:
                raise ValueError(f'coverage outcome mismatch: {batch}:{number}')
            urls = row['destination_urls']
            if not isinstance(urls, list):
                raise ValueError(f'coverage destinations mismatch: {batch}:{number}')
            for url in urls:
                safe_url(url)
            positive += bool(count)
            incomplete += not count
            coverage.append({'batch_id': batch, 'company_id': cid, 'legal_name': companies[cid], 'outcome': 'research_leads_pending_review' if count else 'research_incomplete', 'producer_lead_count': count, 'destination_urls': urls, 'private_origin': {'batch_id': batch, 'file': 'coverage.jsonl', 'row_number': number}, 'producer_blocker_sha256': digest(row['blocker'].encode('utf-8')) if isinstance(row.get('blocker'), str) else None, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'})
        if (len(observations), positive, incomplete) != EXPECTED[batch]:
            raise ValueError(f'producer outcome totals mismatch: {batch}')
        if manifest['company_count'] != 25:
            raise ValueError(f'producer company count mismatch: {batch}')
        if batch != 'international-04':
            if (manifest['atomic_lead_count'], manifest['positive_company_count'], manifest['research_incomplete_company_count'], manifest['verified_benefit_count'], manifest['approved_package_count']) != (*EXPECTED[batch], 0, 0):
                raise ValueError(f'producer summary mismatch: {batch}')
        elif (manifest['observation_count'], manifest['binding_proven_leads'], manifest['binding_unproven_leads']) != (32, 3, 29):
            raise ValueError('US producer summary mismatch')
        bindings = collections.Counter()
        for number, row in enumerate(observations, 1):
            cid = row['company_id']
            if cid not in selected or row['legal_name'] != companies[cid]:
                raise ValueError(f'observation identity mismatch: {batch}:{number}')
            if row['evidence_level'] != 'research_only' or row['reviewer_needed'] is not True:
                raise ValueError(f'observation review status mismatch: {batch}:{number}')
            if not all(isinstance(row[k], str) and row[k] for k in ('statement', 'category_guess', 'eligibility_note')):
                raise ValueError(f'observation metadata mismatch: {batch}:{number}')
            url = safe_url(row['source_url'])
            projected = {'batch_id': batch, 'row_number': number, 'company_id': cid, 'legal_name': companies[cid], 'source_url': url, 'category_guess': row['category_guess'], 'producer_statement_sha256': digest(row['statement'].encode('utf-8')), 'producer_scope_note_sha256': digest(row['eligibility_note'].encode('utf-8')), 'private_origin': {'batch_id': batch, 'file': 'observations.jsonl', 'row_number': number}, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'}
            if batch == 'international-04':
                binding = row['entity_binding']
                if not isinstance(binding, dict) or binding.get('legal_entity_binding') not in ('proven', 'unproven'):
                    raise ValueError(f'US binding mismatch: {batch}:{number}')
                projected['entity_binding'] = binding
                bindings[binding['legal_entity_binding']] += 1
            leads.append(projected)
        if batch == 'international-04' and bindings != {'proven': 3, 'unproven': 29}:
            raise ValueError('US binding totals mismatch')
        inventory[batch] = {'input_sha256': dict(sorted(pinned[batch].items())), 'canonical_company_list_sha256': canonical[batch]['company_list_sha256'], 'covered_companies': 25, 'producer_leads': len(observations), 'companies_with_leads': positive, 'research_incomplete_companies': incomplete}
    if len(all_ids) != 75 or len(leads) != 274 or len(coverage) != 75:
        raise ValueError('wave totals mismatch')
    manifest = {'authority': 'local_audit_only_not_promotion_or_publication_input', 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed', 'covered_companies': 75, 'producer_leads': len(leads), 'companies_with_leads': sum(v['companies_with_leads'] for v in inventory.values()), 'research_incomplete_companies': sum(v['research_incomplete_companies'] for v in inventory.values()), 'us_binding_proven_rows': 3, 'us_binding_unproven_rows': 29, 'approved_benefits': 0, 'distinct_approved_benefits': 0, 'deduplication': 'Producer rows are not independently deduplicated propositions or approved benefits.', 'inventory': inventory, 'canonical_input_sha256': {n: digest(b) for n, b in canonical_raw.items()}, 'leads_sha256': digest(serialize(leads).encode()), 'coverage_sha256': digest(serialize(coverage).encode())}
    return {'leads.jsonl': leads, 'coverage.jsonl': coverage, 'manifest.json': manifest}


def check_or_write(generated, output_dir, check=False):
    files = {name: serialize(value) if name.endswith('.jsonl') else json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n' for name, value in generated.items()}
    if not check:
        output_dir.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        path = output_dir / name
        if check:
            if not path.is_file() or path.is_symlink() or path.read_text(encoding='utf-8') != content:
                raise ValueError(f'generated artifact drift: {name}')
        else:
            path.write_text(content, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root', type=Path, required=True)
    parser.add_argument('--canonical-root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    generated = build(args.input_root, args.canonical_root)
    check_or_write(generated, Path(__file__).resolve().parent / 'official-wave-next', args.check)
    print(json.dumps({key: generated['manifest.json'][key] for key in ('producer_leads', 'covered_companies', 'companies_with_leads', 'research_incomplete_companies', 'approved_benefits')}, sort_keys=True))


if __name__ == '__main__':
    main()
