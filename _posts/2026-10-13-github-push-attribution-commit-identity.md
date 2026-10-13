---
title: 'Git 커밋의 author는 인증된 신원이 아니다: GitHub Push Attribution으로 다시 설계하는 공급망 감사'
date: 2026-10-13 09:00:00 +0900
categories: ["개발/보안"]
description: 'GitHub Push Attribution의 제한 공개 프리뷰를 바탕으로 author·committer·pusher·signer가 답하는 질문을 분리하고, 불일치 정책과 사고 조사 절차를 설계한다.'
featured_image: 'https://picsum.photos/seed/github-push-attribution-commit-identity/1600/900'
tags: [github, git, push-attribution, commit-signing, ruleset, audit-log, software-supply-chain]
---

![GitHub Push Attribution과 커밋 신원 경계](https://picsum.photos/seed/github-push-attribution-commit-identity/1600/900)

커밋 화면에 신뢰하는 유지관리자의 이름과 회사 이메일이 보인다. 그렇다면 그 유지관리자가 코드를 작성했고, 같은 사람이 저장소에 올렸으며, 조직 계정으로 승인까지 했다고 말할 수 있을까. 지금까지 많은 운영 절차는 이 세 질문을 하나의 이름으로 압축했다. 하지만 Git 커밋 안의 문자열, 암호학적 서명, GitHub가 인증한 push 주체는 서로 다른 사건을 설명한다.[1][2][3]

GitHub는 2026년 10월 12일 Push Attribution을 발표했다. GitHub 설명에 따르면 이 기능은 각 커밋을 push한 인증 사용자를 지속적으로 기록하고, 기존 author·committer와 나란히 UI와 API에서 보여 준다.[1] 또한 `Committer must match pusher`라는 새 저장소 규칙은 committer 메타데이터가 인증된 pusher의 검증 이메일 중 하나와 일치하지 않는 push를 차단한다.[1]

먼저 출시 경계를 분명히 해야 한다. 이 기능은 현재 GitHub Enterprise 고객을 대상으로 한 **limited public preview**이며, 참여하려면 account team에 접근을 요청해야 한다.[1] 따라서 모든 GitHub 저장소에 이미 적용되는 일반 기능, GitHub Enterprise Server까지 포함한 정식 출시 기능, 장기간 고정된 API 계약으로 표현하면 안 된다. 이 글의 기능 설명은 공개 발표 범위에 한정하고, 나머지는 조직별 운영 제안으로 표시한다.

## 커밋 객체가 말하는 것과 말하지 않는 것

Git commit 객체에는 부모 객체 ID, author의 이름·이메일·시각, committer의 이름·이메일·커밋 시각, 그리고 메시지가 들어간다.[2] 이 구조가 기록하는 author와 committer는 유용한 이력 정보지만, 문자열을 입력한 사람이 그 이름의 실제 소유자라는 사실까지 자체적으로 증명하지는 않는다. GitHub도 이번 발표에서 author와 committer 필드를 pushing client가 제공하는 문자열이라고 설명하며, write 권한을 가진 사용자가 원하는 이름과 이메일로 설정할 수 있다고 명시했다.[1]

두 필드의 의미부터 나누면 혼란이 줄어든다.

- **author**는 변경을 처음 작성한 주체로 기록된 이름·이메일·시각이다.[2][4]
- **committer**는 현재 commit 객체를 만든 주체로 기록된 이름·이메일·시각이다.[2][4]
- amend나 rebase처럼 commit을 다시 만드는 작업에서는 author 정보가 유지돼도 committer와 commit object name이 바뀔 수 있다.[4][5]
- Git object name은 객체 내용으로 계산되므로 commit 객체 내용이 달라지면 식별자도 달라진다.[4]

앞의 두 문장은 Git 데이터 모델의 의미이고, 뒤의 운영 해석은 별도다. 예를 들어 릴리스 관리자가 외부 기여자의 patch를 적용했다면 author와 committer가 다른 것은 정상일 수 있다. 반대로 두 값이 같다고 해서 한 사람이 작성·검토·push를 모두 수행했다는 뜻은 아니다. **문자열 일치와 신원 검증은 같은 검사가 아니다.**

GitHub 계정 연결도 인증과 혼동하기 쉽다. Repository contributors graph는 commit email이 계정에 연결되지 않으면 커밋을 해당 계정과 연결하지 않고, 개인 profile의 contribution graph에도 별도 email·branch·repository 조건이 적용된다.[6][7] 이는 표시와 기여 집계 규칙을 설명한다. 계정 프로필이 화면에 나타났다는 사실만으로 누가 push 세션을 인증했는지, 누가 개인키로 서명했는지, 누가 변경을 승인했는지까지 확장해서는 안 된다.

## pusher는 서버가 본 수신 사건의 주체다

Push Attribution이 추가하는 핵심은 commit 객체 내부의 새 자기 주장 문자열이 아니다. GitHub가 이미 인증하던 push 사건의 주체를 커밋 단위로 지속 보관하고 노출한다는 점이다.[1] 따라서 pusher가 답하는 질문은 “이 변경을 누가 썼는가?”가 아니라 **“GitHub가 이 커밋을 저장소로 받아들인 push에서 어떤 계정을 인증했는가?”**에 가깝다.

이 차이는 침해 조사에서 중요하다. 공격자가 낮은 권한 계정을 탈취한 뒤 신뢰받는 유지관리자의 이름과 이메일을 committer에 넣으면, 기존 화면만 본 조사자는 신뢰 계정의 작업으로 오인할 수 있다. GitHub는 이런 commit identity spoofing 경로를 이번 기능의 위협 모델로 직접 제시했다.[1] Push Attribution이 켜진 환경에서는 표시된 committer와 인증된 pusher를 분리해 보고, 새 규칙으로 두 값의 불일치를 push 시점에 막을 수 있다.[1]

그러나 pusher도 자연인의 완전한 신원은 아니다. 자동화 계정, GitHub App, deploy key처럼 사람이 직접 누르지 않는 경로가 실제로 어떻게 표시되는지는 공개 발표만으로 알 수 없으므로 preview에서 별도로 검증해야 한다.[1] 그러므로 사고 보고서에는 “pusher identity A로 인증된 push”라고 쓰고, 곧바로 “사람 A가 키보드에서 실행했다”로 바꾸지 않는 편이 정확하다. 자연인 귀속에는 해당 identity의 인증 방식, token 또는 key 소유 관계, IdP 기록, 실행 환경 로그가 추가로 필요하다. 이는 GitHub의 새 필드 정의가 아니라 **운영 분석**이다.

또 하나의 경계가 있다. 발표는 pusher identity가 UI와 API에 표시된다고 밝혔지만, 공개 발표문은 소비자가 의존할 구체적인 응답 필드 이름이나 버전 계약을 제시하지 않는다.[1] 기존 공개 REST commit 문서는 author·committer와 `verification` 객체의 `verified`, `reason`, `signature`, `payload`, `verified_at`을 설명한다.[8] 따라서 프리뷰 참여 조직은 문서에 없는 `pusher_login`, `pushed_by`, `actor` 같은 이름을 추측해 수집기를 만들면 안 된다. 실제 프리뷰 문서와 자기 enterprise의 응답을 확인하고, 필드의 존재·null 가능성·페이지네이션·과거 커밋 처리 범위를 fixture로 고정해야 한다. 이는 공개 API 사실이 아니라 **조직별 구현 권고**다.

## signer는 또 다른 질문에 답한다

Commit signing은 pusher와 겹쳐 보이지만 보증 대상이 다르다. GitHub는 GPG, SSH, S/MIME으로 서명한 commit이나 tag의 암호학적 검증이 성공하면 `Verified` 또는 조건에 따라 `Partially verified` 상태를 표시한다.[3] 서명 검증 기록은 GitHub에 push될 때 저장되며, 저장소 네트워크 안에서 지속된다.[3] 나중에 키가 회전·폐기·만료되거나 기여자가 조직을 떠나도 과거의 검증 상태는 당시 기록을 기준으로 유지된다.[3]

서명은 “어떤 키가 이 commit payload에 서명했고 GitHub가 그 키를 어떻게 검증했는가”에 답한다.[3] Pusher는 “어떤 인증 주체가 이 commit을 GitHub에 전달했는가”에 답한다.[1] **운영 분석으로는** 같은 개발자가 서명하고 직접 push한 흐름과 CI·release bot이 서명된 commit을 대신 전달한 흐름을 서로 다른 정상 유형으로 분류할 수 있다.

`Verified` 배지만 보고 현재도 키가 유효하다고 단정해서는 안 된다. GitHub 문서는 persistent verification이 최초 검증 시점의 상태를 반영하며, 이후 키 상태 변화에 따라 과거 commit을 다시 검증하거나 상태를 소급 변경하지 않는다고 설명한다.[3] 사고 시점의 키 폐기 여부를 판단하려면 commit의 검증 기록뿐 아니라 조직의 키 수명주기와 폐기 시각을 함께 봐야 한다. 반대로 pusher가 확인됐다고 해서 payload에 대한 개인키 서명이 생기는 것도 아니다.

GitHub의 required signed commits 규칙은 대상 branch로 들어오는 commit이 signed and verified인지 검사한다.[9] Push Attribution의 `Committer must match pusher`는 committer 이메일과 pusher의 verified email 일치를 검사한다.[1] 두 규칙은 대체 관계가 아니다. 하나는 서명 검증을, 다른 하나는 push 인증 주체와 committer 메타데이터의 정합성을 본다.

## 네 identity를 한 표에서 읽는다

운영팀은 사람 이름 하나를 찾기보다 각 identity가 답하는 질문을 고정해야 한다.

| Identity | 근거가 놓인 곳 | 답할 수 있는 질문 | 단독으로 답할 수 없는 질문 |
|---|---|---|---|
| author | commit 객체의 이름·이메일·시각[2] | 변경의 원 저자로 누구를 기록했는가 | 그 사람이 실제로 작성하거나 동의했는가 |
| committer | commit 객체의 이름·이메일·시각[2] | 현재 commit 객체를 누가 만들었다고 기록했는가 | 그 계정으로 GitHub에 인증했는가 |
| signer | commit의 서명과 GitHub 검증 기록[3] | 어떤 키가 payload에 서명했고 검증됐는가 | 누가 push했거나 리뷰했는가 |
| pusher | GitHub가 인증해 기록한 push attribution[1] | 어떤 인증 주체가 commit을 저장소에 전달했는가 | 누가 코드를 작성·서명·승인했는가 |

앞의 author·committer 구조는 Git 문서에, signer 상태는 GitHub signature 문서에, pusher 범위는 preview 발표에 근거한다.[1][2][3] 표의 마지막 열은 이 세 사실을 섞지 않기 위한 **분석적 경계**다.

여기에 reviewer와 merger를 다섯째, 여섯째 identity로 연결할 수 있다. Reviewer는 특정 diff를 보고 승인한 계정이고, merger는 base branch 상태를 바꾼 플랫폼 행위의 주체다. 둘은 Git commit 객체의 고정 필드가 아니다.[2] 따라서 “author가 pusher와 일치한다”는 정책이 있어도 독립 리뷰가 수행됐다는 증거는 되지 않는다.

이 모델은 책임을 많이 수집하자는 이야기가 아니다. 질문별로 최소 증거를 선택하자는 이야기다. 저작권 또는 기여 크레딧을 확인할 때는 author와 contribution 규칙을 보고, 객체 무결성과 키 귀속을 확인할 때는 signer를 보고, 탈취된 write credential로 누가 저장소에 전달했는지 조사할 때는 pusher를 본다. 승인 절차 위반은 reviewer와 merger 기록에서 찾는다.

## `Committer must match pusher`가 막는 것

새 규칙은 인증된 pusher의 verified email 집합과 commit의 committer 이메일을 비교하고, 일치가 없으면 push를 차단한다.[1] 따라서 계정 A로 인증한 사용자가 신뢰 계정 B의 이메일을 committer에 넣어 B의 변경처럼 보이게 하는 단순 위조를 막는 데 직접적이다. 사후 탐지보다 push 수신 단계에서 거부한다는 것도 장점이다.

하지만 이 규칙을 “모든 commit 작성자 실명 인증”이라고 부르면 보증 범위를 넘는다. 공식 설명은 **committer**와 pusher의 일치를 말하며 author의 일치를 요구한다고 하지 않는다.[1] 위임된 patch 적용, 자동화 계정, merge 방식, service account처럼 author·committer·pusher가 합법적으로 갈리는 흐름도 있다. 서명키의 소유와 현재 유효성, PR 승인, 빌드 실행 주체도 이 규칙의 판정 대상이라고 공개되지 않았다.[1]

조직은 불일치를 곧바로 악성으로 분류하기보다 예상한 예외와 예상하지 않은 예외를 나눠야 한다. 예를 들어 사람이 로컬 commit을 직접 push하는 저장소에서는 `committer = pusher`가 자연스럽다. 반면 중앙 release bot이 여러 개발자의 commit을 재작성해 push하는 저장소라면 committer를 bot으로 표준화하거나, 흐름을 바꾸거나, 규칙 적용 대상을 달리해야 한다. 이것은 GitHub가 정한 정답이 아니라 **조직별 workflow 설계**다.

## 정책은 한 번에 전체 조직에 켜지 않는다

GitHub 발표는 새 조건을 적용하려면 push ruleset에 추가하라고 안내한다.[1] 현재 일반 문서의 push ruleset은 branch targeting 없이 repository의 모든 push와 전체 fork network에 적용되고, branch·tag ruleset과는 범위가 다르다.[10] Preview의 새 조건이 이 일반 범위를 그대로 따르는지는 제공받은 preview 문서와 실제 tenant에서 확인해야 한다. Branch·tag ruleset은 서로 겹치면 규칙이 집계되고 같은 규칙의 여러 설정 중 더 제한적인 값이 적용되며, 특정 role·team·GitHub App에 bypass를 줄 수 있다.[10] 새 identity 조건과 signed commit·required review·merge queue·automation 예외의 합성 결과도 별도 fixture로 검증해야 한다.

권장 rollout은 세 단계다.

1. **관찰 단계**: preview를 비핵심 저장소에 연결하고 author·committer·pusher·signer 조합을 수집한다. 정상적인 불일치 유형을 workflow별로 분류한다.
2. **제한 단계**: 직접 push가 단순한 소수 저장소에서 규칙을 켠다. 거부 사유, 담당 팀, 정상 복구 절차를 개발자에게 보여 준다.
3. **확대 단계**: release bot, mirroring, vendoring, cherry-pick, emergency hotfix 경로마다 소유자와 예외 만료일을 정한 뒤 repository 단위로 넓힌다. 보호 branch에만 한정할 수 있다고 가정하지 않는다.

이 세 단계는 GitHub의 공식 rollout 절차가 아니라 **조직별 권고안**이다. 특히 limited public preview에서는 UI와 API 표현이 바뀔 수 있으므로 수집 schema를 조직의 영구 표준처럼 고정하지 말고, preview version과 관찰 날짜를 함께 남기는 편이 안전하다.

Bypass는 “관리자니까 항상 허용”으로 두지 않는 것이 좋다. GitHub ruleset은 bypass 주체를 둘 수 있으므로, 예외 계정이 많으면 새 규칙의 탐지 가치가 빠르게 줄어든다.[10] 조직은 bypass 주체, 요청 이유, 대상 repository/ref, 만료 시각, 승인자, 실제 사용 여부를 별도 변경 기록으로 관리해야 한다. 이 필드들은 GitHub Push Attribution의 공개 API 필드가 아니라 **내부 예외 레지스트리 제안**이다.

## 사건 하나를 commit SHA만으로 조사하지 않는다

Commit SHA는 객체 내용을 식별하는 축이지만 push 사건 전체를 식별하지는 않는다.[4] Ref는 object name을 가리키는 이름이므로 같은 commit이 여러 ref에서 참조될 수 있다.[4] 따라서 조사 질문에는 어느 ref가 언제 어떻게 바뀌었는지를 포함하고, 조직의 사건 레코드는 commit과 수신 사건·정책 판정을 별도로 연결해야 한다.

추천하는 최소 조사 묶음은 다음과 같다.

```text
repository + ref + commit SHA
  ├─ author / committer metadata
  ├─ signature verification record
  ├─ authenticated pusher attribution
  ├─ push 시각과 인증 맥락
  ├─ 적용된 ruleset과 allow / deny / bypass 결과
  ├─ 연결된 PR, review, merge 주체
  └─ build와 deployment가 실제 사용한 commit SHA
```

이 schema는 GitHub가 공개한 단일 payload가 아니라 **조직의 상관 분석 모델**이다. 공개되지 않은 Push Attribution 필드명을 가정하지 않고, 각 데이터 소스에서 확인한 값을 공통 사건 ID와 수집 시각으로 연결한다. API가 제공하지 않는 항목을 null과 “미지원”으로 구분해야 한다. 빈 값이 곧 익명 push나 정책 통과를 뜻하지 않기 때문이다.

기존 webhook의 `sender`나 `pusher`라는 이름을 새 per-commit attribution과 자동으로 동일시해서도 안 된다. GitHub webhook 문서는 대부분의 payload에서 `sender`가 event를 trigger한 사용자를 나타내지만, 특정 사용자를 해석할 수 없으면 `ghost`가 들어올 수 있다고 경고한다.[11] 또한 push webhook은 ref 변경 사건을 표현하는 별도 계약이다.[11] 이름이 비슷하다는 이유로 webhook 객체와 preview의 durable per-commit identity를 같은 필드로 join하지 말고, 공식 문서가 보장하는 식별자와 사건 범위를 확인해야 한다.

## 감사 로그의 보존 기간이 조사 가능성을 결정한다

GitHub Enterprise Cloud의 enterprise audit log는 enterprise에 영향을 준 event를 180일 보존하지만 Git event는 7일만 보존한다.[12] Audit log entry에는 적용 가능한 경우 actor, repository, action, 시각, SAML SSO·SCIM identity, 웹 UI 밖의 인증 방식, 선택적으로 source IP 같은 정보가 포함된다.[13] Enterprise owner는 audit와 Git event를 외부 시스템으로 stream해 더 오래 보존할 수 있다.[14]

이 사실은 Push Attribution이 생겼으니 별도 로그 수집을 줄여도 된다는 결론과 반대 방향을 가리킨다. Pusher는 commit 단위 질문을 강화하지만, credential 발급·사용 맥락과 ref 변경, ruleset bypass, 이후 build·deployment까지 한 화면에 보존해 주는 만능 사건 저장소는 아니다. Git event의 GitHub 내 보존 기간은 7일이므로, 그보다 늦게 조사 요청이 들어올 수 있는 조직이라면 streaming과 SIEM 보존 정책을 preview 활성화보다 먼저 확인해야 한다.[12][14]

보존 정책에는 세 시각을 따로 둔다.

- `commit time`: commit 객체의 committer가 기록한 시각[2]
- `push-event observed time`: audit·webhook·stream에서 확보할 수 있을 때의 수신 사건 시각
- `ingested time`: 조직 수집기가 사건을 저장한 시각

첫 값은 client가 만든 commit 데이터이고, 나머지 둘은 운영 시스템의 관찰 시각이다. 두 번째 값은 공개된 Push Attribution 전용 timestamp 필드가 아니라 조직이 audit·webhook·stream에서 상관 분석할 **제안 필드**다. 사건 순서를 정할 때 세 값을 하나로 합치지 않고 clock skew, 재전송, 지연 수집을 분석할 수 있도록 원본 값을 보존한다.

## 불일치는 경보가 아니라 분류된 신호여야 한다

새 기능을 켠 뒤 단순히 `author != pusher`를 경보로 만들면 대부분의 협업 흐름을 의심 사건으로 만들 수 있다. 실제로 막는 공식 규칙도 author가 아니라 committer와 pusher의 verified email 일치를 본다.[1] 경보는 identity 쌍마다 의미를 달리해야 한다.

| 관찰 | 가능한 정상 원인 | 먼저 확인할 것 |
|---|---|---|
| author ≠ committer | rebase, cherry-pick, patch 적용 | 원본 PR·patch와 재작성 주체 |
| committer ≠ pusher | 자동화가 기존 commit을 전달, 중앙 push | 승인된 automation 경로와 verified email 정책 |
| signer ≠ pusher | 서명된 commit을 CI·release bot이 전달 | 서명 payload, bot 권한, 대상 ref |
| committer email이 pusher와 불일치해 거부 | 설정 오류 또는 identity spoofing | 로컬 Git 설정, 계정 verified email, credential 침해 징후 |
| pusher가 평소와 다른 계정 | 당직·이관 또는 탈취 | 인증 방식, token/key, IdP와 source context |

표의 “가능한 정상 원인”은 판정이 아니라 조사 가설이다. 어느 행도 자동 면책이나 자동 침해 선언으로 쓰면 안 된다. 정상 workflow catalog와 대조한 뒤 예상된 불일치는 정책 변경 대상으로, 예상하지 않은 불일치는 보안 triage 대상으로 보낸다.

우선순위가 높은 신호는 단일 불일치보다 조합이다. 예를 들어 보호 branch에 새 pusher가 나타나고, committer가 고신뢰 유지관리자를 가리키며, 서명이 없고, bypass가 사용됐다면 즉시 조사할 가치가 크다. 반대로 승인된 release bot이 검증된 서명을 가진 commit을 정해진 ref에 올렸다면 주체가 달라도 정상일 수 있다. 이 위험 점수는 GitHub 공식 기능이 아니라 조직이 자산 중요도와 workflow에 맞춰 정의할 **내부 탐지 규칙**이다.

## 프리뷰에서 먼저 검증할 다섯 가지

기능 접근 권한을 받은 조직이라면 정책 활성화 전에 아래 질문을 실제 저장소 fixture로 확인해야 한다.

1. 기존에 저장된 commit과 preview 활성화 뒤 처음 수신된 commit의 attribution 범위가 어떻게 다른가.
2. 한 push가 새 commit 여러 개를 도입할 때 각 commit의 pusher가 어떻게 표시되는가.
3. 이미 저장소 네트워크에 존재하는 commit을 다른 ref로 push할 때 표시가 어떻게 동작하는가.
4. 사용자, GitHub App, automation, web merge 같은 생성·전달 경로가 UI와 API에서 어떻게 구분되는가.
5. API 값이 없는 경우와 접근 권한이 없는 경우를 어떻게 구별하는가.

이 다섯 항목의 답은 공개 발표문에 구체적으로 적혀 있지 않다.[1] 그러므로 여기서 예상 결과를 단정하지 않는다. 특히 “최초 pusher”, “최근 pusher”, “모든 pusher 배열” 가운데 어느 모델인지를 추측하면 감사 데이터가 조용히 잘못 연결될 수 있다. 프리뷰 tenant에서 관찰한 응답, GitHub가 제공한 preview 문서, support 답변을 증거로 contract test를 만들고 변경을 감시해야 한다.

Contract test는 값을 성공적으로 읽는지만 보면 부족하다. UI에서 같은 commit을 열었을 때의 표시, API의 동일 commit 응답, 규칙의 allow·deny 결과가 같은 identity 해석을 가리키는지 대조한다. 다만 UI 문구와 API 필드가 언제나 일대일이라고 가정하지 않는다. 각각의 식별자, null 의미, 권한별 가시성, retention을 별도로 기록한다. 이것 역시 **조직별 프리뷰 검증 권고**다.

## 운영 지표는 차단 수보다 예외 품질을 본다

초기 지표로는 전체 push 수, attribution이 관찰된 commit 비율, workflow별 identity 조합, 규칙 거부 수, bypass 사용 수, 정상 복구까지 걸린 시간을 수집할 수 있다. 하지만 거부 수가 많다는 사실은 보안이 강해졌다는 뜻이 아니다. 개발자의 잘못된 `user.email` 설정이나 미정리 bot 흐름을 대량으로 막았을 수도 있다.

더 중요한 지표는 다음과 같다.

- 승인되지 않은 committer–pusher 불일치가 보호 branch에 도달한 비율
- bypass 가운데 소유자·사유·만료일이 모두 기록된 비율
- pusher에서 token/key와 IdP identity까지 연결 가능한 비율
- 의심 commit에서 PR review와 실제 deployment SHA까지 복원하는 데 걸린 시간
- preview schema 변경을 contract test가 감지한 시간
- 예외 계정이 장기간 일반 개발에 사용된 횟수

이 지표 목록은 GitHub 제품 사양이 아니라 **조직별 운영 제안**이다. 목적은 기능 사용량을 자랑하는 것이 아니라, “누가 썼고 누가 전달했고 누가 서명하고 누가 승인했는가”라는 서로 다른 질문에 답할 수 있는지 측정하는 데 있다.

## 결론

Push Attribution은 author를 더 강한 author로 바꾸는 기능이 아니다. Commit 객체가 주장하는 author·committer 옆에 GitHub가 인증한 수신 사건의 pusher를 추가해, 지금까지 한 이름에 눌러 담았던 질문을 분리한다.[1] `Committer must match pusher`는 committer identity spoofing의 한 경로를 push 시점에 막지만, author의 동의, 서명키의 현재 상태, 독립 리뷰, 배포 승인까지 증명하지는 않는다.[1][3]

도입의 핵심은 새 필드를 SIEM에 하나 더 넣는 일이 아니다. 첫째, author·committer·signer·pusher의 질문을 데이터 모델에서 분리한다. 둘째, 정상적으로 주체가 갈리는 automation 경로를 catalog로 만들고 예상 밖의 불일치만 조사한다. 셋째, signed commits·review·ruleset bypass와 조합해 어느 통제가 어느 질문에 답하는지 표시한다. 넷째, 7일 Git event 보존 한계를 넘도록 필요한 로그를 미리 stream한다.[12][14]

그리고 preview의 빈칸을 제품 사실처럼 채우지 않는다. 공개되지 않은 API 필드와 과거 commit 처리 방식을 추측하지 말고, 자기 환경의 응답을 fixture로 남긴다. 그래야 pusher가 author를 대체하는 새 배지가 아니라, 인증·서명·검토·전달의 불일치를 설명하는 감사 축이 된다.

## Sources

[1] https://github.blog/changelog/2026-10-12-push-attribution-public-preview
[2] https://git-scm.com/docs/git-commit-tree
[3] https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification
[4] https://git-scm.com/docs/gitglossary
[5] https://git-scm.com/docs/git-commit
[6] https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors
[7] https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference
[8] https://docs.github.com/en/rest/commits/commits?apiVersion=2026-03-10
[9] https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
[10] https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
[11] https://docs.github.com/en/webhooks/webhook-events-and-payloads
[12] https://docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/accessing-the-audit-log-for-your-enterprise
[13] https://docs.github.com/en/enterprise-cloud@latest/admin/concepts/security-and-compliance/audit-log-for-an-enterprise
[14] https://docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/streaming-the-audit-log-for-your-enterprise
