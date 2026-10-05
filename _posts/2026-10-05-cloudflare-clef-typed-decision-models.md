---
title: 'Cloudflare Clef: typed probability로 에이전트 결정을 닫는 법'
date: 2026-10-05 07:30:00 +0900
categories: ["AI 에이전트"]
description: 'Cloudflare Clef의 typed question과 probability 출력을 action gate로 연결할 때 필요한 calibration, threshold, abstain, human escalation, drift 운영 계약을 분석한다.'
featured_image: 'https://picsum.photos/seed/cloudflare-clef-typed-decision-models/1600/900'
tags: [cloudflare-clef, decision-model, typed-probability, calibration, abstain, human-escalation, model-drift]
---

![Cloudflare Clef typed decision model](https://picsum.photos/seed/cloudflare-clef-typed-decision-models/1600/900)

에이전트의 모든 분기점에 자유형 LLM 답변이 필요한 것은 아니다. 고객 문의가 긴급한지, 어느 팀이 담당해야 하는지, 요청을 통과시킬지 막을지처럼 선택지가 미리 정해진 결정도 많다. 이런 곳에서 긴 설명을 생성한 뒤 다시 JSON으로 해석하면 출력 문법, 파싱 실패, 선택지 밖 답변까지 애플리케이션이 떠안는다.

Cloudflare가 2026년 10월 1일 공개한 Clef와 Clef-flash는 이 문제를 다른 계약으로 좁힌다. 모델은 입력 상태와 typed question을 받고, 허용된 답마다 probability를 반환한다. Cloudflare는 Clef를 27B, Clef-flash를 9B 모델로 소개하며 둘 다 64K context를 지원한다고 밝혔다. 두 모델은 Workers AI에서 바로 사용할 수 있고 Apache 2.0 weight도 공개됐다.[1][2][3][4]

하지만 출력이 구조화됐다는 사실과 판단이 옳다는 사실은 다르다. **schema-bound 출력은 문법적 범위를 제한할 뿐 정답을 보장하지 않는다.** 잘못 보정된 0.97도 여전히 잘못된 판단이다. Clef를 운영에 넣는 핵심은 모델 호출보다 typed question, probability, threshold, abstain, 사람 승인과 drift 감시를 하나의 결정 계약으로 연결하는 데 있다.

## typed question은 프롬프트가 아니라 결정 공간이다

일반적인 생성 모델 호출은 답변 형식, 근거와 다음 행동이 섞이기 쉽다. Clef 계열은 입력 `state`와 질문 집합을 분리하고, 질문마다 허용된 답의 형식을 지정한다. 공식 예시는 긴급 여부, 담당 팀, 심각도처럼 서로 다른 질문을 한 상태에 적용한다.[1]

이 구조의 장점은 선택지가 닫혀 있다는 점이다. 담당 팀을 `billing`, `technical`, `sales`로 정의했다면 존재하지 않는 팀이나 장문의 실행 계획이 답으로 나오는 문제를 줄일 수 있다.

반대로 스키마가 현실을 잘못 자르면 모델은 올바른 답을 낼 수 없다. 보안 사건을 `benign`과 `malicious` 둘로만 나누면 조사 정보가 부족한 상태를 표현할 자리가 없다. 담당 팀 선택지에 실제 소유 팀이 빠져 있으면 가장 높은 확률의 답도 잘못된 라우팅이다. 따라서 typed question에는 최소한 다음이 포함돼야 한다.

- 질문 ID와 schema version
- 각 선택지의 업무상 정의와 경계 사례
- 질문이 답할 수 없는 상태를 위한 `unknown` 또는 `needs_review`
- 입력 freshness와 필수 필드 조건
- 결정을 소비할 서비스와 허용된 후속 동작

이것은 모델 출력 형식을 예쁘게 만드는 작업이 아니다. 조직이 자동화하려는 결정을 열거하고, 자동화할 수 없는 상태를 같은 계약 안에 넣는 작업이다.

## probability는 행동이 아니라 관측값이다

Cloudflare 문서는 Clef가 허용된 답 각각에 probability를 반환하며, 에이전트가 이를 이용해 route, block, human escalation 같은 동작을 할 수 있다고 설명한다.[2] 여기서 책임 경계를 정확히 읽어야 한다. 모델이 `block`을 실행하는 것이 아니라 **호출자 코드가 확률을 받아 어떤 행동을 허용할지 결정한다.**

```text
state + typed question
  -> answer별 probability
  -> caller policy
       -> 자동 처리
       -> 보류(abstain)
       -> 사람 검토
  -> 실행 결과 확인
```

예를 들어 `malicious=0.91`이라는 값만으로 계정을 차단해서는 안 된다. 호출자는 질문 버전, 입력 완전성, 자산 위험도, 오판 비용과 threshold를 함께 평가해야 한다. 읽기 전용 큐 분류와 계정 정지는 같은 0.91을 다르게 취급해야 한다. 전자는 잘못 배치해도 되돌리기 쉽지만 후자는 정상 사용자를 즉시 막을 수 있기 때문이다.

권장 정책은 행동별로 분리하는 것이다. 낮은 위험의 자동 분류는 상대적으로 낮은 threshold를 둘 수 있다. 되돌릴 수 없는 삭제, 결제 거부, 계정 정지처럼 피해가 큰 동작은 더 높은 threshold뿐 아니라 독립 규칙과 사람 승인을 요구해야 한다. 모델 probability는 정책 엔진의 입력이지 권한 토큰이나 실행 승인이 아니다.

호출자 소유권은 실패 처리에서도 중요하다. 모델 timeout, schema mismatch, 필수 입력 누락, 상위 두 답의 확률 차이가 작은 경우를 임의의 기본 답으로 접으면 안 된다. 이 상태들은 업무상 결정이 아니라 **결정을 내릴 증거가 부족한 상태**로 기록해야 한다.

## threshold보다 먼저 calibration을 검증한다

확률을 action gate에 쓰려면 calibration이 필요하다. 예측값이 0.8인 사례들을 충분히 모았을 때 실제 정답 비율도 대략 0.8에 가까운지를 보는 성질이다. Cloudflare는 학습 과정에서 유효한 schema output을 위한 label-smoothed cross-entropy와 probability calibration을 다듬기 위한 Brier loss를 사용했다고 설명한다.[1] 이는 calibration을 학습 목표에 포함했다는 공급자 설명이지, 각 조직의 데이터에서 0.8이 곧 80% 성공을 뜻한다는 보장은 아니다.

운영 전에는 자체 holdout 데이터에서 질문별 reliability를 확인해야 한다. 전체 평균 하나로 합치지 말고 언어, 고객군, 입력 출처, 위험 등급, 희귀 클래스별로 나눈다. 전체적으로 잘 보정된 모델도 장애 티켓이나 새로운 피싱 유형에서 과신할 수 있다.

최소 평가 항목은 다음과 같다.

| 평가 항목 | 확인할 질문 |
|---|---|
| reliability curve | 0.7~0.8 구간의 실제 정답률도 그 수준인가 |
| Brier score | 확률 오차가 기존 기준선보다 줄었는가 |
| class별 precision·recall | 희귀하지만 위험한 답을 놓치지 않는가 |
| top-2 margin | 첫 답과 둘째 답이 사실상 동률인 사례가 많은가 |
| coverage | 자동 결정으로 닫힌 비율은 얼마인가 |
| selective risk | 낮은 확신 사례를 보류했을 때 남은 자동 결정의 오류율은 얼마인가 |

threshold는 이 측정 뒤에 정한다. “0.9 이상이면 안전” 같은 보편값은 없다. 질문과 행동마다 false positive와 false negative의 비용이 다르며, class prevalence가 바뀌면 같은 threshold의 precision도 달라진다. threshold를 조정한 데이터와 최종 성능을 평가할 데이터도 분리해야 과적합을 숨기지 않는다.

## abstain과 사람 escalation을 정상 경로로 둔다

닫힌 선택지 모델은 항상 하나의 답에 가장 높은 확률을 줄 수 있다. 그러나 top-1이 존재한다는 사실은 자동 처리해도 된다는 뜻이 아니다. 운영 계약에는 모델이 답을 만들 수 있는 영역과 시스템이 행동해도 되는 영역 사이에 abstain 구간이 필요하다.

abstain 조건은 단일 확률 하한보다 넓게 잡는 편이 안전하다.

- 최고 확률이 질문별 threshold보다 낮다.
- top-1과 top-2의 차이가 너무 작다.
- 필수 입력이 없거나 허용된 freshness를 넘었다.
- 입력이 학습·검증 분포 밖으로 탐지됐다.
- 상호 의존 질문의 답이 충돌한다.
- 고위험 행동이라 별도 승인 정책이 적용된다.

사람 escalation도 단순 실패 큐가 되어서는 안 된다. 검토자는 원문 상태, 각 답의 probability, 질문·모델·정책 버전, abstain 이유를 함께 받아야 한다. 사람의 최종 답과 근거는 나중에 calibration과 drift를 평가할 label로 되돌릴 수 있다. 다만 사람 답변을 곧바로 자동 학습 데이터로 넣으면 검토자 편향과 잘못된 라벨도 증폭된다. label quality gate와 이견 조정 절차를 둬야 한다.

자동화율을 높이려고 abstain을 실패로 취급하면 threshold가 느슨해지고 조용한 오판이 늘어난다. 반대로 모든 애매한 사례를 사람에게 보내면 검토 큐가 병목이 된다. 목표는 최대 자동화가 아니라 허용 가능한 오류 위험에서 확보한 **검증된 coverage**여야 한다.

## drift는 모델 버전뿐 아니라 질문과 업무에서 온다

decision model의 품질은 weight가 바뀔 때만 흔들리지 않는다. 고객 문의 문구, 공격 패턴, 제품 taxonomy, 팀 소유권, class 비율이 변해도 probability의 의미가 달라진다.

따라서 다음 값을 질문 버전별 시계열로 봐야 한다.

- 답변 분포와 probability histogram
- threshold별 자동 처리율과 abstain율
- 사람 overturn 비율과 사유
- class별 precision·recall 및 calibration error
- 입력 누락률과 out-of-distribution 비율
- 실제 실행 뒤 rollback·재분류·사용자 이의 제기율

경보는 평균 confidence 하락에만 걸지 않는다. 평균 confidence는 그대로인데 특정 클래스의 사람 overturn이 늘거나, 자동 처리율이 갑자기 상승하면서 사후 재분류가 늘어도 drift 신호다. 새 모델, 새 adapter, 질문 문구, 선택지, threshold 중 하나라도 바뀌면 각각을 독립 버전으로 남겨야 원인을 되짚을 수 있다.

rollout은 과거 label 데이터의 offline replay에서 시작하고, 다음으로 기존 결정을 바꾸지 않는 shadow traffic을 거친다. 이후 낮은 위험의 읽기·분류 업무에 제한적으로 적용한 뒤 확대한다. 고위험 write는 모델이 좋아져도 사람 승인이나 deterministic policy를 유지할 수 있다.

## Workers AI 제공과 RL 서비스 상태를 섞지 않는다

2026년 10월 1일 발표 시점에 Clef와 Clef-flash의 hosted model은 Workers AI에서 사용할 수 있고, weight는 Apache 2.0으로 공개됐다.[3][4] 이것은 현재 이용 가능한 모델 배포 상태다.

반면 조직 데이터로 진행하는 RL fine-tuning은 같은 상태가 아니다. Cloudflare는 AI Gateway의 request·response 데이터, Workers AI rollout, Containers의 RL sandbox, trainer, Workers AI와 BYO Model 재배포를 잇는 구상을 설명했다.[1] 그러나 발표문은 먼저 Field Deployment Engineer와 함께 모델을 학습하는 design-partner service로 제공하고, 이후 self-service platform을 만들 계획이라고 구분한다.[1] 따라서 “사용자가 지금 콘솔에서 자체 RL fine-tuning을 바로 수행할 수 있다”거나 self-service가 GA라고 쓰면 범위를 넘는다.

hosted model 평가, 공개 weight의 자체 검증, FDE 참여형 fine-tuning은 데이터 이동과 배포 책임이 서로 다르다. 미래 self-service 계획을 현재 기능의 구매 근거로 삼아서는 안 된다.

## benchmark는 후보 선정 자료이지 threshold 증거가 아니다

Cloudflare는 Clef가 10개 decision benchmark 가운데 7개에서 가장 높은 점수를 기록했다고 밝혔고, 43개 benchmark 평가에서 집계한 Jev 대비 median·p95 latency를 제시했다. changelog의 수치는 Clef 209.3ms median·238.6ms p95, Clef-flash 38.8ms median·122.4ms p95, Jev 524.1ms median·536.0ms p95다.[1][2]

이 수치는 Cloudflare가 구성하고 실행한 vendor benchmark다. production traffic의 정확도, calibration, network latency, cold start, queue, 지역별 tail latency를 보장하지 않는다. 특히 “몇 배 빠르다”는 비교를 우리 서비스의 end-to-end 지연으로 옮길 수 없다. 전처리, 네트워크, 정책 평가, 사람 큐, 후속 실행까지 포함하면 임계 경로가 달라진다.

도입 평가는 실제 typed question과 class 비율에서 calibration, selective risk, coverage, p95 지연을 함께 측정해야 한다. 빠르지만 과신하는 모델은 고위험 gate에 부적합할 수 있다.

## 결정 모델의 완성 지점은 호출자 정책이다

Clef가 제공하는 중요한 변화는 자유형 생성 대신 typed question과 허용 답별 probability라는 좁은 인터페이스다. non-autoregressive하게 유효 schema choice를 병렬 scoring한다는 구현과 Workers AI 배포는 hot path의 후보가 될 수 있다.[1] 그러나 좁은 인터페이스는 책임을 없애지 않고 더 선명하게 만든다.

모델은 확률을 낸다. 호출자는 질문과 선택지를 정의하고, calibration을 검증하며, 행동별 threshold를 정한다. 증거가 부족하면 abstain하고, 위험이 크면 사람에게 escalation한다. 실행 뒤 결과를 읽어 오판과 drift를 측정한다. 이 연결이 없으면 typed output은 잘못된 판단을 파싱 가능한 형태로 더 빨리 전달할 뿐이다.

에이전트 결정을 닫는다는 것은 언제나 답을 내게 만드는 일이 아니다. **자동으로 행동해도 되는 범위, 보류해야 하는 범위, 사람이 책임져야 하는 범위를 확률과 정책으로 명시하는 일**이다. schema-bound는 그 계약의 시작점이지 정답 인증서가 아니다.

## Sources

[1] https://blog.cloudflare.com/clef-decision-models/ — Introducing Clef: our open-source decision models, and new RL fine-tuning platform
[2] https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/ — Introducing Clef on Workers AI
[3] https://huggingface.co/Cloudflare/clef — Cloudflare Clef 27B model card
[4] https://huggingface.co/Cloudflare/clef-flash — Cloudflare Clef-Flash 9B model card
