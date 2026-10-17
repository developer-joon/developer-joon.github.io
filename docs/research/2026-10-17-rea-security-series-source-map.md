# REA·에이전트 보안 포스트 4편 Source/Overlap Map

- 기준 시각: 2026-10-17 15:52 KST
- 요청 수량: 4편
- 분류: 1편은 최신 오픈소스 릴리스 딥다이브, 2~4편은 사용자가 요청한 연계 실전 가이드
- 기준 저장소: `morluto/rea`
- 검토한 REA release: `rea-agents-6.5.0` (`3b79af28e80785afce9f5998d8f03289402a1847`, 2026-10-14)
- 조사 시점 REA `main`: `5b243993872c2bcc70cb00060ffb79b347321370`
- 라이선스: release와 조사 시점 `main` 모두 MIT이며 LICENSE SHA-256은 `798f9e4d18e49b30bf2f12696c8ced73dc4e1413da375a333d01281543a1ea8b`
- 배너: 신규 파일을 만들지 않고 각 slug의 고정 seed Picsum `1600×900`을 front matter와 첫 본문 이미지에 동일하게 사용

## 1. REA 딥다이브

- 출력: `_posts/2026-10-17-rea-agent-reverse-engineering-guide.md`
- 게시 시각: `2026-10-17 13:10:00 +0900`
- 제목: `REA 딥다이브: AI 에이전트의 역공학 도구와 안전 경계`
- 검색 의도: REA가 무엇이고 실제로 어떤 분석 엔진과 증거 흐름을 제공하며 어떻게 안전하게 평가하는지 알고 싶은 독자
- dated primary source: `rea-agents 6.5.0` release, 2026-10-14
- 주요 근거:
  - REA README와 6.5.0 tag 문서
  - npm `rea-agents@6.5.0` package metadata
  - process capture·MCP prompts·native/application/firmware analysis 문서
- 가장 가까운 기존 글:
  - `2026-02-20-MCP-What-Is-Model-Context-Protocol.md`
  - `2026-10-11-agent-sandbox-four-layer-boundary.md`
- 반복 금지:
  - MCP 일반 개념과 서버 구축 방법
  - 범용 에이전트 샌드박스 4계층 전체 설명
- 고유 논지: REA는 범용 디컴파일러나 원본 소스 복원기가 아니라, 기존 분석기와 에이전트를 evidence 중심 workflow로 연결하는 도구다. 정적 관찰·동적 실행·추론을 구분하고 허가된 sample로만 평가한다.
- 결론: 도입 기준은 “앱을 복제했는가”가 아니라 evidence provenance, residual unknown, 재현 가능성, 격리 경계를 제공하는가다.
- 사실 경계:
  - official fact: 지원 target, requirements, security model, release/package/license
  - vendor/project result: 공식 showcase 결과는 프로젝트 보고로 표시
  - operational interpretation: 격리 VM·네트워크 차단·승인 gate는 운영 권고
  - organization extension: evidence ledger schema와 평가 점수는 REA 표준이 아님을 명시

## 2. AI 역공학의 정답 조건

- 출력: `_posts/2026-10-17-ai-reverse-engineering-recompilation-proof.md`
- 게시 시각: `2026-10-17 13:20:00 +0900`
- 제목: `AI 역공학의 정답 조건: 재컴파일과 동작 동등성 검증`
- 검색 의도: LLM이 생성한 pseudocode가 실제 바이너리를 복원했다고 말하려면 무엇을 검증해야 하는지 알고 싶은 독자
- dated primary source: OtterSec `Breaking open a propAMM`, 2026-10-15
- 주요 근거:
  - OtterSec GoonFi V2 decompilation 사례
  - OtterSec Hyperliquid risk engine 선행 사례
  - `otter-sec/bn-ebpf-solana` commit `c3fe0de45d37eb68dcb08f2498c6e1f986056572` (2026-10-17 15:52 KST 조회)
  - REA 6.5.0 고정 README의 reconstruction showcase와 Process Capture 문서
- 가장 가까운 기존 글:
  - `2026-10-05-codex-security-vulnerability-validation-pipeline.md`
  - `2026-10-05-ai-generated-vulnerability-report-quality-gate.md`
- 반복 금지:
  - 일반 취약점 접수·patch·disclosure 상태 전이
  - REA 설치와 전체 기능 소개
- 고유 논지: 읽기 쉬운 pseudocode는 정답이 아니다. ABI·입출력·부작용·edge case·instruction 또는 byte-level similarity를 서로 다른 증거 축으로 검증하고, exact binary match도 과적합 가능성을 별도 심사해야 한다.
- 결론: “설명 가능”에서 “검증 가능”으로 성공 기준을 옮겨야 한다.
- 사실 경계:
  - vendor/research result: GoonFi의 exact binary·취약점 결과는 OtterSec 자체 연구로 귀속
  - operational interpretation: 다층 equivalence gate와 negative control은 이 글의 제안
  - 미검증: 다른 compiler·architecture·binary로 일반화하지 않음

## 3. Burp·Ghidra·LLDB 에이전트 연구 워크플로

- 출력: `_posts/2026-10-17-agent-security-research-burp-ghidra-lldb.md`
- 게시 시각: `2026-10-17 13:30:00 +0900`
- 제목: `Burp·Ghidra·LLDB를 연결한 에이전트 보안 연구 워크플로`
- 검색 의도: 웹 요청, 정적 바이너리 구조, 런타임 값을 하나의 에이전트 조사로 연결하되 권한과 증거를 분리하는 방법
- dated primary source: Meta `Zurp is now open source`, 2026-10-01
- 주요 근거:
  - Meta Zurp 공개 글
  - Meta `Muse Code for Security Research`
  - PortSwigger deliberately vulnerable labs와 Burp MCP 설명
  - 제3자 MCP 프로젝트 `clearbluejar/pyghidra-mcp` commit `42d8f80551a765441b1a723f6f1ff45aa3914d5e`, `stass/lldb-mcp` commit `a610f2d0d3835739c41762352442ba2a13958b38` (2026-10-17 15:52 KST 조회)
  - `facebookincubator/Zurp` commit `b1552f20e83ada58fc9bcb8c305f92baa62250ec` (2026-10-17 15:52 KST 조회)
- 가장 가까운 기존 글:
  - `2026-10-13-soc-agent-authorization-boundaries.md`
  - `2026-10-11-agent-sandbox-four-layer-boundary.md`
- 반복 금지:
  - SOC containment·rollback 정책
  - 범용 command/effect sandbox 설명
  - MCP identity·call-time authorization 일반론
- 고유 논지: 동일 finding에 대한 Burp HTTP evidence → Ghidra static evidence → LLDB runtime evidence의 결합·충돌·재현 절차를 중심에 둔다. 에이전트는 조율자이고 finding 판정자는 아니다. 각 claim에 도구 출처를 붙이며 일반 MCP 보안론은 기존 글로 연결만 한다.
- 결론: 도구를 많이 연결하는 것보다 claim-to-evidence graph와 scope enforcement가 중요하다.
- 사실 경계:
  - official fact: Meta guide의 예제 구성과 Zurp 공개 범위
  - gated boundary: Meta-side capability와 token 접근은 공개 client code와 분리
  - operational interpretation: read-only 기본값, scope hook, finding 승격 schema

## 4. 악성 artifact의 prompt injection 방어

- 출력: `_posts/2026-10-17-malicious-artifact-prompt-injection-defense.md`
- 게시 시각: `2026-10-17 13:40:00 +0900`
- 제목: `악성 바이너리도 에이전트를 속인다: 분석 artifact의 Prompt Injection 방어`
- 검색 의도: 바이너리 문자열, decompiler 주석, 웹 응답, README, tool result에 숨은 지시가 분석 에이전트의 행동으로 승격되는 것을 막는 방법
- dated project source: REA 6.5.0 security model, 2026-10-14
- practitioner commentary: OWASP `Memory Is a Feature. It Is Also an Attack Surface`, 2026-05-13 (규범 문서가 아님)
- 주요 근거:
  - OWASP LLM01 Prompt Injection
  - OWASP Agentic Top 10의 goal hijack·tool misuse·supply chain·memory poisoning 경계
  - OWASP third-party MCP security guide
  - REA MCP prompt contract와 process capture security model
- 가장 가까운 기존 글:
  - `2026-02-18-AI-News-Feb-2026.md`
  - `2026-09-25-mcp-supply-chain-delayed-tool-poisoning.md`
  - `2026-09-25-mcp-runtime-governance-identity-authorization-audit.md`
  - `2026-09-25-openai-agents-api-managed-harness.md`
  - `2026-10-11-aws-commerce-ai-assistant-transaction-boundary.md`
  - `2026-10-11-agent-sandbox-four-layer-boundary.md`
- 반복 금지:
  - prompt injection 일반 정의만 반복
  - MCP tool definition fingerprint, OAuth, 일반 egress, credential rotation
  - 구매·결제 tool의 멱등성·상거래 승인 경계
  - OS sandbox 4계층의 전체 재설명
- 고유 논지: MCP 서버 정의 변경이나 일반 웹/RAG 입력이 아니라, 분석 대상 artifact에서 파생된 문자열·주석·심볼·decompiler 및 tool output이 control plane으로 승격되는 경로만 다룬다. 보안 분석 대상은 신뢰할 수 없는 **증거**이지 실행 지시가 아니다. artifact data, analyst instruction, tool control plane, persistent memory를 별도 channel로 둔다.
- 결론: 모델에게 “무시하라”고 말하는 prompt보다 권한·data flow·persistent state를 구조적으로 분리해야 한다.
- 사실 경계:
  - official fact: OWASP 분류 문서의 공격 유형·완화 원칙, REA 문서의 target/process 권한 경계
  - practitioner commentary: OWASP 2026-05-13 MemoryTrap 글은 ASI06 공동 책임자의 해설이며 규범 문서로 취급하지 않음
  - operational interpretation: REA의 권한 경계를 artifact taint model로 확장한 taint label, evidence quarantine, promotion gate, fixture matrix
  - 공격 코드는 제공하지 않고 방어용 inert fixture만 설명

## 배치 공통 검증

1. 파일 수 4개와 위 경로 exact match.
2. 각 글의 first-seen citation과 Sources가 연속 `1..N`.
3. primary source와 source-bearing sentence semantic entailment 독립 검토.
4. 네 글 사이 서론·표·결론·보안 체크리스트 중복 검토.
5. `humanize-korean`은 grounding 이후 보수적으로 적용하고 보호 span 및 의미를 재검토.
6. 각 고정 seed Picsum URL이 HTTP 성공·1600×900이며 front matter와 첫 본문 이미지가 동일.
7. Docker/Jekyll 전체 빌드 후 4개 exact route의 제목·본문 marker·Sources 확인.
8. feature branch만 push. `master` 직접 push, merge, Pages 배포 금지.

## 검토할 고정 permalink

- REA 6.5.0 source: https://github.com/morluto/rea/tree/3b79af28e80785afce9f5998d8f03289402a1847
- REA 6.5.0 release: https://github.com/morluto/rea/releases/tag/rea-agents-6.5.0
- REA process capture: https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/process-capture.md
- REA MCP prompts: https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/mcp-prompts.md
- OtterSec GoonFi: https://osec.io/blog/goonfi-decompilation/
- OtterSec bn-ebpf-solana: https://github.com/otter-sec/bn-ebpf-solana/tree/c3fe0de45d37eb68dcb08f2498c6e1f986056572
- Meta Zurp announcement: https://bugbounty.meta.com/blog/zurp-open-source/
- Meta Muse security research guide: https://bugbounty.meta.com/learn/articles/muse-code-security-research/
- Zurp source: https://github.com/facebookincubator/Zurp/tree/b1552f20e83ada58fc9bcb8c305f92baa62250ec
- pyghidra-mcp: https://github.com/clearbluejar/pyghidra-mcp/tree/42d8f80551a765441b1a723f6f1ff45aa3914d5e
- lldb-mcp: https://github.com/stass/lldb-mcp/tree/a610f2d0d3835739c41762352442ba2a13958b38
- OWASP LLM01: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP Agentic Top 10 announcement: https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/
- OWASP third-party MCP guide: https://genai.owasp.org/resource/cheatsheet-a-practical-guide-for-securely-using-third-party-mcp-servers-1-0
- OWASP MemoryTrap commentary: https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/
