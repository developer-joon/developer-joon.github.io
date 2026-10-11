---
title: 'RAG만으로는 부족하다: AWS 공개 사례로 본 커머스 AI의 거래 경계'
date: 2026-10-11 20:20:00 +0900
categories: ["AI 에이전트"]
description: 'Amazon Rufus/Alexa for Shopping, Kate Spade AI Gift Concierge, AWS 공개 샘플을 분리해 분석하고, 상품 검색과 가격·재고·주문 사이의 거래 경계를 설계한다.'
featured_image: 'https://picsum.photos/seed/aws-commerce-ai-assistant-transaction-boundary/1600/900'
tags: [aws, amazon-bedrock, commerce-ai, shopping-assistant, rufus, agentic-ai, rag, architecture]
---

![AWS 커머스 AI Assistant의 검색과 거래 경계](https://picsum.photos/seed/aws-commerce-ai-assistant-transaction-boundary/1600/900)

커머스 AI Assistant를 설명할 때 흔히 나오는 그림은 단순하다. 상품 문서를 벡터 데이터베이스에 넣고, LLM이 검색 결과를 읽은 뒤 추천 문장을 만든다. 상품 탐색까지만 보면 맞는 설명이다. 그러나 사용자가 “내 사이즈 재고가 있고 금요일까지 도착하는 상품만 보여 줘”, “20만 원 아래로 떨어지면 주문해 줘”라고 말하는 순간 이 구조는 부족하다.

상품 설명은 검색할 수 있지만 가격·재고·배송일은 시점과 판매자에 따라 달라진다. 장바구니와 주문은 상태를 바꾸며, 결제와 환불은 금전적 책임을 만든다. 이 경계를 RAG가 대신할 수는 없다.

이 글의 결론은 하나다.

> **커머스 AI Assistant에서 어려운 것은 답변 생성보다 거래 경계다. LLM은 의도를 구조화하고 도구를 선택하되, 가격·재고 확인과 거래 확정은 권위 있는 API와 결정론적 서비스가 맡아야 한다.**

이를 확인하기 위해 네 종류의 공개 자산을 분리해 본다. Amazon 내부의 대규모 production 서비스인 Rufus와 현재의 Alexa for Shopping, AWS와 Tapestry 발표상 고객 대상 서비스인 Kate Spade Gift Concierge, retailer용 Agentic Shopping Assistant on AWS, 그리고 공개 reference implementation인 AWS Guidance다. 이름은 비슷하지만 공개 범위와 증거 수준은 서로 다르다.

## 거래 흐름부터 분리한다

커머스의 상태 변경은 한 번의 tool 호출이 아니다. 최소한 다음 단계가 서로 다른 상태와 승인 경계를 가져야 한다.

1. 상품을 비교한다.
2. 멱등한 명령으로 장바구니를 변경한다.
3. 상품·seller·배송비·세금·할인·총액·배송지·결제 token·만료시각이 묶인 checkout quote를 만든다.
4. 사용자가 quote를 승인하거나, 사전에 승인한 mandate가 현재 요청을 허용하는지 검사한다.
5. 재고를 예약하고 결제를 승인한 뒤 주문을 생성한다.
6. 일부 단계가 실패하면 결제 승인을 취소하고 재고를 해제하는 보상 동작을 수행한다.
7. 주문 원장의 상태를 다시 읽고 비동기 reconciliation으로 외부 결제·재고 시스템과 맞춘다.

LLM이 만드는 것은 실행 명령이 아니라 **검증 전 의도 초안**이다. Schema, 필수 필드, enum, 범위, 통화, locale을 검증하고, 사용자가 말하지 않은 값을 자동 보완하지 않으며, 서버에서 권한과 정책을 다시 검사해야 한다. Planner가 만든 write 제안은 다음 경로를 통과한다.

```text
LLM / Planner
  → Structured proposal
  → Schema validation
  → Authentication / Authorization
  → Policy / User approval
  → Read API 또는 Idempotent Command API
  → Ledger / Reconciliation
```

외부 결제와 재고 시스템을 하나의 database transaction으로 묶을 수는 없다. Saga·outbox·보상 동작과 durable result 저장이 필요하다. Idempotency key도 이름만 있어서는 부족하다. Key scope와 request fingerprint를 저장하고, 같은 key로 다른 payload가 오면 거절하며, 결제사의 idempotency와 연결해야 한다.

## 먼저 production과 demo를 분리해야 한다

| 자산 | 확인할 수 있는 것 | 동일시하면 안 되는 것 |
|---|---|---|
| Rufus/Alexa for Shopping | Amazon 내부 production과 추론 구조 | 외부 retailer가 같은 모델·code를 쓴다는 주장 |
| Kate Spade Gift Concierge | 고객 대상 출시라는 vendor 발표 | Rufus와 같은 기능·운영 수치, 독립 검증된 운영 상태 |
| Agentic Shopping Assistant on AWS | Retailer용 제품·engagement 범위 | 모든 기능이 Kate Spade에 활성화됐다는 주장 |
| AWS GitHub Guidance | CDK·Bedrock 기반 reference code | 실제 주문·결제 또는 검증된 production 구조 |

Rufus는 자체 LLM·RAG·Trainium/Inferentia serving에서 시작해 Bedrock의 Nova·Claude Sonnet, 자체 모델, tool과 account memory를 함께 쓰는 서비스로 설명됐다.[1][2][5] Amazon은 2026년 5월 13일 이를 Alexa for Shopping으로 개명하고 Alexa+ context를 결합한다고 밝혔다.[6]

AWS는 Kate Spade를 “AgentCore로 구축된 최초의 production-ready retail AI assistant”라고 한정해 발표했다.[9] 모든 쇼핑 assistant 가운데 최초라는 뜻은 아니다. Guidance 분석은 공개 커밋 `e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015`의 정적 검토이며, 실제 AWS 배포 검증이 아니다.[14]

## Rufus 아키텍처는 모델 하나로 설명되지 않는다

공개 자료에는 세 종류의 라우팅이 나온다. **Model router**는 질문 난도에 따라 모델 계층을 고르고, **query planner**는 검색원·API·tool 순서를 계획하며, **infrastructure router**는 추론 작업을 리전·host·multi-node inference cell에 배치한다.[2][3][4][5] Feature, confidence threshold, 모델별 traffic, fallback과 비용 가중치는 공개되지 않았다.

아래 그림은 서로 다른 시점에 공개된 기능을 모은 **logical responsibility map**이다. Amazon 내부 구성도나 확인된 호출 순서가 아니며, 모든 컴포넌트가 같은 요청에서 동시에 사용된다는 뜻도 아니다.

```text
Customer → Session · Identity · Consent
                 │
                 ├─ Deterministic context — 주문 이력 · 계정
                 └─ Query Planner
                       ├─ Model Router
                       │     └─ Infrastructure Router
                       │           └─ Region · Inference Cell
                       └─ Knowledge Retrieval
                             └─ Catalog · Review · Q&A · Web

Answer → Token stream · UI markup → Hydration

별도 commerce boundary
  Live offer · inventory · delivery API
       → Policy · Approval
       → Cart · Reorder · Price alert · Auto-buy
       → Durable transaction service
```

Rufus는 catalog, 리뷰, Q&A, Amazon 검색, Stores API와 외부 웹 자료를 사용한다고 설명한다.[1][2][5] 단일 vector store라기보다 여러 검색원과 API를 조합하는 구조로 해석할 수 있지만, production index의 chunking, embedding, reranker와 freshness SLA는 공개되지 않았다. Amazon Science의 REAPER 연구는 Mistral-7B-Instruct-v0.2 실험에서 tool sequence 정확도 95%, 표 기준 tool accuracy 96%, argument accuracy 92%, plan latency 207ms를 보고했다.[13] 이 논문을 Rufus의 production planner 구현으로 동일시해서는 안 된다.

주문 이력처럼 확보된 context는 첫 inference request에 직접 넣고 추가 정보가 필요할 때 tool을 호출한다.[5] 가격·재고·최신 catalog는 live database에서 조회한다. Auto-buy에서는 LLM이 mandate의 **검증 전 초안**을 만들고, 이후 가격 감시와 주문은 전통적인 service가 수행한다.[5] Notify-and-confirm은 조건 충족 후 거래별 승인을 받는다. Delegated auto-buy는 사전 승인 범위·상한·만료·seller 정책, mandate version, 폐기 시각, 실행 잠금과 잔여 예산까지 정책 엔진이 검사해야 한다.

Rufus는 token과 UI markup instruction을 streaming하고 내부 조회 결과로 UI 데이터를 채우는 과정을 `hydration`이라고 설명한다.[1] 다만 가격 source of truth, 자유 텍스트 가격 차단 여부와 partial-failure 정책은 공개되지 않았다. Production에서는 자연어와 상품 카드가 같은 quote/version을 사용하고 불일치하면 가격 표시를 중단해야 한다.

공개된 serving stack에는 Inf2·Trn1, AWS Neuron, ECS, ALB, vLLM과 multi-node inference가 포함된다.[2][4] 이후 Bedrock 기반 Nova·Claude Sonnet과 자체 모델을 함께 쓴다고 밝혔지만, Bedrock이 자체 serving을 전면 대체했다는 근거는 없다.[5]

## 공개 운영 수치는 vendor claim으로 읽어야 한다

Amazon과 AWS는 Rufus의 규모와 효과를 여러 차례 공개했다.

- Prime Day 기준 3개 리전, 80,000개 초과 Trainium·Inferentia 칩, 평균 분당 300만 token, 첫 응답 P99 1초 미만.[2]
- Query planner의 목표는 300ms SLA와 분당 수백만 query로 설명된다.[3]
- AWS는 비교한 다른 hosting 대안보다 비용이 4.5배 낮았다고 표현했다. 같은 기준이라면 비교군의 약 22.2%, 즉 약 77.8% 감소에 해당하지만 비교 대상과 절대 비용은 공개하지 않았다.[2]
- Amazon 발표 기준 2025년 Rufus 이용 고객은 11월 시점 2억5천만 이상, 연간 실적 발표에서는 3억 이상이다.[7][8]
- Rufus 사용 쇼핑 여정의 구매 완료 가능성 60% 이상 증가와 약 120억 달러의 `incremental annualized sales`가 발표됐다.[5][7][8]

마지막 두 수치는 독립 검증 결과가 아니다. 고유 사용자 집계 방식, 무작위 배정, 비교 집단, selection bias 보정, 매출 귀속 모델과 신뢰구간이 공개되지 않았다. “Rufus가 전환을 60% 높였다”거나 “120억 달러를 직접 벌었다”고 쓰는 대신 **Amazon이 그렇게 귀속해 발표했다**고 한정해야 한다.

## Kate Spade 사례가 공개한 것과 공개하지 않은 것

AWS는 2026년 4월 13일 Kate Spade AI Gift Concierge를 고객 대상 서비스로 출시했다고 발표했다. 이 글은 발표와 공개 설명을 검토했으며 실제 운영 상태·traffic·거래를 독립 검증하지 않았다. 공개된 범위는 범용 구매 agent가 아니라 행사, 받을 사람과 스타일을 질문해 상품 카드와 상세 페이지를 제시하는 guided selling이다. Anthropic Haiku 4.5, Amazon Bedrock과 Bedrock AgentCore를 사용한다고 설명한다.[9]

AWS 발표는 고객 공개 전 약 2.5개월의 테스트를 언급한다.[9] 별도 AWS podcast episode도 공개돼 있지만 landing page에는 transcript와 timestamp가 없어 구축 기간이나 성과 수치의 근거로 사용하지 않았다.[10] Conversion rate와 평균주문금액 변화에 관해서도 검증 가능한 정량 자료는 공개되지 않았다. 발표문의 3.5배 전환 주장은 출처와 측정 방법이 없어 Kate Spade 또는 Rufus의 실측치로 귀속할 수 없다.[9]

Agentic Shopping Assistant on AWS에는 memory, voice, review summarization, cart·checkout 연동 같은 기능이 소개돼 있다.[11][12] 이것은 제품군의 capability다. Kate Spade가 이 기능을 전부 활성화했다는 뜻은 아니다. 또한 AWS가 외부 retailer에게 제공한다고 밝힌 것은 Rufus/Alexa에서 얻은 학습과 architecture pattern이지, 동일 모델이나 planner, production source code가 아니다.[9]

## AWS 공식 샘플을 코드까지 보면 거래 원장이 없다

AWS Guidance의 README와 CDK stack은 Streamlit/ECS, Cognito, API Gateway/Lambda, Bedrock Agent, Bedrock Knowledge Bases, S3와 OpenSearch Serverless를 배포한다.[15][16][17] 정적 상품 catalog를 text와 metadata로 변환해 S3와 Knowledge Base에 적재하는 흐름도 구현돼 있다.[17][19]

여기까지는 검색·대화 demo로 구체적이다. 문제는 거래 기능이다.

- 기준 커밋의 저장소 정적 검토 범위에서는 DynamoDB, Aurora, RDS 같은 transaction database를 확인할 수 없다.[14]
- 상품 원장은 S3의 정적 JSON이다.[20][22]
- `createOrder`는 UUID와 합계를 반환하지만 주문을 저장하지 않는다.[21]
- `sendEmail`은 실제 메일을 보내지 않고 성공 문자열만 반환한다.[21]
- 재고는 정적 값을 읽을 뿐 예약하거나 차감하지 않는다.[22]
- 장바구니와 message는 Streamlit의 process memory에 있다.[23]
- OpenAPI에는 주문 동작이 있지만, 서버가 authoritative catalog를 다시 읽어 가격·수량을 검증하는 흐름은 없다.[18][21]

따라서 `/createOrder`라는 이름만 보고 실제 주문 시스템이라고 소개하면 안 된다. 이 코드는 Bedrock Agent와 Knowledge Base, Action Group을 연결하는 demo다. 실제 AWS 계정에서 이 글의 기준 커밋을 배포해 재현한 것도 아니므로, “검증된 재현 구현”이 아니라 **소스 정적 검토를 거친 공개 reference implementation**이라고 부르는 것이 정확하다.

```text
AWS Guidance demo                 Production target
────────────────────              ─────────────────────────
Streamlit / ECS                   Web · App · Voice
Bedrock Agent                     Identity · Consent
Knowledge Base                    Assistant Orchestrator
S3 static products                Catalog Search / RAG
OpenSearch Serverless             Live Offer · Inventory API
Action Group / Lambda             Policy · Approval Engine
UUID와 합계 반환                  Idempotent Cart · Order API
Process-memory cart               Order Ledger · Payment
                                  Fulfillment · Cancel · Return · Refund
```

## 데이터마다 source of truth가 달라야 한다

| 데이터·행동 | 권장 source | 이유 |
|---|---|---|
| 상품 설명·사용법·FAQ·비교 기준 | Search/RAG | 비정형 지식 검색에 적합 |
| 가격·재고·배송일·쿠폰 | Live commerce API | 시점·seller·offer·locale마다 변경 |
| 주문·배송 상태 | 인증된 고객별 API | 사용자 소유권 검증 필요 |
| 장바구니 추가 | 구조화된 write tool | 수량·variant·멱등성 필요 |
| 주문·결제·환불 | 명시적 승인 뒤 결정론적 API | 금전·규제·복구 경계 |
| 사용자 선호 | 별도 memory store | 출처·동의·TTL·삭제 필요 |

예를 들어 사용자가 다음과 같이 요청한다고 하자.

> “20만 원 이하 러닝화 중 내 사이즈 재고가 있고 금요일까지 배송되는 상품만 비교해 줘.”

안전한 data flow는 다음과 같다.

```text
1. Identity와 consent 확인
2. Intent extraction과 schema validation
3. Catalog semantic retrieval
4. SKU별 live offer · inventory · delivery 조회
5. 배송·할인 policy 적용
6. 근거와 observed_at이 포함된 비교 결과 표시
7. Cart command 실행 — 주문·결제 승인이 아님
8. Checkout quote 생성과 사용자 승인 또는 mandate 검증
9. 가격·재고 재검증 → 재고 예약 → 결제 승인 → 주문 생성
10. Ledger read-back과 비동기 reconciliation
```

가격이나 재고가 바뀌면 모델이 이전 값을 유지해서는 안 된다. 기존 quote를 폐기하고 변경 이유와 새 quote를 사용자에게 보여 줘야 한다. 장바구니 변경은 결제 승인이 아니며, checkout quote 생성·승인·재검증·주문 생성은 별도 단계다.

## Production에서 실패하는 지점

### 가격·재고 freshness

검색 index에는 재고가 있어도 주문 시점에는 품절일 수 있다. 답변과 trace에 `offer_id/SKU`, seller, fulfillment channel, locale, quantity, `observed_at`, source version, TTL을 남겨야 한다. Cart 추가와 결제 직전에 가격·재고·배송일을 다시 확인하고 불일치하면 추정하지 않는다.

### 분산 거래의 결과 불명 상태

| 실패 | 필요한 처리 |
|---|---|
| 주문 생성 뒤 응답 timeout | 같은 idempotency key로 결과를 조회하고 원장과 reconciliation |
| Retry로 중복 주문·결제 | Durable result 저장, 동일 key·다른 payload 거절, 결제사 key 연계 |
| 결제 승인 뒤 주문 생성 실패 | 결제 승인 취소와 보상 event |
| 재고 예약 뒤 결제 실패·만료 | 예약 해제와 만료 worker |
| Webhook 중복·역순·서명 실패 | 서명·timestamp 검증, event ID deduplication, 상태 전이 검사 |
| DB commit 뒤 event 발행 실패 | Transactional outbox와 replay 가능한 consumer |
| Streaming 중 quote 변경 | Stream을 중단하고 새 quote 승인 요구 |

관측성도 대화 trace에 머물면 안 된다. Correlation ID, order ID, mandate version, idempotency key, 상태 전이 감사 event, queue age, reconciliation lag, 결과 불명률과 duplicate suppression 수치를 남긴다. Write kill switch, DLQ, replay 정책과 사람 escalation을 함께 준비해야 한다.

### 간접 prompt injection

리뷰, 판매자 설명, 외부 웹 검색 결과는 비신뢰 데이터다. 외부 문서의 명령이 tool 호출로 이어질 수 있다는 문제는 간접 prompt injection 연구와 agent benchmark에서도 반복해서 확인됐다.[25][26]

입력 필터만으로는 부족하다. `trusted policy / authenticated commerce fact / user data / untrusted text`를 분리하고, tool 최소권한, read/write 분리, 금액·수량 한도, egress 제한을 적용해야 한다. Bedrock Agent는 action에 user confirmation을 요구하도록 구성할 수 있지만, 이를 실제 주문 승인 정책 전체와 동일시하면 안 된다.[24]

### Memory와 공동 계정

공동 계정과 공유 device의 memory는 다른 사람의 민감한 관심사를 노출할 수 있다.[5][6] 쇼핑 이력과 Alexa+의 대화·선호를 결합하는 서비스에는 별도 consent와 목적 제한이 필요하다.[6] Memory에는 opt-in, provenance, TTL, 수정·삭제 UI를 두고, 삭제 tombstone을 원문·요약·embedding·cache와 analytics log에 전파해야 한다.

### 공개 샘플의 network와 PII logging

공식 샘플은 Route 53 설정을 생략하면 internet-facing ALB/HTTP 경로를 만들고 ECS task에 public IP를 준다.[16][28] Task security group은 ALB에서 오는 8501 traffic만 허용하므로 public IP가 곧 직접 인터넷 노출이라는 뜻은 아니다. OpenSearch Serverless network policy는 public access를 허용한다.[29]

샘플에는 여러 log가 있지만 alarm, SLO, distributed trace와 PII redaction 정책은 보이지 않는다.[16][17][30] `createOrder` Lambda는 action event를 기록하고 Bedrock model input/output logging도 활성화한다.[21][30] 이름·이메일·주소와 prompt/response에는 최소 수집, redaction, 접근 통제와 보존 기한을 적용하고, 카드 정보는 모델과 일반 log에 넣지 않고 PSP token만 사용해야 한다.

### 거래 이후 lifecycle

기준 커밋의 저장소 정적 검토 범위에서는 취소, 부분 배송, 대체 상품, 반품, 환불과 chargeback 구현을 확인할 수 없다.[14] Production에서는 주문 ID와 상태 전이, saga·outbox·보상 동작, 고객 알림과 사람 escalation을 포함해야 한다.

추천 품질에는 relevance만 있는 것도 아니다. Sponsored placement, seller·brand 편중, 자체상품 우대, 광고 표시와 추천 이유를 평가해야 한다. Off-Amazon 구매에서는 merchant 선택과 판매자 책임도 별도 정책 경계다.

## 평가는 답변 정확도에서 끝나지 않는다

Offline gate는 적어도 다섯 축으로 나누는 편이 낫다.

1. **Freshness:** 시점별 catalog snapshot과 live answer를 분리해 가격·재고·배송·옵션 정확도와 abstention을 평가한다.
2. **Retrieval/ranking:** Recall·NDCG뿐 아니라 diversity, coverage, 품절 노출률, source match와 seller concentration을 본다.
3. **Transaction state:** 자연어 점수보다 최종 DB state, policy 준수, idempotency와 중복 주문 여부를 판정한다.
4. **Security:** 리뷰·판매자 설명·웹·OCR·memory에 간접 injection을 넣고 unauthorized state change와 정상 utility를 함께 측정한다.[26]
5. **Regression:** model, prompt, router, catalog API와 guardrail version마다 golden·adversarial set을 다시 실행한다.

Online experiment에서는 Amazon의 60% 수치를 그대로 목표로 삼으면 안 된다. Eligible user 또는 session을 무작위 배정하고 assignment 기준 ITT를 1차 분석으로 삼아야 한다. Assistant를 자발적으로 사용한 사람만 비교하면 구매 의도가 높은 집단의 자기선택을 제거할 수 없다.

1차 지표는 증분 완료 주문이나 contribution margin으로 둘 수 있다. 다만 반품, 취소, 불만, 잘못된 가격, 품절 노출, latency, 비용과 seller 편중을 guardrail로 함께 둬야 한다. 재고와 seller 노출이 실험군 사이에서 경쟁하면 graph/cluster 기반처럼 간섭을 고려한 설계가 필요하다.[27]

## 비용은 token 단가가 아니라 성공한 거래 기준으로 본다

Rufus 자료에는 상대 비용 개선과 일부 component latency가 공개돼 있다. 그러나 질의당 절대 비용, 사용자당 비용, full-answer P50/P95/P99, retrieval·tool별 latency 분해와 모델별 traffic 비중은 없다.

따라서 조직 내부에서는 다음처럼 측정하는 편이 낫다.

```text
cost per successful assisted order
= (model + embedding + search + tool/API + compute
   + observability + failed/retried transaction cost)
  / policy-compliant completed assisted orders
```

Token 단가만 비교하면 tool 실패, stale 조회, 재시도, cart abandonment, 환불과 취소 비용이 빠진다.

## 결론: LLM은 구매자가 아니라 검증 전 의도 생성기다

Amazon Rufus의 공개 구조에서 배울 점은 “가장 큰 모델을 쓰면 쇼핑 경험이 좋아진다”가 아니다. Model router, query planner와 infrastructure router를 분리하고, 확실한 context는 직접 주입하며, 최신 가격·재고는 live source에서 읽고, 장기 실행은 전통적인 durable service에 맡긴다는 점이다.

Kate Spade는 AWS·Tapestry 발표상 좁은 guided-selling 범위로 고객 대상 출시된 사례다. 하지만 이 글은 실제 운영을 독립 검증하지 않았고, 정량 평가와 내부 transaction architecture도 공개되지 않았다. AWS Guidance는 Bedrock Agent와 Knowledge Base를 시작하는 데 유용하지만 주문 원장, 결제, 실시간 재고와 post-transaction lifecycle을 채워 주지 않는다.

Production 설계에서 지켜야 할 경계는 명확하다.

- 상품 설명은 RAG에서 찾는다.
- 가격·재고·배송일은 live API에서 다시 확인한다.
- LLM은 검증 전 의도와 tool plan 초안을 구조화한다.
- State-changing action은 policy와 사용자 승인을 거친다.
- 주문은 멱등성을 가진 결정론적 서비스가 처리한다.
- 최종 결과는 주문 원장에서 read-back한다.
- Memory와 log에는 동의, TTL, 삭제와 PII redaction을 적용한다.

이 경계를 지우면 자연스러운 답변이 가격 오류, 중복 주문과 개인정보 노출로 이어진다. 커머스에서는 **누가 거래 사실을 확정했는가**가 더 중요하다.

## Sources

[1] https://www.amazon.science/blog/the-technology-behind-amazons-genai-powered-shopping-assistant-rufus
[2] https://aws.amazon.com/blogs/machine-learning/scaling-rufus-the-amazon-generative-ai-powered-conversational-shopping-assistant-with-over-80000-aws-inferentia-and-aws-trainium-chips-for-prime-day
[3] https://aws.amazon.com/blogs/machine-learning/how-rufus-doubled-their-inference-speed-and-handled-prime-day-traffic-with-aws-ai-chips-and-parallel-decoding
[4] https://aws.amazon.com/blogs/machine-learning/how-amazon-scaled-rufus-by-building-multi-node-inference-using-aws-trainium-chips-and-vllm
[5] https://aws.amazon.com/blogs/machine-learning/how-rufus-scales-conversational-shopping-experiences-to-millions-of-amazon-customers-with-amazon-bedrock
[6] https://www.aboutamazon.com/news/retail/alexa-for-shopping-ai-assistant
[7] https://www.aboutamazon.com/news/retail/amazon-agentic-ai-gen-ai-shopping
[8] https://ir.aboutamazon.com/files/doc_earnings/2025/q4/earnings-result/AMZN-Q4-2025-Earnings-Release.pdf
[9] https://www.aboutamazon.com/news/aws/aws-agentic-shopping-assistant-retailers
[10] https://podcasts.apple.com/us/podcast/a-rough-idea-ai-became-kate-spades-concierge-heres-how/id1881350943?i=1000772717030
[11] https://aws.amazon.com/marketplace/pp/prodview-5d6waertx73zq
[12] https://aws.amazon.com/blogs/industries/introducing-seven-new-features-of-the-agentic-shopping-assistant-on-aws/
[13] https://www.amazon.science/publications/reaper-reasoning-based-retrieval-planning-for-complex-rag-systems
[14] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/commit/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015
[15] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/README.md
[16] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/app.py
[17] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/lib/bedrock_product_kb_stack.py
[18] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/bedrock_agent/shopping_agent/action_groups/create_order_actions/api_schema/create_order_actions.openapi.json
[19] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/lib/upload_catalog_and_kb_sync_stack.py
[20] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/lib/product_service_stack.py
[21] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/bedrock_agent/shopping_agent/action_groups/create_order_actions/lambda/index.py
[22] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/source/product_service/index.py
[23] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/source/retail_ai_assistant_app/pages/1_Shopping_Agent.py
[24] https://docs.aws.amazon.com/bedrock/latest/userguide/agents-userconfirmation.html
[25] https://dl.acm.org/doi/10.1145/3605764.3623985
[26] https://arxiv.org/abs/2406.13352
[27] https://proceedings.neurips.cc/paper/2021/hash/32e19424b63cc63077a4031b87fb1010-Abstract.html
[28] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/lib/ecs_app_stack.py
[29] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/lib/opensearch_serverless_stack.py
[30] https://github.com/aws-solutions-library-samples/guidance-for-generative-ai-shopping-assistant-using-agents-for-amazon-bedrock/blob/e2c4d0017b5a37527e9590b65ee5b8d4dc2e9015/deployment/lib/bedrock_logging_setup.py
