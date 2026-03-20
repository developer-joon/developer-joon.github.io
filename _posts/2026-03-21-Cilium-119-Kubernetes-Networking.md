---
title: 'Cilium 1.19 릴리스 — Kubernetes 네트워킹의 새로운 기준'
date: 2026-03-21 10:00:00
description: 'Cilium 1.19가 출시되었습니다. Multi-Pool IPAM GA 승격, Ztunnel 베타, Encryption Strict Mode 등 핵심 변경 사항을 실무 관점에서 분석합니다.'
featured_image: '/images/2026-03-21-Cilium-119-Kubernetes-Networking/cover.jpg'
tags: [kubernetes, cilium, networking, ebpf, cloud-native]
---

![Cilium 1.19 릴리스 분석](/images/2026-03-21-Cilium-119-Kubernetes-Networking/cover.jpg)

2934개의 커밋, 1010명 이상의 컨트리뷰터, 23,600+ GitHub 스타. **Cilium 1.19**가 정식 출시되었다. eBPF 기반 Kubernetes 네트워킹의 사실상 표준으로 자리 잡은 Cilium이 이번 릴리스에서 어떤 변화를 가져왔는지 핵심만 정리한다.

## Cilium이란 무엇인가?

Cilium은 **eBPF를 활용한 Kubernetes CNI(Container Network Interface) 플러그인**이다. 기존 iptables 기반 네트워킹을 커널 레벨 eBPF 프로그램으로 대체하여 성능과 보안을 동시에 잡는다.

- **네트워크 정책**: L3/L4/L7 수준의 세밀한 트래픽 제어
- **로드밸런싱**: kube-proxy 없이 서비스 메시 구현
- **옵저버빌리티**: Hubble을 통한 네트워크 플로우 모니터링
- **암호화**: WireGuard/IPsec 기반 투명 암호화

GKE, EKS, AKS 등 주요 관리형 Kubernetes 서비스에서 기본 또는 옵션 CNI로 채택되고 있다.

## 1.19 주요 변경 사항

### 1. Multi-Pool IPAM — 드디어 GA

가장 기다려온 기능 중 하나다. Multi-Pool IPAM이 베타에서 **Stable로 승격**되었다.

```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumPodIPPool
metadata:
  name: tenant-a
spec:
  ipv4:
    cidrs:
      - "10.10.0.0/16"
    maskSize: 24
```

**Multi-Pool IPAM이 필요한 이유:**

| 시나리오 | 단일 Pool 문제 | Multi-Pool 해결 |
|---------|--------------|----------------|
| **멀티테넌트** | 테넌트 간 IP 충돌 | 테넌트별 독립 CIDR |
| **레거시 연동** | 특정 IP 대역 필요 | 풀 지정으로 대역 확보 |
| **규제 준수** | IP 감사 어려움 | 워크로드별 IP 추적 |

이번 릴리스에서는 **IPsec과 Direct Routing 모드에서도 Multi-Pool이 동작**하도록 확장되었다.

![네트워크 아키텍처](/images/2026-03-21-Cilium-119-Kubernetes-Networking/network.jpg)

### 2. Ztunnel 베타 — 투명 암호화의 새 시대

**Ztunnel**은 네임스페이스 단위로 TCP 연결을 투명하게 암호화하고 인증하는 기능이다. 기존 Mutual Authentication(mTLS)의 실질적 후계자 역할을 한다.

```yaml
# 네임스페이스에 ztunnel 활성화
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    cilium.io/ztunnel: "enabled"
```

**특징:**
- 애플리케이션 코드 변경 없이 mTLS 적용
- 네임스페이스 단위 세밀한 제어
- 기존 out-of-band Mutual Authentication은 기본 비활성화로 전환

> 💡 기존에 Mutual Authentication을 사용 중이었다면 Ztunnel 마이그레이션을 검토해야 한다. Cilium 팀은 Ztunnel을 새로운 mTLS 표준으로 밀고 있다.

### 3. Encryption Strict Mode

IPsec과 WireGuard 모두에 **Strict Mode**가 추가되었다. 활성화하면 **암호화되지 않은 노드 간 트래픽을 드롭**한다.

```yaml
# Helm values
encryption:
  enabled: true
  type: wireguard
  strictMode:
    enabled: true  # 비암호화 트래픽 차단
```

금융, 의료, 공공 분야처럼 **규제가 엄격한 환경**에서 필수적인 기능이다. "암호화 활성화"만으로는 부족하고 "비암호화 트래픽이 불가능함"을 증명해야 하는 감사 요건을 충족시킨다.

![보안 강화](/images/2026-03-21-Cilium-119-Kubernetes-Networking/security.jpg)

### 4. Network Policy 강화

여러 네트워크 정책 개선이 포함되었다:

**멀티레벨 DNS 와일드카드:**
```yaml
spec:
  egress:
    - toFQDNs:
        - matchPattern: "**.example.com"  # 다단계 서브도메인 매칭
```

기존 `*.example.com`은 1단계만 매칭했지만, `**.example.com`은 `a.b.c.example.com`까지 매칭한다.

**새 프로토콜 매칭:**
- **VRRP** — 고가용성 라우터 프로토콜
- **IGMP** — 멀티캐스트 그룹 관리

**적극적 거부(Active Deny):**
네트워크 정책이 연결을 거부할 때 ICMPv4 "Destination unreachable" 메시지를 반환한다. 클라이언트가 타임아웃까지 기다리지 않고 즉시 실패를 인지할 수 있다.

**⚠️ 주의:** 클러스터 간 정책 셀렉터가 명시적으로 클러스터를 지정하지 않으면 **로컬 클러스터만 허용**하도록 기본값이 변경되었다. Cluster Mesh 사용자는 업그레이드 전에 정책 검토가 필요하다.

### 5. 네트워킹 개선

| 기능 | 설명 |
|------|------|
| **BIG TCP in Tunnels** | VXLAN/Geneve 터널에서 BIG TCP 활용 |
| **PLPMTUD** | TCP 기반 경로 MTU 자동 탐지 |
| **IPv6 Underlay** | 듀얼스택 클러스터에서 IPv6 터널 언더레이 |
| **IPv6 L2 Announcements** | NDP를 통한 IPv6 Layer-2 공지 |
| **IPv6 Service Loopback** | 파드가 IPv6로 자기 자신에게 루프백 |

IPv6 지원이 전방위로 강화되고 있다. IPv4 고갈이 현실화되면서 Kubernetes 클러스터의 IPv6 전환 압력이 높아진 것을 반영한다.

### 6. BGP 및 Gateway API

**BGP:**
- 인터페이스 IP 직접 광고 — 멀티호밍 환경에서 유용
- BGP 소스 IP 오버라이드

**Gateway API:**
- GAMMA 지원에 GRPCRoute 추가 (기존 HTTPRoute만 지원)

### 7. 폐기 예정 (Deprecation)

| 기능 | 상태 |
|------|------|
| Kafka 프로토콜 매칭 (Beta) | 폐기 예정 |
| ToRequires / FromRequires | 폐기 예정 |
| Out-of-band Mutual Auth | 기본 비활성화 |

Kafka 매칭을 사용 중이라면 대안을 준비해야 한다.

## 실무 업그레이드 체크리스트

1.19로 업그레이드할 때 확인해야 할 항목:

- [ ] **Network Policy**: 클러스터 간 셀렉터 기본값 변경 확인
- [ ] **Cluster Mesh**: 멀티클러스터 정책 셀렉터 검토
- [ ] **LoadBalancer IPAM**: 설정 변경 여부 확인
- [ ] **BGP**: CiliumBGPPeeringPolicy 호환성 체크
- [ ] **Mutual Auth**: Ztunnel 마이그레이션 계획 수립
- [ ] **Kafka Policy**: 폐기 일정 확인 및 대안 준비

> 공식 [Upgrade Guide](https://docs.cilium.io/en/v1.19/operations/upgrade/#upgrade-notes)를 반드시 숙지하자.

## 개인적인 운영 소감

현재 6노드 kubeadm 클러스터에서 Cilium을 CNI로 운영 중이다. Cilium을 선택한 이유는 명확했다 — kube-proxy 교체, eBPF 기반 성능, Hubble 옵저버빌리티.

1.19에서 가장 기대되는 기능은 **Encryption Strict Mode**다. 내부 서비스 간 통신도 WireGuard로 암호화하면서, 비암호화 트래픽이 절대 통과하지 못하게 보장할 수 있다. 특히 멀티테넌트 환경을 준비하고 있다면 필수적인 기능이다.

Multi-Pool IPAM GA 승격도 반갑다. 서비스별로 IP 대역을 분리해서 네트워크 정책을 더 깔끔하게 관리할 수 있게 된다.

## 마무리

Cilium 1.19는 "안정화"와 "보안 강화"에 초점을 맞춘 릴리스다. 화려한 신기능보다는 기존 기능의 GA 승격, 엔터프라이즈 보안 요구 충족, IPv6 전방위 지원 등 **실전 운영에 필요한 것들**을 채운 릴리스라 할 수 있다.

Kubernetes 네트워킹에서 Cilium의 위치는 이제 확고하다. 1010명의 컨트리뷰터가 2934개의 커밋을 만들어낸 이 프로젝트의 다음 릴리스가 기대된다.

---

## 참고 자료

- [Cilium 1.19.0 Release Notes](https://github.com/cilium/cilium/releases/tag/v1.19.0)
- [Cilium 공식 문서](https://docs.cilium.io/en/v1.19/)
- [Cilium 1.19 Upgrade Guide](https://docs.cilium.io/en/v1.19/operations/upgrade/#upgrade-notes)
- [eBPF 공식 사이트](https://ebpf.io/)
