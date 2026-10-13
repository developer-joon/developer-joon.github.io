---
title: 'AI 코드 리뷰 비용은 누가 내는가: Copilot quota·조직 예산·외부 라이선스 권한 분리'
date: 2026-10-14 05:10:00 +0900
categories: ["AI 개발 도구"]
description: 'Copilot code review의 요청 권한, member entitlement, 저장소 소유 조직의 AI Credits, 외부 라이선스 제한, 예산 소진을 서로 다른 정책 결정으로 분리한다.'
featured_image: 'https://picsum.photos/seed/copilot-code-review-billing-authorization/1600/900'
tags: [github, github-copilot, code-review, ai-credits, billing, authorization, budget, pull-request]
---

![Copilot code review 비용 귀속과 호출 권한](https://picsum.photos/seed/copilot-code-review-billing-authorization/1600/900)

외부 기여자가 개인 Copilot 라이선스로 조직 저장소의 pull request에 리뷰를 요청했다. 이 리뷰의 비용은 개인 quota에서 빠지는가, 저장소 소유 조직이 내는가. 조직이 대신 결제하도록 바꾸면 그 기여자에게 리뷰 요청 권한도 생기는가. 반대로 외부 라이선스를 막으면 ruleset이 자동으로 시작한 리뷰까지 멈추는가.

GitHub가 2026년 10월 8일 발표한 Copilot code review 관리 기능은 이 질문들을 한 설정으로 해결하지 않는다. 조직은 유료 Copilot 라이선스가 있는 **멤버의 리뷰 사용량을 멤버 entitlement에 귀속할지 저장소 소유 조직에 귀속할지** 선택할 수 있다. 별도 설정으로는 외부에서 제공된 Copilot 라이선스를 가진 사람이 리뷰를 요청할 수 있는지 제한할 수 있다.[1] 즉 이번 변경의 핵심은 “조직이 AI 리뷰를 구매한다”가 아니라, 비용 귀속과 호출 권한을 서로 독립된 정책 축으로 다룰 수 있게 된 것이다.

이 글은 리뷰 결과의 품질을 평가하거나 모델별 비용을 라우팅하는 방법을 다루지 않는다. 초점은 더 좁다. **누가 요청할 수 있는가, 어떤 entitlement가 사용되는가, 어느 계정이 비용을 부담하는가, 어떤 budget이 요청을 막는가, 실패한 리뷰를 release gate가 어떻게 해석할 것인가**를 분리해 운영 계약으로 만드는 방법이다.

## 먼저 다섯 가지 결정을 분리한다

Copilot code review 한 건을 “사용자 A가 조직 B의 저장소에서 실행했다”로만 기록하면 정책 충돌을 설명하기 어렵다. 최소한 다음 다섯 값을 따로 봐야 한다.

| 결정 | 답해야 하는 질문 | 대표 입력 |
|---|---|---|
| Request authorization | 이 주체가 리뷰를 시작할 수 있는가 | 라이선스 제공자, 조직·저장소 authorized-user 설정, 요청 경로 |
| Entitlement owner | 기본적으로 어떤 Copilot entitlement를 사용하는가 | 요청자 또는 PR 작성자의 유료 Copilot 라이선스 |
| Repository owner | 어느 조직의 저장소에서 리뷰가 실행되는가 | base repository 소유 계정 |
| Billing source | AI Credits 사용량을 누구에게 귀속하는가 | Member 또는 Organization 정책 |
| Availability limit | 지금 요청을 실제로 처리할 예산이 남았는가 | 사용자 budget, 조직·cost center·enterprise 한도 |

이 값들은 서로 추론할 수 없다. 저장소 write 권한이 있다고 해서 그 조직이 제공한 Copilot 라이선스를 가졌다는 뜻은 아니다. 조직이 비용을 부담하도록 설정했다고 해서 외부 기여자가 자동으로 authorized user가 되는 것도 아니다. 요청자가 UI에서 Copilot을 reviewer로 선택할 수 있었다고 해서 review가 끝까지 실행되거나 release gate가 만족됐다는 뜻도 아니다.

공식 문서상 code review는 실행될 때 AI Credits를 소비하며, 자동 리뷰는 기본적으로 PR 작성자에게, 다른 사용자가 수동 요청한 리뷰는 그 요청자에게 사용량이 귀속된다. Copilot cloud agent가 만든 PR은 먼저 human co-author에게 귀속하고, 그 사람에게 청구할 수 없으면 조직에 귀속한다. 다른 bot이 만든 PR 또는 bot이 요청한 리뷰는 조직에 직접 귀속된다.[2] 이 규칙은 “어떤 사람과 사건을 사용량에 연결하는가”를 설명한다. 조직의 새 Member/Organization 선택은 그중 유료 Copilot 라이선스를 가진 조직 멤버와 연결된 사용량의 billing source를 바꾸는 설정이다.[2]

## 기본값은 Member이고, quota 소진은 review 실패다

`Choose how members with a Copilot license are billed`의 기본값은 **Member**다. 이 상태에서는 조직 멤버와 연결된 code review가 그 멤버의 Copilot entitlement를 사용하며, 멤버 quota가 소진되면 code review가 실패한다.[1] “조직 저장소에서 실행됐으니 조직 budget으로 자동 fallback한다”는 보장은 없다.

여기서 Member는 설정의 billing option 이름이다. 운영 문서에는 “개인 돈” 대신 `billing_policy=member`, `attributed_actor`, `applicable_user_budget`처럼 관측 가능한 값을 쓴다.

조직 설정 화면에서는 Member와 Organization 가운데 하나를 선택하며, 이 선택은 수동 요청과 자동 리뷰 모두에 적용된다. 문서는 이 변경이 **billing만 바꾸고 code review 접근 권한을 부여하지는 않는다**고 명시한다.[3] 따라서 다음 두 요청은 결과가 달라질 수 있다.

```text
요청 A: 조직 멤버 + 조직이 제공한 유료 Copilot 라이선스
  authorization: 허용
  billing policy: Member
  member quota: 소진
  결과: review 실패

요청 B: 같은 멤버, 같은 저장소
  authorization: 허용
  billing policy: Organization
  organization paid usage: 활성
  applicable budget: 사용 가능
  결과: 조직 billing source로 처리 가능
```

두 번째 흐름도 성공을 보장하지 않는다. 서비스 오류처럼 다른 실패 원인이 남는다. 핵심은 **Member quota 소진을 billing-related failure로 분류하는 것**이다.

## Organization billing은 권한 부여가 아니라 비용 귀속 변경이다

Organization을 선택하면 유료 Copilot 라이선스가 있는 멤버와 연결된 리뷰 사용량을 **저장소를 소유한 조직**에 귀속한다.[1][3] 이 옵션을 사용하려면 해당 조직에서 `AI credits paid usage`가 활성화돼 있어야 한다. Budget 설정은 선택 사항이다.[1][3]

여기에는 자주 섞이는 세 문장이 있다.

1. `Organization billing을 선택했다.`
2. `AI credits paid usage를 활성화했다.`
3. `추가 사용량을 멈추는 budget을 설정했다.`

첫 문장은 code review billing source 선택이다. 둘째는 조직이 포함량을 넘는 AI Credits 유료 사용을 받아들일 수 있게 하는 전제다. 셋째는 지출 또는 사용 중단 경계를 추가하는 선택이다. GitHub의 usage-based billing에서 AI Credits는 token 사용량과 모델에 따라 계산되고 1 credit은 0.01달러로 환산된다.[4] 그러나 이 글의 정책 핵심은 단가가 아니라 **어느 budget graph를 통과해야 요청이 실행되는가**다.

Budget이 항상 hard cap인 것은 아니다. 사용자 단위 budget은 pool과 metered usage 양쪽에서 hard stop으로 동작한다. 반면 cost center·organization·enterprise budget은 shared pool 소진 뒤 적용되며, `Stop usage when budget limit is reached`를 켜야 사용을 멈춘다.[5]

따라서 “조직 budget 1,000달러”라는 한 줄로는 충분하지 않다. 운영자는 최소한 다음을 함께 기록해야 한다.

- AI credits paid usage가 활성화됐는가
- Member와 Organization 중 어느 billing policy가 적용되는가
- 사용자 단위 budget이 있는가
- 조직이 어느 cost center에 연결됐는가
- organization·cost center·enterprise limit 중 어느 것이 적용되는가
- 각 metered budget에 stop-usage가 켜져 있는가
- limit 도달 시 code review를 필수 check가 어떻게 해석하는가

Organization billing은 비용을 중앙화하지만 무제한 가용성을 뜻하지 않는다. 공식 code review 문서는 선택된 billing source에 적용되는 budget이 소진되면 리뷰가 차단된다고 설명한다. 사용자에게 귀속되면 사용자 budget, 조직에 귀속되면 관련 organization budget·cost center budget·enterprise spending limit이 중단 지점이 된다.[2]

## 외부 라이선스 제한은 별도의 authorization gate다

기본 상태에서는 유료 Copilot 라이선스가 있고 저장소에 접근할 수 있는 사람이 그 라이선스로 Copilot review를 요청할 수 있다. 여기서 외부 Copilot 라이선스란 저장소를 소유한 조직이나 enterprise가 제공하지 않은 라이선스이며, 개인 라이선스나 다른 조직이 제공한 라이선스가 예다.[1][2]

조직 owner 또는 repository admin은 `Only allow Copilot code review to be triggered by authorized users`를 켜서 이 경로를 제한할 수 있다. 활성화하면 조직 또는 enterprise가 제공한 Copilot 라이선스를 가진 사람만 해당 범위에서 요청할 수 있다.[1] Organization 수준에서 켠 설정은 조직의 모든 저장소에 적용되고 repository admin이 끌 수 없다.[1][3] Repository 수준에서는 해당 저장소만 더 엄격하게 만들 수 있다.

여기서 상속 범위를 과장하면 안 된다. 공식 설정 문서가 보장하는 것은 **조직 수준에서 활성화한 제한을 저장소에서 해제할 수 없고, 조직의 모든 저장소에 적용한다**는 것이다.[3] 이를 모든 enterprise 정책이 항상 repository까지 같은 방식으로 상속된다거나, fork network 전체가 하나의 authorization domain이 된다거나, 모든 Copilot 기능에 같은 제한이 적용된다는 주장으로 넓혀서는 안 된다.

또한 authorized-user 설정과 “라이선스가 없는 조직 멤버의 code review 허용” 정책은 같은 기능이 아니다. 후자는 Copilot Business 또는 Enterprise 조직에서 `AI credits paid usage`와 별도의 허용 정책을 모두 켰을 때, Copilot 라이선스가 없는 조직 멤버가 GitHub.com의 자기 PR에서 review를 요청할 수 있게 하는 경로다.[2] 이 사용자는 월별 code review allowance가 없으므로 해당 사용량은 조직 또는 enterprise의 paid additional usage로 직접 청구되고 개인 budget에는 귀속되지 않는다.[2]

즉 사용자를 다음처럼 단순히 `licensed=true/false`로만 나누면 안 된다.

| 주체 | 확인할 entitlement·정책 | authorization 질문 | billing 질문 |
|---|---|---|---|
| 조직 제공 유료 라이선스 멤버 | 제공 조직·enterprise, code review 정책 | 요청 가능한가 | Member인가 Organization인가 |
| 외부 유료 라이선스 사용자 | 개인 또는 다른 조직이 제공한 라이선스 | authorized-user 제한에 걸리는가 | 허용될 때 어떤 entitlement가 사용되는가 |
| 라이선스 없는 조직 멤버 | without-license 허용 정책, GitHub.com 범위 | 자기 PR에서 허용됐는가 | 조직 paid additional usage가 가능한가 |
| bot·Copilot cloud agent PR | human co-author·bot 귀속 규칙 | 어떤 자동화가 review를 시작했는가 | 사람에게 귀속 가능한가, 조직 직접 귀속인가 |

## 수동·자동·API 요청은 같은 호출 경로가 아니다

수동 요청은 GitHub.com의 Reviewers 영역에서 Copilot을 선택하는 방식이며, REST API에서는 `copilot-pull-request-reviewer[bot]`을 reviewer로 요청할 수 있다.[6] 하지만 API 호출에 필요한 pull request write 권한과 Copilot review를 시작할 authorization은 같은 검사가 아니다. Authorized-user 제한이 켜진 상태에서 권한 없는 사람이 보낸 API review request는 review를 시작하지 않는다.[2]

자동 리뷰는 다시 두 종류로 나눠야 한다.

- **개인 설정 기반 자동 리뷰**: 사용자가 자신이 만든 PR에 대해 켠 설정
- **repository 또는 organization ruleset 기반 자동 리뷰**: 관리자가 대상 branch·repository에 적용한 정책

공식 문서는 authorized-user 제한이 켜지면 권한 없는 사람의 개인 설정 기반 자동 리뷰는 실행되지 않지만, repository 또는 organization ruleset으로 구성한 자동 리뷰는 계속 실행된다고 설명한다.[2] 따라서 외부 라이선스를 막는 토글을 “모든 자동 리뷰 중지” 버튼으로 사용하면 안 된다. Ruleset이 계속 review를 만들 수 있고, 그 사용량의 귀속과 budget도 별도로 평가된다.

자동 리뷰의 기본 attribution도 명시해야 한다. Repository가 모든 새 PR에 review를 자동 요청하도록 구성된 경우 AI Credits는 PR 작성자에게 귀속된다. 다른 사용자가 수동으로 요청하면 그 요청자에게 귀속된다.[2] Organization billing을 선택한 조직 멤버에 대해서는 billing source가 조직으로 바뀔 수 있지만, 누가 자동 리뷰를 발생시킨 PR의 작성자인지는 감사 데이터에서 지우지 않는 편이 좋다. Attribution actor와 payer를 한 필드로 합치면 나중에 어느 ruleset과 어느 작성 패턴이 사용량을 만들었는지 알 수 없다.

## External collaborator와 fork는 문서가 말한 범위까지만 쓴다

Outside collaborator는 조직 멤버가 아니어도 저장소 접근 권한을 가질 수 있다. 그 사람이 개인 또는 다른 조직의 유료 Copilot 라이선스를 가지고 있다면 기본 정책에서는 외부 라이선스로 review를 요청할 수 있고, authorized-user 제한을 켜면 그 외부 라이선스를 이용한 요청이 차단 대상이 된다.[1][2] 여기까지는 공식 정의에서 직접 따라오는 범위다.

하지만 “모든 external collaborator가 차단된다”고 쓰면 과장이다. 판정 기준은 collaborator라는 GitHub 역할 이름 자체가 아니라, 저장소 소유 조직·enterprise가 제공한 라이선스로 authorized됐는지와 해당 설정이 켜졌는지다.[1][2] 반대로 collaborator 권한이 있다는 사실만으로 조직이 그 사람의 review 비용을 반드시 부담한다고 말할 수도 없다. 접근 권한, Copilot entitlement 제공자, billing policy를 따로 확인해야 한다.

Fork도 base repository와 head repository를 구분해야 한다. 공개 문서는 이번 설정을 “organization 또는 single repository에서 external license의 review 요청을 제한”하는 것으로 설명하지만, fork network에 대한 별도 비용 상속 규칙이나 upstream 조직이 모든 fork의 요청을 통제한다는 계약을 제시하지 않는다.[2][3] 그러므로 운영 문서에는 다음과 같이 보수적으로 적는다.

```text
- review가 어느 pull request와 어느 base repository에서 실행됐는지 기록한다.
- base repository owner의 조직·저장소 설정을 확인한다.
- head가 fork라는 이유만으로 payer나 authorized 상태를 추정하지 않는다.
- 개인 소유 fork와 조직 소유 fork에서 실제 UI·API·ruleset 결과를 fixture로 확인한다.
```

개인 저장소에 대해서는 공식 문서가 더 구체적이다. Authorized-user 제한이 켜져 있으면 repository owner 또는 direct collaborator만 review를 요청할 수 있다.[2] 이 문장을 조직 소유 저장소의 모든 outside collaborator 규칙으로 일반화하지 않는다. 개인 저장소, 조직 저장소, fork의 소유 계정은 서로 다른 정책 범위다.

## Quota·budget 소진을 release gate에서 별도 상태로 만든다

Copilot review를 필수 release signal로 사용한다면 `review comment가 없음`을 한 상태로 처리해서는 안 된다. 적어도 다음 상태를 구분해야 한다.

| 상태 | 의미 | 권고하는 gate 처리 |
|---|---|---|
| `NOT_AUTHORIZED` | 외부 라이선스 제한 등으로 요청자가 review를 시작할 수 없음 | 승인된 요청자로 재요청하거나 ruleset 경로 확인 |
| `MEMBER_QUOTA_EXHAUSTED` | Member 기본 billing에서 멤버 quota 소진 | 조직 billing 전환을 자동 승인하지 말고 owner 결정 요구 |
| `ORG_BUDGET_BLOCKED` | 선택된 조직 billing source의 hard stop 도달 | 비용 owner가 budget 또는 범위를 조정할 때까지 대기 |
| `REQUEST_ACCEPTED` | 요청은 접수됐으나 완료 전 | 성공으로 간주하지 않음 |
| `REVIEW_COMPLETED` | 해당 head SHA에 review 결과 존재 | 이후 push 여부와 merge 정책을 별도 확인 |
| `REVIEW_UNAVAILABLE` | 서비스·기타 원인으로 완료되지 않음 | 재시도와 수동 fallback 정책 적용 |

앞의 제품 상태 중 quota·budget 차단은 공식 동작에 근거하고, 상태 이름과 gate 처리 방식은 이 글의 운영 제안이다.[1][2] 중요한 원칙은 비용 부족을 코드 품질 판정으로 번역하지 않는 것이다. `MEMBER_QUOTA_EXHAUSTED`는 변경이 안전하다는 뜻도, 위험하다는 뜻도 아니다. 단지 요구한 review evidence가 만들어지지 않았다는 뜻이다.

필수 gate라면 fail-closed가 자연스럽지만, 모든 저장소가 같은 복구 경로를 가질 필요는 없다. Production 저장소에서는 해당 head SHA의 Copilot review가 없으면 merge를 보류하고, 승인된 human reviewer로 대체할 수 있는지 명시한다. 비핵심 저장소에서는 수동 review fallback을 허용할 수 있다. 어느 경우든 “budget이 없으므로 check를 성공 처리”하지 말고 `waiver_reason`, `approver`, `head_sha`, `expires_at`을 남긴다. 이는 GitHub가 제공한다고 보장한 필드가 아니라 조직의 release 기록 제안이다.

Budget 증액도 review 요청자가 직접 수행하는 fallback으로 두지 않는다. Organization billing과 paid usage는 비용 owner의 정책이며, PR 작성자의 merge 긴급성이 지출 권한을 만들지는 않는다. 요청자는 실패 원인과 head SHA를 제시하고, 비용 owner는 budget 변경 또는 다른 review path를 선택하며, release owner는 필요한 evidence가 생겼는지 확인한다.

## 설정 조합은 사람 유형별 fixture로 검증한다

문서만 읽고 정책을 배포하면 정상적인 외부 기여 흐름이나 ruleset 자동 리뷰를 잘못 이해하기 쉽다. Production 적용 전 별도 test repository에서 다음 행렬을 실행한다.

| Fixture | 요청 경로 | 확인할 결과 |
|---|---|---|
| 조직 제공 라이선스 멤버 | UI 수동 요청 | Member/Organization 선택에 따른 billing source와 quota 실패 |
| 외부 개인 라이선스 collaborator | UI 수동 요청 | authorized-user off/on에 따른 reviewer 노출·요청 결과 |
| 같은 외부 사용자 | REST API 요청 | API가 성공 응답처럼 보여도 review가 실제 시작됐는지 |
| 외부 사용자 PR | 개인 자동 리뷰 | 제한 활성화 시 실행되지 않는지 |
| 외부 사용자 PR | repository ruleset 자동 리뷰 | 제한과 별개로 계속 실행되는지, 누구에게 귀속되는지 |
| 라이선스 없는 조직 멤버 | 자기 PR 수동·자동 리뷰 | 두 정책 전제와 조직 paid usage 기록 |
| Copilot cloud agent PR | ruleset 자동 리뷰 | human co-author 우선 귀속과 조직 fallback |
| 다른 bot 작성 PR | ruleset 자동 리뷰 | 조직 직접 귀속과 budget 차단 |
| fork에서 온 PR | UI·API·ruleset | base owner 설정과 실제 payer, 미문서화된 차이 |

API 검증에서는 HTTP status만 보지 않는다. 요청 뒤 PR timeline에 Copilot review가 시작됐는지, 완료 결과가 어느 head SHA에 붙었는지, billing report에 어느 account·product로 나타나는지를 read-back한다. GitHub는 조직의 AI Credit usage report를 조회하는 REST endpoint를 제공하며 year·month·day·user·model·product로 필터링할 수 있다고 문서화한다.[7] 다만 보고서의 집계 지연과 세부 필드는 자기 계정에서 확인하고, 공개 문서에 없는 per-review charge ID를 가정하지 않는다.

## 운영 데이터는 actor와 payer를 모두 남긴다

비용 보고서를 payer 기준으로만 집계하면 외부 collaborator, 자동 review, bot PR이 만든 패턴을 놓친다. 반대로 actor만 보면 실제 charge의 cost center를 알 수 없다. 조직 내부 review receipt에는 `base_repository`, `head_sha`, `request_mode`, `request_actor`, `pull_request_author`, `copilot_license_provider`, `authorization_result`, `billing_policy`, `billing_source`, `applicable_budget_scope`, `review_result`를 분리해 남기는 편이 좋다. 이는 GitHub의 단일 API schema가 아니라 운영 제안이다. 수집할 수 없는 값은 `unknown`으로 남기고 이메일 도메인이나 collaborator 역할로 라이선스 제공자를 추측하지 않는다.

관측 지표도 품질 점수 대신 이 정책의 실패를 본다.

- Member quota 소진으로 실패한 review 수
- Organization billing 전환 전후 조직 부담 review 수
- 외부 라이선스 요청의 허용·차단 수와 요청 경로
- 개인 자동 설정과 ruleset 자동 리뷰가 만든 사용량 비율
- 사용자·조직·cost center·enterprise budget별 block 수
- Review 미완료 때문에 release gate가 대기한 시간
- Waiver로 대체된 review와 승인자·만료 누락률
- Bot·fork·external collaborator fixture의 정책 drift

이 지표는 Copilot이 좋은 reviewer인지 평가하지 않는다. 설정한 entitlement·authorization·billing 경계가 실제 요청에서 유지되는지만 확인한다.

## 배포 순서는 billing과 authorization을 따로 바꾼다

두 설정을 같은 날 전사 적용하면 실패 원인을 구분하기 어렵다. 다음 순서가 안전하다.

**1단계: 현재 흐름을 inventory한다.** 저장소별 자동 review ruleset, 외부 collaborator, bot PR, Copilot 라이선스 제공자, 현재 Member quota 실패를 수집한다. 아직 billing source나 authorized-user 정책을 바꾸지 않는다.

**2단계: billing만 제한적으로 전환한다.** 소수 저장소에서 Organization을 선택하고 AI credits paid usage 상태, 적용 budget, stop-usage 여부를 확인한다. 수동과 자동 리뷰가 모두 새 billing source를 따르는지 report로 read-back한다. 이 단계에서 외부 라이선스 정책은 그대로 둬 비용 효과와 권한 효과를 섞지 않는다.

**3단계: authorization을 별도 적용한다.** 외부 라이선스 사용이 허용돼야 하는 협업 유형을 정리한 뒤 repository 단위로 authorized-user 제한을 시험한다. UI, API, 개인 자동 설정, ruleset 자동 리뷰를 각각 확인한다. 조직 수준 적용은 모든 저장소에 내려가고 repository admin이 해제할 수 없으므로 마지막에 결정한다.[1][3]

**4단계: exhaustion drill을 실행한다.** 테스트 사용자 quota와 test scope budget을 의도적으로 제한해 `MEMBER_QUOTA_EXHAUSTED`와 `ORG_BUDGET_BLOCKED`가 release gate에 어떻게 표시되는지 확인한다. Production budget을 태우기 위한 시험이 아니라 작은 별도 범위에서 failure contract를 검증하는 절차다.

**5단계: 예외를 만료시킨다.** 특정 외부 기여자 때문에 조직 전체 제한을 끄거나, 긴급 PR 때문에 상시 budget을 늘리지 않는다. Repository 범위의 정책, 승인된 수동 review fallback, 기간이 있는 budget 변경 가운데 가장 좁은 수단을 선택하고 종료 시 read-back한다.

## 결론

Copilot code review의 비용 주체는 저장소 소유자 한 칸으로 결정되지 않는다. 기본 Member 정책에서는 유료 Copilot 라이선스가 있는 멤버의 entitlement가 사용되고 quota가 소진되면 review가 실패한다. Organization을 선택하면 저장소 소유 조직으로 billing source를 바꿀 수 있지만, AI credits paid usage가 필요하고 budget은 선택 사항이다.[1][3] 이 변경은 결제 귀속만 바꾸며 review 접근 권한을 부여하지 않는다.[3]

호출 권한은 별도의 authorized-user 설정이 담당한다. 조직 또는 repository가 외부 라이선스를 제한할 수 있고, 조직 수준 제한은 repository에서 끌 수 없다.[1][3] 그러나 이 제한은 ruleset 기반 자동 리뷰를 모두 중단하는 스위치가 아니며, 개인 자동 설정과 API 요청에도 각기 문서화된 동작이 있다.[2] Fork와 external collaborator는 역할 이름만으로 payer나 권한을 추정하지 말고 base repository owner, 라이선스 제공자, 요청 경로를 실제 fixture로 확인해야 한다.

운영 계약의 핵심은 간단하다. **Request authorization, entitlement owner, repository owner, billing source, budget exhaustion을 서로 다른 필드와 실패 상태로 남긴다.** 그래야 비용 주체를 바꾸면서 권한까지 넓히거나, 외부 요청을 막으면서 ruleset 사용량도 멈췄다고 오해하거나, quota 소진을 review 통과로 잘못 해석하지 않는다.

## Sources

[1] https://github.blog/changelog/2026-10-08-copilot-code-review-new-organization-billing-options-and-controls
[2] https://docs.github.com/en/copilot/concepts/agents/code-review
[3] https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review
[4] https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing
[5] https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/budgets
[6] https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review
[7] https://docs.github.com/en/rest/billing/usage?apiVersion=2026-03-10
