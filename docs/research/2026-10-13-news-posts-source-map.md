# 2026-10-13 기술 뉴스 포스트 5편 source/overlap map

## Batch contract

- 기준 시각: 2026-10-13 KST
- 뉴스 범위: 2026-10-07~2026-10-12에 게시된 날짜가 확인되는 공식 원문
- 산출물: Jekyll `_posts` 5편
- 본문 길이: Sources·front matter 제외 편당 약 8,000~14,000자
- 인용 계약: 본문 `[n]`, 마지막 `## Sources`, 이어서 `[n] URL`
- 이미지 계약: 고유한 고정 seed Picsum URL을 `featured_image`와 첫 본문 이미지에 동일하게 사용
- 사실 경계: 공식 발표, 공급자 보고 수치, 필자의 운영 제안, 확인되지 않은 공백을 구분

## 1. GitHub Push Attribution

- 파일: `_posts/2026-10-13-github-push-attribution-commit-identity.md`
- 검색 의도: Git 커밋 author·committer·pusher·signer의 차이와 공급망 감사 설계
- 최종 제목: `Git 커밋의 author는 인증된 신원이 아니다: GitHub Push Attribution으로 다시 설계하는 공급망 감사`
- 날짜가 확인된 1차 원문: 2026-10-12 GitHub Changelog
- 주 출처: https://github.blog/changelog/2026-10-12-push-attribution-public-preview/
- 가장 가까운 기존 글: `2026-10-11-ai-software-factory-work-decomposition.md`, `2026-10-05-ai-generated-vulnerability-report-quality-gate.md`, `2026-09-25-mcp-supply-chain-delayed-tool-poisoning.md`
- 반복 금지: 일반적인 artifact provenance 체크리스트, AI PR 분해론, MCP provenance fingerprint
- 고유 논지: commit object의 self-asserted metadata와 서버가 인증한 push event identity를 분리하고, 서명·리뷰·빌드 identity까지 한 공급망 사건으로 연결한다.
- 결론: pusher는 author나 signer를 대체하지 않으며, 조직은 각 identity가 답하는 질문과 불일치 예외를 ruleset·audit query로 관리해야 한다.
- 경계: Limited public preview 및 GitHub Enterprise 범위를 GA처럼 쓰지 않는다. GitHub가 공개하지 않은 API 세부 필드는 제안으로만 둔다.

## 2. Agent Experience 평가

- 파일: `_posts/2026-10-13-agent-experience-evaluation-sdk-api.md`
- 검색 의도: SDK·API·CLI·MCP를 AI 에이전트가 발견하고 올바르게 쓰는지 측정하는 평가 방법
- 최종 제목: `문서가 정확해도 AI 에이전트는 API를 틀린다: Agent Experience를 측정하는 방법`
- 날짜가 확인된 1차 원문: 2026-10-09 Microsoft for Developers
- 주 출처: https://developer.microsoft.com/blog/introducing-the-agent-experience-ax-practitioner-playbook/
- 가장 가까운 기존 글: `2026-06-06-agent-ready-cli-api-devtools.md`, `2026-06-06-tool-use-benchmark-ai-agents.md`, `2026-10-11-postman-agent-mode-context-tool-budget.md`
- 반복 금지: 단순히 CLI/API/schema를 제공하라는 체크리스트, 일반적인 benchmark 정확도론, tool 수를 줄이라는 Postman 논지
- 고유 논지: propensity와 efficacy를 분리하고, 결과 readout보다 trajectory로 extension 미로딩·미선택·오사용을 구분해 제품 surface 변경을 가설 검증한다.
- 결론: AX는 문서 마케팅 지표가 아니라 동일 fixture로 docs·CLI·MCP 변경의 효과를 재현하는 제품 회귀 평가다.
- 경계: Microsoft 사례 수치와 95% skill 점수는 공급자 평가로 귀속하고 보편 성능으로 일반화하지 않는다.

## 3. SOC agent 권한 단계

- 파일: `_posts/2026-10-13-soc-agent-authorization-boundaries.md`
- 검색 의도: SOC/MDR AI agent에서 조사와 대응 권한을 단계적으로 위임하는 운영 설계
- 최종 제목: `89초 평균 대응: SOC 에이전트의 Notify·Collaborate·Authorize 경계`
- 날짜가 확인된 1차 원문: 2026-10-09 OpenAI/Sophos 사례
- 주 출처: https://openai.com/index/sophos/
- 가장 가까운 기존 글: `2026-10-05-ai-agent-unsanctioned-cyber-incident-control-failures.md`, `2026-09-25-coding-agent-operations-sandbox-permissions-opentelemetry.md`
- 반복 금지: sandbox·egress 일반론, 비인가 사이버 평가 사고의 재서술, 공통 observability 체크리스트
- 고유 논지: evidence collection·plan·review·response를 분리하고 Notify/Collaborate/Authorize를 action class와 mandate로 강제한다. 평균 조사 시간 대신 잘못된 격리와 재개방을 측정한다.
- 결론: 조사 자동화율과 대응 자율성은 같은 지표가 아니며, destructive action은 별도 권한·read-back·rollback 계약을 가져야 한다.
- 경계: 89초, 96%, 52%는 OpenAI와 Sophos가 공개한 vendor/customer-reported 결과이며 독립 benchmark가 아니다.

## 4. Browser agent context cache

- 파일: `_posts/2026-10-13-browser-agent-context-cache-cost.md`
- 검색 의도: 브라우저 agent의 screenshot·history mutation이 prompt cache 비용과 지연에 미치는 영향
- 최종 제목: `브라우저 에이전트 비용을 줄인 메커니즘: 캐시 가능한 대화 이력과 배치 정리`
- 날짜가 확인된 1차 원문: 2026-10-08 StackAI/Asana 연구, 2026-10-09 OpenAI 사례
- 주 출처: https://asana.com/inside-asana/cut-browsers-agent-cost
- 가장 가까운 기존 글: `2026-09-25-agent-context-cache-cost-economics.md`, `2026-06-02-llm-app-cost-optimization.md`, `2026-10-11-cloud-local-model-routing-criteria.md`
- 반복 금지: prompt caching 입문, 공급자별 일반 가격 비교, 모델 라우팅 의사결정표
- 고유 논지: longest unchanged prefix 관점에서 매 step screenshot 삭제와 history trimming이 cache를 깨는 과정을 분석하고, batch pruning을 비용·정확도·privacy retention의 교환으로 평가한다.
- 결론: 모델 단가가 아니라 성공한 workflow당 비용과 cache invalidation event를 계측해야 한다.
- 경계: 76배·5배·$0.47은 특정 task의 144개 계획 run 중 143개를 분석한 공급자 보고 결과이며 일반 절감률이 아니다.

## 5. AI secret detection Push Gate

- 파일: `_posts/2026-10-13-ai-secret-detection-push-gate.md`
- 검색 의도: 문맥 기반 AI secret detection을 push protection·security review·예산 정책과 결합하는 방법
- 최종 제목: `정규식이 못 잡는 비밀번호: AI 시크릿 탐지를 Push Gate에 넣기 전에 설계할 것들`
- 날짜가 확인된 1차 원문: 2026-10-07 GitHub Changelog
- 주 출처: https://github.blog/changelog/2026-10-07-purpose-built-model-for-leaked-secret-detection/
- 가장 가까운 기존 글: `2026-10-05-codex-security-vulnerability-validation-pipeline.md`, `2026-10-05-ai-generated-vulnerability-report-quality-gate.md`
- 반복 금지: 일반 취약점 candidate→reproduction pipeline, 취약점 신고 접수 schema, sandbox 재현 체크리스트
- 고유 논지: deterministic detector와 context classifier를 cascade로 두고, push-time fail-open/fail-closed, rotation, 예산 소진, generated artifact 우회를 하나의 운영 계약으로 묶는다.
- 결론: AI 탐지는 secret lifecycle을 대체하지 않으며, 탐지 서비스 장애·오탐·크레딧 소진 때의 정책이 보안 수준을 결정한다.
- 경계: alert scan 자동 업그레이드, private preview, coming soon, AI Credit 과금 계획을 서로 구분한다.
