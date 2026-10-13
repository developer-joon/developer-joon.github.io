---
title: '89초 평균 대응: SOC 에이전트의 Notify·Collaborate·Authorize 경계'
date: 2026-10-13 09:15:00 +0900
categories: ["AI 보안"]
description: 'SOC 에이전트의 조사 자동화와 대응 권한을 분리하고, 증거·계획·검토·실행 및 복구 가능한 위임 경계를 설계한다.'
featured_image: 'https://picsum.photos/seed/soc-agent-authorization-boundaries/1600/900'
tags: [soc, mdr, ai-agent, incident-response, authorization, sophos, openai]
---

![SOC 에이전트의 조사와 대응 권한 경계](https://picsum.photos/seed/soc-agent-authorization-boundaries/1600/900)

보안 운영에서 89초라는 숫자는 강렬하다. 그러나 이 숫자를 “AI가 모든 사고를 89초 안에 해결한다”로 읽는 순간 운영 설계는 잘못된 방향으로 간다. OpenAI가 2026년 10월 9일 공개한 Sophos 사례에서 **89초는 Daybreak 모델로 만든 에이전트를 사용한 사례의 평균 대응 시간이라는 OpenAI·Sophos의 공급자·고객 보고 수치**다.[1] **96%는 기존 프로세스의 약 38분과 에이전트를 사용한 사례의 약 89초를 비교해 제시한 조사 시간 감소율**이고, **52%는 Sophos가 집계한 MDR 사례 중 AI가 정해진 경계 안에서 종단 간 해결했다고 보고한 비율**이다.[1] 공개 페이지는 표본 수·기간·사례 구성·동일 사례 대조 여부와 52%의 구체적인 포함 기준을 밝히지 않으므로 세 수치를 하나의 성공률로 합쳐서는 안 된다.[1]

이 사례에서 더 중요한 부분은 속도가 아니라 작업의 분절이다. 조사 에이전트는 고객 맥락, 탐지, 침해 지표와 위협 인텔리전스를 모으고, 계획 모델은 조사 계획을 만든 뒤 실행과 검토를 반복하며, 분석가가 검토할 요약과 권고 대응을 만든다.[1] 다른 에이전트가 대응 일부를 수행할 수 있지만, 이 문장은 “조사를 자동화했다”와 “환경을 바꾸는 권한을 넘겼다”가 같은 뜻이 아님을 보여 준다.[1]

따라서 SOC 에이전트의 핵심 질문은 모델 정확도가 아니다. **어떤 증거로 어떤 계획을 만들 수 있는가, 누가 그 계획을 검토하는가, 어느 행동까지 별도 승인 없이 실행할 수 있는가, 실행 결과를 어떻게 되돌리고 확인하는가**다. 이 글은 제품 홍보 수치를 재평가하거나 일반적인 샌드박스·네트워크 격리를 반복하지 않는다. 조사와 대응 사이에 놓여야 할 권한 계약, 특히 잘못된 격리와 재개방 실패를 어떻게 계측할지를 다룬다.

## 조사 자동화율과 대응 자율성은 다른 축이다

SOC 업무를 `탐지 → 조사 → 대응` 한 줄로 그리면 자동화 수준도 하나의 백분율로 표현하고 싶어진다. 하지만 조사 단계는 주로 읽기와 추론이고, 대응 단계는 고객 환경의 상태를 바꾸는 쓰기다. 같은 에이전트가 두 단계를 이어서 수행하더라도 위험의 종류는 다르다.

조사 에이전트가 EDR 이벤트를 읽고, 프로세스 트리를 재구성하고, IP 평판과 사용자 로그인 이력을 비교하는 동안의 주된 실패는 **잘못된 결론**이다. 잘못된 결론은 심각하지만 아직 고객 시스템을 변경하지는 않는다. 반면 호스트 격리, 세션 폐기, 계정 비활성화, 파일 삭제, IP 차단은 **잘못된 효과**를 즉시 만든다. 조사 결과가 틀렸을 때 대응 권한까지 자동으로 따라오면 인식 오류가 서비스 중단으로 변환된다.

Sophos의 공개 문서도 이 차이를 운영 모드로 드러낸다. `Notify Only`에서는 제한된 조사와 통지만 가능하고, `Collaborate`에서는 MDR 팀이 조사하되 대응 행동 전에 고객의 서면 승인을 받아야 하며, `Authorize`에서는 MDR 팀이 고객에게 먼저 묻지 않고 능동적 위협에 대한 containment를 수행한 뒤 알린다.[2]

여기서 모드 이름을 에이전트의 성격으로 이해하면 안 된다. `Notify`는 “소극적인 모델”, `Authorize`는 “더 똑똑한 모델”이 아니다. 둘의 차이는 **같은 판단 결과가 어떤 상태 변경 권한으로 교환되는가**다. 모델 버전이나 프롬프트보다 먼저 고객별 mandate를 읽어야 하는 이유다.

또 하나의 함정은 52%를 “52%의 사고에서 사람이 필요 없었다”로 일반화하는 것이다. OpenAI 페이지의 표현은 Sophos가 해당 수치 산정에 포함한 MDR 사례 중 52%가 분석가가 보정한 경계 안에서 AI로 종단 간 해결됐다는 고객 보고 결과다.[1] 이는 나머지 48%가 모두 침해였다는 뜻도, 자동 처리된 52%가 동일한 심각도·동일한 대응 행동을 포함했다는 뜻도, 다른 SOC가 같은 비율을 재현할 수 있다는 뜻도 아니다. 집계 기간·표본 수·포함 기준은 공개되지 않았다.[1]

## 먼저 네 단계를 서로 다른 권한 객체로 만든다

이 글에서 제안하는 기본 흐름은 **evidence → plan → review → response**다. 네 단계는 UI의 진행 상태가 아니라 서로 다른 입력·출력·권한을 가진 객체여야 한다.

### 1. Evidence: 관찰 사실을 변경 불가능한 묶음으로 고정한다

Evidence 객체에는 원본 이벤트 참조, 수집 시각, 자산·사용자 식별자, 센서 출처, 쿼리와 결과, 누락된 데이터, 보존 기간을 넣는다. 에이전트의 자연어 요약은 증거 자체가 아니라 파생물이다. “악성 PowerShell”이라는 문장 대신 프로세스 해시, 부모·자식 관계, 명령행, 서명 상태, 연결 목적지와 그 원본 이벤트 ID를 연결한다.

CISA는 영향받은 시스템을 식별해 즉시, 조정된 방식으로 격리하고 클라우드 자원은 볼륨 snapshot을 남기도록 안내한다.[3] 네트워크 분리가 불가능할 때만 전원을 끄라고 하며, 이 경우 휘발성 메모리 증거를 잃는다고 경고한다. 또한 상황에 따라 영향받은 장치 표본의 시스템 이미지·메모리와 관련 로그·악성 artifact를 보존하도록 권고한다.[3] 따라서 evidence 수집과 response 실행의 순서도 권한 계약의 일부다. 에이전트가 `power_off`를 추천했다면 메모리 캡처가 선행됐는지, 불가능했다면 어떤 긴급 조건 때문에 증거 손실을 감수했는지를 남겨야 한다.

Evidence 단계의 권한은 기본적으로 read-only다. 다만 원격 쿼리도 자산 부하, 개인정보 접근, 로그 보존 변경을 일으킬 수 있으므로 `대상`, `시간 범위`, `조회 데이터 종류`, `최대 쿼리 비용`을 제한한다. 데이터가 없다는 사실을 정상 상태로 추론하지 않고 `unknown`으로 보존하는 것도 중요하다.

### 2. Plan: 결론이 아니라 변경 후보를 명시한다

Plan은 “위협을 차단한다” 같은 목적 문장이 아니다. 다음과 같이 실행 가능한 후보와 선행 조건을 담는다.

```text
판단: credential theft 뒤 lateral movement 가능성
근거: evidence bundle E-1842, E-1847, E-1850
후보 행동:
  A. endpoint host-42 격리
  B. user-17의 활성 세션 폐기
  C. IOC 203.0.113.8을 4시간 차단
예상 효과: host-42의 일반 network 연결 중단
업무 영향: 결제 배치 worker 중단 가능
선행 조건: memory capture 완료, 대체 worker healthy
복구 행동: host 격리 해제, 사용자 세션 재발급, IOC block 만료
확인 쿼리: isolation state, active sessions, firewall rule read-back
```

Sophos가 공개한 MDR 대응 행동에는 Live Response를 통한 사용자·세션·악성 프로세스·파일·예약 작업 조치와, Sophos Central을 통한 장치 격리·애플리케이션 및 IP 차단 등이 포함된다.[4] Microsoft 365 연동에서는 로그인 차단·허용, 세션 폐기, inbox rule 비활성화가 가능하고, 방화벽 연동에서는 침해 사용자 VPN 세션 종료 같은 행동도 가능하다.[4] “대응”이라는 한 단어 아래 가역성, 업무 영향, 증거 손실 가능성이 다른 명령이 섞여 있으므로 plan은 action class별로 쪼개야 한다.

권장 action class는 `observe`, `contain`, `revoke`, `modify`, `delete`, `restore`다. `observe`는 상태를 읽고, `contain`은 연결을 제한하며, `revoke`는 세션·토큰을 무효화한다. `modify`는 rule이나 설정을 바꾸고, `delete`는 artifact를 제거하며, `restore`는 격리 해제나 허용 상태 복귀를 수행한다. 하나의 plan에 여러 class가 있으면 각 항목이 독립적으로 승인·거부될 수 있어야 한다.

### 3. Review: 조사 품질과 실행 권한을 따로 판정한다

Review에는 두 개의 verdict가 필요하다.

- `evidence_verdict`: 증거가 판단을 지지하는가.
- `action_verdict`: 그 판단이 맞더라도 지금 이 고객·자산에 이 행동을 해도 되는가.

예를 들어 실제 malware가 확인돼 `evidence_verdict=confirmed`여도 생명·안전 시스템, 생산 배치 서버, 법적 보존 대상 장치는 즉시 격리 권한 밖일 수 있다. 반대로 증거가 완전하지 않아도 확산 중인 ransomware처럼 사전 합의한 긴급 조건에서는 짧은 TTL의 containment를 먼저 허용할 수 있다. 이때 승인은 “모델이 맞다”가 아니라 “불확실성 안에서도 제한된 조치의 기대 피해가 미조치 피해보다 작다”는 운영 판단이다.

NIST SP 800-61r3는 조직과 제3자의 incident response 책임에 정보 흐름, 조정 방식, 조직을 대신해 행동할 권한을 포함해 문서화할 것을 권고하며, 어떤 역할이 자산을 압수·연결 해제·종료할 권한을 갖는지도 정하도록 한다.[5] 같은 지침은 자동 containment에 더해 incident handler가 containment 행동을 수동으로 선택·수행할 수 있게 하라고 권고한다.[5] 그러므로 사람 검토는 모델 앞에 붙이는 장식이 아니라 자동 경로를 중단하고 다른 대응을 선택할 수 있는 실제 제어점이어야 한다.

### 4. Response: 실행 성공이 아니라 상태 전이를 확인한다

Response 객체는 API의 `200 OK`를 성공으로 기록해서는 안 된다. 요청한 행동, 정책 verdict, 공급자 job ID, 실행 응답, 목표 상태의 read-back, 관찰 시각, TTL, rollback handle을 함께 기록한다.

Sophos의 장치 관리 문서는 관리자 격리가 컴퓨터의 network 연결을 끊지만 Sophos Central에서는 계속 관리할 수 있고, 관리자가 언제든 격리를 해제할 수 있다고 설명한다.[6] 이 제품 동작은 격리 후에도 상태 확인과 복구 통로를 남길 수 있음을 보여 주지만, “격리 요청 성공”만으로 실제 단말이 격리 상태에 도달했다는 보장은 아니다. Response 단계는 제어 plane의 명령 수락과 endpoint의 effective state를 분리해 읽어야 한다.

## Notify·Collaborate·Authorize는 세 개의 고정 버튼이 아니다

공식 Sophos 모드는 고객이 원하는 escalation과 response 방식에 따라 세 가지 선택지를 제공한다.[2] 실제 운영에서는 이 개념을 그대로 쓰되, 계정 전체에 단일 모드를 붙이지 말고 `action class × 자산 등급 × 사건 조건`의 mandate로 확장하는 편이 안전하다. 아래 표는 Sophos 기능 설명이 아니라 이 글의 운영 설계안이다.

| 경계 | Evidence·Plan | Review | Response |
|---|---|---|---|
| Notify | 자동 수집·계획 가능 | 에이전트가 근거와 권고를 게시 | 상태 변경 금지, 담당자 통지 |
| Collaborate | 자동 수집·계획 가능 | 지정 승인자의 명시적 승인 필요 | 승인된 action·target·TTL만 실행 |
| Authorize | 자동 수집·계획 가능 | 사전 mandate와 실시간 policy가 검토 역할 | 경계 안에서 실행 후 즉시 read-back·통지 |

Sophos의 Collaborate 모드는 원칙적으로 대응 전 서면 승인을 요구하지만, 고객이 별도 옵션을 선택하면 정의된 연락처에 전화로 접촉을 시도한 뒤 응답이 없을 때 MDR 팀이 Authorize 방식으로 운영할 수 있다.[2] 이 fallback은 유용하지만 “연락 실패=포괄 승인”으로 구현하면 안 된다. 사전에 정한 사건 등급, 허용 action class, 최대 자산 수, TTL, 제외 자산, 재시도 횟수에만 권한을 발급해야 한다.

예를 들어 일반 직원 노트북의 단일 endpoint 격리는 `Authorize`일 수 있지만, domain controller 격리와 계정 삭제는 `Collaborate`, 악성 파일 hash 통지는 `Notify`로 둘 수 있다. 같은 고객에서도 야간에는 활성 ransomware 탐지에 한해 30분짜리 `contain` 권한을 주고, 업무 시간에는 담당자 승인을 요구할 수 있다. 중요한 것은 모드가 모델 session의 속성이 아니라 **특정 고객과 효과에 결박된 짧은 mandate**라는 점이다.

Mandate에는 최소한 다음 필드가 필요하다.

```text
customer_id, policy_version, action_class, allowed_targets
incident_type, confidence_floor, required_evidence
max_assets, max_duration, expiry, excluded_assets
approval_mode, approver_roles, unreachable_fallback
read_back_query, rollback_action, rollback_deadline
notification_targets, evidence_retention
```

`confidence_floor` 하나만으로 자동 대응을 결정해서는 안 된다. 모델 confidence가 calibration되지 않았거나 사건 유형이 바뀌면 숫자의 의미가 달라진다. `required_evidence`에 서로 독립적인 센서 수, 필수 telemetry freshness, 알려진 정상 변경과의 충돌 여부를 함께 넣고, 고위험 action은 confidence와 무관하게 Collaborate로 승격한다.

Sophos 서비스 설명에서 response action은 통지, 원격 query, host isolation, 프로세스 종료, 악성 artifact 삭제·격리, indicator 차단, 사용자 비활성화, 세션 폐기, 설정·정책 변경 등을 포함할 수 있으며, agentless third-party endpoint의 response action 범위는 host isolation과 un-isolation으로 제한된다.[7] 따라서 “MDR이 연결돼 있다”는 사실만으로 모든 sensor와 endpoint에 같은 실행 능력이 있다고 가정해서는 안 된다. Mandate의 `allowed_targets`는 제품 이름이 아니라 실제 integration별 지원 행동과 현재 연결 상태에서 계산해야 한다.

## 가장 위험한 실패는 ‘놓친 탐지’만이 아니다

SOC 자동화 평가는 보통 mean time to respond와 자동 종결률을 앞세운다. 89초와 52%도 운영 규모를 이해하는 단서지만, 권한 설계의 품질을 증명하지는 않는다.[1] 다음 네 지표와 정의는 Sophos·NIST·CISA의 공식 지표가 아니라 이 글의 운영 제안이다.

### 1. False isolation rate

```text
잘못된 격리율 = 정당한 업무 자산을 오판해 격리한 건수 / 전체 자동 격리 건수
```

분자는 단순히 analyst가 verdict를 뒤집은 건수로 끝내지 않는다. 정상 관리 도구, 승인된 penetration test, software 배포, 사용자 오탐, stale asset mapping 때문에 격리된 사례를 구분한다. 업무 영향도 `사용자 불편`, `batch 지연`, `서비스 중단`, `안전 영향`으로 나눠야 같은 1건의 무게 차이를 볼 수 있다.

CISA는 ransomware 대응에서 영향받은 시스템을 즉시 격리하되, 중요 시스템을 우선순위로 고려하고 격리를 조정된 방식으로 수행하라고 안내한다.[3] 즉 빠른 격리는 필요한 수단이지만 자산 중요도와 공격자의 lateral movement 가능성을 함께 다뤄야 한다.[3] 자동화가 이 맥락을 읽지 못하면 평균 시간은 줄어도 실제 운영 피해는 커질 수 있다.

### 2. Time to safe reopen

```text
안전한 재개방 시간 = 격리 시작부터 복구 조건 검증 후 정상 연결 확인까지
```

`time to isolate`만 최적화하면 닫는 자동화는 빨라지고 여는 책임은 사람의 queue에 남는다. 재개방에는 악성 persistence 제거, credential reset, 필요한 patch, EDR health, 업무 owner 확인, 일정 시간의 재탐지 없음 같은 조건이 필요하다. 조건을 만족하면 `restore` action을 새 승인 대상으로 만들고, 연결 복구 뒤 주요 서비스와 보안 telemetry가 정상인지 read-back한다.

NIST SP 800-61r3는 복구 시 시스템을 정상 운영으로 되돌리고 정상 작동을 확인하며, production에 다시 넣기 전에 침해 지표와 근본 원인을 점검하고 복원 행동의 정확성과 충분성을 검증하라고 권고한다.[5] 격리 해제는 원상 복귀 버튼이 아니라 recovery 검증의 마지막 상태 전이다.

### 3. Rollback success rate

```text
rollback 성공률 = 기한 안에 원래 또는 승인된 안전 상태로 복구된 건수 / rollback 시도 건수
```

모든 행동이 되돌릴 수 있는 것은 아니다. IP block은 rule 삭제로 되돌릴 수 있고 host isolation은 un-isolation이 가능하지만, 파일 삭제와 credential revocation은 원본 복구나 재발급이라는 보상 행동이 필요하다. 그래서 자동화 권한은 “할 수 있는가”가 아니라 “실패했을 때 어떤 보상 행동을 누구 권한으로 수행할 수 있는가”까지 포함해야 한다.

Rollback handle은 실행 전에 준비한다. 기존 firewall rule snapshot, 변경 전 계정 상태, 격리 전 network segment, 삭제 대상 hash와 quarantine 위치를 확보하지 못했다면 해당 action은 Collaborate로 승격한다. Rollback 자체가 실패하면 같은 에이전트가 반복 시도하며 상태를 더 흔들지 말고 사람에게 이관한다.

### 4. Read-back completeness와 state divergence

```text
read-back 완전성 = 목표 상태를 독립 조회로 확인한 action / 실행된 action
state divergence = 요청 상태와 관찰 상태가 불일치한 시간과 건수
```

API 요청이 성공해도 endpoint가 offline이면 격리 정책을 아직 받지 못할 수 있고, 세션 폐기가 일부 identity provider에만 적용될 수 있다. 반대로 timeout 응답 뒤 실제 변경이 완료되면 재시도가 중복 효과를 만들 수 있다. `request_id`와 idempotency key를 사용하고, 제어 plane 응답이 아니라 대상의 effective state를 읽어야 한다.

Read-back query는 response를 실행한 tool과 논리적으로 분리하는 편이 좋다. 같은 adapter가 요청과 확인을 모두 잘못 매핑하면 거짓 성공이 된다. 예를 들어 endpoint isolation API의 job 상태와 endpoint heartbeat의 network state, identity session revoke 응답과 후속 token 사용 실패를 각각 확인한다.

## 운영 정책은 평균이 아니라 예외에서 검증한다

도입 전 평가는 정상적인 phishing·malware 사례만 재생해서는 부족하다. 권한 경계를 공격하는 fixture가 필요하다.

첫째, **증거 충돌**을 넣는다. EDR은 악성으로 분류하지만 change calendar에는 승인된 red-team 활동이 있고, identity log는 정상 위치를 가리키는 사례다. 에이전트가 하나의 강한 signal만으로 Authorize를 선택하는지 본다.

둘째, **자산 오식별**을 넣는다. 같은 hostname이 재사용됐거나 CMDB owner가 오래됐고, IP가 DHCP로 바뀐 상황에서 plan의 target이 evidence의 실제 자산과 같은지 검증한다. Target binding이 약하면 정확한 분석이 엉뚱한 endpoint를 격리한다.

셋째, **부분 실행**을 넣는다. Host 격리는 성공했지만 세션 폐기는 실패하고, IP 차단은 두 방화벽 중 하나에만 반영되는 사례다. 전체 plan을 `resolved`로 닫지 않고 부분 상태와 잔여 위험을 표시해야 한다.

넷째, **통제 plane 지연**을 넣는다. 명령은 수락됐지만 endpoint가 offline이고, 20분 뒤 뒤늦게 격리되는 사례다. 만료된 mandate가 지연 실행되지 않도록 executor가 실행 시점에도 정책과 사건 상태를 다시 확인해야 한다.

다섯째, **잘못된 자동 격리와 복구 실패**를 의도적으로 만든다. 중요 업무 장치를 오탐 격리한 뒤 연락처 부재, un-isolation API 장애, endpoint heartbeat 단절을 순서대로 주입한다. 이 시험에서 보는 값은 탐지 정확도가 아니라 false isolation 감지 시간, safe reopen 시간, rollback 성공 여부, read-back 공백이다.

여섯째, **사건 종결 뒤 재발**을 넣는다. 격리를 해제한 직후 같은 IOC가 재탐지되거나 root cause가 제거되지 않은 상태를 재현한다. 재개방 정책이 단순 timer인지, 복구 조건과 post-reopen observation window를 실제로 확인하는지 드러난다.

## 대시보드도 권한 경계에 맞춰 바꾼다

경영 대시보드에 평균 조사 시간과 자동 종결률만 놓으면 팀은 더 많은 사건을 Authorize로 보내도록 압박받는다. 균형을 위해 속도, 판단, 효과, 복구를 분리한다.

- **조사:** evidence completeness, unsupported conclusion rate, plan 재작성률
- **검토:** Notify→Collaborate 승격률, Collaborate 승인·거부·만료율, 승인 대기 시간
- **대응:** action별 실행 성공률, false isolation rate, state divergence 시간
- **복구:** time to safe reopen, rollback success rate, reopen 후 재격리율
- **권한:** mandate 밖 시도 건수, 만료 권한 거부 건수, excluded asset 접근 시도

이 중 목표를 단일 점수로 합치지 않는 것이 좋다. 조사 시간 89초를 달성하면서 false isolation이 늘 수 있고, 자동 종결률을 높이면서 reopen queue가 길어질 수 있다. 빠른 containment와 빠른 safe reopen도 서로 다른 팀·권한·실패 경로를 가진다.

사건 기록에는 모델의 최종 요약뿐 아니라 evidence bundle ID, plan revision, review verdict, mandate version, action request와 read-back, rollback 결과를 연결한다. 감사자가 “왜 이 장치를 격리했는가”뿐 아니라 “누구의 어떤 위임으로, 당시 어떤 상태를 확인하고, 언제 어떤 조건으로 다시 열었는가”를 재구성할 수 있어야 한다.

## 결론: 89초보다 먼저 정의할 숫자

OpenAI와 Sophos의 사례는 조사 에이전트가 맥락·탐지·IoC·위협 인텔리전스를 모으고 plan–execute–review loop를 거쳐 대응 권고를 만드는 운영 구조를 공개했다.[1] 다만 공개 수치는 표본과 비교 방법이 충분히 제시되지 않은 공급자·고객 보고 결과이므로, 자체 pilot에서는 사건 유형과 권한 모드별로 다시 측정해야 한다.

조사 속도를 실제 방어 효과로 바꾸려면 `evidence → plan → review → response`를 서로 다른 권한 객체로 만들고, Notify·Collaborate·Authorize를 고객 계정의 고정 스위치가 아니라 action class와 자산·사건 조건에 결박된 mandate로 집행해야 한다. 특히 격리, 세션 폐기, 파일 삭제와 정책 변경에는 실행 전 복구 경로, 실행 후 독립 read-back, 실패 시 사람 이관이 필요하다.

가장 먼저 합의할 운영 목표도 평균 89초가 아니다. **잘못된 격리는 얼마나 드문가, 격리된 정상 자산을 안전하게 다시 여는 데 얼마나 걸리는가, rollback은 실제로 성공하는가, 요청한 상태와 관찰한 상태가 얼마나 오래 어긋나는가**다. 조사 자동화율이 높아도 대응 권한은 낮을 수 있고, 그 반대도 가능하다. 좋은 SOC 에이전트는 많이 행동하는 에이전트가 아니라, 증거와 위임 범위 안에서만 행동하고 잘못됐을 때 빠르게 되돌아오는 에이전트다.

## Sources

[1] https://openai.com/index/sophos
[2] https://docs.sophos.com/central/customer/help/en-us/ManageYourProducts/MDR/MDRSettings/MDRThreatResponse/
[3] https://www.cisa.gov/stopransomware/ive-been-hit-ransomware
[4] https://docs.sophos.com/central/customer/help/en-us/ManageYourProducts/MDR/MDRSettings/MDRThreatResponse/MDROpsResponseActions/
[5] https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-61r3.pdf
[6] https://docs.sophos.com/central/customer/help/en-us/PeopleAndDevices/Devices/Computers/DeviceDetailsComputers/
[7] https://www.sophos.com/en-us/legal/mdr-description
