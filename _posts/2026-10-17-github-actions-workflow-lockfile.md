---
title: 'GitHub Actions lockfile 공개 프리뷰: 태그를 믿지 않고 전이 의존성까지 고정하는 법'
date: 2026-10-17 06:30:00 +0900
categories: ["개발 도구"]
description: 'GitHub Actions workflow dependency lockfile 공개 프리뷰의 symbolic ref 해석, 전이 action 고정, stale lock CI와 보호 범위 밖을 재현 가능한 실습으로 검증한다.'
featured_image: 'https://picsum.photos/seed/github-actions-workflow-lockfile/1600/900'
tags: [github-actions, workflow-lockfile, supply-chain, ci-cd, reusable-workflow, gh-cli, public-preview]
---

![GitHub Actions workflow lockfile의 전이 의존성 고정](https://picsum.photos/seed/github-actions-workflow-lockfile/1600/900)

`uses: vendor/action@v3`는 사람이 읽기 쉽지만 실행할 code를 영구히 가리키지는 않는다.
Tag나 branch가 움직이면 workflow YAML이 바뀌지 않아도 다음 run이 다른 commit을 실행할 수 있다.
GitHub는 이 간극을 줄이는 workflow dependency lockfile을 2026년 10월 14일 public preview로 공개했다.[1]
대상은 GitHub Enterprise Cloud, GitHub Enterprise Cloud with data residency, GitHub Team과 GitHub Free다.[1] GitHub Enterprise Server에는 제공되지 않는다.
이 기능은 GA가 아니며 lockfile format, 도구 flag와 동작이 바뀔 수 있다.
핵심 artifact는 repository 안의 `.github/workflows/actions.lock`이다.
Workflow에는 읽기 좋은 symbolic ref를 남기고 실제 실행 commit은 lockfile에서 고정한다.
Action이 또 다른 action을 호출하는 전이 의존성도 lock 대상이 된다.
그러나 lockfile은 dependency가 안전한 code인지 판정하지 않는다.[1]
이 글에서는 보안 기능을 낙관적으로 소개하기보다 움직인 tag, transitive resolution, stale lock과 보호 범위 밖을 직접 확인한다.

## 무엇이 잠기고 무엇이 달라지는가

공식 개념 문서는 tag나 branch reference가 run time에 현재 commit으로 해석된다고 설명한다.[2]
Lockfile을 채택하면 onboard된 workflow의 각 action dependency가 lockfile에 존재해야 한다.[2]
Runner는 symbolic ref의 현재 위치가 아니라 기록된 commit을 실행한다.[2]
Allowed actions policy도 onboard된 workflow에서는 locked commit을 검사한다.[2]
Lockfile의 `workflows` section은 각 onboarded workflow와 그 dependency 목록을 연결한다.[2]
`dependencies` section은 ref, commit, `owner_id`, `repo_id`를 기록한다.[2]
Numeric repository identity는 같은 이름 뒤에 다른 repository가 놓이는 상황을 감지하는 데 쓰인다.[2]
Locked commit은 source repository의 어느 branch 안에 존재해야 한다.[2]
Repository rename이나 redirect가 모두 무해하다고 가정하지 말고 identity mismatch를 review해야 한다.
Workflow file 안에서 full commit SHA를 직접 쓰는 기존 pinning도 여전히 이해할 수 있는 방식이다.
GitHub는 lockfile을 채택한 repository에서는 workflow 내부 SHA pinning이 더 이상 필요하지 않다고 설명한다.[2]
그 이유로 transitive dependency, 읽기 쉬운 workflow와 repository identity 기록을 든다.[2]
하지만 preview 도입을 원하지 않는 repository가 즉시 기존 SHA pin을 제거할 이유는 없다.
Migration은 현재 policy, plan eligibility, runner 동작과 rollback을 먼저 검증해야 한다.

## public preview를 GA로 포장하지 않기

Platform feature인 workflow dependency lockfile은 public preview다.[1][2]
이를 생성하는 `gh-actions-lock` extension도 public preview이며, 동시에 pre-1.0과 active development 상태임을 경고한다.[3]
따라서 CLI output과 lockfile schema를 장기 안정 API로 가정하면 안 된다.
Production pilot에서는 extension version을 고정하고 upgrade PR에서 schema diff를 검토한다.
Preview 기능에 의존하는 required check는 GitHub 자체 장애나 behavior change도 failure domain에 추가한다.
Rollout 문서에는 disable 또는 SHA pinning 복귀 절차를 함께 적는다.
이번 기능은 지원 plan의 모든 repository에 자동 활성화되는 GA 기능처럼 서술해서도 안 된다.
Announcement가 명시한 Enterprise Cloud·Team·Free 범위와 GHES 제외 조건을 보존해야 한다.[1]
Repository에 file 하나를 넣는 것만으로 server-side enforcement가 모든 환경에서 켜진다고 가정하면 안 된다.
실제 account와 policy UI에서 preview eligibility와 target scope를 확인한다.

## 실습 1: symbolic ref와 실제 commit을 분리해 읽기

공식 extension은 GitHub CLI가 먼저 설치돼 있어야 한다.[3]
설치 명령은 다음과 같다.[3]

```bash
gh extension install github/gh-actions-lock
```

검증 환경에서는 바로 최신을 쓰기보다 설치된 extension revision과 `gh actions-lock --help`를 증거로 저장한다.
다음 workflow는 symbolic ref를 의도적으로 유지한다.

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: acme/example-action@v3
      - run: ./scripts/test.sh
```

Repository root에서 `gh actions-lock`을 실행하면 `.github/workflows/` 아래 workflow를 scan하고 resolvable action을 commit으로 고정한다.[3]

```bash
gh actions-lock
```

생성된 file은 개념적으로 다음 두 mapping을 가진다.

```yaml
version: 'v0.0.2'
workflows:
  '.github/workflows/ci.yml':
    - 'actions/checkout@v6'
    - 'acme/example-action@v3'
dependencies:
  'acme/example-action@v3':
    ref: 'v3'
    commit: '<full-commit-sha>'
    owner_id: 123456
    repo_id: 789012
```

예시의 SHA와 numeric ID는 실제 값을 꾸며 쓰지 않고 placeholder로 남겼다.
실제 file에서는 CLI가 원격 resolution으로 얻은 값을 검토해야 한다.
Tool은 workflow reference를 더 구체적인 version으로 rewrite할 수도 있으므로 lockfile만 보지 말고 전체 diff를 봐야 한다.[4]
예를 들어 `@v3`가 `@v3.1.0`으로 바뀔 수 있다.[4]
그 변경은 사람이 review할 symbolic version을 더 구체화한다.
실행 code의 최종 근거는 lockfile의 full commit이다.
Lockfile은 machine-generated artifact이므로 손으로 수정하지 않는다.[2][4]
원하는 결과가 아니면 workflow source를 고치고 다시 생성한다.[4]

## 실습 2: moved tag가 정상 run을 바꾸지 못하는지 확인하기

Moved-tag fixture에는 통제하는 test action repository를 사용한다.
첫 commit A에 benign output을 넣고 `v1` tag를 A에 둔다.
Consumer workflow가 `owner/test-action@v1`을 참조한 상태에서 lockfile을 생성한다.
생성된 lock entry의 `ref`는 `v1`, `commit`은 A여야 한다.
그다음 action repository의 `v1`을 test commit B로 옮긴다.
이 실습은 third-party tag를 실제로 변경하는 것이 아니라 소유한 fixture에서만 수행한다.
Consumer workflow YAML은 바꾸지 않는다.
Onboard된 workflow를 다시 실행했을 때 A의 marker가 나와야 lock behavior가 확인된다.
B의 marker가 나오면 workflow가 onboard되지 않았거나 lockfile enforcement가 적용되지 않은 것이다.
Run log에서 checkout된 action commit과 lock artifact diff를 함께 보존한다.
정상 run 하나만으로 충분하지 않으므로 lock entry를 제거한 negative case도 별도 branch에서 시험한다.
Onboard된 workflow의 dependency가 lockfile에 없으면 실행이 허용되지 않아야 한다.[2]
이 결과는 tag A가 안전하다는 증거가 아니다.
오직 review한 A와 실행한 code가 같다는 증거다.

## 실습 3: 전이 action을 read-back하기

직접 workflow가 `owner/outer-action@v1`만 부르더라도 composite action 내부가 `owner/inner-action@v2`를 호출할 수 있다.
Lockfile은 이런 action의 transitive dependency까지 pin하도록 설계됐다.[1][2]
Fixture의 `outer-action/action.yml`에 `inner-action@v2`를 넣는다.
Consumer에서 `gh actions-lock`을 실행한 뒤 `dependencies`에 outer와 inner가 모두 있는지 검사한다.

```bash
gh actions-lock
python - <<'PY'
from pathlib import Path
text = Path('.github/workflows/actions.lock').read_text()
for ref in ('owner/outer-action@v1', 'owner/inner-action@v2'):
    assert ref in text, f'missing transitive dependency: {ref}'
print('direct and transitive entries present')
PY
```

Text assertion은 tutorial fixture를 이해하기 위한 최소 read-back이다.
실제 gate에서는 lockfile schema parser나 extension의 verify mode를 우선한다.
Inner tag만 움직인 뒤 workflow를 다시 실행해 locked inner commit marker가 유지되는지도 본다.
Direct dependency만 확인하면 supply chain의 두 번째 hop drift를 놓친다.
전이 graph가 깊을수록 lock diff review와 update 빈도도 커질 수 있다.
따라서 dependency 수, depth, owner 분포를 inventory로 출력하면 review 비용을 예측하기 쉽다.

## 중요한 예외: reusable workflow의 내부 dependency

Lockfile은 자기 repository의 workflow를 보호한다.[2]
외부 reusable workflow call 자체는 caller의 lockfile에 기록될 수 있다.[2]
그러나 그 reusable workflow가 내부에서 사용하는 action은 caller lockfile의 transitive closure로 고정되지 않는다.[2]
그 내부 dependency는 reusable workflow가 정의된 repository의 lockfile이 담당한다.[2]
이 경계는 action composition과 reusable workflow composition을 다르게 만든다.
Shared workflow platform을 운영한다면 consumer보다 shared repository를 먼저 onboard하는 것이 권장된다.[4]
실습에서는 consumer, shared-workflow, inner-action 세 repository를 구분한다.
Consumer lockfile에서 reusable workflow commit을 확인한다.
Shared repository lockfile에서 inner action commit을 확인한다.
Consumer lockfile 하나에 둘이 모두 들어올 것이라고 기대하면 잘못된 acceptance criterion이다.
Shared repository가 lockfile을 쓰지 않으면 caller lockfile만으로 그 내부 action drift를 닫을 수 없다.
이것이 첫 번째 보호 범위 밖이다.

## 실습 4: stale lock을 PR에서 실패시키기

Stale lock은 workflow source와 lockfile의 dependency graph가 어긋난 상태다.
예를 들어 workflow에 새 action을 추가하고 lockfile을 갱신하지 않으면 stale하다.
GitHub의 enforcement guide는 pull request에서 `gh actions-lock --verify`를 실행하는 verify job을 안내한다.[5]
이 command는 lockfile이 stale하면 error로 종료하도록 설계됐다.[5]

```yaml
name: verify-actions-lock
on:
  pull_request:
    paths:
      - '.github/workflows/**'
      - '**/action.yml'
      - '**/action.yaml'
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: gh extension install github/gh-actions-lock
      - run: gh actions-lock --verify
```

Preview CLI를 매번 최신으로 설치하는 이 sample은 개념 설명용이다.
실제 gate에서는 검토한 extension revision을 고정하고 그 자체의 공급망 경로도 관리한다.
PR fixture는 dependency 추가, dependency 삭제, workflow rename과 transitive dependency 변경을 각각 만든다.
각 case에서 verify가 예상한 이유로 실패하는지 log를 읽는다.
단순히 non-zero라는 결과만 보면 network failure나 authentication failure를 stale로 오인할 수 있다.
Local pre-commit에는 `gh actions-lock --verify-local --no-fix`를 사용할 수 있다.[5]
이 local command는 offline으로 entry 존재를 확인하지만 GitHub에 pin을 다시 검증하지 않는다.[5]
따라서 local green은 remote identity와 reachability까지 확인한 결과가 아니다.
CI의 remote verify와 local fast feedback은 서로 대체하지 않는다.

## normal run, relock, accept-moved의 차이

Normal `gh actions-lock` run은 이미 잠긴 branch나 partial version을 매번 현재 upstream으로 재해석하지 않는다.[3][4]
그렇지 않으면 tool을 실행하는 행위 자체가 review하지 않은 code upgrade가 된다.
Legitimate update를 원할 때 `gh actions-lock --relock`을 사용한다.[3][4]
기존 locked commit이 upstream에서 더 이상 reachable하지 않으면 `--relock`도 error를 남긴다.[3][4]
Force-push나 tag 삭제 같은 상황을 받아들이려면 원인을 조사한 뒤 `--accept-moved`를 추가한다.[3][4]

```bash
gh actions-lock --relock
git diff -- .github/workflows .github/actions
```

`--accept-moved`는 경고를 지우는 편의 flag로 자동 실행하면 안 된다.
Old commit이 사라졌다는 사실은 compromise, history rewrite, repository transfer 또는 유지보수 실수일 수 있다.
Review에는 old SHA, new SHA, upstream diff, owner/repo identity와 release evidence를 포함한다.
정상적인 tag update라도 changed commit이 실행할 권한과 secret scope를 다시 본다.
Lock update 승인과 application source 승인도 같은 사람에게 몰지 않는 편이 낫다.

## local action과 `$/…` reference

현재 extension은 같은 repository action을 `$/…` 형태로 표현할 수 있다.[3]
`$/actions/my-action`은 defining repository의 running commit에 해석돼 별도 lock entry가 필요 없다.[3]
같은 repository의 reusable workflow도 `$/.github/workflows/reusable.yml` 형태를 쓸 수 있다.[3]
`$/…@v1`처럼 별도 ref를 붙이는 것은 허용되지 않는다.[3]
Fix run은 유효한 `./…` local action을 `$/…`로 rewrite할 수 있다.[3][4]
Local path는 현재 file directory가 아니라 repository root 기준으로 해석된다.[4]
경로가 실제 action file에 연결되지 않으면 workflow onboarding이 skip될 수 있다.[4]
이 skip을 warning으로만 흘려보내면 보호된 줄 알았던 workflow가 밖에 남는다.
Pilot에서는 expected workflow count와 lockfile의 onboarded workflow count를 비교한다.
`--no-migrate-local-actions`를 쓸 때는 왜 migration을 미뤘는지 기록한다.[3]
Local action code는 running commit에 포함되지만 그 action이 부르는 외부 dependency는 graph에서 계속 검사해야 한다.

## 보호 범위 밖을 네 가지로 나누기

첫째, lockfile은 dependency code의 안전성을 평가하지 않는다.[1]
Malicious commit을 review 없이 lock하면 재현 가능하게 악성 code를 실행할 뿐이다.
둘째, script 안의 `curl | bash`, package install, container tag와 remote download는 action reference lock만으로 고정되지 않는다.
셋째, external reusable workflow 내부 action은 그 정의 repository의 lockfile 경계다.[2]
넷째, workflow가 실행할 때 받는 secret, OIDC permission, runner image와 network response는 lockfile 밖의 runtime input이다.
다섯째, first-party shell script와 generated artifact가 같은 commit에 있어도 review 자체가 부실하면 lock은 품질을 보장하지 않는다.
여섯째, compromised action commit이 이미 locked돼 있다면 tag 이동 방지는 도움이 되지 않는다.
일곱째, preview의 server-side policy가 target하지 않은 workflow는 file 존재만으로 강제되지 않을 수 있다.
여덟째, self-hosted runner의 persistent state와 tool cache는 dependency commit 외의 code path를 만들 수 있다.
따라서 lockfile을 CI/CD 공급망 전체의 완결된 provenance로 부르면 안 된다.
정확한 표현은 action과 reusable workflow reference resolution의 drift를 줄이는 repository-owned artifact다.

## policy enforcement와 gradual onboarding

Workflow는 하나씩 lockfile에 onboard할 수 있다.[1][2]
이 특성은 큰 repository의 단계적 migration에 유용하다.
그러나 onboarded workflow와 아직 바깥인 workflow를 dashboard에서 구분하지 않으면 false assurance가 생긴다.
Public preview의 **Require lockfile** policy는 enterprise, organization, repository administrator가 범위에 적용할 수 있다.[1]
Enforcement guide는 targeted workflow가 action dependency를 가지면서 lockfile에 onboard되지 않았으면 run을 block한다고 설명한다.[5]
먼저 선택한 low-risk repository에서 pilot한 뒤 policy를 active로 바꾸는 순서를 권장한다.[5]
Policy 전에 lockfile 생성과 update automation을 준비해야 한다.[5]
Lockfile을 `CODEOWNERS`에 넣어 build security reviewer를 자동 지정할 수 있다.[5]
Branch protection이나 ruleset에서 code-owner approval을 요구할 수 있다.[5]
Policy block은 늦은 실행 단계의 보호이고 PR verify는 개발자에게 stale 이유를 일찍 보여준다.[5]
둘을 중복으로 보지 말고 prevention과 feedback으로 분리한다.

## Dependabot과 중복하지 않는 경계

Dependabot이 onboard된 workflow의 action version을 올리면 같은 PR에서 lock entry도 재생성할 수 있다.[1][5]
그러나 Dependabot은 workflow를 처음 onboard하지 않는다.[4]
Onboard되지 않은 workflow의 update에서는 lockfile 도입이 필요하다고 알릴 뿐이다.[4]
따라서 Dependabot은 lockfile adoption controller가 아니다.
이 글의 초점은 registry credential이나 update cadence가 아니다.
Symbolic version change와 실행 commit change가 한 review diff에 같이 나타나는지 확인하는 것이 핵심이다.
Update PR에서는 workflow ref, locked commit, owner/repo ID와 transitive graph 변화를 함께 본다.
자동 merge는 changed commit의 permission과 source diff를 검토할 정책이 있을 때만 고려한다.

## 성능과 비용 조건

Lockfile은 runner workload 자체를 빠르게 만드는 기능이 아니다.
Workflow 시작 전 dependency resolution과 validation이 추가될 수 있다.
CLI generation은 GitHub API access와 dependency graph traversal을 요구한다.
큰 monorepo에서는 workflow 수와 transitive graph 크기가 update time을 좌우한다.
측정할 값은 `gh actions-lock` duration, API call failure, lockfile size와 changed entry 수다.
PR lead time에는 security review 대기와 false stale failure도 포함한다.
반대로 tag drift incident 조사와 수동 SHA inventory 비용을 줄일 가능성이 있다.
ROI는 lockfile byte 수가 아니라 review된 dependency change당 시간과 예기치 않은 drift 차단 건수로 본다.
Preview 기간에는 CLI version upgrade로 생긴 schema churn도 운영 비용으로 기록한다.
Self-hosted runner와 GitHub-hosted runner에서 verify latency가 다른지도 측정한다.
Network outage 때 local verify는 되지만 remote verify가 실패하는 운영 모드도 정한다.
Fail-open으로 merge할지 fail-closed로 기다릴지는 repository risk 등급에 따라 명시한다.
Release signing job처럼 영향이 큰 workflow는 fail-closed가 자연스럽다.
Documentation-only workflow는 별도 예외가 필요할 수 있지만 예외 owner와 만료일을 둔다.

## 보안과 라이선스 검토

Lockfile은 source repository numeric identity를 기록해 name reuse나 redirect mismatch를 감지하는 신호를 제공한다.[2]
Changed `owner_id`나 `repo_id`는 드문 변화이므로 merge 전에 조사해야 한다.[4]
Lockfile diff에는 full commit이 드러나므로 해당 source tree를 실제로 review할 수 있다.
그러나 minified bundle과 source map의 대응, release build provenance는 별도 문제다.
Action이 Node bundle을 commit했다면 bundle이 source에서 재현되는지도 project risk에 따라 확인한다.
Workflow permission은 `contents: read`처럼 최소 권한을 명시하고 action update 때 확대 여부를 본다.
Fork PR에서 secret이 전달되는 경로와 `pull_request_target` 사용도 lock과 별개로 검토한다.
`gh-actions-lock` repository 자체는 MIT License로 공개돼 있다.[6]
MIT 조건은 copyright와 permission notice를 substantial portions에 포함하도록 요구한다.[6]
Extension의 MIT license가 lock 대상으로 기록된 third-party action license를 대신하지 않는다.
각 action의 license, notice와 redistribution 조건은 dependency별로 남는다.
Preview service의 이용 가능성과 CLI source license도 서로 다른 계약이다.

## 실패 모드와 도입 gate

첫 번째 실패는 file은 존재하지만 중요한 workflow가 onboard되지 않은 상태다.
두 번째 실패는 local-path 오류로 onboarding이 skip됐는데 warning을 놓친 상태다.
세 번째 실패는 transitive action은 잠겼지만 external reusable workflow repository가 잠기지 않은 상태다.
네 번째 실패는 stale lock check가 network failure를 dependency drift로 잘못 보고하는 상태다.
다섯 번째 실패는 `--accept-moved`를 automation이 무조건 사용해 suspicious history rewrite를 승인하는 상태다.
여섯 번째 실패는 changed repository ID를 rename으로 단정하고 확인 없이 merge하는 상태다.
일곱 번째 실패는 allowed-actions policy가 tag pattern만 허용해 locked SHA와 충돌하는 상태다.[4]
여덟 번째 실패는 preview format update 뒤 오래된 extension이 lockfile을 다르게 해석하는 상태다.
아홉 번째 실패는 action 내부 download가 mutable URL이라 outer commit만 재현되는 상태다.
열 번째 실패는 lock update PR이 release 직전에 막혀 긴급 우회가 상시 예외가 되는 상태다.

권장 rollout은 inventory부터 시작한다.
모든 `.github/workflows/*.yml`과 `*.yaml`의 `uses`를 추출한다.
Direct action, local action, reusable workflow와 script-based download를 분류한다.
Low-risk workflow 하나를 onboard하고 generated diff를 review한다.
Moved-tag와 stale-lock fixture를 별도 test repository에서 재현한다.
Transitive action과 reusable workflow 경계가 예상대로 보이는지 read-back한다.
PR verify를 required check로 만들기 전에 outage와 authentication failure message를 확인한다.
그다음 lockfile을 CODEOWNERS에 넣고 reviewer 역할을 정한다.
Pilot metric과 rollback을 확보한 뒤에만 Require lockfile policy 범위를 넓힌다.
CLI와 schema upgrade는 application dependency update와 분리한 PR로 처리한다.

## Workflow lockfile을 도입할 팀과 신중해야 할 팀

**적합한 팀**은 지원되는 GitHub.com plan에서 third-party action과 shared workflow를 많이 쓴다.
**적합한 팀**은 readable tag를 workflow에 남기면서 실제 commit을 review하려 한다.
**적합한 팀**은 transitive action graph와 repository identity를 감사해야 한다.
**적합한 팀**은 preview 변화와 CLI version을 관리할 platform owner가 있다.
**적합한 팀**은 stale lock CI와 CODEOWNERS review를 운영할 수 있다.

**부적합한 팀**은 public preview를 production release path에서 전혀 허용할 수 없다.
**부적합한 팀**은 Enterprise Cloud 대상 범위에 속하지 않는다.
**부적합한 팀**은 action 내부의 remote download까지 lockfile이 보호한다고 기대한다.
**부적합한 팀**은 external reusable workflow provider의 repository를 통제하거나 검증할 수 없다.
**부적합한 팀**은 generated lock diff를 review할 owner 없이 자동 `--accept-moved`만 설정하려 한다.

대안은 workflow file의 full commit SHA pinning을 유지하는 것이다.
이 방식은 direct reference가 명시적이지만 transitive action을 같은 repository artifact로 관리하기 어렵다.
조직이 third-party action을 내부 mirror로 가져와 검토한 commit만 허용하는 방법도 있다.
중요 job을 first-party script와 hermetic build로 줄이는 것도 dependency surface를 줄인다.
Lockfile은 이런 통제와 경쟁하는 단일 정답이 아니라 symbolic ref resolution을 보강하는 한 layer다.

## 결론: lockfile은 안전 판정기가 아니라 실행 commit 계약이다

GitHub Actions workflow lockfile의 장점은 사람이 읽는 tag와 runner가 실행할 commit을 분리해 둘 다 review 가능하게 만드는 데 있다.
Action의 전이 dependency와 repository numeric identity까지 기록하는 점은 direct SHA pin보다 넓은 inventory를 제공한다.
동시에 external reusable workflow 내부, action의 runtime download, secret, runner state와 이미 악성인 locked commit은 보호 범위 밖이다.
Normal run은 locked symbolic ref를 자동 upgrade하지 않고 legitimate move는 `--relock`으로 명시적으로 받아들인다.
Reachability가 깨진 move를 `--accept-moved`로 넘길 때는 새로운 trust decision이 발생한다.
Stale lock은 PR의 `--verify`와 local `--verify-local --no-fix`를 서로 다른 깊이로 운영해야 한다.
무엇보다 이 기능과 CLI는 2026년 10월 17일 현재 public preview이고 CLI는 pre-1.0이다.
따라서 GA 수준의 불변 contract로 쓰지 말고 version pin, pilot, negative fixture와 rollback을 준비해야 한다.
**성공 기준은 `actions.lock` file이 생겼다는 사실이 아니라 symbolic ref, transitive commit, reusable-workflow 경계와 stale 상태를 팀이 재현하고 설명할 수 있다는 것이다.**

## Sources

[1] https://github.blog/changelog/2026-10-14-github-actions-workflow-lockfiles-in-public-preview/ — GitHub Actions workflow lockfiles public preview announcement
[2] https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles — Workflow dependency lockfile concepts and scope
[3] https://github.com/github/gh-actions-lock/tree/f43e069f9e87f8fedcc8f4fb69c617e3c17fe2af — gh-actions-lock public preview repository and CLI behavior
[4] https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies — Locking action dependencies guide
[5] https://docs.github.com/en/actions/how-tos/administer/enforce-workflow-lockfiles — Enforcement, verification, and rollout guide
[6] https://github.com/github/gh-actions-lock/blob/f43e069f9e87f8fedcc8f4fb69c617e3c17fe2af/LICENSE — gh-actions-lock MIT License
