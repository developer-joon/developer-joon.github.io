# 2026년 9월 AI 에이전트·MCP·Kubernetes 포스팅 설계

## 목표

2026년 9월의 주요 개발·운영 이슈를 breadlab.ai의 기존 문체와 콘텐츠 원칙에 맞춘 독립 포스팅 7편으로 발행 준비한다. 각 글은 단순 발표 요약이 아니라 실제 도입 판단에 필요한 권한 경계, 실패 모드, 검증 방법과 운영 trade-off를 설명한다.

## 작업 범위

단일 피처 브랜치 `content/2026-09-agent-mcp-kubernetes`에서 아래 글을 작성한다.

1. `2026-09-25-openai-agents-api-managed-harness.md`
   - 관리형 agent harness가 제공하는 세션·도구·sandbox·관찰 가능성
   - 직접 구축 대비 얻는 것과 잃는 통제권
   - beta 도입 체크리스트와 실패 시 복구 경로
2. `2026-09-25-multi-model-routing-cascade-critique.md`
   - single, cascade, critique 패턴 비교
   - 비용 절감 주장과 품질 평가를 분리하는 벤치마크 설계
   - routing 실패, 비용 폭증, 공급자 종속 대응
3. `2026-09-25-mcp-supply-chain-delayed-tool-poisoning.md`
   - 지연 활성화형 MCP 도구 오염의 공격 흐름
   - 짧은 정적 검토가 놓치는 상태 기반 악성 동작
   - 격리, 반복 호출 테스트, egress 통제와 provenance 검증
4. `2026-09-25-mcp-runtime-governance-identity-authorization-audit.md`
   - agent, 사용자, MCP server, downstream SaaS identity 분리
   - 도구 호출 시점 authorization과 최소 권한
   - 감사 로그, 승인 단계, 차단·폐기·복구 절차
5. `2026-09-25-kubernetes-137-rootless-kubelet-beta.md`
   - `KubeletInUserNamespace` beta의 의미
   - 기존 rootful cluster에 미치는 영향과 node 식별
   - kernel·runtime·CNI 제약 및 점진적 도입
6. `2026-09-25-kubernetes-137-volume-hardening.md`
   - `VolumeBindMountOptions`와 `EmptyDirVolumeMode`
   - `noexec`, `nosuid`, `nodev`, sticky bit의 실제 보안 효과
   - alpha gate, runtime capability, version skew와 검증 예시
7. `2026-09-25-kubernetes-september-2026-cve-response.md`
   - 2026년 9월 공개 Kubernetes 관련 취약점의 영향 범위
   - 권한·플랫폼·기능 사용 여부에 따른 노출 판단
   - 고정 버전 확인, 업그레이드 우선순위와 사후 검증

## 콘텐츠 구조

각 글은 다음 구조를 기본으로 하되 주제에 맞게 조정한다.

1. 문제를 드러내는 구체적 운영 상황
2. 공식 발표 또는 보안 공지가 실제로 말하는 내용
3. 아키텍처·권한·데이터 흐름 분석
4. 도입 또는 공격 시나리오와 실패 모드
5. 실무 적용 절차 또는 의사결정 기준
6. 검증 체크리스트
7. 결론과 참고 자료

각 글은 서로 독립적으로 이해할 수 있어야 한다. 다른 글을 읽어야만 핵심 결론을 이해할 수 있는 연재 의존성은 만들지 않는다. 필요한 경우 관련 글을 짧게 연결하되 같은 설명을 복제하지 않는다.

## 사실성 및 출처 정책

- 공식 제품 문서, 프로젝트 릴리스, Kubernetes 공식 블로그, 보안 공지와 원본 저장소를 우선한다.
- 회사 또는 프로젝트가 제시한 benchmark와 효과 수치는 제품 주장으로 명시하며 독립 검증처럼 서술하지 않는다.
- 보안 취약점의 영향 버전과 고정 버전은 원문 공지를 기준으로 교차 확인한다.
- 검색 결과 요약만으로 사실을 확정하지 않고 원문을 추출해 확인한다.
- 확인하지 못한 기능, 수치, API 이름과 명령을 만들지 않는다.
- 모든 외부 사실에는 본문 문맥상 가까운 링크 또는 글 하단 참고 자료를 제공한다.

## 형식과 이미지

- 기존 `_posts` front matter를 따른다: `title`, `date`, `categories`, `description`, `featured_image`, `tags`.
- 본문은 한국어로 작성하고 명령·식별자는 원문 표기를 유지한다.
- 커버와 본문 상단 이미지는 기존 저장소 규칙에 따라 주제별 고정 seed의 `https://picsum.photos/seed/<slug>/1600/900`을 사용한다.
- 저작권이 불명확한 외부 이미지는 추가하지 않는다.
- 임의의 실행 결과나 재현하지 않은 benchmark를 만들지 않는다.

## 변경 경계

- `_posts/`의 신규 Markdown 7개와 이 설계 문서만 변경한다.
- 테마, 레이아웃, JavaScript, CSS, 프로젝트 페이지와 배포 설정은 변경하지 않는다.
- 기존 포스팅은 수정하지 않는다.
- `master`에 직접 push하거나 merge하지 않는다.

## 검증

1. front matter 필수 필드와 날짜·slug 중복 여부를 검사한다.
2. 각 글의 내부 링크, 외부 참고 URL, 이미지 URL 형식을 검사한다.
3. `bundle exec jekyll build`를 실행한다.
4. 생성된 `_site/blog/<slug>/index.html` 7개가 존재하며 제목과 핵심 섹션이 렌더링됐는지 확인한다.
5. `git diff --check`와 `git status --short`로 공백 오류와 변경 범위를 확인한다.
6. 커밋 후 피처 브랜치만 `origin`에 push한다.
7. GitHub API와 `git ls-remote`로 원격 브랜치와 commit SHA가 일치하는지 재확인한다.

## 완료 기준

- 독립 포스팅 7편이 기존 블로그 형식과 콘텐츠 원칙을 충족한다.
- 외부 사실은 확인 가능한 원문 출처에 근거한다.
- Jekyll 빌드가 성공하고 7개의 HTML 산출물이 생성된다.
- 변경은 한 피처 브랜치에 커밋되어 `origin`에 존재한다.
- 기본 브랜치에는 직접 변경이 없다.
