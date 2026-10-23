# 2026-10-23 개발·보안·플랫폼 콘텐츠 배치 source map

- 기준 시각: 2026-10-23 08:18 KST
- 기준 revision: `origin/master` `5ab58f7afd5b3ff8e8c53aa80d1ed9f5bed41ac9`
- 사용자 승인 범위: 2026-10-23 제안 목록 10개 전체
- 산출물 계약: 신규 블로그 포스트 정확히 10편과 이 source map 1개
- 게시 경계: 검증된 feature branch만 push한다. PR·merge·master push·Pages 배포는 하지 않는다.
- 공통 계약: 고정 고유 Picsum seed `1600/900`, front matter와 첫 본문 이미지 URL 일치, inline citation과 Sources의 first-seen 순서 `1..N`, 공식 사실·vendor 결과·운영 권고 분리

## 배치 인벤토리

### 1. curl 8.23.0 프로토콜별 노출 우선순위

- 경로: `_posts/2026-10-23-curl-8230-protocol-exposure-prioritization.md`
- 게시 시각: `2026-10-23 09:00:00 +0900`
- 제목: `curl 8.23.0 보안 업데이트: CVE 개수보다 실제 사용 프로토콜을 먼저 찾아라`
- 검색 의도: curl/libcurl 8.23.0 패치 우선순위를 runtime·protocol·TLS backend별로 결정하는 방법
- 상태·주요 출처: curl 8.23.0 release table, curl 공식 CVE 목록과 개별 advisory
- 가까운 기존 글: Kubernetes 2026년 9월 CVE 대응, PHP2Shell worker 교체 검증
- 반복 금지: 범용 CVE inventory→patch 체크리스트, exploit payload
- 고유 논지: 버전만 세지 않고 HTTP/2 upload, WebSocket, Schannel/GnuTLS, 다중 protocol 사용 여부를 read-only evidence로 분리한다.
- 경계: advisory별 affected range와 조건은 서로 다르며 CVE 총개수를 위험도나 exploit 가능성으로 일반화하지 않는다.

### 2. Go 1.27 HTTP/1 연결 재사용

- 경로: `_posts/2026-10-23-go-127-http1-connection-reuse.md`
- 게시 시각: `2026-10-23 09:00:02 +0900`
- 제목: `Go 1.27 HTTP/1 연결 재사용: 응답 본문을 읽지 않아도 되는가`
- 검색 의도: Go 1.26과 1.27의 response body 처리·connection reuse 차이를 안전하게 측정
- 상태·주요 출처: Go 공식 2026-10-14 HTTP/1 connection reuse 글, Go 1.27 release notes·net/http 문서
- 가까운 기존 글: Node.js Fetch migration, 성능 테스트 개념
- 반복 금지: 일반 HTTP keep-alive 설명, vendor 수치를 보편적 5배로 일반화
- 고유 논지: 동일 local fixture에서 connection count·handshake·latency를 비교하고 correctness와 optimization을 분리한다.
- 경계: 공식 수치는 작성자 환경의 예시이며 모든 workload의 배수 개선을 뜻하지 않는다.

### 3. dotnetup toolchain manager 공개 미리보기

- 경로: `_posts/2026-10-23-dotnetup-toolchain-manager-preview.md`
- 게시 시각: `2026-10-23 09:00:04 +0900`
- 제목: `dotnetup 공개 미리보기: nvm·rustup처럼 .NET SDK를 관리해도 될까`
- 검색 의도: 기존 apt·brew·dotnet-install.sh 환경에서 dotnetup으로 전환·복구하는 기준
- 상태·주요 출처: Microsoft .NET Blog announcement, `dotnet/sdk` 저장소의 `release/dnup` 계열 문서·README·license
- 가까운 기존 글: 직접 중복 없음
- 반복 금지: 단순 설치 명령 나열, preview를 GA처럼 표현
- 고유 논지: user-local install, global.json, side-by-side SDK, PATH precedence, uninstall·rollback을 검증한다.
- 경계: public preview이며 platform 지원과 command 계약은 현재 문서 범위로 한정한다.

### 4. GitHub AI Scan과 merge gate 분리

- 경로: `_posts/2026-10-23-github-ai-scan-advisory-merge-gate.md`
- 게시 시각: `2026-10-23 09:00:06 +0900`
- 제목: `GitHub AI Scan은 GA인데 왜 PR을 막지 못할까: advisory와 merge gate 분리`
- 검색 의도: GitHub AI Scan·CodeQL·ruleset의 결과와 차단 가능 범위 구분
- 상태·주요 출처: GitHub 2026-10-15 GA announcement, AI-powered security detection 문서와 billing 문서
- 가까운 기존 글: AI secret detection push gate, Copilot Code Review API quality gate
- 반복 금지: 일반 AI 보안 정확도 논쟁, Copilot quota 설명
- 고유 논지: deterministic blocking signal과 advisory signal을 별도 state로 보존하고 수동 승인·예산·fork/Dependabot 공백을 다룬다.
- 경계: AI Scan finding은 advisory이며 ruleset merge block이 아니고 적용·과금 범위도 plan별로 다르다.

### 5. GitHub 오픈소스 라이선스 compliance 예외 lifecycle

- 경로: `_posts/2026-10-23-github-license-compliance-exception-lifecycle.md`
- 게시 시각: `2026-10-23 09:00:08 +0900`
- 제목: `오픈소스 라이선스를 merge gate로 만들 때 예외 만료가 더 중요한 이유`
- 검색 의도: GitHub license compliance 예외의 만료 scheduler·동시 갱신·멱등 제거·재차단 receipt 운영
- 상태·주요 출처: GitHub 2026-10-16 GA announcement와 공식 dependency graph/license compliance 문서
- 가까운 기존 글: `2026-10-17-github-license-compliance-merge-gate.md`가 GA 범위·ruleset·예외 scope·audit·merge 직전 read-back을 다룬 선행 글
- 반복 금지: GA 기능 소개, ruleset 일반론, 예외 scope 설명, audit/read-back 일반론, 라이선스 종류 개론, SBOM 일반론
- 고유 논지: `detected → blocked → exception_requested → approved_until → expired → blocked_again`을 조직 운영 상태로 설계한다.
- 경계: 내부 상태명은 GitHub protocol field가 아닌 이 글의 운영 제안이며 법률 자문이 아니다.

### 6. Dependabot withdrawn alert의 410 Gone

- 경로: `_posts/2026-10-23-dependabot-withdrawn-alert-410-gone.md`
- 게시 시각: `2026-10-23 09:00:10 +0900`
- 제목: `Dependabot 경고의 404와 410 Gone은 왜 다른가`
- 검색 의도: withdrawn alert를 보안 데이터 lake·ticket sync에서 정확히 보존하는 방법
- 상태·주요 출처: GitHub 2026-10-13 changelog, Dependabot alert REST·webhook 문서
- 가까운 기존 글: Dependabot anonymous registry egress
- 반복 금지: registry 인증·egress 설명, 일반 REST status code 개론
- 고유 논지: `open/resolved/dismissed/withdrawn/missing`을 분리하고 webhook/API race와 tombstone 보존을 검증한다.
- 경계: `410`은 withdrawn alert 조회·수정 계약이며 모든 GitHub resource 삭제 의미로 일반화하지 않는다.

### 7. request-response 상관 WAF

- 경로: `_posts/2026-10-23-response-aware-waf-request-response-correlation.md`
- 게시 시각: `2026-10-23 09:00:12 +0900`
- 제목: `요청만 검사하는 WAF는 공격 성공 여부를 모른다: 응답 상관 탐지 설계`
- 검색 의도: request-only WAF와 request+response correlation의 운영 차이와 안전한 도입
- 상태·주요 출처: Cloudflare 2026-10-21 full transaction detection announcement·WAF docs
- 가까운 기존 글: PHP2Shell runtime verification, Microsoft attack chain
- 반복 금지: 실제 exploit payload, Cloudflare 제품 기능 나열
- 고유 논지: 가짜 secret fixture로 request suspicion, response evidence, block decision, redaction과 false positive를 분리한다.
- 경계: 제품 제공 범위·plan과 vendor 사례를 일반 WAF 표준으로 표현하지 않는다.

### 8. Minimus registry 종료와 이미지 공급망 exit strategy

- 경로: `_posts/2026-10-23-minimus-registry-shutdown-image-exit-strategy.md`
- 게시 시각: `2026-10-23 09:00:14 +0900`
- 제목: `컨테이너 레지스트리가 문을 닫았다: Minimus 종료에서 배우는 이미지 탈출 계획`
- 검색 의도: upstream registry 종료 시 digest inventory·mirror·대체 image·rollback 준비
- 상태·주요 출처: Minimus 종료 공지, Docker migration announcement, DHI migration docs·OCI distribution docs
- 가까운 기존 글: Docker Hardened Images 공급망, Cloudflare Basin Exit Test
- 반복 금지: hardened image 제품 소개와 CVE 감소 마케팅 재작성
- 고유 논지: 공급자 종료 전후 pull 가능성, 로컬 cache와 registry mirror, digest·SBOM·UID·CA·entrypoint parity를 검증한다.
- 경계: Docker의 수치·호환성은 vendor claim이며 DHI 채택만을 결론으로 강제하지 않는다.

### 9. tsrs compiler parity와 benchmark

- 경로: `_posts/2026-10-23-tsrs-typescript-rust-parity-benchmark.md`
- 게시 시각: `2026-10-23 09:00:16 +0900`
- 제목: `TypeScript를 Rust로 옮기면 정말 8배 빨라질까: tsrs 호환성부터 검증하기`
- 검색 의도: experimental tsrs의 diagnostic parity·memory·cold/warm 성능 검증
- 상태·주요 출처: Cloudflare 2026-10-20 announcement, canonical tsrs repository·package metadata·license
- 가까운 기존 글: TypeScript 6 RC·TypeScript 7 Go port 준비, Rust·Mojo·Zig 언어 글
- 반복 금지: TypeScript 6 migration, Rust가 빠르다는 일반론
- 고유 논지: 속도보다 type semantics·diagnostic·exit code parity를 먼저 gate로 둔다. JavaScript `tsc` 기본 baseline과 `tsrs` worker scaling은 분리하며 equal-worker 결과로 표현하지 않는다.
- 경계: 최대 8배·약 70% 메모리 절감은 vendor의 초기 조건부 결과이며 프로젝트는 experimental이다.

### 10. 채용 플랫폼 거짓 구인광고 검증 state machine

- 경로: `_posts/2026-10-23-job-platform-false-ad-verification-state-machine.md`
- 게시 시각: `2026-10-23 09:00:18 +0900`
- 제목: `채용 플랫폼은 거짓 구인광고를 게재 전에 어떻게 막아야 하나`
- 검색 의도: 직업안정법 개정에 대비한 사업자 확인·공고 검증·긴급 게시 중지·이의제기 운영 설계
- 상태·주요 출처: 고용노동부 2026-09-22 입법예고, 국가법령정보센터 법률·입법예고 자료
- 가까운 기존 글: 플랫폼 노동자 기본권, 모바일 얼굴 인증 개인정보
- 반복 금지: 시행 전 규정을 확정 의무처럼 표현, 개별 법률 자문
- 고유 논지: `publication_state`, `verification_state`, `appeal_state`를 독립 축으로 두고, 이의제기 접수나 인용이 게시 상태를 자동 복구하지 않도록 별도 결정 전이를 둔다.
- 경계: 하위법령은 입법예고 단계이고 법률 시행 예정일·최종 문언·플랫폼 범위를 구분한다.

## 검증 계약

1. 신규 `_posts/2026-10-23-*.md`는 위 경로와 정확히 일치하는 10개다.
2. 각 포스트의 inline citation first-seen과 Sources는 같은 연속 `1..N`이다.
3. 각 포스트는 서로 다른 고정 Picsum seed를 쓰며 front matter와 첫 본문 이미지 URL이 같다.
4. 코드 fence는 syntax-check하고 실행 가능한 안전 fixture는 주장한 runtime에서 behavior-check한다.
5. 공식 사실·vendor 결과·운영 권고와 내부 제안 field를 분리한다.
6. Critical·Important 독립 검토를 모두 수정하고 재검토한다.
7. Codex humanize는 검토 후 보수적으로 적용하고 protected spans 및 의미를 재검증한다.
8. 최종 Docker/Jekyll build와 생성 HTML 10개를 검사한다.
9. source map 1개와 포스트 10개만 commit·push한다. PR·merge·master push·Pages 배포는 하지 않는다.
