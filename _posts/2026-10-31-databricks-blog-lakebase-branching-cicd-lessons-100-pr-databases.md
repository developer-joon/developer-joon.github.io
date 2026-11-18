---
title: 'PR마다 1TB급 Postgres 복사본을 만들 수 있을까: Copy-on-Write 브랜치와 TTL 검증'
date: 2026-10-31 09:00:04 +0900
categories: ["개발/데이터베이스"]
description: 'Lakebase 고객 사례의 PR별 Postgres 브랜치를 Copy-on-Write·scale-to-zero·TTL 수명주기로 분해하고, 격리·비용·삭제 복구를 검증하는 CI 설계.'
featured_image: 'https://picsum.photos/seed/news-2026-10-31-databricks-blog-lakebase-branching-cicd-lessons-100-pr-databases/1600/900'
tags: [lakebase, postgresql, database-branching, cicd, copy-on-write, ttl, databricks]
---

![Lakebase PR database branching 글의 대표 이미지](https://picsum.photos/seed/news-2026-10-31-databricks-blog-lakebase-branching-cicd-lessons-100-pr-databases/1600/900)

PR마다 운영과 비슷한 Postgres를 붙이면 migration과 data-dependent bug를 일찍 찾을 수 있다. 문제는 1TB를 매번 복사하는 시간과 비용이다. Databricks가 공개한 Snorkel AI 사례는 Lakebase branch를 이용해 약 100개의 동시 PR database를 운영하며, 30분이 넘던 준비를 60초 미만으로 줄였다고 설명한다.[1]

이 숫자는 고객·공급자 사례이지 모든 database의 보장값이 아니다. 글의 요약은 약 2.5TB production dataset을, 본문 일부는 약 1TB base를 언급하고 branch별 변경량은 5~10GB 사례로 제시한다.[1] 서로 다른 분모를 하나의 “1TB 복사가 60초” 주장으로 합치면 안 된다.

실무에서 검증할 것은 세 가지다. **branch가 실제로 격리되는가, Copy-on-Write 비용이 변경량과 함께 움직이는가, PR이 비정상 종료돼도 TTL이 정리하는가.**

## Branch는 snapshot copy가 아니라 독립된 쓰기 환경이다

Lakebase branch는 parent와 unchanged storage를 공유하는 Copy-on-Write 구조다. Child의 변경은 parent에 영향을 주지 않고 branch별 compute를 따로 둘 수 있다.[2] 즉 생성 직후 full copy를 기다리지 않으면서도 application이 표준 Postgres connection으로 read/write할 수 있다.

하지만 “storage를 공유한다”와 “권한·network·secret까지 안전하게 격리된다”는 다른 주장이다. PR branch에는 별도 database role, 짧은 수명의 credential, PR environment만 접근 가능한 network policy를 붙여야 한다. Production service account를 그대로 복사하지 않는다.

Databricks 문서는 expiring branch와 permanent branch의 billing 의미도 다르게 설명한다. Expiring branch는 Copy-on-Write 변경분 중심으로 과금되지만 expiration이 없는 permanent branch는 parent와 거의 같아도 full data size 기준이다.[2] 비용 모델을 검증할 때 branch type을 반드시 기록해야 한다.

## CI 수명주기를 한 상태 기계로 만든다

PR webhook과 database API를 느슨하게 연결하면 orphan branch가 쌓인다. 다음 상태를 명시한다.

```text
requested -> creating -> ready -> migrating -> testing
          -> passed/failed -> deleting -> deleted
                       \-> expired
```

`ready`는 API 상태만이 아니다. Connection, expected snapshot marker, migration baseline을 확인해야 한다. `deleted`도 delete request의 성공이 아니라 branch와 compute가 조회되지 않고 secret이 폐기된 상태다.

Resource key는 `repository_id + pull_request_number + head_sha`로 만든다. PR number만 쓰면 force-push 뒤 오래된 test가 새 branch를 삭제할 수 있다. 모든 create/delete에는 idempotency key와 expected generation을 넣는다.

## TTL은 cleanup의 보조가 아니라 두 번째 안전망이다

Lakebase branch expiration은 `ttl`, 절대 `expire_time`, 또는 `no_expiry` 중 하나로 지정한다. 만료되면 branch와 연결된 data·compute가 영구 삭제되며 reset하면 원래 TTL interval을 기준으로 countdown이 다시 시작된다.[3]

PR close webhook이 정상 경로이고 TTL은 webhook 유실·CI 취소·API timeout을 처리하는 안전망이다. 둘 중 하나만 두지 않는다.

- PR open: 4시간 TTL로 branch 생성
- Test가 길어지면 owner가 TTL 연장
- PR close/merge: 즉시 delete 요청
- Sweeper: repository의 open PR 목록과 branch inventory를 정기 대조
- TTL expiry: 최종 자동 삭제

Protected branch에는 expiration을 붙일 수 없으므로 production을 실수로 TTL 대상으로 만들지 못하는 방어도 확인한다.[3]

## 제안 fixture: 작은 dataset으로 lifecycle을 먼저 검증한다

아래는 **실행하지 않은 제안 fixture**다. 고객 사례의 1TB 수치 재현이 아니라 automation correctness를 확인하는 최소 시험이다.

1. Parent에 20GB test dataset과 schema version marker를 넣는다.
2. Branch A와 B를 같은 parent 시점에서 생성한다.
3. A에서 migration과 1GB update, B에서 다른 500MB update를 실행한다.
4. Parent·A·B에서 row hash와 schema version을 비교한다.
5. A를 명시적으로 삭제하고 B는 짧은 TTL로 만료시킨다.
6. Branch, compute, credential, storage metric이 모두 정리됐는지 확인한다.

측정값은 다음과 같다.

| 단계 | 측정 |
|---|---|
| create→ready | API 완료가 아니라 첫 성공 query까지 |
| first query | suspended compute의 cold start 포함 여부 |
| migration | duration, lock wait, failure rollback |
| storage | branch 생성 직후와 write 뒤 증분 |
| cleanup | close event→resource 부재 시간 |
| expiry | 예정 시각→실제 삭제 시간 |

Scale-to-zero는 idle compute를 정지하고 요청 때 다시 켠다. 공식 문서는 기본 inactivity timeout 24시간, 설정 범위 60초~7일, 재활성화 때 application retry 필요를 명시한다.[4] “branch 생성 시간”과 “첫 query latency”를 합치지 않으면 cold start를 숨길 수 있다.

## 실제 데이터 사용이 만드는 위험

운영과 같은 데이터 형태가 장점이지만 개인정보를 그대로 PR 환경에 복제하는 것은 별도 위험이다. Branching이 빠르다고 data minimization 의무가 사라지지 않는다.

- Production snapshot에 masking/tokenization을 적용할 위치를 고정한다.
- CI actor가 접근할 수 있는 row와 extension을 최소화한다.
- Query log와 test artifact에 원문 데이터가 남지 않게 한다.
- Branch 삭제와 별도로 CI log·dump·screenshot 보존을 관리한다.
- Fork PR에는 secret과 branch create 권한을 주지 않는다.

## 공급자 사례를 우리 SLO로 바꾸는 법

“100 PR database”와 “60초 미만”을 그대로 SLO로 채택하지 않는다. 먼저 동시 PR 수, parent size, branch write volume, compute size, region, migration 종류를 고정한다. p50만이 아니라 p95 create-to-query와 실패율을 측정한다.

완료 기준은 다음처럼 쓸 수 있다.

> 동시 30개 PR 조건에서 95%의 branch가 90초 안에 snapshot marker query에 성공한다. Child write는 parent와 sibling에서 보이지 않는다. PR close 후 15분 안에 명시 삭제되고, webhook 유실 branch는 4시간 TTL로 삭제된다.

Lakebase 사례의 핵심은 거대한 database를 매번 복사했다는 데 있지 않다. Shared base, branch별 변경분, 독립 compute, TTL을 하나의 lifecycle로 묶었다는 데 있다. Copy-on-Write는 생성 시간을 줄이지만, 격리 검증과 orphan cleanup은 CI가 직접 증명해야 한다.

## Sources

[1] https://www.databricks.com/blog/lakebase-branching-cicd-lessons-100-pr-databases
[2] https://docs.databricks.com/gcp/en/oltp/projects/branches
[3] https://docs.databricks.com/gcp/en/oltp/projects/manage-branches
[4] https://docs.databricks.com/gcp/en/oltp/projects/scale-to-zero
