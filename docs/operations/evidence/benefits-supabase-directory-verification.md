# 복지 디렉터리 비브라우저 최종 검증 증적

## 1. 판정과 범위

- **검증 대상 코드 리비전:** `0ebaff1a2380bc4733bfa911fedf8ece751f6369`
- **브랜치:** `agent/benefits-final-verification`
- **실행 구간:** 2026-11-21 18:46:43 UTC ~ 19:09:48 UTC (2026-11-22 03:46:43 ~ 04:09:48 KST)
- **범위 판정:** 아래 비브라우저 제품 게이트는 통과했다. 그러나 브라우저 검증과 Task 16 E2E가 수행되지 않았으므로 전체 릴리스 상태는 **NO-GO**이며 릴리스 승인을 부여하지 않는다.
- 검증 시작 시 브랜치, HEAD, 전체 추적/미추적 작업 트리가 각각 기대값과 일치했고 작업 트리는 깨끗했다. 검증 중 제품 코드는 수정하지 않았다.

## 2. 실행 환경

| 항목 | 실제 값 |
| --- | --- |
| 호스트 | Linux `6.12.0-124.52.1.el10_1.x86_64`, x86_64 |
| Node.js / npm | `v24.15.0` / `11.12.1` |
| Docker | client/server `29.7.2`; Rocky Linux 10.2; x86_64 |
| Supabase CLI | 저장소 고정 `2.118.0` (`community-app/node_modules/.bin/supabase`) |
| PostgreSQL client | `psql (PostgreSQL) 17.6`; 고정 Supabase PostgreSQL 이미지의 클라이언트를 프로필 scratch 전용 래퍼로 실행 |
| Docker 산출물 플랫폼 | `linux/amd64` |
| 저장 공간 | `/home` 3.7 TiB 중 3.5 TiB 가용(실행 전) |

`community-app/node_modules`가 없었으므로 `npm --prefix community-app ci --offline`만 실행했다. 216개 패키지를 설치했고 해당 호스트 실행에서는 취약점 0건으로 종료했다. 호스트에는 Ruby/Bundler가 없었지만 이는 판정 항목이 아니다. 저장소의 고정 Docker Ruby/Node 빌드 경로가 실제로 두 번 성공했다.

## 3. 데이터베이스 검증

모든 데이터베이스 명령은 로컬 Supabase 프로젝트 `developer-joon-community-design`에만 실행했다. 로컬 연결은 `postgresql://postgres:***@127.0.0.1:54322/postgres`로 제한했고 원격/호스팅 데이터베이스에는 연결하거나 쓰지 않았다.

| 명령 | 실제 결과 |
| --- | --- |
| `npm --prefix community-app run db:start` | exit 0; 로컬 스택 시작 |
| `npm --prefix community-app run db:reset` | exit 0; 마이그레이션 `202609260001`~`202611210005` 및 로컬 seed 적용 |
| `npm --prefix community-app run db:test:benefit-title-upgrade` | exit 0; **Tests=4**; 성공 backfill, 잠금 경쟁, 유효하지 않은 제목 rollback, canonical collision rollback 검증; primary DB fingerprint 불변 |
| `PATH=<profile-scratch>/psql-bin:$PATH npm --prefix community-app run db:test:benefit-seed-importer` | 최종 exit 0; **Tests=7**; trigger rewrite, schema drift, dry-run, receipt collision, late failure, 정상 apply, replay 검증 및 정리 성공 |
| `npm --prefix community-app run db:start` (importer 후) | exit 0 |
| `npm --prefix community-app run db:reset` (importer 후) | exit 0 |
| `npm --prefix community-app run db:test` | exit 0; **23 pgTAP 파일, 1,512 tests**, `All tests successful`, `Result: PASS` |
| `npm --prefix community-app run db:lint` | exit 0; `results=[]` |
| `npm --prefix community-app run db:stop` | exit 0; 프로젝트 범위 종료 및 백업 |

호스트 `psql`이 PATH에 없어 importer의 첫 실행은 제품 테스트 전에 필수조건 오류로 종료했다. 이미 로컬에 존재하던 고정 이미지 `public.ecr.aws/supabase/postgres:17.6.1.171`의 `psql`을 사용하는 UID 소유, mode 0700 프로필-scratch 래퍼를 구성했다. 첫 래퍼는 importer의 최소 환경에서 `TMPDIR`이 없어서 버전 probe를 통과하지 못했다. 고정 프로필 scratch 경로를 사용하도록 수정하고, `env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C .../psql --version` probe를 통과시킨 뒤 전체 importer suite를 재실행해 Tests=7을 얻었다. 저장소 제품/테스트 파일 수정은 없었다.

최종 래퍼는 457 bytes, mode `0700`, UID `1001`이며 SHA-256은 `d7e190afd005963a4792ae0a380e6dcbbc1cb1c69cd6c8525a989a518b4be8c9`였다. ephemeral scratch가 정리된 뒤에도 동일 경계를 재구성할 수 있도록 실제 래퍼 bytes와 설치 검사를 남긴다. 고정 scratch mount는 importer가 생성한 TSV를 컨테이너의 `psql`이 같은 절대 경로에서 읽기 위해 read-only로 연결한다. 비밀번호 값은 인자에 넣지 않고 승인된 PostgreSQL 환경변수 이름만 `docker --env`로 전달한다.

```bash
PSQL_BIN=/home/bread/.hermes/profiles/conan/cache/scratch/psql-bin/psql
install -d -m 0700 -- "$(dirname "$PSQL_BIN")"
cat >"$PSQL_BIN" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
image='public.ecr.aws/supabase/postgres:17.6.1.171'
scratch='/home/bread/.hermes/profiles/conan/cache/scratch'
args=(run --rm --network host -i --volume "${scratch}:${scratch}:ro")
for name in PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGCLIENTENCODING PGCONNECT_TIMEOUT PGOPTIONS PGSSLMODE LANG LC_ALL; do
  if [[ -v "$name" ]]; then args+=(--env "$name"); fi
done
exec /usr/bin/docker "${args[@]}" "$image" psql "$@"
WRAPPER
chmod 0700 -- "$PSQL_BIN"
test "$(stat -c %u -- "$PSQL_BIN")" -eq "$(id -u)"
test "$(stat -c %a -- "$PSQL_BIN")" = 700
env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C "$PSQL_BIN" --version
PATH="$(dirname "$PSQL_BIN"):$PATH" npm --prefix community-app run db:test:benefit-seed-importer
```

### 로컬 dry-run rollback 증명

실행 명령:

```text
node scripts/generate-benefit-directory-seed.mjs --check
node scripts/verify-benefit-directory-seed.mjs
PSQL_BIN=<trusted-absolute-wrapper> DATABASE_URL=postgresql://postgres:***@127.0.0.1:54322/postgres \
  node scripts/apply-benefit-directory-seed.mjs --dry-run
```

세 명령 모두 exit 0이었다. importer는 40,053행을 COPY하고 companies/sources/receipt를 각각 40,053/40,053/1로 트랜잭션 내부 검증한 뒤 `ROLLBACK`했으며 `benefit directory seed dry-run rolled back`을 출력했다. 제한된 scalar query의 전/후 결과는 byte-for-byte 동일했다.

```json
{"companies":0,"sources":0,"receipts":0,"publications":0,"publication_aggregate_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
```

정상 persistent import는 수행하지 않았다. 정상 apply와 replay는 suite가 폐기 가능한 로컬 상태에서 검증했고 suite 종료 시 reset/stop했다.

## 4. 고정 seed 계약

| 항목 | 실제 값 |
| --- | --- |
| 전체 회사 | **40,053** |
| identity 분할 | base **1,000** / recruitment **35,910** / FTC **3,143** |
| NDJSON bytes | **18,848,420** |
| NDJSON SHA-256 | `80c89e90b0af6b31f1e2478494aff313c926d234d381294b173f26320115ca23` |
| manifest/bundle SHA-256 | `29fcc16e4d643ec2955241737cba1cacbe5f0c7f86c7c2d5f7d3522510f040ec` |
| ordered ID SHA-256 | `c96f906973da37cf14138e0ef027a05374c1fa08a6906d8c2ef2b900f7ccbf97` |
| source SHA-256 | `b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594` |

## 5. 프런트엔드 및 정적 계약

`community-app`에서 다음을 각각 실행했다.

| 명령 | 실제 결과 |
| --- | --- |
| `npm run test -- --run` | exit 0; **66 files, 1,314 tests passed**; duration 46.09s |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0; Vite 8.3.5, 278 modules transformed, build 643ms |

루트에서는 다음을 실행했다.

| 명령 | 실제 결과 |
| --- | --- |
| `node --test scripts/*.test.mjs` | exit 0; shell expansion으로 루트 `*.test.mjs` **16개 전부 포함**; **605 tests passed**, fail 0, duration 190802.674658ms |
| `mapfile -t db_shells < <(printf '%s\n' supabase/tests/*.sh \| LC_ALL=C sort); test "${#db_shells[@]}" -eq 8; for script in "${db_shells[@]}"; do bash -n -- "$script"; done` | exit 0; 정렬된 8개 DB shell script를 각각 검사. 증적 보강 후 같은 명령을 재실행해 다시 통과 |
| `git diff --check` | exit 0 |

Vite는 기존 `/images/community/community-network.svg` 및 `/images/community/benefit-atlas.svg`가 build time에 resolve되지 않고 runtime에 resolve된다는 경고를 출력했다. 빌드는 성공했다.

## 6. Docker 조립 사이트와 재현성

HEAD 전체 SHA를 포함한 외부 프로필 scratch 경로에 새 디렉터리를 만들고 다음을 실행했다.

```text
./scripts/build-site-docker.sh <scratch>/site-a
./scripts/build-site-docker.sh <scratch>/site-b
node scripts/verify-site.mjs <scratch>/site-a
node scripts/verify-site.mjs <scratch>/site-b
./scripts/verify-site-reproducibility.sh <scratch>/site-a <scratch>/site-b <scratch>/manifests
```

모든 명령은 exit 0이었다.

- A/B 각각 **3,848 regular files**, 195 directories, symlink 0, 비정규 항목 0, 현재 UID(1001) 불일치 0.
- host verifier는 두 산출물 모두에서 canonical `/benefits/`, 회사 shell, duplicate `benefits-root` 부재, artifact integrity, canonical URL, leak 검사와 정확한 eager role graph를 통과시켰다.
- `build-1.sha256`과 `build-2.sha256`은 byte-identical이다.
- manifest: **3,848 records**, 602,095 bytes, SHA-256 `aa7181668f6900f089f4819307b51848d43e2ea69556b37165b9a5343b089ed2`.
- 외부 산출물 경로: `/home/bread/.hermes/profiles/conan/cache/scratch/benefits-site-artifacts-0ebaff1a2380bc4733bfa911fedf8ece751f6369/`.
- 위 산출물과 실행 로그는 ephemeral 검증 출력이며 Git 추적 대상이 아니다.

첫 Docker 빌드 중 컨테이너 `npm ci`가 **moderate 9건**을 보고했다. 또한 기존 Sass import/global color function/function-unit deprecation 경고와 Jekyll Liquid syntax warning 2건을 출력했다. Liquid warning은 `_posts/2026-02-19-LLM-RAG-Pipeline-Guide.md`의 504행 `{{ }}` 빈 표현식과 532행 JSON 예시의 colon을 Liquid 표현식으로 해석한 것이다. 두 번째 조립은 고정 레이어 cache를 사용했고 산출물 manifest는 동일했다. 산출물 검증과 재현성은 통과했지만, 이 경고들을 릴리스 승인으로 해석하지 않는다.

## 7. 보안 및 비공개 경계

- 실제 site verifier의 비밀/구성/소스 누출 검사와 public artifact inventory 검사를 A/B 모두 통과했다.
- DB 증적에는 scalar count와 digest만 기록했다. 회사 행, 원시 RPC body, credential은 기록하지 않았다.
- 로컬 DB URL의 password는 `***`로만 표기한다. scratch 원시 실행 로그는 Git에 추가하지 않는다.
- 호스팅 Supabase, production/development 프로젝트, 배포 대상에 대한 읽기/쓰기/마이그레이션/import는 수행하지 않았다. push, PR, merge, deploy도 수행하지 않았다.
- 필수 Docker 빌드 구현은 고정 공개 Docker image 및 Ruby gem metadata를 조회했다. 이는 호스팅 제품 환경 접근이 아니며, 애플리케이션/회사 데이터나 credential을 전송하지 않았다.
- 검증 종료 확인에서 프로젝트 label 보유 컨테이너는 running 0, retained 0이었다. 관련 `psql` client 컨테이너도 남지 않았다.

## 8. NOT RUN / NO-GO

다음 항목은 의도적으로 실행하지 않았으며 통과로 표시하지 않는다.

1. `node scripts/check-benefits-browser.mjs` 및 브라우저 시각 QA/브라우저 acceptance
2. 전체 `node scripts/release-gate.mjs` 또는 `npm --prefix community-app run release:check`
3. Task 16 community browser E2E
4. 호스팅 migration/import, production smoke 또는 write canary
5. push, PR, merge, deploy

근거:

- `scripts/release-gate.mjs`의 local core는 `scripts/check-benefits-browser.mjs`를 실행하고, 그 뒤 local plan은 `scripts/community-e2e-sentinel.mjs`를 실행한다.
- `scripts/check-benefits-browser.mjs`는 `node:http`의 `createServer`를 사용하며 `server.listen(0, '127.0.0.1', ...)`로 로컬 HTTP 서버를 열고 Chromium/CDP를 실행한다. 이번 비브라우저 범위에서 금지된 경로다.
- `scripts/community-e2e-sentinel.mjs`는 “Task 16 must implement local community browser E2E verification”을 출력하고 의도적으로 exit 1을 설정한다.
- source/plan focused test `node --test scripts/release-gate.test.mjs scripts/check-benefits-browser.test.mjs`는 **123 tests passed**로 위 순서, browser preflight, sentinel fail-closed 계약을 검증했다. 이 실행은 앞서 수행한 `node --test scripts/*.test.mjs` 605 tests에 포함된 두 파일을 별도로 재실행한 **부분집합**이며 추가 test 수로 합산하지 않는다. 또한 실제 브라우저/E2E 통과를 대신하지 않는다.

따라서 비브라우저 제품 게이트의 녹색 결과와 전체 릴리스 상태를 분리한다. **전체 release gate는 green이 아니며, 릴리스 권한은 부여되지 않았다.**

## 9. Git 및 증적 상태

- 검증 대상 base: `0ebaff1a2380bc4733bfa911fedf8ece751f6369`.
- 검증 시작 전과 증적 작성 직전 작업 트리는 clean이었다.
- 이 문서만 별도 evidence commit으로 기록한다. 제품 코드 변경은 없다.
- 브랜치 upstream은 없으며 push/PR/merge/deploy는 수행하지 않았다.
- 본 문서는 독립 승인이나 Task 12 전체 완료 선언이 아니라, 위 리비전에 결속된 비브라우저 실행 사실과 NO-GO 경계를 기록한다.

## 10. Task 14 이후 판정 경계

Task 14는 위 과거 실행 결과를 소급 변경하지 않는다. 새 릴리스 계획은 claim/company
스키마·pgTAP·dblink, strict anonymous v2 projection, OpenDART 생성/독립 검증/importer,
NTS Edge check/test/fmt, 인증 route shell, canonical public Vite manifest graph, 민감값
scanner를 추가한다. DB 증적에는 base importer와 별도로 OpenDART importer의 양수 count가
필수다.

현재 상태는 다음처럼 분리해 기록한다.

- **Claims / manual company review:** 로컬 코드와 정적 계약 검증 대상이며, 호스팅 적용은 수행하지 않았다.
- **NTS verification:** mock-only 로컬 검증 대상이다. 실제 NTS canary는 **NOT RUN**이며 승인·동의·실사업자 자료 없이는 실행 금지다.
- **OpenDART production expansion:** 공식 원본과 reuse-rights authority 및 production bundle이 없어 **BLOCKED**다. 합성 fixture는 테스트 전용이다.
- **Hosted state:** migration, import, secret configuration, Function deploy, DB push, Pages deploy, canary를 수행하지 않았다.
- **Composite release gate:** browser/local HTTP/CDP 단계와 intentional Task 16 sentinel이 포함되므로 비브라우저 범위에서는 **NOT RUN / NO-GO**다. 허용된 constituent 결과를 composite green으로 표현하지 않는다.
