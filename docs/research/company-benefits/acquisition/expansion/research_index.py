#!/usr/bin/env python3
"""Rebuild/check the pinned, quote-free expansion research index (never approval)."""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
ARCHIVE = Path(os.environ.get('EXPANSION_ARCHIVE_ROOT', Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes')) / 'data/benefit-batch-wave/expansion-private-prepush'))
FILES = ('manifest.json', 'coverage.jsonl', 'observations.jsonl')
SHA = re.compile(r'[0-9a-f]{64}\Z')
# Explicitly observed producer spellings, not arbitrary fallback/semantic equivalence.
SHA_FIELDS = {'kr-0': 'outputs_sha256', 'kr-2': 'files'}
COUNT_FIELDS = {'us-second-1': 'observations_count'}
NAME_FIELDS = {'us-second-0': 'sec_official_name', 'us-second-1': 'sec_legal_name',
               'us-second-3': 'sec_official_name', 'us-second-4': 'sec_official_name'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rows(data):
    if not data or not data.endswith(b'\n'):
        raise ValueError('missing or unterminated rows')
    result = [json.loads(line) for line in data.splitlines()]
    if not all(isinstance(row, dict) for row in result):
        raise ValueError('malformed row')
    return result


def safe_url(value):
    if not isinstance(value, str) or not value.startswith(('https://', 'http://')) or re.search(r'[\s\\\x00-\x1f\x7f]', value):
        raise ValueError('unsafe source URL')
    authority = value.split('/', 3)[2].split('?', 1)[0].split('#', 1)[0]
    if not authority or any(c in authority for c in '@%\\'):
        raise ValueError('unsafe source authority')
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError('unsafe source port') from exc
    if (not parsed.hostname or port == 0 or parsed.fragment or
            re.search(r'(?i)(?:[?&])(token|api[_-]?key|access[_-]?key|password|secret|session|auth|credential)=', value)):
        raise ValueError('unsafe source locator')
    return (value, None) if parsed.scheme == 'https' else (None, digest(value.encode('utf-8')))


def declared_file(manifest, shard, name):
    key = SHA_FIELDS.get(shard, 'files_sha256')
    entry = manifest.get(key, {}).get(name)
    if key == 'files':
        if not isinstance(entry, dict):
            raise ValueError('missing producer file metadata')
        return entry['sha256'], entry['rows'], entry['bytes']
    return entry, None, None


def build(input_root, pins):
    if (pins.get('schema_version') != 'expansion-research-inputs-v1' or
            pins.get('scope') != 'research_only_no_approval' or
            len(pins.get('shards', [])) != 13):
        raise ValueError('unsupported input manifest')
    expected_shards = {'kr-0', 'kr-1', 'kr-2', 'kr-3', *(f'us-{n}' for n in range(4)),
                       *(f'us-second-{n}' for n in range(5))}
    if {p.get('shard') for p in pins['shards']} != expected_shards:
        raise ValueError('shard membership mismatch')
    identities = {}
    for ledger in ('candidates.v1.jsonl', 'candidates.v2.jsonl'):
        raw = (ARCHIVE / ledger).read_bytes()
        if digest(raw) != pins.get('identity_ledgers', {}).get(ledger):
            raise ValueError('identity ledger pin mismatch')
        for row in rows(raw):
            cid = row['company_id']
            if cid in identities or row['review_status'] != 'research_only' or row['identity_status'] != 'identity_candidate':
                raise ValueError('duplicate or promoted identity')
            identities[cid] = row['legal_name']
    if len(identities) != 71:
        raise ValueError('identity population mismatch')
    selected = set()
    result = []
    total = 0
    for pin in pins['shards']:
        shard = pin['shard']
        if (set(pin.get('files', {})) != set(FILES) or
                any(not isinstance(v, str) or not SHA.fullmatch(v) for v in pin['files'].values())):
            raise ValueError('invalid file pin inventory')
        raw = {}
        for name in FILES:
            path = input_root / shard / name
            if not path.is_file() or path.is_symlink():
                raise ValueError('missing or symlinked private input')
            raw[name] = path.read_bytes()
            if digest(raw[name]) != pin['files'][name]:
                raise ValueError(f'input pin mismatch: {shard}/{name}')
        manifest = json.loads(raw['manifest.json'])
        coverage = rows(raw['coverage.jsonl'])
        observations = rows(raw['observations.jsonl'])
        for name, parsed in (('coverage.jsonl', coverage), ('observations.jsonl', observations)):
            declared, count, size = declared_file(manifest, shard, name)
            if declared != digest(raw[name]) or (count is not None and count != len(parsed)) or (size is not None and size != len(raw[name])):
                raise ValueError(f'producer file mismatch: {shard}/{name}')
        ids = pin['company_ids']
        names = pin['legal_names']
        if (manifest.get('company_ids') != ids or len(ids) != len(set(ids)) or
                len(ids) != len(names) or len(ids) != len(coverage) or
                ids != [r.get('company_id') for r in coverage] or
                names != [r.get(NAME_FIELDS.get(shard, 'legal_name')) for r in coverage] or
                selected.intersection(ids)):
            raise ValueError(f'ordered shard identity mismatch: {shard}')
        if 'legal_names' in manifest and manifest['legal_names'] != names:
            raise ValueError('producer legal name mismatch')
        selected.update(ids)
        for cid, name in zip(ids, names):
            if identities.get(cid) != name:
                raise ValueError('identity ledger mismatch')
        if pin['coverage_rows'] != len(coverage) or pin['observation_rows'] != len(observations):
            raise ValueError('pinned row count mismatch')
        for key in ('coverage_count', 'company_count'):
            if key in manifest and manifest[key] != len(coverage):
                raise ValueError('producer coverage count mismatch')
        declared_total_key = COUNT_FIELDS.get(shard, 'observation_count')
        if declared_total_key in manifest and manifest[declared_total_key] != len(observations):
            raise ValueError('producer observation count mismatch')
        if shard == 'kr-2' and manifest['files']['observations.jsonl']['rows'] != len(observations):
            raise ValueError('producer observations missing')
        if declared_total_key not in manifest and shard != 'kr-2':
            raise ValueError('missing producer observation count')
        by_company = {cid: [] for cid in ids}
        for number, row in enumerate(observations, 1):
            cid = row.get('company_id')
            if cid not in by_company or row.get(NAME_FIELDS.get(shard, 'legal_name')) != identities[cid]:
                raise ValueError('observation identity mismatch')
            url, http_hash = safe_url(row.get('source_url'))
            by_company[cid].append({'line': number, 'row_sha256': digest(raw['observations.jsonl'].splitlines()[number-1]),
                                    'source_url': url, 'private_http_source_sha256': http_hash})
        for number, (cid, name, cover) in enumerate(zip(ids, names, coverage), 1):
            count = len(by_company[cid])
            declared = [cover[k] for k in ('observation_count', 'observations_count') if k in cover]
            if declared and any(type(v) is not int or v != count for v in declared):
                raise ValueError('coverage observation count mismatch')
            if not declared and (declared_total_key not in manifest or manifest.get('coverage_count') != len(coverage)):
                raise ValueError('missing coverage count and producer totals')
            urls = sorted({r['source_url'] for r in by_company[cid] if r['source_url']})
            http = sorted({r['private_http_source_sha256'] for r in by_company[cid] if r['private_http_source_sha256']})
            result.append({'schema_version': 'expansion-research-index-v1', 'company_id': cid,
                           'legal_name': name, 'shard': shard, 'coverage_line': number,
                           'raw_research_rows': count, 'source_urls': urls,
                           'private_http_source_count': sum(bool(r['private_http_source_sha256']) for r in by_company[cid]),
                           'private_http_source_sha256': http, 'lead_refs': by_company[cid],
                           'status': 'research_only', 'rights_status': 'unreviewed',
                           'review_status': 'pending_independent_review', 'approved_benefits': 0})
        total += len(observations)
    if selected != set(identities) or len(result) != pins['expected_companies'] or total != pins['expected_research_rows']:
        raise ValueError('total population/count mismatch')
    data = ''.join(json.dumps(r, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n'
                   for r in sorted(result, key=lambda r: r['company_id'])).encode('utf-8')
    if b'http://' in data or (str(Path.home()).encode() + b'/') in data:
        raise ValueError('unsafe public projection')
    return data


def check(output, root, pins):
    expected = build(root, pins)
    if not output.is_file() or output.is_symlink() or output.read_bytes() != expected:
        raise ValueError('research index drift')
    records = rows(expected)
    return len(records), sum(r['raw_research_rows'] for r in records)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('compile', 'check'))
    parser.add_argument('--input-root', type=Path, required=True)
    parser.add_argument('--pins', type=Path, default=ARCHIVE / 'research-inputs.v1.json')
    parser.add_argument('--output', type=Path, default=ARCHIVE / 'research-index.v1.jsonl')
    args = parser.parse_args()
    pins = json.loads(args.pins.read_text(encoding='utf-8'))
    if args.action == 'compile':
        if (args.output.is_symlink() or not args.output.resolve().is_relative_to(ARCHIVE.resolve())
                or args.output.resolve() == (ARCHIVE / 'research-index.v1.jsonl').resolve()):
            raise ValueError('compile output must be a new restricted archive file')
        data = build(args.input_root, pins)
        args.output.write_bytes(data)
    companies, leads = check(args.output, args.input_root, pins)
    print(f'{args.action}: {companies} research-only employers; {leads} raw leads; sha256={digest(args.output.read_bytes())}')


if __name__ == '__main__':
    main()
