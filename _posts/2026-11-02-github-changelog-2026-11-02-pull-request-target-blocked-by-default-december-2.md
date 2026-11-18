---
title: '12월부터 막히는 pull_request_target: 포크 PR의 시크릿 노출 경로를 재현하고 안전하게 전환하기'
date: 2026-11-02 09:00:01 +0900
categories: ["개발/도구"]
description: 'GitHub Actions의 pull_request_target 기본 차단을 앞두고 evaluate mode와 brownout을 활용해 영향 범위를 찾고, 포크 PR의 비신뢰 코드를 시크릿과 분리하는 전환 절차를 정리합니다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-github-changelog-2026-11-02-pull-request-target-blocked-by-default-december-2/1600/900'
tags: [github-actions, pull-request-target, fork, secrets, workflow-security, ci-cd]
---

![어두운 작업실의 모니터와 갈라진 빛의 경계](https://picsum.photos/seed/news-2026-11-02-github-changelog-2026-11-02-pull-request-target-blocked-by-default-december-2/1600/900)

GitHub는 2026년 12월 2일부터 github.com의 모든 공개 저장소에서 적용 가능한 Actions 이벤트 정책이 명시적으로 허용하지 않는 한 `pull_request_target` 실행을 기본 차단한다. 11월 9일과 16일 16:00–18:00 UTC에는 실제 차단을 미리 경험하는 brownout도 진행한다.[1]

핵심은 이벤트 이름을 바꾸는 일이 아니라 **신뢰 경계를 다시 그리는 일**이다. `pull_request_target`은 base 저장소 컨텍스트에서 실행돼 시크릿에 접근할 수 있다. 이 상태에서 포크의 비신뢰 코드를 checkout해 실행하면 토큰 탈취 경로가 열린다.[1]

## 먼저 영향 범위를 읽는다

기본 규칙은 enforcement 전 evaluate mode로 동작한다. Insights에서 어떤 실행이 막힐지 확인하고 워크플로 파일, 호출 경로, 필요한 권한을 목록화한다. Brownout에서 막힌 시도는 실패 run과 error annotation을 남기며 워크플로 자체는 실행되지 않는다. 창이 끝나면 규칙은 다시 경고만 내는 evaluate mode로 돌아간다.[1]

다음 표를 워크플로별로 채우면 “허용할 것인가”를 이벤트 이름만 보고 결정하는 실수를 줄일 수 있다.

| 항목 | 기록할 값 |
|---|---|
| 트리거 | `pull_request_target`을 직접 쓰는 파일과 reusable workflow |
| checkout | base SHA인지 fork head SHA인지 |
| 권한 | `contents`, `pull-requests`, `issues`, `id-token`의 실제 필요 범위 |
| 비밀 | repository·environment secret과 OIDC 사용 여부 |
| 실행 | PR이 바꿀 수 있는 script, action, package lifecycle |
| 대안 | `pull_request`, 수동 승인, 두 단계 artifact 전달 |

## 최소 취약 fixture는 이렇게 만든다

아래는 **실행 결과가 아니라 검토용으로 제안하는 fixture**다. 격리된 실습 저장소에서만 만들고 실제 시크릿 대신 무가치한 canary를 사용한다.

{% raw %}
```yaml
name: unsafe-target-demo
on: pull_request_target
permissions:
  contents: read
jobs:
  demo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full-commit-sha>
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: ./ci/from-pr.sh
        env:
          CANARY: ${{ secrets.NON_PRODUCTION_CANARY }}
```
{% endraw %}

위 구조의 위험은 action pin 여부와 별개다. 공격자가 바꿀 수 있는 `ci/from-pr.sh`를 base 컨텍스트의 secret과 같은 job에서 실행하기 때문이다. 실험 목적은 canary 값 자체를 노출하는 것이 아니라 정책이 이 run을 예상대로 탐지·차단하는지 확인하는 데 있다.

## 가장 안전한 기본 전환

빌드와 테스트가 목적이면 `pull_request`로 옮기고 read-only 권한에서 fork 코드를 실행한다. 이 경로에서는 일반적으로 base 저장소 시크릿을 전달하지 않는다. 라벨 부여나 댓글 작성처럼 권한 있는 후처리가 필요하면 untrusted job이 만든 결과를 데이터로만 전달하고, 별도 trusted workflow가 형식과 출처를 검증한 뒤 최소 권한으로 처리한다.

```yaml
name: fork-ci
on: pull_request
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full-commit-sha>
      - run: ./ci/test.sh
```

`pull_request_target`이 정말 필요하다면 포크 head를 checkout하거나 PR이 수정할 수 있는 스크립트·설정·package lifecycle을 실행하지 않는다. 정책의 workflow file targeting으로 특정 파일만 허용할 수 있지만, **명시적 허용은 취약한 workflow를 안전하게 고치는 기능이 아니다**.[1]

## 전환 승인 기준

1. evaluate mode 예상 차단 목록을 저장한다.
2. 공개 저장소의 모든 대상 workflow를 소유자와 함께 분류한다.
3. `pull_request` 전환 fixture에서 fork PR이 테스트되되 secret이 전달되지 않음을 확인한다.
4. 권한 있는 후처리는 별도 workflow와 최소 권한으로 격리한다.
5. 두 brownout에서 의도하지 않은 실패가 없는지 확인한다.
6. 12월 2일 이후 정책을 다시 읽어 실제 enforcement 상태를 기록한다.

이 변경은 GitHub Free·Team·Enterprise Cloud의 공개 저장소에 적용된다. Private·internal 저장소와 GitHub Enterprise Server에는 적용되지 않는다.[1] 적용 대상이 아니더라도 같은 취약 패턴이 안전하다는 뜻은 아니다. 이번 일정은 점검 계기이고, 승인 기준은 언제나 “비신뢰 코드와 권한 있는 컨텍스트가 같은 실행 경로에 있는가”여야 한다.

## Sources

[1] https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2/
