#!/usr/bin/env python3
"""Rebuild the separate, quote-free third-wave research inventory."""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

BATCHES = ('domestic-09', 'domestic-10', 'domestic-11')
PINNED = {
    'domestic-09': {'manifest.json': '3847418e954c2ebda3fe7a759bd9b89a36b8c2327efb175d3f9148f8e47a9dde', 'observations.jsonl': '8f73dc2e9445d5e09ef7dfe5eefbcda04bd011117832c3abf5a5b9a5fecc6edc', 'coverage.jsonl': '9ebc66f7e19967d01437cb011416e4cd88a54e84bd7ca8926ebb399402e75eab'},
    'domestic-10': {'manifest.json': '0935c1a1956c5a7f67dc3c1f0e4d9f6c504a2fd6402059527a3841eea444e25b', 'observations.jsonl': '28678b57c100d270236a6e325b548c132916ffddbd677e067723b25b066713f9', 'coverage.jsonl': 'a15b286c06fe979e9bed141ded3a80a97b01d08325ecfa7d0ce969a13b755ee3'},
    'domestic-11': {'manifest.json': 'be60dc86bb1c615404432b7afe017fbeafccb49064a43837a106f58f1c0d7935', 'observations.jsonl': 'f8250cd1c5a70ef7baf4ef9e1204ac4d8cdc0f4aae443b306f23c3c1c74fd915', 'coverage.jsonl': '67b9b6f6282edd1bf671f942ea8c46ccc4f3c2b742e20bafcae910e98ccb555a'},
}
EXPECTED = {'domestic-09': (134, 10, 15), 'domestic-10': (111, 11, 14), 'domestic-11': (50, 7, 18)}
IDENTITY_AUDIT_SHA256 = '012424cac9e9fe52785ebfb7d8358c4091d1e9631b25e703f3462807b997fbe8'
HTTP_RESEARCH_ONLY_SHA256 = frozenset({
    '029a581b21e21008829b7100378d77e3a544c24964c83b4422136610aa167f31',
    '9577efca6a6a1f913369a7b57621811e9613a5adac08dac8911ab79b37ca17c9',
    '702d51a00539161858c32b2341824b84bc0d4707713fcd2f61198fcf0bd55829',
})


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rows(data):
    return [json.loads(line) for line in data.decode('utf-8').splitlines() if line.strip()]


def serialize(value):
    return ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False) + '\n' for row in value)


def safe_url(url):
    if not isinstance(url, str) or not (url.startswith('https://') or (url.startswith('http:') and digest(url.encode()) in HTTP_RESEARCH_ONLY_SHA256)) or any(ord(c) < 33 or ord(c) == 127 for c in url):
        raise ValueError('unsafe URL')
    authority = url.split('/', 3)[2].split('?', 1)[0].split('#', 1)[0]
    if not authority or '@' in authority or '%' in authority or '\\' in authority:
        raise ValueError('unsafe URL authority')
    parsed = urlsplit(url)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError('unsafe URL port') from exc
    if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username is not None or parsed.password is not None or (port is not None and port == 0):
        raise ValueError('unsafe URL')
    if re.search(r'(?i)(?:[?&])(token|api[_-]?key|access[_-]?key|password|secret|session|auth|credential)=', url):
        raise ValueError('credential-like URL query')
    return url


def identity_correction(input_root, canonical, companies):
    path = input_root / 'international-04-identity-audit.json'
    if not path.is_file() or path.is_symlink():
        raise ValueError('missing/nonregular identity audit')
    raw = path.read_bytes()
    if digest(raw) != IDENTITY_AUDIT_SHA256:
        raise ValueError('pinned identity audit digest mismatch')
    audit = json.loads(raw)
    if (audit['batch'], audit['total_observation_rows'], audit['unproven_leads'], audit['exact_entity_bindable_leads'], audit['remaining_unbound_leads']) != ('international-04', 32, 29, 4, 25):
        raise ValueError('identity audit summary mismatch')
    records, bindable, unbound, seen = [], set(), set(), set()
    selected = set(canonical['international-04']['company_ids'])
    for row in audit['records']:
        cid = row['company_id']
        if cid not in selected or cid in seen or row['selected_legal_name'] != companies[cid] or row['jurisdiction'] != 'US' or row['classification'] not in ('proven_exact_entity', 'affiliate_only', 'unresolved'):
            raise ValueError('identity audit company mismatch')
        seen.add(cid)
        newly = row['exact_entity_bindable_rows']
        remaining = row['unbound_rows']
        if set(newly) & (bindable | unbound) or set(remaining) & (bindable | unbound | set(newly)) or set(newly + remaining) != set(row['observation_rows']):
            raise ValueError('identity audit row overlap')
        for url in row['source_urls']:
            safe_url(url)
        bindable.update(newly)
        unbound.update(remaining)
        records.append({'company_id': cid, 'classification': row['classification'], 'newly_bindable_row_numbers': newly, 'unbound_row_numbers': remaining, 'identity_source_urls': row['source_urls']})
    if len(records) != 14 or bindable != {4, 14, 26, 27} or len(unbound) != 25 or bindable | unbound != set(range(1, 33)) - {18, 19, 20}:
        raise ValueError('identity audit row partition mismatch')
    return {'source_sha256': digest(raw), 'basis': 'international-04 observations.jsonl, 1-based nonempty lines; identity only, not benefit approval', 'previously_unbound_rows': 29, 'newly_bindable_rows': 4, 'still_unbound_rows': 25, 'previously_proven_rows': 3, 'records': records}


def build(input_root, canonical_root, pinned=PINNED):
    canonical_raw = {n: (canonical_root / n).read_bytes() for n in ('series-batches.jsonl', 'companies.jsonl')}
    canonical = {r['batch_id']: r for r in rows(canonical_raw['series-batches.jsonl'])}
    companies = {r['company_id']: r['legal_name'] for r in rows(canonical_raw['companies.jsonl'])}
    leads, coverage, inventory, all_ids, insecure_seen = [], [], {}, set(), set()
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
            expected_outcome = 'research_only_positive_leads' if count else 'research_incomplete'
            if row['outcome'] != expected_outcome:
                raise ValueError(f'coverage outcome mismatch: {batch}:{number}')
            urls = row['destination_urls']
            if not isinstance(urls, list):
                raise ValueError(f'coverage destinations mismatch: {batch}:{number}')
            for url in urls:
                safe_url(url)
            insecure = [digest(url.encode()) for url in urls if url.startswith('http:')]
            insecure_seen.update(insecure)
            positive += bool(count)
            incomplete += not count
            coverage.append({'batch_id': batch, 'company_id': cid, 'legal_name': companies[cid], 'outcome': 'research_leads_pending_review' if count else 'research_incomplete', 'producer_lead_count': count, 'destination_urls': [url for url in urls if url.startswith('https://')], 'destination_url_sha256_research_only': insecure, 'destination_transport_reason': 'http_research_only_unpublishable' if insecure else None, 'claim_eligible': False, 'private_origin': {'batch_id': batch, 'file': 'coverage.jsonl', 'row_number': number}, 'producer_blocker_sha256': digest(row['blocker'].encode('utf-8')) if isinstance(row.get('blocker'), str) else None, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'})
        if (len(observations), positive, incomplete) != EXPECTED[batch]:
            raise ValueError(f'producer outcome totals mismatch: {batch}')
        if manifest['company_count'] != 25:
            raise ValueError(f'producer company count mismatch: {batch}')
        if (manifest['atomic_lead_count'], manifest['positive_company_count'], manifest['research_incomplete_company_count'], manifest['verified_benefit_count'], manifest['approved_package_count']) != (*EXPECTED[batch], 0, 0):
            raise ValueError(f'producer summary mismatch: {batch}')
        for number, row in enumerate(observations, 1):
            cid = row['company_id']
            if cid not in selected or row['legal_name'] != companies[cid]:
                raise ValueError(f'observation identity mismatch: {batch}:{number}')
            if row['evidence_level'] != 'research_only' or row['reviewer_needed'] is not True:
                raise ValueError(f'observation review status mismatch: {batch}:{number}')
            if not all(isinstance(row[k], str) and row[k] for k in ('statement', 'category_guess', 'eligibility_note')):
                raise ValueError(f'observation metadata mismatch: {batch}:{number}')
            url = safe_url(row['source_url'])
            http = url.startswith('http:')
            if http:
                insecure_seen.add(digest(url.encode()))
            projected = {'batch_id': batch, 'row_number': number, 'company_id': cid, 'legal_name': companies[cid], 'source_url': None if http else url, 'source_url_sha256': digest(url.encode()) if http else None, 'source_transport': 'http_research_only_unpublishable' if http else 'https', 'claim_eligible': False, 'category_guess': row['category_guess'], 'producer_statement_sha256': digest(row['statement'].encode('utf-8')), 'producer_scope_note_sha256': digest(row['eligibility_note'].encode('utf-8')), 'private_origin': {'batch_id': batch, 'file': 'observations.jsonl', 'row_number': number}, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'}
            leads.append(projected)
        inventory[batch] = {'input_sha256': dict(sorted(pinned[batch].items())), 'canonical_company_list_sha256': canonical[batch]['company_list_sha256'], 'covered_companies': 25, 'producer_leads': len(observations), 'companies_with_leads': positive, 'research_incomplete_companies': incomplete}
    if len(all_ids) != 75 or len(leads) != 295 or len(coverage) != 75:
        raise ValueError('wave totals mismatch')
    if insecure_seen != HTTP_RESEARCH_ONLY_SHA256:
        raise ValueError('insecure source inventory mismatch')
    manifest = {'authority': 'local_audit_only_not_promotion_or_publication_input', 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed', 'covered_companies': 75, 'producer_leads': len(leads), 'companies_with_leads': sum(v['companies_with_leads'] for v in inventory.values()), 'research_incomplete_companies': sum(v['research_incomplete_companies'] for v in inventory.values()), 'approved_benefits': 0, 'distinct_approved_benefits': 0, 'deduplication': 'Producer rows are not independently deduplicated propositions or approved benefits.', 'unencrypted_http_source_sha256_research_only': sorted(insecure_seen), 'inventory': inventory, 'canonical_input_sha256': {n: digest(b) for n, b in canonical_raw.items()}, 'international_04_identity_correction': identity_correction(input_root, canonical, companies), 'leads_sha256': digest(serialize(leads).encode()), 'coverage_sha256': digest(serialize(coverage).encode())}
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
    check_or_write(generated, Path(__file__).resolve().parent / 'official-wave-third', args.check)
    print(json.dumps({key: generated['manifest.json'][key] for key in ('producer_leads', 'covered_companies', 'companies_with_leads', 'research_incomplete_companies', 'approved_benefits')}, sort_keys=True))


if __name__ == '__main__':
    main()
