import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { authorityJsonMutationCorpus } from './opendart-authority-json-test-corpus.mjs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildOpenDartBundle, generateOpenDartBundle, parseCorpCodeZip, validateOpenDartText } from './generate-opendart-benefit-directory.mjs'
import { buildOpenDartImportSql, computeOpenDartRowDigest } from './apply-opendart-benefit-directory.mjs'
import { zipContractCorpus } from './opendart-zip-contract-test-corpus.mjs'
import { authorityTextCases, corporationTextCases } from './opendart-text-contract-test-corpus.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return (crc ^ 0xffffffff) >>> 0
}
const options = Object.freeze({ edition: '2026-11-23', retrievedAt: '2026-11-23T00:00:00Z', sourceUrl: 'https://opendart.fss.or.kr/api/corpCode.xml', reuseRights: 'OpenDART attribution required' })
const xml = (rows = [
  ['00123456', '가나다 주식회사', 'GANADA CO., LTD.', '123456', '20261122'],
  ['00999999', 'Same Name', '', '', '20260228'],
  ['00000001', 'Same Name', 'Same Name Ltd', '000001', '20260101'],
]) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<result>\n${rows.map(([code, name, eng, stock, date]) => `<list><corp_code>${code}</corp_code><corp_name>${name}</corp_name><corp_eng_name>${eng}</corp_eng_name><stock_code>${stock}</stock_code><modify_date>${date}</modify_date></list>`).join('\n')}\n</result>\n`)

function zip(memberBytes, { name = 'CORPCODE.xml', method = 8, flags = 0 } = {}) {
  const nameBytes = Buffer.from(name)
  const body = method === 8 ? deflateRawSync(memberBytes) : memberBytes
  const crc = crc32(memberBytes)
  const local = Buffer.alloc(30 + nameBytes.length)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8)
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(memberBytes.length, 22); local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30)
  const central = Buffer.alloc(46 + nameBytes.length)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10)
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(memberBytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(0, 38); central.writeUInt32LE(0, 42); nameBytes.copy(central, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length + body.length, 16)
  return Buffer.concat([local, body, central, eocd])
}

const build = (rows, overrides = {}) => {
  const source = zip(xml(rows))
  return buildOpenDartBundle(source, { ...options, ...overrides })
}
const authorityFor = (sourceBytes, overrides = {}) => ({
  schema_version: 'benefit-directory-opendart-authority-v1',
  source_edition: overrides.edition ?? options.edition,
  official_url: options.sourceUrl,
  reuse_rights_note: options.reuseRights,
  source_sha256: sha(sourceBytes),
  retrieved_at: overrides.retrievedAt ?? options.retrievedAt,
})
const transactionResidue = async root => (await readdir(root)).filter(name =>
  name.startsWith('.opendart-stage-') || name.startsWith('.opendart-previous-') || name.endsWith('.generate.lock'))

test('builds canonical deterministic companies and identifiers without merging equal names', () => {
  const source = zip(xml())
  const first = buildOpenDartBundle(source, options)
  const second = buildOpenDartBundle(source, options)
  assert.deepEqual(first, second)
  assert.equal(first.manifest.company_count, 3)
  assert.equal(new Set(first.companies.map(row => row.company_id)).size, 3)
  assert.equal(first.companies.filter(row => row.display_name === 'Same Name').length, 2)
  assert.match(first.companies[0].company_id, /^KR-CAN-[0-9a-f]{32}$/)
  assert.deepEqual(Object.keys(first.companies[0]), ['company_id','identity_class','display_name','normalized_name','industry','size_class','region','summary','is_searchable','source_edition','provenance'])
  assert.deepEqual(Object.keys(first.identifiers[0]), ['identifier_id','company_id','identifier_type','identifier_digest_or_value','source_edition','verified_at'])
  assert.equal(first.identifiers[0].identifier_type, 'opendart_corp_code')
  assert.equal(first.companies.find(row => row.display_name.startsWith('가나다')).provenance.aliases[0], 'GANADA CO., LTD.')
  assert.equal(first.companiesNdjson.at(-1), 10)
  assert.equal(first.identifiersNdjson.at(-1), 10)
})

test('rejects duplicate codes, malformed fields, DTD/entities, unexpected XML, and unsafe ZIPs', () => {
  assert.throws(() => build([['00123456','One','','','20260101'],['00123456','Two','','','20260101']]), /duplicate|corp_code/i)
  for (const bad of [
    [['1234567','One','','','20260101']], [['00123456','','','','20260101']], [['00123456','One','','12345','20260101']], [['00123456','One','','','20260230']],
  ]) assert.throws(() => build(bad), /corp_code|name|stock|date/i)
  assert.throws(() => parseCorpCodeZip(zip(Buffer.from('<!DOCTYPE x [<!ENTITY e "x">]><result/>'))), /DTD|entity/i)
  assert.throws(() => parseCorpCodeZip(zip(Buffer.from('<result><unexpected/></result>'))), /structure|list/i)
  assert.throws(() => parseCorpCodeZip(zip(xml(), { name: '../CORPCODE.xml' })), /member|path|name/i)
  assert.throws(() => parseCorpCodeZip(zip(xml(), { flags: 1 })), /encrypted|flag/i)
  assert.throws(() => parseCorpCodeZip(zip(xml(), { method: 12 })), /method/i)
})

test('generator enforces the complete ZIP contract corpus', () => {
  for (const sample of zipContractCorpus()) {
    if (sample.accept) assert.doesNotThrow(() => parseCorpCodeZip(sample.bytes), sample.name)
    else assert.throws(() => parseCorpCodeZip(sample.bytes), undefined, sample.name)
  }
})

test('generator enforces bounded control-free corporation text by code point and UTF-8 byte', () => {
  for (const field of ['corp_name', 'corp_eng_name']) {
    for (const sample of corporationTextCases(field)) {
      const row = ['00123456', 'Alpha', 'ALPHA', '', '20260101']
      row[field === 'corp_name' ? 1 : 2] = sample.value
      const action = sample.name.includes('surrogate')
        ? () => validateOpenDartText(sample.value,field,200,800,field==='corp_eng_name')
        : () => parseCorpCodeZip(zip(xml([row])))
      if (sample.accept) assert.equal(action()[0][field],sample.value,`${field}: ${sample.name}`)
      else assert.throws(action, undefined, `${field}: ${sample.name}`)
    }
  }
})

test('generator enforces bounded control-free authority text after JSON decoding', () => {
  const sourceBytes = zip(xml())
  for (const sample of authorityTextCases()) {
    const authority = authorityFor(sourceBytes)
    authority[sample.field] = sample.value
    const action = () => buildOpenDartBundle(sourceBytes, authority)
    if (sample.accept) assert.doesNotThrow(action, sample.name)
    else assert.throws(action, undefined, sample.name)
  }
})

test('valid surrogate pairs remain one scalar with exact UTF-8 bytes', () => {
  const emoji='\ud83d\ude00'
  assert.equal([...validateOpenDartText(emoji,'emoji',1,4)].length,1)
  assert.deepEqual(Buffer.from(emoji),Buffer.from([0xf0,0x9f,0x98,0x80]))
  assert.throws(()=>validateOpenDartText(`${emoji}A`,'emoji',1,5),/invalid/i)
})

test('strict authority JSON accepts an escaped valid surrogate pair', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'opendart-valid-surrogate-pair-'))
  try{
    const sourceBytes=zip(xml()),sourceFile=path.join(root,'source.zip'),authorityFile=path.join(root,'authority.json')
    await writeFile(sourceFile,sourceBytes)
    const text=JSON.stringify(authorityFor(sourceBytes)).replace('OpenDART attribution required','OpenDART \\ud83d\\ude00 attribution')+'\n'
    await writeFile(authorityFile,text)
    const built=await generateOpenDartBundle({sourceFile,authorityFile,outputDir:path.join(root,'bundle')})
    assert.equal(built.manifest.authority.reuse_rights_note,'OpenDART 😀 attribution')
    assert.ok(built.manifestBytes.includes(Buffer.from([0xf0,0x9f,0x98,0x80])))
  }finally{await rm(root,{recursive:true,force:true})}
})

test('generator rejects duplicate authority keys at every depth before JSON collapse and enforces parser bounds', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-authority-json-'))
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'source.zip')
    const authorityFile = path.join(root, 'authority.json')
    await writeFile(sourceFile, sourceBytes)
    for (const sample of authorityJsonMutationCorpus(authorityFor(sourceBytes))) {
      await writeFile(authorityFile, sample.text + '\n')
      await assert.rejects(
        generateOpenDartBundle({ sourceFile, authorityFile, outputDir: path.join(root, 'bundle') }),
        sample.expected ?? /duplicate/i,
        sample.name,
      )
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('generator and apply accept only exact calendar-valid UTC-second timestamps', () => {
  assert.doesNotThrow(() => buildOpenDartBundle(zip(xml()), { ...options, retrievedAt: '2024-02-29T23:59:59Z' }))
  for (const retrievedAt of ['2026-02-30T00:00:00Z','2025-02-29T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:00:00+00:00','2026-01-01T00:00:00.000Z']) {
    assert.throws(() => buildOpenDartBundle(zip(xml()), { ...options, retrievedAt }), /retriev|timestamp/i, retrievedAt)
  }
  const sourceBytes = zip(xml())
  const built = buildOpenDartBundle(sourceBytes, authorityFor(sourceBytes))
  const verified = { manifest: structuredClone(built.manifest), bundleSha256: sha(built.manifestBytes) }
  verified.manifest.source.retrieved_at = '2026-02-30T00:00:00Z'
  verified.manifest.authority.retrieved_at = '2026-02-30T00:00:00Z'
  assert.throws(() => buildOpenDartImportSql({ tsvPath: '/private/import/rows.tsv', verified, dryRun: true }), /retriev|timestamp/i)
})

test('pins source digest, edition, retrieval metadata, counts, and frozen base seed preservation', () => {
  const source = zip(xml())
  const built = buildOpenDartBundle(source, options)
  assert.equal(built.manifest.source.sha256, sha(source))
  assert.equal(built.manifest.source.byte_count, source.length)
  assert.equal(built.manifest.source.edition, options.edition)
  assert.equal(built.manifest.source.retrieved_at, options.retrievedAt)
  assert.equal(built.manifest.source.row_count, 3)
  assert.deepEqual(built.manifest.base_seed_preservation, { company_count: 40053, source_sha256: 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594' })
})

test('normal generation is deterministic and check mode is read-only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-generator-'))
  try {
    const source = path.join(root, 'corp.zip'); const output = path.join(root, 'bundle'); const authority = path.join(root,'authority.json')
    const sourceBytes=zip(xml())
    await writeFile(source, sourceBytes, { mode: 0o600 })
    await writeFile(authority,JSON.stringify({schema_version:'benefit-directory-opendart-authority-v1',source_edition:options.edition,official_url:options.sourceUrl,reuse_rights_note:options.reuseRights,source_sha256:sha(sourceBytes),retrieved_at:options.retrievedAt})+'\n')
    await generateOpenDartBundle({ sourceFile: source, authorityFile:authority, outputDir: output })
    const before = [await readFile(path.join(output,'manifest.json')), await readFile(path.join(output,'companies.ndjson')), await readFile(path.join(output,'identifiers.ndjson'))]
    await generateOpenDartBundle({ sourceFile: source, authorityFile:authority, outputDir: output, check: true })
    assert.deepEqual([await readFile(path.join(output,'manifest.json')), await readFile(path.join(output,'companies.ndjson')), await readFile(path.join(output,'identifiers.ndjson'))], before)
    const absentParent = path.join(root, 'absent')
    await assert.rejects(generateOpenDartBundle({ sourceFile: source, authorityFile:authority, outputDir: path.join(absentParent,'bundle'), check: true }), /absent|missing|ENOENT/i)
    await assert.rejects(readdir(absentParent), error => error?.code === 'ENOENT')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('lock allocation collision is fail-closed and cooperating concurrent generators serialize without residue', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-lock-collision-'))
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'corp.zip')
    const authorityFile = path.join(root, 'authority.json')
    const output = path.join(root, 'bundle')
    const lockPath = `${output}.generate.lock`
    await writeFile(sourceFile, sourceBytes)
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n')
    await writeFile(lockPath, 'pre-existing lock')
    await assert.rejects(generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output }), /lock is held/i)
    assert.equal(await readFile(lockPath, 'utf8'), 'pre-existing lock')
    await rm(lockPath)

    let enter
    const entered = new Promise(resolve => { enter = resolve })
    let release
    const released = new Promise(resolve => { release = resolve })
    const first = generateOpenDartBundle({
      sourceFile, authorityFile, outputDir: output,
      testOnly: { beforeInstall: async () => { enter(); await released } },
    })
    await entered
    await assert.rejects(generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output }), /lock is held/i)
    release()
    const result = await first
    assert.equal(result.cleanup.status, 'clean')
    assert.deepEqual(await transactionResidue(root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('competing destination preserves the prior bundle in reported owner-only recovery custody', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-retained-backup-'))
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'corp.zip')
    const authorityFile = path.join(root, 'authority.json')
    const output = path.join(root, 'bundle')
    await writeFile(sourceFile, sourceBytes, { mode: 0o600 })
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n', { mode: 0o600 })
    await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output })
    const prior = Object.fromEntries(await Promise.all(['manifest.json', 'companies.ndjson', 'identifiers.ndjson'].map(async name => [name, await readFile(path.join(output, name))])))
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes, { edition: '2026-11-24', retrievedAt: '2026-11-24T00:00:00Z' })) + '\n')

    let failure
    try {
      await generateOpenDartBundle({
        sourceFile, authorityFile, outputDir: output,
        testOnly: { beforeInstall: async () => {
          await mkdir(output)
          await writeFile(path.join(output, 'intruder.txt'), 'do not overwrite')
        } },
      })
      assert.fail('generation unexpectedly succeeded')
    } catch (error) { failure = error }

    assert.match(failure.message, /automatic restore failed; preserved prior bundle at \.opendart-previous-[^/]+\/bundle/i)
    assert.doesNotMatch(failure.message, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal(await readFile(path.join(output, 'intruder.txt'), 'utf8'), 'do not overwrite')
    const retained = (await readdir(root)).filter(name => name.startsWith('.opendart-previous-'))
    assert.equal(retained.length, 1)
    assert.ok(failure.message.includes(`${retained[0]}/bundle`))
    assert.equal((await stat(path.join(root, retained[0]))).mode & 0o777, 0o700)
    for (const [name, bytes] of Object.entries(prior)) assert.deepEqual(await readFile(path.join(root, retained[0], 'bundle', name)), bytes)
    assert.deepEqual((await transactionResidue(root)).filter(name => !name.startsWith('.opendart-previous-')), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ordinary install failure atomically restores exact prior bytes without transaction residue', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-restored-backup-'))
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'corp.zip')
    const authorityFile = path.join(root, 'authority.json')
    const output = path.join(root, 'bundle')
    await writeFile(sourceFile, sourceBytes)
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n')
    await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output })
    const prior = Object.fromEntries(await Promise.all(['manifest.json', 'companies.ndjson', 'identifiers.ndjson'].map(async name => [name, await readFile(path.join(output, name))])))

    await assert.rejects(generateOpenDartBundle({
      sourceFile, authorityFile, outputDir: output,
      testOnly: { beforeInstall: () => { throw Error('injected ordinary install failure') } },
    }), /injected ordinary install failure/)

    for (const [name, bytes] of Object.entries(prior)) assert.deepEqual(await readFile(path.join(output, name)), bytes)
    assert.deepEqual(await transactionResidue(root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('successful replacement installs exact new bundle and removes the old backup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-successful-replacement-'))
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'corp.zip')
    const authorityFile = path.join(root, 'authority.json')
    const output = path.join(root, 'bundle')
    await writeFile(sourceFile, sourceBytes)
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n')
    await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output })
    const nextAuthority = authorityFor(sourceBytes, { edition: '2026-11-24', retrievedAt: '2026-11-24T00:00:00Z' })
    await writeFile(authorityFile, JSON.stringify(nextAuthority) + '\n')
    const expected = buildOpenDartBundle(sourceBytes, nextAuthority)

    await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output })

    assert.deepEqual(await readFile(path.join(output, 'manifest.json')), expected.manifestBytes)
    assert.deepEqual(await readFile(path.join(output, 'companies.ndjson')), expected.companiesNdjson)
    assert.deepEqual(await readFile(path.join(output, 'identifiers.ndjson')), expected.identifiersNdjson)
    assert.deepEqual(await transactionResidue(root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('post-commit backup cleanup failure reports committed success and retains owner-only garbage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-committed-cleanup-'))
  const warnings = []
  const originalWarn = console.warn
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'corp.zip')
    const authorityFile = path.join(root, 'authority.json')
    const output = path.join(root, 'bundle')
    await writeFile(sourceFile, sourceBytes)
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n')
    await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output })
    const nextAuthority = authorityFor(sourceBytes, { edition: '2026-11-24', retrievedAt: '2026-11-24T00:00:00Z' })
    await writeFile(authorityFile, JSON.stringify(nextAuthority) + '\n')
    const expected = buildOpenDartBundle(sourceBytes, nextAuthority)
    console.warn = message => warnings.push(String(message))

    const result = await generateOpenDartBundle({
      sourceFile, authorityFile, outputDir: output,
      testOnly: { injectBackupCleanupFailure: () => { throw Error('cleanup unavailable') } },
    })

    assert.deepEqual(result.manifest, expected.manifest)
    assert.deepEqual(await readFile(path.join(output, 'manifest.json')), expected.manifestBytes)
    assert.match(warnings.join('\n'), /committed; stale backup remains at \.opendart-previous-[^/]+\/bundle/)
    const retained = (await readdir(root)).filter(name => name.startsWith('.opendart-previous-'))
    assert.equal(retained.length, 1)
    assert.equal((await stat(path.join(root, retained[0]))).mode & 0o777, 0o700)
  } finally {
    console.warn = originalWarn
    await rm(root, { recursive: true, force: true })
  }
})

test('cooperative post-commit cleanup removes the owned lock path despite a reported close failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-lock-close-'))
  const warnings = []
  const originalWarn = console.warn
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'corp.zip')
    const authorityFile = path.join(root, 'authority.json')
    const output = path.join(root, 'bundle')
    await writeFile(sourceFile, sourceBytes)
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n')
    console.warn = message => warnings.push(String(message))
    const result = await generateOpenDartBundle({
      sourceFile, authorityFile, outputDir: output,
      testOnly: { injectLockCloseFailure: () => { throw Error('close unavailable') } },
    })
    assert.equal(result.cleanup.status, 'committed-with-residue')
    assert.deepEqual(result.cleanup.residues, ['generation-lock-close-failed'])
    assert.match(warnings.join('\n'), /committed.*lock cleanup.*residue/i)
    assert.deepEqual(await transactionResidue(root), [])
  } finally {
    console.warn = originalWarn
    await rm(root, { recursive: true, force: true })
  }
})

test('post-commit lock path cleanup failure returns committed success with the owned lock residue', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-lock-path-cleanup-'))
  const warnings = []
  const originalWarn = console.warn
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'corp.zip')
    const authorityFile = path.join(root, 'authority.json')
    const output = path.join(root, 'bundle')
    await writeFile(sourceFile, sourceBytes)
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n')
    console.warn = message => warnings.push(String(message))
    const result = await generateOpenDartBundle({
      sourceFile, authorityFile, outputDir: output,
      testOnly: { injectLockPathCleanupFailure: () => { throw Error('unlink unavailable') } },
    })
    assert.equal(result.cleanup.status, 'committed-with-residue')
    assert.deepEqual(result.cleanup.residues, ['generation-lock-removal-failed'])
    assert.match(warnings.join('\n'), /committed.*lock cleanup.*residue/i)
    assert.equal((await stat(`${output}.generate.lock`)).mode & 0o170000, 0o100000)
  } finally {
    console.warn = originalWarn
    await rm(root, { recursive: true, force: true })
  }
})

for (const replacementType of ['directory', 'file', 'symlink']) {
  test(`lock ${replacementType} replacement present before cleanup inspection is left untouched and reported`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), `opendart-lock-${replacementType}-`))
    const warnings = []
    const originalWarn = console.warn
    try {
      const sourceBytes = zip(xml())
      const sourceFile = path.join(root, 'corp.zip')
      const authorityFile = path.join(root, 'authority.json')
      const output = path.join(root, 'bundle')
      const lockPath = `${output}.generate.lock`
      const symlinkTarget = path.join(root, 'replacement-target')
      await writeFile(sourceFile, sourceBytes)
      await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n')
      await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output })
      const nextAuthority = authorityFor(sourceBytes, { edition: '2026-11-24', retrievedAt: '2026-11-24T00:00:00Z' })
      await writeFile(authorityFile, JSON.stringify(nextAuthority) + '\n')
      const expected = buildOpenDartBundle(sourceBytes, nextAuthority)
      console.warn = message => warnings.push(String(message))

      const result = await generateOpenDartBundle({
        sourceFile, authorityFile, outputDir: output,
        testOnly: { beforeInstall: async () => {
          await rm(lockPath)
          if (replacementType === 'directory') await mkdir(lockPath)
          if (replacementType === 'file') await writeFile(lockPath, 'replacement lock file')
          if (replacementType === 'symlink') { await writeFile(symlinkTarget, 'target'); await symlink(symlinkTarget, lockPath) }
        } },
      })

      assert.deepEqual(await readFile(path.join(output, 'manifest.json')), expected.manifestBytes)
      assert.equal(result.cleanup.status, 'committed-with-residue')
      assert.deepEqual(result.cleanup.residues, ['generation-lock-replaced'])
      assert.match(warnings.join('\n'), /committed.*lock identity mismatch.*did not remove/i)
      const replacement = await stat(lockPath)
      if (replacementType === 'directory') assert.ok(replacement.isDirectory())
      if (replacementType === 'file') assert.equal(await readFile(lockPath, 'utf8'), 'replacement lock file')
      if (replacementType === 'symlink') assert.equal(await readFile(lockPath, 'utf8'), 'target')
    } finally {
      console.warn = originalWarn
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('pre-commit primary failure survives lock cleanup failure and preserves the old bundle', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-lock-primary-'))
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'corp.zip')
    const authorityFile = path.join(root, 'authority.json')
    const output = path.join(root, 'bundle')
    const lockPath = `${output}.generate.lock`
    await writeFile(sourceFile, sourceBytes)
    await writeFile(authorityFile, JSON.stringify(authorityFor(sourceBytes)) + '\n')
    await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: output })
    const prior = await readFile(path.join(output, 'manifest.json'))

    await assert.rejects(generateOpenDartBundle({
      sourceFile, authorityFile, outputDir: output,
      testOnly: { beforeInstall: async () => {
        await rm(lockPath)
        await mkdir(lockPath)
        throw Error('primary install failure')
      }, injectLockCloseFailure: () => { throw Error('secondary lock close failure') } },
    }), error => error.message === 'primary install failure')

    assert.deepEqual(await readFile(path.join(output, 'manifest.json')), prior)
    assert.ok((await stat(lockPath)).isDirectory())
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('apply SQL uses framed UTF-8 digests, strong-code conflicts, exact preservation, and explicit rollback', () => {
  assert.notEqual(computeOpenDartRowDigest(['ab', 'c', ...Array(14).fill(null)]), computeOpenDartRowDigest(['a', 'bc', ...Array(14).fill(null)]))
  assert.notEqual(computeOpenDartRowDigest(['', ...Array(15).fill(null)]), computeOpenDartRowDigest(Array(16).fill(null)))
  const sourceBytes = zip(xml())
  const built = buildOpenDartBundle(sourceBytes, { schema_version:'benefit-directory-opendart-authority-v1', source_edition:options.edition, official_url:options.sourceUrl, reuse_rights_note:options.reuseRights, source_sha256:sha(sourceBytes), retrieved_at:options.retrievedAt })
  const verified = { manifest: built.manifest, bundleSha256: sha(built.manifestBytes) }
  const sql = buildOpenDartImportSql({ tsvPath: '/private/import/rows.tsv', verified, dryRun: true, injectLateFailure: true })
  assert.match(sql, /strong identifier collision/)
  assert.match(sql, /prior receipt preservation failed/)
  assert.match(sql, /publication preservation failed/)
  assert.match(sql, /injected late OpenDART failure/)
  assert.match(sql, /pg_get_constraintdef/)
  assert.match(sql, /relacl/)
  assert.match(sql, /p\.prosrc/)
  assert.match(sql, /t\.tgenabled/)
  assert.match(sql, /t\.tgtype/)
  assert.match(sql, /ROLLBACK;/)
  assert.doesNotMatch(sql, /ON CONFLICT\s*\([^)]*display_name/i)
})

test('row digest rejects malformed UTF-16 instead of colliding with literal replacement text', () => {
  const replacement = ['Alpha�Beta', ...Array(15).fill(null)]
  assert.match(computeOpenDartRowDigest(replacement), /^[0-9a-f]{64}$/)
  for (const malformed of ['Alpha\ud800Beta','Alpha\udc00Beta','Alpha\ud800ABeta','Alpha\ud800\ud801Beta']) {
    assert.throws(() => computeOpenDartRowDigest([malformed, ...Array(15).fill(null)]), /surrogate|unicode/i)
  }
})

test('no-follow source and output reads reject symlinks and failed replacement preserves old bundle', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-symlink-'))
  try {
    const real = path.join(root,'real.zip'); const link = path.join(root,'link.zip'); const output = path.join(root,'bundle'); const authority=path.join(root,'authority.json')
    const sourceBytes=zip(xml()); await writeFile(real, sourceBytes); await writeFile(authority,JSON.stringify({schema_version:'benefit-directory-opendart-authority-v1',source_edition:options.edition,official_url:options.sourceUrl,reuse_rights_note:options.reuseRights,source_sha256:sha(sourceBytes),retrieved_at:options.retrievedAt})+'\n'); await symlink(real, link)
    await assert.rejects(generateOpenDartBundle({ sourceFile: link, authorityFile:authority, outputDir: output }), /symlink|unsafe/i)
    await generateOpenDartBundle({ sourceFile: real, authorityFile:authority, outputDir: output })
    const before = await readFile(path.join(output,'manifest.json'))
    await assert.rejects(generateOpenDartBundle({ sourceFile: real, authorityFile:authority, outputDir: output, testOnly: { beforeInstall: () => { throw Error('injected replacement failure') } } }), /injected/)
    assert.deepEqual(await readFile(path.join(output,'manifest.json')), before)
    await mkdir(path.join(root,'links')); await symlink(path.join(output,'companies.ndjson'), path.join(root,'links','companies.ndjson'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('requires a separate exact source-bound authority descriptor and permits a safe 0755 parent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opendart-authority-'))
  try {
    const sourceBytes = zip(xml())
    const sourceFile = path.join(root, 'source.zip')
    const authorityFile = path.join(root, 'authority.json')
    await writeFile(sourceFile, sourceBytes)
    await writeFile(authorityFile, JSON.stringify({
      schema_version: 'benefit-directory-opendart-authority-v1',
      source_edition: '2026-11-23',
      official_url: 'https://opendart.fss.or.kr/api/corpCode.xml',
      reuse_rights_note: 'Reviewed synthetic test fixture; not production authority.',
      source_sha256: sha(sourceBytes),
      retrieved_at: '2026-11-23T00:00:00Z',
    }) + '\n')
    await chmod(root,0o755)
    await generateOpenDartBundle({ sourceFile, authorityFile, outputDir: path.join(root, 'bundle') })
    const manifest = JSON.parse(await readFile(path.join(root, 'bundle', 'manifest.json')))
    assert.equal(manifest.authority.source_sha256, sha(sourceBytes))
    const bad = { ...manifest.authority, official_url: 'https://attacker.example/corpCode.xml' }
    await writeFile(authorityFile, JSON.stringify(bad) + '\n')
    await assert.rejects(generateOpenDartBundle({ sourceFile, authorityFile, outputDir: path.join(root, 'bad') }), /authority|official|URL/i)
    await writeFile(authorityFile,JSON.stringify(manifest.authority)+'\n');await chmod(root,0o775)
    await assert.rejects(generateOpenDartBundle({sourceFile,authorityFile,outputDir:path.join(root,'writable')}),/writable|parent/i)
  } finally { await chmod(root,0o700).catch(()=>{}); await rm(root, { recursive: true, force: true }) }
})

test('production apply CLI kills and reaps a TERM-ignoring psql group and removes temp custody', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'opendart-signal-'))
  try {
    const sourceBytes=zip(xml()),sourceFile=path.join(root,'source.zip'),authorityFile=path.join(root,'authority.json'),bundleDir=path.join(root,'bundle'),shim=path.join(root,'psql-shim'),pidFile=path.join(root,'child.pid'),applyTmp=path.join(root,'tmp')
    await mkdir(applyTmp,{mode:0o700});await writeFile(sourceFile,sourceBytes);await writeFile(authorityFile,JSON.stringify({schema_version:'benefit-directory-opendart-authority-v1',source_edition:options.edition,official_url:options.sourceUrl,reuse_rights_note:options.reuseRights,source_sha256:sha(sourceBytes),retrieved_at:options.retrievedAt})+'\n')
    await generateOpenDartBundle({sourceFile,authorityFile,outputDir:bundleDir})
    await writeFile(shim,`#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'psql (PostgreSQL) 17.1'; exit 0; fi\ntrap '' TERM INT\necho $$ > '${pidFile}'\nwhile :; do sleep 1; done\n`,{mode:0o700})
    const child=spawn(process.execPath,['scripts/apply-opendart-benefit-directory.mjs','--source',sourceFile,'--authority',authorityFile,'--bundle',bundleDir,'--dry-run'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,TMPDIR:applyTmp,PSQL_BIN:shim,DATABASE_URL:'postgresql://user:secret@127.0.0.1:5432/test'}})
    for(let i=0;i<100;i++){try{await readFile(pidFile);break}catch{await new Promise(r=>setTimeout(r,25))}}
    const psqlPid=Number((await readFile(pidFile,'utf8')).trim());child.kill('SIGTERM');const [code]=await once(child,'close');assert.equal(code,143)
    assert.throws(()=>process.kill(psqlPid,0),error=>error?.code==='ESRCH')
    assert.deepEqual((await readdir(applyTmp)).filter(name=>name.startsWith('opendart-apply-')),[])
  } finally {await rm(root,{recursive:true,force:true})}
})
