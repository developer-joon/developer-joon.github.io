---
title: 'AlloyDB에서 Iceberg를 직접 조인해 보기: 운영 DB와 Lakehouse 사이 복제 제거 실험'
date: 2026-11-04 09:00:29 +0900
categories: ["클라우드"]
description: 'Preview인 AlloyDB direct Iceberg access를 운영 PostgreSQL 데이터와 조인하고, GA인 AlloyDB Sync·Lakehouse federation과 복제·지연·권한·비용 경계를 비교한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-google-databases-direct-iceberg-access-in-alloydb/1600/900'
tags: [google-cloud, alloydb, postgresql, apache-iceberg, lakehouse, data-platform, finops]
---

![AlloyDB 운영 데이터와 Iceberg 테이블의 직접 조인](https://picsum.photos/seed/news-2026-11-04-google-databases-direct-iceberg-access-in-alloydb/1600/900)

AlloyDB for PostgreSQL이 Cloud Storage의 Apache Iceberg table을 등록해 live operational table과 한 SQL에서 직접 조인하는 기능을 preview로 공개했다.[1] Iceberg data를 AlloyDB로 먼저 복제하지 않고 현재 lakehouse copy를 읽으며 AlloyDB columnar engine으로 실행하는 경로다.[1]

같은 발표에는 세 상태가 섞여 있다. **Direct Iceberg access는 preview**, AlloyDB Sync와 Lakehouse federation은 GA다.[1] 셋을 모두 “GA lakehouse 통합”으로 쓰면 안 된다. Direct access의 성능 수치도 Google이 1TB dataset에서 측정한 vendor benchmark이므로 우리 query의 결과로 인용하지 않는다.[1]

## 작은 재현 dataset

제안 fixture는 Cloud Storage의 Iceberg `transaction_history`와 AlloyDB의 `customers`·`current_orders` table을 사용한다. Iceberg에는 partition evolution과 두 snapshot을 만들고, database에는 같은 customer의 현재 risk flag를 둔다. Query는 최근 주문과 5년 이력을 customer ID로 join해 집계한다.

세 경로를 비교한다.

| 경로 | 핵심 질문 |
|---|---|
| Direct Iceberg access | 원본을 제자리에서 읽을 때 freshness·latency·scan 비용은 어떤가 |
| AlloyDB Sync | 복제 지연과 storage를 감수할 때 반복 query latency가 줄어드는가 |
| Lakehouse federation | Query가 어느 engine에서 실행되고 pushdown·권한은 어떻게 보이는가 |

각 run은 query plan, Iceberg snapshot ID, bytes scanned, rows returned, p50·p95, AlloyDB CPU·memory와 비용을 기록한다. Cache warm·cold를 분리하고 동일 snapshot을 pin하지 않은 비교는 폐기한다.

## “복제 없음”의 정확한 뜻

Direct access는 application이 별도 ETL copy를 유지하지 않는다는 뜻이다. Query execution 중 cache, metadata와 temporary data가 전혀 생기지 않는다는 보장은 아니다. 또한 Iceberg의 최신 published snapshot을 읽는 것과 source system의 방금 생성된 event를 읽는 것은 다르다.

Freshness SLO는 source commit, catalog publication, AlloyDB query start와 observed snapshot을 연결해 측정한다. Data team이 schema를 바꿨을 때 type widening, column rename, partition evolution과 snapshot expiration이 query를 어떻게 깨뜨리는지 negative fixture로 둔다.

## 권한과 실패 경계

AlloyDB identity에는 필요한 bucket·catalog·table만 읽게 하고 application database role에는 등록된 foreign table의 필요한 column만 grant한다. “Agent가 AlloyDB에 접속할 수 있다”가 lakehouse 전체를 읽을 권한이 되지 않도록 row·column policy와 query timeout을 둔다.

Cloud Storage 또는 catalog가 실패할 때 operational transaction까지 막히지 않게 connection pool과 endpoint를 분리한다. Direct join은 외부 dependency를 request path에 추가한다. Timeout, stale metadata, partial outage와 large scan을 주입해 transaction table의 정상 query latency가 영향을 받는지 확인한다.

## 비용과 운영 선택

한 번 쓰는 긴 history query는 direct access가 copy를 줄일 수 있다. 자주 반복하는 저지연 query는 sync가 유리할 수 있고, 여러 engine이 같은 governed catalog를 읽어야 하면 federation이 더 자연스러울 수 있다. 이 선택은 제품 상태가 아니라 query frequency, freshness, scan, storage와 failure isolation으로 결정한다.

Preview 기능을 production decision path에 바로 넣지 않는다. Read-only shadow query로 결과 동등성을 확인하고 mismatch·timeout 때 기존 path를 사용한다. Promotion 전에 schema change, snapshot rollback, bucket IAM revoke와 region/network 장애를 시험한다.

복제 제거의 성공 기준은 ETL job 하나를 삭제한 것이 아니다. 같은 snapshot에서 결과가 맞고, live workload의 latency를 해치지 않으며, external outage가 transaction path로 번지지 않고, scan과 compute를 합친 비용이 기존 copy보다 낮아야 한다. Direct Iceberg access는 이 비교를 가능하게 하는 preview 경로이지 비용·성능 우위를 자동 보장하는 기능은 아니다.

## Sources

[1] https://cloud.google.com/blog/products/databases/direct-iceberg-access-in-alloydb
