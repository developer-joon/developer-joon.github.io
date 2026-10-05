---
title: 'Cloudflare Basin GA와 Iceberg의 열린 경계 — 이식성을 증명하는 Exit Test'
date: 2026-10-05 09:30:00 +0900
categories: ["개발/인프라"]
description: 'Basin Pipelines·Catalog·SQL이 묶어 주는 분석 경로와 Apache Iceberg가 여는 데이터 경계를 구분하고, catalog·SQL·IAM·maintenance를 실제 이전 시험으로 검증한다.'
featured_image: 'https://picsum.photos/seed/cloudflare-basin-iceberg-exit-test/1600/900'
tags: [cloudflare, basin, apache-iceberg, data-lakehouse, r2, data-portability, exit-strategy]
---

![Cloudflare Basin과 Apache Iceberg Exit Test](https://picsum.photos/seed/cloudflare-basin-iceberg-exit-test/1600/900)

Cloudflare는 2026년 10월 1일 Basin을 GA로 발표했다. 공식 출시 글은 GA 플랫폼의 제품군을 Basin Pipelines, Basin Catalog, Basin SQL로 직접 열거한다. 이 세 제품은 이벤트 수집과 변환, Apache Iceberg 테이블 관리, 분산 SQL 조회를 서버리스 경로로 묶는다. 기존 Cloudflare Pipelines, R2 Data Catalog, R2 SQL은 각각 Basin Pipelines, Basin Catalog, Basin SQL로 이름이 바뀌었으며 기존 resource와 configuration은 계속 동작한다고 문서에 적혀 있다.[1][2]

발표에서 가장 강한 문구는 “open”과 “never locked into a single vendor”다.[1] 그러나 Iceberg를 저장 형식으로 쓴다는 사실과 분석 시스템 전체를 즉시 옮길 수 있다는 결론은 같지 않다. Iceberg가 여는 경계는 주로 data file과 table metadata다. 수집 시점 SQL, catalog의 현재 포인터와 commit 경로, API token, query dialect, compaction과 snapshot expiration 정책은 별도 운영 계약이다. 따라서 이식성은 포맷 이름이 아니라 **Basin을 멈춘 상태에서도 다른 엔진이 같은 테이블을 발견하고, 읽고, 쓰고, 유지할 수 있는가**로 검증해야 한다.

## Pipelines·Catalog·SQL은 한 제품이 아니라 세 개의 경계다

Basin Pipelines는 HTTP endpoint 또는 Workers binding에서 event를 받아 SQL transform을 적용하고, Basin Catalog의 Iceberg table이나 R2의 Parquet·JSON file로 전달한다. 문서는 durable ingestion과 R2로의 exactly-once delivery를 표방한다.[3] 이 층의 편의성은 stream infrastructure를 직접 운영하지 않는 데 있지만, 원본 event schema와 transform SQL이 Basin 밖에서도 실행된다는 뜻은 아니다.

Basin Catalog는 R2 bucket에 저장된 Iceberg table을 관리하고 표준 Iceberg REST catalog interface를 노출한다. Spark, Snowflake, PyIceberg뿐 아니라 DuckDB, Trino, StarRocks 같은 외부 엔진 연결 예제가 제공된다.[4][5] data와 metadata file은 object storage에 있지만, table 목록과 current metadata pointer는 catalog가 조정한다. 문서도 catalog를 비활성화하면 interface의 요청 처리가 즉시 멈추고, catalog에 저장된 table reference는 다시 활성화할 때까지 접근할 수 없다고 설명한다.[6]

Basin SQL은 Basin Catalog의 Iceberg table을 읽는 serverless distributed query engine이지만 범용 database는 아니다. `SELECT`, join, CTE, window function은 지원하는 반면 DML·DDL은 허용하지 않는 read-only 표면이다. `OFFSET`, `UNNEST`, named `WINDOW`, `LATERAL`도 지원하지 않으며, 큰 query는 resource 조건에 따라 거절되거나 timeout될 수 있다.[7] 따라서 SQL 엔진 교체와 Catalog 없이 table state를 이어받는 일은 서로 다른 시험이다.

## Iceberg가 실제로 열어 주는 범위

Iceberg는 schema, partition spec, snapshot과 manifest를 metadata chain에 기록하고 실제 행을 data file에 둔다. Basin Catalog도 REST interface와 여러 호환 엔진 연결을 제공한다.[4][5]

하지만 “파일이 열려 있다”만으로 안전한 이전이 되지는 않는다. object path를 직접 훑어 최신 `metadata.json`처럼 보이는 파일을 고르는 방식은 catalog의 current pointer와 동시 commit 의미를 잃을 수 있다. Cloudflare 문서는 metadata나 data file을 R2에서 직접 삭제하면 catalog corruption이 생길 수 있으며, 삭제는 catalog transaction을 통해 수행해야 한다고 경고한다.[8]

엔진별 Iceberg 지원 수준도 같지 않을 수 있다. schema·partition evolution, delete mode, time travel과 실제 type을 production과 같은 방식으로 읽고 쓰는지 확인해야 한다. “Iceberg-compatible”은 이 조합 전체의 보증서가 아니다.

## Exit Test 1: catalog를 바꿔도 같은 snapshot을 찾는가

외부 엔진을 Basin Catalog에 연결해 namespace와 table을 열거하고, current snapshot ID, schema ID, partition spec, row count·checksum을 기준선으로 저장한다. 이어 canary table에 새 snapshot을 commit하고 Basin SQL과 외부 엔진이 같은 결과를 읽는지 확인한다.

그 뒤에야 별도 Iceberg REST catalog나 조직이 선택한 대체 catalog로 metadata reference를 재구성한다. 이때 합격 조건은 “Parquet 파일이 보인다”가 아니다.

1. namespace와 table 이름이 충돌 없이 재현된다.
2. current snapshot과 snapshot history의 순서가 일치한다.
3. schema·partition evolution 뒤에도 과거와 현재 query가 맞는다.
4. 두 writer의 동시 commit에서 한쪽이 조용히 덮어쓰지 않는다.
5. rollback 또는 time travel 범위가 retention 계약과 일치한다.

먼저 dual-read와 canary write를 거친 뒤 write를 동결한 cutover window에서 pointer를 확정한다. catalog disable은 최종 단계이지 export 기능이 아니다.[6]

## Exit Test 2: SQL 결과뿐 아니라 의미와 비용을 비교한다

실제 query corpus를 두 엔진에서 실행한다. `COUNT(*)`뿐 아니라 null ordering, UTC, decimal, string·regex, approximate aggregate, nested type, join과 window 결과를 비교한다. Basin SQL은 현재 시간 함수를 UTC·10ms 단위로 처리하며 일부 고비용 연산을 실행 전에 거절할 수 있다.[7]

query마다 다음 네 값을 남긴다.

- 결과 row 수와 정규화한 checksum
- 실행 계획에서 partition·file pruning 여부
- 스캔한 compressed byte와 object operation
- p50·p95 latency, timeout·retry 비율

문법 변환본은 원문과 함께 version control에 둔다. 결과가 같아도 scan과 중간 결과가 급증하면 운영에는 실패한 것이다. 외부 엔진에서 수행한 write는 Basin Catalog와 maintenance 경로에서 다시 읽는다.

## Exit Test 3: IAM은 catalog 권한과 object 권한을 함께 끊어 본다

Basin Catalog에 연결하는 엔진은 Cloudflare API token에 Basin Catalog 권한과 R2 storage 권한을 함께 요구한다. Catalog는 이 token의 R2 권한을 상속한 SigV4 credential을 engine에 제공한다. 특히 Catalog가 read-only여도 R2가 read-write이면 vended credential로 underlying object와 catalog metadata file을 쓸 수 있다고 문서가 명시한다.[6]

따라서 “query 전용” 역할은 두 평면 모두 read-only여야 한다. exit test에서는 최소 네 역할을 분리한다.

| 역할 | Catalog | R2 object | 허용 행위 |
|---|---|---|---|
| reader | read | read | list, load, query |
| writer | read/write | read/write | table create, commit |
| maintainer | read/write | read/write | compact, expire snapshot |
| migrator | read 중심, 제한적 write | source read, target write | 검증된 복제·cutover |

허용·금지 동작을 모두 실행한다. reader의 object write, 다른 bucket 접근, 만료 credential 재사용, token 철회 뒤 vended credential의 유효 구간을 확인한다. 대체 환경에서는 새 IAM 주체·scope·rotation·audit event로 매핑한다. data portability는 identity portability가 아니다.

## Exit Test 4: maintenance를 멈췄을 때도 table이 건강한가

streaming ingest는 작은 file과 snapshot을 계속 만든다. Basin Catalog의 automatic maintenance는 compaction으로 작은 file을 합치고 snapshot expiration으로 오래된 snapshot과 참조되지 않는 data file을 제거한다. compaction target은 64~512MB 범위이며, automatic compaction은 현재 Parquet data file만 지원한다. 이전 snapshot에서 한 번도 참조되지 않은 orphan file은 자동 정리 대상이 아니다.[9]

대체 환경에서 다음 작업을 실제로 예약하고 실패를 주입한다.

1. 같은 ingest 부하에서 file count와 평균 file size가 허용 범위로 수렴하는지 본다.
2. compaction 전후 row checksum과 current snapshot을 비교한다.
3. snapshot expiration이 `older-than`과 `retain-last`를 모두 지키는지 확인한다.
4. 보존 기간 안의 time travel은 성공하고, 만료된 snapshot은 정책대로 사라지는지 본다.
5. orphan 탐지·삭제는 dry run 목록과 object age를 검토한 뒤 수행한다.
6. maintenance 중단, 중복 실행, writer 충돌 뒤 재시도와 복구를 검증한다.

object 수동 삭제는 exit 절차가 아니다. `DROP TABLE`, `DROP TABLE ... PURGE`, snapshot expiration은 보존 결과가 다르고 뒤의 두 작업은 되돌릴 수 없다.[8] cutover 전에는 expiration을 보수적으로 조정하고 검증이 끝날 때까지 rollback history를 남긴다.

## no-lock-in과 no-egress는 가격표까지 읽어야 한다

Cloudflare는 다른 cloud·platform·region의 도구로 data를 query할 때 transfer fee가 없다고 발표한다.[1] R2 가격 문서도 egress bandwidth는 무료라고 적지만 storage와 Class A·B operation은 과금하며, Infrequent Access에는 retrieval fee가 있다.[10] Basin 가격도 Pipelines transform·sink delivery, Catalog operation·compaction, SQL scan을 별도로 계산하고 R2 storage·read·write 비용은 예시에서 제외한다고 명시한다.[11]

“no egress”를 migration 총비용 0으로 바꾸면 안 된다. 외부 compute, 대상 storage, R2 operation, catalog call, retrieval, 중복 저장·조회 비용은 남는다. “no lock-in”도 공급자 주장이다. open format과 REST interface는 탈출구의 재료이지 transform·SQL·IAM·maintenance 재현의 면제권이 아니다.

GA도 같은 방식으로 읽어야 한다. 공식 출시 글에서 GA로 발표한 Basin 제품군은 Basin Pipelines·Catalog·SQL이다.[1] 조직별 workload의 성능, consistency, schema evolution, recovery point, 외부 엔진 조합이 자동으로 보증됐다는 뜻은 아니다. 특히 catalog는 현재 non-default jurisdiction의 R2 bucket을 지원하지 않는다는 제한도 문서에 남아 있다.[6]

Basin의 장점은 ingestion, catalog, query를 관리형 경로로 연결하면서 data를 Iceberg에 두고 외부 엔진 접점을 제공한다는 데 있다. 그 장점을 인정하면서도 이식성의 단위를 정확히 잡아야 한다. **Iceberg는 열린 table 경계를 제공하고, exit test는 그 경계 밖의 catalog·SQL·IAM·maintenance를 조직이 실제로 소유하는지 증명한다.** 도입 전에 이 시험을 반복할 수 있다면 “열린 플랫폼”은 마케팅 문구를 넘어 운영 가능한 선택지가 된다.

## Sources

[1] https://blog.cloudflare.com/cloudflare-basin/ — Basin Pipelines·Catalog·SQL을 포함한 Cloudflare Basin 제품군의 GA 공식 출시 글
[2] https://developers.cloudflare.com/basin/ — Basin 개요
[3] https://developers.cloudflare.com/basin-pipelines/ — Basin Pipelines 개요와 GA 상태
[4] https://developers.cloudflare.com/basin-catalog/ — Basin Catalog와 Iceberg REST interface
[5] https://developers.cloudflare.com/basin-catalog/config-examples/ — 외부 Iceberg engine 연결 목록
[6] https://developers.cloudflare.com/basin-catalog/manage-catalogs/ — catalog lifecycle, token·R2 권한, 제한
[7] https://developers.cloudflare.com/basin-sql/reference/limitations-best-practices/ — Basin SQL 지원 범위와 runtime 제약
[8] https://developers.cloudflare.com/basin-catalog/deleting-data/ — Iceberg 삭제·metadata·transaction 경계
[9] https://developers.cloudflare.com/basin-catalog/table-maintenance/ — compaction과 snapshot expiration
[10] https://developers.cloudflare.com/r2/pricing/ — R2 storage·operation·retrieval·egress 가격 경계
[11] https://developers.cloudflare.com/basin/platform/pricing/ — Basin 구성요소별 가격과 R2 비용 제외 범위
