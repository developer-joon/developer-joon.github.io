---
title: 'Granite Switch 4.1: 채팅·분류·안전 판정을 한 vLLM 엔드포인트에서 전환하기'
date: 2026-10-17 06:20:00 +0900
categories: ["AI 오픈소스"]
description: 'Granite Switch 4.1의 공통 base와 aLoRA 전환 구조, 영어 ASR cascade의 현재 한계, vLLM 배포 비용과 검증 방법을 실전 관점에서 분석한다.'
featured_image: 'https://picsum.photos/seed/granite-switch-4-1-one-endpoint/1600/900'
tags: [granite-switch, granite-4-1, alora, vllm, asr, model-serving, apache-2-0]
---

![Granite Switch 4.1의 단일 엔드포인트 전환 구조](https://picsum.photos/seed/granite-switch-4-1-one-endpoint/1600/900)

채팅 모델, 분류 모델, 안전 판정 모델을 각각 띄우면 기능 경계는 선명하지만 GPU 메모리와 배포 단위가 늘어난다.
Granite Switch 4.1은 이 문제를 공통 Granite base, 여러 adapter, speech encoder를 한 checkpoint에 구성하는 방식으로 풀려는 모델이다.[1]
공식 발표는 2026년 10월 15일 공개됐고 8B와 30B 구성을 소개한다.[1]
핵심인 coarse-grained switching은 한 모델 안에서 토큰 구간별 adapter를 고르는 방식으로, 요청을 서로 다른 서버로 보내는 외부 router와는 다르다.
그러나 단일 endpoint라는 말이 모든 기능을 하나의 end-to-end 멀티모달 모델로 공동 학습했다는 뜻은 아니다.
특히 음성 경로는 현재 ASR 결과를 일반 text token으로 넘기는 영어 cascade다.
따라서 이 글은 chat·decision·guardian 전환과 ASR 전사를 같은 기능으로 뭉개지 않는다.
결론부터 말하면 Granite Switch 4.1은 반복되는 prefix를 공유하는 복합 workflow에 유망하다.
반대로 기능별 장애 격리와 독립 확장이 더 중요한 팀에는 여러 endpoint가 더 단순할 수 있다.

## 이번 공개에서 현재 쓸 수 있는 것

공식 8B model card는 base model, 여러 adapter, encoder를 합쳐 자연어 응답, 일반·전문화 decision, speech-to-text를 오가는 모델이라고 정의한다.[2]
8B checkpoint에는 chat 경로와 Decision aLoRA, Guardian aLoRA, speech encoder가 포함된다.[1][2]
30B도 같은 공개 구성의 선택지로 소개됐다.[1]
두 크기가 있다고 해서 모든 adapter가 두 base에서 같은 정확도와 처리량을 낸다고 가정하면 안 된다.
Model card가 설명하는 switch layer는 입력의 control token을 감지해 위치별 adapter index를 만든다.[2]
그 index는 각 decoder layer가 적용할 LoRA weight를 선택하는 데 쓰인다.[2]
한 contiguous token span에서는 한 adapter가 모든 layer에 걸쳐 활성화된다.[2]
이는 token마다 여러 expert를 섞는 일반적인 sparse MoE와 다른 계약이다.
Repository는 model composer와 adapter library 조합, vLLM 또는 Hugging Face 실행 경로를 공개한다.[3]
공식 composer는 base와 선택한 library를 결합해 배포 가능한 checkpoint를 만든다.[3]
현재 제공되는 artifact를 이용하는 경로와 조직이 직접 adapter를 학습하는 경로도 구분해야 한다.
IBM은 Mellea에서 adapter를 학습할 Adapter SDK와 추가 tutorial, Granite Switch 지원을 앞으로 공개할 계획이라고 적었다.[1]
그러므로 custom Adapter SDK는 4.1 발표 시점의 완성 기능처럼 구매 목록에 넣으면 안 된다.
현재 검증할 대상은 공개 checkpoint, composer, 이미 공개된 adapter library, serving backend다.
계획 기능은 API와 호환성, 출시 시점이 바뀔 수 있는 roadmap이다.

## aLoRA가 공유하는 것과 공유하지 않는 것

Activated LoRA는 adapter가 필요해지는 activation sequence 이후에만 LoRA를 적용하도록 설계된 방식이다.
공식 발표는 base generation에서 만든 KV cache를 뒤이은 adapter decision에 재사용할 수 있다고 설명한다.[1]
이 재사용은 같은 prefix를 chat으로 처리한 뒤 그 문맥에 safety나 decision 판정을 수행할 때 특히 의미가 있다.
Base와 adapter를 한 checkpoint에 둔다고 model weight 전체가 매 요청마다 복제되는 것은 아니다.
그렇다고 adapter 비용이 영이 되는 것도 아니다.
Adapter weight, switch metadata, 추가 kernel, control token 처리와 더 넓어진 checkpoint는 여전히 메모리와 운영 비용을 만든다.
KV cache 재사용도 prefix가 byte-level 또는 token-level로 실제 일치하고 runtime의 cache 조건을 만족할 때만 발생한다.
Prompt template가 달라지거나 tenant별 salt를 넣거나 context를 잘라내면 예상한 hit가 사라질 수 있다.
Decision 결과가 chat 답변과 다른 schema를 갖는다면 client는 기능별 decode contract도 보존해야 한다.
단일 OpenAI-compatible endpoint는 URL을 통합하지만 output semantics까지 하나로 만들지는 않는다.
따라서 adapter 이름, control token, schema version을 application contract로 관리해야 한다.
이 글에서 제안하는 request fixture는 단순하다.
같은 사건 설명을 chat에는 서술형으로, decision에는 제한된 verdict로, guardian에는 safety envelope로 보낸다.
세 응답이 나온다는 사실보다 잘못된 adapter가 활성화되지 않았는지를 먼저 검사한다.
한 기능의 prompt가 다른 기능의 control token을 포함할 때도 negative test를 둔다.

## vLLM에서 작은 검증 환경 만들기

Repository는 `granite-switch` package와 vLLM 기반 배포 경로를 제공한다.[3]
아래 예시는 official precomposed 8B checkpoint를 한 endpoint로 띄우는 최소 형태다.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install \
  'granite-switch[vllm,audio,compose]==0.1.1' \
  'mellea==0.6.0'
python -m vllm.entrypoints.openai.api_server \
  --model ibm-granite/granite-switch-4.1-8b \
  --port 8000
```

`granite-switch` package가 custom model registration과 composer module을 제공하므로 `mellea`와 일반 `vllm`만 설치해서는 이 checkpoint를 띄울 수 없다.[3] 위 버전은 글 검증 시점의 재현 fixture이며 production에서는 공식 compatibility 범위와 CUDA·PyTorch 조합을 다시 확인한다. Audio extra는 alpha ASR 경로까지 검증하기 위해 포함했다.

첫 실행은 여러 GB의 artifact를 내려받을 수 있으므로 배포 시간과 image layer 크기를 별도로 기록해야 한다.[3]
Production에서는 mutable package range 대신 검토한 package version, model revision, container digest를 고정한다.
Model repository의 이름만 고정하면 이후 artifact 변경을 동일 배포로 오인할 수 있다.
먼저 일반 chat request를 보내 base 응답을 확인한다.
다음으로 Mellea가 제공하는 embedded adapter registration과 guardian API를 사용해 같은 endpoint의 안전 판정을 호출한다.[3]

```python
from mellea.backends.openai import OpenAIBackend
from mellea.stdlib.components.chat import Message
from mellea.stdlib.components.intrinsic.guardian import guardian_check
from mellea.stdlib.context import ChatContext

backend = OpenAIBackend(
    model_id="ibm-granite/granite-switch-4.1-8b",
    base_url="http://localhost:8000/v1",
    api_key="unused",
)
backend.register_embedded_adapter_model("ibm-granite/granite-switch-4.1-8b")
ctx = ChatContext().add(Message("user", "Group X people are all lazy."))
score = guardian_check(ctx, backend, "social_bias", scoring_schema="user_prompt")
print(score)
```

이 sample score는 기능 wiring 확인용이지 조직의 차단 threshold 정답이 아니다.
출력 범위와 schema를 assertion하고 malformed JSON, timeout, unknown adapter를 각각 실패로 처리한다.
Chat 응답이 성공했다고 guardian 경로도 건강하다고 판단하면 안 된다.
Readiness probe에는 base, decision, guardian의 짧은 고정 fixture를 따로 둔다.
Probe 결과를 사용자 데이터와 섞지 말고 synthetic input으로 제한한다.

## 직접 checkpoint를 조합할 때의 계약

공식 composer는 base model과 여러 Granite library를 지정해 새 directory를 만든다.[3]

```bash
python -m granite_switch.composer.compose_granite_switch \
  --base-model ibm-granite/granite-4.1-3b \
  --adapters \
    ibm-granite/granitelib-core-r1.0 \
    ibm-granite/granitelib-rag-r1.0 \
    ibm-granite/granitelib-guardian-r1.0 \
  --output ./my-model
```

조합 성공은 model quality 승인과 다르다.
각 adapter가 기대하는 base family, target module, rank, control token과 output schema를 manifest로 남겨야 한다.
Adapter 순서를 바꾼 두 checkpoint가 동일하다는 추측도 금물이다.
Composer version과 입력 artifact revision을 provenance에 포함한다.
Model weight뿐 아니라 tokenizer, chat template, config, custom runtime code의 hash도 저장한다.
자체 adapter를 끼우려면 현재 공개된 composition surface와 아직 계획 단계인 training SDK를 구분한다.
직접 학습 code를 별도로 만들 수는 있지만 그것을 공식 Adapter SDK의 현재 지원으로 표현해서는 안 된다.
Third-party adapter는 Apache-2.0 repository와 별개의 라이선스를 가질 수 있다.
한 checkpoint에 합쳤다는 사실이 모든 component의 이용 조건을 Apache-2.0으로 바꾸지는 않는다.
배포 전에는 component별 license와 training data disclosure를 따로 검토한다.

## 음성은 현재 alpha ASR cascade다

공식 audio 문서는 이 경로를 **Audio Input (Alpha)**라고 부른다.[4]
현재 구현은 작은 ASR model로 음성을 text로 바꾼 뒤 transcript를 LLM의 일반 token으로 삽입한다.[4]
Speech encoder embedding을 학습된 projection으로 직접 LLM에 넣는 방식은 미래 upgrade 설계다.[4]
따라서 “speech와 language가 공동 학습된 4.1 model”이라고 설명하면 현재 구현을 과장한다.
Default ASR은 영어용 Granite Speech 5.0 470M TurboCTC다.[4]
Default transcript는 lowercase이며 punctuation이 없고 decode-time language steering도 제공하지 않는다.[4]
ASR 오류는 그대로 LLM 입력 오류가 된다.
Prosody, emotion, uncertainty 같은 음향 정보도 text cascade에서 손실된다.[4]
긴 음성은 transcript token이 context window를 소비한다.
Prompt와 transcript가 `max_model_len`을 넘으면 vLLM은 일반 prompt-length 오류로 요청을 거부한다.[4]
여러 clip도 하나의 context budget을 공유한다.[4]
Audio-enabled checkpoint는 composer에서 `--enable-audio`를 명시해야 한다.[4]
다른 `--asr-*` option만 줘서는 audio가 활성화되지 않는다.[4]
기본 CUDA 경로에서는 vLLM KV cache 선할당 뒤 ASR weight가 들어갈 여유도 남겨야 한다.[4]
CPU로 ASR을 옮기면 GPU memory는 아끼지만 전사 latency가 커질 수 있다.[4]

```bash
python -m granite_switch.composer.compose_granite_switch \
  --base-model ibm-granite/granite-4.1-3b \
  --built-in-adapters core \
  --enable-audio \
  --output ./granite-switch-audio
```

음성 실습은 깨끗한 영어 한 문장만으로 끝내지 않는다.
억양, 소음, 고유명사, 숫자, 침묵, 긴 clip과 반복 구간을 fixture로 둔다.
첫 단계는 word error rate와 transcript를 저장한다.
둘째 단계는 같은 transcript를 text로 직접 넣었을 때와 audio로 넣었을 때의 downstream verdict를 비교한다.
두 결과가 다르면 ASR, template, marker replacement, LLM 중 어느 단계에서 차이가 생겼는지 분해한다.
Streaming 회의나 multilingual call이 핵심이면 default alpha cascade는 부적합할 수 있다.

## 성능 주장을 자기 workload로 되돌리기

Granite Switch의 SWITCH kernel 문서는 Granite 4.1 3B, H100 한 장, TP=1, bf16, batch 32 조건의 공급자 benchmark를 공개한다.[5]
모든 adapter rank가 32일 때 decode는 Punica 대비 1.21배에서 1.38배였다고 보고한다.[5]
Rank-32 집합에 rank-128 하나를 섞은 조건에서는 최대 2.5배, rank-512 하나를 섞은 조건에서는 최대 5.9배를 보고한다.[5]
이 결과는 heterogeneous rank에서 Punica의 engine-wide `max_lora_rank` padding 비용을 피한 설계와 연결된다.[5]
측정은 512-token prompt, 128 generated token, 고정 seed adapter 배정, warm-up 2회 뒤 5회 중앙값을 사용했다.[5]
그러나 adapter가 하나도 활성화되지 않은 idle 경로에서는 현재 single-graph SWITCH가 raw vLLM보다 조금 느리다.[5]
8B의 이득도 3B보다 작았고 문서는 rank-512 8B population을 측정하지 않았다고 밝힌다.[5]
따라서 “Granite Switch는 vLLM보다 항상 5.9배 빠르다”는 결론은 틀리다.
자체 측정에서는 adapter-active 비율, rank 분포, prefix cache hit, batch, prompt와 output 길이를 고정한다.
Chat만 많은 시간대와 decision burst가 많은 시간대를 별도 trace로 재생한다.
ASR을 포함한 요청은 전사와 generation을 연속 실행하므로 text-only 수치와 분리한다.
P50만 보면 긴 음성과 큰 adapter가 만드는 tail을 놓친다.
최소한 time-to-first-token, decode token/s, end-to-end p95·p99, GPU memory peak를 함께 기록한다.
정확도는 기능별 dataset과 abstention·schema violation을 따로 측정한다.
한 endpoint의 전체 throughput이 높아져도 guardian latency SLO가 깨지면 통합은 실패다.

## 비용은 endpoint 수보다 작업 단위로 계산한다

단일 endpoint는 base weight 중복과 반복 배포를 줄일 가능성이 있다.
하지만 8B나 30B base, adapter 묶음, ASR 470M, KV cache와 runtime overhead를 동시에 수용해야 한다.
공식 ASR model card는 470M English CTC model이며 약 60,000시간의 공개·합성 English audio로 학습됐다고 설명한다.[6]
그 model card의 속도 결과는 Open ASR leaderboard의 특정 H200 또는 L4 조건이므로 자기 GPU 비용으로 바로 옮길 수 없다.[6]
비용 분모는 endpoint 수가 아니라 완료된 유효 작업으로 잡는 편이 낫다.

```text
cost_per_accepted_flow =
    (gpu_time + model_storage + cache_miss_cost
     + asr_compute + failed_request_retries
     + evaluation_and_oncall)
    / accepted_chat_decision_guardian_flows
```

Cache hit가 높은 demo와 tenant별 prefix가 모두 다른 production은 비용 구조가 다르다.
ASR 오류로 재전사하거나 사람이 검토한 시간도 분자에 넣는다.
기능별 server를 합쳐 GPU 한 장을 줄여도 장애 blast radius가 커지면 on-call 비용이 늘 수 있다.
30B가 더 정확할 수 있다는 기대만으로 선택하지 말고 task별 quality gain을 GPU-hour 증가와 비교한다.
Autoscaling도 aggregate queue 하나가 아니라 기능별 queue age와 SLO로 판단한다.
Decision burst가 chat을 굶기는지 admission policy를 시험한다.

## 보안과 라이선스 경계

같은 endpoint는 prompt와 KV cache, log, metric label이 여러 기능을 가로지르게 만든다.
Tenant 간 cache reuse가 일어나지 않도록 runtime의 cache key와 isolation 동작을 확인해야 한다.
Guardian adapter는 안전 판정 도구이지 prompt injection이나 authorization을 완전히 막는 보안 경계가 아니다.
Model이 안전하다고 답해도 tool 실행 권한은 별도의 policy enforcement가 결정해야 한다.
Audio upload는 악성 media parser input, 과도한 길이, 개인정보와 생체정보를 포함할 수 있다.
Format allowlist, decode resource limit, request size limit와 retention policy를 둔다.
Transcript와 원본 audio의 보존 기간도 분리한다.
외부 adapter와 model artifact를 받을 때는 revision, digest, malware scan과 provenance를 확인한다.
Granite Switch repository는 Apache License 2.0으로 공개돼 있다.[7]
Apache-2.0은 copyright·patent grant를 제공하지만 재배포 시 license 사본, 수정 고지, 관련 notice 보존 같은 조건을 요구한다.[7]
또한 상표 사용 권한을 일반적으로 주지 않는다.[7]
공식 model card도 Granite Switch를 Apache-2.0으로 표시한다.[2]
하지만 합성 checkpoint에 포함한 third-party adapter, dataset, base model은 각각의 license를 다시 확인해야 한다.
오픈소스라는 이유만으로 warranty나 production support가 생기는 것도 아니다.

## 실패 모드와 rollout gate

첫 번째 실패는 control token이 누락돼 base chat이 평범한 문장을 decision처럼 반환하는 경우다.
이 실패는 HTTP 200이므로 schema validator가 없으면 발견하기 어렵다.
두 번째 실패는 adapter revision과 tokenizer가 어긋나 switch가 다른 index를 고르는 경우다.
세 번째 실패는 prefix가 미세하게 달라져 KV cache 재사용이 사라지는 경우다.
네 번째 실패는 rank가 큰 adapter 하나가 batch memory와 tail latency를 끌어올리는 경우다.
다섯 번째 실패는 ASR이 고유명사나 숫자를 틀려 뒤의 guardian·decision이 일관되게 잘못되는 경우다.
여섯 번째 실패는 audio가 길어 transcript가 answer budget을 모두 소비하는 경우다.
일곱 번째 실패는 한 기능의 traffic spike가 같은 endpoint의 다른 기능 SLO를 무너뜨리는 경우다.
여덟 번째 실패는 custom adapter가 base update 뒤 조용히 quality regression을 내는 경우다.

저자가 권하는 rollout은 기능 수를 한 번에 늘리지 않는다.
먼저 text-only base와 adapter 하나를 shadow traffic으로 비교한다.
그다음 decision과 guardian을 추가해 schema, cache, latency를 검증한다.
Audio alpha는 별도 canary와 별도 SLO로 마지막에 연다.
각 단계에서 기능별 golden dataset과 adversarial fixture를 실행한다.
Checkpoint 교체 전후에는 같은 request ID 집합으로 output drift를 저장한다.
Cache hit가 기대보다 낮으면 GPU를 더 넣기 전에 prompt normalization과 tenant isolation을 함께 점검한다.
Rollback은 package만이 아니라 model revision, tokenizer, adapter library와 config를 한 묶음으로 되돌려야 한다.

## Granite Switch가 맞는 workload와 맞지 않는 요구

**적합한 팀**은 같은 문맥에서 chat 뒤 decision·guardian을 반복 호출한다.
**적합한 팀**은 Granite base와 공개 adapter library를 함께 평가할 수 있다.
**적합한 팀**은 vLLM kernel, checkpoint provenance와 GPU profile을 운영할 역량이 있다.
**적합한 팀**은 endpoint 통합으로 줄어드는 base 중복을 실제 trace로 측정하려 한다.
**적합한 팀**은 영어 ASR alpha를 제한된 canary로 분리할 수 있다.

**부적합한 팀**은 기능별 독립 scaling과 장애 격리가 최우선이다.
**부적합한 팀**은 multilingual streaming speech를 즉시 production SLA로 요구한다.
**부적합한 팀**은 custom adapter SDK가 이미 안정된 제품이라고 전제한다.
**부적합한 팀**은 하나의 safety score를 authorization 결정으로 바로 연결하려 한다.
**부적합한 팀**은 model과 adapter license·revision을 component별로 추적할 수 없다.

대안은 목적에 따라 달라진다.
Traffic이 낮다면 base chat model과 작은 classifier를 따로 띄우는 편이 운영상 단순할 수 있다.
Function별 scale 차이가 크다면 별도 endpoint와 explicit router가 비용을 더 잘 통제할 수 있다.
Speech 품질이 핵심이면 검증된 multilingual ASR을 독립 service로 두고 transcript contract를 명시하는 편이 낫다.
Granite Switch를 선택할 이유는 endpoint 수가 하나라는 표면보다 공통 prefix와 base를 실제로 재사용하는 workflow에 있다.

## 결론: 하나의 endpoint보다 하나의 검증 가능한 전환 계약

Granite Switch 4.1은 공통 base와 여러 aLoRA를 한 checkpoint에서 전환하고 vLLM endpoint 하나로 서비스하는 구체적인 구현을 제공한다.
그 가치는 chat, decision, guardian이 같은 문맥을 이어받을 때 cache와 model weight 중복을 줄일 가능성에 있다.
그러나 aLoRA는 무료 기능이 아니고 성능은 adapter rank, batch, active 비율과 prefix 일치에 좌우된다.
현재 audio는 영어 ASR cascade인 alpha이며 joint speech-language model로 부르면 안 된다.
Custom Adapter SDK도 현재 기능이 아니라 계획으로 남아 있다.
도입 판단은 공급자 race 결과 하나가 아니라 기능별 정확도, schema 오류, cache hit, tail latency, memory와 실패 복구 비용을 묶어 내려야 한다.
최종 acceptance criterion은 “한 URL에서 세 응답이 나왔다”가 아니다.
**같은 model revision에서 어떤 adapter와 ASR 경로가 활성화됐는지 재현하고, 기능별 실패를 감지하며, 비용과 license를 component 단위로 설명할 수 있어야 한다.**

## Sources

[1] https://huggingface.co/blog/ibm-granite/granite-switch-4-1 — Granite Switch 4.1 launch post
[2] https://huggingface.co/ibm-granite/granite-switch-4.1-8b — Granite Switch 4.1 8B model card
[3] https://github.com/generative-computing/granite-switch/tree/7e724560f9a9449bba2f08e16e8678c4dd6a06e7 — Granite Switch repository and usage guide
[4] https://github.com/generative-computing/granite-switch/blob/7e724560f9a9449bba2f08e16e8678c4dd6a06e7/docs/AUDIO.md — Audio Input alpha design and limitations
[5] https://github.com/generative-computing/granite-switch/blob/7e724560f9a9449bba2f08e16e8678c4dd6a06e7/docs/SWITCH_KERNELS.md — SWITCH kernel design and vendor benchmarks
[6] https://huggingface.co/ibm-granite/granite-speech-5.0-470m-turboctc — Granite Speech 5.0 TurboCTC model card
[7] https://github.com/generative-computing/granite-switch/blob/7e724560f9a9449bba2f08e16e8678c4dd6a06e7/LICENSE — Apache License 2.0
