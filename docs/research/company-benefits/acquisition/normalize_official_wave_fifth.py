#!/usr/bin/env python3
"""Rebuild the pinned, raw-free fifth official-wave audit inventory."""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

BATCHES = ('domestic-16', 'domestic-17', 'domestic-18', 'domestic-19')
PINNED = {
    'domestic-16': {'manifest.json': 'aa8fc4a765f081268c44c95a890cbc523f32ebef4e2fbac9be3d834c7304e0db', 'observations.jsonl': '53b81933bdab57c23fe25a734aeed80cd6edf06f69baa7b8f1875daa9c77d378', 'coverage.jsonl': 'd2eccdb2538b3d0b4ff80b827af36a19c942e8ef597bd42672158b6a63b6d4c5'},
    'domestic-17': {'manifest.json': '9c5d73402b54387f9d6a801db70bb3f36accac76611ab3e5ffdd8ebe07d84801', 'observations.jsonl': '633fcbd4f5ad0e1d8ad6f662bc78d4a024e1be26ca2ed10c0f3a0f4e05481687', 'coverage.jsonl': '40dba6fbf70ec071dfe9a635c0c0fc075eb2163e74378b36071819af53e81e74'},
    'domestic-18': {'manifest.json': 'de46ab5a1e4a006a8f3bcbdac641ec240944b290f0f6ddd659acafb5beb0aef7', 'observations.jsonl': 'c635d7efc9f40242bb22fedb6b06d80d33c9d2428d6f8247acdb94a23ce6bbd6', 'coverage.jsonl': '5bbc713013faf7e27d41edf0ac81597d98a931600301709f7d178808f9924c05'},
    'domestic-19': {'manifest.json': '63f5f6ebe21e5b49a860716bb3caac648566f5138bdaebea3be07d1bb2080fef', 'observations.jsonl': '64d9283bd4744d2fb676712e91add0fda605204eee87f34154c91aaecc1db952', 'coverage.jsonl': 'c4b4e264900879f82b907410ef28bf2f078ca9080dc2cc23da7b59984e4af5ad'},
}
EXPECTED = {'domestic-16': (90, 6, 19), 'domestic-17': (107, 5, 20), 'domestic-18': (139, 12, 13), 'domestic-19': (190, 19, 6)}


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
        for filename, entries in (('observations.jsonl', observed), ('coverage.jsonl', covered)):
            declaration = manifest['files'][filename]
            if declaration['sha256'] != digest(raw[filename]) or declaration['rows'] != len(entries) or ('bytes' in declaration and declaration['bytes'] != len(raw[filename])):
                raise ValueError(f'producer manifest file mismatch: {batch}/{filename}')
        canonical_ids = canonical[batch]['company_ids']
        selected = {r['company_id'] for r in covered}
        members = manifest.get('canonical_company_ids')
        if (len(canonical_ids) != 25 or len(covered) != 25 or selected != set(canonical_ids)
                or selected & selected_all or (members is not None and members != canonical_ids)
                or manifest['canonical_company_list_sha256'] != canonical[batch]['company_list_sha256']):
            raise ValueError(f'canonical membership mismatch: {batch}')
        selected_all.update(selected)
        counts = collections.Counter(r['company_id'] for r in observed)
        if set(counts) - selected or len(observed) != EXPECTED[batch][0]:
            raise ValueError(f'observation membership/count mismatch: {batch}')
        summary = manifest.get('counts', manifest)
        for key, target in ((('companies', 'company_count'), 25), (('observations', 'observation_count'), len(observed)), (('positive_companies', 'positive_company_count'), EXPECTED[batch][1]), (('research_incomplete_companies', 'research_incomplete_company_count'), EXPECTED[batch][2])):
            declared = [summary[k] for k in key if k in summary]
            if len(declared) != 1 or declared[0] != target:
                raise ValueError(f'producer summary mismatch: {batch}/{key}')
        positive = 0
        for number, row in enumerate(covered, 1):
            cid = row['company_id']
            if row['legal_name'] != names[cid]:
                raise ValueError(f'coverage legal name mismatch: {batch}:{number}')
            count = counts[cid]
            declared = [row[k] for k in ('count', 'observation_count') if k in row]
            if len(declared) != 1 or declared[0] != count:
                raise ValueError(f'coverage row count mismatch: {batch}:{number}')
            if (row['outcome'] == 'research_incomplete') != (count == 0):
                raise ValueError(f'coverage outcome mismatch: {batch}:{number}')
            urls = row.get('source_urls', row.get('urls'))
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
    if len(selected_all) != 100 or len(leads) != 526 or len(coverage) != 100:
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
    check_or_write(generated, Path(__file__).resolve().parent / 'official-wave-fifth', args.check)
    print(json.dumps({key: generated['manifest.json'][key] for key in ('producer_leads', 'covered_companies', 'companies_with_leads', 'research_incomplete_companies', 'approved_benefits')}, sort_keys=True))


if __name__ == '__main__':
    main()
