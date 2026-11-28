---
title: '점수보다 평가 파이프라인을 테스트하라: 에이전트 평가 8단계 회귀 실험'
date: 2026-11-28 07:10:00 +0900
categories: ["AI"]
description: '에이전트 점수를 주장부터 보고까지 8단계 공급망으로 분해하고, task·환경·harness·grader 변경을 잡는 fail-closed 회귀 테스트를 설계한다.'
featured_image: 'https://picsum.photos/seed/agent-evaluation-pipeline-regression/1600/900'
tags: [agent-evaluation, benchmark, regression-test, grader, trace, reproducibility]
---

![옅은 하늘 아래 구름이 바다처럼 펼쳐진 풍경](https://picsum.photos/seed/agent-evaluation-pipeline-regression/1600/900)

에이전트 benchmark 점수가 42%에서 48%로 올랐다. 모델이 좋아졌을 수도 있다. 하지만 task가 바뀌었거나 container image가 수정됐거나, harness가 더 많은 turn을 허용했거나, grader bug가 사라졌거나, 실패 case가 집계에서 빠졌을 수도 있다. 최종 숫자는 모델 하나의 속성이 아니라 평가 pipeline 전체가 만든 산출물이다.

Hugging Face는 2026년 11월 공개한 가이드에서 언어 모델 평가가 질문·답변에서 도구를 쓰는 agent, 다시 여러 agent의 팀으로 확장되면서 task와 environment, 주변 software가 점수에 영향을 주는 구조를 설명한다.[1] 공식 글은 공개 검토와 수정 이력, task·environment·rollout·trace·reference solution의 공개 범위를 나눠 다룬다.[1]

이 글은 해당 가이드의 점수를 재현한 실험이 아니다. 평가를 **주장 → 과제 → 환경 → harness → trace → grader → 집계 → 보고**의 여덟 단계로 고정하고, 어느 단계가 바뀌었을 때 기존 결과를 무효화하거나 재실행해야 하는지 검증하는 회귀 설계다. 좋은 점수보다 먼저 “같은 것을 같은 방식으로 쟀는가”를 통과시킨다.

## 1단계 주장: 무엇을 증명하려는지 hash보다 먼저 적는다

평가의 시작은 dataset이 아니라 claim이다. “이 모델은 코딩을 잘한다”, “우리 agent는 환불 업무를 자동화한다”, “새 prompt가 안전하다”는 서로 다른 주장이고 필요한 표본과 실패 비용도 다르다. Claim이 흐리면 통과한 case만 보고 넓은 결론을 붙이게 된다.

Claim manifest에는 대상 population, 행위, 성공 조건, 허용하지 않는 일반화를 적는다. 예를 들면 다음과 같다.

```text
claim_id: repo-fix-python-v1
claim: 공개 Python 저장소의 격리된 버그 수정 과제를 해결한다
unit: task 1개, 독립 attempt 1회
primary: all_required_tests_pass
safety: forbidden_network_write = 0
excludes: 장기 유지보수 능력, 비공개 저장소 성능, 다른 harness로의 이식성
```

이 manifest는 점수를 보고 나서 바꾸지 않는다. Model이나 adapter를 비교하려면 동일 claim revision을 사용한다. Claim이 달라졌다면 같은 leaderboard column에 이어 붙이지 않고 새 series를 만든다. 특히 pass@1을 여러 재시도 중 하나라도 성공한 pass@n처럼 표현하거나 public task 성능을 production reliability로 확대하지 않는다.

공식 가이드는 model release에서 agentic 평가의 비중이 커졌지만 agent가 tool로 environment를 바꾸는 순간 주변 software 각 부분이 score에 영향을 줄 수 있다고 지적한다.[1] 따라서 claim에는 모델 이름뿐 아니라 실제 평가할 system boundary를 명시해야 한다. Model-only claim인지, 특정 harness를 포함한 agent system claim인지부터 갈라야 한다.

## 2단계 과제: 문제 자체를 테스트한다

Task에는 instruction, initial state, 허용 도구, expected terminal state와 verifier가 필요하다. 회귀 시험은 task 파일이 parse되는지만 보지 않는다. 정답과 오답 control을 실행해 verifier가 의도한 의미를 구분하는지 확인한다.

최소 control은 네 가지다.

1. **Oracle:** 알려진 정답이 최대 보상을 받는다.
2. **Do nothing:** 아무 변경도 하지 않으면 낮은 점수를 받는다.
3. **Known wrong:** 그럴듯하지만 틀린 해결책이 실패한다.
4. **Replay:** 같은 terminal state를 다시 채점하면 같은 결과가 나온다.

오염과 포화도 구분한다. 공개 repository와 reference patch가 training 자료에 노출됐을 가능성이 있으면 단순 고득점을 새 추론 능력으로 해석하지 않는다. 공식 가이드는 공개 검토가 잘못된 test를 고치는 데 중요하지만 공개 task가 training에서 접하기 쉬워지는 trade-off도 설명한다.[1] Active test item을 보호하더라도 task construction, category, public development split과 correction history는 공개할 수 있다.[1]

Task manifest에는 source license, 생성·수정 이력, 중복 group, repository와 commit, 금지된 training overlap을 남긴다. Test를 고쳤다면 이전 run을 조용히 재채점하지 않는다. 수정 전후 task revision과 영향을 받은 model result를 함께 기록한다.

## 3단계 환경: 재현 가능한 시작 상태를 만든다

Agent 평가에서 environment는 배경이 아니다. Package mirror, system clock, locale, network, CPU architecture, browser state와 external API 응답이 다르면 같은 action도 다른 결과를 낸다. Container tag만 저장하면 mutable image가 바뀔 수 있으므로 image digest와 build recipe, dependency lock을 보존한다.

환경 preflight는 평가 전에 실행한다.

- Initial file tree와 database fixture hash가 manifest와 같은가?
- Network는 차단·허용 목록대로 동작하는가?
- Credential이 합성값이며 production 권한이 없는가?
- Clock, timezone, locale, random seed가 고정됐는가?
- Tool binary와 dependency version이 receipt와 같은가?
- Case 종료 뒤 snapshot이 초기 상태로 복구되는가?

외부 web이나 SaaS를 반드시 써야 한다면 live service 결과를 재현 가능한 benchmark truth로 취급하기 어렵다. 가능한 한 recorded response나 전용 sandbox를 쓰고, live dependency는 관찰 시각과 실패 상태를 별도 지표로 기록한다. Environment가 준비되지 않은 case는 0점 성공·실패가 아니라 `invalid_environment`로 분리하되, 최종 denominator에서 몰래 빼지 않는다.

공식 가이드는 container definition, build file, pinned dependency와 synthetic fixture를 공개 가능한 environment 요소로 들고, private data·credential·licensed asset은 보호하되 public substitute와의 차이를 문서화하도록 제안한다.[1] “보안상 비공개”가 환경 version조차 공개하지 않는 면허가 되어서는 안 된다.

## 4단계 harness: 모델 밖 실행 정책을 고정한다

Harness는 system prompt, tool schema, context trimming, retry, timeout, 최대 turn, decoding과 message 변환을 소유한다. 같은 model이라도 harness가 다르면 model이 보는 token과 가능한 행동이 달라진다. 그러므로 모델 변경 실험에서 harness도 동시에 업그레이드하면 원인을 분리할 수 없다.

Harness receipt에는 source revision, config digest, system prompt digest, tool name·schema, context policy, model endpoint, decoding, token·turn·time budget을 저장한다. Secret 값은 저장하지 않고 이름과 scope, synthetic 여부만 기록한다. Adapter나 prompt를 바꿀 때도 다른 필드는 그대로인지 machine diff로 확인한다.

회귀 fixture는 harness의 실패 semantics를 겨냥해야 한다. Tool timeout 뒤 같은 write를 재시도하는지, malformed argument를 모델에게 돌려주는지, context가 잘릴 때 original instruction이 남는지, model response가 비어 있을 때 실패로 끝나는지 시험한다. 금지 도구 호출을 grader가 나중에 감점하는 데 그치지 말고 execution layer에서 차단한다.

평가하려는 대상이 model+harness 전체라면 harness를 고정할 필요가 없다는 반론이 있다. 맞지만 그 경우 claim도 system-level로 써야 한다. “Model B가 Model A보다 낫다”가 아니라 “Harness revision H2를 포함한 system B가 H1 system A보다 이 평가에서 낫다”고 보고한다.

## 5단계 trace: 최종 답보다 실행 증거를 보존한다

에이전트는 최종 문장 전에 file을 쓰고 command를 실행하고 environment를 바꾼다. 답만 저장하면 금지된 우회, 불필요한 비용, grader가 못 본 부작용을 잃는다. Trace에는 timestamp와 sequence를 가진 model message, tool call·result, state diff, token usage, error와 종료 이유가 필요하다.

그렇다고 모든 원문을 무기한 공개하면 task answer, credential, 개인 data나 model의 민감 출력을 노출할 수 있다. 공식 가이드는 public task trace와 검토된 excerpt, analysis code를 공개할 수 있지만 protected task나 private data가 든 trace는 보호된 분석과 승인된 case inspection으로 대체할 수 있다고 설명한다.[1]

Trace pipeline도 자체 회귀 시험을 갖는다. Tool call 수를 원시 log에서 다시 계산한 값과 summary가 같은지, error event가 누락되지 않는지, sequence gap과 clock reversal이 없는지 확인한다. Redaction은 원본을 바꿔치기하지 않고 restricted raw trace와 public projection을 구분하며 두 artifact의 digest와 변환 version을 연결한다.

Telemetry가 끊긴 run을 정상 run으로 계산하면 안 된다. Required event가 없거나 trace exporter가 실패하면 `invalid_trace`로 처리한다. 평균 token을 계산할 때 usage가 없는 run을 0으로 넣지 않는다.

## 6단계 grader: 정답보다 채점기를 먼저 공격한다

Grader는 test suite, state assertion, rule-based checker나 LLM judge일 수 있다. 어떤 방식이든 우회 가능성을 시험한다. Agent가 test file을 삭제하거나 expected output을 덮어쓰거나 log 문자열만 맞춰도 pass하는지 known-wrong control로 확인한다. Grader는 agent workspace와 분리된 read-only reference를 사용하고, 종료 뒤 예상 artifact뿐 아니라 금지된 side effect도 검사한다.

LLM judge는 의미 평가에 유용하지만 결정적 security gate를 대신하지 않는다. Judge model·prompt·temperature와 parsing code를 versioning하고, malformed·refusal·timeout을 임의 기본점수로 바꾸지 않는다. 소수 gold case에서 사람 rubric과 불일치율을 추적하고 judge 변경 전후에는 같은 frozen output을 재채점하는 parity test를 한다.

`grader_version`이 바뀌면 기존 raw trace를 새 grader로 재채점해 차이를 볼 수 있지만 이것을 원래 발표 score의 조용한 수정으로 쓰면 안 된다. `score_at_run`과 `score_regraded`를 나누고 correction note를 남긴다. Task와 grader를 함께 바꾸면 어떤 변경이 영향을 줬는지 알 수 없으므로 가능한 한 한 축씩 승격한다.

## 7·8단계 집계와 보고: 누락을 성공으로 바꾸지 않는다

집계기는 전체 예정 case와 실제 run의 set equality부터 확인한다. Timeout, infrastructure error, invalid environment·trace·grader가 denominator에서 빠지면 unreliable system이 오히려 높은 점수를 얻을 수 있다. Primary score와 함께 예정·실행·유효·성공·실패·무효 수를 각각 보고한다.

평균 pass rate 외에도 case family별 결과, paired delta, confidence interval, token·tool call·wall time 분포를 낸다. 여러 attempt를 했다면 pass@k의 k와 selection rule을 표시한다. Checkpoint나 threshold를 test score를 보며 선택했다면 별도 holdout에서 다시 평가한다.

최종 report에는 다음 receipt를 붙인다.

```text
claim_revision
task_set_digest + case_count
environment_image_digest
harness_revision + config_digest
model_revision + adapter_digest
grader_revision
aggregation_revision
run_ids + trace inventory digest
planned / completed / valid / passed counts
known deviations and correction history
```

Hugging Face 공식 글은 약 3,500개의 eval leaderboard와 약 17,000개의 eval dataset이라는 게시 시점 Hub 현황을 언급하지만, 수가 많다는 사실은 개별 평가의 품질을 보증하지 않는다.[1] 같은 이유로 leaderboard score도 receipt 없이 실제 배포 신뢰성을 뜻하지 않는다.

### 여덟 단계 회귀 gate를 하나의 상태로 묶는다

CI gate는 단계별 검사를 통과한 뒤에만 score를 계산한다. 예시는 다음과 같다.

```text
claim_valid
  && task_controls_pass
  && environment_preflight_pass
  && harness_receipt_match
  && trace_complete
  && grader_controls_pass
  && aggregation_set_equality
  && report_receipts_complete
```

한 항목이 실패하면 이전 score를 재사용하거나 누락 case를 제외해 새 score를 내지 않는다. 수정 뒤에는 영향을 받은 단계부터 다시 실행하되 downstream artifact도 새 digest로 재생성한다. Environment image가 바뀌었다면 trace, score와 report가 모두 새 run lineage를 가져야 한다.

Regression corpus에는 정상 fixture뿐 아니라 의도적인 결함을 넣는다. 정답인데 fail하는 test, 오답인데 pass하는 grader, 누락 tool event, 중복 case ID, timeout을 성공으로 바꾸는 aggregator, 다른 dataset hash를 같은 run으로 합치는 report를 준비한다. Gate가 이 mutation을 모두 거부해야 한다. 이는 실제 benchmark 결과가 아니라 평가 infrastructure를 검증하기 위한 제안이다.

공개와 비공개의 경계도 단계별로 정한다. Active test answer를 숨기더라도 claim, category, environment contract, harness budget, metric definition, aggregate denominator와 correction history까지 숨길 이유는 적다. 완전 공개와 완전 비공개 사이에서 재현 가능한 public development split과 승인된 independent review를 조합한다.

## 결론: 점수의 소유자는 모델 하나가 아니다

에이전트 점수는 여덟 단계 중 하나라도 바뀌면 의미가 달라질 수 있다. Task bug 수정은 모델 개선이 아니고, harness의 turn 증가도 weight 개선이 아니며, telemetry 누락은 token 0이 아니다. Claim, task, environment, harness, trace, grader, aggregation, report가 같은 lineage에 있는지 확인해야 한다.

공식 가이드는 agentic evaluation에서 environment와 harness를 포함한 주변 요소, 공개 검토와 correction history, 보호해야 할 test item과 공개 가능한 검증 artifact를 함께 다룬다.[1] 이 원칙을 CI로 옮기면 평가 pipeline 자체가 test 대상이 된다.

좋은 회귀 gate는 점수를 더 잘 보이게 만들지 않는다. 오히려 case가 빠지고 grader가 흔들리고 environment가 달라졌을 때 숫자를 내지 못하게 한다. 그 불편함이 신뢰의 조건이다. **모델을 비교하기 전에 측정기가 같은 질문을 반복하고 있는지 증명할 때** 비로소 42%와 48%의 차이를 해석할 수 있다.

## Sources

[1] https://huggingface.co/blog/agentic-evals
