---
title: 'VPN이 GUI 전용이면 자동화할 수 없는 것들 — AWS Client VPN CLI'
date: 2026-08-16 11:30:00
categories: ["개발/인프라"]
description: 'AWS VPN Client 6.0의 CLI와 중앙 관리 기능을 바탕으로 원격 개발·CI·에이전트 환경의 VPN 자동화, 자격증명과 실패 복구 설계를 살펴본다.'
featured_image: 'https://picsum.photos/seed/aws-client-vpn-cli-automation/1600/900'
tags: [aws, client-vpn, cli, zero-trust, devops, automation, remote-development]
---

![AWS Client VPN CLI 자동화](https://picsum.photos/seed/aws-client-vpn-cli-automation/1600/900)

기업 환경에서 VPN은 오랫동안 사람이 화면에서 연결하는 도구였다. VPN client를 열고 profile을 선택하고 인증한 뒤 연결 버튼을 누른다. 노트북 사용에는 충분하지만 CI runner, 원격 개발환경, 자동화된 진단 작업, AI 에이전트가 내부 자원에 접근해야 하면 GUI는 막다른 길이 된다.

AWS는 VPN Client 6.0에서 GUI와 동등한 CLI, background operation, 중앙 관리 기능과 OpenVPN3 기반 client를 발표했다. 기존 AWS Client VPN endpoint를 변경하지 않고 사용할 수 있으며 Windows, macOS, Linux를 지원한다.

VPN CLI는 단순한 편의 기능이 아니다. 네트워크 연결을 명령과 상태로 표현해 자동화할 수 있게 만드는 인터페이스다. 동시에 credential을 script에 남기거나 연결 범위를 과도하게 열 위험도 커진다.

## GUI 전용 VPN의 운영 한계

GUI 중심 VPN은 사용자의 명시적 행동을 요구한다. 이는 권한 있는 사람이 직접 연결한다는 점에서 안전 장치처럼 보일 수 있다. 하지만 다음 환경에서는 비효율적이다.

- ephemeral CI runner가 내부 package registry에 접근한다.
- 원격 개발 컨테이너가 사내 database를 조회한다.
- 장애 진단 job이 private monitoring endpoint를 확인한다.
- 백업·migration 작업이 제한된 시간에 내부망에 접속한다.
- 코딩 에이전트가 허용된 repository와 test service를 사용한다.

기존에는 third-party OpenVPN 도구를 조합하거나 사람이 먼저 연결 상태를 만들어야 했다. 도구마다 profile과 인증 방식이 달라 운영 표준을 만들기 어려웠다.

CLI가 있으면 연결, 해제, profile import, 상태 조회를 동일한 명령 흐름으로 관리할 수 있다. 성공 여부를 exit code와 구조화 가능한 output으로 판단할 수 있다는 점도 자동화에 중요하다.

## AWS VPN Client 6.0에서 달라진 것

AWS 발표에 따르면 새 client는 다음 기능을 제공한다.

- GUI 기능과 동등한 CLI
- background CLI operation
- GUI와 CLI의 동시 사용
- client process와 독립적으로 유지되는 연결
- 사용자별 profile과 장비 전체 global profile 관리
- 승인된 VPN 설정에 대한 중앙 관리 통제
- OpenVPN3 기반 연결 개선
- 기존 AWS Client VPN endpoint와의 backward compatibility
- Windows x64/ARM, macOS x64/ARM, Linux x64 지원

공식 문서에는 `connect`, `disconnect`, `import-profile`, `delete-profile`, `list-profiles`, `get-connection-status`, `list-connections`, `put-preference`, `send-diagnostic-logs` 같은 명령이 정리돼 있다.

구체적인 명령 옵션은 client 버전과 운영체제별 공식 문서를 확인해야 한다. 중요한 변화는 VPN이 클릭 기반 application에서 automation 가능한 state machine으로 바뀐다는 점이다.

## 자동화하려면 연결보다 상태를 먼저 설계해야 한다

단순 script는 다음처럼 보일 수 있다.

```text
profile import
VPN connect
내부 작업 실행
VPN disconnect
```

하지만 실제 운영에는 더 많은 상태가 있다.

```text
DISCONNECTED
CONNECTING
AUTHENTICATING
CONNECTED
DEGRADED
RECONNECTING
DISCONNECTING
FAILED
```

자동화는 각 상태에서 무엇을 할지 정의해야 한다.

- 이미 연결돼 있으면 새 연결을 만들지 않는다.
- 연결 중이면 제한 시간 동안 기다린다.
- 인증 실패는 무한 재시도하지 않는다.
- 내부 DNS와 route가 준비된 뒤 작업을 시작한다.
- 작업 실패와 VPN 실패를 구분한다.
- 종료 시 자신이 만든 연결만 해제한다.
- process가 죽어도 stale connection을 탐지한다.

"connect 명령 exit code가 0"만으로 내부 서비스 접근 가능 상태라고 판단하면 race condition이 생길 수 있다. 상태 조회와 실제 target health check를 함께 사용해야 한다.

## CI runner에 VPN을 붙이는 것은 신중해야 한다

CI에서 private resource에 접근할 수 있으면 테스트와 배포 자동화가 쉬워진다. 하지만 compromised dependency나 악성 PR도 같은 network path를 사용할 수 있다.

특히 public repository의 pull request가 실행되는 runner에 production VPN 권한을 제공하면 안 된다. 안전한 구조는 다음 원칙을 따른다.

- untrusted PR job과 내부망 접근 job을 분리한다.
- VPN credential은 protected branch와 승인된 workflow에서만 제공한다.
- production이 아니라 필요한 service와 port만 route한다.
- job 단위의 짧은 credential을 사용한다.
- 연결 전후로 identity와 destination을 기록한다.
- artifact와 log에 profile·token이 남지 않게 한다.
- job이 끝나면 연결과 credential을 폐기한다.

가능하다면 CI runner를 private network 안에 두거나 workload identity를 사용하는 방법이 더 단순할 수 있다. VPN client 설치는 기존 runner를 연결하는 현실적인 수단이지만 항상 최선은 아니다.

## 원격 개발환경에서는 편리함과 분리가 충돌한다

개발자는 devcontainer나 cloud workstation에서 사내 API와 database에 접근하고 싶어 한다. CLI VPN은 workspace 시작 시 자동 연결을 구성할 수 있어 편리하다.

그러나 workspace image나 bootstrap script에 profile과 credential을 포함하면 위험하다. base image가 공유되거나 snapshot이 남으면 인증정보가 복제될 수 있다.

다음 구조가 더 안전하다.

1. image에는 client binary만 포함한다.
2. profile은 시작 시 승인된 관리 경로에서 가져온다.
3. 사용자 또는 workload identity로 짧은 인증을 받는다.
4. 필요한 subnet과 DNS만 제공한다.
5. workspace 종료 시 credential과 local state를 삭제한다.
6. connection event를 중앙 log에 남긴다.

개발 편의를 위해 full tunnel과 광범위한 내부망을 열어주면 lateral movement 위험이 커진다. 네트워크 접근도 project와 task 범위로 줄여야 한다.

## AI 에이전트에 VPN을 주기 전에 물어야 할 것

코딩 에이전트가 private repository, CI, staging API를 사용하려면 내부망 연결이 필요할 수 있다. 이때 VPN CLI는 에이전트가 스스로 연결을 만들 수 있게 한다.

하지만 에이전트에게 사람과 같은 VPN profile을 주는 것은 과도하다. 에이전트는 자연어 지시에 따라 도구를 선택하고, prompt injection이나 잘못된 계획으로 예상 밖 destination에 접근할 수 있다.

최소한 다음 경계를 둬야 한다.

- 에이전트가 profile을 생성·수정하지 못하게 한다.
- 허용된 connection command만 wrapper로 제공한다.
- task별 destination allowlist를 적용한다.
- production route는 기본 차단한다.
- credential은 agent session보다 짧게 유지한다.
- 연결과 tool call을 같은 trace ID로 묶는다.
- 네트워크 접근이 필요 없는 단계에서는 연결을 끊는다.
- 데이터 반출을 막기 위해 egress도 통제한다.

VPN은 내부로 들어가는 경로만 제공하는 것이 아니다. 연결된 환경에서 외부로 데이터를 보낼 수 있다면 내부정보 유출 경로가 될 수 있다. ingress와 egress를 함께 봐야 한다.

## 중앙 관리 profile의 의미

새 client의 관리 기능은 profile을 특정 사용자에게 scope하거나 장비 전체에 global profile로 제공하고, 승인된 설정을 중앙에서 적용하는 방향이다.

이는 사용자가 임의 profile을 수정하거나 비승인 endpoint를 추가하는 위험을 줄일 수 있다. 하지만 중앙 profile 자체가 너무 넓은 route와 오래된 인증 방식을 사용하면 통제는 일관되게 잘못 적용된다.

관리자는 다음 항목을 versioned policy로 다루는 편이 좋다.

- endpoint와 인증 방식
- split tunnel 여부
- 허용 route와 DNS
- profile owner와 대상 사용자
- 만료일과 rotation 주기
- client 최소 버전
- diagnostic log 범위
- 예외와 break-glass 절차

global profile은 shared workstation에서 특히 주의해야 한다. profile이 모든 사용자에게 보이는 것과 credential이 공유되는 것은 분리해야 한다.

## 실패 복구와 관측성

VPN 자동화는 성공 경로보다 실패 경로를 먼저 설계해야 한다.

### 인증 실패

잘못된 credential, 만료된 certificate, MFA 실패는 재시도로 해결되지 않는다. 반복 시 account lock이나 보안 경보를 유발할 수 있으므로 즉시 중단하고 명확한 오류를 남겨야 한다.

### route와 DNS 실패

연결 상태가 Connected여도 필요한 private DNS가 해석되지 않거나 route가 누락될 수 있다. target hostname resolve, route 확인, application health check를 별도로 수행한다.

### 연결 누수

job 종료 후 VPN이 남으면 다음 작업이 의도치 않게 내부망을 사용한다. `finally` 또는 trap에서 정리하되 다른 작업이 공유하는 연결을 끊지 않도록 ownership을 추적해야 한다.

### client와 endpoint 차이

AWS는 기존 endpoint와 backward compatibility를 설명하지만 client version별 동작 차이는 있을 수 있다. rollout은 소수 장비에서 시작하고 rollback 가능한 package 배포를 사용한다.

감사 로그에는 연결 주체, 장비, profile, 시작·종료 시간, 할당된 address, 대상 route, 종료 이유를 남긴다. diagnostic log에는 민감정보가 들어갈 수 있으므로 보관과 접근 권한을 제한해야 한다.

## 도입 체크리스트

- CLI를 실행할 주체는 사람, CI workload, agent 중 누구인가
- GUI와 CLI가 같은 profile을 동시에 사용할 때 충돌하지 않는가
- profile과 credential 저장 위치는 분리돼 있는가
- 연결 전후 상태를 조회할 수 있는가
- timeout과 최대 재시도 횟수가 있는가
- 필요한 subnet과 port만 허용하는가
- untrusted code가 VPN 연결 상태에서 실행되지 않는가
- 종료 후 connection과 credential을 폐기하는가
- 중앙 관리 정책에 owner와 만료일이 있는가
- 장애 시 수동 복구와 break-glass 경로가 있는가

이 질문에 답하지 못한다면 CLI 도입은 자동화가 아니라 수동 위험의 고속화가 될 수 있다.

## 결론

AWS VPN Client 6.0의 의미는 버튼을 명령으로 바꾼 데 그치지 않는다. VPN 연결을 CI, 원격 개발환경, 운영 자동화에서 상태와 정책으로 다룰 수 있게 한다. GUI와 동등한 CLI, background operation, 중앙 profile 통제는 표준화된 workflow를 만들기 좋은 기반이다.

동시에 자동 연결은 사람의 확인 단계를 제거한다. credential을 script에 남기거나 untrusted job에 내부망을 열고, 작업 종료 후 연결을 방치할 가능성도 커진다.

좋은 VPN 자동화는 `connect` 명령이 성공하는 시스템이 아니다. 누가 어떤 업무를 위해 어느 경로에 얼마나 오래 연결됐는지 설명할 수 있고, 실패하면 반복하지 않고 멈추며, 작업이 끝나면 접근 권한까지 함께 사라지는 시스템이다.

## 참고 자료

- [AWS: Client VPN now supports CLI, administration controls, and faster connections](https://aws.amazon.com/about-aws/whats-new/2026/08/aws-client-vpn-cli/)
- [AWS Client VPN User Guide: CLI commands](https://docs.aws.amazon.com/vpn/latest/clientvpn-user/connect-aws-client-vpn-connect.html#cli-commands)
