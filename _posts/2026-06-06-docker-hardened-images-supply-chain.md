---
title: 'Docker Hardened Images — 컨테이너 보안의 출발점은 베이스 이미지다'
date: 2026-06-06 10:00:00
categories: ["개발/인프라"]
description: 'Docker Hardened Images와 소프트웨어 공급망 보안 흐름을 바탕으로, 컨테이너 보안은 런타임 정책 이전에 작은 베이스 이미지, CVE 노출 축소, 서명과 SBOM에서 시작된다는 점을 정리한다.'
featured_image: 'https://picsum.photos/seed/docker-hardened-images-supply-chain/1600/900'
tags: [docker, container-security, supply-chain, devops, sbom]
---

![Docker Hardened Images](https://picsum.photos/seed/docker-hardened-images-supply-chain/1600/900)

컨테이너 보안을 이야기하면 Kubernetes 정책, 런타임 격리, 네트워크 정책, admission controller부터 떠올리기 쉽다. 물론 모두 중요하다. 하지만 많은 보안 문제는 그보다 앞에서 시작된다. 바로 베이스 이미지다.

Docker는 최근 Hardened Images, 소프트웨어 공급망 보안, 샌드박스 보안, AI 에이전트 보안 같은 주제를 연달아 다루고 있다. 이 흐름은 컨테이너 운영에서 중요한 메시지를 준다. 보안은 배포 후에 덧붙이는 정책이 아니라, 이미지가 만들어지는 순간부터 시작된다.

특히 AI 에이전트가 코드를 만들고 Dockerfile을 수정하는 환경에서는 이 문제가 더 중요해진다. 사람이 직접 확인하지 않은 이미지가 CI를 통과하고 배포될 수 있기 때문이다.

## 베이스 이미지는 상속되는 위험이다

Dockerfile은 보통 `FROM`으로 시작한다. 이 한 줄이 전체 이미지의 출발점이다.

```dockerfile
FROM node:24
```

문제는 이 베이스 이미지가 단순한 런타임이 아니라 많은 패키지와 설정을 포함한다는 점이다. 운영체제 패키지, 셸, 패키지 매니저, 인증서, 유틸리티, 기본 사용자, 파일 권한이 모두 따라온다. 애플리케이션 코드를 아무리 안전하게 작성해도 베이스 이미지에 불필요한 공격면이 많으면 위험은 남는다.

베이스 이미지의 위험은 상속된다. 개발자는 직접 설치하지 않았다고 생각하지만, 이미지 안에는 이미 많은 구성요소가 들어 있다. 그중 일부에 CVE가 있으면 스캐너는 애플리케이션 이미지 전체를 취약하다고 판단한다.

## Hardened Image의 목적

Hardened Image의 목적은 단순히 이미지 크기를 줄이는 것이 아니다. 공격면을 줄이고, 운영자가 설명 가능한 상태를 만드는 것이다.

핵심 방향은 다음과 같다.

- 불필요한 패키지 제거
- 셸과 디버깅 도구 최소화
- 기본 권한 축소
- 고정된 버전과 출처 관리
- CVE 노출 감소
- SBOM과 서명 같은 공급망 메타데이터 제공

이미지가 작아지면 다운로드와 배포 속도도 좋아질 수 있다. 하지만 더 중요한 것은 "무엇이 들어 있는지"를 알 수 있다는 점이다. 컨테이너 보안에서 모르는 구성요소는 곧 운영 리스크다.

## 작은 이미지가 항상 정답은 아니다

여기서 주의할 점이 있다. 작은 이미지가 무조건 안전한 것은 아니다. `scratch`나 distroless 이미지는 공격면을 줄이지만, 운영 난도를 높일 수 있다. 장애가 났을 때 셸이 없고, 네트워크 도구가 없고, 인증서 경로가 다르면 디버깅이 어려워진다.

따라서 선택은 서비스 성격에 따라 달라진다.

- 외부 노출 API: 공격면 최소화가 중요하다.
- 내부 배치 작업: 디버깅 편의와 재현성이 더 중요할 수 있다.
- 금융/보안 민감 서비스: 서명, SBOM, provenance가 필수에 가깝다.
- 빠르게 변하는 개발 환경: 너무 엄격한 이미지 정책이 생산성을 떨어뜨릴 수 있다.

운영 현실에서는 production image와 debug image를 분리하는 방식이 자주 유용하다. 배포 이미지는 최소화하고, 장애 대응용 이미지는 별도로 관리한다.

## Dockerfile에서 바로 할 수 있는 것

Hardened Image를 쓰지 않더라도 기본 원칙은 적용할 수 있다.

### 1. 태그를 명확히 고정한다

`latest`는 편하지만 재현성을 해친다.

```dockerfile
# 피하는 편이 좋다
FROM node:latest

# 더 낫다
FROM node:24.16.0-bookworm-slim
```

더 엄격한 환경에서는 digest pinning도 검토할 수 있다. 단, digest를 고정하면 보안 업데이트를 자동으로 받지 못하므로 갱신 프로세스가 필요하다.

### 2. 멀티스테이지 빌드를 사용한다

빌드 도구와 런타임 도구를 분리해야 한다.

```dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
USER node
CMD ["node", "dist/server.js"]
```

이 예시는 완벽한 보안 템플릿은 아니지만 방향은 분명하다. 빌드에 필요한 도구를 런타임 이미지에 남기지 않는 것이다.

### 3. root 실행을 피한다

컨테이너 안의 root는 호스트 root와 같지 않지만, 여전히 위험을 키운다. 가능한 경우 non-root user로 실행해야 한다.

```dockerfile
USER node
```

Kubernetes에서는 `runAsNonRoot`, `readOnlyRootFilesystem`, capability drop 같은 설정도 함께 적용하는 것이 좋다.

### 4. 이미지 스캔을 CI에 넣는다

이미지 스캔은 배포 직전 수동 확인이 아니라 CI 단계에 들어가야 한다. 중요한 것은 스캔 도구의 이름보다 정책이다.

- critical CVE가 있으면 실패시킬 것인가?
- fix available이 없는 CVE는 어떻게 처리할 것인가?
- 예외는 누가 승인하는가?
- 예외는 언제 만료되는가?

정책 없이 스캔만 하면 경고가 쌓이다가 아무도 보지 않는 알림이 된다.

## AI 에이전트 시대의 이미지 보안

AI 코딩 에이전트가 Dockerfile을 작성하는 환경에서는 추가 위험이 있다. 에이전트는 동작하는 이미지를 만들기 위해 과도하게 넓은 베이스 이미지를 고를 수 있다. 예를 들어 `ubuntu`를 깔고 필요한 도구를 계속 추가하는 방식은 빠르게 성공할 수 있지만, 운영 이미지는 비대해진다.

따라서 에이전트에게도 정책이 필요하다.

- 허용된 베이스 이미지 목록
- `latest` 금지
- root 실행 금지
- 멀티스테이지 빌드 권장
- 이미지 스캔 필수
- Docker socket 마운트 제한
- 시크릿을 이미지에 복사하지 않기

에이전트가 PR을 만들 수 있다면 CI가 이 정책을 자동으로 검증해야 한다. 리뷰어가 매번 Dockerfile 보안 원칙을 손으로 확인하는 방식은 오래가지 못한다.

## 결론

컨테이너 보안은 런타임에서만 해결되지 않는다. 좋은 네트워크 정책과 admission control이 있어도, 비대한 베이스 이미지와 불명확한 공급망을 그대로 배포하면 위험은 남는다.

Docker Hardened Images 흐름이 보여주는 핵심은 단순하다. 컨테이너 보안의 출발점은 베이스 이미지다. 작고, 설명 가능하고, 검증 가능한 이미지를 만드는 것이 DevOps 보안의 기본선이 되고 있다.

개발팀이 지금 할 수 있는 가장 현실적인 첫 단계는 Dockerfile 표준을 정하고, CI에서 이미지 스캔과 정책 검증을 자동화하는 것이다. 보안은 문서가 아니라 반복 가능한 파이프라인에 들어갈 때 효과가 난다.

## 참고

- Docker Blog: Hardened Images Explained
- Docker Blog: What is Software Supply Chain Security?
- Docker Blog: What is Sandbox Security?
- Docker Blog: How to Secure AI Agents
