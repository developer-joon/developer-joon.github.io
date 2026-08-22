---
title: '클라우드 없이 돌아가는 AI: 14MB 모델과 자동 양자화의 현실'
date: 2026-08-22 08:30:00 +0900
categories: ["AI 뉴스/시장분석"]
description: 'Needle의 14MB 프로젝트 설명과 Shoehorn의 자동 혼합 정밀도 양자화를 바탕으로, 온디바이스 AI의 RAM·저장공간·전력·지연시간·정확도와 개인정보·업데이트·공급망 trade-off를 분석한다.'
featured_image: 'https://picsum.photos/seed/on-device-ai-tiny-model-quantization/1600/900'
tags: [on-device-ai, tiny-model, quantization, edge-ai, llama-cpp, privacy, benchmarking]
---

![온디바이스 AI와 양자화](https://picsum.photos/seed/on-device-ai-tiny-model-quantization/1600/900)

“14MB짜리 AI가 클라우드 없이 기기에서 실행된다”는 문장은 강력하다. 앱보다 작은 모델이 네트워크 없이 tool을 고르고 JSON을 만든다면 AI 제품의 비용과 개인정보 설계가 달라질 수 있다. 반대편에서는 수십억 parameter 모델을 사용자의 VRAM에 정확히 맞게 자동 양자화하려는 도구가 등장한다. 작은 모델을 처음부터 만드는 접근과 큰 모델을 압축해 끼워 넣는 접근이 동시에 발전하는 셈이다.

하지만 “작다”, “양자화됐다”, “로컬에서 돈다”는 같은 뜻이 아니다. 파일이 작아도 실행 RAM은 더 클 수 있고, weight가 VRAM에 들어가도 긴 context의 KV cache와 runtime overhead 때문에 실패할 수 있다. 추론 중 네트워크를 쓰지 않아도 최초 다운로드와 update는 온라인일 수 있다. bit 수를 낮췄다고 같은 품질이 보장되는 것도 아니다.

Needle 2 저장소는 45M-parameter tool-calling 모델을 하나의 14MB binary로 제공하고 약 28MB RAM에서 session을 실행한다고 설명한다. Shoehorn은 BF16 GGUF에서 시작해 실제 memory budget에 맞춰 tensor별 mixed precision을 자동 배정하고 `llama.cpp`에서 실행할 GGUF를 만든다고 소개한다. **두 프로젝트의 용량, RAM, benchmark와 99.99% budget 사용 수치는 개발자가 공개한 공식 프로젝트 설명이지 이 글이 독립적으로 재현한 결과가 아니다.** 설계 아이디어와 검증된 배포 결론을 구분해야 한다.

## 문제 정의: “기기에 들어간다”는 무엇인가

온디바이스 AI의 성공 조건은 model file을 저장할 수 있느냐보다 복잡하다. 최소한 여섯 예산을 따로 봐야 한다.

1. **저장공간**: weight, runtime, tokenizer, adapter와 update가 차지하는 flash
2. **실행 메모리**: weight mapping, KV cache, activation과 host app의 RAM·VRAM
3. **연산량과 bandwidth**: prompt 처리와 token 생성 중 발생하는 계산과 memory 이동
4. **latency**: cold start, first token, decode와 tool 실행을 합친 응답 시간
5. **전력과 발열**: 반복 사용의 battery 소모와 thermal throttling
6. **품질과 범위**: 정확도, 언어, context, tool schema, 거부와 실패 감지

14MB 파일은 배포에 유리해도 Python package와 host app을 합친 peak RSS가 mobile OS의 제한을 넘을 수 있다. 8GB VRAM에 weight가 들어가도 32K context의 KV cache와 graphics driver가 공간을 차지하면 out-of-memory가 난다. 평균 latency가 짧아도 첫 실행의 download와 initialization이 길면 UX는 나쁘다.

따라서 “fit”은 binary question이 아니다. cold start, steady state, 최대 context, 동시 request, background 상태와 발열 뒤 조건에서 각각 맞아야 한다. 그리고 용량이 아니라 **동일 품질 조건**에서 cloud와 다른 local configuration을 비교해야 한다.

## 작은 모델과 양자화 모델은 다르다

작은 모델은 parameter 수, layer, hidden dimension, context 또는 task 범위를 설계 단계에서 줄인다. Needle 2는 45M parameter와 tool calling·device use·structured extraction이라는 좁은 목표를 내세운다. 일반적인 장문 작성이나 광범위한 지식 질의보다 schema에서 함수를 고르고 argument를 구조화하는 문제에 집중한다.

장점은 weight뿐 아니라 연산량과 memory traffic도 줄일 가능성이 크다는 것이다. 대신 범위 밖 질문, 복잡한 reasoning, 다국어와 긴 문서에서는 capacity 한계가 빠르게 드러날 수 있다. “작다”는 단순 압축이 아니라 capability contract다.

양자화는 이미 학습된 weight를 더 적은 bit로 표현한다. parameter 수와 architecture가 같아도 16bit 대신 8bit, 4bit 또는 더 낮은 표현으로 저장해 파일과 bandwidth를 줄일 수 있다. scale과 block metadata가 추가되므로 parameter 수와 bit를 곱한 값이 최종 크기와 정확히 같지는 않는다.

양자화는 큰 모델을 제한된 hardware로 옮길 수 있지만 rounding과 clipping으로 정보가 손실된다. tensor마다 민감도가 다르고 runtime kernel이 해당 format을 효율적으로 지원해야 한다. 파일이 줄어도 dequantization이 비효율적이면 latency와 전력이 기대만큼 좋아지지 않는다.

작은 모델도 양자화할 수 있다. Needle는 작은 45M model에 2-bit 계열 압축을 적용했다고 설명하므로 두 전략을 결합한 사례다. Shoehorn은 더 큰 BF16 GGUF에서 시작해 budget에 맞는 mixed precision을 찾는다. 하나는 model architecture와 task specialization을 포함한 제품이고, 다른 하나는 기존 model을 hardware에 맞추는 도구다. 두 결과의 “몇 MB”를 곧바로 품질 비교로 연결하면 안 된다.

## Needle의 14MB를 정확히 읽는 법

Needle 저장소가 말하는 14MB는 Needle 2의 **weights가 포함된 단일 engine binary**에 대한 프로젝트 설명이다. Python package를 설치하면 engine을 한 번 가져와 cache하며, inference 자체는 network를 사용하지 않고 air-gapped setup도 제공한다고 적혀 있다. 즉 모든 범용 AI가 14MB라는 뜻이 아니라 특정 구조·weight·runtime과 tool-calling contract를 묶은 artifact에 관한 주장이다.

README는 약 28MB RAM, 256-token sliding window, tool 정보를 고정하는 KV sink로 session memory를 제한한다고 설명한다. 작은 RAM에는 유리하지만 256 token window는 긴 고객 문의나 code context를 다루기 어렵게 한다. bounded memory는 공짜 최적화가 아니라 과거 정보를 버리는 정책이다.

또 다른 핵심은 constrained decoding이다. 선언된 tool schema에서 byte-level grammar를 만들고 JSON 형태의 call을 출력한다. 문법 제약은 invalid JSON과 허용되지 않은 field를 줄일 수 있다. 많은 tool 중 상위 다섯 개를 고르는 retrieval head와 learned confidence score로 낮은 신뢰의 요청을 escalation한다는 설명도 있다.

그러나 grammar는 형식을 제한할 뿐 잘못된 room이나 금액을 선택하는 semantic error까지 막지 않는다. confidence도 실제 언어와 device command에서 다시 calibration해야 한다. 공식 benchmark에서 다른 작은 모델과 경쟁했다는 주장은 출발점일 뿐, 우리 tool description과 한국어 입력에서 같은 false-positive를 보장하지 않는다.

검증할 때는 설치 footprint, peak RSS, window에서 정보가 밀려난 뒤 성공률과 confidence threshold별 잘못된 실행을 측정하고, clean install 뒤 airplane mode에서도 시험해야 한다.

## Shoehorn의 자동 양자화는 무엇을 자동화하는가

일반적인 local LLM 배포에서는 Q4, Q5, Q8 같은 preset 중 하나를 고른다. 여유 있게 들어가면 남은 VRAM을 더 높은 정밀도에 쓰지 못하고, 너무 큰 파일을 고르면 context와 runtime 공간이 없어 load에 실패한다.

Shoehorn 프로젝트 페이지는 BF16 GGUF와 importance matrix를 입력으로 받아, 사용 가능한 VRAM에서 추론 overhead를 먼저 빼고 tensor마다 다른 quantization type을 배정한다고 설명한다. 결과는 standard GGUF v3이며 `llama.cpp`를 backend로 사용한다. 일부 tensor는 품질에 민감해 더 많은 bit를 유지하고 덜 민감한 tensor는 낮은 정밀도를 사용한다.

페이지의 “99.99% budget 사용”은 저장 효율에 관한 주장이지 품질 99.99% 보존을 뜻하지 않는다. 13KB slack으로 VRAM을 채웠다는 예시는 budget 계산이 정밀했다는 의미에 가깝다. 답변 품질은 perplexity와 실제 task 평가로 별도 확인해야 한다. memory를 빈틈없이 쓰는 것과 좋은 답을 만드는 것은 다른 최적화 목표다.

runtime, driver, context와 host workload가 달라지면 overhead도 변한다. rounding error 수준의 fit은 안전 margin이 작다는 뜻이므로 production에서는 최대 사용률보다 안정성을 우선할 수 있다.

자동화도 판단을 없애지 않는다. 어떤 calibration data로 tensor 중요도를 계산하는지가 결과를 좌우한다. 영어 web text로 만든 importance matrix가 한국어 고객 문의, code completion과 JSON tool calling에도 최적이라는 보장은 없다. perplexity 변화가 작아도 숫자 복사, function argument, long-context retrieval와 안전 거부가 흔들릴 수 있다.

따라서 여러 memory budget으로 candidate를 만들고 peak memory, domain quality, latency·energy와 safety regression을 통과한 artifact만 배포해야 한다.

## RAM, 저장공간, latency와 전력

다운로드 크기와 peak memory는 별개다. load 중 임시 buffer, host app, OS reserve와 KV cache를 더하면 작은 artifact도 실행에 실패할 수 있다. 특히 KV cache는 context와 batch에 따라 커지며 weight를 Q4로 줄였다고 같은 비율로 줄지 않는다. artifact size, load 직후 RSS·VRAM, 최대 입력의 prefill peak와 동시 요청 peak를 모두 기록해야 한다.

latency도 token/s 하나가 아니다. command routing은 cold start와 first token, 장문은 decode가 중요하다. p50뿐 아니라 p95·p99와 장시간 실행 뒤 thermal throttling을 잰다. cloud 비용은 battery와 열로 이동한다. 낮은 bit kernel이 hardware에 비효율적이거나 낮은 정확도로 재시도와 cloud escalation이 늘면 성공 task당 energy는 오히려 커질 수 있다.

## 동일 품질 조건의 벤치마크

파일 크기와 benchmark score만 나란히 놓으면 공정하지 않다. model별 prompt, grammar, tool 수, context와 fine-tuning data가 다르기 때문이다. Needle 같은 tool specialist와 범용 chat model은 동일 schema, 입력과 성공 판정으로 비교해야 한다.

먼저 제품의 품질 threshold를 정한다. 예를 들어 home control은 위험 action false positive가 0.1% 아래여야 하고, invoice extraction은 field F1과 금액 exact match를 동시에 만족해야 한다. 그 threshold를 넘는 구성 중 storage, peak RAM, p95 latency와 energy가 가장 낮은 것을 선택한다.

비교군에는 원본 BF16/F16, 대표 preset quantization, Shoehorn식 자동 mixed precision, tiny specialized model과 cloud model을 넣는다. prompt, runtime, thread, sampling과 test set을 고정한다. 품질은 task success, invalid output, hallucinated tool, 위험 action과 calibration error를 측정한다. 성능은 cold start, end-to-end p50/p95, peak memory, energy와 throttle을 기록한다.

Needle의 confidence gate는 threshold별 automation·확인·escalation curve로 평가해야 한다. Shoehorn은 bits-per-weight나 budget utilization이 아니라 원본·preset과 **같은 task score를 내는 구간**의 memory와 latency를 비교해야 한다.

한국어 제품이라면 한국어, code-switching, 오타와 구어체를 넣는다. 음성을 쓰면 ASR 오류까지 포함한 end-to-end set이 필요하다. 영어 공식 benchmark를 한국어 device command 품질로 일반화해서는 안 된다.

## 개인정보와 offline의 경계

온디바이스 추론은 입력을 inference API로 보내지 않을 수 있다는 강점이 있다. 음성, 건강 기록과 사내 문서가 local memory를 벗어나지 않으면 provider log와 network breach 위험이 줄고, 장애나 air-gapped 환경에서도 핵심 기능을 유지할 수 있다.

그러나 local model이 데이터 무전송을 자동 보장하지는 않는다. crash report, analytics SDK, OS backup, update client, cloud fallback과 tool API가 정보를 보낼 수 있다. 모델이 local에서 tool을 골라도 CRM이나 home cloud API를 호출하면 argument가 network로 나간다.

검증은 전체 data flow를 대상으로 한다. airplane mode에서 core inference를 실행하고, cold start·idle·error·update의 outbound connection을 관찰한다. prompt와 output이 log, crash dump와 backup에 남는지 확인한다. cloud fallback은 opt-in으로 만들고 전송 범위를 사용자에게 보여준다. 삭제는 app database뿐 아니라 cache와 analytics queue까지 처리한다.

local history는 device 탈취 때 노출될 수 있다. device encryption, 최소 log, 짧은 retention과 key 보호가 필요하다. 개인정보 이점은 “클라우드가 없다”는 문구가 아니라 실제 network와 storage 관찰로 증명해야 한다.

## 업데이트와 공급망의 trade-off

cloud model은 server에서 교체하면 되지만 local model은 각 device에 weight와 runtime을 배포한다. 사용자는 version을 고정하고 offline으로 쓸 수 있는 대신, 오래된 model과 hardware별 fragmentation을 관리해야 한다. 14MB artifact는 update에 유리하지만 package와 engine을 합친 payload를 봐야 한다. 수 GB GGUF를 device별로 만들면 CDN, disk와 QA matrix가 커진다.

model update에는 source·data·quantizer·runtime version, artifact hash와 publisher signature가 필요하다. eval과 compatibility matrix를 남기고 staged rollout과 rollback을 제공해야 한다. GGUF 변환이나 LoRA merge도 원본 license와 재배포 제한을 없애지 않는다.

local 추론은 API provider 대신 model repository, package manager, parser, inference engine과 signing key를 신뢰한다. Needle는 engine을 받아 cache하고, Shoehorn은 Hugging Face와 `llama.cpp` 생태계를 사용한다. 악성 artifact, parser 취약점과 탈취된 release 계정이 공격 경로다.

air-gapped 환경에서는 online 장비에서 artifact, checksum, signature와 SBOM을 수집해 승인된 media로 옮기고 offline registry에서 version을 고정한다. “추론 중 network를 쓰지 않는다”와 “설치·update까지 완전 offline이다”를 분리해 시험해야 한다.

## 실무 체크리스트

- [ ] 작은 모델, 양자화와 온디바이스를 별도 요구사항으로 정의했다.
- [ ] artifact뿐 아니라 package·runtime·tokenizer를 포함한 설치 용량을 쟀다.
- [ ] load, 최대 context와 동시 request의 peak RSS·VRAM을 기록했다.
- [ ] KV cache, host app과 OS reserve를 budget에 포함했다.
- [ ] cold start, first token, p50/p95와 장시간 throttle을 측정했다.
- [ ] request당·성공 task당 energy를 비교했다.
- [ ] 원본, preset, 자동 양자화, tiny model을 같은 조건에서 평가했다.
- [ ] perplexity 외 domain task, 위험 action과 calibration error를 측정했다.
- [ ] 한국어·구어체·오타와 실제 입력 오류를 eval에 넣었다.
- [ ] Needle의 14MB·28MB를 공식 주장으로 표시하고 device에서 재측정했다.
- [ ] Shoehorn의 budget 사용률과 품질 보존률을 혼동하지 않는다.
- [ ] calibration corpus가 실제 언어와 domain을 대표한다.
- [ ] airplane mode와 clean install에서 offline 동작을 시험했다.
- [ ] analytics, crash report, backup, fallback과 tool API를 감사했다.
- [ ] model·quantizer·runtime version, hash, signature와 license를 기록했다.
- [ ] staged rollout, hardware canary, revoke와 rollback이 가능하다.

## 결론

클라우드 없이 돌아가는 AI는 한 가지 기술이 아니다. 처음부터 범위를 줄인 tiny model, 기존 model을 낮은 bit로 바꾼 quantized model, hardware마다 tensor 정밀도를 배분하는 자동 quantization과 local·cloud routing이 함께 움직인다.

Needle 2의 14MB는 작은 45M model, 제한된 context, constrained decoding, tool retrieval와 confidence gate를 묶어 tool calling을 작은 footprint에 맞추려는 공식 프로젝트 설명이다. 모든 AI 능력의 크기가 아니며 28MB RAM과 benchmark도 실제 제품 환경에서 독립 검증해야 한다.

Shoehorn은 양자화를 Q4·Q5 메뉴에서 memory budget 최적화 문제로 바꾸려는 접근이다. tensor별 mixed precision은 남는 VRAM을 품질에 배분할 수 있지만, 99.99% 사용률은 99.99% 품질과 무관하다. calibration, runtime overhead, 안정 margin과 downstream eval이 결과를 결정한다.

온디바이스의 진짜 가치는 작은 파일 하나가 아니다. 입력을 보내지 않을 선택권, offline 지속성, 예측 가능한 latency와 cloud 단가에서의 독립성이다. 그 대가로 device 편차, battery, update fragmentation과 공급망 책임을 떠안는다. 결국 **같은 품질과 안전 기준을 만족하는 구성** 가운데 storage, RAM, latency, energy, privacy와 운영 비용이 가장 나은 것을 골라야 한다. 작은 모델과 자동 양자화는 마법이 아니라 이 trade-off를 더 세밀하게 선택하게 하는 도구다.

## 참고 자료

- [Cactus Compute Needle GitHub Repository — 14MB binary, 약 28MB RAM, tool calling 구조에 대한 공식 프로젝트 설명](https://github.com/cactus-compute/needle)
- [Shoehorn Project Page — memory budget 기반 per-tensor mixed-precision quantization에 대한 공식 설명](https://notactuallytreyanastasio.github.io/shoehorn/)
