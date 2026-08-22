---
title: 'GPT·Claude·로컬 LLM을 한 API로 묶으면 무엇이 달라질까'
date: 2026-08-22 09:30:00 +0900
categories: ["개발/인프라"]
description: '여러 LLM을 단일 API로 묶는 라우터의 호환성, fallback, 관측성, 비용 효과와 함께 중앙 라우터가 만드는 새로운 단일장애점을 실무 관점에서 분석한다.'
featured_image: 'https://picsum.photos/seed/multi-model-router-tradeoffs/1600/900'
tags: [llm, ai-gateway, model-router, openai, anthropic, local-llm, observability, fallback]
---

![멀티 모델 라우터의 구조와 트레이드오프](https://picsum.photos/seed/multi-model-router-tradeoffs/1600/900)

GPT, Claude, 로컬 LLM을 한 제품에서 함께 쓰기 시작하면 가장 먼저 생기는 문제는 model selection이 아니다. OpenAI Chat Completions, Responses, Anthropic Messages가 요청과 streaming event, tool call을 서로 다른 방식으로 표현한다. 인증과 rate limit도 다르며 같은 `temperature` 필드조차 모델별 의미와 지원 범위가 같지 않다.

그래서 팀은 애플리케이션과 provider 사이에 단일 API를 둔다. client는 하나의 endpoint만 호출하고 라우터가 protocol translation, model 선택, fallback, metric 수집을 맡는다. NVIDIA NeMo의 Switchyard는 이런 구조를 Rust proxy와 library로 제공하는 프로젝트다. README 기준으로 OpenAI Chat, OpenAI Responses, Anthropic Messages 사이의 변환, 여러 backend routing, Prometheus metric을 지원한다고 설명한다.[2]

한 API는 분명 편리하다. 하지만 추상화가 provider 차이를 제거하는 것은 아니다. 차이를 **한곳으로 이동**시킨다. 그리고 그 한곳은 비용을 통제하는 control plane인 동시에 모든 LLM traffic이 통과하는 새로운 단일장애점이 된다.

## 문제: 모델보다 protocol이 먼저 갈라진다

단순한 text completion만 사용하면 provider 교체가 쉬워 보인다. `messages`를 보내고 문자열을 받으면 된다. 실제 agent workload는 다르다.

- system instruction의 위치와 우선순위
- tool schema와 tool choice 표현
- parallel tool call 지원 방식
- reasoning 또는 thinking block 처리
- 이미지·오디오 입력 형식
- structured output과 JSON schema 제약
- streaming delta와 종료 event
- usage token 산정 방식
- prompt caching과 cache control
- safety refusal와 error payload

라우터가 이 차이를 공통 schema로 정규화하면 client는 단순해진다. 반대로 공통분모가 너무 작으면 provider 고유 기능을 잃는다. 모든 기능을 지원하려고 확장 필드를 계속 추가하면 "단일 API"가 세 provider API를 합친 더 복잡한 protocol이 된다.

따라서 compatibility는 endpoint가 200을 반환하는지로 판단하면 안 된다. 같은 agent가 tool을 호출하고, 결과를 이어받고, streaming 중단을 복구하며, 최종 schema를 만족하는지 workflow 단위로 검증해야 한다.

## 기본 구조: data plane과 policy plane을 나눈다

멀티 모델 라우터는 다음 다섯 계층으로 이해하면 쉽다.

```text
Client / Agent
      ↓
Authentication · tenant policy · quota
      ↓
Canonical request / capability validation
      ↓
Routing · fallback · budget decision
      ↓
Provider adapter → GPT / Claude / local LLM
      ↓
Canonical stream · metrics · audit
```

입력 계층은 사용자와 tenant를 식별하고 허용 모델, data residency, budget을 확인한다. canonical layer는 요청을 내부 표현으로 바꾸되 원본 request ID와 provider-specific option을 보존한다. routing layer는 모델을 선택하고 fallback 정책을 적용한다. adapter는 실제 provider protocol로 번역한다. 응답 경로는 provider event를 공통 stream으로 바꾸고 metric과 audit를 기록한다.

Switchyard는 standalone proxy뿐 아니라 routing algorithm을 애플리케이션에 embed하는 library 경로도 제시한다. 프로젝트 설명상 library는 model call을 직접 소유하지 않고 target 선택을 호출자에게 돌려줄 수 있다.[2] 중앙 proxy가 필요한지, 기존 gateway 안에 routing decision만 넣을지 선택할 수 있다는 뜻이다.

다만 Switchyard 자체는 README에서 pre-alpha이며 production 용도가 아닌 experimental software라고 명시한다.[2] 따라서 기능 목록은 프로젝트의 현재 자체 설명이지 운영 성숙도에 대한 독립 검증이 아니다.

## 호환성은 capability contract로 관리한다

가장 위험한 구현은 모든 모델을 문자열 ID 하나로 취급하는 방식이다.

```json
{
  "model": "smart-model",
  "messages": [...],
  "tools": [...]
}
```

라우터가 `smart-model`을 아무 backend로 보내면 tool calling이나 image input을 지원하지 않는 모델에서 조용히 품질이 떨어질 수 있다. 더 안전한 방식은 request가 요구하는 capability를 선언하고 route가 이를 만족하는지 검증하는 것이다.

```yaml
required:
  streaming: true
  tool_calling: true
  parallel_tools: false
  json_schema: strict
optional:
  vision: false
  prompt_cache: true
```

모델 catalog에는 context window, modality, tool support, structured output 수준, region, data policy를 기록한다. 가격과 latency는 계속 바뀌므로 configuration version과 관측 시점을 함께 저장해야 한다.

공통 schema로 표현할 수 없는 기능은 route를 거부하거나 caller가 허용한 경우에만 downgrade해야 한다. provider 고유 기능은 namespaced extension으로 전달할 수 있다. strict JSON이 best-effort text로 바뀌거나 parallel tool call이 순차 호출로 바뀌면 요청은 성공해도 agent behavior가 달라진다.

## fallback은 재시도가 아니라 의미 보존 문제다

라우터를 도입하는 대표 이유는 한 provider 장애 시 다른 모델로 전환하기 위해서다. 그러나 fallback은 HTTP request를 다른 endpoint로 다시 보내는 것보다 어렵다.

첫째, **언제 전환할지** 결정해야 한다. connection failure나 명확한 5xx는 비교적 쉽다. rate limit, timeout, malformed stream, safety refusal, context overflow는 의미가 다르다. safety refusal를 장애로 보고 더 느슨한 모델로 우회하면 정책 위반이 된다.

둘째, **어느 시점까지 전환 가능한지** 정해야 한다. 첫 token 전에는 다른 provider로 재시도하기 쉽다. streaming 응답 일부를 client에 보낸 뒤에는 모델을 바꾸면 문체, JSON 구조, tool call ID가 이어지지 않는다. 이 경우 동일 응답을 투명하게 계속하는 대신 stream을 실패시키고 상위 agent가 새 turn으로 복구하도록 하는 편이 정직하다.

셋째, **중복 side effect**를 막아야 한다. 모델이 tool call을 생성했고 실행 여부가 불확실한 상태에서 fallback하면 결제, ticket 생성, email 발송이 두 번 일어날 수 있다. tool execution에는 idempotency key와 durable state가 필요하다.

실무 fallback policy는 failure class별로 달라야 한다.

| 실패 | 권장 처리 |
| --- | --- |
| 연결 실패·명확한 5xx | 동일 capability의 다른 backend 시도 |
| rate limit | retry-after 존중, 다른 quota pool 검토 |
| context overflow | 자동 축약보다 caller에 명시적 반환 |
| safety refusal | 다른 모델로 우회하지 않고 정책 처리 |
| schema validation 실패 | 제한된 repair 또는 강한 tier로 escalation |
| stream 일부 전달 후 단절 | 동일 응답의 투명한 provider 교체 금지 |

fallback chain에는 최대 hop과 전체 deadline도 필요하다. 세 provider를 순서대로 기다리면 각각의 timeout은 정상이어도 사용자 SLA를 넘길 수 있다.

## 관측성: provider metric만으로는 부족하다

라우터가 모든 traffic을 통과시키면 관측성을 표준화하기 좋다. request, error, latency, token, routing overhead를 한곳에서 측정할 수 있다. Switchyard도 이런 Prometheus metric을 기능으로 제시한다.[2]

하지만 단순한 provider별 latency graph만으로는 routing 품질을 알 수 없다. 최소한 다음 dimension이 필요하다.

- tenant, feature, route policy version
- requested model과 selected backend
- required capability와 downgrade 여부
- primary, retry, fallback hop
- queue time, router overhead, provider TTFT, total latency
- input·output·cached·reasoning token
- provider 원가, 추정 원가, 실제 청구 차이
- tool success, schema validation, task completion
- 오류 class와 최종 사용자 결과

특히 `router_overhead`를 별도 span으로 분리해야 한다. 분류를 위해 또 다른 LLM을 호출하면 선택 자체가 latency와 비용을 만든다. classifier 실패가 본 요청 실패로 번지는지도 관찰해야 한다.

trace에는 provider request ID를 남기되 prompt와 response 원문 수집은 별도 정책으로 관리해야 한다. 중앙 router log는 여러 제품의 민감 데이터가 모이는 장소다. 기본값을 full payload logging으로 두면 debugging은 쉬워도 privacy와 보안 위험이 커진다. metadata, redacted sample, opt-in payload를 구분하는 편이 안전하다.

## 비용 절감은 token 단가표보다 어렵다

멀티 모델 routing의 가장 매력적인 설명은 쉬운 요청을 저렴한 로컬 모델로 보내고 어려운 요청만 강한 모델에 보낸다는 것이다. 방향은 맞지만 절감액을 계산하려면 routing overhead와 실패 비용을 포함해야 한다.

```text
완료 작업 비용 = primary inference
              + classifier
              + retry/fallback
              + tool execution
              + validation
              + 실패한 작업의 재처리
              + router 운영비
```

로컬 LLM은 외부 API token 비용이 없더라도 무료가 아니다. GPU 감가와 예약 capacity, idle time, deployment, model loading, on-call, upgrade 비용이 있다. 평균 utilization이 낮으면 token당 실질 비용이 cloud API보다 높을 수 있다.

반대로 비싼 모델이 한 번에 정확한 tool plan을 만들어 retry를 줄이면 성공한 작업당 비용이 더 낮을 수 있다. 따라서 모델별 요청 비용이 아니라 feature별 **성공 작업당 총비용**을 비교해야 한다.

## 중앙화가 만드는 새로운 단일장애점

provider를 여러 개 연결하면 가용성이 자동으로 높아질 것 같지만 중앙 router가 내려가면 모든 provider가 건강해도 요청은 실패한다. 이것이 멀티 모델 구조의 역설이다.

장애 원인은 process crash만이 아니다.

- 잘못된 route configuration이 전체 tenant에 배포된다.
- translation bug가 모든 tool call을 손상시킨다.
- secret rotation 실패로 여러 provider 인증이 동시에 끊긴다.
- metric backend 지연이 request path를 막는다.
- classifier 장애가 모든 동적 route를 멈춘다.
- 중앙 cache나 quota store가 병목이 된다.
- fallback storm이 남은 provider를 과부하시킨다.

대응책은 router를 복제하는 것만으로 충분하지 않다. stateless data plane, multi-zone deployment, last-known-good configuration, circuit breaker, bounded retry, bulkhead와 backpressure가 필요하다. metric export와 audit write는 비동기로 처리해 관측 시스템 장애가 inference를 막지 않도록 해야 한다.

## 실무 체크리스트

### API와 호환성

- canonical schema가 지원하는 범위와 포기한 기능을 문서화했는가
- tool call, streaming, structured output을 workflow로 contract test하는가
- capability mismatch를 조용히 downgrade하지 않는가
- provider extension이 namespace와 version을 갖는가
- 원본·번역 request ID를 추적할 수 있는가

### routing과 fallback

- route 선택 이유를 사람이 설명할 수 있는가
- failure class별 retry와 fallback 규칙이 다른가
- safety refusal를 availability failure로 취급하지 않는가
- 전체 deadline, 최대 hop, retry budget이 있는가
- tool side effect에 idempotency가 적용됐는가

### 관측성과 비용

- router overhead와 provider latency를 분리하는가
- selected backend, policy version, fallback hop을 기록하는가
- token 비용뿐 아니라 성공 작업당 총비용을 측정하는가
- payload logging의 보존·redaction 정책이 있는가
- provider 청구서와 내부 추정치를 정기적으로 대조하는가

### 가용성과 운영

- router 자체의 multi-zone과 capacity 계획이 있는가
- last-known-good config로 즉시 rollback 가능한가
- provider별 circuit breaker와 bulkhead가 있는가
- fallback storm을 막는 load shedding이 있는가
- metric·config store 장애가 request path를 차단하지 않는가
- router 없이 실행 가능한 복구 runbook을 연습했는가

## 결론

GPT, Claude, 로컬 LLM을 한 API로 묶으면 애플리케이션은 단순해지고 모델 실험, 비용 정책, 관측성, fallback을 중앙에서 관리할 수 있다. 특히 여러 agent와 제품이 서로 다른 provider adapter를 중복 구현하는 조직에서는 큰 운영 이점이 있다.

그러나 단일 API는 provider 차이를 없애지 않는다. protocol translation과 capability negotiation, 의미를 보존하는 fallback, 비용 accounting이라는 더 어려운 책임을 중앙에 모은다. 그 결과 router는 편의 계층이 아니라 production control plane이 된다.

좋은 도입 순서는 작은 공통 schema, 명시적 capability contract, 정적 route, 관측 가능한 fallback에서 시작하는 것이다. 이후 실제 task outcome과 비용 데이터가 쌓였을 때 동적 routing을 추가해야 한다. 그리고 항상 물어야 한다. 여러 provider의 장애를 피하려고 만든 이 계층이 오히려 우리 시스템에서 가장 큰 단일장애점이 되지 않았는가.

## 참고자료

- [2] [GitHub: NVIDIA-NeMo/Switchyard](https://github.com/NVIDIA-NeMo/Switchyard)
