# 수익실험실 브랜드 전환 구현 계획

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 공개 사이트의 브랜드성 `0 → 1` 표기를 `수익실험실`로 통일하고 SEO 메타데이터와 1600×900 배너를 교체한다.

**Architecture:** Jekyll front matter와 메뉴 데이터, React 전역 헤더를 같은 한국어 라벨로 맞춘다. 기존 `/lab/` canonical 경로와 일반 문맥의 `0→1`은 유지한다. 정적 계약 테스트와 최종 Docker artifact 검증으로 source와 생성물 양쪽을 확인한다.

**Tech Stack:** Jekyll/Liquid, React 19/TypeScript, Vitest, Node.js 24, Pillow, Docker

---

### Task 1: 공개 브랜드 계약을 RED로 고정

**Objective:** 변경 대상과 변경 금지 대상을 명확히 검사하는 실패 테스트를 만든다.

**Files:**
- Create: `scripts/revenue-lab-branding.test.mjs`
- Modify: `community-app/src/components/AppHeader.test.tsx`

**Step 1: Write failing tests**

- `index.html`, `_pages/lab.md`, `_pages/about.md`, `_data/settings.yml`, React 헤더가 `수익실험실`을 포함해야 한다.
- 위 공개 브랜드 표면에는 `0 → 1`이 없어야 한다.
- `/lab/` permalink는 유지해야 한다.
- 홈과 `/lab/`는 같은 `/images/revenue-lab/cover.png`를 참조해야 한다.
- PNG IHDR은 1600×900이어야 한다.
- React 메뉴 기대값을 `수익실험실`로 변경한다.

**Step 2: Verify RED**

Run:
```bash
node --test scripts/revenue-lab-branding.test.mjs
npm --prefix community-app test -- --run src/components/AppHeader.test.tsx
```

Expected: 기존 라벨과 누락된 배너 때문에 FAIL.

**Step 3: Commit tests**

```bash
git add scripts/revenue-lab-branding.test.mjs community-app/src/components/AppHeader.test.tsx
git commit -m "test: define 수익실험실 brand contract"
```

### Task 2: Jekyll과 React 라벨·SEO 메타데이터 변경

**Objective:** 공개 텍스트와 브라우저/공유 카드 메타데이터를 `수익실험실`로 통일한다.

**Files:**
- Modify: `index.html`
- Modify: `_pages/lab.md`
- Modify: `_pages/about.md`
- Modify: `_data/settings.yml`
- Modify: `community-app/src/components/AppHeader.tsx`

**Step 1: Implement minimal text changes**

- 홈 title/H1을 `수익실험실`로 바꾸고 설명에 `수익실험실` 키워드를 자연스럽게 포함한다.
- `/lab/` title을 `수익실험실`로 바꾸고 permalink는 유지한다.
- About subtitle을 `수익실험실, 코드로 수익모델을 검증하는 실험`으로 바꾼다.
- Jekyll/React 메뉴 라벨을 `수익실험실`로 바꾼다.
- 홈과 `/lab/` 대표 이미지를 `/images/revenue-lab/cover.png`로 맞춘다.

**Step 2: Run focused text tests**

Run:
```bash
npm --prefix community-app test -- --run src/components/AppHeader.test.tsx
```

Expected: React focused test PASS. Banner contract remains RED until Task 3.

**Step 3: Commit**

```bash
git add index.html _pages/lab.md _pages/about.md _data/settings.yml community-app/src/components/AppHeader.tsx
git commit -m "feat: rename revenue section to 수익실험실"
```

### Task 3: 수익실험실 배너 제작

**Objective:** 소셜 공유와 페이지 hero에 쓸 1600×900 로컬 PNG를 만든다.

**Files:**
- Create: `images/revenue-lab/cover.png`

**Step 1: Render the banner**

- 짙은 남색 배경, 노란 포인트, 실험·측정 루프를 나타내는 독창적 추상 그래픽을 사용한다.
- `수익실험실`과 `코드와 자동화로 수익모델을 검증합니다`를 명확히 렌더링한다.
- 한글 폰트를 브라우저 렌더링 단계에서만 불러오고 최종 PNG에는 외부 참조를 남기지 않는다.

**Step 2: Verify GREEN and inspect pixels**

Run:
```bash
node --test scripts/revenue-lab-branding.test.mjs
file images/revenue-lab/cover.png
```

Expected: test PASS, PNG 1600×900.

Use `vision_analyze` to confirm the Korean title/subtitle, contrast, safe margins, and absence of corrupted glyphs.

**Step 3: Commit**

```bash
git add images/revenue-lab/cover.png
git commit -m "feat: add 수익실험실 social banner"
```

### Task 4: 정적 사이트 route 계약 갱신

**Objective:** 생성된 홈페이지와 `/lab/` 제목이 새 브랜드와 일치하도록 release verifier를 갱신한다.

**Files:**
- Modify: `scripts/verify-site.mjs`
- Modify: `scripts/verify-site.test.mjs`
- Modify: `scripts/community-operations-docs.test.mjs`

**Step 1: Change test fixtures first**

홈 제목 기대값을 `Ria & Seoa PaPa – 수익실험실`, `/lab/` 제목 기대값을 `수익실험실 – Ria & Seoa PaPa`로 바꾼다.

**Step 2: Verify RED**

Run:
```bash
node --test scripts/verify-site.test.mjs scripts/community-operations-docs.test.mjs
```

Expected: verifier production route contract가 구 라벨을 요구해 FAIL.

**Step 3: Update verifier contract and verify GREEN**

Run the same command. Expected: PASS.

**Step 4: Commit**

```bash
git add scripts/verify-site.mjs scripts/verify-site.test.mjs scripts/community-operations-docs.test.mjs
git commit -m "test: verify 수익실험실 route metadata"
```

### Task 5: 전체 검증과 feature branch push

**Objective:** 소스, React, 최종 정적 artifact가 모두 동일한 브랜드 계약을 만족하는지 검증한다.

**Files:**
- No planned source changes

**Step 1: Run source and frontend checks**

```bash
node --test scripts/revenue-lab-branding.test.mjs scripts/verify-site.test.mjs scripts/community-operations-docs.test.mjs
npm --prefix community-app run check
npm --prefix community-app run build
```

Expected: all PASS.

**Step 2: Build final site artifact**

```bash
BUILD_TIME="$(git show -s --format=%cI HEAD)"
docker build --target site --build-arg SITE_BUILD_TIME="$BUILD_TIME" -f Dockerfile.build .
```

Expected: Docker `site` target PASS.

**Step 3: Verify generated metadata**

Export or inspect the final artifact and assert:

- `/index.html` title and H1 contain `수익실험실`.
- `/lab/index.html` title, H1, canonical, OG/Twitter metadata are correct.
- `/images/revenue-lab/cover.png` exists and matches the source hash.
- Jekyll and React navigation contain `수익실험실` and not the old brand label.
- `/lab/` remains the canonical path.

**Step 4: Independent review**

Require Critical 0 / Important 0. Fix findings and rerun affected tests plus the final site build.

**Step 5: Push once**

Verify active GitHub account, anonymous repository visibility, write permission, remote branch state, then push only `feat/revenue-lab-branding`. Do not create a PR, merge, or deploy.
