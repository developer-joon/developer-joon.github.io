---
title: '음성 AI에서 첫 50ms 벤치마크를 읽는 법'
date: 2026-08-22 10:00:00 +0900
categories: ["AI 에이전트"]
description: '실시간 음성 AI에서 모델 추론 속도와 end-to-end 체감 latency를 구분하고 첫 오디오, 재생 끊김, 동시성, 비용을 함께 최적화하는 방법을 살펴본다.'
featured_image: 'https://picsum.photos/seed/realtime-voice-ai-first-50ms/1600/900'
tags: [voice-ai, tts, latency, streaming, qwen3-tts, realtime-ai, inference]
---

![실시간 음성 AI의 첫 50ms](https://picsum.photos/seed/realtime-voice-ai-first-50ms/1600/900)

음성 AI의 품질을 비교할 때 사람들은 자연스러움, 발음 정확도, 화자 유사도를 먼저 본다. 물론 중요하다. 그러나 실시간 대화 제품에서는 좋은 샘플 하나보다 사용자가 말을 마친 뒤 시스템이 얼마나 빨리 반응을 시작하는지가 경험을 크게 좌우한다. 짧은 침묵이 반복되면 정확한 음성도 느리고 어색하게 느껴진다.

그렇다고 "첫 50ms"를 모델 benchmark 하나로 이해하면 안 된다. TTS 서버가 요청을 받은 뒤 첫 가청 audio를 내보내는 시간과, 사용자가 발화를 끝낸 뒤 speaker에서 응답을 듣기까지의 end-to-end latency는 전혀 다른 지표다. 음성 agent에는 endpoint detection, speech-to-text, LLM, text segmentation, TTS, network jitter, client buffer와 audio device가 모두 들어간다.

Nari Labs는 Qwen3-TTS 1.7B CustomVoice serving 구현에서 단일 NVIDIA H100 SXM 기준 10 RPS와 p95 50ms 미만의 time-to-first-audio를 달성했다고 발표했다.[3] 이 수치는 Nari Labs가 공개한 자체 구현과 자체 benchmark 방법론의 결과다. 독립 기관이 동일 환경에서 재현한 검증 결과로 소개해서는 안 된다. 더 중요한 것은 숫자 자체보다 측정 정의와 시스템 구조다.

## 문제: 빠른 모델과 빠른 대화는 다르다

실시간 음성 경로를 단순화하면 다음과 같다.

```text
사용자 발화
  → 마이크와 업로드
  → VAD / endpoint detection
  → ASR
  → LLM 첫 유효 text
  → 문장 분할
  → TTS 첫 가청 audio
  → download와 jitter buffer
  → speaker 재생
```

TTS server의 50ms는 이 긴 경로의 한 구간이다. 사용자가 체감하는 응답 시작 시간은 대략 다음처럼 생각할 수 있다.

```text
Turn latency ≈ endpointing + ASR + LLM + TTS + network delivery + client buffer
```

여기서 발화 종료 판단이 500ms를 기다리고 LLM이 첫 문장 조각을 만드는 데 700ms가 걸린다면 TTS를 100ms에서 50ms로 줄여도 전체 대화는 50ms만 빨라진다. 반대로 이미 streaming ASR과 streaming LLM을 사용해 앞단 지연을 크게 줄였다면 TTS의 수십 ms가 눈에 띄는 차이를 만들 수 있다.

따라서 "음성 AI는 50ms"라는 목표는 전체 시스템 budget 안에서 해석해야 한다. 특정 component의 최고 수치가 end-to-end SLA를 대신하지 않는다.

## latency 용어를 먼저 분리한다

음성 시스템의 지표부터 분리하자.

### Time to First Byte

TTS 요청 이후 첫 network byte가 도착한 시간이다. header나 metadata가 먼저 올 수 있고 audio chunk 안에 silence만 있을 수도 있다. 사용자가 실제 소리를 들었다는 뜻은 아니다.

### Time to First Audio

첫 PCM 또는 compressed audio frame을 받은 시간이다. 이 frame에도 leading silence가 포함될 수 있다.

### Audible TTFA

요청 dispatch부터 지속적인 가청 신호가 시작될 때까지의 시간이다. Nari Labs 글은 audible TTFA를 강조하고, 짧은 RMS window로 leading silence를 trim해 이 지표를 줄였다고 설명한다.[3]

중요한 구분이 있다. leading silence를 80ms가량 제거했다는 글의 결과는 **모델 추론을 80ms 빠르게 만든 것이 아니다**. 이미 생성된 audio 앞부분의 silence를 잘라 사용자가 듣는 시작 시점을 앞당긴 serving·signal-processing 최적화다.[3]

### Turn latency

사용자 발화가 실제로 끝난 순간부터 agent 음성이 들릴 때까지의 시간이다. 제품 UX에서 가장 중요한 지표지만 측정하기 어렵다. 사용자가 문장 중간에 잠시 쉰 것인지 진짜 끝낸 것인지 판단하는 endpointing까지 포함하기 때문이다.

## 구조: 첫 chunk와 이후 chunk의 목표가 다르다

TTS streaming은 단일한 throughput 최적화 문제가 아니다. 첫 audio 전과 후의 scheduling 목표가 다르다.

첫 chunk 전에는 매 millisecond가 그대로 침묵으로 느껴진다. 따라서 초기 text·audio token 생성과 codec decoding을 빠르게 우선 처리해야 한다. playback이 시작된 뒤에는 다음 chunk가 현재 buffer가 끝나기 전에만 도착하면 된다. 지나치게 일찍 만들어도 사용자가 더 빨리 듣지 못하고 GPU memory와 queue만 차지한다.

Nari Labs가 설명한 Qwen3-TTS 구조는 Talker, Code Predictor, Codec의 세 부분으로 나뉜다. 자체 구현은 이 세 작업을 하나의 scheduling surface에서 독립적으로 다루고, 아직 첫 audio를 만들지 못한 요청과 playback deadline이 가까운 stream에 우선순위를 준다고 한다.[3]

개념적으로 scheduler는 다음 두 종류의 deadline을 관리한다.

```text
Cold stream: 가능한 한 빨리 첫 chunk 생성
Warm stream: 현재 buffer가 고갈되기 전에 다음 chunk 생성
```

이 구분은 queue discipline을 바꾼다. 모든 request를 FIFO로 처리하거나 batch throughput만 최대화하면 새 요청의 TTFA가 길어진다. 반대로 첫 chunk 요청만 지나치게 우선하면 진행 중인 stream에 underrun이 발생한다. latency와 continuity 사이의 균형이 필요하다.

## chunk 크기의 트레이드오프

작은 초기 chunk는 TTFA를 줄인다. codec이 적은 frame만 모아도 audio를 내보낼 수 있기 때문이다. 하지만 playback headroom이 작고, decode와 network send가 더 자주 발생하며, packet overhead와 scheduling 횟수가 늘어난다.

큰 chunk는 batching과 GPU 효율에 유리하고 underrun 위험을 낮출 수 있지만 첫 audio가 늦어진다. 실무에서는 처음에는 작은 chunk를 보내고 이후에는 크기를 늘리는 ramp 전략이 합리적이다. Nari Labs 글도 serving engine별 frame accumulation을 조정하고 초기에는 작은 chunk, 이후에는 큰 chunk를 사용하는 접근을 설명한다.[3]

이 trade-off는 server에서 끝나지 않는다. client jitter buffer가 audio를 모은 뒤 재생하면 server가 50ms에 첫 chunk를 보내도 사용자는 더 늦게 듣는다. 브라우저 AudioWorklet, mobile audio session, Bluetooth 장치도 별도 지연을 더한다. 따라서 chunk 실험은 실제 speaker output, underrun, client CPU와 p95·p99 jitter까지 기록해야 한다.

## 모델 추론 최적화와 serving 최적화를 구분한다

빠른 TTS 결과에는 여러 층의 최적화가 섞여 있다. 정확한 의사결정을 위해 층별로 분류해야 한다.

### 모델·kernel 수준

- attention kernel 최적화
- CUDA graph capture
- KV cache preallocation
- mixed precision과 quantization
- codec incremental state cache

이 변화는 실제 compute와 synchronization 비용을 줄일 수 있다. 다만 음질, memory, 지원 batch size에 미치는 영향도 측정해야 한다.

### scheduler 수준

- 첫 chunk 요청 우선순위
- playback deadline scheduling
- compatible request batching
- module별 작업 interleaving
- queue와 admission control

이는 같은 model이라도 여러 요청이 경쟁할 때 tail latency와 capacity를 바꾼다.

### audio pipeline 수준

- leading silence trimming
- frame accumulation과 chunk ramp
- PCM encoding과 transport
- client jitter buffer
- audio device warm-up

이 층은 사용자가 듣는 시점을 크게 바꿀 수 있지만 model inference 자체를 빠르게 했다고 표현하면 부정확하다.

### application 수준

streaming ASR·LLM, 빠른 endpointing과 text segmentation도 중요하다. 전체 문장이 완성되기 전에 발화 가능한 첫 clause를 TTS에 넘기면 model을 바꾸지 않아도 체감 latency를 줄일 수 있다. 단, 문맥이 확정되기 전에 합성하면 억양이 어색하거나 뒤 문장을 수정할 수 없다는 trade-off가 있다.

## 50ms보다 어려운 것은 끊기지 않는 20 RPS다

낮은 부하에서 한 요청의 첫 audio를 빨리 만드는 것과 동시 요청이 늘어도 p95를 유지하는 것은 다른 문제다. queue가 생기면 평균보다 tail latency가 먼저 나빠진다.

Nari Labs는 Poisson open-loop traffic으로 5분간 측정하고, 자체 구현이 10 RPS에서 p95 audible TTFA 50ms 미만, 20 RPS에서도 100ms 미만이었다고 보고한다.[3] 또한 10 RPS에서 약 630 characters per second, H100 시간당 4.29달러를 가정하면 full utilization에서 100만 character당 약 2달러라고 계산한다.[3]

이 수치들은 모두 해당 글의 저자 측 측정과 계산이다. 특히 비용 추정에는 network, idle capacity, 운영 overhead가 제외됐다고 원문도 밝힌다.[3] 실제 서비스 비용으로 그대로 사용하면 안 된다. 독립 재현 여부, hardware와 software revision, 품질 조건, 평균 utilization을 별도로 확인해야 한다.

benchmark를 읽을 때는 다음 질문이 필요하다.

- 입력 text 길이와 언어 분포가 production과 같은가
- warm model과 cold start를 구분했는가
- open-loop에서 overload 시 실패 요청을 어떻게 계산했는가
- first audio 이후 underrun이 없는가
- audio가 malformed되지 않았는가
- 음질과 speaker similarity가 유지됐는가
- 같은 GPU와 software version으로 비교했는가
- 5분보다 긴 steady-state에서도 memory와 queue가 안정적인가

## end-to-end latency budget을 먼저 만든다

제품팀은 TTS vendor의 단일 수치를 비교하기 전에 turn latency budget을 만들어야 한다. 예를 들어 목표를 특정 숫자로 고정하기보다 각 구간의 current p50·p95와 개선 가능성을 표로 관리한다.

| 구간 | 측정 시작 | 측정 종료 | 핵심 위험 |
| --- | --- | --- | --- |
| endpointing | 마지막 가청 사용자 음성 | turn 종료 판정 | 너무 빠르면 발화 중단 |
| ASR | audio 수신 | 안정된 text | 수정되는 partial transcript |
| LLM | prompt 가능 시점 | 첫 발화 가능한 text | 긴 prefill·tool call |
| TTS | text dispatch | 첫 가청 server audio | queue·leading silence |
| delivery | server audio | speaker output | network·buffer·device |

각 span에 공통 trace ID를 넣으면 "TTS가 느리다"는 인상 대신 실제 병목을 찾을 수 있다. audio loopback이나 외부 microphone으로 speaker output을 재는 synthetic probe도 유용하다. barge-in, 응답 중단, turn completion과 대화당 비용을 함께 봐야 한다.

## 실무 체크리스트

### 지표 정의

- TTFB, first audio, audible TTFA, turn latency를 구분했는가
- server clock과 실제 speaker output을 모두 측정하는가
- p50·p95·p99와 RPS를 함께 기록하는가
- 첫 chunk 이후 underrun과 completion time을 측정하는가
- model inference와 silence trimming 효과를 따로 보고하는가

### 시스템 구조

- endpointing, ASR, LLM, TTS, client buffer span이 하나의 trace로 연결되는가
- 첫 chunk 요청과 진행 중 stream의 priority가 다른가
- 작은 초기 chunk와 이후 ramp를 실험했는가
- admission control로 overload를 명시적으로 처리하는가
- client와 Bluetooth device의 buffer latency를 포함하는가

### benchmark와 품질

- production 언어·문장 길이·동시성을 재생하는가
- warm, cold, failure 결과를 분리하는가
- latency와 음질을 동일한 실험에서 평가하는가
- 공급자 자체 benchmark와 독립 검증을 구분하는가
- hardware 비용에 idle·network·운영 비용을 더했는가

### 제품 경험

- partial LLM text를 언제 TTS에 넘길지 규칙이 있는가
- 문장 수정 가능성과 빠른 시작 사이의 trade-off를 검토했는가
- barge-in 시 생성·전송·재생을 즉시 취소하는가
- 너무 빠른 응답이 사용자의 turn을 침범하지 않는가
- 자연스러움과 latency를 실제 사용자 실험으로 함께 확인하는가

## 결론

음성 AI에서 첫 50ms가 중요한 이유는 benchmark 순위를 만들기 위해서가 아니다. 대화는 첫 반응이 늦을 때 가장 먼저 기계적으로 느껴지기 때문이다. 낮은 audible TTFA는 대기 침묵을 줄이고 streaming 대화의 리듬을 개선할 수 있다.

그러나 TTS server의 50ms는 전체 경험의 50ms일 뿐이다. endpoint detection, ASR, LLM, text segmentation, network, client buffer, speaker가 더 큰 지연을 만들면 모델 serving 수치만으로는 제품이 빨라지지 않는다. 또한 첫 audio가 빠르더라도 이후 playback이 끊기거나 품질이 낮아지면 실시간 시스템으로 볼 수 없다.

실무의 목표는 단일 component 기록이 아니라 **낮은 p95 turn latency, zero에 가까운 underrun, 충분한 동시성, 검증된 음질을 동시에 유지하는 것**이다. 공급자가 제시한 수치는 후보 기술을 찾는 자료로 사용하고, 최종 판단은 우리 traffic과 실제 client 장치에서 측정한 end-to-end trace로 내려야 한다.

## 참고자료

- [3] [Nari Labs: Pushing the Speed-Cost Frontier for Qwen3-TTS](https://nari-labs.com/blog/qwen3-tts-speed-cost-frontier/)
