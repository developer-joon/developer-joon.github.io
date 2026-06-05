---
title: 'Kubernetes Dashboard에서 Headlamp로 — 운영 UI 전환이 말해주는 것'
date: 2026-06-06 10:40:00
categories: ["개발/인프라"]
description: 'Kubernetes 공식 블로그의 Dashboard에서 Headlamp로의 전환 흐름을 바탕으로, 클러스터 운영 UI는 단순 조회 도구가 아니라 권한, 확장성, 멀티클러스터 운영 모델을 담는 인터페이스라는 점을 정리한다.'
featured_image: 'https://picsum.photos/seed/kubernetes-headlamp-dashboard-transition/1600/900'
tags: [kubernetes, headlamp, dashboard, devops, platform-engineering]
---

![Kubernetes Headlamp 전환](https://picsum.photos/seed/kubernetes-headlamp-dashboard-transition/1600/900)

Kubernetes 운영에서 UI는 애매한 위치에 있었다. 숙련된 운영자는 `kubectl`과 GitOps를 선호한다. 반대로 입문자나 애플리케이션 개발자는 클러스터 상태를 화면으로 보고 싶어 한다. 그래서 Kubernetes Dashboard는 오랫동안 기본적인 시각화 도구 역할을 했다.

최근 Kubernetes 공식 블로그는 Kubernetes Dashboard에서 Headlamp로의 전환을 설명했다. 이 변화는 단순히 대시보드 제품 하나가 바뀌었다는 이야기가 아니다. 클러스터 운영 UI가 어떤 역할을 해야 하는지 다시 생각하게 만든다.

Kubernetes가 팀 전체의 플랫폼이 되면, UI는 단순 조회 화면이 아니라 권한, 확장성, 멀티클러스터 운영, 개발자 셀프서비스를 담는 인터페이스가 된다.

## 왜 운영 UI가 필요한가

`kubectl`은 강력하다. 자동화하기 쉽고, GitOps와 잘 맞고, 모든 리소스를 다룰 수 있다. 하지만 모든 사용자가 같은 수준의 Kubernetes 지식을 갖고 있지는 않다.

애플리케이션 개발자는 보통 다음 정도를 알고 싶어 한다.

- 내 Pod가 떠 있는가?
- 왜 재시작되었는가?
- 최근 로그는 무엇인가?
- 배포가 어느 namespace에 되었는가?
- ingress나 service 주소는 무엇인가?
- resource limit 때문에 죽었는가?

이 질문에 매번 `kubectl describe`, `kubectl logs`, `kubectl get events`를 조합하라고 요구하면 플랫폼팀의 지원 비용이 커진다. UI는 이 간극을 줄인다.

## 기존 Dashboard의 한계

Kubernetes Dashboard는 기본 조회 도구로 유용했지만, 현대적인 플랫폼 운영에는 몇 가지 한계가 있었다.

첫째, 확장성이다. 조직마다 보고 싶은 리소스와 워크플로우가 다르다. CRD, GitOps 상태, policy violation, cost, security scan 결과처럼 기본 Kubernetes 리소스 밖의 정보가 중요해졌다. 단순 리소스 뷰어만으로는 부족하다.

둘째, 권한 모델이다. 운영 UI는 클러스터 권한과 직접 연결된다. 잘못 설계하면 사용자가 UI를 통해 과도한 권한을 얻거나, 반대로 필요한 정보도 보지 못한다. 특히 멀티테넌트 클러스터에서는 RBAC와 UI 경험이 함께 설계되어야 한다.

셋째, 멀티클러스터 운영이다. 이제 많은 팀은 하나의 클러스터만 보지 않는다. dev, staging, production, region별 클러스터, 고객별 클러스터가 나뉜다. 운영 UI가 단일 클러스터 조회에 머물면 실제 운영 흐름과 맞지 않는다.

## Headlamp가 의미하는 방향

Headlamp는 Kubernetes UI를 더 확장 가능한 플랫폼 인터페이스로 보려는 방향과 맞닿아 있다. 중요한 것은 특정 도구를 무조건 도입하라는 뜻이 아니다. 핵심은 운영 UI의 기대치가 바뀌었다는 점이다.

앞으로의 Kubernetes UI는 다음 역할을 해야 한다.

- 기본 리소스 조회
- 로그와 이벤트 확인
- RBAC 기반 접근 제어
- 플러그인 또는 확장 구조
- CRD와 플랫폼 리소스 표현
- 멀티클러스터 컨텍스트
- 개발자 셀프서비스
- 위험한 작업에 대한 가드레일

특히 platform engineering 관점에서는 UI가 중요하다. 플랫폼팀은 모든 개발자에게 Kubernetes 전문가가 되라고 요구하기보다, 안전한 경로를 제공해야 한다. UI는 그 경로 중 하나다.

## UI가 GitOps를 대체하지는 않는다

운영 UI를 도입할 때 흔한 우려가 있다. 사람들이 화면에서 직접 리소스를 수정하면 GitOps 원칙이 깨지는 것 아니냐는 것이다. 이 우려는 타당하다.

운영 UI가 production 리소스를 직접 수정하는 통로가 되면 변경 이력이 분산된다. Git에는 반영되지 않은 수동 변경이 생기고, 나중에 reconcile 과정에서 덮어써질 수 있다.

따라서 UI의 역할을 분리해야 한다.

- 조회와 진단: 적극 허용
- 로그, 이벤트, 상태 확인: 허용
- 일시적 debug action: 제한적으로 허용
- production 설정 변경: GitOps 경로로 유도
- 위험 작업: 승인 또는 별도 권한 필요

좋은 운영 UI는 GitOps를 우회하는 도구가 아니라, GitOps 상태를 이해하고 안전한 변경 경로로 안내하는 도구여야 한다.

## 도입 전에 확인할 질문

Kubernetes 운영 UI를 바꾸거나 새로 도입한다면 다음 질문을 먼저 해야 한다.

### 1. 누가 쓰는가

플랫폼팀만 쓰는 UI와 애플리케이션 개발자도 쓰는 UI는 설계가 다르다. 개발자가 쓴다면 namespace 범위, 읽기 권한, 로그 접근 범위, secret 마스킹이 중요하다.

### 2. 무엇을 허용할 것인가

조회만 허용할지, 재시작이나 scale 같은 작업도 허용할지 정해야 한다. 모든 기능을 열어두면 사고 가능성이 커진다. 반대로 너무 제한하면 아무도 쓰지 않는다.

### 3. GitOps와 어떻게 연결할 것인가

UI에서 본 문제를 어떻게 수정으로 연결할지 정해야 한다. 화면에서 직접 수정할지, PR 생성으로 연결할지, runbook 링크를 제공할지 선택해야 한다.

### 4. 감사 로그가 남는가

운영 UI는 권한 있는 행동을 실행할 수 있다. 누가 어떤 리소스를 봤고, 어떤 작업을 했는지 추적할 수 있어야 한다. 특히 production 클러스터에서는 필수다.

### 5. CRD와 내부 플랫폼 리소스를 보여줄 수 있는가

현대 Kubernetes 환경은 CRD 중심이다. Argo CD, Crossplane, cert-manager, External Secrets, service mesh, policy engine 같은 리소스를 어떻게 보여줄지 고민해야 한다.

## 개발자 경험으로서의 Kubernetes UI

Kubernetes UI는 운영자를 위한 화면에만 머물 필요가 없다. 잘 설계하면 개발자 경험을 개선하는 플랫폼 포털이 될 수 있다.

예를 들어 개발자는 자기 서비스의 배포 상태, 최근 이벤트, 로그, 리소스 사용량, 관련 runbook, 알림 상태를 한 화면에서 볼 수 있다. 문제가 생기면 "왜 실패했는지"와 "다음에 무엇을 해야 하는지"를 UI가 안내할 수 있다.

이때 UI는 단순 대시보드가 아니라 업무 인터페이스가 된다. Kubernetes의 복잡성을 숨기면서도 필요한 정보는 정확히 보여주는 계층이다.

## 결론

Kubernetes Dashboard에서 Headlamp로의 전환은 도구 교체 이상의 의미가 있다. Kubernetes 운영 UI는 이제 단순 리소스 뷰어가 아니라 플랫폼 운영 모델의 일부가 되고 있다.

중요한 것은 어떤 UI를 쓰느냐보다, UI에 어떤 권한과 역할을 줄 것인가다. 조회, 진단, GitOps 연결, RBAC, 감사 로그, CRD 확장성을 함께 설계해야 한다.

클러스터가 커지고 사용자층이 넓어질수록 `kubectl`만으로는 충분하지 않다. 반대로 UI가 모든 것을 직접 수정하는 만능 콘솔이 되어서도 안 된다. 좋은 Kubernetes UI는 운영 복잡성을 줄이되, 변경 통제와 감사 가능성을 해치지 않는 균형점에 있어야 한다.

## 참고

- Kubernetes Blog: From Kubernetes Dashboard to Headlamp: Understanding the Transition
