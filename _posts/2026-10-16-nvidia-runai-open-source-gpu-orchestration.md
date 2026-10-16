---
title: 'NVIDIA Run:ai 오픈소스화: GPU 오케스트레이션 플랫폼을 열어도 멀티테넌시가 자동으로 안전해지지는 않는다'
date: 2026-10-16 04:00:00 +0900
categories: ["AI 오픈소스"]
description: 'Apache-2.0으로 공개된 NVIDIA Run:ai 3.0의 구성 요소와 설치 경로를 살펴보고, GPU 공유의 성능·비용 측정법과 멀티테넌트 보안 경계를 운영 관점에서 분석한다.'
featured_image: 'https://picsum.photos/seed/nvidia-runai-open-source-gpu-orchestration/1600/900'
tags: [nvidia-runai, gpu-orchestration, kubernetes, kai-scheduler, gpu-sharing, multi-tenancy, apache-2-0]
---

![NVIDIA Run:ai의 GPU 오케스트레이션과 멀티테넌트 경계](https://picsum.photos/seed/nvidia-runai-open-source-gpu-orchestration/1600/900)

GPU 클러스터의 병목은 늘 GPU가 부족해서만 생기지 않는다. 짧은 notebook이 GPU 한 장을 오래 점유하고, 분산 학습의 일부 Pod만 먼저 배치되며, 팀별 quota가 실제 scheduling decision과 어긋나면 이미 산 장비도 놀게 된다. 이런 문제를 다루던 상용 플랫폼 **NVIDIA Run:ai**의 전체 플랫폼 소스가 2026년 10월 13일 공개됐다.[1]

이번 공개의 의미는 “무료 GPU”나 “Kubernetes가 알아서 빨라진다”가 아니다. Scheduler, 조직별 자원 정책, workload 해석, GPU fraction을 결정하는 코드를 직접 검토하고 조합할 수 있게 됐다는 데 있다. 하지만 코드를 볼 수 있다는 사실과 안전한 멀티테넌시 사이에는 긴 거리가 있다. **Run:ai는 GPU 배분 정책을 투명하게 만들 수 있지만, workload 격리·identity 경로·secret 보호·내부 network trust까지 대신 닫아 주지는 않는다.**

검토 근거는 공개 저장소, 정식 릴리스, 라이선스를 포함한다.[2][3][4]

설치·호환 범위는 지원 matrix, installer 문서, local development guide에서 확인했다.[5][6][7]

보안·유지보수·초기 통합 신호는 security policy, support policy, partner 검증 발표와 대조했다.[8][9][10]

## 왜 오늘 Run:ai를 골랐나

선정 기준 시각은 2026년 10월 16일 04:00 KST이며, NVIDIA의 공개 발표는 3일 전이다. 따라서 최근 30일 범위를 충족한다. 공개 저장소의 최신 정식 릴리스 `3.0.20`은 10월 11일 게시됐고 prerelease가 아니다.[3]

공개 상태도 분명하다. Monorepo의 control plane, cluster service, installer, CLI, MCP server, 문서와 local development environment가 공개돼 있다.[2] 저장소 루트 코드는 **Apache License 2.0의 OSI 오픈소스 소프트웨어**다.[4] 이것은 open-weight 모델 공개가 아니므로 모델 가중치·학습 데이터·학습 recipe의 공개 범위를 논할 대상은 아니다.

인기와 활동은 증가율을 만들어 내지 않고 관측값으로만 기록했다. 2026년 10월 16일 04:06 KST GitHub 조회 당시 저장소는 **387 stars, 55 forks**였고, 마지막 push는 10월 16일 00:33 KST였다.[2] 여기에 NVIDIA가 발표 시점에 Crusoe, Mirantis, Nebius, OpenNebula, Rafay, Saturn Cloud, Spectro Cloud, vCluster 등 **8개 생태계 파트너의 통합 계획**을 열거했고, Crusoe는 cluster 등록·분산 PyTorch 학습·fractional GPU sharing·inference serving을 검증했다고 자체 발표했다.[1][10]

이는 최근 저장소 활동과 공급자들이 발표한 통합 계획이라는 두 종류의 신호다. 이 가운데 Crusoe는 대표 workload 검증을 별도로 밝혔지만, 실제 고객 채택 규모나 Run:ai 3.0 호환 범위까지 확인된 것은 아니다. 또한 과거 star snapshot이나 GitHub Trending 순위는 확보하지 못했다. 따라서 “3일 만에 몇 배 성장했다”거나 “급상승 1위”라고 표현하지 않는다. 주목받는 이유는 고가 GPU의 공유 정책을 검토·확장할 수 있고, 전체 플랫폼과 네 개 모듈을 따로 채택할 수 있게 됐기 때문으로 **추정**할 수 있다.[1] 이 기능이 star 증가를 일으켰다는 인과는 확인되지 않았다.

## 무엇이 공개됐고, 무엇은 여전히 별도 계약인가

Run:ai 공개는 한 덩어리처럼 보이지만 배포 경로와 책임을 분리해야 한다.

| 자산 | 공개 상태 | 라이선스·운영 경계 |
|---|---|---|
| Run:ai monorepo source | 공개 | 루트 기준 Apache-2.0, NOTICE·nested dependency license 확인 필요 |
| KAI Scheduler | 공개 | Apache-2.0, CNCF Sandbox에 기여된 upstream scheduler |
| GPU Fractioning Operator | 공개 | CUDA 13.4 기반 GPU memory fraction의 Kubernetes integration |
| KAI Resource Management | 공개 | department·project·quota·node pool의 조직 계층 |
| Workload Map | 공개 | workload 구조를 기술하는 contract이며 scheduling·autoscaling 자체는 하지 않음 |
| NGC Community Product | 이용 가능 | 유료 subscription과 enterprise support는 없지만 NGC 다운로드 약관은 별도 적용 |
| 상용 지원 제품 | 계속 제공 | Mission Control·NVIDIA AI Enterprise·marketplace별 지원·라이선스가 다름 |

NVIDIA 발표는 source code에 적용되는 오픈소스 라이선스와 NGC Community Product를 받을 때 동의하는 NVIDIA Software License Agreement를 명시적으로 분리한다.[1] Apache-2.0은 수정·재배포를 허용하지만 LICENSE·NOTICE·수정 고지 의무와 trademark 비허여를 함께 봐야 한다.[4] “코드가 Apache-2.0이니 NVIDIA 상표와 NGC artifact까지 같은 조건”이라고 해석하면 안 된다.

현재 공개 지원 정책은 `release-3.0` branch만 supported로 표시한다. Community source를 직접 운영할 때도 모든 과거 minor가 security fix를 받는 것은 아니다.[9] 무료 사용과 무상 운영 책임은 같은 말이 아니다.

## 네 구성 요소를 하나의 기능으로 뭉개지 말아야 한다

### KAI Scheduler: 어디에 놓을지 결정한다

KAI Scheduler는 gang scheduling, fair-share, quota, topology awareness, bin-packing, preemption과 GPU sharing을 다룬다.[1] 분산 학습 Pod 열 개 중 여섯 개만 배치해 여섯 GPU를 묶어 두는 대신, 전체 group을 배치할 수 있을 때 시작하는 것이 gang scheduling의 핵심이다.

하지만 scheduler는 “이 workload가 안전한가”를 판정하는 sandbox가 아니다. 어디에 놓고 어떤 우선순위로 밀어낼지를 결정할 뿐, container image·command·mounted secret이 신뢰 가능한지는 별도 admission과 supply-chain gate가 맡아야 한다.

### GPU Fractioning Operator: 한 GPU의 memory를 나눈다

GPU fraction은 notebook, 작은 inference server처럼 GPU 전체 memory를 쓰지 않는 workload를 함께 배치할 수 있게 한다. 공개 operator는 CUDA-native fraction을 Kubernetes에서 요청하고 관측하게 만든다. NVIDIA 문서는 GPU fraction 사용에 GPU Operator 26.7.1과 CUDA driver r615 이상이 필요하며, driver version을 명시적으로 설정해야 한다고 적는다.[5]

여기서 **memory hard limit**와 성능 격리를 혼동하면 안 된다. Memory 용량을 나눠도 SM, memory bandwidth, cache, PCIe·NVLink와 host resource contention은 남는다. 이웃 workload의 burst가 tail latency를 흔드는지 실제로 측정해야 한다.

### KAI Resource Management: 누가 얼마나 받을지 정한다

Scheduler가 placement를 결정한다면 Resource Management는 department와 project별 보장량, quota, share와 node pool을 표현한다.[1] 이 계층은 “연구팀 50% 보장” 같은 조직 정책을 cluster decision으로 옮길 수 있다.

그러나 quota는 authorization 전체가 아니다. 사용자가 어느 project에 속하는지, 누가 quota를 바꿀 수 있는지, namespace와 Kubernetes RBAC가 같은 조직 경계를 유지하는지는 identity와 policy layer에서 따로 검증해야 한다.

### Workload Map: workload를 같은 언어로 읽는다

AI workload는 단일 Pod보다 PyTorchJob, RayCluster, JobSet, KServe InferenceService처럼 여러 component와 role을 가진 CRD인 경우가 많다. Workload Map은 driver·worker, prefill·decode 같은 구조와 상태를 공통 contract로 기술한다.[1]

이 contract는 scheduler, dashboard, cost tool이 CRD마다 private adapter를 만드는 문제를 줄인다. 반대로 Workload Map 자체가 queue, schedule, autoscale, multi-cluster propagation을 수행한다고 과장하면 안 된다. **관찰 가능한 구조**와 **실행 권한**은 다른 계층이다.

## 실제로 시작하는 두 경로

Production 도입에서는 guided installer가 권장 경로다. `runai-installer`는 하나의 configuration YAML을 검증하고 preflight, prerequisite, control plane과 cluster 배포를 수행한다. Connected·air-gapped, same-cluster·multi-cluster를 지원하지만 현재 installer는 신규 환경용이며 upgrade는 아직 지원하지 않는다.[6]

설치 전에 Kubernetes/OpenShift, storage, ingress, DNS, FQDN, TLS, registry 접근과 권한을 준비해야 한다. Installer가 cluster 자체와 network boundary를 대신 설계하지 않는다. Run:ai v3.0의 검증 matrix도 GPU Operator 25.10~26.7.1, PostgreSQL 16, Keycloak 26.6 등 구체적인 범위를 둔다.[5]

코드 검토와 기능 실험이 목적이면 source의 local environment가 더 직접적이다.[7]

```bash
git clone https://github.com/dsx-ai-factory/run-ai.git
cd run-ai
git checkout 3.0.20
./local-dev.sh
```

이 명령은 작은 demo binary 하나를 띄우는 과정이 아니다. 공식 가이드는 약 50개 Go service, 5-node Kind cluster, local registry, control plane과 cluster service를 구성한다고 설명한다. Linux에서 스크립트가 경고 기준으로 확인하는 값은 CPU 4개, RAM 16GB, container storage 여유 100GB이며 첫 full build가 약 44GB cache와 8GB image를 남길 수 있다.[7]

GPU가 없는 환경은 fake GPU operator로 control path를 실험할 수 있다. 실제 GPU 경로는 Linux·Docker·NVIDIA GPU·동작하는 driver·NVIDIA Container Toolkit을 요구하며, local script는 NVIDIA GPU만 지원한다.[7] Fake GPU에서 scheduling object가 생성됐다고 실제 CUDA fraction의 성능과 격리가 검증된 것은 아니다.

## 활용 시나리오와 도입 순서

### 여러 팀이 notebook과 학습 job을 공유하는 경우

작은 interactive session이 GPU 전체를 점유하고 대형 batch job이 queue를 독점한다면 fraction, priority, fair-share를 함께 시험할 가치가 있다. 먼저 한 팀의 non-production node pool에서 시작하고, 기존 scheduler와 같은 workload trace를 replay한다.

승인 기준은 “utilization이 올랐다” 하나가 아니다.

- 대기: queue wait p50·p95·p99, gang이 완성되지 못한 시간
- 처리: useful GPU-seconds, completed training step, inference request당 GPU time
- 공정성: project별 entitlement 대비 실제 allocation, starvation duration
- 간섭: colocated workload의 step time·latency tail·OOM·throttling
- 복구: preemption 후 checkpoint 성공률, lost work, 재시작 시간

### 분산 학습의 topology placement를 개선하는 경우

같은 GPU 수라도 NVLink domain과 network fabric을 가로지르는 placement는 collective tail을 키운다. Topology-aware scheduling의 효과는 평균 GPU utilization보다 job completion time과 rank별 collective duration으로 측정한다. Model, precision, global batch, dataset, GPU·driver, network topology를 고정하지 않으면 전후 비교가 scheduler 효과인지 알 수 없다.

### 다양한 CRD를 하나의 platform에서 관리하는 경우

PyTorchJob, Ray, KServe를 모두 지원해야 한다면 Workload Map으로 구조 해석을 공통화할 수 있다. 단, 새 workload adapter를 넣기 전에 malformed object, status 누락, controller version skew, orphan resource를 fixture로 만들어야 한다. “화면에 보인다”와 “올바르게 scale·delete·recover된다”는 다르다.

## 공급자 성능 주장 대신 무엇을 측정할까

이번 open-source 발표는 특정 benchmark에서 몇 배 빨라졌다는 독립 성능 증거를 제공하지 않는다. “GPU utilization과 workload throughput을 개선한다”는 표현은 제품 목적이지 모든 cluster에서 보장되는 결과가 아니다.[1] 따라서 도입안은 공급자 headline 수치를 복제하기보다 현재 cluster의 baseline을 먼저 고정해야 한다.

```text
cost_per_completed_work =
    (gpu_node_cost
   + control_plane_cost
   + storage_and_network_cost
   + failed_job_cost
   + platform_engineering_and_oncall_cost)
  / completed_work_units
```

`completed_work_units`는 팀에 맞춰 학습 token, 성공한 training step, 완료된 job, SLO를 만족한 inference request로 정한다. Failed job이 사용한 GPU 시간과 preemption으로 잃은 work를 분자에서 빼면 orchestration 효과를 과대평가한다.

비교 실험은 최소 세 가지를 분리한다.

1. **Native scheduler baseline**: 같은 cluster와 workload trace에서 현재 queue·placement 결과를 기록한다.
2. **KAI only**: scheduling policy만 바꿔 gang·fair-share·topology 효과를 본다.
3. **Full platform**: Resource Management와 fraction까지 추가해 control-plane 비용과 운영 복잡성을 포함한다.

각 실험에서 hardware model, GPU 수, driver·CUDA, Kubernetes·operator version, workload image digest, model precision, batch·sequence 조건, warm-up, 측정 window와 실패 제외 기준을 함께 남긴다. 현재 독립적인 end-to-end benchmark가 충분하지 않으므로, 공급자 설명과 자체 결과를 같은 표의 동일한 증거로 취급하지 않는 편이 안전하다.

## 보안: 공개된 threat model이 말하는 불편한 사실

Run:ai의 공개 `SECURITY.md`는 이 플랫폼이 단순 scheduler보다 넓은 trust boundary를 가진다고 적는다. Control plane은 multi-tenant HTTP service이고, cluster controller는 Pod·Job·RoleBinding·namespace 변경을 중개하며, 플랫폼은 registry·object storage·Git·API credential을 보관하고 workload에 주입한다.[8]

특히 다음 경계를 배포 전에 시험해야 한다.

### 인증 edge 우회

Downstream service는 bearer token을 다시 검증하지 않고, 인증 edge가 주입한 identity header를 신뢰한다. 따라서 untrusted Pod가 service에 직접 도달하거나 auth middleware가 빠진 route가 생기면 identity spoofing 가능성이 커진다.[8] 모든 control-plane service의 ingress path와 pod-to-pod NetworkPolicy를 negative test로 검증해야 한다.

### Workload spec에서 cluster privilege로의 상승

사용자는 image, command, argument, environment, mounted asset 등 실제 Pod spec의 상당 부분을 제어한다. Admission webhook과 controller가 이를 변환하므로 quoting·validation·sidecar privilege가 공격면이 된다.[8] Namespace RBAC뿐 아니라 privileged container, host mount, service account token automount, device access와 admission bypass를 시험해야 한다.

### 저장 credential 집중

Control plane에는 여러 tenant의 외부 credential이 모인다. 공식 threat model은 일부 integration credential이 plaintext database column에 남을 수 있고, application-level key와 그 private key가 같은 Kubernetes trust domain에 있을 수 있다고 경고한다.[8] External KMS 사용 여부, secret read 권한, rotation, backup encryption과 credential별 blast radius를 별도 review해야 한다.

### Exec·attach·port-forward

Interactive endpoint는 WebSocket으로 workload Pod의 logs, exec, attach, port-forward를 proxy한다. 잘못된 audience·issuer·scope 검사나 upgrade path는 다른 tenant workload의 shell 접근으로 이어질 수 있다.[8] UI 권한만 보지 말고 API endpoint를 직접 호출하는 authorization fixture가 필요하다.

### Audit를 enforcement로 오인

공식 문서는 audit write가 asynchronous이며 기록 실패가 원래 request를 실패시키지 않는다고 명시한다.[8] 규제나 부인 방지가 필요하면 외부 immutable sink로 전송하고, 누락·지연·retention을 독립적으로 감시해야 한다.

소스 공개는 이 경계를 검토할 기회를 준다. 그러나 **감사 가능성은 격리 보장이 아니다.** NetworkPolicy, ingress, Kubernetes RBAC, container runtime, Keycloak, secret store와 rate limiting은 운영자가 닫아야 한다.

## 실패 모드와 rollout gate

### Fraction을 켰지만 비용이 늘어난다

Memory가 남는다는 이유만으로 workload를 함께 놓으면 bandwidth contention과 tail latency가 늘 수 있다. GPU당 Pod 수를 한 번에 늘리지 말고 workload class별 canary를 운영한다. Notebook, latency-sensitive inference, batch training의 colocation matrix를 따로 둔다.

### Fair-share가 starvation을 숨긴다

장기 평균 allocation이 quota와 맞아도 짧은 deadline job이 계속 밀릴 수 있다. 평균 share뿐 아니라 queue age와 가장 오래 기다린 runnable workload를 경보로 사용한다.

### Gang scheduling이 큰 job의 입구를 막는다

All-or-nothing 배치는 partial allocation 낭비를 줄이지만, 큰 gang이 오래 기다리며 queue head를 막을 수 있다. Backfill 정책, priority, preemption 비용과 최대 대기 시간을 함께 시험한다.

### Control plane 장애가 이미 실행 중인 workload에 미치는 영향을 모른다

API가 끊겼을 때 새 submission, 기존 workload, policy update, status sync가 각각 어떻게 동작하는지 fault injection으로 확인한다. “Pod가 계속 돈다”만으로 성공 처리하지 말고 stale policy와 reconciliation 결과까지 본다.

### Upgrade 경로를 installer 재실행으로 오해한다

Guided installer는 현재 신규 설치를 위한 경로이며 upgrade는 지원하지 않는다.[6] Release branch, CRD conversion, database migration, Helm rollback과 workload checkpoint를 포함한 별도 upgrade runbook이 필요하다.

저자가 권하는 rollout 순서는 다음과 같다.

1. Version과 image digest, chart, CRD, policy fixture를 고정한다.
2. Fake GPU local environment에서 object lifecycle과 UI·API contract를 검증한다.
3. 격리된 실제 GPU node pool에서 KAI Scheduler만 shadow 비교한다.
4. Fraction은 low-risk workload class 하나에만 연다.
5. Identity edge 우회, cross-tenant query, exec·port-forward, secret access의 negative test를 통과시킨다.
6. Queue tail·interference·failed-work cost가 baseline보다 나빠지면 자동 확대를 중단한다.
7. Control plane·cluster component 장애와 rollback을 실제로 주입한다.

## 어떤 팀에 맞고, 어떤 팀에는 맞지 않나

**적합한 경우**

- 여러 팀이 Kubernetes 기반 NVIDIA GPU fleet을 공유한다.
- Gang scheduling, topology placement, project quota가 실제 병목이다.
- PyTorchJob·Ray·KServe 등 여러 workload type을 공통 운영해야 한다.
- Scheduler와 policy decision을 source 수준에서 감사·확장하려 한다.
- Control plane, identity, NetworkPolicy, secret lifecycle을 운영할 platform team이 있다.

**부적합한 경우**

- 한 팀이 전용 GPU 몇 장에서 job을 순차 실행한다.
- Kubernetes control plane과 GPU Operator를 유지할 인력이 없다.
- AMD·Intel accelerator까지 같은 fraction path로 지원된다고 기대한다.
- Open-source 배포에도 NVIDIA enterprise support가 포함된다고 가정한다.
- GPU utilization 하나만 올리면 latency·공정성·실패 비용은 무시해도 된다고 본다.

더 단순한 대안도 있다. 전용 cluster에서 queue와 quota만 필요하면 native Kubernetes scheduler와 Kueue 조합이 운영면이 작을 수 있다. HPC batch와 bare-metal 중심 조직은 Slurm이 기존 identity·accounting에 더 잘 맞을 수 있다. 반대로 전체 플랫폼이 부담이면 KAI Scheduler나 Workload Map 한 구성 요소만 채택하는 것이 합리적이다.[1][2]

## 결론: 열린 scheduler보다 닫힌 운영 경계가 중요하다

NVIDIA Run:ai의 오픈소스화는 GPU를 배분하는 핵심 계층을 black box 밖으로 꺼냈다. Platform 팀은 scheduler, quota, workload contract, fraction operator를 읽고 고치며 필요한 부분만 도입할 수 있다. Apache-2.0 monorepo와 실제 local environment, 지원 matrix, 공개 threat model까지 갖춘 점은 검토 가능성을 높인다.[2][4][5]

하지만 이 공개가 멀티테넌시를 자동으로 안전하게 만들지는 않는다. 인증 edge를 우회할 수 없는지, tenant query가 항상 scope를 갖는지, workload spec이 privilege를 얻지 않는지, credential과 interactive proxy가 보호되는지, audit 누락이 감지되는지는 배포자가 증명해야 한다.[8]

따라서 도입 질문은 “Run:ai를 설치하면 GPU 사용률이 오르는가”보다 구체적이어야 한다. **어떤 workload를 함께 놓을지, 누가 allocation policy를 바꿀지, 장애와 preemption의 비용을 어디까지 포함할지, 어느 경계가 실패하면 rollout을 멈출지** 먼저 정해야 한다. Run:ai의 가장 큰 가치는 GPU를 더 촘촘히 채우는 기능만이 아니라, 그 결정을 이제 코드와 fixture로 감사할 수 있다는 데 있다.

## Sources

[1] https://developer.nvidia.com/blog/nvidia-runai-is-now-open-source-as-part-of-nvidia-dsx-ai-factory-platform/
[2] https://github.com/dsx-ai-factory/run-ai
[3] https://github.com/dsx-ai-factory/run-ai/releases/tag/3.0.20
[4] https://github.com/dsx-ai-factory/run-ai/blob/main/LICENSE
[5] https://docs.nvidia.com/run-ai/self-hosted/documentation/installation-and-configuration/support-matrix
[6] https://docs.nvidia.com/run-ai/self-hosted/documentation/installation-and-configuration/install/guided-installation
[7] https://github.com/dsx-ai-factory/run-ai/blob/3.0.20/local-dev.md
[8] https://github.com/dsx-ai-factory/run-ai/blob/3.0.20/SECURITY.md
[9] https://github.com/dsx-ai-factory/run-ai/blob/3.0.20/SUPPORT.md
[10] https://www.crusoe.ai/resources/blog/run-ai-open-source-release
