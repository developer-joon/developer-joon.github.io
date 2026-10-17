# 2026-10-17 주간 AI·개발 포스트 12편 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 공식 자료로 검증된 주간 기술 포스트 10편과 Amazon Bedrock AgentCore·MCP ToolHub 딥다이브 2편을 작성하고, 통합 release gate를 통과한 feature branch와 PR을 전달한다.

**Architecture:** 하나의 source/overlap map이 12개 글의 경계와 경로를 소유한다. 각 글은 독립 작업자가 별도 파일에 작성하고, spec review 후 cross-batch review를 거쳐 하나의 revision-bound 정적 artifact로 검증한다.

**Tech Stack:** Jekyll Markdown, Docker build, React/Vite Community validation, Node artifact verifier, Codex `$humanize-korean`, Git/GitHub CLI.

---

### Task 1: 배치 source/overlap map 확정

**Objective:** 정확히 12개의 제목·경로·날짜·출처·중복 경계·핵심 결론을 고정한다.

**Files:**
- Create: `docs/research/2026-10-17-weekly-ai-dev-posts-source-map.md`

**Steps:**
1. 각 후보의 공식 발표일과 GA/preview/stable 상태를 재확인한다.
2. 기존 `_posts`와 열린 Reflection Beam PR의 검색 의도까지 비교한다.
3. 파일 경로와 즉시 공개 가능한 KST timestamp를 할당한다.
4. 프로그램으로 map 항목 수가 12인지 검증한다.

### Task 2: AI 모델 포스트 3편 작성

**Objective:** 모델 소개가 아닌 실행·비용·운영 메커니즘 중심 글을 작성한다.

**Files:**
- Create: `_posts/2026-10-17-flux-3-image-klein-layout-control.md`
- Create: `_posts/2026-10-17-ultrabert-32k-long-document-retrieval.md`
- Create: `_posts/2026-10-17-granite-switch-4-1-one-endpoint.md`

**Steps:**
1. 파일별 독립 ledger로 cite-while-drafting한다.
2. 모델·코드·라이선스 공개 범위를 분리한다.
3. 공급자 benchmark 조건과 자체 측정 제안을 분리한다.
4. strict citation 및 whitespace 검사를 실행한다.

### Task 3: 개발 도구 포스트 3편 작성

**Objective:** 새 정책·API·LSP의 실제 migration과 검증 절차를 제공한다.

**Files:**
- Create: `_posts/2026-10-17-github-actions-workflow-lockfile.md`
- Create: `_posts/2026-10-17-github-license-compliance-merge-gate.md`
- Create: `_posts/2026-10-17-intellij-java-kotlin-lsp-vscode-cursor.md`

**Steps:**
1. preview와 GA 경계를 보존한다.
2. lockfile·audit event·LSP 동작을 관측 가능한 산출물로 만든다.
3. 기존 GitHub·Copilot 글과 결론을 반복하지 않는다.
4. strict citation 및 whitespace 검사를 실행한다.

### Task 4: 클라우드·관측성 포스트 2편 작성

**Objective:** checkpoint와 metrics cardinality를 비용·실패 모드까지 연결한다.

**Files:**
- Create: `_posts/2026-10-17-lambda-durable-go-workflow.md`
- Create: `_posts/2026-10-17-grafana-connection-kpi-metrics-cost.md`

**Steps:**
1. Lambda Durable Go의 GA 기능과 호출자 idempotency 책임을 분리한다.
2. Grafana의 stack-wide KPI 설정과 retention 지연을 보존한다.
3. 비용 계산은 입력 조건과 단위를 명시한다.
4. strict citation 및 whitespace 검사를 실행한다.

### Task 5: 보안 포스트 2편 작성

**Objective:** 공격 코드를 제공하지 않고 노출 판별·복구 증거·로그 보존을 재현한다.

**Files:**
- Create: `_posts/2026-10-17-cisco-email-gateway-exposure-runbook.md`
- Create: `_posts/2026-10-17-aomei-ephemeral-supply-chain-tampering.md`

**Steps:**
1. Cisco의 두 영향 조건과 fixed version을 advisory 그대로 보존한다.
2. AOMEI의 공격 관측 기간과 보고서 공개일을 분리한다.
3. 현재 URL 평판과 당시 endpoint evidence의 차이를 설명한다.
4. strict citation 및 whitespace 검사를 실행한다.

### Task 6: Amazon Bedrock AgentCore 딥다이브 작성

**Objective:** Bedrock 모델 호출과 AgentCore의 agent infrastructure 기능·성능·비용을 층별로 설명한다.

**Files:**
- Create: `_posts/2026-10-17-amazon-bedrock-agentcore-deep-dive.md`

**Steps:**
1. Runtime, Gateway, Identity, Memory, Observability, Browser, Code Interpreter, Evaluations의 현재 상태와 region/plan 경계를 확인한다.
2. Bedrock token 비용과 AgentCore 인프라 비용을 합치되 이중 계산하지 않는다.
3. 최소 두 workload 시나리오의 월 비용을 도구로 계산한다.
4. latency·session·tool 호출 성능을 조건부로 설명하고 독립 측정 부재를 명시한다.
5. 기존 AWS Commerce AI와 agent governance 글에 내부 링크를 사용해 반복을 줄인다.
6. strict citation 및 whitespace 검사를 실행한다.

### Task 7: MCP ToolHub 딥다이브 작성

**Objective:** MCP ToolHub의 로컬 실행·외부 승인·재생 방지 계약을 설치부터 실패 모드까지 검증한다.

**Files:**
- Create: `_posts/2026-10-17-mcp-toolhub-approval-execution-boundary.md`

**Steps:**
1. authoritative repository, release/tag, package metadata와 LICENSE를 확인한다.
2. stdio-only surface, workspace confinement, read-only Git과 shell 분류를 검증한다.
3. human-only approval, immutable·expiring·single-use request와 replay rejection을 상태 전이로 설명한다.
4. process-tree containment, audit bounds·redaction, Windows/POSIX 차이를 검토한다.
5. 기존 MCP governance·shadow traffic·delayed poisoning·sandbox 글과 겹치지 않게 execution contract를 중심 논지로 유지한다.
6. strict citation 및 whitespace 검사를 실행한다.

### Task 8: 독립 spec·cross-batch review

**Objective:** 12편의 사실·중복·문체 문제를 찾아 Critical/Important 항목을 모두 해소한다.

**Files:**
- Modify: 위 12개 `_posts` 파일
- Modify: `docs/research/2026-10-17-weekly-ai-dev-posts-source-map.md`

**Steps:**
1. 각 글을 source map과 공식 자료에 대조한다.
2. title·description·결론의 권한 경계를 검사한다.
3. 공통 도입부·표·보안 체크리스트·결론 중복을 제거한다.
4. 수정 후 별도 reviewer가 bounded re-review한다.

### Task 9: Korean humanizer pilot와 부분 채택

**Objective:** 보호 구간을 유지하면서 대표 글의 번역투만 보수적으로 개선한다.

**Files:**
- Candidate only: Codex skill workspace의 `final.md`
- Modify when accepted: 대표 `_posts` 파일 1개

**Steps:**
1. 원문을 덮어쓰지 않고 `$humanize-korean` 보수 모드 candidate를 만든다.
2. protected-span checker를 실행한다.
3. modality·인과·귀속·범위를 문장 단위로 검토한다.
4. 더 자연스러워진 문장만 부분 채택한다.
5. citation·structure 검사를 다시 실행한다.

### Task 10: 통합 release gate

**Objective:** 최종 12편이 동일 revision의 안전한 정적 artifact에 포함되는지 증명한다.

**Files:**
- Verify: `_site-docker/blog/*.html`

**Steps:**
1. 12개 source 파일과 12개 expected route를 프로그램으로 대조한다.
2. citation 순서·Sources URL·배너 크기·credential 패턴을 검사한다.
3. Community test 590개, typecheck, lint, Vite build를 실행한다.
4. `./scripts/build-site-docker.sh _site-docker`를 실행한다.
5. `node scripts/verify-site.mjs _site-docker`를 실행한다.
6. 생성 HTML 12개와 대표 기존 페이지를 검사한다.

### Task 11: Commit, push, PR

**Objective:** 검증된 정확한 revision을 feature branch와 PR로 전달한다.

**Files:**
- Create: PR body artifact outside repository

**Steps:**
1. 검토된 14개 파일만 명시적으로 stage한다.
2. `git diff --cached --check` 후 repo-local author로 commit한다.
3. commit 후 revision-derived Docker build와 verifier를 다시 실행한다.
4. 활성 계정·push 권한·중복 branch/PR을 재확인한다.
5. feature branch를 1회 push하고 local/remote/API SHA를 대조한다.
6. PR을 1회 생성하고 base/head/SHA/state/body를 read-back한다.
7. GitHub Checks 부재를 성공으로 표현하지 않는다.
8. merge·`master` push·Pages 배포는 수행하지 않는다.
