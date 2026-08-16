---
title: 'Kubernetes는 왜 YAML을 버리지 않고 KYAML을 만들었나'
date: 2026-08-16 09:00:00
categories: ["개발/인프라"]
description: 'KYAML은 새로운 설정 언어가 아니라 Kubernetes가 실제로 쓰는 YAML의 안전한 부분집합이다. 문법, kubectl 지원 범위, 도입 전략과 한계를 정리한다.'
featured_image: 'https://picsum.photos/seed/kubernetes-kyaml-strict-yaml/1600/900'
tags: [kubernetes, kyaml, yaml, kubectl, devops, configuration]
---

![Kubernetes KYAML](https://picsum.photos/seed/kubernetes-kyaml-strict-yaml/1600/900)

Kubernetes manifest를 작성해 본 사람이라면 YAML의 장점과 단점을 모두 알고 있다. 사람이 읽기 편하고 주석을 남길 수 있지만, 들여쓰기 하나로 구조가 바뀌고 따옴표를 생략한 값이 예상하지 못한 타입으로 해석될 수 있다. Helm 템플릿까지 섞이면 문제는 더 복잡해진다.

Kubernetes SIG CLI가 제안한 KYAML은 이 문제를 새로운 설정 언어로 해결하지 않는다. 기존 YAML에서 Kubernetes에 꼭 필요하지 않은 선택지를 줄이는 방식을 택했다. 핵심은 호환성을 버리지 않으면서 모호성을 줄이는 것이다.

KYAML을 "YAML의 후속 포맷"으로 이해하면 과장이다. 더 정확한 표현은 Kubernetes manifest를 위한 엄격한 YAML 작성 규칙이다.

## KYAML은 새로운 parser가 아니다

KYAML은 KEP 5295에서 제안된 YAML의 엄격한 부분집합이다. KYAML로 유효한 문서는 기존 YAML parser에서도 유효하다. 별도의 확장자나 새로운 parser가 필요한 것이 아니다.

이 선택은 운영에서 중요하다. 설정 언어를 새로 만들면 다음 비용이 따라온다.

- IDE와 syntax highlighting 지원
- formatter와 linter 개발
- 기존 Helm, Kustomize, CI 도구와의 호환성
- 조직 내부 템플릿과 교육 자료의 전환
- 오래된 클러스터와 클라이언트 지원

KYAML은 이 비용을 피한다. 기존 도구에는 여전히 YAML로 보이지만, 작성 형식을 더 결정적으로 제한한다.

일반적인 YAML manifest는 다음처럼 작성한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  labels:
    app: demo
spec:
  containers:
    - name: nginx
      image: nginx:1.20
```

같은 문서를 KYAML 스타일로 표현하면 구조가 더 명시적으로 보인다.

```yaml
---
{
  apiVersion: "v1",
  kind: "Pod",
  metadata: {
    name: "my-pod",
    labels: {
      app: "demo",
    },
  },
  spec: {
    containers: [{
      name: "nginx",
      image: "nginx:1.20",
    }],
  },
}
```

JSON과 비슷하지만 주석과 trailing comma를 허용한다. YAML의 flow style을 일관된 규칙으로 사용하는 셈이다.

## KYAML이 줄이려는 두 가지 위험

첫 번째는 들여쓰기 의존성이다. YAML에서는 들여쓰기가 구조다. 잘못 들여쓴 문서가 syntax error로 끝나면 그나마 낫다. 더 위험한 경우는 문법적으로는 유효하지만 개발자가 의도한 것과 다른 객체가 만들어지는 경우다.

Helm에서는 이 문제가 더 자주 나타난다. 템플릿 엔진이 YAML 바깥에서 문자열과 들여쓰기를 조립하기 때문이다. `indent`, `nindent`, 조건문이 중첩되면 최종 렌더링 결과를 보기 전까지 구조를 확신하기 어렵다.

두 번째는 암묵적 타입 변환이다. YAML 버전과 parser에 따라 문자열처럼 보이는 값이 boolean이나 숫자로 해석될 수 있다. 대표적인 사례가 이른바 Norway Bug다.

```yaml
country: NO
```

사람은 국가 코드 문자열 `NO`로 읽지만 일부 YAML 해석에서는 `false`가 될 수 있다. Kubernetes API schema가 잘못된 타입을 거부할 수도 있지만, 모든 중간 도구와 CRD가 같은 방식으로 방어한다고 가정해서는 안 된다.

KYAML은 문자열 값을 항상 따옴표로 감싸고 map에는 `{}`, list에는 `[]`를 사용한다. 구조와 타입을 눈치가 아니라 문법으로 드러내려는 선택이다.

## JSON으로 바꾸면 되지 않을까

JSON도 Kubernetes manifest로 사용할 수 있다. 구조가 명시적이고 암묵적 타입 변환도 적다. 그렇다면 KYAML 대신 JSON을 표준으로 삼으면 된다는 반론이 가능하다.

하지만 JSON은 사람이 관리하는 설정 파일로 불편한 부분이 있다.

- 표준 JSON에는 주석이 없다.
- trailing comma를 허용하지 않는다.
- 모든 key를 따옴표로 감싸야 한다.
- 작은 수정에서도 diff가 장황해질 수 있다.

KYAML은 JSON의 명시성과 YAML의 주석·작성 편의 사이를 노린다. 모든 사람이 더 읽기 좋다고 느낄지는 별개다. 중괄호가 늘어나면 기존 block style보다 시각적 노이즈가 커진다는 반론도 타당하다.

그래서 KYAML의 가치는 미관보다 결정성에서 찾아야 한다. 여러 사람이 같은 객체를 서로 다른 스타일로 쓰는 선택지를 줄이고 formatter가 하나의 결과를 만들기 쉽게 한다.

## kubectl에서는 어떻게 사용할까

Kubernetes 공식 블로그에 따르면 `kubectl -o kyaml`은 Kubernetes 1.34에서 alpha로 도입됐고 1.35에서는 기능이 기본 활성화된 beta 상태다. 단, 기본 출력이 KYAML로 바뀌는 것은 아니다. 사용자가 여전히 `-o kyaml`을 지정해야 하며 KYAML을 기본 출력으로 만들 계획도 현재는 없다.

```bash
# Kubernetes 1.35+
kubectl get deployment my-app -o kyaml

# Kubernetes 1.34 alpha
export KUBECTL_KYAML=true
kubectl get deployment my-app -o kyaml
```

기존 파일을 변환할 때는 Kubernetes SIG의 `yamlfmt`나 Google `yamlfmt`의 KYAML formatter를 사용할 수 있다. 중요한 것은 곧바로 전체 저장소를 덮어쓰지 않는 것이다.

```bash
# 먼저 diff 확인
yamlfmt -o=kyaml -d deployment.yaml

# 출력 결과를 별도 파일로 검토
kubectl get deployment my-app -o kyaml > deployment.kyaml.yaml
```

변환 후에는 최소한 schema validation, Helm render, Kustomize build, admission policy 테스트를 다시 실행해야 한다. 문법적으로 유효한 YAML이라는 사실이 운영 의도까지 보장하지는 않는다.

## 도입은 formatter보다 diff 정책이 중요하다

KYAML을 조직에 도입할 때 가장 큰 비용은 parser 교체가 아니라 대규모 formatting diff다. 수백 개 manifest를 한 번에 변환하면 실제 설정 변경과 표현 변경을 구분하기 어려워진다.

안전한 순서는 다음과 같다.

1. 새 manifest 한두 개에만 시험 적용한다.
2. 기존 CI와 배포 도구가 그대로 읽는지 확인한다.
3. formatter 전용 PR과 기능 변경 PR을 분리한다.
4. Helm chart는 template 원본과 렌더링 결과를 따로 검증한다.
5. CRD의 문자열·숫자·boolean 필드가 유지되는지 확인한다.
6. 팀이 가독성 비용을 받아들일 수 있는지 리뷰한다.
7. 효과가 확인되면 pre-commit 또는 CI check로 확장한다.

formatter를 도입하면서 개인별 설정을 허용하면 다시 스타일 차이가 생긴다. 조직 차원의 목적이 결정성이라면 버전과 실행 옵션도 저장소에 고정해야 한다.

반대로 모든 manifest를 KYAML로 바꿀 필요는 없다. 사람이 자주 수정하는 작은 파일은 기존 block YAML이 더 읽기 쉬울 수 있다. 생성된 manifest, 복잡한 중첩 구조, 기계적 diff가 중요한 파일부터 적용하는 편이 합리적이다.

## 에이전트가 manifest를 작성하는 시대의 의미

KYAML은 AI 에이전트와 직접 관련된 기능은 아니다. 하지만 에이전트가 설정 파일을 생성하고 수정하는 환경에서는 결정적인 표현이 더 중요해진다.

사람은 주변 문맥을 보고 이상한 들여쓰기나 값 타입을 의심한다. 에이전트는 syntax가 유효하면 작업을 완료했다고 판단하기 쉽다. 같은 객체를 표현하는 방법이 많을수록 불필요한 diff와 리뷰 비용도 늘어난다.

KYAML이 에이전트의 논리 오류를 막아주지는 않는다. 잘못된 image tag, 과도한 권한, 누락된 resource limit은 여전히 유효한 KYAML로 작성할 수 있다. 따라서 다음 검증은 그대로 필요하다.

- API schema와 server-side dry-run
- 정책 엔진을 통한 권한·보안 검증
- Helm/Kustomize 렌더링 결과 비교
- 실제 배포 전 diff와 승인
- production 변경에 대한 GitOps 경로

KYAML은 안전 장치 하나이지 안전한 배포 시스템 전체가 아니다.

## 결론

KYAML의 핵심은 YAML을 버리는 데 있지 않다. Kubernetes가 실제로 필요로 하는 부분만 남겨 구조와 타입을 더 명시적으로 만드는 데 있다. 새로운 parser와 생태계를 만들지 않기 때문에 도입 장벽은 낮지만, 중괄호가 늘어나는 가독성 비용과 대규모 formatting diff는 감수해야 한다.

따라서 전면 전환보다 선택적 도입이 낫다. 생성 파일이나 복잡한 manifest부터 시험하고, formatter PR과 기능 변경을 분리하며, 기존 CI와 정책 검증을 그대로 유지해야 한다.

좋은 설정 형식은 실수를 완전히 없애지 않는다. 대신 같은 내용을 표현하는 선택지를 줄이고, 리뷰어와 도구가 실제 변경에 집중하도록 돕는다. KYAML의 현실적인 가치는 바로 그 지점에 있다.

## 참고 자료

- [Kubernetes Blog: How to Pretty-Print Your Kubernetes YAML as KYAML and Why You'd Want To](https://kubernetes.io/blog/2026/08/11/how-to-pretty-print-kubernetes-yaml-as-kyaml/)
- [KEP 5295: Introducing KYAML](https://github.com/kubernetes/enhancements/tree/master/keps/sig-cli/5295-kyaml)
