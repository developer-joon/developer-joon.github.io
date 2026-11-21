# 기업 복지 Supabase 동적 디렉터리 설계

## 결정

기존 Benefit Atlas의 정적 공개 조회를 Supabase 기반 동적 조회로 전환한다. 첫 버전부터 현재 국내 검색 인덱스의 40,053개 ID 전체를 조회 대상으로 삼는다. 이 수는 1,000개 기준 법인, 35,910개 비중복 채용 관찰 사업자 ID, 3,143개 공시대상기업집단 소속 법인 ID의 합집합이다. 이를 대한민국의 전체 기업, 현재 고용주 또는 모두 독립 검증된 법인으로 표현하지 않는다.

공식 조사 원장과 정적 검증 artifact는 폐기하지 않는다. 공식 정보의 권위 원본은 계속 원장과 독립 검토 결과이며, Supabase는 공개 검색을 위한 동적 read model로 사용한다. 사용자 제보는 별도 검수 원장에 저장하고 관리자가 승인한 뒤 `사용자 제보` 계층으로 즉시 공개한다. 관리자 승인만으로 사용자 제보를 `공식 확인`으로 승격하지 않는다.

## 사용자와 목표

- 참여자: 기업 복지를 빠르게 찾으려는 구직자와 재직자
- 원하는 결과: 기업명과 복지 분야로 검색하고, 기업 기본 정보와 구체적인 복지 내용을 단순한 화면에서 확인
- 운영자: 사용자 제보를 검토하고 공개 여부를 통제하며, 내부 근거와 변경 이력을 감사 가능하게 유지

첫 버전의 핵심 행동은 다음 세 가지다.

1. 기업명 검색과 복지 카테고리·업종·규모 필터
2. 기업 상세에서 구체적 복지 내용·대상·조건 확인
3. 로그인 사용자의 새 복지 제보와 본인 제보 상태 확인

## 기존 시스템과 전환 경계

현재 시스템은 다음 자산을 보존한다.

- 40,053개 국내 검색 ID와 그 identity class
- 기존 2,000개 한미 기준 법인 원장과 공식 조사·독립 검토 파이프라인
- 128개 출처 기반 조사 항목과 별도의 승인 혜택 원장
- 기존 `benefit_correction_requests` 정정 요청, 관리자 검수, 감사 이벤트
- 기존 Benefit Atlas URL과 북마크 가능한 검색 상태

이번 변경은 기존 정정 요청을 새 제보로 재해석하지 않는다. 정정은 현재 표시된 데이터의 수정 요청이고, 제보는 아직 공개되지 않은 새 혜택 후보다. 두 workflow는 테이블·RPC·상태 전이를 분리한다.

기존 정적 artifact는 전환 기간의 검증 기준이자 공식 데이터 importer 입력으로 유지한다. 동적 조회가 안정화된 뒤에도 연구 원장과 release gate는 공식 혜택 승격에 필요하다. 브라우저가 비공개 원장이나 원시 출처를 직접 읽지 않는다.

## 정보 모델

### 검색 대상 기업

`benefit_companies`는 공개 검색용 canonical 행을 가진다.

- `company_id`: 기존 namespaced ID를 그대로 사용
- `identity_class`: `legal_corporation`, `registered_business`, `recruitment_observation`, `group_affiliate`
- `display_name`, `normalized_name`
- `industry`, `size_class`, `region`: 근거가 있는 값만 저장
- `summary`: 공개 가능한 짧은 소개
- `is_searchable`, `source_edition`
- 내부 전용 provenance와 원본 artifact binding

동일 이름을 근거로 ID를 합치지 않는다. 채용 관찰 사업자와 법인, 공시 집단 소속 법인을 같은 종류의 현재 고용주로 표시하지 않는다. 공개 카드에서는 identity class를 이해하기 쉬운 한국어로 표시한다.

### 공개 복지

`benefit_publications`의 한 행은 한 기업이 제공하는 원자적 혜택 하나다.

- `publication_id`, `company_id`, `category_id`
- `title`, `description`
- `eligibility_text`, `condition_text`
- `trust_tier`: `official_verified` 또는 `community_reviewed`
- `status`: `active`, `withdrawn`, `superseded`
- `dedupe_key`, `revision`
- 관리자 전용 source URL, source type, observed/verified time, 원장·검토 binding

공개 사용자는 source URL, source type 원문, 확인일을 조회할 수 없다. 공개 RPC는 `공식 확인` 또는 `사용자 제보`라는 최소 신뢰 배지만 반환한다. 이 숨김은 권위 경계를 없애지 않으며, 관리자 화면과 감사 원장에는 provenance를 보존한다.

혜택 수는 evidence 행 수가 아니라 활성화된 중복 제거 publication 수다. 같은 혜택을 여러 출처가 뒷받침해도 한 건으로 센다.

### 사용자 제보

`benefit_submissions`는 공개 publication과 분리한다.

필수 입력:

- 대상 기업
- 복지 카테고리
- 구체적 혜택 내용

선택 입력:

- 적용 대상과 조건
- 출처 URL

개인정보, 동료 실명, 이메일, 전화번호, 급여명세서·사내 문서 원문은 입력 금지다. source URL이 없어도 제출할 수 있지만, 승인 후에도 `사용자 제보`로만 공개한다.

상태는 `submitted → reviewing → approved | rejected`다. 추가 자료 요청은 append-only event로 남긴다. 승인 시 한 트랜잭션에서 새 `community_reviewed` publication 또는 기존 publication의 새 revision을 만들고 승인 event를 기록한다. 원본 제출 행은 수정하지 않는다.

## 분류 체계

첫 버전은 기존 Benefit Atlas의 열 개 category ID를 재사용하고 한국어 라벨만 단순화한다.

- 휴가
- 육아·가족
- 건강
- 성장·교육
- 주거
- 통근
- 유연근무
- 퇴직·노후
- 식사
- 포용·생활지원

새 category를 브라우저가 임의 생성하지 않는다. 분류 변경은 DB migration과 기존 artifact contract의 호환 검토를 거친다.

## 공개 조회 API

브라우저는 원본 테이블을 직접 조회하지 않고 bounded `SECURITY DEFINER` RPC만 호출한다.

### `search_benefit_companies_v1`

입력:

- 검색어
- category ID 목록
- 업종·규모·지역
- `has_benefits_only`
- 정렬 키
- cursor와 page size

출력:

- 기업 공개 필드
- identity class 라벨
- 중복 제거된 전체 혜택 수
- 공식 확인 수와 사용자 제보 수
- 대표 category 목록
- 다음 cursor

기본 조회는 혜택이 없는 검색 대상도 포함한다. `복지 정보 있는 기업만`을 켜면 활성 publication이 한 건 이상인 기업만 반환한다. 조건은 서버에서 `exists`로 계산하며 클라이언트가 현재 page만 필터링하지 않는다.

### `get_benefit_company_v1`

기업 기본 정보와 활성 publication을 category별 안정된 순서로 반환한다. withdrawn·superseded publication, 제출 원문, 관리자 메모와 provenance는 반환하지 않는다.

### 검색 규칙

- 한글·영문 표시명 검색을 지원하되 법인·사업자 ID 오인 합병은 하지 않는다.
- page size는 최대 50이다.
- 정렬은 결정적 tie-breaker로 `company_id`를 포함한다.
- 모든 입력 길이, enum, cursor shape를 서버에서 검증한다.
- public RPC는 `anon`과 `authenticated`에 동일한 공개 결과를 반환한다.

## 화면 설계

### `/benefits/`

블로그 전역 헤더에서 바로 접근하는 공개 검색 화면이다. Community 인증 provider를 mount하지 않고 공개 Supabase client만 초기화한다.

상단에는 다음 요소만 우선 노출한다.

- 큰 기업명 검색창
- 복지 카테고리 칩
- 업종·규모 필터
- `복지 정보 있는 기업만` 토글
- 적용된 필터와 결과 수

모바일에서는 검색창과 핵심 토글을 먼저 보이고 나머지 필터는 접는다. 입력은 debounce하고, 이전 요청은 취소하며, 늦게 도착한 응답은 현재 query state를 덮어쓰지 못한다. 검색 입력은 URL을 replace하고 명시적 필터·page 이동은 history를 push한다.

결과 카드는 다음을 표시한다.

- 기업명과 짧은 소개
- identity class
- 근거가 있는 업종·규모·지역
- 중복 제거된 혜택 수
- 대표 복지 category
- `공식 확인 N개 · 사용자 제보 N개`

종합 복지 점수, 순위와 맞춤 추천은 제공하지 않는다.

### `/benefits/company/?id=...`

기업 기본 정보와 구체적 복지를 category별로 표시한다. 각 혜택에는 내용·대상·조건과 최소 신뢰 배지만 노출한다. 출처 URL과 마지막 확인일은 공개하지 않는다.

활성 publication이 없으면 `게시 가능한 공개 복지 근거 미확인`이라고 표시한다. `복지 없음`이라고 단정하지 않는다. 하단에는 `이 기업 복지 제보하기`를 제공한다.

### 제보와 관리자 화면

제보, 내 제보, 관리자 queue는 기존 Community Google OAuth와 AuthProvider를 재사용한다. 비로그인 사용자가 제보를 시작하면 bounded draft와 return path를 보존하고 OAuth 후 같은 기업으로 복귀한다.

관리자 화면은 source URL·확인일·기존 publication·중복 후보·감사 이벤트를 볼 수 있다. 일반 사용자는 본인 제출의 상태와 관리자 답변만 볼 수 있고 다른 제출자의 행은 볼 수 없다.

### 기존 URL

기존 `/community/benefits/directory/`와 기업 상세 deep link는 query를 보존해 새 canonical route로 이동한다. 기존 연구·방법론 화면은 감사와 설명을 위해 유지하되 새 단순 검색의 기본 navigation에서는 보조 링크로 둔다.

## 공식 데이터 동기화

공식 혜택과 기업 identity는 브라우저나 관리자 UI가 직접 생성하지 않는다. service-role importer가 검증된 artifact를 읽고 다음을 수행한다.

1. artifact manifest와 파일 digest, schema, exact count를 검증
2. staging table에 적재
3. 기존 canonical ID와 identity class 일치 확인
4. official publication의 원장·review binding 확인
5. 한 트랜잭션에서 upsert하고 import receipt 기록
6. 불일치가 하나라도 있으면 공개 read model을 변경하지 않음

import는 idempotent version key를 사용한다. 동일 version의 다른 bytes, 누락된 기업, identity class 변경, 승인되지 않은 research-only 항목을 거부한다. research-only 항목은 공식 publication으로 적재하지 않는다.

초기 migration은 현재 40,053개 검색 행 전체와 그 분류를 적재하되, 기존 승인 혜택 수를 부풀리지 않는다. 데이터가 비어 보이는 문제를 숨기기 위해 category label이나 source 행을 혜택으로 만들지 않는다.

## 권한과 보안

- 원본 table에는 `anon`·`authenticated` 직접 권한을 주지 않는다.
- 공개 읽기는 bounded RPC만 허용한다.
- 제출·내 목록·관리자 queue·검수는 각각 별도 fixed-owner RPC를 사용한다.
- actor는 `auth.uid()`에서 결정하고 client의 owner/admin/approved 값을 신뢰하지 않는다.
- 관리자 권한은 서버의 `user_roles`에서 확인한다.
- 제출은 idempotency key, payload fingerprint, rate limit과 상태 CAS를 적용한다.
- 승인과 publication 생성은 한 트랜잭션으로 묶는다.
- audit event는 append-only이며 삭제·수정을 거부한다.
- 문자열 길이, Unicode control, HTML, URL authority와 허용 scheme을 서버와 클라이언트 양쪽에서 검증한다.
- URL을 서버가 가져오는 기능은 첫 버전에 넣지 않는다. 향후 추가 시 SSRF, redirect, DNS rebinding, 응답 크기와 content type 방어를 별도 설계한다.
- 공개 응답은 submitter ID, reviewer ID, source URL, 내부 시간, 메모와 artifact locator를 포함하지 않는다.

## 장애와 빈 상태

- Supabase 조회 실패 시 이미 화면에 있는 성공 결과를 지우지 않는다.
- 첫 조회 실패, 후속 필터 실패, 결과 없음, 검색 대상은 있으나 혜택 없음 상태를 서로 다른 문구로 표시한다.
- retry는 현재 URL query를 그대로 재실행한다.
- timeout과 취소를 빈 결과로 해석하지 않는다.
- 공개 조회 장애가 제보 draft를 지우지 않는다.
- 공식 importer 실패 시 기존 공개 revision을 유지한다.
- 승인 transaction 실패 시 submission과 publication이 절반만 변경되지 않아야 한다.

## 성능

- 40,053개 행을 브라우저에 일괄 다운로드하지 않는다.
- 검색, 필터, 정렬, count와 pagination은 서버에서 수행한다.
- 검색용 normalized name과 활성 publication existence에 맞는 index를 둔다.
- page size 최대 50, 응답 payload와 RPC 실행 시간을 회귀 테스트한다.
- 목록은 필요한 공개 필드와 집계만 반환하고 상세 내용을 포함하지 않는다.
- 동일 query의 짧은 client cache는 허용하되 stale 응답이 현재 query를 덮어쓰지 못하게 한다.

## 검증 기준

### 데이터베이스

- 40,053개 exact ID union, 중복 0, identity class별 수가 importer 입력과 일치
- `anon`이 원본 table과 미검수 submission을 읽을 수 없음
- 일반 사용자가 다른 사용자 제출을 읽거나 수정할 수 없음
- forged owner/admin/approved 입력 거부
- source URL 없는 제출 성공과 비공개 provenance 불변식
- rate limit, idempotency, payload mismatch, illegal status transition, concurrent review CAS
- 승인 transaction이 publication과 audit event를 함께 생성하거나 모두 rollback
- 공식 importer가 research-only·hash drift·누락·identity 변경을 fail-closed

### 프런트엔드

- 검색·category·업종·규모·`복지 정보 있는 기업만`의 URL 복원
- 서버 전체 집합 기준 필터와 cursor pagination
- 중복 publication이 혜택 수를 부풀리지 않음
- 출처 URL·확인일·내부 ID가 공개 DOM과 네트워크 projection에 없음
- 공식 확인과 사용자 제보 배지 분리
- 빈 결과와 혜택 미확인 문구 구분
- 요청 취소, out-of-order 응답, 재시도, 기존 결과 보존
- OAuth draft 복원, actor switch, 본인 제보 상태, 관리자 queue
- 모바일 검색·필터·상세·제보 흐름과 키보드 접근성

### 통합과 릴리스

- 기존 정적 artifact verifier와 공식 원장 검증 유지
- Supabase migration reset, pgTAP, 프런트엔드 test/typecheck/lint/build
- importer 실제 fixture와 tamper fixture 실행
- Docker에서 Jekyll+React 단일 artifact 조립
- 새 `/benefits/`와 legacy redirect를 assembled-site verifier로 검사
- 실제 브라우저에서 공개 검색, 상세, 로그인 복귀와 모바일 layout 확인
- 운영 schema 적용·seed import·조회 smoke test가 끝나기 전 navigation을 전환하지 않음

## 전환과 롤백

1. additive DB schema와 RPC를 배포한다.
2. production과 분리된 환경에서 40,053개 기업 read model을 import하고 수·집합·응답을 검증한다.
3. 새 공개 화면을 feature flag 아래 배포한다.
4. 운영 DB에 동일 version을 import하고 공개 RPC smoke test를 실행한다.
5. `/benefits/` navigation을 전환하되 기존 정적 화면과 artifact는 유지한다.
6. 안정화 기간 후 legacy URL을 canonical route로 연결한다.

문제가 발생하면 navigation과 route flag만 기존 정적 화면으로 되돌린다. additive DB table과 submission audit는 삭제하지 않는다. importer는 기존 공개 revision을 덮어쓰는 파괴적 rollback 대신 새 verified revision으로만 교정한다.

## 비목표

- 40,053개 검색 대상을 대한민국 전체 현행 기업으로 주장
- 모든 검색 대상이 현재 고용주라고 주장
- 조사 중 항목을 승인 혜택으로 계산
- 사용자 제보를 공식 정보로 표시
- 기업 종합 점수, 순위, 맞춤 추천, 기업 비교
- 익명 제보
- 출처 URL과 확인일의 공개 노출
- 브라우저에서 관리자 역할 또는 공식 승인 생성
