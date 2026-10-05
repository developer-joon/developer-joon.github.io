# 최신 기술 뉴스 포스팅 10편 편집 설계

## 목표

2026년 10월 5일 기준 최근 사고·제품 발표·표준 변화에 근거한 한국어 기술 포스팅 10편을 작성한다. 기존 `_posts`의 주제와 핵심 결론을 반복하지 않고, 각 글을 독립적으로 게시 가능한 Jekyll 원고로 완성한다.

이번 작업은 원고 작성과 로컬 검증까지만 수행한다. 커밋, push, PR, 운영 배포는 하지 않는다.

## 독자와 문체

- 독자: AI 에이전트, 보안, DevOps, Kubernetes를 실제 운영하는 개발자와 플랫폼 엔지니어
- 문체: 직설적이고 실무적인 한국어 기술 글
- 공급자 발표와 작성자의 운영 해석을 분리한다.
- 과장된 AI 사고 표현을 피하고 확인된 행동, 잠재 영향, 실제 피해를 구분한다.
- 기존 글과 같은 장문의 일반론을 반복하지 않고 뉴스가 만든 새로운 기술·운영 판단에 집중한다.

## 원고 공통 계약

각 원고는 다음 요소를 갖는다.

1. 기존 저장소 형식의 YAML front matter
2. 저작권 불명확한 이미지를 피한 기존 seeded Picsum featured image
3. 최근 발표 또는 사고가 중요한 이유를 설명하는 도입부
4. 공식 사실과 운영 해석의 명시적 구분
5. 실제 적용 단계, 실패 모드 또는 검증 체크리스트
6. 번호가 붙은 인용과 `## Sources` 목록
7. 다른 9편 및 기존 글과 중복되지 않는 검색 의도와 결론

편당 목표 분량은 약 4,000~7,000자다. 필요한 글에는 명령어, YAML, 정책 예시 또는 테스트 시나리오를 포함하되 실행하지 않은 결과를 실제 측정값처럼 제시하지 않는다.

## 확정 주제와 경계

### 1. AI 에이전트 비인가 행동 사고 비교

- OpenAI·Hugging Face 사고와 영국 AISI 보고서를 비교한다.
- 인터넷 권한, 비인가 통신, 실제 조직 대상 행동, 사회공학, 인간 검토를 사실별로 분리한다.
- 기존 일반 AI 보안 글과 달리 두 사고의 기술적 차이와 평가 환경 설계 실패에 집중한다.

### 2. Codex Security Research Preview와 취약점 검증

- 취약점 후보 생성, exploitability 검증, 재현 가능한 증거, 우선순위화의 차이를 다룬다.
- 제품 소개가 아니라 보안 triage 파이프라인과 책임 있는 공개 경계를 분석한다.

### 3. GitHub Copilot Computer Use의 데스크톱 권한

- 접근성, 화면 녹화, 키보드·마우스 제어, GUI-only 앱 자동화의 새 공격 표면을 다룬다.
- 기존 coding-agent sandbox 글과 달리 OS 데스크톱 권한과 승인 기억의 수명에 집중한다.

### 4. Copilot Code Review API의 품질 게이트

- API 기반 리뷰와 effort 설정을 CI·branch protection에 연결할 때의 책임 경계를 다룬다.
- AI 리뷰를 사람 승인이나 결정적 테스트의 대체물로 표현하지 않는다.

### 5. AI 생성 취약점 신고의 품질 관리

- GitHub Structured Private Vulnerability Reports를 기반으로 summary, details, PoC, impact, CWE, AI 사용 공개를 분석한다.
- 취약점 발견 자체보다 재현 가능하고 분류 가능한 신고 입력 계약에 집중한다.

### 6. Agentic Web의 두 번째 청중

- 사람, 검색 crawler, 학습 crawler, 사용자 대리 agent를 구분한다.
- Web Bot Auth, AI crawler 정책, agent traffic, 콘텐츠 접근과 수익 모델을 다룬다.
- 공급자 트래픽 수치는 Cloudflare 관측 범위의 vendor-reported 수치로 표시한다.

### 7. Docker Sandbox Kit Spec v3의 Authority as Code

- OCI image에 network, credential, volume, 도구 권한 요구를 함께 선언하는 모델을 설명한다.
- 선언과 실제 runtime enforcement를 구분하고, digest 고정만으로 안전이 완성되지 않음을 강조한다.

### 8. Kubernetes 1.37 Memory QoS Beta

- feature gate 기본 활성화와 실제 throttling·reservation 기본 동작을 구분한다.
- cgroup v2, `memoryThrottlingFactor`, `TieredReservation`, node-wide 제한과 업그레이드 검증을 다룬다.

### 9. Kubernetes 1.37 PVC last-used tracking

- 사용하지 않는 PVC 후보 탐색과 안전한 회수 절차를 다룬다.
- last-used timestamp를 자동 삭제 허가로 오해하지 않고 StatefulSet, backup, restore, 보존 정책을 결합한다.

### 10. Kubernetes 1.37 HPA scale-to-zero Beta

- 0 replica 진입·복귀 조건, 외부 및 객체 metric, metric outage, cold start를 분석한다.
- 비용 절감 기능 소개가 아니라 production 적용 전 fail-safe와 관측 계약에 집중한다.

## 중복 방지

- 작성 전 전체 `_posts`의 title, description, tags, headings를 검색한다.
- 기존 글과 동일한 핵심 질문이나 결론이 발견되면 해당 원고의 범위를 더 좁히거나 주제를 교체한다.
- MCP authorization, 일반 agent sandbox, managed harness, 일반 tool-use benchmark 설명은 새 글의 중심으로 재사용하지 않는다.
- 공통 보안 원칙은 필요한 만큼만 짧게 언급하고 상세 설명은 기존 글에 내부 링크한다.
- 10편 사이에서도 동일한 체크리스트나 결론을 복사하지 않는다.

## 근거와 인용

- 공식 사고 보고서, 제품 changelog, 기술 사양 및 프로젝트 공식 블로그를 우선한다.
- 검색 결과 snippet만으로 본문 주장을 작성하지 않는다.
- 공급자 성능·트래픽·효과 수치는 공급자 관측 또는 주장임을 표시한다.
- 문장과 출처의 의미가 일치하는지 기계적 인용 검사와 별도로 검토한다.
- 정확한 날짜, 상태(public preview, beta 등), 필드명과 기본값은 작성 직전에 원문에서 다시 확인한다.

## 편집 및 humanize-korean

초안의 사실·인용·기술 검토가 끝난 뒤 대표 원고 한 편에 Codex `$humanize-korean`을 보수 모드로 시험 적용한다. front matter, 제목, 코드, 명령, URL, 인용 번호, 숫자, 날짜, 제품명과 규범적 표현을 보호한다. 원본은 덮어쓰지 않고 후보 diff를 검토하며 의미가 실제로 보존되고 문장이 자연스러워진 변경만 부분 채택한다. 시험이 실패하면 나머지 원고에는 적용하지 않는다.

## 검증

1. 10개 원고 파일 존재와 front matter 필드 검사
2. 파일명·slug·제목·description·tag 중복 검사
3. 인용 ID, URL, Sources 목록의 기계적 검증
4. 문장별 source entailment 및 규범 강도 검토
5. 내부 링크와 외부 링크 형식 검사
6. 민감정보, 자격 증명, 내부 전용 운영 값 유출 검사
7. Jekyll/Docker 공식 경로로 최종 artifact 생성
8. 10개 생성 HTML의 title, 본문, Sources 존재 확인
9. 기존 대표 페이지와 Community artifact 회귀 검사
10. 최종 `git diff --check` 및 작업 트리 변경 파일 확인

## 전달 상태

완료 보고에서는 Markdown 원고, 생성 HTML, 검증 결과를 구분한다. 커밋, push, PR, 운영 배포는 모두 수행하지 않았다고 명시한다.