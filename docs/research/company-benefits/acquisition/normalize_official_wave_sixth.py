#!/usr/bin/env python3
"""Rebuild the pinned, raw-free sixth official-wave audit inventory."""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

BATCHES = ('domestic-20', 'domestic-21', 'domestic-22', 'domestic-23')
PINNED = {
    'domestic-20': {'manifest.json': 'e27a1a565f8bddaddaf5a44c78a4fc25f52f811a090aeb5baf4301baa876f9a6', 'observations.jsonl': '14a3883b8db330bab18ffd342fec2fa52946e2201fba86eacd4b83e52732c527', 'coverage.jsonl': 'a6964737bb057c3f950a08f7fc162e2b81bbc42260644f600f92ac824aa0ae4d'},
    'domestic-21': {'manifest.json': '2517d4a85f19f43edaaef8f6d404af7959d260f2d65a5a099082ac1e2bc82fe4', 'observations.jsonl': 'c6e42be0b8bd0cd41c34982264b666b4ab48c1281f7d00b3d7d1a6761a9e543d', 'coverage.jsonl': '11530f1e9c43c540cdeab3e09926a4e0a16ea61486aebbf95103115fa03e7cce'},
    'domestic-22': {'manifest.json': '39b7184bd831befadf7019288649e50e63cf778d8097e4f2e92c32040a1eae3b', 'observations.jsonl': '63f050104aa6a404c18332c337b31556d01cd5d012475553d8b2b7bcab0620d6', 'coverage.jsonl': '654129ead3f32883519e46c6062b951fc47d6d448dc591476624c02364441d73'},
    'domestic-23': {'manifest.json': '3c70f0025b024ab03bc006710eb29897629d5b0ce56f8d32105bd68d635cb6be', 'observations.jsonl': 'a374b5606b0aa866494e619ee7337c18b65224e6cc275b663328ca7a987ba9b3', 'coverage.jsonl': '50a47a1f54cbcc2b0b523888d6ac8b43cf2775d9c9f341be7e5c403575431c4d'},
}
EXPECTED = {'domestic-20': (108, 7, 18), 'domestic-21': (150, 15, 10), 'domestic-22': (155, 13, 12), 'domestic-23': (145, 10, 15)}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rows(data):
    return [json.loads(line) for line in data.decode('utf-8').splitlines() if line.strip()]


def serialize(value):
    return ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False) + '\n' for row in value)


def safe_url(url):
    if not isinstance(url, str) or not (url.startswith('https://') or url.startswith('http:' + '//')) or any(ord(c) < 33 or ord(c) == 127 for c in url):
        raise ValueError('unsafe URL')
    authority = url.split('/', 3)[2].split('?', 1)[0].split('#', 1)[0]
    if not authority or any(c in authority for c in ('@', '%', '\\')):
        raise ValueError('unsafe URL authority')
    parsed = urlsplit(url)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError('unsafe URL port') from exc
    if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username is not None or parsed.password is not None or port == 0:
        raise ValueError('unsafe URL')
    if re.search(r'(?i)(?:[?&])(token|api[_-]?key|access[_-]?key|password|secret|session|auth|credential)=', url):
        raise ValueError('credential-like URL query')
    return url


def build(input_root, canonical_root, pinned=PINNED):
    canonical_raw = {n: (canonical_root / n).read_bytes() for n in ('series-batches.jsonl', 'companies.jsonl')}
    canonical = {r['batch_id']: r for r in rows(canonical_raw['series-batches.jsonl'])}
    names = {r['company_id']: r['legal_name'] for r in rows(canonical_raw['companies.jsonl'])}
    leads, coverage, inventory, selected_all, insecure = [], [], {}, set(), set()
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
        observed, covered = rows(raw['observations.jsonl']), rows(raw['coverage.jsonl'])
        if manifest['batch_id'] != batch:
            raise ValueError(f'producer batch mismatch: {batch}')
        for filename in ('observations.jsonl', 'coverage.jsonl'):
            declaration = manifest['files_sha256'][filename]
            if declaration != digest(raw[filename]):
                raise ValueError(f'producer manifest file mismatch: {batch}/{filename}')
        declared_canonical = [manifest[k] for k in ('canonical_company_list_sha256', 'canonical_batch_company_list_sha256', 'company_list_sha256') if k in manifest]
        declared_files = [manifest[k] for k in ('canonical_files_sha256', 'canonical_file_sha256', 'canonical_inputs_sha256') if k in manifest]
        if (len(declared_canonical) != 1 or declared_canonical[0] != canonical[batch]['company_list_sha256']
                or any(declared != {n: digest(data) for n, data in canonical_raw.items()} for declared in declared_files)):
            raise ValueError(f'canonical manifest digest mismatch: {batch}')
        canonical_ids = canonical[batch]['company_ids']
        selected = {r['company_id'] for r in covered}
        if (len(canonical_ids) != 25 or len(covered) != 25 or selected != set(canonical_ids)
                or selected & selected_all or len(selected) != 25):
            raise ValueError(f'canonical membership mismatch: {batch}')
        selected_all.update(selected)
        counts = collections.Counter(r['company_id'] for r in observed)
        if set(counts) - selected or len(observed) != EXPECTED[batch][0]:
            raise ValueError(f'observation membership/count mismatch: {batch}')
        if manifest['company_count'] != 25 or manifest['observation_count'] != len(observed):
            raise ValueError(f'producer summary mismatch: {batch}')
        positive_key = next(k for k in ('observed_company_count', 'covered_company_count', 'positive_company_count') if k in manifest)
        if manifest[positive_key] != EXPECTED[batch][1]:
            raise ValueError(f'producer summary mismatch: {batch}')
        positive = 0
        for number, row in enumerate(covered, 1):
            cid = row['company_id']
            if row['legal_name'] != names[cid]:
                raise ValueError(f'coverage legal name mismatch: {batch}:{number}')
            count = counts[cid]
            if row['observation_count'] != count:
                raise ValueError(f'coverage row count mismatch: {batch}:{number}')
            if (row['status'] == 'research_incomplete') != (count == 0) or (count and row['status'] not in ('research_leads', 'research_only_leads')):
                raise ValueError(f'coverage outcome mismatch: {batch}:{number}')
            urls = row['destination_urls']
            if not isinstance(urls, list):
                raise ValueError(f'coverage destinations mismatch: {batch}:{number}')
            urls = [u['url'] if isinstance(u, dict) else u for u in urls]
            for url in urls:
                safe_url(url)
            http = [digest(url.encode()) for url in urls if url.startswith('http:')]
            insecure.update(http)
            positive += bool(count)
            coverage.append({'batch_id': batch, 'company_id': cid, 'legal_name': names[cid], 'outcome': 'research_leads_pending_review' if count else 'research_incomplete', 'producer_lead_count': count, 'destination_urls': [url for url in urls if url.startswith('https:')], 'destination_url_sha256_research_only': http, 'destination_transport_reason': 'http_research_only_unpublishable' if http else None, 'claim_eligible': False, 'private_origin': {'batch_id': batch, 'file': 'coverage.jsonl', 'row_number': number}, 'producer_blocker_sha256': digest(row['blocker'].encode()) if isinstance(row.get('blocker'), str) else None, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'})
        if (len(observed), positive, 25 - positive) != EXPECTED[batch]:
            raise ValueError(f'producer outcome totals mismatch: {batch}')
        for number, row in enumerate(observed, 1):
            cid = row['company_id']
            if cid not in selected or row['legal_name'] != names[cid]:
                raise ValueError(f'observation identity mismatch: {batch}:{number}')
            if row['evidence_level'] != 'research_only' or row['reviewer_needed'] is not True:
                raise ValueError(f'observation review status mismatch: {batch}:{number}')
            if not all(isinstance(row[k], str) and row[k] for k in ('statement', 'category_guess', 'eligibility_note')):
                raise ValueError(f'observation metadata mismatch: {batch}:{number}')
            url = safe_url(row['source_url'])
            http = url.startswith('http:')
            if http:
                insecure.add(digest(url.encode()))
            leads.append({'batch_id': batch, 'row_number': number, 'company_id': cid, 'legal_name': names[cid], 'source_url': None if http else url, 'source_url_sha256': digest(url.encode()) if http else None, 'source_transport': 'http_research_only_unpublishable' if http else 'https', 'claim_eligible': False, 'category_guess': row['category_guess'], 'producer_statement_sha256': digest(row['statement'].encode()), 'producer_scope_note_sha256': digest(row['eligibility_note'].encode()), 'private_origin': {'batch_id': batch, 'file': 'observations.jsonl', 'row_number': number}, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'})
        inventory[batch] = {'input_sha256': dict(sorted(pinned[batch].items())), 'canonical_company_list_sha256': canonical[batch]['company_list_sha256'], 'covered_companies': 25, 'producer_leads': len(observed), 'companies_with_leads': positive, 'research_incomplete_companies': 25 - positive}
    if len(selected_all) != 100 or len(leads) != 558 or len(coverage) != 100:
        raise ValueError('wave totals mismatch')
    output_manifest = {'authority': 'local_audit_only_not_promotion_or_publication_input', 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed', 'covered_companies': 100, 'producer_leads': len(leads), 'companies_with_leads': sum(v['companies_with_leads'] for v in inventory.values()), 'research_incomplete_companies': sum(v['research_incomplete_companies'] for v in inventory.values()), 'approved_benefits': 0, 'distinct_approved_benefits': 0, 'deduplication': 'Producer rows are not independently deduplicated propositions or approved benefits.', 'unencrypted_http_source_sha256_research_only': sorted(insecure), 'inventory': inventory, 'canonical_input_sha256': {n: digest(b) for n, b in canonical_raw.items()}, 'leads_sha256': digest(serialize(leads).encode()), 'coverage_sha256': digest(serialize(coverage).encode())}
    return {'leads.jsonl': leads, 'coverage.jsonl': coverage, 'manifest.json': output_manifest}


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
    check_or_write(generated, Path(__file__).resolve().parent / 'official-wave-sixth', args.check)
    print(json.dumps({key: generated['manifest.json'][key] for key in ('producer_leads', 'covered_companies', 'companies_with_leads', 'research_incomplete_companies', 'approved_benefits')}, sort_keys=True))


if __name__ == '__main__':
    main()
