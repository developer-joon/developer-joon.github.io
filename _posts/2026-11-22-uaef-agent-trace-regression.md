---
title: '에이전트 프레임워크를 바꿔도 같은 기준으로 평가하려면: UAEF Trace 회귀 테스트'
date: 2026-11-22 07:10:00 +0900
categories: ["AI 에이전트"]
description: 'UAEF의 공통 AgentTrace를 기준으로 프레임워크 교체 전후를 비교하고, 누락된 데이터가 있으면 실패시키는 작은 JSON 회귀 테스트를 설계한다.'
featured_image: 'https://picsum.photos/seed/hotnews-uaef-agent-trace/1600/900'
tags: [uaef, agenttrace, ai-agent, regression-test, evaluation, aws]
---

![흐린 하늘 아래 잔잔한 물과 넓은 모래사장 너머로 낮은 절벽과 흰 해안 마을이 보이는 풍경](https://picsum.photos/seed/hotnews-uaef-agent-trace/1600/900)

에이전트를 LangGraph에서 다른 런타임으로 옮겼는데 답변은 여전히 그럴듯하다. 그렇다면 교체가 성공한 것일까? 최종 문장만 보면 도구 호출 순서가 바뀌었거나 비용과 지연이 늘어난 사실을 놓치기 쉽다. 반대로 프레임워크별 로그 구조를 그대로 비교하면 같은 행동도 서로 다른 필드명 때문에 다른 것으로 보인다.

AWS가 2026년 11월 11일 공개한 Universal Agent Evaluation Framework(UAEF)는 프레임워크별 실행 기록을 어댑터로 공통 `AgentTrace`에 정규화한 뒤 같은 평가 계층에 넘긴다. AWS는 7개 품질 차원의 36개 내장 지표, 실험 저장과 기준 실행 비교를 UAEF의 구성으로 설명한다.[1] 이 글의 초점은 지표 목록이 아니라 **교체 전후의 원시 실행을 먼저 같은 계약으로 바꾸면 프레임워크에 종속되지 않은 회귀 테스트를 만들 수 있다**는 점이다.

## 비교 단위를 프레임워크 로그가 아니라 AgentTrace로 둔다

공식 설명에서 어댑터는 메시지, 도구 호출, 에이전트 간 전달을 읽어 하나의 정규 표현으로 바꾼다. 이미 저장된 trace를 변환할 수도 있고, UAEF가 에이전트를 호출해 실행 결과를 수집한 뒤 변환할 수도 있다.[1] 따라서 비교 파이프라인은 다음 순서를 가져야 한다.

```text
동일한 테스트 입력
  → 기존 프레임워크 실행 → adapter A ┐
                                     ├→ AgentTrace → 동일 지표 → 차이 판정
  → 후보 프레임워크 실행 → adapter B ┘
```

UAEF 소스의 `AgentTrace` 모델에는 `trace_id`, `session_id`, 메시지, 도구 호출, 입력·출력 토큰, 지연, 비용, 메타데이터, 프레임워크와 시각이 정의돼 있다.[2] 여기서 `framework`는 분류 정보이지 점수 기준이 아니다. 평가 입력이 정규화된 뒤에는 “LangGraph라서 허용”, “다른 SDK라서 제외” 같은 예외를 두지 않아야 중립성이 유지된다.

다만 정규화가 의미의 동일성을 자동 보장하지는 않는다. 한 어댑터가 도구 오류를 버리거나 다른 어댑터가 지연을 초에서 밀리초로 기록하면 같은 필드 이름 아래 다른 의미가 들어간다. 그래서 adapter 계약에는 단위, 누락 처리, tool argument의 canonical JSON 규칙, multi-turn 순서, error 보존 방식을 함께 고정해야 한다.

## 공식 기능과 운영 해석을 분리한다

공식적으로 UAEF는 ground truth가 없는 평가도 지원하지만 정답이나 예상 도구 호출과 비교하는 지표에는 해당 기준 데이터가 필요하다. 저장한 실행은 기준 실행과 비교할 수 있고 공통 지표의 평균에 대해 절대·백분율 변화를 계산한다.[1] 현재 고정 리비전의 비교 엔진은 기본 5% 임계값을 사용하고 두 실행에 공통으로 존재하는 지표만 비교한다.[3]

여기서부터는 운영 해석이다. **공통 지표만 비교한다는 구현을 그대로 배포 게이트로 쓰면 위험할 수 있다.** 후보 실행에서 중요한 지표가 통째로 사라져도 교집합 밖으로 빠질 수 있기 때문이다. 프레임워크 교체 회귀 테스트에서는 “계산된 지표의 점수가 낮지 않다”보다 먼저 “필수 필드와 필수 지표가 모두 존재한다”를 검사해야 한다. 표본 수가 0이거나 evaluator 오류가 있거나 기준 실행과 dataset fingerprint가 다르면 비교 자체를 무효로 처리하는 편이 안전하다.

LLM judge 점수도 보조 신호로 다룬다. AWS는 judge에 전달되는 에이전트 출력을 신뢰하지 않는 입력으로 취급하고 근거가 실제 내용에서 발견되지 않으면 점수를 거부한다고 설명한다. 또한 judge 점수를 보안 통제의 판정으로 사용하지 말라고 명시한다.[1] 따라서 권한 우회, 금지 도구 호출, PII 유출 같은 항목은 확률적 점수보다 결정적 assertion으로 막아야 한다.

## 교체 전후 실험을 묶는 최소 계약

두 실행이 비교 가능하려면 모델이나 프레임워크 이름보다 아래 값이 먼저 같아야 한다.

- `dataset_id`와 dataset 내용의 해시
- case별 `case_id`, 입력, 기대 답변과 기대 tool call
- adapter 버전과 내부 trace schema 버전
- metric 목록, metric 버전, judge 모델·prompt·temperature
- timeout, 재시도, 동시성, 최대 turn 수
- 표본 수와 실패·누락 건수

Prompt나 모델을 의도적으로 바꾼다면 변경값은 run metadata에 남기되 테스트 입력과 평가기는 고정한다. 반대로 adapter와 metric을 동시에 바꾸면 점수 변화가 에이전트 때문인지 측정기 때문인지 분리하기 어렵다. 먼저 같은 원시 trace를 구·신 adapter에 통과시키는 adapter parity 테스트를 하고 그다음 실제 에이전트 실행을 비교하는 두 단계가 낫다.

UAEF가 DynamoDB에 실험 메타데이터를, S3에 전체 결과를 저장하고 baseline 비교를 제공한다는 것은 공식 기능이다.[1] 하지만 어떤 commit을 기준으로 승격할지, 필수 지표를 무엇으로 정할지, 허용 가능한 하락 폭을 얼마로 둘지는 조직의 운영 정책이다. 공급자의 기본 5%를 곧바로 서비스 SLO로 복사하지 않는다.

## 실행 가능한 작은 JSON fixture

아래 예시는 UAEF API를 재현한 것이 아니라, `AgentTrace`에서 회귀 판정에 필요한 일부 필드만 뽑은 **조직 내부 축약 fixture**다. 두 프레임워크 이름은 달라도 schema와 case가 같고 도구 호출·최종 답변·지연을 같은 코드로 비교한다. 첫 블록을 `traces.json`, 둘째 블록을 `compare.py`로 저장한 뒤 `python3 compare.py traces.json`으로 실행한다.

```json
{
  "schema": "agent-trace-regression/v1",
  "baseline": {
    "case_id": "refund-001",
    "framework": "langgraph",
    "messages": [{"role": "assistant", "content": "환불 상태는 접수 완료입니다."}],
    "tool_calls": [{"name": "get_refund", "arguments": {"order_id": "A-17"}, "error": null}],
    "latency_ms": 820
  },
  "candidate": {
    "case_id": "refund-001",
    "framework": "strands",
    "messages": [{"role": "assistant", "content": "환불 상태는 접수 완료입니다."}],
    "tool_calls": [{"name": "get_refund", "arguments": {"order_id": "A-17"}, "error": null}],
    "latency_ms": 900
  }
}
```

```python
import json, sys

p = json.load(open(sys.argv[1], encoding="utf-8"))
assert p.get("schema") == "agent-trace-regression/v1", "unknown schema"
b, c = p["baseline"], p["candidate"]
required = {"case_id", "framework", "messages", "tool_calls", "latency_ms"}
assert required <= b.keys() and required <= c.keys(), "missing required field"
assert b["case_id"] == c["case_id"], "dataset case mismatch"
assert b["messages"] and c["messages"], "empty message list"
assert all(x.get("error") is None for x in b["tool_calls"] + c["tool_calls"]), "tool error"
project = lambda xs: [(x["name"], x["arguments"]) for x in xs]
assert project(b["tool_calls"]) == project(c["tool_calls"]), "tool-call regression"
assert b["messages"][-1]["content"] == c["messages"][-1]["content"], "answer regression"
assert 0 < c["latency_ms"] <= b["latency_ms"] * 1.20, "latency regression"
print("PASS", b["case_id"])
```

실제 CI에서는 문자열 완전 일치 대신 도메인에 맞는 deterministic metric이나 고정된 judge 설정을 쓸 수 있다. 그래도 schema·case·필수 필드·오류·표본 검사는 그보다 먼저 실행한다.

## 실패를 성공으로 바꾸지 않는 승인 기준

이 fixture를 배포 게이트로 확장할 때는 다음을 모두 만족해야 통과로 판정한다.

1. baseline과 candidate의 dataset hash, case 집합, trace schema, metric 버전이 정확히 같다.
2. 필수 필드와 필수 지표가 하나라도 없으면 0점으로 대체하지 않고 실행을 실패시킨다.
3. adapter 오류, tool 오류, timeout, judge parsing 실패가 한 건이라도 있으면 별도 승인 없이는 승격하지 않는다.
4. 기대 tool 이름·순서·argument가 다르거나 금지 도구가 호출되면 평균 점수와 무관하게 실패한다.
5. 각 필수 metric은 사전에 정한 절대 하한과 baseline 대비 하락 한도를 모두 통과해야 한다.
6. p95 지연, token, 비용의 표본 수가 최소치보다 적거나 telemetry가 끊기면 통과시키지 않는다.
7. 모든 실패 case의 원문 trace와 adapter 버전, 실행 commit을 보존해 재현할 수 있어야 한다.

평균 하나만 보면 일부 case의 큰 하락이 다른 case의 개선에 가려진다. 전체 평균과 함께 case별 하한, 실패율, 하위 분위수, 금지 행동의 0건 조건을 둔다. threshold 경계값도 테스트해 `-5%`가 통과인지 실패인지 코드와 문서가 다르게 해석하지 않도록 한다.

## 프레임워크 교체를 측정기 교체로 만들지 않는다

에이전트 프레임워크 교체의 핵심 위험은 새 SDK가 낯설다는 데 있지 않다. 실행 기록의 모양이 달라져 이전 품질 기준을 잃는 데 있다. UAEF의 유용한 지점은 특정 framework 점수표보다 정규화를 평가보다 앞에 둔 구조다. 같은 dataset을 실행하고 각 native trace를 같은 `AgentTrace` 계약으로 바꾸고 동일한 metric과 fail-closed gate를 적용하면 교체 전후를 같은 눈금에서 볼 수 있다.

그렇다고 canonical trace가 객관성을 자동 생성하지는 않는다. Adapter가 무엇을 버렸는지, metric 설정이 같았는지, 누락을 실패로 처리했는지까지 검증해야 한다. 프레임워크 중립성은 지원 목록이 아니라 **동일 입력·동일 trace 의미·동일 평가기·동일 승인 규칙**을 반복해서 지키는 과정에서 생긴다.

## Sources

[1] https://aws.amazon.com/blogs/machine-learning/uaef-a-framework-agnostic-system-for-closed-loop-evaluation-of-ai-agents/
[2] https://github.com/awslabs/uaef/blob/524e57ab58e7f88101564919ee6b880b85f8159b/src/uaef/models/agent_trace.py
[3] https://github.com/awslabs/uaef/blob/524e57ab58e7f88101564919ee6b880b85f8159b/src/uaef/experiments/comparison.py
