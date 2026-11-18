#!/usr/bin/env python3
"""Pinned append-only, research-only wave index. No private text is published."""
import argparse
import collections
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
FILES = ('manifest.json', 'coverage.jsonl', 'observations.jsonl')
SHA = re.compile(r'^[0-9a-f]{64}$')
COUNT_KEYS = ('observation_count', 'observations_count', 'count', 'lead_count', 'positive_lead_count', 'research_only_count')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def lines(data):
    return [json.loads(line) for line in data.decode('utf-8').splitlines() if line.strip()]


def encode(row):
    return json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(',', ':')) + '\n'


def project_url(url):
    if not isinstance(url, str) or not url.startswith(('https://', 'http://')) or any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise ValueError('unsafe source URL')
    authority = url.split('/', 3)[2].split('?', 1)[0].split('#', 1)[0]
    if not authority or any(x in authority for x in ('@', '%', '\\')):
        raise ValueError('unsafe source authority')
    parsed = urlsplit(url)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError('unsafe source port') from exc
    if not parsed.hostname or port == 0 or re.search(r'(?i)(?:[?&])(token|api[_-]?key|access[_-]?key|password|secret|session|auth|credential)=', url):
        raise ValueError('unsafe/credential-bearing URL')
    return (url, None) if parsed.scheme == 'https' else (None, digest(url.encode()))


def pin_batch(root, batch):
    if not re.fullmatch(r'(domestic|international)-\d{2}', batch):
        raise ValueError('invalid batch ID')
    result = {}
    for name in FILES:
        path = root / batch / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'missing or symlinked private file: {batch}/{name}')
        result[name] = digest(path.read_bytes())
    return {'batch_id': batch, 'files': result}


def declared_sha(manifest, name):
    declarations = []
    for key in ('files', 'files_sha256', 'file_sha256', 'sha256', 'outputs_sha256'):
        if key in manifest and name in manifest[key]:
            entry = manifest[key][name]
            declarations.append(entry.get('sha256') if isinstance(entry, dict) else entry)
    if not declarations or len(set(declarations)) != 1:
        raise ValueError(f'missing or conflicting producer digest: {name}')
    return declarations[0]


def build(input_root, canonical_root, pins):
    if pins.get('schema_version') != 1 or not isinstance(pins.get('batches'), list):
        raise ValueError('unsupported input pins schema')
    canonical_bytes = {n: (canonical_root / n).read_bytes() for n in ('series-batches.jsonl', 'companies.jsonl')}
    batches = {r['batch_id']: r for r in lines(canonical_bytes['series-batches.jsonl'])}
    names = {r['company_id']: r['legal_name'] for r in lines(canonical_bytes['companies.jsonl'])}
    coverage, leads, inventory, selected = [], [], [], set()
    for pin in pins['batches']:
        batch = pin['batch_id']
        if batch not in batches or not re.fullmatch(r'(domestic|international)-\d{2}', batch):
            raise ValueError('unknown batch')
        if set(pin['files']) != set(FILES) or any(not isinstance(v, str) or not SHA.fullmatch(v) for v in pin['files'].values()):
            raise ValueError('invalid pinned file inventory')
        raw = {}
        for name in FILES:
            path = input_root / batch / name
            if not path.is_file() or path.is_symlink():
                raise ValueError(f'missing/nonregular input: {batch}/{name}')
            raw[name] = path.read_bytes()
            if digest(raw[name]) != pin['files'][name]:
                raise ValueError(f'pinned input mismatch: {batch}/{name}')
        manifest = json.loads(raw['manifest.json'])
        observed, covered = lines(raw['observations.jsonl']), lines(raw['coverage.jsonl'])
        if manifest.get('batch_id') != batch:
            raise ValueError('producer batch mismatch')
        for name, records in (('coverage.jsonl', covered), ('observations.jsonl', observed)):
            if declared_sha(manifest, name) != digest(raw[name]):
                raise ValueError(f'producer file mismatch: {batch}/{name}')
            entry = manifest.get('files', {}).get(name)
            if isinstance(entry, dict):
                for count_key in ('rows', 'count'):
                    if count_key in entry and entry[count_key] != len(records):
                        raise ValueError(f'producer file count mismatch: {batch}/{name}')
        canonical = batches[batch]
        ids = canonical['company_ids']
        if len(ids) != 25 or len(covered) != 25 or {r['company_id'] for r in covered} != set(ids) or len({r['company_id'] for r in covered}) != 25 or selected.intersection(ids):
            raise ValueError(f'canonical membership mismatch: {batch}')
        selected.update(ids)
        for key in ('canonical_company_list_sha256', 'canonical_batch_company_list_sha256', 'company_list_sha256'):
            if key in manifest and manifest[key] != canonical['company_list_sha256']:
                raise ValueError(f'canonical list digest mismatch: {batch}')
        for key in ('company_ids', 'member_ids'):
            if key in manifest and manifest[key] != ids:
                raise ValueError(f'canonical member order mismatch: {batch}')
        for key in ('canonical_ledger_sha256', 'canonical_files_sha256', 'canonical_file_sha256', 'canonical_inputs_sha256'):
            if key in manifest and manifest[key] != {n: digest(data) for n, data in canonical_bytes.items()}:
                raise ValueError(f'canonical ledger mismatch: {batch}')
        for key in ('company_count', 'member_count', 'selected_companies', 'coverage_count', 'coverage_rows'):
            if key in manifest and manifest[key] != 25:
                raise ValueError(f'company count mismatch: {batch}')
        for key in ('observation_count', 'atomic_lead_count', 'research_only_atomic_leads'):
            if key in manifest and manifest[key] != len(observed):
                raise ValueError(f'observation count mismatch: {batch}')
        counts = collections.Counter(r['company_id'] for r in observed)
        if set(counts) - set(ids):
            raise ValueError(f'observation membership mismatch: {batch}')
        for number, row in enumerate(covered, 1):
            cid = row['company_id']
            if row['legal_name'] != names[cid]:
                raise ValueError(f'coverage legal name mismatch: {batch}:{number}')
            declared = [row[k] for k in COUNT_KEYS if k in row]
            if declared and any(v != counts[cid] for v in declared):
                raise ValueError(f'coverage row count mismatch: {batch}:{number}')
            if not declared and (manifest.get('observation_count') != len(observed) or manifest.get('coverage_count') != 25):
                raise ValueError(f'missing coverage count without pinned producer totals: {batch}:{number}')
            # US coverage can lack current exact-employer leads while retaining
            # unproven or historical raw research rows for audit.
            if batch.startswith('domestic-') and (row.get('status') == 'research_incomplete' or row.get('outcome') == 'research_incomplete') and counts[cid]:
                raise ValueError(f'coverage status mismatch: {batch}:{number}')
            urls = row.get('source_urls', row.get('destination_urls', []))
            if not isinstance(urls, list):
                raise ValueError('malformed coverage URLs')
            projected = [project_url(u['url'] if isinstance(u, dict) else u) for u in urls]
            if row.get('lead_url'):
                projected.append(project_url(row['lead_url']))
            cover = {'type': 'coverage', 'batch_id': batch, 'line': number, 'company_id': cid, 'legal_name': names[cid], 'raw_research_rows': counts[cid], 'status': 'research_only', 'source_urls': [u for u, _ in projected if u], 'private_http_url_sha256': [h for _, h in projected if h]}
            if not declared:
                cover['count_source'] = 'derived_from_observations'
            coverage.append(cover)
        for number, row in enumerate(observed, 1):
            cid = row['company_id']
            if cid not in ids or row['legal_name'] != names[cid]:
                raise ValueError(f'observation identity mismatch: {batch}:{number}')
            if not (row.get('research_only') is True or row.get('evidence_level') == 'research_only') or row.get('review_needed', row.get('reviewer_needed')) is not True:
                raise ValueError(f'review status mismatch: {batch}:{number}')
            if not isinstance(row.get('statement'), str) or not row['statement']:
                raise ValueError(f'missing private statement: {batch}:{number}')
            url, private_hash = project_url(row['source_url'])
            binding = row.get('entity_binding')
            if isinstance(binding, dict):
                binding = binding.get('legal_entity_binding')
            historical = bool(row.get('historical') is True or binding == 'historical'
                              or (isinstance(row.get('reason'), str) and '2018 evidence only' in row['reason']))
            producer_claimed_proven = binding == 'producer_claimed_proven'
            if producer_claimed_proven:
                binding = 'unproven'  # Producer assertion is not independent payroll-employer proof.
            if binding == 'historical':
                binding = None  # A dated plan is not proof of a current employer benefit.
            if binding is not None and binding not in ('proven', 'unproven'):
                raise ValueError('invalid entity binding')
            lead = {'type': 'lead', 'batch_id': batch, 'line': number, 'company_id': cid, 'legal_name': names[cid], 'source_url': url, 'private_http_url_sha256': private_hash, 'statement_sha256': digest(row['statement'].encode()), 'category_guess': row.get('category_guess', row.get('category')), 'entity_binding': binding, 'historical': historical, 'status': 'research_only', 'source_rights_status': 'unreviewed', 'claim_eligible': False}
            if producer_claimed_proven:
                lead['producer_claimed_proven'] = True
            for field in ('quote', 'source_quote'):
                if field in row and row[field] is not None:
                    if not isinstance(row[field], str) or not row[field]:
                        raise ValueError(f'invalid private quote: {batch}:{number}')
                    lead[field + '_sha256'] = digest(row[field].encode())
            if row.get('binding_source_url'):
                lead['binding_source_url'], lead['private_binding_http_url_sha256'] = project_url(row['binding_source_url'])
            leads.append(lead)
        inventory.append({'batch_id': batch, 'companies': 25, 'raw_research_rows': len(observed)})
    header = {'type': 'header', 'schema_version': 1, 'status': 'research_only', 'approved_benefits': 0, 'companies': len(coverage), 'raw_research_rows': len(leads), 'batches': inventory, 'canonical_sha256': {n: digest(raw) for n, raw in canonical_bytes.items()}}
    return {'header': header, 'coverage': coverage, 'leads': leads}


def output_bytes(result):
    return ''.join(encode(r) for r in [result['header'], *result['coverage'], *result['leads']]).encode()


def check_index(path, result):
    if not path.is_file() or path.is_symlink() or path.read_bytes() != output_bytes(result):
        raise ValueError('wave index drift')


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        try:
            temp.write(data)
            temp.flush()
            os.fsync(temp.fileno())
            name = temp.name
        except BaseException:
            Path(temp.name).unlink(missing_ok=True)
            raise
    os.replace(name, path)


def write_index(path, result):
    atomic_write(path, output_bytes(result))


def add_wave(pins_path, index_path, pins, input_root, canonical_root, batch):
    if any(p['batch_id'] == batch for p in pins['batches']):
        raise ValueError('batch already pinned')
    if pins['batches']:
        check_index(index_path, build(input_root, canonical_root, pins))
    updated = {'schema_version': 1, 'batches': [*pins['batches'], pin_batch(input_root, batch)]}
    result = build(input_root, canonical_root, updated)
    # Both artifacts are prepared before replacing either; failures in validation never write.
    atomic_write(pins_path, (json.dumps(updated, indent=2, sort_keys=True) + '\n').encode())
    write_index(index_path, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('check', 'add-wave', 'regenerate'))
    parser.add_argument('batch', nargs='?')
    parser.add_argument('--input-root', type=Path, required=True)
    parser.add_argument('--canonical-root', type=Path, default=HERE.parent)
    parser.add_argument('--pins', type=Path, default=HERE / 'research-wave-inputs.json')
    parser.add_argument('--output', type=Path, default=HERE / 'wave-index.jsonl')
    args = parser.parse_args()
    pins = json.loads(args.pins.read_text())
    if args.command == 'add-wave':
        if not args.batch:
            parser.error('add-wave requires a batch ID')
        result = add_wave(args.pins, args.output, pins, args.input_root, args.canonical_root, args.batch)
    else:
        if args.batch:
            parser.error('batch ID only valid with add-wave')
        result = build(args.input_root, args.canonical_root, pins)
        (check_index if args.command == 'check' else write_index)(args.output, result)
    print(json.dumps(result['header'], sort_keys=True))


if __name__ == '__main__':
    main()
