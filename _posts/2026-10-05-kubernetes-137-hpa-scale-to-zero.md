---
title: 'Kubernetes 1.37 HPA Scale-to-Zero Beta: 0에서 다시 깨어나는 운영 계약'
date: 2026-10-05 09:10:00 +0900
categories: ["개발/인프라"]
description: 'Kubernetes 1.37 HPA scale-to-zero의 metric 조건과 ScaledToZero 상태를 짚고, metric adapter 장애·stale 0·cold start·flapping·rollback을 운영 관점에서 정리한다.'
featured_image: 'https://picsum.photos/seed/kubernetes-137-hpa-scale-to-zero/1600/900'
tags: [kubernetes, hpa, autoscaling, scale-to-zero, external-metrics, object-metrics, devops]
---

![Kubernetes 1.37 HPA Scale-to-Zero](https://picsum.photos/seed/kubernetes-137-hpa-scale-to-zero/1600/900)

Kubernetes 1.37은 2026년 8월 26일 공개됐고, HPA(HorizontalPodAutoscaler)의 scale-to-zero가 Beta로 승격돼 기본 활성화됐다.[1] 적합한 metric을 쓰는 HPA는 유휴 workload를 0 Pod까지 내렸다가 수요가 돌아오면 다시 올릴 수 있다. 하지만 마지막 Pod가 사라진 뒤에도 wake-up signal은 계속 생성되고 조회돼야 한다. metric producer, adapter, API aggregation, HPA controller 중 하나라도 끊기면 0은 절감 상태가 아니라 깨어나지 못하는 상태가 된다.

## 정확한 API 계약

`HPAScaleToZero` gate는 v1.37에서 Beta이며 기본값이 `true`다.[7] `minReplicas: 0`을 쓰려면 HPA에 **최소 하나의 Object 또는 External metric**이 있어야 한다. CPU·memory 같은 Resource metric만 정의하면 API server가 거부한다.[2][3]

CPU와 memory는 실행 중인 Pod에서 측정하므로 replica가 0이면 관측 대상도 사라진다. 반면 queue depth 같은 External metric이나 별도 Kubernetes object의 Object metric은 worker가 없어도 존재할 수 있다.[2][4] wake-up metric은 worker 밖에서 생성되고, replica 0에서도 남아 있으며, 수요 증가를 제때 반영해야 한다. 적용 전 External Metrics API 등을 직접 조회해 현재 값과 timestamp를 확인한다. manifest 검증 성공은 metric pipeline 검증 성공이 아니다.[2]

## `ScaledToZero`는 0의 소유자를 기록한다

replica 0은 HPA가 idle을 판단해 내린 0일 수도, 운영자가 수동으로 멈춘 0일 수도 있다. 기존의 “target을 0으로 만들면 HPA가 멈춘다”는 동작을 보존하면서 자동 복구를 허용하기 위해 `ScaledToZero` condition이 추가됐다.[2][5]

v1.37 controller는 `currentReplicas > 0`에서 `desiredReplicas == 0`으로 성공적으로 rescale하고, `minReplicas == 0`이며 Object 또는 External metric이 있을 때 `ScaledToZero=True`를 기록한다. 그 밖의 성공적인 rescale에서는 False와 `NotScaledToZero`를 기록한다.[6] 이 reason은 adapter 정상, application ready, SLO 충족을 증명하지 않는다.

`ScaledToZero=True`인 0은 HPA가 만든 상태이므로 metric freshness와 backlog를 계속 감시한다. False이거나 condition이 없는 0은 자동 wake-up이 보장되지 않는다. `ScalingActive=False`와 `FailedGetExternalMetric` 또는 `FailedGetObjectMetric`이 보이면 metric 경로를 복구하거나 수동 capacity를 투입한다.[2][5]

Deployment를 처음부터 `replicas: 0`으로 만들면 HPA가 수행한 1→0 이력과 condition이 없어 자동으로 깨어나지 않는다. 최소 1 replica에서 시작해 HPA가 첫 scale-down을 수행하게 해야 한다.[2][5]

## 0에서도 signal은 살아 있어야 한다

queue consumer는 “queue가 비었는가”만 시험해서는 안 된다. worker가 0일 때 producer가 message를 넣고, broker가 backlog를 계산하고, exporter와 adapter가 Kubernetes metric API로 반환하며, HPA가 값을 읽는 전체 경로를 시험해야 한다.

workload Pod가 자기 queue metric을 export하면 마지막 Pod와 함께 endpoint도 사라질 수 있다. signal은 broker, 별도 collector, load balancer처럼 target 밖에 둔다. HTTP service는 Kubernetes Service가 요청을 버퍼링하지 않으므로 첫 요청을 보존하려면 별도 buffering layer가 필요하다.[2] native HPA가 request activator 역할까지 제공하는 것은 아니다.

## metric 오류와 잘못된 0은 다른 장애다

HPA가 여러 metric을 쓰면 각 metric이 제안한 replica 수 중 최댓값을 선택한다. 일부 metric 조회가 실패했을 때 계산 가능한 다른 metric이 scale-up을 요구하면 scale-up은 진행할 수 있다. 반대로 나머지 metric이 현재 replica 이하만 제안해도, 오류가 하나라도 있으면 controller는 scale-down을 중단한다. 실패한 metric이 실제로는 높은 수요를 가리킬 가능성을 보수적으로 처리하는 fail-safe다.[3][6]

그러나 이 보호는 **조회 오류**에만 작동한다. adapter가 HTTP 성공 응답으로 stale 값이나 잘못 계산한 `0`을 반환하면 controller는 정상 sample로 받아들일 수 있다. 특히 모든 관련 metric이 그 0을 유효 값으로 반환하면 scale-down을 막아 줄 fetch error가 없다. endpoint health만 보지 말고 sample timestamp·갱신 주기·원본 backlog와의 불일치를 감시해야 한다.[2][6]

실패 주입은 세 경우를 구분한다.

1. **명시적 조회 실패:** 1 이상에서 adapter를 끊어 scale-down이 보류되는지 확인한다.
2. **0에서 조회 실패:** `ScaledToZero=True`에서 backlog를 만든 뒤 adapter를 끊어 condition·Event와 수동 scale-up 절차를 확인한다.
3. **성공 응답의 stale/incorrect 0:** adapter는 성공을 반환하지만 값은 0에 고정해, API 가용성 알림이 놓치는 고착을 검증한다.

알림은 `backlog > 0 AND replicas == 0`, sample age 초과, 원본과 adapter 값의 불일치, `ScalingActive=False`를 조합한다. 복구 runbook에는 adapter 복원, target을 1 이상으로 올리기, backlog 처리 확인을 포함한다.

## cold start SLO는 끝까지 측정한다

wake-up은 metric 관측, HPA reconcile, Pod scheduling, application start를 거친다.[2] HPA sync period 기본값은 15초이고, downscale stabilization window 기본값은 5분이다.[3] 여기에 adapter cache, image pull, volume attach, secret 조회, node capacity, readiness 지연이 더해진다.

다음 timestamp를 한 trace로 남긴다.

- backlog가 양수가 된 시점
- Object/External metric에 새 값이 보인 시점
- HPA `desiredReplicas`가 1 이상이 된 시점
- Pod가 Scheduled·Ready가 된 시점
- 첫 item 처리가 시작·완료된 시점

SLO는 Pod 생성 시간이 아니라 backlog 발생부터 첫 유효 처리까지로 잡는다. queue가 cold start 동안 work를 보존하는지, visibility timeout과 retry가 중복 처리를 만드는지도 확인한다.

## 1↔0 flapping의 실제 경계

일반적인 `Value` 기반 Object/External metric에서 1→0 경계는 target threshold 근처가 아니라 **metric 값 0과 양수 사이**다. replica가 1일 때 값이 0이면 계산 결과가 0이 될 수 있고, 0에서 값이 조금이라도 양수가 되면 다시 1 이상을 제안할 수 있다.[8] 따라서 짧은 시간 동안 0과 양수를 오가는 noisy signal이 마지막 Pod의 종료와 재생성을 반복시킨다.

replica가 0일 때 계산은 ready Pod 수와 tolerance를 적용하지 않는다. 작은 양수 값을 tolerance가 흡수해 줄 것이라고 기대하면 안 된다.[8] 이 경계의 완화책은 scale-down tolerance가 아니라 `behavior.scaleDown.stabilizationWindowSeconds`로 최근의 더 높은 recommendation을 유지하고, producer/adapter 쪽에서 debounce·moving window 같은 **signal smoothing**을 적용하는 것이다.[3][6] 다만 smoothing이 실제 수요를 늦게 보이지 않도록 0→Ready 지연과 backlog 최고치를 함께 측정한다.

burst에서는 0→1 성공만 보지 말고 `maxReplicas`, Pod 처리율, backlog 증가율, downstream rate limit을 함께 검증한다. scale behavior와 smoothing을 동시에 바꾸지 말고 한 변수씩 조정해 zero 진입 횟수, replica churn, backlog, 오류율을 비교한다.

## rollout과 rollback

첫 production 적용은 durable queue를 가진 비핵심 consumer 하나로 제한한다. 1 이상에서 autoscaling을 확인하고 HPA가 0까지 내리게 한 뒤 실제 work를 넣어 0→N과 backlog drain을 검증한다. 이어 조회 실패, stale 0, scheduling 지연을 주입한다. 합격 기준은 replica 증가가 아니라 SLO 안의 처리다.

version skew도 확인한다. `kube-apiserver`만 먼저 지원하면 `minReplicas: 0` HPA를 받을 수 있지만, 이전 `kube-controller-manager`는 0을 수동 pause로 해석해 깨우지 못할 수 있다.[5]

rollback 순서는 다음과 같다.

1. HPA의 `minReplicas`를 1 이상으로 바꾼다.
2. 현재 0인 workload를 최소 1 replica로 올린다.
3. metric과 backlog 처리가 정상인지 확인한다.
4. 그 뒤에 feature gate 비활성화나 downgrade를 진행한다.

0인 workload를 둔 채 gate를 끄거나 이전 버전으로 내리면 0에 남을 수 있다.[5] rollback 완료는 모든 대상이 metric에 반응하고 backlog를 처리하는지로 판정한다.

## 결론

HPA scale-to-zero의 운영 계약은 단순하다. 마지막 Pod 밖에 wake-up signal을 두고, `ScaledToZero`로 자동 0과 수동 pause를 구분하며, 조회 실패와 성공 응답의 잘못된 0을 별개로 감시해야 한다. 1↔0 경계에서는 tolerance가 아니라 downscale stabilization과 signal smoothing으로 churn을 줄이고, cold start와 backlog를 end-to-end로 검증한다.

## Sources

[1] https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release — Kubernetes v1.37: Garhwal
[2] https://kubernetes.io/blog/2026/09/02/kubernetes-v1-37-hpa-scale-to-zero-beta — Kubernetes v1.37: Scale Workloads to Zero with HorizontalPodAutoscaler
[3] https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale — Horizontal Pod Autoscaling
[4] https://kubernetes.io/docs/reference/kubernetes-api/autoscaling/horizontal-pod-autoscaler-v2 — HorizontalPodAutoscaler v2 API
[5] https://github.com/kubernetes/enhancements/blob/80b2f0c018465a93f54a2cfa24a09819866e7d0e/keps/sig-autoscaling/2021-scale-from-zero/README.md — KEP-2021: HPA supports scaling to/from zero pods
[6] https://github.com/kubernetes/kubernetes/blob/v1.37.0/pkg/controller/podautoscaler/horizontal.go — Kubernetes v1.37.0 HPA controller
[7] https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates — Kubernetes Feature Gates
[8] https://github.com/kubernetes/kubernetes/blob/v1.37.0/pkg/controller/podautoscaler/replica_calculator.go — Kubernetes v1.37.0 replica calculator
