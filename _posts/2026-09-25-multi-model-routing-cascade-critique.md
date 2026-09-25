---
title: '멀티모델 라우팅 운영 설계: Single, Cascade, Critique의 비용과 실패 경계'
date: 2026-09-25 07:20:00 +0900
categories: ["AI 에이전트"]
description: '멀티모델 오케스트레이션을 Single, Cascade, Critique 흐름으로 나누고 품질 게이트 오판, 상관 실패, 지연시간, 전체 워크플로 비용, 격리와 안전한 패치 적용까지 운영 관점에서 분석한다.'
featured_image: 'https://picsum.photos/seed/multi-model-routing-cascade-critique/1600/900'
tags: [ai-agent, multi-model, model-routing, cascade, critique, llmops, observability]
---

![멀티모델 라우팅과 cascade critique 운영](https://picsum.photos/seed/multi-model-routing-cascade-critique/1600/900)

모델을 여러 개 연결하면 품질과 비용을 동시에 최적화할 수 있다는 설명은 매력적이다. 작은 모델이 대부분의 작업을 처리하고, 어려운 요청만 강한 모델로 넘기며, 필요할 때 다른 모델이 결과를 비평하면 된다. 다이어그램도 단순하다. 그러나 운영 환경에서 어려운 부분은 모델을 두 개 호출하는 코드가 아니다. 어느 요청을 올릴지 판단하고, 두 모델의 실패가 겹치는 순간을 탐지하며, 추가 호출의 지연과 비용을 전체 작업 기준으로 통제하는 일이다.

GitHub는 2026년 9월 4일 Project HydraFusion을 research preview로 소개하면서 Single, Cascade, Critique라는 세 가지 오케스트레이션 패턴을 제시했다.[3] 이 preview에서 Cascade는 효율적인 모델의 초안에 품질 게이트를 적용하고 필요할 때 상위 모델로 승격하는 흐름이며, Critique는 초안을 다른 모델 계열의 읽기 전용 critic이 검토한 뒤 한 번 수정하는 흐름이다.[3] 이 구분은 멀티모델 시스템을 운영 설계로 옮길 때 유용한 출발점이다.

하지만 패턴 이름만 선택한다고 시스템이 완성되지는 않는다. Cascade의 핵심은 첫 모델보다 품질 게이트다. Critique의 핵심은 비평 모델의 지능보다 격리와 수정 적용 규칙이다. Single의 핵심은 단순함 자체가 아니라 복구 가능한 기준선이라는 점이다. 세 경로를 하나의 제품에 넣으려면 라우팅 정확도, 품질, 지연시간, 비용, 안전성을 각각 측정하고 서로의 교환 관계를 명시해야 한다.

이 글은 멀티모델 오케스트레이션을 “어떤 모델 조합이 가장 강한가”가 아니라 “실패를 어디서 제한하고 어떻게 관측할 것인가”라는 운영 문제로 다룬다.

## 먼저 세 흐름의 책임을 분리한다

세 패턴을 모델 수로만 구분하면 설계가 흐려진다. 중요한 차이는 호출 횟수가 아니라 결정권과 부작용이 어디에 있는가다.

### Single: 비교 기준이자 안전한 축소 경로

Single은 하나의 모델이 작업을 처음부터 끝까지 처리한다. GitHub가 소개한 분류에서도 Single은 한 모델을 사용하는 기본 패턴이다.[3] 구현이 단순하고 호출 경로가 짧으며, 실패 원인도 상대적으로 추적하기 쉽다.

Single을 “낮은 단계”로 취급하면 안 된다. 오히려 모든 멀티모델 실험은 동일한 프롬프트, 도구, 샌드박스, reasoning 설정을 사용하는 Single 기준선에서 시작해야 한다. 그래야 Cascade나 Critique의 이득이 모델 변경 때문인지, 프롬프트 변경 때문인지, 추가 검증 때문인지 구분할 수 있다.

운영에서 Single은 다음 세 역할을 맡는다.

1. **성능 기준선**: 성공률, 완료 시간, 성공한 작업당 비용을 비교한다.
2. **장애 축소 모드**: 라우터나 critic이 불안정할 때 단일 모델 경로로 돌아간다.
3. **재현 경로**: 복잡한 멀티모델 trace를 단순한 조건으로 재실행한다.

따라서 Single 경로를 없애고 모든 요청을 곧바로 Cascade로 보내는 것은 좋지 않다. 멀티모델 계층에 장애가 생겼을 때 비교점과 피난처를 동시에 잃기 때문이다.

### Cascade: 싼 초안보다 게이트가 중심이다

Cascade는 상대적으로 효율적인 모델이 먼저 결과를 만들고, 품질 게이트가 부족하다고 판단한 작업만 더 강한 모델로 승격한다.[3] 이상적인 경우 쉬운 요청은 저비용 경로에서 끝나고 어려운 요청만 추가 비용을 쓴다.

이를 단순화하면 다음과 같다.

```text
request
  -> draft model
  -> quality gate
       -> pass: 결과 검증 후 종료
       -> fail: stronger model로 escalation
  -> 최종 검증
```

여기서 draft model의 가격보다 중요한 값은 게이트의 오판 비용이다. 통과시켜야 할 결과를 승격하면 비용과 지연이 늘어난다. 승격해야 할 결과를 통과시키면 사용자에게 낮은 품질이나 잘못된 변경이 전달된다. 전자는 운영 효율을 해치고 후자는 제품 신뢰를 해친다.

Cascade의 성공 조건은 “작은 모델이 꽤 잘한다”가 아니다. **작은 모델이 실패하는 요청을 게이트가 충분히 잘 식별한다**가 더 정확한 조건이다. 이 차이를 놓치면 평균 benchmark는 좋아도 실제 제품에서 조용한 품질 저하가 발생한다.

### Critique: 두 번째 답변이 아니라 독립 검토다

Critique는 초안 모델의 결과를 다른 모델 계열의 critic이 읽기 전용으로 검토하고, 그 피드백을 바탕으로 한 번 수정하는 패턴이다.[3] “다른 모델에게 다시 물어보기”와 같아 보이지만 운영 의미는 다르다.

critic은 작업을 다시 수행하는 주체가 아니다. 무엇이 잘못되었는지, 어떤 요구사항을 놓쳤는지, 어떤 검증이 부족한지 구조화해 반환하는 검토자다. GitHub가 설명한 패턴은 read-only critic의 검토 뒤 초안을 작성한 모델이 한 번 revision하는 흐름이다.[3] 수정 결과의 검증과 실제 적용 권한은 별도 단계에 남긴다.

```text
request
  -> primary/drafting model이 candidate 생성
  -> read-only critic이 결함 목록 작성
  -> 같은 drafting model이 한 번의 revision 생성
  -> validator가 patch 검증
  -> 안전할 때만 적용
```

Critique의 장점은 서로 다른 관점에서 오류를 발견할 가능성이다. 단점은 두 모델이 같은 잘못된 가정에 동의할 수 있고, critic의 그럴듯하지만 틀린 지적이 오히려 정답을 훼손할 수 있다는 점이다. 그러므로 critic의 출력은 명령이 아니라 검증해야 할 증거 후보여야 한다.

## 품질 게이트는 분류기이며 오판 비용이 비대칭이다

Cascade를 설계할 때 가장 먼저 정해야 할 것은 “품질이 낮으면 승격한다”라는 문장이 아니다. 무엇을 낮은 품질로 정의할지, 각 오판이 얼마의 피해를 만드는지 정해야 한다.

게이트 결과를 네 칸으로 나누면 문제가 선명해진다.

| 실제 초안 상태 | 게이트 판정 | 결과 |
|---|---|---|
| 충분함 | 통과 | 정상 종료 |
| 충분함 | 승격 | 불필요한 비용과 지연 |
| 부족함 | 승격 | 정상 복구 가능 |
| 부족함 | 통과 | 조용한 품질 실패 |

마지막 칸이 가장 위험하다. 시스템은 성공했다고 기록하지만 실제 결과는 요구사항을 충족하지 못한다. 코드 작업이라면 테스트가 빠지거나 잘못된 파일이 수정될 수 있고, 분석 작업이라면 근거 없는 결론이 전달될 수 있다. 사용자 재시도나 사람이 뒤늦게 수정하기 전까지 실패가 드러나지 않을 수도 있다.

반대로 충분한 초안을 과도하게 승격하는 게이트는 품질 지표만 보면 좋아 보일 수 있다. 사실상 대부분의 요청을 강한 모델로 보내기 때문이다. 그러나 이 구조는 Cascade가 아니라 지연된 고비용 Single에 가깝다. 첫 호출의 비용과 시간을 지불한 뒤 강한 모델을 다시 호출한다.

따라서 게이트에는 하나의 정확도 대신 다음 지표가 필요하다.

- 부족한 결과를 승격한 비율, 즉 결함 탐지 재현율
- 승격한 결과 중 실제로 부족했던 비율
- 불필요한 승격률
- 부족한 결과의 잘못된 통과율
- 승격 후 실제 복구율
- 게이트 판단에 든 토큰, 시간, 금액
- 위험 등급별 오판 비용

모든 요청에 같은 임계값을 쓰는 것도 피해야 한다. 문서 초안의 표현 누락과 데이터 삭제 코드를 만드는 작업은 오판 피해가 다르다. 읽기 전용 요약은 약간 느슨한 임계값을 쓸 수 있지만, 쓰기 권한이 있는 작업은 높은 재현율을 우선해야 한다.

게이트 신호는 자기 보고 confidence 하나에 의존하지 않는 편이 낫다. 모델은 틀린 답에 높은 확신을 보일 수 있다. 가능한 신호를 조합해야 한다.

- 출력 schema validation 결과
- 필수 요구사항 coverage
- 테스트와 정적 분석 결과
- 수정 파일 범위 위반 여부
- 금지된 명령이나 API 호출 여부
- diff 크기와 복잡도
- 도구 오류 또는 미완료 단계
- 모델이 명시한 불확실성
- 과거 유사 작업에서의 실패 패턴

특히 실행 가능한 검증이 있으면 모델 평가보다 우선해야 한다. 테스트 실패를 모델에게 다시 평가하게 하기보다 테스트 결과를 게이트의 직접 신호로 쓰는 편이 설명 가능하고 재현 가능하다.

## correlated failure: 모델 수가 독립성을 보장하지 않는다

멀티모델 시스템은 흔히 “한 모델이 놓친 것을 다른 모델이 잡는다”는 가정에 기대지만, 두 모델의 실패가 독립적이라는 보장은 없다. 같은 입력, 같은 누락된 문서, 같은 잘못된 도구 결과를 보면 서로 다른 모델도 같은 결론에 도달할 수 있다.

상관 실패는 여러 층에서 생긴다.

### 입력 상관성

초안과 critic이 동일한 불완전한 요구사항을 읽으면 둘 다 같은 제약을 놓친다. 원인이 모델이 아니라 입력에 있으므로 모델을 바꿔도 해결되지 않는다.

### 컨텍스트 상관성

critic에게 초안의 장황한 추론과 결론을 그대로 제공하면 anchor가 생긴다. critic이 독립적으로 문제를 재구성하지 않고 초안의 논리를 따라갈 수 있다. 검토에는 필요한 산출물과 요구사항을 주되, 불필요한 자기 합리화는 줄이는 편이 낫다.

### 도구 상관성

두 모델이 같은 검색 index, 같은 오래된 문서, 같은 flaky test를 사용하면 사실상 하나의 오류원에 의존한다. 모델 계열을 다르게 해도 관측 데이터가 같으면 실패가 함께 움직인다.

### 평가 상관성

초안과 게이트가 비슷한 프롬프트 패턴과 동일한 모델 계열을 사용하면 같은 스타일의 오류를 정상으로 판단할 수 있다. model family diversity는 도움이 될 수 있지만, 그것만으로 독립성이 증명되지는 않는다.

### 운영 상관성

두 provider 호출이 같은 네트워크 egress, 같은 인증 계층, 같은 quota broker에 의존하면 장애 시 함께 실패한다. 논리적 멀티모델이 물리적 단일 장애점을 가질 수 있다.

상관 실패를 줄이려면 다양성의 위치를 명확히 해야 한다. 모델 이름만 다르게 하는 것이 아니라 검증 방법, 데이터 출처, 실행 권한, 실패 도메인을 분리한다. 예를 들어 코드를 생성한 모델과 다른 모델이 리뷰하더라도 최종 판정은 실제 테스트, type check, policy engine이 맡게 할 수 있다.

운영 지표에도 개별 모델 실패율뿐 아니라 동시 실패율이 필요하다. `P(primary fail)`과 `P(critic fail)`만 기록하면 부족하다. `P(primary fail and critic miss)`와 특정 오류 유형에서의 공동 실패를 측정해야 한다. 두 모델의 실패가 강하게 겹치면 추가 호출은 비용만 늘리고 품질 방어에는 거의 기여하지 않을 수 있다.

## latency는 모델 호출 합이 아니라 임계 경로다

Cascade와 Critique는 호출을 추가하므로 지연시간이 늘어난다. 그러나 단순히 각 모델 평균 시간을 더하는 계산도 정확하지 않다. queue, 도구 실행, 병렬 검증, timeout, 재시도가 섞이기 때문이다.

Cascade의 대략적인 완료 시간은 다음처럼 볼 수 있다.

```text
T_cascade = T_draft + T_gate
          + escalation_rate × (T_escalation + T_final_validation)
          + retry_and_queue_overhead
```

Critique는 대체로 다음 경로를 가진다.

```text
T_critique = T_draft + T_critic + T_revision + T_validation
           + retry_and_queue_overhead
```

평균값만 보면 안 된다. escalation이 드문 경우 평균은 낮아도 승격된 요청의 p95가 사용자 SLA를 넘을 수 있다. critic provider의 tail latency가 길면 전체 Critique 경로가 불안정해진다. 특히 사용자가 기다리는 대화형 작업과 백그라운드 코드 작업은 허용 가능한 지연 예산이 다르다.

라우팅 전에 요청별 latency budget을 정하는 편이 좋다.

```text
interactive quick task: 8초
interactive substantial task: 30초
background coding task: 10분
scheduled batch: 1시간
```

이 값은 예시일 뿐이며 제품의 실제 SLA로 교체해야 한다. 중요한 것은 각 단계가 전체 예산을 모른 채 독립적으로 timeout을 소비하지 않게 하는 것이다. 초안이 예산의 대부분을 사용했다면 critic과 revision을 모두 시작하는 대신 검증 가능한 Single 결과로 종료하거나 비동기 전환을 선택해야 한다.

deadline은 단계별 고정 timeout보다 전체 요청의 남은 시간으로 전달하는 것이 낫다. 각 호출이 30초 timeout을 가지면 세 단계가 연속으로 90초를 소비할 수 있다. 반면 절대 deadline을 공유하면 남은 예산이 없는 단계는 시작하지 않는다.

streaming UX도 구분해야 한다. 초안을 사용자에게 먼저 보여준 뒤 critic이 수정하면 빠르게 느껴질 수 있지만, 사용자가 이미 읽거나 복사한 내용을 뒤집는 문제가 생긴다. 초안이 잠정 결과임을 명확히 표시하지 않으면 속도를 얻는 대신 신뢰를 잃는다. 코드 변경처럼 부작용이 있는 결과는 검토가 끝나기 전에 적용하거나 성공으로 표시하면 안 된다.

## token 가격이 아니라 전체 workflow cost를 계산한다

멀티모델 라우팅의 비용을 모델 API 청구액만으로 비교하면 결론이 왜곡된다. 전체 비용에는 모델, 도구, 샌드박스, 검색, 테스트, 저장소, 관측성, 사람 검토, 실패 복구가 포함된다.

성공한 작업 한 건의 비용은 다음처럼 생각할 수 있다.

```text
성공 작업당 비용 =
  (모든 모델 호출 비용
   + 도구 및 실행 환경 비용
   + retry 비용
   + 실패 후 복구 비용
   + 사람 개입 비용)
  / 검증된 성공 작업 수
```

Cascade가 토큰 비용을 줄여도 잘못 통과한 결과 때문에 사용자 재시도가 늘면 전체 비용은 커질 수 있다. Critique가 호출 비용을 늘려도 배포 전 결함을 발견해 사람 리뷰와 롤백을 줄이면 전체 비용은 낮아질 수 있다. 반대로 critic이 사소한 스타일 지적만 많이 만들어 revision token을 소비한다면 가치가 없다.

complete accounting은 GitHub가 HydraFusion에서 제시한 운영 원칙 중 하나다.[3] 이를 실제 시스템에 적용하려면 요청 하나를 trace ID로 연결하고 초안, 게이트, critic, revision, 테스트, fallback, 사람 개입 비용을 같은 원장에 기록해야 한다.

비용 대시보드에는 최소한 다음 값을 분리한다.

- 요청당 초안 모델 비용
- 게이트 자체 비용
- escalation 모델 비용
- critic 및 revision 비용
- 도구와 샌드박스 실행 비용
- cache hit와 miss
- 취소 후에도 청구된 호출 비용
- retry와 fallback 비용
- 검증된 성공당 총비용
- 오류 유형별 사람 개입 시간

평균 요청 비용만 보면 실패한 긴 꼬리를 숨긴다. p50, p95, p99 비용을 함께 보고, 특정 repository 크기나 입력 길이에서 비용이 폭증하는지 확인해야 한다.

## timeout, cancel, fallback은 하나의 상태 머신이어야 한다

멀티모델 시스템에서 timeout을 단순 예외 처리로 두면 중복 작업과 유령 호출이 생긴다. client는 포기했지만 provider에서는 생성이 계속되고, fallback 모델이 같은 작업을 수행하며, 두 결과가 늦게 도착해 서로 다른 patch를 적용하려 할 수 있다.

요청 상태를 명시적으로 관리해야 한다.

```text
RECEIVED
  -> DRAFT_RUNNING
  -> GATE_RUNNING
  -> ESCALATING | CRITIC_RUNNING | VALIDATING
  -> APPLY_PENDING
  -> COMPLETED

어느 단계에서든:
  -> CANCEL_REQUESTED
  -> CANCELLED | CANCEL_UNCONFIRMED
  -> FALLBACK_ELIGIBLE | FAILED
```

cancel 요청을 보냈다는 사실과 실제 provider 작업이 중단되었다는 사실은 다르다. 취소 확인이 없는 호출은 `CANCEL_UNCONFIRMED`로 남기고, 결과가 늦게 와도 적용 단계에 진입하지 못하도록 fencing token이나 generation ID를 검사해야 한다.

fallback 순서도 사전에 정의해야 한다.

1. 같은 provider에서 안전한 재시도가 가능한지 판단한다.
2. 남은 deadline과 budget을 확인한다.
3. 다른 모델 또는 Single 축소 경로로 전환한다.
4. 출력 schema와 도구 권한을 fallback 경로에서도 다시 강제한다.
5. 쓰기 작업이면 중복 적용을 막는 idempotency key를 사용한다.
6. 품질을 보장할 수 없으면 부분 성공으로 포장하지 않고 실패를 반환한다.

fallback은 가용성을 높이지만 의미가 달라질 수 있다. 모델이 바뀌면 출력 형식, tool selection, 코드 스타일, 안전 거부가 달라질 수 있다. 따라서 “아무 모델이나 응답하면 성공”으로 판정하면 안 된다. 동일한 acceptance test를 통과해야 같은 성공 상태를 받을 수 있다.

retry는 오류 분류 뒤에만 허용한다. 일시적 rate limit, 연결 reset, provider 5xx는 제한된 재시도 대상이 될 수 있다. schema violation, 정책 위반, 반복되는 논리 오류는 같은 입력으로 재시도해도 해결 가능성이 낮다. 이 경우 escalation이나 사용자 확인이 낫다.

## read-only critic은 격리를 기술적으로 강제한다

Critique에서 “critic에게 수정하지 말라고 프롬프트에 쓴다”는 것은 격리가 아니다. critic 프로세스에 쓰기 도구가 연결되어 있으면 실수나 prompt injection으로 부작용이 발생할 수 있다. GitHub가 설명한 Critique 패턴은 다른 모델 계열의 read-only critic을 사용한다.[3] 운영 구현에서도 read-only를 권한 경계로 만들어야 한다.

critic에게 허용할 수 있는 능력은 다음과 같다.

- 요구사항과 산출물 읽기
- diff와 테스트 로그 읽기
- 제한된 검색 또는 문서 조회
- 결함 목록과 증거 위치 반환
- 추가 검증 명령 제안

critic에게 주지 말아야 할 능력은 다음과 같다.

- 저장소 파일 수정
- shell 쓰기 명령 실행
- branch, commit, PR 변경
- 배포 또는 외부 시스템 갱신
- 시크릿 원문 접근
- primary agent의 credential 재사용

가능하면 critic을 별도 컨테이너나 샌드박스에서 실행하고, repository snapshot을 read-only mount로 제공한다. 네트워크도 필요한 endpoint만 허용한다. critic 출력은 자유 형식 명령이 아니라 구조화된 review object로 받는다.

```json
{
  "verdict": "revise",
  "findings": [
    {
      "severity": "high",
      "requirement_id": "R-4",
      "evidence": "src/router.ts:118",
      "problem": "timeout 이후 늦은 결과가 적용될 수 있음",
      "suggested_check": "취소 세대가 다른 결과를 거부하는 테스트 추가"
    }
  ]
}
```

이 구조의 목적은 critic의 문장을 곧바로 실행하지 않게 하는 것이다. revision 단계는 finding을 입력으로 받되 원본 요구사항과 실제 파일을 다시 확인해야 한다. 근거가 없는 지적은 수정으로 이어지지 않아야 한다.

critic에게 primary의 모든 내부 메시지와 credential을 넘기지 않는 것도 중요하다. 검토에 필요한 최소 정보만 전달해야 격리가 유지된다. isolated review는 HydraFusion이 밝힌 운영 원칙 중 하나다.[3]

## fail-safe patch application: 생성과 적용을 분리한다

멀티모델 코드 작업에서 가장 위험한 지점은 모델이 patch를 만드는 순간이 아니라 그 patch가 실제 작업 공간에 적용되는 순간이다. Critique나 escalation 결과를 자동 적용하려면 생성, 검증, 적용을 별도 단계로 나눠야 한다.

안전한 흐름은 다음과 같다.

1. primary가 격리된 작업 공간에서 candidate patch를 만든다.
2. critic은 snapshot과 diff를 읽기 전용으로 검토한다.
3. revision은 새 patch를 만들되 원본 작업 공간에 직접 쓰지 않는다.
4. patch parser가 허용 경로, 파일 수, diff 크기를 검사한다.
5. 별도 임시 worktree에 patch를 적용한다.
6. syntax check, unit test, 정책 검사를 실행한다.
7. base revision이 여전히 같은지 확인한다.
8. 모든 검사를 통과할 때만 목표 worktree에 원자적으로 적용한다.
9. 적용 후 exact diff와 테스트 결과를 다시 기록한다.

중간 단계가 실패하면 기존 결과를 보존하는 fail-safe 동작이 필요하다. patch 일부만 적용한 채 종료하면 안 된다. 충돌을 무시하고 fuzzy apply를 강행하는 것도 피해야 한다. base commit이나 파일 hash가 달라졌다면 새 상태에서 다시 생성하거나 사람에게 넘겨야 한다.

적용 정책은 작업 위험도에 따라 달라질 수 있다.

- 문서와 테스트 fixture: 자동 적용 후 검사
- 일반 애플리케이션 코드: 임시 worktree 검증 후 적용
- migration, IAM, 결제, 배포 설정: 사람 승인 필수
- 데이터 삭제 또는 외부 write: 자동 적용 금지

fail-safe application은 HydraFusion이 언급한 운영 원칙에도 포함된다.[3] 핵심은 모델이 수정안을 냈다는 이유만으로 현재 상태를 덮어쓰지 않는 것이다.

## observability: 모델 이름보다 의사결정 경로를 남긴다

멀티모델 시스템의 로그에 `model=A`, `model=B`만 남으면 장애 원인을 찾기 어렵다. 어떤 라우팅 규칙이 적용되었고, 게이트가 어떤 신호로 통과시켰으며, critic의 어떤 finding이 revision에 반영되었는지 연결해야 한다.

하나의 trace에는 다음 span이 필요하다.

```text
request.accept
route.select
model.draft
quality_gate.evaluate
model.escalate 또는 critic.review
model.revise
patch.validate
workflow.verify
result.apply
```

각 span에는 최소한 다음 속성을 남긴다.

- trace ID, workflow ID, attempt ID
- router와 prompt 버전
- 모델과 provider 식별자
- 입력 및 출력 token 수
- cache 상태
- 시작 시각, TTFT, 완료 시각
- timeout과 cancel 결과
- gate score와 사용한 신호
- escalation 이유
- critic verdict와 finding 개수
- patch 범위와 validator 결과
- 최종 성공 조건
- 단계별 추정 비용

원문 prompt와 코드 전체를 무조건 로그에 저장하는 것은 위험하다. 개인정보, 시크릿, 사내 코드가 포함될 수 있다. 기본 로그는 메타데이터와 hash 중심으로 설계하고, 재현에 필요한 payload는 접근 통제와 보존 기간을 별도로 둔다.

대시보드는 모델별 성공률만 보여주지 말고 경로별 결과를 비교해야 한다.

- Single 성공률과 비용
- Cascade pass 경로 성공률
- Cascade escalation 비율과 복구율
- gate false pass 추정치
- Critique가 발견한 실제 결함 비율
- revision으로 새 결함이 생긴 비율
- 동시 실패율
- p50/p95/p99 end-to-end latency
- timeout 뒤 늦은 응답 비율
- fallback 성공률과 품질 차이
- 성공 작업당 전체 비용

알림도 단순 provider 오류율 외에 의미적 회귀를 잡아야 한다. 예를 들어 escalation 비율이 갑자기 5%에서 40%로 늘면 draft model 품질, gate threshold, 입력 분포 중 하나가 변했을 수 있다. 반대로 escalation 비율이 급감하면서 사용자 재시도가 늘면 게이트가 결함을 통과시키고 있을 가능성이 있다.

## HydraFusion 수치는 구매 결론이 아니라 실험 가설이다

GitHub는 vendor-controlled offline 평가에서 TerminalBench 2.1은 Opus 5 대비 품질이 4.9 point 높고 추정 비용이 67% 낮았으며, DeepSWE는 품질이 1.5 point 낮고 비용이 36% 낮았고, CheckpointBench는 품질이 0.1 point 낮고 비용이 65% 낮았다고 보고했다.[3] 이 수치는 GitHub가 통제한 offline claim이며 독립 재현 결과나 일반적인 production 보장이 아니다.[3]

GitHub 역시 결과의 적용 범위를 평가한 benchmark revision, configuration, model pool, pricing assumption, medium reasoning level로 명시적으로 제한했다.[3] 따라서 “멀티모델이면 67% 절감된다”라고 일반화하면 안 된다. benchmark마다 품질과 비용의 교환 관계가 달랐다는 점 자체가 workload 의존성을 보여준다.

또한 이 preview는 첫 턴의 단일 prompt로 수행하는 substantial coding task를 우선 권장하며, 이름, 모델, workflow, behavior가 변경될 수 있다고 밝힌 research preview다.[3] 대화가 길고 도구 상태가 누적되는 운영 에이전트, 짧은 실시간 요청, 비코딩 업무에 같은 결과를 기대해서는 안 된다.

이 수치를 활용하는 올바른 방법은 내부 실험의 가설로 바꾸는 것이다.

- 우리 substantial coding task에서도 성공당 비용이 줄어드는가?
- 품질 손실이 허용 범위 안에 있는가?
- offline 성공이 실제 repository와 CI에서도 재현되는가?
- escalation과 critique가 p95 latency를 얼마나 늘리는가?
- 사람 리뷰 시간과 rollback이 실제로 감소하는가?

공급업체 수치는 후보 구성을 고르는 데 쓸 수 있다. 도입 결정은 우리 trace, 우리 가격 계약, 우리 실패 비용으로 내려야 한다.

## benchmark는 라우터와 전체 workflow를 함께 평가한다

멀티모델 평가에서 각 모델의 단독 점수만 비교하면 라우팅 시스템을 평가할 수 없다. 라우터가 쉬운 문제와 어려운 문제를 어떻게 나누는지, 게이트가 결함을 얼마나 놓치는지, critic이 유효한 결함을 찾는지, revision이 실제로 개선하는지 단계별로 측정해야 한다.

### 1. 평가 단위를 실제 작업으로 만든다

prompt 하나의 정답 여부보다 repository 상태 변화와 검증 결과를 평가 단위로 삼는다. 각 사례에는 다음이 있어야 한다.

- 고정된 시작 commit 또는 snapshot
- 명시적인 사용자 요구사항
- 허용된 도구와 권한
- 시간과 비용 예산
- 기대 파일 범위
- 실행 가능한 테스트
- 금지된 부작용
- 사람 평가가 필요한 rubric

### 2. 난이도와 위험도를 분리해 층화한다

입력 길이나 diff 크기만으로 난이도를 정의하지 않는다. 익숙한 반복 수정, 모호한 요구사항, cross-file reasoning, flaky test, 오래된 문서, 권한 부족처럼 실패 유형을 포함한다. 위험도도 read-only, local write, external write로 나눈다.

### 3. 동일 조건의 기준선을 만든다

최소한 다음 구성을 비교한다.

- 저비용 모델 Single
- 고품질 모델 Single
- Cascade
- Critique
- Cascade 뒤 선택적 Critique

각 구성은 같은 task set, 도구 버전, reasoning budget, timeout, cache 조건에서 실행해야 한다. 그렇지 않으면 orchestration 효과와 설정 차이가 섞인다.

### 4. 게이트 자체의 confusion matrix를 기록한다

초안이 실제로 충분했는지 독립 validator 또는 blinded human review로 라벨링한다. 그 뒤 게이트의 pass/escalate 판정과 비교한다. 전체 정확도보다 false pass를 위험 등급별로 본다.

### 5. critique의 순효과를 잰다

critic finding 개수는 품질 지표가 아니다. 다음 세 상태를 비교해야 한다.

- revision 전 candidate 품질
- critic finding의 정확성
- revision 후 최종 품질

revision이 기존 정답을 훼손하거나 새 결함을 넣는 비율도 기록한다. “critic이 무언가 말했다”가 아니라 “검증된 최종 품질이 개선되었다”가 성공 조건이다.

### 6. 장애를 주입한다

정상 호출만 평가하면 운영 준비도를 알 수 없다. 다음 조건을 별도 실험한다.

- draft provider timeout
- gate 응답 schema 오류
- critic rate limit
- cancel 확인 실패
- 늦게 도착한 이전 attempt 결과
- fallback 모델의 형식 차이
- 테스트 도구의 일시적 실패
- base branch가 중간에 변경된 patch conflict

각 장애에서 중복 write, 부분 patch, 무한 retry, 예산 초과가 없는지 확인한다.

### 7. 통계와 비용을 함께 보고한다

task 성공률만 보고하지 않는다. bootstrap confidence interval이나 반복 실행 분산을 확인하고, p50/p95 latency, 성공당 비용, 사람 개입률을 함께 제시한다. 라우팅 규칙을 조정한 데이터와 최종 평가 데이터도 분리해야 한다. 같은 benchmark에 threshold를 맞추고 같은 세트에서 성능을 보고하면 과적합을 숨길 수 있다.

GitHub가 말하는 validated routing은 실행 전에 workflow definition, model binding, fallback behavior와 model availability를 검증하는 원칙이다.[3] 여기에 더해 운영팀은 라우팅의 실제 효과를 holdout task와 production shadow traffic에서 별도로 검증해야 한다.

## rollout은 shadow, 제한된 write, 단계적 확대 순서가 안전하다

멀티모델 경로를 한 번에 기본값으로 바꾸지 않는다. 모델 품질뿐 아니라 provider quota, tail latency, 로그 크기, cancel 동작, 비용 추정까지 production traffic에서 달라질 수 있다.

권장 rollout 순서는 다음과 같다.

### 0단계: Single 기준선 고정

현재 production 경로의 성공률, 비용, 지연시간, 사람 개입률을 기록한다. prompt, tool, validator 버전을 고정해 비교 가능하게 만든다.

### 1단계: offline replay

민감 정보를 정리한 실제 trace를 Single, Cascade, Critique로 재생한다. 기존 production 결과와 비교하고 gate threshold를 조정한다.

### 2단계: shadow routing

사용자에게는 기존 Single 결과만 제공하되 멀티모델 경로를 그림자로 실행한다. 두 결과의 품질과 비용을 비교한다. shadow 호출도 실제 비용과 provider quota를 쓰므로 예산을 둔다.

### 3단계: read-only workload canary

요약, 분석, 코드 리뷰처럼 외부 write가 없는 작업의 작은 비율에 적용한다. false pass와 critic 오판을 집중 관찰한다.

### 4단계: 제한된 patch workflow

임시 worktree와 검증 gate가 있는 코드 변경에만 허용한다. 자동 merge나 배포는 연결하지 않는다. 사람 승인과 exact diff 확인을 유지한다.

### 5단계: 위험도별 확대

repository, 팀, task type 단위로 트래픽을 늘린다. 비율만 늘리지 말고 각 cohort의 실패 패턴을 확인한다. 고위험 write는 별도 승인 정책을 유지한다.

## rollout 체크리스트

배포 전에는 다음 질문에 모두 답할 수 있어야 한다.

### 라우팅과 품질

- [ ] Single 기준선의 성공률, p95 지연, 성공당 비용이 기록되어 있는가?
- [ ] Cascade의 pass와 escalation 성공률을 분리해 보는가?
- [ ] 품질 게이트의 false pass를 위험 등급별로 측정했는가?
- [ ] gate threshold를 조정한 세트와 최종 평가 세트를 분리했는가?
- [ ] critic finding의 정확성과 revision의 순개선율을 측정했는가?
- [ ] 모델 간 correlated failure를 오류 유형별로 분석했는가?

### 실행 경계

- [ ] critic에 쓰기 credential과 쓰기 도구가 없는가?
- [ ] repository snapshot이 read-only로 mount되는가?
- [ ] patch 생성과 적용이 분리되어 있는가?
- [ ] 임시 worktree에서 테스트한 뒤에만 적용하는가?
- [ ] base revision 변경과 stale result를 거부하는가?
- [ ] 외부 write에는 idempotency와 승인 정책이 있는가?

### 시간과 비용

- [ ] 전체 workflow deadline이 각 단계로 전달되는가?
- [ ] 단계별 timeout의 합이 SLA를 무한히 늘리지 않는가?
- [ ] cancel 확인 실패 상태를 별도로 다루는가?
- [ ] retry, escalation, critique 횟수에 상한이 있는가?
- [ ] token 외에 도구, 샌드박스, 사람 비용을 포함하는가?
- [ ] 평균뿐 아니라 p95와 p99 비용 및 지연을 보는가?

### fallback과 장애

- [ ] provider, model, Single 축소 경로의 우선순위가 정해졌는가?
- [ ] fallback 결과에도 동일한 validator가 적용되는가?
- [ ] 늦게 온 취소 attempt가 결과를 덮어쓰지 못하는가?
- [ ] timeout, rate limit, schema 오류, patch conflict를 주입해 보았는가?
- [ ] 모든 fallback이 실패했을 때 정직한 실패 상태를 반환하는가?

### 관측성과 개인정보

- [ ] 하나의 trace로 draft부터 apply까지 연결되는가?
- [ ] router, prompt, model, validator 버전을 남기는가?
- [ ] escalation 이유와 gate 신호를 재현할 수 있는가?
- [ ] 원문 prompt와 코드 로그에 접근 통제와 보존 정책이 있는가?
- [ ] 품질 회귀와 비용 회귀에 별도 alert가 있는가?

## rollback은 모델 교체보다 상태 복구가 중요하다

멀티모델 rollout이 실패했을 때 feature flag를 끄는 것만으로 충분하지 않을 수 있다. 이미 적용된 patch, 진행 중인 attempt, 늦게 도착할 provider 응답이 남아 있기 때문이다.

rollback 절차는 제어 경로와 데이터 경로를 함께 다뤄야 한다.

1. 새 요청의 Cascade와 Critique 진입을 즉시 차단한다.
2. 기존 요청은 상태별로 drain 또는 cancel한다.
3. cancel 미확인 attempt의 결과 적용 권한을 폐기한다.
4. Single 기준선 경로로 트래픽을 전환한다.
5. rollout 기간에 적용된 변경을 trace ID와 commit으로 식별한다.
6. 검증 실패 변경은 일반 배포 rollback 절차로 되돌린다.
7. router와 prompt 버전을 이전의 검증된 조합으로 고정한다.
8. 비용, 품질, latency가 기준선으로 회복되었는지 확인한다.

## rollback 체크리스트

- [ ] 모든 멀티모델 경로를 독립 feature flag로 끌 수 있는가?
- [ ] Single 경로가 멀티모델 서비스 장애와 독립적으로 동작하는가?
- [ ] 진행 중 요청을 조회하고 상태별로 중단할 수 있는가?
- [ ] stale generation의 patch apply를 중앙에서 거부할 수 있는가?
- [ ] rollout 버전이 만든 commit과 외부 write를 추적할 수 있는가?
- [ ] 자동 적용된 patch를 원자적으로 revert할 방법이 있는가?
- [ ] provider별 quota와 queue가 정상화되었는지 확인하는가?
- [ ] rollback 뒤 성공률, p95 지연, 비용을 기준선과 비교하는가?
- [ ] 원인을 분류하기 전 자동 재활성화를 막는가?
- [ ] 재배포 전에 실패 사례를 regression set에 추가하는가?

rollback 기준도 사전에 수치화해야 한다. 예를 들어 high-risk false pass 한 건, 성공률의 일정 폭 하락, p95 latency의 SLA 초과, 성공당 비용의 예산 초과처럼 즉시 중단 조건을 정한다. 기준이 없으면 장애 중에 품질과 비용을 두고 논쟁하느라 대응이 늦어진다.

## 어떤 패턴을 언제 선택할 것인가

세 패턴은 서열이 아니라 작업 특성에 따른 선택지다.

### Single이 적합한 경우

- 요청이 짧고 실패 비용이 낮다.
- 하나의 강한 모델로 이미 목표 품질을 만족한다.
- 지연시간이 최우선이다.
- 검증 가능한 신호가 부족해 게이트 오판을 측정하기 어렵다.
- 멀티모델 계층의 운영 복잡도가 절감액보다 크다.

### Cascade가 적합한 경우

- 쉬운 요청이 충분히 많다.
- 어려운 요청을 구분하는 강한 신호가 있다.
- escalation의 추가 지연을 허용할 수 있다.
- 잘못된 통과를 validator가 막을 수 있다.
- 비용 분포의 긴 꼬리를 줄일 필요가 있다.

### Critique가 적합한 경우

- 요구사항 누락이나 검토 가능한 결함이 주요 실패 유형이다.
- 초안과 다른 관점의 모델을 사용할 수 있다.
- critic을 기술적으로 read-only로 격리할 수 있다.
- revision 이후 실행 가능한 검증이 있다.
- 한 번의 추가 검토가 사람 리뷰 또는 rollback을 줄일 가능성이 크다.

### Cascade 뒤 선택적 Critique가 적합한 경우

- 고위험 작업만 이중 방어가 필요하다.
- gate는 난이도를 판정하고 critic은 결함을 찾는 식으로 역할을 분리할 수 있다.
- 전체 deadline과 호출 예산이 충분하다.
- 각 단계의 순효과를 별도로 관측할 수 있다.

마지막 조합이 가장 복잡하므로 처음부터 선택하지 않는 편이 낫다. Single 기준선을 만들고, Cascade 또는 Critique 하나만 추가해 효과를 증명한 뒤 결합해야 한다. 복잡한 라우터는 성능을 높일 수 있지만 실패 원인과 책임 경계를 흐리기도 한다.

## 결론

멀티모델 오케스트레이션의 가치는 모델을 많이 호출하는 데 있지 않다. 쉬운 작업은 짧게 끝내고, 어려운 작업은 정확히 승격하며, 다른 관점의 검토가 실제 결함을 줄이고, 실패한 결과는 적용 전에 멈추게 하는 데 있다.

Single은 기준선과 축소 경로다. Cascade는 작은 모델보다 품질 게이트의 분류 성능이 핵심이다. Critique는 두 번째 모델의 권위보다 read-only 격리와 fail-safe patch application이 핵심이다. 어느 패턴이든 correlated failure, tail latency, 전체 workflow cost를 측정하지 않으면 평균 점수와 token 단가가 운영 현실을 가린다.

GitHub의 HydraFusion 결과는 특정 benchmark revision, 구성, model pool, 가격 가정과 medium reasoning level에서 나온 vendor-controlled offline claim으로만 읽어야 한다.[3] preview가 제시한 complete accounting, bounded execution, isolated review, fail-safe application, validated routing이라는 원칙은 유용하지만, 실제 효과는 각 팀의 workload에서 다시 검증해야 한다.[3]

도입 순서는 단순하다. Single을 측정하고, 하나의 패턴을 shadow로 붙이고, read-only 작업부터 canary를 열고, patch 적용 경계를 검증한 뒤 단계적으로 확대한다. 동시에 timeout, cancel, fallback을 상태 머신으로 만들고 언제든 Single로 rollback할 수 있어야 한다.

좋은 멀티모델 시스템은 언제 더 강한 모델을 부를지 아는 시스템만이 아니다. 추가 호출이 도움이 되지 않는 순간을 알고, 틀린 검토를 거부하며, 실패한 수정이 실제 상태에 닿기 전에 멈추는 시스템이다.

## Sources

[3] https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration — Project HydraFusion: Frontier quality via multi-model orchestration
