# Revenue Experiment Status Refresh Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 코인 자동매매 종료·포지션 정리와 신규 수익모델 연구 상태를 사이트의 모든 현재형 화면에 일관되게 반영한다.

**Architecture:** 과거 포스트는 역사적 기록으로 유지하고, 메인·수익실험실·About·프로젝트 페이지처럼 현재 상태를 나타내는 표면만 수정한다. 최종 정산값이 없으므로 자산 대시보드를 상태 대시보드로 바꾸고, 과거 금액은 날짜가 붙은 스냅샷으로 격리한다.

**Tech Stack:** Jekyll, Liquid, Markdown, HTML, Docker `jekyll/jekyll:4.2.0`

---

### Task 1: 현재 상태 검증 스크립트 준비

**Objective:** 구현 전후에 남은 오래된 현재형 문구와 필수 신규 문구를 기계적으로 확인한다.

**Files:**
- Create: `/home/bread/.hermes/profiles/conan/cache/validate_revenue_refresh.py`

**Steps:**
1. 대상 현재형 페이지 목록을 정의한다.
2. 금지 문구 `트레이딩봇 LIVE`, `LIVE 운용 중`, `실제 돈 넣고 운용 중`, `v4 LIVE 운영 중`, `101개 포스트`, `16+ 포스트`를 검사한다.
3. 필수 문구 `포지션 정리`, `다른 수익모델`, `실험 종료` 또는 `종료·보류`를 검사한다.
4. 신규 포스트와 후속 링크의 존재를 검사한다.
5. 구현 전 실행해 실패를 확인한다.

### Task 2: 종료·보류 포스트 작성

**Objective:** 자동매매 중단과 포지션 정리의 이유 및 다음 방향을 솔직한 운영 회고로 기록한다.

**Files:**
- Create: `_posts/2026-09-25-crypto-trading-experiment-on-hold.md`

**Steps:**
1. 기존 포스트와 동일한 front matter를 작성한다.
2. 종료 결정, 운영 교훈, 최종 숫자를 단정하지 않는 이유, 다음 수익모델 판단 기준을 작성한다.
3. 투자 조언이 아니라는 고지를 추가한다.
4. deterministic Picsum 이미지를 사용한다.
5. front matter와 필수 섹션을 검사한다.

### Task 3: 메인과 수익실험실 현행화

**Objective:** 첫 화면에서 현재 상태를 오해하지 않도록 상태 중심 정보 구조로 바꾼다.

**Files:**
- Modify: `index.html`
- Modify: `_pages/lab.md`

**Steps:**
1. 메인 SEO 설명과 소개를 수익모델 검증 중심으로 수정한다.
2. 트레이딩 카드를 종료·보류 상태로 바꾼다.
3. 로또 카드를 과거 자동화 실험으로 바꾼다.
4. 다음 수익모델 연구 카드를 추가한다.
5. 수익실험실의 현재 총액·목표 프로그레스 UI를 상태 대시보드로 교체한다.
6. 공개 금액은 날짜가 있는 과거 스냅샷 표로 이동한다.
7. 블로그 포스트 수를 Liquid 동적 값으로 바꾼다.
8. 자동 업데이트 주장을 검증 후 업데이트 원칙으로 교체한다.

### Task 4: About 및 프로젝트 상세 정합성 수정

**Objective:** 직접 URL과 검색엔진을 통해 접근하는 상세 페이지에서도 현재 상태가 일치하게 한다.

**Files:**
- Modify: `_pages/about.md`
- Modify: `_projects/2026-01-trading-bot.md`
- Modify: `_projects/2026-02-tech-blog.md`
- Modify: `_projects/2026-03-ai-agent.md`
- Modify: `_projects/2026-04-lotto-analyzer.md`
- Modify: `_posts/2026-05-24-trading-bot-v4-long-only-p2-dca-status.md`

**Steps:**
1. About의 실거래 현재형을 과거 실험과 현재 연구 방향으로 바꾼다.
2. 트레이딩 프로젝트를 실전 운영 종료 상태로 재작성한다.
3. 블로그 프로젝트의 고정 포스트 수와 오래된 로드맵을 현행화한다.
4. AI 에이전트 프로젝트의 트레이딩 감시 크론 현재형을 제거한다.
5. 로또 프로젝트의 자동 운영·1회 누적 수치를 역사적 실험 기록으로 바꾼다.
6. 5월 트레이딩 현황 글 상단에 종료 글 링크를 추가한다.

### Task 5: 콘텐츠 및 Jekyll 검증

**Objective:** 내용 정합성, 빌드, 생성 HTML 및 링크를 검증한다.

**Files:**
- Test: `/home/bread/.hermes/profiles/conan/cache/validate_revenue_refresh.py`

**Steps:**
1. 검증 스크립트를 실행해 통과시킨다.
2. `git diff --check`를 실행한다.
3. Docker에서 `bundle exec jekyll build`를 실행한다.
4. `_site/index.html`, `_site/lab/index.html`, 신규 포스트 HTML, 네 프로젝트 HTML을 확인한다.
5. 신규 종료 글 링크가 생성된 경로와 일치하는지 확인한다.
6. 비밀정보 및 placeholder 패턴을 검사한다.

### Task 6: 커밋과 업스트림 브랜치 생성

**Objective:** 검증된 변경을 한 번만 push하고 원격 상태를 읽어 확인한다.

**Files:**
- Commit all scoped files only.

**Steps:**
1. diff와 변경 파일 목록을 재확인한다.
2. 콘텐츠 변경을 `docs: refresh revenue experiment status`로 커밋한다.
3. 활성 GitHub 계정과 push 권한을 재확인한다.
4. `git push -u origin content/2026-09-revenue-experiment-reset`을 실행한다.
5. `git ls-remote`와 GitHub API에서 원격 SHA를 읽는다.
6. 공개 브랜치 URL이 HTTP 200인지 확인한다.
7. PR은 생성하지 않는다.
