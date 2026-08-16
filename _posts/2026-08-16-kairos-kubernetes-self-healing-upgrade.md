---
title: '11분 무인 Kubernetes 업그레이드보다 중요한 concurrency: 1'
date: 2026-08-16 10:00:00
categories: ["개발/인프라"]
description: 'Kairos와 GitOps 도구로 Kubernetes 노드를 자동 업그레이드한 사례를 통해 A/B 롤백, 서명 검증, etcd quorum과 동시성 실패 모드를 살펴본다.'
featured_image: 'https://picsum.photos/seed/kairos-kubernetes-self-healing-upgrade/1600/900'
tags: [kubernetes, kairos, gitops, argocd, etcd, cosign, kyverno, platform-engineering]
---

![Kairos Kubernetes 무인 업그레이드](https://picsum.photos/seed/kairos-kubernetes-self-healing-upgrade/1600/900)

Kubernetes control plane 업그레이드는 자동화하기 좋은 작업처럼 보인다. 버전을 올리고 노드를 한 대씩 재부팅한 뒤 health check를 통과하면 다음 노드로 이동하면 된다. 하지만 이 짧은 설명에는 실패 지점이 빠져 있다.

새 이미지가 잘못됐을 수 있다. 공급망에서 변조됐을 수 있다. 노드가 돌아오지 않을 수 있다. 순차 실행이라고 믿었던 설정이 모든 노드를 동시에 재부팅할 수도 있다. etcd quorum을 잃으면 "자동화가 조금 실패한 것"이 아니라 control plane 전체가 멈춘다.

CNCF 블로그에 공개된 Kairos 기반 사례는 업그레이드를 약 11분 만에 사람 개입 없이 끝낸 성공담이다. 그러나 더 중요한 부분은 이전 설정에서 `concurrency: 0`을 한 번에 한 노드로 오해해 control-plane 세 대가 동시에 재부팅됐다는 실패다. 시스템이 살아남은 것은 설계가 아니라 운이었다.

## 파이프라인은 여섯 도구가 한 역할씩 맡는다

사례의 환경은 세 control-plane 노드로 구성된 K3s HA 클러스터다. 운영체제는 Kairos Hadron을 사용하고 Cilium CNI가 설치돼 있다. 업그레이드 경로에는 여러 CNCF 도구가 연결된다.

- Renovate: 새 Kairos image tag를 감지하고 PR 생성
- Kyverno: 허용한 image source와 형식을 admission 단계에서 검증
- Cosign: 이미지가 신뢰한 CI identity에서 서명됐는지 확인
- Argo CD: merge된 변경을 cluster에 reconcile
- kairos-operator: 노드를 cordon하고 A/B slot을 갱신한 뒤 재부팅
- Git 저장소와 CI: 변경 이력, 검증, 승인 경로 제공

각 도구의 역할은 좁다. Renovate가 배포하지 않고, Argo CD가 image provenance를 판단하지 않으며, Cosign이 노드 순서를 관리하지 않는다. 이 경계가 명확해야 실패 원인을 추적할 수 있다.

"도구를 많이 썼다"가 좋은 설계라는 뜻은 아니다. 작은 환경에서는 운영 복잡성이 더 커질 수도 있다. 중요한 것은 필요한 안전 속성을 어떤 계층에서 책임질지 명시하는 것이다.

## A/B 파티션이 롤백을 단순하게 만든다

Kairos는 immutable OS 접근을 사용한다. 실행 중인 시스템을 package manager로 조금씩 patch하는 대신 새 OS image를 비활성 partition에 기록하고 다음 boot에서 전환한다.

개념적으로는 다음과 같다.

```text
현재 부팅: Slot A, version 1.0
업그레이드: Slot B에 version 1.1 기록
재부팅: Slot B로 전환
실패: Slot A로 되돌림
```

이 구조의 장점은 상태 전이를 이해하기 쉽다는 점이다. package update가 중간에 끊겨 반쯤 변경된 OS가 남는 문제를 줄이고, 이전 image가 남아 있어 rollback 경로가 명확하다.

하지만 A/B partition이 모든 상태를 복구하지는 않는다. OS는 되돌릴 수 있어도 다음 항목은 별개다.

- etcd data와 Kubernetes object
- workload의 persistent volume
- 외부 데이터베이스 migration
- CNI와 kernel 호환성
- control-plane component의 version skew
- 새 버전에서 생성한 configuration state

따라서 "A/B이므로 안전한 업그레이드"라는 결론은 과하다. A/B는 host OS rollback을 단순화할 뿐 cluster state 전체의 transaction을 제공하지 않는다.

## concurrency: 0이 만든 가장 위험한 오해

사례에서 가장 중요한 실패는 동시성 설정이었다. 작성자는 `concurrency: 0`을 한 번에 하나씩 실행하는 의미로 이해했지만 실제 동작은 모든 노드를 동시에 처리하는 것이었다. 세 control-plane 노드가 한꺼번에 재부팅됐다.

HA control plane에서 etcd는 과반수 quorum이 필요하다. 세 멤버라면 일반적으로 두 멤버가 통신 가능해야 정상적으로 합의를 진행할 수 있다. 세 대를 동시에 내리면 quorum을 보장할 수 없다.

테스트 환경에서 살아남았다는 사실은 안전성을 증명하지 않는다. 다음 실행에서는 boot 지연, image pull 실패, disk 문제, network partition이 겹칠 수 있다.

수정된 핵심은 단순하다.

```yaml
spec:
  concurrency: 1
```

그러나 숫자 하나만 고치는 것으로 끝나서는 안 된다. 안전 조건을 검증하는 테스트가 필요하다.

- 동시에 cordon 상태가 되는 control-plane 노드는 한 대 이하인가
- 다음 노드로 이동하기 전에 이전 노드가 Ready인가
- etcd endpoint health와 member 수가 정상인가
- timeout 후 자동 중단하는가
- operator 재시작 후 진행 상태를 복구하는가
- 이미 실행 중인 upgrade와 중복 생성되지 않는가

설정의 의미는 이름으로 추측하면 안 된다. 특히 `0`, empty list, null은 제품마다 unlimited, disabled, default처럼 전혀 다르게 해석된다.

## 공급망 검증은 tag 확인보다 깊어야 한다

Kyverno policy는 upgrade CR이 예상한 repository와 tag 형식을 사용하는지 검사한다. 이는 typo와 명백한 비승인 registry를 막는 데 유용하다.

하지만 `quay.io/kairos/hadron:*` 형식만 허용한다고 해서 그 image가 신뢰할 수 있다는 뜻은 아니다. tag는 이동할 수 있고 registry account가 침해될 수 있다.

Cosign 검증은 한 단계 더 나아간다. image가 예상한 GitHub Actions OIDC identity에서 생성됐는지 확인한다. 여기서 검증해야 할 것은 단순히 "서명이 있다"가 아니다.

- 어떤 issuer가 서명했는가
- 어떤 repository와 workflow identity인가
- image digest가 검증 대상과 일치하는가
- policy가 tag가 아니라 digest에 묶여 있는가
- 서명 검증 실패 시 fail closed 하는가

서명된 악성 image도 가능하다. 신뢰한 CI workflow 자체가 오염되면 정상 identity로 서명될 수 있다. provenance 검증은 dependency scanning, build isolation, review policy를 대체하지 않는다.

## GitOps가 자동 승인이라는 뜻은 아니다

Renovate가 PR을 만들고 merge되면 Argo CD가 변경을 감지해 cluster에 적용한다. 이 흐름은 모든 상태 전이를 Git에 남긴다는 장점이 있다.

그러나 자동 생성 PR을 자동 merge하고 곧바로 control-plane 업그레이드까지 연결하면 GitOps가 단순한 배포 trigger가 된다. 저장소에 기록이 남는 것과 변경이 안전한 것은 다르다.

control-plane 변경에는 최소한 다음 gate가 필요하다.

1. 새 image와 signature 검증
2. version skew와 breaking change 확인
3. test cluster 또는 canary node 적용
4. etcd snapshot과 복구 가능성 확인
5. maintenance window 또는 명시적 승인
6. 순차 실행 및 각 단계 health gate
7. 실패 시 중단과 rollback

완전 무인 실행이 항상 목표일 필요는 없다. detection과 검증은 자동화하되 production merge에는 사람 승인을 남기는 구조가 더 합리적인 조직도 많다.

## self-healing이라는 표현을 조심해야 한다

노드가 재부팅 후 돌아오고 실패 시 이전 slot으로 부팅하는 동작은 self-healing에 가깝다. 하지만 시스템이 모든 실패 원인을 이해하고 스스로 수정하는 것은 아니다.

다음 상황에서는 사람 개입이 필요할 수 있다.

- 이전 slot도 부팅되지 않는다.
- firmware나 disk 장애가 발생한다.
- etcd data corruption이 생긴다.
- CNI가 새 kernel과 호환되지 않는다.
- rollback 후에도 Kubernetes component가 불일치한다.
- operator가 잘못된 성공 상태를 기록한다.

따라서 runbook과 break-glass 접근은 여전히 필요하다. 콘솔 접근, 이전 image 선택, etcd snapshot restore, 노드 교체 절차를 실제로 연습해야 한다. 자동화가 정상 경로를 빠르게 만들수록 비정상 경로는 더 드물게 사용되고, 그만큼 복구 절차가 낡기 쉽다.

## 실무 체크리스트

비슷한 파이프라인을 설계한다면 다음 질문에 답할 수 있어야 한다.

### 변경 전

- control-plane과 worker의 version skew 정책은 무엇인가
- etcd snapshot은 최신이며 restore 테스트를 했는가
- image digest와 서명 identity를 검증하는가
- canary 환경에서 동일한 경로를 실행했는가
- 동시에 중단 가능한 최대 노드 수를 계산했는가

### 실행 중

- 한 번에 몇 노드를 cordon·reboot하는가
- Ready뿐 아니라 etcd와 CNI health도 확인하는가
- 다음 단계로 넘어가는 timeout과 retry 정책은 무엇인가
- operator와 Argo CD의 중복 reconcile이 멱등적인가
- 관찰 가능한 run ID와 단계별 이벤트가 남는가

### 실패 후

- 자동 중단과 rollback 조건이 명확한가
- 이전 A/B slot로 돌아가는 데 필요한 접근 수단이 있는가
- etcd quorum 상실 시 복구 절차가 있는가
- 부분 성공한 노드와 실패한 노드를 구분할 수 있는가
- 다시 실행할 때 중복 작업이 발생하지 않는가

이 질문에 답하지 못하면 11분이라는 숫자는 운영 성숙도를 보여주지 않는다.

## 결론

Kairos 기반 사례의 흥미로운 점은 무인 업그레이드가 빨랐다는 사실보다 여러 안전 장치를 한 경로에 연결했다는 데 있다. Renovate는 변경을 발견하고, Kyverno와 Cosign은 입력을 검증하며, Argo CD는 선언 상태를 적용하고, kairos-operator는 노드를 순차 처리한다. A/B partition은 host OS rollback을 단순화한다.

동시에 `concurrency: 0` 실패는 자동화의 본질을 보여준다. 잘못 이해한 설정 하나가 사람보다 더 빠르고 일관되게 전체 control plane을 위험에 빠뜨릴 수 있다.

좋은 자동화는 사람을 제거하는 시스템이 아니다. 허용 가능한 실패 범위를 코드로 표현하고, 그 범위를 넘으면 즉시 멈추며, 사람이 복구할 수 있는 증거와 경로를 남기는 시스템이다.

## 참고 자료

- [CNCF Blog: Eleven minutes, zero humans — Building a self-healing Kubernetes upgrade pipeline on Kairos](https://www.cncf.io/blog/2026/08/14/eleven-minutes-zero-humans-building-a-self-healing-kubernetes-upgrade-pipeline-on-kairos/)
- [Kairos Documentation](https://kairos.io/docs/)
- [etcd Disaster Recovery](https://etcd.io/docs/latest/op-guide/recovery/)
