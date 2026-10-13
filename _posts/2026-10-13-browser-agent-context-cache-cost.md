---
title: '브라우저 에이전트 비용을 줄인 메커니즘: 캐시 가능한 대화 이력과 배치 정리'
date: 2026-10-13 08:15:00 +0900
categories: ["AI 에이전트"]
description: 'Asana와 StackAI의 144개 계획 run 중 143개 분석을 바탕으로 longest unchanged prefix, screenshot batch pruning, 성공 workflow당 비용과 privacy retention의 교환을 분석한다.'
featured_image: 'https://picsum.photos/seed/browser-agent-context-cache-cost/1600/900'
tags: [browser-agent, prompt-caching, context-engineering, screenshot-pruning, llmops, cost-optimization, privacy]
---

![브라우저 에이전트의 대화 이력과 캐시 무효화](https://picsum.photos/seed/browser-agent-context-cache-cost/1600/900)

Asana와 StackAI는 한 브라우저 에이전트 실험에서 최적화된 GPT-6.1 Sol workflow의 추정 모델 비용이 실행당 평균 0.47달러였고, 기존 Model B 운영 설정보다 76배 저렴하고 5배 빨랐다고 보고했다.[1][2] 그러나 이 숫자를 “캐시를 켜면 76배 절감된다”로 읽으면 핵심도, 비교 조건도 모두 놓친다. 76배는 **일부 run이 상한에 걸린 기존 Model B baseline**과 모델·history budget·cache·screenshot policy가 함께 바뀐 설정을 비교한 공급자 보고 비율이다.[1][3] 같은 Model B 안에서 workflow 변경만 비교한 보고치는 29배였고, GPT-6.1 Sol을 480,000자 예산에서 고정하면 새 캐시·스크린샷 정책의 평균 추정 비용 차이는 1.97달러 대 0.47달러, 약 4배였다.[1][3] 이 비율들은 단일 task의 소표본 실험 결과이지 일반적인 절감 보장이 아니다.

진짜 사건은 모델 선택이 아니라 대화 이력의 **변경 위치**다. 기존 agent는 고정된 도구와 system prompt는 캐시했지만, 페이지 텍스트와 스크린샷이 누적되는 history는 캐시하지 않았다.[1] 더 큰 문제는 이전 스크린샷을 거의 매 step 삭제하고 오래된 텍스트도 예산에 맞춰 잘랐다는 점이다.[1] 다음 요청의 끝에 새 관측을 붙이는 대신 이미 보낸 중간 구간을 계속 수정했으므로, 공급자가 재사용할 수 있는 “맨 앞부터 연속해서 같은 부분”이 매번 짧아졌다.[1]

이 글은 prompt cache의 일반 입문이나 공급자별 가격표 비교를 반복하지 않는다. 그런 기초와 일반 비용 원장은 기존 글 [에이전트 Prompt Caching 비용 최적화]({% post_url 2026-09-25-agent-context-cache-cost-economics %})에서 다뤘다. 여기서는 Asana의 144개 계획 run 중 분석에 포함된 143개와 별도의 12회 후속 실험을 분해해, 브라우저 screenshot mutation과 cache rewrite의 관계에 집중한다.[1]

## 76배라는 숫자보다 먼저 실험 설계를 읽어야 한다

연구 task인 CAT32는 공개 데모 사이트 `books.toscrape.com`에서 32권의 페이지를 방문해 책마다 title, URL, UPC, price, availability, stock quantity의 여섯 field, 총 192개 사실을 수집하고 가격 합계와 최저가·최고가 책을 표로 반환하는 workflow였다.[1] 독립적으로 만든 reference의 가격 합계는 £1,164.91이었고, 한 model call이 여러 browser action과 여러 책 방문을 수행할 수 있어 call 수는 cache policy뿐 아니라 모델이 작업을 묶는 방식에도 영향을 받았다.[1]

본 실험은 네 모델, 여섯 history 정책, 두 character budget, 조건당 세 번으로 구성됐다.[1]
계획된 grid는 `4 × 6 × 2 × 3 = 144`회였고, 이 가운데 infrastructure failure 한 건을 제외한 143개 run이 분석에 포함됐다.[1] Model A와 기존 production model인 Model B를 1단계에서, Model B의 후속 세대인 Model C와 GPT-6.1 Sol을 2단계에서 시험했다.[1]
공급자 이름을 공개하지 않은 A·B·C를 임의의 실제 모델명으로 추정해서는 안 된다.[1]
Model A는 2025년 가을 출시된 더 작고 저렴한 모델, Model B는 같은 연구소가 2026년 여름 출시해 당시 production에서 쓰던 모델, Model C는 그 후속 세대로만 보고됐다.[1]

여섯 정책은 `Baseline`, `History only`, `3:1`, `10:1`, `20:10`, `20:1`이었다.[1] `N:M`은 스크린샷을 N개까지 허용하다가 초과할 때 오래된 이미지를 한꺼번에 지워 M개로 줄이는 정책이다.[1] 예를 들어 `20:1`은 최대 20개까지 쌓은 뒤 최신 한 개만 남겨, prune 사이에서 약 19회의 연속 호출이 이전 history prefix를 재사용할 기회를 만든다.[1][2] 두 history budget은 120,000자와 480,000자였으며, 이 예산은 message text와 tool call을 세지만 image, system prompt, tool definition은 세지 않았다.[1]

각 run은 최대 500 step으로 제한됐고, 각 model call의 출력 상한은 16,384 token이었다. Model A에는 20달러, 나머지에는 75달러의 run-level 모델 비용 상한이 적용됐다.[1] 1단계 cache lifetime은 5분이었고, 2단계에서는 Model C가 5분, GPT-6.1 Sol이 30분을 사용했다.[1] 2단계의 두 모델은 high effort로 실행됐지만, 1단계는 effort와 thinking 설정을 명시하지 않아 모델 기본값을 사용했다.[1] Model C는 tool을 자동 선택했고 Sol은 forced function choice를 사용했으므로, 모델 간 결과는 동일 protocol의 순수 benchmark가 아니라 연구진 표현대로 기술적 비교(descriptive comparison)여야 한다.[1]

비용은 provider의 uncached input, cache write, cache read, output token counter와 연구가 고정한 2026년 9월 17일 단가 snapshot으로 계산한 추정치이며 sandbox·server 비용은 제외됐다.[1] 연구팀은 persisted output을 reference와 비교하고, 192개 사실을 한 번이라도 보았는지와 마지막 request에도 유지했는지를 따로 판정했다.[1] 최종 답변 형식 개선은 연구 범위 밖이었다.[1]

## Longest unchanged prefix는 “같은 내용이 많다”와 다르다

OpenAI 공식 문서는 rendered context의 맨 앞부터 이어지는 prefix가 일치해야 재사용할 수 있고, breakpoint보다 앞의 content나 관련 setting이 바뀌면 그 변경 이후는 기존 entry와 맞지 않는다고 설명한다.[4]
Anthropic 문서도 `tools → system → messages` 순서로 prefix hash가 누적되며, cache breakpoint에서 뒤로 기존 entry를 찾더라도 앞선 block의 변경은 뒤쪽 message cache까지 무효화한다고 설명한다.[5]
이 규칙의 요점은 전체 요청에서 같은 token의 비율이 아니라 **첫 번째 차이가 어디에서 발생했는가**다.[4][5]

브라우저 agent의 요청을 단순화하면 다음과 같다.

```text
Request 17
[T tools][S system][H1 page text + screenshot]
[H2 page text + screenshot] ... [H16 latest result]

Request 18: append-only
[T][S][H1][H2] ... [H16][H17 new result]
                  └ longest unchanged prefix ┘

Request 18: per-step screenshot removal
[T][S][H1 text only][H2] ... [H16][H17 new result]
     └ first change
```

두 번째 형태에서는 이미지 하나만 없어져도 H1 이후의 H2~H16은 맨 앞에서 끊김 없이 이어지는 동일 prefix가 아니다.[4][5]
Anthropic은 image를 prompt 어디에서든 추가하거나 제거하면 message cache가 무효화된다고 명시한다.[5]
OpenAI도 full rendered context에 image와 tool result가 포함되고 전체 rendered prefix가 일치해야 한다고 설명한다.[4]
따라서 과거 screenshot 하나를 지우면 이미 누적된 history를 다시 write하거나 uncached input으로 처리할 수 있다.[4][5]

Asana의 baseline은 system prompt에만 marker를 두었고, history caching 정책은 최신 tool-result message의 마지막 block에 두 번째 marker를 추가했다.[1] GPT-6.1 Sol adapter에서는 system·developer prefix와 최신 function-call output에 explicit breakpoint를 두고, 30분 lifetime을 사용하며, 전체 prefix가 여전히 맞을 때만 이전 breakpoint 하나를 보존했다.[1] 본 실험 전 6-call smoke test에서도 screenshot prune 시 재사용이 사라지는 현상이 확인됐다.[1]

여기서 “최신 tool result에 marker를 둔다”만 복사해서는 안 된다. Breakpoint는 앞부분이 동일할 때 재사용 후보를 만들 뿐, 이전 message를 수정한 결과를 되돌리지 않는다.[4][5] OpenAI는 explicit breakpoint 이전의 content를 바꾸면 그 뒤 prefix가 맞지 않는다고 설명하고, Anthropic은 changing block에 marker를 두고 계속 새 entry만 쓰는 흔한 실패를 별도로 경고한다.[4][5] 연구에서 history caching만 적용한 조건이 큰 예산에서 네 모델 중 세 모델의 no-history-cache baseline보다 비쌌던 이유도 cache write가 계속 발생하고 read가 적었기 때문이다.[1][2]

## Batch pruning은 삭제를 없애지 않고 무효화를 묶는다

Per-step pruning은 매 call 한 장을 지워 거의 매번 history cache를 깼다.[1]
`20:1`은 삭제 자체를 제거하는 대신 약 20회에 한 번으로 모은다.[1]
Prune call에서는 prefix가 바뀌지만, 그 사이 약 19회는 append-only 형태를 유지한다.[1][2]
따라서 batch pruning의 단위 효과는 screenshot 수보다 invalidation event의 빈도를 낮추는 데 있었다.[1]

연구진이 모델별 best condition으로 선택한 것은 Model B의 `20:10, 480k`와 Model A·Model C·GPT-6.1 Sol의 `20:1, 480k`였다.[1] 실행당 평균 추정 비용은 각각 Model A 0.84달러, Model B 1.24달러, Model C 0.66달러, Sol 0.47달러였다.[1] 다만 이는 조건당 세 번뿐인 run의 평균이고 최종 답변 형식은 평가 범위 밖이었으므로, 일반적인 모델 순위나 end-to-end 정확도 benchmark로 읽으면 안 된다.[1] Best condition의 cache-read share는 Model A 94%, Model B 88%, Model C 73%, Sol 89%였다.[1]

더 큰 context가 반드시 더 비싸지는 않았다는 점도 중요하다. Model B의 30번째 call은 best condition에서 평균 약 93,000 input token을 실었고 development baseline에서는 약 59,000 token이었지만, best condition은 대부분을 0.1배 가격의 cache read로 처리하고 call 수도 줄였다.[1] 그 결과 run 전체 input은 Model B에서 19.7 million token에서 2.3 million token으로 줄었다.[1] Sol의 480k median-cost run에서도 24번째 call은 baseline이 약 40,000 token·cache 9%였고 best condition이 약 58,000 token·cache 93%였으며, 전체 call은 35회에서 24회로 줄었다.[1]

이 결과는 “context를 작게 만들라”가 아니라 **값비싼 재처리와 반복 탐색을 함께 보라**는 증거다. 120,000자 조건에서 Model C는 첫 text trim이 10번째 call에 왔고 Model A는 64번째에 왔다.[1] 작은 예산에서는 Model C의 18회 run 중 최종 답을 낸 run이 없었고 Sol은 18회 중 3회뿐이었으며, 대부분 step limit에서 멈췄다.[1] 반면 480,000자에서는 어떤 모델도 text trim을 하지 않았고 Model C와 Sol의 모든 run이 답을 냈다.[1]

“봤다”와 “마지막까지 보유했다”도 달랐다. 120,000자에서는 거의 모든 run이 어느 시점에 192개 사실을 보았지만 최종 request에 192개를 모두 유지한 run은 하나도 없었다.[1] 480,000자의 모델별 전체 18-run 집계에서는 Model A 14회, Model B 15회, Model C 17회, Sol 18회가 마지막 request에 192개 사실을 유지했다.[1] 이 수치는 모델별 best condition 세 run의 결과와 분모가 다르다. Context를 일찍 잘라 비용을 줄였다고 기록해도 agent가 잃어버린 사실을 다시 읽으면 browser call, 모델 call, wall-clock time이 함께 늘어난다.

## 12회 후속 실험은 “항상 20:1”이라는 결론을 뒤집는다

본 실험 뒤 연구팀은 screenshot을 아예 prune하지 않는 별도의 12회 follow-up을 2026년 10월 1일 UTC에 실행했다.[1] Model B, Model C, Sol을 각각 네 번씩 480,000자, history caching, screenshot cap 100으로 실행했으며 어느 run도 그 cap에 닿지 않았다.[1] Model A는 복원한 screenshot을 넣으면 이전 run 하나가 200,000-token input limit을 넘었기 때문에 제외됐다.[1]

이 조건의 call당 비용은 best condition보다 Model B와 Sol에서 1.2배 낮았고 Model C에서는 약 5% 낮았으며, 12회 모두 정확한 총액을 말했다.[1][2] 다만 한 run은 192개 사실 전체를 보지 못했으므로 정확한 합계가 complete extraction을 뜻하지는 않았고, follow-up은 본 실험 뒤 한 batch로 실행되면서 네 run이 cache를 공유할 수 있었기 때문에 본 조건과의 비교는 indicative하다고 연구진이 제한했다.[1] 표본도 조건당 세 번 또는 네 번이고 run별 call 수가 달라, 몇 퍼센트 차이의 정책 순위를 확정할 통계적 힘은 없다.[1][2]

후속 결과의 올바른 해석은 pruning이 쓸모없다는 것이 아니다. 이 CAT32 task는 480,000자 limit에 닿지 않았고 최대 request도 약 151,000 input token이어서, 삭제로 얻는 context 절감보다 그 삭제가 일으키는 rewrite 비용이 더 컸다.[1] 연구팀 계산으로 35-call Sol run의 prune 비용을 이후 cache read 절감으로 회수하려면 Sol의 0.05배 read 가격에서는 약 27회의 추가 call, 다른 모델의 0.1배 가격에서는 약 13회의 추가 call이 필요했다.[1] 더 긴 task, 작은 context window, 더 비싼 cache read에서는 교차점이 앞당겨질 수 있다.[1][2]

그러므로 `20:1`은 제품 상수가 아니다.
이번 연구에서는 모델별 best condition 중 하나였고, 별도 후속에서는 no-prune의 call당 비용이 더 낮았다.[1]
운영자는 `N`과 `M`을 copy-paste하기보다 history growth, image token, 남은 step, cache read 단가, context limit까지 포함해 다음 prune가 회수될 가능성을 계산해야 한다.

## 브라우저 history mutation을 별도 운영 사건으로 기록한다

여기부터는 공개 연구 결과가 아니라 production 적용을 위한 필자의 운영 제안이다. 일반적인 cache read·write 원장은 [기존 글]({% post_url 2026-09-25-agent-context-cache-cost-economics %})을 따르되, 브라우저 agent에는 `screenshot_batch_prune`, `text_budget_trim`, `compaction`, `page_revisit`을 별도 사건으로 추가한다.

첫째, 요청마다 `longest_reusable_prefix_tokens`와 `invalidation_reason`을 기록한다. 공급자 usage에는 cache read와 write token이 나타나지만, “왜 첫 불일치가 생겼는가”는 application이 request assembly diff와 연결해야 한다. 이유는 최소한 다음처럼 나눈다.

```text
append_only_growth
screenshot_batch_prune
text_budget_trim
compaction
system_prompt_version_change
tool_schema_or_order_change
tool_choice_or_reasoning_setting_change
ttl_expired
provider_route_miss
unknown
```

OpenAI는 tool name·description·schema·순서, reasoning effort, output format, compaction 같은 변경이 rendered prefix나 재사용 가능성을 바꿀 수 있다고 문서화한다.[4] Anthropic도 tool definition 변경은 전체 cache를, image 추가·삭제와 tool choice 변경은 message cache를 무효화한다고 구분한다.[5] 따라서 `cache_miss` 한 값으로 합치면 정상적인 policy 배포, 의도한 prune, serializer 회귀, TTL 만료를 구별할 수 없다.

Screenshot 정책은 개수보다 **정보 가치와 회수 비용**으로 결정한다. 각 이미지에 step, page, visual state, sensitivity를 붙이고, prune 전에 이후 판단의 증거인지 판정한다. OCR text가 있어도 버튼 상태나 공간 관계 같은 시각 증거가 복원된다고 가정하지 않는다.

Batch prune 직전에 `prune_delta`를 계산한다. 이는 지울 image token 추정치, 새 cache write 비용, 남은 예상 call에서 절약할 cache read 비용, context-limit 초과 위험, 사실 재탐색 가능성을 함께 담는다. `rewrite_cost > expected_future_read_saving`이고 context pressure가 낮다면 prune을 미룬다. 반대로 context limit까지 남은 여유가 작거나 loop가 감지되면 cache hit를 희생하고서라도 prune 또는 compaction을 실행한다.

비용 KPI를 `cost_per_call`이나 `cache_hit_rate`로 끝내지 않는다. 최소 원장은 다음과 같아야 한다.

```text
accepted_workflow_cost =
  성공 run의 model read/write/uncached/output 비용
  + 실패·timeout·재시도 run의 비용
  + browser/sandbox 비용
  + 재탐색 tool 비용
  + 사람 검토 비용

acceptance =
  required facts retained
  AND final output validator passed
  AND side-effect policy passed
```

연구에서도 실행당 비용은 call 수와 call당 비용이 함께 내려가며 감소했고, 작은 budget은 잃어버린 사실의 재방문과 미완료를 늘렸다.[1] 그러므로 cache read 95%인데 답을 내지 못한 run은 성공적인 최적화가 아니다. Dashboard는 cache-read share 옆에 completion rate, accepted result rate, repeated page visit, facts seen·retained, step-cap rate를 같은 cohort로 보여줘야 한다.

마지막으로 cache policy를 versioned experiment로 배포한다. Policy·serializer·tool registry·model·TTL·budget version을 manifest에 남기고 provider payload와 대조한다. Asana 연구도 UI label 대신 sandbox, outgoing request, provider receipt까지 설정 전파를 추적했다.[1] Canary에서는 capped·unfinished run을 제거하지 말고 lower bound로 표시한다.

## 더 오래 보존할수록 싸질 수 있지만 privacy 비용은 커진다

Append-only history와 no-prune는 cache reuse에 유리하지만, page text와 screenshot을 request와 cacheable prefix에 더 오래 남긴다.[4][5]
브라우저 agent가 민감 화면을 본다면 “삭제하지 않아 비용을 줄인다”는 선택은 정보의 **노출 면적과 체류 시간**을 늘릴 수 있다.
비용 최적화와 data minimization은 자동으로 같은 방향을 향하지 않는다.

OpenAI 문서에서 prompt cache는 token 원문 자체가 아니라 KV tensor를 application state로 둘 수 있으며, 최신 세대의 30분 TTL entry는 마지막 write나 reuse 뒤 최소 30분 동안 재사용 가능하고 더 오래 유지될 수도 있다.[4] 같은 문서는 조직 간 cache를 공유하지 않고 regional processing boundary를 넘겨 재사용하지 않는다고 설명한다.[4] Anthropic 문서는 raw prompt text나 response를 cache용으로 at-rest 저장하지 않고 KV representation과 cryptographic hash를 memory에 두며, 표준 5분 또는 확장 1시간 lifetime 뒤 즉시가 아닌 신속한 삭제 대상으로 설명한다.[5] 또한 Claude API의 cache는 조직 간 격리되고, 일부 경로에서는 workspace 단위로도 격리된다.[5]

이 차이는 공급자 안전 서열이 아니다. 실제 retention은 model, API feature, 조직 계약, ZDR, cloud 경로에 따라 달라진다.[4][5] 짧은 cache TTL도 trace, screenshot store, session replay가 더 오래 보관하지 않는다는 보장은 아니다. 반대로 application에서 이미지를 지워도 provider cache를 수동 삭제할 수 없으며, 두 공식 문서 모두 manual cache clear를 제공하지 않는다고 밝힌다.[4][5]

따라서 다음은 필자의 privacy 운영 제안이다.

- 로그인 이후 화면과 개인정보는 cacheable history에 넣기 전에 crop·redact하거나 structured result로 바꾼다.
- 민감도별로 no-prune 허용 여부, 최대 screenshot age, provider·region·workspace, TTL과 trace 보존 기간을 묶는다.
- Tenant나 user 사이에서 prefix를 공유하지 않고 application cache family도 tenant 경계로 분리한다.
- 비용 보고서에는 절감액과 함께 screenshot retention과 redaction failure를 제시한다.

이 정책은 cache를 금지하자는 뜻이 아니다. 같은 20장 screenshot이라도 공개 catalog와 관리자 console은 보존 위험이 다르다. 공개 자료 수집 workflow에서는 긴 append-only window가 합리적일 수 있지만, 민감 화면에서는 더 잦은 prune로 cache write 비용을 감수하거나 image 대신 최소 구조화 필드만 history에 남기는 편이 맞을 수 있다. 성공 workflow당 모델 비용만 최적화하면 privacy 비용을 다른 원장으로 떠넘기게 된다.

## 실전 판단 순서

고정 fixture에서 실패·capped run을 버리지 말고 baseline을 보존한 뒤, `history caching only → no-prune → 여러 N:M` 순서로 한 변수씩 비교한다. 각 cohort에는 model·serializer·tool schema·TTL·character budget·screenshot policy를 고정하고, trim 시작 call, retained-fact rate, accepted workflow당 비용을 함께 남긴다. 공개 browsing과 인증된 민감 browsing은 retention cohort를 분리한다.

의사결정은 다음 세 질문으로 압축할 수 있다.

```text
1. 다음 요청은 이전 요청의 어디까지 완전히 같은가?
2. 지금 history를 줄이지 않으면 정확성·context limit·privacy 중 무엇이 위험해지는가?
3. 줄인 뒤 다시 쓰는 비용을 남은 호출의 cache read 절감으로 회수할 수 있는가?
```

첫 질문이 cost를, 둘째가 safety와 correctness를, 셋째가 pruning 시점을 결정한다. 하나라도 계측할 수 없다면 `20:1` 같은 숫자를 production 기본값으로 고정할 근거가 없다.

## 결론

Asana와 StackAI의 연구가 보여준 것은 “더 비싼 모델도 캐시하면 싸다”는 광고 문구가 아니다.
브라우저 agent가 history 중간을 매번 수정하면 대화 이력은 cache 바깥에 남는다.[1][2]
History 끝에 marker를 추가하는 것만으로도 부족하며, screenshot 삭제와 text trim의 빈도를 함께 바꿔 longest unchanged prefix가 실제로 길어져야 한다.[1][2]

동시에 76배는 한 task에서 기존 Model B의 capped baseline과 workflow·model이 함께 바뀐 GPT-6.1 Sol 조건을 비교한 공급자 보고 수치다.[1][3] 같은 Model B의 workflow 개선은 29배, Sol 내부의 큰 예산 조건 비교는 약 4배였고, 별도 12-run follow-up에서는 이 task에 한해 no-prune가 call당 더 저렴했다.[1][3] 이 경계를 지키면 headline을 재현 목표로 오해하지 않고 메커니즘을 검증할 수 있다.

Production의 목표는 cache hit rate 최대화가 아니다. **정확하게 끝난 workflow당 총비용을 낮추되, cache invalidation reason을 설명하고, context limit과 민감 데이터 retention의 상한을 지키는 것**이다. Append-only history는 강력한 비용 구조지만 무한 보존 정책이 아니다. Pruning은 token 청소가 아니라 cache rewrite, 정보 손실, privacy exposure를 한 번에 바꾸는 운영 결정이다.

## Sources

[1] https://assets.asana.biz/asset/fb86cc8e-6611-4404-b7c6-172692a724bb/How-Asana-used-Codex-to-optimize-browser-agent-costs-and-runtime.pdf
[2] https://asana.com/inside-asana/cut-browsers-agent-cost
[3] https://openai.com/index/asana-browser-agent
[4] https://platform.openai.com/docs/guides/prompt-caching
[5] https://platform.claude.com/docs/en/build-with-claude/prompt-caching
