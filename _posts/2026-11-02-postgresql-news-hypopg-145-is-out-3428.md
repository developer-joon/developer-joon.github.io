---
title: '인덱스를 만들지 않고 실행 계획을 비교하기: HypoPG 1.4.5 실전 검증'
date: 2026-11-02 09:00:07 +0900
categories: ["개발/데이터베이스"]
description: 'HypoPG 1.4.5의 가상 인덱스로 EXPLAIN 계획과 예상 크기를 비교하고, 실제 CREATE INDEX 결과와 분리해 후보를 검증하는 절차.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-postgresql-news-hypopg-145-is-out-3428/1600/900'
tags: [postgresql, hypopg, index, explain, query-planner, database-performance]
---

![HypoPG 가상 인덱스 글의 대표 이미지](https://picsum.photos/seed/news-2026-11-02-postgresql-news-hypopg-145-is-out-3428/1600/900)

대형 table에 index를 만들고 나서 planner가 쓰지 않는다는 사실을 발견하면 이미 시간과 I/O를 썼다. HypoPG는 실제 relation을 만들지 않고 hypothetical index를 session memory에 등록해 `EXPLAIN`에서 planner가 선택할지 미리 볼 수 있게 한다.[1]

2026년 11월 2일 공개된 HypoPG 1.4.5는 `hypo_estimate_index`의 오래된 오류와 hypothetical index의 `relid` 처리에서 crash로 이어질 수 있는 문제를 수정했다. PostgreSQL 9.2 이상 호환을 발표하지만 query가 빨라진다고 보장하는 release는 아니다.[2][3]

가상 index가 답하는 질문은 좁다. **현재 통계와 cost model에서 이 index가 선택될 가능성이 있는가.** 실제 생성 시간, disk usage, write amplification, cache churn, lock, 실제 실행 latency는 별도 검증 대상이다.

## HypoPG가 만드는 것은 planner input이다

Hypothetical index는 catalog에 영구 저장되지 않고 현재 connection의 private memory에 있다. 다른 session과 table storage에 영향을 주지 않으며 `EXPLAIN`에서만 사용되고 `EXPLAIN ANALYZE`에는 쓰이지 않도록 설계됐다.[4]

기본 흐름은 다음과 같다.

```sql
CREATE EXTENSION hypopg;

SELECT * FROM hypopg_create_index(
  'CREATE INDEX ON orders (customer_id, created_at DESC)'
);

EXPLAIN
SELECT *
FROM orders
WHERE customer_id = 42
ORDER BY created_at DESC
LIMIT 20;
```

이 결과에 hypothetical index scan이 보인다고 실제 query가 그 속도로 실행된 것은 아니다. `ANALYZE`를 붙여 실행 시간을 재려 하지 않는다.

## 후보 세 개를 한 번에 비교하지 않는다

여러 가상 index를 동시에 등록하면 planner가 조합을 선택해 어느 후보가 유효했는지 흐려진다. 기준선과 후보별 snapshot을 분리한다.

1. Baseline `EXPLAIN (FORMAT JSON)`
2. Candidate A만 등록한 plan
3. `hypopg_reset()` 후 Candidate B만 등록한 plan
4. 필요한 경우 A+B 조합 plan
5. 선택된 최종 후보만 실제 index로 생성한 plan

Plan text diff는 node ID나 cost 변동 때문에 시끄럽다. Root node, relation, index name, estimated rows, total cost, sort 존재 여부를 구조적으로 추출한다.

## 선택도가 다른 query set을 준비한다

한 query가 index를 쓴다고 전체 workload에 유익한 것은 아니다. 다음 분포를 포함한다.

- 매우 selective한 point lookup
- 고객별 최근 N개처럼 order와 limit가 있는 query
- 넓은 date range scan
- 대부분 row를 읽는 low-selectivity predicate
- write-heavy table의 대표 insert/update

HypoPG는 앞의 네 query에 대한 planner 선택을 보여 줄 수 있지만 마지막 write cost를 측정하지 않는다. Write path는 실제 index를 staging copy에 만든 뒤 WAL, latency, vacuum을 측정해야 한다.

## 예상 크기는 예산이지 실제 값이 아니다

`hypopg_relation_size()` 또는 관련 size estimation 기능은 후보 index의 예상 크기를 제공한다. 1.4.5가 `hypo_estimate_index` 오류를 수정했으므로 version 차이를 확인할 이유가 있다.[2]

아래 **제안 fixture는 이 글에서 실행하지 않았다.** Production table에 index를 만들지 않고 복구 가능한 staging clone을 사용한다.

```text
snapshot_id
postgres_version
hypopg_version
statistics_timestamp
candidate_ddl
estimated_index_bytes
baseline_plan.json
hypothetical_plan.json
actual_index_bytes
actual_plan.json
```

절차는 다음과 같다.

1. 고정 dataset을 적재하고 `ANALYZE`한다.
2. HypoPG 1.4.5에서 후보 size와 plan을 저장한다.
3. 별도 staging database에 같은 DDL로 실제 index를 만든다.
4. `pg_relation_size()`와 실제 `EXPLAIN (ANALYZE, BUFFERS)`를 수집한다.
5. 예상/실제 size와 planner 선택 차이를 기록한다.

Production에서 `EXPLAIN ANALYZE`를 임의 실행하지 않는다. Write query나 대형 scan은 실제로 실행되며 data와 부하를 바꿀 수 있다.

## 통계가 바뀌면 가상 계획도 바뀐다

Planner는 column statistics와 parameter value에 민감하다. Candidate 검토 때 다음을 고정한다.

- dataset snapshot과 row count
- `default_statistics_target` 및 column별 statistics
- PostgreSQL major와 planner GUC
- prepared statement의 generic/custom plan 여부
- extension version과 session

오래된 statistics에서 선택된 hypothetical index는 배포 뒤 선택되지 않을 수 있다. 반대로 production skew를 제거한 synthetic data는 유용한 index를 놓칠 수 있다.

## 실제 index 승인 gate

가상 index가 선택된 뒤에도 바로 production DDL로 승격하지 않는다.

| Gate | 증거 |
|---|---|
| 계획 개선 | 대상 query set에서 sort/scan/cost 변화 |
| 크기 | 예상과 staging 실제 size |
| 읽기 | staging의 latency와 buffer read |
| 쓰기 | insert/update latency, WAL 증가 |
| 운영 | create 시간, lock, replica lag, rollback |
| 중복 | 기존 index prefix와 기능 중복 없음 |

`CREATE INDEX CONCURRENTLY`도 공짜가 아니다. 더 오래 걸리고 실패한 invalid index cleanup이 필요할 수 있다. 배포 runbook에는 진행률, replica lag cap, 취소 기준과 삭제 절차를 넣는다.

## 1.4.5 upgrade 자체를 검증한다

Release note가 relid crash 가능성을 고쳤으므로 여러 schema와 같은 이름의 table을 가진 fixture가 유용하다.[2] 1.4.4와 1.4.5에서 동일 session script를 돌려 crash, wrong relation binding, size estimate를 비교한다. 다만 1.4.4의 실패를 의도적으로 production에 재현하지 않는다.

HypoPG는 index advisor가 아니다. 후보 DDL과 대상 query를 사람이 제시하면 planner의 가설을 싸게 확인하는 도구다. “가상 plan이 좋아 보였다”를 “실제 index가 운영에 이롭다”로 승격하려면 staging의 실제 index와 write·rollback 비용까지 통과해야 한다.

## Sources

[1] https://hypopg.readthedocs.io/en/latest/hypothetical_indexes.html
[2] https://postgresql.org/about/news/hypopg-145-is-out-3428
[3] https://github.com/HypoPG/hypopg/releases/tag/1.4.5
[4] https://hypopg.readthedocs.io/en/latest/usage.html
