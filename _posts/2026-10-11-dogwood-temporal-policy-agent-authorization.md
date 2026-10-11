---
title: '에이전트 권한은 Allowlist만으로 부족하다 — Dogwood Temporal Policy'
date: 2026-10-11 08:30:00 +0900
categories: ["AI 보안"]
description: 'Dogwood Local Engine을 중심으로 최근 15분의 green test, 도구 호출 순서·빈도·누적량, 동시 요청의 total order, durable log와 snapshot, crash recovery, atomic policy update, harness trust boundary를 설계한다.'
featured_image: '/images/posts/2026-10-11-dogwood-temporal-policy-agent-authorization.png'
tags: [dogwood, temporal-policy, ai-agent, authorization, runtime-verification, durable-log, crash-recovery]
---

![Dogwood temporal policy와 에이전트 실행 이력](/images/posts/2026-10-11-dogwood-temporal-policy-agent-authorization.png)

에이전트에게 `tests`와 `git:push`를 허용했다고 해서, 테스트하지 않은 코드를 push해도 된다는 뜻은 아니다. `Transfer`가 허용돼도 한 시간에 수백 번 호출하거나 합계 5천 달러를 넘겨서는 안 된다. 개별 요청이 합법이어도 **잘못된 순서, 지나친 빈도, 과도한 누적량**으로 이어지면 위험하다.

Point-in-time authorization은 현재 principal, action, resource, context를 보지만, 최근 검증·호출 횟수·누적량에는 과거 상태가 필요하다. AWS가 2026년 9월 30일 공개한 Apache 2.0 Dogwood Local Engine은 temporal condition을 로컬 enforcement layer에 임베드해 action 이력으로 verdict를 계산한다.[1] 구현 설명은 공개 저장소의 `v1.0.0` tag 기준이며, 별도 managed service의 GA 상태를 주장하지 않는다.[4]

이 글은 MCP의 identity, OAuth, scope, call-time authorization을 다시 설명하지 않는다. 초점은 이미 식별된 action stream에 **시간축을 추가했을 때 생기는 상태·동시성·내구성 문제**다. 특히 중요한 경계는 분명하다. Dogwood Local Engine은 자신이 받은 event와 policy를 바탕으로 verdict를 계산한다. 거부된 도구를 실제로 실행하지 않는 일, event가 빠짐없이 정확하게 들어오게 하는 일, engine과 저장소를 변조에서 보호하는 일은 harness의 책임이다.[1]

## Allowlist가 답하지 못하는 질문

`{ tests, lint, git:commit, git:push }`라는 allowlist는 네 action이 허용 후보라는 사실만 말한다. 마지막 test response가 15분 이내의 성공인지, 그 뒤 실패가 있었는지, lint가 commit보다 먼저 끝났는지, 최근 10분의 메시지 횟수나 한 시간의 transfer 합계가 얼마인지는 답하지 못한다.

Dogwood는 Cedar의 point-in-time 조건을 유지하면서 `when temporal`로 event history를 참조한다. 권한 범위에 순서, 선행 조건, 빈도, 누적량이라는 trajectory를 더한다.[2]

일반 IAM의 대체재는 아니다. Tenant, role, resource, 현재 입력은 여전히 현재 요청의 authorization 문제이고 temporal 제약은 여기에 history dimension을 더한다.

```text
현재 요청이 허용 범위 안에 있음
AND 최근 실행 이력이 temporal constraint를 만족함
= 이번 요청을 허용할 후보
```

마지막 줄을 “실행됨”이라고 쓰지 않은 이유가 있다. Engine의 allow는 verdict일 뿐이고, 실제 실행은 harness가 결정한다.

## `green test within 15m`는 timestamp 비교보다 강하다

Dogwood Local Engine 발표의 대표 정책은 push를 허용하려면 최근 15분 안에 통과한 test가 있고, 그 뒤 실패한 test가 없어야 한다는 규칙이다.[1]

```dogwood
@id("push_after_green_tests")
permit (principal, action == Sandbox::Action::"git:push", resource)
when temporal {
    !Sandbox::Action::"tests"::response{ output.passed: false }
    since within 15m
    Sandbox::Action::"tests"::response{ output.passed: true }
};
```

이는 `last_green_at >= now - 15m`보다 강하다. 15분 이내 green을 anchor로 삼고 그 뒤 red가 없어야 한다. `within 15m`는 닫힌 구간이라 정확히 15분 전 event는 포함되고 더 오래되면 제외된다. `10:00 green → 10:04 red → 10:05 push`는 deny, `10:04 red → 10:08 green → 10:09 push`는 allow 후보이며, `10:08 green → 10:23 push`는 경계에 있다.[1][6]

**운영 설계 제안:** 다른 commit의 green을 재사용하지 않도록 repository, ref, commit digest, suite, environment를 correlation한다. 이는 Dogwood 표준 필드가 아니라 조직 schema다. 15분도 보안 상수가 아니므로 성능만 보고 업무상 필요한 window를 줄이면 정책 의미가 바뀐다.[1]

## Decision event와 history event는 서로 다른 사실이다

Dogwood의 기본 event schema에서는 tool call을 보통 `request`와 `response` 한 쌍으로 기록하고 `request`가 decision kind다. 하지만 둘은 고정 예약어가 아니라 기본 schema의 예다. Custom event kind를 추가할 수 있고, 어느 kind가 verdict를 받는지도 설치된 schema의 `decision_kinds`에서 정한다. `v1.0.0`의 단일 `submit` 경로는 kind를 hard-code하지 않고 schema에 따라 decision event에는 verdict를, history event에는 기록 확인만 돌려준다.[2][4][5]

기본 schema를 전제로 하면 거부된 request는 도구가 실행되지 않았으므로 response가 없어야 한다. 아래 표의 `request`/`response` 역시 그 기본 모델을 설명한다.[1]

이 구분은 문법이 아니라 정책 의미다.

| 기준 event | 의미 | 적합한 질문 |
|---|---|---|
| `action::request` | 실행을 시도했고 admission 판단에 들어왔다 | 제출 시도 횟수, submitted-attempt exposure |
| `action::response` | 허용된 실행이 끝나 결과가 돌아왔다 | test 성공, HTTP 200, 실제 완료 결과 |

`green test`는 성공 여부가 필요하므로 `tests::response{ output.passed: true }`를 봐야 한다. Test request가 허용됐다는 사실은 test가 통과했다는 증거가 아니다. 반대로 지출 한도를 response만으로 계산하면 아직 끝나지 않은 동시 요청을 누락할 수 있다.

예를 들어 event 금액 단위를 integer cents로 고정하고 한 시간 cap을 `500_000` cents($5,000)로 두자. `200_000` cents 요청 세 개가 거의 동시에 들어오고 response가 아직 없다면 response 합계는 0이지만 request 합계는 세 번째 판단에서 `600_000` cents가 된다. 현재 decision event도 먼저 history에 들어가므로 세 번째 요청을 거부할 수 있다. Dogwood 소개 글도 현재 판단 중인 request를 포함해 합산해야 동시·비동기 우회를 막을 수 있다고 설명한다.[2][5]

여기서 request aggregate는 **admitted exposure가 아니라 submitted-attempt exposure**다. Decision event는 verdict 전에 append·step되므로 현재 request와 deny된 이전 request도 history에 남는다.[5] **운영 설계 제안:** admitted-only 한도는 caller-held lock 안에서 allow 직후 별도 reservation event를 쓰거나 downstream ledger가 원자적으로 예약하게 한다. 실제 결제 원장은 transaction ledger와 idempotency를 권위로 둔다.

## 순서·빈도·누적량은 서로 다른 상태다

Temporal policy를 “최근에 무엇이 있었는지 검색하는 기능”으로만 보면 세 제약을 한데 뭉개기 쉽다.

### 순서: 선행 조건과 금지 전이

순서 정책은 `approve → execute`, `test green → push`, `read confidential → no external send`처럼 event의 방향을 본다. Dogwood의 `formerly`, `since`는 window 안의 순서 관계를 표현한다.[2]

**운영 설계 제안:** `ApproveSale(AMZN, 100)`을 `SellShares(MSFT, 100)`에 재사용하지 못하도록 stock, shares, tenant, 작업 ID를 correlation한다.[2]

### 빈도: 몇 번 시도하거나 성공했는가

빈도는 최근 10분 Slack post 3회처럼 count를 window에 묶는다. Strands Box의 developer preview 예시는 Slack `chat.postMessage`의 HTTP 200 response가 최근 10분 동안 세 번이면 다음 post를 막는다. 거부된 요청은 response가 없으므로 성공 횟수에 들어가지 않는다.[3] 반면 재시도 폭주 자체를 막고 싶다면 request를 세야 한다. 같은 “분당 3회”라도 성공률 제한과 시도율 제한은 다른 정책이다.

고정 window와 sliding window도 구분해야 한다. 현재 Dogwood의 window는 “지금부터 최근 1시간” 같은 상대적 sliding window다. 자정에 초기화되는 일일 quota 같은 absolute-time window는 2026년 8월 발표에서 향후 방향으로 제시됐지, 이미 제공되는 기능으로 설명되지 않았다.[2]

### 누적량: 이벤트 수가 아니라 합계 exposure

호출 5회 제한은 1달러 다섯 번과 1천 달러 다섯 번을 같게 취급한다. 금액, 레코드 수, 외부 전송 byte, 삭제 대상 수처럼 위험이 크기에 비례하면 `sum_within`으로 window 안의 값을 더해야 한다. Dogwood는 `count_within`, `count_distinct_within`, `sum_within`을 제공하며, 이들은 Metric First-Order Temporal Logic 기반 핵심 연산 위에 정의된 macro다.[2]

누적량 정책에는 의미 단위를 schema에서 고정해야 한다. 이 글의 예시는 모두 integer cents다. `500_000`을 cents로 선언하고 다시 “5천 달러”로 해석하는 것은 맞지만, dollars 필드에 같은 수를 넣으면 100배 오류다. 다중 통화의 환산 출처·버전을 event에 넣거나 currency별 cap을 분리하는 것은 **운영 설계 제안**이며, engine은 입력 숫자의 업무 정확성을 보증하지 않는다.

## 동시성에서는 total order가 정책 의미가 된다

병렬 tool call에는 자연스러운 단일 순서가 없다. 두 agent가 같은 engine을 공유하거나 한 agent가 여러 call을 동시에 제출하면 “둘 중 무엇이 먼저였는가”는 벽시계만 보고 결정하기 어렵다. 그러나 temporal logic은 앞선 event들의 ordered history를 평가한다. Engine은 모호한 동시 입력을 하나의 **total order**로 선형화해야 한다.

Dogwood Local Engine `v1.0.0`의 library API는 `submit(&mut self, ...)`다. 즉 같은 instance를 여러 thread가 호출하려면 embedder가 `Mutex<DurableTemporalEngine>` 같은 caller-held mutex로 감싸 append·step·evaluate 전체를 직렬화해야 한다. 예제 `dogwood-server`가 이 lock을 제공한다. Engine은 그 임계 구역에서 timestamp를 정하고 append·sync한 뒤 현재 event를 monitor에 step하고 verdict를 계산한다. 처리 순서는 `linearize → persist → step → evaluate`다.[1][5]

이 설계가 누적량 race를 닫는 방식을 보자.

```text
이전 submitted-attempt 합계: 400,000 cents
동시 입력 A: +100,000 cents
동시 입력 B: +100,000 cents
한도: 500,000 cents
```

A와 B가 각자 $4,000 snapshot을 읽고 독립 평가하면 둘 다 허용될 수 있다. Total order에서 A가 먼저 들어가면 A 판단은 $5,000이고, B는 A와 자기 자신이 포함된 $6,000 submitted-attempt history에서 deny된다. 반대 순서도 가능하지만 둘 다 “내가 먼저”라고 판단해서는 안 된다. 이 예에서 deny된 B도 이후 합계에 남는다는 점이 admitted-only 회계와의 차이다.[5]

여기서 total order는 실제 세계의 절대적 인과 순서를 발견한 것이 아니다. Engine이 정책 평가를 위해 정한 선형화 순서다. Harness가 event 제출을 늦추거나 일부 request를 우회하면 log order가 실행 reality와 어긋난다. 그래서 모든 tool call을 먼저 intercept하고 verdict를 받은 뒤에만 실행해야 한다. Tool을 먼저 시작하고 나중에 request event를 기록하면 admission control이 아니라 사후 기록이 된다.

응답 순서도 호출 순서와 다를 수 있다. A request 뒤 B request가 기록돼도 B response가 먼저 올 수 있다. 또 temporal history는 decision 직전의 `0..i`가 아니라 **현재 decision event까지 포함한 `0..=i`**다. Policy author는 제출 순서, 완료 순서, 성공 여부 중 무엇을 의도하는지 명시해야 한다.[2][5]

## Durable log와 snapshot은 권한 상태를 보존한다

Temporal authorization에서 history는 보조 audit data가 아니다. 다음 verdict를 바꾸는 **권한 상태**다. 이를 메모리에만 두면 재시작이 정책 우회가 된다. 한 시간에 다섯 번만 허용되는 action을 네 번 실행한 뒤 engine을 재시작했을 때 count가 0으로 돌아가면 여섯 번째 효과가 허용될 수 있다. 최근 실패 test가 사라지면 재시작 직후 오래된 green만 남은 것처럼 판단할 수도 있다.

Local Engine은 event를 redb 기반 durable log에 저장하고, append를 disk에 sync한 뒤 verdict를 계산한다. Allow뿐 아니라 deny decision event도 이미 durable history에 등록된다. 다만 **decision 결과 자체는 internal log에 기록되지 않는다.** 메모리의 incremental summary는 각 temporal clause에 필요한 window를 추적한다.[1][4][5]

재시작 때는 최신 snapshot을 읽고, snapshot 이후 log record만 replay해 monitor state를 복원한다. Snapshot에 이미 반영된 오래된 event는 log에서 prune해 저장 공간을 제한한다.[1] 이를 세 층으로 이해하면 쉽다.

1. **durable log**: event와 policy update의 순서를 보존하는 복구 입력
2. **in-memory summary**: 현재 policy를 빠르게 평가하기 위한 파생 상태
3. **snapshot**: 파생된 monitor state의 durable checkpoint

Snapshot은 audit archive와 다르다. Engine log는 과거 record를 prune하고 snapshot은 완전한 event history가 아니라 파생 monitor state를 보존하며 decision 결과도 남기지 않는다. 따라서 장기 포렌식 원장으로 쓸 수 없다.[4] 별도 audit log를 유지하는 것은 공식 embedding 요구사항이지만, 보존 기간·무결성 방식은 조직이 정할 운영 설계다.

재시작 시 engine은 snapshot을 복원하고 이후 record를 순서대로 replay한다. Snapshot이 쓸 수 없는데 log가 이미 prune됐다면 `v1.0.0`은 history hole을 감춘 채 빈 상태로 열지 않고 오류를 낸다.[5] 이 오류를 고위험 action의 deny나 운영자 개입으로 연결하는 것은 **운영 설계 제안**이다.

Harness 쪽에는 별도 crash gap이 남는다. Engine이 allow verdict를 반환하기 전 event는 durable하지만, tool 실행 전 또는 실행 후 response 기록 전에 harness가 죽을 수 있다. Engine log와 외부 side effect는 하나의 transaction이 아니다. Idempotency key, downstream status 조회, 재시도 전 reconciliation, correlation ID는 이 간극을 줄이기 위한 **운영 설계 제안**이다.

## Policy update도 event와 같은 순서에 들어가야 한다

실행 중 policy를 바꾸면 “어느 request부터 새 규칙인가”라는 경계가 생긴다. 여러 rule을 갱신하는 동안 일부만 새 버전이고 일부는 이전 버전인 혼합 상태가 노출되면, 어떤 완전한 policy set에서도 나오지 않을 allow가 발생할 수 있다. Crash가 update 중간에 일어날 때도 복구 결과는 update 전 전체 또는 update 후 전체여야 한다.

Local Engine은 policy update를 event와 같은 log에 넣고 caller-held/server lock 아래에서 linearize·persist한다. Record 앞 request는 이전 set, 뒤 request는 완전히 갱신된 set을 본다. Recovery도 log 순서대로 replay하므로 혼합 set 노출을 막는다.[1][5]

History 초기화 범위는 control-plane 경로에 따라 다르다. `install`은 전체 policy set을 `[SetActionSchema; DeleteAll; Add each]`로 교체하므로 **결과 set의 모든 policy가 empty history로 다시 태어난다.** 반면 targeted `batch`는 언급하지 않은 policy의 monitor state를 유지하고, `Add`·`Update`·`Reset` 대상만 empty history로 시작한다. 새 clause가 update 이전 event를 소급하지 않는 이유는 snapshot이 현재 policy에 필요한 summary만 담고 log는 prune될 수 있기 때문이다.[4][5]

예를 들어 targeted batch로 `commit` 전에 15분 이내 clean lint를 요구하는 policy를 10:10에 추가했다면, 10:09 lint는 새 policy의 증거가 아니다. 10:11 commit은 deny되고 update 이후 lint가 필요하다.[1][5] 반대로 batch에서 건드리지 않은 다른 policy의 window는 유지된다.

**운영 설계 제안:** rollout 때 empty history를 알리고 prerequisite를 다시 실행하며 update 위치와 policy version을 audit log에 연결한다. Rollback도 새 update이지 과거 state의 자동 복원이 아니다.

## Harness가 실제 trust boundary다

Local Engine의 보안 경계를 가장 정확하게 표현하면 다음과 같다.

```text
agent/tool call
  -> harness가 모든 호출을 intercept
  -> request event를 engine에 제출
  -> engine이 history + policy로 verdict 계산
  -> allow일 때만 harness가 tool 실행
  -> harness가 정확한 response event 제출
```

Engine은 네 번째 줄의 verdict 계산을 책임진다. 다음 책임은 harness에 남는다.[1]

- 거부된 action이 절대 실행되지 않도록 **verdict를 강제**한다.
- Policy가 의존하는 모든 request와 response를 누락 없이 제출한다.
- Event producer를 인증하고 action, input, output 필드가 실제 효과를 정확히 나타내게 한다.
- Agent나 tool process가 engine memory, durable store, policy control plane을 변조하지 못하게 격리한다.
- Policy를 바꿀 주체를 통제하고 실패한 변경을 보고한다.
- Prune되는 engine log와 별도로 장기 audit log를 유지한다.
- Temporal window의 기준이 되는 host clock을 보호한다.

Engine에 “test passed” response를 보내는 주체가 agent 자신이라면 agent는 성공을 위조할 수 있다. Shell command가 우회 경로로 network를 호출하는데 harness가 그 효과를 event로 보지 못하면 outbound history는 불완전하다. Deny를 받아도 agent가 같은 binary나 raw socket을 직접 실행할 수 있다면 verdict는 권고문일 뿐이다.

Developer preview인 Strands Box는 containment와 Dogwood policy를 결합한 사례다. 여러 enforcement point가 history를 공유하지만, `box.toml`로 직접 허용한 일부 path 접근은 policy history에 나타나지 않는다.[3] 상세 containment 구조는 2번 글에서 다루고, 여기서는 **모든 효과가 event로 관측되는지 별도 확인해야 한다**는 경계만 남긴다.

## Safety는 제공하지만 liveness는 아직 아니다

Dogwood가 현재 검증하는 것은 safety다. Safety는 “나쁜 일이 일어나지 않는다”는 형태다. 승인 없이 판매하지 않는다, 최근 green test가 없으면 push하지 않는다, window 합계를 넘는 요청을 허용하지 않는다. 과거 history를 보고 현재의 위험한 action을 deny할 수 있다.[2]

Liveness는 “좋은 일이 결국 일어난다”는 형태다. 시작한 작업은 terminal state에 도달해야 한다, 획득한 lock은 결국 release돼야 한다, 승인된 요청은 언젠가 처리돼야 한다. 2026년 8월 Dogwood 발표와 10월 Strands Box 발표는 liveness를 향후 방향으로 설명한다. 현재 제공되는 기능처럼 쓰면 안 된다.[2][3]

Temporal safety policy가 `deploy:start` 뒤 중복 start를 막아도, 첫 deploy를 완료시키거나 반드시 alert하지는 않는다. **운영 설계 제안:** workflow state machine, timeout, queue lease, compensating action으로 liveness를 맡긴다.

**운영 검증 제안:** green 뒤 red, 15분 경계, 동시 누적 초과, response 유실, update 직전 prerequisite를 trace로 재생하고 crash와 harness bypass를 주입한다.

## 결론

Point-in-time allowlist는 호출 가능한 action의 외곽선을 그리지만, 위험은 trajectory에서 나타날 수 있다. 최근 15분의 green test와 그 뒤 red의 부재, 승인과 실행의 순서, window 안의 빈도와 누적 exposure는 durable event history 없이는 판단할 수 없다.

Dogwood Local Engine이 맡는 핵심은 event와 policy update를 하나의 순서로 선형화하고, 먼저 durable log에 기록한 뒤, snapshot과 replay로 이어지는 history에서 verdict를 계산하는 일이다.[1][5] 기본 schema의 request aggregate는 deny까지 포함한 submitted-attempt exposure이고 response는 완료 결과다. Admitted-only exposure는 별도 reservation이나 downstream ledger가 필요하다.

그렇다고 engine이 전체 보안 경계가 되는 것은 아니다. Engine은 verdict를 계산할 뿐이다. Harness가 모든 호출을 가로채 deny를 집행하고, 정확한 request/response를 빠짐없이 제출하며, clock·memory·store·policy control plane을 보호해야 temporal authorization이 실제 통제가 된다.[1] 별도의 audit log와 외부 side effect reconciliation도 필요하다.

마지막으로 현재 Dogwood가 제공하는 것은 과거를 보고 위험한 다음 action을 막는 safety다. 작업이 언젠가 끝나고 자원이 결국 해제되는 liveness는 아직 제공된 기능이 아니라 향후 방향이다.[2][3] 운영 설계는 이 둘을 섞지 말아야 한다. 안전한 에이전트 권한은 “이 도구를 쓸 수 있다”에서 끝나지 않는다. **어떤 검증된 이력 뒤에, 어떤 순서로, 얼마나 자주, 총 얼마까지 실행할 수 있으며, 그 이력을 누가 신뢰 가능하게 만들고 복구하는가**까지 닫혀야 한다.

## Sources

[1] https://aws.amazon.com/blogs/opensource/introducing-the-dogwood-local-engine-temporal-governance-for-agent-actions/
[2] https://aws.amazon.com/blogs/opensource/introducing-dogwood-runtime-verification-for-ai-agents/
[3] https://aws.amazon.com/blogs/opensource/introducing-strands-box-ai-agent-sandboxes-powered-by-dogwood/
[4] https://github.com/dogwood-policy/dogwood-local-engine/tree/v1.0.0
[5] https://github.com/dogwood-policy/dogwood-local-engine/blob/v1.0.0/dogwood-local-engine/src/durable.rs
[6] https://dogwood-policy.github.io/dogwood/guide/04-temporal-expressions.html
