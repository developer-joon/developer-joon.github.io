#!/usr/bin/env python3
"""Build an independent, dated legal-size evidence sibling from pinned private sources."""
import argparse
import csv
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import xml.etree.ElementTree as ET
import zipfile

FTC_SHA = '080238dc8e95bc7cff0100534854d317ed6948a25a291688f451fa5be23053fb'
DART_SHA = '6dcf6031e8e9eecbcefc120a7461f9a7bd3ef97c88ba55d20d80f416285de1c3'
JOB_SHA = '16756d002508995b70f158bd279a48fb825af6a79820eb82b0009efcbeb82365'
MID_SHA = '962e10cb95b8b8ee274d420f4e89293dbc8da8e4ba9966178ef6af068fe6e040'
SME_SHA = 'c8242d45872ffb1d35241b434b4dfce828a39697fc27bb6f9d8b565730bed4ba'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
CUTOFF = '2026-11-20'
MAX_XLSX_MEMBERS = 64
MAX_SHEET_BYTES = 200_000_000  # Pinned DART sheet: 170,339,698 bytes.
MAX_SHEET_COMPRESSED = 30_000_000
MAX_SHARED_BYTES = 5_000_000
MAX_SHEET_ROWS = 130_000  # Pinned DART sheet: 120,050 rows.
FTC_FOOTER = '* 음영표시는 상호출자제한기업집단(자산총액 12.0조 원 이상)'
# The pinned DART edition has blank or short registry identifiers on these rows;
# none can establish an exact BID-to-CRN bridge. Refuse any new such exclusion.
DART_EXCLUSIONS = {'crn_blank': 1901, 'bid_blank': 747, 'both_blank': 90,
                   'bid_invalid': 29, 'crn_invalid': 11}


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


def bounded_member(archive, name, byte_limit, compressed_limit):
    if len(archive.infolist()) > MAX_XLSX_MEMBERS:
        raise ValueError('XLSX member count exceeded')
    info = archive.getinfo(name)
    if info.file_size > byte_limit or info.compress_size > compressed_limit:
        raise ValueError('XLSX member size exceeded: ' + name)
    return archive.open(info)


def rows(archive, sheet):
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        with bounded_member(archive, 'xl/sharedStrings.xml', MAX_SHARED_BYTES, MAX_SHARED_BYTES) as stream:
            root = None
            for event, element in ET.iterparse(stream, events=('start', 'end')):
                if root is None:
                    root = element
                if event != 'end':
                    continue
                if element.tag == NS + 'si':
                    shared.append(''.join(element.itertext()))
                    root.clear()
    with bounded_member(archive, f'xl/worksheets/sheet{sheet}.xml',
                        MAX_SHEET_BYTES, MAX_SHEET_COMPRESSED) as stream:
        sheet_data = None
        count = 0
        for event, row in ET.iterparse(stream, events=('start', 'end')):
            if event == 'start' and row.tag == NS + 'sheetData':
                sheet_data = row
            if event != 'end' or row.tag != NS + 'row':
                continue
            count += 1
            if count > MAX_SHEET_ROWS:
                raise ValueError('XLSX row ceiling exceeded')
            values = {}
            for cell in row:
                match = re.match(r'[A-Z]+', cell.get('r', ''))
                if not match:
                    continue
                element = cell.find(NS + 'v')
                value = shared[int(element.text)] if cell.get('t') == 's' and element is not None else ''.join(cell.itertext())
                values[match.group()] = value.strip()
            yield int(row.get('r')), values
            # Clearing just the row retains 120K empty children on sheetData.
            if sheet_data is None:
                raise ValueError('XLSX sheetData missing')
            sheet_data.clear()


def ftc_affiliates(path, pinned=False):
    claims = {}
    count = 0
    footers = 0
    with zipfile.ZipFile(path) as book:
        for number, values in rows(book, 4):
            if number == 3:
                if tuple(values.get(key) for key in ('B', 'C', 'D')) != ('기업집단', '소속회사명', '법인등록번호'):
                    raise ValueError('FTC header changed')
                continue
            if number < 3:
                continue
            if values == {'A': FTC_FOOTER} and footers == 0:
                footers += 1
                continue
            crn, name, group = (values.get(key, '') for key in ('D', 'C', 'B'))
            if re.fullmatch(r'\d{6}-\d{7}', crn):
                crn = crn.replace('-', '')
            if not re.fullmatch(r'\d{13}', crn) or not safe(name) or not safe(group, 80):
                raise ValueError(f'FTC affiliate row schema changed at {number}')
            count += 1
            claims.setdefault(crn, set()).add((name, group))
    if pinned and (count, footers) != (3529, 1):
        raise ValueError('FTC pinned row/footer counts changed')
    conflicts = {crn for crn, claims_for_crn in claims.items() if len(claims_for_crn) != 1}
    return {crn: next(iter(items)) for crn, items in claims.items() if crn not in conflicts}, conflicts, count


def dart_bridge(path, bids, pinned=False):
    mapping = {}
    exclusions = {key: 0 for key in DART_EXCLUSIONS}
    valid = 0
    with zipfile.ZipFile(path) as book:
        for number, values in rows(book, 1):
            if number == 1:
                if (values.get('G'), values.get('H')) != ('법인등록번호', '사업자등록번호'):
                    raise ValueError('DART header changed')
                continue
            bid = values.get('H', '')
            if re.fullmatch(r'\d{3}-\d{2}-\d{5}', bid):
                bid = bid.replace('-', '')
            crn = values.get('G', '')
            crn_ok = bool(re.fullmatch(r'\d{13}', crn))
            bid_ok = bool(re.fullmatch(r'\d{10}', bid))
            if not crn_ok or not bid_ok:
                reason = ('both_blank' if not crn and not bid else
                          'crn_blank' if not crn else 'bid_blank' if not bid else
                          'crn_invalid' if not crn_ok else 'bid_invalid')
                if not pinned:
                    raise ValueError(f'DART row schema changed at {number}: {reason}')
                exclusions[reason] += 1
                continue
            valid += 1
            if bid in bids:
                mapping.setdefault(bid, set()).add(crn)
    if pinned and (valid != 117271 or exclusions != DART_EXCLUSIONS):
        raise ValueError('DART pinned row/exclusion counts changed')
    return mapping


def csv_records(path, fields, bid_key, name_key, expiry_key=None, pinned=False):
    result = {}
    count = expired = 0
    with open(path, encoding='cp949', newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != fields:
            raise ValueError('source CSV schema changed')
        for row in reader:
            count += 1
            if None in row or any(value is None for value in row.values()):
                raise ValueError('source CSV row schema changed')
            bid, name = row[bid_key], row[name_key].strip()
            if not re.fullmatch(r'\d{10}', bid) or not safe(name):
                raise ValueError(f'CSV identity schema changed at row {count + 1}')
            expiry = row[expiry_key] if expiry_key else None
            if expiry_key:
                try:
                    if date.fromisoformat(expiry) < date.fromisoformat(CUTOFF):
                        expired += 1
                        continue
                except ValueError:
                    raise ValueError(f'CSV expiry schema changed at row {count + 1}') from None
            result.setdefault(bid, set()).add((name, expiry))
    if pinned and (count, expired) != ((557, 326) if expiry_key else (30, 0)):
        raise ValueError('CSV pinned row/expiry counts changed')
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
    base_ids = {ident for ident in json.loads(Path(base).read_bytes())['company_shards']
                if re.fullmatch(r'KR-CRN-\d{13}', ident)}
    selected_ids = [json.loads(line)['registry_id'] for line in Path(selected).read_text().splitlines() if line]
    if (not base_ids or len(selected_ids) != len(base_ids) or
            len(set(selected_ids)) != len(selected_ids) or set(selected_ids) != base_ids):
        raise ValueError('selected base membership mismatch')
    directory_ids = accepted_directory(Path(directory), base_sha)
    directory_manifest = json.loads((Path(directory) / 'manifest.json').read_bytes())
    if (directory_manifest['sources']['recruitment']['sha256'] != JOB_SHA or
            directory_manifest['sources']['dart_bridge']['sha256'] != hashes[1]):
        raise ValueError('directory source binding mismatch')
    claims, conflicts, ftc_rows = ftc_affiliates(ftc, pinned=hashes[0] == FTC_SHA)
    bids = {ident[7:] for ident in directory_ids if ident.startswith('KR-BIZ-')}
    bridges = dart_bridge(dart, bids, pinned=hashes[1] == DART_SHA)
    ambiguous = {bid for bid, crns in bridges.items() if len(crns) != 1}
    claimed_crns = set().union(*bridges.values()) if bridges else set()
    mid_claims = csv_records(mid, ['순번','사업자번호','업체명','내일채움공제 가입인원'], '사업자번호', '업체명', pinned=hashes[2] == MID_SHA)
    sme_claims = csv_records(sme, ['연번','사업자번호','상호','대표자명','주소','주생산품','선정일','유효기간 종료일'], '사업자번호', '상호', '유효기간 종료일', pinned=hashes[3] == SME_SHA)
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
        output.parent.mkdir(parents=True, exist_ok=True)
        # Stage/verify the pair together; rollback ordinary rename failures.
        # This is not a crash-atomic directory exchange.
        with tempfile.TemporaryDirectory(prefix='.domestic-size-stage-', dir=output.parent) as temp:
            stage = Path(temp) / 'new'
            stage.mkdir()
            for filename, content in files.items():
                (stage / filename).write_bytes(content)
            if {p.name for p in stage.iterdir()} != set(files) or any(
                    (stage / name).read_bytes() != content for name, content in files.items()):
                raise ValueError('staged overlay byte mismatch')
            prior = Path(temp) / 'prior'
            if output.exists():
                os.replace(output, prior)
            try:
                os.replace(stage, output)
            except OSError:
                if prior.exists():
                    os.replace(prior, output)
                raise
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
