---
title: '로컬 동기화가 정말 필요한가: NVMe Postgres와 엣지 복제의 손익분기점 측정'
date: 2026-11-03 09:00:09 +0900
categories: ["개발/데이터베이스"]
description: '중앙 Postgres의 I/O 병목과 로컬 사본의 복제 지연·동기화 비용을 같은 workload로 측정해, NVMe·read replica·edge sync의 손익분기점을 판단하는 방법.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-clickhouse-blog-does-your-application-need-local-data-or-faster-postgres/1600/900'
tags: [postgresql, nvme, local-first, replication, edge-data, latency, database-performance]
---

![NVMe Postgres와 로컬 동기화 비교 글의 대표 이미지](https://picsum.photos/seed/news-2026-11-03-clickhouse-blog-does-your-application-need-local-data-or-faster-postgres/1600/900)

사용자 가까이에 data를 복제하면 read latency는 줄어든다. 대신 authoritative copy가 하나 더 생기고 freshness, conflict, bootstrap, deletion, schema migration을 운영해야 한다. ClickHouse는 로컬 동기화를 도입하기 전에 central Postgres가 정말 storage I/O 때문에 느린지 측정하자는 글을 공개했다.[1]

이 글은 원문이 나온 **2026년 11월 3일을 사건 시점으로 고정**한다. 당시 ClickHouse Managed Postgres는 AWS Public Beta였고 GCP Private Preview였다.[2][3] 이후 11월 9일 AWS가 GA로 전환됐지만 GCP는 계속 Private Preview였다는 공식 후속 발표도 함께 표시한다.[4] 후속 lifecycle 변화가 11월 3일 당시 상태를 소급해 바꾸지는 않는다.

원문은 ClickHouse Managed Postgres를 홍보하는 공급자 글이다. Local NVMe가 모든 network-attached storage보다 빠르거나 중앙 DB가 모든 edge architecture를 대체한다고 일반화하면 안 된다. 올바른 질문은 **두 번째 사본이 주는 latency 절감이 복제 지연과 운영 복잡성보다 큰 workload가 어디인지**다.

## 먼저 병목을 CPU·memory·I/O·network로 나눈다

Postgres가 느리다고 곧 storage가 원인은 아니다. 다음을 같은 시간축에 둔다.

- Query latency p50/p95/p99
- Buffer cache hit와 physical read
- CPU saturation, run queue
- Storage latency·IOPS·throughput
- Lock wait와 connection wait
- Client↔DB network RTT
- Autovacuum, checkpoint, WAL activity

Data set이 memory에 들어오면 NVMe 차이가 작을 수 있다. 반대로 cache를 넘는 random read와 WAL fsync가 병목이면 local NVMe 효과가 커질 수 있다. Connection pool wait를 storage upgrade로 해결하려 하면 비용만 늘어난다.

## 세 architecture를 같은 계약으로 비교한다

### 1. 중앙 Postgres

Application은 authoritative DB를 직접 읽는다. Freshness와 transaction boundary가 단순하지만 먼 region의 RTT와 중앙 병목을 감수한다.

### 2. 중앙 Postgres + read replica

Read를 분산하지만 replication lag가 있다. ClickHouse Managed Postgres의 read replica는 기본적으로 Primary와 direct streaming connection이 아니라 object storage의 WAL segment를 가져와 replay하는 구조라고 문서화돼 있다.[5] HA Standby와 read scaling replica는 별도 역할이다.

### 3. Application-local copy

SQLite나 local cache처럼 가까운 사본을 둔다. Read는 빠르지만 subset 정의, initial sync, change propagation, conflict, revocation을 application이 소유한다. Agent workload처럼 query working set이 prompt마다 달라지면 어떤 subset을 미리 복제할지 예측하기 어렵다는 것이 원문의 논지다.[1]

## 평균 latency가 아니라 freshness를 같이 잰다

로컬 사본은 2ms, 중앙 DB는 20ms라고 해도 local data가 3초 늦으면 주문 상태나 권한 조회에는 쓸 수 없다. 각 read에 다음을 붙인다.

```text
read_latency_ms
source_commit_lsn_or_version
replica_visible_version
replication_lag_ms
served_from
staleness_budget_ms
```

Product catalog와 ACL은 같은 freshness budget을 쓰지 않는다. 데이터 종류별로 `central_only`, `replica_ok`, `local_ok`를 분류한다.

## 제안 fixture: 세 경로를 같은 workload로 실행한다

아래는 **이 글에서 실행하지 않은 제안 fixture**다. 공급자 benchmark를 재현했다고 주장하지 않는다.

1. 같은 PostgreSQL major, schema, data seed를 사용한다.
2. Local NVMe와 network block storage 후보의 CPU·RAM·Postgres 설정을 맞춘다.
3. 같은 region의 load generator에서 cache-warm·cache-cold를 분리한다.
4. Read replica 또는 local SQLite projection을 추가한다.
5. Read 80%/write 20%, write-heavy, agent-like random traversal을 각각 실행한다.

| 경로 | 성능 | 정확성 | 운영 비용 |
|---|---|---|---|
| Central | query p50/p99, RTT | commit 직후 read | DB·network 비용 |
| Read replica | query + lag | stale window | replica compute/storage |
| Local copy | local read + sync | missing/conflict/delete | sync service·사본 수 |

Cache-cold 실행은 OS와 DB cache 상태를 명시하고, 반복마다 순서를 randomize한다. Storage 후보의 provisioned IOPS와 실제 관측 IOPS를 모두 남긴다.

## 공급자 benchmark는 configuration까지 인용한다

ClickHouse 글은 Managed Postgres NVMe와 PostgresBench를 근거로 network-attached 후보보다 낮은 latency와 높은 throughput을 주장한다. HA 비교에서는 두 synchronous standby를 둔 자사 구성과 Amazon RDS Multi-AZ의 같은 두-standby quorum 구성에서 약 4배 throughput을 보고한다.[1] 이는 ClickHouse 측 benchmark이며 instance, 가격, region, dataset, client count를 확인하지 않고 보편 수치로 쓰지 않는다.

검증 보고서에는 최소한 다음을 붙인다.

- 공급자와 instance type
- CPU/RAM, storage type·size·IOPS
- PostgreSQL version과 parameter
- HA topology와 synchronous commit 설정
- Dataset size, cache ratio, query mix
- Client count, region/zone, run duration
- 반복 수와 분산

“NVMe”라는 media label 하나로 결과를 설명하지 않는다.

## Analytics offload도 별도 consistency model이다

원문은 WalShadow와 `pg_clickhouse`를 중앙 data layer의 확장 경로로 소개한다. WalShadow의 약 200ms commit-to-visible은 ClickHouse benchmark 수치이고 기능은 Private Preview다.[1] 공식 문서도 Postgres→ClickHouse replication이 asynchronous이고 두 database가 transaction boundary를 공유하지 않으므로 최신 committed state가 필요한 read는 Postgres를 사용하라고 설명한다.[6]

따라서 analytical engine을 붙였다고 local sync 문제가 사라지는 것은 아니다. Freshness와 failure recovery를 다른 계층에서 운영하게 된다.

## 손익분기점을 계산하는 방법

두 번째 사본의 월비용은 compute만이 아니다.

```text
benefit = 절감된 사용자 대기 + 중앙 DB 증설 회피
cost = replica/sync compute + storage + egress
     + schema·conflict·incident 운영 시간
     + stale read로 인한 business risk
```

정량화가 어려운 risk는 0으로 두지 말고 scenario로 둔다. 예를 들어 권한 철회가 5초 늦을 수 있는 local copy는 latency 이득과 별개로 탈락할 수 있다.

Central Postgres가 SLO를 만족하면 가장 단순한 architecture가 이길 수 있다. 만족하지 못할 때도 곧바로 모든 data를 edge로 보내지 않는다. Read replica, query/index 개선, analytical offload, bounded local subset을 순서대로 검토하고 각각의 freshness 계약을 측정한다.

## Sources

[1] https://clickhouse.com/blog/does-your-application-need-local-data-or-faster-postgres
[2] https://clickhouse.com/blog/postgres-managed-by-clickhouse-beta
[3] https://clickhouse.com/blog/postgres-managed-by-clickhouse-gcp-private-preview
[4] https://clickhouse.com/blog/managed-postgres-ga-xata-acquisition
[5] https://clickhouse.com/docs/products/managed-postgres/read-replicas
[6] https://clickhouse.com/docs/products/managed-postgres/overview
