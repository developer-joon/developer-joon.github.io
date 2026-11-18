---
title: 'MongoDB Change Stream을 ClickHouse 분석 테이블로 옮길 때 삭제와 타입 불일치를 처리하는 법'
date: 2026-11-04 09:00:05 +0900
categories: ["개발/데이터베이스"]
description: 'GA가 된 MongoDB CDC ClickPipes의 JSON·structured ingestion, 삭제 tombstone, oplog resume, resync 경계를 실제 문서 변화 fixture로 검증하는 방법.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-clickhouse-blog-mongodb-cdc-connector-clickpipes-ga/1600/900'
tags: [mongodb, clickhouse, clickpipes, cdc, change-streams, data-engineering, schema-evolution]
---

![MongoDB CDC ClickPipes 글의 대표 이미지](https://picsum.photos/seed/news-2026-11-04-clickhouse-blog-mongodb-cdc-connector-clickpipes-ga/1600/900)

MongoDB Change Stream을 ClickHouse로 연결했다고 CDC가 완성되는 것은 아니다. Insert는 쉬운 경로다. 운영에서 문제를 만드는 것은 schema가 제각각인 document, 삭제된 row의 의미, snapshot 중 발생한 update, oplog resume point 유실이다.

ClickHouse는 2026년 11월 4일 MongoDB CDC용 ClickPipes를 GA로 발표했다. Parallel snapshot, structured ingestion, Cloud API와 Terraform 설정이 GA 범위에 포함됐다.[1] ClickHouse는 1.5PB 이동과 수백 production 고객, 최대 100배 analytical query 같은 수치도 제시하지만 모두 공급자 또는 인용 고객 사례다. Workload·요금·query가 다른 환경의 보장으로 일반화하지 않는다.[1]

## JSON mode와 structured mode는 다른 실패를 만든다

기본 mode는 `_id`와 전체 document를 native JSON column에 보존한다. Schema drift를 받아들이기 쉽지만 query마다 JSON path와 type 처리가 필요하다. Structured ingestion은 pipe 생성 때 sample에서 top-level field를 추론하고 column으로 만든다.[2]

MongoDB collection은 polymorphic이므로 structured mode는 예외를 따로 처리한다.

- 빠진 field: Nullable column의 `NULL`
- 예상 밖 field: `_peerdb_malformed_data` JSON
- type mismatch: malformed data와 typed column 결과를 함께 조사
- nested object: 자동으로 모든 하위 field를 column으로 평탄화한다고 가정하지 않음

즉 typed table이 생겼다는 사실은 schema가 깨끗하다는 증거가 아니다. `_peerdb_malformed_data` 비율과 key 분포를 SLI로 둔다.

## Update와 delete는 새 version으로 읽는다

ClickPipes의 MongoDB 기본 table은 `ReplacingMergeTree` 계열을 사용하고 `_peerdb_version`, `_peerdb_is_deleted`를 둔다. Update와 delete는 같은 `_id`의 더 새 version row로 표현되고 background merge는 비동기다.[3]

따라서 아래 query는 시점에 따라 과거 version을 함께 볼 수 있다.

```sql
SELECT * FROM orders WHERE _id = 'A-100';
```

정확한 최신 상태를 검증할 때는 문서가 안내하는 대로 `FINAL`과 delete filter를 사용한다.[3]

```sql
SELECT *
FROM orders FINAL
WHERE _peerdb_is_deleted = 0;
```

`FINAL`을 모든 production analytical query의 무조건적 기본값으로 만들기 전에 비용을 측정한다. Materialized view나 query-time dedup 전략을 workload에 맞게 선택하되, 삭제 tombstone을 놓치지 않는 acceptance test를 유지한다.

## Pre-image가 필요한 삭제와 필요 없는 삭제

Delete event는 document key를 알려 주지만 삭제 전 전체 document가 필요한 pipeline은 MongoDB pre/post image 설정이 필요할 수 있다. ClickHouse 발표는 delete pre-image 지원을 설명한다.[1] 다만 pre-image를 켰다는 사실만으로 모든 historical attribute가 영구 보존되는 것은 아니다. MongoDB 설정, retention, Change Stream event shape를 함께 확인해야 한다.

분석 요구를 먼저 분리한다.

1. 최신 mirror에서 삭제된 row를 숨긴다: `_id`와 tombstone이면 충분할 수 있다.
2. 삭제 시점의 customer segment를 audit한다: delete 전 document 또는 별도 history model이 필요하다.
3. Source collection drop을 목적지 drop으로 해석한다: 공식 FAQ는 source DB/table drop 뒤 destination table을 보존한다고 설명하므로 별도 정책이 필요하다.[4]

## Snapshot과 Change Stream의 경계를 검증한다

Initial snapshot이 오래 걸리는 동안 source write는 계속된다. Parallel snapshot은 collection을 `_id` range로 나눠 속도를 높이지만, 병렬성 자체가 중복·누락 없음의 증거는 아니다.[1]

아래 **제안 fixture는 이 글에서 실행하지 않았다.** 전용 replica set과 disposable ClickHouse service에서 수행한다.

```javascript
// 서로 다른 shape의 제안 문서
{_id: 1, amount: 100, customer: {tier: "gold"}}
{_id: 2, amount: "unknown", coupon: "WELCOME"}
{_id: 3, customer: null}
```

시험 순서는 다음과 같다.

1. 세 문서를 넣고 initial snapshot을 시작한다.
2. Snapshot 진행 중 `_id:1`을 update하고 `_id:2`를 delete한다.
3. 새 field와 다른 type을 가진 `_id:4`를 insert한다.
4. JSON mode와 structured mode를 별도 pipe로 실행한다.
5. 각 `_id`의 source 최종 상태와 ClickHouse `FINAL` 결과를 비교한다.
6. Oplog retention보다 긴 중단을 모의해 resume 실패와 resync 동작을 기록한다.

비교 record에는 source cluster time, resume token 관측, ClickPipe 상태, destination version, malformed data를 넣는다. Row count만 같으면 update와 delete의 의미가 뒤바뀐 오류를 찾지 못한다.

## Oplog retention은 복구 시간 예산이다

ClickHouse의 generic MongoDB guide는 최소 24시간 oplog retention을 요구하고 72시간 이상을 권고한다.[5] 이는 모든 환경의 정답이 아니라 snapshot·장애 복구 시간을 버틸 시작점이다. Change Stream resume point가 oplog에서 사라지면 FAQ는 resync를 안내한다.[4]

따라서 필요한 보존 시간은 다음보다 길어야 한다.

```text
최대 snapshot 시간
+ 최대 connector 중단 시간
+ 운영자 감지·승인 시간
+ 안전 여유
```

Source oplog byte rate가 급증하면 시간 기준 설정만 믿을 수 없다. 실제 earliest retained timestamp와 replication lag를 alert에 포함한다.

## 비용과 성능 수치를 분리한다

ClickHouse 발표의 고객 지연 90% 감소, 타 ETL 대비 5~10배 비용 효율, 최대 100배 query 같은 수치는 유용한 후보 가설이다.[1] 그러나 우리 검증은 다음 항목을 독립적으로 잰다.

- snapshot source impact와 완료 시간
- commit-to-visible lag p50/p95/p99
- malformed document 비율
- delete 반영 시간
- resume·resync 횟수와 재처리량
- ClickPipes data volume·compute 비용

GA는 lifecycle 상태다. 모든 schema와 delete semantics가 application 요구에 맞는다는 인증이 아니다. JSON과 structured mode 중 하나를 고르는 것보다, drift·tombstone·resume 실패를 처음부터 정상 운영 경로로 설계하는 일이 더 중요하다.

## Sources

[1] https://clickhouse.com/blog/mongodb-cdc-connector-clickpipes-ga
[2] https://clickhouse.com/docs/integrations/clickpipes/mongodb
[3] https://clickhouse.com/docs/integrations/clickpipes/mongodb/quickstart
[4] https://clickhouse.com/docs/integrations/clickpipes/mongodb/faq
[5] https://clickhouse.com/docs/integrations/clickpipes/mongodb/source/generic
