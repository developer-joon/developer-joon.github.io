---
title: '에이전트 4개가 정말 4배 나은가: 일반 협업과 정보 집계 나눠 검증하기'
date: 2026-11-28 07:00:00 +0900
categories: ["AI"]
description: '모든 실험군이 풀 수 있는 matched-budget 협업 시험과 분산된 정보를 통신으로 모으는 시험을 분리해, 각 fixture가 답할 수 있는 범위만 판정한다.'
featured_image: 'https://picsum.photos/seed/multi-agent-token-budget-test/1600/900'
tags: [multi-agent, ai-agent, token-budget, evaluation, reinforcement-learning, swarmlab]
---

![안개 낀 산 능선 너머로 햇빛이 퍼지는 풍경](https://picsum.photos/seed/multi-agent-token-budget-test/1600/900)

에이전트 한 개 대신 네 개를 띄우면 답을 탐색할 기회도 늘어난다. 하지만 정확도가 올랐다고 곧바로 “협업이 통했다”고 결론 내릴 수는 없다. 모델 호출 횟수, 생성 토큰, 재시도 횟수와 벽시계 시간이 함께 늘었다면 개선은 대화가 아니라 계산량에서 왔을 수 있다. 네 사람이 회의해서 얻은 성과인지, 같은 사람이 네 번 풀어 가장 좋은 답을 고른 효과인지부터 분리해야 한다.

Hugging Face가 공개한 교육용 실험은 네 에이전트가 하나의 언어 모델 정책을 공유하고, 검증 가능한 숫자 정렬 문제에서 메시지를 주고받도록 학습시킨다. 공식 실습은 H200 두 장에서 약 5시간, 대략 50달러가 드는 예로 소개되며, 한 GPU는 공유 Qwen3-0.6B 정책을 vLLM으로 제공하고 다른 한 GPU는 학습에 사용한다.[1] 이 수치는 해당 공급자 환경의 추정치다. 네 에이전트가 일반 코딩이나 연구 과제에서도 우월하다거나, 다른 GPU·가격표에서도 같은 비용이 나온다는 뜻은 아니다.

이 글은 공식 결과를 재현했다고 주장하지 않는다. 대신 작은 환경에서도 **동일한 정보와 예산에서 통신이 추가한 순효과**를 묻는 시험과 **분산된 정보를 통신으로 모을 수 있는지** 묻는 시험을 분리하고, 각 시험의 예산·대조군·기록 형식과 실패 판정을 먼저 고정한다.

## 에이전트 수가 아니라 비교 단위를 고정한다

멀티에이전트 실험의 첫 번째 함정은 처리량을 지능으로 읽는 것이다. 네 에이전트가 각자 한 번씩 답하면 단일 에이전트 한 번보다 네 배 가까운 샘플을 얻는다. 여기에 토론 메시지까지 허용하면 입력 문맥과 출력 토큰도 더 늘어난다. 그러므로 `1 agent vs 4 agents`만 비교해서는 통신의 효과를 식별할 수 없다.

최소한 다음 네 실험군을 같은 문제 집합에 배치해야 한다.

| 실험군 | 실행 방식 | 통신 | 총 시도·토큰 예산 |
|---|---|---:|---:|
| A | 단일 에이전트 1회 | 없음 | 낮음 |
| B | 단일 에이전트 반복 후 최선 선택 | 없음 | C와 동일 |
| C | 네 에이전트 독립 실행 후 최선 선택 | 없음 | 고정 |
| D | 네 에이전트가 메시지를 교환 | 있음 | B·C와 동일 |

A는 값싼 기준선일 뿐 협업의 직접 대조군이 아니다. 핵심 비교는 C와 D다. 모델, decoding, 총 생성 토큰, 최대 도구 호출, 문제당 시도 수와 최종 선택 규칙을 같게 하고 메시지 전달만 바꾼다. B도 함께 두면 “여러 process로 나눈 것”과 “여러 독립 샘플을 낸 것”의 차이를 볼 수 있다.

예산은 요청 횟수 하나로 표현하면 부족하다. 한 요청이 긴 토론을 만들 수 있기 때문이다. `total_input_tokens`, `total_output_tokens`, `model_calls`, `tool_calls`, `wall_time`, `peak_concurrency`를 모두 기록한다. 유료 API라면 실제 청구 단위도 저장하되 가격 변경과 cache discount를 분리한다. 토큰 수가 같은데 병렬 실행으로 시간이 줄어든 경우는 품질 향상이 아니라 지연 개선으로 따로 보고한다.

## 공식 네 에이전트 실험에서 배울 것과 확대하지 말 것

공식 글은 에이전트를 추가하면 context와 budget, 시스템 복잡도가 함께 바뀌며, context를 섞는 통신 자체가 내재적인 성능 향상은 아니라고 명시한다.[1] 첫 실험은 네 에이전트, 공유 언어 모델, 정답을 자동 검증할 수 있는 단순 과제로 시작한다. 각 에이전트의 sampled token이 학습 행이 되고, 수신 메시지와 도구 결과가 context가 되며, loss는 team 안에서 평균한 뒤 team 사이에서 다시 평균해 긴 대화가 더 큰 가중치를 받지 않게 한다.[1]

이 설계의 장점은 정답이 분명하다는 데 있다. 대화가 유창해졌는지가 아니라 숫자 순서가 맞는지 자동 판정할 수 있다. 반면 단순 과제의 성공을 역할 분담이 필요한 실제 소프트웨어 개발로 확대하면 안 된다. 공유 정책을 쓰는 네 agent는 서로 다른 전문 모델 네 개와도 다르다. 학습 중 협력을 얻은 결과와 inference 때 prompt로 역할만 나눈 결과도 별도 조건이다.

Hugging Face의 `swarmlab`은 협업 primitive를 통제해 시험하기 위한 별도 testbed다. World, participant, message medium, metric을 나누고 broadcast·gossip·tree 같은 topology, 전달 지연, visibility, role을 실험 변수로 둔다. Event log를 바탕으로 score를 다시 계산하고 run을 resume하거나 특정 round에서 fork할 수 있으며, soft·hard cap과 공통 ledger로 지출 한도를 관리한다고 설명한다.[2] 이 기능은 실험 도구의 능력이지 특정 topology의 우월성을 보증하는 결과는 아니다.

## Fixture를 둘로 나눈다: 일반 협업과 분산 정보 집계

개인 장비나 작은 API 예산에서는 학습부터 재현하기보다 inference 수준의 대조 실험으로 시작하는 편이 낫다. 다만 하나의 fixture로 두 질문을 동시에 답하려 해서는 안 된다. 공식 숫자 정렬 과제도 각 agent가 다른 수를 받기 때문에 단일 agent나 비통신 team은 재시도를 아무리 늘려도 완전한 답을 알 수 없고, 저자들은 이 과제가 matched-budget 협업 비교를 직접 시험하지 않는다고 명시한다.[1]

첫 번째는 **일반 협업 순증분 fixture**다. 모든 arm과 모든 participant에게 동일한 문제 정보와 도구를 제공하고, 단일 agent도 원칙적으로 풀 수 있는 자동 채점 과제를 쓴다. 예를 들어 합성 repository의 failing test, API 계약, 변경 이력을 B·C·D 모두에게 똑같이 공개한다. C는 네 agent가 서로의 trace를 보지 않고 독립 후보를 내며, D만 정해진 메시지 channel을 쓴다. 총 token·시도·도구 호출과 최종 선택 규칙은 같게 둔다. 이때 C와 D의 차이만이 같은 정보 접근성에서 통신이 독립 샘플링보다 나은지 답할 수 있다.

두 번째는 **private-information 통신 필요성 fixture**다. 숨겨진 네 자리 코드의 각 자리를 네 participant에게 하나씩 나눠 주고, 통신군만 관찰을 공유해 완전한 답을 만들게 한다. 비통신군의 고정 aggregator에는 participant의 private observation이나 이를 결합할 별도 통로를 주지 않는다. 이 fixture에서 비통신군이 지는 것은 설계상 예상되는 결과다. 따라서 합격 결론은 “분산된 정보를 메시지로 집계했다”로 한정하며, 같은 예산에서 일반적 협업이 독립 샘플링보다 우월하다는 증거로 쓰지 않는다.

두 fixture 모두 합성 repository나 공개 라이선스 자료로 만들고 sandbox에는 외부 network와 production credential을 넣지 않는다. 특히 실제 credential이나 private source를 정보 조각으로 분배하지 않는다. 일반 협업 fixture는 모든 arm이 항상 맞히거나 항상 틀리지 않도록 사전 pilot에서 단일 agent 성공률이 중간인 문제를 고른다. Pilot 문제를 최종 평가에 반복하지 않고 쉬움·중간·어려움 strata와 표본 수를 미리 고정한다.

## 토큰 예산은 중간에 새지 않도록 실행기가 강제한다

“최대 8,000 token”이라고 문서에 적는 것만으로 예산이 같아지지 않는다. 재시도, timeout 뒤 중복 요청, tool output의 재주입, system prompt, agent 간 메시지 복사가 숨어 있기 때문이다. 실행기는 모든 model request 전후에 누적 사용량을 갱신하고 hard cap을 넘기기 전에 다음 호출을 거부해야 한다.

```text
run_budget:
  max_input_tokens: 24000
  max_output_tokens: 8000
  max_model_calls: 16
  max_messages: 12
  max_wall_seconds: 300
termination:
  budget_exhausted: fail_closed
  timeout: record_failure
  partial_answer: score_separately
```

위 형식은 특정 framework의 공식 schema가 아니라 검증용 계약 예시다. Tokenizer와 provider usage가 다르면 둘을 함께 저장하고 과금 비교에는 provider가 반환한 usage를 우선한다. 공유 prefix cache가 적용됐다면 logical input token과 billed token을 나눈다. 통신군의 메시지를 각 수신자 prompt에 반복 삽입하면 같은 문장도 여러 번 input token으로 계산된다는 점도 숨기지 않는다.

예산 소진 뒤 일부 agent의 답만 골라 정상 완료처럼 처리하면 긴 토론의 실패가 사라진다. `completed`, `budget_exhausted`, `timeout`, `tool_error`, `invalid_final`을 상호 배타적인 종료 상태로 저장한다. 최종 선택기가 별도 모델이면 그 token도 같은 총예산에 넣는다. 그렇지 않으면 독립군에는 단순 majority vote를 쓰면서 통신군에만 비싼 judge를 붙이는 불공정 비교가 된다.

## 정확도와 함께 대화의 실패 모양을 측정한다

주요 지표는 problem-level exact accuracy다. 그다음 같은 예산에서의 성공 한 건당 output token, model call, wall time을 계산한다. 평균만 보고하지 말고 난이도별 성공률과 bootstrap confidence interval, paired case 차이를 함께 본다. 같은 문제를 모든 군에 배치했으므로 어떤 case가 통신에서 새로 해결됐고 어떤 case가 오히려 망가졌는지 짝지어 볼 수 있다.

통신 품질은 메시지 수가 많다고 좋아지지 않는다. 다음 실패 유형을 trace에서 분류한다.

- **Herding:** 첫 오답이 근거 없이 반복돼 모두 같은 답으로 수렴한다.
- **Redundant work:** 네 agent가 같은 계산을 반복하고 새 정보가 없다.
- **Lost evidence:** 올바른 관찰이 메시지에 있었지만 최종 결정에 반영되지 않는다.
- **Authority bias:** manager나 마지막 발화자의 주장을 검증 없이 따른다.
- **Coordination overhead:** 정답은 같지만 token과 시간이 크게 늘어난다.
- **Fragmentation:** 서로 다른 표기와 상태를 써서 정보를 합치지 못한다.

이 분류는 자동 점수와 별개다. 일부 trace를 사람이 blind review하고 동일한 rubric으로 표시한 뒤 reviewer agreement를 보고한다. 결과를 본 뒤 유리한 실패 유형만 새로 만들지 않도록 rubric과 표본 추출법은 실행 전에 동결한다.

## 통신의 순증분을 판정하는 승인 기준

일반 협업 fixture에서 통신군 D를 채택하려면 “가장 높은 accuracy” 한 조건만으로는 부족하다. 최소 기준은 다음과 같다.

1. D와 C의 case 집합, 모델 revision, tokenizer, decoding, tool, 총예산과 선택 규칙이 같다.
2. D의 정확도 개선이 사전에 정한 최소 효과 크기를 넘고 불확실성 구간을 함께 보고한다.
3. 성공 한 건당 token·비용·시간이 서비스 한도를 넘지 않는다.
4. Budget exhaustion, timeout과 invalid final이 개선을 상쇄할 만큼 늘지 않는다.
5. 통신을 제거한 C와 단일 반복 B보다 나은 이유가 단순 추가 sample이나 정보 접근성 차이로 설명되지 않는다.
6. 다른 seed와 보류 test set에서도 방향이 유지된다.

Private-information fixture는 별도 gate를 쓴다. 각 private observation이 message trace에 나타나고, 완전한 답으로 정확히 결합되며, 통신을 끊었을 때는 정보 부족 때문에 실패하는지를 확인한다. 이 결과는 communication channel의 정보 집계 능력만 승인하며 일반 협업 fixture의 D 승격 여부를 바꾸지 않는다.

반대로 정확도 차이가 작고 비용만 늘었다면 “협업 실패”라기보다 이 과제와 예산에서 통신의 순증분을 확인하지 못했다고 쓰는 편이 정확하다. 특정 topology가 실패했을 수도 있고 모델이 메시지 protocol을 학습하지 못했을 수도 있다. 한 번의 부정적 결과로 모든 multi-agent 구조를 부정할 수는 없다.

## 결론: 네 개의 창보다 같은 저울이 먼저다

멀티에이전트 시스템은 화면에 네 개의 역할을 띄우는 순간 그럴듯해진다. 그러나 실험의 질문은 agent가 몇 개인지가 아니라 **같은 총자원에서 메시지 교환이 독립 샘플링보다 더 많은 정답을 만들었는가**다. 이를 보려면 단일 1회, 단일 반복, 다중 독립, 다중 통신을 분리하고 token·호출·시간·최종 선택 비용을 한 ledger에 넣어야 한다.

공식 교육용 실험은 공유 정책과 검증 가능한 과제, team reward를 통해 협력을 학습시키는 출발점을 제공한다.[1] `swarmlab`은 topology, visibility, role과 budget을 통제하고 event log를 replay할 수 있는 실험 기반을 제공한다.[2] 어느 쪽도 “에이전트 네 개는 네 배 낫다”는 보증서는 아니다.

작은 팀이 먼저 할 일은 GPU 두 장을 빌리는 것이 아니라 자동 채점 가능한 fixture와 공정한 대조군을 만드는 것이다. 결과가 좋아도 공급자 실험값과 자체 관찰을 섞지 않고, 결과가 나빠도 실행하지 않은 조건을 추측으로 채우지 않는다. 같은 저울 위에서 정확도, token, 실패 유형을 함께 잴 때만 협업은 데모의 인상에서 운영 가능한 증거로 바뀐다.

## Sources

[1] https://huggingface.co/blog/training-swarms
[2] https://github.com/huggingface/swarmlab
