---
title: 'AI 소프트웨어 팩토리는 에이전트를 많이 붙인다고 만들어지지 않는다'
date: 2026-10-11 09:00:00 +0900
categories: ["AI 에이전트"]
description: 'Vercel AI SDK Factory의 #17898→#18033→#18036 기록을 따라 재현 artifact, 충돌 난 백포트, 네 종료 상태, 인간의 최종 병합권을 분석한다.'
featured_image: '/images/posts/2026-10-11-ai-software-factory-work-decomposition.png'
tags: [software-factory, ai-agent, ai-sdk, vercel, work-decomposition, evidence, integration-queue, human-review]
---

![AI 소프트웨어 팩토리의 작업 분해와 통합 큐](/images/posts/2026-10-11-ai-software-factory-work-decomposition.png)

에이전트 세 개를 동시에 실행하면 코드 후보는 빨리 늘어난다. 하지만 결과를 비교하고 검증하고 병합하는 책임까지 사라지지는 않는다. 같은 이슈를 서로 다르게 해석한 세 에이전트가 각자 “테스트 통과”를 보고하면, 사람 앞에는 생산량이 아니라 판정해야 할 재고가 쌓인다.

Vercel이 공개한 AI SDK Factory 사례는 이 문제를 실제 이슈와 PR 기록으로 보여준다. AI SDK 저장소에는 매달 100건이 넘는 새 이슈가 들어왔고, 2026년 6월 말에는 열린 이슈가 1,000건을 넘고 PR도 약 800건에 이르렀다. Vercel은 이를 유지관리자의 근면 부족이 아니라 코드 생성 비용이 낮아진 상황에서 사람의 주의력이 따라가지 못한 구조적 적체로 설명한다.[1] 이 진단과 성과 수치는 Vercel이 자사 저장소를 관찰해 발표한 **공급자 주장**이지, 다른 조직에도 같은 효과가 난다는 통제 실험 결과는 아니다.

이 글은 일반적인 Research·Implementation·Test·Review 역할론을 다시 설명하지 않는다. 그 구조와 Jira를 통한 비동기 인수인계는 기존 [AI 에이전트 팀 운영기 — Jira Issue를 업무 인수인계 인터페이스로 쓰기]({% post_url 2026-05-24-agent-team-jira-handoff-interface %})에서 다뤘다. 여기서는 Vercel 사례에만 있는 더 좁은 질문을 본다. **왜 재현 artifact가 구현의 선행조건이 되었고, #17898이 #18033을 거쳐 충돌 난 v5 백포트 #18036으로 이동했으며, 자동화된 흐름 끝에서도 사람이 병합했는가?**

## 공급자 사례에서 먼저 확인할 것

Vercel은 `ai-sdk-factory`를 AI SDK의 이슈와 PR을 자동 처리하는 시스템으로 소개한다. 공개된 작업 범위는 이슈 분류, 버그 재현, 버그 수정, PR 리뷰, 백포트, 문서 수정, 기능 분석, 기능 구현이다. 각 작업자는 자신의 prompt, context, eval을 가지며, 모든 변경의 최종 병합은 AI SDK 팀의 사람이 수행한다.[1]

출시 후 약 4주 동안 factory agent가 작성한 PR은 주간 병합 PR의 25~35%였고, 닫힌 이슈의 70~80%를 처리했다고 Vercel은 보고했다. 열린 이슈는 6월 말 정점 1,022건에서 8월 초 844건으로 줄었고, 열린 버그도 약 25% 감소했다.[1] 그러나 같은 기간의 인력 변화, 이슈 유입 구성, 릴리스 주기 같은 교란 요인은 공개되어 있지 않다. 따라서 “factory가 버그를 25% 줄였다”는 인과 결론으로 확대하면 안 된다.

더 유용한 것은 숫자보다 구축 순서다. Vercel은 처음부터 모든 일을 하는 거대한 자율 에이전트를 만들지 않았다. 분류를 먼저 안정화한 뒤 재현, 수정, 리뷰로 범위를 넓혔다. 하나의 에이전트에 여러 skill을 몰아넣기보다 작업별 에이전트를 택한 이유도 각 기능을 독립적으로 추론하고 시험하고 디버깅하기 쉬워서였다.[1]

이 선택의 의미는 직무명을 잘게 나누는 데 있지 않다. 한 단계가 실패해도 어느 책임과 환경을 고쳐야 하는지 구분할 수 있고, 다음 단계가 앞 단계의 결론을 믿는 대신 artifact를 다시 실행할 수 있다는 데 있다.

## #17898은 구현 요청이 아니라 재현 가능한 입력으로 바뀌었다

커뮤니티 이슈 #17898은 OpenAI web search 도구에 `blockedDomains`를 추가해 provider의 `blocked_domains`로 전달해 달라는 요청이었다.[2] 겉으로 보면 type 하나와 request mapping을 추가하면 되는 작은 기능이다. Factory는 곧바로 구현 PR을 만들지 않았다. 먼저 요청을 feature로 분류하고, 분석 작업에서 `main`에 기능이 없음을 확인하는 `issue-17898-type-probe.ts`를 만들었다. 그 probe는 `blockedDomains`를 사용했을 때 type check가 실패하는지를 보여줬다.[1]

여기서 중요한 순서가 나온다.

```text
#17898 원문 요청
  → main에서 실패하는 type probe
  → 구현 작업의 고정된 입력
  → 수정 뒤 type/runtime/live 검증
  → PR #18033
```

재현 단계의 성공은 초록색이 아니다. **요구한 실패를 정확히 빨간색으로 만드는 것**이다. 구현 작업은 그 artifact가 재실행되는 지점에서 시작한다. 이 선행조건이 없으면 구현자는 이슈를 새로 해석하면서 자신이 고치기 쉬운 문제로 바꿀 수 있다. 반대로 probe가 먼저 고정되면 구현자는 “무엇을 해결했다고 주장하는가”를 임의로 옮기기 어렵다.

분석 artifact와 구현 검증은 역할도 다르다.

- 변경 전 probe는 `main`에 `blockedDomains`가 없다는 문제 존재를 확인한다.
- 변경 후 type test는 OpenAI와 Azure의 공개 입력 surface가 예상대로 열렸는지 확인한다.
- runtime test는 `blockedDomains` 단독 사용, allow/block 조합, request serialization을 확인한다.
- live end-to-end test는 실제 OpenAI web search가 차단한 도메인을 결과 source로 돌려주지 않는지 확인한다.[1][3]

즉 “테스트가 있다”가 아니라, **기능 부재 → contract 변경 → provider payload → 실제 외부 동작**으로 증거가 이어진다. 모든 단계가 같은 보증 강도를 갖는 것은 아니다. Type probe만으로 live API 동작을 증명할 수 없고, 한 번의 live test만으로 모든 회귀를 배제할 수도 없다. 다만 서로 다른 실패면을 하나의 구현 주장에 연결하면 사람이 무엇을 확인했고 무엇이 아직 가정인지 읽을 수 있다.

PR #18033에는 `filters.blockedDomains`의 type/schema 처리, `blocked_domains` 직렬화, OpenAI·Azure 문서, 관련 test가 함께 기록되어 있다.[3] Factory review는 구현 완전성과 side effect, 하위 호환 위험을 평가했다. 이 자동 평가는 독립 기관의 보증이 아니다. 같은 factory가 만든 판단이므로 사람에게 제출되는 입력에 가깝다. 사례의 핵심은 자동 승인 문구가 아니라, 원래 probe와 변경 파일, type/runtime/live test가 한 PR에서 대조 가능했다는 점이다.

## #18033에서 #18036으로 갈 때 복사가 깨졌다

`main`용 #18033이 병합된 뒤 factory는 release line별 백포트를 만들었다. v6 백포트와 달리 v5 백포트에서는 cherry-pick 충돌이 났다. Vercel 설명에 따르면 factory는 충돌 상태를 표시하고 해결안을 검증한 뒤 17분 후 수정 commit을 push했다. 이후 두 백포트 모두 사람이 리뷰하고 병합했다.[1]

v5 PR #18036의 공개 기록은 이 과정을 더 구체적으로 보여준다. Commit history에는 `backport conflicted cherry-pick for v5.0`과 `fix backport for v5.0`이 따로 남아 있다. PR은 자신이 #18033의 backport이며 #17898을 해결한다고 연결하고, OpenAI·Azure type coverage, blocked-only·combined-filter·request-serialization runtime coverage, live validation, 문서 변경을 대상 release line에서 다시 설명한다.[4]

이 PR의 증거를 **PR 설명만으로** 표현하면 부족하다. 공개 페이지에는 대상 branch가 `release-v5.0`임이 드러나고, 그 branch를 대상으로 한 checks가 통과했으며, 유지관리자 `lgrammel`이 변경을 승인한 뒤 직접 병합한 기록도 남아 있다.[4] 즉 #18036의 공개 증거는 다음 세 층이다.

1. PR 설명이 원본 이슈·원본 PR·검증 범위를 연결한다.
2. Release branch용 checks가 충돌 해결 뒤 v5 상태를 검사한다.
3. 인간 유지관리자의 approval과 merge 기록이 최종 책임 주체를 보여준다.

이 세 층이 있다고 해서 백포트가 무결하다는 수학적 증명이 되는 것은 아니다. 그러나 “bot이 cherry-pick했다”보다 훨씬 구체적으로 무엇이 자동화됐고 누가 최종 판정을 내렸는지를 확인할 수 있다. 이후 `ai` 5.0.222와 관련 package 배포 기록도 같은 timeline에 연결되어 있다.[4]

백포트를 별도 작업으로 취급해야 하는 이유가 여기에 있다. Release line이 갈라지면 public type, provider dependency, fixture, 문서 버전이 달라질 수 있다. 문법상 충돌이 없어도 의미 충돌은 남을 수 있고, 이번 사례처럼 실제 충돌을 해결했다면 원본과 다른 새 diff가 생긴다. 따라서 원본 PR의 승인을 복사할 수 없다. **대상 branch의 checks와 별도 인간 승인이 필요한 새 변경**으로 돌아가야 한다.

## 네 종료 상태는 실패를 같은 바구니에 넣지 않는다

Vercel은 factory run의 종료 상태를 `success`, `flawed`, `blocked`, `manual` 네 가지로 나눈다. 성공한 run만 배포 후보가 된다.[1]

| 상태 | 의미 | 다음 개선 대상 |
|---|---|---|
| `success` | 작업이 정해진 기준을 충족했다 | 인간 리뷰와 병합 후보로 이동 |
| `flawed` | 결과 자체가 잘못됐다 | prompt, context, eval, 작업 정의 |
| `blocked` | 필요한 실행 조건이 없었다 | credential, service, dependency, sandbox provisioning |
| `manual` | 의도적으로 사람에게 넘겼다 | 자동화 경계를 유지하거나 재검토 |

이 분류가 중요한 이유는 실패율 그래프가 예뻐져서가 아니다. 예를 들어 monorepo command를 잘못 골라 엉뚱한 결과를 낸 run은 `flawed`다. 필요한 provider credential이나 service가 없어 실행조차 못 한 run은 `blocked`다. Public API 방향처럼 제품 판단이 필요한 작업은 `manual`일 수 있다. 셋을 모두 `failed`로 합치면 작업 prompt를 고쳐야 하는지, 실행 플랫폼을 고쳐야 하는지, 자동화하지 말아야 하는지 알 수 없다.

`success`도 자동 병합 허가는 아니다. 이는 agent가 자기 단계의 조건을 충족했다는 뜻일 뿐, 프로젝트 방향과 배포 위험을 인수했다는 뜻은 아니다. #18036에서 checks 뒤에 인간 approval과 merge가 따로 남은 이유와 같다.

실패는 다음 version의 fixture로 환류되어야 한다. `flawed` 사례는 같은 입력에서 올바른 판정을 내리는지 eval에 넣고, `blocked` 사례는 필요한 환경을 task manifest에 명시한다. 다만 한 작업이 막혔다고 모든 역할에 같은 secret과 network 권한을 주면 안 된다. 실패를 줄였지만 권한 범위는 넓어지는 잘못된 최적화가 된다.

## 작업별 sandbox는 신뢰의 대체물이 아니다

Public repository의 issue, PR, comment, link는 공격자가 조작할 수 있다. Vercel은 untrusted content를 바탕으로 코드를 처음 실행하는 bug reproduction 단계부터 보안을 넣고, 작업자를 작업별 code·runtime·필요한 secret만 가진 Vercel Sandbox에서 실행한다고 설명한다. 외부 network 도달 범위를 제한하는 shielding layer도 두며, 마지막 방어선은 사람 승인 없는 병합을 금지하는 것이다.[1]

Vercel Sandbox 문서는 sandbox가 독립 filesystem과 network를 가진 Firecracker microVM에서 실행된다고 설명한다.[5] 하지만 제품 primitive가 곧 특정 run의 effective policy는 아니다. Sandbox SDK의 network policy 기본값은 `allow-all`이고, `deny-all` 또는 명시적 allow policy를 별도로 설정할 수 있다.[6] 따라서 “sandbox 사용”만 확인해서는 secret과 network 경계가 실제로 좁아졌다고 말할 수 없다.

Factory 사례와 연결해 보면 권한은 작업 종료 조건에 맞춰 달라져야 한다. 분류 작업자는 write token이 필요 없고, 재현 작업자는 제한된 package 설치와 외부 API 접근이 필요할 수 있다. 구현 작업자가 branch에 commit할 수 있어도 protected branch 병합 권한은 필요 없다. 리뷰 작업자는 diff와 artifact를 읽으면 되며 production credential을 가질 이유가 없다. Task별 분리는 책임뿐 아니라 **실행 권한의 상한**이어야 한다.

격리는 재현성에도 기여한다. Source revision, image, dependency lock, command가 고정돼야 `blocked`와 `flawed`를 구분할 수 있다. 여러 작업자가 long-lived workspace와 uncommitted file을 공유하면 probe가 어떤 상태에서 실패했는지, 구현 test가 누구의 변경 덕분에 통과했는지 복원하기 어렵다.

## 실행 큐와 인간의 병합 큐를 혼동하지 않는다

AI SDK Factory는 GitHub webhook으로 작업을 queue에 넣고 worker가 sandbox run을 시작한다. Vercel은 Functions, Queues, Blob, Sandbox, Neon Postgres를 사용하며 여러 run과 reviewer queue를 보여주는 UI를 운영한다고 밝혔다.[1]

여기서 Vercel Queues는 현재 **Beta** 제품이다. 공식 문서는 durable asynchronous messaging, at-least-once delivery, retry, visibility timeout을 설명하며 consumer가 idempotent해야 한다고 명시한다.[7] 이는 factory가 메시지 재전달을 견뎌야 한다는 뜻이지, queue가 변경 품질이나 병합 가능성을 보증한다는 뜻은 아니다.

실행 queue는 task를 언제 시작할지 정한다. 반면 reviewer queue는 재현 artifact, 구현과 백포트 결과, 자동 평가, release-line checks를 사람이 어떤 순서로 읽을지 정한다. 이 글에서는 일반적인 one-change 원칙, head/base SHA에 증거를 묶는 법, reviewer WIP·queue age·backpressure, merge 후 지표를 다시 설계하지 않는다. 그 운영 모델은 [에이전트가 만든 PR이 넘쳐날 때 — Draft PR 제한이 보여준 오픈소스의 새 병목]({% post_url 2026-10-11-agent-generated-pr-review-bottleneck %})에서 자세히 다룬다.

Vercel 사례에서 남길 포인트는 하나다. Queue delivery의 성공, factory run의 `success`, release branch checks의 통과, 인간의 merge는 서로 다른 상태다. 앞 상태가 뒤 상태를 자동으로 함의하지 않는다.

## 인간의 최종 병합은 factory 밖의 예외가 아니다

Vercel은 AI SDK가 많은 애플리케이션의 기반이므로 quality와 security를 양보할 수 없고, 사람이 무엇이 배포되는지 통제해야 한다고 설명한다. Factory는 lifecycle의 많은 부분을 자동화하지만 모든 변경을 사람이 병합하도록 설계됐다.[1] Vercel의 별도 글도 agent output을 활용하는 것과 그것에 의존하는 것을 구분하며, PR에 이름을 올리는 사람은 코드를 읽고 동작을 이해해야 한다고 주장한다.[8]

사람이 merge button을 눌렀다는 사실만으로 책임이 이행되는 것은 아니다. #17898 흐름에서 인간 리뷰어가 볼 수 있어야 했던 것은 자동 점수 하나가 아니었다.

- 원래 요청이 type probe로 제대로 표현됐는가?
- #18033의 type, mapping, runtime, live test가 같은 contract를 검증하는가?
- v5 충돌 해결 diff가 원본 기능을 보존하는가?
- `release-v5.0` checks가 현재 백포트 상태를 대상으로 했는가?
- Public API와 문서 변경을 지금 v5에 배포해도 되는가?

이 질문의 마지막 책임은 prompt나 CI actor에게 넘길 수 없다. 자동 리뷰는 구현상 누락과 위험을 찾는 입력이고, checks는 지정된 검사를 통과했다는 입력이다. 프로젝트 방향, 허용 위험, 배포 후 소유권을 결합해 병합하는 행위는 별도 결정이다. Factory의 인간 병합권은 자동화가 덜 됐다는 잔여물이 아니라 **시스템이 의도적으로 보존한 책임 경계**다.

권한도 이 구조를 반영해야 한다. Bot은 branch와 PR을 만들고 label을 붙일 수 있지만 protected branch의 최종 merge 조건을 우회해서는 안 된다. 자동 평가 actor와 인간 approval actor가 공개 기록에서 구분되어야 사고 뒤에 누가 어떤 근거로 결정했는지 복원할 수 있다. #18036의 공개 timeline에서 bot의 백포트 commit, checks, `lgrammel`의 approval과 merge가 나뉘어 보이는 것은 이 책임 경계를 관찰할 수 있게 한다.[4]

## 작은 factory라면 재현부터 시작한다

Vercel 사례를 그대로 복제하려는 팀이라면 에이전트 수보다 첫 자동화 단위를 좁혀야 한다. 가장 안전한 출발점은 특정 package의 한 종류 이슈를 골라 **재현 artifact 생성만** 맡기는 것이다.

1. 기준 branch에서 실패해야 하는 probe와 정확한 실행 명령을 만든다.
2. 사람이 probe가 사용자 요청을 대표하는지 확인한다.
3. 승인된 artifact가 있을 때만 구현 작업을 시작한다.
4. 구현 뒤에는 같은 contract를 type, runtime, 필요시 live test로 반전시킨다.
5. Release line마다 새 diff와 새 checks로 다루고, 충돌 해결은 원본 승인으로 덮지 않는다.
6. Run을 `success`, `flawed`, `blocked`, `manual`로 나눠 서로 다른 개선 backlog로 보낸다.
7. 최종 병합과 배포 위험은 사람이 소유한다.

이 순서에서는 구현 agent가 없어도 가치가 생긴다. 사람이 구현하더라도 정확한 실패 기준을 받아 시작할 수 있기 때문이다. 반대로 재현이 불안정한 상태에서 구현부터 자동화하면 그럴듯한 PR은 늘지만 어떤 문제를 해결했는지 검토하는 비용도 함께 늘어난다.

## 결론

AI 소프트웨어 팩토리는 에이전트 조직도를 흉내 낸 시스템이 아니다. Vercel 사례에서 factory를 factory답게 만든 것은 **재현 artifact를 구현의 입구로 삼고, release line의 충돌을 새 작업으로 취급하며, 실행 결과를 네 종료 상태로 분리하고, 최종 병합 책임을 사람에게 남긴 것**이다.

#17898은 설명문에서 실패하는 type probe로 바뀌었다. #18033은 그 요구를 type, provider mapping, runtime, 문서, live validation으로 구현했다. v5 백포트 #18036은 충돌을 겪은 뒤 `release-v5.0` checks와 인간 approval을 거쳐 병합됐고 실제 package 배포로 이어졌다.[2][3][4] 이 공개 사슬은 역할 이름보다 각 단계의 선행조건과 책임자가 왜 중요한지를 보여준다.

가져갈 질문은 “에이전트를 몇 개 병렬로 돌릴 것인가”가 아니다. **구현을 시작하기 전에 재실행 가능한 실패가 있는가, release line에서 증거를 다시 만들었는가, 그리고 최종 결정을 자기 이름으로 소유할 사람이 있는가?** 세 질문에 답하지 못하면 빠른 자동화는 factory가 아니라 판정 대기열을 만든다.

## Sources

[1] https://vercel.com/blog/building-a-software-factory-for-ai-sdk
[2] https://github.com/vercel/ai/issues/17898
[3] https://github.com/vercel/ai/pull/18033
[4] https://github.com/vercel/ai/pull/18036
[5] https://vercel.com/docs/vercel-sandbox
[6] https://vercel.com/docs/vercel-sandbox/sdk-reference
[7] https://vercel.com/docs/queues/concepts
[8] https://vercel.com/blog/agent-responsibly
