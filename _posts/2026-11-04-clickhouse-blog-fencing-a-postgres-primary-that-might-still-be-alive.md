---
title: 'ClickHouse Postgres fencing은 실패해도 승격한다: fail-open 구현과 fail-closed 대안'
date: 2026-11-04 09:00:03 +0900
categories: ["개발/데이터베이스"]
description: '모든 fencing 수단이 실패해도 옛 Primary를 잠긴 것으로 보고 승격하는 ClickHouse·Ubicloud의 fail-open 구현과, 가용성을 낮추는 fail-closed 대안을 구분한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-clickhouse-blog-fencing-a-postgres-primary-that-might-still-be-alive/1600/900'
tags: [postgresql, failover, fencing, split-brain, high-availability, wal, disaster-recovery]
---

![Postgres Primary fencing 글의 대표 이미지](https://picsum.photos/seed/news-2026-11-04-clickhouse-blog-fencing-a-postgres-primary-that-might-still-be-alive/1600/900)

제어 평면에서 Primary가 보이지 않는다고 Primary가 죽은 것은 아니다. Network partition이 control plane만 가르고 application client는 옛 Primary에 계속 연결할 수 있다. 이때 Standby를 승격하면 두 서버가 서로 다른 쓰기를 받아 split brain이 될 수 있다.

그러나 ClickHouse가 공개한 Ubicloud 기반 Managed Postgres의 실제 구현은 fencing을 엄격한 승격 전제조건으로 두지 않는다. 여러 수단을 병렬 실행해 **어느 한 메커니즘의 command 또는 API call이 오류 없이 반환되면 성공으로 처리**한다. 전부 실패해도 마지막 child job이 끝나면 옛 Primary를 locked out으로 간주하고 Standby 승격을 진행한다. 즉 availability를 택한 의도적인 **fail-open** 설계다.[1] 이 글은 이 실제 동작과, 필자가 더 엄격한 환경에 제안하는 fail-closed 대안을 분리한다.

## 승격은 격리가 아니다

PostgreSQL에서 `pg_ctl promote` 또는 `pg_promote()`를 호출하면 Standby는 recovery를 끝내고 정상 Primary 역할로 전환한다.[2] 이 동작은 옛 Primary의 process, network, disk를 건드리지 않는다.

DNS를 새 주소로 바꿔도 TTL이 남은 resolver와 이미 열린 TCP session은 옛 Primary를 계속 쓸 수 있다. Connection pool이 DNS를 다시 조회하지 않으면 더 오래 남는다. 그러므로 “DNS가 바뀌었다”는 routing 증거이지 fencing 증거가 아니다.

Synchronous replication도 fencing을 대신하지 않는다. PostgreSQL은 session별로 `synchronous_commit`을 바꿀 수 있고 quorum `ANY 1` 구성에서는 다른 Standby의 ACK만으로 옛 Primary가 commit할 수 있다.[2] ClickHouse 글은 ACK를 기다리는 중 client가 취소하거나 옛 Primary가 재시작돼도 WAL에 기록된 commit이 옛 노드에서 보일 수 있는 경계를 설명한다.[1]

## 실제 구현: 첫 반환을 성공으로, 전부 실패해도 승격

ClickHouse/Ubicloud에서는 옛 Primary state machine이 메커니즘별 child job을 동시에 시작한다. 각 child는 SSH command 또는 cloud API call이 반환되면 `lockout_succeeded`를 보고하고, SSH error·실패 또는 timeout·EC2 API error면 `lockout_failed`를 보고한다. 하나라도 먼저 성공하면 Standby가 다음 단계로 이동한다.[1]

더 중요한 예외는 **모든 메커니즘이 실패한 경우**다. 남은 child가 하나도 없으면 성공 보고가 없어도 옛 Primary를 locked out으로 센다. Standby는 이를 주기적으로 확인한 뒤 승격한다. 따라서 이 구현에서 “locked out” 상태는 반드시 data plane 차단이 관측됐다는 뜻이 아니다.[1]

환경별 시도는 다음과 같다.

- Bare metal: host에서 VM의 veth link를 내린다.
- AWS: management NIC는 남기고 user NIC를 force detach한다.
- GCP: user traffic을 싣는 Dynamic NIC를 삭제한다.
- 공통 guest 경로: `pg_stop`과 `pg_hba.conf` 교체를 시도한다.[1]

첫 command/API return을 성공으로 취급하고 전부 실패해도 승격하는 선택은 fencing 지연으로 primary 부재가 길어지는 일을 피한다. 반대로 network partition에서 옛 Primary가 실제로 write를 계속 받는 드문 경우에는 split brain 위험을 남긴다. 이것이 원문의 availability trade-off다.

## 필자의 대안: 증거 기반 fail-closed gate

아래부터는 ClickHouse/Ubicloud의 현재 동작을 설명하는 것이 아니라, split brain 방지가 availability보다 중요한 환경을 위한 **필자의 제안**이다. API `200`이나 command return만으로 실제 data plane 차단을 단정하지 않고 다음 증거를 요구한다.

- 새 TCP connection이 옛 Primary에 실패한다.
- 기존 client session도 더는 write를 commit하지 못한다.
- application의 모든 ingress와 관리용 우회 경로가 차단됐다.
- host가 재부팅되거나 network가 복구돼도 차단 상태가 유지된다.
- fencing 대상의 instance·disk·network identity가 정확하다.

잘못된 instance를 끄는 false positive는 가장 위험하다. Control plane ID, PostgreSQL `system_identifier`, host identity, timeline을 하나의 incident record에 묶는다.

## 제안 대안에서도 병렬 fencing은 유지한다

실제 구현처럼 여러 방법을 병렬 시도해 downtime을 줄이되, 제안하는 fail-closed 대안에서는 “아무 요청 하나가 반환”된 것이 아니라 **독립된 probe가 data plane 차단을 확인**해야 승격한다.

```text
cloud stop/terminate ─┐
network ACL deny ─────┼─> verified fence ─> promote standby
host agent poweroff ──┘
```

각 방법에는 `requested`, `accepted`, `observed_effect`, `verified`를 분리한다. Timeout이나 권한 오류는 성공이 아니다. 여러 action이 뒤늦게 완료돼 새 Primary를 잘못 차단하지 않도록 target generation과 idempotency key도 필요하다.

## 제안 fixture: control plane만 끊는다

아래는 **아직 실행하지 않은 격리 환경용 제안 fixture**다. Production DB와 공유 network를 사용하지 않는다.

1. Primary P와 Standby S를 streaming replication으로 구성한다.
2. Client C는 P에 열린 session을 유지하고 단조 증가 row를 쓴다.
3. Failover controller에서 P로 가는 관리 경로만 끊되 C→P 경로는 남긴다.
4. Controller가 P를 down으로 판단하는 동안 C의 commit이 계속되는지 확인한다.
5. 승격 전에 network deny 또는 P 종료로 C의 기존·신규 write를 차단한다.
6. 차단을 독립 probe로 확인한 뒤 S를 승격한다.
7. Network를 복구해도 P가 application write를 받지 않는지 확인한다.

```sql
-- 제안용 canary table. production에서 실행하지 않는다.
CREATE TABLE fence_probe (
  writer text NOT NULL,
  seq bigint NOT NULL,
  written_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (writer, seq)
);
```

각 writer는 `old-primary-client`와 `new-primary-client`로 구분한다. 양쪽에서 같은 business key를 다르게 갱신해 timeline divergence가 눈에 보이게 한다. 실험 뒤 두 노드의 `pg_control_system()`, `pg_is_in_recovery()`, timeline과 row set을 보존한다.

## 제안하는 promotion gate를 기계적으로 만든다

ClickHouse/Ubicloud의 현재 state machine과 달리, 더 강한 일관성이 필요한 조직에는 아래와 같은 fail-closed 흐름을 제안한다.

```text
DETECT_UNREACHABLE
  -> IDENTIFY_OLD_PRIMARY
  -> REQUEST_FENCE
  -> VERIFY_OLD_WRITE_PATHS_BLOCKED
  -> CHECK_STANDBY_REPLAY_POSITION
  -> PROMOTE
  -> SWITCH_ROUTING
  -> VERIFY_SINGLE_WRITER
```

`VERIFY_OLD_WRITE_PATHS_BLOCKED`가 inconclusive면 promotion을 멈추고 사람을 호출한다. 이 선택은 split brain 가능성을 낮추는 대신 fencing을 확인할 때까지 database에 Primary가 없어 downtime이 길어질 수 있다. ClickHouse/Ubicloud는 바로 이 가용성 비용을 피하려고 실제 제품에서는 fail-open을 선택했다.[1]

Standby 상태도 확인해야 한다. PostgreSQL 문서는 streaming replication이 기본적으로 비동기이며 failover 시 replication delay만큼 data loss가 가능하다고 설명한다.[2] “옛 Primary를 막았다”와 “Standby가 충분히 따라왔다”는 서로 다른 gate다.

## 복귀는 자동 재가입이 아니다

Network가 돌아온 옛 Primary를 그대로 cluster에 붙이면 안 된다. 새 Primary와 timeline이 갈라졌을 수 있다. 옛 노드는 쓰기 금지 상태에서 보존하고, 필요한 divergent row와 WAL을 조사한 뒤 새 Primary 기준으로 재초기화하거나 검토된 `pg_rewind` 절차를 적용한다.

ClickHouse Managed Postgres 문서는 HA Standby와 read replica를 별도 목적으로 둔다. 두 Standby 구성은 적어도 하나의 ACK를 기다리는 synchronous quorum이고 Standby는 failover 전용이다.[3] 이 제품 구조를 그대로 자체 운영 Postgres에 복사하기보다, 우리 topology에서 누가 writer이고 어느 component가 fencing authority인지 명시해야 한다.

ClickHouse/Ubicloud의 결론은 명확하다. 첫 fencing command/API call이 성공으로 반환되면 진행하고, 모든 수단이 실패해도 옛 Primary를 locked out으로 계산해 승격하는 fail-open 설계로 availability를 우선한다. 반면 이 글에서 제안한 fail-closed gate는 실제 write 차단 증거가 불충분하면 Primary 부재를 감수하고 승격을 멈춘다. 어느 쪽이든 “빠른 복구”와 “동시 writer 방지”를 동시에 얻는다고 표현해서는 안 되며, 조직의 손실 모델에 맞춰 이 trade-off를 명시해야 한다.

## Sources

[1] https://clickhouse.com/blog/fencing-a-postgres-primary-that-might-still-be-alive
[2] https://www.postgresql.org/docs/current/warm-standby.html
[3] https://clickhouse.com/docs/products/managed-postgres/high-availability
