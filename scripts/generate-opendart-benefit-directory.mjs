#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const MAX_ZIP_BYTES = 32 * 1024 * 1024
const MAX_XML_BYTES = 64 * 1024 * 1024
const MAX_ROWS = 200_000
const MAX_RATIO = 200
const BASE = Object.freeze({ company_count: 40053, source_sha256: 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594' })
const AUTHORITY_KEYS = ['schema_version','source_edition','official_url','reuse_rights_note','source_sha256','retrieved_at']
const OFFICIAL_URL = 'https://opendart.fss.or.kr/api/corpCode.xml'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const crc32 = bytes => { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1))}return(crc^0xffffffff)>>>0 }
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))
const exactDate = value => {
  if (!/^\d{8}$/.test(value)) return false
  const year = Number(value.slice(0,4)), month = Number(value.slice(4,6)), day = Number(value.slice(6,8))
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}
const exactUtcSecond = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value)
  if (!match) return false
  const [year,month,day,hour,minute,second] = match.slice(1).map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month-1] && hour <= 23 && minute <= 59 && second <= 59
}
const bounded = (value, label, maxCodePoints, maxUtf8Bytes, optional = false) => {
  if (optional && value === '') return ''
  if (typeof value !== 'string' || value !== value.trim() || [...value].length < 1 || [...value].length > maxCodePoints || Buffer.byteLength(value,'utf8') > maxUtf8Bytes || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) throw Error(`${label} invalid`)
  return value
}

async function readNoFollow(filePath, maximum, label) {
  const absolute = path.resolve(filePath); const parts = absolute.split(path.sep).filter(Boolean); const handles = []
  try {
    let dir = await open(path.parse(absolute).root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(dir)
    for (const part of parts.slice(0,-1)) { dir = await open(`/proc/self/fd/${dir.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(dir) }
    const file = await open(`/proc/self/fd/${dir.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); handles.push(file)
    const before = await file.stat({ bigint:true })
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maximum)) throw Error(`${label} is not a regular file within byte bound`)
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0
    while (offset < bytes.length) { const read = await file.read(bytes,offset,bytes.length-offset,offset); if (!read.bytesRead) throw Error(`${label} truncated`); offset += read.bytesRead }
    const after = await file.stat({ bigint:true }); if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw Error(`${label} changed during read`)
    return bytes
  } catch (error) { if (['ELOOP','ENOTDIR'].includes(error?.code)) throw Error(`${label} unsafe symlink component`,{cause:error}); throw error }
  finally { for (const handle of handles.reverse()) await handle.close() }
}

function decodeXmlText(text, label) {
  if (/<!\[CDATA\[|&(?!(?:amp|lt|gt|quot|apos);)/u.test(text)) throw Error(`${label} contains unsupported entity or CDATA`)
  return text.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&amp;','&')
}

export function parseCorpCodeXml(bytes) {
  let text
  try { text = new TextDecoder('utf-8',{fatal:true}).decode(bytes) } catch { throw Error('CORPCODE.xml is not valid UTF-8') }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('DTD and entity declarations are forbidden')
  text = text.replace(/^\uFEFF?\s*<\?xml\s+version="1\.0"(?:\s+encoding="UTF-8")?\s*\?>\s*/i,'').trim()
  const root = text.match(/^<result>\s*([\s\S]*?)\s*<\/result>$/)
  if (!root) throw Error('unexpected CORPCODE.xml root structure')
  const rows = []; let rest = root[1]; const list = /^\s*<list>\s*<corp_code>([\s\S]*?)<\/corp_code>\s*<corp_name>([\s\S]*?)<\/corp_name>\s*<corp_eng_name>([\s\S]*?)<\/corp_eng_name>\s*<stock_code>([\s\S]*?)<\/stock_code>\s*<modify_date>([\s\S]*?)<\/modify_date>\s*<\/list>/
  while (rest.trim()) {
    const match = rest.match(list); if (!match) throw Error('unexpected CORPCODE.xml list structure')
    rows.push({ corp_code:decodeXmlText(match[1],'corp_code'), corp_name:decodeXmlText(match[2],'corp_name'), corp_eng_name:decodeXmlText(match[3],'corp_eng_name'), stock_code:decodeXmlText(match[4],'stock_code'), modify_date:decodeXmlText(match[5],'modify_date') })
    if (rows.length > MAX_ROWS) throw Error('OpenDART row ceiling exceeded')
    rest = rest.slice(match[0].length)
  }
  if (!rows.length) throw Error('CORPCODE.xml contains no list rows')
  const codes = new Set()
  for (const row of rows) {
    if (!/^\d{8}$/.test(row.corp_code) || codes.has(row.corp_code)) throw Error('invalid or duplicate corp_code')
    codes.add(row.corp_code); bounded(row.corp_name,'corp_name',200,800); bounded(row.corp_eng_name,'corp_eng_name',200,800,true)
    if (row.stock_code !== '' && !/^\d{6}$/.test(row.stock_code)) throw Error('stock_code invalid')
    if (!exactDate(row.modify_date)) throw Error('modify_date invalid')
  }
  return rows
}

export function parseCorpCodeZip(zip) {
  if (!Buffer.isBuffer(zip) || zip.length < 52 || zip.length > MAX_ZIP_BYTES) throw Error('source ZIP byte bound invalid')
  let eocd = -1
  for (let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--) if (zip.readUInt32LE(i)===0x06054b50) { eocd=i; break }
  if (eocd<0 || eocd+22+zip.readUInt16LE(eocd+20)!==zip.length) throw Error('ZIP central directory is malformed')
  const entries=zip.readUInt16LE(eocd+10), diskEntries=zip.readUInt16LE(eocd+8), centralSize=zip.readUInt32LE(eocd+12), centralOffset=zip.readUInt32LE(eocd+16)
  if (zip.readUInt16LE(eocd+4)!==0 || zip.readUInt16LE(eocd+6)!==0 || entries!==1 || diskEntries!==1 || centralOffset+centralSize!==eocd) throw Error('ZIP must be single-disk with exactly one expected member')
  const c=centralOffset; if (zip.readUInt32LE(c)!==0x02014b50) throw Error('ZIP central directory entry malformed')
  const creatorVersion=zip.readUInt16LE(c+4), neededVersion=zip.readUInt16LE(c+6), flags=zip.readUInt16LE(c+8), method=zip.readUInt16LE(c+10), expectedCrc=zip.readUInt32LE(c+16), compressed=zip.readUInt32LE(c+20), uncompressed=zip.readUInt32LE(c+24), nameLen=zip.readUInt16LE(c+28), extraLen=zip.readUInt16LE(c+30), commentLen=zip.readUInt16LE(c+32), diskStart=zip.readUInt16LE(c+34), localOffset=zip.readUInt32LE(c+42)
  if (c+46+nameLen+extraLen+commentLen!==eocd) throw Error('ZIP central directory bounds invalid')
  const nameBytes=zip.subarray(c+46,c+46+nameLen); let name
  try { name=new TextDecoder('utf-8',{fatal:true}).decode(nameBytes) } catch { throw Error('ZIP member name is not valid UTF-8') }
  if (name!=='CORPCODE.xml' || name.includes('/') || name.includes('\\')) throw Error('ZIP member name must be exact CORPCODE.xml')
  if ((flags & ~0x800)!==0) throw Error(flags & 1 ? 'encrypted ZIP member forbidden' : 'unsupported ZIP flag')
  if (![0,8].includes(method)) throw Error('unsupported ZIP compression method')
  if (uncompressed<1 || uncompressed>MAX_XML_BYTES || compressed<1 || uncompressed/compressed>MAX_RATIO) throw Error('ZIP decompression byte or ratio ceiling exceeded')
  const unixMode=(zip.readUInt32LE(c+38)>>>16)&0xffff, fileType=unixMode&0o170000
  if (creatorVersion!==0x0314 || neededVersion!==20 || diskStart!==0 || localOffset!==0 || (fileType!==0 && fileType!==0o100000)) throw Error(fileType===0o120000?'ZIP symlink member forbidden':'ZIP version, disk, offset, or mode contract invalid')
  if (zip.readUInt32LE(localOffset)!==0x04034b50) throw Error('ZIP local header malformed')
  const localVersion=zip.readUInt16LE(localOffset+4), localFlags=zip.readUInt16LE(localOffset+6), localMethod=zip.readUInt16LE(localOffset+8), ln=zip.readUInt16LE(localOffset+26), le=zip.readUInt16LE(localOffset+28)
  if (localVersion!==neededVersion || localFlags!==flags || localMethod!==method || zip.readUInt32LE(localOffset+14)!==expectedCrc || zip.readUInt32LE(localOffset+18)!==compressed || zip.readUInt32LE(localOffset+22)!==uncompressed || !zip.subarray(localOffset+30,localOffset+30+ln).equals(nameBytes)) throw Error('ZIP local/central metadata mismatch')
  const start=localOffset+30+ln+le; if (start+compressed!==centralOffset) throw Error('ZIP member data must end exactly at central directory')
  const payload=zip.subarray(start,start+compressed); let xml
  try { xml=method===0?Buffer.from(payload):inflateRawSync(payload,{maxOutputLength:MAX_XML_BYTES}) } catch (error) { throw Error('ZIP deflate stream invalid',{cause:error}) }
  if (xml.length!==uncompressed || crc32(xml)!==expectedCrc) throw Error('ZIP uncompressed size or CRC mismatch')
  return parseCorpCodeXml(xml)
}

function domainHash(domain, edition, code) { return sha(Buffer.concat([Buffer.from(domain+'\0'),Buffer.from(String(Buffer.byteLength(edition))+':'+edition+'\0'+code)])) }
function companyId(edition, code) { return `KR-CAN-${domainHash('benefit-directory-opendart-company-v1',edition,code).slice(0,32)}` }
function identifierUuid(edition, code) { const b=Buffer.from(domainHash('benefit-directory-opendart-identifier-v1',edition,code).slice(0,32),'hex'); b[6]=(b[6]&15)|0x50; b[8]=(b[8]&63)|0x80; const h=b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}` }
const jsonLines = rows => Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n')
const requireMetadata = options => {
  bounded(options.edition,'edition',100,400); bounded(options.retrievedAt,'retrieved-at',64,256); if (!exactUtcSecond(options.retrievedAt)) throw Error('retrieved-at invalid')
  bounded(options.sourceUrl,'source URL',500,2000); const url=new URL(options.sourceUrl); if (url.protocol!=='https:') throw Error('source URL must use https')
  bounded(options.reuseRights,'reuse-rights',1000,4000)
}

export function validateOpenDartAuthority(authority, sourceBytes) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority) || Object.keys(authority).sort().join('\0') !== [...AUTHORITY_KEYS].sort().join('\0')) throw Error('authority descriptor exact shape invalid')
  if (authority.schema_version !== 'benefit-directory-opendart-authority-v1') throw Error('authority descriptor schema version invalid')
  bounded(authority.source_edition,'authority source edition',100,400)
  bounded(authority.official_url,'authority official URL',500,2000)
  if (authority.official_url !== OFFICIAL_URL) throw Error('authority official URL is not allowlisted')
  bounded(authority.reuse_rights_note,'authority reuse rights note',1000,4000)
  if (!/^[0-9a-f]{64}$/.test(authority.source_sha256) || authority.source_sha256 !== sha(sourceBytes)) throw Error('authority source sha256 mismatch')
  bounded(authority.retrieved_at,'authority retrieval timestamp',64,256)
  if (!exactUtcSecond(authority.retrieved_at)) throw Error('authority retrieval timestamp invalid')
  return Object.freeze({...authority})
}

async function readAuthority(authorityFile, sourceBytes) {
  if (!authorityFile) throw Error('--authority is required')
  const bytes=await readNoFollow(authorityFile,16*1024,'OpenDART authority descriptor')
  let authority
  try { authority=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) } catch { throw Error('authority descriptor JSON invalid') }
  return validateOpenDartAuthority(authority,sourceBytes)
}

export function buildOpenDartBundle(sourceBytes, options={}) {
  const authority=options.schema_version==='benefit-directory-opendart-authority-v1'?validateOpenDartAuthority(options,sourceBytes):null
  if(authority) options={edition:authority.source_edition,retrievedAt:authority.retrieved_at,sourceUrl:authority.official_url,reuseRights:authority.reuse_rights_note}
  requireMetadata(options); const sourceRows=parseCorpCodeZip(sourceBytes); const ids=new Set(); const identifierIds=new Set()
  const joined=sourceRows.map(row=>{
    const id=companyId(options.edition,row.corp_code), identifierId=identifierUuid(options.edition,row.corp_code)
    if (ids.has(id)||identifierIds.has(identifierId)) throw Error('deterministic identifier collision'); ids.add(id); identifierIds.add(identifierId)
    const aliases=row.corp_eng_name && row.corp_eng_name!==row.corp_name ? [row.corp_eng_name] : []
    return { code:row.corp_code, company:{ company_id:id, identity_class:'legal_corporation', display_name:row.corp_name, normalized_name:row.corp_name.toLowerCase(), industry:null, size_class:'unclassified', region:null, summary:null, is_searchable:true, source_edition:options.edition, provenance:{ source:'OpenDART corpCode', source_sha256:sha(sourceBytes), corp_modify_date:row.modify_date, stock_code:row.stock_code||null, aliases } }, identifier:{ identifier_id:identifierId, company_id:id, identifier_type:'opendart_corp_code', identifier_digest_or_value:row.corp_code, source_edition:options.edition, verified_at:options.retrievedAt } }
  }).sort((a,b)=>compare(a.code,b.code))
  const companies=joined.map(x=>x.company), identifiers=joined.map(x=>x.identifier), companiesNdjson=jsonLines(companies), identifiersNdjson=jsonLines(identifiers)
  const ordered=Buffer.from(joined.map(x=>`${x.code}\0${x.company.company_id}\n`).join(''))
  const manifest={ schema_version:'benefit-directory-opendart-v1', ...(authority?{authority}:{}), source:{ sha256:sha(sourceBytes), byte_count:sourceBytes.length, edition:options.edition, retrieved_at:options.retrievedAt, row_count:sourceRows.length, url:options.sourceUrl, reuse_rights:options.reuseRights, member:'CORPCODE.xml' }, company_count:companies.length, identifier_count:identifiers.length, ordered_code_company_sha256:sha(ordered), outputs:{ companies:{ path:'companies.ndjson', byte_count:companiesNdjson.length, sha256:sha(companiesNdjson) }, identifiers:{ path:'identifiers.ndjson', byte_count:identifiersNdjson.length, sha256:sha(identifiersNdjson) } }, base_seed_preservation:BASE, generation_contract:{ ordering:'UTF-8 byte order of corp_code', company_id:'SHA-256 domain benefit-directory-opendart-company-v1 over length-framed edition and corp_code; first 32 lowercase hex; collision checked', identifier_id:'RFC 4122-shaped deterministic UUID from separate SHA-256 domain; collision checked', line_format:'canonical JSON key insertion order, one record per LF-terminated line' } }
  return { manifest, companies, identifiers, companiesNdjson, identifiersNdjson, manifestBytes:Buffer.from(JSON.stringify(manifest)+'\n') }
}

async function writeSynced(file, bytes) { const h=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600); try { await h.writeFile(bytes); await h.sync() } finally { await h.close() } }
async function compareTracked(destination,built) {
  let inventory; try { inventory=(await readdir(destination)).sort() } catch (error) { if(error?.code==='ENOENT') throw Error('production bundle is absent; generate only from an authentic official source'); throw error }
  if (inventory.join(',')!=='companies.ndjson,identifiers.ndjson,manifest.json') throw Error('tracked OpenDART bundle inventory differs')
  const actual=await Promise.all([readNoFollow(path.join(destination,'manifest.json'),128*1024,'tracked manifest'),readNoFollow(path.join(destination,'companies.ndjson'),128*1024*1024,'tracked companies'),readNoFollow(path.join(destination,'identifiers.ndjson'),128*1024*1024,'tracked identifiers')])
  if(!actual[0].equals(built.manifestBytes)||!actual[1].equals(built.companiesNdjson)||!actual[2].equals(built.identifiersNdjson)) throw Error('tracked OpenDART bundle differs from source authority')
}

export async function generateOpenDartBundle({sourceFile,authorityFile,outputDir,check=false,testOnly}={}) {
  if(!sourceFile||!outputDir) throw Error('sourceFile and outputDir are required'); const sourceBytes=await readNoFollow(sourceFile,MAX_ZIP_BYTES,'OpenDART source'); const authority=await readAuthority(authorityFile,sourceBytes); const built=buildOpenDartBundle(sourceBytes,authority); const destination=path.resolve(outputDir)
  if(check){ await compareTracked(destination,built); return built }
  const parent=path.dirname(destination), stat=await lstat(parent); if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o022)!==0) throw Error('output parent must be pre-existing, caller-owned, non-symlink, and not group/world writable')
  const lockPath=`${destination}.generate.lock`; let lock
  try { lock=await open(lockPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600) } catch(error){ if(error?.code==='EEXIST') throw Error('OpenDART generation lock is held'); throw error }
  let stage=null,stageOwned=false,backupContainer=null,backupOwned=false,retainBackup=false
  try {
    stage=await mkdtemp(path.join(parent,'.opendart-stage-')); stageOwned=true; await chmod(stage,0o700)
    await writeSynced(path.join(stage,'manifest.json'),built.manifestBytes); await writeSynced(path.join(stage,'companies.ndjson'),built.companiesNdjson); await writeSynced(path.join(stage,'identifiers.ndjson'),built.identifiersNdjson)
    const dh=await open(stage,constants.O_RDONLY|constants.O_DIRECTORY); await dh.sync(); await dh.close()
    backupContainer=await mkdtemp(path.join(parent,'.opendart-previous-')); backupOwned=true; await chmod(backupContainer,0o700)
    const backup=path.join(backupContainer,'bundle'); let oldMoved=false,stageInstalled=false
    try {
      try { await rename(destination,backup); oldMoved=true } catch(error){ if(error?.code!=='ENOENT') throw error }
      if(testOnly?.beforeInstall) await testOnly.beforeInstall()
      await rename(stage,destination); stageInstalled=true; stage=null; stageOwned=false
    } catch(error) {
      if(oldMoved&&!stageInstalled) {
        let destinationAbsent=false
        try { await lstat(destination) } catch(destinationError) { if(destinationError?.code==='ENOENT') destinationAbsent=true }
        if(destinationAbsent) {
          try { await rename(backup,destination); oldMoved=false }
          catch { retainBackup=true; throw Error(`OpenDART bundle install failed; automatic restore failed; preserved prior bundle at ${path.basename(backupContainer)}/bundle`) }
        } else {
          retainBackup=true
          throw Error(`OpenDART bundle install failed; automatic restore failed; preserved prior bundle at ${path.basename(backupContainer)}/bundle`)
        }
      }
      throw error
    }
    try {
      if(testOnly?.injectBackupCleanupFailure) await testOnly.injectBackupCleanupFailure()
      await rm(backupContainer,{recursive:true,force:true}); backupContainer=null; backupOwned=false
    } catch {
      retainBackup=true
      console.warn(`OpenDART bundle committed; stale backup remains at ${path.basename(backupContainer)}/bundle and may be removed after verification`)
    }
    return built
  } finally {
    if(stageOwned&&stage!==null) await rm(stage,{recursive:true,force:true})
    if(backupOwned&&backupContainer!==null&&!retainBackup) await rm(backupContainer,{recursive:true,force:true})
    await lock.close(); await rm(lockPath,{force:true})
  }
}

function cliArgs(args){ const result={check:false}; for(let i=0;i<args.length;i++){ const arg=args[i]; if(arg==='--check') result.check=true; else if(['--source','--authority','--output'].includes(arg)){ if(!args[i+1]) throw Error(`missing value for ${arg}`); result[arg.slice(2)]=args[++i] } else throw Error('unknown argument '+arg) } return result }
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const a=cliArgs(process.argv.slice(2)); for(const k of ['source','authority']) if(!a[k]) throw Error(`--${k} is required`)
  const repo=path.resolve(import.meta.dirname,'..'); const result=await generateOpenDartBundle({sourceFile:a.source,authorityFile:a.authority,outputDir:a.output??path.join(repo,'supabase/fixtures/benefit-directory-opendart'),check:a.check})
  console.log(`OpenDART bundle ${a.check?'checked':'generated'}: ${result.manifest.company_count} companies; source sha256 ${result.manifest.source.sha256}`)
}
