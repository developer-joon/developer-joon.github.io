# Company benefits population protocol — DRAFT / BLOCKED

**Status: BLOCKED. This protocol is not frozen or approved. No eligible, selected, effective-selected ledger or freeze manifest exists.**

The target is a protocol-bounded editorial sample of 1,000 domestic and 1,000 international employing legal entities. A target is not an achieved count. Writing order and canonical hash order are not rankings, and the eventual international set would not be a census or representative global sample.

## Scope and legal entity rule

Domestic entities must be incorporated in Korea and have their registered head office in Korea. International entities must be incorporated and headquartered outside Korea in the fixed panel: US, Canada, Mexico, Brazil, Argentina, United Kingdom, France, Germany, Italy, Turkey, Russia, Australia, China, India, Indonesia, Japan, Saudi Arabia and South Africa.

The selected unit is the employing legal entity. The financial consolidation parent, ultimate parent and benefit-policy owner remain separate. A parent and subsidiary may both appear only if each independently meets the scale threshold and has entity-specific benefit applicability evidence.

## Scale rules

- Domestic non-financial: annual revenue at least KRW 100 billion.
- International non-financial: annual revenue at least USD 1 billion or the fixed official equivalent.
- Domestic financial: year-end total assets at least KRW 10 trillion.
- International financial: year-end total assets at least USD 10 billion or the fixed official equivalent.
- Public ownership never creates automatic eligibility.
- The fiscal year end must be no more than 24 months before cutoff.

Non-USD values retain their original value and currency. Conversion uses World Bank indicator `PA.NUS.FCR` for the statement fiscal year. Missing country-year conversion data is a rejection, not an invitation to improvise.

## Source precedence

1. Government/regulator financial filing.
2. Government or public-enterprise disclosure.
3. Publicly accessible audited company statement.

Commercial, editorial and search-result sources are discovery-only. They cannot prove identity, scale, selection or benefits.

## Canonical selection

Required values are `[protocol_seed, jurisdiction, registry_id, legal_name]`. Jurisdiction is uppercase ISO alpha-2. Strings use Unicode NFC and trimmed whitespace; internal legal-name whitespace collapses to one ASCII space. Serialize compact UTF-8 JSON with `ensure_ascii=false`, separators `(',', ':')` and `allow_nan=false`, then sort by lowercase SHA-256. Missing values fail. Hash collisions use canonical JSON bytes as the tie-break.

After a lawful freeze, immutable selected ledgers cannot change. Exclusions and replacements are append-only events, and effective-selected ledgers are deterministic projections. Each event records the previous and next effective hashes. Research stops until the next hash is approved.

## Why the protocol is blocked

Official-source research found unmet acquisition gates:

- Korea OpenDART, FTC and Cleaneye acquisition requires user-owned API/service keys.
- SEDAR+ bulk is licensed; Germany and Italy lack an approved open national entity-financial bulk path.
- Turkey, Russia and South Africa require paid, subscription or contractual data paths for scalable structured coverage.
- Several exchange interfaces do not grant or clearly document bulk/commercial reuse.
- France and Japan require user-owned account/API keys.
- Every official-list union still needs lawful acquisition, checksums, field validation and complete scale verification.

The exact jurisdiction-level gaps and gates are machine-readable in `population-protocol.json`. Until every acquisition gate is met, no file listed under `forbidden_while_blocked` may be created. Empty ledgers would be misleading and are therefore also prohibited.

## Approval gate

Only after lawful complete acquisition may a new protocol version materialize eligible ledgers, select exactly 1,000 per scope when available, initialize effective projections, calculate manifests and request explicit approval. Approval must identify the protocol and every eligible, selected and effective hash. This draft does not claim that approval.
