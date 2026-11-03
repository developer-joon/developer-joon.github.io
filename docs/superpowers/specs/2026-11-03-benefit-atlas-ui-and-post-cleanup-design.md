# Benefit Atlas UI 및 복지 포스트 정리 설계

## 범위

복지 조사는 기존 `feat/company-benefits-v2` 작업에서 계속 진행한다. 이 작업은 별도 `feat/benefit-atlas-ui` 격리 브랜치에서 UI와 공개 블로그 표현만 개선하며 조사 원장, 승인 상태, canonical batch를 수정하지 않는다.

## 1. 브랜드와 메뉴

- 전역 메뉴의 `기업 복지 탐색기`를 `Benefit Atlas`로 변경한다.
- React 헤더와 Jekyll 메뉴를 함께 변경해 full-document navigation 계약을 유지한다.
- 페이지 H1도 `Benefit Atlas`로 통일한다.
- 보조 문구는 `공개 근거로 살펴보는 기업 복지`와 `확인된 내용과 근거의 한계를 함께 표시합니다.`를 유지한다.
- 내부 기능 탭은 사용성을 위해 한국어를 유지한다: `복지 현황`, `조건 탐색`, `조사 기준·정정 이력`.

## 2. Benefit Atlas 배너

- Community의 전체 폭 배너 구조와 responsive wrapper를 재사용하되 전용 시각 자산을 사용한다.
- 짙은 청록/네이비 바탕에 기업, 복지 분야, 공개 근거의 연결을 추상화한 로컬 SVG를 추가한다.
- SVG는 스크립트, 이벤트 핸들러, `foreignObject`, 외부 참조, 텍스트를 포함하지 않는다.
- 배너는 바깥 full-bleed 영역과 안쪽 공통 wrapper로 구성한다.
- 제목, 설명, 데이터 버전/검증 상태를 배너 안에서 읽을 수 있게 배치한다.
- 모바일에서는 제목과 설명이 한 글자씩 깨지지 않게 `word-break: keep-all`을 적용하고 가로 overflow를 금지한다.
- 전역 헤더와 메뉴의 기존 반응형 치수 및 모바일 56px 터치 영역은 변경하지 않는다.

## 3. 정보 수정 요청

- GitHub Issue 링크와 공개 이슈 제출 경로를 사용하지 않는다.
- 기존 Google 로그인, Supabase 정정 요청 RPC, `/community/benefits/correction/`, `/community/benefits/my-corrections/`를 재사용한다.
- 기업 상세와 방법론 화면에서 `정보 수정 요청` CTA를 명확하게 노출한다.
- 로그인 전에는 Google 로그인 필요성과 동일 사이트 복귀를 안내한다.
- 입력 폼은 기업, 복지 분야, 현재 표시 내용, 제안 내용, 적용 범위, 공개 HTTPS 근거 URL을 받는다.
- 개인정보, 사내 비공개 문서, 인증 필요 자료, 유료 자료를 제출하지 말라는 안내를 폼 가까이에 둔다.
- 제출 후 사용자는 내 요청 화면에서 상태, 관리자 답변, 반영 버전을 확인한다.
- 승인만으로 공개 artifact가 즉시 바뀌지 않는다는 문구를 표시한다.
- obsolete GitHub Issue URL, 텍스트, template, 테스트가 남아 있으면 제거한다.

## 4. 복지 블로그 포스트 정리

### 목적

현재 80개 batch 포스트에는 법인 메타데이터와 반복적인 `게시 가능한 근거를 확인하지 못했습니다` 문단이 대량 포함돼 있다. 이 내용은 조사 원장에는 필요하지만 독자가 읽는 블로그 글에서는 복지 정보로서 가치가 낮다. 블로그는 실제로 설명할 복지 근거가 있는 항목만 보여준다.

### 보존 기준

회사 section은 다음 중 하나 이상을 충족할 때만 포스트에 남긴다.

1. 구체적인 복지 명칭과 내용이 있다.
2. 공개 source body에 결합된 quote 또는 의미 있는 요약이 있다.
3. 법인, 직군, 고용형태, 시점 등 적용 범위를 독자에게 설명할 수 있다.
4. 상충하거나 과거 자료라는 사실 자체가 독자에게 중요한 주의 정보이며 해당 근거가 있다.

다음만 있는 section은 블로그에서 제거한다.

- 법인 ID, 매출, 관할 등 메타데이터만 있음
- URL과 HTTP 상태만 있음
- 접근 실패 또는 `현재 게시 가능한 근거를 확인하지 못했다`는 반복 문구만 있음
- 복지와 관계없는 회사 소개, 재무, 채용 절차만 있음
- source snippet만 있고 factual body가 없음

이 제거는 블로그 표현 정리일 뿐이며 research ledger, receipt, gap, source registry를 삭제하지 않는다.

### 포스트 삭제 기준

- 정리 후 의미 있는 회사 section이 0개인 batch 포스트는 삭제한다.
- 의미 있는 section이 1개 이상이면 해당 section만 남기고 제목/설명을 실제 남은 내용에 맞게 수정한다.
- 삭제된 포스트 링크는 허브에서 제거한다.
- 허브는 남은 국내/해외 포스트 수와 실제 링크를 결정적으로 다시 생성한다.
- 고정 seed Picsum 배너 관례는 유지하고 새 저작권 불명 이미지를 추가하지 않는다.
- 각 포스트의 각주와 source 번호는 남은 본문에 맞게 재정렬하며 orphan 각주를 허용하지 않는다.

### 자동 검증

정리 스크립트 또는 검사기는 다음을 확인한다.

- 포스트마다 의미 있는 복지 section이 1개 이상
- 반복 gap-only 문구가 본문에 없음
- 허브의 모든 링크 대상이 존재
- 삭제된 포스트를 가리키는 링크가 없음
- 본문 각주와 source 정의가 일치
- front matter와 featured image가 유효
- 조사 원장과 canonical artifact는 변경되지 않음

## 5. 테스트와 검증

1. 메뉴명, active route, Jekyll/React shell 계약 테스트를 먼저 실패시킨다.
2. Benefit Atlas 배너 DOM, 접근 가능한 H1, 로컬 SVG asset, 모바일 wrapper 계약 테스트를 추가한다.
3. 정정 CTA가 내부 폼으로 연결되고 GitHub Issue URL이 없음을 테스트한다.
4. correction form의 기존 인증, draft 복구, mutation fail-closed 테스트를 유지한다.
5. 포스트 정리 기준과 허브 링크 무결성 테스트를 추가한다.
6. focused test, 전체 frontend test/typecheck/lint/build, Jekyll assembly verifier를 실행한다.
7. 사용자가 결과 화면을 요청하지 않았으므로 로컬 HTTP/dev/CDP 서버는 실행하지 않는다. 정적 artifact와 테스트로 검증한다.

## 비목표

- 조사 기준 완화
- `no_public_info`를 복지 부재로 표현
- 조사 원장 또는 canonical batch 삭제
- GitHub Issue 기반 정정 흐름 부활
- 새로운 인증 체계 추가
- 80/80 완료 전 vNext를 기본 사용자 화면으로 활성화
- 원격 push, PR, merge, 배포
