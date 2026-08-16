---
title: 'LLM이 14배 빨라지면 서비스도 14배 좋아질까'
date: 2026-08-16 10:30:00
categories: ["개발/인프라"]
description: 'OpenAI Ultrafast 발표를 계기로 TTFT, 출력 속도, 도구 호출, 비용과 fallback을 분리해 초고속 LLM이 실제 제품 지연시간에 미치는 영향을 분석한다.'
featured_image: 'https://picsum.photos/seed/ultrafast-llm-latency-economics/1600/900'
tags: [llm, inference, latency, openai, cerebras, ai-infrastructure, performance]
---

![초고속 LLM 지연시간](https://picsum.photos/seed/ultrafast-llm-latency-economics/1600/900)

OpenAI는 GPT-5.6 Sol을 최대 14배 빠르게 실행하는 Ultrafast API service tier를 preview로 발표했다. Cerebras 기반이며 최대 초당 750개의 output token을 제공한다는 설명이다.

수치만 보면 서비스 응답시간이 14분의 1로 줄어들 것처럼 보인다. 그러나 LLM 제품의 지연시간은 모델이 token을 생성하는 시간 하나로 결정되지 않는다. 요청 queue, 첫 token 대기, 긴 입력 처리, 검색, tool call, 외부 API, 네트워크와 UI 렌더링이 모두 합쳐진다.

따라서 "모델이 14배 빠르다"와 "사용자가 14배 빨리 작업을 끝낸다"는 다른 주장이다. Ultrafast 발표를 이해하려면 먼저 지연시간을 분해해야 한다.

## 공급업체 수치부터 정확히 읽어야 한다

OpenAI 공식 RSS가 밝힌 내용은 제한적이다.

- 새로운 API service tier의 preview다.
- 대상 모델은 GPT-5.6 Sol이다.
- 일반 실행 대비 최대 14배 빠르다고 주장한다.
- 최대 750 output tokens per second를 제시한다.
- Cerebras가 실행 인프라를 제공한다.

여기서 "최대"라는 표현이 중요하다. 평균이나 p95가 아니며 모든 입력 길이, 출력 길이, region, 동시성 조건에서 보장된다는 의미도 아니다. 독립된 benchmark 결과도 아니다.

실무에서 확인해야 할 항목은 더 많다.

- 측정한 입력과 출력 token 길이
- streaming 여부와 첫 token 시간
- warm request와 cold request 구분
- 동시 요청 수와 queue 조건
- rate limit과 burst 처리
- 일반 tier 대비 가격
- 같은 품질 설정과 reasoning effort 사용 여부
- 오류율과 재시도 비율

이 조건 없이 최고 출력 속도만 비교하면 제품 의사결정에 필요한 정보가 부족하다.

## TTFT와 output speed는 다른 지표다

사용자가 체감하는 첫 번째 성능 지표는 Time to First Token, TTFT다. 요청을 보낸 뒤 첫 token이 화면에 나타날 때까지 걸리는 시간이다.

두 번째는 token 생성 속도다. 첫 token 이후 응답 전체가 얼마나 빨리 완성되는지를 결정한다.

예를 들어 첫 token까지 2초가 걸리고 1,000 token을 초당 100 token으로 생성한다면 전체 모델 시간은 대략 다음 구조다.

```text
전체 모델 시간 ≈ TTFT + 출력 token 수 / 출력 속도
              ≈ 2초 + 1,000 / 100
              ≈ 12초
```

출력 속도가 초당 750 token으로 올라가면 생성 구간은 크게 줄어든다. 하지만 TTFT가 그대로라면 짧은 답변의 체감 개선은 제한적일 수 있다.

```text
짧은 응답 100 token
기존: 2초 + 100 / 100 = 약 3초
고속: 2초 + 100 / 750 = 약 2.13초
```

반대로 긴 코드 생성, 보고서 초안, 대량 structured output에서는 출력 속도의 영향이 커진다. 같은 기술도 workload에 따라 가치가 다르다.

## 에이전트는 token보다 도구를 기다린다

코딩 에이전트나 업무 자동화 에이전트의 실행은 보통 다음처럼 진행된다.

1. 목표를 해석한다.
2. 파일이나 문서를 읽는다.
3. 명령 또는 API를 호출한다.
4. 결과를 기다린다.
5. 실패를 판단한다.
6. 다음 도구를 선택한다.
7. 최종 결과를 검증한다.

이 과정에서 모델 출력은 여러 구간 중 하나다. `npm install`이 40초 걸리고 테스트가 2분 걸리며 외부 API가 5초 응답한다면, token 생성 속도를 크게 높여도 end-to-end 시간은 그만큼 줄지 않는다.

이를 단순한 식으로 표현하면 다음과 같다.

```text
작업시간 = 모델 처리 + 도구 대기 + 네트워크 + queue + 검증 + 재시도
```

모델 처리 비중이 전체의 10%라면 그 구간을 14배 개선해도 전체 작업시간의 이론적 개선에는 한계가 있다. 고전적인 Amdahl's Law와 같은 문제다.

반대로 tool call 사이에 짧은 추론을 수십 번 반복하는 에이전트라면 작은 지연 감소가 누적된다. 각 단계가 빨라지면 긴 작업의 total wall-clock time이 의미 있게 줄 수 있다.

결국 먼저 측정해야 할 것은 모델 속도가 아니라 전체 trace에서 모델이 차지하는 비율이다.

## 가장 효과가 큰 workload

초고속 inference가 특히 유용한 작업은 다음과 같다.

### 긴 결과를 즉시 소비하는 인터랙티브 작업

사용자가 긴 코드, 문서, SQL, 분석 결과를 화면에서 기다리는 경우다. 출력 token이 많고 사용자가 completion을 기다리기 때문에 생성 속도 개선이 직접 전달된다.

### 짧은 모델 호출이 여러 번 이어지는 에이전트

계획, 도구 선택, 결과 해석을 반복하는 workflow에서는 호출당 수백 밀리초 차이가 누적될 수 있다. 단, tool latency가 더 크다면 개선폭은 제한된다.

### 높은 동시성에서 compute가 병목인 API

모델 service time이 짧아지면 같은 capacity에서 더 많은 요청을 처리할 가능성이 있다. 하지만 provider의 rate limit과 queue 정책까지 확인해야 실제 throughput이 증가한다.

### 실시간 음성·협업 인터페이스

음성 대화나 pair programming처럼 응답 간 침묵이 UX를 해치는 제품에서는 sub-second 차이가 중요하다. 이 경우 평균보다 p95와 jitter가 더 중요하다.

반면 야간 batch 요약, 비동기 보고서, 사용자가 기다리지 않는 index 작업은 더 느리고 저렴한 tier가 합리적일 수 있다.

## 속도와 비용을 함께 봐야 한다

빠른 tier가 더 비싸다면 판단 기준은 "token당 가격"만으로 충분하지 않다. 사용자 대기시간, 완료율, infrastructure utilization, 재시도 비용을 함께 봐야 한다.

예를 들어 빠른 모델이 두 배 비싸지만 고객 지원 agent의 평균 처리시간을 줄여 사람이 개입하는 비율을 낮춘다면 전체 비용은 줄 수 있다. 반대로 배치 작업에서는 같은 품질을 더 비싸게 처리하는 결과가 된다.

실무 지표는 다음처럼 잡는 편이 낫다.

- 성공한 작업 한 건당 총비용
- p50, p95 TTFT
- p50, p95 end-to-end latency
- 평균 output tokens per second
- tool wait 비중
- timeout과 retry 비율
- 사용자 중단률
- 사람 escalation 비율

특히 평균 속도만 보면 tail latency를 놓친다. 일부 요청이 매우 빠르고 일부가 queue에서 오래 기다리면 평균은 좋아도 제품 경험은 불안정하다.

## 빠른 모델을 기본값으로 두지 않는 라우팅

모든 요청을 Ultrafast tier로 보내는 구현은 단순하지만 비용과 가용성 위험이 커진다. workload별로 라우팅하는 편이 낫다.

```text
if 사용자가 기다리는 긴 생성 작업:
    ultrafast tier
elif 짧지만 여러 단계로 이어지는 agent decision:
    latency budget에 따라 ultrafast 검토
elif 비동기 batch:
    표준 또는 batch tier
else:
    기본 tier
```

라우팅 기준에는 입력 길이, 예상 출력 길이, 사용자 SLA, 작업 우선순위, 현재 budget을 사용할 수 있다. 모델이 응답 길이를 정확히 예측하지 못하므로 처음에는 기능 단위 규칙이 더 단순하고 설명 가능하다.

빠른 tier에서 rate limit이나 장애가 발생할 때의 fallback도 필요하다.

1. 동일 모델의 standard tier로 전환
2. 사용 가능한 다른 provider 또는 모델로 전환
3. 긴 출력은 비동기 작업으로 전환
4. 사용자가 품질·속도 모드를 선택하도록 제공
5. 중복 요청을 막기 위한 idempotency 적용

fallback 후 응답 품질이나 출력 형식이 달라질 수 있으므로 schema validation과 feature flag가 필요하다.

## benchmark는 실제 trace로 해야 한다

도입 검증은 단순 prompt 몇 개의 stopwatch 측정으로 끝내면 안 된다. production과 비슷한 trace를 재생해야 한다.

최소 비교 조건은 다음과 같다.

- 동일한 model과 generation 설정
- 동일한 입력 및 출력 제한
- 같은 region과 client network
- 충분한 warm-up
- 여러 시간대와 동시성 수준
- 성공·오류·rate limit 모두 기록
- p50, p95, p99 분리
- 전체 tool workflow 시간 측정

빠른 응답이 품질을 바꾸지 않는지도 확인해야 한다. service tier가 같고 model이 같다면 원칙적으로 품질이 같아야 하지만, 실제 product configuration과 fallback이 동일한지는 검증해야 한다.

공급업체 benchmark는 후보를 찾는 자료다. 구매 결정은 우리 workload에서 측정한 결과로 내려야 한다.

## 결론

초당 750 output token과 최대 14배라는 수치는 분명 흥미롭다. 긴 결과 생성과 실시간 인터페이스에서는 제품 경험을 크게 바꿀 가능성이 있다. 여러 모델 호출을 반복하는 에이전트에서도 지연 감소가 누적될 수 있다.

그러나 LLM 제품은 token generator 하나가 아니다. TTFT, queue, retrieval, tool call, 외부 API, 검증, 재시도가 전체 시간을 만든다. 모델 구간만 빨라졌는데 서비스 전체가 같은 비율로 빨라질 것이라고 기대하면 안 된다.

가장 좋은 도입 방식은 기본값 교체가 아니라 workload별 실험이다. 전체 trace에서 모델 시간이 차지하는 비율을 측정하고, 성공한 작업당 비용과 p95 지연시간을 비교한 뒤, 빠른 tier가 실제 병목을 해결하는 경로에만 적용해야 한다.

## 참고 자료

- [OpenAI: Previewing Ultrafast mode — GPT-5.6 Sol at up to 14X the speed](https://openai.com/index/previewing-ultrafast)
- [OpenAI News RSS](https://openai.com/news/rss.xml)
