import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOpenDartImportSql } from './apply-opendart-benefit-directory.mjs'

const verified={bundleSha256:'b'.repeat(64),manifest:{schema_version:'benefit-directory-opendart-v1',source:{retrieved_at:'2026-11-23T00:00:00Z',sha256:'a'.repeat(64),edition:'2026-11-23'},authority:{retrieved_at:'2026-11-23T00:00:00Z'},ordered_code_company_sha256:'c'.repeat(64),company_count:2,identifier_count:2}}
const sql=()=>buildOpenDartImportSql({tsvPath:'/safe/rows.tsv',verified,dryRun:true})

test('protected snapshots have locked per-table and aggregate row/byte preflights before materialization and COPY',()=>{
  const text=sql(); const bound=text.indexOf('$snapshot_bound$'); const firstSnapshot=text.indexOf('CREATE TEMP TABLE prior_publications'); const copy=text.indexOf('\\copy dart_stage_raw')
  assert.ok(bound>text.indexOf('LOCK TABLE public.benefit_publications'))
  assert.ok(bound<firstSnapshot && firstSnapshot<copy)
  assert.match(text,/LIMIT 100001/)
  assert.match(text,/268435456/)
  assert.match(text,/OpenDART protected snapshot exceeds 100000 rows or 256 MiB per table\/aggregate/)
  assert.match(text,/set_config\('statement_timeout','60000',true\)/)
})

test('preflight pins the complete non-internal trigger inventory for every import target',()=>{
  const text=sql()
  assert.match(text,/t\.tgisinternal=false/)
  for(const table of ['benefit_companies','benefit_company_identifiers','benefit_company_sources','benefit_import_receipts']) assert.match(text,new RegExp(`'${table}'`))
  assert.match(text,/pg_get_triggerdef/)
  assert.match(text,/919231c97273f831498ce690575535b562cecca806bad4cff144d90156103a87/)
  assert.match(text,/complete target trigger inventory mismatch/)
})
