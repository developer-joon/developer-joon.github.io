---
title: '오픈소스 라이선스를 PR merge gate로 만들 때 생기는 예외와 우회 경로'
date: 2026-10-17 06:40:00 +0900
categories: ["개발/보안"]
description: 'GitHub open source license compliance의 GA·적용 조건을 확인하고 탐지, 정책, 예외, 감사, read-back을 분리해 GPL·AGPL·SSPL 의존성 fixture로 merge gate를 검증한다.'
featured_image: 'https://picsum.photos/seed/github-license-compliance-merge-gate/1600/900'
tags: [github, license-compliance, dependency-graph, rulesets, sbom, open-source, supply-chain]
---

![GitHub 라이선스 정책과 PR merge gate의 상태 경계](https://picsum.photos/seed/github-license-compliance-merge-gate/1600/900)

GitHub는 2026년 10월 16일 open source license compliance를 generally available로 발표했다.[1] 이 기능은 enterprise가 허용 라이선스 정책을 중앙에서 정하고 ruleset으로 pull request를 검사하게 한다. 그러나 “GA”라는 한 단어가 모든 저장소에서 즉시 차단이 시작됐다는 뜻은 아니다. 발표가 명시한 대상은 GitHub Enterprise Cloud와 data-resident GHEC이며, GitHub Code Security가 활성화된 저장소다.[1] Dependency graph도 평가하려는 저장소에서 켜져 있어야 한다.[2]

라이선스 gate를 도입할 때 가장 위험한 오해는 판정 하나가 법적 결론이라는 생각이다. GitHub가 제공하는 결과는 dependency metadata와 조직이 입력한 정책을 비교한 제품 판정이다. 특정 결합 방식이 저작권 의무를 발생시키는지에 대한 법률 자문은 아니다. GitHub 문서도 내장 목록의 위험 분류는 정보 제공용이며 조직의 법무 지침을 대신하지 않는다고 밝힌다.[3] 따라서 운영자는 탐지, 정책, 예외, 감사, read-back을 서로 다른 상태로 보존해야 한다.

이 글은 generic한 “실패하면 merge를 막자”는 체크리스트를 반복하지 않는다. 초점은 어떤 dependency가 실제로 탐지됐는지, 어떤 policy가 그 repository에 유효한지, 누가 어떤 범위로 예외를 승인했는지, 변경 기록이 남았는지, 그리고 merge 직전 동일한 상태를 다시 읽었는지에 있다. GPL·AGPL·SSPL이라는 이름도 위험 등급표를 만들기 위해 사용하지 않는다. 서로 다른 SPDX 표현과 package 경로가 gate에서 어떻게 관찰되는지 시험하는 fixture 이름으로만 사용한다.

## GA와 실제 적용 가능 상태를 분리한다

발표 시점의 제품 상태는 GA다.[1] 반면 2026년 10월 17일 확인한 일부 세부 GitHub Docs 페이지에는 여전히 public preview라는 주의 문구가 남아 있었다.[2][3] 이는 발표를 preview로 되돌리는 증거라기보다 문서 surface 간 갱신 시차로 보는 편이 안전하다. 배포 기록에는 발표의 GA 상태와 확인한 문서의 잔존 preview 문구를 둘 다 남겨야 한다. 서로 다른 문구를 조용히 하나로 합치면 나중에 어떤 계약을 근거로 rollout했는지 알 수 없다.

GA 여부와 plan eligibility도 별개다. 이번 발표 범위는 GitHub Enterprise Cloud 고객이며 repository에는 GitHub Code Security가 활성화돼야 한다.[1] Configure 문서는 organization에 GitHub Code Security가 있고 enterprise policy와 ruleset을 관리할 권한이 있어야 한다고 적는다.[3] Dependency graph가 꺼져 있으면 평가 입력 자체가 준비되지 않는다.[3] 따라서 “Enterprise 계정이다”만으로 readiness를 true로 만들면 안 된다.

Repository별 준비 상태는 최소 다섯 값으로 나눈다. 첫째는 hosting platform이다. 둘째는 GitHub Code Security coverage다. 셋째는 dependency graph enablement다. 넷째는 적용되는 ruleset의 mode와 target이다. 다섯째는 effective policy와 exception set이다. 이 다섯 값 중 하나가 unknown이면 gate가 없다고 단정할 수도 없고 정상이라고 단정할 수도 없다.

GitHub Enterprise Server까지 이번 GA 범위라고 넓혀 쓰지 않는다. Announcement는 GHEC와 data-resident GHEC를 명시한다.[1] GHES 운영자는 자기 버전의 release note와 문서를 별도로 확인해야 한다. GitHub Team이나 개인 저장소에도 같은 entitlement가 있다고 추정해서는 안 된다. 제품 이름이 같아도 plan, hosting, repository coverage가 다르면 실제 기능 상태가 달라진다.

## 탐지 결과와 정책 판정을 한 필드로 합치지 않는다

License compliance는 repository의 dependency data를 사용하며 transitive dependency도 평가한다.[2] 그 입력은 dependency graph가 manifest와 lock file을 분석한 결과, 또는 dependency submission API로 제출된 데이터에서 온다.[4] 간접 dependency는 lock file에 정의되거나 API로 제출돼야 가장 안정적으로 드러난다.[4] 그러므로 `policy_result=pass`가 전체 production artifact의 모든 component를 보았다는 뜻은 아니다.

탐지 상태에는 package identity, version, relationship, manifest, detector, detected license를 남긴다. 정책 상태에는 policy revision, allowed SPDX expressions, 적용 scope, exception set을 남긴다. 판정 상태에는 compliant, noncompliant, unknown, not-evaluated를 구분한다. `unknown`을 compliant로 바꾸지 않는다. `not-evaluated`를 “라이선스 없음”으로 번역하지 않는다.

예를 들어 Gradle lock이 없는 동적 version은 오늘과 내일 다른 transitive graph를 만들 수 있다. GitHub가 manifest에서 direct dependency를 읽어도 실제 build가 선택한 간접 version과 차이가 날 수 있다. 반대로 build가 생성한 graph를 dependency submission API로 제출하면 detector와 제출 시각도 provenance가 된다.[4] 이 입력 경로의 차이를 지우면 같은 policy가 서로 다른 inventory에 적용된 사실을 놓친다.

라이선스 문자열도 package의 법적 해석 전체가 아니다. `GPL-3.0-only`, `GPL-3.0-or-later`, 복합 `AND`·`OR` 표현은 서로 다른 SPDX expression이다. 파일별 라이선스, vendored source, generated code, 선택 기능의 추가 dependency는 package 단위 metadata만으로 충분히 표현되지 않을 수 있다. 따라서 gate는 inventory와 triage의 자동화이지 source audit의 완전한 대체물이 아니다.

## Policy는 조직의 결정이고 detector는 관측 장치다

Enterprise policy는 built-in list에서 라이선스를 고르거나 SPDX identifier를 수동 입력해 만들 수 있다.[2][3] 문서가 표시하는 일반 위험 분류는 법률 결론이 아니다.[3] 조직은 제품 배포 방식, 수정 여부, network service 여부, 고객 계약, source 제공 절차를 반영해 별도 정책을 정해야 한다. 이 글은 GPL, AGPL, SSPL을 허용하거나 금지하라고 권하지 않는다.

정책 리뷰에는 `policy_id`, `revision`, `effective_from`, `approver`, `rationale`, `owner`를 남기는 편이 낫다. 이 필드는 운영 기록을 위한 제안이며 GitHub의 필수 schema라는 주장은 아니다. Allowlist를 바꿀 때는 어떤 repository 집합이 영향받는지도 계산한다. 한 license를 enterprise baseline에 추가하는 일과 특정 package를 한 repository에서 예외 처리하는 일은 blast radius가 다르다.

GitHub는 enterprise baseline 위에 repository-specific exception을 둘 수 있게 한다.[2] Ruleset은 enterprise, organization, repository scope에서 정의할 수 있다.[2] Repository custom property를 이용해 inactive, evaluate, active rollout 군을 나누는 절차도 공식 문서에 제시돼 있다.[3] 이 구조에서는 policy 문서 한 장보다 repository에 실제로 합성된 effective state가 더 중요하다.

정책 source를 Git repository에 복사해 두는 것만으로 GitHub의 적용 상태를 증명할 수 없다. 사람이 검토한 YAML과 platform UI의 effective policy가 달라질 수 있다. Repository settings의 License policy 화면은 결합된 policy와 exception set을 보여 준다.[3] GitHub REST API는 package URL 목록을 repository의 license compliance policy에 대조하는 `POST /repos/{owner}/{repo}/license-compliance/package-checks` endpoint를 제공한다.[5] 배포 자동화는 이 package check와 ruleset REST read-back을 사용하고, API가 반환하지 않는 exception 상세만 승인자의 UI evidence로 보완해야 한다.

## Ruleset의 Evaluate와 Active는 다른 결과다

Active ruleset에 `Require license compliance results before merging` 조건이 있으면 새 noncompliant dependency를 도입하는 pull request가 해결 전까지 차단된다.[2] Evaluate mode는 검사를 실행하고 annotation을 만들지만 그 조건 자체로 merge를 막지는 않는다.[2] 두 mode를 같은 “enabled”로 표시하면 shadow rollout과 enforcement를 구분할 수 없다. 성공 지표도 annotation 생성률과 실제 block률로 나눠야 한다.

또 하나의 교차 효과가 있다. Comment resolution을 요구하는 branch protection rule은 Evaluate ruleset에서 생성된 annotation도 추적할 수 있다.[2] 따라서 evaluate라서 절대로 차단하지 않는다고 단정하면 안 된다. License ruleset은 관찰 모드여도 다른 보호 규칙과 조합돼 merge 경로에 영향을 줄 수 있다. Pilot에서는 해당 repository의 전체 ruleset과 branch protection을 함께 읽어야 한다.

Ruleset target도 고정값이 아니다. Repository pattern, 명시적 선택, custom property가 바뀌면 같은 branch가 다음 실행에서 다른 정책을 받을 수 있다.[3] Custom property 변경 권한도 enforcement 권한의 일부다. `active`를 `evaluate`로 바꾸는 행위는 검사 엔진을 끄지 않아도 merge 차단을 제거할 수 있다. 그러므로 policy 변경만 감사하고 property와 ruleset 변경을 놓치면 우회 경로가 남는다.

Merge queue를 사용한다면 ordinary pull request와 queue-generated commit 모두에서 결과를 확인한다. Direct push, administrator path, bot merge, API merge도 fixture에 포함한다. GitHub가 이 모든 경로에서 동일하게 동작한다고 이 글이 미리 보증하는 것은 아니다. 실제 repository ruleset의 bypass actor와 enforcement 결과를 test repository에서 관찰하자는 권고다.

## GPL·AGPL·SSPL fixture는 법률 시험이 아니라 시스템 시험이다

작은 Maven 또는 Gradle repository에 direct dependency 세 개와 transitive dependency 세 개를 준비한다. Fixture package는 실제 production artifact가 아니라 재현 가능한 내부 package나 고정된 공개 package version을 사용한다. 각 package metadata에는 의도한 SPDX expression을 명시한다. 기대 결과 manifest도 repository에 둔다.

첫 번째 행은 direct `GPL-3.0-only`다. 두 번째 행은 direct `AGPL-3.0-only`다. 세 번째 행은 direct `SSPL-1.0`이다. 네 번째부터 여섯 번째 행은 각각 같은 표현이 transitive path에서만 들어오게 만든다. 일곱 번째 행은 detected license가 unknown인 package다. 여덟 번째 행은 복합 `MIT OR GPL-3.0-only` 표현이다.

```text
fixture_id | relationship | declared_expression       | expected_detection
G1         | direct       | GPL-3.0-only              | detected
A1         | direct       | AGPL-3.0-only             | detected
S1         | direct       | SSPL-1.0                  | detected
G2         | transitive   | GPL-3.0-only              | detected with path
A2         | transitive   | AGPL-3.0-only             | detected with path
S2         | transitive   | SSPL-1.0                  | detected with path
U1         | direct       | NOASSERTION               | unknown, never auto-allow
O1         | direct       | MIT OR GPL-3.0-only       | preserve expression
```

이 표의 expected_detection은 GitHub가 특정 package에 반드시 그 값을 부여한다는 보증이 아니다. 조직이 통제하는 metadata와 lock file을 이용해 detector의 관측 계약을 시험하자는 설계다. Product 결과가 expectation과 다르면 즉시 package를 위험하다고 결론 내리지 않는다. 먼저 manifest, lock, submitted snapshot, package metadata와 detected output을 비교한다.

각 행을 policy 결과와도 분리한다. 같은 `GPL-3.0-only`가 baseline에서 허용되면 compliant일 수 있고 금지되면 noncompliant일 수 있다. Package exception이 있으면 같은 표현이라도 특정 package와 scope에서 해소될 수 있다. 이 차이가 detector 오류가 아니라 policy 적용 결과일 수 있다. 그래서 fixture report에는 detection과 decision을 별도 열로 둔다.

## 예외는 alert 닫기가 아니라 범위가 있는 상태 전이다

Noncompliant finding은 개발자가 dependency를 바꾸거나 exception을 요청하거나 policy 자체를 변경해 해결할 수 있다.[3] Finding이 나타났다고 자동으로 exception request가 만들어지는 것은 아니다.[2] 요청이 필요하면 Enterprise Open Source License Manager가 검토한다.[2] 이 역할은 policy를 수정할 수 있으므로 일반 repository write 권한과 분리해야 한다.

공식 절차에서 승인자는 package, license, package pattern 중 예외 대상을 선택할 수 있다.[3] 적용 scope도 repository 또는 enterprise 중에서 고른다.[3] 승인 뒤 alert가 닫히고 다른 required check가 실패하지 않았다면 pull request 차단이 풀린다.[3] 즉 `alert_closed`와 `merge_allowed`도 같은 상태가 아니다.

운영 기록에는 요청자, 승인자, package identity, version 범위, detected expression, exception kind, scope, 근거 문서, 만료 시각을 둔다. GitHub가 모든 필드를 강제한다는 뜻은 아니다. 특히 만료와 재검토는 조직이 보완할 수 있는 lifecycle 통제다. 영구 enterprise-wide exception을 가장 쉬운 복구 버튼으로 사용하면 한 PR의 긴급성이 모든 repository의 baseline을 바꾼다.

예외 요청에는 법률 의견 원문 전체를 pull request annotation에 복사하지 않는 편이 낫다. 대신 접근이 통제된 검토 기록의 식별자와 결론 범위를 연결한다. 개발자는 package를 바꾸는 대안과 exception을 요청하는 대안을 구분해야 한다. Reviewer는 “이 package가 안전하다”가 아니라 지정된 scope와 조건에서 policy exception을 승인했다는 사실만 기록한다.

Exception이 적용된 뒤에는 원래 PR head SHA가 그대로인지 다시 확인한다. 승인 대기 중 manifest나 lock file이 바뀌었다면 과거 detection 결과를 재사용해서는 안 된다. 새 dependency가 추가됐는데 옛 exception 하나로 check가 green이 되는지 negative test를 둔다. Package pattern exception이 예상보다 넓게 일치하는지도 canary package로 확인한다.

## 감사 로그는 결과가 아니라 변경 이력이다

GitHub 문서는 license policy 변경이 audit log에 `license_compliance_policy` prefix의 Policy Management event를 남기며 action type은 `create` 또는 `modify`라고 설명한다.[3] 이 이벤트는 policy가 언제 누구에 의해 바뀌었는지 조사하는 데 유용하다. 그러나 audit event가 존재한다는 사실만으로 현재 repository에 원하는 policy가 적용됐음을 증명하지는 않는다. Audit는 transition evidence이고 effective-policy read-back은 state evidence다.

예외 승인, role assignment, custom property 변경, ruleset 변경도 별도 관찰 대상으로 삼는다. 공개 문서에서 확인하지 못한 event 이름을 추측해 검색식에 박아 넣지는 않는다. Test enterprise에서 실제 event payload와 action 이름을 먼저 수집한다. 그 뒤 SIEM parser와 retention 정책을 고정한다.

Audit stream은 rollout 전에 준비해야 한다. 나중에 stream을 켠다고 이전 사건이 복구되는 것은 아니다. 장기 규정 준수 보고가 필요하면 GitHub UI의 보존 기간과 조직의 외부 보존 요구를 비교한다. 원본 event, 수집 시각, parser version, ingestion gap을 함께 관리한다.

감사 dashboard의 총계만 보지 않는다. 특정 policy revision에서 어떤 repository가 active였고 어떤 exception이 유효했는지를 재구성할 수 있어야 한다. Repository가 삭제되거나 이름이 바뀌어도 stable identifier를 유지하는 편이 낫다. 사람이 보는 사유와 기계가 비교하는 scope를 모두 보존해야 한다.

## Read-back은 merge 직전의 실효 상태를 증명한다

배포 자동화가 policy 저장 요청에서 200을 받았다고 끝내면 안 된다. Repository의 effective policy와 exception set을 다시 읽는다.[3] Target ruleset이 Active인지 REST API로 확인한다. Branch와 repository가 실제 target에 포함되는지 확인한다. Dependency graph와 Code Security 적용 상태도 다시 확인한다.

다음 package-check 요청은 지정한 PURL이 **현재 repository 정책에서** 어떤 결과를 얻는지 확인하는 read-back이다.[5] `POST`이지만 정책을 변경하는 요청은 아니다. 응답은 package별 판정 증거이고, repository의 모든 dependency를 자동 발견하거나 예외의 전체 사유를 반환하는 API로 확대해서는 안 된다.

```bash
curl --fail-with-body -L -X POST \
  -H 'Accept: application/vnd.github+json' \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  "https://api.github.com/repos/$OWNER/$REPO/license-compliance/package-checks" \
  -d '{"purls":["pkg:npm/lodash@4.17.21"]}'
```

같은 revision에서 repository ruleset 목록과 target enforcement를 읽고 package-check 결과와 함께 receipt에 저장한다. Token에는 이 두 read surface에 필요한 최소 권한만 부여한다. 응답을 공개 CI log에 그대로 출력하기 전에는 repository와 policy metadata의 민감도를 검토한다.

Pull request에서는 annotation 존재만 보지 않는다. 평가한 base SHA와 head SHA를 기록한다. Detected dependency diff와 policy result를 fixture expectation에 대조한다. Check가 완료된 뒤 head가 바뀌면 새 결과를 기다린다. Merge 직전에도 required result가 같은 head에 붙어 있는지 확인한다.

SBOM은 read-back의 보조 수단이다. GitHub는 dependency graph의 현재 상태를 SPDX 형식 SBOM으로 내보내며 version, package identifier, license, transitive path 같은 정보를 포함할 수 있다.[6] UI나 REST API로 export할 수 있다.[6] 하지만 SBOM은 current inventory이고 pull request의 policy decision receipt는 아니다.

따라서 보존할 artifact를 셋으로 나눈다. 첫째는 base와 head의 dependency change 및 gate 결과다. 둘째는 merge 직전 effective policy와 exception snapshot이다. 셋째는 merge 후 repository SBOM이다. 셋이 같은 역할을 한다고 가정하지 않는다.

```text
MERGE_RECEIPT
  repository_id, pull_request, base_sha, head_sha
  detector_snapshot, dependency_diff
  policy_revision, ruleset_id, enforcement_mode
  effective_exceptions, decision, decided_at
  post_merge_sha, sbom_digest, read_back_at
```

이 receipt는 GitHub가 제공하는 표준 객체가 아니라 조직 확장이다. 원문 secret이나 불필요한 개인정보를 넣지 않는다. 목적은 “승인됐다”는 문장을 나중에 재현 가능한 입력과 연결하는 것이다.

## 성능과 비용은 manifest 수보다 graph 변화량에 가깝다

License gate의 직접 제품 가격은 계약과 Code Security 적용 범위에서 확인해야 한다. 이 글은 임의의 좌석 단가를 제시하지 않는다. 운영 비용은 policy review 시간, exception backlog, dependency graph 품질 개선, audit 보존, false-positive triage에서 생긴다. Merge latency도 비용이다.

벤치마크 fixture는 작은 repository 하나로 끝내지 않는다. Manifest 1개와 100개인 repository를 나눈다. Direct dependency 변화와 깊은 transitive 변화도 나눈다. Warm cache와 cold graph update를 구분한다. 결과는 PR annotation까지 걸린 시간과 merge-ready까지 걸린 시간을 따로 잰다.

관측 지표에는 detection latency p50·p95·p99를 둔다. Policy evaluation latency도 별도로 둔다. Unknown license 비율과 not-evaluated manifest 수도 기록한다. Exception request age와 approval lead time도 기록한다. Gate timeout 때문에 사람이 bypass한 비율도 본다.

Dependency graph가 불완전한 저장소는 check가 빠르게 끝나도 좋은 상태가 아니다. 반대로 대형 monorepo가 느리더라도 transitive path를 정확히 보여 주면 가치가 있을 수 있다. 성능 평가는 green 응답 속도가 아니라 inventory coverage와 함께 봐야 한다. 비용 최적화가 detector 입력 삭제로 이어져서는 안 된다.

## 실패 모드는 다섯 층에서 따로 복구한다

첫 번째 실패는 detection gap이다. Lock file 누락, unsupported manifest, stale submission, generated dependency가 원인일 수 있다. 이때 policy를 완화하지 말고 inventory source를 고친다. Unknown과 absent를 구분한다.

두 번째 실패는 policy mismatch다. 사람의 승인 문서와 GitHub effective policy가 다를 수 있다. 이때 repository read-back을 기준으로 merge를 보류한다. 승인된 변경을 다시 적용하거나 잘못된 scope를 되돌린다. 문서를 green evidence로 대신하지 않는다.

세 번째 실패는 exception overreach다. Package pattern이나 enterprise scope가 의도보다 넓을 수 있다. Canary package가 함께 허용되는지 시험한다. 넓게 적용됐다면 exception을 폐기하고 더 좁은 package 또는 repository scope로 재승인한다. 과거 merge receipt도 영향 분석에 사용한다.

네 번째 실패는 audit gap이다. 정책은 바뀌었지만 event가 수집되지 않았거나 parser가 버렸다. 이때 “변경 없음”으로 보고하지 않는다. 수집 공백을 incident로 기록하고 GitHub effective state와 관리자 변경 기록을 대조한다. Audit 복구 전에는 대규모 policy migration을 멈추는 편이 안전하다.

다섯 번째 실패는 stale success다. Check가 통과한 뒤 head, base, policy, ruleset target 중 하나가 변할 수 있다. Merge queue와 branch update fixture로 재현한다. 결과가 자동 재평가되지 않으면 별도 required check가 SHA와 policy revision을 검증해야 한다. Green badge 하나를 영구 승인으로 취급하지 않는다.

## 우회 경로는 actor보다 상태 변화로 찾는다

Administrator, automation, merge queue, API는 서로 다른 actor path다. 어느 path가 required result 없이 branch state를 바꿀 수 있는지가 더 중요하다. Test repository에서 direct push, force push, web edit, API merge, bot PR, ruleset bypass를 각각 실행한다. 실제 production secret이나 법적 위험이 있는 package를 쓰지 않는다.

Ruleset target에서 빠지는 새 repository도 우회다. Custom property 기본값이 inactive라면 생성 직후 repository는 enforcement 밖일 수 있다.[3] Repository template과 provisioning workflow에서 target property를 설정하고 read-back한다. 이름 pattern에만 의존하면 rename이나 transfer가 scope를 바꿀 수 있다.

Dependency 입력을 제거하는 우회도 본다. Lock file 삭제, manifest rename, dependency submission 중단, generated manifest 이동을 fixture로 만든다. 기대 결과는 무조건 noncompliant가 아니라 `coverage_changed`다. Coverage 감소를 clean result로 표시하면 gate가 가장 필요한 순간에 조용히 사라진다.

Exception 우회는 기존 package와 비슷한 이름, wildcard pattern, version 변경으로 시험한다. Policy 우회는 SPDX expression의 `OR`, custom identifier, 대소문자와 whitespace를 사용한다. 제품이 어떤 normalization을 적용하는지는 관찰 결과로 고정한다. 추측한 parser 동작을 정책으로 만들지 않는다.

## 보안과 라이선스 책임은 자동화 뒤에도 남는다

Dependency graph와 SBOM에는 내부 package 이름과 version, repository 구조가 포함될 수 있다. Export artifact의 접근 권한과 retention을 정한다. Audit stream과 exception 기록도 최소 권한으로 제한한다. 외부 ticket에 전체 SBOM을 무심코 첨부하지 않는다.

Policy manager role은 예외와 baseline을 바꿀 수 있는 높은 권한이다.[2][3] 개인 한 명에게 상시 부여하기보다 팀, 승인 규칙, 정기 access review를 검토한다. 긴급 merge가 role 획득 사유가 되지 않게 한다. 승인과 merge를 가능하면 다른 책임자가 확인한다.

라이선스 판정은 취약점 판정과도 다르다. 허용된 라이선스 package가 안전한 version이라는 뜻은 아니다. 취약점이 없는 package가 조직의 license policy를 만족한다는 뜻도 아니다. SBOM이 존재한다고 source 제공 의무나 notice 생성이 자동 이행되는 것도 아니다.

법무 검토가 필요한 사건은 자동화 결과와 함께 사람에게 전달한다. Detector의 표현, dependency path, 사용 방식, 배포 모델, 수정 여부를 구분한다. 이 글의 fixture 결과를 실제 라이선스 의무에 대한 의견으로 인용해서는 안 된다. 최종 정책 지침은 조직의 적격한 담당자가 정해야 한다.

## 중앙 license policy가 맞는 팀과 부담이 큰 팀

이 기능은 GHEC와 GitHub Code Security를 이미 운영하고 dependency graph coverage가 높은 enterprise에 잘 맞는다. 여러 조직의 policy를 중앙화하면서 repository별 exception을 통제하려는 팀에도 적합하다. Ruleset과 custom property로 evaluate에서 active로 점진 전환하려는 환경에도 맞는다. Audit와 SBOM을 기존 governance pipeline에 연결할 수 있다면 read-back 가치가 커진다.

반대로 lock file이 없고 build-time dependency가 외부 시스템에만 있는 팀에는 즉시 강제 gate가 맞지 않는다. GHES나 다른 forge를 주로 사용하는 팀도 이번 GHEC GA만으로 같은 기능을 가정하면 안 된다. 법무 기준이 정해지지 않은 조직은 tool의 내장 위험 분류를 임시 정책으로 승격시키면 안 된다. 몇 시간 안에 예외 승인이 필요한데 reviewer와 lifecycle이 없는 팀은 merge 병목부터 만들 가능성이 크다.

단일 repository와 소수 dependency만 가진 팀은 dependency review action 같은 기존 경로와 운영 복잡도를 비교할 수 있다. 새 기능이 항상 더 싼 것은 아니다. 중앙 policy, role, audit, exception workflow의 이익이 관리 비용보다 큰지 판단해야 한다. 도구 선택보다 먼저 inventory 품질과 의사결정 책임을 고정해야 한다.

## 결론

GitHub open source license compliance는 2026년 10월 16일 GHEC의 GitHub Code Security 적용 저장소를 대상으로 GA가 됐다.[1] 세부 문서에 남은 preview 표시는 확인 시점의 문서 시차로 기록하되 발표의 범위를 임의로 축소하거나 GHES까지 넓히지 않는다.[2][3] Active ruleset은 위반을 merge 전에 막을 수 있고 Evaluate mode는 관찰 rollout을 가능하게 한다.[2] 그러나 다른 branch protection과 결합된 실제 결과는 repository에서 확인해야 한다.

좋은 gate는 라이선스 이름 목록이 아니다. **탐지된 graph, 조직 policy, 승인된 exception, audit transition, merge 직전 effective-state read-back**이 연결된 시스템이다. GPL·AGPL·SSPL fixture는 법률 결론을 자동화하지 않는다. Direct와 transitive dependency, unknown metadata, 복합 SPDX expression, exception scope와 stale result를 반복 재현하는 장치다.

마지막 성공 조건은 green check가 아니다. 어떤 head SHA가 어떤 inventory와 policy revision으로 평가됐고 어떤 예외가 적용됐으며 merge 후 SBOM이 무엇이었는지 재구성할 수 있어야 한다. 그 증거가 없으면 자동화는 판단을 빠르게 했을 뿐 책임 경계를 선명하게 만들지 못한다.

## Sources

[1] https://github.blog/changelog/2026-10-16-open-source-license-compliance-generally-available
[2] https://docs.github.com/en/code-security/concepts/supply-chain-security/open-source-license-compliance
[3] https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-license-policies
[4] https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-graph
[5] https://docs.github.com/en/rest/dependency-graph/license-compliance?apiVersion=2026-03-10
[6] https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/exporting-a-software-bill-of-materials-for-your-repository
