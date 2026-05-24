---
title: 'Kubernetes Service ExternalIPs 폐기 — 오래된 편의 기능이 보안 리스크가 된 이유'
date: 2026-05-24 12:00:00
categories: ["개발/인프라"]
description: 'Kubernetes v1.36에서 Service .spec.externalIPs 폐기와 제거가 본격화된다. CVE-2020-8554 이후 권장되어 온 비활성화 흐름과 운영팀이 준비할 마이그레이션 방향을 정리한다.'
featured_image: '/images/2026-05-24-kubernetes-service-externalips-deprecation/cover.svg'
tags: [kubernetes, devops, security, networking, cloud-native]
---

![Kubernetes ExternalIPs 폐기](/images/2026-05-24-kubernetes-service-externalips-deprecation/cover.svg)

Kubernetes 프로젝트는 2026년 5월 14일 v1.36 관련 글에서 Service의 `.spec.externalIPs` 필드 폐기와 제거 방향을 다시 명확히 했다. 이 기능은 초기 Kubernetes에서 클라우드 로드밸런서와 비슷한 동작을 제공하려는 시도였다. 하지만 보안 모델이 현대적인 멀티테넌트 클러스터 환경과 맞지 않으면서 오래된 편의 기능이 리스크가 되었다.

공식 글의 핵심은 분명하다. `.spec.externalIPs`는 클러스터의 모든 사용자를 완전히 신뢰한다는 전제에 기대고 있으며, 이 전제가 깨지는 환경에서는 CVE-2020-8554에서 설명된 여러 공격 가능성을 만든다. Kubernetes는 1.21 이후 이 기능을 비활성화할 것을 권장해왔다.

## ExternalIPs는 무엇이었나

Kubernetes Service는 보통 다음 방식으로 외부 트래픽을 받는다.

- `LoadBalancer`
- `NodePort`
- `Ingress`
- `Gateway API`
- 클러스터 외부 로드밸런서와의 연동

`.spec.externalIPs`는 Service에 외부 IP를 직접 지정하는 방식이다. 클러스터 네트워크가 해당 IP로 들어온 트래픽을 Service로 라우팅하도록 기대한다.

초기에는 간단하고 유용해 보였다. 클라우드 로드밸런서가 없는 환경이나 베어메탈 클러스터에서 빠르게 외부 IP를 붙일 수 있었기 때문이다.

하지만 문제는 권한 모델이다.

## 왜 위험한가

Kubernetes의 Service 생성 권한을 가진 사용자가 임의의 external IP를 지정할 수 있다면, 클러스터 네트워크 트래픽을 의도치 않은 Service로 가져올 수 있다.

멀티테넌트 환경에서는 특히 위험하다.

- 한 팀이 다른 팀의 트래픽을 가로챌 수 있다.
- 내부 IP 대역을 악용할 수 있다.
- 클러스터 외부 시스템과의 라우팅 경계가 흐려진다.
- 네트워크 정책이 기대한 방식으로 동작하지 않을 수 있다.

CVE-2020-8554는 이런 계열의 문제를 드러냈다. Kubernetes는 강력한 API를 제공하지만, 네트워크와 권한 경계가 애매한 기능은 시간이 지나면서 제거 대상이 된다.

## "예전에는 됐는데"가 가장 위험한 신호

운영팀 입장에서 어려운 점은 이 기능이 오래전부터 존재했다는 것이다. 오래된 기능은 종종 문서보다 실제 사용처가 많다.

- 사내 설치 스크립트가 externalIPs를 넣고 있을 수 있다.
- Helm chart 값에 숨어 있을 수 있다.
- 베어메탈 클러스터에서 임시 우회로 사용 중일 수 있다.
- 테스트 환경에서만 쓰던 설정이 운영에 남아 있을 수 있다.

그래서 폐기 공지를 봤을 때 첫 반응은 "우리는 안 쓸 것 같은데"가 아니라 "어디 숨어 있는지 찾아보자"가 되어야 한다.

## 점검 방법

운영 클러스터에서는 먼저 현재 사용 여부를 확인해야 한다.

```bash
kubectl get svc -A -o jsonpath='{range .items[?(@.spec.externalIPs)]}{.metadata.namespace}{"/"}{.metadata.name}{"	"}{.spec.externalIPs}{"
"}{end}'
```

출력이 있다면 해당 Service가 왜 externalIPs를 쓰는지 추적해야 한다.

추가로 IaC 저장소에서도 검색해야 한다.

```bash
grep -R "externalIPs" -n ./manifests ./charts ./kustomize
```

단, grep 결과가 없다고 안심하면 안 된다. Helm values에서 조건부로 생성하거나, 배포 파이프라인에서 동적으로 주입할 수 있다.

## 대안은 무엇인가

환경에 따라 대안은 다르다.

### 클라우드 환경

관리형 Kubernetes라면 보통 `Service type: LoadBalancer`가 가장 단순하다. 클라우드 컨트롤러가 로드밸런서를 만들고, 보안 그룹이나 방화벽과 연동한다.

장점은 운영 부담이 적다는 것이다. 단점은 비용과 클라우드 종속성이다.

### 베어메탈 환경

베어메탈에서는 MetalLB 같은 솔루션을 고려할 수 있다. BGP 또는 Layer2 방식으로 LoadBalancer 타입 Service에 외부 IP를 할당한다.

장점은 Kubernetes 표준 Service 모델에 가까워진다는 점이다. 단점은 네트워크 팀과의 협업, IP 풀 관리, 장애 시 라우팅 영향도를 이해해야 한다는 점이다.

### HTTP/HTTPS 트래픽

웹 트래픽이라면 Ingress나 Gateway API를 쓰는 것이 일반적이다. 특히 Kubernetes 생태계는 점점 Gateway API 쪽으로 무게중심이 이동하고 있다.

Gateway API는 역할 분리를 더 명확히 한다.

- 인프라 팀: GatewayClass/Gateway 관리
- 앱 팀: HTTPRoute/TCPRoute 등 라우트 관리

멀티테넌트 클러스터에서는 이 분리가 중요하다.

## 마이그레이션 전략

가장 나쁜 접근은 v1.36 업그레이드 직전에 급하게 바꾸는 것이다. 네트워크 경로 변경은 장애를 만들기 쉽다.

권장 순서는 다음이다.

1. 전체 클러스터에서 externalIPs 사용 현황을 수집한다.
2. 각 Service의 실제 트래픽 경로와 소유 팀을 확인한다.
3. 대안 방식을 결정한다: LoadBalancer, MetalLB, Gateway API 등.
4. 스테이징에서 동일 트래픽 경로를 검증한다.
5. DNS TTL을 낮추고 전환 계획을 만든다.
6. 모니터링과 롤백 경로를 준비한다.
7. admission policy로 신규 externalIPs 사용을 차단한다.

마지막 항목이 중요하다. 기존 사용처를 제거해도 신규 사용을 막지 않으면 몇 달 뒤 다시 생긴다.

## 정책으로 막기

Kubernetes 1.21 이후에는 externalIPs 비활성화를 쉽게 하기 위한 admission controller 흐름이 추가되어 왔다. 조직에서는 정책 엔진을 통해 차단할 수도 있다.

예를 들어 다음 원칙을 둘 수 있다.

- 일반 namespace에서는 externalIPs 금지
- 예외 namespace는 플랫폼팀 승인 필요
- PR 단계에서 manifest 검사
- 운영 클러스터 admission 단계에서 최종 차단

정책은 문서보다 강하다. 문서는 잊히지만 admission은 요청을 거부한다.

## 결론

`.spec.externalIPs` 폐기는 Kubernetes가 성숙해지는 과정에서 자연스러운 정리다. 초기에는 편의 기능이었지만, 멀티테넌트와 보안 요구가 커진 지금은 위험한 예외 경로가 되었다.

운영팀이 할 일은 단순하다.

- 지금 쓰는지 찾는다.
- 대안을 정한다.
- 전환을 테스트한다.
- 신규 사용을 정책으로 막는다.

Kubernetes 업그레이드는 기능 추가보다 기능 제거에서 더 자주 장애가 난다. externalIPs를 아직 쓰고 있다면, v1.36 릴리스 노트를 읽는 것보다 먼저 클러스터와 manifest를 검색하는 것이 맞다.

## 참고

- Kubernetes Blog, 2026-05-14: "Kubernetes v1.36: Deprecation and removal of Service ExternalIPs"
- CVE-2020-8554
