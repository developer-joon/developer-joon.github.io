# 커뮤니티 혜택 제보·사업체 확장 설계

- 작성일: 2026-11-23
- 상태: 사용자 승인 설계
- 대상: Benefits 기업 검색 및 기업 상세

## 1. 목적

Benefits를 링크 제출 중심의 자료함에서 다음 두 기능을 갖춘 참여형 디렉터리로 전환한다.

1. 공개 명단과 사용자 요청을 결합해 검색 가능한 국내 사업체 범위를 점진적으로 확장한다.
2. 사용자가 댓글을 쓰듯 혜택 한 건을 제보하고, 다른 사용자의 확인을 거쳐 기업 본문에 반영한다.

이 기능은 커뮤니티 확인과 공식 확인을 섞지 않는다. 사용자 확인 수가 많아도 공식 정보로 자동 승격하지 않는다.

## 2. 확정된 제품 결정

- 혜택 제보와 반응은 Google 로그인 사용자만 가능하다.
- 제보자에게는 기존 커뮤니티 닉네임을 표시한다.
- 제보는 자유 댓글이 아니라 구조화된 혜택 한 건이다.
- 서로 다른 사용자 3명의 `나도 확인했어요`와 반대 0건을 충족하면 `커뮤니티 확인 혜택`으로 자동 승격한다.
- 승격 후에도 `현재는 달라요`가 1건 생기면 `재확인 필요`로 강등한다.
- 커뮤니티 확인에는 유효기간을 두지 않는다. 대신 최초 제보일과 마지막 확인일을 항상 표시한다.
- 기업 명단은 공개 명단과 사용자 사업체 추가를 결합하는 혼합형으로 확장한다.
- 개인사업자를 포함한다.
- 사업자등록번호는 선택 입력이다. 번호가 있으면 상호명·개업일자·대표자명을 함께 받아 국세청 진위확인을 수행한다.
- 번호가 없으면 운영자 검토 후 사업체를 공개한다.

## 3. 기업 명단 확장

### 3.1 기본 명단

기존 40,053개 검색 인덱스와 정적 검증 artifact를 유지한다. OpenDART가 파일로 제공하는 공시대상 회사 고유번호·정식명칭·영문명·종목코드·변경일자를 추가 입력원으로 사용한다.[2]

공개 명단은 대한민국의 모든 사업체라고 표현하지 않는다. 전국사업체조사는 모든 사업체를 대상으로 하지만 통계 작성과 모집단 구축이 목적이며, 이 서비스가 소비할 수 있는 개별 사업체 공개 명단과 동일하지 않다.[3]

공개 문구는 다음 의미를 유지한다.

> 공개 명단과 사용자 검증으로 등록된 국내 사업체를 검색합니다. 국내 전체 사업체 명부는 아닙니다.

### 3.2 식별자와 중복 병합

사업체는 출처별 ID를 그대로 공개 기본키로 사용하지 않는다. 내부 canonical company ID를 발급하고 다음 식별자를 별도 결합한다.

- 기존 법인·사업자·채용 관찰·그룹 계열 식별자
- OpenDART `corp_code`
- 사업자등록번호 HMAC digest
- 정규화된 상호명과 별칭

이름만 같은 서로 다른 사업체를 자동 병합하지 않는다. 강한 식별자가 일치하거나 운영자가 승인한 경우에만 병합한다. 병합 이력과 이전 ID는 감사용으로 보존한다.

### 3.3 사업체 추가 요청

#### 사업자등록정보가 있는 요청

입력 필드:

- 상호명
- 사업자등록번호
- 개업일자
- 대표자명
- 지역·업종·웹사이트 선택 입력

서버 전용 검증 함수가 국세청 진위확인 API에 입력값을 전달한다. 해당 API는 사업자등록번호, 개업일자, 대표자명 등으로 등록정보 일치 여부를 확인하며 상태조회도 제공한다.[1]

성공 조건:

- 진위확인 결과가 일치한다.
- 사업 상태가 공개 등록 가능한 상태다.
- 동일 사업자번호 digest로 등록된 canonical company가 없다.

성공하면 사업체를 자동 등록한다. 실패·시간 초과·외부 API 오류에서는 fail-closed로 등록하지 않는다.

민감정보 처리:

- 대표자명과 개업일자는 검증 요청 중에만 사용하고 저장하지 않는다.
- 사업자등록번호 원문은 로그·감사 이벤트·공개 projection에 저장하지 않는다.
- 중복 방지에는 서버 비밀키 기반 HMAC digest만 저장한다.
- 공개 화면에는 `사업자 정보 확인됨`과 검증 시각만 표시한다.
- 외부 API 요청·응답 로그는 값이 아닌 성공 여부와 오류 분류만 기록한다.

#### 사업자등록정보가 없는 요청

입력 필드:

- 상호명
- 지역
- 업종
- 웹사이트 또는 확인 가능한 공개 정보

요청은 `pending_review`로 저장하고 운영자가 승인·거절·기존 사업체 병합을 결정한다. 승인 전에는 공개 검색과 혜택 제보 대상에 포함하지 않는다.

## 4. 구조화된 혜택 제보

### 4.1 제보 필드

필수:

- 기업 ID
- 혜택 범주
- 한 줄 혜택명
- 간단한 설명
- 확인 시점

선택:

- 적용 대상
- 이용 조건
- 공개 근거 URL

입력 길이, URL 스킴, 범주 수를 서버에서 제한한다. 설명은 짧은 경험 제보를 위한 필드이며 게시글 본문이나 자유 댓글 스레드를 대체하지 않는다.

### 4.2 공개 표시

제보 직후 `제보된 혜택` 영역에 표시한다.

- 혜택명과 범주
- 설명·적용 대상·조건
- 제보자 커뮤니티 닉네임
- 최초 제보일
- 확인 인원과 반대 인원
- 마지막 확인일

Google 이메일, 공급자 subject, 내부 사용자 ID는 공개하지 않는다. 프로필이 삭제되면 공개 이름은 `탈퇴한 사용자`로 대체한다.

### 4.3 중복 제보

정확히 같은 기업·범주·정규화 제목·적용 대상의 활성 제보는 새 항목을 만들지 않고 기존 항목 확인으로 유도한다. 유사 문구를 AI나 fuzzy match만으로 자동 병합하지 않는다. 운영자가 병합할 때 원본 claim ID와 반응 이력을 보존한다.

## 5. 확인·반대와 상태 전이

### 5.1 반응 규칙

반응 종류:

- `confirm`: 나도 확인했어요
- `dispute`: 현재는 달라요

규칙:

- Google 로그인 사용자만 반응할 수 있다.
- 사용자는 혜택 한 건에 하나의 현재 반응만 가진다.
- 반응 변경은 가능하지만 중복 집계하지 않는다.
- 제보자는 자기 제보를 확인할 수 없다.
- 제보자도 자기 제보에 반대할 수는 있으며, 이 경우 철회 안내를 우선 제공한다.

### 5.2 상태

- `submitted`: 공개된 신규 제보
- `community_confirmed`: 확인 3명 이상, 반대 0명
- `disputed`: 반대 1명 이상
- `hidden`: 신고·운영 조치로 비공개
- `withdrawn`: 제보자 또는 운영자가 철회

전이는 서버의 원자적 mutation 안에서 반응 upsert, 집계, claim 상태 변경, 공개 publication 변경, 감사 이벤트 기록을 함께 처리한다.

### 5.3 자동 승격·강등

`confirm_count >= 3 AND dispute_count = 0`이면 `community_confirmed`로 승격한다. 기존 `benefit_publications`에는 `community_reviewed` trust tier의 활성 publication을 원자적으로 생성한다.

`dispute_count >= 1`이 되면:

- claim을 `disputed`로 변경한다.
- 해당 community publication을 철회한다.
- 기업 본문의 핵심 혜택 영역에서 제외한다.
- `재확인 필요` 영역에서 원래 제보와 반응 수를 유지한다.

반대가 다시 0이 되고 확인 3명 이상이면 동일한 원자적 경계를 통해 재승격할 수 있다. publication revision과 supersession lineage를 유지한다.

### 5.4 공식 확인

커뮤니티 확인은 공식 확인이 아니다. 운영자가 검토 가능한 공식 근거를 승인할 때만 `official_verified` publication을 생성한다.

- 확인 3건만으로 공식 승격하지 않는다.
- 운영자 승인만으로 근거 없는 제보를 공식 정보로 바꾸지 않는다.
- 공식 publication은 근거 유형·관찰일·검증일을 private provenance에 보존한다.
- 공개 projection은 민감 provenance와 내부 검토자 정보를 노출하지 않는다.

## 6. 화면 구조

### 6.1 기업 검색 카드

복지 상태를 첫눈에 구분한다.

정보가 있는 경우:

> 공개 확인 혜택 4개 · 커뮤니티 확인 혜택 7개  
> 건강 · 식사 · 휴가 · 가족

정보가 없는 경우:

> 공개 확인된 복지 정보 없음  
> 첫 번째 혜택을 제보해 주세요.

기업 설명, 내부 identity label, 복잡한 trust 집계는 검색 카드의 우선 정보에서 제거한다.

### 6.2 기업 상세

순서:

1. 기업명과 검증 상태
2. `혜택 제보하기`
3. 공식 확인 혜택
4. 커뮤니티 확인 혜택
5. 제보된 혜택
6. 재확인 필요

커뮤니티 확인 카드에는 `공식 정보가 아닌 커뮤니티 확인 정보`를 표시한다. 자동 만료는 하지 않지만 최초 제보일과 마지막 확인일을 항상 노출한다.

### 6.3 사업체가 검색되지 않을 때

빈 결과 화면에 `사업체 추가`를 제공한다. 사업체 추가 완료 후 같은 흐름에서 첫 혜택 제보로 이동한다. 검증 실패 시 사용자의 혜택 초안은 로컬에 보존하고 재시도할 수 있게 한다.

## 7. 데이터 모델

### 7.1 사업체 추가

`benefit_company_add_requests`

- `request_id`
- `requester_id`
- `proposed_name`
- `normalized_name`
- `region`, `industry`, `website`
- `verification_method`: `nts_full`, `manual`
- `verification_status`
- `business_number_digest` nullable
- `external_verified_at` nullable
- `status`: `pending_review`, `approved`, `rejected`, `merged`
- `resolved_company_id` nullable
- 생성·처리 시각

민감 원문 필드는 두지 않는다.

### 7.2 회사 식별자

`benefit_company_identifiers`

- `company_id`
- `identifier_type`
- `identifier_digest_or_value`
- `source_edition`
- `verified_at`
- `(identifier_type, identifier_digest_or_value)` unique

공개 가능한 OpenDART 코드와 비공개 HMAC digest의 projection을 분리한다.

### 7.3 혜택 제보

`benefit_claims`

- `claim_id`
- `company_id`
- `submitter_id`
- `category_id`
- `title`, `description`
- `eligibility_text`, `condition_text`
- `observed_on`
- `source_url` nullable
- `status`
- `active_publication_id` nullable
- 생성·수정 시각

`benefit_claim_reactions`

- `claim_id`
- `user_id`
- `reaction`: `confirm`, `dispute`
- 생성·수정 시각
- `(claim_id, user_id)` unique

집계 수는 클라이언트 값을 신뢰하지 않는다. 서버 mutation이 잠금 순서를 고정하고 실제 reaction 행에서 계산한다.

## 8. 권한·보안·악용 방지

- 공개 읽기는 bounded RPC만 허용하고 원본 테이블 SELECT를 허용하지 않는다.
- 제보·반응·사업체 요청은 authenticated RPC만 허용한다.
- actor는 `auth.uid()`에서 도출하며 클라이언트 사용자 ID를 신뢰하지 않는다.
- 제보·반응·사업체 요청에 idempotency와 사용자별 rate limit을 적용한다.
- 자기 확인, 중복 반응, 숨김 claim 반응, 존재하지 않는 기업 probe를 서버에서 차단한다.
- 신고·숨김·복구·병합·공식 승격은 append-only 감사 로그에 기록한다.
- 사업자 검증 외부 호출은 서버 전용 환경에서 수행하고 API 키를 브라우저에 제공하지 않는다.
- 외부 서비스 장애 시 검증 성공을 추정하지 않는다.
- 신고된 claim은 즉시 삭제하지 않고 moderation 상태로 전환해 복구 가능하게 한다.

## 9. 실패 처리

- 국세청 검증 실패: 사업체 미등록, 민감 입력 폐기, 안전한 사용자 문구 표시
- 국세청 장애·시간 초과: 초안 보존 후 재시도, 자동 승인 금지
- 반응 mutation 충돌: idempotent replay 또는 최신 상태 반환
- 자동 승격 publication 실패: reaction과 claim 상태까지 전체 rollback
- 기업 병합 충돌: 강한 식별자가 다르면 자동 병합 금지
- 삭제된 사용자: claim 유지, 공개 닉네임만 대체
- 공개 RPC 오류: RPC명·SQL·프로젝트 URL을 숨긴 고정 문구 사용

## 10. 테스트 전략

### 데이터베이스

- Google 로그인 actor 경계와 익명 mutation 거부
- 자기 확인 거부
- 동일 사용자 반응 중복·변경
- 2→3 확인 승격
- 첫 dispute 발생 시 원자적 강등
- dispute 제거 후 재승격
- 동시 3번째 확인 race
- 동시 confirm/dispute race
- publication revision·supersession invariant
- 사업자 HMAC 중복 차단
- 외부 검증 성공·불일치·장애 fail-closed
- 민감정보 비저장·비노출

### 프런트엔드

- 기업 미검색→사업체 추가→혜택 초안 복구
- 공식·커뮤니티·제보·재확인 영역 분리
- 확인 수·반대 수·날짜 표시
- 자기 제보 확인 버튼 비활성
- raw backend 오류 비노출
- 모바일 44px target과 검색 상시 노출

### 운영 검증

- reset-from-zero, pgTAP, DB lint
- anonymous public RPC와 authenticated mutation 실제 Data API 검증
- assembled Jekyll/React artifact 검증
- 운영 migration dry-run→승인→apply→read-back
- 외부 API secret leak 검사
- 대표 기업·사용자 추가 사업체·개인사업자 검색 smoke test

## 11. 구현 단계

1. 회사 식별자·추가 요청·검증 경계
2. OpenDART importer와 기존 인덱스 병합
3. 혜택 claim·reaction·상태 전이
4. community publication 원자적 승격·강등
5. 검색 카드와 기업 상세 UI 개편
6. 관리자 사업체 검토·claim moderation
7. 로컬·운영 release gate와 runbook

각 단계는 독립 migration과 rollback 경계를 가진다. 기업 명단 확대가 완료되지 않아도 claim 기능을 기존 40,053개 기업에 먼저 적용할 수 있지만, 공개 배포에서는 두 기능의 준비 상태를 별도로 표시한다.

## Sources

[1] https://www.data.go.kr/data/15081808/openapi.do — 국세청 사업자등록정보 진위확인 및 상태조회 서비스  
[2] https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018 — OpenDART 고유번호 개발가이드  
[3] https://kostat.go.kr/statDesc.es?act=view&mid=a10501010000&sttr_cd=S010004 — 전국사업체조사 통계 설명
