# Benefit Atlas 검증 혜택·점진 릴리스 설계

## 배경

현재 additive approved-v2 projection은 국내 기업 950개에 적용됐지만, `statement`가 비어 있지 않은 reference/community evidence를 구체 혜택으로 계산한다. 이 규칙은 페이지 본문 덤프, 조사 판정 문장, 검색 결과, 카테고리 간 복제 및 동일 혜택의 다중 출처를 실제 혜택으로 오인한다. 이미 `master`에 들어간 projection의 `specific_benefit_count`와 사용자 노출은 신뢰할 수 없다.

## 목표

1. 검증되지 않은 기존 내용을 즉시 fail-closed로 비노출한다.
2. evidence record와 실제 benefit proposition을 분리한다.
3. 독립 검토된 원자적 혜택만 구체 혜택 수와 카드에 포함한다.
4. 조사 작업은 25개 기업 단위, 공개 checkpoint는 검증된 100개 기업 단위로 운영한다.
5. 최초 골드셋은 국내 25개와 미국 25개, 총 50개 기업으로 계약을 검증한다.
6. 기존 active v1 및 원천 evidence bytes는 감사 이력으로 보존한다.
7. assistant는 검증된 feature branch push까지만 수행하고 PR·merge·배포는 수행하지 않는다.

## 비목표

- 공개 근거가 없는 혜택을 생성하거나 추론하지 않는다.
- 기업 수를 늘리기 위해 검토 기준을 낮추지 않는다.
- 검색 결과 snippet, source title, 카테고리명 또는 페이지 전체를 혜택 설명으로 사용하지 않는다.
- `not_publicly_verifiable`을 단순 미발견이나 접근 실패와 동일시하지 않는다.
- 모든 국가의 모든 법인을 한 번에 모집단으로 선언하지 않는다. 우선 고정된 국내 1,000개와 미국 1,000개를 완료한다.

## 핵심 데이터 모델

### Evidence record

Evidence는 조사 과정에서 확보한 원문·출처·적용 범위다. Evidence 자체는 구체 혜택이 아니다. 기존 official/reference/community 원장은 보존하며, 혜택을 입증하지 못하는 evidence도 감사 목적으로 남길 수 있다.

### Verified benefit proposition

새 `verified_benefits` inventory의 각 항목은 하나의 원자적 혜택을 나타낸다.

필수 필드:

- `benefit_id`: 회사와 proposition identity에 결박된 결정적 ID
- `company_id`
- `primary_category_id`: 정확히 하나의 주 카테고리
- `title`: 원문이 직접 입증하는 짧은 혜택명
- `description`: 원문 범위를 넘지 않는 구체 설명
- `scope`: 국가, 법인, 역할, 고용형태, 가족 대상 및 조건
- `currentness`: 현재·과거·미확인 및 확인 시각
- `conflict_status`
- `evidence_ids`: 하나 이상의 근거 ID
- `review`: `independently_reviewed`, reviewer receipt hash, reviewed candidate hash, 검토 시각

하나의 혜택을 여러 출처가 뒷받침하면 `evidence_ids`만 늘리고 혜택 수는 늘리지 않는다. 하나의 statement를 여러 카테고리에 복제하지 않는다. 교차 검색이 필요하면 별도의 보조 태그를 사용하되 count는 주 카테고리에서만 증가한다.

## 구체 혜택 eligibility

다음 조건을 모두 만족해야 한다.

1. 독립 검토 상태가 `independently_reviewed`다.
2. 하나의 구체 proposition을 설명한다.
3. 정확한 대상 기업 또는 공개된 제한 범위가 확인된다.
4. 카테고리별 최소 인용문이 retained source body에 verbatim으로 존재한다.
5. 모든 evidence와 source가 credential 없는 HTTPS 공개 출처에 결박된다.
6. 페이지 덤프, 조사 메타 문장, 검색 결과, 다른 기업 내용, 장래 계획 및 법정 의무 설명이 아니다.
7. 동일 회사·동일 proposition과 중복되지 않는다.

어느 하나라도 실패하면 raw evidence로만 남고 `specific_benefit_count`에는 기여하지 않는다.

## 긴급 정정

현재 projection을 새 계약으로 재생성한다.

- 기존 reference/community evidence는 삭제하지 않는다.
- 검증 혜택 inventory는 비어 있는 상태로 시작한다.
- 모든 기존 `specific_benefit_count`를 0으로 재계산한다.
- evidence가 있지만 검증 혜택이 없으면 `구체 혜택 재검증 중`으로 표시한다.
- 기존 `no_public_info`가 필수 route closure를 증명하지 못하면 `research_incomplete`로 낮춘다.
- `not_publicly_verifiable`은 필수 route와 plausible lead가 terminal하게 해결된 경우에만 허용한다.
- projection 전체의 listing/detail/count parity와 source closure를 재검증한다.

이 정정은 잘못된 정보를 감추는 것이 아니라, raw evidence와 공개 가능한 사실을 분리하는 조치다.

## 조사·검토 상태 머신

```text
not_researched
  -> acquisition_in_progress
  -> candidate_extracted
  -> machine_validated
  -> pending_independent_review
  -> independently_reviewed
  -> promoted
```

실패·보류 상태:

- `research_incomplete`: 필수 route 또는 plausible lead가 남음
- `source_access_failed`: 접근 실패가 있어 absence를 결론낼 수 없음
- `conflicting_evidence`: 상충이 해결되지 않음
- `not_publicly_verifiable`: 필수 조사 경로가 terminal하게 닫혔지만 게시 가능한 혜택을 확인하지 못함

수집자가 자신이 만든 candidate를 승인할 수 없다. 검토자는 exact candidate bytes와 source closure를 재현하고 승인 receipt를 repository 외부에 발급한다.

## 25개 조사 배치와 100개 릴리스 checkpoint

### 조사 배치

- canonical membership 25개 기업
- 기업당 canonical 10개 카테고리, 총 250개 cell
- exact company IDs와 category order 고정
- candidate package, source captures, checksums, independent review receipt를 하나의 immutable package로 관리

### 릴리스 checkpoint

- 검증 완료된 25개 조사 배치 4개를 묶어 기업 100개로 구성
- 정확히 100개 기업, 1,000개 cell의 상태를 포함
- benefit count는 verified proposition 수, evidence count는 별도 메타데이터
- checkpoint는 이전 공개 상태에 additive하게 적용하되, 동일 기업의 새 revision은 명시적 correction 이벤트로만 교체
- 이전 checkpoint가 merge된 최신 `master`에서 다음 branch를 생성

최초 checkpoint는 계약 검증을 위해 국내 `domestic-01` 25개와 미국 `international-01` 25개, 총 50개 골드셋으로 예외적으로 작게 운영한다. 두 배치 모두 기존 승인 여부와 무관하게 새 proposition 계약으로 재검토한다.

## 브랜치 정책

1. `fix/benefit-atlas-verified-batch-release`: 긴급 정정, 계약, 골드셋 기반을 포함하는 최초 branch
2. 이후 `feat/benefit-atlas-verified-0051-0150`처럼 checkpoint 범위를 명시
3. 각 branch는 직전 checkpoint가 merge된 최신 `origin/master`에서 시작
4. assistant는 feature branch를 한 번 push하고 원격 SHA를 read-back 검증
5. PR 생성, merge, deployment는 수행하지 않음

## 검증 게이트

### Pre-flight gate

- clean canonical HEAD
- 정확한 batch membership과 250-cell set equality
- source 이용 조건과 credential 미포함
- producer/reviewer 분리

### Candidate gate

- 원자적 proposition schema
- quote verbatimness
- entity·category·scope·currentness 결박
- page dump/meta/search shell/cross-company/cross-category replay 거부
- proposition dedupe 및 다중 source grouping

### Promotion gate

- exact candidate hash와 external independent review receipt
- global ID/source collision 검사
- package inventory와 `SHA256SUMS` exact equality
- canonical ledger mutation 전 모든 검증 완료

### Release gate

- listing/detail `specific_benefit_count` exact parity
- artifact verifier와 mutation tests
- Community tests, typecheck, lint, build
- static-site Docker build 및 exported artifact verification
- browser smoke는 명시적으로 요청되거나 release gate가 자체 관리하는 일시적 서버만 사용하고 종료

## 제품 표시

전체 진행률을 다음처럼 분리한다.

- 전체 대상 기업
- 조사 완료 기업
- 검증 혜택 보유 기업
- 재검증 대기 기업
- 공개 근거 확인 불가 기업
- 마지막 checkpoint 일자

기업 상세는 검증 혜택, evidence-only, 연구 미완료, 접근 실패, 상충, 공개 확인 불가를 구분한다. `공개 정보 없음`은 사용하지 않는다.

## 성공 기준

1. 현재 잘못 분류된 1,988 evidence record가 구체 혜택 수로 노출되지 않는다.
2. verified proposition 없이 `specific_benefit_count > 0`을 만들 수 없다.
3. 하나의 proposition을 여러 source가 지원해도 count는 1이다.
4. 하나의 statement를 여러 카테고리에 복제하면 verifier가 거부한다.
5. 최초 50개 기업 골드셋은 국내 25개·미국 25개 exact membership을 가진다.
6. 이후 100개 checkpoint는 승인된 25개 배치 네 개의 exact union이다.
7. branch push, PR, merge, 배포 상태를 각각 별도로 보고한다.
