---
title: 'AI 에이전트의 테스트 결과를 Jira에 남기는 법 — 재현 가능한 업무 로그 만들기'
date: 2026-05-24 19:00:00
categories: ["AI 에이전트"]
description: 'AI 에이전트가 코드를 수정한 뒤 테스트 결과를 대화창에만 남기면 재현성이 떨어진다. Jira에 실행 명령, 결과, 실패 원인, 남은 리스크를 구조화해 남기는 방식을 정리한다.'
featured_image: '/images/2026-05-24-ai-agent-test-results-in-jira/cover.svg'
tags: [ai-agent, jira, testing, claude-code, qa]
---

![AI 에이전트 테스트 결과 Jira 기록](/images/2026-05-24-ai-agent-test-results-in-jira/cover.svg)

AI 에이전트가 코드를 수정하면 항상 같은 질문이 남는다. 정말 테스트했는가? 어떤 명령을 실행했는가? 실패한 테스트는 없었는가? 실패했다면 왜 실패했고, 어떻게 고쳤는가?

대화창에 “테스트 통과했습니다”라고 남기는 것은 부족하다. 사람 리뷰어가 재현할 수 있어야 하고, 다음 에이전트가 이어받을 수 있어야 한다. 그래서 테스트 결과는 Jira Issue에 구조화해서 남겨야 한다.

## 테스트 결과는 결과만 있으면 안 된다

나쁜 테스트 보고는 이렇게 생겼다.

```text
테스트 완료. 문제 없음.
```

이 문장은 거의 쓸모가 없다. 어떤 테스트를 했는지, 어떤 환경에서 했는지, 무엇을 검증했는지, 실패한 것은 없는지 알 수 없다.

좋은 테스트 보고는 최소한 다음을 포함해야 한다.

- 실행한 명령
- 실행 환경
- 성공/실패 결과
- 실패한 경우 원인
- 재시도 여부
- 커버한 케이스
- 커버하지 못한 케이스
- 남은 리스크

AI 에이전트가 남기는 테스트 결과는 사람이 재실행할 수 있어야 한다.

## `/jira test-result PROJ-123`

테스트 결과 기록용 명령은 별도로 두는 편이 좋다.

```text
/jira test-result PROJ-123
```

이 명령은 최근 실행한 테스트 명령을 자동으로 수집하거나, 사용자가 입력한 결과를 템플릿에 맞춰 Jira comment로 남긴다.

기본 템플릿은 다음과 같다.

```markdown
## Test Result

### Commands
```bash
npm test -- webhook
npm run lint
```

### Result
- `npm test -- webhook`: PASS
- `npm run lint`: PASS

### Covered Cases
- 5xx 응답 재시도
- 4xx 응답 미재시도
- network timeout 재시도
- webhook URL/token 로그 마스킹

### Failed Attempts
- 첫 번째 구현에서 4xx도 재시도되는 문제 발견
- retry predicate 분리 후 해결

### Remaining Risk
- 실제 Slack 429 rate limit 응답은 mock 기반으로만 검증됨
- 운영 환경 timeout 값은 배포 후 모니터링 필요
```

이 정도면 리뷰어가 무엇을 믿어도 되는지 판단할 수 있다.

## 실패 로그도 자산이다

에이전트는 종종 실패를 숨기려는 듯한 결과 요약을 만든다. 하지만 개발에서 실패 로그는 중요한 자산이다. 어떤 테스트가 실패했고, 왜 실패했고, 어떻게 해결했는지가 다음 작업자의 시간을 줄인다.

따라서 테스트 결과에는 실패한 시도도 남겨야 한다.

```markdown
### Failed Attempts
1. `npm test -- webhook` 실패
   - 원인: retry 조건이 status code 전체에 적용되어 400도 재시도됨
   - 조치: `shouldRetry(status)` 분리

2. `npm run lint` 실패
   - 원인: unused import
   - 조치: 불필요한 import 제거
```

이 정보는 단순히 “최종 PASS”보다 유용할 때가 많다.

## 테스트 범위와 남은 리스크를 분리한다

테스트를 했다는 말은 모든 리스크가 사라졌다는 뜻이 아니다. 특히 AI 에이전트가 만든 코드는 테스트 범위와 남은 리스크를 분리해서 기록해야 한다.

예를 들어 다음과 같이 쓴다.

```markdown
### Covered Cases
- 5xx retry
- network timeout retry
- 4xx no retry
- secret masking

### Not Covered
- 실제 Slack API rate limit
- 운영 환경 네트워크 지연
- 여러 알림이 동시에 실패하는 경우

### Remaining Risk
- retry로 인해 중복 알림이 발생할 가능성
- rate limit 정책은 후속 이슈 필요
```

이렇게 쓰면 리뷰어가 추가 테스트나 후속 이슈를 판단할 수 있다.

## 자동 수집과 수동 보정

플러그인이 테스트 결과를 자동으로 수집할 수 있으면 좋다. 예를 들어 Claude Code 세션에서 실행한 Bash 명령 중 테스트 관련 명령을 찾아 comment 초안을 만들 수 있다.

하지만 자동 수집만 믿으면 안 된다. 테스트 명령의 의미는 사람이 보정해야 한다.

```text
자동 수집:
- npm test -- webhook: exit code 0
- npm run lint: exit code 0

사람/에이전트 보정:
- 이 테스트가 어떤 요구사항을 검증했는지
- mock 기반이라 실제 API는 검증하지 못했다는 점
- 남은 리스크
```

좋은 플러그인은 자동으로 초안을 만들고, 최종 comment 전 preview를 보여줘야 한다.

## 테스트 결과와 Jira 상태 전환

테스트 결과가 없는 상태에서 `/jira complete`를 실행하면 경고해야 한다.

```text
No test result found for PROJ-123.
Continue completion without test evidence? [y/N]
```

작은 문서 작업은 테스트가 없을 수 있다. 하지만 코드 변경이 있는 이슈에서 테스트 결과 없이 리뷰로 넘기는 것은 위험하다.

상태 전환 정책은 팀마다 다르겠지만, 기본 원칙은 다음이다.

- 코드 변경 있음 + 테스트 결과 없음 → 경고
- 테스트 실패 있음 → 리뷰 대기 전환 차단 또는 확인 필요
- 테스트 통과 + 남은 리스크 기록 → 리뷰 대기 전환 가능

## 민감 정보 마스킹

테스트 로그에는 민감 정보가 자주 섞인다. webhook URL, API token, DB connection string, 고객 ID 등이 대표적이다.

Jira에 기록하기 전 반드시 redaction이 필요하다.

```text
https://hooks.slack.com/services/XXX/YYY/ZZZ
→ https://hooks.slack.com/services/[REDACTED]

Authorization: Bearer abcdefg
→ Authorization: Bearer [REDACTED]
```

에이전트가 로그를 붙이기 전에 플러그인이 한 번 더 막아야 한다. 사람도 실수하지만, 에이전트는 더 빠르게 더 많은 실수를 남길 수 있다.

## 결론

AI 에이전트의 테스트 결과는 대화창에 남기면 안 된다. Jira Issue에 실행 명령, 결과, 실패 원인, 커버한 케이스, 남은 리스크를 구조화해서 남겨야 한다.

테스트 기록의 목적은 “통과했다”는 선언이 아니다. 사람이 재현하고, 다음 에이전트가 이어받고, 나중에 비슷한 이슈에서 참고할 수 있는 업무 로그를 만드는 것이다.

AI 에이전트가 코드를 더 빨리 쓰는 시대일수록, 테스트 결과를 더 엄격하게 남기는 습관이 필요하다.
