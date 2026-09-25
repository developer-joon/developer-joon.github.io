---
title: '코딩 에이전트 운영 통제: Sandbox·권한·OTel·Proof of Presence'
date: 2026-09-25 09:00:00 +0900
categories: ["AI 에이전트"]
description: 'GitHub Copilot의 sandbox, 관리형 권한, OpenTelemetry와 Proof of Presence를 연결해 실행·승인·감사를 설계하는 방법.'
featured_image: 'https://picsum.photos/seed/coding-agent-operations-control-plane/1600/900'
tags: [github-copilot, coding-agent, sandbox, opentelemetry, permissions, proof-of-presence, agent-security]
---

![코딩 에이전트 운영 통제면](https://picsum.photos/seed/coding-agent-operations-control-plane/1600/900)

코딩 에이전트의 위험은 “코드를 틀리게 생성한다”에서 끝나지 않는다. 이제 에이전트는 셸을 실행하고, 파일을 읽고 고치며, 패키지를 내려받고, Git 자격 증명을 사용하고, 원격 시스템에 요청을 보낸다. 자연어 답변의 품질 문제가 로컬 워크스테이션과 소프트웨어 공급망의 변경 문제로 바뀐 것이다.

GitHub가 2026년 9월 발표한 변화에는 Copilot 앱의 로컬 sandbox와 기업 관리형 agent operation 권한이 포함된다.[1][3]
같은 달 OpenTelemetry 내보내기와 고영향 작업 전 proof of presence도 발표됐다.[2][4] 이들을 각각 “새 기능”으로만 보면 설정 화면 네 개가 늘어난 것처럼 보인다. 운영 관점에서는 다르다. **실행을 격리하고, 행동을 판정하고, 전 과정을 추적하며, 가장 민감한 경계에서 인간의 현재 의사를 다시 확인하는 통제면**이 만들어지고 있다.

이 글은 에이전트 harness의 선택이나 self-hosted 실행 환경 구축을 설명하지 않는다. 검색 의도도 “Copilot 신기능 요약”이 아니다. 목표는 이미 코딩 에이전트를 도입하기로 한 조직이 다음 질문에 답할 수 있는 운영 모델을 만드는 것이다.

- 어떤 명령이 어디에서 실행됐는가?
- 실행 전에 어느 정책이 허용·거부·승인을 결정했는가?
- sandbox가 실제로 적용되지 못했을 때 무엇이 일어났는가?
- 승인한 사람은 어떤 대상과 변경 내용을 보고 승인했는가?
- 세션 쿠키나 장기 토큰만으로 고영향 작업을 밀어붙일 수 있는가?
- 사고 후 하나의 trace에서 계획, 정책, 명령, 파일 변경, 네트워크 요청, 사람의 개입을 재구성할 수 있는가?

핵심 주장은 간단하다. **sandbox, permission, telemetry, proof of presence 중 하나만 도입해서는 에이전트 운영 통제가 완성되지 않는다.** 네 계층은 서로 다른 실패를 막으며, 서로를 대체하지 않는다.

## 먼저 공식 발표의 범위를 좁혀 읽자

운영 설계를 시작하기 전에 GitHub가 실제로 발표한 사실과 이 글의 해석을 분리해야 한다.

### GitHub가 공식적으로 밝힌 내용

Copilot 앱의 로컬 sandbox는 파일, 네트워크 자원, 로컬 자격 증명에 대한 접근을 제한한다. 프로젝트별로 추가 읽기·쓰기 경로, 읽기 전용 경로, 거부 폴더, outbound internet, local network, Git 및 GitHub CLI 자격 증명 사용을 설정할 수 있다.[1] 프로젝트 설정은 sandbox 세션이 요청하는 정책이며, 기업 관리형 설정이 적용되면 실제 유효 정책은 더 제한적일 수 있다.[1]

이 로컬 sandbox는 기본적으로 꺼져 있고, 프로젝트의 **새 세션**에 적용된다. 이미 실행 중인 세션에는 자동 소급되지 않으며, 운영체제가 요청 정책을 집행할 수 없으면 sandbox shell은 격리 없이 계속 실행하지 않고 오류로 종료된다.[1] GitHub 문서상 Copilot 앱의 로컬 sandbox는 public preview이고, Copilot CLI의 로컬 sandbox는 experimental 상태다.[1][5]

기업 관리형 권한은 shell command, file read/edit, network domain을 중앙에서 `deny`, `ask`, `allow`로 통제한다. GitHub는 관리형 제한이 사용자나 workspace 설정, auto-approval, 과거에 저장한 승인으로 약화될 수 없다고 설명한다. 팀별 전문 정책도 제공할 수 있으며, Copilot 앱·Copilot CLI·Agent Host를 사용하는 VS Code 세션에서 일반 제공된다.[3]

Copilot 앱의 OpenTelemetry 설정은 기업 관리형 설정을 통해 agent session, AI model 요청, tool 사용 흐름을 조직의 호환 모니터링 도구로 보낼 수 있게 한다. prompt와 response 본문은 기본적으로 제외된다.[2] 관리형 설정 레퍼런스에는 OTLP endpoint, 전송 protocol, content capture, service name, resource attributes, header를 지정하는 항목이 제시돼 있다.[6][7]

Proof of presence는 enterprise sudo mode에 IdP challenge를 추가한다. 보호된 고영향 작업을 시도하면 기업 IdP로 다시 인증해야 하며, 같은 sudo-mode session과 timeout model을 사용한다.[8] 2026년 9월 24일 발표된 public preview의 범위는 Microsoft Entra ID를 SAML 또는 OIDC IdP로 쓰는 Enterprise Managed Users 기업의 github.com과 GHEC-DR이다. 성공 후 브라우저 세션에서는 2시간 동안 추가 proof 없이 고영향 작업을 수행할 수 있고, pull request merge 전 적용은 당시 “coming soon”으로 안내됐다.[4]

### 이 글의 운영 해석

다음부터 제안하는 span 이름, 승인 토큰 필드, 위험 등급, SLO, 장애 분류는 GitHub가 정의한 프로토콜이 아니다. 공식 기능을 조직의 운영 체계에 연결하기 위한 **설계 제안**이다. 특히 proof of presence는 현재 “모든 에이전트 작업에 사람 승인을 붙이는 기능”이 아니다. 지원 범위와 보호 대상이 정해진 GitHub 계정 보안 기능이다.[4][8] 이를 에이전트 승인 모델의 완성품으로 과장하지 않고, 별도의 인간 확인 계층을 설계할 때 참고할 원칙으로 사용한다.

## 네 개의 통제는 서로 다른 질문에 답한다

네 통제를 한 문장으로 합치면 오히려 경계가 흐려진다. 각각이 답하는 질문부터 분리하자.

| 통제 계층 | 답해야 하는 질문 | 막으려는 대표 실패 | 막지 못하는 것 |
|---|---|---|---|
| Sandbox | 프로세스가 실제로 무엇에 닿을 수 있는가? | 홈 디렉터리 탐색, 자격 증명 탈취, 임의 egress | 허용 범위 안에서의 악의적 변경 |
| Managed permissions | 요청한 행동을 정책상 실행해도 되는가? | 금지 명령, 민감 파일 수정, 미승인 domain 접근 | 허용된 명령 내부의 복합 부작용 |
| OpenTelemetry | 실제로 어떤 판단과 실행이 이어졌는가? | 조사 불가능, 정책 우회 미탐지, 병목 은폐 | 그 자체로 행동을 차단하는 것 |
| Proof of presence | 민감 행동 시점에 권한 있는 사람이 실제로 개입했는가? | 탈취 세션·토큰만으로 고영향 작업 수행 | 승인 이후 2시간 동안의 모든 오판 |

여기서 중요한 것은 “방어 심층화”를 제품 수 늘리기로 이해하지 않는 것이다. 네 계층이 같은 `session_id`, `policy_decision_id`, `approval_id`, `trace_id`로 연결되지 않으면 운영자는 네 개의 콘솔을 오가면서 정황을 추측하게 된다. 통제의 개수보다 **결정과 실행 사이의 인과관계**가 중요하다.

## 운영 설계 1: Sandbox를 신뢰 경계로 모델링하라

Sandbox의 첫 목적은 명령이 성공하게 만드는 것이 아니라 잘못된 명령의 영향 반경을 제한하는 것이다. 따라서 “sandbox enabled: true”를 보안 완료 신호로 쓰면 안 된다. 실제 유효 정책과 실행 결과를 관찰해야 한다.

### 기본 정책은 읽기보다 더 좁아야 한다

개발자는 저장소 전체 읽기와 현재 작업 트리 쓰기를 당연하게 생각한다. 그러나 에이전트 세션에는 더 좁은 경계가 가능하다.

1. 작업 디렉터리만 읽기 허용
2. 변경 대상 경로만 쓰기 허용
3. `.git`, SSH 설정, cloud credential, package manager token 경로는 명시적으로 거부
4. local network는 기본 차단
5. outbound internet은 package registry, source host 등 목적지 allowlist로 제한
6. Git·GitHub CLI 자격 증명 주입은 작업 단계별로 분리
7. MCP·LSP 같은 하위 프로세스도 가능한 경우 같은 sandbox 경계 안에서 실행

GitHub의 managed sandbox 설정은 sandbox 강제, bypass 금지, current working directory 자동 grant 제한, MCP/LSP sandbox 강제, Git 또는 `gh` 인증 주입 금지, local/outbound network 차단 같은 제한을 중앙에서 더할 수 있다.[6] 문서가 설명하는 핵심 의미는 관리 설정이 사용자 설정의 “편리한 기본값”이 아니라 완화할 수 없는 최소 제한이라는 점이다.[5][6]

### 정책 계산과 정책 집행을 따로 기록하라

세션 시작 시 다음 세 상태를 구분해야 한다.

- `requested_policy`: 프로젝트나 사용자가 요청한 정책
- `effective_policy`: 기업 정책과 OS 제약을 합성한 최종 정책
- `enforcement_result`: 실제 프로세스 시작 시 적용 성공 여부

예를 들어 프로젝트는 `/work/repo` 쓰기와 인터넷 접근을 요청했지만, 기업 정책이 인터넷을 차단하고 `/work/repo/generated`만 쓰도록 좁힐 수 있다. trace에 requested만 남기면 “인터넷을 허용했다”는 잘못된 결론을 내리고, effective만 남기면 사용자가 더 넓은 접근을 시도했다는 탐지 신호를 잃는다.

정책 원문 전체를 매 span에 복사할 필요는 없다. 정규화한 정책의 hash와 version을 기록하고, 별도 정책 저장소에서 해당 시점의 문서를 조회할 수 있게 한다. 단, hash가 같다는 사실만으로 집행이 같았다고 보면 안 된다. OS, 앱 버전, sandbox backend, 시작 오류도 함께 남겨야 한다.

### Fail-closed를 정상 장애로 다뤄라

GitHub는 OS가 요청 정책을 집행하지 못하면 격리 없이 실행하지 않고 shell을 실패시킨다고 명시한다.[1] 이것은 불편한 예외가 아니라 보안 설계의 핵심이다. 운영팀은 이 실패를 “에이전트 가용성 저하”로만 보고 sandbox를 끄도록 유도해서는 안 된다.

권장 상태 전이는 다음과 같다.

```text
SESSION_REQUESTED
  -> POLICY_RESOLVED
  -> SANDBOX_STARTING
  -> SANDBOX_ENFORCED
  -> COMMANDS_ALLOWED

SANDBOX_STARTING
  -> ENFORCEMENT_UNAVAILABLE
  -> SESSION_BLOCKED
  -> HUMAN_REMEDIATION
```

`ENFORCEMENT_UNAVAILABLE`에서 unsandboxed fallback으로 넘어가는 edge를 만들지 않는 것이 중요하다. 예외가 정말 필요하다면 일반 재시도가 아니라 별도의 break-glass workflow로 보내고, 더 강한 승인, 짧은 만료, 화면 경고, 전체 trace 보존을 요구해야 한다.

## 운영 설계 2: Managed permissions를 trace의 정책 결정으로 연결하라

System prompt는 행동 지침이지 권한 경계가 아니다. GitHub의 관리형 권한은 shell·file·network operation을 `deny`, `ask`, `allow`로 분류하고, 중앙 제한을 로컬 설정이 약화하지 못하게 한다.[3]

| 결정 | 실행 의미 | trace에 남길 값 |
|---|---|---|
| `deny` | 실행과 반복 승인 요청을 차단 | operation, resource, reason code |
| `ask` | 현재 입력과 예상 효과를 고정하고 사람 결정을 대기 | request digest, policy version, approval ID |
| `allow` | 현재 sandbox와 정책 범위에서 실행 | effective sandbox policy, executor result |

정책은 `deny > ask > allow` 순으로 가장 제한적인 결과를 선택하고, managed source와 사용자 설정도 보수적으로 합성한다.[6] 명령 문자열만 보면 wrapper·package script를 놓치므로 trace는 모델이 요청한 operation, 실제 command·resource, sandbox가 관찰한 효과를 하나로 연결해야 한다. 상세한 identity·credential 수명 주기는 별도의 Agent IAM 글에서 다룬다.

## 운영 설계 3: OpenTelemetry trace를 실행 증거로 만들라

GitHub는 Copilot agent session에서 model과 tool의 흐름을 OTel 호환 도구로 보낼 수 있고, 중앙 관리 설정으로 endpoint를 지정할 수 있다고 설명한다.[2][7] 이것은 출발점이지 완성된 감사 모델은 아니다. 관찰 backend에 span이 도착해도 정책 결정, 실제 변경, 사람 승인과 연결되지 않으면 “agent가 tool을 썼다”는 정도만 알 수 있다.

### 권장 trace 계층

한 사용자 요청을 root trace로 잡고 다음 span 계층을 권장한다.

```text
agent.session                         # root
├─ agent.turn                         # 사용자 입력 단위
│  ├─ model.inference                 # 모델 요청/응답 메타데이터
│  ├─ policy.evaluate                 # deny/ask/allow 결정
│  ├─ approval.wait                   # 사람 결정을 기다린 시간
│  ├─ sandbox.command                 # 격리된 명령 실행
│  │  ├─ filesystem.effect            # 실제 읽기/쓰기 요약
│  │  └─ network.effect               # 실제 목적지/결과 요약
│  ├─ tool.invoke                     # MCP, GitHub CLI 등 도구 호출
│  └─ verification.readback           # 변경 결과 재확인
└─ session.finalize                   # 결과·잔여 변경·폐기 상태
```

`model.inference`와 `tool.invoke`만 있으면 에이전트 행동은 보이지만 통제의 작동은 보이지 않는다. 반드시 `policy.evaluate`, `approval.wait`, `sandbox.command`를 동등한 운영 span으로 취급해야 한다.

### 최소 attribute schema

다음 필드는 OpenTelemetry 표준 semantic convention이라고 주장하는 값이 아니다. 조직이 별도 namespace로 정의할 운영 확장안이다.

| 범주 | 권장 attribute | 목적 |
|---|---|---|
| 신원 | `agent.user.id_hash`, `agent.enterprise.id`, `agent.team.id` | tenant 및 사용자 상관관계 |
| 세션 | `agent.session.id`, `agent.turn.id`, `agent.mode` | root부터 command까지 연결 |
| 버전 | `agent.client.version`, `agent.model.id`, `agent.policy.version` | 변경 전후 회귀 분석 |
| 격리 | `agent.sandbox.enabled`, `agent.sandbox.backend`, `agent.sandbox.policy_hash` | 실제 집행 상태 확인 |
| 권한 | `agent.permission.operation`, `agent.permission.decision`, `agent.permission.reason_code` | 허용·거부·승인 분포 분석 |
| 승인 | `agent.approval.id`, `agent.approval.actor_hash`, `agent.approval.expires_at` | 누가 무엇을 언제 승인했는지 연결 |
| 대상 | `agent.resource.kind`, `agent.resource.id_hash`, `agent.repo.id` | 영향 받은 객체 식별 |
| 효과 | `agent.effect.type`, `agent.effect.count`, `agent.effect.digest` | 실제 변경 요약과 무결성 확인 |

민감한 파일 path, command argument, prompt 전문을 attribute에 그대로 넣으면 telemetry backend가 두 번째 비밀 저장소가 된다. GitHub 발표도 prompt와 response content가 기본 제외된다고 명시한다.[2] 기본값을 유지하고, 원문 capture가 반드시 필요한 조사 환경에서만 별도 권한·보존 기간·마스킹을 적용하는 편이 낫다.

### Event, status, link를 구분하라

- **Span status**는 작업 성공 여부를 표현한다. 정책상 deny는 시스템 오류가 아니라 정상적인 통제 결과일 수 있으므로 `ERROR` 하나로 뭉개지 않는다.
- **Event**는 `permission.denied`, `approval.requested`, `sandbox.violation`, `credential.blocked` 같은 순간을 기록한다.
- **Link**는 브라우저에서 이루어진 proof-of-presence challenge, 외부 CI run, Git commit처럼 다른 trace 또는 audit record를 연결한다.

이 구분이 없으면 거부율이 높아진 것이 공격 탐지인지, 정책 오설정인지, agent 계획 품질 저하인지 판단하기 어렵다.

### Trace만으로 감사가 완성되지는 않는다

OTel backend는 sampling, cardinality 제한, retention, exporter failure의 영향을 받는다. 따라서 법적 감사나 변경 승인 증거를 trace 하나에만 맡겨서는 안 된다. 정책 결정 record와 승인 record는 불변 감사 저장소에 별도로 보존하고, trace에는 그 ID와 digest를 연결한다.

권장 원칙은 이렇다.

- 성능·행동 분석: OTel trace
- 정책의 최종 결정: policy decision log
- 인간의 승인과 identity freshness: approval/audit log
- 실제 Git 변경: commit, branch protection, repository audit log
- 비밀 접근: vault 또는 credential broker audit log

모든 원본을 한곳에 복제하는 것이 아니라, ID와 digest로 연쇄를 만든다.

## 운영 설계 4: Approval과 Proof of Presence를 trace에 분리하라

업무 승인은 “이 변경이 적절한가?”를, Proof of Presence는 “실제 권한자가 지금 개입했는가?”를 확인한다. GitHub PoP는 IdP 재인증 또는 MFA로 고영향 작업의 identity freshness를 높이지만, 잘못된 diff 자체를 판별하지는 않는다.[4]

| 증거 | binding | 만료 조건 |
|---|---|---|
| 업무 승인 | operation, target, diff digest, policy version | 입력·대상·정책 변경 |
| Proof of Presence | 사용자, browser session, IdP challenge | GitHub 지원 범위와 sudo-mode session |
| 실행 결과 | sandbox policy hash, command/effect digest | 단일 실행 완료 또는 실패 |

Trace에서는 `approval.review → identity.freshness.challenge → sandbox.command → verification.readback` 순서를 연결한다. 현재 PoP public preview는 대상과 경로가 제한되고 성공 후 sudo-mode session도 2시간 유지되므로, 더 민감한 작업에는 짧은 single-use capability나 별도 step-up 인증이 필요하다.[4] 구체적인 credential 발급과 revoke는 Agent IAM 글의 책임이다.

## 네 통제가 결합될 때 생기는 다섯 실패모드

| 실패 | 잘못된 상태 | 필요한 통제와 증거 |
|---|---|---|
| Sandbox enforcement 불가 | UI는 격리 세션처럼 보이지만 host shell로 fallback | fail-closed, `enforcement_result=failed`, backend reason[1] |
| 승인 뒤 대상 변경 | 사람이 본 diff·branch와 실제 실행 대상이 다름 | 실행 직전 digest·HEAD·policy version 재검증 |
| Telemetry exporter 손실 | 변경은 계속되지만 trace만 사라짐 | drop·queue saturation 경보, 고위험 write의 read-only 강등 |
| PoP freshness 과대평가 | 한 번의 MFA를 장시간 포괄 승인으로 해석 | PoP와 operation approval의 별도 만료, 짧은 single-use binding[4] |
| MCP/LSP 경계 이탈 | command는 sandbox 안이지만 local server는 host 권한 | local MCP/LSP sandbox 강제, remote server의 별도 identity·network 정책[6] |

Content capture는 별도 위험이다. GitHub는 prompt와 response를 기본 제외하므로 이 기본을 유지하고, 조사 때문에 켤 때만 대상·기간·저장소를 제한한다.[2] Permission deny는 transient error가 아니라 통제 결과이므로 재시도하지 않고 계획 변경이나 사람 에스컬레이션으로 보낸다.

## Trace에서 봐야 할 운영 지표

“세션 성공률” 하나는 거의 아무것도 설명하지 못한다. 최소한 다음 지표를 위험 등급과 팀, repository, 정책 version별로 나눈다.

### 정책 품질

- operation별 deny·ask·allow 비율
- 같은 목표에서 의미상 동일한 deny 반복 횟수
- 사용자 override 시도와 enterprise policy 차단 횟수
- saved approval이 무효화된 이유
- 정책 변경 전후 agent 완료율과 우회 시도율

### 승인 품질

- approval wait p50/p95
- 승인·거부·만료 비율
- 승인 후 실행 전 digest mismatch 비율
- 한 승인으로 실행된 operation 수
- PoP challenge 성공·실패·timeout과 업무 승인 연결률

### Sandbox 건전성

- sandbox start 성공률과 backend별 실패 이유
- sandbox violation 종류: filesystem, network, credential
- 요청 정책과 유효 정책의 차이
- unsandboxed 또는 bypass 세션 수
- 세션 종료 후 남은 process와 working tree 수

### 관찰 가능성 건전성

- root trace 대비 policy span 존재율
- command span 대비 effective policy hash 기록률
- approval-required command의 approval link 연결률
- exporter drop·retry·queue saturation
- high-cardinality field와 content capture 사용량

### 결과 안전성

- 명령 성공 후 read-back verification 실패율
- 세션 종료 시 uncommitted change와 untracked file 비율
- 예상하지 않은 domain 및 credential 접근 시도
- human rollback과 incident 전환 횟수
- 같은 session에서 branch·HEAD 변경으로 승인 폐기된 횟수

이 지표의 목적은 개발자를 감시하는 것이 아니라 통제의 공백을 찾는 것이다. 개인별 생산성 순위로 사용하면 사용자는 agent를 조직 계정 밖에서 실행하거나 telemetry를 우회하려 할 수 있다. 수집 목적, 접근자, 보존 기간, 개인 평가 사용 금지를 정책에 명시해야 한다.

## 현실적인 도입 순서

네 통제를 동시에 production에 강제하면 어디서 실패했는지 구분하기 어렵다. 다음 순서가 비교적 안전하다.

### 0단계: 작업 분류와 금지선

먼저 agent operation catalog를 만든다.

- 읽기: source search, log read, dependency metadata 조회
- 제한 쓰기: 작업 트리 수정, test fixture 생성
- 공급망 변경: dependency 추가, lockfile 변경, workflow 수정
- 원격 변경: issue comment, branch push, PR 생성
- 고영향 변경: merge, release, webhook·token·security setting 변경

각 operation에 데이터 등급, 필요 credential, network destination, 최대 영향, rollback 가능성, 승인자를 붙인다. 분류가 없으면 `ask`가 너무 많아져 승인 피로가 생기거나, 반대로 broad allow가 남는다.

### 1단계: OTel을 먼저 연결하되 content는 수집하지 않는다

기존 동작을 바꾸기 전에 session, model, tool 흐름을 관찰한다. prompt·response content는 기본 제외 상태로 두고, trace completeness와 exporter 안정성부터 측정한다.[2] 기존 agent가 어떤 command, path, domain을 사용하는지 baseline을 만든다.

### 2단계: Managed permissions를 audit 성격으로 설계한다

즉시 모든 unknown operation을 deny하기보다 read/ask/deny 후보를 분류한다. 단, credential path, local network, production token 같은 명확한 금지선은 처음부터 deny한다. 정책 판정과 실제 효과의 차이를 trace로 확인한다.

### 3단계: Sandbox를 신규 세션에 강제한다

Copilot 앱의 프로젝트 sandbox 설정이 신규 세션에 적용되고 기존 세션에는 자동 소급되지 않는 점을 고려해 전환 창을 관리한다.[1] 활성 세션 목록을 확인하고, 재시작 기준과 종료 시점을 정한다. OS·backend별 fail-closed 테스트를 수행한다.

### 4단계: `ask`를 bound approval로 바꾼다

승인 화면에 정규화한 command, target, diff, network destination, credential 사용, 예상 효과를 보여준다. 승인 record를 digest와 policy version에 묶고, 변경되면 재승인한다. approval wait span으로 마찰을 측정해 정책을 세분화한다.

### 5단계: 고영향 작업에 identity freshness를 더한다

지원되는 GitHub Enterprise 범위에서는 PoP를 검토하되, EMU·Entra ID·배포 형태·보호 action 범위를 확인한다.[4][8] 지원되지 않는 작업에는 자체 step-up authentication을 둔다. PoP가 업무 승인이나 command binding을 대체하지 않게 한다.

### 6단계: 실패 주입과 운영 훈련

다음 조건을 의도적으로 만든다.

- sandbox backend unavailable
- managed deny와 saved approval 충돌
- 승인 대기 중 branch HEAD 변경
- OTLP collector timeout과 인증 오류
- network allowlist DNS 변화
- local MCP server의 금지 path 접근
- PoP challenge timeout 또는 IdP 장애
- command 성공 후 result read-back 실패

각 실험에서 agent가 멈췄는지뿐 아니라 trace, policy log, approval log, repository audit record가 같은 사건으로 연결되는지 검증한다.

## 도입 체크리스트

- [ ] agent operation을 읽기·제한 쓰기·공급망·원격·고영향으로 분류하고 owner와 rollback을 정했다.
- [ ] Copilot 앱 public preview와 CLI experimental 범위를 변경 관리에 반영했다.[1][5]
- [ ] sandbox의 requested/effective/enforced 정책과 실제 filesystem·network 경계를 기록한다.
- [ ] 정책 집행 불가 시 unsandboxed fallback 없이 fail-closed함을 재현했다.
- [ ] enterprise deny가 workspace·auto-approval·saved approval보다 우선한다.[3]
- [ ] 승인에 command·target·diff·policy hash를 묶고 입력 변경 시 폐기한다.
- [ ] PoP의 지원 범위와 2시간 sudo-mode session을 위험 모델에 반영했다.[4]
- [ ] root trace가 policy·approval·command·검증을 연결하고, 민감 원문은 기본 수집하지 않는다.[2]
- [ ] exporter 장애와 sampling이 고위험 write 증거를 누락하지 않는지 시험했다.
- [ ] MCP/LSP·package lifecycle script·symlink를 통한 경계 이탈을 시험했다.
- [ ] command 성공 뒤 파일과 원격 상태를 read-back한다.
- [ ] trace ID 하나로 정책·승인·실행·Git 기록을 복원하고 break-glass를 전수 감사할 수 있다.

## 공급자 주장과 운영 판단의 경계

이번 글이 인용한 자료는 모두 GitHub 공식 발표와 공식 문서다. 따라서 기능 제공 여부, 지원 범위, 설정 의미를 확인하는 1차 자료로는 적합하지만 효과를 독립 검증한 자료는 아니다.

GitHub는 로컬 sandbox가 unintended command의 잠재 영향을 줄이고, managed permission이 민감 operation에 fine-grained guardrail을 제공한다고 설명한다.[1][3]
또한 OTel은 예상 밖 행동 조사를 돕고, PoP는 탈취된 credential이나 agent의 무단 고영향 행동을 막는 데 도움이 된다고 설명한다.[2][4] 이 문장들은 공급자의 목적과 기대 효과다. 각 조직의 repository 구조, OS, plugin, MCP server, credential broker, IdP 정책에서 실제로 어느 정도 효과가 있는지는 실패 주입과 내부 측정으로 확인해야 한다.

특히 다음은 공식 기능 설명에서 바로 결론 낼 수 없다.

- sandbox가 모든 child process와 개발 도구의 부작용을 완전히 포착하는가
- deny/ask/allow 정책이 조직의 복합 command를 얼마나 정확히 분류하는가
- OTel export가 incident에 필요한 모든 증거를 손실 없이 보존하는가
- PoP가 agent가 수행하는 모든 write action에 적용되는가
- 승인 마찰이 개발 생산성이나 우회 사용에 어떤 영향을 주는가

이 질문은 vendor claim이 아니라 내부 검증 항목으로 남겨야 한다.

## 결론: 에이전트 운영의 단위는 답변이 아니라 통제된 실행이다

코딩 에이전트를 chat assistant로 볼 때는 좋은 답변과 나쁜 답변을 비교하면 됐다. 실행 주체로 볼 때는 기준이 바뀐다. 어떤 권한으로, 어느 경계 안에서, 어떤 정책 판단을 거쳐, 누구의 승인으로, 무엇을 실제로 바꿨는지 설명할 수 있어야 한다.

Sandbox는 영향 반경을 줄이지만 허용 범위 안의 잘못된 행동을 판정하지 않는다. Managed permissions는 행동을 판정하지만 실제 OS 격리를 대신하지 않는다. OpenTelemetry는 흐름을 보여주지만 그 자체로 차단하지 않는다. Proof of presence는 현재 권한자의 개입을 확인하지만 변경 내용의 적절성을 보장하지 않는다. 네 계층의 역할이 다른 이유다.

새 기준은 기능 네 개를 켜는 것이 아니다. **정책 결정과 sandbox 집행, 인간 승인과 identity freshness, command 실행과 결과 검증을 하나의 trace로 연결하는 것**이다. 여기에 fail-closed, 제한된 approval capability, content-minimized telemetry, 재현 가능한 실패 주입이 더해져야 한다.

조직이 “에이전트가 무엇을 할 수 있는가”만 문서화하고 “실패했을 때 무엇이 실행되지 않았으며 어떤 증거가 남는가”를 답하지 못한다면 아직 운영 준비가 끝난 것이 아니다. 반대로 거부, 승인 만료, sandbox 시작 실패, telemetry 손실, IdP 장애까지 정상 상태 기계에 넣었다면 코딩 에이전트는 개인 생산성 도구를 넘어 관리 가능한 실행 주체가 된다.

## Sources

[1] https://github.blog/changelog/2026-09-23-local-sandboxing-in-the-github-copilot-app — Local sandboxing in the GitHub Copilot app
[2] https://github.blog/changelog/2026-09-22-opentelemetry-in-the-github-copilot-app — OpenTelemetry in the GitHub Copilot app
[3] https://github.blog/changelog/2026-09-09-enterprise-managed-permissions-for-github-copilot-agent-operations — Enterprise managed permissions for GitHub Copilot agent operations
[4] https://github.blog/changelog/2026-09-24-require-proof-of-presence-for-high-impact-actions — Require proof of presence for high-impact actions
[5] https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes — About cloud and local sandboxes for GitHub Copilot
[6] https://docs.github.com/en/copilot/reference/enterprise-managed-settings-reference — Enterprise managed settings
[7] https://docs.github.com/en/copilot/concepts/agents/opentelemetry — OpenTelemetry for agent monitoring
[8] https://docs.github.com/en/enterprise-cloud@latest/admin/configuring-settings/hardening-security-for-your-enterprise/configuring-proof-of-presence — Configuring Proof of Presence
