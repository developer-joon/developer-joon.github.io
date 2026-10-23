---
title: '요청만 검사하는 WAF는 공격 성공 여부를 모른다: 응답 상관 탐지 설계'
date: 2026-10-23 09:00:12 +0900
categories: ["개발/보안"]
description: '요청의 의심 신호와 같은 HTTP 거래의 응답 증거를 결합해 차단하되, 원문 로그를 남기지 않고 지연·스트리밍·압축·캐시 경계를 검증하는 response-aware WAF 도입 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/response-aware-waf-correlation/1600/900'
tags: [waf, cloudflare, response-security, correlation, data-loss, privacy, streaming, cache]
---

![눈 덮인 소나무 숲 위로 붉고 초록빛 오로라가 펼쳐진 밤하늘](https://picsum.photos/seed/response-aware-waf-correlation/1600/900)

전통적인 WAF는 요청이 origin에 도착하기 전에 URL, header, body의 공격 패턴을 찾는다. 명백한 공격을 일찍 끊는 데 적합하지만, 그 요청을 애플리케이션이 실제로 거부했는지, 민감한 내용을 반환했는지까지는 요청만 보고 알 수 없다. 같은 의심 문자열도 검색 예제, 보안 교육 문서, 취약한 endpoint에서 전혀 다른 결과를 만든다.

Cloudflare는 2026년 10월 21일 **full transaction detection**과 **response rules**를 발표했다. 전자는 같은 HTTP 거래의 요청과 응답을 함께 평가하고, 후자는 조건에 맞는 origin 응답을 requester에게 보내기 전에 WAF 차단 응답으로 바꾼다. 두 기능은 모든 plan에 GA로 제공되며, 첫 managed protection은 php2shell 대응에 쓰였다.[1] 이 제품 발표가 보여 주는 변화는 “응답도 스캔한다”보다 크다. 요청의 **의심**과 응답의 **영향 증거**를 다른 신호로 보존한 뒤 정책 단계에서 결합한다는 점이다.

다만 Cloudflare의 현재 동작을 WAF 일반 표준으로 부르면 안 된다. Cloudflare가 제공하는 managed detection, field, plan별 권한과 rollout 상태는 공급자 제품 계약이다. 이 글의 event schema, fixture, promotion gate, rollback 절차는 그 아이디어를 다른 gateway나 자체 reverse proxy에도 적용하기 위한 운영 설계다.

## 먼저 세 질문을 분리한다

Response-aware WAF는 한 번의 “악성/정상” 판정보다 세 단계로 보는 편이 안전하다.

```text
request suspicion
  이 요청에 조사할 만한 패턴·맥락이 있는가?

response evidence
  같은 거래의 응답에 성공·노출을 시사하는 증거가 있는가?

policy decision
  관측만 할까, 응답을 가릴까, 요청 단계에서 즉시 막을까?
```

Request suspicion은 공격 성공의 증명이 아니다. Cloudflare의 Attack Signature Detection도 signature match metadata를 기록할 뿐 스스로 action을 적용하지 않으며, 실제로 차단됐는지는 배포된 rule과 outcome을 따로 확인하라고 설명한다.[2] 이 구분을 내부 모델에도 유지해야 한다.

Response evidence 역시 단독으로는 충분하지 않을 수 있다. 예를 들어 `200` 상태, JSON content type, “configuration” 같은 단어는 정상 응답에도 흔하다. 반면 특정 관리 endpoint를 겨냥한 의심 요청 뒤, 성공 상태와 내부 구성 형식을 함께 본다면 confidence가 높아진다. 중요한 것은 두 신호가 단지 같은 1분 구간에 있었다는 사실이 아니라 **같은 transaction ID와 같은 policy snapshot**에 속한다는 점이다.

필자의 권고 상태는 다음과 같다. 이것은 Cloudflare protocol field가 아니라 조직 내부의 정규화 모델이다.

```text
request_received
  → request_suspicious | request_clean | request_unknown
  → origin_not_called | origin_called
  → response_evidence | response_clean | response_uninspectable
  → logged | response_blocked | request_blocked | allowed
```

`response_uninspectable`을 `response_clean`으로 바꾸지 않는다. Body가 너무 크거나, streaming이라 끝을 기다릴 수 없거나, 지원하지 않는 encoding이라 해석하지 못한 상태는 “증거 없음”이지 “안전함”이 아니다. Cloudflare의 현재 managed request rules도 plan별 검사 크기가 다르고, limit 뒤의 request content는 완전히 분석되지 않을 수 있다고 문서화한다.[3] 자체 구현도 request와 response 각각에 `complete`, `truncated`, `unsupported` 상태를 둬야 한다.

## Cloudflare 제품에서 확인된 범위

발표 시점의 제품 범위를 먼저 고정하자.[1]

- Full transaction detection은 Cloudflare를 통해 proxy되는 zone에 GA다.
- Managed response protection과 custom response rule은 Free를 포함한 모든 plan에 제공된다.
- 모든 고객은 Log와 Block action을 지원하는 custom response rule을 최대 3개 만들 수 있다.
- Paying customer는 `cf.waf.signature.response.*` detection field를 custom response rule에서 사용할 수 있지만, 발표 시점에는 account별 rollout 중이다.
- Custom response rule은 request·response property와 detection result를 결합할 수 있지만 **response body를 직접 조건식으로 작성하는 기능은 아직 없다**.
- Response block은 origin 응답을 WAF 응답으로 바꾸지만, origin에서 이미 수행한 작업을 되돌리지는 못한다.

마지막 두 줄이 특히 중요하다. Managed full-transaction detection이 response content를 분석한다는 사실과 고객이 임의의 response-body regex를 작성할 수 있다는 말은 다르다. 또한 응답 차단은 정보가 requester에게 나가는 것을 막을 수 있어도, origin의 database write, 외부 API 호출, queue enqueue를 rollback하지 못한다. 상태 변경 endpoint는 여전히 request 단계 인증·인가·입력 검증이 1차 통제여야 한다.

Cloudflare Ruleset Engine 문서는 request phase와 response phase를 별도 순서로 공개한다. 현재 공개 목록에는 request custom rules, rate limiting, managed WAF가 앞쪽에 있고 response 쪽에는 header transform, response 정보를 쓰는 rate limiting, compression, response managed firewall 등이 있다.[4] 이 순서는 vendor 구현이다. 그러나 일반 설계에서도 “어느 representation을 어느 시점에 검사했고, 차단 전에 무엇이 이미 실행됐는가”를 명시해야 한다는 교훈은 같다.

## 안전한 fixture로 상관 관계부터 검증한다

실제 exploit payload, production secret, 고객 PII로 pilot을 시작할 이유가 없다. 아래 내용은 실행 결과를 보고하는 fixture가 아니라 staging에서 검증할 제안이다. 별도 `/__security-fixture__/export` endpoint를 만들고 외부에서 접근할 수 없게 한 뒤 다음처럼 무해한 marker만 사용한다.

```text
Request fixture
method: GET
path: /__security-fixture__/export
header: X-WAF-Fixture: suspicious-request-v1

Origin response fixture
status: 200
content-type: application/json
body marker: "fixture_secret":"NOT-A-REAL-SECRET"
```

`NOT-A-REAL-SECRET`은 어떠한 실제 자격 증명 형식도 흉내 내지 않는다. Endpoint는 file system을 읽거나 명령을 실행하지 않고 고정 JSON만 반환한다. Test용 hostname, isolated cache namespace, synthetic identity를 사용하고 fixture request는 monitoring에서 실제 incident와 구별한다.

최소 네 가지 조합을 실행한다.

| 요청 신호 | 응답 증거 | 기대 결과 | 검증 목적 |
|---|---|---|---|
| 없음 | 없음 | allow | 정상 baseline |
| 있음 | 없음 | log 또는 allow | 의심 요청만으로 과잉 차단하지 않음 |
| 없음 | 있음 | 별도 leak policy에 따라 log | 응답 단독 노출 관측 |
| 있음 | 있음 | response block | 같은 거래의 상관 차단 |

여기에 `401`, `403`, `302`, `500`, 빈 body를 추가한다. 의심 요청 뒤 origin이 `403`을 반환했는데 response rule이 이를 “성공한 공격”으로 세면 안 된다. 반대로 status가 `200`이어도 application-level error JSON일 수 있으므로 status code 하나를 성공 증거로 쓰지 않는다. Content type, endpoint class, response signature와 application outcome을 함께 본다.

상관 관계가 맞는지도 concurrency로 확인한다. Fixture ID가 다른 요청 100개를 섞어 보내고, A 요청의 suspicion이 B 응답의 marker와 결합되지 않아야 한다. Connection 재사용, HTTP/2 multiplexing, retry가 있어도 key는 socket이나 source IP가 아니라 transaction별 immutable ID여야 한다. Retry는 새 attempt ID를 받고 parent operation ID로만 연결한다.

## Detection event에는 원문 대신 최소 증거를 남긴다

Response-aware inspection은 보호 장치가 새 개인정보 수집 장치가 되기 쉽다. 공격 의심 요청에는 cookie, authorization header, form data가 있고, 성공 응답에는 secret이나 고객 정보가 실제로 있을 수 있다. “탐지했으니 원문을 SIEM에 저장한다”는 기본값은 사고 범위를 넓힌다.

필자의 권고 event는 원문 대신 category와 비복원 지문을 저장한다.

```json
{
  "transaction_id": "fixture-tx-0007",
  "policy_version": "response-correlation-v3",
  "request_signal": "fixture_suspicion",
  "response_signal": "fixture_secret_marker",
  "response_status": 200,
  "inspection_state": "complete",
  "decision": "response_blocked",
  "request_body_logged": false,
  "response_body_logged": false,
  "evidence_fingerprint": "hmac-sha256:<keyed-digest>",
  "fixture": true
}
```

이 schema도 제품 제공 field가 아니다. Fingerprint는 plain SHA-256보다 접근 통제된 HMAC이 낫다. 짧은 token이나 정형화된 값은 일반 hash만으로 사전 대입할 수 있기 때문이다. HMAC key는 WAF rule repository나 log와 분리하고 rotation version만 event에 남긴다.

Matched substring, 앞뒤 문맥, 전체 header를 기본 수집하지 않는다. 꼭 필요한 조사에서는 break-glass 권한, 짧은 보존 기간, field-level encryption, 조회 감사, ticket 연결을 요구한다. Cloudflare Sensitive Data Detection은 response body에서 PII·금융정보·secret pattern을 찾지만 matched payload logging을 현재 지원하지 않는다. 또한 이 별도 managed ruleset은 응답 경로 밖에서 탐지하므로 Log action만 가능하고 이미 보낸 response를 차단할 수 없다.[5] 이것은 full transaction response blocking과 다른 제품 경로다. 둘을 “Cloudflare response DLP” 하나로 합쳐 설명하면 latency와 action 경계가 사라진다.

## Blocking은 request 차단과 response 차단을 다르게 측정한다

Request block은 origin 호출 전 끝낼 수 있다. Response block은 origin이 응답을 만든 뒤 requester에게 전달되기 전에 실행된다. 따라서 같은 `blocked` label로 합치지 않는다.

```text
request_blocked
- origin_called = false
- origin_side_effect_possible = false

response_blocked
- origin_called = true
- bytes_released_to_client = 0 이어야 함
- origin_side_effect_possible = true
```

`bytes_released_to_client = 0`은 response block의 핵심 acceptance criterion이다. Log에 block action이 찍혔다는 것만으로 충분하지 않다. Slow client와 fast client, HTTP/1.1과 HTTP/2, body 크기 경계에서 fixture marker가 한 byte도 도착하지 않는지 client capture로 확인한다. 동시에 origin access log에는 요청이 도달했음을 인정한다.

부분 전송 뒤 위험 문자열을 찾았다면 이미 유출된 byte를 회수할 수 없다. 그러므로 inline body 기반 차단은 필요한 inspection window를 보내기 전까지 buffer해야 한다. 이 선택은 보안과 latency의 직접적인 trade-off다.

## 지연과 streaming을 별도 SLO로 둔다

응답을 상관 분석하면 origin time과 edge inspection time이 요청 latency에 더해진다. 특히 body evidence가 필요하면 첫 byte 또는 후속 chunk를 보류할 수 있다. Cloudflare의 response body inspection 문서도 일부 content를 edge에 보관하면 TTFB가 늘거나 incremental delivery가 늦어질 수 있다고 설명한다.[6]

Pilot은 평균만 보지 말고 다음 cohort를 분리한다.

- HTML·JSON의 p50, p95, p99 TTFB 증가
- 작은 body와 inspection limit 근처 body의 total latency
- Cache hit와 cache miss
- Compression별 identity, gzip, Brotli
- HTTP/1.1과 HTTP/2
- Block match와 no-match
- Scanner timeout·unsupported·truncated 비율

SSE, chunked stream, large download, gRPC stream, WebSocket upgrade는 일반 page와 같은 정책에 넣지 않는다. 끝까지 buffer하면 기능 자체가 깨지거나 memory가 무한히 늘 수 있다. 우선 response body 상관 차단에서 명시적으로 제외하고 request protection, authentication, response header·status 관측, application-side output filtering으로 보완한다. 정말 inline 검사가 필요하면 bounded prefix만 검사하고 `inspected_bytes`, `streaming_bypass_reason`을 기록한다. Prefix에서 신호가 없었다고 전체 stream이 깨끗하다고 표현하지 않는다.

Cloudflare 문서는 response body buffering을 `None`으로 설정하면 body를 변경하는 일부 기능을 끌 수 있지만, `Cache-Control: no-transform`은 read-only inspection을 막지 않는다고 설명한다.[6] 이는 Cloudflare 설정의 구체적 동작이다. 일반 gateway에서는 `no-transform`만 보고 security inspection이 꺼진다고 가정하지 말고 실제 route별 effective policy를 read-back해야 한다.

## 압축과 content type은 검사 representation을 바꾼다

Origin이 gzip이나 Brotli로 압축한 body를 보냈을 때 signature가 compressed bytes를 보는지, decoded representation을 보는지 모르면 fixture가 우연히 통과한다. 일반적인 설계 권고는 다음과 같다.

1. Wire bytes와 decoded bytes의 크기를 각각 제한한다.
2. 지원하는 content encoding만 bounded decode한다.
3. 중첩 encoding, 비정상 expansion ratio, decode failure는 `uninspectable`로 기록한다.
4. 검사한 representation과 client에게 보낸 representation을 event에 남긴다.
5. Content type과 실제 parser 결과가 다르면 fail-open으로 조용히 허용하지 않는다.

압축 해제 폭탄을 재현하려고 위험한 payload를 만들 필요는 없다. 작은 고정 fixture를 identity·gzip·Brotli로 각각 인코딩하고 같은 marker가 같은 decision을 내는지만 확인한다. Unsupported encoding fixture도 작은 임의 byte로 만들고 body 원문을 log하지 않는다.

`Content-Type`도 단순 label이 아니다. JSON endpoint가 `text/html`로 잘못 응답하면 HTML용 buffering과 변환이 적용될 수 있다. 반대로 실제 HTML을 `application/octet-stream`으로 보내면 대상에서 빠질 수 있다. Origin의 정확한 media type을 deployment contract로 두고, mismatch rate를 WAF coverage metric과 함께 본다.

## Cache 경계는 “어느 응답”과 상관했는지를 바꾼다

Cache hit에서는 origin이 호출되지 않는다. 그때 request와 결합하는 대상은 방금 생성된 origin response가 아니라 저장된 representation이다. Cloudflare Sensitive Data Detection 문서는 cache와 Workers가 처리한 response도 검사한다고 명시하지만[5], 이 사실을 모든 response rule이나 다른 vendor 제품에 일반화하면 안 된다.

자체 또는 다른 edge를 설계할 때 다음을 따로 시험한다.

```text
cold miss: request → origin → inspect → cache/write? → client
warm hit:  request → cache → inspect? → client
revalidate: request → conditional origin → 304/새 body → inspect → client
stale path: request → stale-if-error object → inspect? → client
```

Cache write보다 inspection이 뒤라면 차단한 민감 응답이 cache에 남아 다음 정상 요청에 제공될 수 있다. 반대로 cache lookup 뒤 검사가 없으면 첫 miss에서 log한 policy가 warm hit에 적용되지 않을 수 있다. 합격 조건은 차단 fixture가 cache에 저장되지 않거나 즉시 purge되고, warm hit·revalidation·stale serving에서도 marker가 client에 도달하지 않는 것이다.

Cloudflare의 Cache Response Rules처럼 origin 응답을 받은 뒤 request와 response field를 함께 쓸 수 있는 기능도 있지만, 공개 field 목록은 status와 response header 중심이다.[7] Cache rule에서 request·response field를 함께 쓸 수 있다는 사실이 response body exploit correlation까지 제공한다는 뜻은 아니다. 제품별 phase와 field를 이름 그대로 확인해야 한다.

## Rollout은 log에서 시작해 block으로 좁혀 간다

첫날부터 zone 전체를 response block으로 바꾸지 않는다. Detection과 mitigation을 분리한 목적은 관측 후 정책을 정하기 위해서다. Rollout 단위는 hostname 전체보다 endpoint class와 response type이 낫다.

### 1. Inventory

민감 data를 반환할 수 있는 endpoint, state-changing endpoint, stream, large download, cacheable path를 분류한다. 각 경로의 owner, expected status·content type, compression, cache policy, 최대 body, latency SLO를 기록한다.

### 2. Shadow detection

`request_suspicious`, `response_evidence`, 둘의 교집합, `uninspectable`을 원문 없이 센다. Security reviewer가 sample transaction의 application outcome과 비교한다. 의심 요청 수를 성공한 공격 수로 보고하지 않는다.

### 3. Inert canary

네 조합 fixture와 concurrency·cache·compression 변형을 canary zone에서 실행한다. Response block에서는 marker byte 0, 정상 case에서는 body hash 일치, origin side effect 없음, event correlation 1:1을 요구한다.

### 4. Narrow block

높은 confidence 조합만 특정 path에 block한다. Documentation, search, customer-upload preview처럼 false positive 비용이 큰 route는 더 오래 log 상태에 둔다. State-changing API에는 response block과 별개로 request authorization과 idempotency 검증을 유지한다.

### 5. Promotion gate

다음 조건을 만족할 때만 범위를 넓힌다.

- False-positive review backlog가 합의한 한도 안이다.
- `unknown`·`uninspectable` 비율과 원인이 설명된다.
- p95·p99 TTFB와 stream first-event latency가 budget 안이다.
- Cache hit에서도 정책 coverage가 확인됐다.
- Raw request·response body가 log나 alert에 남지 않는다.
- Rollback owner와 이전 policy version이 준비돼 있다.

## Rollback은 request protection을 함께 끄지 않는다

Response correlation 때문에 latency나 정상 차단 문제가 생기면 response block만 이전 상태로 되돌려야 한다. Managed request rules, 인증, rate limit까지 한 번에 비활성화하면 장애를 고치는 동안 공격 표면을 넓힌다.

```text
response policy v3 block
  → v3 log-only
  → path scope 축소
  → body inspection 비활성화, header/status 관측 유지
  → request-phase protection은 그대로 유지
```

Rollback 뒤에는 rule 상태만 보지 않는다. 정상 fixture가 다시 전달되고, 차단 fixture가 예상대로 log-only가 됐으며, latency가 baseline으로 돌아왔는지 읽는다. 차단 응답이 cache에 들어갔거나 민감 origin response가 잘못 저장됐을 가능성이 있으면 해당 cache key를 좁게 purge하고 warm-path fixture를 재실행한다. Policy repository에는 version, approver, activation time, rollback reason, affected path를 남기되 payload 원문은 남기지 않는다.

Emergency rollback의 stop condition도 미리 정한다. 예를 들어 정상 응답 차단률, p99 TTFB 증가, stream disconnect, scanner timeout, memory pressure 중 하나가 threshold를 넘으면 자동으로 log-only로 전환하고 담당자를 호출한다. 자동 전환은 완전 disable이 아니라 가장 좁은 안전 상태로 내려가는 것이 좋다.

## Dashboard는 차단 수보다 상관 품질을 보여 줘야 한다

Response-aware WAF의 성과를 `blocked_transactions` 하나로 표현하면 false positive를 성과로 보상하게 된다. 최소한 다음 지표를 분리한다.

- Request suspicion만 있었던 거래 수
- Response evidence만 있었던 거래 수
- 둘이 같은 transaction에서 결합된 수
- Request block과 response block 수
- Origin 호출 여부와 origin side-effect 가능성
- Client에게 전달된 fixture marker byte 수
- Complete·truncated·unsupported·streaming-bypass 비율
- Cache hit·miss별 coverage
- Content encoding별 decode failure
- Policy version별 false positive와 rollback 횟수
- Raw payload logging violation 수
- Endpoint cohort별 p95·p99 TTFB 증가

`block count`가 늘어도 marker가 일부 전달됐거나 privacy violation이 생겼다면 성공이 아니다. 반대로 request suspicion은 많지만 response evidence가 거의 없다면 request signature가 probing을 잘 잡는 것인지, false positive가 많은지 application outcome review가 필요하다.

## 결론

요청만 보는 WAF는 “이 입력이 수상한가?”에 답할 수 있지만, 그 요청이 실제 노출로 이어졌는지는 알 수 없다. Response-aware correlation은 같은 HTTP transaction의 request suspicion과 response evidence를 결합해 그 간격을 줄인다. Cloudflare의 2026년 10월 21일 발표는 이 모델을 GA 제품으로 만들었고, response rule은 matching origin response를 requester에게 도달하기 전에 차단할 수 있다.[1]

그렇다고 응답을 더 많이 저장하고 더 오래 buffer하면 되는 것은 아니다. 안전한 도입 계약은 명확하다.

1. 의심 요청, 응답 증거, 최종 action을 서로 다른 state로 보존한다.
2. 실제 exploit와 secret 대신 고정된 inert marker로 correlation과 zero-byte release를 검증한다.
3. 원문 대신 category와 keyed fingerprint를 남기고, `uninspectable`을 clean으로 바꾸지 않는다.
4. Streaming·compression·cache hit를 일반 HTML miss와 별도 cohort로 시험한다.
5. Response block은 origin side effect를 되돌리지 못하므로 request-phase 통제를 유지한다.
6. Rollback은 response block만 log-only로 내리고 request protection은 보존한다.

좋은 response-aware WAF는 요청과 응답을 모두 봤다는 사실로 완성되지 않는다. **같은 거래를 정확히 묶고, 차단 전에 byte가 새지 않았으며, 검사하지 못한 경계를 숨기지 않고, 민감한 원문을 또 다른 log에 복제하지 않았다는 증거**가 있어야 한다.

## Sources

[1] https://blog.cloudflare.com/full-transaction-waf
[2] https://developers.cloudflare.com/waf/detections/attack-signature-detection/
[3] https://developers.cloudflare.com/waf/managed-rules/
[4] https://developers.cloudflare.com/ruleset-engine/reference/phases-list/
[5] https://developers.cloudflare.com/waf/managed-rules/reference/sensitive-data-detection/
[6] https://developers.cloudflare.com/rules/configuration-rules/response-body-inspection/
[7] https://developers.cloudflare.com/cache/how-to/cache-response-rules/settings/
