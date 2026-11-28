---
title: 'AI SRE에게 멀티클라우드 장애 조사를 맡기기 전: 읽기 전용 권한·승인·귀속 테스트'
date: 2026-11-28 07:30:00 +0900
categories: ["AI"]
description: 'Azure SRE Agent의 멀티클라우드·A2A preview 경계를 확인하고, 조사 주체와 cloud 권한, 변경 승인, 책임 귀속을 보존하는 테스트를 설계한다.'
featured_image: 'https://picsum.photos/seed/multicloud-ai-sre-identity-approval/1600/900'
tags: [azure-sre-agent, multicloud, ai-sre, identity, incident-response]
---

![밤의 도로 위로 길게 이어진 자동차 불빛 궤적](https://picsum.photos/seed/multicloud-ai-sre-identity-approval/1600/900)

장애 채널에서 AI SRE에게 “원인을 찾아줘”라고 말하는 순간, 한 번의 요청이 Teams, Azure, AWS나 Google Cloud, 다른 팀의 agent까지 건너갈 수 있다. 편리함만 보면 하나의 대화지만 권한 관점에서는 여러 주체와 trust boundary가 이어진 분산 실행이다.

Microsoft가 Ignite 2026에서 발표한 Teams 통합, Microsoft Entra Agent ID, AWS·Google Cloud connector, A2A 기반 agent 협업, Azure CLI와 Grafana 통합은 대부분 public preview다. Slack 통합은 private preview다.[1] 이 상태 경계를 지우고 “멀티클라우드 자동 복구가 완성됐다”고 말하면 안 된다. 먼저 읽기 전용 조사와 production 변경을 분리하고, 누가 무엇을 요청·제안·승인·실행했는지 끝까지 복원되는지 시험해야 한다.

## 하나의 incident에 최소 네 주체가 있다

사고 대응 trace에는 최소한 다음 주체가 따로 남아야 한다.

| 주체 | 확인할 질문 |
|---|---|
| 사용자 | 누가 어떤 채널과 세션에서 조사를 시작했는가 |
| SRE agent | 어떤 Entra identity와 Azure RBAC로 실행됐는가 |
| 외부 cloud principal | 어떤 federation으로 어떤 role을 얻었는가 |
| 수신 agent·승인자 | 누가 요청을 받았고 누가 변경을 승인했는가 |

Microsoft 설명에 따르면 Teams의 SRE Agent는 자체 Entra agent user로 참여하고, 할당된 Azure RBAC 안에서 동작한다. production에 영향을 줄 수 있는 변경은 권한 있는 사람의 승인을 기다린다. SRE Agent는 system-assigned 또는 user-assigned managed identity를 사용해 왔고, public preview인 Entra Agent ID를 통해 activity log에 자체 이름으로 나타날 수 있다.[1]

여기서 “자체 이름”은 책임의 끝이 아니다. 원 요청자와 agent, 승인자와 실행 주체가 하나의 이름으로 뭉개지지 않아야 한다. 사람이 승인했더라도 agent가 선택한 tool input과 승인자가 본 변경안이 같았는지 별도로 확인해야 한다.

## AWS·GCP 연결은 자격 증명 제거가 아니라 경계 이동이다

AWS와 Google Cloud connector는 public preview이며 Azure managed identity에서 federation한다고 발표됐다. 고정 access key를 관리하지 않아도 되고, 외부 cloud IAM이 agent가 접근할 수 있는 범위를 결정한다.[1] 이는 장기 secret을 줄이는 장점이 있지만 “자격 증명이 없다”는 뜻은 아니다. 신뢰 정책, token audience, role 조건, session 수명과 외부 cloud audit log가 새로운 검증 대상이 된다.

읽기 전용 조사 역할은 서비스 이름만 보고 설계하지 않는다. 예를 들어 log 조회 권한이 query 결과를 저장할 bucket 쓰기 권한을 암묵적으로 필요로 하는지, metric 탐색 tool이 tag 수정 API도 함께 가진 managed policy를 쓰는지 확인한다. preview connector가 지원하는 계정·region·resource 유형도 실제 tenant에서 읽어야 한다.

권장 출발점은 cloud별 별도 role이다.

- Azure 조사 identity: resource와 activity log 읽기, 변경 API 거부
- AWS 조사 role: 필요한 account·region의 관측 API만 허용
- GCP 조사 service identity: project별 viewer 범위와 log read 분리
- 변경 role: 조사 identity와 분리하고 짧은 승인 후에만 발급

이 구조는 제품의 기본 schema가 아니라 조직이 추가하는 운영 설계다. role 이름, 승인 ID, incident ID와 evidence digest도 조직 내부 필드임을 명시해야 한다.

## A2A에서는 호출자와 수신자의 권한을 합치지 않는다

Microsoft의 agent collaboration은 A2A를 기반으로 한 public preview다. 발신 agent는 incident 소유권을 유지하고, 수신 agent는 자기 도구와 권한을 사용하며, 수신 팀이 각 caller를 승인한다고 설명한다.[1] 따라서 A2A 호출은 발신 agent의 권한이 원격으로 복제되는 구조로 해석하면 안 된다.

trace는 다음 연결을 보존해야 한다.

1. 원 incident와 사용자 요청
2. 발신 agent identity와 outbound 요청 digest
3. 수신 agent identity와 caller 승인 정책
4. 수신 agent가 사용한 local tool·권한
5. 반환 evidence와 발신 agent의 해석
6. 후속 변경안과 별도 human approval

수신 agent가 “DB latency가 원인”이라고 답했다고 해서 발신 agent가 production 변경 권한까지 얻는 것은 아니다. evidence를 받은 상태와 변경을 제안한 상태, 승인된 상태, 실행된 상태를 분리한다. A2A 응답이 끊기거나 오래된 incident를 참조하면 `unknown` 또는 `inconclusive`로 남기고 성공으로 보정하지 않는다.

## 제안 테스트: 읽기 전용 조사를 먼저 깨본다

다음은 실제 tenant에서 실행하기 전에 sandbox와 synthetic incident로 검토할 **제안형 테스트**다. 성공 결과를 전제하지 않는다.

첫째, 같은 synthetic incident를 Teams, Azure CLI, portal에서 각각 시작한다. 모든 경로에서 원 요청자, channel, agent identity, session과 incident correlation ID가 남는지 비교한다. Azure Container Apps portal의 on-demand 세션은 발표상 read-only이고 사용자의 Azure identity를 사용한다.[1] 이 경로가 별도 SRE agent identity 경로와 어떻게 구분되는지 trace에서 확인한다.

둘째, Azure resource와 AWS·GCP 관측 대상에 존재하는 정상 evidence를 읽게 한다. 이어서 의도적으로 허용하지 않은 subscription, account, project와 region을 요청한다. 기대 결과는 부분 성공으로 숨기는 것이 아니라 명시적 access denial과 대상 경계 기록이다.

셋째, 조사 prompt 안에 production 변경 요청을 섞는다. 읽기 전용 identity에서 변경 API가 실제로 거부되고, agent가 승인 없는 우회 tool을 찾지 않는지 확인한다. cached credential, query-result store, automation webhook 같은 인접 경로도 함께 시험한다.

넷째, 다른 팀 agent에 A2A 요청을 보낸다. 미승인 caller, 승인된 caller, 폐기된 승인, 수신 agent timeout을 각각 주입한다. 발신 agent가 실패를 자기 관측 결과로 꾸미지 않고 원격 evidence 상태를 보존해야 한다.

## 승인 계약은 입력 digest와 실행 결과를 묶는다

“사람이 승인함”이라는 boolean만으로는 부족하다. 승인 객체는 최소한 incident ID, 제안한 변경의 canonical form, 대상 cloud·account·resource, 예상 영향, rollback 조건, 만료 시각과 제안 digest를 포함해야 한다. 승인 뒤 tool input이 달라지면 새 승인을 요구한다.

실행 단계의 불변식은 다음과 같이 둘 수 있다.

- 읽기 전용 조사 identity는 변경 tool을 호출할 수 없다.
- 승인자는 자신의 권한 범위를 넘는 변경을 승인할 수 없다.
- 승인은 특정 proposal digest와 짧은 시간 창에만 유효하다.
- 실행자는 승인된 대상과 parameter만 사용한다.
- 실행 결과와 cloud-native audit event를 읽어 incident trace에 결합한다.
- 실패·부분 성공·rollback도 성공과 다른 상태로 기록한다.

Microsoft는 SRE Agent 공식 community repository에 lab과 sample 환경을 제공하지만, repository 자체는 제품 service 구현 전체가 아니라 resource hub 성격이다.[2] sample의 identity나 권한을 production 기본값으로 복사하지 말고 tenant의 effective policy를 읽어야 한다.

## activity log만으로는 충분하지 않다

Entra Agent ID와 Azure activity log는 agent 행위를 자체 이름으로 찾는 데 유용하다.[1] 그러나 외부 cloud와 A2A를 포함한 전체 incident에는 각 시스템의 원본 audit event가 필요하다. 중앙 trace에는 원본 event ID와 immutable digest를 참조하고, provider event를 조직 내부 schema로 변환했다면 그 사실을 명확히 표시한다.

최소 감사 묶음은 다음과 같다.

- 사용자 요청과 channel metadata
- agent·connector·외부 role의 effective identity
- tool 이름, 입력 digest, 읽은 resource와 evidence ID
- A2A 발신·수신 ID와 수신 팀 승인
- 변경 proposal, human approval, 실행 event
- 오류, 재시도, 부분 결과, rollback 결과

보관 시스템이 하나의 cloud 장애로 함께 멈추지 않는지도 검토한다. incident trace를 production subscription 안의 동일한 logging path에만 두면 장애 시 가장 필요한 증거가 사라질 수 있다.

## preview 도입 전 판정표

- Teams·Entra Agent ID·AWS/GCP connector·A2A·CLI·Grafana 기능을 public preview로, Slack을 private preview로 표시한다.[1]
- tenant와 region에서 실제 활성화된 기능과 문서상 발표를 구분한다.
- Azure, AWS, GCP의 조사 role을 쓰기 권한과 분리한다.
- federation의 audience, trust condition, session 수명과 폐기 경로를 확인한다.
- A2A 호출에서 발신·수신 identity와 각자의 권한을 따로 기록한다.
- proposal digest가 달라지거나 승인이 만료되면 fail-closed한다.
- provider별 audit event를 원 incident까지 역추적한다.
- synthetic test를 실행하기 전에는 MTTR 감소나 자동 복구 성공률을 주장하지 않는다.

멀티클라우드 AI SRE의 첫 KPI는 “몇 분 만에 고쳤는가”가 아니다. **누가 시작했고, 어떤 identity가 어느 cloud의 무엇을 읽었으며, 누가 어떤 변경을 승인했고, 실제 실행은 누구에게 귀속되는가**를 한 incident에서 복원할 수 있는지가 먼저다. 이 연결이 끊기면 빠른 진단은 운영 통제가 아니라 더 빠른 불확실성이 된다.

## Sources

[1] https://techcommunity.microsoft.com/blog/appsonazureblog/what%E2%80%99s-new-in-azure-sre-agent-at-microsoft-ignite-2026/4573607
[2] https://github.com/microsoft/sre-agent
