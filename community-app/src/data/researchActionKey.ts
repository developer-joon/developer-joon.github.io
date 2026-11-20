import casefoldOverrides from './researchCasefold16.json' with { type: 'json' }

// Python 3.14 / Unicode 16: regenerated with
// {chr(i): chr(i).casefold() for i in range(0x110000) if chr(i).casefold() != chr(i).lower()}
// Python str.split(None) includes U+001C..001F and U+0085; JS \s includes U+FEFF instead.
// eslint-disable-next-line no-control-regex -- Python's whitespace contract intentionally includes C0 separators.
const pythonWhitespace = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u
// Node 24 Unicode 17 assigns these 42 marks (and NFKC-maps U+A7F1);
// Python 3.14 Unicode 16 treats all 43 as undecomposed starters.
// eslint-disable-next-line no-misleading-character-class -- Explicit Unicode codepoint ranges, not grapheme clusters.
const unicode16Starters = /([\ua7f1\u1acf-\u1add\u1ae0-\u1aeb\u{10efa}-\u{10efb}\u{11b60}-\u{11b67}\u{1e6e3}\u{1e6e6}\u{1e6ee}-\u{1e6ef}\u{1e6f5}])/u
const overrides: Record<string, string> = casefoldOverrides

export function researchActionKey(action: string): string {
  const collapsed = action.split(pythonWhitespace).filter(Boolean).join(' ')
  const normalized = collapsed.split(unicode16Starters).map((part, index) => index % 2 ? part : part.normalize('NFKC')).join('')
  // Per-scalar: JS whole-string lowercasing has context-sensitive final sigma; Python casefold does not.
  return Array.from(normalized, (char) => overrides[char] ?? char.toLowerCase()).join('')
}
