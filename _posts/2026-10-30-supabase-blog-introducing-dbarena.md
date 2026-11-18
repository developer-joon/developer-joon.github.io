---
title: '클라우드 Postgres 벤치마크를 믿어도 될까: DBArena 원본 데이터로 직접 재검증하기'
date: 2026-10-30 09:00:01 +0900
categories: ["개발/데이터베이스"]
description: 'Supabase 후원 DBArena의 공개 명령·설정·원시 결과를 이용해 호스팅 Postgres 순위를 재현하고, 가격 시점·메모리·리전·반복 분산을 분리해 읽는 검증 절차.'
featured_image: 'https://picsum.photos/seed/news-2026-10-30-supabase-blog-introducing-dbarena/1600/900'
tags: [postgresql, dbarena, database-benchmark, supabase, amazon-rds, cloud-sql, performance]
---

![DBArena 벤치마크 글의 대표 이미지](https://picsum.photos/seed/news-2026-10-30-supabase-blog-introducing-dbarena/1600/900)

호스팅 Postgres 비교표에서 1등을 찾는 일은 쉽다. 어려운 일은 그 순위가 우리 시스템의 질문에 답하는지 확인하는 것이다. Supabase가 후원하는 DBArena는 Supabase 기본 Postgres와 OrioleDB 베타, Amazon RDS, Google Cloud SQL을 같은 공개 절차로 비교하고 원시 결과까지 공개했다.[1] 공개성은 중요한 진전이지만, 후원 주체와 실험 범위를 지우는 면허는 아니다.

이 글의 결론부터 말하면 **순위를 복사하지 말고 한 test point를 끝까지 재현한 뒤 차이의 원인을 설명해야 한다.** DBArena가 제공한 명령과 메타데이터는 출발점이고, 우리 리전·가격·데이터 분포를 넣은 재실행이 구매 결정의 증거다.

## 공개 결과가 실제로 고정한 조건

첫 공개 라운드는 PostgreSQL 17, 공급자 기본 설정, direct TLS 연결을 사용했다. 데이터가 메모리에 들어가는 `cache-fit`과 RAM의 네 배인 `cache-exceeding`을 나눴고, 30분 워밍업 뒤 60분을 측정했다. 각 test point는 새 환경에서 성공한 실행 세 개를 확보하고, client count별 처리량 중앙값이 가장 높은 동시성을 고른다.[1][2]

핵심 지표도 경계를 함께 읽어야 한다.

- `tpm`: 60분 동안의 평균 transactions per minute
- `tpm/$`: 할인 없는 온디맨드 월 730시간 정가 기준 가격 대비 처리량
- `p95`: 모든 트랜잭션의 p95가 아니라 `New Order` 트랜잭션의 지연

워크로드는 TPC-C에서 파생됐지만 공식 TPC-C 요구 사항을 모두 충족하지 않으며 think time도 꺼져 있다.[1] 그러므로 결과를 “우리 쇼핑몰의 초당 주문 수”로 번역하면 안 된다. 이것은 특정 order-processing 부하에서 최대 처리량을 찾는 비교다.

첫 결과는 2026년 9월 25일부터 10월 1일까지 측정한 62개 공개 결과와 750회가 넘는 개별 실행으로 구성됐다.[1] 이 날짜는 가격과 인스턴스 세대의 snapshot이다. 예약 할인, 계약 할인, 이후 가격 변경을 넣으면 `tpm/$` 순위가 바뀔 수 있다.

## 같은 vCPU가 같은 장비는 아니다

DBArena는 vCPU 수를 맞추지만 RAM 비율은 공급자마다 다르다고 명시한다. AWS와 GCP에서는 load generator를 DB와 같은 zone에 두지만 Supabase는 zone을 선택할 수 없어 같은 region까지만 맞춘다. AWS는 `us-east-1`, GCP는 `us-east1`이고 replica와 cross-region은 범위 밖이다.[2]

따라서 재검증 표에는 적어도 다음 열이 필요하다.

| 축 | 공개 결과에서 확인할 값 | 재실행에서 고정할 값 |
|---|---|---|
| 컴퓨트 | vCPU, RAM, instance type | 동일 tier 또는 실제 구매 후보 |
| 스토리지 | 크기, IOPS, throughput | provisioned 값과 실제 관측값 |
| 네트워크 | region/zone, RTT | load generator 위치와 TLS RTT |
| DB | PostgreSQL·extension 버전 | parameter group과 재시작 여부 |
| 부하 | warehouse 수, client sweep | seed, client count, think time |
| 가격 | 시점, 월 730시간 정가 | 실제 계약 가격과 부가 비용 |

RAM이 더 큰 후보가 `cache-fit`에서 유리한 것은 제품 결함도 부정행위도 아니다. 다만 “같은 vCPU”와 “같은 자원”은 같은 문장이 아니다.

## 한 점만 재현하는 제안 fixture

아래 절차는 **아직 이 글에서 실행하지 않은 제안 fixture**다. 클라우드 비용과 계정 권한이 필요하므로 `--dry-run`과 예산 상한을 먼저 둔다.

1. DBArena 저장소에서 비교할 두 공급자의 동일 tier·scenario `result.json`을 고른다.
2. 파일의 commit, candidate manifest, 가격 snapshot, exact command를 보존한다.
3. `dbarenactl run`을 같은 test point에 성공 3회로 실행한다.
4. 각 실행의 client sweep 전체를 저장하고 published selection rule을 다시 적용한다.
5. 공개 결과와 재실행의 `tpm`, `p95`, RTT, 비용을 나란히 둔다.

DBArena 도구 문서는 `results`가 candidate manifest를 다시 읽어 instance와 가격 입력을 구성하며, 가격 snapshot이 없으면 `pricing: null`인 결과를 경고와 함께 만들 수 있다고 설명한다.[3] 가격 자료가 비어 있는데 `tpm/$`를 계산해 채우지 말아야 한다.

```bash
set -euo pipefail

# 제안 명령: 실제 계정·예산·삭제 절차를 검토한 뒤 실행한다.
dbarenactl run   --candidate candidates/aws/rds/tpcc/manifest.yaml   --test-point xlarge/cache-exceeding   --iterations 3   --dry-run
```

실행 전에는 삭제 실패도 비용으로 취급한다. Sweep ID, 생성 resource, teardown 결과를 별도 ledger에 남기고 종료 후 공급자 콘솔의 잔존 DB·disk·VM을 확인한다.

## 평균 순위보다 반복 분산을 본다

사이트는 peak concurrency에서 중앙값인 한 실행의 상세 수치를 보여 준다. 원시 자료에는 client count별 실행이 남아 있으므로 다음을 다시 계산할 수 있다.[2]

- 세 실행의 최소·중앙·최대 tpm
- 같은 client count의 p95 분산
- peak concurrency가 반복마다 달라지는지
- RTT와 storage metric이 나쁜 실행에 함께 움직였는지
- 오류로 폐기된 실행의 수와 이유

중앙값이 같아도 한 후보의 변동폭이 크면 운영 용량 계획은 달라진다. 평균 tpm만 보고 replica 수를 정하는 대신, 보수적인 하위 실행과 장애 여유를 넣는다.

## 우리 데이터로 넘기기 전에 답할 질문

TPC-C 파생 부하가 실제 병목을 덮을 수 있다. JSONB, 긴 transaction, 대형 index scan, extension, connection pooler, read replica, bulk ingest가 핵심이라면 DBArena 결과는 사전 선별 자료다. 최종 후보에는 anonymized query shape와 실제 row-size 분포를 가진 별도 시험이 필요하다.

검증 결과는 “A가 B보다 빠르다”보다 다음 형태가 안전하다.

> 2026-10-30에 고정한 정가와 `us-east` 단일 리전, PostgreSQL 17 기본 설정, DBArena의 cache-exceeding TPC-C 파생 부하에서 후보 A의 중앙 tpm이 높았다. 우리 재실행 3회의 범위는 X~Y였고 실제 계약 가격을 적용한 순위는 별도다.

DBArena의 가장 큰 가치는 승자를 정해 주는 데 있지 않다. 명령, 설정, 가격 입력, selection rule, 원시 실행을 함께 공개해 **반박 가능한 비교**를 만든 데 있다. 구매 결정도 같은 수준의 provenance를 남길 때 비로소 재현 가능해진다.

## Sources

[1] https://supabase.com/blog/introducing-dbarena
[2] https://dbarena.com/methodology
[3] https://github.com/dbarena/dbarenactl
