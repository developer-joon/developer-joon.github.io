# 2026-10-22 기술·사회 이슈 콘텐츠 배치 source map

- 기준 시각: 2026-10-22 13:15 KST
- 기준 revision: `origin/master` `561029021a1376f0a1bd03abf30f037e0495b06a`
- 사용자 승인 범위: 앞서 제안한 기술 주제 6개 전체, 사회 이슈 3개, 기업 복지·문화 Community 초안 1개
- 산출물 계약: 신규 블로그 포스트 8편, 기존 동일 포스트 1편 유지, Community 검토용 초안 1편
- 게시 경계: feature branch까지만 준비한다. Community에는 게시하지 않으며, master merge와 Pages 배포도 하지 않는다.

## 배치 인벤토리

### 1. PHP2Shell 긴급 대응

- 경로: `_posts/2026-10-22-php2shell-runtime-worker-patch-verification.md`
- 제목: `PHP2Shell 긴급 대응: 패치 설치보다 실행 중 worker 교체를 먼저 증명하라`
- 검색 의도: PHP CVE-2026-109618·109619 fixed version과 실제 FPM·Apache·container runtime 교체 검증
- 상태: 2026-10-21 security release. PHP 8.2.35, 8.3.36, 8.4.27, 8.5.12에서 수정.
- 주요 출처: PHP GHSA 2건, PHP release, CISA, CERT-EU
- 가까운 기존 글: Cisco Email Gateway exposure runbook, Kubernetes CVE response
- 반복 금지: 범용 inventory→patch→verify 체크리스트와 exploit 재현
- 고유 논지: CLI 버전이 아니라 SAPI·persistent worker·container digest와 old replica 0을 read-back한다.
- 경계: 구성 완화는 완전한 수정이 아니며, 공개 PoC와 실제 침해 확인을 구분한다.

### 2. GitHub Actions workflow lockfile

- 기존 경로: `_posts/2026-10-17-github-actions-workflow-lockfile.md`
- 기존 제목: `GitHub Actions lockfile 공개 프리뷰: 태그를 믿지 않고 전이 의존성까지 고정하는 법`
- 판정: 사용자가 요청한 주제는 이미 moved-tag fixture, transitive action, reusable workflow, stale lock, Dependabot, preview 경계까지 동일하게 발행돼 있다.
- 처리: 중복 포스트를 새로 만들지 않고 기존 글을 배치의 충족 항목으로 유지한다. 2026-10-22 현재 공식 계약을 바꾸는 새 사실이 확인되지 않아 무의미한 날짜 갱신도 하지 않는다.

### 3. Node.js 10월 보안 업데이트

- 경로: `_posts/2026-10-22-nodejs-october-security-runtime-verification.md`
- 제목: `Node.js 10월 보안 업데이트: 22·24·26 런타임을 같은 패치로 보면 안 되는 이유`
- 검색 의도: Node 22.23.4·24.22.1·26.12.1 branch별 보안 수정과 실제 실행 binary 교체 검증
- 주요 출처: Node security advisory와 세 release page, Release WG schedule
- 가까운 기존 글: Node Fetch migration, Kubernetes CVE response, Docker hardened images
- 반복 금지: Node LTS 일반론, Axios→Fetch, generic image scan
- 고유 논지: 동일 inert regression fixture를 세 line에 적용하고 bundled dependency 차이와 long-lived worker를 확인한다.
- 경계: 최고 severity는 High이며 line별 CVE·dependency update 범위가 다르다.

### 4. PostgreSQL 19 업그레이드 리허설

- 경로: `_posts/2026-10-22-postgresql-19-rc-upgrade-rehearsal.md`
- 제목: `PostgreSQL 19 RC1 업그레이드 리허설: GA 전에 실패 지점을 찾는 법`
- 검색 의도: pg_upgrade --check, extension ABI, cutover·rollback clock 검증
- 상태: RC1이며 GA 예정일은 2026-11-19. Production GA가 아니다.
- 주요 출처: PostgreSQL RC1 announcement, release 19 notes, pg_upgrade·upgrading docs, beta page
- 가까운 기존 글: Kubernetes self-healing upgrade
- 반복 금지: 신기능 나열, 일반 백업 권고, RC benchmark의 GA 일반화
- 고유 논지: RC1→RC2→GA마다 같은 preflight artifact를 반복해 blocker diff를 남긴다.

### 5. npm 공급망과 GitHub package firewall

- 경로: `_posts/2026-10-22-github-package-firewall-npm-supply-chain.md`
- 제목: `npm install 전에 막는 GitHub Package Firewall: 정책보다 요청 경로를 먼저 검증하라`
- 검색 의도: npm install-time malware gate, cooldown, attestation downgrade, direct-registry bypass
- 상태: 2026-10-20 public preview, GHEC 대상, 현재 npm만 지원, preview 이후 과금 가능
- 주요 출처: GitHub announcement·docs, GitHub Advisory Database, Microsoft npm campaign report
- 가까운 기존 글: Actions lockfile, AOMEI tampering, Docker hardened images, MCP supply chain
- 반복 금지: action SHA pinning, SBOM·image digest, MCP metadata fingerprint
- 고유 논지: 모든 npm 요청이 firewall을 지나는지 access log·egress log·negative fixture로 증명한다.

### 6. React SPA soft navigation 성능 측정

- 경로: `_posts/2026-10-22-react-spa-soft-navigation-rum.md`
- 제목: `React SPA의 LCP는 왜 틀릴까: soft navigation을 navigationId로 다시 측정하기`
- 검색 의도: React Router route event와 Chrome soft-navigation heuristic의 mismatch 측정
- 상태: Chrome 151 기본 제공. CrUX soft-navigation 지표는 experimental이며 stable Search Console 신호가 아니다.
- 주요 출처: Chrome soft-navigation docs, Chrome 151 beta·stable, web.dev SPA FAQ·CrUX announcement, WICG
- 가까운 기존 글: GitHub Issues instant navigation, Next.js 16.2
- 반복 금지: cache·prefetch·service worker 최적화, 일반 CWV 설명
- 고유 논지: browser navigationId와 앱 route hook의 false positive·negative를 분리한다.

### 7. 주 4.5일제 사회 이슈

- 경로: `_posts/2026-10-22-four-and-half-day-workweek-evidence-boundary.md`
- 제목: `주 4.5일제는 생산성을 높였나: 정부 시범사업 사례로 아직 답할 수 없는 것`
- 검색 의도: 워라밸+4.5 프로젝트 참여기업 사례와 정책 인과효과의 차이
- 주요 출처: 고용노동부 2026-10-21 사례 발표, 2026-07-14 참여현황
- 가까운 기존 글: 직접 중복 없음. 설문 해석 글의 분모·인과 경계와 방법론만 인접.
- 반복 금지: 사례를 전국 효과로 일반화, 지원금·자동화·신규채용 효과를 노동시간 단축 효과로 합산
- 고유 논지: 노동시간, 임금, 생산량, 업무강도, 비공식 초과근무, 지원 종료 후 지속성을 분리한다.

### 8. 플랫폼 노동 기본법 사회 이슈

- 경로: `_posts/2026-10-22-platform-workers-basic-rights-bill.md`
- 제목: `플랫폼 노동자를 근로자로 만들지 않고도 보호할 수 있을까`
- 검색 의도: 일하는 사람 기본법안의 최소권리와 근로기준법상 근로자성 차이
- 주요 출처: 고용노동부 2026-10-15 간담회, 법안 제2220160호, 근로복지공단 산재보험 적용범위
- 가까운 기존 글: 직접 중복 없음.
- 반복 금지: 발의안을 시행법처럼 표현, 특정 조사 비율을 전국 프리랜서로 일반화
- 고유 논지: 서면계약·보수·휴식·안전·분쟁구제와 근로자성·보험 적용을 별도 축으로 읽는다.

### 9. 휴대전화 안면인증과 생체정보 사회 이슈

- 경로: `_posts/2026-10-22-mobile-signup-face-auth-privacy.md`
- 제목: `휴대전화 개통 때 얼굴을 보여줘야 하나: 보이스피싱 방지와 생체정보의 경계`
- 검색 의도: 휴대전화 개통 안면인증의 법적 근거·대체수단·보관 최소화·효과 측정
- 주요 출처: 개인정보위 2026-10-01 국민토론회, 2026-05-28 개선권고, 2026-08-05 제도혁신 논의
- 가까운 기존 글: 직접 중복 없음. AI 규제·privacy 글의 일반 원칙만 인접.
- 반복 금지: 전 국민 얼굴 DB, 유출 확인, 전면 금지라고 과장
- 고유 논지: 목적 정당성, 필요성, 비례성, 데이터 최소화와 탐지율·오탐률·우회율을 별도로 요구한다.

### 10. 기업 복지·문화 Community 검토용 초안

- 경로: `docs/community-drafts/2026-10-22-corporate-benefits-culture.md`
- 제목: `복지보다 오래 남는 조직문화는 무엇이었나요?`
- 태그: `자유 이야기` (`free-talk`)
- 계약: title 2–120자, body 1–50,000자, tag 1–3개. Category field는 없다.
- 공개 경계: 검토용 초안만 저장하고 Community API·Supabase에는 쓰지 않는다.
- 안전 경계: 회사명·부서·지역·급여·건강·가족사·개별 분쟁 등 재식별·민감정보를 요청하지 않는다.

## 검증 계약

1. 신규 `_posts` 수는 정확히 8개다.
2. 기존 lockfile 글은 수정하지 않는다.
3. Community 초안은 정확히 1개이며 외부 게시하지 않는다.
4. 각 포스트의 inline citation first-seen과 Sources는 연속 `1..N`이어야 한다.
5. 고정 seed Picsum banner를 사용하고 front matter와 첫 본문 이미지 URL을 일치시킨다.
6. Critical·Important 독립 검토를 모두 수정한 뒤 통합 Docker/Jekyll build를 한 번 실행한다.
7. 검증된 feature branch만 push한다. PR, merge, master push, Pages 배포는 하지 않는다.
