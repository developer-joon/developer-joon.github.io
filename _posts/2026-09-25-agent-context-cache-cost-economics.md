---
title: '에이전트 Prompt Caching 비용 최적화: Prefix·TTL·Invalidation'
date: 2026-09-25 08:10:00 +0900
categories: ["AI 에이전트"]
description: '장시간 에이전트의 cache read·write 비용과 prefix 안정성, TTL, 무효화를 성공 작업당 비용 기준으로 최적화한다.'
featured_image: 'https://picsum.photos/seed/agent-context-cache-cost-economics/1600/900'
tags: [ai-agent, context-cache, prompt-caching, agentops, llmops, observability, cost-optimization]
---

![에이전트 Context Cache 운영 경제학](https://picsum.photos/seed/agent-context-cache-cost-economics/1600/900)

에이전트 비용을 줄이겠다는 회의는 자주 모델 단가표에서 시작한다. 더 싼 모델을 어디에 넣을지, 어떤 요청을 상위 모델로 보낼지, reasoning 강도를 얼마나 낮출지를 논의한다. 그러나 장시간 실행되는 코딩 에이전트에서는 같은 저장소 설명, 도구 정의, 정책, 대화 이력, 이전 diff와 테스트 결과가 매 턴 입력으로 다시 들어간다. 이 반복 prefix가 수만 토큰이라면 모델을 바꾸지 않아도 캐시가 비용 곡선을 크게 바꾼다. 반대로 prefix가 조금씩 흔들리면 할인 단가를 지원하는 모델을 써도 매번 cache write 또는 일반 입력 비용을 낸다.

문제는 “prompt caching을 켰는가”가 아니다. 다음 요청이 **같은 prefix로 인식되도록 입력을 운영하는가**, TTL 안에 재사용되는가, 의미가 바뀐 정보는 안전하게 무효화되는가, 그리고 절감액이 검증된 성공 작업 수를 기준으로도 남는가가 핵심이다.

이 글은 모델 선택이나 멀티모델 라우팅을 다루지 않는다. 대신 하나의 에이전트 실행 경로 안에서 cache read와 write를 비용 원장에 넣고, TTL과 cache key 안정성을 설계하며, 긴 코딩 세션의 prefix를 계층화하는 방법을 다룬다. 마지막에는 히트율이 좋아 보이는데도 청구액이 줄지 않는 이유와 성공 작업당 비용을 측정하는 실무 기준을 제시한다.

> 이 글의 공급업체 동작과 가격 수치는 2026년 9월 25일 공식 문서를 확인한 기준이다. 가격, 지원 모델, 최소 cacheable token, TTL 정책은 바뀔 수 있으므로 실제 도입 시 링크된 최신 문서를 다시 확인해야 한다.

## Context cache는 응답 캐시가 아니라 prefix 계산 캐시다

context cache를 HTTP response cache처럼 생각하면 설계가 어긋난다. 같은 질문에 같은 답을 반환하는 캐시가 아니다. 모델이 긴 입력 prefix를 처리하며 만든 중간 상태를 재사용하고, 그 뒤에 붙은 새로운 suffix는 다시 처리해 새 출력을 생성한다.

따라서 캐시 가능 단위는 대략 다음과 같이 보아야 한다.

```text
request_t = stable_prefix + growing_history_t + volatile_suffix_t

stable_prefix:
  도구 schema, 핵심 system instruction, 저장소 공통 규칙

growing_history_t:
  이전 사용자/assistant 메시지, tool use와 tool result

volatile_suffix_t:
  이번 작업 상태, 최신 파일 내용, 현재 테스트 결과, 새 사용자 입력
```

OpenAI 공식 문서는 prompt cache가 OpenAI가 제공한 instruction, developer message, tool definition, text·image·document·지원 audio를 포함한 렌더링된 전체 context의 prefix를 대상으로 하며, 재사용하려면 해당 prefix 전체가 일치해야 한다고 설명한다.[3] Anthropic도 `tools → system → messages` 순서의 전체 prefix를 기준으로 cache breakpoint까지를 캐시한다고 명시한다.[1]

이 구조가 뜻하는 바는 단순하다. 뒤쪽의 사용자 질문이 달라지는 것은 정상이다. 하지만 앞쪽의 tool definition 순서, system prompt 안의 시각 문자열, 저장소 목록의 정렬 순서가 바뀌면 그 이후의 긴 대화 이력까지 재사용하지 못할 수 있다. 캐시 최적화는 문장을 짧게 만드는 일보다 **변하지 않아야 할 앞부분을 실제로 변하지 않게 만드는 일**에 가깝다.

## 비용 원장을 cache read, cache write, uncached input으로 분해한다

캐시를 켠 뒤 `input_tokens` 하나만 저장하면 비용을 설명할 수 없다. 호출별 입력은 최소 세 구간으로 나눠야 한다.

```text
I_total = I_read + I_write + I_uncached
```

- `I_read`: 기존 cache entry에서 읽은 입력 토큰
- `I_write`: 새 entry로 기록한 입력 토큰
- `I_uncached`: 캐시 대상이 아니거나 breakpoint 뒤에서 일반 처리된 입력 토큰

Anthropic 응답의 `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`는 이 세 구간을 각각 관측하는 필드이며, 세 값을 합해야 전체 입력 토큰이 된다.[1] OpenAI는 usage의 cached token 세부 정보를 통해 읽힌 토큰을 보고하며, 지원 모델과 세대에 따라 cache write 요금 및 retention 방식이 다르다.[3]

호출 한 번의 모델 비용을 다음처럼 적을 수 있다.

```text
C_call = (I_read × P_read)
       + (I_write × P_write)
       + (I_uncached × P_input)
       + (O × P_output)
```

여기서 `P_read`, `P_write`, `P_input`, `P_output`은 해당 호출 시점의 모델, API 경로, 지역, 계약에 적용된 실제 단가다. 할인율만 하드코딩하지 말고 청구서와 맞는 price table version을 trace에 남겨야 한다.

Anthropic 공식 가격표에서 일반적인 prompt caching 배수는 5분 cache write가 기본 입력의 1.25배, 1시간 write가 2배, cache read가 0.1배다. 다만 문서에 별도 예외가 있는 모델도 있고, Batch나 data residency 같은 다른 가격 modifier가 중첩될 수 있다.[2] OpenAI의 2026년 9월 문서에서 GPT-5.6 이상은 uncached input 대비 cache write 1.25배, cache read 0.1배로 설명되지만, 이전 모델은 추가 write 비용이 없고 cached-input 단가가 모델별로 다르다고 구분한다.[3]

즉 `cache_hit=true`만으로 비용을 계산할 수 없다. 한 요청 안에서도 오래된 prefix는 read, 새로 늘어난 history는 write, 최신 suffix는 uncached input이 될 수 있다.

## Cache write는 공짜 준비 단계가 아니다

첫 요청은 캐시를 “만드는” 요청이다. 이후 읽기가 없다면 write premium만 지불하고 끝난다. 캐시 도입 효과는 entry 생성 수가 아니라 entry당 후속 read 수에 달려 있다.

prefix 길이를 `P`, 같은 prefix를 쓰는 요청 수를 `N`, 기본 입력 단가를 1로 정규화해 보자. suffix와 출력은 비교에서 제외한다.

Anthropic의 일반적인 5분 가격 배수를 적용하면:

```text
캐시 없음      = N × P
5분 캐시 사용  = 1.25P + (N - 1) × 0.1P
```

절감이 발생하는 조건은 다음과 같다.

```text
1.25P + (N - 1) × 0.1P < NP
N > 1.277...
```

정수 요청으로는 최초 write 뒤 한 번만 제대로 읽어도, 즉 같은 prefix를 두 요청이 사용하면 입력 비용이 캐시 미사용보다 낮아진다. 1시간 write의 배수를 2로 두면 손익분기 조건은 `N > 2.111...`이므로 최초 write 뒤 두 번의 read, 총 세 요청이 필요하다. 이는 Anthropic 공식 가격 배수로 계산한 결과다.[2]

하지만 이 계산은 TTL 안에서 exact prefix match가 일어나고, entry가 실제로 남아 있으며, 가격 modifier가 같다는 가정이다. 운영에서는 miss 확률을 넣어야 한다.

```text
E[C_prefix] = P × {
    E[N_write] × write_multiplier
  + E[N_read] × read_multiplier
  + E[N_uncached] × 1
}
```

TTL 만료나 prefix churn으로 `E[N_write]`가 커지면 캐시는 절감 장치가 아니라 write premium 발생 장치가 된다. 확률 기반의 요청당 식을 사용한다면 write·read·uncached 항을 모두 요청당 확률로 통일해야 한다.

## TTL은 설정값이 아니라 요청 간격의 분포다

TTL 선택을 “5분은 짧고 1시간은 안전하다”로 끝내면 비용을 예측할 수 없다. 필요한 데이터는 평균 세션 길이가 아니라 같은 cacheable prefix를 사용하는 연속 요청 사이의 간격 분포다.

Anthropic의 기본 cache lifetime은 5분이며, 같은 cached content가 사용되면 추가 write 비용 없이 갱신된다. TTL은 응답 종료가 아니라 write 또는 read 요청의 시작 시점부터 측정되므로, 응답 생성에 4분이 걸렸다면 응답이 끝난 뒤 사실상 약 1분 안에 후속 요청이 시작되어야 5분 entry를 재사용할 수 있다는 예시도 공식 문서에 명시되어 있다.[1] 1시간 TTL은 더 높은 write 비용으로 선택할 수 있다.[1][2]

OpenAI는 모델 세대에 따라 retention이 다르다. 2026년 9월 공식 문서 기준 GPT-5.6 이상은 `prompt_cache_options.ttl`로 `30m`을 사용하며 최신 write 또는 reuse 뒤 최소 30분 lifetime을 설명한다. GPT-5.5 계열과 그 이전 지원 모델은 `prompt_cache_retention`과 in-memory 또는 최대 24시간 정책 등 서로 다른 동작을 가진다.[3] 그러므로 “OpenAI cache TTL”이라는 단일 상수를 코드에 넣으면 안 된다.

운영 데이터에서는 다음 bucket을 직접 계산한다.

```text
Δt = next_request_started_at - previous_cache_write_or_read_started_at

bucket:
  0~1분
  1~5분
  5~30분
  30~60분
  1~24시간
  24시간 초과
```

긴 코딩 에이전트는 모델 호출 사이에 테스트, 빌드, dependency install, 사람 승인 대기가 들어간다. 모델 응답은 빨라도 `pytest`가 12분 걸리면 5분 cache는 식는다. 이 경우 TTL 문제를 모델 latency만 보고 진단하면 안 된다. tool span을 포함한 실제 inter-request gap을 보아야 한다.

### TTL 선택은 cohort별로 한다

하나의 제품에서도 cadence가 다르다.

- 짧은 대화형 수정: 수초에서 수분 간격으로 연속 호출
- 대규모 테스트가 있는 코딩 작업: 5~30분 간격
- 사람 승인을 기다리는 작업: 수십 분에서 수시간 간격
- 야간 batch: 작업 내부 호출은 촘촘하지만 다음 작업과는 멀리 떨어짐

전체 평균에 맞춘 TTL은 어느 cohort에도 맞지 않을 수 있다. repository 크기, task type, 도구 실행 시간, human-in-the-loop 여부로 나누고 각 cohort의 TTL survival rate를 측정한다.

```text
TTL_survival_rate(T) =
  TTL 안에 다음 cache-eligible 요청이 시작된 prefix 수
  / 후속 요청 가능성이 있었던 prefix 수
```

1시간 TTL의 write premium은 “혹시 모르니” 지불하는 보험이 아니다. 5분을 넘지만 1시간 안에 돌아오는 read가 실제로 몇 번 발생하는지로 결정해야 한다.

## Cache key 안정성은 문자열 정규화보다 구조의 안정성이다

운영팀이 흔히 `cache_key`라는 말을 들으면 애플리케이션이 임의 문자열을 정해 cache entry를 직접 조회한다고 생각한다. 실제 공급업체 동작은 더 복잡하다. 핵심 identity는 렌더링된 prefix와 모델·설정의 호환성이고, 별도 key는 routing 또는 grouping에 관여할 수 있다.

OpenAI의 `prompt_cache_key` 의미는 모델 세대에 따라 다르다. GPT-5.6 이전 모델에서는 높은 트래픽의 관련 요청을 같은 cache 보유 머신 쪽으로 그룹화해 overflow miss를 줄이는 routing hint로 사용할 수 있다. GPT-5.6 이상에서는 OpenAI가 routing을 자동 처리하므로 cache 최적화에 이 key가 필요하지 않으며, 선택적으로 고객·사용자별 cache accounting을 분리하는 용도다.[3] 어느 경우든 동일 key만 넣는다고 서로 다른 prefix가 같은 entry가 되지는 않는다.

따라서 애플리케이션에서 관리할 것은 두 종류다.

```text
provider_cache_identity:
  공급업체가 실제 prefix match와 compatibility에 사용하는 요소

app_cache_family_id:
  우리가 관측과 cohort 분석에 사용하는 논리적 식별자
```

`app_cache_family_id`는 예를 들어 다음 필드로 만든다.

```text
sha256(
  provider
  + model_snapshot
  + prompt_schema_version
  + tool_registry_version
  + policy_bundle_version
  + repository_context_version
  + retention_mode
)
```

이 ID를 provider가 동일 entry로 쓴다고 가정하면 안 된다. 목적은 같은 논리적 prefix 계열의 hit, write, invalidation을 묶어 보는 것이다. 원문 prompt를 관측 시스템에 남기지 않고도 어떤 변경이 비용 회귀를 만들었는지 추적할 수 있다.

### 결정론적 직렬화가 필요하다

내용이 논리적으로 같아도 bytes나 token sequence가 달라지면 exact prefix match가 깨질 수 있다. 다음 항목을 고정한다.

- tool definition 배열의 순서
- JSON object key 순서와 serializer 버전
- 공백, 줄바꿈, Unicode 정규화 정책
- system/developer message block 분할 방식
- few-shot example 순서
- repository file 목록 정렬 기준
- 빈 optional field의 포함 여부
- image와 document block의 순서
- locale, timezone, timestamp의 위치

특히 tool registry를 매 요청 동적으로 순회해 배열을 만들면 hash map iteration이나 feature flag 평가 순서 때문에 schema 순서가 흔들릴 수 있다. 도구 집합이 같아도 prefix는 달라질 수 있다. registry version별 canonical order를 만들어야 한다.

### 변동값을 prefix 앞에 두지 않는다

다음 값은 대개 cacheable prefix의 앞부분에 두면 안 된다.

- 현재 시각과 날짜
- request ID, trace ID, queue position
- 남은 budget과 deadline
- 임시 working directory 경로
- 매번 달라지는 git status
- 최신 테스트 결과
- nonce와 서명
- 사용자별 실시간 권한 요약

관측용 ID는 API metadata나 trace context로 보내고, 모델이 꼭 읽어야 하는 변동값은 stable breakpoint 뒤의 최신 message에 둔다. “오늘 날짜를 알아야 한다”는 요구가 있어도 50,000-token 정책 bundle 앞에 timestamp를 삽입할 이유는 없다.

## Invalidation은 cache miss와 stale semantics를 함께 다룬다

캐시 무효화에는 두 종류가 있다.

1. **물리적 invalidation**: prefix가 달라져 provider cache hit가 발생하지 않음
2. **의미적 invalidation**: bytes는 같아 hit가 나지만 현실의 정책이나 저장소 상태가 바뀌어 재사용하면 안 됨

첫 번째만 생각하면 안정적인 prefix를 만들 수 있다. 두 번째를 놓치면 오래된 규칙을 싸게 반복하는 시스템이 된다.

Anthropic은 `tools → system → messages` 계층에서 앞선 계층의 변경이 해당 계층과 뒤 계층 cache를 무효화한다고 설명한다.[1] 예를 들어 tool definition을 바꾸면 system과 message cache까지 영향을 받을 수 있다. 이는 cacheable prefix를 계층적으로 설계해야 하는 이유다.

의미적 invalidation은 애플리케이션 책임이다. 저장소의 `AGENTS.md` 내용이 바뀌었는데 prefix에 파일 내용 대신 고정 문구 “현재 AGENTS.md를 따르라”만 있고 모델이 실제 최신 파일을 받지 못한다면 cache hit는 성공해도 작업은 실패할 수 있다.

### Versioned content로 invalidation을 명시한다

안정성을 위해 변경을 숨기지 말고 버전 경계를 고정한다.

```text
policy_bundle_version: 2026-09-17.3
repo_rules_digest: sha256:...
tool_registry_version: tools-v42
prompt_schema_version: coding-agent-v8
workspace_snapshot: git:<commit-sha>
```

중요한 것은 digest 문자열만 모델에게 주는 것이 아니다. 실제 내용과 버전을 함께 prefix에 넣고, 내용이 바뀔 때 version도 바꾼다. 이렇게 하면 의도한 miss를 회귀로 오해하지 않고 `invalidation_reason=repo_rules_changed`로 설명할 수 있다.

### Invalidation budget을 둔다

모든 변경을 금지하면 프롬프트와 도구를 개선할 수 없다. 대신 변경 비용을 릴리스 비용에 포함한다.

```text
C_invalidation_release =
  예상 cold cohort 수
  × cohort별 평균 cacheable prefix token
  × 적용 write 또는 uncached 단가
```

system prompt 한 줄을 바꾸는 배포가 수천 개의 warm session을 동시에 cold miss로 만들 수 있다. 트래픽이 큰 경우 prompt version rollout을 canary cohort로 나누고, 새 버전의 warm-up write와 성공률을 관측한 뒤 확대한다.

## Long-running coding agent의 prefix는 세 층으로 설계한다

장시간 실행되는 코딩 에이전트는 대화 이력 전체를 하나의 거대한 cacheable blob으로 취급하기 쉽다. 처음에는 hit가 잘 나지만, tool result가 누적되고 breakpoint 탐색 범위를 벗어나거나 작은 앞부분 변경이 전체 history를 무효화하면 비용이 급증한다.

권장 구조는 “가장 오래 안정적인 것부터, 가장 자주 변하는 것까지” 순서로 배치하는 것이다.

```text
L0: platform-stable prefix
  - core safety policy
  - canonical tool schemas
  - 공통 출력 계약
  - agent runtime protocol

L1: task-family / repository-stable prefix
  - 저장소 규칙
  - build/test 명령
  - architecture summary
  - 허용/금지 경로
  - task acceptance criteria

L2: growing conversation history
  - 사용자 요청
  - 계획과 결정
  - tool calls와 압축된 결과
  - 검증 결과의 요약

volatile tail
  - 현재 turn 목표
  - 최신 diff
  - 직전 명령의 상세 출력
  - 남은 시간과 budget
```

L0와 L1 사이, L1과 L2 사이의 경계를 추적하면 어느 층이 miss를 만들었는지 알 수 있다. 공급업체가 explicit breakpoint를 지원하는 범위와 lookback 규칙은 다르므로 같은 논리 구조를 API별 adapter가 실제 request 형식으로 변환해야 한다.

Anthropic의 explicit caching은 최대 4개 breakpoint를 정의할 수 있고, 각 breakpoint에서 뒤로 최대 20개 block 위치를 탐색한다. 이전 요청이 실제로 쓴 entry만 찾으며, 안정적인 내용이 보인다고 자동으로 과거 위치에 entry를 만드는 것은 아니다.[1] 따라서 한 turn에서 수많은 block을 추가하는 agent라면 이전 write 지점이 20-block lookback 밖으로 밀려나기 전에 보조 breakpoint를 설계해야 한다.[1]

OpenAI의 2026년 9월 문서는 GPT-5.6 이상에서 explicit mode와 implicit mode의 breakpoint 탐색 범위를 구분하고, explicit breakpoint 및 이전 message ending을 제한된 범위에서 역탐색한다고 설명한다.[3] 이 숫자는 모델 세대별 계약이므로 provider adapter의 capability table로 관리해야 한다.

### Tool output 원문을 영구 history로 끌고 가지 않는다

코딩 agent의 context가 커지는 가장 흔한 이유는 큰 tool output이다.

- 전체 test log
- 수천 줄의 compiler error
- dependency tree
- 전체 파일 내용의 반복
- `git diff`의 여러 복사본
- 검색 결과 원문

이 결과가 이후 추론에 필요하더라도 매 턴 원문 전체가 필요한 것은 아니다. durable summary와 retrievable artifact를 분리한다.

```text
durable history:
  command, exit code, 핵심 오류, 관련 파일/라인, artifact digest

external artifact store:
  전체 stdout/stderr, 원본 diff, coverage report
```

필요할 때만 artifact를 다시 읽는다. 이렇게 하면 growing prefix의 토큰 증가율과 매 turn write 크기를 낮출 수 있다. 단, 요약으로 acceptance evidence를 잃으면 성공률이 떨어진다. 테스트 실패의 핵심 stack trace와 재현 명령처럼 다음 결정에 필요한 증거는 남겨야 한다.

### Compaction은 cache reset 이벤트로 취급한다

대화 압축은 token을 줄이지만 prefix를 다시 쓴다. compaction 직후 write spike가 발생할 수 있으므로 “context window 절약”만 보고 실행하면 안 된다.

compaction 판단식은 다음처럼 둘 수 있다.

```text
예상 미압축 비용 = 남은 turn 수 × 증가하는 read/write 비용
예상 압축 비용   = compaction 호출 비용
                 + 새 compacted prefix write 비용
                 + 정보 손실로 인한 재시도 기대비용
```

새 요약 prefix가 이후 충분히 재사용될 때만 경제적이다. 세션 종료 직전에 압축하면 write를 한 번 더 만들고 read 없이 끝날 수 있다.

## 히트율이 높아도 돈을 아끼지 못하는 여섯 가지 경우

대시보드의 `cache hit rate = 90%`는 좋은 소식처럼 보인다. 그러나 어떤 분모와 가중치를 썼는지 모르면 의미가 없다.

### 1. 요청 히트율이 token 히트율을 숨긴다

100개 요청 중 90개가 1,024-token prefix에 hit하고, 나머지 10개가 100,000-token prefix를 miss하면 request hit rate는 90%다. 비용은 큰 miss 10개가 지배할 수 있다.

```text
request_hit_rate = cache read가 1 token 이상인 요청 수 / eligible 요청 수

token_read_ratio = Σ I_read / Σ(I_read + I_write + I_uncached)
```

두 값을 함께 보고 prefix-size bucket별로 다시 나눠야 한다.

### 2. read가 많지만 write amplification도 크다

대화가 자랄 때 이전 prefix는 읽고 새 history는 계속 쓴다. read token이 커 보여도 매 turn write token이 더 빠르게 증가하면 비용은 줄지 않는다.

```text
write_amplification = Σ I_write / max(Σ I_read, 1)
```

이 값은 단순 cache miss율보다 prefix churn을 빨리 드러낸다. 다만 provider usage semantics가 다르므로 같은 정의를 provider별 raw field에 맞춰 검증해야 한다.

### 3. 작은 prefix만 hit하고 비싼 suffix는 매번 uncached다

공통 system prompt 2,000 token은 잘 읽히지만 매번 최신 repository dump 80,000 token을 suffix로 붙인다면 hit badge는 떠도 절감액은 작다. `matched_prefix_tokens / eligible_prefix_tokens`를 별도로 보아야 한다.

### 4. 입력은 싸졌지만 출력과 도구 비용이 지배한다

캐시는 입력 처리 비용을 줄인다. 장문의 코드 생성 output, web search, sandbox runtime, GPU build, 사람 review 비용까지 자동으로 줄이지 않는다. 전체 workflow에서 입력 비용 비중이 10%라면 입력을 크게 할인해도 성공 작업당 총비용은 조금만 변한다.

### 5. 실패 작업이 cache read를 많이 만든다

무한 수정 loop는 같은 prefix를 잘 재사용한다. cache hit와 read token은 높지만 결국 테스트를 통과하지 못하면 사업적으로는 0개의 성공을 만든다. 히트율을 성공률과 분리해 칭찬하면 실패 loop를 최적화하게 된다.

### 6. Warm benchmark가 production cold start를 숨긴다

같은 prompt를 연속 재생하는 benchmark는 TTL survival과 exact match에 유리하다. production에서는 여러 workspace, 낮은 요청 빈도, prompt version 배포, region 분리와 높은 동시성 때문에 cold miss가 더 많을 수 있다. GPT-5.6 이전 OpenAI 모델에서는 cache가 개별 머신에 있어 같은 prefix와 key 조합의 트래픽이 높아지면 overflow routing으로 효과가 낮아질 수 있다. GPT-5.6 이상에서는 공급자가 routing을 자동 처리한다.[3]

따라서 실험 결과에는 최소한 cold, warm, post-TTL, post-deploy, high-concurrency 조건을 분리해야 한다.

## 관측성: 호출 로그가 아니라 cache lifecycle trace를 만든다

하나의 cache entry가 write되고 여러 요청에서 read된 뒤 TTL 만료나 version 변경으로 사라지는 생애주기를 연결해야 한다. provider가 내부 cache entry ID를 주지 않더라도 논리적 family와 prefix fingerprint로 근사할 수 있다.

각 모델 호출 span에 다음 속성을 남긴다.

```text
trace_id
workflow_id
attempt_id
provider
model_snapshot
api_endpoint
processing_region
prompt_schema_version
tool_registry_version
policy_bundle_version
repo_rules_digest
app_cache_family_id
prefix_fingerprint
breakpoint_layout_version
retention_mode
requested_ttl
cache_read_tokens
cache_write_tokens
uncached_input_tokens
output_tokens
provider_reported_cached_tokens
cache_outcome: read | write | partial | bypass | ineligible
miss_reason
invalidation_reason
previous_cache_event_at
inter_request_gap_ms
price_table_version
estimated_cost_usd
verified_task_outcome
```

원문 prompt와 소스코드를 로그에 복사하는 것은 기본값이 아니어야 한다. fingerprint는 민감한 내용을 복구할 수 없는 방식으로 만들고, 필요하다면 조직별 secret을 사용한 HMAC으로 cross-tenant dictionary attack 위험을 줄인다. payload 보존은 별도 접근 통제와 짧은 retention을 둔다.

### Miss reason을 추정 가능한 범위에서 구조화한다

provider가 모든 miss 원인을 알려주지는 않는다. 그렇더라도 애플리케이션이 아는 사실은 기록할 수 있다.

```text
cold_start
prefix_changed_tools
prefix_changed_system
prefix_changed_repo_context
prompt_version_rollout
ttl_expired_likely
below_minimum_tokens
retention_mode_changed
region_or_workspace_changed
concurrency_overflow_suspected
provider_eviction_or_unknown
cache_bypassed
```

`unknown`을 없애려고 근거 없는 원인을 붙이면 안 된다. `ttl_expired_likely`처럼 추정임을 상태 이름에 남기고, provider-reported fact와 application inference를 분리한다.

## 대시보드에 필요한 지표

### 1. 비용 지표

```text
cache_read_cost     = Σ(I_read × P_read)
cache_write_cost    = Σ(I_write × P_write)
uncached_input_cost = Σ(I_uncached × P_input)
output_cost         = Σ(O × P_output)
```

```text
cache_net_saving =
  가상의 전부 uncached 입력 비용
  - 실제 read/write/uncached 입력 비용
  - cache 운영 오버헤드
```

가상의 비용은 같은 실제 token 수를 standard input 단가로 처리했다고 가정한 counterfactual이다. 모델이나 context가 바뀐 실험과 섞으면 안 된다.

### 2. 재사용 지표

- request hit rate
- token read ratio
- cache write tokens / cache read tokens
- cache family당 read 횟수
- 최초 write 후 read가 한 번도 없는 비율
- prefix-size bucket별 cold miss율
- TTL bucket별 survival rate
- prompt/tool version별 invalidation token
- partial hit의 matched prefix 길이

### 3. 성능 지표

- cache read 여부별 time to first token
- cache read token bucket별 prefill latency
- cold/warm end-to-end latency p50, p95, p99
- tool 실행을 포함한 inter-request gap
- post-TTL 첫 요청의 latency와 비용

cache read가 latency를 줄일 수 있다는 공식 설명은 있어도 실제 절감 폭은 workload와 routing에 따라 다르다.[1][3] 공급업체 마케팅 수치를 SLA로 옮기지 말고 자기 trace에서 측정한다.

### 4. 품질 지표

- 검증된 task success rate
- 성공 전 평균 attempt 수
- stale context로 인한 재작업률
- compaction 후 회귀율
- prompt version별 성공률
- cache outcome별 테스트 통과율
- 사람 개입률과 review minutes

캐시는 품질 중립적인 기능처럼 보이지만 prefix 설계를 바꾸면서 중요한 context를 suffix로 빼거나 요약하면 품질이 달라질 수 있다. 비용 실험과 quality gate를 분리하지 않는다.

## 성공 작업당 비용이 최종 지표다

평균 호출 비용은 agent 제품의 단위 경제학이 아니다. 한 작업이 여러 model call, tool call, retry, sandbox 실행, 사람 승인을 포함하기 때문이다.

```text
C_workflow =
  Σ C_model_call
  + Σ C_tool
  + C_sandbox
  + C_storage_and_observability
  + C_human_review
  + C_failure_recovery
```

검증된 성공 작업당 비용은 cohort 전체의 실패 비용을 포함해야 한다.

```text
Cost_per_verified_success =
  Σ C_workflow_of_all_attempted_tasks
  / count(verified_success)
```

분모의 `verified_success`는 모델의 “완료했습니다” 응답 수가 아니다. 코딩 작업이라면 요구사항 충족, 허용된 diff 범위, 테스트·정적 분석 통과, 금지된 부작용 없음 같은 외부 검증을 통과한 작업 수다.

예를 들어 cache 최적화 전 100개 작업에 100달러를 쓰고 80개가 성공했다면 성공당 비용은 1.25달러다. 최적화 뒤 총비용이 85달러로 줄었지만 context를 과도하게 압축해 성공이 60개로 떨어지면 성공당 비용은 약 1.42달러다. 청구액은 줄었지만 제품 경제성은 악화됐다.

실험에서는 다음 cohort를 동일한 task set과 validator로 비교한다.

```text
A: cache off 또는 cold replay
B: 현재 production cache 정책
C: 새 prefix layout / TTL 정책
```

각 cohort에 대해 아래를 함께 보고한다.

- verified success rate와 신뢰구간
- 성공당 총비용
- 성공당 cache read/write token
- 실패당 낭비 비용
- p50/p95 완료 시간
- 사람 review 시간
- cold와 warm 비중

같은 task를 연속 실행해 B와 C만 warm하게 만들면 공정한 비교가 아니다. 요청 순서를 randomize하고, TTL 조건과 cache priming 여부를 명시한다.

## 계산 예시: 8만 token prefix를 20회 재사용할 때

모델 간 절대 단가 비교가 아니라 cache 동작만 보기 위해 기본 입력 단가를 1로 정규화하자. 각 요청은 동일한 80,000-token prefix와 4,000-token uncached suffix를 가지며 총 20회 호출된다. output과 도구 비용은 두 경우에 같다고 가정해 제외한다.

캐시가 없으면:

```text
20 × (80,000 + 4,000) = 1,680,000 input-price units
```

5분 cache가 첫 요청에서 write되고 뒤 19회 모두 read라면:

```text
80,000 × 1.25        = 100,000  # 최초 write
19 × 80,000 × 0.1    = 152,000  # 후속 read
20 × 4,000            = 80,000  # uncached suffix
합계                  = 332,000
```

이 가정에서 입력 비용은 cache 미사용 대비 약 80.24% 낮다. 1시간 write 배수 2를 적용하면 합계는 392,000으로 약 76.67% 낮다. 이 숫자는 정규화된 산술 예시이지 특정 모델의 견적이 아니다. 실제 금액에는 모델별 단가, cache miss, output, tool, 지역, Batch, 계약 할인이 들어간다.

같은 세션에서 19회 중 절반이 TTL 만료나 prefix churn으로 write가 된다면 결과는 크게 달라진다. 따라서 예산 모델의 입력값은 “20 turns”가 아니라 다음이어야 한다.

```text
N_write, N_read, N_uncached,
각 이벤트의 token 크기,
각 이벤트 당시 price table,
최종 verified outcome
```

## 운영 실험 절차

### 1단계: cache를 바꾸기 전에 원장을 맞춘다

provider usage field와 실제 invoice를 표본 대조한다. streamed response, retry, timeout, cancel 뒤 늦게 끝난 호출도 원장에 들어오는지 확인한다. SDK가 usage field를 누락하거나 이름을 바꾸는 경우를 schema test로 막는다.

### 2단계: prefix fingerprint를 시각화한다

요청 원문을 저장하지 않아도 block별 fingerprint와 token count를 남길 수 있다.

```text
request 17
  tools      hash=A tokens=6,240   changed=no
  system     hash=B tokens=3,110   changed=no
  repo_ctx   hash=C tokens=41,820  changed=yes
  history    hash=D tokens=18,440  growing=yes
  tail              tokens=2,320
```

어느 block부터 달라졌는지 한눈에 보여야 timestamp 하나가 6만 token miss를 만드는 문제를 찾을 수 있다.

### 3단계: cold/warm/post-TTL replay를 분리한다

- cold: 기존 entry가 없다고 가정
- warm: TTL 안에 동일 prefix 재호출
- post-TTL: 의도적으로 TTL 경계를 넘김
- invalidation: tools, system, repo context를 하나씩 변경
- concurrency: 동일 family 요청을 실제 예상 동시성으로 발생

각 조건에서 read/write/uncached token과 latency를 수집한다. 단순 기능 테스트가 아니라 비용 회귀 테스트다.

### 4단계: prefix 변경을 canary한다

prompt schema나 tool registry version을 한 번에 전환하면 cache herd가 발생할 수 있다. 작은 traffic cohort에서 새 prefix를 먼저 write하고, 성공률과 write spike를 본 뒤 확대한다. 구버전과 신버전이 동시에 존재하는 동안 family별 비용을 분리한다.

### 5단계: 성공당 비용으로 승격 여부를 결정한다

cache token ratio가 개선됐다는 이유만으로 rollout하지 않는다. 사전에 정한 quality non-inferiority 조건과 성공당 비용 개선 조건을 모두 통과해야 한다.

```text
rollout 조건 예시:
  verified success rate 하락이 허용 한계 이내
  cost per verified success 개선
  p95 latency 예산 이내
  stale-context incident 증가 없음
  cold-start write spike가 예산 이내
```

숫자 임계값은 예시를 복사하지 말고 조직의 실제 SLA와 실패 비용으로 정한다.

## 실무 체크리스트

- [ ] stable prefix 앞에 timestamp·trace ID·queue 상태를 섞지 않는다.
- [ ] tool 배열과 JSON serialization이 결정론적이고 정책 bundle에 version이 있다.
- [ ] 큰 tool output 원문과 durable summary를 분리한다.
- [ ] compaction을 새 cache write 이벤트로 비용 처리한다.
- [ ] test/build/human wait를 포함한 inter-request gap과 TTL survival을 측정한다.
- [ ] write 후 read가 0회인 entry와 post-TTL rewrite를 추적한다.
- [ ] 정책·저장소·tool version 변경 시 semantic invalidation을 보장한다.
- [ ] read·write·uncached input·output token을 별도 원장으로 보관한다.
- [ ] request hit rate와 token read ratio, write amplification을 함께 본다.
- [ ] price table version과 timeout·retry·cancel 비용을 기록한다.
- [ ] cold·warm·post-TTL을 동일 task set과 validator로 비교한다.
- [ ] 실패 비용을 포함한 verified success당 비용과 p95 완료 시간을 최종 지표로 삼는다.

## 결론

에이전트의 context cache는 API 옵션 하나가 아니라 입력 구조와 실행 cadence를 함께 다루는 운영 시스템이다. 같은 모델과 같은 작업이라도 prefix가 안정적이고 TTL 안에 후속 요청이 오면 긴 context를 낮은 read 단가로 재사용할 수 있다. 반대로 timestamp 하나가 앞에 들어가거나 tool schema 순서가 흔들리거나 테스트 시간이 TTL을 넘으면 매번 write 비용을 내고도 hit를 얻지 못한다.

좋은 설계는 stable prefix, growing history, volatile tail을 분리한다. cache key는 prefix identity를 대신하는 마법 문자열로 취급하지 않고 routing과 관측 목적을 구분한다. invalidation은 miss를 줄이는 문제와 stale semantics를 막는 문제를 동시에 다룬다. long-running coding agent에서는 tool output을 요약 가능한 history와 재조회 가능한 artifact로 나누고, compaction과 prompt 배포를 새로운 write 이벤트로 계산한다.

무엇보다 hit rate 하나를 목표로 삼지 않는다. request hit rate가 아니라 token 크기로 가중한 read와 write를 보고, TTL survival과 invalidation 비용을 추적하며, 실패한 시도와 사람 개입까지 모두 포함한 **검증된 성공 작업당 비용**으로 결론을 내린다.

가장 싼 cache read는 많은 토큰을 할인받은 호출이 아니다. 한 번 쓴 prefix가 충분히 재사용되고, 최신 의미를 유지하며, 결국 검증된 성공으로 끝난 호출이다.

## Sources

[1] https://platform.claude.com/docs/en/build-with-claude/prompt-caching — Anthropic Prompt caching
[2] https://platform.claude.com/docs/en/about-claude/pricing — Anthropic Pricing
[3] https://platform.openai.com/docs/guides/prompt-caching — OpenAI Prompt caching
