---
title: 'pgBadger 13.3으로 같은 쿼리가 두 번 집계되는 로그 분석 함정 재현하기'
date: 2026-11-03 09:00:06 +0900
categories: ["개발/데이터베이스"]
description: 'log_min_duration_statement와 auto_explain이 한 실행을 함께 기록할 때 pgBadger 13.2·13.3의 실행 횟수와 총 시간이 어떻게 달라지는지 검증하는 로그 fixture.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-postgresql-news-pgbadger-v133-has-been-released-3435/1600/900'
tags: [postgresql, pgbadger, auto-explain, query-performance, logging, observability]
---

![pgBadger 로그 분석 글의 대표 이미지](https://picsum.photos/seed/news-2026-11-03-postgresql-news-pgbadger-v133-has-been-released-3435/1600/900)

성능 보고서에 같은 query가 200번 실행됐다고 나왔다. 실제 application은 100번만 호출했다면 어디서 두 배가 됐을까. PostgreSQL의 `log_min_duration_statement`와 `auto_explain`이 같은 실행을 각각 기록하고 log parser가 둘을 별도 실행으로 세었을 가능성이 있다.

pgBadger 13.3은 이 중복 집계 문제를 수정한 maintenance release다. Multiline statement, `Query Parameters`, explain plan copy, remote watch filter와 동시 실행용 temporary file 이름 문제도 함께 고쳤다.[1] 새 기능의 크기보다 중요한 것은 **보고서 숫자가 실제 실행 수를 보존하는지 작은 fixture로 확인하는 것**이다.

## PostgreSQL log는 실행의 원본과 동일하지 않다

`log_min_duration_statement`는 설정한 threshold 이상 걸린 statement를 기록한다. `0`이면 모든 statement를, 음수면 duration logging을 끈다.[2] `auto_explain`은 threshold를 넘은 statement의 execution plan을 server log에 남기며 `auto_explain.log_analyze`를 켜면 실제 실행 통계를 수집한다.[3]

두 기능은 목적이 다르다.

- duration log: 어떤 SQL이 얼마나 오래 걸렸는가
- auto_explain: 그 SQL이 어떤 plan으로 실행됐는가

같은 backend execution이 두 log record를 만들 수 있다. Parser가 correlation을 잃으면 count와 total duration이 부풀고 “가장 비싼 query” 순위가 바뀐다.

## 13.3 수정 범위를 정확히 읽는다

PostgreSQL news와 v13.3 release tag는 “`log_min_duration_statement`와 `auto_explain`이 보고한 같은 실행을 두 번 세는 문제”를 수정했다고 명시한다.[1][4] 이것은 PostgreSQL 실행 자체가 중복됐다는 뜻이 아니다. pgBadger가 log를 해석해 만든 aggregate가 중복됐다는 뜻이다.

13.3은 maintenance release다. Query가 빨라지거나 database 부하가 줄어드는 release로 표현하면 안 된다. 바뀌는 것은 주로 분석 결과의 정확성과 parser 안정성이다.

## 최소 fixture의 관측 기준

아래 fixture는 **이 글에서 실행하지 않은 제안**이다. Disposable PostgreSQL과 고정한 log file을 사용한다. Production에서 logging을 갑자기 확대하지 않는다. `auto_explain.log_analyze`는 overhead가 있고, `log_timing`도 비용을 늘릴 수 있다.[3]

PostgreSQL 설정 예시는 다음과 같다.

```conf
shared_preload_libraries = 'auto_explain'
logging_collector = on
log_destination = 'stderr'
log_line_prefix = '%m [%p] db=%d,user=%u,app=%a '
log_min_duration_statement = 0
auto_explain.log_min_duration = 0
auto_explain.log_analyze = on
auto_explain.log_timing = off
```

`log_line_prefix`에 timestamp와 PID를 넣어 한 backend의 record를 대조한다. 실제 설정 이름과 허용값은 시험하는 PostgreSQL major의 문서를 확인한다.

동일 query를 정확히 20번 실행한다.

```sql
CREATE TABLE fixture_items AS
SELECT i AS id, repeat('x', 100) AS payload
FROM generate_series(1, 10000) AS g(i);

SELECT count(*) FROM fixture_items WHERE id % 10 = 0;
```

마지막 `SELECT`만 script loop에서 20회 실행하고, client 성공 횟수와 server log의 statement identity를 별도 기록한다.

## 13.2와 13.3은 같은 log bytes를 읽어야 한다

두 version에서 database workload를 각각 돌리면 log 내용 자체가 달라져 parser 차이를 분리하기 어렵다. 한 번 생성한 immutable log file을 복사해 각 container에 read-only로 제공한다.

```bash
set -euo pipefail

# 제안 명령. image digest는 실제 실행 전에 고정한다.
sha256sum fixture-postgresql.log > fixture-postgresql.log.sha256

pgbadger-13.2 fixture-postgresql.log -o report-13.2.html
pgbadger-13.3 fixture-postgresql.log -o report-13.3.html

sha256sum -c fixture-postgresql.log.sha256
```

위 binary 이름은 설명용 wrapper다. 실제 release artifact나 container 안의 `pgbadger` version을 출력하고 tag·digest를 ledger에 남긴다. HTML만 눈으로 비교하지 말고 pgBadger가 지원하는 machine-readable output을 함께 생성해 query count와 total duration을 추출한다.

## 기대 결과를 먼저 고정한다

Fixture acceptance는 다음과 같다.

| 항목 | 기대 |
|---|---:|
| client 성공 실행 | 20 |
| 원본 log의 대상 execution | 20 |
| 13.3 report execution count | 20 |
| explain plan 연결 | 20개 execution에 대응 |
| `Query Parameters` | fixture에 있으면 query와 연결 |

13.2가 반드시 정확히 40을 보여야 한다고 미리 단정하지 않는다. Log format, prepare/bind, multiline 여부에 따라 bug trigger가 달라질 수 있다. 중요한 것은 실제 실행 20회를 ground truth로 두고 두 parser 결과와 record linkage를 조사하는 것이다.

## Multiline과 parameter도 한 fixture에 섞지 않는다

13.3 release에는 multiline SQL과 `Query Parameters` 처리 수정도 있다.[4] 모든 trigger를 한 번에 넣으면 실패 원인을 알기 어렵다. Fixture를 세 개로 나눈다.

1. 중복 집계: 단일 line statement + auto_explain
2. multiline: 같은 query를 여러 line으로 기록
3. parameter: prepared statement와 `Query Parameters`

각 fixture가 독립적으로 통과한 뒤 조합 fixture를 추가한다. Query text normalization이 달라진 경우 “count가 없어졌다”가 아니라 다른 fingerprint로 갈라졌는지도 확인한다.

## 보고서를 부하 측정기로 오해하지 않는다

pgBadger는 설정된 log에 들어온 실행만 분석한다. Threshold 아래 query, logging이 꺼진 session, 잘린 log, rotation 사이에서 유실된 bytes는 보이지 않는다. HTML의 total time은 database 전체 CPU time과 같은 값도 아니다.

운영 upgrade 전후에는 다음을 함께 본다.

- PostgreSQL이 기록한 대상 statement 수
- log file byte 수와 rotation gap
- pgBadger parsed/unparsed line 수
- query fingerprint별 count·duration
- parser warning과 temporary file collision

13.3으로 report가 작아졌다면 부하가 줄었다고 결론 내리지 않는다. 중복 제거로 집계가 교정됐는지 원본 log와 대조한다. 관측 도구의 upgrade도 application release와 마찬가지로 ground truth fixture가 필요하다.

## Sources

[1] https://postgresql.org/about/news/pgbadger-v133-has-been-released-3435
[2] https://www.postgresql.org/docs/current/runtime-config-logging.html
[3] https://www.postgresql.org/docs/current/auto-explain.html
[4] https://github.com/darold/pgbadger/releases/tag/v13.3
