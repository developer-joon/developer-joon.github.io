---
title: 'AlloyDB Express scale-to-zero 실측 설계: 에이전트별 임시 PostgreSQL 비용은 얼마나 줄어드나'
date: 2026-11-04 09:00:27 +0900
categories: ["클라우드"]
description: 'Preview인 AlloyDB Express의 생성·15분 유휴 정지·자동 재개·무료 허용량을 CI와 코딩 에이전트용 fixture로 측정하고 보안·비용 경계를 구분한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-google-databases-introducing-alloydb-express-for-rapid-testing-and-prototyping/1600/900'
tags: [google-cloud, alloydb, postgresql, scale-to-zero, finops, ci, coding-agent, database]
---

![AlloyDB Express의 생성과 scale-to-zero 비용 측정](https://picsum.photos/seed/news-2026-11-04-google-databases-introducing-alloydb-express-for-rapid-testing-and-prototyping/1600/900)

Google Cloud는 2026년 11월 4일 AlloyDB Express를 preview로 공개했다. Google은 database를 2초 미만에 만들고, 15분 동안 activity가 없으면 자동 pause해 idle compute 비용을 멈추며, 새 query가 오면 수 초 안에 깨울 수 있다고 설명한다.[1] 이 수치는 공급자 설명이지 우리 workload의 측정 결과가 아니다.

CI와 coding agent가 task마다 격리된 PostgreSQL을 요구한다면 생성 속도와 scale-to-zero가 매력적이다. 그러나 preview를 GA처럼 다루거나 “scale-to-zero = 총비용 0”으로 쓰면 안 된다. Storage, network, observability와 activity로 간주되는 background connection의 영향은 별도로 확인해야 한다.

## 같은 schema로 세 경로를 비교한다

제안 fixture는 migration 20개, row 10만 개, HNSW index 하나와 단순 join을 가진 작은 schema다. 다음 세 경로를 동일한 runner에서 비교한다.

- AlloyDB Express database를 task마다 새로 생성
- 미리 만든 Express를 15분 이상 idle 후 재사용
- Runner 안의 ephemeral PostgreSQL container

각 run에서 `request → endpoint ready`, migration 완료, 첫 query, teardown 시간을 monotonic clock으로 기록한다. Resume 시험은 마지막 client connection을 닫고 15분을 넘긴 뒤 첫 query와 두 번째 query latency를 분리한다. Monitoring agent와 connection pool의 health check가 pause timer를 계속 갱신하는지도 확인한다.

이 글은 해당 fixture를 실제 실행한 benchmark가 아니라 실행 가능한 측정 설계다.

## 비용 단위는 database-hour가 아니라 verified task다

Google은 무료 tier와 사용량 기반 가격, 월 50 CU의 무료 허용량을 소개한다.[1] 실제 계산은 배포 region의 현재 가격표와 billing export로 다시 해야 한다. `compute cost / successful isolated task`를 최종 단위로 두면 실패한 provisioning과 wake retry가 숨지 않는다.

다음 항목을 billing label과 연결한다.

| 항목 | 측정값 |
|---|---|
| Active compute | task 실행과 migration 시간 |
| Idle leakage | pause 전 15분과 background ping |
| Resume | 첫 query까지 시간과 재시도 수 |
| Storage | task 종료 뒤 남은 데이터와 backup |
| Network | runner와 database의 zone·region별 전송 |
| Failure | 생성 실패·quota 대기·cleanup 누락 비용 |

Task 종료가 곧 database 삭제인지, 다음 task를 위해 pause 상태로 보존하는지 정책을 구분한다. 고아 database inventory와 TTL cleanup이 없으면 빠른 self-service가 비용 누수 속도도 높인다.

## 보안 경계

Express는 조직의 IAM, network와 organization policy guardrail을 적용할 수 있다고 발표됐다.[1] Agent에 project-wide database admin을 주는 대신 broker가 제한된 template로 instance를 만들고 task identity에만 access를 부여하는 방식을 제안한다. Password를 prompt나 workspace에 저장하지 않고 workload identity와 짧은 수명의 credential을 사용한다.

Public endpoint를 기본값으로 가정하지 않는다. CI runner에서 private connectivity를 쓸 때 DNS, route, firewall, IP 부족과 provisioning latency를 측정한다. Task 종료 뒤 user, connection, log와 snapshot이 남지 않는지 확인한다.

## Production 승격은 별도 변경이다

Google은 Express database를 data, schema, user와 connection string을 유지한 채 AlloyDB production 구성으로 upgrade할 수 있다고 설명한다.[1] “one click”은 application readiness 보장이 아니다. HA, read replica, backup, PITR, maintenance와 performance policy를 별도로 설정하고 전환 중 connection behavior를 시험한다.

Preview 단계의 adoption gate는 좁아야 한다. 공급자 수치와 독립 측정을 나란히 두고 p95 provisioning·resume, task 성공률, idle leakage와 비용을 보고한다. Quota exhaustion과 region 장애 때 local PostgreSQL 또는 다른 test service로 빠지는 경로도 둔다.

AlloyDB Express의 가치는 database를 오래 켜 두지 않는 데 있다. 실제 절감은 “15분 후 pause” 문구가 아니라 health check를 포함한 실제 activity, wake tail, storage와 cleanup을 합친 청구서에서 결정된다.

## Sources

[1] https://cloud.google.com/blog/products/databases/introducing-alloydb-express-for-rapid-testing-and-prototyping
