---
title: '정규식이 못 잡는 비밀번호: AI 시크릿 탐지를 Push Gate에 넣기 전에 설계할 것들'
date: 2026-10-13 11:00:00 +0900
categories: ["AI 보안"]
description: 'GitHub의 문맥 기반 시크릿 탐지를 결정적 탐지기와 계단식으로 배치하고, push 시점 실패 정책·AI Credit 예산·우회 통제·자격 증명 회전을 하나의 운영 계약으로 설계한다.'
featured_image: 'https://picsum.photos/seed/ai-secret-detection-push-gate/1600/900'
tags: [github, secret-scanning, push-protection, ai-security, credentials, github-advanced-security, ai-credits]
---

![AI 시크릿 탐지 Push Gate 운영 설계](https://picsum.photos/seed/ai-secret-detection-push-gate/1600/900)

`ghp_`처럼 형식이 정해진 토큰은 정규식으로 찾기 쉽다. 반면 `db_password = "spring-demo-2026"`처럼 서비스 이름도 길이 규칙도 없는 문자열은 값 하나만 보고 비밀번호인지 테스트 데이터인지 판단하기 어렵다. GitHub는 2026년 10월 7일 주변 코드를 읽어 이런 비정형 자격 증명을 식별하는 전용 모델을 발표했다.[1] 모델은 코드나 설명문을 생성하는 범용 도구가 아니라 시크릿 가능성을 분류하도록 미세 조정됐다고 GitHub는 설명한다.[1]

중요한 변화는 모델 자체보다 실행 위치다. 같은 분류기를 저장 후 alert scan, push protection, Copilot `/security-review`에 배치하면 시간 제약과 실패 비용이 달라진다.[1] 저장 후 경보는 재처리할 수 있지만 push gate는 개발자의 쓰기 경로에 동기적으로 개입한다.

따라서 “AI가 정규식보다 똑똑하니 차단을 켠다”는 접근은 부족하다. 이 글의 질문은 취약점 후보를 어떻게 검증할지가 아니다. **결정적 탐지와 문맥 분류를 어떤 순서로 실행하고, 모델·네트워크·예산이 실패했을 때 push를 허용할지, 실제 자격 증명이 들어갔다면 누가 회전시키며, 생성 산출물이 gate를 우회하지 못한다는 사실을 어떻게 시험할지**를 하나의 운영 계약으로 만드는 방법이다.

## 먼저 네 가지 제품 상태를 분리한다

본문의 GitHub 제품·문서 상태 확인일은 **2026-10-13**이다. 발표문은 네 가지 상태를 한꺼번에 다루지만, 이를 모두 “출시된 AI push protection”이라고 요약하면 안 된다.

첫째, **AI-detected secret alert scan은 기존 고객에게 적용된 업그레이드**다. AI-detected Password alert를 사용하던 고객은 새 모델로 자동 전환됐고, 기존 alert scan은 GitHub Secret Protection(GHSP) 또는 GitHub Advanced Security(GHAS)에 추가 요금 없이 계속 포함된다.[1] 현재 설정 문서도 AI 기반 generic secret detection이 조직·엔터프라이즈 소유 저장소에서 GitHub Secret Protection을 켠 경우 제공되며 Copilot 구독은 필요하지 않다고 설명한다.[2]

둘째, **AI-detected secrets in push protection은 private preview**다. 관리자가 정책이 허용하는 범위에서 별도로 켜야 하며, GitHub Enterprise Cloud 또는 GitHub Team의 github.com 저장소가 유료 GHSP/GHAS 적용을 받아야 대상이 된다.[1] 공개·비공개·internal 저장소가 대상이 될 수 있지만, Copilot Business나 Enterprise 구독만으로 이 기능의 GHSP 요건을 대신하지는 못한다.[1]

셋째, **Copilot `/security-review`의 secret classifier 결합은 coming soon인 private preview 계획**이다. `/security-review` 자체는 Copilot CLI의 read-only 보안 전문 agent이며, Copilot 앱의 해당 명령은 현재 변경분에서 높은 신뢰도의 취약점을 찾아 우선순위·심각도·신뢰도와 수정 제안을 반환하는 public preview다.[3][4] 그러나 10월 7일 발표 시점에 새 secret classifier가 이 review에 이미 들어갔다는 뜻은 아니며, GitHub는 기존 LLM 기반 review 옆에 해당 검사를 추가할 예정이라고 밝혔다.[1]

넷째, **AI Credit 과금은 발표된 계획**이다. 포함된 alert scan과 달리 opt-in AI push protection 및 `/security-review`의 새 secret check에는 향후 AI Credit 사용량이 도입된다. GitHub는 public preview에 opt-in하고 기능을 활성화한 뒤 과금이 시작된다고 예고했다.[1] 발표문은 이 과금 모델을 broader availability 전에 공유한 것이고 도입 시점을 “coming weeks”로 표현하므로, 현재 청구됐다고 단정해서는 안 된다.[1]

배포 문서에는 `alert scan upgraded`, `push private preview`, `review integration coming soon`, `AI Credit billing planned`를 구별해 고정한다.

## 정규식과 AI는 대체 관계가 아니라 계단식이다

GitHub의 현재 분류에서 provider pattern은 AWS·Stripe처럼 발급자가 정해진 토큰을 정규식 기반으로 찾고, generic pattern은 private key·connection string 같은 공급자 비종속 형식을 정규식으로 찾으며, AI-detected category는 password 같은 비정형 값을 모델로 찾는다.[5] 공식 application card도 generic secret detection의 목적을 결정적 pattern matching이 찾지 못하는 비정형 시크릿의 식별로 설명한다.[6]

이 구분은 운영 아키텍처의 힌트다. 필자의 권고는 **결정적 탐지기를 1단계, AI 분류기를 2단계로 두는 cascade**다. 이는 GitHub가 공개한 내부 처리 순서나 현재 preview에서 설정할 수 있는 control 목록이 아니라, 외부 보완 계층을 포함한 개념적 wrapper architecture다.

```text
변경된 blob 수집
  → 1단계: provider·generic·custom deterministic pattern
      → 확실한 일치: 즉시 block 또는 기존 bypass 절차
      → 미일치: 2단계 AI 대상 선별
  → 2단계: 주변 코드와 함께 context classification
      → 정책 threshold 이상: block 또는 승인형 bypass
      → threshold 미만: 허용하되 표본·지표만 기록
  → 저장 후 전체 이력 alert scan은 별도로 계속 실행
```

첫 단계에서는 구조가 안정된 토큰을 설명 가능하고 반복 가능한 기존 matcher가 처리한다. 모델 rollout, threshold 변경, credit 소진이 알려진 토큰의 차단 결과를 바꾸지 않게 하는 것이 핵심이다.

두 번째 단계에는 결정적 규칙이 처리하지 못한 문자열과 필요한 최소 문맥만 보낸다. 후보가 없는 이미지·vendor binary·대형 generated bundle까지 무차별 분류하지 말고, assignment·환경 변수·connection setup·인증 header처럼 자격 증명 문맥을 만들 수 있는 변경을 대상으로 삼는다. 다만 이 선별기가 곧 공격자의 우회 지점이 되므로 “AI 비용 절감 필터”도 보안 경계로 시험해야 한다.

저장 후 alert scan은 push gate의 백업이지 중복 낭비가 아니다. Secret scanning은 저장소의 모든 branch와 Git history를 스캔하고 새 secret type이 추가되면 기존 저장소를 다시 스캔할 수 있으며, alert가 발생하면 노출된 credential을 즉시 rotate하라고 문서화한다.[7] Push protection은 저장소에 들어오기 전에 block하는 예방 경계이고, repository 수준 bypass가 발생하면 alert와 audit event를 남긴다.[8] 두 경로는 같은 탐지 결과라도 “들어오기 전 거부”와 “이미 들어온 뒤 대응”이라는 서로 다른 상태 전이를 담당한다.

## Push gate에는 판정표보다 실패표가 먼저 필요하다

동기식 gate에서 정상 응답만 설계하면 실제 정책은 timeout 순간에 결정된다. 다음은 GitHub가 발표한 기본 동작이 아니라 조직이 정해야 할 **운영 권고**다.

| 사건 | 권고 동작 | 이유 |
|---|---|---|
| deterministic high-confidence match | fail-closed | 알려진 형식은 모델 상태와 무관하게 막는다 |
| AI high-confidence match | 보호 branch·production 경로는 block, 승인형 bypass만 허용 | 문맥 탐지의 예방 효과를 유지한다 |
| AI timeout·5xx | 고위험 저장소는 fail-closed, 저위험 저장소는 제한적 fail-open | 가용성과 노출 위험을 저장소 등급으로 결정한다 |
| AI Credit hard cap 도달 | preview에서 실제 push 응답을 확인한 뒤 조직의 degraded mode 적용 | 비용 상태를 탐지 결과 없음으로 위장하지 않는다 |
| 분류할 수 없는 대형·지원 제외 파일 | 별도 상태로 거부 또는 quarantine | `no finding`과 `not scanned`를 분리한다 |
| deterministic engine 장애 | 모든 보호 대상 fail-closed | 가장 안정적인 기본 방어선의 부재를 허용하지 않는다 |

모든 저장소에 무조건 fail-closed를 걸면 모델 장애가 조직 전체의 push 중단으로 번질 수 있다. 반대로 전부 fail-open이면 공격자는 장애나 예산 소진을 기다려 gate를 건널 수 있다. 그래서 저장소를 `production-critical`, `internal-standard`, `sandbox`처럼 나누고 각 등급에 다른 **degraded-mode contract**를 둔다.

Production-critical에서는 AI 응답이 없으면 막고 시간 제한 break-glass만 둔다. Internal-standard에서는 deterministic scan이 정상일 때만 허용하되 조직 정의 상태인 `ai_scan_status=unavailable`과 blob hash를 recovery queue에 남긴다. Sandbox도 release 승격 전에는 정상 AI 검사를 다시 통과시킨다. GitHub 문서는 hard budget 소진이 추가 사용을 막는다고 설명하지만, AI push protection이 그때 push를 거부·허용·skip·fallback 중 어떻게 처리하는지는 공개하지 않았다.[1][9] 따라서 이 표의 상태와 동작은 preview fixture로 제품 응답을 확인한 뒤 적용할 조직 정책이다.

Fail-open에는 commit SHA, 미검사 blob hash, 실패 원인, 정책 버전, 재검사 deadline, owner를 기록한다. 재검사에서 secret이 나오면 **degraded gate를 통과한 노출 사건**으로 분류하고, canary와 queue drain 뒤 정상 모드로 복귀한다.

## AI Credit은 비용 설정이 아니라 가용성 입력이다

발표된 과금 귀속도 surface마다 다르다. AI push protection은 원칙적으로 저장소를 소유한 조직에 사용량이 귀속되고, enterprise-managed user의 user-namespace 저장소 예외에서는 pusher와 그 사용자 할당 credit에 귀속된다.[1] `/security-review`의 새 secret check는 active Copilot plan의 billing account에 귀속되며, GitHub는 AI usage insights에서 GHSP 아래 보고될 예정이라고 설명한다.[1]

AI push protection 검사는 push를 차단하지 않은 경우에도 credit을 소비할 수 있다.[1] 그러므로 `차단 건수 × 단가`로 예산을 잡으면 평상시 clean push의 비용을 놓친다. 측정 단위는 차단 수가 아니라 `분류 요청 수`, `분류된 blob bytes`, `push당 credits`, `no-finding credits`, `재시도 credits`, `저장소 등급별 burn rate`가 되어야 한다. GitHub가 공개하는 차원만 사용하고, 세부 값이 노출되지 않으면 로컬 push telemetry와 SKU별 billing aggregate에서 분리해 추정해야 한다.[1]

GitHub의 budget 기능은 75%, 90%, 100% 임계 알림을 보낼 수 있고, 지원되는 budget에서 **Stop usage when budget limit is reached**를 선택해야 한도 도달 뒤 사용이 실제로 중단된다.[9] 이 옵션을 선택하지 않으면 budget 초과 이메일은 오지만 사용은 계속된다.[9] 또한 여러 applicable budget 중 하나라도 stop-usage가 켜진 채 소진되면 추가 사용이 차단될 수 있어, 겹치는 product·SKU·scope budget은 예상 밖 중단을 만들 수 있다.[9]

필자의 권고는 지난 push volume과 clean-check credit으로 baseline을 계산하고, 75%에서 비필수 범위를 검토하며, 90%에서 신규 opt-in을 동결하는 것이다. Hard cap이 실제 AI 검사와 push 경로에 어떤 응답을 만드는지 test scope에서 확인하고, 그 관찰 결과에 맞춰 repository tier별 실패 정책을 실행한다.

비용이 부족해도 deterministic scan을 끄거나 production push를 임의 표본화하지 않는다. 중복 재시도와 동일 blob 재분류부터 줄이고, cache key에는 `model_version + policy_version + blob_hash + context_hash`를 넣는다.

새 `/security-review` 검사는 기본적으로 꺼져 있고 명령 실행만으로 활성화되지 않으며, agent가 명시적 승인 없이 과금 기능·정책·budget을 바꾸면 안 된다.[1] Opt-in과 budget 변경은 승인된 관리 workflow가 수행하고 결과를 read-back한다.

## 차단은 노출 방지이고, 회전은 자격 증명 수명 주기다

AI gate가 secret을 찾았을 때 가장 위험한 오해는 “commit에서 지웠으니 해결”이다. GitHub 문서는 유출된 secret을 즉시 rotate해야 하며, Git history에서 문자열을 제거하는 것보다 provider에서 revoke하는 일이 핵심이라고 설명한다.[7][10] Push가 정말 원격 저장소에 도달하지 않았고 다른 channel에도 복제되지 않았다는 확신이 있더라도, 누가 로그·terminal scrollback·agent transcript·artifact를 보았는지 모르면 credential owner가 회전 여부를 판단해야 한다.

필자의 권고는 detection event를 다음 상태로 관리하는 것이다.

```text
DETECTED
  → BLOCKED_BEFORE_REMOTE | ENTERED_REPOSITORY | BYPASSED
  → OWNER_IDENTIFIED
  → REVOKE_OR_ROTATE_STARTED
  → DEPENDENCIES_UPDATED
  → OLD_CREDENTIAL_INVALIDATED
  → AUDIT_COMPLETED
  → CLOSED
```

`BLOCKED_BEFORE_REMOTE`도 자동 종결하지 않는다. Hook 이전에 CI artifact, chat, issue, paste, agent memory로 복사됐을 가능성을 확인한다. `ENTERED_REPOSITORY`나 `BYPASSED`이면 즉시 provider revoke·rotate를 우선하고, 새 credential을 secret manager에 저장한 뒤 dependent service를 갱신한다. History rewrite는 노출 표면을 줄이는 별도 작업이지 revoke의 대체가 아니다.

담당자도 repository maintainer 하나로 뭉치지 않는다. Detector owner는 판정과 서비스 상태를, credential owner는 revoke·재발급을, application owner는 dependency 교체와 smoke test를, incident owner는 무단 사용 조사와 종료 승인을 맡는다. Password처럼 provider validity API가 없는 값은 AI 점수를 “active” 증거로 바꾸지 말고, 인증 시스템의 실제 owner에게 확인한다. 공식 pattern 표에서도 AI-detected password는 AI 기반 category이며, 기존 문서 기준 push protection과 validity check가 지원되지 않는 것으로 표시돼 있다.[5] 이번 private preview 발표는 AI password의 push-time 검사를 예고하지만 기존 지원 표와 시점 차이가 있으므로, preview에서 관찰한 실제 capability를 날짜와 함께 기록해야 한다.[1][5]

## Bypass는 모델 오탐 버튼이 아니라 예외 workflow다

기존 repository push protection은 write access 사용자가 이유를 선택해 bypass할 수 있고, 우회가 발생하면 repository alert, audit log event, 관련 관리자 알림이 생성된다.[8] Delegated bypass를 켜면 bypass 권한이 없는 기여자는 지정 reviewer에게 요청하고, reviewer가 승인하거나 거부하며 요청은 7일 후 만료된다.[11]

AI 탐지에서도 같은 인간 승인 표면을 쓸 수 있는지는 private preview의 실제 설정과 문서를 확인해야 한다. 발표문은 AI push protection을 관리자가 enable한다고 설명하지만 AI 판정에 기존 delegated bypass의 모든 동작이 동일하게 적용된다고 상세 계약까지 공개하지는 않았다.[1] 따라서 preview 도입 전에 test repository에서 direct push, pull request merge, web edit, API update, 여러 branch push에 대해 block·bypass·alert·audit가 어떻게 연결되는지 확인한다.

운영 권고로는 bypass 요청에 secret 원문을 복사하지 않고 다음 항목만 남긴다.

- repository, commit SHA, file path, line range
- detector 종류와 model/policy version
- `false-positive`, `test-fixture`, `migration-window`, `incident-recovery` 중 하나의 제한된 사유
- 요청자, 승인자, 만료 시각
- 실제 credential이 아님을 확인한 evidence 위치
- push 뒤 재검사와 제거 deadline

상시 exempt actor는 최소화한다. Bot 전체가 아니라 서명된 workflow, 고정 path, 짧은 기간의 조합으로 예외를 좁히고 나머지 push는 다시 gate를 타게 한다.

## Generated artifact는 비용 최적화와 우회의 경계다

생성 파일에는 minified JavaScript, vendored fixture, snapshot, lockfile, compiled output처럼 무작위 문자열이 많아 오탐과 비용을 늘릴 수 있다. 그래서 `dist/**`, `fixtures/**`, `generated/**`를 AI 분류에서 제외하고 싶어진다. 하지만 공격자나 잘못 구성된 agent가 실제 credential을 그 경로에 쓰면 제외 규칙은 완전한 우회로가 된다.

다음은 제품이 보장한다고 발표한 동작이 아니라 필자의 **generated-artifact bypass test suite 권고**다.

1. **경로 위장:** 실제 비밀번호 형태의 canary를 `src/config.py`에 넣었을 때와 `generated/config.py`에 넣었을 때 결과를 비교한다. 제외 경로에서도 deterministic matcher는 반드시 실행하고, AI skip이면 `not_scanned_by_ai`가 명시돼야 한다.
2. **이름 변경:** 차단되는 파일을 `.min.js`, `.snap`, `.lock`, 확장자 없는 파일로 rename해도 content 기반 후보 선별이 사라지지 않는지 확인한다.
3. **생성 후 이동:** 허용 경로에서 생성한 뒤 보호 경로로 `git mv`하거나 반대로 이동했을 때 final tree와 diff 양쪽에서 검사가 수행되는지 확인한다.
4. **인코딩·분할:** base64, 문자열 연결, multiline YAML, template interpolation, escape sequence로 같은 canary를 표현해 deterministic과 AI 단계의 관측 차이를 기록한다. 탐지되지 않는 표현을 곧 지원 보장으로 만들지 말고 gap inventory로 남긴다.
5. **대형 파일 경계:** scan size threshold 바로 아래·위에 canary를 배치해 `clean`과 `skipped-too-large`가 구분되는지 확인한다.
6. **부분 push:** 여러 commit 중 중간 commit에만 canary를 넣고 마지막 commit에서 삭제했을 때 push에 포함된 history 전체가 정책 범위인지 확인한다.
7. **Bot·agent identity:** 사람, GitHub App, deploy key, agent가 만든 branch에서 같은 fixture를 push해 actor exemption이 detector exemption으로 변하지 않는지 확인한다.
8. **Budget exhaustion:** hard cap에 도달한 test scope에서 generated path와 일반 path가 각각 fail-open/closed 계약대로 동작하고 미검사 영수증이 생성되는지 확인한다.
9. **캐시 충돌:** 같은 blob을 다른 assignment·주석 문맥에 넣어 context hash가 바뀌었는데도 과거 clean 결과가 재사용되지 않는지 확인한다.
10. **Bypass 후 재검사:** 승인된 fixture가 저장소에 들어간 뒤 alert scan, audit event, 만료 후 제거 check가 이어지는지 확인한다.

Canary에는 실제 credential을 쓰지 않고 인증 불가능한 문자열과 기대 결과를 manifest에 고정한다. 결과는 `deterministic_match`, `ai_match`, `ai_skipped`, `service_unavailable`, `budget_blocked`, `bypass_approved`로 나눠 “push 성공”과 “gate 미실행”을 구분한다.

## 도입은 shadow에서 blocking으로, 단 gate 계약은 먼저 쓴다

Private preview를 곧바로 전사 fail-closed로 켜기보다 세 단계로 올리는 편이 안전하다. 이는 GitHub의 의무 절차가 아니라 운영 권고다.

**1단계: inventory와 shadow.** 기존 pattern 차단은 유지하고 AI 결과만 수집한다. Tier, path, actor, 오탐 처리, latency, credit burn을 측정하며 실제 secret은 즉시 rotate한다.

**2단계: 제한 blocking.** 소수 production repository에서 high-confidence finding만 차단하고 승인형 bypass를 붙인다. Timeout, budget cap, large file, generated path, bot push를 시험한다.

**3단계: 정책 확대.** 등급별 우회율, degraded 유입, rotate 시간, 미검사 queue age가 기준을 만족할 때 넓힌다. Model version이나 threshold가 바뀌면 shadow 표본을 재생한다.

최소 관측 항목은 deterministic/AI 단계별 match율, block·bypass·not-scanned 비율, scan latency, service error·timeout·budget stop, repository tier별 fail-open 유입, confirmed secret의 rotate 완료 시간, generated-artifact fixture 통과율, push당 AI Credits다. 탐지 precision 하나를 성공 지표로 삼지 않는다. 미검사 변경이 늘거나 회전이 느려지고 bypass가 증가하면 더 많은 후보를 찾았어도 보안 결과가 좋아졌다고 말할 수 없다.

## 계획·플랫폼 범위를 배포 체크리스트에 고정한다

2026년 10월 7일 발표 기준으로 github.com의 GitHub Team과 GHEC 저장소는 유료 GHSP 또는 GHAS coverage가 있을 때 AI push protection 대상이 될 수 있다.[1] GHEC with data residency에서는 AI push protection이 paid GHSP/GHAS coverage와 함께 planned 상태이고, Copilot Business·Enterprise는 Copilot security review command의 지원 계획이다.[1]

GHES에서는 새 모델의 AI-detected alert가 **3.23 public preview**로 계획됐고 기존 GHSP/GHAS 구매에 포함되지만, 해당 Server release에 AI push protection과 Copilot security review command는 포함되지 않는다.[1] Individual Copilot Pro, Pro+, Max, Free, Student는 access control과 credit consumption 조건 아래 security-review의 새 model check 대상이 될 수 있고 GHSP/GHAS license가 필요하지 않다.[1] Copilot Business·Enterprise도 지원 platform, invitation, 관리자 정책 조건 아래 security-review check 대상이지만 이 구독은 AI push protection에 필요한 GHSP license를 대체하지 않는다.[1]

배포 요청에는 따라서 `hosting platform`, `repository visibility`, `GHSP/GHAS coverage`, `Copilot plan`, `preview invitation`, `admin policy`, `billing account`, `budget scope`를 각각 적는다. “Enterprise 고객” 한 칸으로는 GHEC와 GHES, GitHub Enterprise라는 상위 묶음, Copilot Enterprise라는 별도 구독을 구분할 수 없다. 기능이 UI에 보인다는 사실도 해당 repository의 비용 귀속과 fail policy가 승인됐다는 뜻이 아니다.

## 결론

GitHub의 발표는 하나의 GA 기능이 아니다. 기존 AI-detected alert scan은 새 모델로 자동 업그레이드되어 GHSP/GHAS에 계속 포함되고, AI push protection은 private preview이며, `/security-review`의 secret classifier 결합은 coming soon인 private preview 계획이고, 두 opt-in check의 AI Credit 과금도 broader availability에 앞서 공개된 계획이다.[1]

실제 보안 수준은 모델 이름보다 경계 조건에서 결정된다. 알려진 token은 결정적 detector가 먼저 막고 문맥이 필요한 후보만 AI로 넘긴다. 차단 뒤에는 문자열 삭제가 아니라 revoke·재발급·dependency 갱신까지 추적하고, generated artifact·대형 파일·bot·cache·bypass를 canary로 반복 검증한다.

AI 탐지는 secret lifecycle을 대체하지 않는다. **정상일 때 무엇을 찾는가보다, 모델이 응답하지 않거나 예산이 끝나거나 사람이 우회했을 때 어떤 변경이 들어가고 누가 자격 증명을 무효화하는가**가 push gate의 진짜 계약이다.

## Sources

[1] https://github.blog/changelog/2026-10-07-purpose-built-model-for-leaked-secret-detection
[2] https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enabling-ai-powered-generic-secret-detection
[3] https://docs.github.com/copilot/concepts/agents/copilot-cli/about-custom-agents
[4] https://docs.github.com/copilot/how-tos/github-copilot-app/agent-sessions
[5] https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns
[6] https://docs.github.com/en/code-security/responsible-use/security-and-quality-ai-features
[7] https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning
[8] https://docs.github.com/en/code-security/concepts/secret-security/push-protection
[9] https://docs.github.com/en/billing/how-tos/set-up-budgets
[10] https://docs.github.com/en/code-security/secret-scanning/working-with-secret-scanning-and-push-protection/remediating-a-leaked-secret
[11] https://docs.github.com/en/code-security/concepts/secret-security/bypass-requests
