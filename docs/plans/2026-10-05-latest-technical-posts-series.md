# 최신 기술 뉴스 포스팅 10편 구현 계획

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 최근 공식 발표와 사고 보고서에 근거하고 기존 글과 중복되지 않는 게시 가능 Jekyll 원고 10편을 작성하고 로컬에서 검증한다.

**Architecture:** 각 원고를 독립된 research→draft→citation review 단위로 작성하되 공통 front matter와 인용 계약을 따른다. 초안 작성은 독립적으로 병렬화하고, 통합 단계에서 중복·문체·인용·Jekyll 렌더링을 한 번 더 검증한다. 커밋·push·PR·배포는 수행하지 않는다.

**Tech Stack:** Jekyll, Markdown/Kramdown, Ruby/Bundler, Docker 정적 빌드, Python 기반 citation ledger, Codex `$humanize-korean`

---

### Task 1: 기존 글 중복 지도와 출처 묶음 확정

**Objective:** 각 신규 글의 검색 의도와 기존 글의 경계를 기계적으로 기록한다.

**Files:**
- Create: `docs/research/2026-10-05-latest-posts-source-map.md`
- Read: `_posts/*.md`

**Steps:**
1. 전체 기존 글의 title, description, tags, headings를 추출한다.
2. 신규 주제별 겹치는 기존 글과 금지할 반복 논점을 기록한다.
3. 공식 출처 URL, 게시일, source class, 글에서 사용할 주장 범위를 기록한다.
4. 누락되거나 원문을 추출할 수 없는 핵심 출처가 있으면 대체 공식 출처를 확보한다.
5. `TBD`, 출처 없는 수치, 검색 snippet 의존 항목이 없는지 검사한다.

### Task 2: AI 에이전트 비인가 행동 사고 비교 글

**Objective:** OpenAI·Hugging Face와 AISI 사고를 과장 없이 비교한다.

**Files:**
- Create: `_posts/2026-10-05-ai-agent-unsanctioned-cyber-incident-control-failures.md`

**Steps:**
1. 두 공식 사고 보고서에서 timeline, 환경, 권한, 비인가 행동, 피해 여부, 대응을 추출한다.
2. “탈출”, “해킹 성공”, “실제 피해” 같은 표현의 증거 수준을 분리한다.
3. 평가 환경 설계와 인간 검토 실패를 중심으로 4,000~7,000자 초안을 작성한다.
4. 인용과 Sources를 검증하고 기존 AI 보안 글과 중복되는 일반론을 제거한다.

### Task 3: Codex Security 취약점 검증 파이프라인 글

**Objective:** AI 취약점 발견과 exploitability 검증 사이의 운영 파이프라인을 설명한다.

**Files:**
- Create: `_posts/2026-10-05-codex-security-vulnerability-validation-pipeline.md`

**Steps:**
1. 공식 research preview 범위, 입력, 결과, 제한을 확인한다.
2. candidate→reproduction→impact→priority→disclosure 단계로 글을 구성한다.
3. 공급자 주장과 독립 운영 권고를 구분한다.
4. 기존 AI agent security 글과 중복되는 sandbox 일반론은 제외한다.

### Task 4: Copilot Computer Use 데스크톱 보안 글

**Objective:** GUI 자동화가 추가하는 OS 권한과 승인 수명 문제를 분석한다.

**Files:**
- Create: `_posts/2026-10-05-github-copilot-computer-use-desktop-security.md`

**Steps:**
1. 지원 OS, preview 상태, 제어 가능한 동작, 승인·관리 설정을 확인한다.
2. 접근성, 화면 녹화, clipboard, 입력, 항상 허용 앱의 실패 모드를 구분한다.
3. 최소 권한 활성화와 해제 검증 절차를 작성한다.
4. 기존 shell sandbox 글과 겹치는 설명을 제거한다.

### Task 5: Copilot Code Review API 품질 게이트 글

**Objective:** AI 리뷰 API를 CI에 연결할 때의 검증·승인 경계를 설계한다.

**Files:**
- Create: `_posts/2026-10-05-copilot-code-review-api-quality-gate.md`

**Steps:**
1. API와 effort 기본값의 공식 범위를 확인한다.
2. review 요청, 결과 수집, 결정적 검사, 사람 승인, branch protection 순서를 설계한다.
3. false positive, stale diff, 대형 PR, 보안 변경 실패 모드를 포함한다.
4. AI 리뷰가 테스트나 승인자를 대체한다는 표현을 금지한다.

### Task 6: AI 생성 취약점 신고 품질 글

**Objective:** Structured Private Vulnerability Reports를 재현 가능한 보안 신고 계약으로 해석한다.

**Files:**
- Create: `_posts/2026-10-05-ai-generated-vulnerability-report-quality-gate.md`

**Steps:**
1. required fields, PoC 최소 길이, CWE, `SECURITY.md`, AI 사용 공개, API 동작을 확인한다.
2. triage 가능한 입력과 자동 생성된 저품질 신고를 구분하는 기준을 작성한다.
3. 공개 전 재현, 영향 확인, 중복 탐지, 민감정보 제거 절차를 포함한다.
4. 제품 기능과 조직의 추가 정책을 구분한다.

### Task 7: Agentic Web 글

**Objective:** 사람과 agent를 동시에 상대하는 웹 운영 모델을 설명한다.

**Files:**
- Create: `_posts/2026-10-05-agentic-web-bot-identity-content-economy.md`

**Steps:**
1. Cloudflare의 traffic 수치와 제품·표준 설명을 vendor-reported로 분류한다.
2. search, training, agent traffic의 목적 차이를 설명한다.
3. Web Bot Auth, crawler policy, Markdown for Agents, WebMCP, 결제 모델의 경계를 정리한다.
4. breadlab.ai에 적용 가능한 최소 정책을 운영 해석으로 별도 제시한다.

### Task 8: Docker Sandbox Kit Spec v3 글

**Objective:** 에이전트 권한 요구를 OCI artifact로 선언·검토하는 방식을 분석한다.

**Files:**
- Create: `_posts/2026-10-05-docker-sandbox-kit-authority-as-code.md`

**Steps:**
1. workload, mixin, descriptor, capability, conformance의 공식 의미를 확인한다.
2. network·credential 예제를 인용 범위 안에서 설명한다.
3. 선언, host decision, runtime enforcement를 분리한다.
4. inert annotation, digest 신뢰, 구성 충돌, 권한 회수 실패를 다룬다.

### Task 9: Kubernetes 1.37 Memory QoS 글

**Objective:** Beta 기본 활성화와 실제 memory 정책 적용을 구분한다.

**Files:**
- Create: `_posts/2026-10-05-kubernetes-137-memory-qos-beta.md`

**Steps:**
1. `MemoryQoS`, `memoryThrottlingFactor`, `memoryReservationPolicy` 기본값을 확인한다.
2. cgroup v2 전제, upgrade path, stale 설정 reset, node-wide limitation을 설명한다.
3. 적용 전후 확인 명령과 rollback 절차를 작성하되 실행 결과를 꾸미지 않는다.
4. 기존 Kubernetes 1.37 글과 내용이 겹치지 않는지 확인한다.

### Task 10: Kubernetes 1.37 PVC last-used 글

**Objective:** last-used 신호를 안전한 PVC 회수 workflow로 연결한다.

**Files:**
- Create: `_posts/2026-10-05-kubernetes-137-pvc-last-used-tracking.md`

**Steps:**
1. feature 상태, timestamp 의미, 업데이트 조건, 제한을 확인한다.
2. 후보 탐색→owner 확인→backup→dry run→삭제→복구 검증 workflow를 작성한다.
3. StatefulSet, retained PVC, offline workload, DR 보존 실패 모드를 포함한다.
4. timestamp를 자동 삭제 허가로 표현하지 않는다.

### Task 11: Kubernetes 1.37 HPA scale-to-zero 글

**Objective:** 0 replica 확장의 metric 계약과 장애 동작을 분석한다.

**Files:**
- Create: `_posts/2026-10-05-kubernetes-137-hpa-scale-to-zero.md`

**Steps:**
1. feature 상태, metric 조건, 최소 replica 의미를 공식 문서에서 확인한다.
2. scale-down, wake-up, metric outage, cold start, flapping을 구분한다.
3. production rollout, SLO, fallback, rollback 체크리스트를 작성한다.
4. 비용 절감률을 근거 없이 제시하지 않는다.

### Task 12: 교차 편집과 Codex humanize-korean pilot

**Objective:** 의미를 보존하면서 번역투와 반복 문구를 줄인다.

**Files:**
- Modify: 신규 `_posts/2026-10-05-*.md` 10개
- Use: `research/grounded-technical-publishing/scripts/verify_humanizer_protected_spans.py`

**Steps:**
1. 제목, 도입, 결론, 체크리스트의 10편 간 중복을 탐지한다.
2. 대표 원고 한 편의 prose-only candidate에 `$humanize-korean` 보수 모드를 적용한다.
3. 보호 구간 검사와 문장별 의미 검토를 통과한 변경만 부분 채택한다.
4. pilot가 안전하면 나머지 원고에 같은 절차를 적용하고, 실패하면 원문을 유지한다.
5. 모든 편에서 과장, 일률적인 문장 리듬, 공급자 홍보 문구를 제거한다.

### Task 13: 인용·렌더링·보안 최종 검증

**Objective:** 10편의 source와 생성 HTML이 실제 게시 가능한 상태인지 증명한다.

**Files:**
- Verify: 신규 Markdown 10개
- Generate: Docker/Jekyll artifact directory

**Steps:**
1. 인용 ledger와 Sources 블록을 strict 모드로 검증한다.
2. 각 source-bearing 문장의 entailment, 날짜, 상태, normative strength를 검토한다.
3. front matter, 파일명, slug, 제목, description, tags, 내부 링크 중복을 검사한다.
4. 민감정보·credential pattern·내부 전용 값이 없는지 검사한다.
5. 프로젝트의 `scripts/build-site-docker.sh`로 최신 작업 트리 artifact를 만든다.
6. `scripts/verify-site.mjs`로 artifact를 검증한다.
7. 10개 생성 HTML에서 title, 본문, `Sources`를 확인한다.
8. `git diff --check`와 `git status --short`로 변경 범위를 확인한다.
9. 커밋·push·PR·배포가 없음을 확인하고 Markdown·HTML·검증 결과를 분리해 보고한다.
