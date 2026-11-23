const q = JSON.stringify

export function authorityJsonMutationCorpus(authority) {
  const fields = {
    schema_version: q(authority.schema_version),
    source_edition: q(authority.source_edition),
    official_url: q(authority.official_url),
    reuse_rights_note: q(authority.reuse_rights_note),
    source_sha256: q(authority.source_sha256),
    retrieved_at: q(authority.retrieved_at),
  }
  const object = entries => `{${entries.join(',')}}`
  const canonicalEntries = Object.entries(fields).map(([key, value]) => `${q(key)}:${value}`)
  const withReplacement = (key, replacement) => object(canonicalEntries.map(entry => entry.startsWith(`${q(key)}:`) ? replacement : entry))
  const duplicate = (key, first, second, secondKeyLiteral = q(key)) => object([
    ...canonicalEntries.filter(entry => !entry.startsWith(`${q(key)}:`)),
    `${q(key)}:${q(first)}`,
    `${secondKeyLiteral}:${q(second)}`,
  ])

  return [
    { name: 'source_edition forged then valid', text: duplicate('source_edition', 'forged', authority.source_edition) },
    { name: 'source_edition valid then forged', text: duplicate('source_edition', authority.source_edition, 'forged') },
    { name: 'official_url forged then valid', text: duplicate('official_url', 'https://attacker.example/corpCode.xml', authority.official_url) },
    { name: 'official_url valid then forged', text: duplicate('official_url', authority.official_url, 'https://attacker.example/corpCode.xml') },
    { name: 'escaped-equivalent key', text: duplicate('source_edition', 'forged', authority.source_edition, '"source_\\u0065dition"') },
    { name: 'nested object duplicate', text: withReplacement('source_edition', '"source_edition":{"future":{"key":1,"key":2}}') },
    { name: 'nested array object duplicate', text: withReplacement('reuse_rights_note', '"reuse_rights_note":[{"key":1,"key":2}]') },
    { name: 'depth bound', text: withReplacement('source_edition', `"source_edition":${'['.repeat(80)}"x"${']'.repeat(80)}`), expected: /depth/i },
    { name: 'key count bound', text: withReplacement('source_edition', `"source_edition":${object(Array.from({ length: 1100 }, (_, index) => `${q(`k${index}`)}:0`))}`), expected: /key/i },
    { name: 'string length bound', text: withReplacement('source_edition', `"source_edition":${q('x'.repeat(5000))}`), expected: /string/i },
  ]
}
