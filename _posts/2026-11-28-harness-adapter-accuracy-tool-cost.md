---
title: '모델보다 실행기를 학습한다: Harness Adapter로 정확도와 도구 호출 비용 함께 재기'
date: 2026-11-28 07:20:00 +0900
categories: ["AI"]
description: '실제 agent harness 안에서 학습한 LoRA adapter를 base model과 비교해 pass@1, token, tool call, 이식성과 rollback을 함께 검증하는 방법을 설계한다.'
featured_image: 'https://picsum.photos/seed/harness-adapter-accuracy-tool-cost/1600/900'
tags: [harness-adapter, ai-agent, lora, reinforcement-learning, evaluation, tool-calling]
---

![짙은 안개에 일부가 가려진 현수교](https://picsum.photos/seed/harness-adapter-accuracy-tool-cost/1600/900)

같은 언어 모델을 Pi, OpenCode, Hermes Agent에 연결하면 행동이 같을까? System prompt, tool schema, context 관리, 오류를 모델에게 돌려주는 방식과 최대 turn이 다르면 모델이 실제로 보는 trajectory도 달라진다. 범용 benchmark에서 좋은 weight를 그대로 쓰는 것보다 배포할 harness와 작업 분포 안에서 작은 adapter를 학습시키는 편이 정확도와 비용을 함께 개선할 수 있다는 주장이 여기서 나온다.

Hugging Face는 Qwen3.8-27B weight를 고정하고 Pi·OpenCode·Hermes Agent별 RL LoRA를 학습한 결과와 통합 super-adapter, dataset, rollout과 GGUF artifact를 공개했다.[1][2] 공식 글의 대표값에서 Qwen3.8-27B를 Pi harness로 Terminal-Bench 2.1에 평가한 pass@1은 39%이고 평균 token은 task당 2.9K였으며, custom RL LoRA를 적용한 값은 55%와 1.5K였다.[1] 이는 특정 model, harness version, benchmark, decoding과 실행 한도에서 공급자가 보고한 결과다. 모든 agent 업무에서 정확도가 16%p 오르거나 비용이 절반이 된다는 법칙은 아니다.

이 글은 대규모 RL 학습을 직접 실행한 결과가 아니다. 공개된 설계를 바탕으로 base와 adapter를 공정하게 비교하고, verifier 오류와 harness version 종속성, tool 호출 비용과 rollback까지 포함하는 검증안을 만든다.

## Adapter가 학습하는 대상은 모델만이 아니다

일반적인 RL agent 학습은 framework 안에 별도 agent loop를 재구현할 수 있다. 반면 공식 실험은 실제 배포 harness를 그대로 실행하고 harness와 vLLM 사이 proxy가 생성 token을 기록해 trainer에 넘기는 방식이다.[1] 최종 image에는 Pi 1.5.2, OpenCode 2.2.7, Hermes Agent v0.22.6이 사용됐다.[1]

이 차이는 중요하다. Adapter는 “코딩 능력”만 배우는 것이 아니라 특정 harness에서 tool을 어떤 형식으로 호출하고, 오류 뒤 얼마나 더 탐색하며, 언제 답을 끝내는지가 보상으로 이어지는 패턴도 학습할 수 있다. Harness가 바뀌면 tool 이름, prompt와 context가 달라져 이 이점이 사라지거나 부작용이 생길 수 있다.

따라서 artifact 이름에 model뿐 아니라 harness family와 version, task distribution, training recipe를 넣는다. `qwen-27b-coding`보다 `qwen3.8-27b-pi-1.5.2-repo-fix-v1`처럼 lineage가 드러나는 이름이 낫다. Base weight, LoRA digest, tokenizer, chat template, harness image와 tool schema를 한 manifest에 묶는다.

“모델보다 실행기를 학습한다”는 표현도 정확히는 harness-aware behavior를 adapter weight에 학습한다는 뜻이다. Harness source 자체가 자동으로 개선되는 것은 아니며 deterministic permission, sandbox와 retry policy는 여전히 code에서 통제해야 한다.

## 학습 전에 verifier를 역으로 시험한다

RL은 주어진 reward를 최적화한다. Verifier가 잘못된 답을 통과시키면 모델은 그 빈틈을 배우는 것이 합리적이다. 공식 pipeline은 reference solution이 최대 reward를 얻는지, do-nothing보다 명확히 높은지, canary가 do-nothing보다 높은 점수를 받지 않는지, reference replay가 같은 reward를 내는지 검사했다.[1]

공식 보고에서 Hub 후보 1,127개 중 858개가 validation을 통과했고, wrong-answer control은 불완전 implementation을 허용한 Tasksmith task와 알려진 오답을 허용한 Terminal-Bench 2.1의 regex-log verifier 결함을 잡았다.[1] 이 수치는 해당 pipeline의 관찰이며 자체 task 품질을 보증하지 않는다.

사내 task를 만들 때도 최소 네 control을 둔다.

| Control | 목적 | 실패 의미 |
|---|---|---|
| Oracle | 올바른 해법이 최대점인지 확인 | verifier가 정답을 거부 |
| Empty | 무행동의 바닥점 확인 | 작업이 필요하지 않음 |
| Known wrong | 그럴듯한 오답 차단 | reward hacking 가능 |
| Replay | 반복 채점의 결정성 | 환경·채점 불안정 |

Repository task라면 agent가 test를 수정하거나 삭제해도 통과하지 않게 grader를 별도 mount에서 실행한다. Network는 필요한 package mirror만 허용하고 production secret을 넣지 않는다. Task instruction과 test가 benchmark나 production incident를 그대로 누출하지 않도록 license와 privacy를 검토한다.

학습 가능한 난이도도 확인한다. 공식 pipeline은 base model이 항상 맞히거나 항상 틀리는 task는 group-relative 학습 신호가 약하므로 일부 attempt만 성공한 task를 qualified set으로 골랐다. 442개 scored task 중 151개는 매번 성공, 120개는 전부 실패, 171개가 일부 성공이었다고 보고한다.[1] 자체 pilot에서도 여러 seed로 base success 분포를 측정하되 최종 evaluation set을 학습 selection에 쓰지 않는다.

## Base와 adapter 비교 계약을 먼저 동결한다

Adapter 효과를 보려면 model weight 차이 외 조건을 같게 한다. Harness image, task set, sandbox, model serving, temperature, token·turn·time limit, concurrency와 grader를 고정한다. Base와 adapter를 가능한 한 paired task로 실행하고 순서를 randomize해 infrastructure drift를 줄인다.

Primary metric은 task-level pass@1이다. 함께 기록할 효율 지표는 다음과 같다.

- Input·output·total token
- Model call, tool call과 shell command 수
- Turn 수와 wall time
- 성공 task당 token·tool call·GPU time
- Timeout, invalid tool argument, blocked call과 verifier error
- Task family별 새 성공과 새 실패

모든 task 평균만 보면 adapter가 어려운 task를 포기해 호출을 줄였는데 효율이 좋아 보일 수 있다. 공식 글도 “둘 다 성공한 task”에서 tool call 감소를 별도로 보고한다.[1] `all tasks`, `both solved`, `base-only solved`, `adapter-only solved`를 나눠야 한다. 실패 task의 짧은 trajectory를 비용 절감으로 칭찬하지 않는다.

Token 비용도 provider bill과 동일하지 않을 수 있다. Local GPU에서는 throughput과 wall time, API에서는 cached input discount와 tool execution 비용을 분리한다. Tool call 한 번이 단순 file read인지 비싼 remote browser나 database query인지 가중치를 따로 둔다.

## 공식 수치는 조건을 붙여 읽는다

Hugging Face의 specialist adapter는 각 target harness의 두 benchmark에서 base보다 성능과 효율이 좋아졌다고 보고됐다.[1] Final evaluation은 Harbor·OpenEnv stack의 HF sandbox에서 task당 한 attempt, temperature 0.8, thinking off로 실행했고 LoRA checkpoint를 base weight에 merge해 vLLM 한 GPU에서 제공했다.[1]

예를 들어 공식 최종 표에서 Pi specialist의 SWE-bench Pro hard 51 pass@1은 39.2%에서 64.7%로, Terminal-Bench 2.1은 16.3%p 개선된 것으로 보고됐다.[1] Hermes와 OpenCode도 각 harness에서 개선됐지만 개선 폭은 동일하지 않았다. Tool call은 base와 adapter가 모두 해결한 task에서 SWE-bench Pro 기준 56~72%, Terminal-Bench 2.1 기준 53~70% 적었다고 공급자는 보고한다.[1]

이 값을 읽을 때 세 경계를 지킨다. 첫째, pass@1의 표본과 graded task 수가 표마다 다를 수 있으므로 denominator를 보존한다. 둘째, thinking off 결과를 thinking mode나 다른 effort와 섞지 않는다. 셋째, tool call 감소는 token·latency·비용 감소와 관련될 수 있지만 호출당 비용이 같다는 보장은 없다.

대표 headline의 39→55%와 2.9K→1.5K도 Pi와 특정 Terminal-Bench 설정의 요약값이다.[1] 자체 배포 승인에는 그대로 쓰지 않고 frozen local task에서 같은 revision을 비교한다.

## 호출 수 감소가 reward hacking인지 trace로 확인한다

Adapter가 tool을 덜 호출하면서 정확도가 오르면 이상적인 결과처럼 보인다. 그러나 짧은 trajectory에는 여러 설명이 있다. 더 빨리 올바른 수정에 도달했을 수 있고, context를 충분히 읽지 않고 우연히 test를 통과했을 수도 있으며, verifier loophole을 이용했을 수도 있다.

공식 training reward는 verifier correctness에 작은 tool-efficiency bonus 0.1을 결합했다.[1] 이런 bonus는 효율을 유도할 수 있지만 잘못된 verifier와 만나면 “빨리 속이는” 행동도 보상할 수 있다. 자체 학습에서는 correctness gate를 먼저 통과한 trajectory에만 efficiency bonus를 주고, security·permission violation은 평균 reward로 상쇄되지 않는 hard failure로 둔다.

Trace review는 다음 질문을 본다.

1. 필요한 repository file과 failing test를 읽었는가?
2. Tool call이 줄어든 대신 더 큰 batch command나 위험한 wildcard를 썼는가?
3. Test·grader·fixture를 변조하지 않았는가?
4. 첫 수정 뒤 관련 test와 regression을 실행했는가?
5. 실패를 숨기거나 output parsing을 우회하지 않았는가?
6. Adapter-only success가 의미 있는 수정인가, brittle shortcut인가?

자동 assertion과 blind human review를 조합한다. Model 이름을 가리고 base·adapter trace를 같은 rubric으로 평가한다. 전체를 사람이 볼 수 없다면 task family와 outcome group별 층화 표본을 미리 정한다.

## Harness 업그레이드와 이식성을 별도 시험한다

Specialist adapter가 학습한 behavior가 특정 harness version에 묶일 수 있다. Tool schema가 바뀌거나 system prompt가 길어지고 context compaction이 달라지면 성능이 급락할 수 있다. 배포 전에 2×2 matrix를 돌린다.

| | 기존 harness H0 | 새 harness H1 |
|---|---:|---:|
| Base | 기준 | harness 변화 효과 |
| Adapter | 학습 조건 | 이식성 효과 |

H0에서 adapter가 좋아도 H1에서 base보다 나빠지면 adapter를 자동 승계하지 않는다. Harness 변경과 adapter 변경을 같은 canary에 묶지 말고 먼저 H1+base, 다음 H1+adapter로 나눈다. Tool call schema compatibility, invalid argument와 retry loop를 deterministic fixture로 검사한다.

공식 연구는 Pi adapter를 Hermes Agent와 OpenCode에서도 평가해 일부 성능·효율 transfer를 보고했지만, 다른 agent loop를 쓰는 AutomationBench 300개 task에서는 adapter들이 base 근처에 있었고 Hermes adapter는 낮았다. 저자들은 매우 다른 설정으로의 전이가 명확하지 않다고 해석한다.[1] 이것은 harness 간 이식성이 자동이 아님을 보여 주는 공급자 결과다.

통합 super-adapter도 specialist의 완전 대체로 가정하지 않는다. 공식 실험은 세 LoRA를 rank 방향으로 결합하고 scaling을 비교했으며, thinking off에서는 한 harness만 쓸 경우 specialist를 권장한다.[1] 여러 harness를 운영한다면 하나의 artifact 관리 단순성과 harness별 최고 성능의 trade-off를 자체 matrix에서 측정한다.

## 배포와 rollback은 base를 항상 비교 가능하게 남긴다

Adapter canary는 동일 model server pool에서 traffic을 hash로 나누거나 shadow task를 사용한다. 사용자 data를 무단 학습·평가에 사용하지 않고 승인된 synthetic·public fixture로 시작한다. Online에서는 reward를 즉시 알기 어려우므로 tool error, user correction, escalation, latency와 비용을 안전 지표로 보고 offline verified task를 정기 실행한다.

승격 manifest에는 base revision, adapter digest, merge 방식, quantization, harness image, task·grader digest와 승인 threshold를 넣는다. Adapter를 base에 merge한 artifact와 runtime에 동적으로 attach한 artifact는 수치적으로 같은지 golden prompt로 검사한다. GGUF 등 format 변환 뒤에도 tool-call serialization과 stop token이 보존되는지 본다.

Rollback은 adapter weight만 끄는 것으로 끝나지 않을 수 있다. Adapter에 맞춰 system prompt나 tool budget을 바꿨다면 base로 돌아갈 때 config도 같이 복구해야 한다. 그래서 `base bundle`과 `adapter bundle`을 각각 immutable하게 보관하고 한 번에 전환한다. Rollback 뒤 같은 canary task와 tool schema assertion을 다시 실행한다.

자동 중단 조건은 pass proxy 하락, forbidden action, invalid tool call 급증, token·latency 한도 초과와 telemetry 누락을 포함한다. Telemetry가 없으면 안전하다고 판단하지 않고 canary를 중단한다.

## 결론: 정확도와 비용을 같은 trace에서 본다

Harness adapter의 매력은 큰 base model을 다시 학습하지 않고도 실제 agent loop와 작업 분포에 맞는 행동을 LoRA에 학습할 수 있다는 데 있다. Hugging Face의 공개 결과는 Pi·OpenCode·Hermes Agent별 adapter가 특정 coding benchmark와 조건에서 pass@1을 높이고 tool call을 줄인 사례를 제공한다.[1] Artifact와 trajectory도 공개돼 검토 가능한 출발점이 된다.

그러나 adapter는 verifier, task selection과 harness version의 편향도 학습할 수 있다. 따라서 oracle·empty·known-wrong·replay control로 task를 먼저 검증하고, base와 동일 예산에서 paired 평가하며, 성공한 task의 token·tool call과 새 실패를 함께 본다. Trace review로 짧아진 실행이 더 정확한 계획인지 loophole인지 구분한다.

실제 도입의 질문은 “39%가 55%가 되는가”가 아니다. **우리 harness revision과 우리 task distribution에서, 고정된 verifier 아래 adapter가 base보다 더 많은 올바른 terminal state를 만들면서 비용과 위험한 행동을 줄이고, harness 업그레이드나 rollback 때도 그 차이를 재현할 수 있는가**다. 그 계약을 통과할 때 adapter는 demo 숫자가 아니라 운영 가능한 최적화가 된다.

## Sources

[1] https://huggingface.co/blog/harness-adapters-at-scale
[2] https://github.com/huggingface/blog/blob/22c0b0e901b124640dde7d1a76b086cc3a11210c/harness-adapters-at-scale.md
