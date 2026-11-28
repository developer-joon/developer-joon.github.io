---
title: 'AI 에이전트에도 DNS와 인증서가 필요한가: Agent Name Service 60초 검증 실험'
date: 2026-11-28 07:45:00 +0900
categories: ["AI"]
description: 'Agent Name Service의 DNS 기반 이름·인증서·공개 로그 경계를 정리하고, 발견과 신원 확인을 권한 부여와 분리하는 60초 검증안을 설계한다.'
featured_image: 'https://picsum.photos/seed/agent-name-service-dns-certificate/1600/900'
tags: [agent-name-service, dns, x509, agent-identity, authentication]
---

![흐린 하늘과 안개 사이로 솟은 고층 건물 꼭대기](https://picsum.photos/seed/agent-name-service-dns-certificate/1600/900)

AI agent가 조직 경계를 넘어 서로를 호출하려면 “어디에 있는가”와 “누구인가”를 함께 풀어야 한다. 그러나 검색 결과에 이름이 나온다는 사실은 그 agent를 신뢰하거나 특정 행동을 허용할 근거가 아니다. discovery, identity verification, authorization과 reputation은 서로 다른 판단이다.

Linux Foundation은 2026년 11월 10일 Agent Name Service(ANS)를 공식 프로젝트로 받아들였다. 발표에 따르면 ANS는 기존 DNS infrastructure를 사용한 domain-anchored naming, 등록과 versioning, DNS publication, public log auditing, integrity monitoring, agent 간 authentication을 일곱 개 specification 문서로 정의하며 11개 조직이 지원한다.[1] 이는 공개 표준 프로젝트의 출범과 초기 생태계 신호이지, 보편 채택이나 완성된 보안 보증은 아니다. 이 글이 검토한 `ans-spec` revision은 commit `0922b3d40b17a4c9a47727cd78f63e27a26c0e6c`다. 해당 revision에서 ANS-0~ANS-6은 모두 `Status: DRAFT v1.0`이고 개별 문서 버전은 0.1.0~0.3.0 범위다.[2][3] 따라서 여기서 “표준”은 안정·확정 규격이 아니라 Linux Foundation 아래 공개된 **draft 표준화 작업**을 뜻한다.

## 이름·발견·인증·권한을 네 단계로 나눈다

ANS를 운영에 넣기 전에 질문을 분리한다.

1. **Naming:** 어떤 domain 아래 어떤 agent 이름과 version을 가리키는가?
2. **Discovery:** endpoint와 검증 material을 어디서 얻는가?
3. **Authentication:** DNS, X.509와 공개 log를 통해 제시된 identity가 맞는가?
4. **Authorization:** 확인된 identity가 이 tenant에서 이 action을 수행해도 되는가?

Linux Foundation 설명은 ANS가 agent 이름과 등록, DNS publication, identity verification과 상호 인증을 위한 framework를 제공한다고 말한다.[1] 그러나 인증 성공은 “이 agent가 주장한 domain과 묶여 있다”는 신호일 뿐이다. 안전한 행동, 최신 보안 상태, 지급 능력, 조직 내부 권한을 자동으로 증명하지 않는다.

GitHub의 Agent Name Service 조직은 reference implementation, specification repository와 Go·Rust·Java SDK 등을 공개하고 있다.[4] organization 소개에는 DNS, X.509와 transparency log를 통한 identity 증명이 언급된다. 구현 repository가 존재한다는 사실과 특정 release가 production-ready라는 판단은 별개다. 실제 도입과 시험에서는 mutable `main`만 가리키지 말고 `ans-spec` commit SHA와 ANS-0~ANS-6 각 문서의 `Version` 값을 함께 고정하며, reference implementation·SDK의 commit 또는 release와 라이선스도 별도로 기록해야 한다.[2]

## DNS는 신뢰를 만들기보다 domain에 고정한다

Domain-anchored identity의 장점은 새 전역 naming authority를 처음부터 만드는 대신 조직이 이미 통제하는 domain을 anchor로 쓸 수 있다는 점이다. 운영자는 DNS record를 게시하고 agent identity와 endpoint, 검증 정보를 연결할 수 있다.[1]

하지만 trust assumption도 그대로 따라온다.

- domain 등록 계정과 DNS provider가 탈취되지 않았는가
- resolver가 DNSSEC 또는 조직이 정한 검증 경로를 올바르게 처리하는가
- stale cache와 낮거나 높은 TTL이 rotation·폐기를 방해하지 않는가
- split-horizon DNS가 외부와 내부에서 다른 identity를 돌려주지 않는가
- wildcard와 동명이 record가 잘못된 agent를 선택하게 하지 않는가

따라서 “DNS에서 찾았다”는 discovery 성공으로만 기록한다. domain control proof, certificate chain, version과 log inclusion을 확인하기 전에는 authenticated 상태로 올리지 않는다.

## 인증서와 공개 로그도 각각 실패할 수 있다

X.509 검증은 chain, hostname 또는 identity binding, 유효 기간, key usage와 신뢰 anchor를 함께 본다. system clock이 틀리거나 intermediate가 누락되면 정상 identity도 실패할 수 있다. 반대로 chain만 유효하고 agent 이름·version binding을 확인하지 않으면 다른 endpoint의 인증서를 잘못 받아들일 수 있다.

공개 transparency log는 발급·등록 이력을 감사하고 무단 변경을 탐지하는 데 도움을 줄 수 있다. Linux Foundation 발표도 public log auditing과 integrity monitoring을 ANS specification 범위에 포함한다.[1] 하지만 log에 있다는 사실은 내용이 선하다는 보증이 아니다. inclusion, append-only 성질, checkpoint freshness와 monitor가 실제로 경보를 냈는지 각각 확인해야 한다.

검증 상태를 한 boolean으로 만들지 않는 편이 좋다.

| 축 | 예시 상태 |
|---|---|
| DNS | found / missing / conflicting / stale |
| certificate | valid / expired / not-yet-valid / chain-error / name-mismatch |
| log | included / absent / stale-checkpoint / proof-error |
| version | current / deprecated / revoked / unknown |
| authorization | allowed / denied / approval-required |

이 상태 이름은 ANS 표준 field가 아니라 조직이 추가하는 내부 운영 schema다. provider record와 섞이지 않게 namespace를 분리한다.

## 제안형 60초 검증 흐름

“60초”는 ANS가 보장하는 protocol SLA가 아니라 이 글에서 제안하는 운영 budget이다. network와 log 상태에 따라 실패할 수 있으며, budget을 넘겼다고 identity가 악성이라는 뜻도 아니다. 목표는 짧은 시간 안에 **확인하지 못하면 호출하지 않는 것**이다.

- **0~10초 — 입력 정규화:** agent name, 기대 domain, 요청한 version과 action을 canonical form으로 만든다. Unicode 혼동 문자와 trailing dot 처리 규칙을 고정한다.
- **10~20초 — DNS 조회:** authoritative answer, record type, TTL과 DNSSEC 검증 결과를 저장한다. 여러 resolver 결과가 충돌하면 중단한다.
- **20~35초 — 인증서 검증:** endpoint가 제시한 chain, identity binding, 유효 기간과 trust anchor를 확인한다. 현재 시각과 검증 library version도 영수증에 남긴다.
- **35~50초 — 공개 log·version 확인:** registration과 version record의 inclusion proof, checkpoint freshness, 폐기 상태를 확인한다.
- **50~60초 — authorization:** 검증된 identity를 조직 policy에 넣어 action, tenant, resource와 시간 범위를 판단한다. 별도 승인이 필요하면 호출하지 않고 대기 상태로 둔다.

각 단계는 앞 단계 성공만으로 뒤 단계 성공을 추정하지 않는다. timeout, network error와 unknown field는 고위험 action에서 deny로 끝낸다. 읽기 전용 public metadata처럼 저위험 요청은 별도 정책을 둘 수 있지만, 그 예외도 명시해야 한다.

## 실패 주입은 happy path보다 중요하다

다음은 reference implementation과 test domain을 준비한 뒤 수행할 **제안형 fixture**다. 아직 실행한 결과가 아니다.

첫째, 정상 record와 인증서, log proof를 가진 agent를 조회해 각 단계의 receipt가 하나의 identity digest로 연결되는지 본다. 둘째, DNS answer를 존재하지 않는 endpoint로 바꾸고 cache가 TTL 뒤 갱신되는지 확인한다. 셋째, 만료·not-yet-valid·name mismatch 인증서를 각각 제공해 certificate 단계에서 멈추는지 본다.

넷째, valid certificate를 유지한 채 log에서 version을 폐기하거나 더 오래된 version을 반환한다. transport TLS 성공을 현재 agent version의 유효성으로 오인하면 안 된다. 다섯째, 같은 표시 이름을 다른 domain에 등록해 UI와 policy가 fully qualified identity를 사용하는지 확인한다.

여섯째, log endpoint timeout과 stale checkpoint를 주입한다. cached proof 사용을 허용한다면 최대 age와 emergency policy를 정하고 audit에 남긴다. 마지막으로 identity 검증은 성공하지만 authorization policy가 거부하는 action을 요청한다. 기대 결과는 인증 성공·권한 거부가 동시에 기록되는 것이다.

## rotation과 폐기는 연결 중에도 일어난다

긴 작업에서는 시작 시점 검증만으로 충분하지 않을 수 있다. certificate가 rotation되고 version이 폐기되거나 domain ownership이 바뀔 수 있다. 세션 수명과 identity proof 수명을 맞추고, 고위험 단계 직전에 freshness를 다시 확인한다.

rotation 계획에는 다음이 필요하다.

- old/new key가 겹치는 허용 기간
- DNS TTL과 resolver cache를 고려한 전파 시간
- log에 새 version을 먼저 올릴지 DNS를 먼저 바꿀지에 대한 순서
- old version의 명시적 deprecated·revoked 상태
- 진행 중 세션을 종료하거나 재인증하는 조건
- rollback 시 이전 key와 record를 다시 허용할 기준

폐기를 DNS record 삭제 하나로 끝내면 negative cache와 stale resolver 때문에 오래된 endpoint가 남을 수 있다. version registry, certificate 상태, public log와 authorization denylist가 같은 사건을 가리키도록 한다.

**출범과 채택 신호도 과장하지 않아야 한다.** Linux Foundation 발표는 AGNTCY Agent Directory Service가 ANS identity 검증을 지원하고, ANS Finder가 Agentic Resource Discovery와 상호운용된다는 초기 사례를 소개한다.[1] 또한 11개 조직의 지원을 밝힌다. 이는 interoperability 작업이 시작됐다는 근거이지 모든 agent platform이 ANS를 채택했다는 증거는 아니다.

도입 보고서에는 ANS-0~ANS-6의 `DRAFT v1.0` 상태, 각 문서의 0.x 버전, 검토한 `ans-spec` commit SHA, reference implementation version, SDK language, license와 시험한 resolver·certificate·log 조합을 기록한다.[2][3] mutable default branch의 현재 모습만 보고 장기 호환을 약속하지 않는다. 보고서와 UI에서 “ANS 표준 준수”라고 뭉뚱그리지 말고 “고정한 공개 draft revision을 대상으로 한 내부 시험”으로 범위를 제한한다. 프로젝트 이름이나 Linux Foundation 거버넌스만으로 보안 심사를 생략하지 않는다.

## 배포 전 판정표

- discovery, authentication, authorization과 reputation을 서로 다른 상태로 둔다.
- DNS answer와 domain control proof를 같은 것으로 취급하지 않는다.
- certificate chain, name binding, validity와 trust anchor를 모두 검사한다.
- log inclusion, checkpoint freshness, version·폐기 상태를 별도로 확인한다.
- 60초를 표준 보장이 아니라 조직의 검증 budget으로 표시한다.
- ANS-0~ANS-6의 draft 상태, 각 0.x 문서 버전과 `ans-spec` commit SHA를 고정한다.[2][3]
- 결과를 확정 표준 적합성 인증이 아니라 고정한 공개 draft revision 대상 시험으로 표시한다.
- timeout과 conflicting answer가 고위험 action에서 fail-closed인지 시험한다.
- fully qualified identity를 사용해 동명이 agent 혼동을 막는다.
- 실제 fixture 실행 전에는 “검증 성공”이나 성능 수치를 만들지 않는다.

ANS는 agent identity 문제를 익숙한 DNS와 인증서 생태계에 연결하려는 공개 draft 표준화 작업이다. 가치가 있으려면 “이름을 찾았다”에서 멈추지 않고 domain, certificate, log, version과 폐기 상태를 짧은 검증 흐름에서 결합해야 한다. 그리고 마지막 결정인 authorization은 여전히 호출 조직의 정책으로 남겨야 한다.

## Sources

[1] https://www.linuxfoundation.org/press/linux-foundation-welcomes-agent-name-service-to-bring-verifiable-identity-and-discovery-to-ai-agents
[2] https://github.com/agentnameservice/ans-spec/tree/0922b3d40b17a4c9a47727cd78f63e27a26c0e6c/spec
[3] https://github.com/agentnameservice/ans-spec/blob/0922b3d40b17a4c9a47727cd78f63e27a26c0e6c/spec/ans-6-agent-authentication.md
[4] https://github.com/agentnameservice
