import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateOpenDartBundle } from './generate-opendart-benefit-directory.mjs'
import { verifyOpenDartBundle } from './verify-opendart-benefit-directory.mjs'

const options = { edition: '2026-11-23', retrievedAt: '2026-11-23T00:00:00Z', sourceUrl: 'https://opendart.fss.or.kr/api/corpCode.xml', reuseRights: 'OpenDART attribution required' }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const crc32 = bytes => { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1))}return(crc^0xffffffff)>>>0 }
function source() {
  const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><result><list><corp_code>00123456</corp_code><corp_name>Alpha</corp_name><corp_eng_name>ALPHA INC.</corp_eng_name><stock_code>123456</stock_code><modify_date>20261122</modify_date></list><list><corp_code>00999999</corp_code><corp_name>Alpha</corp_name><corp_eng_name></corp_eng_name><stock_code></stock_code><modify_date>20260101</modify_date></list></result>')
  const name = Buffer.from('CORPCODE.xml'); const body = deflateRawSync(xml)
  const crc=crc32(xml)
  const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8); local.writeUInt32LE(crc,14); local.writeUInt32LE(body.length,18); local.writeUInt32LE(xml.length,22); local.writeUInt16LE(name.length,26); name.copy(local,30)
  const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314,4); central.writeUInt16LE(20,6); central.writeUInt16LE(8,10); central.writeUInt32LE(crc,16); central.writeUInt32LE(body.length,20); central.writeUInt32LE(xml.length,24); central.writeUInt16LE(name.length,28); name.copy(central,46)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length,12); end.writeUInt32LE(local.length+body.length,16)
  return Buffer.concat([local,body,central,end])
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(),'opendart-verifier-')); const sourceFile = path.join(root,'corp.zip'); const bundleDir = path.join(root,'bundle')
  await writeFile(sourceFile, source()); await generateOpenDartBundle({ sourceFile, bundleDir, outputDir: bundleDir, ...options })
  return { root, sourceFile, bundleDir }
}

async function rewriteManifest(bundleDir, updater) {
  const manifestPath = path.join(bundleDir,'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath,'utf8'))
  await updater(manifest)
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
}

test('independent verifier accepts canonical source-bound bundle', async () => {
  const f = await fixture()
  try { const result = await verifyOpenDartBundle({ sourceFile: f.sourceFile, bundleDir: f.bundleDir }); assert.equal(result.companyCount, 2); assert.equal(result.sourceSha256, sha(source())) } finally { await rm(f.root,{recursive:true,force:true}) }
})

test('verifier rejects deletion even after mutable manifest digest/count recomputation', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.bundleDir,'companies.ndjson'); const rows = (await readFile(file,'utf8')).trim().split('\n'); rows.pop(); const bytes = Buffer.from(rows.join('\n')+'\n'); await writeFile(file,bytes)
    await rewriteManifest(f.bundleDir, manifest => { manifest.company_count--; manifest.outputs.companies.byte_count=bytes.length; manifest.outputs.companies.sha256=sha(bytes) })
    await assert.rejects(verifyOpenDartBundle({ sourceFile:f.sourceFile,bundleDir:f.bundleDir }), /source authority|count|set|binding/i)
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
      await assert.rejects(verifyOpenDartBundle({ sourceFile:f.sourceFile,bundleDir:f.bundleDir }), /authority|edition|identifier|deterministic/i)
    } finally { await rm(f.root,{recursive:true,force:true}) }
  }
})

test('verifier rejects symlink bundle components and source', async () => {
  const f = await fixture()
  try {
    const copy = path.join(f.root,'companies.copy'); await cp(path.join(f.bundleDir,'companies.ndjson'),copy); await rm(path.join(f.bundleDir,'companies.ndjson')); await symlink(copy,path.join(f.bundleDir,'companies.ndjson'))
    await assert.rejects(verifyOpenDartBundle({ sourceFile:f.sourceFile,bundleDir:f.bundleDir }), /symlink|regular|unsafe/i)
    const sourceLink=path.join(f.root,'source-link.zip'); await symlink(f.sourceFile,sourceLink)
    await assert.rejects(verifyOpenDartBundle({ sourceFile:sourceLink,bundleDir:f.bundleDir }), /symlink|regular|unsafe/i)
  } finally { await rm(f.root,{recursive:true,force:true}) }
})
