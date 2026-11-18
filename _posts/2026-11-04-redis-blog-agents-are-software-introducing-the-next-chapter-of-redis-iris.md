---
title: '에이전트 메모리를 Redis 하나로 합치기 전에: Iris 6개 기능의 GA·beta 경계와 실패 주입'
date: 2026-11-04 09:00:03 +0900
categories: ["AI 에이전트"]
description: 'Redis Iris의 Intent Router·Playbooks·Memory·Context Gateway·Lens·Agent Mesh를 출시 상태별로 나누고, stale memory와 routing·MCP·messaging 장애를 검증한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-redis-blog-agents-are-software-introducing-the-next-chapter-of-redis-iris/1600/900'
tags: [redis, iris, agent-memory, intent-routing, mcp, agent-mesh, context-gateway]
---

![여섯 개의 통로가 하나의 붉은 데이터 허브로 연결된 모습](https://picsum.photos/seed/news-2026-11-04-redis-blog-agents-are-software-introducing-the-next-chapter-of-redis-iris/1600/900)

에이전트 production 문제를 “기억을 더 넣으면 해결된다”로 단순화하면 stale context, 개인정보 보존, 잘못된 routing이 더 커질 수 있다. Memory, live data, tool access, messaging은 서로 다른 failure mode를 가진다.

Redis는 2026년 11월 4일 Iris의 다음 단계를 공개하며 여섯 기능을 하나의 runtime에 묶었다. 발표 시점에 Intent Router, Agent Playbooks, Agent Memory, Context Gateway는 GA이고, Lens와 Agent Mesh는 beta다.[1]

## 여섯 기능을 하나의 성숙도로 부르면 안 된다

| 기능 | 출시 상태 | 주 역할 |
|---|---|---|
| Intent Router | GA | 요청 의미에 따라 FAQ·skill·사람·LLM으로 routing |
| Agent Playbooks | GA | 안정된 답과 최신 절차를 구분해 재사용 |
| Agent Memory | GA | 행동·문서에서 memory 생성, 계층·감사·삭제 |
| Context Gateway | GA | MCP 등 context source의 통합 진입점 |
| Lens | beta | route·skill·memory provenance와 성능 추적 |
| Agent Mesh | beta | agent 간 stream, buffering, reconnect, handoff |

“Redis Iris가 GA”라고 한 문장으로 요약하면 beta 기능까지 운영 안정성이 확정된 것처럼 보일 수 있다. 기능별 status와 fallback을 따로 기록해야 한다.

## memory, cache, live data를 구분한다

고객 지원 agent를 예로 들면 같은 질문에도 세 종류의 context가 필요하다.

- 환불 정책처럼 자주 바뀌지 않는 FAQ
- 사용자가 선호하는 언어 같은 memory
- 현재 주문 상태 같은 live data

FAQ를 매번 LLM에 묻는 것은 낭비지만, 어제 주문 상태를 memory에서 꺼내 답하면 틀린다. Playbook과 router는 어떤 정보가 재사용 가능하고 어떤 정보가 fresh tool call을 요구하는지 명시해야 한다.

권장 schema는 다음과 같다.

```text
context_kind: faq | preference | live_record | derived_memory
source_id
observed_at
expires_at
subject_id
provenance
pii_class
```

`value`만 저장하고 종류와 expiry를 잃으면 최신성과 삭제 정책을 적용하기 어렵다.

## Intent Router는 fuzzy if문이지만 fallback이 필요하다

Redis는 Intent Router가 문구가 아니라 의미를 맞춰 FAQ, skill, human, LLM 등으로 보낸다고 설명한다.[1] Semantic routing은 표현 변형에 강하지만 비슷한 intent의 경계에서 잘못된 route를 선택할 수 있다.

예를 들어 “주문을 취소하고 싶다”와 “취소 정책을 알고 싶다”는 단어가 비슷하지만 action 권한이 다르다. Router confidence가 낮거나 여러 route가 비슷하면 read-only FAQ나 human escalation으로 보내야 한다. 잘못된 route를 빠르게 실행하는 것보다 안전한 fallback이 중요하다.

## Context Gateway가 tool 오류를 없애지는 않는다

Context Gateway는 여러 MCP server와 context source에 governed entry point를 제공하고, 어떤 tool이 문제를 해결했는지 cache해 재사용할 수 있다.[1]

하지만 gateway가 있어도 다음은 발생한다.

- MCP server timeout
- tool schema 변경
- 잘못된 credential scope
- cached tool result의 만료
- source별 identity 충돌

Gateway의 성공 응답만 보지 말고 최종 source와 fresh 여부, fallback 경로를 기록해야 한다. Tool 선택 cache가 오래되면 더 좋은 tool이 추가돼도 낡은 경로를 계속 사용할 수 있다.

## 작은 지원 agent 실패 주입

아래는 **실행하지 않은 검증 fixture**다. 실제 고객 정보 대신 synthetic profile과 주문 데이터를 사용한다.

```text
FAQ cache: 배송·환불 정책
Memory: 선호 언어, 과거 상담 요약
Live source: 현재 주문 상태
Escalation: 사람 상담 queue
```

주입할 실패는 여섯 기능에 맞춰 나눈다.

1. **Stale memory**: 취소된 선호를 active memory로 남긴다.
2. **Wrong route**: 정책 질문을 환불 실행 skill로 보낸다.
3. **PII deletion**: 삭제 요청 뒤 memory와 derived index에서 잔존 여부를 본다.
4. **MCP outage**: 주문 source가 timeout될 때 오래된 값을 사실처럼 말하는지 본다.
5. **Duplicate message**: 같은 handoff event를 두 번 전달한다.
6. **Provenance gap**: 답은 맞지만 Lens가 source session을 연결하지 못하게 한다.

통과 조건은 “답변 생성”이 아니다. Stale data를 표시하고, write action 전에 확인하며, 삭제를 전파하고, duplicate를 idempotency key로 제거하며, provenance가 없으면 confidence를 낮추는지 본다.

## Agent Mesh의 재연결과 exactly-once는 다르다

Redis는 Agent Mesh beta가 ephemeral stream, automatic buffering과 reconnect, Durable SSE Streams, A2A communication을 제공한다고 설명한다.[1]

재연결이 된다는 것은 message가 정확히 한 번 처리된다는 뜻이 아니다. 연결이 끊긴 시점에 sender와 receiver의 acknowledgment 상태가 다르면 재전송으로 duplicate가 생길 수 있다.

업무 action에는 다음이 필요하다.

```text
message_id
idempotency_key
producer_agent
consumer_agent
attempt
acknowledged_at
effect_receipt
```

결제·ticket 생성처럼 side effect가 있는 consumer는 idempotency를 자체 구현해야 한다. Messaging layer의 buffering을 business transaction guarantee로 확대하지 않는다.

## Lens beta에만 감사 가능성을 의존하지 않는다

Lens는 outcome을 skill, route, FAQ, memory, source session에 연결하고 task success, token, latency를 보여주는 beta 기능이다.[1] 유용하지만 beta observability가 unavailable해도 core agent가 무감사 상태로 action해서는 안 된다.

최소 audit event는 application이 독립적으로 남기고, Lens는 분석과 시각화 layer로 둔다. Lens 장애 때 write action을 중단할지, 제한된 mode로 계속할지도 정책으로 정한다.

## 공급자 효과와 제품 계약을 분리한다

Redis는 Iris가 더 적은 token으로 더 많은 outcome을 만들고 reliability와 explainability를 높인다고 설명한다.[1] 이는 제품 방향과 공급자 주장이다. 실제 비용·정확도·생산성은 조직 workload에서 측정해야 한다.

Redis를 도입했다고 다음 문제가 자동으로 사라지지는 않는다.

- 틀린 memory를 누가 정정하는가
- 개인정보 삭제가 모든 derived artifact에 전파되는가
- Router 오분류를 어떻게 발견하는가
- Gateway가 반환한 data의 freshness를 누가 검증하는가
- Message duplicate가 side effect를 반복하는가

Iris를 평가할 때는 “여섯 기능이 통합됐다”보다 각 기능의 실패가 다른 기능으로 전파되는지를 본다. GA 네 기능에도 failure injection이 필요하고, beta 두 기능에는 명시적인 fallback이 필요하다. 하나의 runtime은 integration 비용을 줄일 수 있지만, 하나의 장애 domain이 되지 않도록 경계를 설계해야 한다.

## Sources

[1] https://redis.io/blog/agents-are-software-introducing-the-next-chapter-of-redis-iris/
