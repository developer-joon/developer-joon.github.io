---
title: '컨테이너 레지스트리가 문을 닫았다: Minimus 종료에서 배우는 이미지 탈출 계획'
date: 2026-10-23 09:00:14 +0900
categories: ["개발/인프라"]
description: 'Minimus 레지스트리 종료를 계기로 digest inventory, 사내 mirror, SBOM·서명·UID·CA·entrypoint 동등성, offline 복구, rollback까지 공급자 교체 절차를 설계한다.'
featured_image: 'https://picsum.photos/seed/minimus-registry-shutdown-exit-strategy/1600/900'
tags: [container, registry, minimus, oci, image-mirror, sbom, rollback, supply-chain]
---

![차량과 오토바이가 빽빽하게 늘어선 도심 도로와 양옆의 상가 건물](https://picsum.photos/seed/minimus-registry-shutdown-exit-strategy/1600/900)

Minimus는 2026년 8월 24일부터 60일간 제품과 이미지를 유지한 뒤 운영을 종료한다고 공지했고, Docker의 후속 안내는 `reg.mini.dev`가 2026년 10월 22일 내려갔다고 적었다.[1][2] 그전에 내려받은 이미지는 계속 실행되지만 이후 업데이트는 제공되지 않는다고 했다.[1] 오늘 새 노드에서 Pod가 다시 잡히거나 CI가 깨끗한 runner에서 이미지를 받으려 한다면, 어제까지 멀쩡했던 배포가 `ImagePullBackOff`로 바뀔 수 있다는 뜻이다.

여기서 배워야 할 것은 “어느 hardened image 제품이 더 좋은가”가 아니다. 6월에 쓴 Docker Hardened Images 글이 작은 베이스 이미지, CVE 축소, SBOM과 서명의 가치를 다뤘다면 이번 질문은 다르다. **이미 선택한 공급자가 사라져도 서비스를 재현하고 패치할 수 있는가?** Docker는 Minimus 사용자를 위한 DHI 전환 안내에서 많은 서비스는 `FROM` 한 줄 교체로 옮길 수 있다고 설명한다. 동시에 4,000개 이상 catalog, CVE 최대 95% 감소, 공격 표면 최대 90% 감소를 내세운다.[2] 이 숫자와 “drop-in” 표현은 Docker의 제품 주장이지, 내 workload에서 확인된 결과가 아니다.

종료 공지를 받은 팀의 목표는 특정 vendor를 빨리 고르는 것이 아니라 다음 네 가지를 증명하는 것이다.

1. 현재와 미래 배포가 의존하는 모든 이미지 digest를 안다.
2. 필요한 manifest, platform별 image, layer와 증거물을 통제 가능한 저장소에 보존했다.
3. 대체 이미지가 package 이름뿐 아니라 실행 계약까지 만족한다.
4. cutover 실패 시 외부의 종료된 registry 없이 이전 digest로 되돌릴 수 있다.

## 먼저 “사용 중인 tag”가 아니라 digest inventory를 만든다

Repository에서 `reg.mini.dev` 문자열을 검색하는 것만으로는 부족하다. Dockerfile의 `FROM`, Kubernetes manifest와 Helm values, CI service container, ephemeral job, CronJob, init container, admission mutation 결과, 현재 실행 중인 Pod를 모두 봐야 한다. 오래된 release branch와 rollback manifest도 배포 가능하면 범위에 들어간다. 반대로 node cache에 우연히 남은 image는 사용 근거가 아니다.

Inventory의 최소 단위는 다음과 같다.

```text
workload | env | source_ref | index_digest | platform | manifest_digest
payments | prod | reg.mini.dev/python:3.13 | sha256:<index> | linux/amd64 | sha256:<manifest>
worker   | prod | reg.mini.dev/node:24    | sha256:<index> | linux/arm64 | sha256:<manifest>

mirror_ref | owner | last_pull_test | sbom_ref | signature_policy | rollback_until
registry.example/base/python@sha256:<index> | platform | 2026-10-21 | sha256:<sbom> | policy-v3 | 2027-01-31
```

`source_ref`의 tag와 digest를 둘 다 남기는 이유가 있다. Tag는 사람이 사용하던 이름을 추적하는 단서이고 digest는 실제 content identity다. OCI Distribution Specification에서 tag는 manifest를 가리키는 사람이 읽을 수 있는 pointer이며, digest는 content의 암호학적 hash로 만든 식별자다. Pull은 manifest와 그 manifest가 가리키는 blob을 받는 과정이다.[3] 따라서 `python:3.13`을 적은 spreadsheet는 재현 inventory가 아니다. 같은 tag가 종료 직전 다른 digest를 가리켰을 가능성을 닫지 못한다.

Multi-architecture image라면 top-level index digest만 적어서도 안 된다. `linux/amd64`, `linux/arm64`처럼 실제 cluster가 쓰는 platform과 하위 manifest digest를 함께 보존한다. 운영에 arm64 node가 하나라도 있는데 amd64 layer만 저장하면 평소에는 통과하다가 reschedule 때 실패한다. “현재 node에서 pull 성공”과 “지원하는 모든 platform을 복구 가능”은 다른 판정이다.

발견 결과가 0건이어도 성공으로 처리하지 않는 scan을 만든다. 다음 예시는 Git이 추적하는 설정에서 direct reference를 찾는 좁은 1차 검사다. Cluster inventory와 registry audit log 검사는 별도로 합쳐야 한다.

```bash
set -euo pipefail

out="minimus-source-refs.txt"
if git grep -nE '(^|[[:space:]"])reg\.mini\.dev/' -- . >"$out"; then
  test -s "$out"
else
  status=$?
  if [ "$status" -eq 1 ]; then
    printf '%s\n' '직접 참조 0건: cluster·CI·release branch 증거와 대조 전에는 완료로 승인하지 않음' >&2
    exit 1
  fi
  exit "$status"
fi
```

검색 결과는 workload owner와 연결한다. “어느 팀 것인지 모르는 digest”는 삭제 후보가 아니라 조사 대상이다. 특히 final application image만 보고 base image를 놓치지 않는다. 최종 image digest는 application artifact의 identity이고, 그 image를 다시 build할 때 필요한 base digest는 별도 build dependency다.

## Mirror는 tag 복사가 아니라 닫힌 복구 세트를 만드는 일이다

OCI registry에서 image를 복구하려면 manifest 하나만으로 충분하지 않다. Manifest가 참조하는 config와 모든 layer blob이 목적지에 있어야 한다. OCI spec은 존재하는 manifest나 blob에 대한 `HEAD`가 `200 OK`를 반환하고, 없는 content는 `404 Not Found`를 반환하도록 정의한다.[3] 복사 도구의 “성공” 로그보다 목적지에서 digest로 다시 읽는 검사가 중요한 이유다.

원본이 아직 접근 가능한 비상 창이라면 digest-pinned reference만 받아 다음처럼 복사할 수 있다. 인증은 command line argument나 script에 쓰지 말고 도구의 credential store 또는 권한을 제한한 auth file을 사용한다.

{% raw %}
```bash
set -euo pipefail

: "${SRC:?예: reg.mini.dev/team/image@sha256:<64-hex>}"
: "${DST:?예: registry.example/archive/team-image:rescue-20261022}"

if ! printf '%s\n' "$SRC" | grep -Eq '^([^/]+/)+[^/@]+@sha256:[0-9a-f]{64}$'; then
  printf '%s\n' 'SRC는 64자리 sha256 digest로 고정한 reference여야 함' >&2
  exit 64
fi

expected="${SRC##*@}"
skopeo copy --all --preserve-digests \
  "docker://$SRC" "docker://$DST"
actual="$(skopeo inspect --format '{{.Digest}}' "docker://$DST")"
test "$actual" = "$expected"
```
{% endraw %}

Skopeo의 `--all`은 image list와 그 안의 모든 platform image를 복사하려 시도하고, `--preserve-digests`는 digest를 보존할 수 없으면 실패한다.[4] 이 실패는 media type 변환이나 누락을 숨기지 않게 해 주므로 비상시에도 제거하면 안 된다. 목적지 tag는 편의를 위한 별칭일 뿐, 배포와 rollback record에는 `registry.example/...@sha256:...`를 쓴다.

다만 위 명령이 **서명, SBOM, provenance까지 자동 보존했다는 뜻은 아니다**. 이들은 image manifest를 subject로 삼는 별도 OCI artifact나 referrer일 수 있다. 원본 digest별로 발견한 증거물의 media type, digest, signer identity, 발급 시각을 ledger에 기록하고 destination에서 다시 discover한다. 복사 도구와 registry가 referrer를 어떻게 다루는지 확인하지 못했다면 상태를 `evidence_missing`으로 두고 promotion을 막는다. 서명 JSON을 파일로 내려받았다는 사실도 신뢰가 아니다. 승인한 key 또는 keyless identity·issuer 조건으로 검증이 성공해야 한다. Cosign의 공식 `verify` 명령도 keyless flow에서 예상 certificate identity와 OIDC issuer를 명시하도록 요구한다.[5]

원본은 10월 22일 종료 예정이었고, 공지 시각을 지난 뒤의 direct pull은 migration 전략이 될 수 없다. 현재 endpoint가 인증 응답을 돌려주더라도 특정 repository의 manifest와 blob이 온전하다는 보장은 아니다. 원본 복사가 실패하면 node cache를 “registry”로 승격하지 말고 incident로 선언한다. 승인된 cache export, 과거 CI artifact, 사내 mirror를 조사하되 digest·platform·출처를 입증하지 못한 layer 조합으로 새 이미지를 만들지 않는다.

## Local cache와 tar archive가 주는 거짓 안도감

“이미 떠 있는 container는 계속 돈다”는 말은 맞지만 복구 가능하다는 뜻은 아니다. Container runtime의 local cache는 node 교체, garbage collection, disk pressure, autoscaling에 따라 사라진다. 다른 architecture node로 옮길 수도 없다. Build cache는 실행 image archive와도 다르다. Cache hit가 있었다는 사실로 manifest와 모든 runtime layer가 보존됐다고 가정하면 안 된다.

`docker image save`는 local image store의 image와 parent layer를 tar archive로 내보낼 수 있다. 그러나 기본 동작은 **그 daemon에 실제로 존재하는 platform variant**만 담고, `--platform`으로 요청한 variant가 local store에 없으면 오류가 난다.[6] 즉 노트북에서 만든 `image.tar` 하나는 multi-arch mirror의 대체물이 아니다. Archive를 쓰려면 다음 항목을 함께 관리한다.

- archive 자체의 SHA-256, 생성자, 생성 시각, 원래 image digest
- 포함된 OS/architecture/variant 목록
- 암호화된 object storage의 immutable retention과 복구 권한
- 격리된 빈 host에서 `load` 후 digest 확인 및 실제 startup test
- SBOM·서명·provenance의 별도 보존 위치와 검증 trust root

Air-gapped 환경도 동일하다. “인터넷이 없으니 안전”한 것이 아니라 patch 공급과 trust metadata 갱신 경로가 끊길 수 있다. Offline bundle에는 image만 아니라 scanner DB snapshot, 공개키 또는 trusted root, 정책 version, 만료 시각, 갱신 절차가 필요하다. 마지막 정상 bundle을 무기한 허용하지 말고 최대 offline 기간을 정한다. 기간을 넘기면 신규 배포는 fail closed하고, 이미 실행 중인 workload의 계속 운영은 별도 위험 승인으로 분리한다.

## 대체품의 이름보다 실행 계약을 비교한다

`minimus/node`를 다른 `node` image로 바꾸고 application test가 뜨면 migration이 끝났다고 보기 쉽다. 하지만 OCI image config 자체가 `User`, `Env`, `Entrypoint`, `Cmd`, `WorkingDir`, `StopSignal` 같은 runtime default를 담는다.[7] Base image 교체는 filesystem package 집합뿐 아니라 process 실행 계약을 바꾸는 작업이다.

후보마다 old와 new의 digest를 고정한 뒤 아래 parity matrix를 채운다.

| 계약 | 확인할 evidence | 실패 예시 |
|---|---|---|
| Platform | index와 platform manifest digest | arm64 manifest 없음 |
| UID/GID | image config와 실제 `id`, volume write test | non-root가 기존 volume에 쓰지 못함 |
| Entrypoint/Cmd | config JSON과 no-override startup | wrapper가 빠져 signal 전달 변화 |
| CA/TLS | trust store 경로와 staging TLS handshake | 사내 CA 또는 필요한 root 누락 |
| 동적 library | linked library와 native extension smoke test | glibc/musl 차이로 load 실패 |
| 파일·경로 | working directory, passwd/group, timezone data | 절대경로·사용자 lookup 실패 |
| Port·capability | listen port와 securityContext | UID 변경 후 80 port bind 실패 |
| SBOM | subject digest, format, component coverage | 다른 digest의 SBOM을 연결 |
| Signature/provenance | signer·issuer·subject digest·build source | signature는 있으나 identity 불일치 |
| 종료 동작 | SIGTERM, readiness 제거, grace period | PID 1이 signal을 전달하지 않음 |

DHI를 후보로 삼는다면 Docker의 migration checklist가 좋은 출발점이다. Runtime image는 기본 non-root UID 65532로 실행되고 package manager와 shell이 없으며, CA certificate와 entrypoint 차이를 확인하라고 명시한다.[8] 이는 호환성 보증서가 아니라 test 항목이다. 기존 image가 UID 1000으로 volume을 만들었다면 65532로 바꾸는 순간 권한 오류가 날 수 있다. 기존 entrypoint가 certificate import나 template rendering을 했다면 shell 없는 runtime에서 조용히 사라질 수도 있다.

따라서 “동일 package version”보다 workload 행동을 시험한다. Read-only root filesystem, production과 같은 `securityContext`, 빈 volume과 기존 snapshot volume을 각각 붙인다. Health/readiness endpoint, DNS, outbound TLS, timezone, locale, native module load, signal 종료를 확인한다. Certificate test는 단순히 `/etc/ssl/certs`가 존재하는지 보지 말고 staging의 허용된 endpoint와 실제 handshake를 실행한다. Custom CA가 필요하면 image layer에 무심코 복사할지, runtime mount로 관리할지 먼저 결정한다.

DHI 외에도 다른 maintained image catalog, upstream official image, 조직이 직접 재현 가능하게 build하는 base가 후보가 될 수 있다. 비교표에는 catalog 크기나 오늘의 CVE count뿐 아니라 다음을 넣는다.

- 지원 종료 공지 기간과 patch SLA, 과거 이행 기록
- digest-pinned pull, multi-arch, private mirror와 air-gap export 지원
- SBOM·서명·provenance를 표준 도구로 반출하고 검증할 수 있는지
- source와 build recipe의 공개 범위, 재build 가능성
- 계약 종료 후 artifact와 trust metadata를 얼마나 보존할 수 있는지
- custom CA, FIPS, locale, debug variant가 만드는 별도 lifecycle

Docker가 발표한 CVE·공격 표면 감소치는 Docker가 관리하는 비교 조건의 vendor 결과다.[2] 우리 image에서 scanner, severity policy, package denominator를 고정해 다시 측정하고, functional parity와 별도 gate로 둔다. CVE 수가 더 낮아도 startup 계약이 깨지면 cutover할 수 없다.

## Cutover는 pull test가 아니라 새 노드 복구 시험이다

기존 node cache가 성공을 가리는 것을 막으려면 빈 worker 또는 격리된 clean runner에서 rehearsal한다. 목적지 registry만 허용하고 원본 hostname egress는 막는다. Build, deployment, autoscaling, node drain, rollback을 연속으로 실행한다. 완료 상태는 다음처럼 분리한다.

```text
inventoried
  → mirrored_by_digest
  → evidence_verified
  → parity_passed
  → canary_ready
  → traffic_shifted
  → old_registry_egress_zero
  → rollback_rehearsed
```

Canary에는 새 image digest를 명시하고 mutable tag를 사용하지 않는다. Error rate, startup latency, readiness failure, TLS error, permission denial, OOM, graceful shutdown 시간을 old digest와 같은 관측창에서 비교한다. Threshold를 넘으면 자동 확장을 멈추고 traffic을 old deployment로 되돌린다. Database migration처럼 image와 독립적이지 않은 변경은 같은 release에 넣지 않는다. Schema가 앞으로만 이동했다면 image rollback이 가능해 보여도 실제 application은 돌아갈 수 없다.

Rollback artifact도 종료된 Minimus 주소를 가리키면 rollback이 아니다. Cutover 전에 old digest를 사내 registry에 보존하고, deployment manifest의 registry host까지 바꾼 rollback revision을 만든다. Clean node에서 그 revision을 배포해 readiness와 요청 처리를 확인한다. 다음 조건을 모두 만족할 때만 원본 registry 의존을 제거했다고 판정한다.

- 모든 production·staging workload가 승인된 destination digest를 사용한다.
- 새 node와 빈 CI runner에서 source registry 없이 build·deploy·rollback된다.
- Registry, DNS, proxy, firewall log에서 `reg.mini.dev` 요청이 정한 관측 기간 0건이다.
- SBOM·서명·provenance가 destination digest와 연결되고 정책 검증을 통과한다.
- Old와 new image의 owner, patch source, EOL, 다음 교체 rehearsal 날짜가 등록돼 있다.

## 다음 종료 공지 전에 만들어 둘 것

이번 사건의 장기 대책은 공급자를 두 곳 사는 것이 아니다. 같은 tag 이름을 가진 두 catalog도 UID, CA, libc, entrypoint가 다르면 즉시 대체할 수 없다. 분기마다 대표 workload 하나를 clean environment에서 대체 source로 rebuild하고, mirror를 끊은 상태에서 restore하며, old digest rollback까지 재연한다. 이 **exit test**가 통과한 날짜를 service readiness와 함께 관리해야 한다.

새 image 공급 계약에는 artifact export만 묻지 말고 서명과 SBOM의 portability, 종료 통지 기간, final snapshot, support 종료 뒤 digest 보존, 삭제 일정, trust root 반출 조건을 넣는다. 조직 내부 registry도 영구적이지 않으므로 replication, immutable retention, backup restore와 관리자 계정 상실 시 복구를 시험한다.

Minimus image가 이미 실행 중이라는 사실은 시간을 조금 벌어 줄 뿐이다. Cache는 patch channel이 아니고, tag는 inventory가 아니며, 다른 vendor의 비슷한 제품은 검증 전까지 drop-in이 아니다. 탈출 계획의 완료 기준은 새 로고의 registry에서 pull에 성공하는 것이 아니다. **원본이 완전히 사라진 clean environment에서 승인된 digest와 증거물로 배포하고, 실패하면 사내에 보존한 digest로 되돌아갈 수 있음을 보여 주는 것**이다.

## Sources

[1] https://www.minimus.io/get-started
[2] https://www.docker.com/blog/moving-from-minimus-to-docker-hardened-images/
[3] https://github.com/opencontainers/distribution-spec/blob/v1.1.1/spec.md
[4] https://github.com/containers/skopeo/blob/master/docs/skopeo-copy.1.md
[5] https://github.com/sigstore/cosign/blob/main/doc/cosign_verify.md
[6] https://docs.docker.com/reference/cli/docker/image/save/
[7] https://github.com/opencontainers/image-spec/blob/v1.1.1/config.md
[8] https://docs.docker.com/dhi/migration/checklist/
