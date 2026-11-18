---
title: 'OpenKruise Agents 0.6으로 유휴 에이전트 비용 줄이기: 자동 일시정지·웜풀·MCP ACL 실험'
date: 2026-11-03 09:00:23 +0900
categories: ["클라우드"]
description: 'OpenKruise Agents v0.6.0의 L4/L7 정책, MCP 도구 ACL, 자격증명 주입, 웜풀과 자동 일시정지를 하나의 보안·FinOps 검증 루프로 정리한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-cncf-blog-openkruise-agents-v0-6-0-leaping-ahead-in-agent-sandbox-security-and-automatio/1600/900'
tags: [kubernetes, openkruise, ai-agent, sandbox, mcp, network-policy, finops, autoscaling]
---

![OpenKruise Agents의 보안 정책과 유휴 비용 제어](https://picsum.photos/seed/news-2026-11-03-cncf-blog-openkruise-agents-v0-6-0-leaping-ahead-in-agent-sandbox-security-and-automatio/1600/900)

OpenKruise Agents v0.6.0은 agent sandbox의 lifecycle과 traffic data plane을 함께 다룬다. 새 `TrafficPolicy`·`SecurityProfile`은 L4 목적지와 L7 요청을 제어하고, MCP `tools/call`의 도구 이름을 화이트리스트로 제한하며, proxy가 Kubernetes Secret의 자격증명을 outbound 요청에 주입할 수 있다.[1] 같은 릴리스는 warm pool autoscaling, idle pause, schedule·traffic 기반 resume, paused fleet upgrade를 제공한다.[1]

보안과 FinOps를 별도 controller로 쪼개지 않고 한 수명주기로 검증할 수 있다는 점이 중요하다. 그러나 “pause했으니 비용이 0” 또는 “proxy가 있으니 우회 불가”라고 쓰면 과장이다. Root나 `NET_ADMIN`·`SYS_ADMIN` 권한이 있는 container는 in-pod ACL을 우회할 수 있어 NetworkPolicy와 host·cloud 방화벽을 함께 써야 한다.[1]

## 정책의 실패 기본값부터 시험한다

`TrafficPolicy`가 Pod를 선택하면 allow rule과 일치하지 않는 egress는 거부된다. DNS Service를 허용하지 않으면 FQDN 규칙도 실패한다. 더 위험한 경계는 peer가 빠진 rule을 compiler가 건너뛴다는 점이다.[1] YAML이 apply됐다는 사실만으로 default deny를 증명할 수 없다.

제안 fixture는 네 가지 요청을 만든다.

1. 허용된 외부 API의 읽기 요청
2. 같은 host의 금지된 쓰기 요청
3. cloud metadata와 사내 도메인 요청
4. 허용 목록에 없는 MCP tool 호출

각 요청은 response와 gateway audit log를 함께 확인한다. L4 deny가 L7까지 도달하지 않는지, `mcpToolPolicy`의 `defaultAction: deny`가 정확한 tool name에 적용되는지 본다. 자격증명 Secret을 회전한 뒤 sandbox를 재시작하지 않고 새 token이 사용되는지도 검증한다.[1]

## 자동 일시정지는 probe의 의미가 전부다

Idle-driven pause는 exec probe가 일정 시간 비활성 상태를 보고할 때 작동한다. 실패하거나 timeout 난 probe는 pause나 wake를 일으키지 않는다.[1] 따라서 probe 오류를 idle로 간주해 사용 중 sandbox를 끄는 경로는 기본 동작이 아니다. 대신 probe 장애가 오래 지속되면 비용이 계속 발생할 수 있으므로 별도 경보가 필요하다.

Wake-on-traffic도 첫 요청의 성공을 보장하지 않는다. 인증되지 않은 요청은 401로 끝나며 wake하지 않고, 인증된 첫 요청이 sandbox를 깨워도 그 요청 자체는 503을 받을 수 있다.[1] Client에는 bounded retry와 phase 확인이 필요하다. 재개 p50·p95·p99, 첫 성공 요청까지 시간, pause 직전 진행 중 작업 손실을 측정한다.

## Warm pool은 평균이 아니라 부족과 유휴를 함께 본다

`PoolAutoscaler`는 available capacity의 watermark와 cron schedule로 `SandboxSet.spec.replicas`를 조정한다. 빠른 scale-up과 느린 scale-down을 위한 서로 다른 stabilization window를 둘 수 있다.[1] 야간 replica를 줄였다는 로그보다 다음 지표가 더 유용하다.

- `warm_available`과 claim 대기 시간
- 시간대별 idle sandbox CPU·memory
- cold start·resume·warm claim의 p95
- schedule miss와 burst 시 요청 실패율
- paused instance upgrade 후 원래 paused 상태 복원 여부

Kubernetes 1.33+에서는 claim 시 in-place resource resize를 사용할 수 있지만, 작은 warm instance를 크게 만드는 시간도 측정해야 한다.[1] 원문이 제시한 Alibaba Cloud ACS Agent Sandbox 기본 배포의 gateway 참조 사양은 replica당 4 vCPU·8 GiB, 기본 3 replicas, replica당 ingress+egress 1.5 Gbit/s이며, 여기서 계산한 93.75 MB/s 상한과 replica당 약 90 MB/s 권장 business traffic은 이론값이다.[1] 이와 별개로 OpenKruise 프로젝트 글은 고객 사례로 MiniMax의 20–40 ms instance provisioning과 분당 최대 15,000 sandboxes 공급, Kimi의 peak 수만 concurrent requests·10만 Pod 규모 backend·분 단위 1,000-node scale-out을 전한다.[1] 전자는 ACS 기본 구성의 사양·이론적 상한이고 후자는 프로젝트가 인용한 고객 보고치다. 어느 쪽도 이 글에서 독립 재현된 결과나 committed service metric이 아니므로, 우리 cluster의 CNI, storage, RuntimeClass, image 크기에서 재측정하기 전에는 SLO로 쓰지 않는다.

## Upgrade와 state 보존 경계

`CheckpointRestore`는 writable root filesystem을 보존하지만 memory와 IP는 유지하지 않으며 business image 변경도 지원하지 않는다.[1] Paused sandbox를 깨워 sidecar를 갱신하고 다시 pause할 수 있지만, 그것이 process memory까지 보존한다는 뜻은 아니다. Upgrade fixture는 filesystem marker, 열린 connection, process state, IP allowlist를 각각 확인해야 한다.

도입 판정은 security와 savings를 함께 닫는다. 금지 요청과 MCP tool이 실제 차단되고, raw credential이 Pod spec·environment·sandbox metadata에 나타나지 않으며, Secret rotation이 무중단 반영돼야 한다. 동시에 pause 이후 compute 감소와 재개 tail latency를 청구 데이터로 확인해야 한다. 한쪽만 통과하면 안전하지만 비싸거나, 저렴하지만 우회 가능한 플랫폼이 된다.

## Sources

[1] https://www.cncf.io/blog/2026/11/03/openkruise-agents-v0-6-0-leaping-ahead-in-agent-sandbox-security-and-automation/
