---
title: 'Kubernetes 1.37 WAS: AI·GPU 워크로드를 그룹으로 스케줄링하기'
date: 2026-09-25 08:50:00 +0900
categories: ["개발/인프라"]
description: 'Workload·PodGroup, gang scheduling, preemption과 DRA를 이용해 AI·GPU 작업을 그룹 단위로 배치하고 전환하는 방법.'
featured_image: 'https://picsum.photos/seed/kubernetes-137-workload-aware-scheduling-ai/1600/900'
tags: [kubernetes, scheduling, gang-scheduling, ai, gpu, dra, podgroup, jobset, lws]
---

![Kubernetes 1.37 Workload-Aware Scheduling](https://picsum.photos/seed/kubernetes-137-workload-aware-scheduling-ai/1600/900)

분산 학습 작업이 GPU 8개를 요구한다고 하자. 기본 Kubernetes scheduler는 Pod를 하나씩 배치하므로 5개는 Running이고 3개는 Pending인 상태가 될 수 있다. 애플리케이션이 8개 rank의 동시 기동을 전제로 한다면 Running인 5개도 유효한 학습을 하지 못한다. 값비싼 GPU를 점유했지만 작업은 진전하지 않는 부분 배치다. 두 작업이 각각 일부 GPU를 잡으면 어느 쪽도 필요한 수를 채우지 못하는 교착에 가까운 상태도 생긴다.

Kubernetes 1.37의 Workload-Aware Scheduling(WAS)은 이 문제를 scheduler 외부의 임시 queue나 admission webhook만으로 우회하지 않고, 여러 Pod를 하나의 scheduling unit으로 다루는 기반을 Kubernetes 안에 넣는다. `Workload`와 `PodGroup`, gang scheduling, workload-aware preemption, PodGroup 단위 DRA `ResourceClaim`이 beta로 올라갔고, 여러 그룹을 다시 묶는 `CompositePodGroup`은 alpha로 처음 도입됐다.[1][2]

그러나 “beta가 됐으니 AI 클러스터에서 바로 기본값으로 켠다”는 결론은 성급하다. beta 기능도 기본 비활성화이고, `CompositePodGroup`, topology-aware scheduling, Job 연계는 여전히 alpha 경계를 가진다.[1][8][12] API 버전도 평면 워크로드와 계층형 워크로드가 동일하지 않으며, 1.36 alpha 매니페스트는 그대로 이식할 수 없다. scheduler 하나만 바꾸는 작업도 아니다. API server, controller manager, scheduler, kubelet과 실제 workload controller가 일관된 기능 집합을 가져야 한다.

이 글은 먼저 Kubernetes 1.37 공식 사실을 정리한 뒤, 그 사실에서 도출한 **저자의 운영 해석**을 별도로 표시한다. 특히 “atomic scheduling”을 “항상 함께 살아 있음”으로 확대 해석하지 않고, shared claim을 “GPU 한 개를 모든 컨테이너가 안전하게 동시 사용”한다는 뜻으로 오해하지 않는 데 초점을 둔다.

## 먼저 결론: 하나의 기능이 아니라 네 층의 계약이다

WAS를 운영할 때는 다음 네 층을 분리해서 보는 편이 안전하다.

1. **의도와 템플릿:** `Workload`가 static scheduling policy와 그룹 구조를 정의한다.
2. **runtime scheduling unit:** `PodGroup`이 한 그룹의 실제 정책과 상태를 가진다. 계층 구조에서는 `CompositePodGroup`이 group-of-groups를 표현한다.
3. **scheduler 동작:** gang scheduling과 workload-aware preemption이 그룹 단위 배치와 선점을 수행한다.
4. **controller 통합:** Job, JobSet, LWS 같은 실제 workload controller가 위 객체를 올바른 순서와 소유 관계로 생성하고 Pod를 연결한다.

`Workload`가 애플리케이션 Pod를 만들거나 재시작하는 controller가 되는 것은 아니다. 공식 문서에서 `Workload`는 장기 보존되는 정적 정책 템플릿이고, runtime 상태는 controller가 만든 `PodGroup`이 가진다.[10] 반대로 `PodGroup`만 존재한다고 Job의 성공·실패나 replica lifecycle이 관리되는 것도 아니다. 실행 수명 주기는 계속 Job·JobSet·LWS가 담당한다.

이 구분을 놓치면 책임이 흐려진다. scheduler 팀은 “PodGroup을 배치했다”고 보고하고, controller 팀은 “Pod를 만들었다”고 보고하지만, 둘 사이 reference와 owner lifecycle이 잘못돼 모든 Pod가 Pending일 수 있다. WAS 도입은 scheduler 옵션 추가가 아니라 controller와 scheduler 사이의 새 계약을 배포하는 일이다.

## Kubernetes 1.37에서 무엇이 beta이고 무엇이 alpha인가

공식 릴리스 글과 feature gate 표를 기준으로 상태를 나누면 다음과 같다.[1][12]

| 기능 | 1.37 단계 | 기본값 | 주요 gate | 주요 구성 요소 |
|---|---|---:|---|---|
| `Workload`·`PodGroup`, PodGroup scheduling, gang scheduling | Beta | OFF | `GenericWorkload` | API server, controller manager, scheduler |
| Workload-Aware Preemption | Beta | OFF | `GenericWorkload`에 통합 | API server, controller manager, scheduler |
| PodGroup shared DRA ResourceClaims | Beta | OFF | `DRAWorkloadResourceClaims` | API server, controller manager, scheduler, kubelet |
| `CompositePodGroup` | Alpha | OFF | `CompositePodGroup`, `GenericWorkload`, `TopologyAwareWorkloadScheduling` | API server, controller manager, scheduler |
| multi-level topology-aware scheduling | Alpha | OFF | `TopologyAwareWorkloadScheduling`, `CompositePodGroup` | API server, scheduler, 일부 controller 경로 |
| PodGroup `preemptionPolicy` | Alpha | OFF | `PodGroupPreemptionPolicy` | API server, scheduler |
| Job의 `.spec.scheduling` 통합 | Alpha | OFF | `WorkloadWithJob` | API server, controller manager의 Job controller |

여기서 가장 중요한 사실은 **beta도 기본 비활성화**라는 점이다. 1.37로 업그레이드했다고 기존 Pod가 자동으로 gang scheduling을 사용하지 않는다. `GenericWorkload=false`인 클러스터의 일반 Pod scheduling은 기존 경로를 유지한다.[1][12]

또 하나는 gate의 범위가 다르다는 점이다. `DRAWorkloadResourceClaims`는 kubelet까지 포함하지만 `GenericWorkload`의 핵심 scheduling 경로는 제어면 구성 요소가 중심이다.[1][6] 하나의 “WAS enabled” boolean으로 인벤토리를 만들면 어느 부분이 실제로 준비됐는지 알 수 없다. 구성 요소별 gate와 API discovery 결과를 별도 필드로 관리해야 한다.

> **저자의 운영 해석:** 첫 rollout의 최소 범위는 `GenericWorkload` 기반의 평면 `PodGroup`이다. shared DRA claim, topology-aware scheduling, `CompositePodGroup`, Job alpha 통합은 각각 별도 변경으로 추가하는 편이 원인 분리와 rollback에 유리하다.

## Workload와 PodGroup: 템플릿과 runtime을 분리한다

Kubernetes 1.37의 핵심 `Workload`와 `PodGroup`은 `scheduling.k8s.io/v1beta1`로 승격됐다.[1] `Workload`는 `podGroupTemplates`에 정책을 보관하고, 실제 workload controller는 그 템플릿을 바탕으로 `PodGroup`을 만든다. Pod는 `spec.schedulingGroup.podGroupName`으로 runtime `PodGroup`을 가리킨다.[8]

개념적 흐름은 다음과 같다.

```text
Job / JobSet / LWS / custom controller
        |
        | creates policy template
        v
Workload (static policy)
        |
        | instantiates runtime group
        v
PodGroup (runtime scheduling unit)
        |
        | referenced by
        v
Pods: spec.schedulingGroup.podGroupName
        |
        v
kube-scheduler: group scheduling cycle
```

평면 분산 작업의 최소 형태는 다음과 같다. 이 예시는 API 관계를 보여주기 위한 축약본이며, 실제 운영에서는 controller가 owner reference와 이름, Pod 연결을 관리하도록 해야 한다.

```yaml
apiVersion: scheduling.k8s.io/v1beta1
kind: Workload
metadata:
  name: trainer-policy
  namespace: ai-training
spec:
  podGroupTemplates:
    - name: workers
      schedulingPolicy:
        gang:
          minCount: 8
      priorityClassName: ai-training-high
      disruptionMode:
        all: {}
---
apiVersion: scheduling.k8s.io/v1beta1
kind: PodGroup
metadata:
  name: trainer-run-20260925-workers
  namespace: ai-training
spec:
  workloadRef:
    workloadName: trainer-policy
    templateName: workers
  schedulingPolicy:
    gang:
      minCount: 8
  priorityClassName: ai-training-high
  disruptionMode:
    all: {}
```

1.36 alpha를 사용했다면 단순히 `apiVersion`만 바꿔서는 안 된다. 1.37 공식 글은 alpha version line에서 `v1alpha2`가 `v1alpha3`로 완전히 대체됐고, preemption 관련 `disruptionMode` 이름도 `PodGroup`에서 `all`, `Pod`에서 `single`로 바뀌었다고 설명한다.[1] beta로 이동하는 core `Workload`·`PodGroup`은 `v1beta1`을 사용해야 한다.

`Workload` spec의 불변성도 rollout에 영향을 준다. 공식 문서는 flat `Workload`의 전체 spec을 생성 후 수정할 수 없는 정적 템플릿으로 설명한다.[10] 따라서 기존 객체를 patch해 정책을 바꾸는 전환보다 새 버전의 policy와 새 runtime group을 만들고 새 실행부터 연결하는 방식이 예측 가능하다.

> **저자의 운영 해석:** `Workload`를 “클러스터 공용 AI 정책”이라는 이름으로 여러 controller가 무제한 공유하지 않는 편이 좋다. 정책 변경과 owner lifecycle, 삭제 책임을 명확히 하려면 controller 또는 workload class별 immutable revision으로 관리하고 이름에 revision을 포함하는 방식이 안전하다.

## gang scheduling이 보장하는 것과 보장하지 않는 것

Gang scheduling은 초기 배치 시 그룹 전체 또는 `minCount`가 요구하는 최소 Pod 수를 함께 수용할 수 있을 때만 bind한다. 충분한 placement를 찾지 못하면 그 scheduling cycle에서 어느 Pod도 bind하지 않고 그룹을 unschedulable queue로 돌려보낸다.[3][4]

1.37에서는 PodGroup 자체가 scheduling queue의 first-class entity가 됐다. 이전처럼 member Pod가 각각 queue에 들어가는 대신 top-level PodGroup이 queueing unit이 되며, 그룹이 같은 backoff와 queueing behavior를 공유한다.[1] 이 변화는 여러 대형 training job이 경쟁할 때 Pod별 queue 순서가 그룹 의도를 훼손하는 문제를 줄이는 기반이다.

동작을 단계로 풀면 다음과 같다.[3][4]

1. Pod가 참조하는 `PodGroup`이 존재해야 한다.
2. 생성된 group member 수가 `minCount`에 도달하기 전에는 active scheduling queue에 진입하지 않는다.
3. scheduler는 그룹의 unscheduled Pod 전체에 대해 placement를 시뮬레이션한다.
4. 이미 scheduled된 member와 새로 feasible한 member를 합쳐 `minCount`를 만족하면 성공한 placement를 bind한다.
5. 만족하지 못하면 이번 cycle에서는 bind하지 않고 재시도를 기다린다.

하지만 이 atomicity는 **초기 scheduling decision의 atomicity**다. 실행 중 node failure, eviction, Pod 삭제, 애플리케이션 crash로 실제 Running 수가 `minCount` 아래로 내려갈 수 있다. 공식 gang scheduling 문서도 초기 placement 이후 runtime count가 threshold 아래로 떨어질 수 있다고 명시한다.[4] `PodGroupInitiallyScheduled=True` 역시 초기 scheduling 결과를 나타낼 뿐, 이후 member failure를 계속 반영하는 availability signal은 아니다.[3]

따라서 “gang이므로 항상 8개 rank가 살아 있다”는 문장은 틀리다. 정확한 표현은 “scheduler가 최초 admission에서 `minCount` 미만을 bind하지 않는다”에 가깝다. 실행 중 membership과 collective health는 Job controller, training operator, 애플리케이션 health check와 별도 controller가 계속 관리해야 한다.

> **저자의 운영 해석:** 분산 학습에서 `minCount`를 전체 replica 수보다 낮추는 elastic policy는 자원 활용률을 높일 수 있지만, framework가 실제로 world size 변경을 안전하게 처리할 때만 사용해야 한다. scheduler가 6/8을 허용한다는 사실은 NCCL·MPI·training framework가 6개 rank로 올바르게 수렴한다는 뜻이 아니다.

## Workload-Aware Preemption: 빈 공간을 만드는 단위도 그룹으로 바뀐다

Pod 단위 preemption은 고우선순위 training gang을 위해 여러 node에서 충분한 공간을 만들어야 하는 상황에 약하다. 낮은 우선순위 Pod 몇 개를 내보냈지만 전체 gang이 들어갈 만큼 공간이 되지 않으면, 피해는 발생했는데 고우선순위 workload도 시작하지 못한다.

Workload-Aware Preemption(WAP)은 pending `PodGroup`을 하나의 preemptor로 보고 cluster 전체에서 victim set을 찾는다. PodGroup을 victim으로 볼 때 priority, workload type, group size, start time과 disruption mode를 고려한다.[5] 1.37에서는 별도 `WorkloadAwarePreemption` gate가 `GenericWorkload`에 합쳐져 gang scheduling의 핵심 일부로 함께 beta가 됐다.[1]

1.37의 주요 변화는 다음과 같다.

- preemptor placement를 찾기 위해 potential victim 전체를 제거한 상태를 시뮬레이션한 뒤, 가능한 victim을 되살리는 reprieve 과정을 수행한다.[1]
- 1.36에서 victim 하나를 reprieve할 때마다 preemptor scheduling을 다시 실행하던 방식을 줄여, 1.37은 preemptor placement를 한 번 계산한 뒤 그 placement를 가정하고 victim reprieve 가능성을 본다.[1]
- 일반 single Pod preemption도 victim Pod가 속한 PodGroup의 `disruptionMode`를 존중하도록 개선됐다.[1]
- `disruptionMode` 값은 beta 정리 과정에서 `all`과 `single`로 변경됐다.[1]
- `PodGroupPreemptionPolicy` alpha gate를 켜면 PodGroup의 `preemptionPolicy`가 그룹이 preemption을 수행할 수 있는지 결정하는 authoritative field가 된다.[1][12]

`disruptionMode: all`은 그룹을 함께 희생시키는 fate-sharing 의도를 나타낸다. 반대로 `single`은 member 일부를 개별 victim으로 취급할 수 있다. 이 선택은 단순 안정성 옵션이 아니다. `all`은 분산 작업의 무의미한 부분 실행을 줄일 수 있지만, 작은 capacity gap 때문에 큰 저우선순위 gang 전체가 중단될 수 있다. `single`은 피해량을 줄일 수 있지만, victim 애플리케이션이 부분 member 손실을 감당하지 못하면 실제 진전 없이 GPU만 남겨 둘 수 있다.

### AI/GPU 클러스터에서의 preemption 비용

GPU 작업의 victim cost는 Pod 종료 수보다 크다.

- 마지막 checkpoint 이후의 학습량이 사라질 수 있다.
- GPU memory와 device state 정리에 시간이 걸린다.
- 공유 filesystem으로 checkpoint가 몰리면 storage burst가 생긴다.
- 재기동 후 dataset cache와 model weight를 다시 읽어야 한다.
- multi-node collective가 한 member 손실로 전체를 멈출 수 있다.
- preemptor가 요구하는 GPU model·MIG profile·NIC topology가 victim이 비운 자원과 맞지 않을 수 있다.

> **저자의 운영 해석:** PriorityClass는 비즈니스 중요도만 담지 말고 checkpoint 비용과 예상 실행 시간까지 포함한 제한된 tier로 설계하는 편이 좋다. 임의 namespace가 최고 priority를 사용하면 그룹 단위 preemption의 피해 규모도 커진다. ResourceQuota와 admission policy로 priority 사용 권한을 통제하고, 실제 victim GPU-hours와 preemptor start success를 함께 측정해야 한다.

preemption 성공률은 “몇 개 Pod를 evict했는가”가 아니라 “그 결과 preemptor gang이 실제로 Running과 application-ready 상태에 도달했는가”로 측정해야 한다. victim만 사라지고 preemptor가 topology나 DRA 조건 때문에 계속 Pending이면 WAP는 목적을 달성하지 못한 것이다.

## shared DRA ResourceClaims: Pod별 예약을 PodGroup 예약으로 바꾼다

`DRAWorkloadResourceClaims`는 1.37에서 beta가 됐지만 기본값은 `false`다.[12] 이 기능을 켜면 `PodGroup.spec.resourceClaims`가 기존 `ResourceClaim`을 참조하거나 `ResourceClaimTemplate`에서 그룹당 하나의 claim을 만들 수 있다. member Pod가 이름과 claim/template reference를 일치시키면 scheduler는 Pod가 아니라 PodGroup을 `status.reservedFor`에 기록하고, 그룹의 Pod들이 그 claim을 공유한다.[6]

이 모델은 두 가지 운영 문제를 줄인다.[6]

1. 한 `ResourceClaim.status.reservedFor`에 개별 Pod를 기록할 때의 256개 한계를 PodGroup reference로 우회한다.
2. 복제되는 그룹마다 shared claim을 생성·삭제하는 로직을 JobSet이나 LWS 같은 controller가 각각 다시 구현하지 않아도 된다.

축약된 관계는 다음과 같다.

```yaml
apiVersion: scheduling.k8s.io/v1beta1
kind: PodGroup
metadata:
  name: inference-replica-0
  namespace: ai-serving
spec:
  schedulingPolicy:
    gang:
      minCount: 2
  resourceClaims:
    - name: shared-accelerator
      resourceClaimTemplateName: accelerator-template
---
apiVersion: v1
kind: Pod
metadata:
  name: inference-leader-0
  namespace: ai-serving
spec:
  schedulingGroup:
    podGroupName: inference-replica-0
  resourceClaims:
    - name: shared-accelerator
      resourceClaimTemplateName: accelerator-template
```

Pod와 PodGroup의 `name`, `resourceClaimName` 또는 `resourceClaimTemplateName`이 일치해야 group reservation으로 처리된다. 하나라도 맞지 않으면 Pod 단위 claim 경로로 갈 수 있으므로 template rendering과 실제 저장 객체를 비교해야 한다.[6]

여기서 “shared”를 장치의 동시 접근 안전성으로 오해하면 안 된다. Kubernetes가 claim lifecycle과 reservation을 PodGroup 단위로 표현할 수 있다는 뜻이지, 모든 GPU와 driver가 여러 container의 동시 사용을 안전하게 제공한다는 보장은 아니다. 장치의 shareability, CDI injection, driver semantics, MIG 또는 time-slicing 정책은 해당 DRA driver와 hardware 운영 모델에서 확인해야 한다.

### gate를 끌 때의 1.37 실패 방식

1.37에는 중요한 안전 변경이 있다. Pod가 PodGroup claim과 일치하는 `ResourceClaimTemplate`을 참조하지만 `DRAWorkloadResourceClaims`가 비활성화된 경우, 예전처럼 Pod마다 claim을 대량 생성하지 않고 **아무 claim도 생성하지 않는다**.[1][6] group용 template가 Pod별로 복제돼 DRA 자원을 소진하는 상황을 피하기 위한 동작이다.

이 선택은 resource flood를 막지만 workload 가용성에는 fail-closed로 나타난다. mixed gate rollout이나 rollback 중 claim이 생기지 않아 Pod가 Pending에 머물 수 있다. 따라서 “gate OFF면 기존 per-Pod 동작으로 자연스럽게 fallback한다”는 전제로 rollback을 설계하면 안 된다.

또한 generated claim은 PodGroup lifecycle을 따른다. member Pod가 0개가 돼도 PodGroup이 남아 있으면 reservation과 allocation이 지속될 수 있고, PodGroup이 삭제되고 claim이 더는 reserved되지 않아야 generated claim이 제거된다.[6] 유령 PodGroup은 곧 유령 GPU reservation이 될 수 있다.

> **저자의 운영 해석:** shared claim canary에는 Pod 종료뿐 아니라 PodGroup 삭제, controller crash, finalizer 정체, namespace 삭제까지 포함해야 한다. 관측 지표는 Pod 수가 아니라 claim age, `reservedFor` 대상, PodGroup owner, allocated device와 실제 consumer 수의 불일치여야 한다.

## CompositePodGroup: gang of gangs를 표현한다

평면 `PodGroup` 하나로 충분한 workload가 많다. 단일 Job의 8개 동일 worker가 대표적이다. 그러나 JobSet이나 LeaderWorkerSet(LWS)은 여러 하위 그룹으로 구성된다. 예를 들어 data loader 그룹은 부분 실행이 가능하지만 trainer 그룹은 8개가 함께 필요할 수 있고, 전체는 같은 zone에 있으면서 각 replica의 leader와 worker는 같은 rack에 있어야 할 수 있다.

`CompositePodGroup`은 이런 group-of-groups를 tree로 표현하는 1.37 alpha API다. non-leaf에는 `CompositePodGroup`, 실제 Pod를 담는 leaf에는 `PodGroup`이 놓인다. parent의 gang policy는 `minGroupCount`, leaf의 gang policy는 `minCount`를 사용한다.[1][11]

```text
CompositePodGroup: training-run (minGroupCount: 2)
├── PodGroup: driver  (minCount: 1)
└── CompositePodGroup: trainers
    ├── PodGroup: rack-a workers (minCount: 4)
    └── PodGroup: rack-b workers (minCount: 4)
```

scheduler는 root에서 leaf로 hierarchy를 재귀 평가하고, root 정책을 만족하는 child group 조합을 찾았을 때 hierarchy의 Pod를 unified scheduling unit으로 처리한다.[3] topology-aware scheduling을 함께 쓰면 parent가 zone을 고른 뒤 child는 그 zone 안에서 rack domain을 고르는 top-down 제약이 가능하다.[9]

이 기능이 JobSet과 LWS에 중요한 이유는 workload 구조를 평평하게 펴면서 의미를 잃지 않아도 되기 때문이다. JobSet의 여러 replicated Job, LWS의 여러 leader-worker replica가 서로 다른 leaf policy를 가지면서 상위 수준에서 함께 admission되거나 같은 topology boundary를 공유할 수 있다.[1][2]

하지만 1.37의 `CompositePodGroup`은 alpha이고 status에도 한계가 있다. API schema에는 status subresource가 있지만 scheduler가 1.37에서 `CompositePodGroup.status.conditions`를 채우지 않는다.[3][11] 따라서 parent condition만 보고 hierarchy의 progress를 판단하는 운영 도구는 동작하지 않는다. leaf PodGroup condition, Pod event, controller status를 조합해야 한다.

또한 topology constraint를 강하게 할수록 가능한 placement가 급격히 줄어든다. 전체 job을 한 zone에, 각 group을 한 rack에, GPU와 RDMA NIC를 같은 topology에 맞추는 요구는 통신 성능을 높일 수 있지만 admission latency와 fragmentation을 키운다. 큰 gang이 최적 domain을 기다리는 동안 작은 작업이 뒤로 밀리거나, autoscaler가 총 GPU 수는 늘렸지만 올바른 domain에 capacity를 만들지 못할 수 있다.

> **저자의 운영 해석:** CompositePodGroup은 flat PodGroup으로 표현할 수 없는 실제 계층이 있을 때만 사용한다. “미래를 대비한 추상화”로 모든 Job을 tree로 감싸면 alpha API, status 공백, controller 복잡도만 늘어난다.

## Job, JobSet, LWS는 같은 통합 수준이 아니다

WAS API가 존재한다고 모든 workload controller가 자동으로 이를 생성하는 것은 아니다. controller가 `Workload`와 runtime group을 만들고, owner reference를 연결하고, Pod의 `schedulingGroup`을 설정해야 한다.

### Job: built-in reference integration이지만 alpha

Kubernetes 1.37의 Job controller는 `WorkloadWithJob` gate 아래 `.spec.scheduling`을 `Workload`와 `PodGroup`으로 compile한다. `schedulingPolicy`, topology constraint, disruption mode, resource claims를 표현할 수 있다.[8] gang의 `minCount`를 생략하면 Job `parallelism`이 기본값이 된다.[8]

`.spec.scheduling`을 생략하면 기존 Pod-by-Pod 결과를 보존하는 `Basic` policy가 적용된다. 다만 gate가 켜진 eligible Job에는 Basic이어도 Workload와 PodGroup이 생성된다.[8] 즉 “gang을 요청하지 않았으니 API object 증가가 없다”는 가정은 틀릴 수 있다. API object count와 controller reconcile 부하를 capacity test에 포함해야 한다.

Job scheduling field 대부분은 생성 후 immutable이고, 예외적으로 gang `minCount`는 elastic scaling을 위해 바꿀 수 있다.[8] Job 하나는 1.37 alpha 통합에서 하나의 PodGroup에 매핑된다.[8] 여러 역할과 서로 다른 scheduling policy가 필요한 작업은 Job 하나보다 상위 controller가 더 자연스럽다.

### JobSet: parent가 hierarchy ownership을 결정해야 한다

JobSet은 여러 Job을 만드는 상위 controller다. parent가 Workload를 compile하고 child Job controller에 runtime PodGroup 생성을 위임할 수도 있고, parent가 Workload와 모든 PodGroup·CompositePodGroup lifecycle을 중앙에서 소유할 수도 있다. 공식 1.37 controller integration 설명은 표준 building block과 `workloadbuilder`를 제공하지만, 각 controller가 자신의 API 구조와 ownership 모델을 선택하도록 한다.[1][7]

Job 문서는 parent가 `scheduling.k8s.io/group-template-name` annotation을 child Job에 넣으면 Job controller가 parent template에 대응하는 PodGroup을 만들 수 있고, 그렇지 않으면 parent가 두 객체를 모두 관리하는 경로를 설명한다.[8] Pod template에 이미 `spec.schedulingGroup`이 있으면 Job controller가 객체 생성을 건너뛰는 opt-out도 있다.[8]

이 flexibility는 통합 가능성을 높이지만 duplicate ownership 위험을 만든다. parent와 child가 동시에 같은 runtime group을 만들거나, 둘 다 상대가 만든다고 가정해 아무도 만들지 않을 수 있다. ownership mode는 controller version과 함께 명시하고 integration test로 고정해야 한다.

### LWS: replica-local gang과 전체 fleet gang을 구분한다

LWS에서는 leader와 worker 한 세트가 하나의 atomic unit일 수 있지만, 모든 replica가 동시에 시작할 필요는 없을 수 있다. 이 경우 replica마다 flat PodGroup을 만들고 각 leader-worker set만 gang으로 묶는 편이 효율적이다. 반대로 disaggregated inference가 여러 역할의 동시 준비를 요구하면 상위 CompositePodGroup이 필요할 수 있다.

전체 LWS를 하나의 거대한 gang으로 만들면 consistency는 단순해지지만, 한 replica를 위한 작은 capacity 부족도 전체 rollout을 막는다. replica-local gang은 availability와 incremental scale-out에 유리하지만 global barrier가 필요한 애플리케이션에는 부족하다.

> **저자의 운영 해석:** JobSet·LWS 연계에서 첫 질문은 “WAS를 지원하는가”가 아니라 “scheduling unit과 failure unit이 어디인가”다. application barrier, checkpoint boundary, serving replica의 독립성에 맞춰 leaf와 parent boundary를 정해야 한다.

## workloadbuilder가 해결하는 것과 해결하지 않는 것

1.37은 controller 작성자가 공통 scheduling building block을 자신의 API에 embed하고, `workloadbuilder` Go library로 scheduler-facing object를 생성하는 경로를 제공한다.[1][7] library는 `k8s.io/component-helpers/scheduling/schedulingv1/workloadbuilder`에 있으며 defaulting, validation, Workload compile, PodGroup 생성 로직을 공유한다.[7]

building block은 leaf용 `WorkloadPodGroup...` type과 composite용 `WorkloadCompositePodGroup...` type으로 나뉜다. controller는 자신에게 자연스러운 field 이름과 nesting을 선택하되, policy·topology·disruption·resource claim의 공통 shape를 재사용할 수 있다.[1][7]

이 라이브러리는 controller마다 서로 다른 validation과 object 생성 로직을 다시 만드는 문제를 줄인다. 그러나 다음을 자동으로 결정하지는 않는다.

- 사용자 API에서 어떤 default를 제공할지
- parent와 child 중 누가 runtime group을 소유할지
- application-level readiness와 failure를 어떻게 판단할지
- orphan group과 claim을 어떻게 복구할지
- controller upgrade 중 old/new object를 어떻게 전환할지
- cluster별 fairness, quota, admission 정책을 어떻게 설계할지

또한 building block은 `scheduling.k8s.io/v1alpha3`이고 library가 core `Workload`·`PodGroup` v1beta1로 compile하며, `CompositePodGroup`은 v1alpha3에 남는다.[7] controller CRD가 alpha building block type을 embed했다면 Kubernetes minor upgrade뿐 아니라 vendored library와 CRD schema의 전환도 함께 관리해야 한다.

## AI/GPU 운영의 핵심 트레이드오프

### 1. utilization과 time-to-start

Gang scheduling은 쓸모없는 부분 배치를 막아 GPU-hours 낭비를 줄일 수 있다. 반면 큰 contiguous capacity를 기다리므로 queue time은 늘 수 있다. 작은 작업을 자주 흘려보내는 것이 중요한 shared cluster에서는 엄격한 all-or-nothing gang이 전체 throughput을 낮출 수도 있다.

측정해야 할 값은 단순 GPU utilization이 아니다.

- 제출부터 gang admission까지의 p50/p95 시간
- Running Pod 중 application barrier를 넘지 못한 비율
- Pending gang 때문에 비어 있는 GPU와 부분 배치로 묶인 GPU 시간
- job completion throughput과 checkpoint recovery 시간
- topology별 fragmentation과 autoscaler scale-up 성공률

### 2. topology quality와 schedulability

같은 zone·rack·fabric에 배치하면 collective communication 성능을 높일 수 있다. 그러나 강한 topology constraint는 scheduler 후보를 줄인다. 성능 향상과 admission delay를 함께 benchmark해야 하며, “같은 rack”이 실제 network topology를 정확히 나타내는 node label인지도 검증해야 한다.

label이 stale하거나 autoscaler가 올바른 domain label을 늦게 붙이면 scheduler는 자원이 있어도 placement를 찾지 못할 수 있다. topology label은 단순 metadata가 아니라 scheduling correctness의 일부가 된다.

### 3. preemption responsiveness와 wasted work

높은 priority job을 빠르게 시작시키려면 victim을 넓게 선택할 수 있어야 한다. 하지만 checkpoint 주기가 긴 training job을 반복해서 preempt하면 cluster throughput이 떨어진다. group-level `all`은 application consistency를 지키는 대신 피해를 크게 만들 수 있다.

preemption budget, minimum run time, checkpoint freshness는 Kubernetes WAP가 직접 보장하는 계약이 아니다. queue controller나 admission 정책, workload controller 수준의 보완이 필요하다.

### 4. shared device lifecycle과 blast radius

PodGroup shared claim은 여러 Pod가 하나의 allocation lifecycle을 공유하게 해 object 수와 256 reservation limit 문제를 줄인다.[6] 반면 claim 또는 driver 준비가 실패하면 그룹 전체가 막힐 수 있고, PodGroup cleanup이 정체되면 비싼 device가 계속 예약된다. per-Pod failure isolation과 group-level lifecycle 단순화 사이의 교환이다.

### 5. native API와 생태계 scheduler 공존

이미 Kueue, Volcano 또는 custom scheduler를 쓰는 클러스터라면 native WAS를 곧바로 병행해서는 안 된다. admission, queueing, gang semantics, preemption ownership이 겹칠 수 있다. 어느 계층이 admission을 하고 어느 scheduler가 bind하는지 단일 책임을 정해야 한다.

> **저자의 운영 해석:** 기존 queueing system을 제거하는 마이그레이션은 WAS feature enablement와 별도 프로젝트로 다룬다. 먼저 기존 queue가 admission한 일부 workload의 실제 placement만 native PodGroup으로 시험하고, fairness·quota·cohort 기능의 대체 여부를 확인한 뒤 ownership을 옮기는 편이 안전하다.

## 버전 전환 전략: 1.36 alpha를 제자리 변환하지 않는다

1.36 alpha 사용자는 세 가지 변화를 함께 다뤄야 한다.

1. core `Workload`·`PodGroup`의 목표 API가 `scheduling.k8s.io/v1beta1`이 된다.[1][10]
2. alpha line은 `v1alpha2`에서 breaking change가 있는 `v1alpha3`로 교체됐고 disruption mode 이름이 달라졌다.[1]
3. `WorkloadAwarePreemption` 별도 gate가 사라지고 `GenericWorkload`에 합쳐졌다.[1][10]

안전한 전환은 in-place patch보다 새 실행 세대에서 dual-read 또는 recreate하는 방식이다.

### 권장 전환 순서

1. **inventory:** 저장된 `Workload`, `PodGroup`, Pod `schedulingGroup`, controller version, API version, gate를 수집한다.
2. **정지점 정의:** 장시간 실행 중인 alpha gang을 업그레이드 중 유지할지, checkpoint 후 종료하고 새 beta object로 재제출할지 결정한다.
3. **controller 선검증:** 새 controller가 v1beta1 object와 새 field name을 생성하는지 staging에서 확인한다.
4. **API discovery 확인:** target patch의 served/storage version과 feature gate 상태를 실제 cluster에서 읽는다.
5. **새 workload canary:** 기존 alpha object를 변환하지 말고 새 beta Workload·PodGroup으로 canary job을 제출한다.
6. **old writer 차단:** old controller가 v1alpha2 object를 다시 만들지 못하게 leader election과 deployment 순서를 관리한다.
7. **drain and cleanup:** old run이 끝난 뒤 alpha object와 orphan claim을 정리한다.
8. **복구 경로 유지:** beta canary 실패 시 gate만 끄지 말고 검증된 기존 scheduler/controller 경로로 새 제출을 되돌린다.

공식 페이지 사이에 transitional 표기가 일시적으로 다를 수 있다는 점도 주의해야 한다. 1.37 WAS 릴리스 글은 core API의 v1beta1 승격을 설명하지만, 일부 PodGroup·preemption 개념 페이지에는 1.36 alpha와 `v1alpha2` 문구가 남아 있는 상태가 관찰된다.[1][5] hierarchical 예시에서도 Workload와 leaf PodGroup의 version 표기가 페이지별로 다를 수 있다.[11]

따라서 문서 예제를 그대로 production manifest로 복사하지 말고 다음을 실제 target patch에서 확인해야 한다.

```bash
kubectl api-resources --api-group=scheduling.k8s.io
kubectl api-versions | grep '^scheduling.k8s.io/'
kubectl explain workload --api-version=scheduling.k8s.io/v1beta1
kubectl explain podgroup --api-version=scheduling.k8s.io/v1beta1
```

> **저자의 운영 해석:** 공식 릴리스 글을 feature intent의 기준으로 삼되, apply 가능한 schema의 최종 기준은 target cluster의 discovery와 OpenAPI다. 문서 페이지의 version 표기가 충돌하면 “더 새로 보이는 예제”를 추측으로 선택하지 않는다.

## 단계적 rollout: 한 번에 하나의 불확실성만 추가한다

### 0단계: 목적과 성공 기준을 수치화한다

“AI scheduling 개선” 대신 다음처럼 좁은 목표를 정한다.

- 8-GPU training job의 partial-allocation GPU-hours를 80% 줄인다.
- gang admission p95를 기존 queue 대비 허용 범위 안에 유지한다.
- preemption 후 preemptor application-ready 성공률을 측정한다.
- orphan PodGroup과 orphan shared claim을 0으로 유지한다.

기준선에는 workload 크기, GPU type, topology, queue time, runtime, checkpoint interval을 포함한다.

### 1단계: control plane에서 API와 gate를 검증한다

별도 staging cluster 또는 canary control plane에서 `GenericWorkload`를 API server, controller manager, scheduler에 일관되게 켠다.[1] served API와 validation을 확인하고, gate가 꺼진 component가 없는지 process args와 config를 수집한다.

이 단계에서는 DRA, CPG, TAS, Job alpha gate를 아직 켜지 않는다. 수동 또는 전용 canary controller가 만드는 flat v1beta1 Workload·PodGroup만 시험한다.

### 2단계: CPU-only flat gang으로 lifecycle을 검증한다

비싼 GPU 전에 CPU-only Job으로 다음을 확인한다.

- Workload → PodGroup → Pod 생성 순서
- owner reference와 삭제 순서
- `minCount` 미달 시 bind되지 않는지
- capacity를 추가하면 재queue되고 함께 bind되는지
- PodGroup condition과 scheduler event가 관측되는지
- controller restart 뒤 duplicate group이 생기지 않는지

### 3단계: 소규모 GPU gang을 추가한다

동일 GPU type을 요구하는 2~4 Pod gang으로 확대한다. 실제 application barrier, NCCL initialization, device allocation, cleanup까지 본다. Pod가 Running인 시점과 training이 첫 step을 완료한 시점을 분리해 기록한다.

### 4단계: workload-aware preemption을 fault injection한다

낮은 priority canary를 먼저 실행한 뒤 높은 priority gang을 제출한다. victim 선정, 종료 시간, checkpoint 결과, preemptor admission, victim 재queue를 끝까지 추적한다. “eviction event가 발생했다”에서 시험을 끝내지 않는다.

### 5단계: shared DRA claim을 별도 rollout한다

모든 관련 component와 kubelet에 `DRAWorkloadResourceClaims`를 일관되게 적용한다.[1][6] PodGroup claim과 Pod claim의 matching을 검사하고, group delete 시 generated claim이 회수되는지 확인한다. gate를 일부 component에서 끈 mixed-state fault도 시험해 per-Pod claim flood 대신 no-claim Pending으로 나타나는지 확인한다.

### 6단계: Job `.spec.scheduling`을 제한된 namespace에 적용한다

`WorkloadWithJob`은 alpha이므로 일반 Job 전체에 즉시 노출하지 않는다.[8] admission policy와 namespace allow-list로 canary를 제한한다. scheduling field를 생략한 Basic Job에도 object가 생성되는지와 API object 증가량을 측정한다.

### 7단계: topology와 CompositePodGroup을 마지막에 추가한다

flat group이 해결하지 못하는 JobSet·LWS use case만 선택한다. 이 단계에서는 `CompositePodGroup`뿐 아니라 그 전제인 `GenericWorkload`와 `TopologyAwareWorkloadScheduling`도 관련 control-plane component에서 함께 활성화됐는지 확인한다.[12] zone-level parent와 rack-level leaf constraint를 단계적으로 추가하고, 각 제약이 admission latency와 network 성능에 주는 영향을 비교한다. CPG status가 비어 있다는 전제로 observability를 설계한다.[11]

### 8단계: patch upgrade와 autoscaler를 포함한 장기 검증

scheduler leader failover, controller rollout, node pool scale-up/down, GPU node 교체, API server skew를 실행한다. 새 node가 올바른 DRA driver와 topology label을 갖기 전에 workload를 받지 않도록 readiness gate 또는 taint 정책을 적용한다.

## rollback은 gate OFF가 아니라 새 제출 경로 전환이다

WAS rollback을 모든 gate를 끄는 작업으로 정의하면 위험하다. 실행 중 Pod는 immutable `schedulingGroup` reference를 가질 수 있고, shared ResourceClaim은 PodGroup lifecycle을 따르며, alpha Job controller가 만든 owner graph가 남아 있을 수 있다.[6][8] active scheduler가 group semantics를 잃으면 같은 객체를 일반 Pod처럼 취급하는 version-skew 위험도 있다.

안전한 rollback은 다음 순서에 가깝다.

1. 신규 WAS workload 제출을 중단한다.
2. controller writer를 하나로 고정하고 old/new writer 동시 동작을 막는다.
3. 실행 중 gang은 완료·checkpoint·중단 중 하나를 명시적으로 선택한다.
4. 기존 검증된 queue/scheduler 경로로 새 workload를 제출한다.
5. Pod → PodGroup/CPG → Workload와 ResourceClaim owner graph를 확인한다.
6. active object가 남아 있는 동안 관련 API와 gate를 성급히 제거하지 않는다.
7. orphan object와 reserved device가 0인지 확인한 뒤 feature gate를 되돌린다.

DRA gate rollback은 특히 주의해야 한다. 1.37에서는 group용 template가 gate OFF 상태에서 Pod별 claim으로 fallback하지 않고 claim 생성 자체가 멈춘다.[1][6] rollback capacity가 있어도 claim controller path가 사라지면 새 Pod는 시작하지 못한다. rollback runbook에 “shared claim을 쓰지 않는 이전 manifest로 새 실행을 재제출”하는 경로가 필요하다.

## 예상 실패 모드와 진단 순서

### 실패 1: 모든 member Pod가 Pending이고 scheduling event가 빈약하다

가능한 원인은 PodGroup 미생성, 잘못된 `podGroupName`, `minCount` 미달, scheduler가 group을 아직 관찰하지 못한 경우다. Pod부터 보지 말고 Workload, PodGroup, Pod reference의 생성 순서와 이름을 비교한다.

### 실패 2: 총 GPU 수는 충분한데 gang이 계속 unschedulable이다

GPU model, DRA claim, taint/toleration, node affinity, zone/rack constraint를 동시에 만족하는 placement가 없는 경우다. 총량 dashboard 대신 topology domain별 feasible capacity를 계산한다. fragmented free GPU는 gang이 사용할 수 있는 capacity와 다르다.

### 실패 3: victim은 종료됐지만 preemptor가 시작하지 않는다

preemption이 만든 공간과 preemptor가 요구하는 topology 또는 device type이 맞지 않을 수 있다. victim event, nominated placement, DRA allocation, topology constraint를 한 timeline으로 연결한다. victim 수만 보면 성공처럼 보일 수 있다.

### 실패 4: 일부 Pod만 Running이 된 뒤 애플리케이션이 멈춘다

초기 admission 이후 member eviction 또는 failure가 발생했거나, `minCount`가 전체 desired replica보다 낮을 수 있다. `PodGroupInitiallyScheduled=True`를 현재 health로 사용하지 말고 actual ready member와 application barrier를 확인한다.[3][4]

### 실패 5: shared ResourceClaim이 생성되지 않는다

Pod와 PodGroup claim의 세 필드가 일치하는지, template가 같은 namespace에 있는지, 네 구성 요소와 kubelet에서 gate가 켜졌는지 확인한다. mixed gate라면 1.37의 의도된 no-claim 동작일 수 있다.[6]

### 실패 6: JobSet child Job마다 중복 Workload 또는 PodGroup이 생긴다

parent와 Job controller가 모두 lifecycle owner라고 판단한 경우다. parent annotation, child ownerReference, Pod template의 `schedulingGroup`, controller version을 확인한다. ownership mode를 하나로 고정한다.[8]

### 실패 7: CompositePodGroup의 status가 계속 비어 있다

1.37 alpha의 알려진 API 경계다. scheduler가 CPG status condition을 채우지 않는다.[11] leaf PodGroup과 Pod, controller status로 진단해야 하며 empty status를 곧바로 scheduler failure로 판정하지 않는다.

### 실패 8: autoscaler가 node를 늘렸지만 queue가 줄지 않는다

새 node가 필요한 GPU/DRA device, topology label, driver readiness를 제공하지 않거나 잘못된 domain에 추가됐을 수 있다. “node count 증가”와 “gang feasible placement 증가”를 분리해서 본다.

### 실패 9: API upgrade 뒤 old manifest가 거부되거나 의미가 바뀐다

`v1alpha2` 잔존, `disruptionMode`의 old field name, served version 차이가 원인일 수 있다.[1] Git 저장소 검색과 server-side dry-run으로 old API를 사전에 차단한다.

### 실패 10: 삭제된 workload의 GPU가 계속 예약돼 있다

PodGroup 또는 owner finalizer가 남아 generated ResourceClaim lifecycle이 끝나지 않은 상태일 수 있다. Pod가 0이라는 사실만 보지 말고 PodGroup deletion timestamp, finalizer, claim `reservedFor`를 확인한다.[6]

## 관측 가능성: Pod보다 scheduling unit을 중심에 둔다

기존 dashboard가 Pod phase만 보여 준다면 WAS의 핵심 상태를 놓친다. 최소한 다음 관계를 한 화면에서 연결해야 한다.

```text
true workload UID
  -> Workload UID / apiVersion
  -> CompositePodGroup tree (있다면)
  -> PodGroup UID / policy / minCount / priority
  -> member Pods / node / device
  -> ResourceClaim / allocated device / reservedFor
  -> scheduler events / preemption victims
```

권장 지표는 다음과 같다.

- PodGroup queue wait와 scheduling cycle latency
- `minCount` 대비 created/scheduled/ready member 수
- workload별 unschedulable reason 분포
- preemption 시 victim GPU-hours와 preemptor ready 성공률
- topology domain별 feasible GPU count와 fragmentation
- PodGroup 없는 `schedulingGroup` reference 수
- owner 없는 Workload·PodGroup·CPG 수
- consumer 없는 allocated ResourceClaim 수와 age
- Basic Job이 만든 WAS object 수와 controller reconcile latency
- controller version별 생성 API version과 validation error

로그와 event의 cardinality도 capacity test에 포함한다. Pod별 queue에서 group queue로 바뀌어 signal shape가 달라질 수 있고, 대규모 JobSet은 하나의 root 아래 많은 leaf를 만든다. workload UID와 group UID를 공통 label로 넣되 무제한 object name을 metric label에 직접 넣어 cardinality를 폭발시키지 않는 설계가 필요하다.

## 도입 체크리스트

- [ ] target patch의 served API와 저장소의 `v1alpha2`·old `disruptionMode` 사용을 확인했다.
- [ ] server-side dry-run과 OpenAPI validation으로 v1beta1 전환을 검증한다.
- [ ] `GenericWorkload`를 API server·controller manager·scheduler에서 일관되게 관리한다.
- [ ] `DRAWorkloadResourceClaims`는 kubelet까지 동일하게 적용한다.
- [ ] CPG rollout 때 `GenericWorkload`와 `TopologyAwareWorkloadScheduling` 전제를 함께 검증한다.
- [ ] Workload → group → Pod의 owner와 garbage collection 경로가 단일하다.
- [ ] `minCount`가 application barrier와 일치하고 Running과 application-ready를 구분한다.
- [ ] preemption 뒤 victim 복구와 preemptor ready를 끝까지 검증한다.
- [ ] DRA driver의 multi-Pod sharing semantics와 claim 회수를 검증한다.
- [ ] topology domain별 GPU·NIC·NUMA feasible capacity를 계산한다.
- [ ] CPG status 한계와 parent/leaf constraint를 dashboard와 alert에 반영한다.
- [ ] 신규 WAS 제출을 즉시 차단하고 이전 scheduler 경로로 재제출할 수 있다.
- [ ] active reference가 남은 동안 API와 gate를 제거하지 않는다.
- [ ] rollback 뒤 orphan group·claim·device reservation이 0인지 확인한다.

## 공식 사실과 운영 해석을 다시 분리한다

**공식 사실:** Kubernetes 1.37에서 Workload·PodGroup, gang scheduling, workload-aware preemption, workload DRA ResourceClaim 지원은 beta로 승격됐다. `GenericWorkload`와 `DRAWorkloadResourceClaims`는 기본 비활성화다. CompositePodGroup과 multi-level scheduling, Job 통합의 관련 부분은 alpha다.[1][6][8]

**공식 사실:** gang scheduling의 atomicity는 최초 placement decision을 대상으로 하며, 이후 Pod 삭제·eviction으로 runtime member 수가 `minCount` 아래로 내려갈 수 있다.[4] Shared ResourceClaim은 PodGroup lifecycle과 reservation을 공유하게 하지만 hardware driver의 동시 사용 안전성을 자동으로 보장하지 않는다.[6]

**저자의 운영 해석:** production 도입 순서는 flat CPU gang → flat GPU gang → preemption → shared DRA → Job controller integration → topology/CompositePodGroup이 적절하다. 이 순서는 Kubernetes의 규범적 요구가 아니라 실패 영역을 하나씩 추가하기 위한 운영 전략이다.

**저자의 운영 해석:** AI 플랫폼의 성공 지표는 scheduler bind 성공률이 아니라 application-ready 시간, 유효 training GPU-hours, checkpoint 손실, preemption 후 진전, orphan device reservation이다. Kubernetes object가 정상이어도 학습·추론이 진전하지 않을 수 있기 때문이다.

## 결론

Kubernetes 1.37 Workload-Aware Scheduling의 의미는 “Kubernetes에 gang scheduler가 생겼다”보다 넓다. `Workload`가 정적 scheduling intent를 담고, `PodGroup`이 runtime unit이 되며, scheduler queue와 preemption이 그 단위를 이해하고, DRA claim도 group lifecycle에 맞춰 공유될 수 있게 됐다.[1][6] `CompositePodGroup`은 JobSet과 LWS 같은 계층형 workload를 gang-of-gangs와 multi-level topology로 표현할 길을 열었다.[11]

동시에 경계도 분명하다. beta 기능은 기본 비활성화이며, Job 통합과 CompositePodGroup은 alpha다. initial gang admission은 runtime health를 보장하지 않고, group preemption은 checkpoint 비용을 없애지 않으며, shared claim은 device sharing semantics를 대신 정의하지 않는다. topology를 엄격하게 만들수록 성능은 좋아질 수 있지만 schedulability와 queue latency는 나빠질 수 있다.

가장 안전한 접근은 큰 AI workload를 한 번에 옮기는 것이 아니다. target patch의 실제 API discovery를 확인하고, controller ownership을 하나로 정하고, flat PodGroup부터 시작해 application-ready와 device lifecycle까지 관측한다. 그 다음에 preemption, DRA, hierarchy를 각각 별도 rollout으로 추가한다.

성공 기준도 “gate를 켰다”가 아니다. 부분 배치 낭비가 줄고, 고우선순위 gang이 victim 피해에 상응하는 진전을 만들며, controller 재시작과 cluster upgrade에도 owner graph가 유지되고, rollback 뒤 GPU reservation이 남지 않아야 한다. WAS는 AI/GPU 운영 문제를 자동으로 제거하는 기능이 아니라, 그 문제를 Pod보다 올바른 단위로 표현하고 검증할 수 있게 하는 scheduling 기반이다.

## Sources

[1] https://kubernetes.io/blog/2026/09/08/kubernetes-v1-37-advancing-workload-aware-scheduling — Kubernetes v1.37: Advancing Workload-Aware Scheduling
[2] https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release — Kubernetes v1.37: Garhwal
[3] https://kubernetes.io/docs/concepts/scheduling-eviction/podgroup-scheduling — PodGroup Scheduling
[4] https://kubernetes.io/docs/concepts/scheduling-eviction/gang-scheduling — Gang Scheduling
[5] https://kubernetes.io/docs/concepts/scheduling-eviction/workload-aware-preemption — Workload-Aware Preemption
[6] https://kubernetes.io/docs/concepts/resource-management/dynamic-resource-allocation/dra-api — DRA API Objects
[7] https://kubernetes.io/docs/concepts/workloads/workload-api/workloadbuilder — Scheduling Building Block APIs and the workloadbuilder Library
[8] https://kubernetes.io/docs/concepts/workloads/controllers/job — Jobs: Integrate with Workload APIs
[9] https://kubernetes.io/docs/concepts/scheduling-eviction/topology-aware-scheduling — Topology-Aware Workload Scheduling
[10] https://kubernetes.io/docs/concepts/workloads/workload-api — Workload API
[11] https://kubernetes.io/docs/concepts/workloads/compositepodgroup-api — CompositePodGroup API
[12] https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates — Feature Gates
