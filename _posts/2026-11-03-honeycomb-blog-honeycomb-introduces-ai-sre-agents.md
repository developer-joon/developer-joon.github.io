---
title: '알람이 울리기 전에 움직이는 AI SRE: Honeycomb Team Agents의 증거·기억·권한 경계'
date: 2026-11-03 09:00:02 +0900
categories: ["AI 에이전트"]
description: 'Honeycomb Personal·Team Agents가 trace와 deploy를 근거로 지속적인 SRE 목표를 수행하는 방식을 살펴보고, confirmed·hypothesis·권한 경계를 평가하는 fixture를 제안한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-honeycomb-blog-honeycomb-introduces-ai-sre-agents/1600/900'
tags: [honeycomb, ai-sre, observability, opentelemetry, distributed-tracing, ai-agent, incident-response]
---

![분산 추적 그래프를 살피며 배포를 감시하는 작은 로봇](https://picsum.photos/seed/news-2026-11-03-honeycomb-blog-honeycomb-introduces-ai-sre-agents/1600/900)

SRE 자동화는 알람이 울린 뒤 원인을 요약하는 데서 끝나지 않는다. 배포 직후 regression을 찾고, instrumentation 빈틈을 고치며, 반복되는 reliability debt를 ticket으로 만드는 일은 알람이 없을 때도 계속된다.

Honeycomb는 2026년 11월 3일 Personal Agent와 Team Agents를 early access로 공개했다. Team Agents는 deploy 감시, instrumentation 개선, alert 조사, agent 품질 개선, 지식 문서 유지 같은 목표를 schedule·trigger·SLO에 맞춰 수행한다고 발표했다.[1]

## chat assistant가 아니라 목표 기반 worker다

Personal Agent는 개인의 질문과 조사를 돕고, 추천 action은 사용자가 지시할 때 실행한다. Team Agents는 팀 목표를 background에서 계속 수행하며, 여러 조사에서 얻은 기억을 공유한다.[1]

둘의 차이는 UI보다 실행 주기와 권한에 있다.

| 구분 | Personal Agent | Team Agent |
|---|---|---|
| 시작 | 사용자의 질문 | schedule, trigger, SLO |
| 기억 | 개인 조사 context | 팀의 공유 조사 기억 |
| 산출물 | 설명·추천 | ticket, page, fix draft 등 |
| 권한 | 사용자 지시에 따른 action | 팀이 부여한 범위의 자율 action |

“자율”은 무제한 권한이 아니다. Honeycomb도 팀이 허용한 범위 안에서 ticket을 만들고 responder를 page하거나 fix draft를 만들며, 신뢰를 얻은 만큼 autonomy가 커진다고 설명한다.[1]

## 관찰 데이터가 근거가 되어야 한다

Honeycomb 발표의 중요한 계약은 각 finding을 query, trace, deploy 또는 ticket에 연결하고 confirmed인지 hypothesis인지 표시한다는 것이다.[1]

SRE agent가 “database가 느리다”고 말할 때 필요한 것은 자연어 설명보다 다음 증거다.

```text
finding_id
service_version
time_window
query_link
trace_ids
deploy_id
status: confirmed | hypothesis
counterevidence
proposed_action
```

Query link만 있어도 충분하지 않다. Dashboard가 나중에 바뀌거나 retention이 지나면 결과가 재현되지 않을 수 있다. Query definition, time window, dataset, relevant trace ID를 함께 보관해야 한다.

## shared memory는 정답 창고가 아니다

어제의 incident에서 배운 사실이 오늘도 맞을 수 있지만 service version이나 topology가 바뀌면 오래된 기억이 오히려 오진을 만든다. Shared memory에는 생성 시각과 적용 범위, 근거, expiry가 필요하다.

예를 들어 “checkout latency는 payment provider 때문”이라는 기억은 특정 deploy와 incident에는 맞아도 다음 주 database index regression에는 맞지 않을 수 있다. Agent는 과거 기억을 hypothesis로 불러오고 현재 trace로 다시 확인해야 한다.

권장 상태는 다음과 같다.

```text
memory_state = active | stale | superseded | rejected
scope = service + environment + version range
provenance = investigation + trace/query links
```

## OpenTelemetry demo용 평가 fixture

아래는 **실행하지 않은 평가 설계**다. 실제 production service 대신 OpenTelemetry demo 같은 격리 환경을 사용한다.

### Phase A: 정상 배포

기준 latency와 error rate를 수집한다. Agent가 문제가 없는 상태에서 ticket을 만들거나 page하지 않는지 본다.

### Phase B: latency regression

특정 service에 delay를 주입하고 새 deploy marker를 남긴다. Agent가 deploy 전후를 비교하고 관련 trace를 제시하는지 확인한다.

### Phase C: 잘못된 instrumentation

Span attribute를 누락하거나 parent-child 연결을 끊는다. Agent가 애플리케이션 장애와 telemetry 품질 문제를 구분하는지 본다.

### Phase D: 회복

변경을 되돌린 뒤 finding을 종료하고, 어떤 evidence로 회복을 확인했는지 기록하게 한다.

평가 지표는 다음처럼 둔다.

- Regression 탐지 시간
- 원본 trace/query link 완성률
- confirmed와 hypothesis 오분류율
- false page와 중복 ticket 수
- stale memory 사용 횟수
- 승인 없이 실행한 write action 수

## ticket 작성까지만 허용하는 이유

초기 검증에서는 agent가 ticket과 fix draft는 만들되 code merge, deploy, rollback은 실행하지 못하게 한다. Observability evidence가 정확해도 remediation이 안전하다는 뜻은 아니기 때문이다.

권한을 단계적으로 늘린다.

```text
Level 0: 읽기와 조사
Level 1: ticket·문서·fix 초안
Level 2: 사람 승인 뒤 비파괴 action
Level 3: 제한된 자동 remediation + rollback
```

각 단계의 승격 조건에는 일정 기간의 false positive, evidence 완성률, 승인 우회 여부를 포함한다. Agent가 빠르게 ticket을 만든다는 이유만으로 deploy 권한을 주지 않는다.

## 발표 수치의 경계

Honeycomb 발표에는 응답자의 76%가 AI 생성 코드 증가가 review·monitoring 역량보다 빠르다고 답했고, 65%가 AI rate limit·runaway loop·token spend spike로 production issue를 겪었다는 수치가 나온다.[1]

하지만 발표 당시 Honeycomb는 이를 forthcoming survey라고 소개했다. 모집 방식, 표본 구성, 질문지, 원자료가 공개되기 전에는 시장 전체의 확정 통계로 사용하지 않는 편이 안전하다. 이 수치는 제품 필요성을 설명하는 공급자 자료이지 독립적인 운영 benchmark가 아니다.

## early access가 의미하는 것

Personal·Team Agents는 GA가 아니라 early access다.[1] 기능, 가격, data retention, API, 권한 모델이 바뀔 수 있다. Production 도입 전 확인할 항목은 다음과 같다.

- 어떤 telemetry와 prompt가 모델 provider로 전송되는가
- Team memory를 누가 읽고 지울 수 있는가
- Agent action과 사람 승인을 어떻게 audit하는가
- Query·trace link가 retention 이후에도 유효한가
- Agent 장애가 observability 수집 경로에 영향을 주는가

Agent가 없어도 기존 alert와 query가 계속 작동해야 한다. AI layer를 observability의 단일 실패 지점으로 만들지 않는다.

## 성공 조건은 “먼저 말했다”보다 “근거를 남겼다”다

배포 regression을 사람보다 먼저 발견하는 것은 유용하다. 하지만 원본 trace 없이 결론만 남기거나, hypothesis를 confirmed로 표현하거나, 오래된 기억으로 잘못된 팀을 page하면 자동화 비용이 더 커진다.

Honeycomb Team Agents를 평가할 때는 답변 품질보다 evidence chain을 본다. 어느 deploy와 time window를 비교했는지, 어떤 query와 trace가 결론을 지지하는지, 반대 증거는 무엇인지, agent가 어느 권한에서 멈췄는지를 재구성할 수 있어야 한다. Early access 단계의 올바른 목표는 완전 자율 SRE가 아니라 **증거를 보이며 제한된 action을 수행하는 신뢰 가능한 동료**를 검증하는 것이다.

## Sources

[1] https://www.honeycomb.io/blog/honeycomb-introduces-ai-sre-agents
