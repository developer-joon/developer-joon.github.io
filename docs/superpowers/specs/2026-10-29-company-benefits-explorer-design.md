# 기업 복지 탐색기 UI 설계

## 결정

검증된 기업 복지 원장을 세 개의 독립된 탐색 화면으로 제공한다.

1. `복지 히트맵`: 전체 기업과 복지 분야를 비교
2. `분야별 순위`: 특정 복지 분야에서 공식 자료로 확인된 강점을 탐색
3. `내게 맞는 복지`: 사용자가 중요하게 생각하는 생활 조건에 따라 결과를 재정렬

세 화면은 같은 데이터·필터·비교 목록을 공유한다. 한 긴 대시보드에 모든 기능을 쌓지 않고 상단 탭으로 분리한다. 기업을 선택하면 별도의 기업 상세 화면에서 적용 법인·대상·조건·공식 근거를 확인한다.

## 제품 목적

사용자가 2,000개 기업의 복지를 다음 질문으로 탐색할 수 있게 한다.

- 어떤 기업이 어떤 분야의 복지를 공식적으로 공개했는가?
- 해당 복지는 어느 국가·법인·직군·고용형태에 적용되는가?
- 육아, 건강, 성장, 주거 등 특정 분야에서 공식 근거가 강한 기업은 어디인가?
- 내 생활 조건과 우선순위에 맞는 공개 복지는 무엇인가?
- 이 정보는 언제, 어떤 공식 자료에서 확인됐는가?

이 제품은 `최고의 회사`를 판정하지 않는다. 공개자료에서 검증된 복지의 범위·구체성·최신성을 비교하는 탐색 도구다.

## 비목표

- 전체 복지 수준을 하나의 종합점수로 평가
- 공개되지 않은 복지를 없다고 판정
- 기업의 근무환경·문화·급여·고용안정성을 복지 점수에 혼합
- 직원 리뷰·댓글만으로 복지를 확정
- 사용자 개인정보나 가족·건강정보를 서버에 저장
- Community 글·댓글 데이터베이스를 복지 원장으로 사용
- 초기 버전에서 Community 데이터베이스 마이그레이션 추가

## 디자인 방향

### 이름

`근거 중심 다크 데이터 워크스페이스`

### 시각 언어

- Community의 공통 헤더·계정 영역·푸터 계약은 유지한다.
- 탐색기 본문은 짙은 네이비 작업공간과 고밀도 데이터 표면을 사용한다.
- 민트는 현재 확인된 상태와 주요 행동, 파랑은 범위 제한, 황색은 과거·명칭만 확인, 회색은 확인 불가, 적색은 상충을 뜻한다.
- 색만으로 상태를 전달하지 않고 모든 셀에 상태 문자열과 접근성 라벨을 함께 제공한다.
- 둥근 마케팅 카드 묶음이 아니라 검색·필터·표·근거 패널 중심의 실제 데이터 제품처럼 보이게 한다.
- 모든 제품 문구는 한국어를 기본으로 한다.

### 정보 밀도

- 데스크톱은 좌측 필터, 중앙 작업영역, 우측 요약 패널의 3열 구조다.
- 태블릿에서는 우측 패널을 접고 중앙 표 위에 요약 블록을 배치한다.
- 모바일에서는 필터를 drawer로 이동하고 히트맵을 가로 스크롤 표로 표시한다.
- 한 번에 최대 50개 기업만 렌더링해 2,000개 행을 DOM에 올리지 않는다.

## URL과 정적 사이트 통합

GitHub Pages의 정적 경로 제약에 맞춰 각 화면에 실제 HTML entry를 둔다.

```text
/community/benefits/                  복지 히트맵
/community/benefits/rankings/         분야별 순위
/community/benefits/fit/              내게 맞는 복지
/community/benefits/company/?id=...   기업 상세
```

동적 path parameter 대신 검증된 `id` query parameter를 사용한다. 각 entry는 동일한 React 애플리케이션을 로드하고 `App.tsx`가 정규화된 pathname을 기준으로 lazy route를 선택한다.

페이지별 `<title>`, canonical URL, description을 독립적으로 설정한다. 기존 Jekyll AJAX navigation을 거치지 않고 full-document navigation 계약을 유지한다.

## 공통 탐색 셸

### 상단 탭

- 복지 히트맵
- 분야별 순위
- 내게 맞는 복지
- 조사 기준·정정 이력

`조사 기준·정정 이력`은 기존 허브 Community 글 또는 전용 읽기 문서로 연결한다. 허브 글이 게시되기 전에는 비활성 placeholder가 아니라 로컬 방법론 문서에서 생성된 정적 설명 페이지를 제공한다.

### 공유 상태

다음 상태는 URL query에 정규화해 저장하고 탭 이동 시 유지한다.

```text
scope=all|domestic|international
q=<검색어>
categories=<허용된 카테고리 ID 목록>
statuses=<허용된 판정 상태 목록>
compare=<최대 4개 company_id>
page=<양의 정수>
```

`내게 맞는 복지`의 우선순위는 다음과 같이 별도 query에 저장한다.

```text
preset=parenting|growth|housing|health|remote|custom
weights=<허용된 카테고리별 0~5 정수>
```

- 검색어는 trim 후 최대 100자다.
- ID와 enum은 manifest에 선언된 값만 허용한다.
- 비교 기업은 최대 4개다.
- 알 수 없는 query key는 직렬화할 때 제거한다.
- query가 과도하게 길거나 잘못되면 안전한 기본값으로 복구하고 UI에 짧은 안내를 표시한다.
- 개인화 상태는 URL과 현재 브라우저 메모리에만 존재하며 계정이나 서버에 저장하지 않는다.

## 데이터 아키텍처

### 원칙

조사 원장이 source of truth다. 브라우저가 점수나 상태를 임의 추론하지 않는다. 검증된 원장에서 결정론적으로 생성한 읽기 전용 정적 artifact를 탐색기가 소비한다.

Community 게시글과 댓글은 탐색기 데이터의 source of truth가 아니다. 댓글 제보는 기존 검증 절차를 통과해 조사 원장이 갱신된 뒤 다음 artifact 버전에 반영한다.

### 정적 artifact

```text
/community/data/company-benefits/manifest.json
/community/data/company-benefits/<version>/company-index.json
/community/data/company-benefits/<version>/rankings.json
/community/data/company-benefits/<version>/details/<shard>.json
/community/data/company-benefits/<version>/methodology.json
```

`manifest.json` 최소 필드:

```text
schema_version
data_version
generated_at
protocol_hash
effective_selection_hashes
company_count
category_taxonomy
status_taxonomy
index_url
rankings_url
methodology_url
detail_shards
artifact_sha256
```

`company-index.json`은 히트맵·검색·필터에 필요한 최소 정보만 담는다.

```text
company_id
legal_name
display_name
scope
headquarters_country
industry
scale_band
fiscal_year
category_summaries
source_coverage
last_verified_at
```

상세 출처와 claim은 company ID prefix로 나눈 shard에서 지연 로딩한다. shard 수는 생성 단계에서 고정하고 manifest에 회사 ID → shard URL 매핑 또는 결정 규칙을 기록한다.

### 생성과 무결성

- artifact는 수작업으로 편집하지 않는다.
- generator는 승인된 `effective-selected` 원장과 검증된 claim/source 원장만 읽는다.
- 생성 전 원장 스키마·선정 hash·claim 근거 조건을 다시 검증한다.
- manifest는 모든 하위 artifact의 SHA-256과 record count를 가진다.
- 동일 입력은 byte-identical한 artifact를 생성해야 한다.
- 버전 경로는 immutable하다. 최신 manifest만 새 버전을 가리킨다.
- 브라우저는 manifest와 각 payload를 strict schema로 검증한다. 부분적으로 잘못된 데이터를 조용히 표시하지 않는다.

### 초기 구현 경계

- Supabase migration 없음
- 새로운 공개 RPC 없음
- 로그인 불필요
- Community 인증 세션이 만료돼도 탐색기 읽기는 영향받지 않음
- 정적 artifact 로딩 실패를 Community anonymous retry와 결합하지 않음

## 복지 분류 체계

초기 상위 카테고리는 다음으로 고정한다.

1. 휴가·근무시간
2. 육아·가족
3. 건강·보험
4. 교육·성장
5. 주거·금융
6. 이동·통근
7. 유연근무·원격근무
8. 퇴직·장기근속
9. 식사·생활편의
10. 포용·접근성

각 claim은 상위 카테고리 하나와 세부 benefit type 하나를 가진다. 같은 복지를 여러 상위 카테고리에 중복 계산하지 않는다. 검색 노출을 위한 보조 태그는 가질 수 있지만 점수에는 한 번만 반영한다.

## 상태 표현

히트맵 셀은 다음 상태 중 하나를 표시한다.

```text
확인됨
범위 제한 확인
과거 확인
명칭만 확인
확인 불가
상충
해당 없음
```

- `확인 불가`는 복지가 없다는 뜻이 아니다.
- `해당 없음`은 법적·사업적 맥락상 카테고리를 적용하지 않는다는 공식 근거가 있을 때만 사용한다.
- 한 카테고리에 여러 claim 상태가 섞이면 셀에는 가장 중요한 주의 상태와 확인된 claim 수를 함께 표시한다.
- `상충`이 있으면 확인된 claim이 함께 있어도 상충 배지를 우선 노출한다.
- 셀 선택 시 기업 상세의 해당 카테고리 section을 연다.

## 화면 1: 복지 히트맵

### 목적

2,000개 기업의 복지 공개 상태와 근거 품질을 빠르게 비교한다.

### 구성

- 검색
- 국내/해외 scope
- 업종·국가·규모 구간 필터
- 복지 카테고리 선택
- 판정 상태 필터
- 기업 비교 목록
- 50개 행 단위 페이지네이션
- 고정 기업명 열과 가로 스크롤 카테고리 열
- 우측 분야별 상위 기업 요약
- 데이터 버전·마지막 검증일 표시

### 셀 상호작용

셀은 다음 정보를 요약한다.

```text
대표 상태
확인된 claim 수
범위 제한 여부
마지막 검증일
근거 coverage
```

클릭 또는 키보드 활성화 시 기업 상세로 이동한다. hover에만 중요한 정보를 두지 않는다.

### 비교

최대 4개 기업을 비교 목록에 담을 수 있다. 비교 tray는 선택 기업의 카테고리별 상태와 적용 범위를 나란히 표시한다. 사용자가 직접 선택한 기업만 비교하며 자동으로 승자를 정하지 않는다.

## 화면 2: 분야별 순위

### 명칭 원칙

화면과 SEO 문구에서 `복지 좋은 회사 종합순위`를 사용하지 않는다. 다음 표현을 사용한다.

> 공식 공개자료로 확인된 복지 분야별 강도

### 순위 단위

사용자가 상위 카테고리 하나를 선택해야 순위가 표시된다. 기본 카테고리는 고정하지 않고 첫 진입 시 카테고리 선택을 요구하거나 URL에 명시된 카테고리를 사용한다.

### 점수 구성

카테고리별 100점은 다음 네 component로 분리한다.

```text
확인된 세부 유형 범위: 최대 35
적용 대상의 폭: 최대 30
조건·금액·기간의 구체성: 최대 20
근거의 공식성·최신성: 최대 15
```

점수는 generator가 claim 단위 규칙으로 계산하고 각 component를 함께 공개한다. 브라우저는 합산 점수를 재계산해 payload와 불일치하면 해당 순위를 표시하지 않는다.

### 평가 제외

다음 기업은 낮은 점수를 주는 대신 `평가 근거 부족`으로 분리한다.

- 해당 카테고리의 현재 A/B 근거가 없음
- 확인 가능한 적용 범위가 없음
- 상충 claim이 해결되지 않음
- freshness 기준을 충족하지 못함

따라서 확인 불가 기업이 순위 하단에서 `복지가 나쁜 기업`처럼 보이지 않는다.

### 동점

동점은 다음 순서로 정렬한다.

1. 최신성 component
2. 적용 범위 component
3. canonical company ID

이 규칙은 방법론 화면에 공개한다.

## 화면 3: 내게 맞는 복지

### 목적

사용자의 생활 상황에 따라 확인된 복지 카테고리를 재정렬한다. 취업 추천이나 고용 의사결정을 대신하지 않는다.

### 기본 preset

- 육아 중
- 커리어 성장
- 주거·이동
- 건강 관리
- 원격·유연근무
- 직접 설정

preset은 카테고리 weight 묶음일 뿐 개인 정보를 추론하지 않는다. `직접 설정`은 카테고리별 0~5 중요도를 조절한다.

### 결과 명칭

`추천 기업` 대신 `조건 일치 기업`을 사용한다.

각 결과는 다음을 설명한다.

```text
일치한 우선순위
확인된 복지 claim
적용 국가·법인·직군
제외되거나 확인되지 않은 조건
근거 coverage
```

`확인 불가`는 음수로 계산하지 않는다. 해당 category는 `판단 자료 부족`으로 표시하고 일치도 계산의 denominator에서 제외하되, 비교 가능한 category 수를 함께 표시한다. 비교 가능한 category 수가 preset의 절반보다 적으면 숫자 일치도 대신 `자료 부족`을 표시한다.

## 기업 상세 화면

### 헤더

- 기업 표시명·법인명
- 본사 국가·업종·규모 구간·기준 회계연도
- 국내/해외 scope
- 마지막 전체 검증일
- 데이터 버전
- `정확한 전체 매출순위가 아님` 안내

### 카테고리별 claim

각 claim은 다음을 표시한다.

```text
복지명
판정 상태
상세 내용
적용 국가·고용 법인·직군·고용형태
근속·기간 조건
공식 출처 제목·소유자
문서 게시일·확인일
근거 위치 또는 짧은 인용문
A/B 등급
공식 원문 링크
```

외부 링크는 HTTPS allowlist 검증 후 `rel="noopener noreferrer"`를 사용한다. 원문 내용을 HTML로 주입하지 않고 텍스트로 렌더링한다.

### 관련 Community 글

해당 기업이 포함된 25개 기업 상세 글이 게시된 경우 읽기 링크를 제공한다. 탐색기 데이터를 Community 본문에서 역파싱하지 않는다. artifact에 검증된 `community_post_id`가 있을 때만 링크한다.

### 정정 제보

기업 상세에는 기존 Community 신고·댓글 정책을 설명하는 링크를 제공한다. 비공개 문서·개인정보 업로드를 유도하는 별도 입력 form은 만들지 않는다.

## 데이터 로딩과 실패 처리

### 로딩 순서

1. manifest 로드 및 검증
2. index 로드 및 hash·schema 검증
3. 현재 화면에 필요한 ranking 또는 detail shard 지연 로드
4. URL query 정규화
5. 화면 표시

### 실패 상태

- manifest 실패: 탐색기를 표시하지 않고 재시도와 조사 기준 링크 제공
- index hash/schema 불일치: 전체 탐색 화면 fail closed
- ranking 불일치: 히트맵은 유지하되 순위 탭만 차단하고 무결성 오류 표시
- detail shard 실패: 목록 상태는 유지하고 상세 패널에서 재시도 제공
- 새 manifest가 가리키는 version 로딩 실패: 서로 다른 version의 데이터를 혼합하지 않음
- 빈 검색 결과: 활성 필터와 초기화 행동 표시

이전 버전 artifact는 rollback을 위해 배포물에 유지할 수 있지만 브라우저가 임의로 오래된 버전으로 fallback하지 않는다. 운영 rollback은 manifest 포인터를 검증된 이전 version으로 되돌리는 방식으로 수행한다.

## 성능

- initial route는 explorer shell과 manifest loader만 포함하도록 lazy-load한다.
- company index는 Brotli/Gzip 압축 전 크기와 전송 크기를 release gate에서 측정한다.
- 초기 화면은 detail source 전체를 다운로드하지 않는다.
- 히트맵은 페이지당 최대 50개 행만 렌더링한다.
- 검색과 필터는 2,000개 index record에 대해 Web Worker 없이 동작하는 것을 우선하고, 실제 측정에서 main-thread 지연이 확인될 때만 worker를 도입한다.
- query 변화는 네트워크 재요청 없이 현재 index에서 처리한다.
- detail shard와 rankings payload는 URL별 immutable cache header를 전제로 content-addressed version 경로를 사용한다.

## 접근성

- 탭은 `nav`와 현재 페이지 `aria-current="page"`로 구현한다.
- 히트맵은 실제 table semantics를 유지한다.
- sticky 기업명 열에도 열·행 header 관계를 보존한다.
- 모든 상태는 색상과 텍스트를 함께 표시한다.
- 셀·필터·비교 tray·pagination은 키보드로 조작 가능하다.
- focus indicator를 숨기지 않는다.
- 작은 화면에서 가로 스크롤 영역의 존재를 텍스트와 gradient cue로 안내한다.
- `prefers-reduced-motion`에서는 전환 애니메이션을 제거한다.

## 보안과 개인정보

- 모든 정적 JSON은 외부 입력으로 보고 strict runtime schema를 통과해야 한다.
- React text rendering만 사용하고 raw HTML을 렌더링하지 않는다.
- 외부 URL은 HTTPS, 허용된 길이, credential 부재를 검사한다.
- query parser는 길이·enum·ID 수를 제한한다.
- fit preset과 custom weight는 서버에 저장하지 않는다.
- 인증 여부와 관계없이 동일한 공개 데이터를 제공한다.
- Community의 stale JWT 복구 로직을 탐색기 정적 read에 적용하지 않는다.

## 컴포넌트 경계

```text
BenefitsExplorerShell
├── BenefitsTopNav
├── BenefitsFilterPanel
├── BenefitsDataVersion
└── route outlet
    ├── BenefitsHeatmapPage
    │   ├── BenefitsHeatmapTable
    │   ├── CompanyCompareTray
    │   └── CategoryRankingSummary
    ├── BenefitsRankingsPage
    │   ├── CategoryPicker
    │   ├── RankingMethodSummary
    │   └── CategoryRankingList
    ├── BenefitsFitPage
    │   ├── FitPresetPicker
    │   ├── CustomWeightEditor
    │   └── FitResultList
    └── BenefitsCompanyPage
        ├── CompanyEvidenceHeader
        ├── BenefitClaimGroup
        └── OfficialSourceList
```

데이터 계층은 Community repository와 분리한다.

```text
BenefitsArtifactClient
├── loadManifest
├── loadCompanyIndex
├── loadRankings
├── loadCompanyDetail
└── validate/hash-check helpers
```

## 테스트 전략

### 단위 테스트

- pathname route resolution
- query parsing·정규화·round trip
- 최대 비교 기업 4개 제한
- status/category enum 거부
- artifact strict schema validation
- content hash 불일치 거부
- 점수 component 합계 검증
- `확인 불가` 비감점 처리
- fit 비교 가능 category 부족 처리
- 동점 정렬

### 컴포넌트 테스트

- 세 탭과 현재 페이지 표시
- 히트맵 상태 텍스트·색상·aria label
- 50개 행 pagination
- 필터와 비교 목록의 탭 간 URL 보존
- 분야 미선택 순위 empty state
- 평가 근거 부족 기업의 별도 표시
- fit preset과 custom weight
- 기업 상세의 적용 범위·공식 출처
- manifest/index/ranking/detail별 오류 경계
- 모바일 filter drawer와 가로 스크롤 안내

### 생성기 테스트

- 승인된 effective selection 외 기업 거부
- 정확히 1,000개 국내·1,000개 해외 회사
- 중복 company ID 거부
- claim source 조건 검증
- category 중복 점수 방지
- 결정론적 byte-identical output
- manifest count·hash와 실제 artifact 일치
- 원본 URL과 짧은 인용문 외 비공개 자료 미포함

### 통합·release 검증

- Vite multi-page build에 네 route entry 포함
- GitHub Pages artifact에 각 HTML·JS·JSON 존재
- canonical/title/description route별 검증
- 기존 Community 590개 테스트와 정적 site verifier 회귀 통과
- 데스크톱·태블릿·모바일 화면 검증
- 키보드 탐색과 색상 외 상태 전달 검증
- 2,000개 fixture에서 필터·검색·페이지 전환 성능 측정
- 이전 manifest로 rollback한 artifact smoke test

## 단계별 출시

### 1단계: UI fixture vertical slice

- 실제 기업을 흉내 낸 명백한 fixture 데이터 사용
- 세 탭, 기업 상세, URL 상태, 오류 상태 구현
- 화면에 `예시 데이터` 배지 고정
- fixture를 운영 사실처럼 게시하지 않음

### 2단계: 파일럿 50곳 연결

- 승인된 국내 25곳·해외 25곳 원장에서 artifact 생성
- 히트맵·분야별 순위·fit 결과를 독립 검토
- 점수 규칙과 공개 문구 검증

### 3단계: 2,000곳 확장

- 동결된 effective selection과 검증 claim으로 전체 artifact 생성
- 크기·성능·접근성 release gate 통과
- 허브 글과 상세 Community 글 링크 연결

## 완료 기준

- 세 화면과 기업 상세가 동일한 검증 데이터·필터·비교 상태를 공유한다.
- 히트맵에서 상태와 적용 범위를 색상 외 텍스트로 이해할 수 있다.
- 순위는 카테고리별이며 종합 복지 순위를 만들지 않는다.
- 근거 부족 기업을 낮은 복지로 표현하지 않는다.
- fit 화면은 개인 데이터를 저장하지 않고 판단 가능한 근거 범위를 설명한다.
- 모든 기업 상세 claim은 공식 출처와 적용 범위를 가진다.
- 정적 artifact의 version·hash·count를 검증하고 서로 다른 version을 혼합하지 않는다.
- 기존 Community 인증·글·댓글·신고 기능에 회귀가 없다.
- fixture, 파일럿, 전체 데이터 상태가 화면과 배포 보고에서 명확히 구분된다.
- 별도 승인 전에는 운영 게시·push·PR·배포를 수행하지 않는다.
