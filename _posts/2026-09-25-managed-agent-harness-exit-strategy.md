---
title: '관리형 Agent Harness Exit Strategy: 세션·도구·Artifact 이식성'
date: 2026-09-25 10:20:00 +0900
categories: ["AI 에이전트"]
description: '관리형 harness의 업무 상태와 도구 계약, artifact를 분리해 공급자 장애와 이전을 검증하는 방법.'
featured_image: 'https://picsum.photos/seed/managed-agent-harness-exit-strategy/1600/900'
tags: [ai-agent, agents-api, managed-harness, portability, vendor-lock-in, disaster-recovery, agentops]
---

![관리형 Agent Harness Exit Strategy](https://picsum.photos/seed/managed-agent-harness-exit-strategy/1600/900)

관리형 agent harness는 에이전트 제품을 빠르게 만드는 강력한 선택이다. 세션 유지, 도구 호출 반복, context compaction, subagent 위임, 실행 환경 연결, 중단 후 재개를 직접 구현하지 않아도 된다. OpenAI Agents API도 OpenAI가 session, orchestration, context compaction, recovery를 관리하고 애플리케이션이 도구와 실행 환경을 제공하는 경계를 제시한다.[1]

하지만 이 편의에는 구조적인 질문이 따른다.

> 관리형 세션이 중단되거나 가격·기능·정책이 바뀌었을 때, 진행 중인 업무를 다른 실행기로 옮길 수 있는가?

대부분의 팀은 도입 시 API 호출 방법과 정상 경로부터 구현한다. Exit strategy는 계약 갱신이나 실제 장애가 발생한 뒤에야 논의한다. 그때는 이미 세션 ID, event schema, tool call 형식, artifact 경로, compaction 결과가 공급자 모델에 깊게 묶여 있다. “다른 모델을 호출한다”는 정도로는 진행 중인 agent workflow를 복구할 수 없다.

이 글은 Agents API의 기능 소개가 아니다. 관리형 harness를 사용하면서도 **업무 상태와 복구권을 애플리케이션이 유지하는 방법**을 다룬다.

## 모델 이식성과 harness 이식성은 다르다

모델 이식성은 동일한 prompt를 다른 모델 API에 보낼 수 있는지 묻는다. Harness 이식성은 훨씬 넓다.

- 진행 중인 목표와 완료 조건은 어디에 있는가?
- 이미 실행한 tool call과 외부 부작용을 재구성할 수 있는가?
- 사람이 승인한 범위와 만료 시각을 복원할 수 있는가?
- compaction 과정에서 사라진 원문 사실을 다시 얻을 수 있는가?
- sandbox에 남은 파일과 artifact를 다른 환경으로 옮길 수 있는가?
- parent agent와 subagent의 작업 관계를 재현할 수 있는가?
- stream이 끊긴 시점과 실제 외부 상태의 차이를 판별할 수 있는가?

OpenAI 문서는 session을 지속 가능한 작업 인스턴스로 설명하고, events와 saved items를 통해 진행 상황과 저장된 메시지·도구 호출을 조회할 수 있다고 설명한다.[1][2] 이는 복구에 유용한 기반이다. 하지만 공급자의 session 자체가 조직 업무의 유일한 source of truth가 되면 다른 harness가 그 의미를 그대로 이해하지 못한다.

따라서 이식성의 목표는 공급자 내부 실행을 완벽히 복제하는 것이 아니다. **업무를 안전한 checkpoint에서 재시작할 수 있을 만큼 상태와 증거를 소유하는 것**이다.

## 먼저 두 종류의 상태를 분리한다

에이전트 실행 상태는 크게 두 층으로 나눌 수 있다.

### Harness 상태

- 모델 대화와 내부 context
- 현재 turn과 subagent 상태
- tool call item과 streaming delta
- compaction으로 생성된 작업 기억
- 공급자별 environment 연결 상태
- 공급자 session ID와 event cursor

### 업무 상태

- 사용자가 달성하려는 목표
- 입력 데이터와 원본 요구사항
- 완료·실패·중단 조건
- 이미 반영된 외부 변경
- 사람의 승인과 정책 결정
- 검증 결과와 남은 작업
- 비용·시간·재시도 budget
- 결과 artifact와 provenance

Harness 상태는 공급자에 따라 달라도 된다. 업무 상태는 공급자가 바뀌어도 의미가 유지돼야 한다. 문제는 두 상태를 같은 대화 기록에 넣는 순간 시작된다. “PR을 만들었고 테스트가 통과했다”는 문장이 context 안에만 존재하면 실제 PR 번호, commit SHA, 테스트 명령, 결과를 신뢰할 수 없다.

업무 상태는 구조화된 내부 기록으로 따로 보관해야 한다.

```yaml
work_item_id: work_01K...
goal: "결제 API의 중복 청구 버그 수정"
base_revision: "8b11c0..."
acceptance_criteria:
  - "동일 idempotency key 재호출 시 청구가 한 번만 발생"
  - "기존 결제 통합 테스트 통과"
policy:
  risk_class: high
  production_write: forbidden
approvals:
  - id: approval_42
    scope: "staging test data write"
    expires_at: "2026-09-25T12:00:00+09:00"
external_effects:
  - type: git_branch
    id: "agent/fix-idempotency"
    verified: true
checkpoints:
  - id: cp_03
    status: verified
    artifact_digest: "sha256:..."
next_action: "독립 reviewer가 diff와 회귀 테스트 검토"
```

이 schema는 Agents API 표준 필드가 아니라 조직이 정의하는 portability contract의 예시다. 공급자 객체를 복사하는 것이 아니라 업무 의미를 보존한다.

## 이식성을 깨뜨리는 공급자 종속점

Agents API의 기능과 운영 경계는 기존 글에서 자세히 다뤘다. Exit strategy에서는 기능을 다시 설명하기보다 **어떤 상태가 공급자 안에만 남으면 복구가 막히는지**만 확인하면 된다.

| 종속점 | 공급자 안에만 둘 때의 위험 | 애플리케이션이 소유할 최소 상태 |
|---|---|---|
| event stream과 saved item | 연결 중 놓친 event를 완전한 원장처럼 복구할 수 없다.[2] | 의미 있는 상태 전환, provider ID, 외부 transaction ID |
| terminal state | turn `completed`가 tool·업무 성공을 보장하지 않는다.[2][3] | artifact 확인, side-effect read-back, validator 결과 |
| tool callback | 인증·retry·approval 의미까지 SDK callback에 잠긴다. | canonical command/result, idempotency key, policy decision |
| compaction | 요약에서 사라진 요구사항·금지 조건을 복원할 수 없다.[1] | 원문 요구사항, 승인, 실패 이력, checkpoint |
| hosted workspace | sandbox lifecycle과 조직 보존 정책이 결합된다.[3] | 내부 저장소의 artifact, hash, provenance, base revision |

Event stream은 실시간 관찰 신호이고 dashboard·history는 완료된 작업과 token usage를 점검하는 수단이다.[4] 둘 다 유용하지만 내부 workflow ledger를 대신하지 않는다. Ledger에는 `work.started`, `tool.effect.verified`, `approval.granted`, `checkpoint.created`, `validation.failed`, `handoff.prepared`처럼 공급자가 바뀌어도 의미가 유지되는 전환만 저장한다.

Tool contract도 provider payload가 아니라 검증 가능한 내부 명령으로 고정한다.

```json
{
  "operation": "github.pull_request.create",
  "actor": "agent-runtime-17",
  "repository_id": 123456,
  "base_sha": "8b11c0...",
  "head_branch": "agent/fix-idempotency",
  "idempotency_key": "work_01K...:pr:create",
  "approval_id": "approval_42"
}
```

새 harness에는 전체 대화를 무조건 replay하지 않는다. 최신 검증 checkpoint를 기준으로 복구에 필요한 사실과 증거만 handoff package에 담는다.

```text
handoff/
├── manifest.json
├── brief.md
├── policy.json
├── approvals.json
├── effects.jsonl
├── validation.json
├── artifacts/
└── provenance.json
```

Artifact는 sandbox 만료 전에 내부 저장소로 복사하고 hash·크기·media type·생성 tool·base revision을 기록한다. 복원할 때는 manifest가 허용한 상대 경로만 사용하고 traversal, symlink, 실행 권한을 다시 검사한다. Handoff package에는 secret이나 내부 chain-of-thought를 넣지 않는다.

## 이중 실행보다 shadow replay가 안전하다

공급자 교체를 검증하기 위해 같은 작업을 두 harness에 동시에 쓰게 하는 것은 위험하다. 두 agent가 branch, comment, ticket, 배포를 중복 생성할 수 있다.

대신 세 단계로 검증한다.

### 1. Offline replay

과거 업무의 입력과 checkpoint를 새 harness에 제공하되 외부 tool을 deterministic stub으로 대체한다. 계획, tool 선택, 최종 artifact가 acceptance criteria를 충족하는지 비교한다.

### 2. Read-only shadow

실제 요청을 새 harness에도 보내지만 검색과 분석 도구만 허용한다. 기존 harness의 결과와 비교하되 쓰기 결과는 폐기한다. 두 경로의 latency, tool 선택, token, 실패 유형을 기록한다.

### 3. Bounded canary

낮은 위험 업무 일부만 새 harness에 맡긴다. 쓰기 tool은 staging 또는 전용 repository로 제한하고 사람 승인을 유지한다. 실패 시 기존 harness에서 새 session을 시작할 수 있는 handoff package를 생성한다.

이 방식은 즉시 active-active를 만드는 것보다 느리지만 side effect 충돌과 데이터 오염을 줄인다.

## 공급자 장애 시 복구 순서

장애가 발생하면 무조건 다른 harness에 마지막 prompt를 다시 보내서는 안 된다. 먼저 외부 상태를 확인해야 한다.

1. 새 작업 유입을 중단한다.
2. 공급자 session과 turn의 마지막 확인 상태를 읽는다.
3. `requested but unverified` tool call을 찾는다.
4. 외부 시스템을 read-back해 실제 반영 여부를 확인한다.
5. 늦은 결과가 반영되지 않도록 generation 또는 fencing token을 갱신한다.
6. 마지막 검증된 checkpoint와 artifact를 선택한다.
7. 유효한 approval과 credential만 다시 발급한다.
8. Handoff package를 새 harness에 넣는다.
9. 새 harness는 완료된 단계를 재실행하지 않고 남은 단계부터 시작한다.
10. 최종 결과를 기존 acceptance criteria로 다시 검증한다.

여기서 핵심 상태는 `FAILED`가 아니라 `UNKNOWN_EFFECT`다. 요청을 보냈지만 결과를 받지 못한 작업은 실패로 간주해 재시도하기보다 실제 상태를 먼저 조회해야 한다.

## 이식성 수준을 과장하지 않는다

모든 harness 기능을 공통화하려 하면 가장 낮은 공통분모만 남는다. 반대로 vendor-specific 기능을 금지하면 관리형 서비스를 도입한 이점이 줄어든다. 현실적인 방법은 이식성 수준을 나누는 것이다.

### Level 0: 결과만 보존

최종 응답과 artifact만 저장한다. 과거 결과 열람은 가능하지만 진행 중 작업 복구는 어렵다.

### Level 1: 업무 상태 보존

목표, 정책, 외부 효과, 검증 결과, checkpoint를 내부 ledger에 저장한다. 다른 harness에서 수동 재시작할 수 있다.

### Level 2: 도구 계약 이식

공급자와 독립적인 tool gateway와 canonical result를 사용한다. 제한된 자동 handoff가 가능하다.

### Level 3: 정기 migration drill

장애 주입, artifact export, unknown effect 확인, 새 harness 재개를 정기적으로 시험한다. 복구 시간과 데이터 손실 범위를 측정한다.

대부분의 팀은 Level 1과 Level 2 사이가 현실적이다. 완전한 실시간 이동보다 안전한 checkpoint 재시작을 목표로 하는 편이 단순하다.

## 도입 전 체크리스트

- [ ] 내부 work item ID와 provider session ID를 분리했다.
- [ ] 목표·완료 조건·정책·승인·외부 효과를 canonical ledger에 저장한다.
- [ ] compaction summary, saved item, raw event의 보존 목적을 구분한다.
- [ ] 공급자 SDK 바깥에 canonical tool contract와 idempotency key가 있다.
- [ ] timeout 뒤 재시도 전에 외부 상태를 read-back하고 `UNKNOWN_EFFECT`를 처리한다.
- [ ] tool 성공과 업무 성공을 별도 상태로 기록한다.
- [ ] artifact를 내부 저장소로 복사하고 hash와 base revision을 검증한다.
- [ ] sandbox 만료 전에 checkpoint와 필요한 결과를 export한다.
- [ ] handoff package에서 secret과 불필요한 민감 데이터를 제거한다.
- [ ] 진행 중 session을 중단하고 credential을 회수할 수 있다.
- [ ] 새 harness adapter로 offline replay와 read-only shadow를 수행한다.
- [ ] migration drill에서 RTO·수동 개입·중복 부작용을 측정한다.

## 결론

관리형 agent harness의 가치는 분명하다. Session, orchestration, compaction, recovery 같은 반복적인 실행 계층을 서비스로 사용하면 팀은 제품의 도구와 업무 흐름에 더 집중할 수 있다.[1] 그러나 편의가 곧 이식성을 의미하지는 않는다.

Exit strategy의 목표는 공급자 내부 상태를 완벽히 복제하는 것이 아니다. 조직이 업무 목표, 승인, 외부 부작용, 검증 결과, artifact와 checkpoint를 소유하고 다른 harness에서 안전하게 재시작할 수 있도록 만드는 것이다. Event stream은 실시간 신호이고, saved item은 복구 재료이며, sandbox workspace는 임시 실행 공간이다. 어느 것도 혼자서 업무 원장을 대신하지 않는다.[2][3]

가장 위험한 vendor lock-in은 API 문법이 아니다. 무엇을 했고 무엇이 남았는지 공급자 session 없이는 설명할 수 없는 상태다. 관리형 harness를 도입하기 전에 최소한 하나의 실제 작업을 export하고, session을 잃었다고 가정한 뒤, 다른 실행기에서 checkpoint부터 복구해 보자. 그 훈련이 성공해야 비로소 “교체 가능한 아키텍처”라고 말할 수 있다.

## Sources

[1] https://developers.openai.com/api/docs/guides/agents-api/overview — Agents API overview
[2] https://developers.openai.com/api/docs/guides/agents-api/sessions/events — Events and items
[3] https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted — OpenAI-hosted sandboxes
[4] https://developers.openai.com/api/docs/guides/agents-api/observability — Observability and usage
