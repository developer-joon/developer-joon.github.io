# Company benefits research methodology

## Current state

The population protocol is **DRAFT / BLOCKED**, not frozen or approved. No eligible, selected, effective-selected or manifest file exists. The numbers 1,000 domestic and 1,000 international are targets only; an empty ledger must never be presented as a completed selection.

Selection and writing order are deterministic editorial processing orders, not revenue rankings. The international panel is fixed but does not represent the world or all large employers. Every incomplete national source path is published as a `coverage_gap` rather than silently omitted.

## Source registry contract

`source-registry.jsonl` is the machine-readable authority for source access decisions. Every record names the official owner, source type, jurisdiction, exact URL, key/login/fee model, terms location, extraction/quotation/retention/snapshot/attribution decisions, supported fields, evidence eligibility, check timestamp, HTTP observation and current blocker.

A source is usable as evidence only when it supports the exact field, the intended access is lawful, every extraction/quotation/retention/snapshot/attribution decision is resolved and compatible, and `current_blocker` is null. Public visibility alone is not a bulk-use or republication licence. Unknown, restricted, fee-only or contractual sources remain ineligible until the blocker is resolved. Search results, editorial lists and commercial lists are discovery-only: they cannot establish identity, scale, inclusion or a benefit claim.

Raw responses, filings and bulk archives stay out of Git. A future authorized acquisition must store them in controlled external storage with request parameters, retrieval timestamp, response metadata and SHA-256. Git retains only normalized records, short lawful quotes, locators and permitted metadata.

## Candidate and scale sources by jurisdiction

The links below are official owner pages recorded directly in the registry; no numbered citation is claimed without a claim ledger.

### Korea (domestic)

- Financial Supervisory Service [OpenDART corporation-code guide](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018) provides filer identifiers and names but requires a user-owned API key.
- Korea Fair Trade Commission [business-group affiliate API](https://www.data.go.kr/data/15091891/openapi.do) provides group and affiliate identifiers through a data.go.kr service key.
- Ministry of Economy and Finance / ALIO [public institution API](https://www.data.go.kr/data/15125287/openapi.do) supplies institution codes and classifications through a service key.
- Cleaneye [local public-enterprise API](https://www.data.go.kr/data/15057730/openapi.do) provides management/financial fields through a service key; legacy name-only joins need explicit treatment.

The domestic official-list union cannot be acquired in this environment without user-owned keys, so it is not materialized.

### Americas

- **United States:** SEC [EDGAR APIs and bulk archives](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) provide CIK, submissions and XBRL facts without authentication. Complete acquisition and fair-access scheduling remain undone.
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

1. Classify by the employing legal entity's incorporation and registered head office, not brand or ultimate parent.
2. Join only with a canonical official registry identifier. Missing registry IDs fail; names cannot silently substitute.
3. Apply the financial/non-financial threshold and 24-calendar-month fiscal-age limit. Future fiscal year ends fail. Public entities use the same threshold.
4. Preserve original metric, currency, fiscal year and consolidated/standalone scope. The protocol fixes the World Bank `PA.NUS.FCR` annual conversion rule for non-USD international values.
5. Materialize and checksum complete official-list unions outside Git, then normalize eligible records.
6. Use the highest available source class in the pinned precedence order. A lower class requires structured checks and reasons proving every higher class unavailable.
7. Only after completeness validation may canonical SHA-256 ordering select exactly 1,000 per scope. If fewer qualify, stop; never lower a threshold silently.
8. Freeze protocol and ledger hashes only after explicit approval. Approval requires a reviewed code commit adding exactly one `APPROVED_FREEZE_ANCHORS` entry from the immutable protocol version to the reviewed freeze-manifest SHA-256. The production map is intentionally empty while this protocol is blocked. An approved protocol version is immutable forever; any change requires a new version and a new reviewed anchor. Thereafter, immutable selection changes only through append-only exclusion/replacement events and approved effective hashes.

## Benefit evidence

Grade A is a lawfully public official policy, benefits/careers page, annual/sustainability report, handbook, plan, collective agreement or government disclosure. Grade B is a lawfully public official job posting, jurisdiction/entity guide, recruiting presentation or press release. Grade C and discovery sources cannot confirm claims.

Confirmed, limited, past and name-only records require at least one directly applicable A/B source. Every benefit source must support `benefit_claim`, match the company jurisdiction, name the selected employer in `applicable_legal_entities`, and match the recorded benefit policy owner. An `INT` official policy is accepted only with an explicit ISO-country-to-legal-entity mapping; wildcards are prohibited. Conflict requires two distinct conflicting A/B sources, explicit `supports` and `contradicts` propositions, distinct quotes and distinct content hashes. Each record carries the employing legal entity, policy owner, countries, roles, employment types, tenure condition, source locator, short supporting quote, publication/check dates and content SHA-256.

A claim explicitly records `current`, `undated_current` or `historical` validity. A dated current claim must be within 24 calendar months and cannot have a future publication date. `undated_current` requires a null publication date and a check within 30 days. Older official evidence is allowed only for a `past` claim labeled `historical`. For every source, causal timestamps must satisfy source document publication date (when present) ≤ retrieval ≤ source check ≤ claim research ≤ independent review ≤ prepublication check ≤ validation/render `as_of`. Community publication is not the source document publication date. Every core URL must be rechecked within 14 days before publication. Rendering re-runs these rules against the render date (current UTC date unless `--as-of` is supplied), never the population cutoff. `확인 불가` is a non-claim research result listing searched official source IDs; it means public official evidence was not found, not that a benefit is absent.

The immutable freeze manifest hashes only the protocol, eligible ledgers and selected ledgers. The effective manifest separately hashes the append-only replacement events and current effective projections and references the freeze-manifest SHA-256. Replacement replay must never rewrite the freeze manifest.

## Review, rendering and corrections

The original researcher cannot approve their own claim. An independent reviewer records claim ID, entailment/applicability decision, stale or overgeneralization findings, conflicts, resolution and timestamp. Conflict review must record a determination (`resolved_supports`, `resolved_contradicts`, or `unresolved`); unresolved wording needs explicit reviewer approval.

The protocol cutoff is inclusively fixed at `2026-10-29T23:59:59+09:00` in the `Asia/Seoul` civil timezone. Records or evidence events after that instant are outside this protocol snapshot; changing the instant, offset, timezone interpretation, or inclusive semantics requires a new pinned protocol version and code review.

The renderer accepts only an explicitly approved protocol and complete 25-company batches with complete claim/source references. It emits deterministic bytes, labels output as draft, states that writing order is not rank, explains `확인 불가`, and warns against posting private/confidential or personal information.

Corrections are append-only events and must be reverified against public official sources. Private documents, personal data, payroll/insurance/health records, credentials and contractually confidential material are never copied into the research ledger.
