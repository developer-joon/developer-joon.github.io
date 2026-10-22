---
title: 'PostgreSQL 19 RC1 업그레이드 리허설: GA 전에 실패 지점을 찾는 법'
date: 2026-10-22 07:00:00 +0900
categories: ["개발/데이터베이스"]
description: 'PostgreSQL 19 RC1에서 pg_upgrade --check, 확장 모듈 호환성, 전환·롤백 시간을 같은 절차로 측정하고 RC2와 GA에서 blocker 차이를 추적하는 업그레이드 리허설 가이드.'
featured_image: 'https://picsum.photos/seed/postgresql-19-upgrade-rehearsal/1600/900'
tags: [postgresql, pg-upgrade, database-upgrade, extension, cutover, rollback, release-candidate]
---

![두 손으로 짙은 보라색 포도송이를 들고 있는 모습](https://picsum.photos/seed/postgresql-19-upgrade-rehearsal/1600/900)

PostgreSQL 19 RC1은 2026년 10월 15일 공개된 **릴리스 후보**다. PostgreSQL 프로젝트는 RC1이 최초 정식 릴리스와 대체로 같을 것으로 보지만, 그 전에 수정이 더 들어갈 수 있다고 명시했다. RC2는 11월 12일, GA는 문제가 발견돼 일정이 바뀌지 않는다는 조건 아래 11월 19일로 예정돼 있다.[1] 따라서 지금 해야 할 일은 RC1을 운영 데이터베이스에 올리는 것이 아니라, 운영과 닮은 격리 환경에서 업그레이드 절차를 실행해 실패 지점과 소요 시간을 먼저 찾는 것이다. PostgreSQL도 beta와 release candidate를 production system에 쓰지 말라고 안내한다.[2]

이 글의 목표는 신기능을 둘러보는 데 있지 않다. **RC1 → RC2 → GA에서 입력과 측정법이 같은 리허설을 반복하고, blocker가 어떻게 달라졌는지 diff로 남기는 것**이 목표다. 한 번 성공한 RC1 리허설은 GA 승인서가 아니다. 반대로 RC1에서 실패한 항목도 제품 결함이라고 단정할 수 없다. 패키지 저장소, 확장 모듈, 로컬 설정, 데이터베이스 스키마가 원인일 수 있기 때문이다.

## 먼저 성공 조건을 숫자로 고정한다

업그레이드 리허설은 “명령이 0으로 끝났다”보다 넓어야 한다. 시작 전에 다음 네 가지를 합의한다.

1. `pg_upgrade --check`의 hard blocker가 0개다.
2. 사용 중인 모든 데이터베이스의 확장 모듈에 PostgreSQL 19용 실행 파일과 검증된 업데이트 경로가 있다.
3. 쓰기 차단부터 새 클러스터 acceptance 완료까지의 시간이 목표 RTO 안에 든다.
4. 정해 둔 rollback deadline 안에 기존 클러스터로 돌아갈 수 있고, 새 클러스터에 쓰기를 허용한 뒤의 데이터 처리 방안도 설명할 수 있다.

PostgreSQL 19는 이전 major release에서 단순 바이너리 교체만으로 이동하는 버전이 아니다. 공식 release note는 `pg_dumpall` 기반 dump/restore, `pg_upgrade`, logical replication 중 하나가 필요하다고 밝히며 migration 항목의 비호환 변경도 함께 검토하라고 한다.[3] 특히 중간 major version을 건너뛴다면 건너뛴 모든 버전의 migration note를 읽어야 한다. 이 검토 결과를 `release-notes-review.md`처럼 사람 이름과 판정이 남는 artifact로 만든다.

## 리허설 입력은 “백업”이 아니라 재현 가능한 묶음이다

일반적인 “백업이 있다”는 문장은 리허설 입력으로 부족하다. 아래 항목을 한 실행 디렉터리에 고정한다.

```text
rehearsal-2026-10-22-rc1/
├── manifest.txt              # source/target 버전, 패키지, OS, 파일시스템
├── old-pg-config.txt         # old pg_config --configure 결과
├── new-pg-config.txt         # new pg_config --configure 결과
├── databases.tsv             # DB, owner, encoding, locale
├── extensions.tsv            # DB별 extname, extversion
├── libraries.txt             # shared_preload_libraries 등
├── tablespaces.tsv           # 경로와 파일시스템
├── replication.tsv           # physical/logical slot, subscription 상태
├── pg-upgrade-check.log
├── pg-upgrade-run.log
├── generated-scripts/        # reindex/update-extension 등 생성물
└── clock.tsv                 # 단계별 시작·종료·판정
```

소스 클러스터는 운영 서버 자체가 아니라, 같은 시점의 **복구 검증된 snapshot 또는 backup으로 만든 격리 복제본**이어야 한다. 개인·민감 데이터가 들어 있다면 리허설 환경도 운영과 같은 접근 제어와 폐기 정책을 적용한다. synthetic data만으로는 스키마 blocker를 볼 수 있지만 실제 relation 수, tablespace 배치, catalog 규모가 빠져 cutover 시간은 왜곡될 수 있다.

바이너리 이름만 `19`인지 보지 말고 실행 파일과 빌드 옵션을 기록한다.

```bash
set -euo pipefail

# 리허설 호스트의 격리 디렉터리에서만 실행한다.
OLD_BIN=/opt/postgresql/18/bin
NEW_BIN=/opt/postgresql/19rc1/bin
ARTIFACT=$PWD/rehearsal-2026-10-22-rc1
mkdir -p "$ARTIFACT"

"$OLD_BIN/postgres" --version | tee "$ARTIFACT/old-version.txt"
"$NEW_BIN/postgres" --version | tee "$ARTIFACT/new-version.txt"
"$OLD_BIN/pg_config" --configure > "$ARTIFACT/old-pg-config.txt"
"$NEW_BIN/pg_config" --configure > "$ARTIFACT/new-pg-config.txt"
sha256sum "$OLD_BIN/postgres" "$NEW_BIN/postgres" \
  > "$ARTIFACT/server-binaries.sha256"
```

경로는 예시다. OS package manager가 관리하는 설치라면 패키지명·repository·package digest도 함께 남긴다. RC2나 GA에서 “같은 절차”를 반복하려면 어떤 바이너리를 시험했는지가 먼저 고정돼야 한다.

## `pg_upgrade --check`가 잡는 것과 놓치는 것

`--check`는 데이터를 변경하지 않고 두 클러스터의 호환성을 검사한다. 기존 서버가 실행 중일 때도 사용할 수 있으며, 실제 전환에서 `--link`, `--clone`, `--copy-file-range`, `--swap` 중 하나를 쓸 계획이라면 check에도 같은 mode option을 넣어 mode별 조건까지 확인해야 한다.[4]

다음은 **격리 복제본**과 미리 `initdb`한 빈 target cluster를 대상으로 한 예시다. 명령은 PostgreSQL 19 쪽 `pg_upgrade`를 사용한다.

```bash
set -euo pipefail

# 절대 운영 PGDATA를 예시 경로에 대입하지 않는다.
OLD_BIN=/opt/postgresql/18/bin
NEW_BIN=/opt/postgresql/19rc1/bin
OLD_DATA=/srv/pg-rehearsal/source-copy
NEW_DATA=/srv/pg-rehearsal/target-rc1
ARTIFACT=$PWD/rehearsal-2026-10-22-rc1
mkdir -p "$ARTIFACT"

"$NEW_BIN/pg_upgrade" \
  --check \
  --clone \
  --retain \
  --old-bindir="$OLD_BIN" \
  --new-bindir="$NEW_BIN" \
  --old-datadir="$OLD_DATA" \
  --new-datadir="$NEW_DATA" \
  2>&1 | tee "$ARTIFACT/pg-upgrade-check.log"
```

`--clone`은 reflink를 지원하는 파일시스템에서만 동작한다. 실제 계획이 기본 `--copy`라면 check에서도 `--copy`를 쓰고, link mode라면 격리 복제본에 `--link`를 쓴다. **편의를 위해 리허설 mode를 바꾸면 실제 cutover 조건을 검사하지 못한다.** `--retain`은 성공해도 SQL과 log를 남겨 RC별 비교가 가능하게 한다.

`pg_upgrade --check`는 compile-time setting, catalog와 데이터 형식, 일부 알려진 rebuild·reindex 조건, 선택한 전송 mode의 조건을 검사하고 수동 조정이 필요하면 알려 준다. 그러나 공식 문서는 외부 모듈의 binary compatibility는 `pg_upgrade`가 확인할 수 없다고 선을 긋는다.[4] 그러므로 결과를 다음처럼 세 층으로 나눈다.

| 층 | 예시 | 통과 기준 |
|---|---|---|
| `pg_upgrade` hard blocker | incompatible cluster setting, 지원하지 않는 catalog object, schema restore 실패 | error 0개 |
| 배포·확장 blocker | PostgreSQL 19용 `.so`/DLL 부재, preload library 미설치, update path 부재 | 각 항목에 설치 artifact와 시험 결과 존재 |
| 사후 작업 | 생성된 extension update, reindex/rebuild, 통계 재생성 | 담당자·명령·예상 시간·완료 판정 존재 |

“check 통과”와 “전환 가능”을 구분하는 것이 핵심이다.

## 확장 모듈은 DB별 inventory와 binary를 따로 본다

`pg_extension`에는 source 데이터베이스에 설치된 extension 이름과 버전이 기록된다.[5] `pg_available_extension_versions`는 target 서버에 설치 가능한 구체적 버전과 의존 extension을 보여 준다.[6] 서로 다른 cluster에서 얻는 두 집합을 DB와 extension 이름으로 비교해야 한다. 한 DB에서만 설치된 extension을 놓치지 않도록 첫 query는 source의 모든 데이터베이스에서 실행하고, 두 번째 query는 PostgreSQL 19 target에서 실행한다.

```sql
-- source cluster: 데이터베이스마다 실행해 extensions-source.tsv로 모은다.
SELECT current_database() AS database_name,
       extname,
       extversion AS installed_version
FROM pg_extension
ORDER BY extname;
```

```sql
-- target cluster: PostgreSQL 19 package가 제공하는 version을 기록한다.
SELECT name,
       version,
       requires
FROM pg_available_extension_versions
ORDER BY name, version;
```

두 결과를 같은 접속에서 join하려고 하면 안 된다. Source에서 조회한 `pg_available_extension_versions`는 old server에 설치된 package를, 비어 있는 target에서 조회한 `pg_extension`은 target 기본 extension만 반영한다. `extensions-source.tsv`의 각 `(database_name, extname, installed_version)`에 대해 target 목록, 배포 package, 지원 release를 별도로 대응시킨다.

이 결과만으로 호환성을 선언해서는 안 된다. 다음 질문에 각각 증거를 붙인다.

- PostgreSQL 19 server binary에 맞춰 빌드된 shared object가 target의 library directory에 있는가?
- `shared_preload_libraries`, `session_preload_libraries`, background worker가 참조하는 모듈이 모두 설치됐는가?
- extension control/SQL 파일과 shared object가 같은 package build에서 왔는가?
- 설치된 `extversion`에서 target version까지 update path가 있는가?
- extension이 정의한 type, operator class, index access method, custom statistics를 쓰는 대표 query가 통과하는가?
- standby와 job runner에도 같은 binary가 배포됐는가?

공식 절차는 새 서버 binary에 맞는 extension shared object를 먼저 설치하고, target에 `CREATE EXTENSION`으로 schema를 미리 만들지 말라고 안내한다. 기존 schema 정의는 old cluster에서 복제되며, update가 있으면 `pg_upgrade`가 사후 script를 생성할 수 있다.[4] 즉 “패키지가 설치된다”와 “기존 extension data가 안전하게 동작한다”는 별도 gate다.

확장별 acceptance fixture도 고정한다. 예를 들어 PostGIS라면 대표 geometry read/write와 spatial index scan, `pgvector`라면 저장된 vector 조회와 index path, custom type extension이라면 dump가 아닌 실제 old data page를 읽는 query를 준비한다. extension 이름은 예시일 뿐이며 지원 여부나 PostgreSQL 19 호환성을 여기서 보증하지 않는다. 각 프로젝트의 19 지원 release와 자체 test 결과가 있어야 통과다.

## logical replication은 별도 preflight 표가 필요하다

logical slot이나 subscription을 쓰는 환경은 server upgrade만 재현하면 안 된다. PostgreSQL 19 문서는 `pg_upgrade`가 logical slot을 옮기는 기능을 old cluster 17 이상에서만 지원하고, 그보다 오래된 source의 logical slot은 조용히 무시한다고 명시한다. 새 cluster의 `wal_level`, `max_replication_slots`, output plugin 설치 상태, slot의 `conflicting` 상태 등도 prerequisite다.[7]

따라서 `replication.tsv`에는 최소한 다음을 넣는다.

```text
node | role | source_major | slot | plugin | active | conflicting | subscriber_lsn | decision
```

RC1 리허설에서 slot이 보였다는 사실만으로 통과시키지 않는다. subscription disable 시점, source의 마지막 LSN, target에서 재개된 LSN, lag가 0으로 돌아온 시각을 clock에 남긴다. 문서의 prerequisite가 맞지 않는 topology라면 “수동 재생성”이나 “별도 logical migration”을 명시적인 실행 경로로 선택한다.

## cutover clock은 다섯 구간으로 잰다

전체 명령 실행 시간만 재면 실제 중단 시간을 과소평가한다. 리허설 clock은 다음 경계를 monotonic clock과 wall clock으로 함께 기록한다.

| 시각 | 사건 | 다음 단계 진입 조건 |
|---|---|---|
| `T0` | 변경 동결·배포 중지 | schema 변경 job 0 |
| `T1` | application 쓰기 차단·connection drain 완료 | old cluster active write 0 |
| `T2` | old cluster 종료·upgrade 시작 | 마지막 checkpoint와 replica 상태 기록 |
| `T3` | `pg_upgrade` 및 필수 생성 script 완료 | hard blocker 0 |
| `T4` | new cluster 시작·acceptance 완료 | 핵심 read/write, extension, job, replication 통과 |
| `T5` | traffic 전환·관찰 창 시작 | error/latency/data invariant 기준 충족 |

운영 중단 시간 후보는 보통 `T1 → T5`다. 이 구간을 `drain`, `pg_upgrade`, `post-upgrade script`, `startup`, `acceptance`, `routing`으로 나눠야 줄일 곳이 보인다. relation 수가 많아 schema restore와 file operation이 오래 걸리는지, extension rebuild가 긴지, application connection pool을 비우는 데 시간이 드는지 구분한다.

측정 예시는 단순해야 한다.

```bash
mark() {
  printf '%s\t%s\n' "$(date --iso-8601=ns)" "$1" \
    | tee -a rehearsal-2026-10-22-rc1/clock.tsv
}

mark T1_WRITES_BLOCKED
# 여기에는 검토된 리허설 runbook 단계만 실행한다.
mark T2_OLD_STOPPED
mark T3_UPGRADE_AND_REQUIRED_SCRIPTS_DONE
mark T4_ACCEPTANCE_DONE
mark T5_TRAFFIC_SWITCH_SIMULATED
```

이 함수는 시간을 기록할 뿐 서버를 멈추거나 traffic을 바꾸지 않는다. 실제 명령은 환경별 승인된 runbook에 둔다. RC 리허설 결과를 그대로 production 명령 목록으로 복사하지 않는다.

## rollback clock은 “돌아가기로 결정한 순간”부터 잰다

Rollback RTO는 upgrade 시작부터가 아니다. `T_fail`에서 실패를 감지하고 rollback을 선언한 뒤 old service가 acceptance를 통과한 `T_old_ready`까지다. 여기에 실패 감지와 의사결정 시간도 따로 기록한다.

```text
rollback_total = detect + decide + quiesce_new + restore_old + validate_old + reroute
```

전송 mode가 rollback 가능성을 바꾼다.[4]

- `--check`만 실행했다면 old cluster는 변경되지 않는다.
- 기본 copy나 clone mode는 old cluster를 그대로 두므로, 새 cluster에 쓰기를 받기 전이라면 old cluster를 다시 시작하는 경로를 연습할 수 있다.
- link mode에서 새 cluster를 한 번이라도 시작하면 공유 파일이 변경될 수 있어 old cluster를 다시 쓰는 것이 안전하지 않다. 이 경우 복구 원본이 따로 필요하다.
- swap mode는 file transfer가 시작된 뒤 old cluster를 파괴적으로 바꿀 수 있다. 문서가 old cluster가 더는 안전하지 않다고 알린 뒤에는 복구 원본에서 되돌려야 한다.

어떤 mode든 새 cluster가 client write를 받은 뒤의 rollback은 단순 재시작이 아니다. old cluster에는 그 write가 없으므로 write를 버릴지, 이중 기록·변경 로그로 되돌릴지, forward fix를 할지 사전에 정해야 한다. 그래서 `T4` acceptance 전까지 외부 write를 차단하고, `T5` 뒤에는 rollback이 아니라 **data reconciliation을 포함한 failback**으로 이름을 바꾸는 편이 정확하다.

리허설에서는 최소 세 실패를 주입한다.

1. `--check`가 extension library 부재로 중단된다.
2. upgrade 뒤 핵심 extension acceptance query가 실패한다.
3. traffic 전환 직전 rollback을 선언한다.

각 case에서 선언 시각, old cluster 기동 시각, application health 통과 시각, 잃거나 재처리할 write 수를 기록한다. 실제 운영 데이터를 훼손하는 fault injection은 하지 않는다.

## RC1에서 만든 artifact를 RC2와 GA에 그대로 적용한다

RC2와 GA 때 새 문서를 처음부터 쓰지 않는다. RC1 디렉터리를 template으로 복제하되 binary와 package digest만 새 release로 바꾼다.

```text
release | server_sha256 | check_result | blocker_count | extension_failures | cutover_s | rollback_s
RC1     | ...           | PASS/FAIL    | ...           | ...                | ...       | ...
RC2     | ...           | PASS/FAIL    | ...           | ...                | ...       | ...
GA      | ...           | PASS/FAIL    | ...           | ...                | ...       | ...
```

비교 대상은 최종 PASS 한 줄이 아니다.

- `pg_upgrade --check` log에 새 warning이나 생성 script가 생겼는가?
- release note의 migration 항목이 RC1 이후 바뀌었는가?
- extension package version과 shared object hash가 달라졌는가?
- 같은 snapshot에서 cutover와 rollback 시간이 허용 오차를 벗어났는가?
- 대표 query의 plan, 결과 invariant, error가 달라졌는가?
- RC1 blocker가 사라졌다면 PostgreSQL 변경 때문인지 local package 변경 때문인지 설명되는가?

RC2는 RC1의 성공을 이어받지 않는다. GA도 RC2 결과를 이어받지 않는다. 매번 새 target cluster를 초기화하고, 같은 source snapshot 계열과 같은 acceptance fixture로 처음부터 실행한다. GA binary가 확정된 뒤 마지막 리허설을 통과해야 실제 변경 승인 후보가 된다.

## 최종 승인표

| Gate | 증거 | 실패 시 행동 |
|---|---|---|
| Release 상태 | GA release와 binary hash | RC면 production 전환 금지 |
| Migration note | 검토자와 적용 여부 | 미검토 항목 해소 |
| `pg_upgrade --check` | 원문 log, exit code, mode | hard blocker 제거 후 재실행 |
| Extension | DB별 inventory, package hash, fixture 결과 | 호환 release 확보 또는 migration 방식 변경 |
| Replication | slot/subscription preflight와 재개 LSN | topology별 별도 절차 적용 |
| Cutover | `T1 → T5` 구간별 시간 | RTO 초과 구간 개선 |
| Rollback | 주입 case별 `T_fail → T_old_ready` | mode 또는 복구 전략 변경 |
| Data | 핵심 invariant와 reconciliation 계획 | 쓰기 허용 금지 |

PostgreSQL 19 RC1의 가치는 GA를 미리 썼다는 데 있지 않다. 운영과 닮은 실패를 GA 전에 싸게 발견하고, RC2와 GA에서 동일한 절차로 수정 여부를 확인할 수 있다는 데 있다. 가장 중요한 결과물은 “RC1에서 성공했다”는 문장이 아니라, **어떤 binary와 extension으로 어떤 blocker를 만났고, 전환과 복귀에 각각 몇 분이 걸렸는지 재현하는 artifact**다.

## Sources

[1] https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/
[2] https://www.postgresql.org/developer/beta/
[3] https://www.postgresql.org/docs/19/release-19.html
[4] https://www.postgresql.org/docs/19/pgupgrade.html
[5] https://www.postgresql.org/docs/19/catalog-pg-extension.html
[6] https://www.postgresql.org/docs/19/view-pg-available-extension-versions.html
[7] https://www.postgresql.org/docs/19/logical-replication-upgrade.html
