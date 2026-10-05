---
title: 'Copilot Code Review API 품질 게이트 — 요청 성공과 병합 허용 사이의 상태 설계'
date: 2026-10-05 07:00:00 +0900
categories: ["AI 개발 도구"]
description: 'Copilot Code Review API를 품질 게이트에 연결할 때 요청 접수, 리뷰 완료, 코멘트 해소, 사람 승인, 병합 허용을 분리해 운영하는 방법을 다룬다.'
featured_image: 'https://picsum.photos/seed/copilot-code-review-api-quality-gate/1600/900'
tags: [github-copilot, code-review, api, quality-gate, pull-request, devsecops]
---

![Copilot Code Review API 품질 게이트](https://picsum.photos/seed/copilot-code-review-api-quality-gate/1600/900)

GitHub는 2026년 10월 2일 Copilot code review를 REST와 GraphQL API로 요청하고, 요청마다 review effort level을 선택할 수 있다고 발표했다. API 지원과 Balanced 기본값 변경은 Copilot Pro, Pro+, Max, Business, Enterprise 계획에 일반 제공(GA)된다.[1] 이제 외부 시스템이 review를 시작할 수 있으므로 **리뷰 요청과 병합 통제 사이에 명시적인 상태 기계가 필요하다.**

API 2xx로 “AI 리뷰 통과” check를 성공시키면 안 된다. 응답은 요청 접수만 증명한다. 리뷰 완료, 검토한 head commit, 남은 지적, 사람 승인, ruleset의 병합 허용은 각각 판정해야 한다.

## 발표에서 확정된 범위

이번 변경으로 지원되는 REST·GraphQL API에서 Copilot 리뷰를 요청하고 요청별 effort를 선택적으로 지정할 수 있다.[1] GitHub 사용 안내는 REST에서 `copilot-pull-request-reviewer[bot]`을 reviewer로 요청하는 방식을 설명한다.[6] 일반 REST 표면은 `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`다. 조회용 `GET`은 아직 리뷰를 제출하지 않은 reviewer를 반환하며, reviewer가 리뷰를 제출하면 요청 목록에서 빠지고 제출된 리뷰 목록으로 이동한다.[4]

GraphQL에서는 login 기반 `requestReviewsByLogin`의 `botLogins`를 쓰거나,[7] ID 기반 `requestReviews`의 `botIds`를 쓴다.[5] 두 mutation의 input에서 `union` 기본값은 `false`다. 생략하면 기존 reviewer 요청 집합을 교체하므로 기존 요청을 보존해 추가하려면 `union: true`를 명시해야 한다.[5][7] effort의 요청별 지정은 발표에서 확정됐지만 REST 속성명이나 GraphQL input field 이름은 발표문에 없다.[1] 필드명을 추측하지 말고 적용 API version과 schema의 실제 계약을 contract test로 고정해야 한다.

GitHub built-in `Default`는 2026년 9월 28일부터 새 조직·저장소와 기존 조직·저장소 모두에서 Balanced로 해석된다. 설정에서 Lite를 명시적으로 골랐다면 그 선택은 유지됐다.[1] 적용 순서는 요청 시 선택한 effort, 같은 PR에서 직전에 사용한 effort, 요청자 설정, 저장소 설정, 조직 설정(개인 소유 저장소는 소유자 설정), GitHub built-in default다.[2]

enterprise, organization, repository, personal 수준을 관리할 수 있고 하위 수준이 상위 수준을 override한다.[1] 요청별 선택은 해당 실행에서 가장 높은 우선순위를 가진다.[2] 따라서 조직 기본값만 보고 실제 effort를 단정하지 말고, 요청값과 완료 후 overview comment에 표시되는 관측값을 함께 보관해야 한다. 설정 문서의 Max는 아직 `Coming soon`이며 사용할 수 없으므로 현재 정책의 실행 가능한 값으로 취급하면 안 된다.[3]

## 다섯 상태를 하나의 성공 플래그로 접지 않는다

핵심 레코드는 `repository`, `pull_number`, `head_sha`, `review_run_id`, `requested_effort`, `observed_effort`를 묶은 review run이다. 같은 PR이라도 commit이 추가되면 이전 결과를 현재 코드에 재사용할 수 없다.

여기서 `review_run_id`와 아래의 `request_accepted → review_completed → comments_resolved → human_approved → merge_allowed`는 **GitHub REST·GraphQL의 공식 도메인 필드나 상태가 아니라 이 글이 제안하는 내부 운영 모델**이다. 다만 GraphQL의 `RequestReviewsInput`과 `RequestReviewsByLoginInput`에는 mutation 응답 payload의 같은 필드로 돌려주는 범용 `clientMutationId`가 있으므로 내부 `review_run_id`를 넣어 요청과 응답을 상관시킬 수 있다.[5][7] 이는 GitHub가 run ID를 발급하거나 상태 전이를 관리한다는 뜻이 아니다.

운영 구현에서는 리뷰를 요청하는 GitHub App 백엔드나 CI 품질 게이트 오케스트레이터가 호출 직전에 UUID/ULID 같은 내부 `review_run_id`를 만들고 자체 저장소에 PR node ID, `head_sha`, 요청 시각·actor·effort와 함께 기록한다. GraphQL을 쓴다면 그 값을 `clientMutationId`로 보내고 응답의 같은 필드를 확인한다. 하지만 이 값은 해당 mutation 호출의 상관 ID일 뿐, 나중에 생성되는 `PullRequestReview`에 영속 연결되는 review 식별자가 아니다.[5][7] REST review-request API에는 이에 대응하는 요청·응답 상관 필드도 없다.[4] 따라서 이후 webhook과 reconciliation에서는 Copilot bot actor, 대상 PR, 검토 commit, 요청·제출 시각을 대조해 제출된 GitHub review를 찾고 그 review의 node ID·URL을 run의 외부 증거로 연결한다. review thread의 node ID와 review comment ID도 같은 run의 하위 증거로 저장한다. 후보 review가 여러 개라 연결이 모호하면 임의로 고르지 않고 `unknown`으로 두어 재조회하거나 사람이 정합성을 확인하는 방식을 권한다.

| 상태 | 필요한 증거 | 아직 증명하지 않는 것 |
|---|---|---|
| `request_accepted` | 요청 응답, PR, 요청 시점 `head_sha`, 요청자, effort | 리뷰 완료, 코멘트 부재, 승인 |
| `review_completed` | Copilot review/overview, 검토 commit, 완료 시각, 실제 effort | 지적 해소, 사람 승인, 최신 head 일치 |
| `comments_resolved` | 해당 run의 actionable thread 해소와 예외 승인 | 새 push 부재, 사람의 최종 승인 |
| `human_approved` | 권한 있는 사람이 현재 `head_sha`에 낸 유효한 approval | ruleset·필수 check·merge queue 충족 |
| `merge_allowed` | 현재 mergeability와 모든 필수 조건 충족 | 실제 merge 또는 배포 성공 |

### 1. request accepted

호출 직전에 `head_sha`를 읽고 요청 레코드를 만든다. 멱등 키는 `repo + PR + head_sha + policy_version + effort`처럼 실행 의도를 구별해야 한다. timeout 뒤 무조건 재호출하면 중복 리뷰를 만들 수 있으므로 requested reviewer, review timeline, 자체 run을 먼저 대조한다. REST 조회에서 Copilot이 사라졌다고 실패로 판단해서도 안 된다. 리뷰를 제출한 reviewer가 요청 대기 목록에서 빠지는 것은 정상이다.[4]

check 이름은 `copilot-review/requested`처럼 좁게 붙인다. `quality/passed`나 `review/approved`는 잘못된 의미를 전달한다. 인증·권한·정책·budget·rate limit 오류는 `request_failed`로 남기되 merge 허용으로 fail-open하지 않는다.

### 2. review completed

완료 판정기는 webhook과 주기적 reconciliation을 함께 사용한다. webhook은 유실·중복·순서 역전이 가능하므로 GitHub의 review와 timeline을 다시 읽어 확정한다. review가 참조한 commit과 현재 `head_sha`가 다르면 run은 `stale`이며 새 review가 필요하다.

완료된 run의 overview comment에는 실제 effort가 표시된다.[2] 요청값과 관측값이 다르면 설정 drift나 계약 변경으로 기록한다. overview 존재는 코멘트 해소나 승인이 아니다. 기본적으로 Copilot은 `Comment` review를 남기며 required approval로 계산되지 않는다.[6]

### 3. comments resolved

review가 만든 코멘트와 thread를 run ID와 `head_sha`에 귀속한다. unresolved thread 수만 0으로 만드는 것으로는 부족하다. suggestion 적용으로 새 commit이 생기면 결과가 stale이고, UI에서 resolve한 행위도 수정의 적절성을 보증하지 않는다. `resolved_by_change`, `accepted_risk`, `false_positive`, `superseded` 같은 사유와 actor를 남긴다.

GitHub도 Copilot이 모든 문제를 찾는다고 보장하지 않으며, 피드백을 검증하고 사람 review로 보완하라고 명시한다.[2] “코멘트 없음”은 결함 없음이 아니라 이번 run에서 actionable comment가 관측되지 않았다는 뜻이다. 고위험 thread의 예외는 작성자가 단독 처리하지 못하게 별도 approver를 요구할 수 있다.

### 4. human approved

사람 승인은 별도 gate다. approver가 코드 소유권과 조직 정책에 맞는지, approval이 최신 `head_sha`를 대상으로 하는지, 새 commit으로 dismiss되지 않았는지 확인한다. Copilot approvals는 public preview다. 기본적으로 Copilot review는 required approval이 아니며, 관리자가 허용한 경우에만 approving review가 요구 조건을 만족할 수 있다. 새 commit 뒤에는 이 approval도 dismiss된다.[2][3]

이 운영 모델은 Copilot approval을 `human_approved`로 승격하지 않는다. 사용하기로 했다면 `automated_approval`이라는 별도 상태로 보존한다. bot identity와 최종 위험을 수락한 사람 identity를 섞지 않기 위해서다.

### 5. merge allowed

마지막 상태는 현재 GitHub ruleset, branch protection, 필수 status check, review, merge queue를 다시 조회한 결과다. `review_completed`와 `comments_resolved`를 custom required check로 게시할 수는 있지만, 테스트 실패나 code owner 미승인 같은 독립 조건은 별도로 남는다.

상태 전이는 단조롭지 않다. 새 commit은 review 완료, 코멘트 해소, 사람 승인을 무효화할 수 있다. 각 상태에 `evaluated_head_sha`, `policy_version`, `observed_at`, `evidence_url`을 저장하고 merge 직전에 다시 계산한다. `merge_allowed`와 실제 `merged`도 별도 상태다.

## effort를 위험 정책으로 사용한다

Lite와 Balanced는 재현 가능한 위험 정책으로 고른다. 인증·권한·결제·암호화·인프라 경로, 여러 서비스에 걸친 변경은 Balanced를 요청하고, 낮은 위험의 국소 변경은 Lite를 요청하는 식이다. GitHub는 Lite를 일반적인 버그·보안 취약점·스타일 문제에 대한 표준 검토, Balanced를 복잡한 로직·보안 민감 코드·cross-service 변경에 대한 더 깊은 분석으로 설명한다.[2] 이는 제품의 사용 목적이지 조직 코드에서의 탐지율 보장이 아니다.

자체 실험 없이 응답시간, 결함 탐지율, 비용 배수, 내부 계산량을 확정값으로 주장하지 않는다. `requested_at`, `completed_at`, 변경 규모, 실제 effort, 유효 comment 수, 재review 횟수, 사람 승인까지의 시간을 관측해 조직 데이터로 만든다. Balanced가 Lite보다 더 많은 AI credits를 쓰고 Actions minutes도 소폭 더 쓸 수 있다는 공식 설명은 정책 입력이지만, 특정 조직의 효과를 대신 측정하지 않는다.[2][3]

## 상태별 영수증과 fail-closed

request receipt에는 endpoint 또는 mutation, actor, `head_sha`, requested effort를 기록한다. GraphQL이면 `clientMutationId`와 `union` 값도 남긴다. completion에는 review ID, reviewed commit, observed effort를 두고, resolution과 approval에는 각각 thread별 처리 사유·예외 승인자와 human review ID·유효 head를 연결한다.

대시보드는 하나의 초록색 체크 대신 `accepted → completed → resolved → human-approved → merge-allowed`를 보여줘야 한다. timeout이나 webhook 부재는 실패가 아니라 관측 지연에 따른 `unknown`일 수 있다. 이때는 재조회하고, 끝내 증거를 확보하지 못하면 fail-closed한다. API가 자동화하는 것은 review 시작이지 merge 허가가 아니므로, merge 직전에 현재 commit을 기준으로 증거 사슬을 다시 계산한다.

## Sources

[1] https://github.blog/changelog/2026-10-02-copilot-code-review-api-support-and-new-default-effort-level — Copilot code review: API support and new default effort level
[2] https://docs.github.com/en/copilot/concepts/agents/code-review — About GitHub Copilot code review
[3] https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review — Configuring code review by GitHub Copilot
[4] https://docs.github.com/en/rest/pulls/review-requests?apiVersion=2026-03-10 — REST API endpoints for review requests
[5] https://docs.github.com/en/graphql/reference/pulls#mutation-requestreviews — GraphQL `requestReviews` mutation
[6] https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-code-review — Using GitHub Copilot code review
[7] https://docs.github.com/en/graphql/reference/pulls#mutation-requestreviewsbylogin — GraphQL `requestReviewsByLogin` mutation
