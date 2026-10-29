# Company benefits population protocol — version 1.1.0 frozen population

**Status: APPROVED for the user-authorized population freeze. Independent technical review remains pending.**

This freeze contains 1,000 domestic and 1,000 international employing legal entities. Canonical hash order is an editorial processing order, not a revenue rank, source rank, complete market census, probability sample, or claim of global representativeness.

## Materialized scope

- **Domestic:** 1,350 eligible Korean legal employers were built from official, keyless DART/OpenDART bulk downloads. The first 1,000 in canonical SHA-256 order are selected.
- **International:** 1,071 eligible US SEC registrant legal employers were built from official SEC quarterly Financial Statement Data Sets and primary Form 10-K employee evidence. The first 1,000 in canonical SHA-256 order are selected.
- The fixed international panel remains US, CA, MX, BR, AR, GB, FR, DE, IT, TR, RU, AU, CN, IN, ID, JP, SA and ZA. The current selected international population contains **US entities only**. The other 17 panel jurisdictions are explicit coverage gaps with zero selected entities; see `population/international-coverage-gaps.json`.

## Legal entity and thresholds

The selected unit is the employing legal entity. Financial consolidation parent, ultimate parent and benefit-policy owner remain separate roles.

- Domestic non-financial: annual revenue at least KRW 100 billion.
- Domestic financial: year-end total assets at least KRW 10 trillion.
- International non-financial: annual revenue at least USD 1 billion.
- International financial: year-end total assets at least USD 10 billion.
- Fiscal period end must be no more than 24 months before cutoff.
- Positive official employer evidence is required for the same registry ID, legal name and fiscal period.

Every row retains structured scale and employer evidence: official source ID and URL, exact locator, observed or retained artifact SHA-256, retrieval and filing dates, registry ID, legal name, fiscal period, metric/value/currency or employee count/quote as applicable. Missing or mismatched row evidence fails verification.

## Sources actually exercised

Korean identity uses the DART company-overview bulk Excel family at `https://dart.fss.or.kr/dsae001/downloadExcel.do`. Korean scale and employee evidence use the official OpenDART financial and periodic-report Excel download families. They do not use the API-key corporation-code guide.

US scale evidence retains each actual SEC quarterly archive URL, archive hash and `num.txt` locator. Employer evidence retains each primary EDGAR filing URL, filing hash, bounded quote and exact normalized-text or Inline XBRL locator.

## Canonical selection and immutable state

Canonical values are `[protocol_seed, jurisdiction, registry_id, legal_name]`, normalized and serialized exactly as defined in `population-protocol.json`. Eligible ledgers are sorted by SHA-256 plus canonical-byte collision tie-break; selected ledgers are the first 1,000 records in each scope.

The freeze manifest hashes the exact bytes of the protocol, eligible ledgers, selected ledgers and structured coverage-gap artifact. Initial-effective ledgers are byte-identical to selected ledgers. The effective manifest hashes current effective ledgers and the empty event ledger and references the freeze-manifest digest. Future exclusions require append-only events and the next unused eligible canonical record.

## Benefits research state

This commit freezes the population only. `benefit-claims.jsonl`, `reviews.jsonl` and `corrections.jsonl` are empty. No benefit claim or 25-company editorial draft is complete. Draft rendering fails closed until every company in the requested batch has reviewed claims.

## Approval basis

The user authorized full implementation and scope. The protocol, freeze manifest and effective manifest record that basis as `user-authorized implementation scope; technical review pending`; they do not invent a named human review event. Any technical approval or publication decision requires subsequent independent review.
