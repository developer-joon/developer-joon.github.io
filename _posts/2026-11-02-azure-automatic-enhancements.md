---
title: 'AKS Automatic 비용과 운영 책임이 어떻게 바뀌었나: Terraform 배포와 마이그레이션 체크'
date: 2026-11-02 09:00:22 +0900
categories: ["클라우드"]
description: 'AKS Automatic의 관리형 시스템 노드 풀, 전용 Terraform 리소스, SLA와 일방향 마이그레이션을 비용·책임·복구 관점에서 검증한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-azure-automatic-enhancements/1600/900'
tags: [azure, aks, kubernetes, terraform, platform-engineering, finops, sla, gateway-api]
---

![AKS Automatic의 관리 책임과 비용 경계](https://picsum.photos/seed/news-2026-11-02-azure-automatic-enhancements/1600/900)

AKS Automatic의 새 클러스터는 관리형 시스템 노드 풀을 기본 사용한다. Microsoft가 provisioning, patch, upgrade, scaling, node auto-repair를 맡고 시스템 풀 VM 비용과 compute quota는 고객 subscription에 잡히지 않는다.[1] 이 구성은 2026년 6월부터 GA지만 기존 Automatic 클러스터가 이를 채택하는 전환과 Standard에서 Automatic으로 바꾸는 경로는 preview다.[1]

상태를 한 문장으로 합치면 안 된다. **신규 Automatic의 관리형 시스템 노드 풀은 GA이고, 기존 클러스터의 SKU·시스템 풀 전환은 preview이며 되돌릴 수 없다.**[1] 비용 절감 가능성도 “AKS 전체가 무료”라는 뜻이 아니다. 사용자 node pool, storage, load balancer, observability, egress와 add-on 비용은 계속 측정해야 한다.

## Terraform으로 새 클러스터를 먼저 재현한다

AzureRM provider 4.81 이상에는 `azurerm_kubernetes_automatic_cluster` 전용 리소스가 있다.[1] 기존 AzAPI 우회 대신 plan과 state에서 Automatic 계약을 직접 볼 수 있다. 다만 실제 조직에서는 provider lockfile, resource schema, region quota를 고정하고 disposable subscription에서 먼저 적용하는 절차를 제안한다. 이 글은 Terraform을 실행해 성공을 확인한 보고서가 아니다.

검증표에는 최소한 다음을 넣는다.

| 항목 | 확인할 증거 |
|---|---|
| 시스템 구성요소 | 어떤 Pod가 Microsoft 관리 인프라에 있고 어떤 add-on이 사용자 node에 남는지 |
| 비용 | 전환 전 시스템 VM 비용과 전환 후 사용자 compute·네트워크·관측 비용 |
| 기본 정책 | Deployment Safeguards와 baseline Pod Security의 실제 거부 결과 |
| DNS | 새 클러스터의 LocalDNS 기본 상태와 장애 시 fallback |
| Traffic | AKS 1.36 이상 새 Automatic의 Gateway API 기본값과 기존 Ingress 변환 차이 |
| State | Terraform import·plan에서 예상하지 않은 교체가 없는지 |

## SLA는 애플리케이션 SLA가 아니다

가용 영역을 켠 적격 클러스터에는 관리형 시스템 구성요소에 99.9% uptime 약정이 적용된다.[1] Downtime 판정은 적어도 하나의 managed system component에 실행 중인 system Pod가 없는 상태를 기준으로 한다. 이는 사용자 Deployment의 요청 성공률이나 p99 latency 약정이 아니다.[1]

따라서 플랫폼 SLO는 API server, managed system components, 사용자 node와 application을 분리해야 한다. 공급자 credit 조건을 충족해도 고객 요청이 실패할 수 있고, 반대로 application 장애가 system component SLA 위반은 아닐 수 있다. Credit 청구 증거와 incident SLO 증거도 별도로 보관한다.

## 일방향 전환 전에 해야 할 일

Preview migration은 rollback 버튼이 없다.[1] 전환 전에 cluster configuration, node pool, add-on, admission exception, network profile, identity와 route를 export하고 새 Automatic cluster에서 같은 workload를 검증하는 blue/green 경로를 우선 검토한다. In-place가 필요하다면 실패 시 복구가 “원래 SKU로 되돌리기”가 아니라 workload를 다른 cluster로 옮기는 것임을 runbook에 적는다.

관리형 시스템 node가 사라져도 DaemonSet은 사용자 node와 managed system pool 양쪽에 영향을 줄 수 있고, 일부 add-on은 `aks-system-surge` node에서 동작한다.[1] 비용표에서 system node VM 세 줄만 지우고 DaemonSet·surge·observability 자원을 빼먹으면 절감률이 과장된다.

## NGINX 종료와 함께 보되 한 변경으로 묶지 않는다

Microsoft의 ingress-nginx 기반 application routing add-on에 대한 critical security patch 지원은 2026년 11월 종료 예정이다. 새 AKS 1.36+ Automatic은 Gateway API를 기본 사용하지만 기존 Ingress와 annotation은 자동 변환되지 않는다.[1] System pool 전환과 ingress migration을 같은 maintenance window에 넣으면 실패 원인과 rollback 경로가 섞인다.

먼저 동일 traffic fixture를 NGINX와 Gateway API에 병행 배포해 route, TLS, client IP, timeout, rewrite 차이를 확인한다. 그다음 별도 변경으로 managed system pool migration을 수행한다. Automatic이 운영 부담을 줄인다는 주장은 맞지만, 플랫폼 팀의 책임이 사라지는 것은 아니다. 책임은 node patching에서 workload policy, 비용 attribution, migration evidence와 application SLO로 이동한다.

## Sources

[1] https://blog.aks.azure.com/2026/11/02/automatic-enhancements
