# Benefits Blog 시각 통합 및 탐색 정리 설계

## 결정

Benefits의 별도 짙은 남색 Atlas 테마를 제거하고 Breadlab Blog와 동일한 밝은 편집형 디자인 언어를 적용한다. 글로벌 메뉴명은 `Benefits`로 유지하며, Benefits 내부 기본 UI 언어는 한국어를 유지한다.

내부 상단 탐색은 다음 두 항목만 노출한다.

1. `기업 검색` → `/benefits/`
2. `조사 기준` → `/community/benefits/methodology/`

`복지 현황`과 `조건 탐색`은 기본 탐색에서 제거한다. 기존 URL과 페이지 구현은 삭제하거나 다른 URL로 강제 이동하지 않는다. 기존 deep link를 보존하고, 조사 기준 화면에서 필요할 때만 `기존 분석 자료`라는 명시적인 보조 영역으로 연결한다.

## 문제

현재 Benefits는 Blog 및 Community와 다른 짙은 남색·청록색 대시보드 테마를 사용한다. 글로벌 헤더는 동일하지만 hero, 탭, 입력, 카드, 테이블이 별도 제품처럼 보인다.

또한 `국내 기업 검색`, `복지 현황`, `조건 탐색`, `조사 기준·정정 이력` 네 탭은 사용자 관점에서 앞의 세 항목이 유사한 탐색 기능으로 보인다. 동적 Supabase 디렉터리와 이전 정적 분석 화면이 같은 위계에 놓여 현재 제품의 기본 경로가 불명확하다.

운영 데이터 미노출의 확인된 원인은 프런트 설정이 아니라 운영 Supabase에 `search_benefit_companies_v1` RPC migration이 적용되지 않은 것이다. 운영 공개 RPC는 `404 / PGRST202`를 반환한다. UI 변경은 이 운영 장애를 해결한 것처럼 보이게 해서는 안 된다.

## 시각 방향

이름: **Breadlab editorial directory**

- 분위기: 밝고 차분한 편집형 디렉터리
- 공간 모델: Blog hero 아래에 검색과 결과가 이어지는 단일 컬럼 콘텐츠 흐름
- 시각 요소: 흰색 지면, 얇은 border, 제한적인 shadow, Blog accent 색상, 편집형 제목과 metadata
- 타이포그래피: Blog의 본문·제목 위계와 동일한 CSS 변수 및 반응형 크기 사용
- 모션: hover와 focus feedback만 사용하고 장식 애니메이션은 추가하지 않음

## 레이아웃

### 공통 shell

- 기존 Jekyll/React 공통 글로벌 헤더 계약을 유지한다.
- Blog와 동일한 `500 / 680 / 900 / 1100px` 반응형 콘텐츠 폭을 사용한다.
- 글로벌 메뉴의 `Benefits` active state와 full-document navigation을 유지한다.
- Benefits 페이지의 한국어 H1과 본문은 변경하지 않는다.

### Hero

- 기존 `/images/community/benefit-atlas.svg`를 유지하되 Blog `hero--single`과 같은 배경 이미지·overlay·콘텐츠 배치로 사용한다.
- 페이지 전체를 짙은 배경으로 만들지 않는다.
- kicker, H1, 소개문, 데이터 범위 문구를 한 hero 안에 유지한다.
- hero 이후 콘텐츠는 밝은 Blog 지면으로 이어진다.

### 내부 탐색

- 상단 primary navigation에는 `기업 검색`, `조사 기준`만 표시한다.
- 현재 경로는 텍스트와 border로 구분하며 색상만으로 표시하지 않는다.
- 모바일에서 각 링크는 최소 44px target을 유지한다.
- `복지 현황`, `조건 탐색` deep link는 계속 동작한다.
- 조사 기준 화면에 보조 링크를 둘 경우 `기존 분석 자료`라고 명확히 표시하고 primary tab처럼 보이지 않게 한다.

### 검색과 필터

- 기업명 검색을 첫 번째 조작 가능한 control로 유지한다.
- Blog 검색창의 밝은 배경, 얇은 border, accent focus 표현을 재사용한다.
- 복지 범주와 `복지 정보 있는 기업만`은 검색 다음에 둔다.
- 업종·규모 등 세부 필터만 모바일 disclosure에 둔다.
- 기존 URL state, debounce, history, pagination, generation guard를 변경하지 않는다.

### 결과

기업 결과는 Blog post card의 위계를 따르는 밝은 편집형 record로 표시한다.

1. identity label
2. 기업명과 상세 링크
3. 업종·규모·지역
4. 공개 근거 상태 또는 공개 publication count
5. 복지 category badge

근거가 없는 기업은 계속 `게시 가능한 공개 복지 근거 미확인`으로 표현한다. `복지 없음`으로 축약하지 않는다. official/community trust 구분도 유지한다.

## 오류와 데이터 상태

- `PGRST202` configuration 오류는 empty result와 구분한다.
- 사용자에게는 `기업 데이터를 준비하고 있습니다. 잠시 후 다시 확인해 주세요.`와 재시도 action을 표시한다.
- 응답에 내부 RPC 이름, URL, project ref, key, SQL details를 노출하지 않는다.
- 일반 네트워크·timeout·rate limit 오류의 기존 구분은 유지한다.
- UI는 운영 migration 또는 seed 완료를 추정하지 않는다.

## 운영 데이터 복구 경계

UI 작업과 production database mutation을 분리한다.

1. 운영 프로젝트 식별과 CLI 인증 확인
2. `SUPABASE_DB_PASSWORD`를 채팅·로그·CLI literal이 아닌 승인된 secret mechanism으로 설정
3. exact reviewed revision에서 migration dry-run
4. dry-run 결과 검토 후 별도 migration apply 승인
5. independent seed verifier 실행
6. target binding 후 seed importer dry-run
7. 결과 검토 후 별도 seed apply 승인
8. 40,053개 count와 `1,000 / 35,910 / 3,143` identity split read-back
9. 공개 search/detail RPC smoke

현재 등록된 Supabase 정보에는 운영 project ref와 CLI account authorization만 있고 database password 또는 database URL은 없다. 해당 secret이 설정되기 전에는 migration dry-run을 실행하지 않는다.

## 테스트

- React header에 `Benefits`가 정확히 한 번 표시되는지 검증
- Jekyll assembled navigation에 `Benefits`와 `js-no-ajax`가 결속되는지 검증
- primary Benefits tab이 정확히 두 개인지 검증
- legacy heatmap/fit routes가 계속 dispatch되는지 검증
- Blog design token과 responsive width 계약을 source/compiled CSS로 검증
- loading, PGRST202, network error, empty, ready 상태에서 H1이 하나인지 검증
- PGRST202가 empty state가 아닌 준비 중 alert로 표시되는지 검증
- 검색 순서, 44px target, focus-visible, responsive details 재개방 계약 유지
- full frontend test/typecheck/lint/build 실행
- Docker static site assembly 및 verifier 실행
- 배포 후 `/benefits/`와 `/blog/`를 desktop/mobile에서 비교 검증

## 완료 기준

- 글로벌 메뉴는 `Benefits`로 표시된다.
- Benefits 내부 primary 탐색은 두 항목만 표시된다.
- 기존 분석 deep link는 깨지지 않는다.
- Benefits 화면이 Blog와 동일한 밝은 편집형 shell, spacing, typography, color token을 사용한다.
- 동적 검색 동작과 접근성 계약이 유지된다.
- configuration 오류가 빈 데이터처럼 보이지 않는다.
- production 데이터가 보인다는 완료 주장은 migration·seed·RPC read-back이 실제로 끝난 뒤에만 한다.
