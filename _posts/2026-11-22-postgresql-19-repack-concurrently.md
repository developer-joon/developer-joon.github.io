---
title: '운영 테이블 bloat를 중단 없이 줄일 수 있을까: PostgreSQL 19 REPACK(CONCURRENTLY) 검증'
date: 2026-11-22 07:50:00 +0900
categories: ["개발/데이터베이스"]
description: 'PostgreSQL 19 REPACK(CONCURRENTLY)의 online 범위를 잠금 대기, 임시 디스크, WAL, 복제 지연, 취소·실패 복구 관점에서 검증하도록 운영 게이트를 설계한다.'
featured_image: 'https://picsum.photos/seed/hotnews-postgresql19-repack/1600/900'
tags: [postgresql, repack, bloat, wal, replication, database-operations]
---

![잔잔한 호숫가의 돌무더기와 나무 말뚝](https://picsum.photos/seed/hotnews-postgresql19-repack/1600/900)

PostgreSQL 19는 `VACUUM FULL`과 `CLUSTER`의 역할을 통합한 `REPACK`을 도입했다. `REPACK (CONCURRENTLY)`는 읽기와 쓰기를 계속 허용하면서 dead tuple 공간을 회수한다.[1] 그러나 이를 “잠금도, 여유 공간도, WAL 부담도 없다”로 읽으면 위험하다.

아래 내용은 PostgreSQL 19 GA 문서를 바탕으로 한 **online 검증 설계**이며 실행 결과가 아니다. 판단 기준은 잠금 대기, 디스크 최고점, WAL 증가량, replica lag, 취소 뒤 복구 가능성이다.

## REPACK은 왜 공간을 돌려줄 수 있나

일반 `VACUUM`은 재사용 가능한 공간을 테이블 내부에 남기는 경우가 많다. 반면 `REPACK`은 살아 있는 행을 새 파일로 다시 쓰고 인덱스도 새로 만든 뒤 기존 파일과 교체한다. 그래서 dead tuple이 차지하던 공간을 운영체제에 반환할 수 있다. `USING INDEX`를 붙이면 지정한 인덱스 순서에 맞춘 물리 재배치도 수행한다.[2]

작업 중에는 테이블과 모든 인덱스의 임시 복사본이 필요하므로 최소한 **테이블 크기 + 인덱스 크기**만큼의 빈 공간이 있어야 한다. `USING INDEX`가 정렬을 쓰면 테이블 크기 정도가 더 필요하고, 동시 변경 tuple도 별도 저장된다. bloat가 100GB라고 빈 공간 100GB만 준비해서는 안 된다.

`CONCURRENTLY`는 partitioned·UNLOGGED table, materialized view, heap이 아닌 access method, 적절한 replica identity가 없는 table에는 쓸 수 없다. `MAINTAIN` 권한과 repack slot도 필요하다. XID wraparound 방지에는 `VACUUM`을 써야 한다.

## online은 짧은 배타 잠금을 포함한다

동시 실행의 대부분은 `SHARE UPDATE EXCLUSIVE` 잠금 아래 진행된다. 일반 DML은 허용하지만 `VACUUM`, `ANALYZE`, `CREATE INDEX CONCURRENTLY` 같은 유지보수 작업과 충돌할 수 있다. 마지막 파일 교체에는 모든 테이블 잠금 모드와 충돌하는 `ACCESS EXCLUSIVE`가 필요하다.[2][3]

장기 transaction이나 DDL 때문에 잠금을 기다리는 동안 새 DML이 쌓이면 마지막 catch-up도 길어진다. 약 1억 400만 행보다 많은 동시 update/delete나 동시 DDL은 실패 원인이 될 수 있다.[2]

또한 `REPACK (CONCURRENTLY)`는 MVCC-safe하지 않다. repack 시작 전 snapshot을 사용하면서 대상 테이블에는 아직 접근하지 않았던 transaction은 교체 commit 뒤 테이블을 비어 있는 것처럼 볼 수 있다. 장기 `REPEATABLE READ` 보고서나 여러 테이블의 일관된 snapshot을 요구하는 batch가 있다면 “SELECT가 차단되지 않는다”만으로 안전 판정을 내릴 수 없다.

## 진행률에서 멈춤과 대기를 구분한다

`pg_stat_progress_repack`은 초기화, heap scan, sort, 새 heap 쓰기, `catch-up`, 파일 교체, 인덱스 재작성, cleanup을 보여준다.[4] `initializing`은 logical decoding 준비와 XID를 받은 transaction 종료 때문에 길어질 수 있다. `catch-up`에는 동시 변경 적용과 마지막 배타 잠금 대기가 모두 포함된다.

따라서 같은 phase가 오래 유지된다는 사실만으로 hang이라고 결론 내리지 않는다. 다음 query를 함께 보면서 blocker, 처리량, 대기 event를 기록한다.

```sql
SELECT p.pid, p.phase, p.heap_blks_total, p.heap_blks_scanned,
       p.heap_tuples_scanned, p.heap_tuples_written,
       p.index_rebuild_count,
       a.wait_event_type, a.wait_event,
       pg_blocking_pids(p.pid) AS blocking_pids
FROM pg_stat_progress_repack AS p
JOIN pg_stat_activity AS a USING (pid)
WHERE p.relid = 'repack_lab.orders'::regclass;
```

운영 SLO는 미리 정한다. 예를 들어 lock wait 5초, p99 증가 20%, primary 빈 공간 30%, replay lag 2GB 중 하나라도 넘으면 취소한다. 숫자는 예시이며 실제 기준은 평시 부하와 복구 목표로 승인해야 한다.

## disposable 환경용 제안 fixture

**경고:** 다음 fixture는 약 1GB 안팎의 데이터를 만들고 마지막에 `DROP SCHEMA ... CASCADE`로 객체를 삭제한다. 운영 database에서 실행하지 말고, PostgreSQL 19 disposable instance와 전용 database에서만 실행한다. database 이름과 접속 대상을 두 번 확인하고 충분한 디스크를 확보한다.

먼저 bloat 후보를 만든다. 실제 크기는 압축, page 배치, 설정에 따라 달라진다.

```sql
CREATE SCHEMA repack_lab;
CREATE TABLE repack_lab.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL,
  status text NOT NULL,
  payload text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
) WITH (fillfactor = 100);

INSERT INTO repack_lab.orders (customer_id, status, payload)
SELECT g % 100000, 'open', repeat(md5(g::text), 20)
FROM generate_series(1, 1000000) AS g;

CREATE INDEX orders_customer_idx
  ON repack_lab.orders (customer_id);
ANALYZE repack_lab.orders;

DELETE FROM repack_lab.orders WHERE id % 2 = 0;
VACUUM repack_lab.orders;
```

아래 runner는 크기와 WAL LSN을 전후로 남긴다. `lock_timeout`은 마지막 잠금 대기를 제한하는 fixture용 경계다.

```bash
set -euo pipefail

: "${PGDATABASE:?set PGDATABASE to a disposable PostgreSQL 19 database}"
test "$(psql -XAtqc 'SHOW server_version_num')" -ge 190000

target_size_sql="SELECT pg_total_relation_size('repack_lab.orders')"
before_size=$(psql -XAtqc "$target_size_sql")
before_lsn=$(psql -XAtqc 'SELECT pg_current_wal_lsn()')
printf 'before_size=%s before_lsn=%s\n' "$before_size" "$before_lsn"

psql -Xv ON_ERROR_STOP=1 <<'SQL'
SET application_name = 'repack-lab';
SET lock_timeout = '5s';
SET maintenance_work_mem = '512MB';
REPACK (CONCURRENTLY, ANALYZE) repack_lab.orders;
SQL

after_size=$(psql -XAtqc "$target_size_sql")
after_lsn=$(psql -XAtqc 'SELECT pg_current_wal_lsn()')
wal_bytes=$(psql -XAtqc \
  "SELECT pg_wal_lsn_diff('$after_lsn', '$before_lsn')::bigint")
printf 'after_size=%s after_lsn=%s wal_bytes=%s\n' \
  "$after_size" "$after_lsn" "$wal_bytes"
```

DML 지속성은 별도 부하 session에서 `INSERT`·`UPDATE` 성공률과 p95/p99를 기록한다. fixture를 끝낼 때만 `DROP SCHEMA repack_lab CASCADE;`를 실행한다.

## 디스크·WAL·replica lag를 한 묶음으로 본다

WAL은 LSN 차이로 작업 구간 총량을 구하고, `pg_stat_wal.wal_bytes`와 `pg_stat_io`의 WAL write/fsync도 시작·종료 snapshot으로 비교한다. PostgreSQL 19는 `max_repack_replication_slots`를 별도로 두며 기본값은 5다.[5] 동시 repack 수를 이 값까지 무조건 채우지 말고, primary I/O와 standby replay 처리량이 감당하는 수로 제한한다.

physical replica에서는 `pg_stat_replication`의 LSN 차이를 초 단위로 수집한다. 공식 문서도 current WAL과 standby receive/replay 위치 차이를 상태 판단에 사용한다.[6] 최고 lag, 회복 시간, archive 지연과 `pg_wal` 사용량을 본다. replica 회복 전에 다음 테이블을 시작하지 않는다.

디스크도 `pg_total_relation_size` 전후 값만으로는 부족하다. tablespace의 free bytes를 짧은 간격으로 기록해 임시 복사본, 정렬 파일, 동시 변경분이 겹치는 최고점을 잡는다. telemetry가 끊기면 시작하지 않는다.

## 취소와 실패도 fixture의 일부다

성공 경로만 돌리면 운영 절차가 아니다. 부하를 계속 발생시키는 상태에서 repack backend PID를 확인한 뒤 `SELECT pg_cancel_backend(<pid>);`로 취소하는 별도 run을 둔다. 취소 신호 전송 성공과 실제 종료는 다르므로 다음을 확인한다.

1. `pg_stat_progress_repack`에서 해당 PID가 사라졌다.
2. 새 session에서 대상 테이블의 row count와 checksum query가 성공한다.
3. insert/update/delete probe가 정상 동작한다.
4. relation과 index가 valid 상태이며 예상하지 않은 객체가 남지 않았다.
5. filesystem free bytes와 `pg_replication_slots`가 작업 전 기준으로 회복하는지 관찰한다.
6. replica replay lag가 승인 시간 안에 평시 범위로 돌아온다.

같은 검사를 `lock_timeout`과 동시 DDL 실패에도 적용한다. busy table에서는 대부분의 작업 뒤에도 실패할 수 있다.[2] 재시도는 blocker와 용량 원인을 제거하고 application 지표와 replica가 회복된 뒤 수행한다.

## 운영 판정: online은 측정값으로만 승인한다

`REPACK (CONCURRENTLY)`는 긴 배타 잠금을 피하지만 마지막 잠금, MVCC caveat, 복사본용 디스크, WAL과 standby replay 비용은 남는다.

배포 게이트는 간단하다. 지원 대상 테이블과 권한을 확인하고, 장기 transaction·DDL 창을 비우고, 최악의 임시 공간을 확보한다. 그다음 progress와 blocker, DML latency, free bytes, WAL bytes, replica replay lag를 동시에 수집한다. 취소·실패 뒤 데이터와 쓰기 경로가 정상이고 임시 자원이 회수되는 것까지 확인해야 한다. 이 조건을 만족한 테이블과 부하 구간에 한해서만 “online repack”이라고 부르는 편이 정확하다.

## Sources

[1] https://www.postgresql.org/about/news/postgresql-19-released-3449/
[2] https://www.postgresql.org/docs/19/sql-repack.html
[3] https://www.postgresql.org/docs/19/explicit-locking.html
[4] https://www.postgresql.org/docs/19/progress-reporting.html
[5] https://www.postgresql.org/docs/19/runtime-config-replication.html
[6] https://www.postgresql.org/docs/19/warm-standby.html
