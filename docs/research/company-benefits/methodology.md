# Company benefits research methodology

## Current state

Population protocol 4.0.0 is a new freeze with 1,037 domestic and 1,060 international eligible records and exactly 1,000 selected records per scope. Eligibility requires official reporting-entity or stated consolidated `employee_count >= 100`; this is not guaranteed payroll headcount. Missing or ambiguous counts fail. Entities officially evidenced as closed, dissolved, liquidation-complete, or merged out on or before cutoff are excluded even if a stale source says `active`; delisting alone is not closure. The selected international set remains strict US-incorporated and US principal-business-address SEC 10-K filers, not all SEC filers. The other 17 fixed-panel jurisdictions remain structured coverage gaps. The new external receipt is review-pending and does not authorize the freeze.

한국어 요약: 동일한 공식 근거 경계의 보고 법인 또는 명시된 연결 인원수가 100명 미만이면 제외하며, 인원수가 없거나 모호해도 탈락한다. 이 수치는 급여대장상 인원수를 보장하지 않는다. 기준일 이전의 폐업·해산·청산완료·합병소멸 공식 근거는 오래된 `active` 표시보다 우선하지만, 상장폐지만으로 폐업으로 보지 않는다.

Selection and writing order are deterministic editorial processing orders, not revenue rankings. The international panel is fixed, but the selected US-only cohort is not globally representative and does not represent all SEC filers or all large employers. Every incomplete national source path is published as a `coverage_gap` rather than silently omitted.

## Source registry contract

`source-registry.jsonl` is the machine-readable authority for source access decisions. Every record names the official owner, source type, jurisdiction, exact URL, key/login/fee model, terms location, extraction/quotation/retention/snapshot/attribution decisions, supported fields, evidence eligibility, check timestamp, HTTP observation and current blocker.

A source is usable as evidence only when it supports the exact field, the intended access is lawful, every extraction/quotation/retention/snapshot/attribution decision is resolved and compatible, and `current_blocker` is null. Public visibility alone is not a bulk-use or republication licence. Unknown, restricted, fee-only or contractual sources remain ineligible until the blocker is resolved. Search results, editorial lists and commercial lists are discovery-only: they cannot establish identity, scale, inclusion or a benefit claim.

Raw responses, filings and bulk archives stay out of Git. They are retained in controlled external storage. Git commits compact source-artifact manifests that separately identify official acquisition artifacts and derived ledgers, plus row bindings to the exact official archive or filing.

## Candidate and scale sources by jurisdiction

The links below are official owner pages recorded directly in the registry; no numbered citation is claimed without a claim ledger.

### Korea (domestic)

- Financial Supervisory Service [OpenDART corporation-code guide](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018) provides filer identifiers and names but requires a user-owned API key.
- Korea Fair Trade Commission [business-group affiliate API](https://www.data.go.kr/data/15091891/openapi.do) provides group and affiliate identifiers through a data.go.kr service key.
- Ministry of Economy and Finance / ALIO [public institution API](https://www.data.go.kr/data/15125287/openapi.do) supplies institution codes and classifications through a service key.
- Cleaneye [local public-enterprise API](https://www.data.go.kr/data/15057730/openapi.do) provides management/financial fields through a service key; legacy name-only joins need explicit treatment.

The frozen Korean population was materialized from the keyless DART company-overview workbook, OpenDART 2024 BS and PL ZIP archives, and the periodic-report employee workbook. The API-key sources above remain documented coverage paths but were not used for the frozen rows.

### Americas

- **United States:** SEC [EDGAR APIs and bulk archives](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) supplied the materialized 2025 Q1–2026 Q3 quarterly financial archives and exact retained Form 10-K filing evidence. The committed manifest binds each row to those official bytes; 2026 Q4 was unavailable at acquisition time.
- **Canada:** CSA [SEDAR+ filing FAQ](https://systems.securities-administrators.ca/onlinehelp/faqs/general-faqs-about-filings/) confirms a Data Distribution Service. Bulk use is licensed; public provincial issuer lists are not a complete national financial bulk substitute.
- **Mexico:** CNBV [XBRL viewer](https://xbrl.cnbv.gob.mx/visorXbrl.html?v=1.0.3) exposes official filings, but the observed bulk endpoints are undocumented and reuse/retention terms are unresolved.
- **Brazil:** CVM [open-company registration data](https://dados.cvm.gov.br/dataset/cia_aberta-cad) and official filing archives can support CNPJ-based joins. The complete CNPJ/CVM population and scale join is not materialized.
- **Argentina:** CNV [company portal](https://www.cnv.gov.ar/SitioWeb/Empresas) exposes CUIT/CNV identities and financial workbooks. Its observed bulk-like endpoints are undocumented and reuse terms require confirmation.

### Europe

- **United Kingdom:** [Companies House data products](https://www.gov.uk/guidance/companies-house-data-products) publish company and accounts bulk files. Complete joining and threshold validation remain undone.
- **France:** INPI [RNE API access](https://data.inpi.fr/content/editorial/Acces_API_Entreprises) provides identities and non-confidential annual accounts but requires an account/credentials.
- **Germany:** [Unternehmensregister search](https://www.unternehmensregister.de/de/howto/search) is authoritative, but national entity-level financial bulk extraction is constrained by per-document access, fees/CAPTCHA and reuse conditions.
- **Italy:** CONSOB [listed-company information](https://www.consob.it/web/area-pubblica/quotate) is an official candidate source. Complete official entity-financial bulk access is contractual or paid.
- **Turkey:** KAP [company and filing pages](https://www.kap.org.tr/en/sirketler/ALL) are official and public for bounded access. Bulk/commercial reuse is not approved without terms or contract review.
- **Russia:** FNS [state accounting statements resource](https://bo.nalog.gov.ru/about) is official, while scalable subscriber access is contractual/paid and reuse is unresolved.

EU electronic-reporting rules can improve issuer document comparability, but they do not replace national legal-entity universes and do not supply complete employer populations.

### Asia-Pacific, Middle East and Africa

- **Australia:** ASIC [company dataset](https://data.gov.au/data/dataset/asic-companies) is an open identity seed with ACN/ABN, but does not contain scale financials. An approved entity-level financial join is missing.
- **China:** Shanghai Stock Exchange [XBRL company information](https://english.sse.com.cn/markets/dataservice/xbrl/companyinfo/) is official for listed issuers. Cross-exchange completeness and bulk/commercial reuse remain unresolved.
- **India:** the official [Company Master Data catalogue](https://www.data.gov.in/catalog/company-master-data) was unavailable during checking. A complete official financial join and reuse validation remain unresolved.
- **Indonesia:** IDX [financial statements and annual reports](https://idx.co.id/en/listed-companies/financial-statements-and-annual-report) is official, but no approved documented bulk/reuse path has been established.
- **Japan:** FSA [EDINET API v2 specification](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf) documents identity and XBRL filing access. Calls require a user-owned subscription key.
- **Saudi Arabia:** the Saudi Exchange [issuer directory](https://saudiexchange.sa/wps/portal/tadawul/market-participants/issuers/issuers-directory?locale=en) is official, but access verification encountered blocking and bulk/reuse approval is absent.
- **South Africa:** CIPC [disclosure forms and fees](https://www.cipc.co.za/?page_id=6125) is authoritative but fee-based; JSE [structured financial data products](https://marketdataconnect.jse.co.za/pages/Data-Shop) are commercial licensed feeds.

## Eligibility and selection

1. Classify by the selected reporting legal entity's incorporation and registered head office, not brand or ultimate parent. This does not prove the payroll employer.
2. Join only with a canonical official registry identifier. Missing registry IDs fail; names cannot silently substitute.
3. Apply the financial/non-financial threshold and 24-calendar-month fiscal-age limit. Future fiscal year ends fail. Public entities use the same threshold.
4. Preserve original metric, currency, fiscal year and consolidated/standalone scope. The protocol fixes the World Bank `PA.NUS.FCR` annual conversion rule for non-USD international values.
5. Require an unambiguous official reporting-entity workforce count of at least 100. Treat it as bounded workforce evidence, not guaranteed payroll headcount.
6. Exclude official closure, dissolution, liquidation-complete, or merged-out events effective on or before cutoff. Cessation evidence overrides stale active labels; delisting alone does not.
7. Materialize and checksum complete official-list unions outside Git, then normalize eligible records.
8. Use the highest available source class in the pinned precedence order. A lower class requires structured checks and reasons proving every higher class unavailable.
9. Only after completeness validation may canonical SHA-256 ordering select exactly 1,000 per scope. If fewer qualify, stop; never lower a threshold silently.
10. Freeze protocol and ledger hashes only after explicit authorization. Production verification and rendering require an approved external freeze-anchor receipt supplied by path or `COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT`; no repository literal authorizes its own freeze.

Population workforce evidence is explicitly scoped as `filing_entity_total` or `filing_entity_total_or_stated_workforce`. SEC statements may cover a registrant or consolidated workforce. Parent/subsidiary relationships, payroll employer, and benefit-policy owner remain unknown unless separately established. A benefit claim cannot inherit population evidence: it must bind the actual policy owner and every applicable legal entity before publication. When the frozen population owner is a structured unknown, directly applicable official claim evidence may establish the owner for that claim without mutating the company record; the source must name a nonempty owner and include both the selected reporting entity and that owner in its applicability (or the owner must be the selected entity).

## Benefit evidence

Grade A is a lawfully public official policy, benefits/careers page, annual/sustainability report, handbook, plan, collective agreement or government disclosure. Grade B is a lawfully public official job posting, jurisdiction/entity guide, recruiting presentation or press release. Grade C and discovery sources cannot confirm claims.

Confirmed, limited, past and name-only records require at least one directly applicable A/B source. Every benefit source must support `benefit_claim`, match the company jurisdiction, name every applicable legal entity in `applicable_legal_entities`, and match a known population policy owner or establish an applicable owner under the structured-unknown rule above. Anonymous owners and unrelated parent/group transfer fail. An `INT` official policy is accepted only with an explicit ISO-country-to-legal-entity mapping; wildcards are prohibited. Every evidenced claim has one bounded `source_evidence` entry per `source_ids` item, with no duplicate, omitted or extra source: source ID, evidence role, source-specific proposition, locator, exact quote and content SHA-256 are bound to that exact source-registry row. The top-level locator/quote/hash remains a primary-source compatibility projection and cannot stand in for these complete bindings. Conflict requires two distinct conflicting A/B sources and both explicit `supports` and `contradicts` positions. Each conflict side binds its exact source ID, position, proposition, source locator, supporting quote and content SHA-256 to the same source-registry record; quotes and hashes must be distinct. Each record carries the employing legal entity, policy owner, countries, roles, employment types, tenure condition, source locator, short supporting quote, publication/check dates and content SHA-256.

The approved pilot starts from 161 reusable pre-binding source records. Claim-specific legal-entity and tuple binding expands those inputs to 215 distinct source IDs referenced by the final claim/search ledgers; 196 evidenced source tuples bind the 176 evidenced claims, including separate plan-row and code-definition tuples for all 20 two-source DOL claims. The remaining 23 claims are non-claim search results. Counts are recomputed from the final ledgers rather than treating the 161 input records as a final-source total.

A claim explicitly records `current`, `undated_current` or `historical` validity. A dated current claim must be within 24 calendar months and cannot have a future publication date. `undated_current` requires a null publication date and a check within 30 days. Older official evidence is allowed only for a `past` claim labeled `historical`. For every source, causal timestamps must satisfy source document publication date (when present) ≤ retrieval ≤ source check ≤ claim research ≤ independent review ≤ prepublication check ≤ validation/render `as_of`. Community publication is not the source document publication date. Every core URL must be rechecked within 14 days before publication. Rendering re-runs these rules against the render date (current UTC date unless `--as-of` is supplied), never the population cutoff. `확인 불가` is a non-claim research result listing searched official source IDs; it means public official evidence was not found, not that a benefit is absent. Its searched official source need not identify a benefit-policy owner, but it must remain eligible, match jurisdiction, include the selected reporting entity in explicit applicability, and satisfy access, legal-decision, timing and search-scope rules; affiliate/group routes cannot substitute.

The immutable freeze manifest hashes only the protocol, eligible ledgers and selected ledgers. The effective manifest separately hashes the append-only replacement events and current effective projections and references the freeze-manifest SHA-256. Replacement replay must never rewrite the freeze manifest.

## Review, rendering and corrections

The 2,000-company series is partitioned into 80 immutable 25-company positions by `series-batches.jsonl`, directly from each effective-selected sequence. Each record binds its company-list hash, the complete effective-sequence hash, and the replacement-event-ledger hash. A replacement occupies the excluded entity's exact position with the next deterministic unused reserve; it never globally resorts the effective sequence or shifts later batch boundaries. The immutable freeze receipt continues to bind only the original freeze. Any nonempty replacement-event ledger additionally requires a distinct approved repository-external effective-selection receipt binding the freeze digest, effective manifest, both effective sequences, event ledger, and candidate effective digest; it cannot substitute for or rewrite the immutable receipt. `series-progress.json` separately records pending or approved status, company-list hashes, approval timestamps and reviewer identities. Only approved batches may have claims, reviews, explicit company gaps, URL checks, or rendered drafts. Each approved company must have at least one independently approved claim or exactly one Korean non-absence company gap with its own independently approved outcome review. Protocol-3.1.1 pilot claims, reviews, and gaps remain only as nonpublishable, byte-pinned wrappers in `series-historical-audit.jsonl`; its immutable manifest binds the exact prior order, bytes, counts, schema, source protocol, historical freeze, and provenance. The active `benefit-claims.jsonl`, `reviews.jsonl`, `series-prepublication-checks.jsonl`, and `series-research-gaps.jsonl` ledgers start empty after the protocol-4.0.0 refreeze. Later research enters only through the metadata-only package described in `series-input-contract.md` and `schema/series-input.schema.json`.

The original researcher cannot approve their own claim. An independent reviewer records claim ID, entailment/applicability decision, stale or overgeneralization findings, conflicts, resolution and timestamp. Every evidenced source tuple has exactly one `source_entailment_reviews` entry that repeats its source ID, role, proposition, locator, exact quote and content hash and sets `entailment_confirmed` to true under the reviewer's identity and timestamp. Secondary evidence is reviewed independently rather than inheriting approval from the primary tuple. For every conflict-evidence side, the reviewer separately records one non-duplicated conflict-side entailment attestation containing the same source ID, position, exact proposition, exact quote, locator and content hash, identifies themself, and sets `entailment_confirmed` to true. The verifier checks exact bindings and complete one-to-one coverage; it does not pretend to infer semantic entailment. A published `conflict` claim must have an explicit human attestation that the two bound propositions oppose each other, an `unresolved` determination consistent with that status, and explicit approval of the unresolved publication wording. A resolved determination requires the claim to leave `conflict` status.

The protocol data-eligibility cutoff is inclusively fixed at `2026-10-29T23:59:59+09:00` in the `Asia/Seoul` civil timezone. Source filings accepted after that instant are outside this population snapshot. Acquisition, protocol approval, manifest generation, and receipt issuance may truthfully occur later and are never backdated. Changing the eligibility instant, offset, timezone interpretation, or inclusive semantics requires a new pinned protocol version and code review.

The renderer accepts only an explicitly approved protocol and complete 25-company batches with complete claim/source references. It emits deterministic bytes, labels output as draft, states that writing order is not rank, explains `확인 불가`, and warns against posting private/confidential or personal information.

Corrections are append-only events and must be reverified against public official sources. Private documents, personal data, payroll/insurance/health records, credentials and contractually confidential material are never copied into the research ledger.


Protocol 4.0.0 preserves all 167 protocol-3.1.1 independent SEC workforce adjudications unchanged: 163 approvals and four rejections. That historical review boundary first leaves 1,066 rows; the new minimum-workforce predicate then removes six rows below 100, leaving 1,060 eligible entities and 60 reserves. The external corrected acquisition remains the historical 1,070-row source artifact, not a claim that all acquired rows survive the new predicate.

SEC workforce `evidence_date` is an ISO date or null, with `date_basis` equal to `explicit_quote_date` or `undated_current`. Reviewed dates are bound exactly to the employee-count clause; an undated count uses null and `undated_current`. Other dates are extracted deterministically from the bounded retained count statement; multiple unresolved dates fail acquisition. Financial fiscal periods and SEC filing dates are never substituted for workforce dates. The legacy workforce `fiscal_period_end` mirrors this workforce evidence date, including null. Domestic evidence is unchanged.

The frozen acquisition audit manifest distinguishes external byte pins from committed compact copies. Verification recomputes committed hashes and checks external hashes, CSV counts, review identities and the historical 1,740-candidate partition before applying protocol 4.0.0. External files remain under the profile cache and are required for this acquisition audit. Workforce decisions are population eligibility evidence, not benefit claims or benefit-policy approval.

The approved protocol-3.1.1 receipt remains historical and cannot authorize protocol 4.0.0. The new candidate receipt is stored outside the repository at `/home/bread/.hermes/profiles/conan/cache/company-benefits/protocol-4.0.0/freeze-anchor-receipt.json`, mode 0600, with `review_status=review_pending`. Production verification and rendering remain fail-closed until an independent reviewer approves that exact digest.
