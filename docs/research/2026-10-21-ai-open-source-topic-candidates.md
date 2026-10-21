# 2026-10-21 AI 오픈소스 포스팅 후보

- 조사 시각: 2026-10-21 04:00 KST
- 최근성 범위: 2026-09-21~2026-10-21
- 저장소 기준: `origin/master` `d095d56ba8876d6b3fa07cceab3b38491df0e406`
- 조사 범위: 최신 `origin/master`의 `_posts` 202편 전체와 `docs/research` 이력
- 결과 성격: 포스트 초안이 아닌 **후보 조사 문서**
- 검색어: `October 20 2026 open source AI release`, `October 2026 open weights model release`, `Hugging Face October 20 2026 benchmark`, `GitHub AI release October 2026`

## 선정 원칙

1. 공식 발표뿐 아니라 repository, release/tag, model card, package metadata, 라이선스를 실제로 확인한다.
2. 코드·weights·data·recipe의 공개 범위와 이용 조건을 분리한다.
3. 최근 30일 안의 공개물 중 직접 재현할 수 있는 독립적인 실습 질문이 있어야 한다.
4. 누적 star, download, 공급자 benchmark를 인기 상승률이나 독립 성능으로 바꾸어 말하지 않는다.
5. 기존 글과 10월 19~20일 조사 후보의 프로젝트·중심 논지·결론을 반복하지 않는다.
6. 조사한 공식 채널과 위 검색어에서는 기준 시각까지 10월 21일자 신규 공개를 확인하지 못했다. 따라서 10월 20일 공개물을 최우선으로 두고 30일 범위 안에서 보완했다.
7. Downloadable·ungated artifact라도 적용 라이선스가 서로 충돌하면 추천하지 않는다. Preview-only, manual gate, runtime 미통합, 상업 제한 custom license는 제외·보류에서 따로 설명한다.

## 추천 순위

### 1. FairStress — 같은 정답 뒤에 숨은 설득 취약성은 집단별로 대칭적인가

**추천 제목**

> FairStress 실전: LLM의 최종 선택보다 설득에 흔들리는 방향을 측정하기

Ai2는 2026년 10월 20일 FairStress를 공개했다. 이 benchmark는 demographic swap 뒤 최종 선택만 비교하지 않고, 더 약한 후보를 지지하는 동일한 adversarial prefix를 제시했을 때 올바른 결정을 포기하는 정도가 집단에 따라 달라지는지 측정한다.[1]

공개 저장소에는 29개 고위험 domain, 300개 2인 비교 scenario, 33개 minority/majority contrast, 78개 adversarial prefix와 네 가지 metric의 scoring code가 있다. 코드는 MIT, dataset은 CC BY 4.0으로 분리된다.[2]

- **공개 분류:** MIT open-source software와 CC BY 4.0 benchmark data다. Model weights를 공개하는 프로젝트는 아니다.
- **왜 지금:** 10월 20일 공식 공개물이며, 단순 accuracy parity와 decision robustness parity를 분리하는 실행 가능한 평가 질문이 있다.
- **실습 축:** matched pair와 prefix를 고정하고 공식 네 metric인 Accuracy Gap, Robustness Gap, Tie-Break Lean, Tie-Break Shift를 측정한다. Correct-answer abandonment와 switch direction은 별도 파생 분석으로 표시하고, 같은 model revision·prompt·seed를 고정한다.
- **검색 의도:** `LLM 공정성 벤치마크`, `AI 채용 결정 편향 테스트`, `adversarial prefix fairness`.
- **기존 글과 구분:** 기존 규제 글의 bias-audit 의무나 일반적인 subgroup 평가 권고를 반복하지 않는다. **결과가 같아도 반론에 대한 견고성이 비대칭일 수 있는지**에만 집중한다.
- **사실 경계:** FairStress는 equality-centered symmetric fairness라는 특정 정의를 구현한다. 이 결과를 공정성 전체의 판정이나 실제 채용·대출 차별의 인과 증거로 확대하지 않는다.

### 2. τ-bench 2.0 — 한국어 text와 voice agent의 실패 위치를 같은 manifest에서 분리하기

**추천 제목**

> τ-bench 2.0 한국어 실전: 음성 에이전트의 entity·tool-call·judge 오류 분리

`tau2-bench` v2.0.0 release는 GitHub 기준 2026년 10월 20일 00:28 UTC에 게시됐다. 한국어를 포함한 여섯 language pack, text·voice 실행, frozen benchmark manifest, entity-capture benchmark를 제공하며, release 본문은 자체 release date를 10월 19일로 적고 있다.[3]

Tag에 고정된 코드는 MIT다.[4]

- **공개 분류:** Repository code와 문서는 MIT다. Language pack·task/database fixture에는 별도 dataset license가 명시되지 않아 repository LICENSE의 적용 범위를 게시 전 다시 확인해야 한다. 평가에 연결하는 model·voice provider의 weights와 약관도 별도다.
- **왜 지금:** 한국어 text와 audio-native run을 같은 공개 task family에서 실행할 수 있어, 음성 인식·entity capture·tool argument·simulator·judge 오류를 한 점수로 뭉개지 않고 나눌 수 있다.
- **실습 축:** 한국어 airline·retail·telecom task subset과 manifest를 고정한다. Text와 audio-native trajectory·log를 후처리해 entity exact match, tool argument error, simulator failure, post-hoc judge disagreement, latency를 별도로 분류한다. 이는 release가 제공하는 단일 공식 breakdown이 아니라 이 글에서 설계할 분석이다.
- **검색 의도:** `한국어 음성 에이전트 벤치마크`, `tau2 bench 사용법`, `voice agent entity capture 평가`.
- **기존 글과 구분:** 기존 voice-agent 글의 STT→LLM→TTS latency budget이나 일반 tool-use pass rate를 반복하지 않는다. **언어 pack과 modality 전환이 어느 평가 단계의 의미를 바꾸는지**만 다룬다.
- **사실 경계:** v2.0의 task, manifest, communication check, judge 변경 가능성을 감안해 1.x 점수와 직접 개선률을 만들지 않는다. 비교가 필요하면 동일 v2.0 tag로 모두 재실행한다.

### 3. DeepInfer — batch 구성이 바뀌어도 같은 샘플이 나오는지 검증하기

**추천 제목**

> DeepInfer 실전: batch-invariant 추론과 deterministic sampling을 재현하는 법

DeepSeek가 공개한 DeepInfer는 DeepSeek 모델용 offline inference framework다. 현재 공개 범위에는 optimized kernels, attention·context·MoE parallelism, asynchronous scheduling, batch-invariant inference, deterministic sampling, regex·JSON Schema·EBNF structured output이 포함된다. 반면 완전한 serving에 필요한 KV-cache system, prefill/decode 분리, replica load balancing은 포함되지 않았다.[5]

Framework 코드는 Apache-2.0이다.[6] 기본 대상으로 연결되는 `DeepSeek-V4.1-Flash-1017` repository와 weights는 MIT이며, model card는 별도 Jinja chat template 대신 reference encoding 구현과 local inference 경로를 제공한다.[7]

- **공개 분류:** Apache-2.0 open-source inference software와 MIT open-weight model의 조합이다. 학습 data와 end-to-end training recipe는 공개 범위가 아니므로 완전 재현 모델로 부르지 않는다.
- **왜 지금:** 검토 revision `774ce244b87cc0eb8d4b94ab9f5de2ab22049f01`의 최신 commit이 10월 20일이며, 별도 GitHub release/tag는 없다. 단순 tokens/s가 아니라 batch composition과 seed가 출력 결정성에 미치는 영향을 검증할 수 있다.
- **실습 축:** 동일 input token·sampling parameter·`seq_seed`를 고정하고 batch size와 동시 sequence 구성을 바꾼다. batch-invariant mode 전후의 token equality, structured-output validity, latency를 기록한다.
- **검색 의도:** `DeepInfer 사용법`, `LLM deterministic sampling`, `batch invariant inference`.
- **배포 요구:** 공식 경로는 Linux, Python 3.12, CUDA 13과 NVIDIA SM100 또는 CANN 9.2와 Ascend 950을 요구한다. 연결 model은 763B 규모이며 공식 문서는 최소 accelerator 수·cluster memory를 제시하지 않는다. 일반 소비자 GPU hands-on으로 포장하지 않는다.
- **기존 글과 구분:** 기존 multi-model routing, cache cost, generic inference 최적화 글을 반복하지 않는다. **동일 요청의 결과가 batch 구성과 scheduler에 의해 달라지는지**라는 단일 재현 질문에 고정한다.
- **사실 경계:** framework 공개와 production service 완결성은 다르다. DeepSeek의 benchmark나 비용 주장을 독립 측정값으로 제시하지 않는다.

## 이번 후보에서 제외·보류

### Cosmos3-H-Embodied-Nano — 적용 라이선스 충돌로 보류

**검토했던 제목**

> Cosmos3-H-Embodied-Nano 검증: 수술 영상과 로봇 action의 양방향 오차 측정

NVIDIA model card는 2026년 10월 20일 공개된 16B model이 하나의 checkpoint에서 forward dynamics, inverse dynamics, policy를 수행한다고 설명한다. 2.4초 clip에서 영상과 action을 함께 다루며 공개 weights와 HTTP policy server 경로를 제공한다.[8]

공식 GitHub repository에는 checkpoint conversion, evaluation, data rebuilding script와 마지막 3,063-update H16 단계의 재구현 recipe가 있다. 앞선 46,937-update 단계의 checkpoint·recipe와 optimizer/run state는 공개되지 않았고, 15개 dataset family 가운데 공개 데이터로 재구축 가능한 것도 11개뿐이다.[9]

현재 라이선스 표기는 충돌한다. GitHub README와 repository `LICENSE`는 OpenMDW-1.1이라고 적지만, Hugging Face model card와 그 repository의 실제 `LICENSE` 파일은 NVIDIA Open Model License를 적용한다.[8][9][10]

- **보류 이유:** GitHub source·recipe의 `LICENSE`는 OpenMDW-1.1이고 Hugging Face checkpoint의 실제 `LICENSE`는 NVIDIA Open Model License다. README가 model까지 OpenMDW-1.1로 묶어 설명하므로 적용 범위가 충돌한다. 해소 전에는 추천하지 않으며 dataset은 family별 원 라이선스를 다시 확인해야 한다.
- **왜 지금:** 10월 20일 공개됐고, 하나의 checkpoint가 video→action과 action→video를 모두 수행하므로 두 방향의 일관성을 별도의 metric으로 검증할 수 있다.
- **향후 실습 축:** 공식 evaluation을 확장해 공개 sample episode의 inverse dynamics action MSE, forward rollout dynamic-region PSNR, tool centroid distance, action→video→action cycle error를 측정한다. Cycle error는 공식 제공 metric이 아니라 제안 실험이다.
- **검색 의도:** `수술 로봇 world model`, `Cosmos3 embodied nano`, `video action inverse dynamics`.
- **배포 요구:** model card의 test hardware는 H100이며 16B multimodal model과 cosmos-framework가 필요하다. 저사양 로컬 실습으로 표현하지 않는다.
- **기존 글과 구분:** 기존 vision agent·computer-use 보안 글이나 일반 benchmark 비교를 반복하지 않는다. **영상 예측과 action 예측이 같은 trajectory에서 서로 일관되는지**에 집중한다.
- **사실 경계:** 누락된 네 dataset family뿐 아니라 앞선 46,937-update training stage와 초기 run state가 없어 released checkpoint의 end-to-end training replay는 불가능하다. 의료·수술 deployment 적합성도 model-card benchmark만으로 입증되지 않는다.

### Hy-Memory — 기존 memory 정정·삭제 글과 중심 논지 중복

**검토했던 제목**

> Hy-Memory 실전: 장기 메모리 writer의 갱신·충돌·삭제 정확도 검증

Tencent의 Hy-Memory repository는 chat, working, coding memory pipeline과 Python SDK, MemHub를 공개한다. 검토 revision의 README는 최신 package 발표를 `2.0.4`로 적지만 Quick Start 예제는 `2.0.3`을 pin하며, OpenAI-compatible LLM·embedding endpoint와 coding diff-chain을 설명한다.[11]

GitHub Releases의 최신 표시는 10월 18일의 MemHub `v1.0.4`이고 core package와 version axis가 다르다.[12] `Hy-Memory-30B-A3B`의 고정 model metadata는 ungated public artifact, Apache-2.0, 51개 safetensors shard, 약 30B parameter를 확인해 준다.[13] GitHub source revision의 root license도 Apache-2.0이지만, PyPI package version별 metadata는 별도로 고정·검토해야 한다.[14]

- **보류 이유:** 기존 `_posts/2026-06-06-ai-memory-ux-privacy.md`가 잘못된 기억의 정정, 오래된 사실 제거, 출처, 수정·삭제를 이미 중심 논지로 다룬다. Writer state transition만으로는 결론이 중복된다.
- **향후 재검토 조건:** 제품 고유의 merge/tombstone algorithm, 관측 API, coding diff-chain이 기존 글에 없는 검증 질문을 만들 수 있을 때만 다시 검토한다.
- **검색 의도:** `AI agent 장기 메모리`, `Hy-Memory 사용법`, `LLM memory conflict resolution`.
- **배포 요구:** 30B-A3B writer를 직접 실행하는 경로와 외부 OpenAI-compatible endpoint를 쓰는 SDK 경로를 분리해야 한다. 공식 최소 GPU memory는 확인되지 않았으므로 저사양 실행 가능성을 암시하지 않는다.
- **기존 글과 구분:** 기존 agent memory UX·privacy 글이나 Jira 유사 이슈 기억 글의 일반론을 반복하지 않는다. **writer의 state transition과 stale fact 제거**를 실행 fixture로 검증한다.
- **사실 경계:** Repository가 말하는 production-grade나 공급자 benchmark는 독립 운영 검증이 아니다. GitHub tag, PyPI package, MemHub build 번호를 하나의 release version처럼 섞지 않는다.

### Carbon-A 1.2B

2026년 10월 8일 공개된 Carbon-A는 단일-base resolution의 protein-coding region 예측과 공개 annotation pipeline을 제공해 corpus 공백은 크다.[15] 그러나 이번 cutoff의 10월 20일 공개물보다 최근성이 낮고 독자층·GPU·생물정보학 검증 요구가 높아 보류했다. 후속 글을 쓴다면 model card까지 함께 검토해 nucleotide·exon·gene boundary와 strand error를 분리하고, RNA 전사 증거를 단백질 번역·기능 입증으로 확대하지 않아야 한다.

### AnyLanguageModel 1.0.0

10월 13일 immutable `1.0.0` release에는 JSON Lines streaming, structured-output 관련 변경, Swift dependency 갱신이 포함됐다.[16] 다만 이번 상위 후보보다 최근성이 낮고, package와 연결하는 각 model/provider의 라이선스를 별도로 추적해야 한다. Apple·Swift 중심 후속 후보로 보류한다.

### NVIDIA Dory1.0-4B

10월 16일 공개된 Dory는 한 checkpoint에서 recurrent loop 수를 바꾸는 실험이 가능하다. 그러나 기준 시각에 vLLM support는 아직 pull request 설치를 요구하고 llama.cpp도 별도 지원 branch·고정 commit이 필요하다.[17] Weights는 OpenMDW-1.1 custom license이므로 표준 open-source release로 분류하지 않는다. 주류 runtime release에 통합된 뒤 다시 확인한다.

### Jais 3 7B

Arabic·English tool calling이라는 검색 의도와 BF16·FP8·GGUF·MLX artifact는 분명하다.[18] 다만 공급자 benchmark 비중이 크고 발표한 code·data·recipe의 현재 공개 완결성을 더 확인해야 한다. 이번에는 artifact state와 corpus 차별성이 더 명확한 세 후보를 우선했다.

### Liquid AI d1

LFM Open License v1.0은 연 매출 1,000만 달러 이상 법인의 commercial use를 허가하지 않는다.[19] 따라서 OSI open source나 제한 없는 open-weight로 분류하지 않는다. typed decision이라는 중심 논지도 기존 Cloudflare Clef 글과 가까워 제외했다.

### Apron

Repository에는 inference evidence record와 일부 구현이 있지만 PyPI 이름은 `0.0.0`으로 비어 있다고 명시돼 있다.[20] 또한 모델 선택·비용·accepted result 중심 논지는 기존 routing·cost 글과 겹친다. 설치 가능한 package release와 독립적인 search intent가 생길 때 다시 검토한다.

### 전날 및 기존 corpus와 중복

- 2026-10-20 조사: GenOffice v0.11.919, LightOnOCR-3 0.8B, Model Pulse, NVIDIA Nemotron 3 Diarization, RAG-Anything v1.4.2
- 2026-10-19 조사: AstaBrief 8B, Transformers GGUF, Holo4, LocalAI 4.11
- 기존 발행 주제: Run:ai, Olmo-core 3, Reflection Beam, REA, Granite Switch, UltraBERT, FLUX.3 Image Klein

이 항목들은 프로젝트 이름뿐 아니라 PPTX 검증, OCR grounding, download 시계열, diarization, page provenance, citation entailment, packed quant, trajectory 감사, failover state machine이라는 중심 실습축까지 중복하지 않도록 제외했다.

## 다음 작성 우선순위

1. **FairStress** — cutoff 직전 공개, API 기반 재현성, 기존 corpus와의 차별성이 가장 좋다.
2. **τ-bench 2.0** — 한국어 text/audio-native modality delta라는 실전 검색 의도가 강하다. Version 비교는 같은 tag로 재실행해야 한다.
3. **DeepInfer** — batch-invariant·deterministic sampling이라는 독립 질문이 강하지만 SM100/Ascend 950와 불명확한 최소 cluster 규모가 독자 접근성을 낮춘다.

## Sources

[1] https://huggingface.co/blog/allenai/fairstress
[2] https://github.com/pardissz/fairstress/tree/ded1b93fc670fd7d7f1757b96fcc89e10d15ce68
[3] https://github.com/sierra-research/tau2-bench/releases/tag/v2.0.0
[4] https://raw.githubusercontent.com/sierra-research/tau2-bench/v2.0.0/LICENSE
[5] https://github.com/deepseek-ai/DeepInfer/tree/774ce244b87cc0eb8d4b94ab9f5de2ab22049f01
[6] https://raw.githubusercontent.com/deepseek-ai/DeepInfer/774ce244b87cc0eb8d4b94ab9f5de2ab22049f01/LICENSE
[7] https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/tree/1bae0e1088993b9b82de08f59de5be5a34e42170
[8] https://huggingface.co/nvidia/Cosmos3-H-Embodied-Nano/tree/710459f061e0ddc0f4cbd8a581e686efb013839b
[9] https://github.com/NVIDIA-Medtech/Cosmos3-H-Embodied-Nano/tree/7a1a9e07ce6eabb51666c5307a89957f88c9e90d
[10] https://huggingface.co/nvidia/Cosmos3-H-Embodied-Nano/raw/710459f061e0ddc0f4cbd8a581e686efb013839b/LICENSE
[11] https://github.com/Tencent-Hunyuan/Hy-Memory/tree/8f1c4045e913566a6f40eb4451d68218b2307773
[12] https://github.com/Tencent-Hunyuan/Hy-Memory/releases/tag/v1.0.4
[13] https://huggingface.co/api/models/tencent/Hy-Memory-30B-A3B/revision/64a460a94d5498b7316fb02395c72d01c47a7347
[14] https://raw.githubusercontent.com/Tencent-Hunyuan/Hy-Memory/8f1c4045e913566a6f40eb4451d68218b2307773/LICENSE
[15] https://huggingface.co/blog/HuggingFaceBio/carbon-annotator-genbank-genome-annotation
[16] https://github.com/huggingface/AnyLanguageModel/releases/tag/1.0.0
[17] https://huggingface.co/nvidia/NVIDIA-Nemotron-Labs-Dory1.0-4B-BF16/tree/b366b87f762ea334ba3eb55912031baba1515810
[18] https://huggingface.co/inception42/Jais-3-7B/tree/11dcac6d60aaf87e427c33d070dd6cf412f7270a
[19] https://huggingface.co/LiquidAI/d1-3B/raw/051bcc464b01b9f92942b364d9586b0ef5912432/LICENSE
[20] https://github.com/mondegreens/apron/tree/937bf5bc5db13b415fe8db95a145d01ce4124bc1
