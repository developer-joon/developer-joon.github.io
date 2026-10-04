# 커뮤니티 홈 간소화 및 태그 조회 수정 구현 계획

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 커뮤니티 홈을 자유게시판 목록 중심으로 간소화하고 운영 태그 5개가 정상 표시되게 한다.

**Architecture:** 홈 컴포넌트의 소개용 히어로를 단일 H1로 축소하고 기존 검색·필터·목록 데이터 흐름은 유지한다. 태그 오류는 PostgreSQL `uuid`가 허용하는 canonical 문자열과 클라이언트의 과도한 RFC version/variant 검증 불일치를 바로잡는다.

**Tech Stack:** React 19, TypeScript, Vitest, CSS, Vite, Jekyll, GitHub Pages

---

### Task 1: 운영 태그 ID 응답 계약 수정 확인

**Objective:** 운영에 저장된 고정 tag UUID를 유효한 PostgreSQL UUID 응답으로 수용한다.

**Files:**
- Modify: `community-app/src/data/communityRepository.ts:170`
- Test: `community-app/src/data/communityRepository.test.ts:274-307`

**Step 1: 실패 테스트 작성**

`listTags()` fixture에 운영 첫 태그 ID `a1000000-0000-0000-0000-000000000001`을 사용하고 성공 응답을 기대한다.

**Step 2: RED 확인**

Run: `npm test -- --run src/data/communityRepository.test.ts -t "maps the active tag projection"`
Expected: `INVALID_RESPONSE`로 실패.

**Step 3: 최소 구현**

UUID 검증을 PostgreSQL canonical UUID 문법인 `8-4-4-4-12` hexadecimal 형식으로 바꾸되 임의 문자열, 추가 키, 잘못된 tag 필드는 계속 거부한다.

**Step 4: GREEN 확인**

Run: `npm test -- --run src/data/communityRepository.test.ts -t "maps the active tag projection|rejects malformed active tag rows"`
Expected: 4 tests pass.

**Step 5: 커밋**

이미 완료된 커밋 `591b60a`를 유지한다.

### Task 2: 커뮤니티 홈을 자유게시판 제목으로 축소

**Objective:** 모바일 첫 화면에서 불필요한 소개 문구와 중복 CTA를 제거한다.

**Files:**
- Modify: `community-app/src/pages/CommunityHomePage.tsx:246-257`
- Modify: `community-app/src/styles/community.css`
- Test: `community-app/src/pages/CommunityHomePage.test.tsx:51-59`

**Step 1: 실패 테스트 작성**

다음을 검증한다.

```tsx
expect(screen.getByRole('heading', { level: 1, name: '자유게시판' })).toBeInTheDocument()
expect(screen.queryByText('COMMUNITY · 공개 개발 기록')).not.toBeInTheDocument()
expect(screen.queryByText(/질문보다 오래 남는 경험/)).not.toBeInTheDocument()
expect(screen.getAllByRole('link', { name: '글쓰기' })).toHaveLength(1)
```

**Step 2: RED 확인**

Run: `npm test -- --run src/pages/CommunityHomePage.test.tsx -t "lets anonymous visitors"`
Expected: 기존 제목과 중복 링크 때문에 실패.

**Step 3: 최소 구현**

`community-hero` 안에는 `<h1 id="community-heading">자유게시판</h1>`만 남긴다. 키커, 설명 wrapper, 설명문과 본문 CTA를 삭제한다. CSS의 grid·절대 배치·과도한 하단 여백을 단일 제목에 맞는 간결한 padding으로 변경한다.

**Step 4: GREEN 확인**

Run: `npm test -- --run src/pages/CommunityHomePage.test.tsx`
Expected: 모든 홈 테스트 통과.

**Step 5: 커밋**

```bash
git add community-app/src/pages/CommunityHomePage.tsx community-app/src/pages/CommunityHomePage.test.tsx community-app/src/styles/community.css
git commit -m "fix: simplify community board heading"
```

### Task 3: 전체 검증 및 운영 배포

**Objective:** UI와 태그 수정이 실제 production artifact와 운영 경로에서 동작함을 증명한다.

**Files:**
- Verify only: repository and generated artifact

**Step 1: 전체 정적 검증**

Run:

```bash
cd community-app
npm run check
npm run build
cd ..
node --test scripts/*.test.mjs
git diff --check
```

Expected: 전체 앱 테스트, scripts 테스트, typecheck, lint, build 모두 통과.

**Step 2: Docker artifact 검증**

Run: `./scripts/build-site-docker.sh "$TMPDIR/release-<sha>-site"`
Run: `node scripts/verify-site.mjs "$TMPDIR/release-<sha>-site"`
Expected: 538 files, no symlinks, verifier pass.

**Step 3: GitHub 안전 확인 후 배포**

활성 계정, public repository, anonymous HTTP 200, remote fast-forward 상태를 확인한 뒤 `HEAD:master`를 한 번만 push한다.

**Step 4: 운영 확인**

Pages workflow 성공과 배포 SHA를 확인한다. Lightpanda로 `/community/`를 열어 다음을 확인한다.

- H1 `자유게시판`
- 제거 문구 부재
- 글쓰기 링크 1개
- 태그 `AI·Agent`, `개발`, `인프라·클라우드`, `사이드 프로젝트`, `자유 이야기`
- 태그 오류 alert 부재
