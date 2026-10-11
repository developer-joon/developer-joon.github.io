# 2026-10-11 에이전트 운영 포스팅 10편: source/overlap map

- 기준 시각: **KST 2026-10-11**
- 요청 범위: 앞서 선정한 주제 **정확히 10편**을 각각 독립된 포스팅으로 작성한다.
- 코퍼스 비교: 기존 `_posts/*.md` **162편**, H2/H3 **3,319개**를 제목·설명·태그·본문 소제목 기준으로 검색했다.
- 출처 원칙: 검색 snippet은 발견에만 사용한다. 본문은 아래 1차 출처의 실제 원문을 기준으로 작성하고, 공급자 발표·설문 결과·운영 제안을 구분한다.
- 공통 금지선: 기존 글의 sandbox/IAM/MCP/OTel/멀티모델 비용 일반론을 복제하지 않는다. 10편 안에서도 같은 체크리스트와 결론을 반복하지 않는다.

## 선정 요약

| # | 새 글이 소유할 검색 의도 | 핵심 1차 출처 | 고유 결론 |
|---|---|---|---|
| 1 | AI 코딩 도구 일일 사용률과 production 업무 활용률의 차이 | Stack Overflow 2026 Survey | 공개 집계는 권한 위임이나 원인을 측정하지 않는다. 가역성·증거·책임 경계는 조직별 로그로 검증할 운영 가설이다. |
| 2 | Copilot GA와 Strands Box를 비교한 agent sandbox 4계층 | GitHub 2026-10-07, AWS 2026-10-07 | 격리와 정책은 다르며 tool call 문자열이 아니라 실제 효과를 외부 경계에서 집행해야 한다. |
| 3 | Dogwood temporal policy로 순서·시간·누적량을 권한에 포함하는 법 | AWS 2026-09-30 | 개별 호출이 합법이어도 trajectory가 위험할 수 있어 durable event history가 권한 상태가 된다. |
| 4 | Postman Agent Mode의 4천만 사용자 운영 설계 | Postman 2026-03-24, AWS 2026-10-09 | 모델 능력보다 tool budget·schema-aware read·purpose-built context가 성숙 제품 통합의 병목이다. |
| 5 | 사용자 token을 LLM에 노출하지 않는 delegated identity | AWS Security 2026-10-06 | identity는 prompt/tool argument가 아니라 transport로 운반하고 data layer가 실제 사용자를 판정해야 한다. |
| 6 | Draft PR 제한이 드러낸 OSS review capacity 문제 | GitHub 2026-10-08 | GitHub의 외부 기여자별 생성 한도와 Draft counting은 admission control일 뿐, 변경 품질이나 AI 기여 원인을 판정하지 않는다. |
| 7 | Vercel AI SDK software factory의 risk-aligned automation | Vercel 2026-08-12 | agent 수보다 좁은 역할, 격리, 사람 merge, 실패를 자산화하는 개선 loop가 중요하다. |
| 8 | Platform Engineering 2.0의 AI-native workload 계약 | CNCF 2026-07-06, KubeCon 2026 일정 | 새 플랫폼 재구축보다 기존 golden path의 persona·GPU·model·agent·FinOps 계약을 확장해야 한다. |
| 9 | Copilot CLI의 local model 발견을 계기로 한 local/cloud routing | GitHub 2026-10-07 | local model은 곧 offline·private가 아니며 route는 data·action·telemetry 경계를 함께 판정해야 한다. |
| 10 | 1인 조직 4%→10%와 agent leverage의 운영 현실 | Stack Overflow 2026 Survey | agent는 구현 인건비를 줄여도 시장·보안·지원·당직·법적 책임을 없애지 않는다. |

---

## 1. 2026 개발자 설문: AI 코딩 도구 일일 사용 73%, 프로덕션 업무 활용 19.9%

- **파일:** `_posts/2026-10-11-ai-daily-use-production-trust-gap.md`
- **발표일/상태:** Stack Overflow 공식 2026 Survey 요약, 2026-10-06. 3만 명 이상 응답자의 자기보고 설문이다.
- **1차 출처:** https://stackoverflow.blog/2026/10/06/the-results-of-the-2026-developer-survey-are-here/
- **보조 비교 출처:** https://survey.stackoverflow.co/2025/ai/
- **사실 경계:** 73%는 AI coding assistants 또는 coding agents 사용자 문항, 65.9%·62.5%는 업무상 AI 도구 문항 전체 응답자, 19.9%는 AI workflow 문항 응답자처럼 분모가 서로 다르다. 공개 집계는 production 권한 위임·자율 실행·원인을 측정하지 않으며 전체 개발자 모집단으로 일반화할 수 없다.
- **가장 가까운 기존 글:** `2026-09-25-coding-agent-operations-sandbox-permissions-opentelemetry.md`, `2026-06-06-tool-use-benchmark-ai-agents.md`.
- **반복 금지:** sandbox·OTel 구현 체크리스트, 일반 benchmark 비판.
- **고유 논지:** 서로 다른 문항의 높은 사용 빈도와 낮은 production 업무 활용률을 동일 응답자의 위임 격차로 오독하지 않는다. `read → propose → reversible write → guarded production action`은 조사 결론이 아니라 조직별 실행 로그로 검증할 운영 가설로 제안한다.

## 2. 프롬프트로 막지 말고 실행 경계에서 막아라 — 에이전트 샌드박스의 4계층

- **파일:** `_posts/2026-10-11-agent-sandbox-four-layer-boundary.md`
- **발표일/상태:** GitHub local sandboxing GA 2026-10-07. Strands Box는 같은 날 **developer preview**, Apache 2.0.
- **1차 출처:** https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available/
- **1차 출처:** https://aws.amazon.com/blogs/opensource/introducing-strands-box-ai-agent-sandboxes-powered-by-dogwood/
- **현재 문서:** https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes
- **사실 경계:** GitHub 발표의 GA 범위와, 일부 문서가 남긴 preview/experimental 문구가 충돌할 수 있으므로 발표·surface·OS별 문서 상태를 분리한다. Strands Box는 production GA로 쓰지 않는다.
- **가장 가까운 기존 글:** `2026-10-05-docker-sandbox-kit-authority-as-code.md`, `2026-09-25-coding-agent-operations-sandbox-permissions-opentelemetry.md`, `2026-05-24-cloudflare-claude-managed-agents-sandbox.md`.
- **반복 금지:** sandbox가 필요한 이유, requested/effective/enforced 일반 모델, OCI capability 설명.
- **고유 논지:** ① OS containment ② effect-level interception ③ credential injection ④ temporal tool policy를 비교한다. command string approval과 실제 파일·host·HTTP path 효과의 차이를 중심에 둔다.

## 3. 에이전트 권한은 Allowlist만으로 부족하다 — Dogwood Temporal Policy

- **파일:** `_posts/2026-10-11-dogwood-temporal-policy-agent-authorization.md`
- **발표일/상태:** Dogwood Local Engine 2026-09-30, Apache 2.0. Strands Box 통합은 2026-10-07 developer preview.
- **1차 출처:** https://aws.amazon.com/blogs/opensource/introducing-the-dogwood-local-engine-temporal-governance-for-agent-actions/
- **보조 출처:** https://aws.amazon.com/blogs/opensource/introducing-dogwood-runtime-verification-for-ai-agents/
- **보조 출처:** https://aws.amazon.com/blogs/opensource/introducing-strands-box-ai-agent-sandboxes-powered-by-dogwood/
- **사실 경계:** Local Engine은 verdict를 계산하지만 enforcement는 harness 책임이다. event integrity와 engine isolation이 전제다. safety는 제공하지만 liveness는 향후 방향이다.
- **가장 가까운 기존 글:** `2026-10-05-docker-sandbox-kit-authority-as-code.md`, `2026-09-25-mcp-runtime-governance-identity-authorization-audit.md`.
- **반복 금지:** call-time authorization 일반론, capability manifest.
- **고유 논지:** `green test within 15m`, 순서, 횟수, 누적 exposure 같은 trajectory 제약의 상태·동시성·crash recovery·atomic policy update를 분석한다.

## 4. 4천만 사용자를 위한 Postman Agent Mode — 모델보다 먼저 터진 세 가지 병목

- **파일:** `_posts/2026-10-11-postman-agent-mode-context-tool-budget.md`
- **발표일/상태:** Postman 엔지니어링 회고는 2026-03-24, Postman·AWS 공동 AWS 기술 글은 2026-10-09. 사용자 수는 developer community/audience이며 Agent Mode의 활성·동시 사용자 수와 동일시하지 않는다.
- **1차 출처:** https://aws.amazon.com/blogs/machine-learning/how-postman-runs-agent-mode-for-40-million-developers-on-amazon-bedrock/
- **사실 경계:** tool count 증가에 따른 오류, context handler, approval, geographic cross-Region inference, zero data retention, tiered cache를 공급자 사례로 귀속한다. 보편적 성능 보장으로 쓰지 않는다.
- **가장 가까운 기존 글:** `2026-06-06-agent-ready-cli-api-devtools.md`, `2026-09-25-agent-context-cache-cost-economics.md`.
- **반복 금지:** prompt caching 일반 최적화, CLI/API가 agent-ready여야 한다는 일반론.
- **고유 논지:** UI를 흉내 내는 agent가 아니라 schema-based reads, task-scoped tools, purpose-built context를 갖춘 product-native agent로 바꾸는 과정에 집중한다.

## 5. 사용자 토큰을 LLM에게 보여주지 않고 권한을 위임하는 법

- **파일:** `_posts/2026-10-11-ai-agent-token-identity-propagation.md`
- **발표일/상태:** AWS Security advanced how-to, 2026-10-06. Bedrock AgentCore·IAM Identity Center·Lake Formation을 사용한 deployable pattern이다.
- **1차 출처:** https://aws.amazon.com/blogs/security/identity-aware-ai-data-agents-with-aws-lake-formation-and-trusted-identity-propagation/
- **현재 문서:** https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-header-allowlist.html
- **현재 문서:** https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/common-use-cases.html
- **사실 경계:** `requestHeaderAllowlist`, Gateway의 `metadataConfiguration.allowedRequestHeaders`, Lambda의 `bedrockAgentCorePropagatedHeaders`, `onBehalfOf`를 AWS-specific 구현으로 명시한다. 모든 agent framework의 표준 필드로 일반화하지 않는다.
- **가장 가까운 기존 글:** `2026-09-25-coding-agent-iam-ephemeral-identity.md`, `2026-09-25-mcp-runtime-governance-identity-authorization-audit.md`.
- **반복 금지:** agent 자체 workload identity, 일반적인 ephemeral credential 설명.
- **고유 논지:** 사람의 token이 prompt·tool schema·trace·memory에 들어가지 않는 parallel transport와 data-layer authorization을 소유한다.

## 6. 코드 생성 비용이 낮아진 뒤 — Draft PR 제한이 드러낸 리뷰 수용량 병목

- **파일:** `_posts/2026-10-11-agent-generated-pr-review-bottleneck.md`
- **발표일/상태:** GitHub changelog 2026-10-08. Draft 포함 여부를 repository 설정에서 선택하는 기능이다.
- **1차 출처:** https://github.blog/changelog/2026-10-08-draft-pull-requests-count-toward-pull-request-limits/
- **현재 문서:** https://docs.github.com/en/communities/moderating-comments-and-conversations/limiting-interactions-in-your-repository
- **사실 경계:** 발표는 low-quality contribution과 spam 관리 동기를 밝히지만 증가분이 AI agent 때문이라는 인과 통계를 제공하지 않는다. 2026-10-11 기준 changelog, interaction 문서, REST schema의 범위가 일치하지 않으므로 문서 지연·UI/API 시차·단계적 rollout 가운데 어느 것인지 단정하지 않는다.
- **가장 가까운 기존 글:** `2026-10-05-copilot-code-review-api-quality-gate.md`, `2026-05-24-ai-agent-test-results-in-jira.md`.
- **반복 금지:** Copilot review API 상태 기계, Jira 증거 업로드.
- **고유 논지:** 외부 기여자별 creation cap, Draft counting, bypass, 최소 admission receipt, 방치 Draft 정리를 다룬다. 일반 factory queue와 reviewer WIP는 7번 글의 소유 범위로 남긴다.

## 7. AI 소프트웨어 팩토리는 에이전트를 많이 붙인다고 만들어지지 않는다

- **파일:** `_posts/2026-10-11-ai-software-factory-work-decomposition.md`
- **발표일/상태:** Vercel Engineering 사례, 2026-08-12. 자사 AI SDK 저장소 운영 결과인 vendor-reported case다.
- **1차 출처:** https://vercel.com/blog/building-a-software-factory-for-ai-sdk
- **사실 경계:** 100+ monthly issues, late-June 1,000+ issues와 약 800 PR, open issues 1,022→844, bugs 약 25% 감소는 Vercel 관측으로 귀속한다. agent만의 인과 효과로 확대하지 않는다.
- **가장 가까운 기존 글:** `2026-05-24-agent-team-jira-handoff-interface.md`, `2026-05-24-vercel-chat-sdk-ai-sdk-tools-agent.md`.
- **반복 금지:** Jira lifecycle command와 AI SDK 제품 기능 소개.
- **고유 논지:** reproduce/implement/backport 역할 경계, per-task sandbox·least-secret, human merge, 실패를 AGENTS.md와 workflow로 환류하는 factory economics를 다룬다.

## 8. Platform Engineering 2.0 — 개발자만을 위한 플랫폼은 왜 AI 시대에 부족한가

- **파일:** `_posts/2026-10-11-platform-engineering-ai-native-workloads.md`
- **발표일/상태:** CNCF 게스트 글 2026-07-06. “Platform Engineering 2.0”은 CNCF 표준이나 인증 명칭이 아니라 글 저자의 framework다.
- **1차 출처:** https://www.cncf.io/blog/2026/07/06/evolving-platform-engineering-for-ai-native-workloads
- **보조 출처:** https://www.cncf.io/announcements/2026/08/10/cncf-reveals-kubecon-cloudnativecon-north-america-2026-schedule-adds-new-ai-inference-agentic-track/
- **사실 경계:** five pillars와 maturity 방향은 framework 제안이다. KubeCon 발표의 82%·66% 수치는 CNCF survey 인용으로 귀속한다.
- **가장 가까운 기존 글:** Kubernetes AI gateway·GPU scheduling·coding agent operations 글들.
- **반복 금지:** 개별 Kubernetes 기능, generic platform engineering 정의.
- **고유 논지:** 기존 golden path를 버리지 않고 persona, accelerator, model endpoint, agent identity, evaluation, FinOps를 어떤 contract로 추가할지 단계적으로 제안한다.

## 9. 클라우드 모델과 로컬 모델을 함께 쓸 때 라우팅 기준은 무엇이어야 하는가

- **파일:** `_posts/2026-10-11-cloud-local-model-routing-criteria.md`
- **발표일/상태:** GitHub Copilot CLI 1.0.94-0 개선, 2026-10-07. Ollama runtime과 model 설치는 별도이며, tool calling·streaming 지원이 필요하다.
- **1차 출처:** https://github.blog/changelog/2026-10-07-discover-local-models-in-github-copilot-cli/
- **사실 경계:** local provider discovery는 offline mode를 자동 활성화하지 않고 telemetry도 끄지 않는다. remote provider는 offline mode에서도 network로 prompt/code를 받을 수 있다는 발표 경계를 유지한다. intelligent routing은 발표 시점 “stay tuned”이므로 이미 제공된 것으로 쓰지 않는다.
- **가장 가까운 기존 글:** `2026-09-25-multi-model-routing-cascade-critique.md`, `2026-03-28-alibaba-qwen-3-5-local-ai.md`, `2026-06-02-llm-app-cost-optimization.md`.
- **반복 금지:** single/cascade/critique 품질·비용 표, 로컬 모델 benchmark.
- **고유 논지:** provider 위치·offline·telemetry·tool authority를 분리하고 `data sensitivity × action risk × context size × latency/cost`로 route를 판정한다.

## 10. 1인 조직이 4%에서 10%로 늘었다 — AI 에이전트는 솔로 창업의 레버리지인가

- **파일:** `_posts/2026-10-11-solo-organization-ai-agent-leverage.md`
- **발표일/상태:** Stack Overflow 공식 2026 Survey 요약, 2026-10-06. “AI가 증가를 만들었다”는 공식 인과 결론이 아니라 글의 anecdotal 해석이다.
- **1차 출처:** https://stackoverflow.blog/2026/10/06/the-results-of-the-2026-developer-survey-are-here/
- **사실 경계:** organization of one 응답 4%→10%와 freelance/contractor/self-employed 비율이 대체로 비슷했다는 결과를 분리한다. 생존율·매출·고용 대체 효과를 만들지 않는다.
- **가장 가까운 기존 글:** `2026-03-07-Side-Project-One-Month-Retrospective.md`, `2026-03-05-AI-Assistant-One-Month-Honest-Review.md`.
- **반복 금지:** 특정 AI 도구 사용 후기, 일반적인 “AI가 일자리를 대체한다” 담론.
- **고유 논지:** build leverage와 company completeness를 분리한다. 제품·배포·지원·보안·회계·법무·영업의 owner map과 stop-the-line 조건을 통해 1인 운영의 병목을 드러낸다.

## 10편 상호 중복 금지선

- 1번은 **production 위임의 신뢰 격차**, 10번은 **1인 회사의 역할·책임 격차**를 소유한다.
- 2번은 **격리와 효과 집행 계층**, 3번은 **시간·순서·누적량이 있는 상태형 정책**을 소유한다.
- 4번은 **성숙 제품을 agent-readable하게 만드는 context/tool 설계**, 7번은 **오픈소스 유지보수 workflow의 factory 운영**을 소유한다.
- 5번은 **사람 identity의 transport와 data-layer authorization**, 기존 IAM 글은 **agent workload credential lifecycle**을 소유한다.
- 8번은 **조직 플랫폼 contract**, 9번은 **단일 요청의 model placement/routing contract**를 소유한다.
- 공통 보안 체크리스트를 모든 글에 복제하지 않는다. 각 글은 자신의 핵심 실패 모드와 검증 항목만 제시하고 관련 기존 글을 링크한다.
