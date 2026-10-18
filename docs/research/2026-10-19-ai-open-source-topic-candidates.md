# 2026-10-19 AI 오픈소스 포스팅 후보

- 조사 시각: 2026-10-19 07:43 KST
- 최근성 범위: 2026-09-19~2026-10-19
- 저장소 기준: `origin/master` `8210fd28979f1413d0be6614c1a10e26bc230c24`
- 결과 성격: 포스트 초안이 아닌 **후보 조사 문서**
- 검색어: `October 2026 open source AI release`, `open weights model release October 2026`, `Hugging Face September 2026 local inference`, `GitHub trending AI October 2026`

## 선정 원칙

1. 공식 발표와 실제 공개 artifact가 모두 있어야 한다.
2. 코드·weights·data의 라이선스를 구분한다.
3. 직접 재현할 수 있는 독립적인 실습 질문이 있어야 한다.
4. 누적 star나 공급자 benchmark만으로 “급상승” 또는 성능 우위를 단정하지 않는다.
5. 이미 발행된 Run:ai, Olmo-core 3, Reflection Beam, REA, Granite Switch, UltraBERT, FLUX.3 Image Klein 글과 중심 논지가 겹치면 제외한다.

## 추천 순위

### 1. AstaBrief 8B — 로컬 PDF에서 인용 가능한 연구 보고서를 만들 수 있는가

**추천 제목**

> AstaBrief 8B 실전: 로컬 PDF 보고서의 인용 정확도를 검증하는 법

Ai2는 2026년 10월 2일 연구 질문과 검색된 문헌 excerpt를 받아 인용 포함 보고서를 생성하는 AstaBrief 8B를 공개했다. 공식 발표는 model weights뿐 아니라 training data와 자체 PDF에 적용할 수 있는 예제 workflow도 함께 공개했다고 설명한다.[1]

모델 카드의 현재 artifact는 비공개·gated가 아니며 Apache-2.0이고, 조사 시점 기준 최근 다운로드 2,124회와 like 68개를 기록했다.[2] 학습 과정의 model·dataset collection도 공개되어 있다.[3]

다만 DPO와 SFT dataset은 각각 CC BY-NC 4.0이며 model weights와 같은 라이선스가 아니다.[4][5] PDF 보고서 예제는 `ai2-scholarqa-lib`의 고정 커밋 `95a5cf01c47e27ee6dac28d0653818c7ecc581c3`에서 검토할 수 있다.[6]

- **공개 분류:** model weights는 Apache-2.0 open-weight, 예제 코드는 Apache-2.0, 공개 SFT·DPO data는 CC BY-NC 4.0이다. Artifact가 함께 공개됐어도 같은 이용 조건은 아니며, 모든 원천 문헌과 teacher model을 완전히 재현할 수 있다는 뜻도 아니다.
- **왜 지금:** 최근 공개 artifact가 실제로 내려받을 수 있고, “보고서 생성”을 citation entailment와 evidence coverage로 평가하는 실전 주제가 된다.
- **실습 축:** 동일 PDF 묶음과 질문을 고정하고 citation precision, citation recall, unsupported sentence, source-span 재현율, latency를 비교한다.
- **검색 의도:** `로컬 AI 논문 보고서`, `AstaBrief 사용법`, `LLM 인용 정확도 검증`.
- **기존 글과 구분:** 기존 RAG 파이프라인 글의 검색·벡터 DB 설명을 반복하지 않는다. 검색 결과가 이미 주어진 뒤 **보고서 문장과 인용 근거가 실제로 연결되는지**에만 집중한다.
- **사실 경계:** 공식 글의 51.1초 대 178.5초는 Ai2의 전체 Asta pipeline 측정이다. 임의의 8B 모델 대비 일반적인 3.5배 성능 향상으로 확대하지 않는다.

### 2. Transformers의 GGUF 실행 — Apple Silicon에서 packed quant를 유지하기

**추천 제목**

> Apple Silicon Transformers GGUF: packed Q4·Q5·Q6의 메모리와 품질 비교

Hugging Face는 2026년 9월 22일 Transformers에서 GGUF checkpoint를 packed 상태로 실행하고 ggml kernel을 재사용하는 경로를 공개했다.[7] 공식 글은 초기 범위를 Apple Silicon과 Qwen3.5 중심으로 한정하고, 호환 kernel이 없으면 dequantization 또는 SDPA fallback으로 메모리·성능 특성이 달라질 수 있다고 명시한다. Apple Silicon 문서도 `ggml-org/ggml-quantization` kernel을 사용할 수 있을 때만 GGUF weights가 MPS에서 packed 상태를 유지한다고 설명한다.[8] 작성 시점에는 다음 stable release가 아니라 `transformers` main 설치를 요구했다. 비교 기준 main snapshot은 `d4804f9d76b8c071b993d813e9e87067b780cbee`이며 해당 revision의 LICENSE는 Apache-2.0이다.[9]

- **공개 분류:** Apache-2.0 open-source software. 실행할 GGUF model의 weights license는 model별로 다시 확인해야 한다.
- **왜 지금:** 지원되는 Apple Silicon·Qwen3.5·ggml kernel 조합에서는 llama.cpp용 quant를 별도 변환 없이 packed 상태로 유지하면서 Transformers의 hook·evaluation·custom generation 흐름에서 다룰 수 있는 새 연결점이다.
- **실습 축:** 같은 model·prompt·seed에서 BF16, Q6_K, Q5_K_M, Q4_K_M의 resident memory, load time, tokens/s, task score를 기록한다. kernel fallback 발생 여부도 결과에 포함한다.
- **검색 의도:** `Apple Silicon Transformers GGUF`, `MPS packed GGUF`, `Qwen3.5 Q4 Q5 Q6 품질 비교`.
- **기존 글과 구분:** 기존 클라우드·로컬 모델 라우팅 글과 일반 GGUF 로딩 설명을 반복하지 않는다. **Apple Silicon에서 compatible kernel 사용 여부에 따라 packed 실행과 fallback이 어떻게 달라지는지**에 범위를 고정한다.
- **사실 경계:** 공식 benchmark는 측정 경로가 완전히 같지 않으므로 절대 성능 순위로 쓰지 않는다. 지원 architecture·kernel·stable release 범위는 실제 작성 시점에 다시 확인한다.

### 3. Holo4 — computer-use 성능보다 공개 trajectory를 먼저 검증하기

**추천 제목**

> Holo4 computer-use 모델 검증: 성공률보다 7,366개 공개 trajectory를 읽는 법

H Company는 2026년 9월 28일 GUI, code, MCP, API를 오가는 Holo4 computer-use 모델 두 종류와 여러 quant format을 공개했다.[10]

두 weight의 라이선스는 다르다. Holo4-35B-A3B는 Apache-2.0이고 조사 시점 다운로드 2,429회·like 35개였지만,[11] Holo4-27B는 CC BY-NC 4.0이며 다운로드 1,434회·like 99개였다.[12] 두 모델의 최근 다운로드 합계는 3,863회지만 이는 고유 사용자나 실제 배포 수가 아니다.

공개 benchmark trajectory dataset은 7,366개 run을 담고 Apache-2.0으로 표시되지만 upstream task content의 원래 라이선스는 별도로 유지된다.[13] 실행 harness는 MIT 코드이며 검토 기준 커밋은 `debc66e44a96569092f262938a84c8cde68cc297`다.[14]

- **공개 분류:** 35B-A3B는 Apache-2.0 open-weight, 27B는 non-commercial source-available/open-weight. 두 모델을 하나의 “완전 오픈소스”로 묶지 않는다.
- **왜 지금:** 최종 점수만이 아니라 screenshot, action, tool result, verifier result가 포함된 trajectory를 내려받아 실패 유형을 재분류할 수 있다.
- **실습 축:** 허가된 fixture에서 navigation error, stale observation, destructive action, verifier mismatch를 분류하고 공개 trajectory schema와 비교한다. 실제 계정이나 외부 서비스는 조작하지 않는다.
- **검색 의도:** `Holo4 로컬 실행`, `computer use agent trajectory`, `GUI agent benchmark 검증`.
- **기존 글과 구분:** 기존 Copilot Computer Use 글의 승인·desktop 보안 일반론을 반복하지 않는다. **공개 trajectory 검사, 실패 재분류, verifier 결과 감사**에 집중한다. 환경 replay는 별도 package와 복원 계약이 확인되기 전까지 범위에서 제외한다.
- **사실 경계:** 공개 trajectory는 감사 가능성을 높이지만 benchmark 환경과 외부 앱 상태를 완전히 재현한다는 보장은 아니다. 공급자가 보고한 성공률을 독립 benchmark로 표현하지 않는다.

### 4. LocalAI 4.11 — streaming 시작 전 failover만 허용하는 이유

**추천 제목**

> LocalAI 4.11 모델 failover: 응답이 시작된 뒤 재시도하면 안 되는 이유

LocalAI 4.11은 2026년 10월 2일 공개됐으며, 하나의 public model name 뒤에 local·remote target을 순서대로 두는 failover chain을 추가했다.[15][16] 공식 설명상 transport error, server error, OOM, rate limit은 다음 target으로 넘길 수 있지만 validation error, 일반 client error, cancellation은 target을 unhealthy로 만들지 않는다. 재시도는 response가 commit되기 전에만 수행한다. Release tag `v4.11.0`은 커밋 `58830f7ac508845a6f4efa32cfca06af422d4d82`를 가리킨다.[17] 저장소는 MIT이고 조사 시점 누적 star는 49,621개였다.

- **공개 분류:** MIT open-source software. 연결되는 local·remote model의 weights와 API 약관은 별도다.
- **왜 지금:** 기존 글이 설명한 일반 timeout·cancel·fallback 상태 머신을 반복하는 대신, LocalAI가 실제 response commitment를 어디서 판정하고 어떤 관측값을 남기는지 제품 수준에서 검증할 수 있다.
- **실습 축:** local target 정상, 시작 전 OOM, rate limit, 첫 token 이후 연결 종료를 fixture로 만들어 response commit 전후에 target 전환·header·event가 어떻게 달라지는지 검증한다. `X-LocalAI-Served-Model`, `X-LocalAI-Failover`와 중복 token 여부도 함께 기록한다.
- **검색 의도:** `LocalAI failover`, `로컬 LLM 장애 전환`, `streaming 재시도 중복 응답`.
- **기존 글과 구분:** `_posts/2026-09-25-multi-model-routing-cascade-critique.md`가 이미 timeout·cancel·fallback 상태 머신, 오류 분류, idempotency를 다룬다. 새 글은 일반 원리를 다시 설명하지 않고 **LocalAI 4.11의 첫 token 전후 fixture와 실제 header·event 관측 결과**에만 집중한다.
- **사실 경계:** release의 243개 merged PR과 353개 commit은 공급자 release 집계다. 안정성·처리량 개선을 독립 측정한 결과가 아니다.

## 이번 후보에서 제외

### Liquid AI d1 decision models

2026년 10월 7일 d1-3B와 d1-omni-600M이 공개됐다.[18] 그러나 model metadata의 license는 표준 Apache-2.0이 아니라 LFM Open License v1.0이다. 연 매출 1,000만 달러를 넘는 기업의 무료 commercial use를 제한하므로 OSI식 open source나 제한 없는 open-weight로 분류하면 안 된다.[19] 또한 “생성 대신 typed decision”이라는 중심 논지는 기존 `Cloudflare Clef` 글과 겹친다. 라이선스 비교나 multimodal edge decision이라는 별도 질문이 승인되기 전에는 후보에서 제외한다.

### 이미 다룬 최근 주제

- NVIDIA Run:ai open-source GPU orchestration
- Olmo-core 3 MoE training system
- Reflection Beam 501B open-weight inference
- REA agent reverse engineering
- Granite Switch, UltraBERT, FLUX.3 Image Klein

이 프로젝트들은 현재 `origin/master`에 독립 포스트가 있으므로 새 후보에서 제외했다.

## 다음 작성 우선순위

1. **AstaBrief 8B** — 독립 검색 의도가 가장 분명하고 model·data·example workflow가 함께 있지만, model/code의 Apache-2.0과 data의 CC BY-NC 4.0을 분리해 다뤄야 한다.
2. **Transformers GGUF** — Apple Silicon packed quant 비교가 가능하지만 stable release 포함 여부와 compatible kernel을 작성 시점에 다시 확인해야 한다.
3. **Holo4 trajectory** — 공급자 benchmark를 반복하지 않고 공개 trace를 감사하는 방향이면 기존 글과 구분된다.
4. **LocalAI failover** — 운영 가치가 높지만 단순 release 소개가 아니라 failure semantics fixture가 필수다.

## Sources

[1] https://allenai.org/blog/astabrief — Open-sourcing AstaBrief, the fast report-generation model in Asta
[2] https://huggingface.co/allenai/AstaBrief_8B — AstaBrief 8B model card
[3] https://huggingface.co/collections/allenai/astabrief — AstaBrief model and training-data collection
[4] https://huggingface.co/api/datasets/allenai/AstaBrief_DPO_Mix — AstaBrief DPO dataset metadata
[5] https://huggingface.co/api/datasets/allenai/AstaBrief_SFT_Mix — AstaBrief SFT dataset metadata
[6] https://github.com/allenai/ai2-scholarqa-lib/tree/95a5cf01c47e27ee6dac28d0653818c7ecc581c3/api/scholarqa/lite — ScholarQA Lite example workflow
[7] https://huggingface.co/blog/transformers-llama-cpp-quants — Transformers now runs llama.cpp quants
[8] https://huggingface.co/docs/transformers/apple_silicon — Transformers Apple Silicon guide
[9] https://github.com/huggingface/transformers/blob/d4804f9d76b8c071b993d813e9e87067b780cbee/LICENSE — Transformers pinned Apache-2.0 license
[10] https://huggingface.co/blog/Hcompany/holo4 — Holo4: powering generalist computer-use agents
[11] https://huggingface.co/Hcompany/Holo4-35B-A3B/tree/508458727831368da85d53a8055c2b0f923ed4f3 — Holo4-35B-A3B pinned model snapshot
[12] https://huggingface.co/Hcompany/Holo4-27B/tree/4de03cfeee1d930b616bfd4817570293f29ad8b9 — Holo4-27B pinned model snapshot
[13] https://huggingface.co/datasets/Hcompany/trajectories — Holo4 benchmark trajectories dataset
[14] https://github.com/hcompai/hai-agents-python/commit/debc66e44a96569092f262938a84c8cde68cc297 — Holo4 agent harness snapshot
[15] https://localai.io/blog/what-landed-in-localai-4-11 — What landed in LocalAI 4.11
[16] https://github.com/mudler/LocalAI/releases/tag/v4.11.0 — LocalAI v4.11.0 release
[17] https://github.com/mudler/LocalAI/commit/58830f7ac508845a6f4efa32cfca06af422d4d82 — LocalAI v4.11.0 tag commit
[18] https://huggingface.co/blog/LiquidAI/open-d1 — Multimodal open d1 decision models for the edge
[19] https://www.liquid.ai/lfm-license — LFM Open License v1.0
