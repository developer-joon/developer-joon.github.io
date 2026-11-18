---
title: '트래픽이 바뀔 때마다 LLM 서버를 다시 최적화한다: Together Compiler의 지속 컴파일 구조'
date: 2026-11-04 09:00:01 +0900
categories: ["AI 인프라"]
description: 'Together Compiler의 persistent engine과 다단계 측정, parallelism cost model을 통해 변화하는 LLM 트래픽에 지속적으로 적응하는 추론 최적화 구조를 살펴본다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-together-blog-together-compiler-continuous-compilation-for-ai-inference/1600/900'
tags: [together-ai, llm-inference, compiler, vllm, sglang, gpu, continual-optimization]
---

![계속 변하는 그래프 위에서 톱니바퀴가 자동 조정되는 모습](https://picsum.photos/seed/news-2026-11-04-together-blog-together-compiler-continuous-compilation-for-ai-inference/1600/900)

LLM serving 설정은 한 번 찾고 끝나는 정답이 아니다. Prompt 길이, batch size, 동시성, MoE expert 편향, session 지속시간이 바뀌면 어제 가장 빨랐던 kernel과 parallelism 구성이 오늘은 느릴 수 있다.

Together AI는 2026년 11월 4일 Together Compiler(TKCC)를 공개하며, 모델·하드웨어·실제 traffic shape를 입력으로 받아 inference engine을 지속 최적화하는 loop를 제시했다.[1]

## 정적 benchmark와 운영 traffic은 다르다

정적 benchmark는 같은 분포를 여러 번 실행해 후보를 비교하기 쉽다. 운영 환경은 지역별 사용 시간, 새 모델 출시, 긴 prompt 비율, burst가 계속 변한다. 특히 MoE와 sparse attention처럼 입력 분포에 따라 실행 경로가 달라지는 모델은 microbenchmark만으로 최적 구성을 고르기 어렵다.

Together Compiler는 이 문제를 다음 loop로 다룬다.[1]

```text
traffic 관찰
  → agent가 최적화 후보 생성
  → 빠른 저충실도 측정으로 후보 축소
  → 실제 분포에 가까운 고충실도 측정
  → 선택한 코드를 persistent engine에 반영
  → traffic drift 감지 후 반복
```

핵심은 agent가 코드를 쓴다는 사실보다 **실험 처리량과 측정 신뢰도를 함께 설계했다**는 점이다.

## persistent engine이 실험 비용을 줄인다

vLLM, SGLang, TRT-LLM 같은 engine을 후보마다 시작하고 종료하면 model load와 초기화에 수십 분이 걸릴 수 있다. 이 시간이 길면 agent가 많은 최적화 아이디어를 만들어도 GPU는 기다리는 시간이 더 길어진다.

TKCC는 engine을 한 번 시작한 뒤 candidate forward pass를 hot-reload하는 persistent engine 방식을 사용한다.[1] 작은 layer subset을 올린 fast engine은 빠른 후보 제거에 쓰고, 더 많은 layer와 실제 입력 분포를 사용하는 slower engine은 최적화가 전체 workload에서도 유지되는지 확인한다.

이 구조는 CI의 unit test와 integration test를 나누는 것과 비슷하다. 빠른 test만 통과한 kernel을 production에 바로 넣지 않고, 비싼 검증은 가능성 높은 후보에 집중한다.

## parallelism 선택도 traffic에 의존한다

Tensor parallel(TP), expert parallel(EP), data/context 계열 parallelism은 hardware spec만 보고 고르기 어렵다. Prompt 길이가 고르지 않거나 특정 expert에 token이 몰리면 network와 compute의 병목 위치가 달라진다.

Together Compiler는 hardware spec, microbenchmark, 측정한 forward pass를 결합한 cost model로 후보 공간을 빠르게 줄인다고 설명한다.[1] 이때 cost model은 최종 진실이 아니라 측정 순서를 정하는 도구다. 예측이 좋은 후보도 실제 traffic replay에서 다시 확인해야 한다.

## 공급자 수치를 그대로 SLA로 쓰지 않는다

Together AI는 자사가 선택한 frontier open-source model(Kimi K3, GLM 5.3, MiniMax M3.1-Flash, DeepSeek v4.1-Flash) workload에서 24시간 이내에 최대 2.6배 높은 TPS를 달성했다고 보고했다. 또한 SemiAnalysis InferenceX 저지연 benchmark에서 MiniMax M3.1-Flash 1,111 TPS와 DeepSeek v4.1-Flash 1,205 TPS, Llama 1B batch size 1에서 공개 megakernel 대비 1.7배, 기존 agentic 성능 최적화 system 대비 252배 높은 실험 처리량을 제시했다.[1]

모두 Together가 선택한 hardware, model, baseline, traffic 조건의 결과다. 다음을 일반화할 수 없다.

- 모든 모델과 workload에서 같은 배율로 빨라진다.
- TPS가 늘면 TTFT와 tail latency도 항상 좋아진다.
- open-weight 모델을 쓴다는 이유로 compiler 전체가 오픈소스다.
- 24시간 안에 찾은 구성이 장기간 안전하게 유지된다.

TPS만 높인 후보가 memory headroom을 소진하거나 p99를 악화시키면 production 최적화로는 실패다.

## 간소화한 continual tuning fixture

TKCC 전체를 구현하지 않아도 지속 최적화의 핵심 가설은 검증할 수 있다. 아래는 **제안된 실험이며 실제 측정 결과가 아니다**.

Traffic phase를 세 구간으로 만든다.

| Phase | Prompt / output | 동시성 | 검증하려는 변화 |
|---|---|---:|---|
| A | 짧음 / 짧음 | 낮음 | latency 중심 |
| B | 김 / 짧음 | 중간 | prefill·KV cache 압력 |
| C | 혼합 / 김 | 높음 | scheduler·decode 압력 |

후보 설정은 batch token 상한, scheduler policy, tensor parallel 크기, prefix cache, kernel variant처럼 안전하게 바꿀 수 있는 값으로 제한한다. 각 후보를 작은 replay에서 평가한 뒤 상위 후보만 전체 replay로 보낸다.

```text
score = throughput
        - λ1 * max(0, p99_ms - slo_ms)
        - λ2 * oom_count
        - λ3 * error_count
        - λ4 * reload_disruption_ms
```

점수에 오류와 OOM을 큰 벌점으로 넣어야 “빠르게 실패하는” 구성이 승리하지 않는다. 새로운 설정을 적용하기 전에는 canary와 자동 rollback 기준도 필요하다.

## drift를 감지해도 즉시 재컴파일하지 않는다

Traffic은 짧은 burst로도 흔들린다. 분포가 조금 바뀔 때마다 tuning을 시작하면 실험 자체가 GPU를 점유하고 설정이 계속 진동할 수 있다.

운영 controller에는 다음 guardrail이 필요하다.

1. 최소 관찰 window와 sample 수
2. 기존 설정 대비 예상 이득의 하한
3. 동일 후보 재평가 cooldown
4. canary와 production traffic의 격리
5. SLO 위반 시 즉시 rollback
6. compiler와 serving plane의 권한 분리

Agent가 생성한 kernel은 arbitrary code다. 성능 실험 환경을 production credential과 분리하고, compile sandbox, resource limit, artifact signature, allowlisted deployment path를 적용해야 한다.

## 지속 최적화의 성공 지표

최종 dashboard에는 최고 TPS보다 loop 전체 비용이 보여야 한다.

- 유효한 후보 수 / 생성한 후보 수
- GPU 실험 시간과 idle 시간
- fast engine에서 탈락한 비율
- 고충실도 재검증에서 순위가 뒤집힌 비율
- canary rollback 수
- traffic phase별 TPS, TTFT, p99, OOM
- tuning 비용을 회수하는 데 걸린 시간

최적화로 시간당 GPU 비용을 5% 줄였지만 탐색에 더 많은 GPU를 썼다면 경제적 이득은 없다. 반대로 traffic이 자주 바뀌는 대형 serving 환경에서는 persistent engine이 실험 startup 비용을 줄이는 효과가 클 수 있다.

Together Compiler가 보여주는 전환은 “더 좋은 kernel 하나”에서 “계속 바뀌는 workload에 적응하는 검증 loop”로의 이동이다. 다만 agent가 만든 설정을 믿는 것이 아니라, 낮은 비용의 탐색과 높은 충실도의 재검증, canary, rollback을 한 시스템으로 묶을 때만 production 최적화가 된다.

## Sources

[1] https://www.together.ai/blog/together-compiler-continual-compilation-for-ai-inference
