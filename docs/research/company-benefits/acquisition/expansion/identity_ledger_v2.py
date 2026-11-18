#!/usr/bin/env python3
"""Compile/check the second additive identity-only expansion ledger from pinned inputs."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import unicodedata
from urllib.parse import urlsplit

HERE = pathlib.Path(__file__).resolve().parent
ARCHIVE = pathlib.Path(os.environ.get('EXPANSION_ARCHIVE_ROOT', pathlib.Path(os.environ.get('HERMES_HOME', pathlib.Path.home() / '.hermes')) / 'data/benefit-batch-wave/expansion-private-prepush'))
CANONICAL = HERE.parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def name_key(name):
    if not isinstance(name, str) or not name.strip():
        raise ValueError('missing legal name')
    text = unicodedata.normalize('NFKC', name).casefold()
    text = re.sub(r'\(\s*주\s*\)|주식회사|㈜', '', text)
    text = re.sub(r'[^\w]', '', text, flags=re.UNICODE)
    text = re.sub(r'(incorporated|corporation|company|limited|corp|inc|co|ltd)$', '', text)
    if not text:
        raise ValueError('empty normalized legal name')
    return text


def source_date(value):
    if not isinstance(value, str):
        raise ValueError('missing source date')
    try:
        parsed = datetime.datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError('invalid source date') from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('source date needs a timezone')
    return value


def official_url(value, jurisdiction, identifier):
    if not isinstance(value, str) or re.search(r'[\s\\\x00-\x1f\x7f]', value):
        raise ValueError('unsafe URL')
    parts = urlsplit(value)
    host = 'data.sec.gov' if jurisdiction == 'US' else 'englishdart.fss.or.kr'
    if (parts.scheme != 'https' or parts.netloc != host or parts.username is not None
            or parts.password is not None or parts.port is not None or parts.fragment):
        raise ValueError('unsafe URL authority')
    if jurisdiction == 'US':
        if value != f'https://data.sec.gov/submissions/CIK{identifier}.json':
            raise ValueError('unexpected official URL')
    elif not re.fullmatch(r'https://englishdart\.fss\.or\.kr/dsbc001/selectPopup\.ax\?selectKey=[0-9]{8}', value):
        raise ValueError('unexpected official URL')
    return value


def compile_ledger(us_path, kr_path, manifest_path, companies_path, batches_path, prior_path):
    manifest = json.loads(pathlib.Path(manifest_path).read_text(encoding='utf-8'))
    if manifest['schema_version'] != 'expansion-identity-sources-v2':
        raise ValueError('unsupported source manifest provenance')
    for key, path in [('us', us_path), ('kr', kr_path)]:
        if digest(pathlib.Path(path)) != manifest['sources'][key]['sha256']:
            raise ValueError(f'{key} source pin mismatch')
    for key, path in [('companies.jsonl', companies_path), ('series-batches.jsonl', batches_path)]:
        if digest(pathlib.Path(path)) != manifest['canonical'][key]:
            raise ValueError(f'canonical {key} pin mismatch')
    if (digest(pathlib.Path(prior_path)) != manifest['prior']['candidates.v1.jsonl']
            or digest(HERE / 'source-manifest.v1.json') != manifest['prior']['source-manifest.v1.json']):
        raise ValueError('prior ledger pin mismatch')
    us = json.loads(pathlib.Path(us_path).read_text(encoding='utf-8'))
    kr = json.loads(pathlib.Path(kr_path).read_text(encoding='utf-8'))
    companies = [json.loads(line) for line in pathlib.Path(companies_path).read_text(encoding='utf-8').splitlines()]
    prior = [json.loads(line) for line in pathlib.Path(prior_path).read_text(encoding='utf-8').splitlines()]
    if (len(companies) != manifest['canonical']['company_count']
            or len(prior) != manifest['prior']['company_count']
            or len({r['company_id'] for r in companies}) != len(companies)
            or len({r['company_id'] for r in prior}) != len(prior)):
        raise ValueError('baseline count/duplicate mismatch')
    first = json.loads((HERE / 'source-manifest.v1.json').read_text(encoding='utf-8'))
    canonical_ids = {r['company_id'] for r in companies}
    names = {(r['jurisdiction'], name_key(r['legal_name'])) for r in companies}
    for row in prior:
        if (row['company_id'] in canonical_ids
                or (row['jurisdiction'], name_key(row['legal_name'])) in names):
            raise ValueError('prior identity collision')
        canonical_ids.add(row['company_id'])
        names.add((row['jurisdiction'], name_key(row['legal_name'])))
    if (us.get('schema_version') != 'us-expansion-second-research-pool-v1'
            or us.get('status') != 'research_only_not_published'
            or us.get('canonical_original_sha256') != {'companies.jsonl': manifest['canonical']['companies.jsonl']}
            or us.get('canonical_membership_count') != len(companies)
            or us.get('first_pool_sha256') != first['sources']['us']['sha256']
            or us.get('first_pool_count') != first['sources']['us']['expected_count']
            or us.get('source_inventory', {}).get('source_url') != 'https://www.sec.gov/files/company_tickers.json'
            or kr.get('schema_version') != 'expansion-kr-second-candidates-v1'
            or kr.get('scope') != 'private_research_only_no_canonical_mutation'
            or kr.get('canonical_sha256') != manifest['canonical']['companies.jsonl']
            or kr.get('first_wave_sha256') != first['sources']['kr']['sha256']):
        raise ValueError('unsupported source provenance or prior pin')
    us_rows, kr_rows = us['candidates'], kr['verified_new_candidates']
    if (len(us_rows) != manifest['sources']['us']['expected_count']
            or len(kr_rows) != manifest['sources']['kr']['expected_count']
            or us['candidate_count'] != len(us_rows)
            or kr['counts']['verified_new'] != len(kr_rows)
            or len(us_rows) + len(kr_rows) != manifest['expected_total']):
        raise ValueError('candidate count mismatch')
    result = []
    for jurisdiction, source_rows in [('US', us_rows), ('KR', kr_rows)]:
        for record in source_rows:
            company_id = record['company_id']
            legal_name = record['sec_official_name'] if jurisdiction == 'US' else record['legal_name']
            if jurisdiction == 'US':
                match = re.fullmatch(r'US-CIK([0-9]{10})', company_id)
                if not match or match[1] != record.get('cik'):
                    raise ValueError('malformed CIK')
                if (record.get('selection_status') != 'identity_verified_research_pool_only'
                        or not re.fullmatch(r'[A-Z]{2}', record.get('state_of_incorporation', ''))):
                    raise ValueError('unsupported SEC provenance')
                url = record['sec_submissions_url']
                date = record['sec_observed_at_utc']
                identifier = match[1]
            else:
                match = re.fullmatch(r'KR-CRN-([0-9]{13})', company_id)
                if not match or record.get('official_crn') != f'{match[1][:6]}-{match[1][6:]}':
                    raise ValueError('malformed CRN')
                if (record.get('status') != 'verified_identity_candidate_not_benefit_approved'
                        or record.get('source_field') != 'Company Name (Korean) + Corporation Registration Number'
                        or record.get('normalized_legal_name') != name_key(legal_name)):
                    raise ValueError('unsupported DART provenance')
                url = record['official_source_url']
                date = record['observed_at']
                identifier = match[1]
            key = (jurisdiction, name_key(legal_name))
            if company_id in canonical_ids or key in names:
                raise ValueError('canonical or expansion identity collision')
            canonical_ids.add(company_id)
            names.add(key)
            result.append({'schema_version': 'expansion-identity-v2', 'company_id': company_id,
                           'legal_name': legal_name, 'jurisdiction': jurisdiction,
                           'official_identity_url': official_url(url, jurisdiction, identifier),
                           'source_date': source_date(date),
                           'canonical_companies_sha256': manifest['canonical']['companies.jsonl'],
                           'identity_status': 'identity_candidate', 'review_status': 'research_only'})
    return (''.join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n'
                    for row in sorted(result, key=lambda r: r['company_id']))).encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['compile', 'check'])
    parser.add_argument('--us', type=pathlib.Path, required=True, help='private second SEC candidate JSON')
    parser.add_argument('--kr', type=pathlib.Path, required=True, help='private second DART candidate JSON')
    parser.add_argument('--manifest', type=pathlib.Path, default=HERE/'source-manifest.v2.json')
    parser.add_argument('--companies', type=pathlib.Path, default=CANONICAL/'companies.jsonl')
    parser.add_argument('--batches', type=pathlib.Path, default=CANONICAL/'series-batches.jsonl')
    parser.add_argument('--prior', type=pathlib.Path, default=ARCHIVE/'candidates.v1.jsonl')
    parser.add_argument('--output', type=pathlib.Path, default=ARCHIVE/'candidates.v2.jsonl')
    args = parser.parse_args()
    expected = compile_ledger(args.us, args.kr, args.manifest, args.companies, args.batches, args.prior)
    if args.action == 'compile':
        if (args.output.is_symlink() or not args.output.resolve().is_relative_to(ARCHIVE.resolve())
                or args.output.resolve() == (ARCHIVE / 'candidates.v2.jsonl').resolve()):
            raise ValueError('compile output must be a new restricted archive file')
        args.output.write_bytes(expected)
    elif args.output.read_bytes() != expected:
        raise ValueError('ledger differs from pinned deterministic compilation')
    print(f'{args.action}: {len(expected.splitlines())} research-only identity candidates; sha256={hashlib.sha256(expected).hexdigest()}')


if __name__ == '__main__':
    main()
