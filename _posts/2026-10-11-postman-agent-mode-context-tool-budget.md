---
title: 'Postman Agent Mode의 운영 경계: Tool Budget과 목적형 Context 설계'
date: 2026-10-11 07:30:00 +0900
categories: ["AI 에이전트"]
description: 'Postman Agent Mode 사례를 통해 tool budget, schema-aware read, UI-state decoupling, 목적형 context, 사람 승인과 Bedrock 추론 제어의 서로 다른 경계를 분석한다.'
featured_image: '/images/posts/2026-10-11-postman-agent-mode-context-tool-budget.png'
tags: [postman, agent-mode, tool-budget, context-engineering, amazon-bedrock, human-in-the-loop, data-residency]
---

![Postman Agent Mode의 context와 tool budget 운영 경계](/images/posts/2026-10-11-postman-agent-mode-context-tool-budget.png)

Postman 공식 문서는 Agent Mode를 자연어로 API lifecycle의 작업을 수행하는 기능으로 설명한다.[3] 이 사례에서 중요한 숫자는 모델 benchmark가 아니다. Postman 내부 시험에서는 모델에 보이는 도구가 약 40개를 넘자 존재하지 않는 도구 호출, schema와 맞지 않는 argument, 문맥상 틀린 도구 선택이 늘었다. 현재 구조는 170개가 넘는 도구 중 관련된 약 15개를 골라 격리된 sub-agent에 전달한다.[1] 더 큰 모델도 오류를 없애지는 못했다.

먼저 **4천만 명**의 경계부터 그어야 한다. 이는 AWS와 Postman이 각 사례 글에서 제시한 Postman의 developer community 또는 audience 규모다.[1][2] Agent Mode 활성 사용자, MAU, 동시 사용자, 호출량을 뜻하지 않으며, 두 글은 그런 수치를 공개하지 않는다. 따라서 이 사례는 큰 developer audience를 보유한 제품에 Agent Mode를 통합한 vendor case로 읽어야지, 4천만 Agent Mode 사용자가 검증한 benchmark로 읽어서는 안 된다.

이 글은 Postman의 수치를 보편 법칙으로 확대하지 않는다. 먼저 공급자가 공개한 구현 사실을 분리하고, 그다음 다른 성숙 제품에 적용할 때 필요한 운영 해석을 제안한다. 핵심은 “API나 CLI를 제공하라”는 일반론도, prompt cache 비용을 줄이는 방법도 아니다. **모델이 한 작업에서 볼 수 있는 도구·데이터·현재 상태를 어떤 계약으로 좁히고, 실행 권한과 추론 인프라 제어를 어디에서 분리할 것인가**가 중심이다.

## Tool budget은 도구 개수가 아니라 선택 문제의 크기다

Postman은 초기 Agent Mode에서 요청 열기, 단일 field 수정, 특정 metadata 조회처럼 작고 정밀한 도구를 선호했다. 초기에는 통제와 정확성에 유리했지만, 실제 workflow 하나가 긴 tool-call sequence로 분해됐다. 각 단계가 다시 모델을 거쳐야 하므로 사용자가 한 동작으로 생각한 작업이 느리게 보였고, 도구 수가 늘수록 선택 오류도 증가했다.[1][2]

여기까지가 공급자 사례다. 약 40개라는 지점은 Postman의 도구 이름, 설명, 중복 정도, 당시 모델과 평가 task에서 나온 내부 관측이다. 공개 글에는 표본 수, error rate, model별 곡선이 없다. 그러므로 `MAX_TOOLS=40`을 업계 상수로 복사할 근거는 없다. 40개의 서로 다른 도구와 이름·argument가 비슷한 40개 도구는 난도가 다르다.

일반화할 수 있는 부분은 **도구 catalog 전체와 한 추론 turn에 노출되는 도구 집합을 분리하라**는 설계다. Tool budget에는 적어도 네 가지가 포함된다.

| 예산 축 | 모델이 부담하는 것 | 운영에서 볼 신호 |
|---|---|---|
| 선택 예산 | 비슷한 도구 설명 중 하나를 고르는 부담 | nonexistent tool, wrong-tool rate, 재선택 횟수 |
| schema 예산 | 이름·설명·argument schema가 차지하는 context | 노출 tool token, invalid argument rate |
| 순서 예산 | 원자적 도구를 여러 번 이어 붙이는 계획 부담 | 작업당 call 수, round trip, 중간 실패율 |
| 권한 예산 | 현재 task에 불필요한 effect까지 선택지에 들어오는 위험 | 승인 거절, 범위 밖 호출, write tool 노출 시간 |

Postman의 root agent가 vector database의 tool embedding을 조회해 170개 이상을 약 15개로 좁히는 구조는 이 예산을 줄이는 한 구현이다.[1] 그러나 retrieval top-k가 곧 authorization은 아니다. 관련성 검색이 write 권한을 부여해서는 안 되며, 검색에서 빠진 필수 도구를 모델이 “없는 기능”으로 단정해서도 안 된다.

운영에서는 `catalog → candidate → authorized → visible`을 따로 기록하는 편이 낫다.

```text
catalog: 제품이 제공하는 전체 도구
candidate: task와 context로 검색된 도구
allowed: 사용자·tenant·정책상 실행 가능한 도구
visible: 이번 agent thread에 실제 전달된 도구
```

이 구분은 이 글의 운영 제안이지 Postman이 공개한 공식 field가 아니다. 각 단계의 version과 선택 이유를 trace에 남기면, 모델 실패인지 retrieval 누락인지 권한 정책의 정상 차단인지 구별할 수 있다. Tool budget을 줄인다는 말은 기능을 삭제한다는 뜻이 아니라, **한 판단 시점의 선택 공간과 권한 공간을 함께 좁힌다**는 뜻이다.

## Schema-aware read는 “질문마다 도구 하나”를 버리는 방식이다

Postman의 API Catalog에는 service uptime, test result, endpoint response time처럼 구조화된 데이터가 있다. Postman은 여러 view를 각각 도구로 만드는 대신 ClickHouse table schema를 모델에 주고, 하나의 query tool이 join과 `WHERE`를 포함한 질의를 생성하게 했다.[1][2] 엔지니어링 단위가 “예상 질문별 도구 작성”에서 “데이터를 한 번 잘 모델링하기”로 옮겨간 셈이다.

이 방식은 read surface에서 특히 강하다. `get_failed_tests`, `get_slow_endpoints`, `compare_service_uptime`을 계속 추가하면 자연어 질문의 조합 수만큼 tool catalog가 커진다. 반면 schema-aware query는 table, relation, metric 의미를 안정적으로 정의하면 새로운 분석 질문을 같은 도구로 처리할 수 있다. 도구 수는 줄고 표현력은 커진다.

다만 schema-aware가 곧 unrestricted SQL을 뜻하지는 않는다. 공급자 글은 ClickHouse query 사례를 설명하지만 row-level authorization, query cost limit, PII column policy의 구체 구현까지 공개하지 않는다.[1] 다른 조직이 이 패턴을 적용할 때는 다음을 별도 enforcement layer로 둬야 한다.

- tenant와 workspace 범위를 서버가 주입하고 모델이 해제하지 못하게 한다.
- read-only identity를 사용하고 허용한 view 또는 semantic layer만 노출한다.
- scan byte, 실행 시간, row 수, join 수에 상한을 둔다.
- secret·credential·raw payload column은 schema 공개 단계부터 제외한다.
- 결과에는 조회 시각, dataset version, 적용 filter를 붙여 후속 판단의 freshness를 알린다.
- 생성 query와 실제 실행 query, 차단 이유를 audit event로 남긴다.

즉 schema-aware read의 장점은 query engine에 권한을 넘기는 것이 아니라, **읽기 질문의 다양성을 data model이 흡수하게 하는 것**이다. Mutation까지 같은 방식으로 일반화하면 위험이 달라진다. “조건에 맞는 request를 찾아라”는 composable read지만 “조건에 맞는 모든 request를 수정하라”는 대량 effect다. 읽기 query와 쓰기 command는 같은 schema를 참고할 수 있어도 승인, 최대 영향 범위, rollback 계약은 분리해야 한다.

## UI-state decoupling은 화면 자동화가 아니라 domain state 복원이다

Postman이 만난 더 오래된 문제는 client API가 UI state에 암묵적으로 묶여 있었다는 점이다. 일부 request 수정 도구는 특정 화면 요소가 열려 있어야 했고, 다른 도구는 tab을 여는 side effect를 만들었다. Agent Mode는 request를 읽기 위해 먼저 tab을 여는 등 데이터를 다루기보다 사람의 click 순서를 흉내 내야 했다.[1][2]

Postman은 도구를 tab에서 분리하는 중이며 Native Git 기능이 이 접근을 넓게 사용한다고 설명한다. Agent Mode는 이제 열린 tab 없이 background에서 request를 보낼 수 있지만 사용자 승인은 여전히 필요하다.[1][2] 중요한 변화는 headless 실행 자체가 아니다. “화면에 열림”이라는 우연한 presentation state가 “어떤 request를 어느 revision에서 대상으로 삼는가”라는 domain state로 바뀐 것이다.

성숙 제품에서는 UI가 사실상의 orchestration layer가 되기 쉽다. 선택된 row, 활성 tab, 펼친 panel이 backend 호출의 숨은 precondition 역할을 한다. 이를 그대로 agent tool로 감싸면 문제가 생긴다.

1. 사용자가 tab이나 선택을 바꾸면 대상이 흔들린다.
2. 읽기가 화면 열기라는 side effect를 만든다.
3. UI 구현에 따라 agent 동작도 달라진다.
4. background agent와 사용자가 같은 UI state를 경쟁한다.

운영 해법은 UI를 없애는 것이 아니다. UI를 domain command의 한 client로 내린다. Tool input에는 `workspace_id`, `resource_id`, `revision`, `environment_id`처럼 대상을 명시하고, server가 권한과 version precondition을 검사한다. 실행 결과는 UI가 열려 있는지와 무관한 domain event가 되며, 화면은 그 결과를 다시 projection한다. 이 구조라야 사람과 agent가 같은 대상을 다루면서도 서로의 tab 상태를 덮어쓰지 않는다.

## Purpose-built context는 화면 객체의 직렬화가 아니다

Postman은 처음에 부족한 도구가 가장 큰 병목일 것으로 예상했지만, 실제로는 빠졌거나 잘못된 context 때문에 올바른 도구도 쓸모없어지는 경우가 더 컸다고 설명한다. 여기서 context는 사용자가 제품의 어디에 있는지, 어떤 entity가 활성인지, 앞에서 어떤 상태가 만들어졌는지에 대한 이해다.[1][2]

기존 UI data model을 그대로 직렬화하는 시도도 잘 작동하지 않았다. 그 객체는 rendering과 client-server 전송을 위해 만들어졌지 모델의 판단을 위해 만들어진 것이 아니기 때문이다. Postman은 entity별 context handler를 만들어 agent에게 필요한 정보만 추렸다. Request description, OpenAPI specification, payload처럼 길이가 열린 사용자 데이터가 늘자 truncation이 다음 문제로 나타났고, 개별 handler마다 잘라내기와 확장 규칙을 넣지 않아도 되는 filesystem-backed 접근도 탐색하고 있다고 밝혔다.[1][2]

Agent Mode의 context는 도구 결과만으로 구성되지 않는다. 공급자 설명은 세 요소를 구분한다. client-side tool은 제품 안에서 최종 동작을 수행하고, generic agent instruction은 기본 행동을 정하며, RAG knowledge base는 넓은 제품 지식을 필요한 때 공급한다.[1] Postman은 Learning Center를 바탕으로 짧은 feature별 article을 만들고, 사용자 query와 현재 context에 따라 runtime에 선택한다. 예를 들어 mock server가 선택되면 관련 article을 넣는다.[1][2]

이 사례에서 얻을 운영 해석은 “모든 것을 요약하라”가 아니다. 목적형 context는 같은 entity도 task에 따라 다른 projection을 가져야 한다.

```text
request 실행 context:
  method, resolved URL, environment, auth mode, body 요약, revision

request 문서화 context:
  이름, 설명, example, schema, audience, 누락된 설명

request 장애 분석 context:
  최근 status·latency, test failure, variable resolution, 변경 이력
```

세 projection은 같은 원본을 가리키되 freshness와 provenance를 공유해야 한다. 요약만 주고 원본으로 확장할 handle이 없으면 세부 검증이 막힌다. 반대로 원본 전체를 매번 넣으면 noise와 민감 데이터가 판단 공간을 점유한다. 따라서 context handler는 `summary + source handle + version + omitted fields + sensitivity`를 반환하고, agent가 필요할 때 좁게 확장하는 편이 낫다. 이 field 집합 역시 이 글의 운영 제안이다.

여기서 context budget과 tool budget은 연결된다. 현재 선택된 entity가 틀리면 엉뚱한 tool subset을 고르고, tool subset이 부족하면 추가 context를 읽을 길도 막힌다. 그래서 tool selection 이전에 task와 대상의 최소 identity를 고정하고, 실행 도중 context가 바뀌면 selection version도 갱신해야 한다. 단순 token 상한보다 **어떤 정보가 어떤 결정에 쓰였는지**를 추적하는 것이 먼저다.

## UI와 분리해도 Human approval은 사라지지 않는다

Postman의 production design에서는 application state를 바꾸는 action 전에 사용자 승인을 요구한다. 열린 tab 없이 background request를 보내는 경로도 승인을 유지한다. 또한 enterprise admin은 Agent Mode의 guardrail 설정에서 Amazon Bedrock Guardrails를 켜 PII가 기반 모델에 도달하기 전에 redact하도록 할 수 있다.[1]

이 세 제어는 서로 대체하지 않는다.

- UI-state decoupling은 실행 대상을 화면 상태에서 분리한다.
- Human approval은 특정 effect를 지금 허용할지 사람이 결정한다.
- PII redaction은 model input에 들어가는 데이터 범위를 줄인다.

승인 dialog가 있다는 사실만으로 안전한 것도 아니다. `Send request?`처럼 추상적인 문구는 사람이 effect를 판단하기 어렵다. 다른 제품에 적용한다면 승인 시점에 대상 resource와 revision, destination host, 사용할 environment, credential의 이름과 scope, 예상되는 write 또는 network effect를 고정해 보여줘야 한다. 승인 후 tool argument가 달라지면 다시 승인하고, 실행 결과는 승인 record와 연결한다. 이는 Postman이 공개한 UI 사양이 아니라 일반화한 운영 제안이다.

모든 tool call을 승인받는 방식도 답은 아니다. 읽기와 navigation까지 계속 묻으면 사용자는 내용을 읽지 않고 승인하게 된다. Read-only query, local draft, reversible update, external network call, destructive action처럼 effect class를 나누고, 자동 실행 범위와 재승인 조건을 정해야 한다. 사람은 모델의 생각을 승인하는 것이 아니라 **구체적으로 고정된 효과**를 승인해야 한다.

## Bedrock 운영 제어는 tool·context 설계와 다른 경계다

AWS 사례에 따르면 Postman은 Bedrock에서 지원되는 Claude model을 workload에 따라 선택하고, geographic cross-Region inference로 허용 geography 안의 처리 용량을 활용한다. 지원되는 Agent Mode model에는 `data_retention_mode: none`을 설정했으며, 안정적인 system prompt·instruction·core tool에는 1시간, 더 자주 변하는 context에는 5분 prompt-cache checkpoint를 사용한다.[1] 여기까지가 공급자가 공개한 구현 사실이다.

각 제어의 보장은 서로 대체할 수 없다. Geographic profile은 처리 가능한 destination Region 집합을 정하지만 source Region 고정을 뜻하지 않는다.[4] `none`은 호환되는 model 경로에서 request와 response를 durable storage에 남기지 않는 retention 정책이지, 입력의 전송이나 in-memory 처리가 없다는 뜻이 아니다.[5] Prompt cache는 지정한 TTL 동안 반복 prefix를 재사용하는 기능이며, context 정확성·tool 권한·data residency를 보장하지 않는다.[6] Model routing 역시 품질과 latency 선택이지 이 세 정책의 자동 승계가 아니다.

운영에서는 호출 응답이 매번 하나의 “effective retention mode”를 알려준다고 가정하지 않는 편이 안전하다. 배포 시점에 account·project 설정과 선택 model의 `allowed_modes`, inference profile의 destination Region, cache 호환성을 현재 문서와 제어면에서 확인하고, 보장에 맞지 않는 fallback은 차단해야 한다. Trace에는 provider가 자동 제공하는 단일 field에 기대지 말고 조직의 검증 record로 `selected_model`, 요청을 보낸 `source_region`과 선택한 `inference_profile`, `requested_retention`, `verified_at`을 남긴다. 이 기록은 retention을 새로 보장하는 증거가 아니라, 어떤 설정과 지원 조건을 언제 확인해 route를 허용했는지 재현하기 위한 운영 제안이다.

## 제품 통합의 병목을 찾는 검토 순서

Postman 사례를 다른 성숙 제품에 옮길 때는 model upgrade부터 시작하기보다 다음 순서로 실패를 분해하는 편이 낫다. 아래 순서는 공개 architecture를 바탕으로 한 운영 제안이다.

1. **대상 고정**: 사용자의 task, tenant, workspace, resource, revision을 UI state와 분리한다.
2. **목적형 context 구성**: 판단에 필요한 projection과 원본 확장 handle, freshness를 만든다.
3. **Read surface 정리**: 반복되는 좁은 조회 도구를 schema-aware read로 통합하되 권한과 query budget은 서버에서 집행한다.
4. **Tool 후보 축소**: catalog 전체가 아니라 task에 관련되고 허가된 subset만 노출한다.
5. **Effect 승인**: 변경·외부 전송의 대상과 argument를 고정한 뒤 사람에게 승인받는다.
6. **Inference bundle 선택**: model, Region profile, retention, cache 호환성을 하나로 route한다.
7. **증거 기록**: context version, visible tools, 승인 payload, 실제 query·effect, model과 profile을 같은 trace에 연결한다.

목적은 모든 제품을 Postman처럼 구현하는 것이 아니라 실패를 “모델이 틀렸다”로 뭉개지 않는 데 있다. 잘못된 resource, 과도하게 비슷한 도구, UI에 숨은 precondition, 정책과 맞지 않는 fallback은 각각 다른 owner가 고쳐야 한다.

## 결론

Postman Agent Mode 사례가 보여주는 생산 환경의 핵심은 도구를 많이 붙이는 능력이 아니다. 전체 catalog는 170개가 넘더라도 한 task에는 약 15개를 보여주고, 구조화된 read는 schema-aware query로 흡수하며, agent가 tab을 열어야만 데이터를 읽는 결합을 걷어냈다. Rendering object 대신 목적형 context handler와 runtime knowledge selection을 만들고, state-changing action에는 사람 승인을 남겼다.[1][2]

이 수치와 결과는 Postman과 AWS가 공개한 vendor case다. 약 40개에서 오류가 늘었다는 관측을 보편 한계로, 4천만 developer community·audience를 Agent Mode 활성 사용자 수로, 더 큰 model의 개선을 구조 문제의 해결로 바꾸어 말하면 안 된다.[1][2]

일반화할 결론은 경계의 분리다. Tool retrieval은 authorization이 아니고, schema-aware read는 unrestricted query가 아니며, background 실행은 무승인이 아니다. Geographic routing은 단일 Region 고정이 아니고, zero retention은 무처리가 아니며, prompt cache는 최신 context를 보장하지 않는다. 이 경계를 각각 version과 evidence로 묶을 때 성숙 제품은 비로소 “화면을 흉내 내는 agent”에서 “제품의 domain state를 직접 다루되 승인과 데이터 정책을 지키는 agent”로 이동할 수 있다.

## Sources

[1] https://aws.amazon.com/blogs/machine-learning/how-postman-runs-agent-mode-for-40-million-developers-on-amazon-bedrock/
[2] https://blog.postman.com/what-we-learned-from-building-an-ai-agent-for-40-million-developers/
[3] https://learning.postman.com/docs/getting-started/basics/about-agent-mode/
[4] https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
[5] https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html
[6] https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
