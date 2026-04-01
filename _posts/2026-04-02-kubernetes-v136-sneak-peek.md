---
title: 'Kubernetes v1.36 프리뷰: Ingress NGINX 은퇴와 Gateway API 마이그레이션 준비'
date: 2026-04-02 00:00:00
description: 'Kubernetes v1.36의 주요 변경사항을 살펴봅니다. Ingress NGINX 은퇴, externalIPs 폐기, Gateway API 전환, DRA 개선 등 실무에 미치는 영향과 마이그레이션 전략을 안내합니다.'
featured_image: '/images/2026-04-02-kubernetes-v136-sneak-peek/cover.jpg'
tags: [kubernetes, devops, cloud-native]
---

![Kubernetes v1.36 릴리스 주요 변경사항](/images/2026-04-02-kubernetes-v136-sneak-peek/cover.jpg)

Kubernetes v1.36이 2026년 4월 22일에 공식 릴리스될 예정입니다. 이번 릴리스는 단순한 기능 추가를 넘어, 보안 강화와 아키텍처 개선을 위한 중요한 전환점이 될 것으로 보입니다. 특히 오랜 기간 사용되어 온 Ingress NGINX의 은퇴와 Gateway API로의 전환이 본격화되면서, 많은 운영팀이 마이그레이션 계획을 세워야 할 시점입니다.

이번 포스트에서는 Kubernetes v1.36의 주요 변경사항과 실무에 미치는 영향, 그리고 마이그레이션 전략을 상세히 살펴보겠습니다.

## 주요 변경사항: 무엇이 달라지나

### 1. Ingress NGINX 공식 은퇴

Kubernetes SIG Network와 보안 대응 위원회는 2026년 3월 24일부로 **Ingress NGINX를 공식적으로 은퇴**시켰습니다.

**은퇴의 의미:**
- 이 날짜 이후 더 이상 릴리스, 버그 수정, 보안 업데이트가 제공되지 않음
- 기존 배포는 계속 작동하지만, 새로운 취약점이 발견되어도 패치되지 않음
- Helm 차트와 컨테이너 이미지는 여전히 접근 가능하나, 사용이 권장되지 않음

**왜 지금인가?**

Ingress NGINX는 오랜 기간 사실상 표준(de facto standard)으로 사용되어 왔지만, 유지보수 부담과 보안 우려가 지속적으로 제기되어 왔습니다. Kubernetes 생태계가 성숙해지면서 더 현대적이고 안전한 대안들이 등장했고, SIG Network는 커뮤니티가 이러한 대안들로 전환할 시기가 왔다고 판단했습니다.

### 2. Service.spec.externalIPs 폐기 예정

Kubernetes v1.36부터 Service 스펙의 `externalIPs` 필드가 **deprecated** 상태로 전환됩니다.

**보안 이슈:**
- CVE-2020-8554: Man-in-the-Middle 공격에 취약
- 임의의 외부 IP를 서비스에 라우팅할 수 있어 클러스터 트래픽 탈취 가능

**타임라인:**
- v1.36부터: deprecation 경고 표시
- v1.43에서: 완전히 제거 예정

**대안:**
- LoadBalancer 서비스: 클라우드 관리형 인그레스
- NodePort: 단순한 포트 노출
- Gateway API: 유연하고 안전한 외부 트래픽 처리

### 3. gitRepo 볼륨 드라이버 완전 제거

Kubernetes v1.11부터 deprecated되었던 `gitRepo` 볼륨 타입이 v1.36에서 **완전히 비활성화**됩니다.

**왜 제거하나?**
- 중요한 보안 취약점: 공격자가 노드에서 root 권한으로 코드 실행 가능
- 더 나은 대안들이 이미 존재함

**마이그레이션 방법:**
- Init 컨테이너를 사용한 Git clone
- git-sync 스타일의 외부 도구 활용

```yaml
# ❌ 더 이상 작동하지 않음
volumes:
  - name: git-repo
    gitRepo:
      repository: "https://github.com/example/repo.git"

# ✅ 권장 방법: Init 컨테이너 사용
initContainers:
  - name: git-clone
    image: alpine/git
    args:
      - clone
      - --single-branch
      - https://github.com/example/repo.git
      - /repo
    volumeMounts:
      - name: repo-volume
        mountPath: /repo
```

## 새로운 기능: 성능과 보안 개선

### 1. SELinux 볼륨 레이블링 GA (Generally Available)

Kubernetes v1.36에서 SELinux 볼륨 마운트 개선이 **정식 기능(GA)**으로 승격됩니다.

**성능 개선:**
- 기존: 재귀적 파일 레이블링 (느림, 불일치 발생)
- 개선: `mount -o context=XYZ` 옵션으로 마운트 시점에 전체 볼륨에 레이블 적용
- 효과: Pod 시작 지연 감소, 일관된 성능

**주의사항:**
- 특권 Pod와 비특권 Pod가 볼륨을 공유할 때 잠재적 충돌 가능
- `seLinuxChangePolicy` 필드와 SELinux 볼륨 레이블을 정확하게 설정해야 함

### 2. ServiceAccount 토큰 외부 서명

외부 키 관리 시스템(KMS)을 통한 ServiceAccount 토큰 서명이 **베타 기능**으로 제공되며, v1.36에서 GA로 승격될 예정입니다.

**장점:**
- 클라우드 KMS나 하드웨어 보안 모듈(HSM)과 통합 가능
- 중앙화된 서명 인프라 활용으로 보안 강화
- 키 관리 단순화

### 3. DRA: 디바이스 Taints와 Tolerations (베타)

Dynamic Resource Allocation(DRA)에 물리 디바이스를 위한 **taints와 tolerations 지원**이 베타로 전환됩니다.

**사용 사례:**
- 특정 GPU만 특정 워크로드에서 사용하도록 제한
- 결함이 있는 하드웨어를 스케줄링에서 제외
- 특수 목적 하드웨어 리소스 격리

```yaml
# DeviceTaintRule 예시
apiVersion: resource.k8s.io/v1alpha3
kind: DeviceTaintRule
metadata:
  name: exclude-faulty-gpus
spec:
  selector:
    driver: nvidia.com/gpu
    deviceID: "GPU-123-456"
  taints:
    - key: hardware.failure
      value: "true"
      effect: NoSchedule
```

### 4. DRA: 분할 가능한 디바이스 지원

하나의 하드웨어 가속기를 **여러 논리 유닛으로 분할**하여 워크로드 간 공유 가능합니다.

**이점:**
- GPU 활용률 향상: 전체 디바이스를 할당하는 대신 필요한 만큼만 할당
- 비용 효율성: 고가의 하드웨어 리소스 효율적 사용
- 워크로드 격리 유지

**예시:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ml-training
spec:
  containers:
    - name: trainer
      resources:
        claims:
          - name: gpu-partition
            request:
              driver: nvidia.com/gpu
              partition: "4GB"  # GPU 메모리의 일부만 요청
```

## 실무 영향과 마이그레이션 전략

### Ingress NGINX 사용자를 위한 로드맵

**단계 1: 현황 파악 (지금)**
1. 현재 Ingress 리소스 목록 확인
2. 사용 중인 어노테이션과 커스터마이징 파악
3. 트래픽 패턴과 성능 요구사항 분석

```bash
# Ingress 리소스 목록 확인
kubectl get ingress --all-namespaces

# 사용 중인 어노테이션 조사
kubectl get ingress -o yaml | grep -A5 annotations
```

**단계 2: 대안 평가 (2026년 4~6월)**

**옵션 A: Gateway API**
- Kubernetes의 공식 차세대 인그레스 표준
- 더 강력한 라우팅 기능과 보안 모델
- NGINX Ingress Controller보다 표현력이 뛰어남

**옵션 B: 다른 Ingress Controller**
- **Traefik**: 자동 서비스 디스커버리, 우수한 DX
- **Contour**: Envoy 기반, 멀티 테넌시 지원
- **HAProxy Ingress**: 성능 중심, 레거시 호환성
- **Istio/Linkerd Gateway**: 서비스 메시와 통합

**단계 3: 파일럿 마이그레이션 (2026년 7~9월)**
- 비프로덕션 환경에서 테스트
- 성능 벤치마크 수행
- 팀 교육 및 문서화

**단계 4: 프로덕션 전환 (2026년 10월~2027년 1분기)**
- 단계적 롤아웃 (Canary 배포)
- 모니터링 및 알림 구성
- 롤백 계획 준비

### Gateway API 마이그레이션 예시

**기존 Ingress (Ingress NGINX):**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 8080
```

**Gateway API 전환:**
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-app-route
spec:
  parentRefs:
    - name: my-gateway
  hostnames:
    - app.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: api-service
          port: 8080
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
```

### externalIPs 사용자를 위한 체크리스트

1. **현재 사용 여부 확인:**
```bash
kubectl get svc --all-namespaces -o json | \
  jq -r '.items[] | select(.spec.externalIPs != null) | "\(.metadata.namespace)/\(.metadata.name)"'
```

2. **대안 선택:**
   - 클라우드 환경: LoadBalancer 타입 서비스로 전환
   - 온프레미스: MetalLB 같은 베어메탈 로드밸런서 도입
   - 간단한 노출: NodePort 사용

3. **변경 적용:**
```yaml
# Before (externalIPs)
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: ClusterIP
  externalIPs:
    - 203.0.113.10
  ports:
    - port: 80

# After (LoadBalancer)
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: LoadBalancer
  ports:
    - port: 80
```

## 마무리: 변화를 기회로

Kubernetes v1.36은 단순한 버전 업그레이드가 아닌, 생태계 전반의 현대화를 위한 중요한 이정표입니다. Ingress NGINX 은퇴와 Gateway API 전환, externalIPs 폐기 등 큰 변화들이 예정되어 있지만, 이는 모두 보안 강화와 더 나은 개발 경험을 위한 진화입니다.

**지금 해야 할 일:**
1. 현재 클러스터에서 deprecated 기능 사용 여부 확인
2. 마이그레이션 계획 수립 (6~12개월 타임라인)
3. 팀 교육 및 문서화 시작
4. 테스트 환경에서 Gateway API 실험

**4월 22일 릴리스 이후:**
- 공식 릴리스 노트와 마이그레이션 가이드 확인
- 커뮤니티 피드백과 베스트 프랙티스 모니터링
- 단계적 업그레이드 진행

Kubernetes는 계속 진화하고 있으며, 이러한 변화에 적응하는 것이 현대적인 클라우드 네이티브 환경을 유지하는 핵심입니다. v1.36으로의 전환을 계획하고 준비한다면, 더 안전하고 효율적인 인프라를 구축할 수 있을 것입니다.

## 참고 자료

- [Kubernetes v1.36 Sneak Peek (공식 블로그)](https://kubernetes.io/blog/2026/03/30/kubernetes-v1-36-sneak-peek/)
- [Ingress NGINX 은퇴 공지](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [Gateway API 공식 문서](https://gateway-api.sigs.k8s.io/)
- [KEP-5707: Deprecate service.spec.externalIPs](https://kep.k8s.io/5707)
- [Dynamic Resource Allocation (DRA) 개요](/blog/kubernetes-dra-gpu-sharing)
