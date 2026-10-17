# 2026-10-17 주간 AI·개발 포스트 12편 source/overlap map

## 배치 계약

- 조사 시각: 2026-10-17 KST
- 주간 뉴스 범위: 2026-10-12 00:00~2026-10-17 08:34 KST
- 주간 발표 기반 글: 10편
- 사용자 지정 딥다이브: Amazon Bedrock AgentCore, MCP ToolHub 2편
- 총 publishable source: 12편
- 배너: 글별 고유 fixed-seed Picsum 1600×900, `featured_image`와 첫 본문 이미지 동일
- 전달: feature branch push와 PR까지만 수행

## 1. FLUX.3 Image Klein

- Path: `_posts/2026-10-17-flux-3-image-klein-layout-control.md`
- Date: `2026-10-17 06:00:00 +0900`
- Proposed title: `FLUX.3 Image Klein 실전: 생성보다 어려운 다중 참조 편집과 레이아웃 제어`
- Search intent: FLUX.3의 다중 참조 편집, bounding-box layout control, 양자화별 실제 배포 비용
- Trigger/status: 2026-10-15 공개, 공개 가중치·FLUX Kommunity License
- Primary sources:
  - https://huggingface.co/blog/flux-3
  - https://huggingface.co/black-forest-labs/flux-3-image-klein
  - https://github.com/black-forest-labs/flux-3-image-klein
- Nearest existing posts: 이미지 생성 일반론, 모델 성능·비용 비교 글
- Forbidden repetition: 최신 이미지 모델 기능 나열, 공급자 benchmark를 독립 결과처럼 표현
- Unique thesis: 좌표 조건은 hard mask가 아니며 다중 참조·prompt upsampler·양자화 구성까지 합친 전체 배포 비용을 측정해야 한다.
- Intended artifact: 동일 seed의 일반/좌표 프롬프트 비교와 BF16·FP8·NVFP4 측정 설계
- Claim boundary: 5.6B는 image transformer 기준이며 텍스트 인코더·upsampler 자원을 별도로 본다.

## 2. UltraBERT 32K

- Path: `_posts/2026-10-17-ultrabert-32k-long-document-retrieval.md`
- Date: `2026-10-17 06:10:00 +0900`
- Proposed title: `UltraBERT 32K 활용법: 생성형 LLM 없이 긴 문서를 분류하고 검색하기`
- Search intent: 긴 문서에서 chunking과 32K encoder의 품질·지연·비용 비교
- Trigger/status: 2026-10-14 공개, Apache-2.0 English encoder·embedding family
- Primary sources:
  - https://huggingface.co/blog/dmis-lab/ultrabert
  - https://huggingface.co/dmis-lab/UltraBERT-150M
  - https://arxiv.org/abs/2610.15028
- Nearest existing posts: RAG pipeline, embedding, LLM 비용 최적화
- Forbidden repetition: encoder가 항상 생성형 LLM보다 우수하다는 일반화, 저자 SOTA 주장 재포장
- Unique thesis: 긴 문서에서는 모델 크기보다 chunk boundary가 만드는 정보 손실과 32K attention 비용을 함께 측정해야 한다.
- Intended artifact: 8K+ 문서의 chunked retrieval 대 single-32K fixture
- Claim boundary: 일반 encoder checkpoint와 contrastive-trained Embed checkpoint의 결과를 섞지 않는다.

## 3. Granite Switch 4.1

- Path: `_posts/2026-10-17-granite-switch-4-1-one-endpoint.md`
- Date: `2026-10-17 06:20:00 +0900`
- Proposed title: `Granite Switch 4.1: 채팅·분류·안전 판정을 한 vLLM 엔드포인트에서 전환하기`
- Search intent: 공통 base와 aLoRA를 사용한 단일 checkpoint·endpoint 운영
- Trigger/status: 2026-10-15 발표, Apache-2.0 모델·코드
- Primary sources:
  - https://huggingface.co/blog/ibm-granite/granite-switch-4-1
  - https://huggingface.co/ibm-granite/granite-switch-4.1-8b
  - https://github.com/generative-computing/granite-switch
- Nearest existing posts: typed decision model, 모델 routing 글
- Forbidden repetition: 확률 threshold 일반론, 여러 모델을 cascade하는 기존 결론
- Unique thesis: 공통 base의 cache·memory를 공유하되 adapter activation contract와 ASR cascade를 하나의 멀티모달 모델처럼 오해하지 않아야 한다.
- Intended artifact: chat·decision·guardian 요청 fixture와 endpoint 전환 표
- Claim boundary: custom adapter SDK는 현재 계획이며 ASR은 영어 cascade다.

## 4. GitHub Actions workflow lockfile

- Path: `_posts/2026-10-17-github-actions-workflow-lockfile.md`
- Date: `2026-10-17 06:30:00 +0900`
- Proposed title: `GitHub Actions lockfile 공개 프리뷰: 태그를 믿지 않고 전이 의존성까지 고정하는 법`
- Search intent: workflow dependency lockfile로 action·reusable workflow·transitive commit 고정
- Trigger/status: 2026-10-14 public preview
- Primary sources:
  - https://github.blog/changelog/2026-10-14-github-actions-workflow-lockfiles-in-public-preview
  - https://docs.github.com/actions/concepts/security/workflow-dependency-lockfiles
  - https://github.com/github/gh-actions-lock
- Nearest existing posts: Dependabot anonymous registry, supply-chain identity, GitHub policy freshness
- Forbidden repetition: Dependabot 인증·egress, Git author/committer/pusher identity
- Unique thesis: 사람이 검토한 symbolic ref와 실제 실행 commit 사이의 drift를 repository-owned lock artifact로 닫는다.
- Intended artifact: moved-tag fixture, stale lock CI, transitive dependency read-back
- Claim boundary: lockfile은 dependency가 안전한지 판별하지 않으며 preview 상태다.

## 5. GitHub license compliance

- Path: `_posts/2026-10-17-github-license-compliance-merge-gate.md`
- Date: `2026-10-17 06:40:00 +0900`
- Proposed title: `오픈소스 라이선스를 PR merge gate로 만들 때 생기는 예외와 우회 경로`
- Search intent: GitHub license policy·ruleset·audit event·SBOM API를 merge gate로 운영
- Trigger/status: 2026-10-16 GA, GitHub Enterprise Cloud와 Code Security 범위
- Primary sources:
  - https://github.blog/changelog/2026-10-16-open-source-license-compliance-generally-available
  - https://docs.github.com/code-security/supply-chain-security/understanding-your-software-supply-chain
- Nearest existing posts: Dependabot registry, AI secret detection push gate, Copilot policy freshness
- Forbidden repetition: generic fail-closed release gate, package registry 인증
- Unique thesis: license detection 결과, 조직 정책, 예외 승인, audit/read-back은 서로 다른 상태다.
- Intended artifact: GPL·AGPL·SSPL test dependency matrix와 exception lifecycle
- Claim boundary: plan·repository eligibility를 보존하고 법률 자문처럼 표현하지 않는다.

## 6. IntelliJ Java/Kotlin LSP 1.0

- Path: `_posts/2026-10-17-intellij-java-kotlin-lsp-vscode-cursor.md`
- Date: `2026-10-17 06:50:00 +0900`
- Proposed title: `Cursor와 VS Code에서 IntelliJ JVM 엔진 쓰기: Java·Kotlin LSP 1.0 검증`
- Search intent: JVM monorepo에서 IntelliJ LSP extension의 indexing·rename·debug 정확도 검증
- Trigger/status: 2026-10-15 첫 stable 1.0
- Primary sources:
  - https://blog.jetbrains.com/idea/2026/10/intellij-idea-s-java-and-kotlin-for-cursor-and-vs-code-hits-1-0/
- Nearest existing posts: Cursor·VS Code MCP 통합, 코딩 에이전트 평가 글
- Forbidden repetition: IDE 추천·기능 나열, 에이전트 일반 생산성 주장
- Unique thesis: 에디터 UI보다 LSP/DAP 결과의 determinism과 대형 build graph에서의 resource cost가 중요하다.
- Intended artifact: 동일 Maven·Gradle fixture의 indexing·rename·memory 비교 설계
- Claim boundary: stable extension과 개별 preview 기능을 분리한다.

## 7. AWS Lambda Durable Go

- Path: `_posts/2026-10-17-lambda-durable-go-workflow.md`
- Date: `2026-10-17 07:00:00 +0900`
- Proposed title: `Lambda Durable Go로 승인 대기 배포 만들기: 재시작돼도 부작용을 반복하지 않는 법`
- Search intent: Go durable function의 checkpoint·callback·resume compatibility·idempotency
- Trigger/status: 2026-10-15 Go SDK GA
- Primary sources:
  - https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-durable-go-sdk-support/
  - https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html
  - https://github.com/aws/aws-durable-execution-sdk-go
- Nearest existing posts: Temporal policy agent authorization, remediation plan change control
- Forbidden repetition: 승인/read-back 일반론, state machine 기능 나열
- Unique thesis: durable checkpoint는 코드의 외부 부작용을 되돌리거나 자동 멱등화하지 않는다.
- Intended artifact: plan→approval callback→deploy→verify failure-injection fixture
- Claim boundary: Lambda·연계 서비스 비용과 callback authentication을 별도 계산한다.

## 8. Grafana connection KPI

- Path: `_posts/2026-10-17-grafana-connection-kpi-metrics-cost.md`
- Date: `2026-10-17 07:10:00 +0900`
- Proposed title: `Service Graph를 끄지 않고 메트릭 비용 줄이기: latency histogram의 실제 cardinality`
- Search intent: connected-service KPI 구성별 active series 비용과 진단력 비교
- Trigger/status: 2026-10-14 Grafana Cloud GA
- Primary sources:
  - https://grafana.com/whats-new/2026-10-14-choose-connection-kpis-to-control-metrics-cost/
  - https://grafana.com/docs/grafana-cloud/platform/knowledge-graph/configure/traces-metrics-generation/
- Nearest existing posts: OpenTelemetry·agent operations, 일반 observability 글
- Forbidden repetition: telemetry 도입 체크리스트, 비용을 cardinality 하나로만 설명
- Unique thesis: service graph topology를 남기면서 latency histogram series만 제거할 때 잃는 tail-latency 신호를 수치화한다.
- Intended artifact: all KPI / requests+errors / topology-only series inventory
- Claim boundary: 설정은 stack-wide이고 기존 series는 retention까지 남으며 self-managed 기능으로 확대하지 않는다.

## 9. Cisco Secure Email Gateway

- Path: `_posts/2026-10-17-cisco-email-gateway-exposure-runbook.md`
- Date: `2026-10-17 07:20:00 +0900`
- Proposed title: `보안 기능을 켰을 때만 노출되는 취약점: Cisco 이메일 게이트웨이 판별 런북`
- Search intent: CVE-2026-76519의 두 영향 조건과 패치·침해 복구 분리
- Trigger/status: 2026-10-14 16:00 GMT advisory, Critical, 실제 악용 확인
- Primary sources:
  - https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-esa-afw-zqYJkjxp
- Nearest existing posts: Kubernetes CVE response, vulnerability validation pipeline
- Forbidden repetition: CVSS 나열, exploit PoC, generic patch checklist
- Unique thesis: 제품 버전만이 아니라 File Reputation policy와 Content Scanner Tools version을 함께 검사해야 노출을 판별할 수 있다.
- Intended artifact: `contentscannerstatus`·policy·external log triage runbook
- Claim boundary: 모든 Cisco email product가 취약하다고 확대하지 않고 공격 코드를 제공하지 않는다.

## 10. AOMEI ephemeral supply-chain tampering

- Path: `_posts/2026-10-17-aomei-ephemeral-supply-chain-tampering.md`
- Date: `2026-10-17 07:30:00 +0900`
- Proposed title: `5분만 열리는 공급망 공격: 사후 URL 검사가 정상이어도 안전하지 않은 이유`
- Search intent: 짧은 origin configuration 변조와 point-in-time triage의 구조적 한계
- Trigger/status: 2026-10-15 GTIG/Mandiant 보고서, 관측 기간 2026년 4~7월
- Primary sources:
  - https://cloud.google.com/blog/topics/threat-intelligence/investigating-ephemeral-supply-chain-tampering
- Nearest existing posts: delayed MCP tool poisoning, supply-chain identity 글
- Forbidden repetition: tool metadata fingerprint·MCP re-consent, 일반 SBOM 주장
- Unique thesis: 현재 URL·평판·재다운로드는 과거 5~10분 배포 창의 artifact를 증명하지 못한다.
- Intended artifact: endpoint process tree·network history·hash/signature evidence bundle
- Claim boundary: 보고서 공개일과 공격 관측 기간을 분리하고 피해 규모를 추정하지 않는다.

## 11. Amazon Bedrock AgentCore

- Path: `_posts/2026-10-17-amazon-bedrock-agentcore-deep-dive.md`
- Date: `2026-10-17 07:40:00 +0900`
- Proposed title: `Amazon Bedrock AgentCore 딥다이브: 모델 토큰과 에이전트 실행을 같은 청구서로 착각하지 않는 법`
- Search intent: Bedrock model invocation과 AgentCore Runtime·Gateway·Identity·Memory·Observability·built-in tools·Evaluations의 기능·성능·비용 분리
- Trigger/status: 사용자 지정 current-service deep dive; 주간 단일 발표 글이 아님
- Primary sources:
  - https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html
  - https://aws.amazon.com/bedrock/agentcore/pricing/
  - https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html
  - https://aws.amazon.com/blogs/machine-learning/the-new-agentcore-runtime-elastic-optimized-and-consistently-fast-starts/
  - https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html
  - https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity.html
  - https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html
  - https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html
  - https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/batch-evaluations.html
  - https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-agentcore-new-optimization-capabilities/
- Nearest existing posts: MCP runtime governance, managed harness exit, coding-agent operations, browser context cost, AWS Commerce AI transaction boundary
- Forbidden repetition: agent identity·sandbox 일반론, commerce transaction 설계, managed-vs-build checklist
- Unique thesis: model tokens, agent compute, tools, memory, sandbox, trace와 evaluations는 독립 meter·quota·failure domain이다.
- Intended artifact: dual-plane trace, quota snapshot, failure matrix, Decimal-based two-scenario cost ledger
- Claim boundary: AWS Runtime V2 echo benchmark를 end-to-end agent latency로 확대하지 않는다. Batch Evaluation은 GA 발표와 preview 문서 충돌을 그대로 공개한다.

## 12. MCP ToolHub

- Path: `_posts/2026-10-17-mcp-toolhub-approval-execution-boundary.md`
- Date: `2026-10-17 07:50:00 +0900`
- Proposed title: `승인은 실행 권한이 아니라 한 번 소비되는 상태다: MCP ToolHub의 로컬 실행 경계`
- Search intent: local stdio-only execution gateway의 immutable approval snapshot·consume-before-execute·replay rejection
- Trigger/status: 사용자 지정 project deep dive; canonical repo `zhihaochen67/mcp-toolhub`, v0.1.0 alpha release
- Primary sources:
  - https://github.com/zhihaochen67/mcp-toolhub
  - https://github.com/zhihaochen67/mcp-toolhub/releases/tag/v0.1.0
  - https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/docs/architecture.md
  - https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/docs/approval-lifecycle.md
  - https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/docs/operations.md
  - https://github.com/zhihaochen67/mcp-toolhub/blob/e4a9f290838d42f0eebbacb7cf06a34c4b2e7b9f/LICENSE
- Nearest existing posts: shadow MCP traffic, MCP runtime governance, delayed tool poisoning, sandbox four-layer, coding-agent operations
- Forbidden repetition: MCP inventory·OAuth·enterprise PDP, delayed metadata poisoning, generic sandbox taxonomy
- Unique thesis: 사람이 검토한 mutation/command snapshot을 workspace·expiry·executable identity에 묶고 실행 전에 원자적으로 소비하는 것이 핵심이며, 이것은 filesystem/network sandbox가 아니다.
- Intended artifact: 14-tool inventory, Contract V1 lifecycle, approve→consume→execute→replay rejection demo
- Claim boundary: ToolHub는 MCP catalog/context reduction 제품이 아니다. v0.1.0 artifact는 MIT지만 현재 main에는 명시적 LICENSE가 없어 HEAD 전체를 MIT로 단정하지 않는다.

## 통합 검증 계약

1. 위 12개 Path와 생성 파일이 정확히 일치해야 한다.
2. 모든 front matter date는 revision-derived build time 이전이어야 한다.
3. 각 글의 citation first-seen sequence, Sources sequence, `1..N`이 같아야 한다.
4. 공급자 성능 수치는 조건과 공급자 attribution을 유지한다.
5. Preview·GA·stable·alpha와 라이선스 경계가 title·description·body·conclusion에서 일치해야 한다.
6. 12개 생성 HTML의 title, unique conclusion marker, Sources, featured image를 확인한다.
7. 하나의 최종 revision에서 Community와 Docker/Jekyll artifact gate를 통과해야 한다.
