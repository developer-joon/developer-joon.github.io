---
title: '수백만 SQLite를 중앙 DB 하나로 관리하지 않는 법: D1 control plane을 hot path 밖으로 빼기'
date: 2026-10-14 05:30:00 +0900
categories: ["개발/인프라"]
description: 'Cloudflare D1의 실제 구조를 바탕으로 query hot path에서 중앙 catalog를 제거하고, routing metadata·usage aggregation·failure domain을 분리하는 방법을 분석한다.'
featured_image: 'https://picsum.photos/seed/d1-control-plane-off-hot-path/1600/900'
tags: [cloudflare, d1, control-plane, durable-objects, workers-kv, metadata, usage-aggregation, failure-isolation]
---

![D1 control plane과 query hot path의 분리](https://picsum.photos/seed/d1-control-plane-off-hot-path/1600/900)

Cloudflare는 D1 database가 550만 개를 넘었다고 보고했다. 별도로 삭제되지 않은 live database 수는 2026년 10월 8일 기준 1년 동안 15배, 2년 동안 65배 증가했다. 하루에 한 번이라도 query를 실행한 daily active database도 같은 기준일에 1년 동안 18배 늘었다.[1] 이 숫자는 Cloudflare가 자사 시스템을 집계한 공급자 보고치다. 독립 benchmark도 아니고, 모든 account가 같은 증가율이나 부하 분포를 보인다는 뜻도 아니다.

그래도 이 사례가 중요한 이유는 분명하다. Database-per-tenant, preview environment별 database, 사용자가 만든 application별 database처럼 **작은 database의 개수**가 급증하면 병목의 위치가 달라진다. 한 SQLite instance의 query plan보다 “이 database는 어디에 있는가”, “삭제됐는가”, “이 account가 한도를 넘었는가”를 답하는 중앙 metadata와 사용량 집계가 먼저 흔들릴 수 있다. D1 문서도 제품을 per-user·per-tenant·per-entity의 작은 database로 수평 확장하는 모델로 설명하고, 유료·Enterprise account는 요청을 통해 수백만~수천만 개 이상의 database를 지원받을 수 있다고 적는다.[2]

이 글은 D1 사용법, ORM 선택, edge database 비교를 반복하지 않는다. Cloudflare가 공개한 실제 architecture를 먼저 좁게 재구성한 뒤, 그 구조에서 일반화할 수 있는 control-plane 설계 원칙을 별도로 제안한다. Cloudflare가 공개하지 않은 내부 Postgres schema, shard 수, 처리량, 지연 분포, SLA는 추정하지 않는다.

## 먼저 세 평면을 분리한다

Cloudflare의 분류는 세 가지다. **Data plane**은 SQL query 요청이며 빠르고 edge에 있어야 한다. **Control plane**은 database 생성·삭제·목록·import/export·time travel 같은 non-query API와 그에 반응하는 내부 flow다. **Background asynchronous plane**은 분석과 billing 관련 workflow이며 eventual consistency를 허용한다.[1]

이 구분은 component 이름보다 dependency 방향을 명확하게 만든다.

```text
Data plane
  request → edge API 또는 D1 binding → Eyeball Worker → database Durable Object

Control plane
  list          → Edge API Worker → Hyperdrive → central Postgres
  create/delete → Edge API Worker → Hyperdrive/Postgres
                                └→ 관련 Durable Object 초기화·상태 전이

Background asynchronous plane
  usage event → edge 집계 → queue → central consumer → 집계 저장소
```

Cloudflare가 공개한 D1에서 database 하나는 SQLite를 사용하는 Durable Object 하나를 기반으로 한다. Dashboard·Wrangler·CLI를 포함한 HTTP API는 edge gateway를 지나 D1 Edge API Worker로 들어간다. CRUD endpoint는 Hyperdrive를 통해 중앙 data center의 Postgres를 사용하고, query는 Eyeball Worker가 관측·retry·error handling을 담당한 뒤 해당 Durable Object로 전달한다. Workers KV는 여러 D1 Worker가 읽는 routing metadata 층이다.[1]

여기서 “control plane을 없앴다”고 읽으면 안 된다. 중앙 Postgres는 database lifecycle과 source of truth에 여전히 중요하다. 바뀐 것은 **모든 query가 중앙 source of truth를 동기적으로 통과하지 않게 한 것**이다. Control plane은 존재하지만 data plane의 정상 실행을 위한 매-request 관문이 아니다.

## Query hot path에서 중앙 catalog를 제거한다

HTTP API를 통한 query는 먼저 Workers KV에서 D1 UUID와 database metadata의 mapping을 찾는다. KV에 항목이 없는 드문 경우에는 Hyperdrive를 통해 Postgres replica로 fallback한다. 이때도 Hyperdrive는 호출 위치의 cache, Postgres 인접 위치의 cache를 차례로 확인하고 두 곳 모두 miss일 때 replica를 조회한다. Mapping을 얻으면 Edge API Worker가 Service Binding으로 Eyeball Worker를 호출하고, Eyeball Worker가 database를 담당하는 Durable Object에 query를 전달한다.[1]

D1 binding 경로는 더 짧다. User Worker에 연결된 binding 자체가 특정 D1 database 접근을 허가하는 정보를 담으므로 UUID mapping을 다시 해석하지 않고 Eyeball Worker와 Durable Object로 간다.[1] Service Binding은 공개 URL을 거치지 않고 Worker가 다른 Worker의 method를 호출하거나 request를 전달하는 Cloudflare의 내부 연결 표면이다.[3]

Workers KV를 단순한 in-memory cache로 보면 이 선택의 의미를 놓친다. 공식 문서상 KV는 소수의 중앙 저장소에 값을 보관하고 각 Cloudflare data center에서 읽은 값을 cache하는, read-heavy workload용 eventually consistent datastore다.[4] 따라서 한 edge cache entry가 밀려났다고 곧바로 D1의 중앙 Postgres가 원본 요청을 받는 구조가 아니다. Cloudflare는 대규모 cache purge 뒤 수백만 database가 routing metadata를 동시에 Postgres에서 찾으려 하면 metastable failure가 날 수 있다고 설명한다.[1]

Hyperdrive cache만으로 충분하지 않은 이유도 여기에 있다. Hyperdrive는 cache 가능한 read query 결과를 재사용해 origin database 부하와 round trip을 줄이지만, miss가 이어지면 결국 중앙 database를 향한다.[5] 반면 KV는 자체 durable storage를 가진 별도 계층이다. 즉 D1은 `edge cache → 중앙 catalog`의 2단계가 아니라, 정상 경로에 `분산 routing store`를 두고 중앙 catalog를 희귀한 복구 경로로 밀어냈다.

이 설계는 평균 latency보다 **동시 miss의 증폭**을 줄인다. 평소 hit rate가 높아도 purge가 모든 resource에 영향을 주면 중앙 database가 갑자기 전체 routing lookup을 감당할 수 있으므로, fallback concurrency를 별도로 제한해야 한다.

## `newUniqueId()`는 ID 생성 방식 이상의 선택이다

Database 생성 때 D1은 database UUID와 새로운 Durable Object ID를 만들고 DO를 초기화한 뒤, mapping을 Postgres와 Workers KV에 기록한다.[1] 공식 API에서 `newUniqueId()`는 무작위 unique ID를 만들며, 다시 찾으려면 그 문자열을 별도 저장해야 한다.[6]

Cloudflare는 name-to-DO-ID 중앙 mapping round trip을 피하려 이 방식을 택했지만, namespace 선택에 필요한 metadata lookup까지 사라지는 것은 아니라고 설명한다.[1] 이름 기반 addressing도 좋은 출발점이므로, D1의 선택을 기본값으로 복사하기보다 resource 수와 mapping 운영비를 비교해야 한다.[1]

## 생성은 분산 transaction 대신 checkpoint와 복구로 완성한다

D1 database 생성은 한 database transaction으로 묶이지 않는다. Account 한도를 확인하고, ID를 만들고, 사용자에 가까운 위치에서 Durable Object를 초기화하고, 중앙 Postgres에 metadata를 기록하고, KV mapping을 쓰는 작업이 서로 다른 위치와 저장소를 지난다.[1]

Cloudflare가 공개한 핵심 순서는 다음과 같다.

1. Edge에서 account의 non-deleted database 수를 읽어 생성 가능 여부를 확인한다.
2. Postgres round trip이 여러 번 필요한 create handler를 Postgres 가까이 전달한다.
3. 원래 요청 위치 가까이 실행을 다시 보내 Durable Object가 사용자 가까이에 놓이도록 초기화한다.
4. 초기화 응답 뒤 Postgres primary에 database metadata를 기록한다.
5. Postgres 기록을 **creation checkpoint**로 삼는다.
6. 최종 confirmation RPC와 KV 갱신은 `waitUntil()`에서 best-effort로 수행하고 heartbeat가 실패를 나중에 교정한다.[1]

먼 곳의 Durable Object 초기화가 끝날 때까지 Postgres connection과 transaction을 열어 두면 단순해 보이지만 scale하지 않는다는 것이 Cloudflare의 설명이다.[1] 대신 retry 가능한 step과 authoritative checkpoint를 정한다. DO 초기화나 Postgres write가 실패하면 새로운 ID로 재시도한다. 같은 database UUID에 서로 다른 DO ID를 재사용하면 여러 object가 자신이 같은 database의 owner라고 믿을 수 있으므로, retry마다 둘 다 새로 만든다.[1]

이 방식은 orphan이 전혀 생기지 않게 보장하지 않는다. 오히려 orphan이 생길 수 있음을 인정하고 **찾아서 스스로 종료되는 경로**를 설계한다. 각 D1 Durable Object는 30초 간격에 database별 jitter를 더해 control plane에 heartbeat를 보내 active/deleted state와 account limit을 읽는다. 초기화된 DO A 뒤 Postgres write가 실패하고 새 DO B로 retry가 성공했다면, Postgres에 없는 A는 다음 heartbeat에서 자신이 존재하지 않는다는 응답을 받고 deleted 상태로 전환한다.[1]

순서도 중요하다. Postgres에 mapping을 먼저 노출한 뒤 DO를 초기화하면 query가 아직 준비되지 않은 object에 도착할 수 있다. D1은 DO를 먼저 초기화하고 mapping을 기록한다. KV가 stale해 삭제된 database로 query를 보내더라도 DO가 자신의 durable storage에 active/deleted state를 가지고 있어 마지막에 거절할 수 있다.[1] KV는 routing 가속층이지 최종 상태 판정자도, 분산 transaction coordinator도 아니다.

## Metadata sharding 전에 metadata의 역할부터 쪼갠다

여기까지는 Cloudflare가 공개한 실제 구현이다. 이제부터는 이를 다른 multi-tenant platform에 적용하기 위한 필자의 일반화다.

첫 번째 원칙은 중앙 metadata table을 곧바로 여러 database shard로 나누는 것이 아니다. 먼저 metadata를 consistency와 호출 빈도에 따라 세 종류로 나눈다.

```text
1. routing metadata
   resource_id → execution target, namespace, generation, state hint
   read-heavy, data-plane에서 사용, stale 허용 범위가 짧고 명확해야 함

2. lifecycle metadata
   owner, plan, create/delete checkpoint, policy, authoritative state
   control-plane source of truth, 강한 변경 순서와 audit가 필요

3. analytical metadata
   bytes, rows, request count, billing window, trend
   append/aggregate 중심, eventual consistency와 재처리가 가능
```

D1은 이 역할을 Workers KV, Postgres, queue·ClickHouse 계열 workflow로 분리한다.[1] 이것을 “Cloudflare가 Postgres를 특정 방식으로 물리 shard했다”는 주장으로 바꾸면 안 된다. 원문은 내부 Postgres의 shard key, shard 수, replication topology를 공개하지 않았다.

조직의 중앙 catalog가 실제 write·index·vacuum·connection 한계에 도달한 뒤 물리 sharding이 필요하다면, shard directory 자체를 query hot path에 두지 않는 것이 다음 원칙이다. Resource를 만들 때 immutable resource ID와 `routing_generation`을 발급하고, data-plane이 읽는 routing record에 execution target까지 materialize한다. Tenant ID만으로 shard를 정하면 큰 tenant 하나가 hotspot이 될 수 있고, resource ID만 hash하면 account 단위 list·quota 계산이 fan-out될 수 있다. 어느 key를 택하든 query routing과 control-plane listing의 요구가 다르다는 점을 먼저 드러내야 한다.

## Usage aggregation은 query마다 합계를 계산하지 않는다

D1의 storage 한도 집계는 작은 database가 많을 때 중앙 metadata가 왜 먼저 병목이 되는지를 잘 보여준다. 각 Durable Object는 storage usage update를 edge server에서 먼저 모은 뒤 Kafka-like internal queue로 보낸다. 중앙 consumer 수를 제한해 Postgres write 부하를 누르고, consumer는 database별 최신 크기를 기록한다.[1]

한도 판정에 필요한 것은 account 전체 storage다. 하지만 database가 수백만 개면 enforcement 시점마다 `SUM(storage) ... WHERE account_id = ?`를 실행하는 비용이 resource 수에 비례한다. D1은 database별 변경에서 storage delta를 change table에 쌓고, 1초마다 scheduled job이 pending row를 원자적으로 가져와 account별로 합친 뒤 account total row를 한 번씩 갱신한다. 개별 event마다 인기 account의 한 행을 직접 update해 lock contention을 만드는 대신, delta를 먼저 모아 쓴다.[1]

각 Durable Object는 heartbeat 때 account total을 읽고 entitlement와 비교한다. 이 조회는 Postgres replica와 Hyperdrive cache를 사용하며 cache key의 parameter를 account ID 하나로 제한한다. 같은 account의 많은 database가 동일 cache entry를 공유하게 하기 위해서다. 현재 database ID까지 parameter에 넣어 더 정확한 여유 용량을 계산하면 database마다 다른 cache key가 생겨 hit rate가 급락하므로, D1은 enforcement 반응이 조금 늦는 쪽을 받아들였다.[1]

이 선택은 “billing은 부정확해도 된다”는 뜻이 아니다. Storage enforcement total은 eventual consistency를 허용하는 운영 신호다. 별도 process가 Postgres usage를 ClickHouse에 snapshot하며, Cloudflare는 그 ClickHouse event를 storage billing의 source of truth라고 설명한다. Row read/write usage는 query 완료 뒤 event를 ClickHouse로 보내고, 중앙 Limiter가 하루 누적치를 account별로 조회해 free-tier 초과 account를 고른다. 제한 상태는 sub-second replication을 제공하는 내부 KV인 Quicksilver에 만료 시각과 함께 기록되고, Durable Object가 edge에서 이를 확인한다.[1]

즉 하나의 `usage` 숫자가 아니라 목적별 원장이 있다.

- **즉시 query 응답**: usage event를 동기 집계하지 않는다.
- **한도 enforcement**: 약간 stale해도 싼 account total을 읽는다.
- **청구와 historical view**: 별도 analytical event store를 source of truth로 둔다.
- **Edge 차단**: 전 세계에 빠르게 복제되는 제한 flag를 읽는다.

Cloudflare Developer Platform 위에서 유사한 시스템을 만드는 팀은 Workers Analytics Engine을 후보로 검토할 수 있다. 공식 문서는 Worker에서 high-cardinality data point를 기록하고 SQL로 조회하며, per-customer analytics와 usage-based billing을 용도로 제시한다.[7] 다만 Analytics Engine의 공식 sampling 문서는 write와 query 단계에서 weighted adaptive sampling을 적용할 수 있다고 밝힌다.[8] 따라서 정확한 금액·credit·중복 제거가 필요한 회계 원장을 sampling 가능한 analytics dataset 하나로 대체해서는 안 된다. 원시 idempotent event 또는 정산 가능한 authoritative ledger와 운영 dashboard를 분리하는 편이 안전하다.

## Queue를 넣으면 duplicate와 backlog가 새 failure mode가 된다

D1 원문은 내부 Kafka-like queue로 update를 batch하고 consumer 수로 Postgres 부하를 제한한다고 설명하지만, 그 내부 queue의 delivery guarantee나 retention 수치를 공개하지 않는다.[1] 따라서 이를 exactly-once pipeline이라고 부를 근거가 없다.

일반화할 때는 at-least-once를 기본 가정으로 두는 편이 안전하다. Cloudflare Queues 공식 문서도 기본 delivery를 at least once로 설명하며, 드물게 중복 전달될 수 있으므로 unique ID와 database primary key 또는 idempotency key로 deduplicate하라고 권고한다.[9] Usage delta에 다음과 같은 identity가 필요한 이유다.

필자의 권고는 event에 `event_id`, resource·account ID, usage dimension, 이전·새 version, 관측 시각을 넣는 것이다. Consumer가 재실행돼도 같은 event를 두 번 반영하지 않고, 순서가 바뀌면 오래된 version을 무시해야 한다. Backlog가 쌓이면 query availability와 별개로 usage freshness가 나빠지므로 oldest event age, duplicate drop, account-total reconciliation drift를 경보로 둔다. 이 schema와 기준은 D1이 공개한 내부 계약이나 SLA가 아니다.

## Failure domain은 component가 아니라 사용자 행위로 정의한다

“Postgres 장애”, “KV 장애”, “queue 장애” 같은 component 목록만으로는 isolation을 검증하기 어렵다. 사용자 행위별로 어떤 dependency가 필수인지 적어야 한다.

| 사용자 행위 | 정상 경로의 필수 dependency | 장애 시 기대 동작 |
|---|---|---|
| 기존 binding으로 query | Eyeball Worker, 대상 DO | 중앙 catalog 조회 없이 계속 실행 |
| HTTP API query | KV routing record, Eyeball Worker, 대상 DO | KV miss 때만 제한된 central fallback |
| database create/delete/list | control-plane API, Postgres, 관련 DO | 실패를 반환하거나 retry·reconcile |
| storage limit 갱신 | usage event, queue, aggregator | query와 분리하고 freshness 저하로 관측 |
| billing/history | analytical store와 정산 job | data-plane과 분리해 재처리 |

이 표의 첫 두 행은 D1 공개 architecture에 근거하지만, “중앙 Postgres가 완전히 내려가도 모든 HTTP query가 성공한다”는 보장은 공개되지 않았다. KV miss fallback, authentication·entitlement 같은 주변 dependency, 이미 cache된 정보의 유효기간이 있기 때문이다.[1] 정확한 failure SLA 대신 검증 가능한 목표를 세워야 한다.

필자의 권고는 네 가지 fault injection이다.

1. **Central catalog 차단**: 이미 생성되고 binding된 database query의 성공률·latency가 유지되는지 확인한다. 새 create/list가 실패하는 것은 data-plane 실패와 따로 집계한다.
2. **Routing key miss 폭증**: KV read failure나 purge를 모사해 fallback concurrency, Hyperdrive cache hit, Postgres connection을 본다. Circuit breaker가 중앙 catalog를 살리면서도 오류를 무한 retry하지 않는지 확인한다.
3. **Usage consumer 중단**: Query availability는 유지하고 account total freshness와 backlog age가 악화되는지 본다. Consumer 재개 뒤 duplicate 없이 따라잡는지 reconciliation한다.
4. **Create 응답 유실**: Checkpoint 뒤 client response만 잃어버려 retry가 중복 resource를 만들지, orphan이 heartbeat나 sweeper로 정리되는지 검증한다.

여기에 metric도 plane별로 분리한다. Data plane에는 `query_success`, p50·p95·p99 latency, KV lookup 결과, fallback 비율, DO overload를 둔다. Control plane에는 create checkpoint latency, retry stage, orphan age, lifecycle reconciliation drift를 둔다. Background plane에는 enqueue failure, backlog age, dedupe rate, aggregate freshness, ledger reconciliation difference를 둔다. 전체를 하나의 “D1 API availability”로 합치면 control-plane 장애가 query를 막았는지, billing lag만 생겼는지 알 수 없다.

## 공개된 것과 공개되지 않은 것을 구분한다

Cloudflare가 공개한 것은 D1의 plane 구분, Edge API·Eyeball Worker·Durable Object·Workers KV·Hyperdrive·Postgres의 역할, 생성 checkpoint와 heartbeat, query routing fallback, storage delta pre-aggregation, ClickHouse·Quicksilver를 이용한 usage enforcement 흐름이다.[1]

공개하지 않은 것은 central Postgres의 실제 table 전체 schema, physical sharding 여부와 shard key, queue partition 수, consumer throughput, cache hit ratio, account별 분포, component별 SLO와 장애 예산이다. 이 글의 `routing_generation`, event field, reconciliation metric, fault-injection 합격 조건은 공개 architecture를 다른 시스템에 적용하기 위한 필자의 제안이지 D1 내부 구현을 추가로 폭로한 내용이 아니다.

이 경계를 지켜야 사례에서 배울 수 있다. 550만 개와 15배·65배·18배는 규모를 보여 주지만 architecture의 보편적 성능 보증은 아니다.[1] 반대로 내부 수치가 없다고 해서 원칙까지 모호한 것은 아니다. Query가 중앙 catalog의 정상 여부에 매번 종속되지 않게 하고, usage를 비동기로 모아 미리 account total로 만들며, stale routing과 중복 event가 생겨도 최종 execution target과 ledger가 교정하게 만드는 구조는 측정 가능한 설계다.

## 결론

많은 작은 database를 운영할 때 “SQLite가 몇 QPS를 처리하는가”만 보면 control plane 병목을 늦게 발견한다. Resource 수가 늘수록 database 생성·삭제 metadata, UUID-to-target routing, account별 usage 합계, limit propagation이 더 큰 shared state가 된다.

D1의 핵심은 중앙 Postgres를 버린 것이 아니다. Transactional lifecycle metadata는 Postgres에 두되, routing metadata는 Workers KV로 data plane 가까이에 복제하고, binding 경로는 mapping lookup 자체를 건너뛴다. Usage는 request 안에서 합산하지 않고 queue와 pre-aggregation으로 옮긴다. 생성은 장거리 distributed transaction 대신 checkpoint·retry·heartbeat로 수렴시킨다.[1]

다른 platform이 복사해야 할 것도 제품 목록이 아니라 dependency 구조다. **Control plane은 느려지거나 일부 멈출 수 있어도 이미 존재하는 database의 query는 가능한 한 계속되어야 한다.** Metadata sharding은 그 목표를 달성하는 수단 중 하나일 뿐이다. 먼저 routing·lifecycle·analytics metadata를 분리하고, 중앙 lookup을 hot path에서 제거하고, asynchronous usage가 늦거나 중복돼도 교정 가능한 원장을 만든 뒤에야 물리 shard가 필요한지 판단할 수 있다.

수백만 database 시대의 확장성은 중앙 catalog가 얼마나 큰가보다, 중앙 catalog에 문제가 생겼을 때 얼마나 적은 query가 그 사실을 알아차리는가에서 드러난다.

## Sources

[1] https://blog.cloudflare.com/d1-control-plane
[2] https://developers.cloudflare.com/d1/platform/limits
[3] https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings
[4] https://developers.cloudflare.com/kv/concepts/how-kv-works
[5] https://developers.cloudflare.com/hyperdrive/concepts/query-caching
[6] https://developers.cloudflare.com/durable-objects/api/namespace
[7] https://developers.cloudflare.com/analytics/analytics-engine
[8] https://developers.cloudflare.com/analytics/analytics-engine/sampling
[9] https://developers.cloudflare.com/queues/reference/delivery-guarantees
