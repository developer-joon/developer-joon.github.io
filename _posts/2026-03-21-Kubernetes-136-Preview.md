---
title: 'Kubernetes 1.36 프리뷰 — Ingress 은퇴, Gateway API 시대의 개막'
date: 2026-03-21 13:00:00
description: '2026년 4월 22일 출시 예정인 Kubernetes 1.36의 주요 변경 사항을 미리 살펴봅니다. Ingress-Nginx 은퇴, Linux User Namespaces 강화, DRA 업데이트까지.'
featured_image: '/images/2026-03-21-Kubernetes-136-Preview/cover.jpg'
tags: [kubernetes, cloud-native, devops, gateway-api]
---

![Kubernetes 1.36 프리뷰](/images/2026-03-21-Kubernetes-136-Preview/cover.jpg)

**2026년 4월 22일**, Kubernetes 1.36이 출시된다. 연 3회 정기 릴리스 사이클에 따라 예정된 이번 버전에는 보안, 네트워킹, 리소스 관리 전반에 걸친 중요한 변경 사항이 포함되어 있다.

KubeCon Europe 2026(암스테르담)이 이달 말 개최되는 시점에서, 미리 준비해야 할 것들을 정리한다.

## 1. Ingress-Nginx 은퇴 — 한 시대의 종말

가장 큰 변화다. Kubernetes 생태계의 대표적인 Ingress Controller였던 **Ingress-Nginx가 공식 은퇴**한다.

### 영향

- 기존 Ingress-Nginx 버전은 **계속 작동**
- 하지만 **추가 보안 패치 없음**
- 신규 프로젝트에서는 사용 불가

### 후계자: Gateway API

Gateway API는 Ingress의 "표현력 있고 역할 지향적인(expressive and role-oriented)" 후계자다.

| 비교 항목 | Ingress | Gateway API |
|----------|---------|-------------|
| 라우팅 | 기본적 | 고급 (트래픽 분할, 가중치) |
| 멀티테넌트 | 어려움 | 네이티브 지원 |
| 크로스 네임스페이스 | 불가 | 가능 |
| 확장성 | Annotation 의존 | CRD 기반 표준화 |
| 역할 분리 | 없음 | Infra/App 관심사 분리 |

Memgraph CTO Marko Budiselić의 평가:

> "Ingress-Nginx의 은퇴는 Kubernetes 네트워킹이 성장하고 있다는 가장 명확한 신호다. Ingress는 출발점으로 잘 역할했지만, Gateway API는 근본적으로 더 나은 것을 제공한다 — 인프라와 애플리케이션 관심사의 적절한 분리, 크로스 네임스페이스 라우팅, 팀 작업 방식에 맞게 확장되는 모델."

> 💡 현재 Cilium을 CNI로 사용 중인 클러스터에서는 이미 Cilium의 Gateway API 구현을 사용할 수 있다. Cilium 1.19에서 GRPCRoute 지원도 추가되었다.

![인프라 아키텍처](/images/2026-03-21-Kubernetes-136-Preview/infra.jpg)

## 2. Linux User Namespaces 강화

컨테이너 보안의 핵심 업데이트다.

### 무엇이 바뀌나?

Linux User Namespaces는 컨테이너 내부에서 root로 실행되는 프로세스를 **호스트에서는 비특권 사용자로 매핑**하는 기술이다.

```
컨테이너 내부:  root (UID 0) → 프로세스 실행
호스트 시스템:  nobody (UID 65534) → 실제 권한
```

### 왜 중요한가?

컨테이너 탈출(container escape) 취약점의 영향을 대폭 줄여준다. 컨테이너 안에서 root를 획득해도, 호스트에서는 아무 권한이 없기 때문이다.

1.36에서는 이 기능의 안정성과 호환성이 더욱 강화된다.

## 3. DRA(Dynamic Resource Allocation) — 하드웨어 관리의 진화

GPU, FPGA 등 특수 하드웨어를 Kubernetes에서 관리하는 DRA API가 크게 업데이트된다.

### 핵심: 하드웨어에 Taints/Tolerations 도입

기존에 노드(Node)에만 적용되던 Taints/Tolerations 개념이 **개별 하드웨어 디바이스에도 적용**된다.

```yaml
# 유지보수 중인 GPU에 Taint 적용 (개념적 예시)
apiVersion: resource.k8s.io/v1alpha3
kind: ResourceSlice
metadata:
  name: gpu-node1-slot0
spec:
  taints:
    - key: "maintenance"
      value: "scheduled"
      effect: "NoSchedule"
```

**실용적 시나리오:**

| 상황 | Taint/Toleration 활용 |
|------|---------------------|
| GPU 유지보수 | 해당 GPU에 NoSchedule → 자동 리스케줄링 |
| 장애 디바이스 | Taint 적용 → 정상 워크로드 보호 |
| 테스트 파드 | Toleration 추가 → 장애 디바이스 접근 허용 |

Cloudsmith의 Nigel Douglas 평가: "관리자가 **전체 클러스터를 방해하지 않고 특정 디바이스를 오프라인**으로 전환할 수 있게 해준다."

### OCI 아티팩트를 VolumeSource로 마운트 — Stable 승격

오랫동안 개발자들은 ML 모델, 정적 에셋, 바이너리 플러그인을 컨테이너 이미지에 직접 번들링하는 "Fat Image 안티패턴"에 시달려왔다.

1.36에서는 **OCI 아티팩트를 독립적인 VolumeSource로 마운트**하는 기능이 Stable로 승격된다.

```yaml
# Hugging Face 모델을 OCI 아티팩트로 마운트 (개념적 예시)
volumes:
  - name: llm-weights
    ociArtifact:
      image: "registry.example.com/models/llama:v3"
```

**장점:**
- 이미지 크기 대폭 축소 → 배포 시간 단축
- 모델/데이터를 독립적으로 버전 관리
- 보안 패치 시 로직만 업데이트 (데이터는 그대로)

## 4. Manifest 기반 Admission Control

플랫폼 팀의 보안을 강화하는 기능이다.

### 문제 — 시작 시 보안 공백

기존에는 Admission Control 설정이 API를 통해 관리되어, **클러스터 시작 시 정책이 적용되지 않는 순간**이 존재했다. 이 틈에 privileged 컨테이너가 생성될 수 있었다.

### 해결

정책을 API가 아닌 **컨트롤 플레인 디스크의 정적 파일로 관리**. 클러스터 시작 시점부터 즉시 적용된다.

**실용적 의미:**
- `kubectl delete`로 실수로 정책 삭제 → 불가능
- etcd 장애 시에도 정책 유지
- privileged 컨테이너 차단 같은 핵심 가드레일이 **항상** 활성화

## 실전 — 업그레이드 시 주의사항

Kubernetes 업그레이드는 늘 주의가 필요하다. Neteera의 DevOps 리드 Heinan Cabouly는 1.35 업그레이드 경험을 공유했다:

> "화요일 오후, 일상적인 업그레이드. 계획됨. 스테이징 테스트 완료. 변경 관리 승인됨. 수요일 아침, **EKS 노드 그룹 절반이 NotReady**. 파드 퇴거. 06시에 온콜 호출."

원인은 설정 오류가 아니라, 실제 프로덕션 워크로드와의 상호작용에서 발생한 예측 불가능한 문제였다.

### 1.36 업그레이드 체크리스트

- [ ] **Ingress-Nginx** 사용 중이면 Gateway API 마이그레이션 계획 수립
- [ ] **DRA** 사용 시 새 Taints/Tolerations API 호환성 확인
- [ ] **Admission Control** 정적 파일 마이그레이션 검토
- [ ] 스테이징 환경에서 **최소 1주일** 사전 테스트
- [ ] 롤백 계획 준비 (이전 버전 스냅샷)

## 마무리

Kubernetes 1.36은 **"성숙"**이라는 단어로 요약할 수 있다.

- Ingress → Gateway API: 더 구조적인 네트워킹
- User Namespaces: 더 안전한 컨테이너 격리
- DRA Taints: 더 세밀한 하드웨어 관리
- Manifest Admission: 더 견고한 보안 기본값

4월 22일 출시까지 한 달. 준비할 시간은 충분하다.

---

## 참고 자료

- [Cloud Native Now — What to Expect From Kubernetes 1.36](https://cloudnativenow.com/features/what-to-expect-from-kubernetes-1-36/) (2026-03-13)
- [KubeCon Europe 2026 — Amsterdam](https://events.linuxfoundation.org/kubecon-cloudnativecon-europe/)
- [Gateway API 공식 문서](https://gateway-api.sigs.k8s.io/)
- [Kubernetes 릴리스 일정](https://kubernetes.io/releases/)
