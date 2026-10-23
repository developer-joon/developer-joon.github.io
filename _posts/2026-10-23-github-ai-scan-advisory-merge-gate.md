---
title: 'GitHub AI Scan은 GA인데 왜 PR을 막지 못할까: advisory와 merge gate 분리'
date: 2026-10-23 09:00:06 +0900
categories: ["개발/보안"]
description: 'GitHub AI Scan의 advisory finding과 CodeQL·ruleset merge protection을 분리하고, fork·Dependabot·AI credit 공백까지 포함한 안전한 PR 의사결정 모델을 설계한다.'
featured_image: 'https://picsum.photos/seed/github-ai-scan-advisory-merge-gate/1600/900'
tags: [github, ai-scan, codeql, code-scanning, rulesets, merge-gate, ai-credits, application-security]
---

![햇빛이 비치는 침대 위 펼친 책과 분홍 꽃, 김이 오르는 찻잔](https://picsum.photos/seed/github-ai-scan-advisory-merge-gate/1600/900)

GitHub는 2026년 10월 15일 **AI Scan for pull requests**를 generally available로 발표했다. 이 기능은 PHP, Shell/Bash, Terraform HCL, Dockerfile처럼 현재 CodeQL이 다루지 않는 언어와 프레임워크의 PR 변경에서 취약점을 찾도록 CodeQL을 보완한다. Finding은 PR의 **Conversation**과 **Files changed**에 `AI` 표시와 함께 나타나며 위험 설명과 수정 제안을 포함할 수 있다.[1]

여기서 “GA”를 “이제 AI가 위험한 PR을 막는다”로 읽으면 운영 설계가 틀어진다. GitHub가 명시한 계약은 반대다. **AI Scan finding은 advisory이며 code scanning check를 실패시키지 않고, ruleset requirement를 통해 merge를 막을 수도 없다.** Fork에서 들어온 PR과 Dependabot이 만든 PR에는 AI Scan 자체가 실행되지 않는다.[1]

그렇다면 이 기능은 merge gate에 쓸모가 없는가? 그렇지 않다. 다만 advisory signal과 deterministic blocking signal을 같은 상태처럼 취급하지 않아야 한다. AI Scan은 사람이 더 살펴볼 위치를 넓히는 신호다. CodeQL이나 다른 code scanning tool의 확정된 check, 테스트, required review, ruleset은 실제 merge 권한을 제한하는 통제다. 둘을 분리한 뒤 연결해야 GA 기능의 가치와 차단의 예측 가능성을 함께 얻을 수 있다.

## AI Scan이 실제로 하는 일부터 고정한다

현재 공식 문서에서 AI Scan은 전체 repository를 훑는 backlog scanner가 아니다. PR 변경만 분석하며 finding도 repository의 일반 code scanning backlog alert로 나타나지 않는다. Code scanning이 켜져 있고 repository의 effective AI Scan 설정이 활성화돼 있으며, 지원 범위의 변경을 담은 적격 PR일 때 실행된다. CodeQL default setup은 필수가 아니고, CodeQL 분석이 실패하거나 대기 중이어도 AI Scan은 독립적으로 실행될 수 있다.[2]

이 경계는 dashboard와 PR 화면을 해석할 때 중요하다. Default branch의 오래된 PHP 취약점이 AI Scan 결과에 없다고 해서 안전하다는 뜻이 아니다. 반대로 PR에 AI finding이 보인다고 해서 CodeQL alert가 생성됐거나 required check가 실패했다는 뜻도 아니다. 같은 PR 화면에 나란히 표시돼도 두 결과의 lifecycle과 enforcement 능력은 다르다.

공식 실행 조건을 운영 관점에서 풀면 다음 네 질문이 생긴다.

1. 이 repository에서 code scanning과 effective AI Scan 설정이 실제로 켜져 있는가?
2. 이 PR은 fork나 Dependabot이 만든 것이 아닌가?
3. 변경 언어·프레임워크가 현재 AI Scan 대상이며 CodeQL 비지원 영역에 해당하는가?
4. Scan을 수행할 Code Security AI Credits가 남아 있는가?

네 질문 중 하나가 `no` 또는 `unknown`이면 “finding 0개”를 “취약점 0개”로 번역할 수 없다. 결과가 없다는 관찰에는 깨끗한 분석, 비대상 변경, 미실행, 예산 중단, 결과 대기처럼 서로 다른 원인이 섞여 있다.

## Ruleset이 막는 것은 AI finding이 아니다

GitHub의 code scanning merge protection은 ruleset에 필요한 tool과 alert threshold를 지정해 작동한다. Required tool이 설정한 심각도의 alert를 찾았거나, 분석이 진행 중이거나, repository에 tool이 구성되지 않았으면 merge를 막을 수 있다. 이 ruleset 기반 merge protection은 status check와도 별개의 기능이다.[3]

설정 화면에서는 **Require code scanning results**를 선택한 뒤 CodeQL 같은 tool을 추가하고 일반 alert와 security alert의 threshold를 정한다. Security alert는 `Critical`, `High or higher`, `Medium or higher`, `All` 같은 기준을 고를 수 있다.[4] 그러나 이 일반 설명을 AI Scan으로 확대하면 안 된다. AI Scan 문서는 finding이 code scanning check를 실패시키지 않고 ruleset merge requirement에 사용할 수 없다고 별도로 못 박는다.[2]

따라서 다음 구성은 성립하지 않는다.

```text
AI Scan finding 발견
  → Code scanning check 자동 실패
  → Require code scanning results가 merge 차단
```

현재 성립하는 흐름은 아래처럼 두 갈래다.

```text
CodeQL 또는 ruleset에 지정한 code scanning tool
  → threshold 이상 alert / 분석 대기 / tool 미구성
  → ruleset이 merge 차단 가능

AI Scan
  → PR에 advisory finding 표시
  → 개발자·보안 reviewer가 검토하고 수정 또는 dismiss
  → finding 자체는 ruleset merge 차단 신호가 아님
```

이 차이를 숨기려고 PR 화면을 scraping해 AI 문구가 보이면 임의의 check를 실패시키는 방법은 권하지 않는다. UI 문구와 DOM은 안정적인 기계 계약이 아니고, finding 부재와 scan 미실행을 구분하기 어렵다. GitHub가 공개적으로 보장하지 않은 field나 endpoint를 추측해 merge control에 넣어서도 안 된다.

## 안전한 결정 matrix는 탐지와 merge 권한을 따로 본다

아래 표는 GitHub의 provider 상태표가 아니라 **조직이 PR을 운영하기 위한 결정 matrix 제안**이다. `AI signal`, `deterministic gate`, `coverage evidence`를 한 칸에 합치지 않는 것이 핵심이다.

| 관찰 상태 | AI Scan 해석 | Deterministic gate | 권장 merge 결정 |
|---|---|---|---|
| AI finding 있음, CodeQL·테스트 통과 | Advisory 검토 필요 | Blocking signal은 green | 수정 또는 보안 reviewer의 명시적 판단 전 대기 |
| AI finding 없음, scan 완료 증거 있음 | 해당 scan에서 finding 없음 | 별도 gate 결과를 따름 | CodeQL·테스트·review가 모두 충족되면 허용 가능 |
| AI 결과 없음, fork PR | 제품상 미실행 범위 | CodeQL·테스트·review만 평가 | 신뢰 경계에 맞는 수동 보안 검토 또는 격리된 재현 PR 요구 |
| AI 결과 없음, Dependabot PR | 제품상 미실행 범위 | Dependency·테스트 gate 평가 | Dependency diff와 lockfile 검토를 별도 수행 |
| AI 결과 없음, credit hard budget 도달 | 탐지 중단 가능 | 기존 deterministic gate는 별도 상태 | `clean`이 아니라 `coverage unavailable`로 보류 또는 승인된 fallback 적용 |
| AI finding 있음, CodeQL alert도 threshold 초과 | 두 종류의 signal 존재 | Ruleset이 차단 가능 | Deterministic alert 해소 후 AI finding도 별도 triage |
| AI Scan 완료 전 merge 준비 | 결과가 아직 확정되지 않음 | AI 자체는 대기 gate가 아님 | 고위험 repository는 reviewer가 완료 증거를 기다림 |

“수동 판단 전 대기”는 AI finding이 GitHub ruleset으로 자동 차단됐다는 뜻이 아니다. Required review와 CODEOWNERS 같은 기존 보호에서 지정 reviewer가 승인을 보류하는 **사람 중심 통제**다. 조직이 이 절차를 채택하지 않았다면 AI finding이 있는 PR도 다른 requirement만 충족하면 merge될 수 있다.

반대로 모든 AI finding을 자동 취약점으로 간주하는 것도 안전하지 않다. GitHub는 AI 기반 도구의 특성상 false positive가 있을 수 있다고 밝히며 feedback 기능을 제공한다.[2] Reviewer는 finding이 지목한 data flow와 변경 diff를 확인하고, 수정·오탐·위험 수용 가운데 결론과 근거를 남겨야 한다. “AI가 말했다”와 “재현 가능한 보안 결함이다”는 다른 주장이다.

## 내부 상태는 GitHub provider field처럼 쓰지 않는다

Coverage 공백을 관리하려면 상태 모델이 필요하지만, 제품에 없는 field를 제품 계약처럼 보이면 안 된다. 다음은 **필자의 조직 내부 workflow 예시**다. GitHub API response나 ruleset schema가 아니다.

```text
PR_SECURITY_REVIEW
  pr_head_sha        : 검토한 PR head 식별자
  ai_scan_eligibility: eligible / fork_excluded / dependabot_excluded / unsupported / unknown
  ai_scan_run        : completed / pending / unavailable_budget / not_expected / unknown
  ai_findings        : open / resolved / dismissed / none_observed / unknown
  deterministic_gate : pass / fail / pending / not_configured
  human_review       : not_required / requested / approved / changes_requested
  merge_decision     : hold / allow / deny
```

`none_observed`와 `completed`를 분리하는 이유는 finding이 보이지 않는 것만으로 scan 완료를 증명할 수 없기 때문이다. `not_expected`는 fork·Dependabot처럼 공식 제외 조건을 기록한다. `unavailable_budget`은 보안 문제가 없다는 뜻이 아니라 비용 통제로 coverage가 사라졌다는 뜻이다. `human_review=approved`도 GitHub가 AI finding을 ruleset check로 승격했다는 뜻이 아니다.

상태의 snapshot point는 **merge 대상 head SHA**로 고정한다. AI Scan은 PR 생성과 새 commit 뒤에 다시 실행되므로, reviewer가 승인한 뒤 commit이 추가되면 과거 판단을 재사용하지 않는다.[2] Required review에서 stale approval을 dismiss하도록 구성하거나, 적어도 마지막 security review 이후 head가 바뀌었는지 merge 직전에 확인한다.

조직 내부 transition은 다음 정도로 단순하게 둘 수 있다.

```text
head 변경
  → ai_scan_run=pending 또는 not_expected 판정
  → deterministic_gate 재평가
  → AI finding triage와 human review
  → 같은 head에서 evidence 완성
  → allow 또는 deny
```

실제 AI Scan이 제공하지 않는 run ID, finding API field, severity enum을 이 예시에 추가하지 않았다. 조직이 수집할 수 없는 값은 `unknown`으로 두고, 추측한 식별자로 audit record를 채우지 않는다.

## Fork와 Dependabot 공백은 예외가 아니라 정상 입력이다

AI Scan은 fork에서 온 PR과 Dependabot이 만든 PR에 실행되지 않는다.[1][2] 이 사실은 public open source와 dependency update가 많은 repository에서 작은 edge case가 아니다. 외부 기여가 주 경로라면 AI Scan 적용률이 높아 보여도 중요한 PR 집합이 통째로 제외될 수 있다.

Fork PR의 대안은 외부 code를 신뢰해 privileged workflow에서 바로 실행하는 것이 아니다. 먼저 일반 fork용 테스트와 deterministic scanner를 최소 권한으로 실행한다. AI coverage가 반드시 필요하고 조직 절차가 허용한다면 maintainer가 내용을 검토한 뒤 조직 내부 branch에 동일 commit을 안전하게 재현하는 방식을 고려할 수 있다. 이때 원래 fork SHA와 내부 재현 SHA의 내용 동일성을 확인하고, secret이 노출되는 workflow를 자동 실행하지 않는다. 재현이 불가능하면 `AI clean`으로 꾸미지 말고 수동 보안 검토가 대체했다는 사실을 남긴다.

Dependabot PR은 source code 취약점 탐지보다 dependency version, manifest, lockfile, changelog, advisory와 테스트가 중심이 될 수 있다. 하지만 “bot이 만들었으니 안전하다”는 결론은 나오지 않는다. Dependency update가 build script, generated code, container image, GitHub Actions reference를 바꿀 수 있다. AI Scan 공백은 dependency review, 테스트, package provenance와 기존 code scanning으로 보완하되, AI finding이 없다는 표현은 쓰지 않는다.

Code scanning merge protection 자체에도 별도 제한이 있다. 공식 문서는 ruleset 기반 보호가 merge queue group과 default setup으로 분석된 Dependabot PR에는 적용되지 않는다고 설명한다.[3] 즉 Dependabot 경로에서는 “AI Scan만 빠지고 나머지 ruleset은 항상 동일하다”고 가정할 수도 없다. 실제 repository의 PR, merge queue, bot 경로를 각각 negative fixture로 확인해야 한다.

## AI Credits는 비용 상태이면서 coverage 상태다

GA 뒤 AI Scan 사용량은 active-committer license와 별도로 **Code Security AI Credits** SKU에 기록된다. Public repository가 active-committer license를 요구하지 않더라도 AI Scan은 credit을 소비한다. Billing account에 Copilot entitlement에서 포함된 AI credits가 있으면 먼저 그 allowance를 사용하고, 소진 뒤에는 metered usage로 넘어간다. Private·internal organization repository에는 GitHub Code Security 또는 GitHub Advanced Security가 필요하지만, AI Scan 자체에 Copilot license가 필요한 것은 아니다.[1][5]

비용 설계에서 가장 중요한 동작은 hard budget이다. Code Security AI Credits quota가 남지 않으면 AI Scan은 finding을 만들 수 없고, budget을 늘리거나 새 billing cycle이 시작돼야 scanning이 재개된다. 그런데 hard budget 도달은 AI Scan 설정을 자동으로 꺼서 관리자 화면에 명백한 disabled 상태를 만드는 것이 아니다. 공식 문서에 따르면 hard budget은 AI 기능의 **사용량**을 제한하며 enablement 자체는 막지 않는다.[6]

따라서 dashboard에 `enabled`라고 표시된 repository가 실제 PR에서 계속 finding을 생산한다는 보장은 없다. 다음 세 상태를 따로 감시해야 한다.

- **Configured coverage**: code scanning과 effective AI Scan 설정이 활성화된 repository 수
- **Eligible coverage**: fork·Dependabot 제외와 언어 조건을 반영해 scan 대상이 된 PR 수
- **Observed coverage**: 실제로 결과가 도착했거나 완료를 확인한 적격 PR 수

Budget 운영자는 75%·90%·100% alert만 비용 알림으로 보지 말고 보안 coverage 경보로도 전달해야 한다. Security team은 hard budget 소진 때 어떤 repository가 수동 review로 전환되는지, 어떤 위험 등급에서 merge를 보류하는지 미리 정해야 한다. Budget이 0이 된 뒤 finding이 사라진 것을 탐지 품질 향상으로 보고하면 안 된다.

또한 조직 수준에서 AI Scan을 넓게 켜면 code scanning이 활성화된 적격 repository에 즉시 적용되고, repository 관리자가 opt out하기 전에도 qualifying PR이 credit을 쓸 수 있다.[2] 전사 rollout 전에 repository inventory, 월간 PR·commit volume, 포함 credit, metered budget, hard-stop 동작을 함께 확인해야 한다. 다른 Copilot quota나 모델 단가를 가져와 AI Scan 비용을 추정하지 않는다.

## Advisory를 운영 통제로 바꾸는 단계

### 1. Repository별 coverage contract를 만든다

Public·private·internal, organization·personal ownership, Code Security entitlement, managed-user personal namespace 여부를 구분한다. AI Scan 문서상 organization public repository는 active-committer license 없이 사용할 수 있고, private·internal organization repository는 Code Security 또는 Advanced Security가 필요하다. Personal public repository는 사용할 수 있지만 personal private repository와 managed user personal namespace에는 제약이 있다.[2]

### 2. Deterministic gate를 먼저 고정한다

Default branch ruleset에 required pull request review, 테스트, build, CodeQL 또는 조직이 검증한 code scanning tool을 둔다. Require code scanning results에는 tool과 threshold를 명시한다.[4] AI Scan이 지원하지 않는 언어를 본다는 이유로 기존 scanner를 제거하지 않는다. 둘은 대체 관계가 아니라 coverage와 enforcement 역할이 다르다.

### 3. AI finding triage 책임자를 지정한다

지원 언어 변경이 많은 repository에는 security reviewer 또는 CODEOWNER를 지정한다. Finding이 있으면 수정, false positive, risk acceptance 중 하나를 기록한다. Finding이 없을 때는 scan 완료 증거가 있는지 먼저 확인한다. High-risk repository에서는 완료 전 approval을 보류하는 내부 정책을 둘 수 있지만, 이를 GitHub가 제공하는 AI Scan merge gate라고 부르지 않는다.

### 4. 제외 경로를 fixture로 시험한다

같은 harmless 취약 패턴 fixture를 일반 branch PR, fork PR, Dependabot이 만든 PR과 유사한 bot 경로에서 비교한다. 실제 exploit이나 secret은 사용하지 않는다. 기대 결과는 fork와 Dependabot에도 AI finding이 생기는 것이 아니라, **AI Scan 미실행 상태가 정확히 분류되고 대체 review가 시작되는 것**이다.

### 5. Credit exhaustion을 장애 훈련에 넣는다

Production budget을 실제로 소진시키지 말고 별도 pilot scope와 승인된 비용 한도에서 hard-budget 동작을 확인한다. AI Scan이 enabled로 보이지만 finding 생산이 멈출 수 있는 상태를 runbook에 넣는다. Billing alert 수신자, security on-call, repository owner 사이 escalation 경로를 정한다.

### 6. 결과보다 outcome을 측정한다

GitHub의 code scanning PR report는 AI Scan finding 총수, Autofix 제안 비율, 수정 적용과 dismiss outcome을 보여 준다.[7] 하지만 finding 수가 많다고 repository가 더 위험한 것도 아니고, dismiss가 많다고 자동으로 false positive가 많은 것도 아니다. 조직 지표에는 eligible PR 대비 observed scan 비율, fork·Dependabot 비중, budget 때문에 coverage를 잃은 시간, finding triage lead time, 수정·dismiss·risk acceptance 근거 완성률을 함께 둔다.

## 실패 모드와 복구 기준

첫 번째 실패는 **false green**이다. AI finding이 없다는 이유로 clean이라고 표시했지만 실제로는 fork, Dependabot, unsupported change, pending 또는 credit exhaustion이었다. 복구할 때는 과거 PR을 억지로 clean으로 재분류하지 않는다. `coverage unknown`으로 정정하고 필요한 범위만 수동 review한다.

두 번째 실패는 **false gate**다. 팀이 AI Scan finding을 ruleset alert와 같은 것으로 교육해 개발자가 자동 차단된다고 믿는다. 실제로는 reviewer가 보지 않으면 merge된다. Runbook과 dashboard에서 `advisory_open`과 `merge_blocked`를 분리하고, 누가 approval을 보류할 책임이 있는지 명시한다.

세 번째 실패는 **stale review**다. Finding을 수정하고 승인받은 뒤 새 commit이 추가됐는데 이전 approval과 triage receipt를 그대로 쓴다. PR head SHA가 바뀌면 AI Scan, deterministic gate, human review를 새 snapshot으로 되돌린다.

네 번째 실패는 **budget-induced silence**다. Usage 급증이나 hard budget으로 scan이 멈췄지만 enabled repository 수만 보고 coverage가 유지된다고 판단한다. Billing limit과 observed scan gap을 연결해 경보하고, 복구 뒤 누락된 PR 중 아직 open인 것부터 재검토한다.

다섯 번째 실패는 **우회 경로의 과신**이다. Dependabot PR에 AI Scan은 없지만 code scanning ruleset이 모두 적용될 것이라 믿거나, merge queue에서도 ordinary PR과 같은 보호가 유지된다고 가정한다. 공식 제한을 기준으로 각 merge path를 별도 fixture로 검증한다.[3]

## 결론

GitHub AI Scan은 2026년 10월 15일 GA가 됐지만 merge gate가 된 것은 아니다. Finding은 advisory이고 code scanning check를 실패시키지 않으며 ruleset requirement로 merge를 막을 수 없다. Fork PR과 Dependabot PR에는 실행되지 않고, hard budget으로 Code Security AI Credits가 없어지면 설정이 enabled여도 finding을 생산하지 못할 수 있다.[1][2][6]

안전한 설계는 이 한계를 감추지 않는다. **AI Scan은 coverage를 넓히는 advisory signal**, **CodeQL·검증된 scanner·테스트·ruleset은 deterministic blocking signal**, **required review는 애매한 결과와 공백을 책임지는 human decision**으로 둔다. 세 상태를 같은 green badge로 합치지 않는다.

마지막 merge 판단에는 finding 개수보다 증거가 중요하다. 어느 head SHA를 보았는지, AI Scan이 적격이었고 실제 완료됐는지, fork·Dependabot·budget 공백은 없었는지, deterministic gate는 무엇을 차단했는지, 사람이 어떤 근거로 advisory를 해소했는지를 재구성할 수 있어야 한다. GA는 기능의 출시 상태다. Merge gate는 조직이 별도로 설계하고 검증해야 하는 권한 상태다.

## Sources

[1] https://github.blog/changelog/2026-10-15-ai-scan-for-pull-requests-generally-available/
[2] https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/code-scanning/ai-powered-security-detections
[3] https://docs.github.com/en/code-security/concepts/code-scanning/merge-protection
[4] https://docs.github.com/en/enterprise-cloud@latest/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection
[5] https://docs.github.com/en/billing/concepts/product-billing/github-advanced-security
[6] https://docs.github.com/en/enterprise-cloud@latest/billing/concepts/budgets-and-alerts
[7] https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-on-pull-requests
