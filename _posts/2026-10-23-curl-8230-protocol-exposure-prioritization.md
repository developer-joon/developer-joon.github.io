---
title: 'curl 8.23.0 보안 업데이트: CVE 개수보다 실제 사용 프로토콜을 먼저 찾아라'
date: 2026-10-23 09:00:00 +0900
categories: ["개발/보안"]
description: 'curl 8.23.0의 보안 수정을 버전 숫자 하나로 평탄화하지 않고, HTTP/2 upload·WebSocket·Schannel·GnuTLS·SFTP 등 실제 프로토콜과 TLS backend 노출을 read-only 증거로 분리해 패치 순서를 정한다.'
featured_image: 'https://picsum.photos/seed/curl-8230-protocol-exposure-priority/1600/900'
tags: [curl, libcurl, curl-8-23-0, cve, http2, websocket, gnutls, schannel, vulnerability-management]
---

![해 질 무렵 출렁이는 바다 수면과 멀리 보이는 섬](https://picsum.photos/seed/curl-8230-protocol-exposure-priority/1600/900)

`curl --version` 한 줄을 CMDB에 모아 낮은 버전부터 정렬하면 패치 목록은 빨리 만들어진다. 하지만 그 목록은 어느 서비스가 HTTP/2 upload를 하는지, 어느 Windows agent가 Schannel의 자동 client certificate를 쓰는지, 어느 appliance가 GnuTLS 기반 WebSocket을 여는지 알려 주지 않는다. 반대로 CVE 21개라는 숫자만 보고 모든 자산을 같은 위험으로 다루면 실제 노출이 큰 경로가 일반 배치 속도에 묻힌다.

curl 프로젝트는 2026년 10월 14일 `8.23.0`을 공개했다. 공식 release table에서 이 버전은 42일 동안 283개 bugfix와 4개 change를 담았으며, 현재 `8.23.0` 자체에 공개된 취약점 수는 0으로 표시된다.[1] 직전 `8.22.0` 페이지에는 21개 보안 문제가 열거돼 있고, 그중 하나는 High, 나머지는 Low다.[2]

이 숫자는 출발점일 뿐 우선순위가 아니다. 이 글은 공격 payload나 취약 서버 재현법을 다루지 않는다. **실행 중인 curl/libcurl의 version, protocol, TLS·SSH backend, 호출 형태를 읽기 전용으로 확인하고, 확인되지 않은 자산을 자동으로 안전 판정하지 않는 방법**에 집중한다.

## `8.22.0에 21개`를 하나의 위험 점수로 바꾸지 않는다

21개 항목은 같은 전제에서 발생하지 않는다. HTTP(S), HTTP/2, WebSocket, FTP 계열, TFTP, SFTP/SCP가 섞여 있다. curl command-line tool만 해당하는 항목, libcurl API만 해당하는 항목, 둘 다 해당하는 항목도 다르다. GnuTLS·Schannel·wolfSSL·libssh2처럼 build backend가 조건인 문제도 있다.[2]

대표적인 경계를 먼저 펼치면 다음과 같다.

| 노출 축 | 공식 affected 범위와 조건 | 우선 확인할 운영 증거 |
|---|---|---|
| HTTP/2 upload | CVE-2026-92392는 `8.12.0`부터 `8.22.0`까지의 curl과 libcurl에 해당하며 High다. 특정 `RST_STREAM` 처리 뒤 use-after-free가 발생하고, `8.23.0`에서 수정됐다.[3] | 외부·파트너 서버로 upload하는 route, HTTP/2 협상 여부, 병렬 transfer, 실제 실행 artifact |
| WebSocket upload + GnuTLS | CVE-2026-107928은 `7.86.0`부터 `8.22.0`까지 중 GnuTLS build에서만 발생한다. Blocked send 뒤 자동 PONG 경로가 조건이다.[4] | `Protocols`의 WS/WSS, TLS backend 문자열, upload·양방향 통신 여부 |
| HTTPS + Schannel | CVE-2026-86415는 Windows 전용 Schannel build의 `8.21.0`~`8.22.0`에서 자동 client certificate option이 connection reuse key에 반영되지 않는 문제다.[5] | Windows service, Schannel, client certificate 자동 선택, redirect와 connection cache 사용 |
| FTP·IMAP·POP3·SMTP + multi | CVE-2026-92387은 `8.10.0`~`8.22.0` libcurl에서 악성 server가 마지막 control-response line을 끝내지 않을 때 같은 multi-handle의 동시 transfer를 계속 막을 수 있다. Curl tool은 해당하지 않는다.[6] | 해당 protocol 활성화, shared multi-handle, timeout을 가용성 경계로 믿는 daemon |
| SFTP/SCP + libssh2 callback | CVE-2026-87865는 `7.69.1`~`8.22.0`의 libssh2 build와 hashed `known_hosts`, custom `CURLOPT_SSH_KEYFUNCTION` 조합이 핵심이다. 기본 callback과 curl tool은 affected라고 주장되지 않는다.[7] | SSH backend, hashed known_hosts, custom trust-on-first-use callback |
| TLS pinning + wolfSSL | CVE-2026-87866은 `7.43.0`~`8.22.0` 중 wolfSSL build의 public-key pinning 검증 경로에 한정된다. Curl tool은 해당하지 않는다.[8] | wolfSSL build, `CURLOPT_PINNEDPUBLICKEY`, pinning을 trust boundary로 쓰는 workload |

Affected range도 하나가 아니다. 위 표만 봐도 시작점이 `7.43.0`, `7.69.1`, `7.86.0`, `8.10.0`, `8.12.0`, `8.21.0`으로 갈린다.
여러 advisory는 `8.14.x`, `8.16.x`, `8.20.x`의 별도 수정 release도 명시하지만 모든 CVE가 그 예외를 공유하지는 않는다.[3][4][6]
예를 들어 Schannel 항목은 애초에 `8.21.0`에서 도입됐다.[5]
따라서 `version < 8.23.0`을 전부 같은 `vulnerable=true`로 저장하거나, 한 advisory의 backport 경계를 나머지 20개에 복사하면 안 된다.

## 먼저 tool, library, protocol, backend를 네 축으로 분리한다

`curl` executable과 application에 link된 libcurl은 서로 다른 artifact일 수 있다. OS shell의 `/usr/bin/curl`이 `8.23.0`이어도 language runtime, database extension, backup agent 또는 statically linked appliance가 예전 libcurl을 품을 수 있다. 반대로 application이 새 libcurl을 쓰는데 운영자가 PATH에서 오래된 curl tool을 실행할 수도 있다.

Inventory 행은 최소한 다음 네 축을 따로 가져야 한다.

```text
consumer_kind: tool | dynamic_libcurl | static_or_embedded | unknown
artifact_identity: executable path + package build + sha256 또는 image digest
protocols_observed: HTTP/2 upload, WSS, SFTP, SMTP 같은 실제 route
backend_observed: TLS backend, SSH backend, HTTP/2 library
usage_shape: redirect, multi-handle, connection reuse, cookie/HSTS file, custom callback
```

이 field 이름은 curl이 정의한 표준이 아니라 이 글의 운영 제안이다. `protocols_observed`도 `curl -V`가 보여 주는 **지원 가능 protocol**과 network flow·application config에서 확인한 **실제 사용 protocol**을 구분해야 한다. Build가 FTP를 지원한다고 FTP 노출이 있는 것은 아니며, application config에 HTTPS URL이 있다고 실제 process가 같은 libcurl을 쓴다는 보장도 없다.

## 1단계: curl tool의 build capability를 읽기 전용으로 수집한다

다음 script는 PATH에서 선택된 curl의 real path, file hash, version/backend line, 지원 protocol과 feature를 읽는다. Network request를 보내지 않고 credential·environment·command line도 출력하지 않는다. 필요한 도구가 없거나 출력 계약이 달라지면 성공처럼 계속하지 않고 실패한다.

```bash
#!/usr/bin/env bash
set -euo pipefail

command -v curl >/dev/null 2>&1 || {
  printf 'curl_not_found\n' >&2
  exit 1
}
command -v sha256sum >/dev/null 2>&1 || {
  printf 'sha256sum_not_found\n' >&2
  exit 1
}

curl_path=$(command -v curl)
curl_real=$(readlink -f "$curl_path")
version_output=$($curl_real --version)
version_line=$(sed -n '1p' <<<"$version_output")
protocol_line=$(sed -n '/^Protocols:/p' <<<"$version_output")
feature_line=$(sed -n '/^Features:/p' <<<"$version_output")

test -n "$version_line"
test -n "$protocol_line"
test -n "$feature_line"

printf 'curl_path=%s\n' "$curl_path"
printf 'curl_real=%s\n' "$curl_real"
printf 'curl_sha256=%s\n' "$(sha256sum "$curl_real" | cut -d' ' -f1)"
printf 'version_backend=%s\n' "$version_line"
printf 'protocols=%s\n' "${protocol_line#Protocols: }"
printf 'features=%s\n' "${feature_line#Features: }"
```

첫 줄에는 보통 curl version과 함께 `OpenSSL`, `GnuTLS`, `Schannel`, `wolfSSL`, `libssh2`, `nghttp2` 같은 build 정보가 나타난다. 하지만 문자열이 보인다고 특정 option이 사용된 것은 아니다. 이 결과는 capability evidence다. 실제 exposure에는 application config, service owner 확인, 승인된 egress flow와 호출 telemetry를 결합한다.

Container에서는 host의 curl을 검사하지 말고 실제 image 안의 binary 또는 SBOM을 읽는다. Minimal image에 curl tool이 없어도 application이 libcurl을 link할 수 있다. Image tag가 아니라 실행 중 container의 image digest와 결과를 묶고, sidecar·init container·batch image를 별도 consumer로 센다.

## 2단계: 실행 중 libcurl consumer를 놓치지 않는다

Linux의 `/proc/<pid>/maps`에는 process가 현재 mapping한 shared library path가 보일 수 있다. 다음 예시는 읽을 수 있는 process만 대상으로 `libcurl.so` mapping을 찾는다. 전체 command line과 environment는 수집하지 않는다.

```bash
#!/usr/bin/env bash
set -euo pipefail

found=0
for maps in /proc/[0-9]*/maps; do
  test -r "$maps" || continue
  pid=${maps#/proc/}
  pid=${pid%/maps}

  while IFS= read -r libcurl_path; do
    test -n "$libcurl_path" || continue
    comm=$(tr -d '\n' <"/proc/$pid/comm" 2>/dev/null || printf 'unknown')
    printf 'pid=%s comm=%s libcurl=%s\n' "$pid" "$comm" "$libcurl_path"
    found=1
  done < <(awk '$6 ~ /\/libcurl\.so([.][0-9]+)*$/ {print $6}' "$maps" | sort -u)
done

printf 'dynamic_libcurl_mapping_found=%s\n' "$found"
```

`found=0`은 “조직에 libcurl이 없다”는 뜻이 아니다. 아직 실행되지 않은 job, 권한 때문에 읽지 못한 process, musl·다른 library naming, statically linked binary, bundled application은 이 방법에서 빠질 수 있다. Package database, SBOM, image scanner, build lockfile과 process evidence를 union하고 각 source의 coverage를 기록한다.

특히 CLI의 `curl -V` 결과를 모든 libcurl consumer에게 상속하지 않는다. 실행 process가 mapping한 library path를 package build와 연결하고, static binary는 build provenance나 SBOM에서 backend와 enabled protocol을 확인한다. 근거가 없으면 `backend_observed=unknown`으로 두며 `OpenSSL`로 추정하지 않는다.

## 3단계: 실제 사용 경로로 patch queue를 다시 정렬한다

공식 severity를 무시하자는 뜻이 아니다. Severity와 exposure를 곱셈 한 줄로 축약하지 말고 서로 다른 열로 보존한다. 다음 queue는 이 글의 운영 권고이며 curl 프로젝트의 공식 등급이 아니다.

### P0: 외부 server가 trigger하고 confidentiality·code execution 경계에 닿는 경로

- `8.12.0`~`8.22.0`에서 신뢰하지 않는 origin으로 HTTP/2 upload를 하는 consumer
- GnuTLS build로 외부 WebSocket server에 upload·양방향 frame을 보내는 consumer
- Schannel `8.21.0`~`8.22.0`에서 자동 client certificate와 redirect·connection reuse를 함께 쓰는 Windows service
- Negotiate·Kerberos 인증이나 HTTP proxy처럼 자격 증명 경계를 다루는 agent. 세부 적용 조건은 inventory 결과를 각 개별 advisory와 대조해 확정한다.
- wolfSSL public-key pinning을 endpoint authorization의 핵심 통제로 쓰는 client

CVE-2026-92392의 advisory는 use-after-free를 High로 평가하고 원격 code execution으로 전환하려면 여러 구체적인 환경·timing 조건이 함께 필요하다고 밝힌다.[3] 조건이 많다는 사실은 patch를 미뤄도 된다는 뜻이 아니다. 반대로 “HTTP/2 지원”만으로 모든 GET-only client가 같은 exploitability를 가진다고 과장해서도 안 된다. **Upload 여부와 접속 가능한 server trust boundary**를 같이 확인한다.

### P1: 가용성이나 인증 경계를 실제로 맡긴 특수 protocol

- Shared multi-handle에서 FTP·IMAP·POP3·SMTP control channel을 처리하는 daemon
- FTP·IMAP·POP3·SMTP처럼 이번 release의 여러 항목과 겹치는 특수 protocol 경로. 구체 option과 handle 수명 조건은 해당 advisory 확인 전에는 단정하지 않는다.
- SFTP/SCP에서 libssh2 custom host-key callback이나 hashed known_hosts를 쓰는 client
- HTTPS에서 SFTP/SCP redirect를 명시적으로 허용한 curl tool automation
- TFTP를 사용하는 provisioning system. 전송 방향별 영향은 개별 advisory를 기준으로 판정한다.

Curl tool의 SFTP/SCP redirect 문제는 `--location`과 redirect protocol 허용이 함께 있어야 하며, 직접 SFTP URL을 사용할 때의 option 적용과 경계가 다르다.[9] 이처럼 같은 SFTP라는 이름만으로 tool-only redirect 문제와 libssh2 callback 문제를 합치지 않는다.[7][9]

### P2: 상태 파일·출력·CLI option·특정 API shape가 조건인 경로

- Cookie·HSTS·`.netrc` 같은 상태 파일이나 자격 증명 파일을 사용하는 batch. 파일별 조건은 개별 advisory 확인 전에는 노출로 확정하지 않는다.
- `--remote-header-name`(`-J`)으로 remote filename을 받아 local file을 저장하는 automation
- MIME API나 interface 선택 API처럼 특정 호출 형태에만 해당할 수 있는 library consumer. 호출·reuse 조건은 advisory와 code path를 함께 확인한다.

P2는 “나중에 고쳐도 안전”이라는 뜻이 아니다. 예를 들어 `-J` 항목은 command-line tool에만 해당하지만, remote header를 신뢰해 download directory에 저장하는 updater라면 local file integrity가 중요하다. Advisory는 `7.20.0`~`8.22.0`이 affected이고 `8.23.0`에서 수정됐다고 명시한다.[10] 실제 option이 없는 API service보다 해당 updater를 먼저 올리는 것이 exposure 기반 정렬이다.

## 임시 완화와 patch 상태를 같은 칸에 쓰지 않는다

HTTP/2·GnuTLS WebSocket·Schannel advisory는 `8.23.0` upgrade 또는 local patch와 함께 조건별 회피책을 제시한다.[3][4][5]
Ping-pong protocol, libssh2·wolfSSL 검증 경계도 같은 방식으로 수정과 임시 회피를 구분한다.[6][7][8]
SFTP redirect 금지나 `-J` 회피 역시 patch 전 노출을 줄이는 선택지이지 artifact 수정은 아니다.[9][10]
따라서 구성 완화를 `patched=true`로 기록하면 나중에 설정이 되돌아왔을 때 취약 artifact가 다시 노출된다.

상태는 최소한 다음처럼 분리한다.

```text
artifact_fix_state: unreviewed | affected | upstream_fixed | vendor_backport_verified
exposure_state: exposed | mitigated_by_config | no_observed_route | unknown
runtime_state: inventory_only | rollout_started | old_runtime_zero | verified
```

`no_observed_route`는 protocol이 없다는 영구 사실이 아니라 관측 범위 안에서 route를 찾지 못했다는 뜻이다. 새 feature flag, redirect 허용, TLS backend 변경, image rollback이 생기면 다시 평가한다. `unknown`은 green이 아니다.

## Fail-closed promotion은 version 문자열이 아니라 승인 artifact를 본다

Distribution vendor가 older version string에 patch를 backport할 수 있으므로 일반적인 `8.22 < 8.23` 비교만으로 최종 판정하지 않는다. 반대로 vendor package가 설치됐다는 사실도 실행 중 artifact가 교체됐음을 증명하지 않는다. Upstream `8.23.0` binary를 승인한 경우의 최소 gate는 다음처럼 exact hash와 build capability를 함께 고정할 수 있다.

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${CURL_BIN:?set CURL_BIN to the reviewed curl executable}"
: "${APPROVED_SHA256:?set APPROVED_SHA256 from the signed artifact review}"
: "${EXPECTED_TLS_TOKEN:?set EXPECTED_TLS_TOKEN, for example OpenSSL/3.5.4}"
: "${REQUIRED_PROTOCOL:?set REQUIRED_PROTOCOL, for example https}"

test -x "$CURL_BIN"
actual_sha=$(sha256sum "$CURL_BIN" | cut -d' ' -f1)
test "$actual_sha" = "$APPROVED_SHA256"

version_output=$($CURL_BIN --version)
version_line=$(sed -n '1p' <<<"$version_output")
protocol_line=$(sed -n '/^Protocols:/p' <<<"$version_output")

grep -Eq '^curl 8[.]23[.]0([[:space:]]|$)' <<<"$version_line"
grep -Fq "$EXPECTED_TLS_TOKEN" <<<"$version_line"
awk -v required="$REQUIRED_PROTOCOL" '
  /^Protocols:/ {
    for (i = 2; i <= NF; i++) if ($i == required) found = 1
  }
  END { exit(found ? 0 : 1) }
' <<<"$protocol_line"

printf 'promotion_gate=pass sha256=%s\n' "$actual_sha"
```

이 예시는 upstream `8.23.0`용이라 vendor backport를 의도적으로 거부한다. Backport를 허용하려면 version check를 느슨하게 만드는 대신 **vendor advisory ID, 정확한 package release, repository signature, 승인 hash**로 별도 policy branch를 만든다. 어느 근거도 없는데 exit code를 0으로 만드는 fallback은 두지 않는다.

Rollout 뒤에는 build server의 curl이 아니라 실제 workload를 다시 읽는다. 새 image digest, process가 mapping한 libcurl path·hash, backend, protocol route를 같은 receipt에 묶고 old pod·VM·agent가 0인지 확인한다. Library 교체 뒤 process restart가 빠지면 disk의 `.so`와 memory mapping이 다를 수 있다.

## 완료 조건: CVE 21개를 닫는 대신 노출 행을 닫는다

최종 evidence table의 한 행은 `host`가 아니라 실제 consumer와 route를 가리켜야 한다.

```text
consumer_id: payments-egress/ws-client
consumer_kind: dynamic_libcurl
artifact_identity: sha256:<approved-value>
version_basis: upstream_8.23.0
protocol_route: wss upload -> partner.example
backend_observed: GnuTLS
usage_shape: websocket_auto_pong
applicable_cves: CVE-2026-107928
exposure_state: exposed
runtime_state: old_runtime_zero
observed_at: 2026-10-23T00:20:00+09:00
```

이 schema 역시 조직 내부 제안이며 curl protocol field가 아니다. `applicable_cves`는 official affected range와 조건에 근거해 계산하고, application owner의 추측으로 채우지 않는다. Evidence 수집 권한이 없거나 static link provenance를 찾지 못했다면 빈 배열 대신 `unknown`을 기록한다.

완료 gate는 다음 질문에 모두 답해야 한다.

1. Curl tool과 libcurl consumer를 분리했는가?
2. 각 consumer의 실제 artifact와 실행 중 identity를 확인했는가?
3. 지원 protocol과 실제 사용 route를 구분했는가?
4. TLS·SSH backend와 custom callback·redirect·multi-handle 같은 usage shape를 확인했는가?
5. Advisory별 affected range와 stable-branch fix를 개별 적용했는가?
6. 임시 구성 완화와 patch를 별도 상태로 남겼는가?
7. Rollout 뒤 old executable, library mapping, image와 replica가 0인가?
8. 확인하지 못한 항목이 자동 green이 아니라 `unknown`으로 남는가?

## 결론

Curl `8.23.0`은 2026년 10월 14일 공개됐고, 직전 `8.22.0`에는 현재 21개 공개 보안 문제가 연결돼 있다.[1][2] 그러나 21이라는 합계는 HTTP/2 upload의 High use-after-free, GnuTLS WebSocket buffer over-read, Schannel client-certificate connection reuse, ping-pong protocol의 multi-handle 가용성, libssh2·wolfSSL 검증 경계를 구분하지 못한다.

따라서 첫 질문은 “curl이 몇 버전인가”에서 끝나면 안 된다. **어느 executable 또는 library가 실제로 실행 중인지, 어떤 protocol route를 쓰는지, 어느 TLS·SSH backend로 build됐는지, redirect·connection reuse·custom callback 같은 조건이 존재하는지**를 같은 행에서 확인해야 한다.

Patch는 가능한 한 `8.23.0` 또는 advisory가 명시한 검증된 수정 build로 진행한다. 다만 배포 순서는 CVE 개수나 version 문자열만이 아니라 외부 server trust, upload, credential, pinning, shared multi-handle 같은 실제 exposure로 정한다. 마지막 완료 문장도 “CVE 21개 대응”이 아니라 **모든 curl/libcurl consumer를 inventory했고, advisory별 조건을 실제 route에 대조했으며, 승인된 수정 artifact가 실행 중이고 old runtime이 0이며, 남은 unknown이 없다**여야 한다.

## Sources

[1] https://curl.se/docs/releases.html
[2] https://curl.se/docs/vuln-8.22.0.html
[3] https://curl.se/docs/CVE-2026-92392.html
[4] https://curl.se/docs/CVE-2026-107928.html
[5] https://curl.se/docs/CVE-2026-86415.html
[6] https://curl.se/docs/CVE-2026-92387.html
[7] https://curl.se/docs/CVE-2026-87865.html
[8] https://curl.se/docs/CVE-2026-87866.html
[9] https://curl.se/docs/CVE-2026-86410.html
[10] https://curl.se/docs/CVE-2026-92390.html
