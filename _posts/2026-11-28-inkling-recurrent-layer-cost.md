---
title: '26B 모델이 48개 층처럼 계산하는 법: Inkling 2 Mini 반복 레이어 비용 실험'
date: 2026-11-28 07:25:00 +0900
categories: ["AI"]
description: 'Inkling 2 Mini의 물리·활성 파라미터와 논리 레이어 방문을 구분하고, 반복 계산의 지연·메모리 비용을 같은 장비에서 비교하는 실험안을 설계한다.'
featured_image: 'https://picsum.photos/seed/inkling-recurrent-layer-cost/1600/900'
tags: [inkling-2-mini, looped-transformer, moe, local-llm, benchmark]
---

![어두운 수영장 레인 위로 물보라가 솟는 장면](https://picsum.photos/seed/inkling-recurrent-layer-cost/1600/900)

Inkling 2 Mini를 “26B 모델인데 토큰마다 3B만 활성화되는 MoE”라고만 설명하면 중요한 비용이 빠진다. 이 모델은 24개 물리 레이어를 저장하지만, 가운데 12개 레이어를 세 번 방문해 토큰마다 총 48회의 논리 레이어 적용을 수행한다.[1] 저장해야 할 서로 다른 가중치 수와 실제 추론 중 실행되는 계산 경로가 일치하지 않는 사례다.

따라서 로컬 실행 가능성을 판단할 때 총 파라미터, 활성 파라미터, 체크포인트 크기 중 하나만 보면 안 된다. 이 글은 공개 수치를 정리한 뒤 **같은 장비에서 반복 레이어 비용을 분리하는 제안형 실험**을 설계한다. 여기 제시한 실험은 실행 결과가 아니며, 처리량이나 품질 개선을 주장하지 않는다.

## 26B·3.4B·5.4B·48의 뜻을 분리한다

모델 카드가 밝힌 총 파라미터는 26.4B, 기본 활성 파라미터는 3.4B다. 반복 코어를 한 번 더 통과할 때 약 1.0B의 유효 활성 파라미터가 추가되므로 세 번 통과하는 기본 설정의 토큰당 유효 활성 파라미터는 5.4B로 표기된다. 체크포인트는 NVFP4와 MXFP8이 섞인 약 20GB이며 Apache 2.0 라이선스로 배포된다.[2]

이 숫자는 서로 다른 질문에 답한다.

| 지표 | 답하는 질문 | 단독으로 답하지 못하는 것 |
|---|---|---|
| 26.4B physical | 서로 다른 가중치가 얼마나 저장되는가 | 토큰당 실제 연산량 |
| 3.4B active | 한 번의 레이어 경로에서 선택되는 가중치 규모는 얼마인가 | 반복 방문을 포함한 총 계산 |
| 5.4B effective active | 세 번의 반복을 반영한 유효 활성량은 얼마인가 | 런타임별 커널 효율과 지연 |
| 48 logical visits | 토큰이 레이어 적용을 몇 번 거치는가 | 각 방문의 동일한 비용 여부 |

“3.4B만 활성화되므로 일반 3B 모델 속도일 것”이라는 추정도, “48층이므로 일반 48층 모델과 같을 것”이라는 추정도 성립하지 않는다. MoE 라우팅, 공유 가중치 재사용, attention 상태, 정밀도와 런타임 구현이 모두 비용을 바꾼다.

## 24개 가중치 층을 48번 적용하는 구조

디코더는 0~5번 레이어를 한 번, 6~17번 레이어를 세 번, 18~23번 레이어를 한 번 실행한다. 계산하면 6 + 12×3 + 6으로 48회다. 세 반복은 6~17번의 같은 가중치를 재사용하지만, 각 방문은 자체 KV와 short-convolution 상태를 유지한다. 반복 2·3회차는 이전 pass의 출력을 cross-pass message로 읽고, 학습된 gate가 현재 입력과 message를 섞는다.[1]

가중치를 재사용하면 체크포인트와 고유 가중치 메모리는 줄일 수 있다. 그러나 같은 가중치를 세 번 읽는다는 사실이 연산을 세 번 무료로 만들어 주지는 않는다. GPU cache에 남아 재사용되는 비율, expert 선택으로 발생하는 메모리 접근, sequence 길이에 따른 attention 비용이 실제 시간을 결정한다.

또한 모델 카드의 1M-token context는 **지원 상한**이다.[2] 100만 토큰에서 특정 장비가 적절한 속도나 메모리로 동작한다는 보증이 아니며, 그 길이에서 모든 과제의 품질이 유지된다는 뜻도 아니다. 실험은 장비가 감당할 수 있는 구간을 먼저 찾고 점진적으로 늘려야 한다.

## 비교의 핵심은 모델 이름이 아니라 통제 변수다

제안 실험의 첫 단계는 고정 루프 Inkling 2 Mini와 pass 수를 바꿀 수 있는 연구 체크포인트를 분리하는 것이다. Hugging Face 공개 글은 `TML-d24-varloop-research`에서 loop pass를 1·2·3으로 바꿀 수 있다고 설명하지만, 이 변형은 깊이 평가되지 않았고 pass를 줄이면 생성 품질이 낮아질 수 있다고 경고한다.[1]

따라서 1-pass와 3-pass 비교는 “같은 배포 모델의 옵션”이 아니라 **별도 연구 artifact를 이용한 구조 실험**이다. 다음 조건을 실험 manifest에 고정한다.

- 장비 모델, VRAM 또는 통합 메모리, 전력 모드와 냉각 상태
- 체크포인트 ID와 revision, quantization 형식, 파일 digest
- Transformers·llama.cpp·MLX의 정확한 버전과 build 옵션
- prompt token 수, 생성 token 상한, batch와 동시성
- sampling seed, temperature, reasoning effort, stop 조건
- warm-up 횟수와 측정 반복 수

런타임 간 비교에서는 동일한 양자화 파일을 쓸 수 없을 수 있다. 원본 mixed-precision checkpoint와 GGUF를 한 표에서 직접 비교한다면 “런타임 효과”와 “정밀도 효과”가 섞인다. 결과표를 checkpoint 계열별로 나누거나, 같은 계열 안에서만 속도 비율을 계산하는 편이 정직하다.

## 제안 fixture: 길이와 pass를 직교시킨다

실험 matrix는 context 길이와 loop pass를 독립 축으로 둔다. 예를 들어 텍스트는 1K, 8K, 32K, 128K token 구간을 사용하고, 장비가 안전하게 수용하는 범위에서만 다음 구간으로 진행한다. 이미지 조건은 같은 이미지와 같은 질문을 고정하고 텍스트 조건과 별도 표로 관리한다.

각 셀에서 다음 값을 수집하도록 제안한다.

1. model load 직후와 warm-up 후의 resident memory
2. 요청 시작부터 첫 token까지의 TTFT
3. 첫 token 이후 steady-state token/s
4. peak VRAM 또는 unified-memory 사용량
5. prompt 처리와 decode 단계의 wall-clock time
6. 출력 token 수, 종료 이유, 오류와 fallback 여부

pass 1·2·3의 속도 비율은 연구 체크포인트 안에서만 계산한다. 고정 모델과 연구 모델의 3-pass가 수치상 같아 보이더라도 학습과 artifact가 다를 수 있으므로 동일하다고 가정하지 않는다. 품질은 자동 점수 하나로 환원하지 말고, 정답이 명확한 소형 과제와 시각 입력, 장문 회수 과제를 분리한다.

이 fixture를 실행하기 전에는 “pass를 하나 줄이면 지연이 정확히 3분의 1 감소한다”거나 “메모리는 변하지 않는다”고 쓸 수 없다. 공유 가중치가 weight memory에는 유리해도 방문별 상태와 attention cache는 별도 비용을 만든다.

## 결과표는 비용과 품질을 함께 읽는다

측정 결과를 받았다면 각 행에 `runtime / revision / checkpoint / precision / pass / context / batch`를 붙인다. 평균만 쓰지 말고 중앙값과 p95, 오류 건수, 성공한 반복 수를 함께 남긴다. thermal throttling이나 memory spill이 있었다면 해당 행을 정상 실행과 섞지 않는다.

품질 비교도 주의가 필요하다. 공개 글의 Qwen 비교 일부는 작성자 스스로 “vibe test”라고 부르며 추가 검증이 필요하다고 적었다.[1] 모델 카드의 benchmark 표 역시 각 행마다 harness와 버전이 다르다. 예컨대 Terminal Bench 결과에는 특정 Pi 버전이 붙고 다른 coding benchmark에는 mini-swe-agent 버전이 붙는다.[2] 서로 다른 harness의 점수를 모델 고유 성능처럼 단순 합산해서는 안 된다.

판정은 “가장 빠른 설정”보다 목적별 Pareto frontier로 한다. 품질 기준을 통과한 설정 중 TTFT가 짧은 것, 긴 context에서 메모리 상한을 넘지 않는 것, 이미지 입력에서 실패하지 않는 것을 각각 고른다. 장문 한 건과 짧은 대화 다건은 최적 설정이 다를 수 있다.

## 로컬 배포 전 체크리스트

- 모델을 open-weight라고 표현하고, 배포 파일의 Apache 2.0 라이선스와 별도 Acceptable Use Policy를 함께 확인한다.[2]
- 32GB 권장 수치는 특정 checkpoint 실행을 위한 공식 안내이지 모든 context와 동시성을 보장하는 최소 사양으로 확대하지 않는다.[2]
- 총·활성·유효 활성 파라미터와 논리 방문 수를 서로 바꾸어 쓰지 않는다.
- 1M context를 성능 보증으로 읽지 않고 실제 workload 길이에서 단계적으로 측정한다.
- 고정 모델, variable-loop 연구 artifact, GGUF 양자화를 서로 다른 artifact로 기록한다.
- 실행하지 않은 pass 축소와 benchmark는 제안으로 남기고 측정값을 만들지 않는다.

Inkling 2 Mini의 흥미로운 점은 작은 숫자 하나로 비용을 설명하기 어렵다는 데 있다. 26.4B는 저장 규모, 3.4B는 기본 활성량, 5.4B는 반복을 반영한 유효 활성량, 48은 실제 레이어 적용 횟수다. 이 네 축을 분리한 뒤 같은 장비와 같은 입력으로 TTFT·처리량·메모리·품질을 함께 재야 반복 레이어가 주는 이득과 비용을 판단할 수 있다.

## Sources

[1] https://huggingface.co/blog/inkling2mini
[2] https://huggingface.co/thinkingmachines/Inkling-2-Mini
