---
title: 'Java4Shell 긴급 대응: 코드 저장소에 없는 JVM까지 찾아 패치하는 법'
date: 2026-11-22 07:30:00 +0900
categories: ["개발/보안"]
description: 'CVE-2026-114938 대응에서 SBOM만 믿지 않고, 아티팩트·컨테이너 이미지·배포 정의·실행 프로세스의 번들 JVM까지 찾아 패치 증거를 남기는 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/hotnews-java4shell-jvm/1600/900'
tags: [java4shell, cve-2026-114938, java, jvm, sbom, vulnerability-management]
---

![서리가 하얗게 내려앉은 풀과 멀리 흐릿하게 보이는 건물](https://picsum.photos/seed/hotnews-java4shell-jvm/1600/900)

CISA는 2026년 11월 17일 CVE-2026-114938, 이른바 “Java4Shell”의 즉시 패치를 권고했다. CISA 설명에 따르면 이 취약점은 JDK에 포함된 x86-64 HotSpot JVM의 Base64 디코더에 있는 메모리 손상 문제다. 조작된 Base64 입력은 JVM을 중단시키고 인증 없는 원격 코드 실행으로 이어질 수 있다.[1]

“저장소 SBOM에 Java가 없으니 안전하다”는 판단은 위험하다. JVM은 상용 제품·컨테이너 이미지·가상 어플라이언스에 함께 들어올 수 있다. CISA도 JDK와 Java runtime이 인벤토리에 별도 항목으로 나타나지 않을 수 있다고 경고했다.[1]

## 확인된 위험과 아직 확인되지 않은 것

Oracle의 2026년 11월 업데이트는 CVE-2026-114938을 Java SE·GraalVM의 `Compiler` 문제로 기록한다. CVSS 3.1 점수는 8.1이며 네트워크 공격 경로, 높은 공격 복잡도, 인증·사용자 상호작용 불필요, 기밀성·무결성·가용성의 높은 영향을 제시한다.[2] CISA의 “critical” 표현과 Oracle 점수는 출처별 맥락을 구분한다.

**악용 가능성**과 **실제 악용 확인**도 분리한다. CISA 경보는 원격 코드 실행 가능성과 즉시 패치 필요성을 말하지만 active exploitation을 확인했다고 쓰지는 않았다.[1] “현재 활발히 악용 중”이라고 확대하지 않되 패치는 늦추지 않는다.

CVE.org 레코드는 2026년 11월 17일 PUBLISHED 상태가 됐고 Oracle 제품의 영향 빌드와 CVSS 3.1 점수 8.1을 공개했다.[3] 다만 비-Oracle 배포판과 번들 제품은 각 공급자 문서의 **JVM 공급자·제품·전체 빌드 문자열**로 affected/fixed를 판정한다. “Java 17” 같은 major version만으로 결정하면 안 된다.

## SBOM 부재가 안전을 증명하지 못하는 이유

소스 SBOM에서 다음 경로는 쉽게 빠진다.

1. 벤더 애플리케이션이 `jre/`, `runtime/`, `jdk/` 아래에 넣은 private JVM
2. multi-stage container build의 최종 이미지에 복사된 `java` 실행 파일
3. Helm·Kustomize·Terraform이 참조하는 외부 이미지와 mutable tag
4. 노드에 압축 해제된 운영 도구, 백업 에이전트, 설치 프로그램
5. 이미 떠 있는 프로세스가 잡고 있는 삭제·교체 전 실행 파일

따라서 인벤토리는 네 층을 같은 ticket에서 연결해야 한다.

| 층 | 찾아야 할 것 | 최소 증거 |
|---|---|---|
| 아티팩트 | 배포 ZIP/TAR, 설치 디렉터리, appliance export의 JVM | 경로, SHA-256, `release` 파일의 공급자·빌드 |
| 이미지 | registry digest별 최종 root filesystem | immutable digest, scan 시각, 발견된 `java` 경로 |
| 배포 정의 | 실제 환경이 참조하는 image·chart·manifest | namespace/service, 선언 digest, rollout revision |
| 실행 프로세스 | 현재 PID가 실제로 연 `java` executable | PID, `/proc/<pid>/exe`, executable SHA-256, 시작 시각 |

한 층의 결과를 다른 층의 대리 증거로 쓰지 않는다. Registry 업로드는 배포 완료가 아니고, package manager에 Java가 없어도 번들 JVM은 존재할 수 있다. 실행 프로세스까지 확인해야 한다.

## 자격 증명을 노출하지 않는 fail-closed 인벤토리

다음 fixture는 Linux host에서 승인된 root filesystem 목록과 현재 실행 중인 JVM을 조사한다. `ROOTS_FILE`에는 host의 검사 경로와, 별도 안전 절차로 이미 풀어 둔 image rootfs 경로를 한 줄에 하나씩 적는다. Remote registry를 직접 조회하거나 image를 추출하지 않으므로 인증 토큰을 받지 않는다. 또한 `/proc/<pid>/cmdline`과 전체 `ps` 인자를 읽지 않아 JVM option에 들어간 token·password를 출력하지 않는다.

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${ROOTS_FILE:?set ROOTS_FILE to an approved absolute-path list}"
: "${OUT:?set OUT to the destination TSV path}"
PROC_ROOT=${PROC_ROOT:-/proc}
[[ -r "$ROOTS_FILE" ]] || { echo "ROOTS_FILE is not readable" >&2; exit 1; }
[[ "$OUT" = /* ]] || { echo "OUT must be an absolute path" >&2; exit 1; }
[[ "$PROC_ROOT" = /* && -d "$PROC_ROOT" ]] || { echo "invalid PROC_ROOT" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
candidate="$work/jvm-inventory.tsv"
printf 'origin\tpid\texecutable\tsha256\trelease_sha256\tjava_version\timplementor\timplementor_version\truntime_version\n' >"$candidate"
declare -A seen=()
errors=0

release_value() {
  local key=$1 file=$2 value count
  count=$(grep -c "^${key}=" "$file" || :)
  (( count == 0 )) && { printf unknown; return 0; }
  (( count == 1 )) || return 1
  value=$(grep "^${key}=" "$file") || return 1
  value=${value#*=}
  [[ "$value" == \"*\" ]] || return 1
  value=${value#\"}
  value=${value%\"}
  [[ -n "$value" && "$value" != *\"* && "$value" != *$'\t'* \
    && "$value" != *$'\r'* ]] || return 1
  printf '%s' "$value"
}

record_java() {
  local origin=$1 pid=$2 exe=$3 boundary=${4:-/} home release version implementor
  local implementor_version runtime_version hash release_hash key link_target field
  [[ -f "$exe" && -x "$exe" ]] || { errors=1; return; }
  key="$origin|$pid|$exe"
  [[ -z "${seen[$key]:-}" ]] || return 0
  seen[$key]=1

  if ! hash=$(sha256sum -- "$exe"); then errors=1; return; fi
  hash=${hash%% *}
  home=$(dirname -- "$(dirname -- "$exe")")
  release="$home/release"
  version=unknown implementor=unknown implementor_version=unknown
  runtime_version=unknown release_hash=unknown
  if [[ -L "$release" || -e "$release" ]]; then
    if [[ -L "$release" && "$boundary" != / ]]; then
      link_target=$(readlink -- "$release") || { errors=1; return; }
      [[ "$link_target" != /* ]] || { errors=1; return; }
    fi
    if ! release=$(readlink -f -- "$release"); then errors=1; return; fi
    [[ "$boundary" == / || "$release" == "$boundary" || "$release" == "$boundary/"* ]] \
      || { errors=1; return; }
    [[ -r "$release" ]] || { errors=1; return; }
    if ! release_hash=$(sha256sum -- "$release"); then errors=1; return; fi
    release_hash=${release_hash%% *}
    if ! version=$(release_value JAVA_VERSION "$release"); then errors=1; return; fi
    if ! implementor=$(release_value IMPLEMENTOR "$release"); then errors=1; return; fi
    if ! implementor_version=$(release_value IMPLEMENTOR_VERSION "$release"); then errors=1; return; fi
    if ! runtime_version=$(release_value JAVA_RUNTIME_VERSION "$release"); then errors=1; return; fi
  fi
  for field in "$origin" "$pid" "$exe" "$hash" "$release_hash" "$version" \
    "$implementor" "$implementor_version" "$runtime_version"; do
    [[ "$field" != *$'\t'* && "$field" != *$'\n'* && "$field" != *$'\r'* ]] \
      || { errors=1; return; }
  done
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$origin" "$pid" "$exe" "$hash" "$release_hash" "$version" \
    "$implementor" "$implementor_version" "$runtime_version" >>"$candidate"
}

index=0
while IFS= read -r root || [[ -n "$root" ]]; do
  [[ -n "$root" && "$root" = /* && -d "$root" ]] || { errors=1; continue; }
  index=$((index + 1))
  found="$work/root-$index.bin"
  if ! find "$root" -xdev \( -type f -o -type l \) -name java -print0 >"$found"; then
    errors=1
    continue
  fi
  while IFS= read -r -d '' exe; do
    if [[ -L "$exe" && "$root" != / ]]; then
      link_target=$(readlink -- "$exe") || { errors=1; continue; }
      [[ "$link_target" != /* ]] || { errors=1; continue; }
    fi
    if ! resolved=$(readlink -f -- "$exe"); then errors=1; continue; fi
    [[ "$root" == / || "$resolved" == "$root" || "$resolved" == "$root/"* ]] \
      || { errors=1; continue; }
    record_java artifact - "$resolved" "$root"
  done <"$found"
done <"$ROOTS_FILE"

(( index > 0 )) || errors=1

for proc in "$PROC_ROOT"/[0-9]*; do
  pid=${proc##*/}
  [[ -L "$proc/exe" ]] || continue
  if ! exe=$(readlink -f -- "$proc/exe"); then errors=1; continue; fi
  [[ ${exe##*/} == java ]] || continue
  record_java runtime "$pid" "$exe" /
done

if (( errors != 0 )); then
  echo "inventory incomplete; no result promoted" >&2
  exit 1
fi
mv -- "$candidate" "$OUT"
printf 'inventory written to %s\n' "$OUT" >&2
```

이 스크립트는 취약 판정기가 아니라 **누락을 숨기지 않는 수집기**다. 빈 검사 목록과 권한·검색·hash 오류가 있으면 결과를 승격하지 않는다. 별도 rootfs의 절대 symlink나 root 밖으로 탈출하는 link도 host 파일로 잘못 해석하지 않고 실패시킨다. 이런 image는 해당 mount namespace에서 검사하거나 link를 rootfs 내부 경로로 안전하게 materialize한 뒤 다시 수집한다. 낯선 binary를 실행하지 않도록 `java -version` 대신 `release`를 읽고, 공급자·runtime build와 `release` 파일 hash를 함께 남긴다. `PROC_ROOT` 기본값은 `/proc`이며 다른 값은 격리 fixture 시험에만 쓴다. `unknown`은 공급자 확인이 필요한 상태이며 패치 완료로 승격할 수 없다.

컨테이너는 registry digest별 rootfs를 검사하고, 배포 정의와 실행 Pod의 image ID가 같은 digest인지 확인한다. Kubernetes의 init container, sidecar, Job·CronJob과 operator 생성 workload도 포함한다. Appliance는 공급자 문서와 관리 화면의 실제 build를 대조한다.

## 패치는 파일 교체가 아니라 runtime 교체다

CISA는 관련 Java 및 vendor patch를 가능한 한 빨리 적용하되 internet-facing system을 우선하라고 권고한다. 즉시 패치가 어렵다면 애플리케이션 경계에서 Base64 입력 제한·검증, 입력 크기 제한, 인증 없는 접근 제한 같은 임시 보완 통제를 제시한다.[1] 이 통제는 시간을 벌기 위한 것이며 vendor patch의 완료 증거가 아니다.

실행 순서는 다음처럼 잡는다.

1. 외부 노출, 인증 전 입력, identity·build·artifact 시스템을 우선순위로 정한다.
2. JVM마다 공급자 advisory에서 정확한 fixed build와 재시작 필요 조건을 확인한다.
3. 아티팩트와 image를 immutable digest로 다시 만들고 서명·scan 결과를 연결한다.
4. canary에서 시작 실패, JVM crash, latency와 Base64 처리 회귀를 확인한다.
5. 모든 replica를 교체하고 오래된 Pod·VM·Job이 traffic이나 queue를 받지 못하게 한다.
6. 실행 PID의 executable hash와 `release` build를 다시 수집해 선언값과 대조한다.
7. 임시 통제를 유지·해제할 조건과 rollback 기준을 기록한다.

JDK만 업데이트하고 재시작하지 않으면 JVM은 예전 파일을 계속 사용할 수 있다. 자체 JVM을 번들한 제품에는 OS 기본 Java 업데이트가 적용되지 않는다. Artifact, deployment, runtime 세 상태가 모두 맞아야 한다.

## 패치 완료와 증거 체크리스트

- [ ] 모든 발견 JVM에 owner, 서비스, 공급자, 전체 build, executable hash를 연결했다.
- [ ] `unknown`, 접근 실패, scan 누락을 green으로 처리하지 않았다.
- [ ] Oracle 또는 해당 공급자의 CVE-2026-114938 문서로 affected/fixed를 판정했다.
- [ ] internet-facing 및 인증 전 Base64 입력 경로를 우선 처리했다.
- [ ] 패치된 아티팩트와 image digest가 승인·서명·scan 증거와 일치한다.
- [ ] 배포 정의의 digest와 실제 workload image ID가 일치한다.
- [ ] 모든 실행 PID에서 새 executable hash와 runtime build를 다시 확인했다.
- [ ] 오래된 replica, batch worker, init container, sidecar, CronJob이 남지 않았다.
- [ ] 임시 보완 통제의 owner·만료일·해제 조건과 rollback 기준을 남겼다.

Java4Shell 대응의 핵심은 버전 표를 복사하는 데 있지 않다. 코드 저장소 밖 JVM까지 찾아 **어떤 아티팩트가 어떤 배포를 거쳐 어떤 프로세스로 실행되는지** 연결하고, vendor 기준으로 패치한 뒤 같은 경로를 역으로 검증하는 데 있다. SBOM에 항목이 없다는 것은 조사 시작점일 뿐, 안전 판정이 아니다.

## Sources

[1] https://www.cisa.gov/news-events/alerts/2026/11/17/critical-java-vulnerability-requires-immediate-patching
[2] https://www.oracle.com/security-alerts/cspunov2026.html#AppendixJAVA
[3] https://www.cve.org/CVERecord?id=CVE-2026-114938
