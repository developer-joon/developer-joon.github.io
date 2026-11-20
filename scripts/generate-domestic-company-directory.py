#!/usr/bin/env python3
"""Rebuild a dated, research-only Korean recruitment directory from pinned private inputs.

The DART workbook is used exclusively to exclude aliases of existing legal identities.
Its other rows, names, addresses and raw crosswalk never leave this process.
"""
import argparse
import csv
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile

CSV_SHA = '16756d002508995b70f158bd279a48fb825af6a79820eb82b0009efcbeb82365'
DART_SHA = '6dcf6031e8e9eecbcefc120a7461f9a7bd3ef97c88ba55d20d80f416285de1c3'
EDITION = '2026-03-06'
MAX_SHARD_BYTES = 256 * 1024
MAX_RECORDS = 500
MAX_SHARDS = 400
COLUMNS = ['기업명','사업자번호','지역구분','종업원수','공고명','고용형태','공고등록일']
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':')) + '\n').encode('utf-8')


def safe_text(value, limit):
    value = value.strip()
    if not value or len(value) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        return None
    if any(c in value for c in '<>'):
        return None
    return value


def valid_day(value):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value or ''):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def bridge(path, relevant):
    """Only retain CRNs for recruitment BIDs; reject every ambiguous mapping."""
    result = {}
    with zipfile.ZipFile(path) as archive:
        with archive.open('xl/worksheets/sheet1.xml') as stream:
            row_number = 0
            for _, row in ET.iterparse(stream, events=('end',)):
                if row.tag != NS + 'row':
                    continue
                row_number += 1
                values = {}
                for cell in row:
                    col = re.match(r'[A-Z]+', cell.get('r', ''))
                    if col and col.group() in ('G', 'H'):
                        values[col.group()] = ''.join(cell.itertext()).strip()
                bid, crn = values.get('H', ''), values.get('G', '')
                if re.fullmatch(r'\d{3}-\d{2}-\d{5}', bid):
                    bid = bid.replace('-', '')
                if bid in relevant and re.fullmatch(r'\d{13}', crn):
                    result.setdefault(bid, set()).add(crn)
                row.clear()
    return result


def read_jobs(path):
    latest = {}
    job_rows = 0
    invalid_date_rows = 0
    valid_named_bids = set()
    with open(path, encoding='cp949', newline='') as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != COLUMNS:
            raise ValueError('CSV schema changed')
        for entry in reader:
            if None in entry or any(value is None for value in entry.values()):
                raise ValueError('CSV row schema changed')
            job_rows += 1
            bid, day = entry['사업자번호'], entry['공고등록일']
            name = safe_text(entry['기업명'] or '', 120)
            if not re.fullmatch(r'\d{10}', bid or '') or not name:
                continue
            valid_named_bids.add(bid)
            if not valid_day(day):
                invalid_date_rows += 1
                continue
            region = safe_text(entry['지역구분'] or '', 40)
            count = entry['종업원수'] or ''
            staff = int(count) if re.fullmatch(r'\d{1,8}', count) else None
            previous = latest.get(bid)
            if previous is None or day > previous['date']:
                latest[bid] = {'date': day, 'names': {name}, 'regions': {region}, 'staff': {staff}}
            elif day == previous['date']:
                previous['names'].add(name)
                previous['regions'].add(region)
                previous['staff'].add(staff)
    return job_rows, latest, invalid_date_rows, len(valid_named_bids)


def _expected(csv_path, dart_path, selected_path, base_path, hashes):
    for path, expected in zip((csv_path, dart_path), hashes):
        if sha(path) != expected:
            raise ValueError('private input digest mismatch')
    base_ids = set()
    for line in Path(selected_path).read_text(encoding='utf-8').splitlines():
        obj = json.loads(line)
        ident = obj['registry_id']
        if re.fullmatch(r'KR-CRN-\d{13}', ident):
            base_ids.add(ident[7:])
    if not base_ids:
        raise ValueError('no base CRNs')
    job_rows, latest, invalid_date_rows, valid_named_bids = read_jobs(csv_path)
    joins = bridge(dart_path, latest)
    if any(len(crns) > 1 for crns in joins.values()):
        raise ValueError('ambiguous DART bridge')
    records = []
    conflicts = aliases = 0
    for bid in sorted(latest):
        observation = latest[bid]
        if len(observation['names']) != 1:
            conflicts += 1
            continue
        crns = joins.get(bid, set())
        base_matches = crns & base_ids if len(crns) == 1 else set()
        is_alias = bool(base_matches)
        if is_alias:
            aliases += 1
        record = {
            'id': 'KR-CRN-' + next(iter(base_matches)) if is_alias else 'KR-BIZ-' + bid,
            'name': next(iter(observation['names'])),
            'observation_date': observation['date'],
            'source_type': 'dated_recruitment_observation',
            'size_class': 'unclassified',
        }
        if len(observation['regions']) == 1:
            region = next(iter(observation['regions']))
            if region is not None:
                record['region'] = region
        if len(observation['staff']) == 1:
            staff = next(iter(observation['staff']))
            if staff is not None:
                record['employee_count'] = staff
        records.append(record)
    records.sort(key=lambda r: r['id'])
    if len({r['id'] for r in records}) != len(records):
        raise ValueError('duplicate public identity')
    files = {}
    chunks = []
    batch = []

    def flush():
        if not batch:
            return
        if len(chunks) >= MAX_SHARDS:
            raise ValueError('too many shards')
        path = f'shards/{len(chunks):04d}.json'
        content = encoded({'records': batch[:]})
        if len(content) > MAX_SHARD_BYTES:
            raise ValueError('oversized shard')
        files[path] = content
        chunks.append({'path': path, 'count': len(batch), 'bytes': len(content),
                       'sha256': hashlib.sha256(content).hexdigest()})
        batch.clear()

    for record in records:
        if len(batch) >= MAX_RECORDS or len(encoded({'records': batch + [record]})) > MAX_SHARD_BYTES:
            flush()
        batch.append(record)
    flush()
    totals = {'job_rows': job_rows, 'valid_named_bid_before_date_filter': valid_named_bids,
              'invalid_date_rows': invalid_date_rows, 'candidate_unique_bid': len(latest),
              'excluded_last_day_name_conflict': conflicts, 'base_aliases': aliases,
              'new_records': len(records) - aliases, 'listing_records': len(records)}
    manifest = {
        'schema_version': 'domestic-directory-v1',
        'base_manifest_sha256': sha(base_path),
        'sources': {
            'recruitment': {'sha256': hashes[0], 'url': 'https://www.data.go.kr/data/15100246/fileData.do',
                            'edition': EDITION, 'license': '이용허락범위 제한 없음'},
            'dart_bridge': {'sha256': hashes[1], 'url': 'https://dart.fss.or.kr/dsae001/downloadExcel.do',
                            'acquired_on': '2026-11-20',
                            'license': 'full republication unverified; private exact-ID alias exclusion only'},
        },
        'limits': {'max_shards': MAX_SHARDS, 'max_shard_bytes': MAX_SHARD_BYTES,
                   'max_records_per_shard': MAX_RECORDS},
        'methodology': 'Dated recruitment observations, not currently active employers, benefit approval or legal size certificates. Latest-day contradictory names excluded; ambiguous bridge never aliases. Region and staff omitted on conflict. All sizes unclassified.',
        'totals': totals, 'chunks': chunks,
    }
    files['manifest.json'] = encoded(manifest)
    return manifest, files


def build(csv_path, dart_path, selected_path, base_path, output, hashes=(CSV_SHA, DART_SHA), check=False):
    manifest, files = _expected(csv_path, dart_path, selected_path, base_path, hashes)
    output = Path(output)
    if check:
        if not output.is_dir() or {str(p.relative_to(output)) for p in output.rglob('*') if p.is_file()} != set(files):
            raise ValueError('directory file inventory mismatch')
        for name, content in files.items():
            if (output / name).read_bytes() != content:
                raise ValueError('directory byte mismatch: ' + name)
        return manifest
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.domestic-directory-', dir=output.parent))
    backup = None
    try:
        for name, content in files.items():
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        if output.exists():
            backup = Path(tempfile.mkdtemp(prefix='.domestic-directory-backup-', dir=output.parent))
            backup.rmdir()
            os.replace(output, backup)
        try:
            os.replace(stage, output)
        except BaseException:
            if backup is not None:
                os.replace(backup, output)
                backup = None
            raise
        if backup is not None:
            shutil.rmtree(backup)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, required=True)
    parser.add_argument('--dart', type=Path, required=True)
    parser.add_argument('--selected', type=Path, default=Path('docs/research/company-benefits/population/domestic-selected.jsonl'))
    parser.add_argument('--base', type=Path, default=Path('community-app/public/data/company-benefits/manifest.json'))
    parser.add_argument('--output', type=Path, default=Path('community-app/public/data/company-benefits/domestic-directory-v1'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = build(args.csv, args.dart, args.selected, args.base, args.output, check=args.check)
    print(json.dumps(result['totals'], sort_keys=True))


if __name__ == '__main__':
    main()
