# Benefit Atlas 구체 혜택 내용 설계

## 목적

Benefit Atlas가 `건강`, `육아·가족`, `통근` 같은 분류의 존재 여부만 보여주는 문제를 수정한다. 사용자는 각 기업이 실제로 제공한다고 공개 근거에서 확인된 혜택 내용과 적용 조건을 먼저 확인해야 한다.

## 원칙

1. **구체 내용 우선**: 카테고리는 탐색·필터용 보조 정보이며, 기업 상세의 핵심 정보는 근거가 말하는 실제 혜택 내용이다.
2. **근거 문장 보존**: 현재 승인된 reference/community 레코드의 `statement`를 사용자용 혜택 설명으로 사용한다. 금액, 대상, 노선, 재직 조건 등을 임의로 축약하거나 추론하지 않는다.
3. **원문 검증 가능성**: 혜택 설명마다 supporting quote(존재하는 경우), 출처 링크, 현재성, 적용 범위, 신뢰도, 상충 상태를 함께 제공한다.
4. **구체 내용 없는 공식 근거는 혜택으로 노출하지 않음**: 현재 official claim은 카테고리·출처·범위만 있고 혜택명·설명이 없다. 이를 실제 혜택으로 표시하지 않고 `구체 혜택 확인 필요`로 낮춰 표시한다.
5. **무근거 합성 금지**: 카테고리명, 출처 제목 또는 긴 인용문에서 혜택명을 자동 생성하지 않는다. 공개 artifact에 구조화된 구체 설명이 없으면 구체 혜택으로 간주하지 않는다.
6. **기존 lineage 보존**: active v1과 additive approved-v2 projection 구조는 유지한다. 이번 변경은 승인된 projection의 해석·표시 계약을 강화하는 후속 변경이다.

## 사용자 경험

### 기업 상세

`승인 v2 조사 근거` 영역 위에 `확인된 복지 혜택`을 배치한다.

각 혜택 카드는 다음을 표시한다.

- 분야: 예) 통근
- 혜택 내용: 근거 레코드의 `statement`
- 확인 수준: 공식 확인 / 참고 자료 / 커뮤니티 보고
- 적용 대상과 범위
- 현재성·신뢰도·상충 상태
- 원문 인용과 출처 링크

reference/community 레코드가 여러 개면 각각 별도 카드로 표시하며, 같은 문장을 근거 ID 기준으로 중복 렌더링하지 않는다.

구체 설명이 없는 official claim만 존재하는 카테고리는 다음과 같이 표시한다.

> 구체 혜택 확인 필요 — 공식 출처와 적용 범위는 확인됐지만, 공개 데이터에 혜택명과 지원 내용이 구조화되지 않았습니다.

이를 `확인된 복지 혜택` 개수에 포함하지 않는다.

### 목록·히트맵·비교

- 카테고리별 evidence state와 구체 혜택 보유 여부를 분리한다.
- 구체 statement가 하나 이상 있는 셀만 `혜택 내용 확인`으로 표시한다.
- evidence는 있으나 구체 statement가 없는 셀은 `구체 혜택 확인 필요`로 표시한다.
- `no_public_info`와 pending 기업은 기존 문구를 유지하며 서로 합치지 않는다.
- 비교 화면에서는 카테고리명만 나열하지 않고, 기업별 구체 statement의 짧지 않은 원문 문장을 표시한다. UI 폭을 위해 임의 절단하지 않으며 접기/펼치기를 사용한다.

## 데이터·도메인 계약

새로운 혜택명을 추론해 artifact에 저장하지 않는다. 현재 승인 데이터에서 다음 판정 함수를 공통 사용한다.

- `specificBenefitRecords(detail, category)`
  - 게시 가능한 reference record의 `statement`
  - 게시 가능한 community report의 `statement`
  - 향후 `benefit_name`과 `detail`을 갖춘 official record가 계약에 추가되면 그때 포함
- 현재 official claim은 구체 필드가 없으므로 결과에서 제외한다.
- `hasSpecificBenefitContent(detail, category)`는 위 결과가 한 건 이상일 때만 참이다.

목록 artifact에는 상세 statement가 없으므로 구체 혜택 존재를 listing outcome의 evidence ID로 추정하지 않는다. 회사 상세 shard를 로드한 화면에서만 확정 판정한다. 목록·히트맵에 이를 표시하려면 generator가 detail에서 계산한 `specific_benefit_count`를 listing outcome에 추가하고 verifier가 상세 shard의 실제 게시 가능한 statement 개수와 정확히 결박한다.

`official_verified` state만으로 `specific_benefit_count > 0`을 만들 수 없다. reference/community statement만 현재 구체 혜택 count에 포함한다.

## 실패 처리

- listing의 `specific_benefit_count`와 detail의 게시 가능한 statement 개수가 다르면 projection 전체 로드를 실패시킨다.
- 빈 문자열, 공백뿐인 statement, eligibility가 허용되지 않은 record/source는 count와 렌더링에서 제외하지 않고 artifact 자체를 거부한다. 조용한 fallback은 없다.
- 구체 혜택이 없는 셀을 카테고리 이름만으로 실제 혜택처럼 렌더링하는 경로를 테스트로 금지한다.
- credential 없는 HTTPS 출처, evidence/source limitation binding, canonical company/cell binding 규칙을 그대로 유지한다.

## 검증

1. reference statement가 혜택 카드의 중심 내용으로 렌더링된다.
2. community statement가 낮은 근거 수준과 함께 렌더링된다.
3. official-only 셀은 실제 혜택이 아니라 `구체 혜택 확인 필요`로 표시된다.
4. statement가 없는 record로 구체 혜택 count를 올릴 수 없다.
5. listing/detail count mismatch와 eligibility mutation은 client와 Node verifier 모두 거부한다.
6. 현재 canonical projection을 재생성하여 950개 기업·9,500셀 전체에 대해 count가 일치한다.
7. Community 전체 테스트, typecheck, lint, build, artifact verifier, Docker 통합 사이트 빌드와 host-side verifier를 통과한다.

## 비범위

- 근거 문장에서 혜택명·금액·조건을 LLM으로 추출하거나 자동 요약하지 않는다.
- pending 1,050개 기업을 조사 완료 상태로 바꾸지 않는다.
- official claim 원장을 근거 없이 보강하지 않는다.
- PR 생성, merge, 배포는 수행하지 않는다.
