"""Protocol 3.1 compact audit and bounded workforce-date validation."""
import calendar
import csv
import hashlib
import json
import re
from datetime import date
from pathlib import Path

REJECTED = {'0000794170-25-000112', '0000798941-26-000015', '0001018840-26-000012', '0001062231-26-000020'}
EXTERNAL = Path('/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected')

PINNED_EXTERNAL = {'/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/all_1740_jurisdiction_audit.csv': ('5f58b110006d3deca6fb71fcea90677e46f3942b71579f9822cfaa2c557e3f26', 1740), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/exclusions.csv': ('5af14248248f67b6303aacbfe01e7ada4395284195dd0761b23a08ccdf73b4af', 670), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/new_recoveries_full_false_positive_audit.csv': ('74e264dfea1e978af5aa103301e6f67b51e76818444998f38c62b7f0e8fc76a1', 167), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/replacement_reserve_full_audit.csv': ('0fed890b3fdde187c69d421a72baa5e4c85763263fac890f264b9bcf705aa1ec', 70), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/validation_report.json': ('474f566979357cf5adad0ede375138663ea016d7f6ee0fc6035d7a3cb3994e39', None), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/manifest.json': ('e53e99780170f12bd66a00f1acf0cd9667df7a883f0144fa4661ba19b61cfb52', None), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/corrected_strict_us_employee_eligible_ledger.csv': ('05078c97c115a493b88e8a472456b5eff2f9e7e58ee89a48e245be13d5de5762', 1070), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/new_employee_recoveries.csv': ('0fb900e0274fc2e57327af503b0cfd25dbaa3caacde0f9598324a4d7509cc742', 167), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/independent_review/independent_sec_workforce_reviews.jsonl': ('0d07e6a25e26666359765c237ff52654e5851423b487288476bddb7a25c62b3f', None), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/independent_review/summary.json': ('dc04c076766a7d102807d42bd22d980160cea67a655a0f103dc041899ecad235', None), '/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/independent_review/sha256_manifest.json': ('b61071aa16352147b2d5694440bab5ad341cb025bd3d2b01d1b55e5dfc38e9ca', None)}
PINNED_EXTERNAL['/home/bread/.hermes/profiles/conan/cache/scratch/international-open-acquisition/threshold_jurisdiction_corrected/independent_review/build_independent_review.py'] = ('a2b4dc6687067ae5b208749d3cb1020875a0b7755d394627bd9eb1e996bd7db6', None)
EXPECTED_COUNTS = {'candidates': 1740, 'excluded': 674, 'eligible': 1066, 'selected': 1000, 'reserve': 66, 'reviews': 167, 'approved': 163, 'rejected': 4}
PINNED_FILE_COUNTS = {
    'all_1740_jurisdiction_audit.csv': 1740,
    'exclusions.csv': 670,
    'new_recoveries_full_false_positive_audit.csv': 167,
    'replacement_reserve_full_audit.csv': 70,
    'validation_report.json': 1,
    'manifest.json': 1,
    'corrected_strict_us_employee_eligible_ledger.csv': 1070,
    'new_employee_recoveries.csv': 167,
    'independent_sec_workforce_reviews.jsonl': 167,
    'summary.json': 1,
    'sha256_manifest.json': 1,
    'build_independent_review.py': 273,
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def artifact_count(path, data):
    path = Path(path)
    if path.suffix == '.csv':
        return len(list(csv.DictReader(data.decode('utf-8-sig').splitlines())))
    if path.suffix == '.jsonl':
        return len(data.splitlines())
    if path.suffix == '.json':
        json.loads(data)
        return 1
    return len(data.splitlines())

def quote_date(quote):
    # Only the retained bounded quote is searched; financial dates are never inputs.
    dates = set(re.findall(r'\b\d{4}-\d{2}-\d{2}\b', quote))
    months = {name.lower(): n for n, name in enumerate(calendar.month_name) if name}
    for name, day, year in re.findall(r'\b('+'|'.join(calendar.month_name[1:])+r')\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b', quote, re.I):
        dates.add(date(int(year), months[name.lower()], int(day)).isoformat())
    for day, name, year in re.findall(r'\b(\d{1,2})\s+('+'|'.join(calendar.month_name[1:])+r')\s+(20\d{2})\b', quote, re.I):
        dates.add(date(int(year), months[name.lower()], int(day)).isoformat())
    for year in re.findall(r'\b(?:(?:at|as of) (?:the )?end of|year.end(?:ed)?(?: in)?)\s+(20\d{2})\b', quote, re.I):
        dates.add(f'{year}-12-31')
    for item in dates:
        date.fromisoformat(item)
    if len(dates) > 1:
        raise ValueError('ambiguous workforce quote dates')
    return next(iter(dates), None)

def count_quote_date(quote, count):
    token = re.compile(r'(?<![\d,])' + re.escape(f'{int(count):,}') + r'(?![\d,])')
    hits = list(token.finditer(quote))
    if not hits and ',' in f'{int(count):,}':
        hits = list(re.finditer(r'(?<!\d)'+str(count)+r'(?!\d)', quote))
    if len(hits) != 1:
        # Inline XBRL retained quotes sometimes omit a rendered integer.
        return quote_date(quote)
    hit = hits[0]
    left = quote[max(0, hit.start()-180):hit.start()]
    # Start at the latest sentence boundary or explicit as-of introducer.
    boundaries = list(re.finditer(r'(?:[.!?]\s+|\bAs of\s+)', left, re.I))
    if boundaries:
        b = boundaries[-1]
        left = left[b.start() if b.group().lower().startswith('as of') else b.end():]
    right = quote[hit.end():hit.end()+140]
    right = re.split(r'\b(?:compared|down from|up from|an increase|a decrease|reflecting|since)\b|\bover\s+(?=January|February|March|April|May|June|July|August|September|October|November|December)|[.!?]\s+', right, maxsplit=1, flags=re.I)[0]
    return quote_date(left + str(count) + right)

def reviews(path):
    rows = [json.loads(x) for x in Path(path).read_text().splitlines()]
    if len(rows) != 167 or len({r['accession'] for r in rows}) != 167 or len({r['CIK'] for r in rows}) != 167 or len({r['review_id'] for r in rows}) != 167:
        raise ValueError('independent review one-to-one identity mismatch')
    if {r['accession'] for r in rows if r['decision'] == 'rejected'} != REJECTED or sum(r['decision']=='approved' for r in rows)!=163:
        raise ValueError('independent review decisions mismatch')
    for r in rows:
        if r['reviewer_id'] != 'independent-sec-workforce-review' or digest(r['exact quote'].encode()) != r['quote_sha256'] or not re.fullmatch('[0-9a-f]{64}', r['filing_sha256']):
            raise ValueError('independent review hash/reviewer mismatch')
        if r['evidence_date'] not in (None, 'undated_current'):
            date.fromisoformat(r['evidence_date'])
    return {r['accession']:r for r in rows}

def workforce_date(row, review_map):
    r = review_map.get(row['accession'])
    if r:
        if (r['CIK'] != row['legal_id'].removeprefix('CIK') or r['company legal name'] != row['legal_name'] or r['filing_sha256'] != row['employee_filing_sha256'] or r['exact quote'] != row['employee_evidence_quote'] or r['locator'] != row['employee_evidence_locator']):
            raise ValueError('independent review source identity mismatch')
        value = None if r['evidence_date'] == 'undated_current' else r['evidence_date']
    else:
        value = count_quote_date(row['employee_evidence_quote'], row['employee_count'])
    return value, 'explicit_quote_date' if value else 'undated_current'

def validate(root):
    root = Path(root)
    p = root/'population'
    manifest = json.loads((p/'acquisition-audit-manifest.json').read_text())
    if manifest['protocol_version'] != '3.1.0':
        raise ValueError('audit protocol mismatch')
    expected_pins = {
        path: (sha, PINNED_FILE_COUNTS[Path(path).name], 'external_audit_artifact')
        for path, (sha, _legacy_count) in PINNED_EXTERNAL.items()
    }
    if manifest.get('counts') != EXPECTED_COUNTS or {x['path']:(x['sha256'],x['count'],x['role']) for x in manifest['external_pins']} != expected_pins or len(manifest['external_pins']) != len(PINNED_EXTERNAL):
        raise ValueError('external audit pins/counts mismatch')
    if len(manifest['committed_copies']) != 1 or manifest['committed_copies'][0]['path'] != 'population/independent-sec-workforce-reviews.jsonl' or manifest['committed_copies'][0].get('count') != 167 or manifest['committed_copies'][0].get('role') != 'repo_compact_copy':
        raise ValueError('compact artifact coverage mismatch')
    for pin in manifest['external_pins']:
        data = Path(pin['path']).read_bytes()
        if digest(data) != pin['sha256']:
            raise ValueError('external audit pin mismatch')
        if artifact_count(pin['path'], data) != pin['count']:
            raise ValueError('external audit count mismatch')
    for pin in manifest['committed_copies']:
        data = (root/pin['path']).read_bytes()
        if digest(data) != pin['sha256'] or artifact_count(pin['path'], data) != pin['count']:
            raise ValueError('committed audit hash mismatch')
    original = reviews(EXTERNAL/'independent_review/independent_sec_workforce_reviews.jsonl')
    review_map = reviews(p/'independent-sec-workforce-reviews.jsonl')
    if review_map != original:
        raise ValueError('reviewed values differ from independent artifact')
    source = {r['accession']:r for r in csv.DictReader((EXTERNAL/'corrected_strict_us_employee_eligible_ledger.csv').read_text().splitlines())}
    recoveries = {r['accession'] for r in csv.DictReader((EXTERNAL/'new_employee_recoveries.csv').read_text().splitlines())}
    if set(review_map) != recoveries:
        raise ValueError('independent review coverage mismatch')
    for accession in review_map:
        workforce_date(source[accession], review_map)
    all_ids = {r['accession'] for r in csv.DictReader((EXTERNAL/'all_1740_jurisdiction_audit.csv').read_text().splitlines())}
    excluded = {r['accession'] for r in csv.DictReader((EXTERNAL/'exclusions.csv').read_text().splitlines())} | REJECTED
    if len(all_ids)!=1740 or len(excluded)!=674 or set(source)-REJECTED != all_ids-excluded:
        raise ValueError('1740 partition mismatch')
    for name in ['international-eligible','international-selected','international-initial-effective-selected','international-effective-selected']:
        rows = [json.loads(x) for x in (p/f'{name}.jsonl').read_text().splitlines()]
        if len(rows) != (1066 if name.endswith('eligible') else 1000):
            raise ValueError('international count mismatch')
        for row in rows:
            ev = row['employer_evidence']; accession = ev['accession']
            if accession in excluded or accession not in source:
                raise ValueError('excluded workforce accession')
            original_row = source[accession]
            expected_fields = {'url': original_row['employee_filing_url'], 'content_sha256': original_row['employee_filing_sha256'],
                               'locator': original_row['employee_evidence_locator'], 'registry_id': original_row['legal_id'],
                               'legal_name': original_row['legal_name'], 'employee_count': int(original_row['employee_count'])}
            if any(ev.get(key) != value for key, value in expected_fields.items()) or row['registry_id'] != original_row['legal_id'] or row['legal_name'] != original_row['legal_name']:
                raise ValueError('workforce source identity/count mismatch')
            expected, basis = workforce_date(original_row, review_map)
            if 'evidence_date' not in ev or ev.get('evidence_date') != expected or ev.get('date_basis') != basis or ev.get('fiscal_period_end') != expected:
                raise ValueError(f"{row['legal_name']}: workforce evidence date mismatch")
            if ev['quote'] != source[accession]['employee_evidence_quote']:
                raise ValueError('workforce quote mismatch')
    companies = [json.loads(x) for x in (root/'companies.jsonl').read_text().splitlines()]
    if any(r['employer_evidence'].get('accession') in REJECTED for r in companies):
        raise ValueError('excluded company accession')

def build(root, external=EXTERNAL):
    root = Path(root); p=root/'population'; p.mkdir(parents=True, exist_ok=True)
    for path, (expected_hash, expected_count) in PINNED_EXTERNAL.items():
        data = Path(path).read_bytes()
        if digest(data) != expected_hash:
            raise ValueError('external audit source digest mismatch')
        if artifact_count(path, data) != PINNED_FILE_COUNTS[Path(path).name]:
            raise ValueError('external audit source count mismatch')
    rows = list(reviews(external/'independent_review/independent_sec_workforce_reviews.jsonl').values())
    compact = b''.join(json.dumps(r,ensure_ascii=False,separators=(',',':')).encode()+b'\n' for r in rows)
    (p/'independent-sec-workforce-reviews.jsonl').write_bytes(compact)
    names = ['all_1740_jurisdiction_audit.csv','exclusions.csv','new_recoveries_full_false_positive_audit.csv','replacement_reserve_full_audit.csv','validation_report.json','manifest.json','corrected_strict_us_employee_eligible_ledger.csv','new_employee_recoveries.csv','independent_review/independent_sec_workforce_reviews.jsonl','independent_review/summary.json','independent_review/sha256_manifest.json','independent_review/build_independent_review.py']
    pins=[]
    for name in names:
        path=external/name; data=path.read_bytes()
        pins.append({'path':str(path),'sha256':digest(data),'count':artifact_count(path, data),'role':'external_audit_artifact'})
    value={'protocol_version':'3.1.0','counts':{'candidates':1740,'excluded':674,'eligible':1066,'selected':1000,'reserve':66,'reviews':167,'approved':163,'rejected':4},'external_pins':pins,'committed_copies':[{'path':'population/independent-sec-workforce-reviews.jsonl','sha256':digest(compact),'count':167,'role':'repo_compact_copy'}]}
    (p/'acquisition-audit-manifest.json').write_text(json.dumps(value,separators=(',',':')))
    return reviews(p/'independent-sec-workforce-reviews.jsonl')
