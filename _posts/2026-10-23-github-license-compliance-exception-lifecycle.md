---
title: '오픈소스 라이선스를 merge gate로 만들 때 예외 만료가 더 중요한 이유'
date: 2026-10-23 09:00:08 +0900
categories: ["개발/보안"]
description: 'GitHub license compliance 예외를 탐지·요청·기한부 승인·만료·제거·재차단 상태로 운영하고, 외부 만료 레지스트리와 감사 증거로 영구 우회를 막는 방법을 다룬다.'
featured_image: 'https://picsum.photos/seed/github-license-compliance-exception-lifecycle/1600/900'
tags: [github, license-compliance, rulesets, exception, policy, audit-log, supply-chain]
---

![햇빛이 비치는 숲을 배경으로 서 있는 어린 사슴](https://picsum.photos/seed/github-license-compliance-exception-lifecycle/1600/900)

라이선스 merge gate의 GA 범위, Active·Evaluate ruleset, 예외 scope, audit와 merge 직전 read-back은 선행 글 [오픈소스 라이선스를 PR merge gate로 만들 때 생기는 예외와 우회 경로]({% post_url 2026-10-17-github-license-compliance-merge-gate %})에서 다뤘다. 이번 글은 그 설명을 반복하지 않고, 승인 이후 `expires_at` scheduler가 동시 갱신과 제거 경쟁을 어떻게 처리하고 `blocked_again` receipt를 남기는지에만 집중한다.

배경 계약은 짧게 고정한다. GitHub는 2026년 10월 16일 이 기능을 GA로 발표했고,[1] 공식 문서는 Active와 Evaluate 동작 및 예외 흐름을 설명한다.[2] 내장 위험 분류는 법률 자문을 대신하지 않는다.[3] 따라서 아래 상태와 필드는 GitHub 표준이 아니라, 승인된 정책을 기한부로 집행하기 위한 조직의 engineering extension이다.

## GitHub의 제품 상태와 조직의 lifecycle을 분리한다

Active ruleset이 적용된 pull request에서 새 dependency가 정책을 위반하면 merge가 막힌다. 개발자는 dependency를 교체하거나, 정책 변경을 기다리거나, 예외를 요청할 수 있다. 요청은 자동 생성되지 않으며 Enterprise Open Source License Manager가 승인하면 package·license·package pattern과 repository·enterprise scope를 선택할 수 있다. 승인 후 alert가 닫히고 다른 required check가 실패하지 않았다면 pull request가 풀린다.[2][3]

여기까지는 제품이 제공하는 흐름이다. 그러나 현재 공식 REST policy 표현의 package entry에는 package manager, name, action, reason, 추가 허용 SPDX 식, `added_at`이 있고 `expires_at`은 없다.[4] 따라서 “30일 승인”이라는 회의 결론을 GitHub가 30일 뒤 자동 철회한다고 가정해서는 안 된다. 만료일, 재검토 owner, 제거 job과 재차단 증거는 조직이 별도로 관리해야 한다.

이 글에서 사용할 상태는 다음과 같다.

```text
detected
  → blocked
  → exception_requested
  → approved_until
  → expired
  → removal_pending
  → blocked_again

분기:
exception_requested → denied → blocked
approved_until → revoked_early → removal_pending
expired → renewal_requested → approved_until (새 승인 ID와 새 기한)
```

이 이름들은 **GitHub API나 webhook의 표준 enum이 아니다.** GitHub finding, closure request, policy entry, ruleset 결과를 조직 내부 registry가 정규화한 상태다. 제품 상태를 복사한 척하지 말고 `source_event`, `observed_at`, 원본 resource 식별자를 함께 저장해야 한다.

## `approved_until`은 승인 메모가 아니라 실행 계약이다

기한부 예외 레코드는 최소한 다음 질문에 답해야 한다.

| 필드 | 목적 |
|---|---|
| `exception_id` | ticket 번호와 분리된 불변 식별자 |
| `repository_id` | rename에도 유지되는 대상 repository |
| `package_manager`, `package_name` | 예외 대상 identity |
| `approved_purl_constraint` | 별도 required check가 강제할 exact PURL 또는 검토된 version 범위 |
| `detected_expression` | 승인 당시 관측된 SPDX expression |
| `github_scope` | repository 또는 enterprise |
| `github_exception_kind` | package, license, package pattern |
| `requester`, `approver` | 요청과 위험 인수 책임 분리 |
| `legal_decision_ref` | 접근 통제된 검토 기록의 참조만 저장 |
| `approved_at`, `expires_at` | 유효 구간 |
| `expected_policy_fingerprint` | 적용·제거 때 비교할 정책 snapshot |
| `status`, `last_reconciled_at` | 내부 lifecycle과 마지막 read-back |

`expires_at`과 `approved_purl_constraint`는 GitHub field가 아니라 조직 확장이다. GitHub native package exception에는 version constraint가 없으므로, exact PURL·version 제한이 필요하면 PR의 실제 dependency version과 내부 승인 registry를 대조하는 별도 required check가 fail-closed로 강제해야 한다. `legal_decision_ref`에도 법률 의견 원문이나 고객 기밀을 복사하지 않는다. CI annotation에는 예외 ID, 대상, 만료일, 문의 경로 정도만 노출하고 상세 근거는 최소 권한 저장소에 둔다.

GitHub native 범위는 가능하면 repository와 exact package name 쪽으로 좁힌다. Version까지 좁히는 것은 native exception의 기능이 아니며 앞서 말한 별도 required check의 책임이다. Package pattern은 새 이름이나 예상하지 못한 version까지 포함할 수 있고, enterprise scope는 한 pull request의 긴급성을 모든 repository에 전파한다. 넓은 범위가 필요하면 “왜 repository·package 범위와 외부 PURL check로 해결할 수 없는가”를 승인 입력으로 요구한다.

`approved_until`에는 시간뿐 아니라 조건도 묶어야 한다. 예를 들어 head SHA, manifest path, package identity, 내부 `approved_purl_constraint`, detected license가 바뀌면 같은 승인을 재사용하지 않는다. 이 비교도 GitHub native exception이 아니라 별도 required check가 수행한다. 승인 대기 중 lockfile이 갱신됐거나 transitive path가 달라지면 새 detection 결과로 돌아간다. 날짜가 남았다는 이유만으로 대상이 달라진 승인을 계속 적용하면 TTL이 있어도 scope 통제는 실패한다.

## 만료 writer는 승인·적용·merge 시각을 섞지 않는다

선행 글의 일반 read-back 절차를 다시 설계하지 않는다. 여기서 필요한 것은 scheduler가 오래된 snapshot으로 갱신이나 제거를 덮어쓰지 않도록 네 시각과 revision을 분리하는 일이다.

```text
requested_at  사람이 예외를 요청한 시각
approved_at   승인자가 범위와 기한을 결정한 시각
applied_at    GitHub effective policy에서 예외를 읽은 시각
unblocked_at  같은 PR head에서 gate가 통과한 시각
```

GitHub 문서는 repository 설정에서 enterprise baseline과 repository exception을 합친 effective policy를 확인할 수 있다고 설명한다.[2][3] `approval_recorded`에서 platform read-back이 일치할 때만 `approved_until`로 전이하되, 내부 PURL constraint의 통과는 별도 required check receipt로 남긴다. Native policy read-back만으로 version 제한까지 확인했다고 기록하면 안 된다.

Enterprise policy API는 package entry의 `reason`과 `added_at`을 반환하고 package-check endpoint는 PURL을 현재 정책에 대조한다.[4] 어느 응답에도 내부 `expires_at`이나 native version constraint가 생기는 것은 아니다. Scheduler는 GitHub policy revision과 내부 registry revision을 모두 compare-and-swap 조건으로 사용하고, 둘 중 하나가 바뀌면 쓰기를 중단해 최신 승인과 제거를 다시 조정한다.

특히 enterprise policy를 자동 수정할 때는 현재 전체 문서를 읽고 일부 배열만 덮어쓰는 식의 경쟁 조건을 피해야 한다. 공식 `Set the license compliance policy` endpoint는 `licenses`와 `packages` 배열을 받는 정책 설정 작업이다.[4] 두 승인자가 오래된 snapshot을 바탕으로 각각 쓰면 한쪽 변경을 잃을 수 있다. 단일 writer queue, fingerprint 비교, 변경 직전 재조회, 변경 후 read-back을 사용하고 예상 fingerprint가 달라지면 자동 merge하지 않는다. Repository scope 예외와 UI-only 절차가 섞여 있다면 같은 endpoint로 처리할 수 있다고 추정하지 말고 surface별 adapter와 수동 확인 단계를 둔다.

## 만료는 달력 event가 아니라 제거 workflow다

자정이 지났다고 예외가 사라지는 것은 아니다. Scheduler가 `expires_at <= now`를 발견하면 내부 상태만 `expired`로 바뀐다. 이 시점부터 다음 merge를 허용해서는 안 되지만, GitHub에는 예외가 남아 있을 수 있다. 그래서 `expired`와 `removed`를 합치지 않는다.

권장 workflow는 다음과 같다.

1. 만료 14일·7일·24시간 전에 owner와 repository maintainer에게 알린다.
2. 기한에 도달하면 registry를 `expired`로 바꾸고 신규 사용을 fail-closed한다.
3. 현재 effective policy를 읽어 대상 exception과 fingerprint를 다시 확인한다.
4. 예상 항목만 제거하고 결과를 다시 읽는다.
5. 승인 당시의 inert fixture 또는 동일 PURL을 새 PR에서 평가한다.
6. Active ruleset과 같은 target branch에서 실제로 다시 차단될 때 `blocked_again`으로 닫는다.

여기서 “fail-closed”는 GitHub가 제공하는 새 모드가 아니다. 만료됐지만 제거가 확인되지 않은 exception ID가 있으면 조직의 별도 required check가 merge-ready를 내지 않는 운영 설계다. GitHub native check가 잠시 green이어도 registry 상태가 `expired` 또는 `removal_pending`이면 merge를 보류한다.

제거 작업은 idempotent해야 한다. Scheduler가 재실행됐는데 항목이 이미 없다면 성공으로 끝내기 전에 누가 언제 제거했는지 audit evidence를 찾는다. 반대로 같은 package name의 새 예외가 다른 승인 ID로 생성됐다면 이름만 보고 삭제하지 않는다. GitHub에서 읽을 수 있는 scope, package manager, name, 추가 SPDX 식, `added_at`, reason 속 내부 ID를 대조하고, version은 별도 registry와 required-check receipt에서 검증한다. 어느 쪽이든 불일치하면 사람이 확인한다.

## 재차단은 policy read-back과 negative test 두 단계다

예외 항목이 목록에서 사라진 것만으로 lifecycle을 닫으면 안 된다. Target repository가 Evaluate mode로 이동했거나 ruleset target에서 빠졌다면 policy는 깨끗해 보여도 merge는 막히지 않는다. GitHub의 branch rules API는 해당 branch에 적용되는 active rule을 반환하며 evaluate·disabled ruleset의 규칙은 반환하지 않는다. Ruleset API에는 `active`, `evaluate`, `disabled` enforcement와 bypass actor 정보가 있다.[5]

따라서 expiration verifier는 다음 receipt를 만든다.

```text
EXPIRY_RECEIPT
  exception_id
  repository_id, target_branch
  expired_at, removal_started_at, removed_at
  policy_fingerprint_before, policy_fingerprint_after
  ruleset_id, enforcement, license_compliance_rule_present
  fixture_purl, package_check_result
  test_pr, base_sha, head_sha
  expected_result=blocked
  observed_result=blocked
  verified_at, verifier_identity
```

이 receipt도 GitHub 표준 객체가 아니라 조직 확장이다. 성공 조건은 `policy entry absent`와 `test PR blocked`가 모두 true인 것이다. Package-check가 noncompliant를 반환했지만 ruleset이 Evaluate라서 merge 가능한 경우는 `blocked_again`이 아니다. 반대로 PR이 다른 required check 때문에 막혔다면 license gate 재차단 증거가 아니다. Annotation 또는 check 결과에서 license policy violation이 원인임을 확인한다.

실제 위험 package를 반복 설치할 필요는 없다. 조직이 소유한 inert package나 실행 코드가 없는 fixture를 사용해 허용되지 않은 metadata를 재현한다. Production repository에 시험 dependency를 넣을 수 없다면 전용 canary repository에 동일 enterprise policy와 ruleset target을 적용하되, canary 결과를 production coverage 증거로 과장하지 않는다. 최종 확인은 대상 repository의 effective policy와 active rule read-back이어야 한다.

## 갱신은 만료일 수정이 아니라 새 위험 인수다

만료 직전 owner가 “한 달만 연장”을 요청해도 기존 row의 날짜만 바꾸지 않는다. 최초 승인 때의 package version, 배포 모델, 대체 dependency 가능성, 법무 판단이 여전히 같은지 확인한다. 갱신에는 새 `exception_id` 또는 최소한 immutable revision을 부여하고 이전 승인의 `superseded_by`를 남긴다.

갱신 경쟁도 명시적으로 처리한다. Scheduler가 제거를 시작한 뒤 renewal이 승인되면 다음 순서를 따른다.

```text
expired(old)
  → removal_pending(old)
  → blocked_again(old)
  → exception_requested(new)
  → approved_until(new)
```

긴급 사유로 재차단 공백을 허용하지 않기로 했다면 별도 정책에 따라 renewal을 먼저 적용할 수 있다. 그 경우에도 old approval을 되살리지 말고 새 승인과 새 기한을 만든다. 제거 job과 갱신 job이 서로의 write를 덮지 않도록 policy fingerprint와 per-package lock을 사용한다. 어느 전략이든 audit trail에서 “누가 날짜를 바꿨는지”가 아니라 **어떤 근거로 새 위험 인수가 시작됐는지** 보여야 한다.

## 감사 로그는 전이 증거이고 registry는 의도 증거다

GitHub는 license policy 변경을 Policy Management 범주의 `license_compliance_policy` prefix, `create` 또는 `modify` action으로 audit log에 남긴다고 문서화한다.[3] GA 발표도 policy 변경 audit event와 closure request lifecycle의 개선을 명시한다.[1] 이 event는 누가 언제 GitHub 상태를 바꿨는지 확인하는 데 유용하지만 조직의 `expires_at`이나 재검토 조건까지 담는다고 가정해서는 안 된다.

Audit log, webhook, scheduler log, effective-state snapshot의 역할을 나눈다.

- **Webhook**: request 생성·응답·취소를 빠르게 받아 내부 workflow를 진행한다. Delivery ID로 중복 처리를 막는다.[3]
- **Audit log**: 실제 policy 변경 actor와 시각을 조사한다.
- **Exception registry**: 승인 범위, 법무 판단 참조, 만료일과 owner라는 조직 의도를 보존한다.
- **Read-back receipt**: 특정 시점에 GitHub에 적용된 상태와 재차단 결과를 증명한다.

GitHub Enterprise Cloud audit log의 일반 web event 보존은 180일이며 기본 화면은 최근 3개월을 보여 준다.[6] 예외가 1년 뒤 만료될 수 있다면 만료 시점에 과거 승인 event를 UI에서 찾을 수 있다고 전제하지 않는다. 필요한 event를 외부 system of record로 스트리밍하고 원본 event ID, 수집 시각, parser version, ingestion gap을 보존한다. 다만 외부 저장 기간은 조직의 개인정보·보존 정책에 맞춰 정한다.

매일 reconciliation은 양방향이어야 한다. Registry에는 active인데 GitHub에 없는 예외, GitHub에는 있는데 registry에 없는 예외, scope나 reason이 다른 예외를 모두 찾는다. 첫 번째는 조기 철회 또는 적용 실패일 수 있고, 두 번째는 통제 밖 수동 변경일 수 있다. 어느 쪽도 자동으로 정상화하지 않는다. 특히 GitHub-only exception은 즉시 `unmanaged_exception` incident로 격리하고, provenance가 확인될 때까지 범위 확대나 갱신을 금지한다.

## 운영 지표는 승인 속도보다 닫힘을 측정한다

예외 queue의 평균 승인 시간만 최적화하면 승인자는 넓고 긴 예외를 선택하게 된다. Dashboard에는 다음 수를 함께 둔다.

- Active exception 수와 repository·enterprise scope 비율
- 내부 PURL 제한을 별도 check로 강제한 승인 대비 package pattern·license exception 비율
- 30일 이내 만료 예정 수와 owner 없는 예외 수
- `expired`, `removal_pending`에 머문 시간
- 만료 후 실제 제거까지의 p50·p95
- 제거 후 `blocked_again`까지의 p50·p95
- Renewal 비율과 연속 갱신 횟수
- Registry와 GitHub effective policy의 drift 수
- Expired exception이 적용된 상태에서 발생한 merge 시도 수

SLO 예시는 “만료 4시간 안에 제거”와 “제거 2시간 안에 재차단 receipt 생성”처럼 두 단계로 둔다. 수치는 조직의 운영 여건에 맞춰 정한다. 중요한 점은 `expired` row를 closed ticket으로 세지 않는 것이다. `blocked_again` 또는 승인된 대체 통제로 끝나기 전에는 backlog다.

## 최소 rollout은 한 예외의 전체 수명을 통과해야 한다

Pilot은 많은 license를 등록하는 작업이 아니다. 하나의 안전한 fixture로 전체 cycle을 반복하는 작업이다.

1. Evaluate ruleset에서 finding과 request 경로를 확인한다.
2. Active로 전환해 같은 fixture가 license reason으로 merge를 막는지 본다.
3. GitHub에는 repository·package 범위의 짧은 예외를 요청하고, exact version은 내부 PURL required check에 등록한다.
4. 승인과 GitHub effective policy read-back을 분리해 기록한다.
5. 같은 head에서 gate가 풀리는지 확인한다.
6. 만료 뒤 조직 check가 먼저 fail-closed하는지 본다.
7. GitHub exception을 제거하고 policy를 다시 읽는다.
8. 새 head의 test PR이 license reason으로 다시 차단되는지 확인한다.
9. Audit event와 lifecycle receipt를 연결한다.
10. 중복 webhook, scheduler 재실행, 동시 갱신을 넣어 idempotency를 시험한다.

이 과정에서 한 단계라도 수동 screenshot에만 의존하면 자동화 전에 증거 계약부터 보완한다. UI는 승인자가 판단하기 좋지만 drift 탐지와 대규모 만료 처리에는 stable identifier와 read-back이 필요하다. 반대로 API가 있다고 법률 판단을 자동화하지 않는다. API는 승인된 결정을 재현 가능하게 적용하고 철회하는 수단이다.

## 결론

GitHub open source license compliance의 GA는 enterprise policy와 PR ruleset, exception review, API와 audit event를 한데 묶었다.[1] 그러나 제품이 예외의 business TTL까지 대신 정의해 주는 것은 아니다. 현재 공식 policy API의 package exception 표현에는 `added_at`은 있지만 `expires_at`은 없다.[4] 기한부 승인, owner, renewal, 만료와 재차단은 조직의 engineering control로 명시해야 한다.

좋은 예외 workflow의 마지막 상태는 `approved`가 아니다. **`detected → blocked → exception_requested → approved_until → expired → removal_pending → blocked_again`**이 끝까지 이어져야 한다. 승인과 적용, 만료와 제거, policy read-back과 실제 merge 차단을 각각 다른 증거로 남긴다.

법무팀은 어떤 범위의 사용을 받아들일지 결정한다. 엔지니어링팀은 그 결정을 영구 allowlist로 변질시키지 않도록 시간·scope·동시성·감사·negative test를 관리한다. 예외 만료가 중요한 이유는 단순하다. Gate의 강도는 처음 막은 횟수가 아니라, 임시로 열었던 문을 약속한 때에 다시 닫았다는 증거로 결정된다.

## Sources

[1] https://github.blog/changelog/2026-10-16-open-source-license-compliance-generally-available
[2] https://docs.github.com/en/code-security/concepts/supply-chain-security/open-source-license-compliance
[3] https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-license-policies
[4] https://docs.github.com/en/enterprise-cloud@latest/rest/dependency-graph/license-compliance?apiVersion=2026-03-10
[5] https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10
[6] https://docs.github.com/en/enterprise-cloud@latest/admin/concepts/security-and-compliance/audit-log-for-an-enterprise
