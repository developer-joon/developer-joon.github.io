import { deflateRawSync } from 'node:zlib'

const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function canonicalCorpCodeXml() {
  return Buffer.from('<?xml version="1.0" encoding="UTF-8"?><result><list><corp_code>00123456</corp_code><corp_name>Alpha</corp_name><corp_eng_name>ALPHA INC.</corp_eng_name><stock_code>123456</stock_code><modify_date>20261122</modify_date></list></result>')
}

export function buildZip(memberBytes, { method = 8 } = {}) {
  const name = Buffer.from('CORPCODE.xml')
  const body = method === 8 ? deflateRawSync(memberBytes) : Buffer.from(memberBytes)
  const crc = crc32(memberBytes)
  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(memberBytes.length, 22)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(0x0314, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(memberBytes.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE((0o100600 << 16) >>> 0, 38)
  name.copy(central, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length + body.length, 16)
  return Buffer.concat([local, body, central, eocd])
}

function locate(zip) {
  const eocd = zip.length - 22
  return { eocd, central: zip.readUInt32LE(eocd + 16) }
}

function mutate(zip, fn) {
  const copy = Buffer.from(zip)
  fn(copy, locate(copy))
  return copy
}

export function zipContractCorpus(xml = canonicalCorpCodeXml()) {
  const canonical = buildZip(xml)
  const { central, eocd } = locate(canonical)
  const padding = Buffer.from([0x50])
  const padded = Buffer.concat([canonical.subarray(0, central), padding, canonical.subarray(central)])
  padded.writeUInt32LE(central + padding.length, eocd + padding.length + 16)
  return [
    { name: 'canonical deflate', accept: true, bytes: canonical },
    { name: 'canonical stored', accept: true, bytes: buildZip(xml, { method: 0 }) },
    { name: 'padding before central directory', accept: false, bytes: padded },
    { name: 'local compressed size mismatch', accept: false, bytes: mutate(canonical, b => b.writeUInt32LE(b.readUInt32LE(18) + 1, 18)) },
    { name: 'local uncompressed size mismatch', accept: false, bytes: mutate(canonical, b => b.writeUInt32LE(b.readUInt32LE(22) + 1, 22)) },
    { name: 'local CRC mismatch', accept: false, bytes: mutate(canonical, b => b.writeUInt32LE(b.readUInt32LE(14) ^ 1, 14)) },
    { name: 'central CRC mismatch', accept: false, bytes: mutate(canonical, (b, p) => b.writeUInt32LE(b.readUInt32LE(p.central + 16) ^ 1, p.central + 16)) },
    { name: 'EOCD disk number', accept: false, bytes: mutate(canonical, (b, p) => b.writeUInt16LE(1, p.eocd + 4)) },
    { name: 'central directory disk number', accept: false, bytes: mutate(canonical, (b, p) => b.writeUInt16LE(1, p.eocd + 6)) },
    { name: 'central member disk start', accept: false, bytes: mutate(canonical, (b, p) => b.writeUInt16LE(1, p.central + 34)) },
    { name: 'data descriptor flag', accept: false, bytes: mutate(canonical, (b, p) => { b.writeUInt16LE(8, 6); b.writeUInt16LE(8, p.central + 8) }) },
    { name: 'local version mismatch', accept: false, bytes: mutate(canonical, b => b.writeUInt16LE(45, 4)) },
    { name: 'central version needed mismatch', accept: false, bytes: mutate(canonical, (b, p) => b.writeUInt16LE(45, p.central + 6)) },
    { name: 'unsupported creator version', accept: false, bytes: mutate(canonical, (b, p) => b.writeUInt16LE(0x0014, p.central + 4)) },
    { name: 'symlink mode', accept: false, bytes: mutate(canonical, (b, p) => b.writeUInt32LE((0o120777 << 16) >>> 0, p.central + 38)) },
    { name: 'trailing bytes after EOCD', accept: false, bytes: Buffer.concat([canonical, Buffer.from([0])]) },
  ]
}
