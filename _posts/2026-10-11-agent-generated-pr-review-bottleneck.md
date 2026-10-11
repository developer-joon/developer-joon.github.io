---
title: '코드 생성 비용이 낮아진 뒤 — Draft PR 제한이 드러낸 리뷰 수용량 병목'
date: 2026-10-11 13:40:00 +0900
categories: ["AI 개발 도구"]
description: 'GitHub가 AI agent를 원인으로 지목했다는 해석을 피하면서, 외부 기여자의 PR 생성 한도·Draft 포함·bypass·입장 영수증·방치 Draft 정리를 리뷰 수용량 보호 관점에서 분석한다.'
featured_image: '/images/posts/2026-10-11-agent-generated-pr-review-bottleneck.png'
tags: [ai-agent, pull-request, open-source, code-review, github, maintainer, quality-gate]
---

![에이전트가 만든 PR과 리뷰 수용량의 병목](/images/posts/2026-10-11-agent-generated-pr-review-bottleneck.png)

2026년 10월 8일 GitHub는 pull request 생성 한도에 Draft PR을 포함하도록 설정할 수 있다고 발표했다. 이전에는 일반 PR 한도에 도달한 사용자도 Draft는 계속 열 수 있었다. GitHub가 밝힌 목적은 이 우회로를 막고 낮은 품질의 기여와 repository spam이 만드는 clutter, notification, CI run을 줄이는 것이다.[1]

여기서 사실과 해석을 분리해야 한다. 발표는 AI coding agent를 원인으로 지목하지 않는다. Agent가 PR 증가분의 몇 퍼센트를 만들었는지, 사람의 PR보다 품질이 낮은지에 관한 통계도 없다. 그러므로 “AI PR 때문에 GitHub가 제한을 만들었다”는 설명은 근거를 넘는다. 이 글이 다루는 것은 더 좁다. 코드 작성과 PR 생성의 한계비용이 낮아졌을 때, **외부 기여자 한 명이 차지할 수 있는 동시 PR 자리**를 어떻게 제한하고 그 자리에 최소한의 검증 정보를 요구할 것인가다.

이것은 일반적인 AI software factory 설계 글이 아니다. 작업 분해, 실행 queue, reviewer WIP, merge throughput, 인간의 최종 병합권은 [AI 소프트웨어 팩토리 글]({% post_url 2026-10-11-ai-software-factory-work-decomposition %})에서 다룬다. 여기서는 GitHub 기능이 직접 제어하는 외부 기여자의 creation cap, Draft counting, bypass와 그 주변의 admission policy만 본다.

## 먼저 고정해야 할 제품 범위

본문의 GitHub 제품·문서 상태 확인일은 **2026-10-11**이다.

PR 생성 한도 자체는 2026년 6월에 발표됐다. 공식 발표와 현재 interaction 문서가 설명하는 범위는 **public repository에서 write access가 없는 사용자**다. 한 사용자가 동시에 열 수 있는 PR 수를 정하고, 한도에 도달하면 기존 PR을 close하거나 merge해야 다음 PR을 열 수 있다. Write access 이상인 사용자는 이 repository-level 한도의 대상이 아니다.[2][4]

6월 발표에는 신뢰 기여자를 collaborator로 올리지 않고도 한도를 넘게 하는 bypass list와 “Draft는 세지 않는다”는 당시 동작도 명시돼 있다.[4] 10월 8일 변경은 이 기존 한도에 Draft 포함 여부를 선택하는 옵션을 더한 것이다.[1] 따라서 다음처럼 범위를 읽는 편이 안전하다.

- 이것은 저장소 전체의 open PR 총량 제한이 아니다.
- 모든 작성자에게 같은 전역 semaphore를 거는 기능도 아니다.
- 한도는 외부 기여자별 동시 open PR 수를 제어한다.
- Bypass는 특정 외부 기여자에게 creation cap 예외를 주는 기능이다.
- Draft 포함 옵션은 Draft라는 상태를 이용한 한도 우회를 닫는다.

조직 수준 한도는 별도 발표 대상이다. GitHub는 8월 6일 조직의 여러 저장소에 PR 한도를 중앙에서 적용하는 기능을 발표했다.[5] 그러나 10월 8일 Draft 발표문은 조직 수준 설정 화면에도 동일한 Draft 옵션이 노출된다고 명시하지 않는다.[1] Repository 설정과 organization 설정을 같은 것으로 간주하지 말고 각각 확인해야 한다.

## 발표, interaction 문서, REST schema가 아직 한 상태를 말하지 않는다

확인일 기준으로 공식 표면 사이에는 시차가 있다. 10월 8일 changelog는 Draft를 한도에 포함하는 옵션을 발표했다.[1] 반면 interaction 문서는 여전히 “Draft pull requests do not count”라고 적고, repository UI 안내에도 Draft 옵션을 설명하지 않는다.[2]

버전이 고정된 REST 문서의 repository creation-cap endpoint도 같은 간극을 보인다. `GET /repos/{owner}/{repo}/interaction-limits/pulls/creation-cap` 응답 schema와 update 요청에는 `enabled`, `max_open_pull_requests`만 있고 Draft 포함 필드는 없다.[3] 일반적인 temporary interaction restriction endpoint와 PR creation-cap endpoint는 다른 기능이므로 둘을 섞어 읽어서도 안 된다.

이 자료만으로는 원인을 판별할 수 없다. 문서 갱신이 늦은 것인지, UI와 API의 제공 시점이 다른 것인지, 계정이나 환경별 rollout 중인지 공개 자료만으로 확정할 수 없다.

운영 확인은 두 단계가 적절하다.

1. 저장소 또는 조직의 **설정 UI에서 Draft 포함 control이 실제로 보이는지** 확인한다.
2. Production 정책을 바꾸지 않는 별도 test repository에서 **write access가 없는 테스트 계정**으로 한도 직전까지 일반 PR과 Draft를 열어 실제 생성 동작을 확인한다.

두 번째 검증은 production 저장소의 설정을 쓰거나 실제 기여자에게 spam을 만들라는 뜻이 아니다. 테스트 저장소, 최소 branch, 정리 계획을 사용하고 관측한 날짜와 계정 권한을 남긴다. UI가 보인다는 사실과 enforcement가 작동한다는 사실은 별개의 증거다. 반대로 현재 REST schema에 필드가 없다는 사실만으로 기능 전체가 배포되지 않았다고 결론 내릴 수도 없다.

## Creation cap은 품질 점수가 아니라 기여자별 입장 제한이다

동시 PR 한도가 보장하는 것은 한 가지다. 대상 사용자가 queue에 새 PR을 계속 추가할 수 있는지 여부다. 한도가 3이라고 해서 앞의 세 PR이 재현 가능하거나 병합할 가치가 있다는 뜻은 아니다. 작은 문서 수정 세 개와 subsystem을 가로지르는 refactor 세 개도 같은 자리 수로 계산된다.

이 때문에 creation cap을 품질 gate처럼 설명하면 정책이 왜곡된다. Admission은 “이 작성자가 지금 새 자리를 받을 수 있는가”를 결정하고, review는 “들어온 변경이 맞는가”를 판정한다. Bypass도 앞의 결정만 건너뛴다. 신뢰 기여자가 한도보다 많은 PR을 열 수 있다는 뜻이지, test·review·merge 조건이 면제된다는 뜻이 아니다.

그럼에도 이 한도는 쓸모가 있다. 외부 기여자 한 명이 미완성 후보를 많이 열어 목록과 알림을 점유하는 상황을 제한하고, 기존 후보를 끝내거나 닫은 뒤 다음 후보를 제출하도록 만든다. 특히 PR 생성이 자동화돼 작성자의 클릭 비용이 거의 사라졌다면, contributor별 cap은 생성 속도와 유지보수자의 수용 속도 사이에 최소한의 backpressure를 둔다.

정책의 단위도 명확히 해야 한다. “저장소가 바쁘니 모든 외부 기여를 막는다”가 아니라 다음 질문에 답하는 기능이다.

- Write access가 없는 기여자 한 명에게 open PR 자리를 몇 개 줄 것인가?
- 그 자리 계산에 Draft를 포함할 것인가?
- 누가 어떤 근거와 만료 조건으로 bypass되는가?
- 새 자리를 받기 전에 기존 Draft를 어떤 상태로 끝내야 하는가?

전체 review queue의 우선순위나 maintainer 배정은 이 기능 밖의 문제다. Creation cap이 그 문제까지 해결한다고 기대하면 한도를 낮춘 뒤에도 리뷰 지연의 원인을 찾지 못한다.

## Draft를 세는 이유와 세지 않을 이유를 함께 적는다

Draft는 “아직 정식 review를 요청하지 않는다”는 유용한 상태다. 그러나 Draft가 저장소 비용을 전혀 만들지 않는다는 뜻은 아니다. GitHub의 10월 발표도 Draft가 clutter, notification, CI run을 만들 수 있다고 설명한다.[1] Draft를 한도에서 제외하면 일반 PR 한도에 도달한 사용자가 후보를 Draft로 계속 추가할 수 있고, creation cap의 목적이 약해진다.

그렇다고 모든 저장소가 Draft 포함을 켜야 하는 것은 아니다. Maintainer와 외부 기여자가 초기 설계를 공개적으로 다듬거나, 장기 기능을 Draft 하나에서 갱신하는 문화라면 Draft가 정상적인 협업 공간일 수 있다. 반대로 완성되지 않은 자동 생성 PR을 쌓아 두는 경로로 Draft가 주로 쓰인다면 포함하는 편이 일관적이다.

결정 기준은 “Draft는 나쁜가”가 아니라 자리의 의미다.

- **포함:** Draft도 외부 기여자에게 배정한 동시 작업 자리다. 새 후보를 열려면 기존 Draft를 진전시키거나 닫는다.
- **제외:** Draft는 review queue 밖의 협업 공간이다. 대신 CI trigger, 보관 기간, 정식 review 전환 조건을 별도로 제한한다.

정책 문구에는 현재 기본값을 추측해서 쓰지 말고 실제 확인한 동작을 적는다. 예를 들면 `외부 기여자당 open PR 3개, Draft 포함, 2026-10-11 테스트 저장소에서 확인`처럼 날짜·범위·검증 환경을 함께 남긴다.

## Bypass는 신뢰의 영구 배지가 아니다

Interaction 문서는 최대 100명의 신뢰 기여자를 bypass list에 넣을 수 있고, 이들이 collaborator 권한 없이 한도를 넘을 수 있다고 설명한다.[2] 이 기능은 반복적으로 독립된 변경을 관리하는 외부 maintainer나 release 작업 기여자에게 유용하다. 하지만 bypass를 “좋은 코드 작성자”라는 평판 배지로 운영하면 예외가 누적된다.

Bypass에는 부여 사유, owner, 검토일을 남기는 편이 낫다. 판단 기준도 사람의 지위보다 queue 사용 행동에 둔다.

- 동시에 여러 PR을 열어야 할 실제 작업 흐름이 있는가?
- 각 PR이 독립적으로 닫히거나 병합될 수 있는가?
- 피드백 뒤 방치된 Draft를 정리하는가?
- 한도를 넘는 동안 다른 기여자의 triage를 방해하지 않는가?

Bypass된 PR도 동일한 template과 review 조건을 따른다. 예외가 필요한 기간이 끝났거나 abandoned PR이 반복되면 회수한다. 반대로 안정적으로 기존 자리를 마감해 온 신규 기여자에게는 필요할 때 제한적 bypass를 줄 수 있다. 핵심은 bypass가 권한 상승도, 품질 승인도 아니라는 점이다.

## PR template은 최소 admission receipt만 요구한다

Creation cap은 자리 수만 줄인다. 그 적은 자리에 “수정했습니다”라는 요약만 들어오면 maintainer는 문제 재현부터 다시 해야 한다. 다만 이 글에서 일반적인 review schema 전체를 다시 설계할 필요는 없다. 외부 기여자가 새 자리를 받을 때 제출할 최소 영수증은 다음 다섯 항목이면 된다.

```markdown
- Base SHA:
- Head SHA:
- Reproduction command:
- Before change: 예상한 실패와 실제 실패 결과
- After change: 같은 명령의 결과
- Not run: 실행하지 않은 항목과 이유
```

Base SHA는 어떤 기준에서 문제가 존재했는지 고정하고, head SHA는 결과가 어느 변경에 귀속되는지 고정한다. 재현 명령은 maintainer가 설명을 다시 해석하지 않고 실행할 수 있어야 한다. 수정 전 실패와 수정 후 결과가 같은 주장에 연결돼야 하며, 실행하지 않은 항목은 빈칸이나 “모두 통과”로 숨기지 않는다.

Template을 길게 만드는 것은 목적이 아니다. 변경 범위표, 위험 등급, reviewer 상태 머신, 통합 queue metadata까지 한 번에 요구하면 외부 기여자는 형식만 채우고 핵심 실패 증거는 흐려질 수 있다. 더 상세한 증거 계약과 review 상태는 앞서 링크한 [AI 소프트웨어 팩토리 글]({% post_url 2026-10-11-ai-software-factory-work-decomposition %})의 범위다.

자동 검사는 빈 필드만 잡을 수 있다. SHA가 실제 PR의 base/head와 맞는지, 명령이 존재하는지, before 결과가 정말 실패였는지는 사람이 또는 별도 check가 확인해야 한다. Head가 바뀌면 기존 after 결과가 새 head를 증명하지 않는다는 점도 명시한다. 그러나 이 글의 admission 목적에서는 상세한 review workflow보다 **현재 자리를 검증 가능한 후보가 차지하는가**만 확인하면 된다.

## Abandoned Draft는 별도 정리 규칙이 필요하다

Draft를 한도에 포함하면 오래된 Draft가 작성자 자신의 다음 기여를 막을 수 있다. 제외하면 저장소 목록과 automation 비용을 계속 점유할 수 있다. 어느 쪽이든 방치된 Draft를 무기한 두는 정책은 creation cap의 의미를 약하게 만든다.

정리 규칙은 inactivity만 보지 말고 다음 행동의 owner를 구분해야 한다.

- `awaiting-author`: 재현 정보 보완, conflict 해결, 새 head 결과가 필요하다.
- `awaiting-maintainer`: 방향 확인이나 review를 저장소가 해야 한다.
- `blocked-external`: upstream release나 외부 issue를 기다린다.
- `abandoned-draft`: 작성자 응답 기한이 지났고 재개 계획이 없다.

GitHub가 관리하는 `actions/stale`은 일정 기간 상호작용이 없는 issue와 PR에 경고를 남기고 닫도록 구성할 수 있다.[6] 하지만 기본 inactivity timer를 모든 Draft에 그대로 적용하면 maintainer 답변을 기다린 기여자까지 벌점으로 처리한다. 자동 close clock은 `awaiting-author`에만 흐르게 하고, `awaiting-maintainer`와 명시된 외부 blocker에서는 멈추는 것이 낫다.

Close 전 comment에는 필요한 다음 행동, deadline, 다시 제출할 조건을 적는다. 오래된 Draft를 되살릴 때는 현재 base에서 reproduction과 결과를 다시 만들도록 한다. 정리는 기여자를 처벌하는 절차가 아니라, 사용하지 않는 contributor-level 자리를 반환하는 절차다.

## 이 기능에 맞는 관측 항목

일반적인 merge throughput이나 reviewer utilization은 별도 운영 문제다. 이 기능의 효과를 보려면 creation cap과 직접 연결된 항목만 측정하는 편이 낫다.

| 항목 | 확인하려는 것 |
|---|---|
| cap 도달 사용자 수 | 한도가 실제로 누구의 추가 생성을 막는가 |
| 사용자별 open PR·Draft 분포 | 소수 기여자에게 자리가 집중되는가 |
| Draft 포함 전후 우회 생성 | Draft counting이 의도한 loophole을 줄였는가 |
| bypass 사용·회수 사유 | 예외가 필요한 흐름인지 관성적 특권인지 |
| admission receipt 누락률 | 적은 자리에도 재현 정보가 빠지는가 |
| abandoned Draft age·close 수 | 방치 후보가 자리를 얼마나 오래 점유하는가 |
| cap 이후 재제출률 | 좋은 기여가 영구 이탈하지 않고 정리 후 돌아오는가 |

Agent 작성 여부를 분류하더라도 단순 평균으로 품질 원인을 단정하지 않는다. 이 설정의 대상은 “AI”가 아니라 write access가 없는 사용자이고, GitHub 발표도 agent를 원인으로 확인하지 않았다.[1][2][4] 필요한 질문은 작성 도구가 무엇이었는지가 아니라, 한 기여자가 동시에 점유한 후보 수와 각 후보의 최소 증거가 정책에 맞는가다.

## 저장소에 적용할 최소 정책

실제 도입안은 다음 정도로 좁게 시작할 수 있다.

1. **범위 확인:** Public repository의 write access 없는 사용자에게 적용되는 contributor-level cap임을 문서화한다.
2. **동작 확인:** 2026-10-11 현재 문서 표면이 불일치하므로 설정 UI와 별도 테스트 저장소의 비권한 계정 동작을 확인한다.
3. **Draft 결정:** Draft를 자리로 셀지 정하고, 포함·제외 이유와 확인 날짜를 기록한다.
4. **Bypass 관리:** 사유·owner·검토일을 남기고 quality gate 면제가 아님을 명시한다.
5. **입장 영수증:** Base/head SHA, 재현 명령, 수정 전 실패, 수정 후 결과, 미실행 항목만 PR template에 요구한다.
6. **Draft 정리:** `awaiting-author` 상태에만 만료 clock을 적용하고 close 전 다음 행동과 재개 조건을 알린다.
7. **조직 설정 분리:** Organization-level cap은 별도 설정으로 확인하고 10월 발표만으로 Draft 옵션 노출을 가정하지 않는다.

한도 숫자 자체에는 보편적인 정답이 없다. 먼저 사용자별 open PR·Draft 분포와 abandoned Draft age를 보고 작은 값으로 시작한다. 한도에 자주 걸리지만 완결된 변경을 꾸준히 제출하는 기여자에게는 근거 있는 bypass가 맞을 수 있다. 반대로 한도 아래에서도 영수증 없는 Draft가 오래 남는다면 숫자를 더 낮추기보다 admission template과 정리 규칙부터 고쳐야 한다.

## 결론

GitHub가 발표한 것은 AI agent 판정 기능이 아니다. Public repository에서 write access가 없는 사용자의 동시 PR 생성 한도에 Draft를 포함할 수 있게 한 moderation 옵션이다.[1][2][4] 조직 수준 한도는 별도 발표됐고, 10월 발표만으로 조직 설정의 동일한 Draft control까지 확정할 수 없다.[5]

확인일 기준 changelog, interaction 문서, 버전 고정 REST schema도 완전히 일치하지 않는다.[1][2][3] 원인을 rollout으로 단정하지 말고, 설정 UI와 write 없는 테스트 계정의 실제 생성 동작을 분리해 확인해야 한다.

이 기능의 고유한 가치는 거대한 review factory를 설계하는 데 있지 않다. **외부 기여자 한 명이 점유할 수 있는 동시 후보 수를 제한하고, Draft 우회를 선택적으로 닫고, 예외를 관리하며, 각 자리에 최소 재현 영수증을 요구하고, 방치된 Draft의 자리를 반환하는 것**이다. Creation cap은 품질을 판정하지 않지만, 검토할 수 없는 후보가 무제한으로 입장하는 것을 막는 첫 경계는 될 수 있다.

## Sources

[1] https://github.blog/changelog/2026-10-08-draft-pull-requests-count-toward-pull-request-limits/
[2] https://docs.github.com/en/communities/moderating-comments-and-conversations/limiting-interactions-in-your-repository
[3] https://docs.github.com/en/rest/interactions/repos?apiVersion=2026-03-10
[4] https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access
[5] https://github.blog/changelog/2026-08-06-set-pull-request-limits-at-the-organization-level
[6] https://github.com/actions/stale
