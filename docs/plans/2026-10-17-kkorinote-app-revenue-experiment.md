# 꼬리노트 앱 출시 수익 실험 구현 계획

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 꼬리노트 첫 앱 출시 수익 실험 포스트를 작성하고 메인홈·수익실험실의 현재 상태를 개발 중인 실제 제품 기준으로 갱신한다.

**Architecture:** 외부 시장·플랫폼 사실은 공식 원문과 조사 보고서에서 먼저 검증하고 문서 범위의 citation ledger를 만든다. 포스트는 제품 시작 기록과 수익 가설을 담당하고, 메인홈과 수익실험실은 같은 lifecycle 상태를 짧게 투영한다. 최종 변경은 통합 Docker/Jekyll 빌드와 생성 HTML 검증 후 하나의 feature branch로 전달한다.

**Tech Stack:** Jekyll, Markdown, Liquid, HTML, Python 검증 스크립트, Docker, GitHub CLI

---

### Task 1: 기존 콘텐츠와 현재 상태 조사

**Objective:** 새 글의 중복 경계와 세 화면의 상태 계약을 확정한다.

**Files:**
- Read: `_posts/*.md`
- Read: `index.html`
- Read: `_pages/lab.md`
- Read: `docs/superpowers/specs/2026-10-17-kkorinote-app-revenue-experiment-design.md`

**Steps:**
1. 기존 글 전체에서 앱 출시, 수익모델, 광고, 인앱결제, 반려동물 기록 관련 제목과 본문을 검색한다.
2. 포스트·메인홈·수익실험실에서 공유할 lifecycle 문구를 확정한다.
3. `개발 중`, `Apple Developer 등록 완료`, `App Store 출시 전`, `매출 미검증`이 모순 없이 공존하는지 확인한다.
4. 신규 글의 검색 의도와 기존 글에서 반복하지 않을 논지를 기록한다.

### Task 2: 공식 출처와 사업 가설 검증

**Objective:** Apple 정책, RevenueCat 조사, AI 비용 관련 문장을 인용 가능한 원문으로 검증한다.

**Files:**
- Create: `docs/research/2026-10-17-kkorinote-app-revenue-experiment-sources.md`
- Create: profile scratch의 task-specific citation ledger

**Steps:**
1. Apple App Review Guidelines에서 디지털 기능 인앱결제, 광고, 건강정보 경계를 확인한다.
2. Apple Developer Program과 App Store 제출 단계가 별개임을 공식 문서로 확인한다.
3. Small Business Program 수수료를 언급할 경우 공식 조건과 범위를 확인한다.
4. RevenueCat 2026 보고서에서 카테고리 비교에 사용한 지표·표본·범위를 확인한다.
5. OpenAI 가격을 본문에 사용할 경우 현재 공식 가격표를 확인하고 모델·토큰·환율 가정을 재계산한다.
6. 확인되지 않은 eCPM·전환율은 제거하거나 명시적 가정으로 격리한다.
7. 최종 Sources URL의 HTTP 상태와 canonical URL을 확인한다.

### Task 3: 포스트 작성

**Objective:** 꼬리노트 개발 시작과 수익 검증 계획을 사실 경계가 명확한 장문 포스트로 작성한다.

**Files:**
- Create: `_posts/2026-10-17-kkorinote-first-app-revenue-experiment.md`

**Steps:**
1. 저장소 관례에 맞는 front matter를 작성한다.
2. `featured_image`와 첫 본문 이미지에 `https://picsum.photos/seed/kkorinote-first-app-revenue-experiment/1600/900`을 사용한다.
3. 후보 10개 검토, 꼬리노트 선택 이유, MVP 범위, 무료·광고·IAP 가설, AI 비용 제한, 현재 단계, 검증·중단 기준을 작성한다.
4. 외부 사실 문장마다 `[n]` 인용을 붙인다.
5. 마지막에 연속된 `## Sources`와 `[n] URL` 목록을 둔다.
6. 출시·승인·매출 완료로 오해할 표현이 없는지 검토한다.

### Task 4: 메인홈 상태 갱신

**Objective:** 방문자가 첫 화면에서 꼬리노트가 실제 개발 중인 다음 수익 실험임을 알 수 있게 한다.

**Files:**
- Modify: `index.html`의 “다음 수익모델” 카드

**Steps:**
1. 제목을 `꼬리노트 앱 출시 실험`으로 변경한다.
2. 반려동물 건강·일상 기록 MVP와 무료 다운로드·광고·인앱결제 검증 목적을 짧게 설명한다.
3. 상태를 `개발 중 · Apple Developer 등록 완료`로 표시한다.
4. 신규 포스트로 연결되는 링크를 추가한다.
5. 다른 실험 카드의 상태와 링크가 유지되는지 확인한다.

### Task 5: 수익실험실 상태 갱신

**Objective:** 수익실험실에서 꼬리노트의 완료·미완료 단계와 수익 가설을 투명하게 공개한다.

**Files:**
- Modify: `_pages/lab.md`

**Steps:**
1. 상단 “다음 수익모델” 상태를 `꼬리노트 개발 중`으로 바꾼다.
2. 앱 출시 수익 실험 섹션을 추가한다.
3. 완료·미완료 단계, 무료·광고·IAP 가설, AI 제한, 측정 지표를 구분한다.
4. 신규 포스트 링크를 추가한다.
5. 최근 업데이트 날짜를 `2026-10-17`로 변경한다.
6. 과거 트레이딩 스냅샷과 종료 기록이 변하지 않았는지 diff로 확인한다.

### Task 6: 정적 콘텐츠 계약 검사

**Objective:** 세 화면의 문구, 인용, 배너, 거짓 완료 표현을 기계적으로 검사한다.

**Files:**
- Verify: `_posts/2026-10-17-kkorinote-first-app-revenue-experiment.md`
- Verify: `index.html`
- Verify: `_pages/lab.md`

**Steps:**
1. citation first-seen과 Sources 순서가 동일한 `1..N`인지 검사한다.
2. front matter와 첫 본문 이미지 URL이 같은지 검사한다.
3. Picsum 응답이 HTTP 200이고 1600×900인지 검사한다.
4. 세 파일에 `꼬리노트`, `개발 중`, `Apple Developer 등록 완료`가 필요한 위치에 존재하는지 검사한다.
5. `출시 완료`, `승인 완료`, `매출 발생` 같은 금지 상태 표현이 없는지 검사한다.
6. `git diff --check`를 실행한다.

### Task 7: 독립 사실·편집 검토와 한국어 윤문

**Objective:** 사실 과장과 사업 가설의 혼합을 제거하고 자연스러운 한국어 문장만 채택한다.

**Files:**
- Review: 신규 포스트, `index.html`, `_pages/lab.md`, source dossier

**Steps:**
1. 독립 검토자가 claim-to-source entailment, lifecycle 상태, 건강·광고·IAP 경계를 검토한다.
2. Critical·Important findings를 모두 수정한다.
3. 검토된 파일을 worktree 밖에 snapshot한다.
4. Codex `$humanize-korean`을 보수 모드로 적용한다.
5. front matter, 숫자, 날짜, 인용, URL, inline code가 보존됐는지 검사한다.
6. 의미가 자연스러워진 변경만 유지하고 citation·상태 계약을 재검사한다.

### Task 8: 통합 빌드와 생성 HTML 검증

**Objective:** 최종 소스가 실제 배포 artifact에서 올바르게 렌더링되는지 확인한다.

**Files:**
- Run: `scripts/build-site-docker.sh`
- Inspect: 생성된 `/blog/kkorinote-first-app-revenue-experiment.html`, `/index.html`, `/lab/index.html`

**Steps:**
1. 필요하면 게시 시각 이후의 명시적 timezone timestamp로 pre-commit build를 실행한다.
2. Community tests, typecheck, lint, Vite, Jekyll, artifact verifier 결과를 기록한다.
3. Docker image에서 `_site`를 scratch로 추출한다.
4. 포스트 route의 제목·Sources·배너를 확인한다.
5. 메인홈과 수익실험실에서 상태 문구와 링크를 확인한다.
6. 기존 경고와 새 오류를 분리한다.

### Task 9: 커밋·재빌드·원격 branch 전달

**Objective:** 검증된 변경만 커밋하고 정확한 revision을 원격 feature branch로 전달한다.

**Files:**
- Commit: 설계, 계획, source dossier, 포스트, `index.html`, `_pages/lab.md`

**Steps:**
1. 대상 파일만 명시적으로 stage하고 `git diff --cached --check`를 실행한다.
2. `docs: launch KkoriNote app revenue experiment`로 커밋한다.
3. 커밋 후 기본 revision-derived timestamp로 통합 빌드를 다시 실행한다.
4. 활성 GitHub 계정, push 권한, 저장소 공개 상태, 동일 remote branch와 PR 존재 여부를 확인한다.
5. feature branch를 한 번 push한다.
6. local HEAD, `git ls-remote`, GitHub branch API SHA 일치를 검사한다.
7. anonymous branch API HTTP 200을 확인한다.
8. PR은 생성하지 않고 사용자가 만들 수 있는 compare 링크를 제공한다.
9. merge, `master` push, Pages 배포를 수행하지 않는다.
