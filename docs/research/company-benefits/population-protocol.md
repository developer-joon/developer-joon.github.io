# Company benefits population protocol — version 3.1.0 frozen population

**Status: APPROVED for the user-authorized population freeze. Independent technical review remains pending.**

This freeze contains 1,000 domestic and 1,000 international selected reporting legal entities. Canonical hash order is an editorial processing order, not a revenue rank, source rank, complete market census, probability sample, or claim of global representativeness.

## Materialized scope

- **Domestic:** 1,350 eligible Korean reporting legal entities were built from official, keyless DART/OpenDART bulk downloads. The first 1,000 in canonical SHA-256 order are selected.
- **International:** 1,066 eligible strict-US entities were built from official SEC quarterly Financial Statement Data Sets and primary Form 10-K workforce evidence. Every row requires `countryinc=US` and `countryba=US` evidence bound to the same accession, CIK and legal name as scale and workforce evidence. The first 1,000 in canonical SHA-256 order are selected; exactly 66 unused canonical records remain for replacement.
- The fixed international panel remains US, CA, MX, BR, AR, GB, FR, DE, IT, TR, RU, AU, CN, IN, ID, JP, SA and ZA. The current selected international population contains only US-incorporated, US principal-business-address SEC 10-K filers. It is not globally representative and is not all SEC filers. The other 17 panel jurisdictions are explicit coverage gaps with zero selected entities; see `population/international-coverage-gaps.json`.

## Legal entity and thresholds

The selected unit is the reporting legal entity. Positive workforce evidence establishes population eligibility, not the payroll employer, parent/subsidiary relationship, benefit-policy owner, or benefit scope. Those roles remain structured unknowns until separately evidenced.

- Domestic non-financial: annual revenue at least KRW 100 billion.
- Domestic financial: year-end total assets at least KRW 10 trillion.
- International non-financial: annual revenue at least USD 1 billion.
- International financial: year-end total assets at least USD 10 billion.
- Fiscal period end must be no more than 24 months before cutoff.
- Positive official workforce evidence is required for the same registry ID and legal name. Its actual evidence date is preserved and may differ from the financial fiscal period.

Every row retains structured scale and employer evidence: official source ID and URL, exact locator, observed or retained artifact SHA-256, retrieval and filing dates, registry ID, legal name, fiscal period, metric/value/currency or employee count/quote as applicable. Missing or mismatched row evidence fails verification.

## Sources actually exercised

Korean identity uses the DART company-overview bulk Excel family at `https://dart.fss.or.kr/dsae001/downloadExcel.do`. Korean scale and employee evidence use the official OpenDART financial and periodic-report Excel download families. They do not use the API-key corporation-code guide.

US scale evidence retains each actual SEC quarterly archive URL, archive hash and `num.txt` locator. Incorporation and principal-business-address assertions separately retain SEC `sub.txt` `countryinc/stprinc` and `countryba/stprba` fields; filing venue is never treated as jurisdiction evidence. Employer evidence retains each primary EDGAR filing URL, filing hash, bounded quote and exact normalized-text or Inline XBRL locator.

## Canonical selection and immutable state

Canonical values are `[protocol_seed, jurisdiction, registry_id, legal_name]`, normalized and serialized exactly as defined in `population-protocol.json`. Eligible ledgers are sorted by SHA-256 plus canonical-byte collision tie-break; selected ledgers are the first 1,000 records in each scope.

The freeze manifest hashes the exact bytes of the protocol, eligible ledgers, selected ledgers, structured coverage-gap artifact, compact source-artifact manifest, row bindings, all 167 compact independent workforce reviews, and the acquisition-audit manifest that pins the external audit chain. Initial-effective ledgers are byte-identical to selected ledgers. The effective manifest hashes current effective ledgers and the empty event ledger and references the freeze-manifest digest. Future exclusions require append-only events and the next unused eligible canonical record.

## Benefits research state

This commit freezes the population only. `benefit-claims.jsonl`, `reviews.jsonl` and `corrections.jsonl` are empty. No benefit claim or 25-company editorial draft is complete. Draft rendering fails closed until every company in the requested batch has reviewed claims.

## Approval basis

The user authorized full implementation and scope. Production verification and rendering additionally require an external freeze-anchor receipt. The session receipt is `review_pending`; it binds candidate bytes but does not claim independent approval. The committed schema and template contain no self-authorizing digest. Any technical approval or publication decision requires subsequent independent review.
