---
title: '에이전트 로그만 믿으면 놓치는 것: Sysdig AI Defense의 harness·kernel 이중 감사'
date: 2026-11-04 09:00:02 +0900
categories: ["AI 보안"]
description: 'Sysdig AI Defense가 agent harness의 의도와 kernel의 실제 process를 연결하는 방식을 살펴보고, correlation·정책·실패 주입을 포함한 이중 감사 모델을 제안한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-sysdig-press-releases-sysdig-launches-sysdig-ai-defense-bringing-runtime-security-to-eve/1600/900'
tags: [sysdig, ai-defense, ai-agent, runtime-security, falco, ebpf, audit]
---

![두 개의 투명한 레이어에 에이전트 명령과 프로세스 트리가 겹쳐 보이는 모습](https://picsum.photos/seed/news-2026-11-04-sysdig-press-releases-sysdig-launches-sysdig-ai-defense-bringing-runtime-security-to-eve/1600/900)

에이전트 로그에 `run tests` 한 줄이 남았다고 해서 운영체제에서 process 하나만 실행된 것은 아니다. Shell wrapper, package manager, compiler, child process가 이어지고 그중 하나가 credential이나 network에 접근할 수 있다.

Sysdig는 2026년 11월 4일 Sysdig AI Defense의 generally available 전환을 발표했다. 제품은 agent harness 안에서 tool·MCP server·skill·plugin 호출과 argument를 관찰하고, kernel level에서 실제 process와 credential reach를 함께 본다고 설명한다.[1]

## intent와 effect는 서로 다른 증거다

Harness telemetry는 agent가 무엇을 하려 했는지 알려준다. Kernel telemetry는 어떤 executable이 실제로 실행되고 어떤 child process가 생겼는지 보여준다.

| 관점 | 잘 보는 것 | 놓치기 쉬운 것 |
|---|---|---|
| Harness | tool 이름, argument, agent session | wrapper 내부 child process |
| Kernel | process, file, network, credential access | 사용자의 고수준 목적 |
| Network | 외부 연결과 destination | network를 쓰지 않는 local action |

한 층만 보면 오해가 생긴다. `npm test`는 정상 tool call처럼 보이지만 lifecycle script가 별도 binary를 내려받을 수 있다. 반대로 kernel에서 `curl`이 실행된 사실만으로는 agent가 어떤 task와 승인 아래 호출했는지 알기 어렵다.

## Sysdig가 발표한 정책 경계

Sysdig AI Defense는 조직 정책에 따라 action을 허용하거나 사용자 확인을 요청하거나 실행 전에 block하고, 통과한 process를 이후 종료할 수 있다고 설명한다. Agent session과 tool call, 실제 action, 사용 credential과 책임자를 action graph로 연결하는 것이 제품의 중심 주장이다.[1]

제품은 macOS와 Windows에서 GA로 제공된다고 발표됐다.[1] 기반 runtime 기술에 Falco가 쓰인다고 해서 Sysdig AI Defense 전체가 오픈소스라는 뜻은 아니다. 상용 제품의 지원 범위, sensor 배포 방식, 수집 데이터는 계약과 실제 환경에서 따로 확인해야 한다.

## “로그 한 건당 일곱 process”의 해석

Sysdig는 early insight에서 agent log의 action 하나당 kernel이 약 7개 process를 관찰했다고 보고했다.[1] 이는 특정 관찰 집합의 공급자 수치다. 모든 agent, OS, toolchain에 적용되는 상수로 사용하면 안 된다.

중요한 결론은 7이라는 숫자가 아니라 **cardinality가 1:1이 아니라는 사실**이다. 감사 schema가 `agent_action_id → process_id` 하나만 허용하면 실제 process tree를 잃는다.

```text
agent_session_id
  └─ agent_action_id
      ├─ process A
      │   ├─ process B
      │   └─ process C
      └─ network/file/credential events
```

Process가 daemon에 작업을 넘기거나 container runtime을 호출하는 경우 parent PID만으로 연결이 끊길 수 있다. Session correlation ID와 시간, user identity, cgroup/container, executable digest를 함께 사용해야 한다.

## 최소 fixture로 이중 감사를 시험한다

아래는 **실행 결과가 아니라 제안된 fixture**다. Production credential이나 실제 공격 payload를 사용하지 않는다.

```text
Agent action: project의 harmless test script 실행
shell wrapper → package manager → test runner → child helper
```

세 가지 변형을 주입한다.

1. 정상 child process만 생성한다.
2. Helper가 fixture용 fake credential file 읽기를 시도한다.
3. Agent log에는 test만 남기지만 wrapper가 allowlist 밖 binary를 실행한다.

기대하는 관찰은 다음과 같다.

- Harness log가 tool과 argument를 기록한다.
- Kernel log가 전체 process lineage를 기록한다.
- Fake credential 접근이 실제 secret과 구분된 test event로 탐지된다.
- 정책이 alert mode와 enforce mode에서 다르게 작동한다.
- Block 뒤 child process가 남지 않는다.

처음부터 production에서 kill mode를 켜지 않는다. Sysdig 발표도 정책을 alert mode로 시작해 준비되면 enforcement로 옮기는 흐름을 설명한다.[1]

## 정책은 executable 이름보다 context를 봐야 한다

`python`, `bash`, `curl` 같은 도구를 전부 막으면 agent가 아무 일도 할 수 없다. 반대로 이름만 허용하면 argument와 destination을 통한 우회를 놓친다.

정책 입력에는 최소한 다음 context가 필요하다.

- 어떤 사람과 agent session이 시작했는가
- 어떤 repository와 workspace에서 실행되는가
- executable digest와 parent lineage는 무엇인가
- 접근한 credential이 test인지 production인지
- destination과 cloud account는 어디인가
- 해당 action에 사용자 승인이 있었는가

같은 `read file`도 공개 fixture를 읽는 것과 production admin key를 읽는 것은 위험이 다르다. Sysdig 역시 action이 그 시점에 도달할 수 있는 권한을 함께 판단해야 한다고 강조한다.[1]

## tamper-resistant 기록의 경계

Sysdig는 kernel 기록을 compromised agent가 변조할 수 없는 audit evidence로 설명한다.[1] 그러나 sensor가 설치된 host 자체가 완전히 장악됐거나 telemetry export가 끊긴 경우까지 자동 해결되는 것은 아니다.

운영팀은 다음 상태를 구분해야 한다.

```text
observed_and_allowed
observed_and_blocked
observed_and_killed
telemetry_delayed
sensor_unhealthy
harness_only
kernel_only
correlation_failed
```

Event가 없다는 것을 action이 없었다고 해석하려면 sensor health와 coverage가 먼저 증명돼야 한다. Telemetry gap을 `clean`으로 표시하지 않는다.

## 비용과 privacy도 감사 대상이다

모든 model call을 agent·team·person에 귀속하면 비용 분석에는 유용하지만 prompt, path, credential metadata가 보안 platform으로 이동할 수 있다. 수집 field, retention, masking, region, access control을 정해야 한다.

특히 argument 전체를 저장하는 방식은 command line에 잘못 들어간 secret을 다시 중앙 저장소에 복제할 수 있다. Raw value 대신 classification과 hash를 남길 수 있는지, incident 조사 때만 제한적으로 원문을 열 수 있는지 검토해야 한다.

## 두 로그가 다를 때가 가장 중요하다

Harness와 kernel 기록이 항상 같다면 이중 관찰의 가치가 작다. 보안 신호는 둘이 어긋날 때 나온다.

- Agent는 읽기라고 했지만 child process가 파일을 수정했다.
- Tool target은 staging이었지만 credential은 production 권한이었다.
- MCP server 한 번 호출 뒤 예상하지 않은 binary가 실행됐다.
- Harness log는 종료됐지만 process가 background에 남았다.

Sysdig AI Defense의 핵심 주장은 agent가 쓴 자기 설명만으로는 감사가 끝나지 않는다는 것이다. GA는 상용 제공 상태를 뜻할 뿐 모든 환경에서 완전한 coverage를 보장하지 않는다. 실제 도입은 harmless fixture로 process tree와 correlation을 확인하고, telemetry gap을 드러내며, alert에서 enforcement로 단계적으로 이동해야 한다.

## Sources

[1] https://www.sysdig.com/press-releases/sysdig-launches-sysdig-ai-defense-bringing-runtime-security-to-every-action-ai-agents-take
