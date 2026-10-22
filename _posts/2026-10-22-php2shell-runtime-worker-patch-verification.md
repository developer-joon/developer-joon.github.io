---
title: 'PHP2Shell 긴급 대응: 패치 설치보다 실행 중 worker 교체를 먼저 증명하라'
date: 2026-10-22 05:00:00 +0900
categories: ["개발/보안"]
description: 'CVE-2026-109618·CVE-2026-109619의 수정 버전을 확인하고, PHP-FPM·mod_php·컨테이너에서 실제 요청을 처리하는 worker와 오래된 replica가 모두 교체됐는지 안전하게 검증하는 런북.'
featured_image: 'https://picsum.photos/seed/php2shell-runtime-worker-patch-verification/1600/900'
tags: [php, php2shell, cve-2026-109618, cve-2026-109619, php-fpm, mod-php, vulnerability-management, runtime-verification]
---

![푸른 바닷속 빈 수중 공간과 해저](https://picsum.photos/seed/php2shell-runtime-worker-patch-verification/1600/900)

패키지 관리자가 “업데이트 완료”를 출력해도 HTTP 요청을 받는 PHP worker가 자동으로 새 코드가 되는 것은 아니다.
PHP-FPM master와 child, Apache `mod_php` process, 장시간 살아 있는 container와 배포에서 빠진 replica는 디스크의 새 패키지와 별개로 이전 실행 이미지를 계속 사용할 수 있다.
이번 PHP2Shell 대응의 완료 조건은 설치 명령의 종료 코드가 아니라 **실제 요청 경로의 모든 worker가 수정된 artifact로 교체됐다는 read-back**이어야 한다.

PHP 프로젝트는 2026년 10월 21일 CVE-2026-109618과 CVE-2026-109619를 수정한 PHP `8.5.12`, `8.4.27`, `8.3.36`, `8.2.35`를 공개했다.
공식 공지는 웹 요청을 처리하는 PHP-FPM, Apache `mod_php`, `php-cgi`, FrankenPHP, LiteSpeed 설치를 위험 범위에 포함하며, 특히 `mod_php`의 위험이 가장 높다고 설명한다.[1]
PHP 8.1 이하는 upstream 지원이 끝났고, 배포판·LTS vendor의 backport가 있을 수 있으므로 숫자가 낮다는 이유만으로 무조건 미수정이라고 판정해서도 안 된다.[1]

이 글은 공격 payload, 취약점 재현 요청, exploit 성공 조건을 제공하지 않는다.
정상적인 inventory, process와 image identity 확인, 안전한 health check, 오래된 replica 제거에만 집중한다.

## 두 CVE를 한 개의 “PHP 버그”로 뭉개지 말아야 하는 이유

CVE-2026-109618은 OOM 처리 중 부분 초기화된 request memory가 유효한 상태처럼 처리될 수 있는 문제다.
PHP advisory는 Apache `mod_php`에서 application code 실행 전에도 문제가 발생할 수 있고, 기본 입력·memory limit 조건에서 web worker 권한의 인증 전 RCE가 검증됐다고 밝힌다.[2]
그러나 FPM에 대해서는 source analysis상 susceptible하되 이 SAPI의 해당 경로에 대한 완전한 exploit은 입증되지 않았다고 경계를 둔다.[2]
“모든 SAPI가 똑같은 조건과 신뢰도로 exploit됐다”라고 쓰면 공식 범위를 넘는다.

CVE-2026-109619는 한 request가 소유한 error·session·object·extension 상태를 persistent worker가 잘못 유지하고, 다음 request가 정상 초기화 전에 그 stale state를 사용하는 use-after-free 문제다.[3]
공식 advisory는 fatal backtrace 경로의 `mod_php` RCE와 session lifecycle 경로의 `mod_php`·FPM RCE를 확인했다.[3]
Producer와 consumer request가 같은 worker에 도달해야 하지만 worker 수를 늘리거나 자주 재활용하는 조치는 요청당 성공 가능성을 낮출 뿐 조건을 제거하지 않는다.[3]
그래서 worker restart는 패치 적용에 필요하지만, restart 빈도를 높이는 것 자체는 수정이 아니다.

두 취약점의 수정 버전은 같아도 검증해야 할 실행 경계는 다르다.
OOM 문제는 request 시작과 종료, frontend request limit, worker memory 경계를 함께 보게 한다.
Stale global state 문제는 request를 여러 번 처리하는 persistent worker와 restart 누락을 특히 중요하게 만든다.
운영자는 CVE별 exploit을 재현하는 대신 두 수정이 모두 포함된 build가 모든 실제 요청 경로에 올라갔는지 증명해야 한다.

PHP Foundation은 release 시점에 당시 등장한 PoC들을 검토했지만 functional exploit을 확인하지 못했다고 밝혔다.[4]
이는 공개 시점의 관측 경계이며 취약점의 영향이나 patch 긴급도를 낮추는 문장이 아니다.

## 공식 사실과 이 글의 운영 권고를 구분한다

아래 표의 왼쪽은 공식 자료가 직접 말하는 내용이고, 오른쪽은 그 사실을 production 변경으로 옮기기 위한 이 글의 권고다.
오른쪽의 field 이름과 gate는 PHP가 정의한 protocol이나 제품 field가 아니다.

| 구분 | 공식 사실 | 운영 권고 |
|---|---|---|
| 수정선 | `8.2.35`, `8.3.36`, `8.4.27`, `8.5.12`가 upstream 수정 release다.[1] | 자산마다 `upstream_release` 또는 `vendor_backport` 중 어떤 근거로 수정 판정을 내렸는지 기록한다. |
| 실행 범위 | 웹 요청을 처리하는 여러 SAPI가 위험 범위이며 `mod_php`가 가장 높은 위험으로 평가됐다.[1] | CLI의 `php -v` 한 번이 아니라 SAPI·pool·virtual host·container별 runtime inventory를 만든다. |
| 완전한 완화 | 두 advisory 모두 수정 release로 update하는 것만 완전한 mitigation이라고 명시한다.[2][3] | 구성 완화 상태와 patch 상태를 별도 열로 관리하고, 완화만 적용된 자산을 `patched`로 승격하지 않는다. |
| worker lifecycle | 임시 설정을 바꾼 뒤 모든 PHP worker를 restart해야 한다.[2][3] | 패키지 설치 시각보다 늦은 process start time, 새 executable 또는 module identity, old worker 0을 완료 gate로 둔다. |
| 침해 관측 | CISA는 공지 시점에 exploitation을 관측하지 못했다고 밝혔다.[5] | “관측하지 못함”을 “악용되지 않음”으로 바꾸지 말고 별도 탐지·조사 상태를 유지한다. |

## 1단계: `php -v`보다 먼저 요청 경로를 inventory한다

Shell에서 실행한 `php -v`는 보통 CLI SAPI를 보여 준다.
웹 요청이 PHP-FPM socket, Apache module, LiteSpeed worker 또는 별도 container로 흐르면 그 결과는 serving runtime의 증거가 아니다.
같은 host에 PHP 8.2와 8.3 pool이 공존하거나 서로 다른 Unix socket을 virtual host별로 연결한 환경도 흔하다.

먼저 다음 단위를 분리한다.

1. 외부·내부 ingress가 연결되는 load balancer와 reverse proxy route
2. route가 가리키는 FPM socket·TCP upstream·Apache virtual host
3. SAPI와 pool 또는 service 이름
4. host·VM·container·pod와 현재 image identity
5. 실행 중 master·worker PID, 시작 시각, executable 또는 loaded module identity
6. vendor package와 backport advisory
7. drain 중이거나 scale-to-zero처럼 보이지만 다시 살아날 수 있는 old replica

다음 명령은 local host에서 관련 process 후보의 executable 이름과 시작 시각만 읽는다.
전체 command line은 token·접속 문자열 같은 secret을 포함할 수 있으므로 기본 inventory에서 수집하지 않는다.

```bash
ps -eo pid=,lstart=,comm= \
  | grep -E 'php-fpm|php-cgi|apache2|httpd|frankenphp|lsphp'
```

Process 목록은 후보군일 뿐이다.
`php-fpm: pool checkout`처럼 pool 이름이 보여도 reverse proxy가 그 pool을 실제로 사용한다는 증거는 아니다.
Nginx `fastcgi_pass`, Apache module·proxy 설정, service discovery와 load balancer target을 함께 읽어 request route를 연결한다.
설정 파일을 수집할 때 credential이 포함된 include나 environment dump를 티켓에 붙이지 않는다.

## 2단계: 실행 중 process의 identity를 read-back한다

Linux에서는 선택한 PID의 `/proc` 정보를 사용해 실행 파일과 시작 시각을 읽을 수 있다.
다음 예시는 `TARGET_PID`를 명시하도록 강제하며 process command line을 읽지 않고 실행 파일 hash·`libphp` module path만 출력한다.
읽기 권한이 부족하면 실패한 사실을 남기고 승인된 권한으로 다시 수집한다.

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${TARGET_PID:?set TARGET_PID to a verified PHP or web worker PID}"
proc="/proc/${TARGET_PID}"
test -r "${proc}/status"

printf 'pid=%s\n' "$TARGET_PID"
printf 'started='; ps -o lstart= -p "$TARGET_PID"
printf 'exe='; readlink "${proc}/exe"
printf 'exe_sha256='; sha256sum "${proc}/exe" | cut -d' ' -f1
printf 'loaded_libphp='
awk '$6 ~ /\/libphp[^/]*\.so(\.|$)/ {print $6}' "${proc}/maps" \
  | sort -u \
  | paste -sd, -
```

FPM·CGI처럼 process executable 자체가 PHP인 경우에는 같은 inode를 새 process로 읽어 build string을 확인할 수 있다.
이 명령은 취약 요청을 보내지 않으며 version 정보만 요청한다.

```bash
set -euo pipefail

: "${TARGET_PID:?set TARGET_PID to a verified PHP worker PID}"
"/proc/${TARGET_PID}/exe" -v 2>&1 | sed -n '1p'
```

`mod_php`에서는 `/proc/<pid>/exe`가 Apache binary이므로 이 결과를 PHP version으로 오해하면 안 된다.
앞선 `loaded_libphp` 경로와 hash를 package database, vendor advisory 또는 SBOM의 수정 build에 연결한다.
파일 경로 끝에 `(deleted)`가 보이거나 package update 뒤 process 시작 시각이 그대로라면 이전 mapping을 유지하는 worker일 가능성이 있으므로 restart 후 다시 읽는다.

Upstream version 비교도 만능은 아니다.
배포판이 수정 내용을 이전 version string에 backport했다면 `8.1.x`처럼 보이는 숫자만으로 취약 판정을 내릴 수 없다.
반대로 vendor package가 설치됐다는 사실만으로 실행 중 process가 그 파일을 mapping했다는 것도 증명되지 않는다.
**Vendor advisory 또는 package changelog + 설치된 artifact identity + 실행 중 artifact identity**를 한 행에서 연결해야 한다.

## 3단계: container는 tag가 아니라 실행 image ID와 교체 상태를 본다

Mutable tag인 `php:8.3`이나 `latest`는 identity가 아니다.
Registry에서 tag가 새 digest를 가리켜도 이미 실행 중인 container는 자동으로 교체되지 않는다.
Docker 환경에서는 먼저 실행 container와 content-addressed image ID, 시작 시각을 읽는다.

{% raw %}
```bash
#!/usr/bin/env bash
set -euo pipefail

: "${CID:?set CID to the reviewed container ID or name}"
docker inspect --format \
  'name={{.Name}} image_id={{.Image}} configured_image={{.Config.Image}} started={{.State.StartedAt}} status={{.State.Status}}' \
  "$CID"
```
{% endraw %}

Container 안의 CLI 확인은 package sanity check로는 쓸 수 있지만 serving SAPI 증거로 단독 사용하지 않는다.
대신 container 내부의 실제 worker PID를 고르고 `/proc/<pid>/exe`와 시작 시각을 읽거나, 인증된 내부 health path가 반환하는 최소 runtime metadata를 배포 시스템에서 수집한다.
Health 응답에 environment, loaded secret, 전체 `phpinfo()`를 노출하지 않는다.

Kubernetes에서는 tag와 pod spec뿐 아니라 kubelet이 보고한 `imageID`를 저장한다.
다음 예시는 선택한 namespace와 label selector의 현재 container identity를 읽기만 한다.

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${NS:?set NS}"
: "${SELECTOR:?set SELECTOR, for example app=checkout}"

kubectl -n "$NS" get pods -l "$SELECTOR" -o json \
  | jq -r '.items[] as $p
      | $p.status.containerStatuses[]?
      | [$p.metadata.name, .name, .image, .imageID,
         (.ready|tostring), (.restartCount|tostring)]
      | @tsv'
```

`imageID`가 목표 digest와 일치해도 rollout이 끝났다는 충분조건은 아니다.
Ready가 아닌 old pod, load balancer endpoint에 남은 terminating pod, 다른 namespace의 동일 service, cron·queue worker와 scale-to-zero workload도 별도 확인한다.
웹 요청을 직접 받지 않는 PHP queue worker는 이번 두 CVE의 동일한 HTTP 노출 경계와 같다고 단정할 수 없지만, 같은 image를 재사용한다면 다음 scale-up 때 취약 runtime을 되살릴 수 있으므로 artifact inventory에는 포함하는 편이 안전하다.

Deployment에 속한 ReplicaSet 중 replica가 남은 것을 확인하는 read-only 예시는 다음과 같다.
이 명령의 `ownerReferences` 확인은 label 이름에 의존하지 않는다.

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${NS:?set NS}"
: "${DEPLOY:?set DEPLOY}"

kubectl -n "$NS" get rs -o json \
  | jq -r --arg d "$DEPLOY" '
      .items[]
      | select(any(.metadata.ownerReferences[]?;
          .kind == "Deployment" and .name == $d))
      | [.metadata.name,
         ((.spec.replicas // 0)|tostring),
         ((.status.readyReplicas // 0)|tostring),
         (.metadata.annotations["deployment.kubernetes.io/revision"] // "-")]
      | @tsv'
```

가장 최근 revision만 목표 digest이고 이전 ReplicaSet의 `spec.replicas`가 0이 아니라면 완료가 아니다.
HPA, progressive delivery controller, service mesh와 별도 traffic splitter가 replica나 traffic을 되살릴 수 있으므로 각 control plane의 effective state도 확인한다.

## 4단계: patch, restart, read-back을 하나의 변경으로 묶는다

안전한 production 순서는 다음과 같다.
이 절차는 PHP 프로젝트의 product field가 아니라 운영 권고다.

1. **Scope freeze**: 모든 ingress→SAPI→pool→worker·pod 경로와 책임자를 고정한다.
2. **Artifact 승인**: upstream 수정 release 또는 vendor backport의 advisory, package version, image digest를 연결한다.
3. **Canary 교체**: 대표 SAPI와 extension 조합별 canary를 새 artifact로 띄운다.
4. **정상 기능 검사**: login, upload가 필요한 서비스의 정상 upload, session, queue handoff, extension load를 안전한 fixture로 검사한다. 취약 payload를 보내지 않는다.
5. **전체 rollout**: FPM·Apache worker를 모두 restart하거나 immutable image로 pod를 교체한다. Reload가 실제 child 교체를 보장하는지 process start time으로 확인한다.
6. **Read-back**: 목표 artifact identity, worker 시작 시각, Ready endpoint, load balancer membership을 다시 수집한다.
7. **Old count zero**: 이전 executable·module hash, 이전 image ID, 이전 ReplicaSet과 drain되지 않은 target 수가 모두 0인지 확인한다.
8. **관측 강화**: PHP worker의 비정상 child process, tool download, crash·OOM·fatal error, rollout 뒤 error rate를 감시한다.

Package install과 service restart 사이를 별도 변경으로 나누면 오래된 worker가 계속 요청을 받을 수 있다.
반대로 restart만 먼저 하면 같은 취약 artifact를 다시 실행한다.
두 단계는 순서가 있는 하나의 transaction으로 다루고 중간 상태를 `installed_not_restarted`처럼 명시한다.

Rollback도 “이전 image로 되돌리기”가 기본값이면 안 된다.
이전 artifact가 취약하면 compatibility 문제를 해결하는 동안 traffic을 격리하거나 수정된 대체 build로 forward-fix한다.
Rollback 후보는 **수정이 포함됐다고 별도로 검증된 artifact**여야 한다.

## 완료 판정을 기계적으로 만들기

다음 record는 PHP 표준이 아니라 조직 내부 증거 schema의 예시다.
한 행이 하나의 실제 요청 경계를 가리키게 하고 unknown을 false로 바꾸지 않는다.

```text
asset_id: web-prod-a/fpm-checkout
route: public-checkout -> nginx -> unix:/run/php/checkout.sock
sapi: fpm-fcgi
fix_basis: vendor_backport
fix_reference: VENDOR-ADVISORY-ID
artifact_identity: sha256:<approved-digest>
worker_started_after_patch: true
running_worker_count: 24
old_artifact_worker_count: 0
load_balancer_old_target_count: 0
normal_fixture_result: pass
security_review_state: monitoring
observed_at: 2026-10-22T05:40:00+09:00
```

`artifact_identity`는 실제 값으로 채우며 예시 문자열을 production 증거로 복사하지 않는다.
다음 promotion 조건을 모두 만족해야 `verified_patched`로 올린다.

- 대상 route의 inventory coverage가 100%다.
- 각 route의 fix 근거가 upstream release 또는 vendor backport advisory로 확인됐다.
- 실행 중 worker·module·container image identity가 승인 artifact와 연결된다.
- Patch 적용 전 시작된 worker와 old artifact worker가 0이다.
- Old ReplicaSet, old task, drain되지 않은 old target이 0이다.
- 대표적인 정상 request fixture와 extension compatibility test가 통과했다.
- 관측 실패나 권한 부족은 `unknown`으로 남으며 통과로 계산하지 않는다.

단순 평균 coverage는 위험한 공백을 숨긴다.
Internet-facing `mod_php` route 하나가 미확인인데 내부 batch worker 수백 개가 확인됐다고 99% 완료로 발표해서는 안 된다.
외부 노출, SAPI, business criticality별 gate를 따로 두고 가장 위험한 미확인 경로가 전체 promotion을 막게 한다.

## 임시 구성 완화는 patch 상태가 아니다

PHP 공식 advisory는 update만 완전한 mitigation이라고 반복한다.[2][3]
CVE-2026-109618에 대해 administratively enforced `memory_limit=-1`, frontend request size·multipart 경계, container 또는 cgroup memory limit 등이 일부 경로의 위험을 줄일 수 있지만 완전한 해결은 아니다.[2]
특히 `RLIMIT_AS`와 `RLIMIT_DATA`는 allocation failure를 일으켜 취약한 `longjmp()` 경로를 촉발할 수 있으므로 사용하지 말라고 명시돼 있다.[2]

CVE-2026-109619에 대해서는 필요하지 않은 `session.upload_progress.enabled=0`, PHP 8.5의 `fatal_error_backtraces=0`, early INI diagnostic과 attacker-reachable fatal error 제거가 임시 위험 축소책이다.[3]
이 설정들은 administratively 적용하고 모든 worker를 restart해야 하며, 각각 확인된 일부 producer·consumer 경로만 줄인다.[3]
`error_reporting`, `display_errors`, `log_errors` 또는 `@`로 메시지를 숨기는 것은 stale state 접근 전에 이미 global state가 사용되므로 보호책이 아니다.[3]

완화 설정을 적용했다면 다음을 별도로 기록한다.

- 원하는 설정이 놓인 계층: `php.ini`, FPM pool, Apache server configuration
- application이나 directory override가 되살릴 수 있는 값
- 모든 worker restart 시각과 effective configuration read-back
- 완화가 다루는 CVE와 경로
- 다루지 못하는 경로
- Patch 적용 기한과 완화 제거·유지 결정

WAF도 patch 대신 `fixed=true`를 만들 수 없다.
CISA는 update 전 일부 보호가 가능하다고 표현하지만, 동시에 즉시 patch하고 수정할 수 없는 unsupported PHP system은 offline으로 전환하라고 권고한다.[5]

## 공개 PoC와 실제 침해를 같은 상태로 쓰지 않는다

PHP Foundation은 release 시점에 등장한 PoC들을 검토했지만 functional exploit을 확인하지 못했다고 설명했다.[4]
CISA 역시 2026년 10월 21일 공지 시점에는 exploitation을 관측하지 못했다고 밝혔다.[5]
반면 CERT-EU는 기술 세부 정보와 초기 PoC가 공개적으로 돌기 시작해 악용 가능성이 커졌다고 평가했다.[6]
이 세 문장은 충돌하지 않는다.
PoC circulation, 기능이 검증된 exploit, internet scanning·attempt, 실제 침해 확인은 서로 다른 상태다.

따라서 사건 티켓에는 최소한 다음 축을 분리한다.

- `public_detail_state`: advisory만 공개 / PoC circulation / functional exploit independently validated
- `attempt_state`: telemetry 없음 / scanning·attempt 관측 / 대상 worker 도달 확인
- `compromise_state`: indicator 없음 / 조사 불충분 / 의심 / 확인
- `patch_state`: 미설치 / 설치 후 미재시작 / 일부 worker 교체 / 전체 runtime 검증

CISA는 PHP worker가 shell을 실행하거나 tool을 내려받는 등 의심 행위를 감시하라고 권고한다.[5]
이는 유용한 탐지 시작점이지만 해당 행위가 없다는 사실이 침해 부재를 증명하지는 않는다.
Process telemetry, reverse proxy·WAF log, egress DNS·HTTP, unexpected file change, service account activity와 cloud audit를 같은 시간축에서 본다.
이미 의심 신호가 있다면 패치와 worker restart가 포렌식 보존·credential 회전·신뢰 복구를 대신하지 않는다.

또한 정상적인 `php-fpm` child spawn과 worker가 실행한 비정상 shell을 구분한다.
Parent-child relationship, executable signer·hash, command category, destination과 change window를 결합한다.
명령행 전체에는 token이나 secret이 포함될 수 있으므로 일반 티켓에 무분별하게 복사하지 않고 접근 통제된 증거 저장소를 사용한다.

## 자주 실패하는 대응

### 1. CLI version만 확인한다

`php -v`가 수정 version이어도 Nginx가 다른 FPM socket을 가리키거나 Apache가 이전 `libphp`를 mapping할 수 있다.
SAPI·route·PID까지 연결하지 못한 version은 참고 정보다.

### 2. Package install 성공을 runtime 교체로 기록한다

Disk의 package와 memory에 올라간 executable은 다를 수 있다.
설치 전 시작된 worker 수와 old artifact hash를 다시 세어야 한다.

### 3. Container tag를 다시 push하고 끝낸다

같은 tag의 digest가 바뀌어도 실행 container는 그대로다.
Pod의 `imageID`, 시작 시각, old ReplicaSet과 target membership을 확인한다.

### 4. Ready replica 수만 본다

새 replica가 모두 Ready여도 old replica가 drain 중이거나 다른 service selector에 남아 있을 수 있다.
`new ready == desired`와 `old serving == 0`은 별도 조건이다.

### 5. 구성 완화를 완전한 수정으로 바꾼다

`memory_limit=-1`, upload progress 비활성화, WAF rule은 특정 경로의 위험을 줄일 뿐 두 취약점 전체를 고치지 않는다.[2][3][5]
완화 적용 자산에는 patch deadline을 유지한다.

### 6. PoC 공개를 침해 확인으로 쓴다

공개 자료의 존재는 긴급도를 높이지만 특정 조직의 침해 증거는 아니다.
반대로 CISA가 공지 시점에 관측하지 못했다는 문장도 이후의 악용이나 개별 조직의 안전을 보증하지 않는다.[5]

## 결론: “새 package가 있다”에서 “오래된 worker가 없다”로

PHP2Shell 대응의 공식 수정선은 명확하다.
PHP `8.5.12`, `8.4.27`, `8.3.36`, `8.2.35`로 update하거나, EOL branch라면 배포판·LTS vendor의 검증된 backport 또는 지원 branch 전환을 사용한다.[1]
임시 설정과 WAF는 시간을 벌 수 있지만 완전한 수정은 아니다.[2][3][5]

운영에서 어려운 부분은 release 번호를 외우는 일이 아니다.
외부 request가 어느 SAPI와 pool로 들어가는지, 어느 PID·module·container digest가 실제로 처리하는지, package update 뒤 모든 persistent worker가 교체됐는지, old replica가 다시 traffic을 받을 수 없는지 증명하는 일이다.

최종 보고서는 “패치 명령 성공” 한 줄이 아니라 다음 문장이어야 한다.
**모든 요청 경계를 inventory했고, 각 경계의 실행 artifact를 수정 근거에 연결했으며, 패치 전 worker·old image·old replica·old target이 0임을 같은 시점의 read-back으로 확인했다.**
그 증거가 없으면 상태는 실패가 아니라 `unknown`이다.
`unknown`을 안전으로 바꾸지 않는 것이 이번 긴급 대응의 마지막 통제다.

## Sources

[1] https://www.php.net/archive/2026.php#2026-10-21-5 — PHP, Security advisory: Critical remote code execution vulnerabilities, update now
[2] https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w — PHP, CVE-2026-109618: RCE via OOM corruption
[3] https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp — PHP, CVE-2026-109619: RCE via stale global state
[4] https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/ — PHP Foundation, Today's PHP Security Release
[5] https://www.cisa.gov/news-events/alerts/2026/10/21/critical-vulnerabilities-php-require-immediate-patching — CISA, Critical Vulnerabilities in PHP Require Immediate Patching
[6] https://cert.europa.eu/publications/security-advisories/2026-018 — CERT-EU, Critical Vulnerabilities in PHP
