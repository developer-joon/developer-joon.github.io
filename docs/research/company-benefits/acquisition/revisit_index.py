#!/usr/bin/env python3
"""Append-only, checksum-pinned revisit metadata; not approved benefits."""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from wave_index import atomic_write, digest, encode

HERE = Path(__file__).resolve().parent
FILES = ('manifest.json', 'coverage.jsonl', 'observations.jsonl')
SCOPES = ('domestic', 'international')
SHA = re.compile(r'[0-9a-f]{64}\Z')
BATCH = re.compile(r'(domestic|international)-\d{2}\Z')


def records(raw):
    return [json.loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]


def input_name(scope, kind):
    if scope not in SCOPES or kind not in FILES:
        raise ValueError('unknown revisit input')
    return f'{scope}-revisit-{kind}'


def pin_revisit(root, scope):
    return {'scope': scope, 'files': {kind: digest((root / input_name(scope, kind)).read_bytes()) for kind in FILES}}


def safe_url(url):
    """No credentials, HTTP, encoded authority or ambiguous URL in a public locator."""
    if not isinstance(url, str) or not url.startswith('https://') or any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise ValueError('unsafe HTTPS URL')
    authority = re.split(r'[/?#]', url[8:], maxsplit=1)[0]
    if not authority or any(c in authority for c in ('@', '%', '\\')):
        raise ValueError('unsafe URL authority')
    try:
        parsed = urlsplit(url)
        host, port = parsed.hostname, parsed.port
    except ValueError as exc:
        raise ValueError('unsafe URL authority/port') from exc
    if not host or port == 0 or not re.fullmatch(r'[A-Za-z0-9.-]+', host) or host.startswith(('.', '-')) or host.endswith(('.', '-')) or '..' in host:
        raise ValueError('unsafe URL host')
    if re.search(r'(?i)(?:[?&])(token|api[_-]?key|access[_-]?key|password|secret|session|auth|credential)=', url):
        raise ValueError('credential-bearing URL')
    return url


def prior_record(root, reference, cid, parent, scope):
    """Read the exact original pinned coverage; a producer's zero assertion is insufficient."""
    if scope == 'domestic':
        if reference != {'batch_id': parent, 'coverage_file': f'{parent}/coverage.jsonl', 'coverage_line': reference.get('coverage_line')}:
            raise ValueError('prior coverage reference mismatch')
        number = reference['coverage_line']
        if type(number) is not int or number < 1:
            raise ValueError('invalid prior coverage line')
        path = root / parent / 'coverage.jsonl'
        raw = path.read_bytes()
        rows = raw.splitlines()
        if number > len(rows):
            raise ValueError('missing prior coverage line')
        line = rows[number - 1]
        previous = json.loads(line)
        return previous, digest(raw), digest(line)
    if reference.get('path') != f'{parent}/coverage.jsonl' or reference.get('previous_observation_count') != 0:
        raise ValueError('prior coverage reference mismatch')
    raw = (root / parent / 'coverage.jsonl').read_bytes()
    if reference.get('sha256') != digest(raw):
        raise ValueError('prior coverage digest mismatch')
    matched = [r for r in records(raw) if r.get('company_id') == cid]
    if len(matched) != 1:
        raise ValueError('prior coverage membership mismatch')
    return matched[0], digest(raw), None


def build(input_root, canonical_root, pins):
    if pins.get('schema_version') != 1 or not isinstance(pins.get('revisits'), list):
        raise ValueError('unsupported revisit pins')
    canonical_raw = {n: (canonical_root / n).read_bytes() for n in ('companies.jsonl', 'series-batches.jsonl')}
    canonical_sha = {n: digest(v) for n, v in canonical_raw.items()}
    names = {r['company_id']: r['legal_name'] for r in records(canonical_raw['companies.jsonl'])}
    batches = {r['batch_id']: r for r in records(canonical_raw['series-batches.jsonl'])}
    prior_index = records((HERE / 'wave-index.jsonl').read_bytes())
    prior_rows = {r['company_id']: r for r in prior_index if r.get('type') == 'coverage'}
    coverage, leads, inventory, seen = [], [], [], set()
    for pin in pins['revisits']:
        scope = pin['scope']
        if scope not in SCOPES or scope in seen:
            raise ValueError('duplicate/unknown revisit scope')
        seen.add(scope)
        if set(pin['files']) != set(FILES) or any(not isinstance(v, str) or not SHA.fullmatch(v) for v in pin['files'].values()):
            raise ValueError('invalid pinned revisit inventory')
        raw = {}
        for kind in FILES:
            path = input_root / input_name(scope, kind)
            if not path.is_file() or path.is_symlink():
                raise ValueError('missing/nonregular revisit input')
            raw[kind] = path.read_bytes()
            if digest(raw[kind]) != pin['files'][kind]:
                raise ValueError(f'pinned input mismatch: {scope}/{kind}')
        manifest = json.loads(raw['manifest.json'])
        observed, covered = records(raw['observations.jsonl']), records(raw['coverage.jsonl'])
        ids = manifest.get('company_ids')
        if not isinstance(ids, list) or len(ids) != 4 or len(set(ids)) != 4 or len(covered) != 4 or {r['company_id'] for r in covered} != set(ids):
            raise ValueError('revisit coverage union mismatch')
        if set(ids).intersection(r['company_id'] for r in coverage):
            raise ValueError('repeated company across revisits')
        if scope == 'domestic':
            if (manifest.get('canonical_companies_sha256') != canonical_sha['companies.jsonl'] or
                    manifest.get('canonical_series_batches_sha256') != canonical_sha['series-batches.jsonl'] or
                    manifest.get('coverage_count') != len(covered) or manifest.get('observation_count') != len(observed)):
                raise ValueError('domestic canonical/count mismatch')
        else:
            if manifest.get('canonical') != canonical_sha or manifest.get('counts', {}).get('companies') != len(covered) or manifest['counts'].get('observations') != len(observed) or manifest['counts'].get('approved') != 0:
                raise ValueError('international canonical/count mismatch')
        declaration = manifest.get('files' if scope == 'domestic' else 'files_sha256', {})
        if set(declaration) != {input_name(scope, kind) for kind in FILES if kind != 'manifest.json'}:
            raise ValueError('producer file inventory mismatch')
        for kind, rows in (('observations.jsonl', observed), ('coverage.jsonl', covered)):
            value = declaration[input_name(scope, kind)]
            if scope == 'domestic':
                if value.get('rows') != len(rows) or value.get('bytes') != len(raw[kind]):
                    raise ValueError('producer row/byte count mismatch')
                value = value.get('sha256')
            if value != digest(raw[kind]):
                raise ValueError('producer digest mismatch')
        counts = collections.Counter(r['company_id'] for r in observed)
        if set(counts) - set(ids):
            raise ValueError('observation membership mismatch')
        positive = {cid for cid in ids if counts[cid]}
        if scope == 'domestic':
            if manifest.get('unique_company_leads') != len(positive) or set(manifest.get('blocked_company_ids', [])) != set(ids) - positive or manifest.get('absence_conclusions') != 0:
                raise ValueError('producer summary mismatch')
        elif manifest['counts'].get('source_backed_research_leads') != len(observed):
            raise ValueError('producer summary mismatch')
        references = {}
        for number, row in enumerate(covered, 1):
            cid = row['company_id']
            parent = row.get('original_batch_id', row.get('batch_id'))
            if not BATCH.fullmatch(parent or '') or not parent.startswith(scope + '-') or parent not in batches or cid not in batches[parent]['company_ids'] or names.get(cid) != row.get('legal_name'):
                raise ValueError('canonical identity/parent membership mismatch')
            # Older canonical batches predate the repository wave index. Their
            # checksum-bound original coverage below is the zero-row proof.
            if cid in prior_rows and (prior_rows[cid]['batch_id'] != parent or prior_rows[cid]['raw_research_rows'] != 0):
                raise ValueError('prior zero index mismatch')
            reference = row.get('prior_coverage_reference', row.get('previous_coverage'))
            if not isinstance(reference, dict):
                raise ValueError('missing prior coverage reference')
            previous, file_sha, line_sha = prior_record(input_root, reference, cid, parent, scope)
            old_counts = [previous[k] for k in ('observation_count', 'positive_lead_count', 'observations_count') if k in previous]
            if previous.get('company_id') != cid or previous.get('legal_name') != names[cid] or not old_counts or any(type(v) is not int or v != 0 for v in old_counts):
                raise ValueError('prior coverage zero/identity mismatch')
            if scope == 'domestic':
                if row.get('prior_coverage_file_sha256') != file_sha or row.get('prior_coverage_line_sha256') != line_sha:
                    raise ValueError('prior coverage digest mismatch')
                declared = manifest.get('original_prior_coverage_references', [])
                if not any(x.get('company_id') == cid and x.get('batch_id') == parent and x.get('coverage_file') == reference['coverage_file'] and x.get('coverage_line') == reference['coverage_line'] and x.get('prior_coverage_file_sha256') == file_sha and x.get('prior_coverage_line_sha256') == line_sha for x in declared):
                    raise ValueError('prior coverage manifest mismatch')
            else:
                if manifest.get('previous_coverage', {}).get(cid) != reference:
                    raise ValueError('prior coverage manifest mismatch')
            if type(row.get('observation_count')) is not int or row['observation_count'] != counts[cid]:
                raise ValueError('coverage count mismatch')
            status = row.get('outcome', row.get('status'))
            expected = 'research_only_pending_independent_review' if counts[cid] else 'research_incomplete'
            if status != expected or (scope == 'domestic' and row.get('approval_status') != 'not_independently_reviewed'):
                raise ValueError('coverage status mismatch')
            references[cid] = (parent, reference)
            coverage.append({'type': 'coverage', 'scope': scope, 'line': number, 'company_id': cid,
                             'parent_batch_id': parent, 'prior_coverage_sha256': file_sha,
                             'raw_research_rows': counts[cid], 'status': 'research_only',
                             'rights_status': 'rights_unreviewed', 'approved_count': 0,
                             'research_incomplete': counts[cid] == 0})
        for number, row in enumerate(observed, 1):
            cid = row['company_id']
            if cid not in references or row.get('legal_name') != names[cid]:
                raise ValueError('observation identity mismatch')
            parent, reference = references[cid]
            if row.get('original_batch_id', row.get('batch_id')) != parent:
                raise ValueError('observation parent membership mismatch')
            if scope == 'domestic':
                if row.get('prior_coverage_reference') != reference or row.get('review_status') != 'research_only_pending_independent_review' or row.get('rights_status') != 'private_quote_only_permission_undetermined':
                    raise ValueError('observation reference/rights mismatch')
            elif row.get('approval_status') != 'not_approved' or row.get('historical_only') is not False:
                raise ValueError('observation approval/history mismatch')
            if not isinstance(row.get('statement'), str) or not row['statement']:
                raise ValueError('missing statement')
            quote = row.get('quote')
            if quote is None and row.get('quote_absence_permitted') is not True:
                raise ValueError('missing quote without explicit permission')
            if quote is not None and (not isinstance(quote, str) or not quote):
                raise ValueError('invalid quote')
            source = safe_url(row['source_url'])
            final = safe_url(row.get('final_url', row.get('source_final_url')))
            lead = {'type': 'lead', 'scope': scope, 'line': number, 'company_id': cid,
                    'parent_batch_id': parent, 'source_url': source, 'final_url': final,
                    'statement_sha256': digest(row['statement'].encode('utf-8')),
                    'status': 'research_only', 'rights_status': 'rights_unreviewed',
                    'approved_count': 0, 'claim_eligible': False,
                    'currentness_caveat': ('2025 SEC plan; historical plan description, not current policy proof' if scope == 'international' else 'current policy and employer scope unreviewed')}
            if quote is not None:
                lead['quote_sha256'] = digest(quote.encode('utf-8'))
            if scope == 'international':
                if row.get('plan_year_end') != '2025-12-31':
                    raise ValueError('SEC plan year mismatch')
                span = row.get('scope_quote')
                if span is not None:
                    if not isinstance(span, str) or not span:
                        raise ValueError('invalid scope quote')
                    lead['scope_quote_sha256'] = digest(span.encode('utf-8'))
            leads.append(lead)
        inventory.append({'scope': scope, 'companies': len(covered), 'raw_research_rows': len(observed)})
    header = {'type': 'header', 'schema_version': 1, 'status': 'research_only',
              'rights_status': 'rights_unreviewed', 'approved_count': 0,
              'companies': len(coverage), 'raw_research_rows': len(leads),
              'revisits': inventory, 'canonical_sha256': canonical_sha}
    return {'header': header, 'coverage': coverage, 'leads': leads}


def output_bytes(result):
    return ''.join(encode(x) for x in (result['header'], *result['coverage'], *result['leads'])).encode('utf-8')


def check_index(path, result):
    if not path.is_file() or path.is_symlink() or path.read_bytes() != output_bytes(result):
        raise ValueError('revisit index drift')


def write_index(path, result):
    atomic_write(path, output_bytes(result))


def add(pins_path, output, pins, input_root, canonical_root, scope):
    if scope not in SCOPES or scope in [x['scope'] for x in pins['revisits']]:
        raise ValueError('unknown/already pinned revisit')
    if pins['revisits']:
        check_index(output, build(input_root, canonical_root, pins))
    updated = {'schema_version': 1, 'revisits': [*pins['revisits'], pin_revisit(input_root, scope)]}
    result = build(input_root, canonical_root, updated)
    atomic_write(pins_path, (json.dumps(updated, indent=2, sort_keys=True) + '\n').encode())
    write_index(output, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('add', 'check'))
    parser.add_argument('scope', nargs='?')
    parser.add_argument('--input-root', type=Path, required=True)
    parser.add_argument('--canonical-root', type=Path, default=HERE.parent)
    parser.add_argument('--pins', type=Path, default=HERE / 'revisit-inputs.json')
    parser.add_argument('--output', type=Path, default=HERE / 'revisit-index.jsonl')
    args = parser.parse_args()
    pins = json.loads(args.pins.read_text())
    if args.command == 'add':
        if args.scope is None:
            parser.error('add requires domestic or international')
        result = add(args.pins, args.output, pins, args.input_root, args.canonical_root, args.scope)
    else:
        if args.scope is not None:
            parser.error('check does not accept scope')
        result = build(args.input_root, args.canonical_root, pins)
        check_index(args.output, result)
    print(json.dumps(result['header'], sort_keys=True))


if __name__ == '__main__':
    main()
