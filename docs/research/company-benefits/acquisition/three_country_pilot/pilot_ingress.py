#!/usr/bin/env python3
"""Measured three-country identity ingress. No employment or benefit approval."""
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
BASE = HERE.parents[1]
PRIVATE = Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes')) / 'data/benefit-batch-wave/three-country-pilot'
EXPANSION_ARCHIVE = Path(os.environ.get('EXPANSION_ARCHIVE_ROOT', PRIVATE.parent / 'expansion-private-prepush'))
INPUTS = {
    'kr/dart-company-overview.xlsx': '265c6baf6899aa6e310b1b61c88768c62fb46a6c755b24b6996d5edd0b276824',
    'kr/candidates.jsonl': '799e03f5f1c8f9b725d760e55e12f01fd651d1c6bf6f391ab98b8e487b322a67',
    'kr/pilot-manifest.json': '8172a7af20b2aa2495183c757c0ee3e5c438e9c5fcf8b801c03652aff6917096',
    'jp/nta-2026-10-30-tottori-unicode.zip': '7a97dc4b2b16b8b23ba79d5a972eedb6b6819e5b50336ce0d35e54f3d8546072',
    'jp/identity-pilot.json': 'cdb88f1b64b790ecb287b9fe86625eca549db30d6a59019b6f751932a23c0738',
    'us/candidate-pilot.json': '4de22deb414ce4484920eabfa512b6882b860d5ee0cd9c5b242d3c05d125ed1a',
}
BASELINE = {
    'population/domestic-selected.jsonl': ('76c9396c0620ebf25064f812870a207c36ab91d8d4d815bc3c49694999ccbdc4', 1000),
    'population/international-selected.jsonl': ('eb4ddbe78c7db5bb8589ec2b64da09c61996399550f8da6d818d16ff06824e6a', 1000),
    'acquisition/expansion/candidates.v1.jsonl': ('38ff846d0603b7b2d0ac07fb4ba0aa047a0e82eb139d8c88c2ee0a6607dea48e', 36),
    'acquisition/expansion/candidates.v2.jsonl': ('34ab09582e86575954d59346ca16d1b95fb6f68287a3326be57dcae16dc98f16', 35),
}
PRIVATE_INVENTORY_PATH = HERE / 'private-input-inventory.v1.json'
PRIVATE_INVENTORY_SHA = '3361d490c7118c25ce016c1fc4b28292d6d06b1d4ad3fb89f28ae3f576825c56'
SOURCE_PINS = {
    'companies.jsonl': 'e5888e3081d8ead3cc67c18d8e8e8007066c1c0de1c68103c59e390be77894ed',
    'series-batches.jsonl': '51e1ae04cc02584199de65be73e0723b808216ccc93ecea5dfdb0f3a85f95423',
    'population-protocol.json': 'cc5fa6c0e3dba88b51832628d4a70069855f0a00048124fdfdabc5638815d4df',
}
US_STATES = set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split())


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def load(path):
    def pairs(items):
        out = {}
        for key, value in items:
            require(key not in out, 'duplicate JSON key')
            out[key] = value
        return out
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs)


def normalized(name):
    return ''.join(c for c in unicodedata.normalize('NFKC', name).casefold() if c.isalnum())


require(digest(PRIVATE_INVENTORY_PATH) == PRIVATE_INVENTORY_SHA, 'private inventory SHA mismatch')
PRIVATE_INVENTORY = load(PRIVATE_INVENTORY_PATH)


def validate(private=PRIVATE, base=BASE):
    require(PRIVATE_INVENTORY['schema_version'] == 'three-country-pilot-private-input-inventory-v1', 'private inventory schema')
    authoritative = PRIVATE_INVENTORY['authoritative']
    auxiliary = PRIVATE_INVENTORY['auxiliary']
    require(len(authoritative) == 6 and len(auxiliary) == 9 and
            {r['path'] for r in authoritative} == set(INPUTS) and
            len({r['path'] for r in authoritative + auxiliary}) == 15, 'private inventory coverage')
    expected_files = {r['path']: r['sha256'] for r in authoritative + auxiliary}
    require(all(re.fullmatch(r'(kr|jp|us)/[\w.-]+', name) and
                re.fullmatch(r'[0-9a-f]{64}', sha) for name, sha in expected_files.items()), 'private inventory path/hash')
    actual_files = set()
    for country in ('kr', 'jp', 'us'):
        for p in (private / country).rglob('*'):
            require(not p.is_symlink(), 'private symlink')
            if p.is_file():
                actual_files.add(p.relative_to(private).as_posix())
            else:
                require(p.is_dir(), 'private non-file')
    require(actual_files == set(expected_files), 'private file inventory mismatch')
    for name, expected in expected_files.items():
        p = private / name
        require(p.is_file() and not p.is_symlink() and p.stat().st_size <= 35_000_000, 'private input missing/oversized')
        require(digest(p) == expected, 'private input SHA mismatch: ' + name)
    require(all(r['sha256'] == INPUTS[r['path']] for r in authoritative), 'authoritative input binding')
    for name, expected in SOURCE_PINS.items():
        require(digest(base / name) == expected, 'base source SHA mismatch: ' + name)
    old_ids, old_names = set(), set()
    for name, (sha, count) in BASELINE.items():
        p = EXPANSION_ARCHIVE / Path(name).name if name.startswith('acquisition/expansion/') else base / name
        require(p.is_file() and not p.is_symlink(), 'baseline input missing: ' + name)
        require(digest(p) == sha, 'baseline SHA mismatch: ' + name)
        rows = [json.loads(line) for line in p.read_text().splitlines()]
        require(len(rows) == count, 'baseline count mismatch')
        for row in rows:
            old_ids.add(row['company_id'])
            old_names.add((row['jurisdiction'], normalized(row['legal_name'])))
    krm = load(private / 'kr/pilot-manifest.json')
    kr = [json.loads(line) for line in (private / 'kr/candidates.jsonl').read_text().splitlines()]
    jp = load(private / 'jp/identity-pilot.json')
    us = load(private / 'us/candidate-pilot.json')
    require(krm['schema_version'] == 'kr-dart-identity-pilot-v1' and krm['source_sha256'] == INPUTS['kr/dart-company-overview.xlsx'] and krm['candidates_sha256'] == INPUTS['kr/candidates.jsonl'], 'KR source/manifest binding')
    require(krm['selected_count'] == len(kr) == 100 and krm['excluded_ledgers'] == {k: {'sha256': h, 'rows': n} for k, (h, n) in BASELINE.items()}, 'KR selection/baseline')
    require(jp['zip_sha256'] == INPUTS['jp/nta-2026-10-30-tottori-unicode.zip'] and jp['source_date'] == '2026-10-30' and jp['status'] == 'research_only_identity_not_employer', 'JP source/date/status')
    require(len(jp['selected']) == 100, 'JP selection inflation')
    require(us['schema_version'] == 'us-sec-nonsec-pilot-v1' and us['qualified_count'] == len(us['candidates']) == 28 and us['sec_direct_http_status'] == 403 and us['sec_ticker_http_status'] is None and isinstance(us['sec_ticker_extracted_sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', us['sec_ticker_extracted_sha256']), 'US count/transport/ticker extraction')
    require(us['baseline_sha256'] == {'docs/research/company-benefits/' + ('population/international-effective-selected.jsonl' if k == 'population/international-selected.jsonl' else k): h for k, (h, _) in BASELINE.items() if k != 'population/domestic-selected.jsonl'}, 'US baseline binding')
    # Inspect compressed container metadata before opening a member; never extract to disk.
    with zipfile.ZipFile(private / 'kr/dart-company-overview.xlsx') as archive:
        infos = archive.infolist()
        require(len(infos) == 9 and len({i.filename for i in infos}) == 9 and all(i.file_size < 220_000_000 for i in infos), 'XLSX bounds')
        sheet = archive.getinfo('xl/worksheets/sheet1.xml')
        require(sheet.file_size == krm['worksheet_uncompressed_bytes'], 'XLSX sheet size')
        wanted = {r['source_row']: r for r in kr}
        seen_rows = set()
        ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
        with archive.open(sheet) as stream:
            for _, elem in ET.iterparse(stream, events=('end',)):
                if elem.tag != ns + 'row':
                    continue
                num = int(elem.attrib['r'])
                if num in wanted:
                    cells = {re.match(r'[A-Z]+', c.attrib['r']).group(): ''.join(t.text or '' for t in c.iter(ns + 't')).strip() for c in elem.findall(ns + 'c')}
                    row = wanted[num]
                    require(cells.get('A') == row['legal_name'] and cells.get('G') == row['company_id'][7:], 'KR worksheet row mismatch')
                    seen_rows.add(num)
                elem.clear()
        require(len(seen_rows) == 100, 'KR missing worksheet rows')
    with zipfile.ZipFile(private / 'jp/nta-2026-10-30-tottori-unicode.zip') as archive:
        infos = archive.infolist()
        require([(i.filename, i.file_size) for i in infos] == [(x['name'], x['uncompressed_bytes']) for x in jp['archive_entries']] and sum(i.file_size for i in infos) < 5_000_000, 'JP ZIP bounds')
        csv_info = infos[0]
        h = hashlib.sha256()
        with archive.open(csv_info) as stream:
            for chunk in iter(lambda: stream.read(65536), b''):
                h.update(chunk)
        require(h.hexdigest() == jp['csv_sha256'], 'JP CSV SHA')
        selected = {r['corporate_number']: r for r in jp['selected']}
        matched = set()
        with archive.open(csv_info) as stream:
            for fields in csv.reader((line.decode('utf-8-sig') for line in stream)):
                if fields[1] in selected:
                    row = selected[fields[1]]
                    require(fields[6] == row['legal_name'] and fields[8] == row['kind_code'] and
                            fields[9] == row['prefecture'] and fields[10] == row['city'] and
                            fields[11] == row['street'] and fields[15] == row['post_code'] and
                            fields[18] == row['close_date'] == '' and fields[23] == row['latest'] == '1' and
                            fields[29] == row['search_exclusion'] == '0' and
                            row['kind_code'] in ('301', '302'), 'JP CSV identity mismatch')
                    matched.add(fields[1])
        require(len(matched) == 100, 'JP missing CSV identities')
    assigned, ids, names = [], set(), set()
    for worker, rows in (('KR', kr), ('JP', jp['selected']), ('US', us['candidates'])):
        for row in rows:
            cid = 'JP-CN-' + row['corporate_number'] if worker == 'JP' else row['company_id']
            name = row['legal_name']
            grammar = {'KR': r'KR-CRN-\d{13}', 'JP': r'JP-CN-\d{13}', 'US': r'US-CIK\d{10}'}[worker]
            require(isinstance(cid, str) and re.fullmatch(grammar, cid) and isinstance(name, str) and name.strip(), 'country-specific ID/name')
            require(cid not in ids and cid not in old_ids and (worker, normalized(name)) not in names and (worker, normalized(name)) not in old_names, 'duplicate or existing ID/name')
            ids.add(cid)
            names.add((worker, normalized(name)))
            if worker == 'KR':
                require(row['jurisdiction'] == 'KR' and row['source_sha256'] == krm['source_sha256'] and row['status'] == 'identity_discovery_only' and row['review_status'] == 'research_only' and row['selected_entity_worker_evidence'] == 'unproven', 'KR identity-only claim')
            elif worker == 'JP':
                require(row['identity_only'] is True, 'JP identity-only claim')
            else:
                require(row['cik'] == cid[-10:] and row['http_status'] is None and row['retrieval_status'] == 'extraction_success' and row['payroll_employer_bound'] is False and row['review_status'] == 'research_only' and re.fullmatch(r'[0-9a-f]{64}', row['source_extraction_sha256']), 'US extractor-only claim')
                require(row['entity_type'] == 'operating' and
                        isinstance(row['state_of_incorporation'], str) and row['state_of_incorporation'] in US_STATES and
                        isinstance(row['business_address_state_or_country'], str) and row['business_address_state_or_country'] in US_STATES and
                        row['source_url'] == 'https' + '://data.sec.gov/submissions/CIK' + row['cik'] + '.json', 'US domestic identity/source')
            assigned.append({'company_id': cid, 'legal_name': name, 'worker': worker, 'status': 'identity_only'})
    summary = {'schema_version': 'three-country-pilot-assignment-summary-v1', 'counts': {'KR': len(kr), 'JP': len(jp['selected']), 'US': len(us['candidates'])}, 'identity_only': len(assigned), 'employment_verified': 0, 'review_status': 'pending_independent_review', 'source_sha256': {k: INPUTS[k] for k in sorted(INPUTS)}, 'source_snapshot_date': {'KR': None, 'JP': jp['source_date'], 'US': None}, 'candidate_generated_at': {'KR': krm['generated_at_utc'], 'JP': None, 'US': None}, 'identity_observed_at': {'KR': None, 'JP': jp['observed_at'], 'US': us['candidates'][0]['observed_at']}, 'rights_status': {'KR': 'republication_not_established', 'JP': 'attribution_required_review_pending', 'US': 'extractor_only_rights_unreviewed'}, 'retrieval_status': {'KR': 'private_raw_xlsx_hash_verified', 'JP': 'private_raw_zip_csv_hash_verified', 'US': 'direct_403_extractor_text_only_no_raw_http'}}
    return summary, assigned


def check_summary(summary, path=HERE / 'assignment-summary.v1.json'):
    require(load(path) == summary, 'public summary drift')


def write_assignment(private=PRIVATE, base=BASE):
    summary, rows = validate(private, base)
    check_summary(summary)
    destination = private / 'assignment.v1.json'
    payload = json.dumps({'schema_version': 'three-country-pilot-private-assignment-v1', 'summary': summary, 'rows': rows}, ensure_ascii=False, sort_keys=True, indent=2) + '\n'
    require(private.is_dir() and not private.is_symlink() and
            private.stat().st_mode & 0o077 == 0, 'private custody permissions')
    fd, temporary = tempfile.mkstemp(prefix='.assignment-', suffix='.json', dir=private)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            fd = -1  # fdopen owns the descriptor, including on write failure.
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        # Replacing a directory entry never truncates the old inode or follows its hardlinks.
        os.replace(temporary, destination)
    finally:
        if fd != -1:
            os.close(fd)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return summary


if __name__ == '__main__':
    if sys.argv[1:] != ['check']:
        raise SystemExit('usage: pilot_ingress.py check')
    print(json.dumps(write_assignment(), sort_keys=True))
