---
title: 'Lakebase Postgres Google Cloud GA 검증: Scale-to-Zero·브랜치·PITR의 실제 운영 경계'
date: 2026-11-02 09:00:10 +0900
categories: ["개발/데이터베이스"]
description: 'Google Cloud에서 GA가 된 Lakebase Postgres의 지역·scale-to-zero·branch·instant restore·OAuth·Private Service Connect 경계를 운영 체크리스트로 검증한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-databricks-blog-lakebase-postgres-now-generally-available-google-cloud/1600/900'
tags: [databricks, lakebase, postgresql, google-cloud, scale-to-zero, pitr, high-availability]
---

![Lakebase Postgres Google Cloud GA 글의 대표 이미지](https://picsum.photos/seed/news-2026-11-02-databricks-blog-lakebase-postgres-now-generally-available-google-cloud/1600/900)

GA는 “이제 운영 검토를 시작할 수 있다”는 lifecycle 신호이지 모든 workload에 준비됐다는 인증은 아니다. Databricks는 Lakebase Postgres의 Google Cloud GA를 발표하며 serverless autoscaling, scale-to-zero, branching, point-in-time 계열 restore, Unity Catalog 통합과 HA endpoint를 소개했다.[1]

발표문은 Lakebase Search가 pgvector 대비 처리량 2배, 비용 4분의 1이라는 자체 시험도 제시한다.[1] 하지만 이는 **GCP에서 별도 Beta인 Lakebase Search subfeature**의 benchmark다. Lakebase Postgres 본체의 GCP GA가 Search를 GA로 올린 것은 아니며, GCP release note도 Search를 Beta로 따로 기록한다.[2] 1TB를 5분 미만에 적재했다는 수치와 함께 공급자 benchmark로만 다뤄야 하고, 완전한 비교 configuration이 없는 수치를 구매 SLO로 옮기지 않는다.

운영 검증은 여섯 경계로 나눈다. **지역, compute wake-up, branch 격리, restore, 인증, private network**다.

## GA 지역을 먼저 고정한다

Google Cloud release note는 2026년 10월 30일 GA와 함께 기존 `us-east4`, `us-central1`, `europe-west3`에 `us-west1`, `asia-southeast1`을 추가했다고 기록한다.[2] Global GA 발표가 모든 GCP region 지원을 뜻하지 않는다.

Architecture 문서나 검색 결과가 이전 Beta 문구를 보일 수 있으므로 announcement date와 current release note를 함께 읽는다. Project 생성 API에서 실제 selectable region을 확인하고, application·lakehouse·egress·data residency 요구와 맞춘다.

## Scale-to-zero는 무료 idle과 wake-up을 함께 산다

공식 문서는 inactivity timeout 기본값 24시간, 허용 범위 60초~7일, 32 CU 이하 compute라는 경계를 둔다. Suspended compute에 connection 또는 query가 오면 재활성화하며 application은 짧은 wake-up을 견디는 retry를 구현해야 한다.[3]

검증할 값은 “몇 백 ms” 한 번이 아니다.

- idle timeout이 실제 마지막 query/connection 기준으로 적용되는가
- suspend 직후 첫 connection p50/p95/p99
- connection pool의 retry와 timeout 순서
- 동시에 몰린 first request의 성공률
- OAuth token이 wake-up 중 만료될 때의 error
- Scale-to-zero를 끈 endpoint와 비용·latency 차이

24시간 기본값을 확인하려고 하루 기다릴 필요는 없다. 전용 dev compute에서 허용된 최소 timeout을 사용하되 production setting과 구분한다.

## Branch와 restore는 backup을 대체하지 않는다

Lakebase branch는 parent와 Copy-on-Write storage를 공유하고 child 변경이 parent에 영향을 주지 않는 독립 environment다. Current data 또는 restore window 안의 past data에서 만들 수 있다.[4]

Point-in-time에서 새 branch를 만들 수 있다는 사실은 application이 복구됐다는 뜻이 아니다. 다음을 확인한다.

1. 원하는 timestamp가 restore window에 있는가
2. 새 branch의 schema·row invariant가 맞는가
3. Credential과 network route가 준비됐는가
4. Application write를 어느 시점에 차단하는가
5. 기존 branch와 새 branch의 divergent write를 어떻게 처리하는가
6. Traffic 전환과 rollback owner가 누구인가

Restore drill은 원본 branch를 덮지 않고 새 branch에서 검증한 뒤 routing을 바꾸는 방식으로 시작한다. Backup export와 독립 보존 요구가 있다면 branch 기능과 별도로 설계한다.

## OAuth는 한 시간, connection은 더 오래 살 수 있다

Lakebase는 Databricks OAuth token과 native Postgres password 인증을 지원한다. OAuth token은 한 시간 뒤 만료되지만 만료는 login 때 검사되며 이미 열린 connection은 token 만료 뒤에도 유지될 수 있다. 모든 connection에는 24시간 idle timeout과 최대 3일 수명 경계가 있다.[5]

Built-in PgBouncer는 OAuth authentication을 지원하지 않으므로 pooled connection에는 native Postgres password role을 검토해야 한다.[5] 이는 “OAuth를 켰다” 하나로 끝나지 않는 이유다.

Authentication fixture는 다음을 분리한다.

- 유효 token으로 새 connection
- 만료 token으로 새 connection 실패
- Token 만료 전 열린 connection의 계속 사용
- Service principal token rotation
- Pooler 경유 password role
- Workspace가 다른 token의 거부

## Private Service Connect의 443과 5432는 다른 길이다

GCP Private Service Connect 문서는 workspace/API traffic의 inbound PSC(443)와 외부 application의 regional Postgres connection을 위한 performance-intensive services endpoint(5432)를 구분한다. Regional connection string을 외부에서 쓰는 Postgres client는 후자가 필요하고, Data API만 쓰는 경우는 요구가 다르다.[6]

Private Service Connect는 Beta라고 release note에 명시돼 있다.[2] GA database와 Beta network capability를 같은 상태로 표현하지 않는다. DNS, certificate hostname, firewall, port, connection string 형태를 current docs에서 그대로 복사한다.

## 제안 운영 fixture

아래는 **이 글에서 실행하지 않은 제안 fixture**다. 지원 GCP region의 작은 전용 project와 synthetic data에서 수행한다.

| 순서 | 시험 | 통과 증거 |
|---|---|---|
| 1 | 표준 driver 연결 | TLS·role·database identity |
| 2 | 최소 timeout 뒤 wake-up | retry 횟수와 first-query latency |
| 3 | Child branch 쓰기 | Parent에 변경 없음 |
| 4 | 과거 시점 branch | 선택 시각의 marker row |
| 5 | OAuth 만료 | 새 login 실패, 기존 session 경계 |
| 6 | PSC 경로 | Public egress 없이 443/5432 분리 확인 |
| 7 | 삭제·restore drill | owner, RTO, data invariant |

각 run은 project ID, region, branch ID, endpoint type, compute size, client version, 시작·종료 시각을 기록한다. 하나의 성공 screenshot이 아니라 반복 가능한 receipt를 남긴다.

## SLA 숫자는 endpoint 종류와 묶는다

발표문은 multi-zone HA endpoint 99.99%, single-zone endpoint 99.9%라는 서비스 수준을 구분한다.[1] 숫자만 비교하지 말고 어떤 endpoint를 생성했는지, 적용 조건과 제외가 무엇인지 현재 계약 문서에서 확인한다. Single-zone test 결과로 HA endpoint를 검증했다고 보고하지 않는다.

Failure injection도 scope를 지킨다. 공급자 infrastructure를 임의로 파괴하지 말고 client network interruption, connection termination, credential rotation처럼 허용된 시험부터 수행한다. Provider-managed zone failover는 지원되는 공식 test 방법이 있을 때만 실행한다.

Lakebase의 GA 발표를 기능 목록으로 소비하면 가장 중요한 경계가 사라진다. Postgres 본체의 GCP GA와 Lakebase Search·PSC의 GCP Beta를 분리하고, Region별 가용성, 32 CU scale-to-zero 제한, branch와 backup의 차이, OAuth login semantics, 두 network path를 실제 runbook에 넣어야 운영 가능한 계약이 된다.

## Sources

[1] https://www.databricks.com/blog/lakebase-postgres-now-generally-available-google-cloud
[2] https://docs.databricks.com/gcp/en/release-notes/lakebase/
[3] https://docs.databricks.com/gcp/en/oltp/projects/scale-to-zero
[4] https://docs.databricks.com/gcp/en/oltp/projects/branches
[5] https://docs.databricks.com/gcp/en/oltp/projects/authentication
[6] https://docs.databricks.com/gcp/en/oltp/projects/private-link
