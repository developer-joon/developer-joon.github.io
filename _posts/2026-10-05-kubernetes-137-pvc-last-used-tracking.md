---
title: 'Kubernetes 1.37 PVC last-used tracking: Unused condition으로 안전한 회수를 검토하는 법'
date: 2026-10-05 09:10:00 +0900
categories: ["개발/인프라"]
description: 'Kubernetes 1.37의 PVC Unused condition과 lastTransitionTime의 한계를 짚고, 관측 연속성·dry-run·소유자·reclaim policy·백업·복구 검증을 결합한 안전한 회수 검토 workflow를 설계한다.'
featured_image: 'https://picsum.photos/seed/kubernetes-137-pvc-last-used-tracking/1600/900'
tags: [kubernetes, pvc, persistentvolume, storage, lifecycle, backup, disaster-recovery]
---

![Kubernetes 1.37 PVC last-used 신호로 안전한 회수를 검토하는 workflow](https://picsum.photos/seed/kubernetes-137-pvc-last-used-tracking/1600/900)

지금 Pod가 참조하지 않는 PVC와 앞으로도 필요 없는 데이터는 전혀 다르다. Kubernetes 1.37에서는 `PersistentVolumeClaimUnusedSinceTime`이 Beta·기본 활성화되고, PVC protection controller가 PVC status의 `Unused` condition을 관리한다.[1][2]

이는 **정리 후보를 찾는 관측 신호**다. 실제 unmount 기록, 마지막 사용자 감사 로그, 자동 삭제기는 아니다. 운영 목표도 자동 삭제가 아니라 후보 탐색부터 복구 검증까지 증거를 연결하는 것이어야 한다.

## `Unused` condition이 정확히 말하는 것

판정 기준은 PVC를 참조하는 **non-terminal Pod 객체의 존재**다. Pod phase가 `Succeeded` 또는 `Failed`가 아니면 non-terminal로 간주한다. 그런 Pod가 하나도 없으면 `type=Unused`, `status=True`, `reason=NoPodsUsingPVC`가 된다. 하나라도 참조하면 `status=False`, `reason=PodUsingPVC`가 된다.[2][3]

이 정의에는 운영상 중요한 비대칭이 있다.

| 상태 | 의미 | 해석할 때 주의할 점 |
|---|---|---|
| `Unused=True` | non-terminal Pod가 PVC를 참조하지 않음 | 데이터 불필요, backend I/O 없음, 비용 0을 뜻하지 않음 |
| `Unused=False` | non-terminal Pod가 하나 이상 PVC를 참조함 | 실제 mount나 I/O 성공을 보장하지 않음 |
| condition 없음 | 판정 정보가 아직 없음 | 미사용으로 간주하면 안 됨 |

v1.37.0 구현은 feature gate가 켜져 있어도 `status.phase=Bound`이고 `deletionTimestamp`가 없는 PVC에만 이 condition을 평가한다.[7] 따라서 `Pending`을 포함한 unbound PVC에 condition이 없는 것은 이 구현에서 예상되는 상태다. 이를 controller 관측 공백으로 분류하거나 `Unused=True`로 보정하면 안 된다.

`Pending` Pod도 PVC를 참조하면 사용 중으로 센다. 반대로 `Succeeded`나 `Failed` Pod는 계산에서 빠진다.[2][3] 이 condition은 mount telemetry가 아니라 API 객체 관계를 해석한 결과다.

`lastTransitionTime`은 `Unused` status가 바뀐 시각이다. `False`에서 `True`가 됐다면 controller가 Pod 참조 부재를 관찰한 시각이지, 실제 마지막 unmount 시각은 아니다. 정상 관측 중 처리 지연으로 표시 기간은 실제보다 짧을 수 있다.[1][2]

새 Pod 참조로 `True`에서 `False`가 되면 같은 필드는 사용 상태로 전환된 시각이다. timestamp만 “마지막 사용 시각”으로 수집하지 말고 `type`, `status`, `reason`과 함께 저장한다.

Kubernetes는 마지막 Pod 이름이나 UID를 기록하지 않으며, 추천·알림·자동 삭제도 KEP 범위 밖이다.[2] 마지막 사용자를 알아야 한다면 별도 audit·workload inventory가 필요하다.

## 1.37 업그레이드 직후에는 나이를 믿지 않는다

v1.36에서는 gate가 Alpha·기본 비활성화였고, v1.37에서는 Beta·기본 활성화다.[1][2] 업그레이드 뒤 처음 생긴 `lastTransitionTime`은 역사적 미사용 시점이 아니라 controller의 첫 관찰 시점일 수 있다.

첫 수집일부터 조치하지 말고 retention window를 온전히 지난다. kube-apiserver와 kube-controller-manager의 gate가 어긋나면 condition이 없거나 갱신되지 않는다.[2]

condition 생성 뒤 gate를 끄면 값은 etcd에 남지만 갱신은 멈춘다. controller 중단, API server·etcd 장애, status update 오류도 같은 공백을 만든다. 그동안 새 Pod가 참조해도 과거 `Unused=True`가 남을 수 있으므로 오래된 timestamp는 안전한 값이 아니다.[2]

따라서 조직 정책은 **관측 연속성**을 별도 운영 증거로 입증해야 한다. 이는 Kubernetes가 PVC별로 제공하는 공식 신호가 아니다. 정책 기간의 kube-controller-manager 가용성·restart·leader 기록, 두 control-plane component의 gate·version, Pod/PVC watch·list와 API 오류·alert, metrics scrape 연속성을 함께 보존한다.

KEP는 `pvc_protection_controller_unused_condition_syncs_total` 추가를 제안하지만 v1.37.0 source에는 등록·증가 코드가 없고, 관련 PR #139954도 merge되지 않았다.[2][7][8] 이 metric을 운영 근거로 가정하지 말고 실제 controller metrics·로그·API 오류를 함께 보되, 어느 하나도 PVC별 연속성을 단독으로 증명하지는 못한다.

정책 기간의 운영 증거가 없거나 어느 하나라도 공백이면 기존 `lastTransitionTime` 기반 정책 시계를 폐기한다. 연속성 복구 뒤 현재 Pod 참조 부재와 condition을 다시 확인한 시각부터 새 retention window를 시작한다. 오래된 timestamp를 고치는 것이 아니라 후보 계산에서 제외하는 것이다. 재활성화 뒤에도 다음 전환 전에는 stale 값이 바로 교정되지 않을 수 있다.[2]

`deletionTimestamp`가 설정된 PVC도 condition 갱신 대상이 아니므로 후보에서 제외한다.[2]

## 안전한 회수 검토는 여덟 단계 pipeline이다

### 1. 후보를 찾되 삭제 queue에 바로 넣지 않는다

첫 필터는 `status.phase=Bound`, `Unused=True`이면서 `lastTransitionTime`이 조직의 retention window보다 오래된 PVC다. 여기에 `deletionTimestamp` 없음, 허용 namespace, 보호 label 부재 같은 조건을 더한다. 결과는 “삭제 대상”이 아니라 “검토 대상” 목록이어야 한다.

namespace/name, PVC UID, condition, PV, StorageClass, 용량, access mode를 함께 고정하고 실행 전에 UID를 대조한다.

### 2. owner와 미래 사용 의도를 확인한다

owner reference, GitOps manifest, Helm release와 namespace 담당자를 교차 확인한다. owner가 없으면 자동 승인하지 말고 미확인 자산으로 분류한다.

StatefulSet은 기본적으로 삭제·scale down 뒤에도 volume을 보존한다.[5] StatefulSet, ordinal, `volumeClaimTemplates`, PVC retention policy와 scale-up 계획을 확인한다.

완료된 Job Pod는 terminal이라 condition을 붙잡지 않지만 재처리나 다음 Cron 실행이 PVC를 다시 사용할 수 있다.[2][6] “현재 실행 종료”와 “데이터 보존 의무 종료”를 분리한다.

### 3. reclaim policy와 실제 삭제 효과를 계산한다

`persistentVolumeReclaimPolicy=Delete`면 지원 plugin에서 PV와 외부 asset이 제거될 수 있다. `Retain`이면 PV와 데이터가 남아 수동 회수가 필요하다.[3]

StorageClass 기본값을 추정하지 말고 바인딩된 PV 값을 읽는다. 검토 뒤 policy가 바뀌면 중단한다.

### 4. snapshot 또는 backup을 만들고 복구 가능성을 확인한다

CSI snapshot은 특정 시점의 volume 내용을 복사해 새 PVC의 source로 쓸 수 있다.[4] 생성 성공만으로 복구나 application consistency는 보장되지 않는다. DB quiesce, 암호화 key, snapshot retention을 확인한다.

backup ID, 원본 PVC UID, 만료일, restore runbook을 기록하고 snapshot이 같은 lifecycle rule로 지워지지 않는지 확인한다.

### 5. 실제 삭제 없이 dry-run을 통과시킨다

dry-run은 삭제 API를 호출하지 않고 읽기 전용 계획서만 만든다. 최소 입력은 다음과 같다.

- namespace/name과 수집 당시 PVC UID
- 현재 `Unused` condition의 `status`, `reason`, `lastTransitionTime`
- retention window 전체의 kube-controller-manager 가용성·restart·leader, gate/config/version, watch/list·API 오류·alert, metrics scrape 연속성 증거
- 해당 PVC를 `pod.spec.volumes`에서 참조하는 모든 non-terminal Pod 목록
- 바인딩된 PV와 현재 `persistentVolumeReclaimPolicy`
- StatefulSet ordinal, 다음 Job·CronJob 실행, DR standby, legal hold, 보호 label 같은 예외 판정
- backup 또는 snapshot ID, restore 검증 상태와 보존 만료일
- 실행한다면 예상되는 결과: `Delete`는 PV와 backend asset 삭제 가능성, `Retain`은 Released PV와 backend asset 존속 및 후속 수동 회수

기술 합격 기준은 UID 일치, 현재 `Unused=True`, 조직 정책으로 입증한 retention window의 관측 공백 없음, non-terminal Pod 참조 0개다. reclaim policy가 계획과 같고 미해결 예외가 0개이며 복구 검증·예상 결과가 change ticket과 일치해야 한다. 모두 충족해도 이 단계의 결과는 삭제 허가가 아닌 `PASS_PENDING_APPROVAL`이다. 불일치하거나 조회할 수 없으면 `FAIL/CANCEL`로 끝낸다.

산출물에는 `would-delete PVC namespace/name (UID=...)`, 예상 PV/backend 상태와 후속 ticket을 기록하되 어떤 변경 명령도 실행하지 않는다.

### 6. 사람이 영향 범위를 보고 승인한다

workload owner와 storage 운영 책임을 분리한다. owner는 5단계의 `PASS_PENDING_APPROVAL` 산출물에서 age, 예외, reclaim policy, backup과 복구 방법, 예상 영향을 확인한 뒤 승인한다.

승인 뒤 삭제 직전에 5단계 dry-run 전체를 다시 실행한다. UID, 현재 condition, Pod 참조, 관측 연속성, reclaim policy, 예외, backup·복구 증거와 예상 결과가 모두 그대로일 때만 `FINAL_PASS`를 발급한다. 하나라도 달라졌거나 조회할 수 없으면 승인을 폐기하고 `FAIL/CANCEL`로 종료하며, `FINAL_PASS` 없이는 7단계로 넘기지 않는다.

### 7. 작은 batch로 삭제하고 backend 결과까지 관측한다

작은 batch로 처리하며 finalizer, PV phase, CSI event, backend 상태를 기록한다. PVC protection은 사용 중 삭제를 지연시킬 뿐 판단을 검증하지 않는다.[3]

`Retain` PV는 후속 수동 회수 ticket으로 연결하고, `Delete` PV는 외부 asset 제거 완료를 확인한다. API에서 PVC가 사라졌다는 사실만으로 storage 비용 제거가 완료됐다고 보고하지 않는다.

### 8. 복구를 실제로 검증한 뒤 종료한다

대표 volume을 새 PVC로 복원해 mount, schema, 핵심 레코드, 권한, 암호화 key와 RTO·RPO를 검증한다.

오삭제 시 새 PVC로 복원하고 원본 UID와 backup lineage를 보존한 채 workload 참조를 전환한다. 복구 시험 전까지는 “복구 미검증” 상태다.

## 자주 놓치는 세 가지 실패 모드

### StatefulSet: scale down을 폐기로 오인한다

scale down된 ordinal PVC도 다음 scale-up에 필요할 수 있다. replica 계획, PVC retention policy와 shard 복귀 절차를 확인한다.[5]

### Job: terminal Pod를 데이터 수명 종료로 오인한다

terminal Job Pod는 계산에서 빠지지만 재처리, 정산, forensic 보존, 다음 Cron 실행은 별도 lifecycle이다.[2][6]

### DR: standby volume을 orphan으로 오인한다

DR PVC는 평상시 `Unused=True`일 수 있다. DR inventory, drill과 다른 failure domain의 대체 copy를 확인한다.

## 결론

`Unused=True`는 controller가 non-terminal Pod 참조 부재를 관찰했다는 뜻일 뿐이다.[1][2] 실제 unmount, 데이터 가치와 삭제 판단은 포함하지 않는다.

condition은 삭제 trigger가 아니라 evidence pipeline의 첫 입력이다. 연속 관측, owner, 미래 사용, reclaim policy, backup, dry-run과 restore 검증을 함께 요구해야 한다.

## Sources

[1] https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release — Kubernetes v1.37: Garhwal
[2] https://github.com/kubernetes/enhancements/blob/7c054aecc6d97bbc386bbc111fc2d68d278b2179/keps/sig-storage/5541-pvc-last-used-time-status-field/README.md — KEP-5541: Report Last Used Time On a PVC (v1.37 Beta update merge commit)
[3] https://kubernetes.io/docs/concepts/storage/persistent-volumes — Persistent Volumes
[4] https://kubernetes.io/docs/concepts/storage/volume-snapshots — Volume Snapshots
[5] https://kubernetes.io/docs/concepts/workloads/controllers/statefulset — StatefulSets
[6] https://kubernetes.io/docs/concepts/workloads/controllers/job — Jobs
[7] https://github.com/kubernetes/kubernetes/blob/f54c212e3a2f75d674b717a9b29052b20b60aefc/pkg/controller/volume/pvcprotection/pvc_protection_controller.go#L252-L275 — Kubernetes v1.37.0 PVC protection controller implementation
[8] https://github.com/kubernetes/kubernetes/pull/139954 — Add metrics for PVC Unused condition sync operations (closed without merge)
