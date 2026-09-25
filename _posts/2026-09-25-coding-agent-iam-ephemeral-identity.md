---
title: '코딩 에이전트 IAM: 사람 계정 대신 작업별 임시 자격 증명'
date: 2026-09-25 10:40:00 +0900
categories: ["AI 보안"]
description: '사람과 에이전트 identity를 분리하고 GitHub App, credential broker와 작업별 임시 권한을 설계하는 방법.'
featured_image: 'https://picsum.photos/seed/coding-agent-iam-ephemeral-identity/1600/900'
tags: [ai-agent, iam, coding-agent, github-app, least-privilege, security, devsecops]
---

![코딩 에이전트 IAM과 임시 권한](https://picsum.photos/seed/coding-agent-iam-ephemeral-identity/1600/900)

코딩 에이전트를 처음 도입할 때 가장 쉬운 인증 방법은 개발자의 기존 계정을 그대로 사용하는 것이다. 로컬 CLI는 사용자의 Git credential, GitHub CLI 로그인, SSH agent, package registry token, cloud profile을 이미 사용할 수 있다. 별도 integration을 만들지 않아도 clone, branch, push, issue 수정, CI 실행이 가능하다.

바로 그 편리함이 가장 큰 위험이다.

사람 계정에는 오랜 기간 누적된 권한이 있다. 여러 저장소, 조직, package registry, cloud account, VPN 내부 서비스에 접근한다. 사람은 화면과 조직 문맥을 보며 하루에 몇 번 행동하지만 에이전트는 짧은 시간에 수백 개 명령과 API 호출을 실행할 수 있다. 같은 credential이라도 자동화된 실행 속도와 반복성 때문에 사고 반경이 달라진다.

따라서 코딩 에이전트의 IAM은 “어떻게 로그인시킬까”가 아니라 다음 질문에서 시작해야 한다.

> 어떤 사람이 어떤 업무를 어떤 에이전트 실행에 위임했고, 그 실행은 어느 리소스에 어떤 행위를 얼마 동안 할 수 있는가?

## 사람 identity와 agent identity를 분리한다

에이전트가 사람의 요청으로 시작됐다고 해서 사람과 같은 identity로 행동해야 하는 것은 아니다. 한 번의 코딩 작업에는 적어도 다음 주체가 있다.

- 요청을 만든 사람
- 작업을 조율하는 agent runtime
- 실제 명령을 실행하는 sandbox 또는 worker
- GitHub·GitLab 같은 source control integration
- CI/CD workflow identity
- package·artifact registry identity
- cloud 또는 staging 환경 identity

이들을 하나의 personal access token이나 SSH key로 합치면 감사 로그는 모든 행동을 사람의 것으로 기록한다. 사용자가 직접 push했는지, 에이전트가 자동으로 push했는지 구분하기 어렵다. 사용자가 팀을 옮기거나 퇴사했을 때 진행 중인 agent job의 처리도 모호해진다.

권장 모델은 **human delegation과 agent execution을 연결하되 identity는 분리하는 것**이다.

```text
human_subject
   ↓ 작업 위임
work_item / delegation
   ↓ 정책 평가
agent_run
   ↓ 임시 권한 발급
repository credential / CI identity / registry credential
   ↓
구조화된 audit event
```

`human_subject`는 책임과 승인 문맥을 제공한다. `agent_run`은 실제 실행 주체다. 외부 서비스 credential은 agent run과 특정 작업 범위에 묶인 임시 capability다.

이 ID들은 GitHub나 특정 agent 제품의 표준 필드가 아니라 조직이 운영 추적을 위해 정의하는 모델이다.

## 공유 bot 계정도 충분하지 않다

사람 계정을 피하기 위해 `build-bot` 같은 공유 계정을 만드는 팀이 많다. 개인 계정보다 구분은 쉬워지지만 다음 문제가 남는다.

- 모든 repository와 agent run이 같은 credential을 공유한다.
- 한 작업에서 유출된 token이 다른 프로젝트에도 사용된다.
- audit에는 bot 이름만 남고 실제 요청자와 run이 사라진다.
- 권한을 줄이면 여러 자동화가 함께 깨지고, 늘리면 모두가 과도한 권한을 얻는다.
- token 회전과 폐기가 전체 시스템 장애로 이어진다.

공유 bot은 identity 분리의 끝이 아니라 중간 단계다. 최소 단위는 “에이전트 제품 하나”가 아니라 **작업 실행 하나**에 가까워야 한다.

## GitHub App을 권한 broker로 사용한다

GitHub 작업에서는 장기 personal access token보다 GitHub App이 더 적합한 경우가 많다. GitHub App installation access token으로 수행한 API 요청은 app에 귀속된다. App의 repository access와 permission 범위 안에서만 동작한다.[1]

GitHub 공식 문서에 따르면 installation access token은 한 시간 후 만료된다. Token을 만들 때 접근할 repository와 permission을 App이 가진 범위보다 더 좁힐 수도 있다.[1] GitHub도 App 등록과 token 생성 시 최소 권한을 선택하도록 권고한다.[2]

이 특성을 작업별 발급에 활용할 수 있다.

```text
1. 사용자가 issue 작업을 요청한다.
2. 정책 엔진이 대상 repository와 필요한 작업을 계산한다.
3. credential broker가 해당 repository에만 유효한 installation token을 만든다.
4. contents:write, pull_requests:write 등 필요한 permission만 부여한다.
5. token을 agent context가 아닌 실행 worker에 짧게 전달한다.
6. 작업 종료 시 token을 폐기하고 run과 token fingerprint를 연결한다.
```

한 시간 만료가 모든 위험을 해결하지는 않는다. 한 시간은 자동화 공격에 충분히 긴 시간이다. 중요한 것은 token의 수명뿐 아니라 repository와 permission을 함께 좁히고, 발급 조건과 사용량을 관찰하며, 작업 종료 시 폐기하는 것이다.

App private key는 installation token보다 훨씬 강한 credential이다. App이 설치된 모든 account에 대한 token을 만들 수 있으므로 agent worker에 넣으면 안 된다. GitHub도 private key를 vault 등에 안전하게 보관하고 광범위하게 공유하지 말라고 권고한다.[2] Private key는 신뢰된 credential broker에만 두고 worker에는 완성된 임시 token만 전달한다.

## 사용자 대신 행동할 때 attribution을 보존한다

GitHub App의 installation token은 독립적인 automation에 적합하고 활동이 App에 귀속된다. 사용자 입력을 바탕으로 사용자 대신 행동한다면 GitHub는 user access token 사용을 권고한다. User access token은 App의 permission과 사용자의 permission 양쪽에 제한된다.[2]

하지만 코딩 에이전트에서 모든 작업을 user token으로 처리하면 다시 사람 credential의 넓은 범위를 상속할 수 있다. 따라서 다음 두 경로를 명확히 나눈다.

### 독립 automation

- 정기 dependency update
- 정적 분석 결과 반영
- 문서 동기화
- 승인된 issue에서 branch와 PR 생성

이런 작업은 GitHub App installation identity로 수행하고 audit에 요청자와 run ID를 별도로 연결할 수 있다.

### 사용자 권한에 의존하는 위임 작업

- 사용자가 볼 수 있는 private repository 검색
- 사용자 소유 resource 변경
- 개인 권한으로 승인되는 조직 작업

이 경우 user-bound identity가 필요할 수 있다. 그래도 agent가 사용자 token 원문을 모델 context에 읽지 않게 하고, resource·operation·시간을 제한하는 gateway를 둔다.

Attribution은 commit author 문자열 하나로 해결되지 않는다. 최소한 다음을 함께 기록한다.

- human subject ID
- agent runtime과 version
- run·work item ID
- repository ID와 base commit
- 실제 GitHub App 또는 user identity
- token fingerprint와 만료 시각
- 정책 결정과 승인 ID
- 생성한 branch, commit, PR

## API scope만으로 실제 권한을 설명할 수 없다

Agent IAM의 중심은 credential 수명 주기지만, 발급 범위를 정하려면 executor의 실제 도달 범위를 알아야 한다. 좁은 GitHub permission도 사용자 SSH agent, `gh` token, Docker socket처럼 우회 가능한 credential이 함께 노출되면 의미가 약해진다.[3][4]

```text
Effective Capability =
  API permissions
× available credentials
× filesystem·network reach
× runtime duration
```

따라서 broker는 repository scope만 보지 않고 최소한 세 가지를 확인한다: 개인 SSH·PAT를 상속하지 않는가, Docker·cloud profile에 접근하지 않는가, 작업 종료 시 credential과 runtime이 함께 폐기되는가. Sandbox의 세부 정책과 `deny/ask/allow` 합성은 운영 통제 글에서 다루고, 이 글은 **어떤 identity를 언제 발급하고 폐기할지**에 집중한다.

## Credential은 모델이 아니라 executor가 사용한다

가장 중요한 설계 원칙은 모델에게 secret을 보여 주지 않는 것이다. System prompt에 “token을 출력하지 말라”고 적는 것은 접근 통제가 아니다. 모델이 secret을 읽을 수 있으면 tool argument, encoding, log, 생성 파일을 통해 노출할 수 있다.

Credential은 신뢰된 executor 또는 gateway가 주입하고 사용한다.

```text
Agent가 "PR을 생성해 달라"는 구조화된 요청 생성
       ↓
Policy Engine이 repository·branch·approval 검사
       ↓
Credential Broker가 짧은 token 발급
       ↓
Executor가 GitHub API 호출
       ↓
결과 ID와 상태만 Agent에 반환
```

Agent에게는 token 값 대신 capability handle을 제공할 수 있다.

```json
{
  "capability_id": "cap_01K...",
  "operation": "github.pull_request.create",
  "repository_id": 123456,
  "branch_pattern": "agent/*",
  "expires_at": "2026-09-25T11:20:00+09:00"
}
```

Capability handle은 executor에서만 실제 credential로 교환된다. Handle 자체도 재사용과 탈취 위험이 있으므로 run, operation, request digest에 binding하고 짧게 만료시킨다.

## Read, propose, apply 권한을 나눈다

코딩 workflow를 하나의 `write` permission으로 표현하면 과도하게 거칠다. 최소한 세 단계로 나누는 편이 좋다.

### Read

- repository와 issue 읽기
- dependency·CI 상태 조회
- 코드 검색과 분석
- diff와 artifact 검토

Read도 무해하지 않다. Private code와 secret, 고객 데이터가 유출될 수 있다. Repository allowlist와 network egress, response redaction이 필요하다.

### Propose

- 격리된 worktree에 patch 생성
- 검토용 diff와 test report 작성
- PR body 초안 생성
- deployment plan 또는 migration plan 생성

Propose 단계는 production write 없이 작업 품질을 검증할 수 있다. Agent 도입 초기 기본값으로 적합하다.

### Apply

- 원격 branch push
- PR·issue 생성 또는 수정
- CI workflow trigger
- package publish
- staging·production 변경

Apply는 세분화해야 한다. Branch push와 default branch push는 다르고, staging과 production은 다르다. GitHub Copilot cloud agent의 책임 있는 사용 문서도 cloud agent가 대상 repository로 제한되고 새 `copilot/` branch 또는 기존 PR branch에만 push하며 default branch에 직접 push하지 못한다고 설명한다.[5]

이런 구조를 자체 agent에서도 채택할 수 있다. Agent는 branch까지만 쓰고 merge는 branch protection과 사람 review가 담당하게 한다.

## Broker는 승인 ID를 검증한 뒤 credential을 발급한다

승인은 “이 agent를 신뢰한다”가 아니라 repository, base SHA, target, operation과 diff digest에 묶는다. Broker는 credential을 발급하기 직전에 approval ID의 범위·만료·입력 digest를 확인하고, 하나라도 바뀌면 발급을 거부한다.

```text
policy decision → bound approval → short-lived credential → executor use → read-back → revoke
```

관리 정책은 개인의 saved approval이나 auto-approval보다 우선해야 한다.[6] Sandbox와 승인 정책의 세부 조합은 운영 통제 글에서 다룬다. IAM 관점의 핵심은 승인되지 않은 capability를 **발급하지 않는 것**, 승인 범위를 넘긴 token을 **교환하지 않는 것**, 종료된 run의 token을 **즉시 폐기하는 것**이다.

## Run 종료는 credential 종료여야 한다

작업이 끝났는데 token과 sandbox가 계속 살아 있으면 공격 표면도 남는다. Run lifecycle과 credential lifecycle을 연결한다.

```text
QUEUED
  ↓ identity 없음
AUTHORIZED
  ↓ 작업별 capability 발급
RUNNING
  ↓ heartbeat와 사용량 감시
WAITING_APPROVAL
  ↓ 고위험 capability 미발급 또는 일시 중지
COMPLETED / FAILED / CANCELLED
  ↓ token revoke, session 종료, sandbox 폐기
ARCHIVED
  ↓ secret 없는 audit·artifact만 보존
```

취소가 특히 중요하다. UI에서 cancel 버튼을 눌렀다고 child process, network request, cloud job이 모두 멈췄다고 가정하지 않는다. Runtime handle과 credential을 폐기하고 늦게 도착한 결과가 apply되지 않도록 fencing token을 검사한다.

Credential broker 장애 시 fail-open하지 않는다. 기존 token이 남아 있을 수 있으므로 신규 발급 중단, active token inventory, revoke queue, 수동 차단 경로가 필요하다.

## 감사 로그는 책임 그래프를 복원해야 한다

Shell 전체 stdout이나 prompt 전문을 저장하는 것은 감사의 충분조건이 아니다. 오히려 secret과 source code를 중앙 로그에 복제할 수 있다.

감사 event는 다음 질문에 답해야 한다.

- 누가 어떤 작업을 위임했는가?
- 어느 agent build와 sandbox가 실행했는가?
- 어떤 identity와 permission이 발급됐는가?
- 어떤 repository·branch·resource에 접근했는가?
- 어떤 정책이 허용·거부·승인을 결정했는가?
- 실제 외부 효과는 무엇이며 read-back으로 확인됐는가?
- 종료 시 credential과 sandbox가 폐기됐는가?

예시 event는 다음과 같다.

```json
{
  "event_type": "agent.capability.used",
  "occurred_at": "2026-09-25T10:51:03.211+09:00",
  "human_subject_id": "usr_42",
  "work_item_id": "work_01K...",
  "agent_run_id": "run_01K...",
  "runtime_digest": "sha256:...",
  "capability_id": "cap_01K...",
  "provider_identity": "github-app:98765",
  "repository_id": 123456,
  "operation": "git.push",
  "target": "refs/heads/agent/fix-idempotency",
  "policy_decision_id": "dec_01K...",
  "approval_id": "apr_01K...",
  "result": "verified",
  "external_id": "commit:8b11c0..."
}
```

Token 원문, private key, prompt 전문은 이 event에 넣지 않는다. Token은 되돌릴 수 없는 fingerprint나 발급 ID로 추적한다.

## 사고 대응은 identity graph를 기준으로 한다

Credential 유출이 의심되면 “bot token을 교체한다”만으로 충분하지 않다. 다음 객체를 선택적으로 폐기할 수 있어야 한다.

- 특정 agent run
- 특정 capability
- 특정 repository용 installation token
- 특정 GitHub App installation
- agent runtime 전체
- sandbox worker
- CI identity
- registry 또는 cloud credential

App private key가 유출됐다면 개별 installation token 폐기보다 훨씬 넓은 대응이 필요하다. 반대로 하나의 작업 token만 유출됐다면 전체 automation을 중단하지 않고 해당 run과 repository를 격리할 수 있어야 한다.

조사 순서는 다음과 같다.

1. 신규 capability 발급을 중지한다.
2. 의심 run과 worker를 격리한다.
3. 관련 token과 downstream credential을 폐기한다.
4. 최근 push, PR, workflow, package publish를 조회한다.
5. Audit event와 공급자 로그를 연결한다.
6. 승인되지 않은 변경을 revert하거나 quarantine한다.
7. Broker와 policy의 원인을 수정한다.
8. Negative test 후 낮은 위험 read 작업부터 복구한다.

## 현실적인 도입 순서

### 1단계: 사람 credential 인벤토리

Agent가 현재 상속하는 SSH agent, `gh`, package manager, cloud profile, keychain, environment variable을 조사한다. “사용하지 않는다”는 문서보다 sandbox 내부에서 실제로 접근 가능한지 시험한다.

### 2단계: Read-only 기본값

분석과 계획만 수행하고 remote write credential을 주지 않는다. Patch는 artifact로 내보내 사람이 적용한다.

### 3단계: GitHub App과 branch 제한

대상 repository와 필요한 permission만 가진 임시 installation token을 발급한다. Agent 전용 branch에만 push하고 default branch와 merge는 차단한다.

### 4단계: Capability broker

GitHub 외에 CI, registry, staging identity도 작업별로 발급한다. 모델과 sandbox가 root credential을 보지 않게 한다.

### 5단계: Call-time policy와 승인

Operation, target, diff digest, risk class에 따라 allow·deny·ask를 결정한다. 승인 뒤 입력 변경을 차단한다.

### 6단계: 종료와 사고 대응 훈련

Run 취소 시 모든 credential이 폐기되는지, 늦은 결과가 적용되지 않는지, 특정 run 하나만 격리할 수 있는지 검증한다.

## 운영 체크리스트

- [ ] 사람·agent runtime·worker·integration identity를 분리했다.
- [ ] 모든 외부 행동을 human delegation과 run으로 역추적할 수 있다.
- [ ] 공유 PAT와 개인 SSH key를 agent에 제공하지 않는다.
- [ ] 장기 key는 broker에 두고 작업 token의 repository·permission·수명을 최소화한다.
- [ ] token이 모델 context와 일반 로그에 노출되지 않는다.
- [ ] run 완료·실패·취소 때 credential을 폐기하고 실패를 경보한다.
- [ ] filesystem·network·credential injection과 Docker socket 접근을 함께 제한한다.
- [ ] read·propose·apply 권한과 default branch·production gate를 분리한다.
- [ ] 승인을 구체적인 target과 diff digest에 binding한다.
- [ ] 관리 정책이 사용자 bypass보다 우선한다.
- [ ] tool 성공 뒤 외부 상태를 read-back한다.
- [ ] 특정 run·token·repository만 격리하고 token 원문 없이 effect를 복원할 수 있다.

## 결론

코딩 에이전트에 사람 계정을 그대로 주는 방식은 빠르게 작동하지만 운영 경계를 무너뜨린다. 사람의 누적 권한, 로컬 credential, network reach를 자동화된 실행 속도로 사용할 수 있기 때문이다. 공유 bot 계정도 blast radius와 attribution 문제를 완전히 해결하지 못한다.

더 나은 구조는 사람의 위임과 agent의 실행 identity를 분리하고, GitHub App 같은 integration에서 작업별 임시 token을 발급하며, repository와 operation을 최소화하는 것이다. GitHub installation token이 한 시간 뒤 만료되고 repository·permission을 더 좁힐 수 있다는 점은 좋은 기반이지만 그것만으로 충분하지 않다.[1] Sandbox, network, filesystem, credential broker, approval, audit를 하나의 권한 경계로 설계해야 한다.

에이전트는 어떤 작업이 필요한지 제안할 수 있다. 그러나 자기 자신에게 권한을 발급하거나 승인 범위를 넓혀서는 안 된다. 모델의 판단과 권한 집행을 분리하고, 실제 write는 구조화된 capability와 검증 가능한 승인 뒤에서만 실행해야 한다. 그래야 빠른 자동화를 얻으면서도 누가 무엇을 왜 바꿨는지 설명하고, 문제가 생겼을 때 특정 실행만 멈출 수 있다.

## Sources

[1] https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation — Authenticating as a GitHub App installation
[2] https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app — Best practices for creating a GitHub App
[3] https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes — About cloud and local sandboxes
[4] https://openai.com/index/running-codex-safely/ — Running Codex safely at OpenAI
[5] https://docs.github.com/en/copilot/responsible-use/agents — Application card: GitHub Copilot Agents
[6] https://docs.github.com/en/copilot/reference/enterprise-managed-settings-reference — Enterprise managed settings reference
