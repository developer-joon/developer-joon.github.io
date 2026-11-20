#!/usr/bin/env python3
"""Build an independent, dated legal-size evidence sibling from pinned private sources."""
import argparse
import csv
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

FTC_SHA = '080238dc8e95bc7cff0100534854d317ed6948a25a291688f451fa5be23053fb'
DART_SHA = '6dcf6031e8e9eecbcefc120a7461f9a7bd3ef97c88ba55d20d80f416285de1c3'
JOB_SHA = '16756d002508995b70f158bd279a48fb825af6a79820eb82b0009efcbeb82365'
MID_SHA = '962e10cb95b8b8ee274d420f4e89293dbc8da8e4ba9966178ef6af068fe6e040'
SME_SHA = 'c8242d45872ffb1d35241b434b4dfce828a39697fc27bb6f9d8b565730bed4ba'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
CUTOFF = '2026-11-20'


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode()


def safe(value, length=120):
    return isinstance(value, str) and 0 < len(value.strip()) <= length and not any(
        ord(c) < 32 or ord(c) == 127 or c in '<>' for c in value)


def same_name(left, right):
    # Only the explicit corporate designator may vary; retain all substantive characters.
    return left.replace('(주)', '').strip() == right.replace('(주)', '').strip()


def rows(archive, sheet):
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        with archive.open('xl/sharedStrings.xml') as stream:
            for _, element in ET.iterparse(stream, events=('end',)):
                if element.tag == NS + 'si':
                    shared.append(''.join(element.itertext()))
                    element.clear()
    with archive.open(f'xl/worksheets/sheet{sheet}.xml') as stream:
        for _, row in ET.iterparse(stream, events=('end',)):
            if row.tag != NS + 'row':
                continue
            values = {}
            for cell in row:
                match = re.match(r'[A-Z]+', cell.get('r', ''))
                if not match:
                    continue
                element = cell.find(NS + 'v')
                value = shared[int(element.text)] if cell.get('t') == 's' and element is not None else ''.join(cell.itertext())
                values[match.group()] = value.strip()
            yield int(row.get('r')), values
            row.clear()


def ftc_affiliates(path):
    claims = {}
    count = 0
    with zipfile.ZipFile(path) as book:
        for number, values in rows(book, 4):
            if number <= 3 or not values.get('D', ''):
                continue
            crn, name, group = (values.get(key, '') for key in ('D', 'C', 'B'))
            if re.fullmatch(r'\d{6}-\d{7}', crn):
                crn = crn.replace('-', '')
            if not re.fullmatch(r'\d{13}', crn) or not safe(name) or not safe(group, 80):
                raise ValueError('FTC affiliate row schema changed')
            count += 1
            claims.setdefault(crn, set()).add((name, group))
    conflicts = {crn for crn, claims_for_crn in claims.items() if len(claims_for_crn) != 1}
    return {crn: next(iter(items)) for crn, items in claims.items() if crn not in conflicts}, conflicts, count


def dart_bridge(path, bids):
    mapping = {}
    with zipfile.ZipFile(path) as book:
        for _, values in rows(book, 1):
            bid = values.get('H', '')
            if re.fullmatch(r'\d{3}-\d{2}-\d{5}', bid):
                bid = bid.replace('-', '')
            crn = values.get('G', '')
            if bid in bids and re.fullmatch(r'\d{13}', crn):
                mapping.setdefault(bid, set()).add(crn)
    return mapping


def csv_records(path, fields, bid_key, name_key, expiry_key=None):
    result = {}
    with open(path, encoding='cp949', newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != fields:
            raise ValueError('source CSV schema changed')
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError('source CSV row schema changed')
            bid, name = row[bid_key], row[name_key].strip()
            if not re.fullmatch(r'\d{10}', bid) or not safe(name):
                continue
            expiry = row[expiry_key] if expiry_key else None
            if expiry_key:
                try:
                    if date.fromisoformat(expiry) < date.fromisoformat(CUTOFF):
                        continue
                except ValueError:
                    continue
            result.setdefault(bid, set()).add((name, expiry))
    return result


def accepted_directory(directory, base_sha):
    manifest_path = directory / 'manifest.json'
    manifest = json.loads(manifest_path.read_bytes())
    if manifest['base_manifest_sha256'] != base_sha:
        raise ValueError('directory base binding mismatch')
    result = {}
    for chunk in manifest['chunks']:
        path = chunk['path']
        if not re.fullmatch(r'shards/\d{4}\.json', path):
            raise ValueError('unsafe directory shard path')
        raw = (directory / path).read_bytes()
        if len(raw) != chunk['bytes'] or hashlib.sha256(raw).hexdigest() != chunk['sha256']:
            raise ValueError('directory shard digest mismatch')
        records = json.loads(raw)['records']
        if len(records) != chunk['count']:
            raise ValueError('directory shard count mismatch')
        for row in records:
            ident = row['id']
            if not re.fullmatch(r'KR-(?:BIZ-\d{10}|CRN-\d{13})', ident) or ident in result or not safe(row['name']):
                raise ValueError('invalid directory identity')
            result[ident] = row['name']
    if len(result) != manifest['totals']['listing_records']:
        raise ValueError('directory total mismatch')
    return result


def build(ftc, dart, mid, sme, selected, base, directory, output,
          hashes=(FTC_SHA, DART_SHA, MID_SHA, SME_SHA), check=False):
    for path, expected in zip((ftc, dart, mid, sme), hashes):
        if digest(path) != expected:
            raise ValueError('private input digest mismatch')
    base_sha = digest(base)
    directory_sha = digest(directory / 'manifest.json')
    base_ids = {json.loads(line)['registry_id'] for line in Path(selected).read_text().splitlines()
                if line and json.loads(line)['registry_id'].startswith('KR-CRN-')}
    if not base_ids:
        raise ValueError('empty selected base')
    directory_ids = accepted_directory(Path(directory), base_sha)
    directory_manifest = json.loads((Path(directory) / 'manifest.json').read_bytes())
    if (directory_manifest['sources']['recruitment']['sha256'] != JOB_SHA or
            directory_manifest['sources']['dart_bridge']['sha256'] != hashes[1]):
        raise ValueError('directory source binding mismatch')
    claims, conflicts, ftc_rows = ftc_affiliates(ftc)
    bids = {ident[7:] for ident in directory_ids if ident.startswith('KR-BIZ-')}
    bridges = dart_bridge(dart, bids)
    ambiguous = {bid for bid, crns in bridges.items() if len(crns) != 1}
    claimed_crns = set().union(*bridges.values()) if bridges else set()
    mid_claims = csv_records(mid, ['순번','사업자번호','업체명','내일채움공제 가입인원'], '사업자번호', '업체명')
    sme_claims = csv_records(sme, ['연번','사업자번호','상호','대표자명','주소','주생산품','선정일','유효기간 종료일'], '사업자번호', '상호', '유효기간 종료일')
    candidates = {}
    name_mismatch = set()

    def add(ident, cls, source, as_of, expiry=None):
        claim = {'id':ident, 'size_class':cls, 'source':source, 'as_of':as_of}
        if expiry is not None:
            claim['expires_on'] = expiry
        candidates.setdefault(ident, []).append(claim)

    for ident in sorted(base_ids & directory_ids.keys() | (base_ids - directory_ids.keys())):
        crn = ident[7:]
        if crn in claims:
            add(ident, 'large_affiliate', 'ftc', '2026-11-02')
    for ident, name in directory_ids.items():
        if not ident.startswith('KR-BIZ-'):
            continue
        bid = ident[7:]
        if bid not in ambiguous and bid in bridges:
            crn = next(iter(bridges[bid]))
            if crn in claims:
                if same_name(name, claims[crn][0]):
                    add(ident, 'large_affiliate', 'ftc', '2026-11-02')
                else:
                    name_mismatch.add(ident)
        for source, entries, cls, as_of in (
            ('mid', mid_claims, 'mid_history', '2026-06-30'),
            ('sme', sme_claims, 'sme_unspecified', '2025-12-31')):
            if bid not in entries:
                continue
            if len(entries[bid]) != 1 or not same_name(next(iter(entries[bid]))[0], name):
                name_mismatch.add(ident)
                continue
            _, expiry = next(iter(entries[bid]))
            add(ident, cls, source, as_of, expiry)
    class_conflicts = {ident for ident, claims_for_id in candidates.items()
                       if len({item['size_class'] for item in claims_for_id}) > 1}
    labels = [items[0] for ident, items in sorted(candidates.items())
              if ident not in class_conflicts and ident not in name_mismatch]
    ftc_only = [{'id':'KR-CRN-'+crn, 'name':name, 'group':group,
                 'size_class':'large_affiliate', 'source':'ftc', 'as_of':'2026-11-02'}
                for crn, (name, group) in sorted(claims.items())
                if 'KR-CRN-'+crn not in base_ids and crn not in claimed_crns]
    records = encoded({'labels':labels, 'ftc_only':ftc_only})
    totals = {'ftc_rows':ftc_rows, 'ftc_unique_crns':len(claims)+len(conflicts),
              'ftc_conflicting_crns':len(conflicts), 'ftc_unambiguous_crns':len(claims),
              'ambiguous_dart_bids':len(ambiguous), 'name_mismatch_ids':len(name_mismatch),
              'conflicting_classes':len(class_conflicts), 'labels':len(labels),
              'ftc_only':len(ftc_only), 'records':len(labels)+len(ftc_only),
              'base_labels':sum(row['id'].startswith('KR-CRN-') for row in labels),
              'directory_labels':sum(row['id'].startswith('KR-BIZ-') for row in labels)}
    sources = {
        'ftc':{'sha256':hashes[0], 'url':'https://www.ftc.go.kr/www/selectBbsNttView.do?bordCd=3&key=12&nttSn=48244', 'as_of':'2026-11-02', 'license':'공공누리 제1유형 (출처표시: 공정거래위원회)'},
        'dart_bridge':{'sha256':hashes[1], 'url':'https://dart.fss.or.kr/dsae001/downloadExcel.do', 'role':'private exact BID-to-CRN bridge only'},
        'recruitment':{'sha256':JOB_SHA, 'url':'https://www.data.go.kr/data/15100246/fileData.do', 'edition':'2026-03-06'},
        'mid':{'sha256':hashes[2], 'url':'https://www.data.go.kr/data/15102331/fileData.do', 'as_of':'2026-06-30', 'license':'이용허락범위 제한 없음'},
        'sme':{'sha256':hashes[3], 'url':'https://www.data.go.kr/data/15018880/fileData.do', 'as_of':'2025-12-31', 'license':'이용허락범위 제한 없음'},
    }
    manifest = {'schema_version':'domestic-size-evidence-v1', 'base_manifest_sha256':base_sha,
                'directory_manifest_sha256':directory_sha, 'sources':sources, 'totals':totals,
                'records':{'path':'records.json','bytes':len(records), 'sha256':hashlib.sha256(records).hexdigest(),
                           'count':totals['records'], 'labels':totals['labels'], 'ftc_only':totals['ftc_only']},
                'methodology':'Dated identity-specific affiliation/designation evidence, not current employment, standalone assets, benefit policy or benefit approval. Mid-sized evidence historical only; SME designation is not a medium/small subtype. Unlabeled identities remain unclassified.'}
    files = {'manifest.json':encoded(manifest), 'records.json':records}
    output = Path(output)
    if check:
        if not output.is_dir() or {p.name for p in output.iterdir()} != set(files):
            raise ValueError('overlay inventory mismatch')
        for filename, content in files.items():
            if (output / filename).read_bytes() != content:
                raise ValueError('overlay byte mismatch: '+filename)
    else:
        output.mkdir(parents=True, exist_ok=True)
        for filename, content in files.items():
            (output / filename).write_bytes(content)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('ftc','dart','mid','sme'):
        parser.add_argument('--'+name, required=True, type=Path)
    parser.add_argument('--selected', type=Path, default=Path('docs/research/company-benefits/population/domestic-selected.jsonl'))
    parser.add_argument('--base', type=Path, default=Path('community-app/public/data/company-benefits/manifest.json'))
    parser.add_argument('--directory', type=Path, default=Path('community-app/public/data/company-benefits/domestic-directory-v1'))
    parser.add_argument('--output', type=Path, default=Path('community-app/public/data/company-benefits/domestic-size-evidence-v1'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest = build(args.ftc,args.dart,args.mid,args.sme,args.selected,args.base,args.directory,args.output,check=args.check)
    print(json.dumps(manifest['totals'],sort_keys=True))


if __name__ == '__main__':
    main()
