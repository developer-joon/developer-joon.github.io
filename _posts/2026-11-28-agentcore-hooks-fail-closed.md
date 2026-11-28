---
title: '관리형 Agent Harness의 기본값이 바뀌면: AgentCore hook으로 fail-closed 회귀 테스트'
date: 2026-11-28 07:35:00 +0900
categories: ["AI"]
description: 'Amazon Bedrock AgentCore harness의 관리형 기본값과 lifecycle hook 경계를 구분하고, 고위험 tool을 fail-closed로 막는 회귀 테스트를 설계한다.'
featured_image: 'https://picsum.photos/seed/agentcore-hooks-fail-closed/1600/900'
tags: [amazon-bedrock-agentcore, agent-harness, lifecycle-hooks, fail-closed, regression-test]
---

![흰 배경 앞에서 꽃잎을 펼친 데이지 한 송이](https://picsum.photos/seed/agentcore-hooks-fail-closed/1600/900)

관리형 agent harness는 모델 호출 주변의 반복 작업을 줄인다. 반대로 권장 모델, system prompt, context management와 built-in tool 같은 기본값이 공급자 변경 표면이 된다. 애플리케이션 코드가 그대로여도 agent가 보는 prompt, 유지하는 context, 선택할 수 있는 tool이 달라질 수 있다.

AWS는 Amazon Bedrock AgentCore harness를 Apache 2.0 Strands harness 기반으로 업그레이드하고, 권장 모델·task-oriented system prompt·Anthropic 모델용 자동 prompt caching·proactive context management와 planning, web retrieval, filesystem, delegation 도구를 관리형 기본값에 포함한다고 발표했다.[1] 동시에 agent loop의 특정 지점에서 Lambda, SNS 또는 EventBridge로 event를 보내는 lifecycle hook을 제공한다.[2] 공식 개발자 문서는 AgentCore harness 자체를 GA로 명시한다.[3] 다만 GA는 전 리전 공통 가용이라는 뜻이 아니다. 공식 지원 리전 표에서 harness는 일부 리전에만 `Yes`이고, `AgentCore Built-in Tools`는 별도 행으로 관리된다.[4] 이 글은 그 hook을 “안전 보증”으로 부르지 않고, 기본값 변경을 탐지하고 고위험 tool을 차단하기 위한 **제안형 회귀 테스트**로 다룬다.

## 오픈소스 harness와 관리형 실행 계층을 나눈다

Strands harness는 instruction, tool, context management를 조립하는 오픈소스 기반이다. AgentCore harness는 여기에 session persistence, streaming, usage metadata, observability, memory, Identity, Gateway, Browser, Code Interpreter와 customer container 같은 관리형 서비스를 연결한다. AWS는 사용자가 model, instruction, tool, permission과 lifecycle policy 통제를 유지한다고 명시한다.[1]

따라서 “Strands가 Apache 2.0”이라는 사실과 “AgentCore라는 관리형 서비스의 운영 계약”은 다른 층이다. 소스 라이선스가 cloud service의 region, quota, 가격, SLA를 뜻하지 않는다. 반대로 관리형 기본값을 쓰더라도 tool permission과 고위험 행동의 승인 책임이 AWS로 이전되지는 않는다.

상태 확인도 한 덩어리로 하지 않는다. 배포 시점에 (1) harness의 GA 상태와 대상 리전 지원 여부, (2) 사용할 built-in tool의 지원 리전과 문서상 상태, (3) lifecycle hook의 API 문서·release note상 상태와 대상 리전에서의 실제 생성 가능 여부를 각각 확인한다. 현재 hook 문서는 `CreateHarness`·`UpdateHarness` 설정으로 설명하지만 별도의 preview 표시는 하지 않는다.[2] 이후 특정 hook이나 built-in 기능에 preview 표기가 생기면 harness 전체의 GA 상태로 덮지 않고 manifest에 별도로 기록한다.

배포 manifest에는 최소한 다음을 명시적으로 pin하는 편이 좋다.

- model ID 또는 관리형 권장 모델 사용 여부
- system instruction의 source와 digest
- enabled built-in tool 목록과 permission
- context offloading·summarization 정책
- hook event, target ARN, timeout·retry 정책
- 변경 승인·거부 상태와 trace 보존 위치

생략한 값은 “없음”이 아니라 “공급자 기본값 사용”이다. 이 차이를 canary가 읽을 수 있어야 한다.

## hook 세 지점의 거부 의미가 다르다

공식 문서에 나온 주요 event는 `before_invocation`, `before_tool_call`, `after_tool_call`이다. Lambda가 deny를 반환했을 때 효과가 서로 다르다.[2]

| event | hook이 보는 시점 | Lambda deny의 효과 |
|---|---|---|
| `before_invocation` | session state 복원 전 현재 요청 messages | invocation을 시작하지 않고 `hook_stopped`로 종료 |
| `before_tool_call` | tool 이름·유형·tool-use ID·모델 생성 입력 | 해당 tool 호출을 건너뛰고 agent loop는 계속 |
| `after_tool_call` | 이미 실행된 tool 결과 또는 오류 | 완료된 결과는 유지하고 invocation을 중단 |

이 표에서 가장 중요한 것은 `after_tool_call`이 rollback hook이 아니라는 점이다. 환불, 삭제, 배포처럼 되돌리기 어렵거나 외부 부작용이 있는 작업을 `after_tool_call`에서 거부해도 호출은 이미 끝났다. 고위험 행동은 `before_tool_call`에서 승인 계약을 검증하고, 실제 tool 자체도 idempotency와 authorization을 강제해야 한다.

`before_tool_call`의 deny는 agent loop를 계속 진행시킨다.[2] agent가 같은 목적을 다른 tool로 우회하거나 이름만 다른 tool을 선택하지 않는지 시험해야 한다. “한 tool 차단”과 “행동 범주 차단”은 같은 계약이 아니다.

## 정책은 tool 이름보다 효과를 본다

정책 입력에는 tool name만 넣지 말고 canonical action을 만든다. 예를 들어 `refund_create`, `credit_issue`, `payment_reverse`가 모두 금전 변경이라면 같은 위험 범주에 매핑한다. 파일 계열도 path와 operation을 함께 본다. built-in tool의 이름이 바뀌면 allowlist가 자동 허용으로 떨어지지 않고 unknown-deny가 되어야 한다.

공식 문서에는 2026년 11월 12일 00:00 UTC 이전에 생성되고 file hook이 있는 harness의 호환 기간도 적혀 있다. 기존 `file_operations` 대신 `read`, `write`, `edit` 도구가 도입되면서, 해당 harness는 2026년 12월 12일 00:00 UTC까지 새 tool 이름 event와 deprecated event를 둘 다 받을 수 있다.[2] event 수를 곧 tool 실행 수로 세면 중복 집계할 수 있다.

이 기간의 회귀 테스트는 `hookEventId`, tool-use ID와 event 종류를 함께 사용해 중복 관측과 실제 중복 실행을 구분해야 한다. 호환 기간 뒤 deprecated event가 사라질 때 정책이 새 이름을 처리하지 못해 열리는지도 확인한다.

## 제안 fixture: 허용·거부·장애를 분리한다

다음 fixture는 sandbox resource와 부작용 없는 mock tool을 대상으로 하는 **제안**이다. 실제 AgentCore 환경에서 실행했다고 주장하지 않는다.

첫 번째 시나리오는 정상 읽기다. canary prompt가 허용된 `read` action을 한 번 요청하고, hook event, tool-use ID, allow decision, tool 결과와 최종 stop reason을 수집한다. 기대 계약은 “한 번 허용된 입력과 한 번의 tool 결과가 같은 correlation으로 연결됨”이다.

두 번째는 승인 없는 고위험 변경이다. refund mock tool에 approval ID 없이 접근한다. `before_tool_call`이 deny하고 mock side-effect counter가 0인지 별도 store에서 읽는다. agent가 대체 tool이나 재명명된 action으로 우회하면 실패다.

세 번째는 변조된 승인이다. 승인 객체에는 action, 대상, 금액, 만료 시각과 canonical input digest를 넣는다. 승인 후 금액이나 대상을 바꾸면 deny되어야 한다. 승인 ID 존재만 검사하면 stale approval 재사용을 막지 못한다.

네 번째는 hook target 장애다. Lambda timeout, permission error, malformed response, EventBridge delivery 문제를 각각 주입한다. 이때 실제 서비스가 어떤 오류와 stop reason을 내는지는 현재 문서와 trace에서 확인해야 한다. 정책 목표는 고위험 action에 대해 **결정하지 못하면 실행하지 않음**이다. 제품이 자동으로 그 목표를 보장한다고 가정하지 말고 tool authorization 계층에서도 차단한다.

다섯 번째는 `after_tool_call` 오류 관측이다. 성공 tool, exception을 낸 tool, 결과가 큰 tool을 분리해 event의 result와 error field를 확인한다. 이미 완료된 부작용을 hook이 되돌린다고 쓰지 않는다.

## 기본값 drift는 canary trace로 잡는다

관리형 기본값을 선택했다면 정기 canary가 동일한 prompt를 보내고 결과 text보다 실행 계약을 비교해야 한다. 기록할 대상은 model identifier, system instruction digest를 얻을 수 있는 범위, tool inventory, hook event 순서, context offloading 여부, usage metadata와 stop reason이다.

공급자가 권장 모델이나 prompt를 바꾸는 것은 관리형 상품의 정상 변경일 수 있다. 문제는 변경 자체가 아니라 조직의 위험 가정이 조용히 깨지는 것이다. 다음 변화는 release gate를 다시 열도록 한다.

- 새 built-in tool이 tool inventory에 등장함
- 기존 tool name이나 input schema가 달라짐
- 같은 canary에서 hook event가 누락·중복됨
- deny 뒤 loop가 다른 변경 tool을 선택함
- context 관리로 승인 근거가 잘리거나 오래된 승인이 복원됨
- model·instruction source를 식별할 수 없어짐

canary는 실제 환불이나 삭제를 실행하지 않는다. sandbox의 가짜 resource와 mock action을 쓰고, side-effect counter가 0이라는 음성 증거를 읽는다. production 권한을 가진 canary는 안전 검사 자체가 새로운 위험이 된다.

## fail-closed는 hook 하나가 아니라 겹친 계약이다

안전 경계는 네 층으로 나누는 편이 낫다.

1. **Harness 설정:** 불필요한 tool을 애초에 노출하지 않는다.
2. **Before hook:** action과 canonical input, approval digest를 검증한다.
3. **Tool authorization:** IAM과 대상 서비스가 최종 권한을 제한한다.
4. **After evidence:** 실행 결과를 읽어 승인된 대상과 일치하는지 대조한다.

hook event는 감사에 유용하지만 IAM의 대체재가 아니다. IAM이 넓고 hook만 좁다면 hook 장애가 곧 권한 노출이 된다. 반대로 IAM만 좁혀도 “허용된 범위 안의 잘못된 환불” 같은 업무 정책 오류는 막지 못한다.

retry도 명시해야 한다. 같은 tool-use ID가 재전송됐을 때 idempotency key로 중복 부작용을 막고, 결과를 모르는 timeout을 성공이나 실패로 단정하지 않는다. 외부 시스템에서 최종 상태를 읽을 때까지 `unknown`으로 두는 것이 맞다.

## 배포 전 회귀 판정표

- 관리형 기본값과 명시적으로 pin한 설정을 inventory에서 구분한다.
- harness가 GA라는 사실과 대상 리전에서의 지원 여부를 분리하고 공식 리전 표를 확인한다.[3][4]
- built-in tool과 lifecycle hook의 상태·리전 가용성을 각각 문서와 release note에서 확인한다.[2][4]
- `before_invocation`, `before_tool_call`, `after_tool_call`의 deny 효과를 서로 바꾸어 쓰지 않는다.[2]
- irreversible action은 `after_tool_call`이 아니라 실행 전 승인과 tool 권한에서 막는다.
- unknown tool·schema·정책 오류는 고위험 범주에서 deny한다.
- deny 뒤 agent가 다른 tool로 우회하지 않는지 확인한다.
- file tool 호환 기간의 이중 event를 실제 이중 실행과 구분한다.[2]
- hook target timeout과 권한 오류를 주입하고 side effect 0을 읽는다.
- 실험을 실행하기 전에는 “fail-closed를 검증했다”가 아니라 “검증안”이라고 쓴다.

AgentCore hook의 가치는 비결정적 agent loop에 결정적 checkpoint를 넣는 데 있다. 하지만 checkpoint는 transaction도, rollback도, IAM도 아니다. 관리형 기본값을 inventory로 만들고, 고위험 action을 실행 전에 검증하며, hook 장애와 tool 우회를 함께 시험할 때 비로소 공급자 변화에 닫힌 운영 계약을 만들 수 있다.

## Sources

[1] https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-harness-adds-strands-harness-defaults-built-in-tools-and-lifecycle-hooks/
[2] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-lifecycle-hooks.html
[3] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness.html
[4] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html
