---
title: 'Docker Kanvas — Compose에서 Kubernetes까지, Helm과 Kustomize에 도전장'
date: 2026-03-21 14:00:00
description: 'Docker가 출시한 Kanvas는 Docker Compose 파일을 Kubernetes 배포 아티팩트로 자동 변환합니다. Helm, Kustomize와 무엇이 다르고, 누가 써야 하는지 분석합니다.'
featured_image: '/images/2026-03-21-Docker-Kanvas-Helm-Kustomize/cover.jpg'
tags: [docker, kubernetes, helm, devops, cloud-native]
---

![Docker Kanvas 소개](/images/2026-03-21-Docker-Kanvas-Helm-Kustomize/cover.jpg)

2026년 1월 6일, Docker가 **Kanvas**를 출시했다. Docker Compose 파일을 Kubernetes 배포 아티팩트로 자동 변환하는 플랫폼이다. Helm과 Kustomize가 양분하던 K8s 배포 도구 시장에 Docker가 직접 뛰어든 것.

## Compose → K8s 변환이란 무엇인가?

대부분의 개발자는 로컬 개발 환경에서 Docker Compose를 사용한다. 문제는 이 Compose 파일을 **프로덕션 Kubernetes 환경에 배포할 때** 발생한다.

### 기존 워크플로우

```
docker-compose.yml → (수동 변환) → Helm Chart 또는 Kustomize 오버레이 → K8s 배포
```

이 과정에서:
- Compose의 서비스 정의를 Deployment, Service, Ingress로 분해
- 환경별 설정(dev/staging/prod) 분리
- 시크릿, ConfigMap 매핑
- 볼륨, 네트워크 정책 변환

**수동으로 하면 반복적이고 실수가 잦다.** 예전에는 Kompose라는 도구가 있었지만 활발히 관리되지 않았고, 출력물의 품질도 프로덕션 수준이 아니었다.

### Kanvas의 접근 방식

```
docker-compose.yml → Kanvas → Deployment + Service + Ingress + ConfigMap + ...
```

Kanvas는 Docker Compose 파일을 분석하여 **프로덕션 수준의 Kubernetes 매니페스트를 자동 생성**한다.

## Helm vs Kustomize vs Kanvas

세 도구는 K8s 배포 문제를 서로 다른 각도에서 접근한다.

| 비교 항목 | Helm | Kustomize | Kanvas |
|----------|------|-----------|--------|
| **철학** | 패키지 매니저 | 오버레이 패칭 | Compose 변환 |
| **입력** | Chart 템플릿 | Base + Overlay | docker-compose.yml |
| **템플릿 엔진** | Go template | 없음 (패치 기반) | 자동 생성 |
| **학습 곡선** | 높음 | 중간 | 낮음 (Compose 아는 경우) |
| **커스터마이징** | values.yaml | kustomization.yaml | 환경별 오버라이드 |
| **에코시스템** | 방대한 Chart Hub | K8s 내장 | Docker 생태계 |
| **대상** | DevOps/SRE | 플랫폼 팀 | Compose 사용 개발자 |

### Helm의 강점과 약점

**강점:**
- 가장 성숙한 에코시스템 (수천 개의 공개 Chart)
- 릴리스 관리, 롤백 내장
- 복잡한 멀티컴포넌트 앱 배포에 적합

**약점:**
- Go 템플릿 문법이 진입장벽
- Chart 구조 이해에 시간 소요
- 템플릿이 복잡해지면 디버깅 어려움

### Kustomize의 강점과 약점

**강점:**
- kubectl에 내장 (추가 도구 불필요)
- 선언적, 패치 기반으로 직관적
- 기존 YAML을 그대로 사용

**약점:**
- 복잡한 조건부 로직 어려움
- 대규모 오버레이 관리 시 디렉토리 구조 복잡

### Kanvas의 차별점

**강점:**
- Docker Compose 파일에서 바로 시작
- 로컬 개발 → K8s 배포 간 간극 최소화
- Docker Desktop과의 통합

**약점:**
- 신규 도구 (에코시스템 미성숙)
- Compose의 추상화 수준이 K8s와 다름
- 복잡한 K8s 기능(CRD, Operator 등) 표현 한계

![컨테이너 기술](/images/2026-03-21-Docker-Kanvas-Helm-Kustomize/container.jpg)

## 누가 Kanvas를 써야 하는가?

### ✅ 적합한 경우

| 시나리오 | 이유 |
|---------|------|
| **Compose 기반 앱의 K8s 마이그레이션** | 기존 Compose 파일을 그대로 활용 |
| **K8s 입문자** | Helm/Kustomize 학습 없이 시작 |
| **빠른 프로토타이핑** | 로컬 → K8s 즉시 배포 |
| **소규모 팀** | DevOps 전담 인력 없이 배포 |

### ⚠️ 부적합한 경우

| 시나리오 | 이유 |
|---------|------|
| **복잡한 마이크로서비스** | Helm의 의존성 관리가 필요 |
| **기존 Helm 에코시스템 활용** | Chart 전환 비용 > 이익 |
| **CRD/Operator 의존** | Compose 추상화로 표현 어려움 |
| **GitOps 파이프라인** | ArgoCD/Flux는 Helm/Kustomize 네이티브 |

## 실전 비교 — 간단한 웹 앱 배포

같은 앱을 세 도구로 배포할 때의 차이를 비교해보자.

### Docker Compose (원본)

```yaml
# docker-compose.yml
services:
  web:
    image: myapp:latest
    ports:
      - "8080:80"
    environment:
      - DB_HOST=db
  db:
    image: postgres:16
    volumes:
      - db-data:/var/lib/postgresql/data
volumes:
  db-data:
```

### Helm

```yaml
# values.yaml + templates/deployment.yaml + templates/service.yaml
# + Chart.yaml + ... (최소 5개 파일)
replicaCount: 1
image:
  repository: myapp
  tag: latest
service:
  port: 80
postgresql:
  enabled: true
```

### Kustomize

```yaml
# base/deployment.yaml + base/service.yaml + base/kustomization.yaml
# + overlays/prod/kustomization.yaml (최소 4개 파일)
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
```

### Kanvas

```bash
# docker-compose.yml 그대로 사용
kanvas convert docker-compose.yml --output k8s/
```

파일 수만 봐도 차이가 명확하다. Kanvas는 **시작 비용이 가장 낮다**.

## K8s 배포 도구의 미래

Kanvas의 등장은 K8s 도구 시장의 분화를 보여준다:

1. **Helm** — 여전히 복잡한 앱과 에코시스템의 왕
2. **Kustomize** — GitOps와 플랫폼 팀의 표준
3. **Kanvas** — Compose 세계에서 K8s로의 다리

세 도구가 공존하는 것이 자연스러운 결과일 수 있다. 마치 프로그래밍 언어처럼, 각각의 강점이 다른 사용 사례에 적합하기 때문이다.

특히 Kubernetes 1.36에서 Ingress-Nginx가 은퇴하고 Gateway API로 전환되는 시점에서, 배포 도구들이 이 변화를 어떻게 흡수하는지도 지켜볼 만하다.

## 마무리

Docker Kanvas는 **"Compose를 쓰는데 K8s로 가고 싶은"** 개발자에게 가장 빠른 다리를 제공한다. Helm의 깊이나 Kustomize의 유연성을 대체하지는 않지만, K8s 배포의 진입장벽을 확실히 낮춘다.

이미 Helm이나 Kustomize에 능숙하다면 Kanvas를 급하게 도입할 필요는 없다. 하지만 팀에 Compose만 아는 개발자가 있거나, 빠른 프로토타이핑이 필요하다면 한 번 살펴볼 가치가 있다.

---

## 참고 자료

- [Docker Kanvas 공식 문서](https://docs.docker.com/kanvas/)
- [InfoQ — Docker Kanvas Challenges Helm and Kustomize](https://www.infoq.com/news/2026/01/docker-kanvas-cloud-deployment/)
- [Helm 공식 문서](https://helm.sh/)
- [Kustomize 공식 문서](https://kustomize.io/)
