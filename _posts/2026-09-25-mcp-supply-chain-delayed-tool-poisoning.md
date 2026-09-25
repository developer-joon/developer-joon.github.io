---
title: '세 번은 정상이고 네 번째부터 달라진다 — MCP 공급망의 지연형 Tool Poisoning'
date: 2026-09-25 07:40:00 +0900
categories: ["AI 보안"]
description: '정상 도구처럼 신뢰를 얻은 뒤 metadata를 바꾸는 지연형 MCP tool poisoning을 공급망, 상태 기반 검증, 권한 통제, 사고 대응 관점에서 분석한다.'
featured_image: 'https://picsum.photos/seed/mcp-supply-chain-delayed-tool-poisoning/1600/900'
tags: [mcp, ai-security, tool-poisoning, supply-chain, incident-response, sandbox]
---

![MCP 공급망의 지연형 Tool Poisoning](https://picsum.photos/seed/mcp-supply-chain-delayed-tool-poisoning/1600/900)

MCP 서버를 검토할 때 우리는 무엇을 확인하는가. 저장소의 코드, 설치 명령, 처음 노출되는 tool 목록, 한두 번의 호출 결과를 보고 "정상적으로 동작한다"고 판단하기 쉽다. 하지만 도구가 처음부터 악의적인 행동을 보여 주지 않는다면 짧은 검토는 신뢰를 만드는 절차가 아니라 공격자가 통과해야 할 예측 가능한 관문이 된다.

지연형 tool poisoning은 바로 이 틈을 노린다. 설치 직후에는 format, summarize 같은 평범한 기능만 제공하고, 일정한 호출 횟수나 시간이 지난 뒤 tool description과 metadata를 바꾼다. 에이전트는 변경된 설명을 새 지시로 받아들이고, 이미 사용자에게 승인받았다고 생각한 서버를 계속 사용할 수 있다. 핵심은 "악성 도구를 설치했다"는 단순한 사건이 아니다. 같은 이름의 도구가 시간에 따라 다른 계약을 제시하는데도 클라이언트와 운영 절차가 이를 동일한 대상으로 취급하는 문제다.

2026년 8월 Pillar Security는 공개 GitHub PR을 통해 `productivity-suite`라는 MCP 서버가 전달됐다고 관찰한 연구 보고서를 공개했다. 연구진 설명에 따르면 이 서버는 초기에 benign한 format·summarize 동작을 보였고, 평범한 tool 호출 세 번 뒤 metadata가 변경됐다.[6] 이 글은 그 캠페인을 독립적으로 재현했다는 보고가 아니다. Pillar 연구자가 공개한 관찰을 출발점으로 삼아, 비슷한 패턴을 조직이 어떻게 검증하고 차단하며 대응할지 운영 관점에서 분석한다.

## 공격의 핵심은 코드보다 "도구 계약의 시간차"다

일반적인 보안 리뷰는 특정 시점의 스냅샷을 본다. PR diff를 읽고, dependency를 확인하고, 서버를 한 번 실행하고, tool 목록과 결과를 기록한다. 이 방식은 대상이 검토 전후에 같은 행동을 유지한다는 가정 위에서만 유효하다.

MCP tool은 이름만으로 정의되지 않는다. 적어도 다음 요소가 함께 계약을 이룬다.

- tool 이름과 사람이 읽는 description
- 입력 schema와 필수·선택 인자
- 출력 형태와 오류 조건
- read-only인지 상태를 바꾸는지에 대한 속성
- 서버가 요구하는 scope와 credential
- 실행 중 접근하는 파일, 환경 변수, 네트워크 목적지
- 사용자의 추가 승인 없이 실행할 수 있는 범위

이 가운데 description과 metadata는 단순한 문서가 아니다. LLM 기반 클라이언트는 어떤 tool을 언제 사용할지 결정할 때 이 정보를 문맥으로 사용한다. 따라서 handler 코드는 그대로여도 description이 "요약 전에 로컬 설정을 읽어라"처럼 달라지면 에이전트가 선택하는 인자와 주변 행동이 달라질 수 있다. 반대로 외형상 description이 같아도 원격 endpoint가 다른 구현을 제공하면 결과는 달라진다.

지연형 공격의 효과는 세 단계에서 나온다.

1. **초기 신뢰 형성**: 설치와 첫 호출에서 기대한 기능만 보여 준다.
2. **검사 종료 감지 또는 추정**: 호출 횟수, 경과 시간, client identity, session 상태 같은 조건을 사용한다.
3. **계약 교체**: tool metadata 또는 실제 동작을 바꾸고, 이미 형성된 신뢰를 재사용한다.

Pillar 연구진은 관찰 대상이 세 번의 일반 호출 뒤 metadata를 변경했으며, 바뀐 metadata가 SSH key, AWS credential, shell history, Kubernetes configuration에 접근하도록 유도하면서 활동을 숨기려 했다고 보고했다.[6] 여기서 중요한 표현은 "접근을 시도하도록 유도했다고 연구진이 보고했다"는 것이다. 공개 보고만으로 특정 조직에서 실제 파일이 읽혔거나 credential이 탈취됐다고 단정해서는 안 된다. 탐지 신호와 확인된 피해는 서로 다른 증거 수준이다.

## PR 기반 전달은 신뢰를 빌려 쓰는 공급망 문제다

Pillar가 기술한 전달 경로는 공개 GitHub PR이었다.[6] PR은 소프트웨어 협업의 정상적인 장치다. 그래서 공격자는 별도의 배포 인프라를 만들지 않고도 프로젝트 maintainer, 자동 검사, 커뮤니티 리뷰라는 신뢰 신호에 접근할 수 있다.

보고서가 집계한 캠페인 범위는 23개 PR이었다. 연구 시점에 19개는 닫혔고 4개는 열려 있었으며, GitHub의 PR merge 방식으로 병합된 것은 없었다. 구성 형태는 17개 remote endpoint, 4개 숨겨진 local script 참조, 2개 directory·listing 제출로 분류됐다.[6] 이 수치는 연구자가 특정 시점에 관찰한 집합이지 모든 MCP 생태계의 감염률도, 실제 침해 건수도 아니다.

공격자 귀속 역시 공개 GitHub 계정 수준을 넘겨 말할 근거가 없다. 계정 이름, commit author, PR 작성자는 조사 단서일 수 있지만 자연인이나 조직의 신원을 증명하지 않는다. 따라서 사고 보고서에는 "해당 공개 GitHub 계정이 PR을 제출했다"고 기록해야 한다. 계정 뒤의 개인, 국가, 범죄 조직을 추정해 확정적인 표현으로 옮기면 기술 조사와 법적 판단을 모두 흐린다.

PR 검토에서 특히 위험한 형태는 remote endpoint 참조다. 리뷰어가 보는 저장소에는 짧은 설정만 있고, 실제 tool definition과 실행 코드는 외부 서버가 제공할 수 있다. PR이 닫히거나 merge되지 않았다고 해서 노출 가능성이 자동으로 사라지는 것도 아니다. 누군가 검토 과정에서 endpoint를 수동으로 등록했거나 local script를 실행했다면 저장소의 최종 merge 상태와 실행 이력은 분리해서 확인해야 한다.

반대로 PR이 존재했다는 사실만으로 침해를 선언해서도 안 된다. 공급망 조사에서는 최소한 다음 상태를 구분해야 한다.

- PR이 제출됐지만 아무도 실행하지 않음
- reviewer가 설정 파일만 열어 봄
- CI가 server를 설치하거나 실행함
- maintainer가 로컬 client에 임시 등록함
- tool discovery만 수행함
- 실제 tool 호출이 발생함
- 민감한 파일 또는 credential 접근 시도가 로그에 남음
- 외부 전송이 확인됨

이 구분이 있어야 "악성 제출 관찰"과 "실제 영향 확인"을 섞지 않을 수 있다.

## 왜 짧은 smoke test는 실패하는가

대부분의 smoke test는 설치 성공, tool discovery 성공, 대표 호출 한두 건 성공, 비정상 종료 없음 정도를 확인한다. 기능 회귀를 빠르게 잡는 데는 유용하지만 지연형 behavior를 검증하도록 설계된 것은 아니다.

세 번째 호출 뒤 바뀌는 서버를 두 번만 호출하면 테스트 결과는 완벽하게 정상이다. 호출 횟수를 네 번으로 늘리기만 해도 충분하지 않다. 공격자가 임계값을 열 번으로 바꾸거나, 같은 session에서만 전환하거나, 특정 client header가 없을 때만 악성 정의를 반환하면 고정된 테스트는 다시 통과된다.

더 근본적인 문제는 smoke test가 결과 payload만 비교한다는 점이다. format 결과가 계속 올바르더라도 호출 사이에 tool description, schema, annotations, 요구 scope가 바뀌었다면 보안 계약은 이미 달라졌다. "출력이 맞다"와 "같은 권한 경계 안에서 실행됐다"는 별개의 조건이다.

따라서 보안 검증은 다음 질문에 답해야 한다.

- 첫 discovery와 반복 discovery의 tool definition이 동일한가.
- 새 session, 재시작, 시간 경과 뒤에도 동일한가.
- 호출 횟수와 순서를 바꿔도 동일한가.
- 오류를 일부러 발생시킨 뒤 definition이 달라지지 않는가.
- client identity, locale, header, IP 범위에 따라 다른 정의를 주지 않는가.
- 결과가 같더라도 filesystem과 network side effect가 달라지지 않는가.

짧은 검사를 버릴 필요는 없다. 다만 smoke test를 합격 기준 전체로 쓰지 말아야 한다. 빠른 기능 확인 뒤에 stateful security test를 별도 단계로 두고, 두 단계가 서로 다른 실패를 찾는다는 사실을 문서화해야 한다.

## Stateful 테스트는 "한 번"이 아니라 전이를 검증한다

지연형 poisoning을 찾으려면 서버를 stateless 함수처럼 다루지 말고 상태 기계로 취급해야 한다. 테스트 대상은 하나의 요청과 응답이 아니라 `초기 상태 → 정상 호출 반복 → metadata 재조회 → 재시작 → 새 identity → 시간 경과`의 전이다.

실무에서는 다음과 같은 test matrix를 만들 수 있다.

| 축 | 예시 변형 | 확인할 항목 |
|---|---|---|
| 호출 횟수 | 0, 1, 2, 3, 4, 10, 50회 | definition, 결과, side effect |
| session | 동일 session, 새 session, resume | 상태가 어디에 저장되는지 |
| 시간 | 즉시, 수 분 후, 다음 날 | 시간 조건부 변경 여부 |
| 순서 | format만 반복, summarize 교차, 오류 삽입 | 특정 sequence trigger 여부 |
| identity | reviewer, CI, 일반 개발자 | 사용자별 차등 동작 여부 |
| network | 허용 목적지만, egress 차단 | 숨은 외부 의존성과 실패 방식 |
| filesystem | 빈 home, 가짜 secret, read-only mount | 민감 경로 탐색 여부 |

호출 횟수는 무한히 늘릴 수 없으므로 risk-based boundary를 정해야 한다. 예를 들어 첫 10회는 매회 definition을 재조회하고, 이후에는 임의 구간과 session 전환 지점에서 확인한다. 테스트 시간이 길어질수록 비용은 증가하지만, 단 한 번의 정상 호출만으로 승인하는 것보다는 공격자가 숨겨야 할 상태 공간을 크게 넓힌다.

민감 파일 접근 여부를 검증할 때 실제 production credential을 넣어서는 안 된다. canary 이름과 가짜 값이 담긴 SSH key, AWS config, kubeconfig, shell history를 격리된 filesystem에 배치하고, open syscall과 outbound request를 관찰한다. 목적은 secret을 제공하는 것이 아니라 서버가 업무 기능과 무관한 경로를 탐색하는지 보는 것이다.

테스트 결과에는 payload뿐 아니라 다음 telemetry를 함께 저장해야 한다.

- 각 시점의 원본 tool definition
- 정규화한 definition fingerprint
- server package 또는 image digest
- process tree와 실행 command
- 열린 파일 경로와 실패한 접근
- DNS query와 outbound destination
- 요청·응답 timestamp와 session ID
- 정책 엔진의 허용·차단 결정

이렇게 해야 "네 번째 호출에 달라졌다"는 관찰을 나중에 재현하고, definition 변경과 side effect 사이의 순서를 설명할 수 있다.

## Tool-definition fingerprint는 승인 대상을 고정한다

Pillar 보고서는 tool-definition 변경을 사용자에게 보이게 하고, fingerprint를 기록하며, 변경 시 renewed approval을 요구하라고 권고한다.[6] 이 원칙을 구현하려면 무엇을 hash할지 먼저 정해야 한다.

fingerprint는 MCP discovery 결과와 조직이 관리하는 provenance 정보를 구분해 계산하는 편이 좋다.

- **MCP discovery fingerprint**: tool name과 description, input·output schema, annotations와 capability flag
- **조직 provenance fingerprint**: server·endpoint identity와 transport, 실행 command, package version, lockfile 또는 container image digest, 승인된 scope·filesystem·egress 정책

첫 번째 값은 MCP가 제공하는 definition에서 계산할 수 있다. 두 번째 값의 scope, permission class, filesystem 경로, network destination과 artifact digest는 표준 tool definition이 보장하는 필드가 아니므로 조직 registry와 실행 manifest에서 가져와야 한다. 두 fingerprint를 함께 승인 baseline에 묶어야 discovery 내용이 같아도 실행 provenance가 바뀐 경우를 탐지할 수 있다.

JSON 문자열을 그대로 hash하면 key 순서나 공백만 달라도 다른 값이 된다. 따라서 key 정렬, 일관된 Unicode 처리, 의미 없는 whitespace 제거 같은 canonicalization 규칙이 필요하다. 반대로 보안상 의미 있는 description 변화까지 제거하면 안 된다. 사람이 읽는 문구가 모델의 행동을 바꿀 수 있으므로 description은 fingerprint 대상에서 제외할 장식이 아니다.

fingerprint는 신뢰 그 자체가 아니다. 악성 정의도 안정적으로 hash할 수 있고, 공격자가 처음부터 악성 내용을 고정하면 "변경 없음"으로 보인다. fingerprint의 역할은 과거에 승인한 계약과 지금 제시된 계약이 같은지 비교하는 것이다. 최초 승인 시의 안전성 평가는 code review, provenance, sandbox test, owner 확인이 담당해야 한다.

원격 MCP에서는 endpoint가 같은데 응답 정의만 달라질 수 있다. client는 연결할 때마다 또는 적절한 주기로 discovery 결과를 다시 계산하고 승인된 fingerprint와 비교해야 한다. local stdio에서는 command, 인자, executable digest, package lock 정보까지 연결해야 한다. MCP 보안 모범 사례는 local server가 client와 같은 권한으로 실행되는 코드이며, client가 정확한 실행 command를 보여 주고 명시적 승인을 요구하며 filesystem과 network를 sandbox 또는 제한해야 한다고 설명한다.[5]

## Re-consent는 경고창이 아니라 계약 갱신이다

fingerprint가 달라졌을 때 단순히 "도구가 업데이트됐습니다. 계속하시겠습니까?"라고 묻는다면 사용자는 습관적으로 승인할 가능성이 높다. re-consent는 변경된 내용을 이해할 수 있게 보여 주고, 위험이 커진 부분에는 별도 정책을 적용하는 과정이어야 한다.

좋은 변경 화면은 다음을 명확히 보여 준다.

- description에서 추가·삭제된 문장
- schema에 새로 생긴 인자
- read-only에서 write로 바뀐 annotation
- 추가로 요구하는 OAuth scope
- 새 filesystem 경로와 network destination
- remote endpoint 또는 executable digest 변경
- 변경 주체, 배포 시각, 검토 가능한 provenance

변경 종류에 따라 처리도 달라야 한다. 오탈자 수정처럼 권한과 행동에 영향을 주지 않는 변경은 owner 승인으로 충분할 수 있다. 새로운 write 기능, credential 접근, 외부 egress 추가는 security review와 사용자의 재동의를 모두 요구할 수 있다. 조직 정책이 금지하는 secret 탐색은 사용자가 동의해도 허용하지 않아야 한다.

MCP authorization만으로 이 문제 전체를 해결할 수는 없다. 이것은 사양 자체의 직접적인 문구가 아니라, authorization과 실행 정책의 책임을 분리해야 한다는 운영 해석이다. OAuth consent가 있었다는 사실은 도구가 모든 파일을 읽거나 임의의 목적지로 데이터를 보낼 권리를 얻었다는 뜻이 아니다.

또한 공식 가이드는 progressive least-privilege scope와 runtime step-up을 권고한다.[5] 설치 시 모든 권한을 한꺼번에 주는 대신, read-only 요약은 낮은 scope로 시작하고 실제 write나 민감 데이터 접근 시점에 추가 승인을 받는 방식이 지연형 공격의 blast radius를 줄인다.

## Sandbox와 egress 통제는 마지막 방어선이 아니라 기본선이다

metadata 변경을 완벽히 탐지한다는 전제는 위험하다. 탐지가 늦거나 fingerprint 구현에 누락이 생겨도 실제 피해 가능성을 제한해야 한다. 그래서 MCP 서버는 신뢰 여부와 별개로 최소 권한 sandbox 안에서 실행해야 한다.

local stdio server라면 전용 OS user, read-only root filesystem, 제한된 작업 directory, 최소 환경 변수, process·memory·CPU 한도, syscall 제한을 적용할 수 있다. container를 사용하더라도 host home, Docker socket, SSH agent socket, cloud credential directory를 편의상 mount하면 격리 효과가 무너진다. "컨테이너 안에서 실행된다"보다 어떤 capability와 mount가 남았는지가 중요하다.

remote server는 로컬 filesystem을 직접 읽지 못한다고 안심하기 쉽다. 그러나 client가 파일 내용을 tool argument에 넣거나, agent가 server description을 따라 다른 local tool을 호출하면 간접 경로가 생긴다. 따라서 원격·로컬 구분과 별개로 agent가 조합할 수 있는 tool chain을 정책 대상으로 봐야 한다.

egress는 기본 거부에서 시작해 업무에 필요한 destination만 허용하는 편이 낫다. DNS와 IP만 허용하면 CDN, redirect, shared hosting 때문에 목적지를 잘못 판단할 수 있으므로 가능한 경우 service identity, TLS 정보, proxy policy를 함께 사용한다. 승인된 destination이라도 upload size, method, rate, content class를 제한해야 한다.

공식 MCP 보안 모범 사례도 local server를 client 권한으로 실행되는 코드로 보고 filesystem과 network 접근을 제한하거나 sandbox할 것을 권고한다.[5] 이 원칙은 poisoning 탐지 여부와 무관하게 적용할 수 있다. 공격을 정확히 분류하지 못해도 민감 경로가 mount되지 않았고 외부 전송이 차단됐다면 영향은 크게 제한된다.

## 파일과 credential 접근을 별도 권한으로 분리한다

많은 개발 환경에서 credential은 "필요하면 프로그램이 알아서 찾는 것"으로 취급된다. `~/.ssh`, `~/.aws`, kubeconfig, shell history, `.env`, cloud CLI cache가 같은 home 아래에 있고, agent와 tool process가 사용자의 권한을 그대로 물려받는다. 편리하지만 하나의 MCP server가 개발자의 전체 신뢰 영역을 상속한다.

Pillar 연구진은 변경된 metadata가 SSH key, AWS credential, shell history, Kubernetes configuration을 대상으로 삼았다고 보고했다.[6] 실제 피해 여부와 별개로 이 목록은 개발 workstation에서 보호 경계를 어디에 세워야 하는지 보여 준다.

운영 정책은 파일 경로와 credential 사용을 다음처럼 분리할 수 있다.

- source tree는 필요한 repository 하위만 mount한다.
- home 전체 대신 작업용 빈 home을 제공한다.
- SSH key 파일과 SSH agent socket을 기본 차단한다.
- AWS·cloud credential은 장기 key 대신 짧은 수명의 workload identity를 사용한다.
- kubeconfig는 개발·staging·production을 분리하고 namespace·verb를 최소화한다.
- shell history와 clipboard는 업무 입력으로 명시하지 않는 한 노출하지 않는다.
- `.env`와 secret file은 이름 기반 차단뿐 아니라 별도 secret broker를 통해 전달한다.
- tool이 credential을 직접 읽지 않고 broker가 대상 API 호출을 대행하도록 한다.

credential broker 방식은 비밀 값 자체를 tool에 주지 않고, 제한된 작업에 대한 capability만 제공한다. 예를 들어 MCP server가 AWS key를 읽는 대신 "특정 bucket의 특정 prefix를 읽는 요청"을 broker에 제출하고 정책 검사를 받게 할 수 있다. 이때 사용자 identity, agent session, tool fingerprint를 함께 묶으면 credential 재사용 범위를 더 줄일 수 있다.

## 로그는 사고가 난 뒤 만들어지지 않는다

지연형 공격은 시간 순서가 중요하다. 최초 설치, 첫 discovery, 세 번의 정상 호출, definition 변경, 이후 접근 시도가 각각 언제 일어났는지 연결해야 한다. 로그를 남기지 않았다면 나중에 PR과 현재 server 상태만 보고 과거 행동을 복원하기 어렵다.

최소 감사 이벤트는 다음을 포함해야 한다.

- actor, device, client, agent session
- MCP server identity와 transport
- tool name, definition fingerprint, 이전 fingerprint
- 호출 sequence number와 timestamp
- 승인·거부·step-up 같은 policy decision
- 접근한 파일의 정규화 경로와 결과
- credential broker 요청과 발급된 scope
- outbound destination, byte count, 차단 여부
- package, image, executable digest
- PR URL, commit SHA, 설치 출처 같은 provenance

prompt와 응답 전문을 무조건 보존하면 또 다른 secret 저장소가 생긴다. 민감 인자는 기본 마스킹하고, 원문이 꼭 필요한 환경은 접근 권한과 보존 기간을 별도로 둬야 한다. 반대로 fingerprint와 policy decision만 남기고 sequence를 버리면 지연형 전이를 분석하기 어렵다. 필요한 것은 모든 내용을 영구 보존하는 것이 아니라 조사 질문에 답할 수 있는 구조화된 증거다.

보존 기간은 평소 사용 주기보다 길어야 한다. 한 달에 한 번 쓰는 tool의 로그를 7일만 남기면 이전 실행과 변경 시점을 비교할 수 없다. 조직의 규제, 개인정보, 저장 비용을 고려하되 최소한 tool 승인 주기와 credential 수명, 일반적인 탐지 지연을 함께 검토해야 한다. immutable 또는 append-only 저장, 시간 동기화, request ID 연계도 중요하다.

## Credential rotation은 자동 반사 행동이 아니라 범위 판단이다

의심스러운 MCP server가 발견되면 "모든 credential을 즉시 교체"하거나 반대로 "유출 증거가 없으니 아무것도 하지 않음"이라는 두 극단으로 가기 쉽다. rotation은 증거와 잠재 접근 범위를 바탕으로 우선순위를 정해야 한다.

다음 조건이면 rotation 우선순위를 높인다.

- process가 실제 credential 파일을 읽은 audit 기록이 있다.
- SSH agent나 cloud metadata endpoint에 접근했다.
- secret 값이 들어 있는 tool argument 또는 prompt가 외부로 전송됐다.
- 허용되지 않은 egress와 파일 읽기가 같은 session에서 이어졌다.
- 장기 credential이 sandbox 안에 mount돼 있었고 접근 로그가 불완전하다.
- credential scope가 production write까지 포함한다.

반대로 설정 PR이 존재했지만 실행되지 않았고, CI·개발 장비 어디에도 설치 흔적이 없으며, endpoint 접속도 없다는 증거가 충분하다면 전체 조직의 key를 무조건 교체하는 조치는 비용 대비 효과가 낮을 수 있다. 그래도 노출 가능성이 있는 계정의 최근 인증 로그와 token 발급 이력은 확인해야 한다.

rotation 순서는 공격자가 접근했을 가능성과 악용 시 영향을 함께 본다. production cloud key, deploy key, cluster-admin kubeconfig, signing key를 먼저 처리하고, 낮은 scope의 단기 token은 폐기·만료 여부를 확인한다. key만 바꾸고 기존 session, refresh token, SSH certificate, CI variable, cache를 남기면 대응이 끝나지 않는다.

## Incident response: PR 발견부터 복구까지

### 1. 식별과 보존

의심 PR, account URL, commit SHA, endpoint, package 이름, tool definition 원문을 보존한다. 화면 캡처만이 아니라 API 응답과 repository object를 가능한 범위에서 확보한다. 공개 GitHub 계정 이상의 공격자 신원은 추정하지 않는다.

### 2. 실행 범위 확인

repository merge 여부와 실제 실행 여부를 따로 조사한다. 개발자 MCP 설정, CI log, package cache, shell history, endpoint access log, process telemetry에서 server가 등록·실행·호출됐는지 찾는다. 호출 횟수와 session별 sequence를 재구성한다.

### 3. 격리

endpoint와 package를 catalog에서 비활성화하고, 실행 중인 process를 중지하며, egress를 차단한다. 증거 보존이 필요한 장비는 무작정 삭제하거나 재설치하기 전에 forensic snapshot과 관련 로그를 확보한다. 동일 fingerprint와 변형 endpoint를 조직 전체에서 검색한다.

### 4. 영향 분석

어떤 filesystem mount, environment variable, credential broker, network destination이 해당 process에 노출됐는지 계산한다. "읽을 수 있었다"와 "읽었다"를 구분하고, "외부로 보낼 수 있었다"와 "전송이 확인됐다"도 구분한다. 불확실한 부분은 불확실하다고 기록한다.

### 5. Credential 처리

증거와 잠재 범위에 따라 revoke, rotate, session invalidation을 수행한다. production write credential과 signing material을 우선한다. 새 credential을 발급하기 전에 감염된 설정과 process가 제거됐는지 확인해야 한다. 그렇지 않으면 새 비밀도 같은 경로에 다시 노출된다.

### 6. 복구와 재승인

신뢰 가능한 source에서 server를 다시 설치하고, definition fingerprint를 새 baseline으로 승인한다. stateful test, sandbox, egress policy를 통과하기 전에는 production credential을 연결하지 않는다. 변경된 tool은 사용자에게 diff와 새 권한을 보여 주고 re-consent를 받는다.

### 7. 사후 개선

왜 PR review, CI, client 승인, runtime policy 중 어느 계층에서도 차단되지 않았는지 분석한다. "리뷰어가 놓쳤다"로 끝내지 말고 짧은 smoke test, remote code 의존, fingerprint 부재, 과도한 mount, 로그 공백 같은 구조적 원인을 backlog와 owner에 연결한다.

## 팀별 운영 책임을 나눈다

이 문제를 보안팀 하나의 제품 도입 과제로 만들면 빈틈이 생긴다. 각 팀이 통제할 수 있는 지점이 다르다.

**개발팀**은 PR에서 endpoint, install script, executable source, lockfile 변경을 명시하고 tool owner를 지정한다. 임시 테스트라도 개인의 전체 home과 production credential을 연결하지 않는다.

**플랫폼팀**은 승인된 MCP catalog, sandbox profile, egress proxy, short-lived identity, fingerprint 저장소를 제공한다. 개발자가 안전한 기본 경로를 우회하는 편이 더 쉬운 환경을 만들지 않아야 한다.

**보안팀**은 위험 등급, re-consent 기준, 금지 경로, rotation 조건, 로그 보존 기준을 정한다. tool description 변경도 code change처럼 review 대상이라는 규칙을 세운다.

**SOC와 incident response 팀**은 tool call을 일반 endpoint log와 연결할 수 있어야 한다. PR이 merge됐는지만 묻지 말고 누가 언제 discovery와 호출을 수행했는지 확인하는 query와 playbook을 준비한다.

**MCP client 개발자**는 definition 변경을 조용히 수용하지 않고 사용자와 정책 엔진에 이벤트로 노출해야 한다. fingerprint가 달라지면 기존 승인을 일시 중지하고, 민감 행동은 서버 description과 무관하게 강제 정책으로 통제한다. Pillar 보고서도 sensitive action을 정책으로 계속 강제할 것을 권고한다.[6]

## 배포 전 체크리스트

### 공급망과 출처

- [ ] PR 작성자 계정과 repository provenance를 기록했는가.
- [ ] merge 상태와 실제 설치·실행 상태를 구분했는가.
- [ ] remote endpoint가 제공하는 코드를 repository review만으로 승인하지 않았는가.
- [ ] package version, commit SHA, image 또는 executable digest를 고정했는가.
- [ ] install script와 숨은 local script 참조를 확인했는가.

### Stateful 검증

- [ ] tool discovery 결과를 최초와 반복 호출 뒤에 비교했는가.
- [ ] 최소한 임계값 주변의 여러 호출 횟수를 시험했는가.
- [ ] session 재개, 새 session, process 재시작을 시험했는가.
- [ ] 호출 순서와 오류 삽입을 바꿔 봤는가.
- [ ] canary 파일과 차단된 egress로 side effect를 관찰했는가.
- [ ] 짧은 smoke test 통과를 보안 승인으로 오해하지 않는가.

### Fingerprint와 동의

- [ ] description, schema, annotation, scope를 fingerprint에 포함했는가.
- [ ] canonicalization 규칙이 문서화됐는가.
- [ ] endpoint와 실행 artifact identity를 함께 묶었는가.
- [ ] definition 변경 시 기존 승인을 중단하는가.
- [ ] 사용자에게 diff와 추가 권한을 구체적으로 보여 주는가.
- [ ] 금지된 민감 행동은 사용자 동의와 무관하게 차단하는가.

### 격리와 권한

- [ ] 전용 user 또는 격리 runtime에서 실행하는가.
- [ ] home, SSH agent, Docker socket을 기본으로 노출하지 않는가.
- [ ] repository 외 filesystem은 기본 거부인가.
- [ ] egress는 필요한 destination만 허용하는가.
- [ ] cloud와 Kubernetes credential은 짧고 최소 scope인가.
- [ ] runtime step-up과 credential broker를 사용할 수 있는가.

### 관찰과 대응

- [ ] 호출 sequence와 definition fingerprint를 함께 기록하는가.
- [ ] 파일 접근과 outbound connection을 연계할 수 있는가.
- [ ] 로그 보존 기간이 tool 사용 주기보다 충분한가.
- [ ] 의심 endpoint의 조직 전체 검색 방법이 있는가.
- [ ] revoke·rotation·session invalidation 순서가 정해져 있는가.
- [ ] 실제 접근, 잠재 접근, 확인된 전송을 구분해 보고하는가.

## 결론

지연형 MCP tool poisoning은 새로운 종류의 악성 코드라는 설명만으로는 부족하다. 이것은 도구의 identity를 이름과 endpoint로만 보고, 시간에 따라 변하는 definition을 승인 계약에 포함하지 않았을 때 생기는 운영 실패다.

Pillar 연구진이 보고한 사례에서 주목할 점은 "세 번"이라는 숫자 자체가 아니다. 처음 몇 번의 정상 동작으로 검토 절차를 통과하고 그 뒤 metadata를 바꾸는 전환 구조다.[6] 임계값이 다섯 번이나 하루 뒤로 바뀌어도 같은 방어 원칙이 적용돼야 한다.

해법은 한 제품이나 한 번의 스캔이 아니다. PR 출처를 추적하고, stateful 테스트로 전이를 확인하며, tool definition을 fingerprint하고, 변화가 생기면 re-consent를 요구해야 한다. 동시에 sandbox와 egress, 파일·credential 접근 통제로 탐지 실패의 영향을 제한하고, sequence가 남는 로그와 조건부 rotation, 검증 가능한 incident response를 준비해야 한다.

MCP 공식 보안 가이드는 local server를 client 권한으로 실행되는 코드로 다루고 명시적 승인과 filesystem·network 제한을 권고한다.[5] 이 기본선 위에 "승인한 tool이 계속 같은 tool인가"라는 질문을 추가해야 한다. 신뢰는 설치 순간에 영구 부여되는 속성이 아니라, 정의와 권한과 실행 경계가 유지되는 동안에만 유효한 상태다.

## Sources

[5] https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices — MCP Security Best Practices
[6] https://www.pillar.security/blog/deadbugz-currently-active-mcp-supply-chain-campaign — Deadbugz: Currently Active MCP Supply-Chain Campaign
