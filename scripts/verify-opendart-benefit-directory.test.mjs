import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateOpenDartBundle } from './generate-opendart-benefit-directory.mjs'
import { applyOpenDart } from './apply-opendart-benefit-directory.mjs'
import { parseOpenDartSourceZip, validateOpenDartAuthorityDescriptor, verifyOpenDartBundle } from './verify-opendart-benefit-directory.mjs'
import { zipContractCorpus } from './opendart-zip-contract-test-corpus.mjs'
import { authorityTextCases, corporationTextCases } from './opendart-text-contract-test-corpus.mjs'

const options = { edition: '2026-11-23', retrievedAt: '2026-11-23T00:00:00Z', sourceUrl: 'https://opendart.fss.or.kr/api/corpCode.xml', reuseRights: 'OpenDART attribution required' }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const crc32 = bytes => { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1))}return(crc^0xffffffff)>>>0 }
function source(rows = [['00123456','Alpha','ALPHA INC.','123456','20261122'],['00999999','Alpha','','','20260101']]) {
  const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><result>${rows.map(([code,name,eng,stock,date])=>`<list><corp_code>${code}</corp_code><corp_name>${name}</corp_name><corp_eng_name>${eng}</corp_eng_name><stock_code>${stock}</stock_code><modify_date>${date}</modify_date></list>`).join('')}</result>`)
  const name = Buffer.from('CORPCODE.xml'); const body = deflateRawSync(xml)
  const crc=crc32(xml)
  const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8); local.writeUInt32LE(crc,14); local.writeUInt32LE(body.length,18); local.writeUInt32LE(xml.length,22); local.writeUInt16LE(name.length,26); name.copy(local,30)
  const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314,4); central.writeUInt16LE(20,6); central.writeUInt16LE(8,10); central.writeUInt32LE(crc,16); central.writeUInt32LE(body.length,20); central.writeUInt32LE(xml.length,24); central.writeUInt16LE(name.length,28); name.copy(central,46)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length,12); end.writeUInt32LE(local.length+body.length,16)
  return Buffer.concat([local,body,central,end])
}

async function fixture(retrievedAt = options.retrievedAt) {
  const root = await mkdtemp(path.join(tmpdir(),'opendart-verifier-')); const sourceFile = path.join(root,'corp.zip'); const bundleDir = path.join(root,'bundle'); const authorityFile=path.join(root,'authority.json'); const bytes=source()
  await writeFile(sourceFile, bytes); await writeFile(authorityFile,JSON.stringify({schema_version:'benefit-directory-opendart-authority-v1',source_edition:options.edition,official_url:options.sourceUrl,reuse_rights_note:options.reuseRights,source_sha256:sha(bytes),retrieved_at:retrievedAt})+'\n'); await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: bundleDir })
  return { root, sourceFile, authorityFile, bundleDir }
}

async function rewriteManifest(bundleDir, updater) {
  const manifestPath = path.join(bundleDir,'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath,'utf8'))
  await updater(manifest)
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
}

async function rewriteSelfConsistentName(f, value) {
  const sourceBytes=source([['00123456',value,'ALPHA INC.','123456','20261122'],['00999999','Alpha','','','20260101']])
  const sourceDigest=sha(sourceBytes)
  await writeFile(f.sourceFile,sourceBytes)
  const authority=JSON.parse(await readFile(f.authorityFile,'utf8'))
  authority.source_sha256=sourceDigest
  await writeFile(f.authorityFile,JSON.stringify(authority)+'\n')
  const companiesPath=path.join(f.bundleDir,'companies.ndjson')
  const companies=(await readFile(companiesPath,'utf8')).trim().split('\n').map(JSON.parse)
  companies[0].display_name=value
  companies[0].normalized_name=value.toLowerCase()
  for(const company of companies) company.provenance.source_sha256=sourceDigest
  const companyBytes=Buffer.from(companies.map(JSON.stringify).join('\n')+'\n')
  await writeFile(companiesPath,companyBytes)
  await rewriteManifest(f.bundleDir,manifest=>{
    manifest.authority.source_sha256=sourceDigest
    manifest.source.sha256=sourceDigest
    manifest.source.byte_count=sourceBytes.length
    manifest.outputs.companies.byte_count=companyBytes.length
    manifest.outputs.companies.sha256=sha(companyBytes)
  })
}

test('independent verifier accepts canonical source-bound bundle', async () => {
  const f = await fixture()
  try { const result = await verifyOpenDartBundle({ sourceFile: f.sourceFile, authorityFile:f.authorityFile, bundleDir: f.bundleDir }); assert.equal(result.companyCount, 2); assert.equal(result.sourceSha256, sha(source())) } finally { await rm(f.root,{recursive:true,force:true}) }
})

test('independent verifier enforces the same complete ZIP contract corpus', () => {
  for (const sample of zipContractCorpus()) {
    if (sample.accept) assert.doesNotThrow(() => parseOpenDartSourceZip(sample.bytes), sample.name)
    else assert.throws(() => parseOpenDartSourceZip(sample.bytes), undefined, sample.name)
  }
})

test('independent verifier separately enforces the shared corporation text corpus', () => {
  for (const field of ['corp_name', 'corp_eng_name']) {
    for (const sample of corporationTextCases(field)) {
      const row = ['00123456', 'Alpha', 'ALPHA', '', '20260101']
      row[field === 'corp_name' ? 1 : 2] = sample.value
      const action = () => parseOpenDartSourceZip(source([row]))
      if (sample.accept) assert.equal(action()[0][field === 'corp_name' ? 'name' : 'eng'],sample.value,`${field}: ${sample.name}`)
      else assert.throws(action, undefined, `${field}: ${sample.name}`)
    }
  }
})

test('independent verifier separately enforces bounded control-free authority text', () => {
  const bytes = source()
  for (const sample of authorityTextCases()) {
    const authority = {schema_version:'benefit-directory-opendart-authority-v1',source_edition:options.edition,official_url:options.sourceUrl,reuse_rights_note:options.reuseRights,source_sha256:sha(bytes),retrieved_at:options.retrievedAt}
    authority[sample.field] = sample.value
    const action = () => validateOpenDartAuthorityDescriptor(authority, bytes)
    if (sample.accept) assert.doesNotThrow(action, sample.name)
    else assert.throws(action, undefined, sample.name)
  }
})

test('verifier and apply reject self-consistently rehashed bundles with invalid decoded names',async()=>{
  for(const value of ['Alpha\tBeta','Alpha\u2028Beta','😀'.repeat(201)]){
    const f=await fixture()
    try{
      await rewriteSelfConsistentName(f,value)
      await assert.rejects(verifyOpenDartBundle({sourceFile:f.sourceFile,authorityFile:f.authorityFile,bundleDir:f.bundleDir}),/corp_name|source authority|invalid/i)
      await assert.rejects(applyOpenDart({databaseUrl:'postgresql://user:password@127.0.0.1/test',psqlBin:'/does/not/matter',sourceFile:f.sourceFile,authorityFile:f.authorityFile,bundleDir:f.bundleDir,dryRun:true}),/corp_name|source authority|invalid/i)
    }finally{await rm(f.root,{recursive:true,force:true})}
  }
})

test('verifier accepts a valid leap day and rejects normalized or impossible authority timestamps', async () => {
  const leap = await fixture('2024-02-29T23:59:59Z')
  try { await verifyOpenDartBundle({sourceFile:leap.sourceFile,authorityFile:leap.authorityFile,bundleDir:leap.bundleDir}) }
  finally { await rm(leap.root,{recursive:true,force:true}) }
  for (const retrievedAt of ['2026-02-30T00:00:00Z','2025-02-29T00:00:00Z','2026-01-01T24:00:00Z']) {
    const f = await fixture()
    try {
      const authority = JSON.parse(await readFile(f.authorityFile,'utf8'))
      authority.retrieved_at = retrievedAt
      await writeFile(f.authorityFile, JSON.stringify(authority) + '\n')
      const identifiersPath=path.join(f.bundleDir,'identifiers.ndjson')
      const identifiers=(await readFile(identifiersPath,'utf8')).trim().split('\n').map(JSON.parse)
      for(const identifier of identifiers) identifier.verified_at=retrievedAt
      const identifierBytes=Buffer.from(identifiers.map(JSON.stringify).join('\n')+'\n')
      await writeFile(identifiersPath,identifierBytes)
      await rewriteManifest(f.bundleDir, manifest => {
        manifest.authority.retrieved_at=retrievedAt
        manifest.source.retrieved_at=retrievedAt
        manifest.outputs.identifiers.byte_count=identifierBytes.length
        manifest.outputs.identifiers.sha256=sha(identifierBytes)
      })
      await assert.rejects(verifyOpenDartBundle({sourceFile:f.sourceFile,authorityFile:f.authorityFile,bundleDir:f.bundleDir}), /authority|timestamp|binding/i)
    } finally { await rm(f.root,{recursive:true,force:true}) }
  }
})

test('verifier rejects deletion even after mutable manifest digest/count recomputation', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.bundleDir,'companies.ndjson'); const rows = (await readFile(file,'utf8')).trim().split('\n'); rows.pop(); const bytes = Buffer.from(rows.join('\n')+'\n'); await writeFile(file,bytes)
    await rewriteManifest(f.bundleDir, manifest => { manifest.company_count--; manifest.outputs.companies.byte_count=bytes.length; manifest.outputs.companies.sha256=sha(bytes) })
    await assert.rejects(verifyOpenDartBundle({ sourceFile:f.sourceFile,authorityFile:f.authorityFile,bundleDir:f.bundleDir }), /source authority|count|set|binding/i)
  } finally { await rm(f.root,{recursive:true,force:true}) }
})

test('verifier rejects substituted corp code, altered edition, and recomputed output manifests', async () => {
  for (const mutation of ['code','edition']) {
    const f = await fixture()
    try {
      const idFile = path.join(f.bundleDir,'identifiers.ndjson'); const ids = (await readFile(idFile,'utf8')).trim().split('\n').map(JSON.parse)
      if (mutation === 'code') ids[0].identifier_digest_or_value='00123457'; else ids[0].source_edition='other-edition'
      const bytes=Buffer.from(ids.map(JSON.stringify).join('\n')+'\n'); await writeFile(idFile,bytes)
      await rewriteManifest(f.bundleDir, manifest => { manifest.outputs.identifiers.byte_count=bytes.length; manifest.outputs.identifiers.sha256=sha(bytes) })
      await assert.rejects(verifyOpenDartBundle({ sourceFile:f.sourceFile,authorityFile:f.authorityFile,bundleDir:f.bundleDir }), /authority|edition|identifier|deterministic/i)
    } finally { await rm(f.root,{recursive:true,force:true}) }
  }
})

test('verifier rejects self-consistently rehashed manifest authority changes while authority is fixed',async()=>{
  const f=await fixture()
  try{
    await rewriteManifest(f.bundleDir,m=>{m.authority.source_edition='forged';m.source.edition='forged';m.authority.official_url='https://attacker.example/corpCode.xml';m.source.url=m.authority.official_url})
    await assert.rejects(verifyOpenDartBundle({sourceFile:f.sourceFile,authorityFile:f.authorityFile,bundleDir:f.bundleDir}),/authority|binding/i)
  }finally{await rm(f.root,{recursive:true,force:true})}
})

test('verifier rejects symlink bundle components and source', async () => {
  const f = await fixture()
  try {
    const copy = path.join(f.root,'companies.copy'); await cp(path.join(f.bundleDir,'companies.ndjson'),copy); await rm(path.join(f.bundleDir,'companies.ndjson')); await symlink(copy,path.join(f.bundleDir,'companies.ndjson'))
    await assert.rejects(verifyOpenDartBundle({ sourceFile:f.sourceFile,authorityFile:f.authorityFile,bundleDir:f.bundleDir }), /symlink|regular|unsafe/i)
    const sourceLink=path.join(f.root,'source-link.zip'); await symlink(f.sourceFile,sourceLink)
    await assert.rejects(verifyOpenDartBundle({ sourceFile:sourceLink,authorityFile:f.authorityFile,bundleDir:f.bundleDir }), /symlink|regular|unsafe/i)
  } finally { await rm(f.root,{recursive:true,force:true}) }
})
