# 기업 복지 v2 조사·정정 설계

## 목표

국내·해외 2,000개 기업의 10개 복지 분야, 총 20,000개 기업-분야 셀을 실제 조사 기록으로 완결한다. 공식 근거 기준은 낮추지 않고, 더 넓은 공개자료와 검토된 커뮤니티 보고를 별도 신뢰도 계층으로 공개한다. Google 로그인 사용자는 정정 요청을 제출하고 처리 상태를 확인하며, 관리자는 요청을 검토하지만 승인만으로 정적 공개 artifact를 직접 변경하지 않는다.

## 비목표

- 20,000개 셀에 존재하지 않는 복지를 만들어 넣지 않는다.
- 직원 리뷰·블로그·익명 게시물을 공식 확인으로 승격하지 않는다.
- 모회사·그룹 정책을 선택 법인에 자동 전이하지 않는다.
- 정정 승인과 정적 artifact 배포를 하나의 브라우저 동작으로 결합하지 않는다.
- 종합 복지 점수나 순위를 만들지 않는다.

## 조사 상태 모델

모든 회사-분야 셀은 다음 중 정확히 하나의 주 상태를 갖는다.

1. `official_verified`: 정부·공시·회사 공식자료가 해당 법인과 분야를 직접 뒷받침한다.
2. `reference`: 회사 명의 채용자료, 채용 플랫폼, 주요 언론 또는 기타 공개 웹에서 참고 가능한 정보를 찾았지만 공식 확인 조건은 충족하지 못한다.
3. `community_report`: 관리자 검토를 통과한 직원 리뷰·익명 커뮤니티·사용자 제출만 존재한다.
4. `no_public_info`: 해당 국가·분야의 필수 검색 경로를 모두 실행했지만 공개 가능한 정보를 찾지 못했다.

우선순위는 `official_verified > reference > community_report > no_public_info`다. 주 상태가 높은 계층으로 정해져도 하위 계층 근거와 상충 정보는 삭제하지 않는다.

`not_researched`는 공개 상태가 아니다. 필수 조사 시도가 빠진 셀은 통합 실패로 처리한다.

## 출처와 적용 범위

모든 공개 출처를 수집 대상으로 허용하되 다음 유형을 보존한다.

- `official_government`
- `company_recruiting_major_media`
- `other_public_web`
- `community_employee_review`
- `user_submission`

각 자료는 신뢰도, 현재성, 법인·국가·직군·고용형태 적용 범위, 상충 상태를 함께 가진다. 과거 자료는 `historical`, 그룹 자료는 `group_only`, 법인 적용이 불명확하면 `unresolved`로 표시한다.

서버가 제출 URL을 가져오는 경우 HTTPS 문법 검사만으로 충분하지 않다. 자격증명 포함 URL, localhost, 사설·링크로컬 주소, DNS rebinding, 위험한 redirect, 과도한 응답 크기와 비 HTTP 콘텐츠를 거부한다.

## 20,000셀 완결 증명

기존 80개 배치와 각 배치 25개 기업의 canonical 순서를 유지한다. 각 배치는 25 × 10 = 250개 셀을 가져야 한다.

각 셀에는 collector가 생성한 조사 시도 receipt가 필요하다. receipt는 셀·검색 경로·질의 또는 locator·시작/완료 시각·결과 상태·발견한 source ID·원시 응답 hash·외부 capture locator·collector 버전을 결합한다.

`no_public_info`는 coverage policy가 요구하는 모든 경로 receipt가 있을 때만 유효하다. generator는 누락된 셀이나 receipt를 자동 생성하지 않는다. 80개 승인 배치, 20,000개 고유 셀, 정확한 Cartesian set equality가 성립해야 통합된다.

기존 공식 claim 검증은 그대로 유지한다. reference와 community report는 별도 ledger와 schema를 사용하며 공식 claim ledger에 들어갈 수 없다.

## 공개 artifact와 UI

새 데이터 버전은 기존 버전을 덮어쓰지 않는 immutable directory로 생성한다. manifest에는 20,000셀 상태 집계와 cell/attempt/reference/community ledger hash를 기록한다.

탐색·비교에는 모든 승인 상태를 포함하되 각 셀에 다음 배지를 노출한다.

- 공식 확인
- 채용·언론 참고
- 기타 공개자료
- 커뮤니티 보고
- 과거 정보
- 적용 범위 미확인
- 정보 상충

같은 조건에서는 공식 확인, 참고 정보, 커뮤니티 보고, 공개 정보 없음 순서로 보여준다. 공식 확인 건수와 커뮤니티 보고 건수를 합산하지 않으며 단일 종합 점수를 만들지 않는다.

## Google 로그인 정정 요청

복지 공개 읽기 경로는 인증 번들을 초기화하지 않는다. 정정 요청과 내 요청 목록은 기존 Community `AuthProvider`를 사용하는 별도 인증 entry에서 제공한다.

비로그인 사용자가 회사 상세의 `정보 수정 요청`을 누르면 정정 draft를 저장하고 Google OAuth를 시작한다. 성공 후 원래 회사·분야 폼으로 복귀한다. callback 실패, 세션 만료, reload, 네트워크 실패에도 입력과 같은 idempotency key를 보존하며 검증된 성공 응답 후에만 draft를 지운다.

제출 필드는 company ID, category, 현재 표시값, 제안값, 공개 HTTPS source URL, 적용 범위, 관찰한 data version이다. 개인정보, OAuth 토큰, 이메일, 비공개·인증 필요·유료 자료를 저장하지 않는다.

상태 흐름은 `submitted → reviewing → approved|rejected → applied`다. 추가 자료 요청은 상태 또는 명시적 review action으로 기록한다. 사용자는 자신의 요청 상태, 관리자 답변, 반영 data version만 조회할 수 있다.

## 데이터베이스 경계

전용 `benefit_correction_requests`와 append-only audit/event 원장을 사용한다. 기존 abuse report 테이블은 재사용하지 않는다.

브라우저 직접 table write는 허용하지 않는다. `auth.uid()`로 actor를 결정하는 fixed-owner, empty-search-path `SECURITY DEFINER` RPC를 제공한다.

- `create_benefit_correction_request_v1`
- `list_my_benefit_correction_requests_v1`
- `list_benefit_correction_queue_v1`
- `review_benefit_correction_request_v1`
- operator-only `mark_benefit_correction_applied_v1`

모든 mutation은 bounded input, database-backed idempotency, fingerprint, rate limit, CAS 전이를 적용한다. 관리자 권한은 `user_roles`를 통해 서버에서 확인하고 JWT role metadata를 신뢰하지 않는다.

## 관리자 검토와 artifact 반영

관리자는 전용 queue에서 요청을 검토하고 답변·상태를 변경한다. 승인은 DB workflow 상태만 변경한다.

별도 privileged offline/CI 작업이 승인 요청을 immutable snapshot으로 export하고 research ledger 후보로 가져온다. 기존 독립 검토와 artifact generator를 통과해 새 manifest가 실제 게시된 뒤에만 operator가 해당 요청에 `applied_data_version`을 기록한다.

## 실패와 보안

- 늦은 auth/session 응답이 새 세션이나 입력을 덮어쓰지 않는다.
- actor가 바뀌면 이전 사용자의 draft/status 응답을 노출하지 않는다.
- 중복 클릭과 retry는 같은 요청 하나로 수렴한다.
- 관리자 action은 expected status를 요구한다.
- 승인된 제출 텍스트는 HTML로 실행하거나 검증 없이 Markdown에 삽입하지 않는다.
- 공개 artifact 생성·검증 실패 시 기존 버전을 유지한다.
- production admin bootstrap은 브라우저 역할 관리가 아니라 privileged runbook으로 수행한다.

## 검증 기준

- DB: 직접 write 거부, ownership, admin 권한, forged JWT, rate limit, idempotency, CAS, 상태/필드 불변식 pgTAP.
- Frontend: OAuth draft 복원, callback 실패, auth expiry, 중복 제출, malformed RPC payload, actor switch, 본인 목록, 관리자 queue 테스트.
- Pipeline: 누락·중복·category 치환·복사 receipt·orphan source·미승인 report·그룹 전이·상충 은폐·기존 artifact overwrite를 모두 거부.
- Artifact: 정확히 20,000셀, 80×250 배치, ledger hash lineage, shard/hash/inventory 검증.
- Release: frontend test/typecheck/lint/build, Supabase migration test, Docker Jekyll+React assemble, static verifier, 실제 브라우저 모바일·키보드·로그인 복귀 확인 후 feature branch만 push한다.
