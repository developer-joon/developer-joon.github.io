#!/usr/bin/env python3
"""Rebuild the pinned, quote-free fourth official-wave audit inventory."""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

BATCHES = ('domestic-12', 'domestic-13', 'domestic-14', 'domestic-15', 'international-05')
PINNED = {
    'domestic-12': {'manifest.json': 'bd2a29facec55ac2c88ee6dc6df183aa25c3874f8c187962c3117332fbdae7cc', 'observations.jsonl': 'd0e41e97c5c3ebc39ad7cd8724ad6516d7e43f9eaaff84be89e7d28a6217bd1c', 'coverage.jsonl': '41b03ade6d6f28189a3a84f40254e0335ef66c85c96027bad6d1312327207293'},
    'domestic-13': {'manifest.json': 'fd2ff56b6aa6cdd6ffd7e505ae33a3a42c0647b1212ed82d1caf2849a5c4b09a', 'observations.jsonl': 'ef88ad9c5bdf9a481af44c58c53be8b1cf925ad76da07e64ad78bcd9735fca4e', 'coverage.jsonl': 'bc5b5a9763bda84a0c1161c26715b55c8945e7f28a745e5357eea631d65556e4'},
    'domestic-14': {'manifest.json': 'b74cd07fc9737a8f37aa5b491dba0b98800c515bf86a37195b9d3d4756da8bd4', 'observations.jsonl': '7688fec4ad951e845266adff3b34777e9bda14f6a65082a8bfbce4004e692db6', 'coverage.jsonl': '2cebf042c54bb92191a728f0d248edcc20cfe821c97cf44575b65ac01cd2dd3e'},
    'domestic-15': {'manifest.json': '6313988d02a070f73e320f929bbde713684b71312495b474b71e33877a84cfb8', 'observations.jsonl': '9dc0163bc24bdfa8438bf740d59a4ff0b0d92daeb6251b44987737e97673bb90', 'coverage.jsonl': '76366586d7258ae0314f043c85216dcb1c0706501382ed274d689e35855565d1'},
    'international-05': {'manifest.json': '235d6be32973013779b7e711e97d433f90d6c775e838287585330d50fb1142cf', 'observations.jsonl': '35c96619b99f242eedb4efc40bc8fb9a6b70a1352cd9683364c7621f3fb9eca8', 'coverage.jsonl': '3d04ff41c0de2c9961f7eca2f806f3be76730aaa14ea51179c2415cc71d94d34'},
}
EXPECTED = {'domestic-12': (87, 8, 17), 'domestic-13': (92, 11, 14), 'domestic-14': (188, 15, 10), 'domestic-15': (111, 10, 15), 'international-05': (142, 23, 2)}


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


def manifest_sha(manifest, filename):
    layouts = [manifest[k] for k in ('files', 'files_sha256', 'file_sha256') if k in manifest]
    if len(layouts) != 1:
        raise ValueError('producer manifest layout mismatch')
    declaration = layouts[0][filename]
    return declaration['sha256'] if isinstance(declaration, dict) else declaration


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
            if manifest_sha(manifest, filename) != digest(raw[filename]):
                raise ValueError(f'producer manifest digest mismatch: {batch}/{filename}')
            declaration = manifest.get('files', {}).get(filename)
            if isinstance(declaration, dict) and (declaration.get('rows') != len(entries) or ('bytes' in declaration and declaration['bytes'] != len(raw[filename]))):
                raise ValueError(f'producer manifest file count mismatch: {batch}/{filename}')
        canonical_ids = canonical[batch]['company_ids']
        selected = {r['company_id'] for r in covered}
        members = manifest.get('member_ids', manifest.get('company_ids'))
        declared_hash = manifest.get('canonical_company_list_sha256', manifest.get('company_list_sha256'))
        if (len(canonical_ids) != 25 or len(covered) != 25 or selected != set(canonical_ids)
                or selected & selected_all or (members is not None and members != canonical_ids)
                or declared_hash != canonical[batch]['company_list_sha256']):
            raise ValueError(f'canonical membership mismatch: {batch}')
        selected_all.update(selected)
        counts = collections.Counter(r['company_id'] for r in observed)
        if set(counts) - selected or len(observed) != EXPECTED[batch][0]:
            raise ValueError(f'observation membership/count mismatch: {batch}')
        if manifest.get('company_count', manifest.get('member_count')) != 25 or manifest['observation_count'] != len(observed):
            raise ValueError(f'producer summary mismatch: {batch}')
        if 'per_company_counts' in manifest and manifest['per_company_counts'] != {cid: counts[cid] for cid in canonical_ids}:
            raise ValueError(f'producer per-company count mismatch: {batch}')
        positive = 0
        for number, row in enumerate(covered, 1):
            cid = row['company_id']
            if row['legal_name'] != names[cid]:
                raise ValueError(f'coverage legal name mismatch: {batch}:{number}')
            count = counts[cid]
            declared = [row[k] for k in ('research_only_count', 'observation_count', 'lead_count') if k in row]
            if len(declared) != 1 or declared[0] != count:
                raise ValueError(f'coverage row count mismatch: {batch}:{number}')
            status = row.get('status', row.get('outcome'))
            if status is not None and (status == 'research_incomplete') != (count == 0):
                raise ValueError(f'coverage outcome mismatch: {batch}:{number}')
            urls = row.get('source_urls', row.get('destination_urls'))
            if not isinstance(urls, list):
                raise ValueError(f'coverage destinations mismatch: {batch}:{number}')
            for url in urls:
                safe_url(url)
            http = [digest(url.encode()) for url in urls if url.startswith('http:')]
            insecure.update(http)
            positive += bool(count)
            coverage.append({'batch_id': batch, 'company_id': cid, 'legal_name': names[cid], 'outcome': 'research_leads_pending_review' if count else 'research_incomplete', 'producer_lead_count': count, 'destination_urls': [url for url in urls if url.startswith('https:')], 'destination_url_sha256_research_only': http, 'destination_transport_reason': 'http_research_only_unpublishable' if http else None, 'claim_eligible': False, 'private_origin': {'batch_id': batch, 'file': 'coverage.jsonl', 'row_number': number}, 'producer_blocker_sha256': digest(row['blocker'].encode()) if isinstance(row.get('blocker'), str) else None, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed'})
        declared_positive = manifest.get('positive_company_count', manifest.get('companies_with_leads'))
        if (len(observed), positive, 25 - positive) != EXPECTED[batch] or (declared_positive is not None and declared_positive != positive):
            raise ValueError(f'producer outcome totals mismatch: {batch}')
        for key in ('research_incomplete_company_count', 'research_incomplete_count'):
            if key in manifest and manifest[key] != 25 - positive:
                raise ValueError(f'producer incomplete summary mismatch: {batch}')
        if batch == 'international-05' and (manifest['entity_binding_proven_count'] != 0 or manifest['entity_binding_unproven_count'] != len(observed)):
            raise ValueError('US producer entity summary mismatch')
        for number, row in enumerate(observed, 1):
            cid = row['company_id']
            if cid not in selected or row['legal_name'] != names[cid]:
                raise ValueError(f'observation identity mismatch: {batch}:{number}')
            if row['evidence_level'] != 'research_only' or row['reviewer_needed'] is not True:
                raise ValueError(f'observation review status mismatch: {batch}:{number}')
            if not all(isinstance(row[k], str) and row[k] for k in ('statement', 'category_guess', 'eligibility_note')):
                raise ValueError(f'observation metadata mismatch: {batch}:{number}')
            binding = row.get('entity_binding')
            if batch == 'international-05' and (not isinstance(binding, dict) or binding.get('legal_entity_binding') != 'unproven'):
                raise ValueError(f'US entity binding mismatch: {batch}:{number}')
            url = safe_url(row['source_url'])
            http = url.startswith('http:')
            if http:
                insecure.add(digest(url.encode()))
            leads.append({'batch_id': batch, 'row_number': number, 'company_id': cid, 'legal_name': names[cid], 'source_url': None if http else url, 'source_url_sha256': digest(url.encode()) if http else None, 'source_transport': 'http_research_only_unpublishable' if http else 'https', 'claim_eligible': False, 'category_guess': row['category_guess'], 'producer_statement_sha256': digest(row['statement'].encode()), 'producer_scope_note_sha256': digest(row['eligibility_note'].encode()), 'private_origin': {'batch_id': batch, 'file': 'observations.jsonl', 'row_number': number}, 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed', 'entity_binding': 'unproven' if binding else 'not_adjudicated'})
        inventory[batch] = {'input_sha256': dict(sorted(pinned[batch].items())), 'canonical_company_list_sha256': canonical[batch]['company_list_sha256'], 'covered_companies': 25, 'producer_leads': len(observed), 'companies_with_leads': positive, 'research_incomplete_companies': 25 - positive}
    if len(selected_all) != 125 or len(leads) != 620 or len(coverage) != 125:
        raise ValueError('wave totals mismatch')
    manifest = {'authority': 'local_audit_only_not_promotion_or_publication_input', 'evidence_level': 'research_only', 'source_rights_status': 'unreviewed', 'covered_companies': 125, 'producer_leads': len(leads), 'companies_with_leads': sum(v['companies_with_leads'] for v in inventory.values()), 'research_incomplete_companies': sum(v['research_incomplete_companies'] for v in inventory.values()), 'approved_benefits': 0, 'distinct_approved_benefits': 0, 'deduplication': 'Producer rows are not independently deduplicated propositions or approved benefits.', 'unencrypted_http_source_sha256_research_only': sorted(insecure), 'inventory': inventory, 'canonical_input_sha256': {n: digest(b) for n, b in canonical_raw.items()}, 'leads_sha256': digest(serialize(leads).encode()), 'coverage_sha256': digest(serialize(coverage).encode())}
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
    check_or_write(generated, Path(__file__).resolve().parent / 'official-wave-fourth', args.check)
    print(json.dumps({key: generated['manifest.json'][key] for key in ('producer_leads', 'covered_companies', 'companies_with_leads', 'research_incomplete_companies', 'approved_benefits')}, sort_keys=True))


if __name__ == '__main__':
    main()
