---
title: 'Claude Code Jira 플러그인 개발기 — 이슈번호로 브랜치 만들고 개발 완료까지 연결하기'
date: 2026-05-24 18:00:00
categories: ["AI 에이전트"]
description: 'Jira 플러그인은 개발 방식을 강제하지 않아야 한다. 대신 이슈번호로 브랜치를 만들고, 개발 시작을 기록하고, 커밋과 개발 완료까지 연결하는 작업 라이프사이클을 표준화해야 한다.'
featured_image: '/images/2026-05-24-claude-code-jira-branch-commit-complete-flow/cover.svg'
tags: [claude-code, jira, git, ai-agent, workflow]
---

![Claude Code Jira 브랜치 커밋 완료 흐름](/images/2026-05-24-claude-code-jira-branch-commit-complete-flow/cover.svg)

처음에는 Jira 플러그인에 개발 방식 선택 명령을 넣을 생각이었다. 예를 들어 `/jira start PROJ-123 --mode superpowers`, `/jira start PROJ-123 --mode spike`, `/jira start PROJ-123 --mode analysis-only` 같은 방식이다.

하지만 이 설계는 곧 어색해졌다. Jira 플러그인이 개발 방식을 정하는 것은 책임이 너무 크다. 실제 개발은 이슈마다 다르고, 사람마다 다르고, 도구도 계속 바뀐다.

그래서 방향을 바꿨다. 플러그인은 개발 방식을 강제하지 않는다. 대신 Jira Issue에서 개발 브랜치, 커밋, 개발 완료 보고까지 이어지는 작업 라이프사이클을 표준화한다.

## 표준화할 것은 개발 방식이 아니라 입구와 출구다

개발자는 같은 Jira Issue를 받아도 여러 방식으로 처리할 수 있다.

- Superpowers 방식으로 계획을 세우고 TDD로 구현할 수 있다.
- OMC를 사용할 수 있다.
- Claude Code 기본 기능으로 바로 수정할 수 있다.
- Codex를 병행할 수 있다.
- 먼저 로직 분석만 할 수 있다.
- spike 실험을 하고 결과만 남길 수 있다.
- 사람이 직접 구현할 수도 있다.

이 자유도는 유지해야 한다. 플러그인이 특정 개발 방식을 강제하면 오히려 쓰기 불편해진다.

대신 표준화해야 할 것은 다음이다.

- 이슈번호로 작업을 시작한다.
- 이슈번호가 포함된 브랜치를 만든다.
- Jira 상태를 개발중으로 바꾼다.
- 개발 시작 comment를 남긴다.
- 커밋 메시지에 이슈번호를 포함한다.
- 테스트 결과를 Jira에 남긴다.
- 개발 완료 시 리뷰 대기 상태로 넘긴다.

즉, 개발 방식은 자유롭게 두고 작업의 궤적은 Jira와 Git에 남긴다.

## `/jira start PROJ-123`

가장 중요한 명령은 `/jira start`다.

```text
/jira start PROJ-123
```

이 명령은 단순히 Jira Issue를 여는 것이 아니다. 개발 작업의 입구를 만든다.

해야 할 일은 다음과 같다.

1. Jira Issue 조회
2. 이슈 brief 생성
3. 현재 git repo 확인
4. base branch 확인
5. 브랜치명 생성
6. git branch 생성
7. Jira 상태를 개발중으로 변경
8. 개발 시작 comment 작성
9. Claude Code 세션에 작업 컨텍스트 출력

브랜치명은 보통 다음 형식이 좋다.

```text
feature/PROJ-123-slack-webhook-retry
```

한글 이슈 제목을 그대로 브랜치에 쓰는 것은 피하는 편이 낫다. URL, CI, shell script, 일부 도구에서 문제가 생길 수 있다. 영어 slug를 만들기 어렵다면 단순히 이슈번호만 써도 된다.

```text
feature/PROJ-123
```

## 개발 시작 comment

`/jira start`는 Jira에도 기록을 남겨야 한다.

```markdown
## Development Started

### Branch
`feature/PROJ-123-slack-webhook-retry`

### Issue Brief
Slack webhook 전송 실패 시 재시도 로직을 추가한다.

### Acceptance Criteria
- 5xx 응답은 최대 3회 재시도
- 4xx 응답은 재시도하지 않음
- 최종 실패 시 로그 기록
- webhook URL/token은 로그에 남기지 않음

### Notes
개발 방식은 Claude Code 세션 안에서 결정한다.
구현 후 테스트 결과와 변경 요약을 이슈에 남긴다.
```

이 comment는 사람과 에이전트 모두에게 신호를 준다. 이 이슈는 개발이 시작되었고, 어느 브랜치에서 작업 중이며, 완료 기준은 무엇인지 명확해진다.

## 개발 중 기록

개발 중간에 모든 생각을 Jira에 남길 필요는 없다. 하지만 중요한 결정과 막힌 지점은 남겨야 한다.

필요한 명령은 이 정도면 충분하다.

```text
/jira note PROJ-123
/jira decision PROJ-123
/jira blocker PROJ-123
```

예를 들어 구현 중 4xx는 재시도하지 않기로 결정했다면 이렇게 남길 수 있다.

```markdown
## Decision

### Decision
5xx와 network error만 재시도하고, 4xx는 즉시 실패 처리한다.

### Reason
4xx는 요청 자체가 잘못된 경우가 많아 재시도해도 성공 가능성이 낮다.
반복 호출 시 rate limit이나 중복 알림 위험이 커진다.

### Trade-off
429 rate limit은 별도 정책이 필요하다.
이번 이슈에서는 후속 작업으로 분리한다.
```

이런 결정이 Jira에 남아 있으면 리뷰어가 왜 그렇게 구현했는지 추적할 수 있다.

## `/jira commit PROJ-123`

개발이 어느 정도 끝났다면 커밋이 필요하다.

```text
/jira commit PROJ-123
```

이 명령은 다음을 확인해야 한다.

- 현재 브랜치에 이슈번호가 포함되어 있는가?
- 변경 파일이 있는가?
- diff에 민감정보가 포함되어 있지 않은가?
- 테스트 결과가 있는가?
- 커밋 메시지에 이슈번호가 포함되어 있는가?

커밋 메시지 규칙은 단순한 것이 좋다.

```text
<type>(<ISSUE_KEY>): <summary>
```

예시는 다음과 같다.

```text
feat(PROJ-123): add Slack webhook retry handling
fix(PROJ-456): prevent duplicate alert delivery
test(PROJ-789): add retry policy coverage
```

커밋 전에 secret scan은 반드시 필요하다. `.env`, `API_KEY`, `SECRET`, `TOKEN`, `password=`, webhook URL 같은 패턴이 diff에 있으면 경고하거나 막아야 한다.

## `/jira complete PROJ-123`

개발 완료 명령은 `done`보다 `complete`가 낫다.

```text
/jira complete PROJ-123
```

이유는 `Done`이라는 Jira 상태와 혼동될 수 있기 때문이다. 개발 완료는 보통 최종 완료가 아니다. 리뷰 대기 또는 QA 대기로 넘기는 단계다.

`/jira complete`가 해야 할 일은 다음이다.

1. git status 확인
2. 마지막 커밋 확인
3. 변경 파일 요약
4. 테스트 결과 수집
5. 남은 리스크 정리
6. Jira comment 작성
7. Jira 상태를 리뷰 대기로 변경
8. PR이 있으면 링크 첨부

완료 comment는 이렇게 남길 수 있다.

```markdown
## Development Completed

### Branch
`feature/PROJ-123-slack-webhook-retry`

### Commits
- `abc1234` feat(PROJ-123): add Slack webhook retry handling

### Changed Files
- `src/slack/webhook.ts`
- `tests/slack/webhook.test.ts`

### Implementation Summary
Slack webhook 전송 실패 시 재시도 로직을 추가했다.
5xx 응답과 network error는 최대 3회 재시도하며, 4xx 응답은 재시도하지 않는다.

### Test Result
- `npm test -- webhook`: PASS
- `npm run lint`: PASS

### Remaining Risk
- Slack 429 rate limit은 별도 정책이 필요하다.
- 운영 timeout 값은 배포 후 모니터링이 필요하다.

### Next Step
리뷰 요청.
```

이 정도면 리뷰어는 변경 내용을 빠르게 이해할 수 있다.

## 실패한 설계: 개발 모드를 커맨드로 고르기

처음 생각했던 `--mode superpowers` 같은 설계는 버리는 게 맞다. 이유는 세 가지다.

첫째, 개발 방식은 작업마다 다르다. 둘째, 도구는 계속 바뀐다. 셋째, Jira 플러그인이 실행 엔진이 되면 책임이 과해진다.

Jira 플러그인의 역할은 작업의 입구와 출구를 표준화하는 것이다. 실제 구현은 Claude Code 세션 안에서 자연스럽게 결정하면 된다.

## 결론

Claude Code Jira 플러그인은 개발자를 특정 방식에 가두면 안 된다. 대신 Jira Issue에서 시작해 브랜치, 커밋, 테스트 결과, 리뷰 요청까지 이어지는 작업의 궤적을 남겨야 한다.

좋은 자동화는 자유도를 줄이는 것이 아니라, 반복되는 행정 작업을 줄이고 중요한 기록을 놓치지 않게 만든다.

이슈번호로 브랜치를 만들고, 개발 시작을 기록하고, 커밋과 완료 보고를 Jira에 남기는 것. 이 정도의 얇은 인터페이스가 실제로 오래 쓸 수 있는 설계다.
