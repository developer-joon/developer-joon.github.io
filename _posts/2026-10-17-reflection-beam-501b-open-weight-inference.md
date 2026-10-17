---
title: 'Reflection Beam 501B 오픈웨이트: 23B active가 23B 모델 비용을 뜻하지 않는 이유'
date: 2026-10-17 04:00:00 +0900
categories: ["AI 오픈소스"]
description: 'Apache-2.0으로 공개된 Reflection Beam 501B-A23B의 실제 공개 범위와 실행 방법을 살펴보고, MoE의 active parameter와 메모리·KV cache·운영 비용을 분리해 검증하는 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/reflection-beam-501b-open-weight-inference/1600/900'
tags: [reflection-beam, open-weight, mixture-of-experts, llm-inference, vllm, sglang, apache-2-0]
---

![Reflection Beam의 sparse MoE와 실제 추론 비용](https://picsum.photos/seed/reflection-beam-501b-open-weight-inference/1600/900)

오픈웨이트 모델의 크기를 읽을 때 가장 위험한 숫자는 종종 가장 작아 보이는 숫자다. **Reflection Beam**은 전체 501B parameter 가운데 token마다 약 23B를 활성화하는 sparse Mixture-of-Experts(MoE) 모델이다. 여기서 “23B active”만 보면 24GB나 48GB GPU 몇 장으로 충분할 것처럼 느껴진다. 실제 배포에서는 그렇지 않다.

Reflection은 2026년 10월 16일 Beam의 BF16·FP8·NVFP4 가중치를 Apache License 2.0으로 공개하고 self-hosting 경로를 열었다.[1] 모델 카드는 501.3B total, 23.4B active, 52개 layer, 256개 expert 중 token당 8개 routing, 1M token context라는 구조를 명시한다.[2] 저장소의 LICENSE도 Apache License 2.0 전문이다.[3]

Hugging Face의 출시 글은 Transformers·SGLang·vLLM 지원과 SFT·RL 활용 경로를 함께 설명한다.[4] Reflection의 안전 보고서는 생물·화학·사이버·통제 상실 위험뿐 아니라 indirect prompt injection 평가를 별도로 공개한다.[5] 이 글은 이 다섯 자료를 기준으로 **active compute, 상주 weight, KV cache, agent 권한을 서로 다른 비용과 위험으로 분리**한다. 기존 Olmo-core 3 글이 MoE 학습 경로의 storage·통신 비용을 다뤘다면, 여기서는 공개 checkpoint를 실제로 serve할 때 생기는 weight residency·context·concurrency 비용에 범위를 고정한다.

## 왜 오늘 Beam을 골랐나

선정 기준 시각은 **2026년 10월 17일 04:00 KST**다. 실제 가중치 공개는 10월 16일이므로 최근 30일 조건을 충족한다. 10월 5일의 최초 발표 때는 가중치가 “이달 말 공개 예정”이었지만, 지금은 네 checkpoint가 비공개 gate 없이 내려받을 수 있다. 따라서 preview 예고가 아니라 실제 공개된 artifact를 다룰 수 있다.

초기 반응은 증가율로 과장하지 않고 같은 시각의 관측값으로 기록했다.

Hugging Face API에서 BF16 checkpoint는 **440 downloads·86 likes**, FP8은 **603 downloads·18 likes**였다.[6][7]

NVFP4는 **864 downloads·22 likes**, DFlash2 drafter는 **141 downloads·18 likes**였다.[8][9]

네 저장소의 단순 합계는 2,048 downloads와 144 likes지만, Hugging Face의 download 집계가 고유 사용자나 production 배포 수를 뜻하지는 않는다.

생태계 신호도 있다. Transformers에는 Beam architecture와 분산 실행 예제가 commit permalink로 들어갔다.[10] vLLM recipe 저장소에는 10월 16일 추가된 NVIDIA GPU별 BF16·FP8·NVFP4 배포 recipe가 있고, SGLang에도 B300·GB300·H200별 cookbook이 공개됐다.[11][12] 이 자료는 “성능이 독립 검증됐다”는 증거가 아니라 **출시 당일 여러 serving stack이 구체적인 배포 경로를 만들었다**는 채택 신호다.

왜 주목받는지에 대한 가설은 세 가지다. 첫째, coding·agent workload를 겨냥한 대형 모델을 자체 infrastructure에서 운용할 수 있다. 둘째, 501B의 저장 용량과 23B active compute를 분리해 capacity와 token당 계산량 사이의 새로운 선택지를 제공한다. 셋째, BF16부터 NVFP4까지 checkpoint와 serving recipe가 동시에 나와 “가중치만 공개되고 실행법은 없는” 간극을 줄였다. 다만 이 기능들이 download나 like를 직접 만들었다는 인과는 측정되지 않았다.

## 공개된 것과 공개되지 않은 것

Beam은 Reflection이 명시적으로 **open-weight 모델**이라고 부른다.[1] 이 글도 공개 가중치와 공개 구현을 설명할 뿐, 모델 전체가 별도의 “오픈소스 AI” 정의를 충족한다고 확대해서 부르지 않는다. 원본 학습 데이터와 완전한 재현 가능성은 다시 별도의 축이다.

공개된 범위는 비교적 넓다.

- Instruction-tuned 가중치가 BF16·FP8·NVFP4로 공개됐다.[1][2]
- DFlash2 speculative decoding용 drafter checkpoint도 공개됐다.[4][9]
- BF16·FP8·NVFP4 저장소에는 Apache-2.0 메타데이터와 LICENSE 파일이 있다.[3][6][7]
- DFlash2 저장소도 Apache-2.0으로 표시되지만, 검토 시점의 API 파일 목록에는 별도 LICENSE 파일이 없었다.[9]
- Transformers architecture 구현, tokenizer의 response template, SGLang·vLLM serving 경로가 공개됐다.[4][10][11]
- 모델 카드에는 architecture와 주요 benchmark 결과가 precision별로 실렸다.[2]
- 안전 보고서는 평가 범주, 일부 수치, prompt injection mitigation의 형태를 공개한다.[5]

그러나 **원본 학습 데이터는 공개되지 않았다**. Reflection은 pretraining에 23.8T token의 web data와 proprietary licensed dataset을 사용했다고 설명한다.[13] 어떤 데이터가 어느 비율로 들어갔는지, 모든 sample의 provenance와 삭제 절차가 무엇인지는 공개 가중치만으로 재구성할 수 없다.

학습 recipe도 층을 나눠 봐야 한다. 공개 문서에는 MoE 구조, attention 설계, 정밀도 처리, SFT와 RL을 적용하는 예제가 있다. 이것은 모델을 후속 학습하는 데 유용하다. 하지만 Beam을 처음부터 동일하게 재학습할 수 있는 **완전한 corpus, exact data mixture, 모든 optimizer schedule, 전체 training infrastructure fixture**가 공개됐다는 뜻은 아니다.

Apache-2.0으로 명시된 공개 가중치와 해당 구현 코드에 그 license가 적용되더라도 학습 데이터의 제3자 권리까지 자동으로 이전되는 것은 아니다.[3] 사용자는 모델 output의 용도, fine-tuning dataset의 권리, 배포 지역의 규제, 생성 코드의 license 검토를 별도로 책임져야 한다. “Apache-2.0 모델이니 모든 산출물이 Apache-2.0”이라는 결론은 성립하지 않는다.

## 23B active와 501B resident를 분리해서 읽기

Sparse MoE는 모든 token에 모든 expert를 실행하지 않는다. Beam의 첫 3개 layer는 dense MLP이고, 나머지 49개 MoE layer는 256개 expert 중 8개를 선택한다.[2][10] 이 구조는 token당 matrix multiplication 양을 줄이지만, 요청마다 어떤 expert가 선택될지 미리 고정할 수는 없다.

따라서 serving process는 보통 전체 expert weight를 GPU memory 또는 접근 가능한 계층에 보유해야 한다. Active parameter는 주로 **한 token을 계산할 때 참여하는 parameter 양**을 설명한다. Model weight를 저장하고 분산하는 비용은 여전히 total parameter와 checkpoint precision에 가깝게 움직인다.

실제 공개 artifact의 크기가 이 차이를 보여 준다. 검토 시점의 Hugging Face 모델 API `usedStorage` 기준으로 BF16 저장소는 약 **1,002.7GB**, FP8은 약 **503.3GB**, NVFP4는 약 **293.7GB**다.[6][7][8] 이 값은 해당 저장소의 사용량 지표이며 고정된 revision의 file manifest 합계라고 확대해서 해석하지 않는다. 그래도 23B dense 모델 하나의 저장 크기로는 이 세 checkpoint를 설명할 수 없다.

vLLM의 pinned recipe는 runtime headroom까지 포함한 최소 GPU memory를 NVFP4 **353GB**, BF16 **1,204GB**로 잡는다.[11] 이 값은 모델의 보편적인 하한이 아니라 해당 recipe가 weight에 20% 여유를 더한 배포 기준이다. 그래도 “23B active니까 단일 consumer GPU에서 실행된다”는 해석이 틀렸다는 점은 분명하다.

MoE에는 network 비용도 붙는다. Expert parallelism을 쓰면 token representation이 해당 expert가 있는 GPU로 이동하고 결과가 다시 합쳐진다. 평균 FLOPs가 줄어도 all-to-all traffic, routing imbalance, straggler, kernel 효율 저하가 생길 수 있다. 특히 작은 batch에서는 expert별 작업이 잘게 쪼개져 GPU utilization이 낮아질 수 있다.

결론은 간단하다. **Active parameter는 compute 힌트이지 memory 견적서가 아니다.** Capacity planning은 checkpoint byte, precision, GPU별 VRAM, interconnect, context 길이, batch, concurrency를 함께 넣어야 한다.

## 1M context도 무료 용량이 아니다

Beam의 최대 context는 1,048,576 token이다.[2] 긴 repository, 긴 agent trace, 여러 문서를 한 요청에 넣을 수 있다는 점은 매력적이다. 그러나 지원 가능한 최대 길이와 운영에서 경제적인 길이는 다르다.

KV cache는 request마다 생기고 context와 동시 요청 수에 따라 증가한다. Weight는 replica가 공유할 수 있지만 KV cache는 각 sequence의 상태다. 1M context를 한 번 통과하는 데 성공했다고 1M context 요청 여러 개를 동시에 처리할 수 있다는 뜻은 아니다.

Beam은 대부분의 layer에서 512-token sliding-window attention을 쓰고 주기적으로 full attention layer를 둔다.[10] 이 hybrid 구조는 모든 layer가 전체 sequence를 보는 설계보다 cache와 attention 계산을 줄이는 방향이다. 그래도 full-attention layer와 긴 sequence의 prefill, request별 cache는 사라지지 않는다.

운영에서는 적어도 다음 값을 따로 측정해야 한다.

1. **TTFT(Time to First Token):** 긴 prompt를 prefill하는 데 걸린 시간
2. **ITL(Inter-Token Latency):** 생성 중 token 사이 지연
3. **Throughput:** 초당 output token과 완료 request 수
4. **Peak VRAM:** weight, KV cache, CUDA graph, temporary buffer를 포함한 최대값
5. **Goodput:** latency SLO를 지킨 완료 token 또는 완료 request
6. **Cost per accepted task:** 재시도·tool call·검증까지 포함한 실제 업무 완료 비용

Context benchmark는 8K, 32K, 128K, 256K, 1M처럼 계단을 나눠야 한다. 각 단계에서 batch와 concurrency를 고정하고, OOM 여부만이 아니라 TTFT와 P95 latency를 기록한다. 1M을 지원한다는 사실은 1M을 기본값으로 쓰라는 권고가 아니다.

## 실제로 실행하는 두 경로

### 경로 1: 관리형 endpoint로 적합성부터 확인

대부분의 팀에는 대형 GPU node를 빌리기 전에 managed endpoint로 task 적합성을 확인하는 편이 낫다. Hugging Face 출시 글은 router의 OpenAI-compatible API와 Inference Endpoint 경로를 제공한다.[4] 아래 예제는 `openai` Python package와 `HF_TOKEN`이 필요하며, token에는 필요한 최소 권한만 부여한다.

```bash
python -m pip install openai
```

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=os.environ["HF_TOKEN"],
)

response = client.chat.completions.create(
    model="reflection/Beam-1.0-501B-A23B:auto",
    messages=[
        {
            "role": "user",
            "content": "이 저장소의 실패 가능한 배포 경로를 세 가지로 분류해줘.",
        }
    ],
)

print(response.choices[0].message)
```

API key를 source에 넣지 말고 secret manager나 process environment에서 주입해야 한다. Prompt, tool result, generated patch가 provider log와 retention 정책에서 어떻게 처리되는지도 확인한다. Managed endpoint는 초기 자본 비용을 줄이는 대신 data residency, egress, 공급자 장애, 가격 변경에 대한 통제권을 일부 잃는다.

### 경로 2: SGLang으로 self-hosting

공식 예제는 NVFP4 checkpoint를 4대 B300에 tensor parallel로 올리고 DFlash2 drafter를 붙인다.[4] 검토 시점의 SGLang cookbook은 일반 release image가 아니라 전용 `lmsysorg/sglang:beam` image를 먼저 받도록 안내한다.[12] 따라서 아래 명령은 그 image 또는 동일한 Beam 지원 commit 안에서 실행해야 하며, production에서는 mutable tag 대신 검증한 digest를 고정한다.

```bash
docker pull lmsysorg/sglang:beam
```

아래는 그 환경에서 핵심 option을 보존한 실행 형태다.

```bash
python -m sglang.launch_server \
  --model-path reflection/Beam-1.0-501B-A23B-NVFP4 \
  --served-model-name beam \
  --tp 4 \
  --attention-backend trtllm_mha \
  --page-size 64 \
  --context-length 1048576 \
  --mem-fraction-static 0.85 \
  --enable-unified-memory \
  --speculative-algorithm DFLASH \
  --speculative-draft-model-path reflection/Beam-1.0-501B-A23B-DFlash2 \
  --speculative-dflash-block-size 8 \
  --tool-call-parser beam \
  --reasoning-parser beam \
  --host 127.0.0.1 \
  --port 30000
```

원문은 외부 접근을 위해 `0.0.0.0`을 사용하지만, 인증 proxy와 network policy가 준비되지 않은 첫 검증에서는 loopback binding이 안전하다. H200에서는 FP8 checkpoint, TP 8, `fa3` attention backend를 쓰는 별도 예제가 있다.[4] Hardware와 precision을 바꾸면서 option 하나만 복사하면 kernel 불일치나 OOM을 만들 수 있다.

vLLM도 recipe를 제공하지만 현재 pinned 문서는 Beam 지원이 아직 정식 vLLM release에 포함되지 않았고 전용 `reflection-beam` image를 사용한다고 명시한다.[11] 따라서 `latest` image를 무조건 pull하기보다 문서가 검증한 image digest와 recipe commit을 내부 배포 manifest에 고정해야 한다.

## Agent 활용 시나리오

### 1. 대형 repository의 변경 계획과 코드 탐색

Beam은 coding과 long-horizon agent task를 주목적으로 둔다. 긴 context에는 repository map, 관련 source, test failure, issue thread를 넣을 수 있다. 하지만 전체 repository를 무차별로 한 prompt에 넣는 것보다 search와 dependency graph로 필요한 범위를 줄이는 편이 비용과 품질 모두 유리하다.

권장 흐름은 `search → read-only 분석 → patch 제안 → 격리 test → human review → apply`다. 모델이 shell과 GitHub token을 직접 가진 상태에서 처음부터 끝까지 실행하게 하지 않는다. Context가 길어질수록 prompt injection이 숨을 표면도 넓어진다.

### 2. CI failure triage

Build log, test result, 최근 diff를 함께 주고 실패 원인 후보와 재현 명령을 만들게 할 수 있다. 이때 성공 기준은 “그럴듯한 설명”이 아니라 clean checkout에서 재현되는 최소 command와 failing assertion이다. 모델이 수정한 뒤에는 원래 failure가 사라졌는지, 회귀 test가 fix를 되돌렸을 때 다시 실패하는지 확인해야 한다.

### 3. 내부 runbook 질의와 tool orchestration

1M context는 여러 runbook과 schema를 함께 읽는 데 쓸 수 있다. 그러나 retrieval 결과는 명령이 아니라 untrusted data로 취급한다. Tool argument는 schema validation을 거치고, write·delete·deploy에는 별도 authorization을 둔다. Answer quality와 action authority를 같은 점수로 묶지 않는다.

## 공급자 benchmark를 구매 결론으로 쓰지 않기

모델 카드에는 SWE-bench Verified, Terminal Bench, AIME 등 다양한 결과가 precision별로 공개돼 있다. 예를 들어 Beam BF16의 SWE-bench Verified는 81.6%, Terminal Bench v2.1은 80.1%로 기재돼 있다.[2] 모든 표는 temperature 0.7, top-p 0.99 조건이라고 명시한다.

이 숫자는 **공급자가 게시한 model-card 결과**다. 공개 직후라 동일 harness, 동일 prompt, 동일 tool policy, 동일 budget으로 반복한 독립 검증이 충분히 축적됐다고 보기 어렵다. HF 글이 공개한 다섯 task 실험도 스스로 “vibe evals, not benchmarks”라고 선을 긋는다.[4] 이 글도 Beam을 실행할 수 있는 GPU cluster나 유료 endpoint workload를 대신 실행한 독립 benchmark 결과를 제시하지 않으며, 아래 내용은 독자가 자기 workload에서 검증할 측정 계약이다.

내부 평가에서는 다음 조건을 고정해야 한다.

- checkpoint: BF16, FP8, NVFP4 중 하나
- serving engine와 image digest
- GPU 종류·개수·interconnect
- context 길이와 input/output token 상한
- batch, concurrency, reasoning effort
- tool schema, timeout, retry, sandbox image
- dataset commit과 contamination 검토
- pass criterion과 grader version

Coding agent라면 pass rate만으로 부족하다. 평균 token, wall-clock, 실패한 tool call, test retry, invalid patch, human correction 시간도 측정한다. 저렴한 token 생성이 긴 trajectory와 재시도로 상쇄될 수 있기 때문이다.

Quantization도 별도 실험 축이다. Model card 표에서 BF16·FP8·NVFP4 점수가 비슷하게 보이더라도 모든 업무에서 품질 손실이 없다는 뜻은 아니다.[2] 긴 context retrieval, structured tool call, 한국어, 조직 전용 codebase에서 precision별 회귀를 따로 돌려야 한다.

## 운영 비용을 계산하는 방법

Self-hosting 비용은 GPU 시간에 국한되지 않는다. 최소한 다음 항목을 한 장부에 넣어야 한다.

- GPU node 임대 또는 감가상각
- checkpoint download와 persistent storage
- replica별 weight memory
- KV cache와 peak concurrency를 위한 여유
- inter-GPU·inter-node network
- cold start와 kernel autotuning 시간
- image·driver·CUDA·engine upgrade 검증
- observability와 incident response
- idle capacity와 예약 instance lock-in

vLLM recipe는 NVFP4 첫 시작에서 FlashInfer MoE kernel autotuning이 약 10분 걸릴 수 있어 engine-ready timeout을 3,600초로 늘린다.[11] Autoscaler가 이 startup cost를 모르고 빠르게 scale-out·scale-in하면 traffic을 받기도 전에 node가 회수될 수 있다.

비용 비교 단위는 `원/token` 하나보다 `원/승인된 작업`이 낫다. 예를 들어 patch 하나가 test를 통과하고 reviewer가 채택할 때까지 사용한 prompt·generation·tool execution·retry·GPU idle 시간을 합친다. Managed endpoint와 self-hosted를 같은 task set, 같은 SLO, 같은 품질 gate로 비교해야 한다.

## 보안: 안전 학습과 안전한 agent는 다른 문제다

Beam 안전 보고서는 harmful request에 대한 refusal/pivot, systemic risk, child safety, prompt injection 등을 평가한다. BF16 harmful request refuse-or-pivot rate는 88.90%, NVFP4는 88.50%, 8-bit variant는 89.70%로 보고됐다.[5] 이 수치는 Reflection의 평가 조건에서 나온 결과이며, “약 11%는 곧바로 위해를 제공한다”처럼 보완 관계로 단순 해석해서는 안 된다. 평가 category와 grader의 정의를 함께 읽어야 한다.

보고서는 indirect prompt injection 완화로 agent harness의 developer prompt에 tool output 속 지시를 무시하라는 정책을 넣었다고 설명한다.[5] 중요한 사실은 이 완화가 **model weight 자체의 강제 경계가 아니라 harness prompt의 한 계층**이라는 점이다. 공격자가 prompt를 우회하거나 tool result가 신뢰된 system context로 잘못 승격되면 같은 보장이 유지되지 않는다.

Production agent에는 모델 밖의 통제가 필요하다.

1. Tool은 기본 deny와 최소 scope로 등록한다.
2. Web·email·issue·문서는 untrusted input으로 label한다.
3. Secret은 모델 context에 넣지 않고 실행 경계에서 짧게 주입한다.
4. File write와 network egress를 sandbox policy로 제한한다.
5. Deploy, payment, delete, permission change에는 대상과 diff에 묶인 승인을 요구한다.
6. Tool call 전후 argument, policy decision, result hash를 감사 event로 남긴다.
7. Timeout 뒤 결과 불명 상태를 성공이나 실패로 임의 확정하지 않는다.

Open weights는 공급자 API 의존을 줄이고 model binary를 보유하게 한다. 대신 abuse monitoring, patch adoption, access control, incident response를 배포자가 맡는다. “내 VPC에 있다”는 사실은 prompt injection, 과도한 IAM, secret leakage를 해결하지 않는다.

## 실패 모드와 rollout gate

### Weight는 올라갔지만 request를 받을 여유가 없다

Model load 성공 직후 남은 VRAM이 적으면 짧은 smoke test는 통과해도 긴 context나 concurrency에서 OOM이 난다. 해결은 context cap, batch cap, KV cache budget을 명시하고 longest-context와 peak-concurrency test를 분리하는 것이다.

### Expert traffic이 특정 GPU에 몰린다

평균 active parameter가 같아도 input distribution에 따라 expert routing이 불균형할 수 있다. GPU별 utilization, all-to-all bytes, queue delay, expert load 분포를 관측한다. 평균 throughput만 보면 한 GPU의 straggler를 놓친다.

### Speculative decoding이 항상 빠르다고 가정한다

DFlash2 drafter는 후보 token을 먼저 만들고 target model이 검증한다. Acceptance가 낮은 domain이나 낮은 concurrency에서는 추가 memory와 compute가 이득을 상쇄할 수 있다. On/off A/B에서 acceptance rate, ITL, throughput, peak VRAM을 함께 비교한다.

### 최대 context가 정확도를 보장한다고 믿는다

1M token이 입력 가능해도 오래된 정보 회수, 위치 편향, 상충 문서 처리 품질은 별도 문제다. Needle test 하나 대신 실제 repository·runbook fixture에서 근거 인용과 변경 대상 선택을 평가한다.

### Reasoning trace를 비밀 로그로 축적한다

Beam response template은 reasoning, answer, tool call을 분리한다.[4] Debugging에는 유용하지만 reasoning에 source code, customer data, secret fragment가 남을 수 있다. Log retention, redaction, 접근 권한을 answer log보다 더 느슨하게 두면 안 된다.

### Engine의 day-0 branch를 정식 release로 착각한다

전용 image나 unreleased recipe에는 빠른 지원과 재현성 위험이 함께 있다. Image digest, driver, CUDA, model revision을 고정하고 upgrade 전 shadow traffic을 돌린다. “day-0 지원”은 장기 호환성 보증이 아니다.

## 현실적인 도입 순서

**1단계: task fixture를 먼저 만든다.** 실제 업무에서 30~100개 대표 task를 고르고 성공 조건, timeout, 금지 action을 적는다.

**2단계: managed endpoint에서 품질 상한을 본다.** Reasoning effort와 context를 제한하며 pass rate, token, latency, tool error를 수집한다.

**3단계: precision을 비교한다.** 같은 fixture로 BF16 또는 provider baseline과 FP8·NVFP4의 품질 차이를 측정한다.

**4단계: read-only self-hosted canary를 연다.** 실제 secret과 write tool 없이 model serving 안정성, cold start, OOM, routing imbalance를 관측한다.

**5단계: 제한된 tool을 붙인다.** Search와 test처럼 가역적이고 격리 가능한 도구부터 시작한다.

**6단계: approval-bound write를 연다.** 생성한 patch hash와 대상 repository를 승인 객체에 묶고, 적용 뒤 read-back을 요구한다.

**7단계: rollback을 시험한다.** Model revision, serving image, prompt policy 중 하나를 되돌릴 때 session과 in-flight request를 어떻게 처리할지 실제로 연습한다.

Rollout 승인 조건에는 task success뿐 아니라 P95 TTFT, P95 completion latency, peak VRAM, error rate, cost per accepted task, unauthorized tool attempt, human correction rate를 넣는다. 어느 하나가 임계치를 넘으면 더 작은 model이나 managed route로 돌아갈 수 있어야 한다.

## 어떤 팀에 맞고, 어떤 팀에는 맞지 않나

Beam은 다음 조건의 팀에 맞을 가능성이 높다.

- Coding·reasoning·agent task가 충분히 크고 반복적이다.
- 대형 NVIDIA GPU node와 빠른 interconnect를 운영할 역량이 있다.
- Data residency나 model customization 때문에 self-hosting 가치가 크다.
- Evaluation fixture와 sandbox, approval, audit를 모델과 별도로 운영한다.
- 1M context를 쓰는 명확한 workload가 있고 context 비용을 측정할 수 있다.

반대로 다음 환경에는 과한 선택일 수 있다.

- 단일 consumer GPU나 작은 on-prem server가 유일한 실행 환경이다.
- 짧은 classification·extraction이 주 workload다.
- Traffic이 작고 변동이 커서 idle GPU 비용이 크다.
- Model quality를 비교할 fixture가 없고 leaderboard만으로 도입하려 한다.
- Tool 권한과 secret 관리가 아직 prompt에 의존한다.
- 한국어 중심 업무인데 별도 회귀 평가 없이 영어 benchmark를 그대로 신뢰하려 한다.

이 경우 작은 dense model, 더 작은 open-weight model, 또는 managed endpoint가 단순하고 저렴할 수 있다. Beam은 “23B처럼 계산하는 501B”이지 “23B처럼 저장하고 운영하는 501B”가 아니다.

## 결론: sparse compute가 infrastructure를 희소하게 만들지는 않는다

Beam의 공개는 의미가 크다. Apache-2.0 가중치, 세 precision, 1M context, native Transformers 구현, SGLang·vLLM 경로, 안전 보고서가 같은 시점에 나왔다. 공개 첫날부터 다운로드와 serving integration이 관측된 점도 실제 검토 가치를 높인다.

그러나 핵심 trade-off는 숫자 두 개 사이에 있다. **23B active는 token당 계산량을 줄이고, 501B total은 weight memory와 배포 복잡도를 남긴다.** 여기에 context와 concurrency가 KV cache를 늘리고, expert parallelism이 network를 요구하며, agent tool이 보안 경계를 확장한다.

따라서 Beam을 평가할 때 첫 질문은 “23B active 모델이 얼마나 똑똑한가”가 아니다. **우리 hardware에서 어떤 precision과 context로 SLO를 지키는가, 승인된 업무 한 건당 비용은 얼마인가, model 밖의 권한 경계가 실패해도 피해를 제한할 수 있는가**를 물어야 한다. Open weight가 통제권을 주는 것은 맞다. 그 통제권을 운영 능력으로 바꾸는 비용까지 계산해야 비로소 적합한 선택이 된다.

## Sources

[1] https://reflection.ai/blog/beam-is-available
[2] https://huggingface.co/reflection/Beam-1.0-501B-A23B
[3] https://huggingface.co/reflection/Beam-1.0-501B-A23B/blob/main/LICENSE
[4] https://huggingface.co/blog/reflection-beam
[5] https://reflection.ai/beam-safety-report
[6] https://huggingface.co/api/models/reflection/Beam-1.0-501B-A23B
[7] https://huggingface.co/api/models/reflection/Beam-1.0-501B-A23B-FP8
[8] https://huggingface.co/api/models/reflection/Beam-1.0-501B-A23B-NVFP4
[9] https://huggingface.co/api/models/reflection/Beam-1.0-501B-A23B-DFlash2
[10] https://github.com/huggingface/transformers/blob/09281b8d56b08199ce9f397c694f38853cc45278/docs/source/en/model_doc/beam.md
[11] https://github.com/vllm-project/recipes/blob/d6f49e55be3cb340f7a15499057206ca6f26f2db/models/reflection/Beam-1.0-501B-A23B.yaml
[12] https://github.com/sgl-project/sglang/blob/456231e2517dd29e78c77d20126c893b3f1a6675/docs/cookbook/autoregressive/Reflection/Beam-1_0.mdx
[13] https://reflection.ai/blog/introducing-beam