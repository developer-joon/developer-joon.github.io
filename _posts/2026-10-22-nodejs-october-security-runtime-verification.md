---
title: 'Node.js 10월 보안 업데이트: 22·24·26 런타임을 같은 패치로 보면 안 되는 이유'
date: 2026-10-22 06:00:00 +0900
categories: ["개발/보안"]
description: 'Node.js 22.23.4·24.22.1·26.12.1의 보안 수정과 bundled dependency 차이를 분리하고, inert fixture와 runtime receipt로 container·process·worker 교체를 검증한다.'
featured_image: 'https://picsum.photos/seed/nodejs-october-security-runtime-verification/1600/900'
tags: [nodejs, security-release, runtime-verification, container, worker, tls, brotli]
---

![큰 바위 너머 산골짜기와 호수가 보이는 흐린 풍경](https://picsum.photos/seed/nodejs-october-security-runtime-verification/1600/900)

Node.js 프로젝트는 2026년 10월 21일 26.x, 24.x, 22.x용 보안 릴리스를 공개했다. 세 release line 모두 최고 심각도는 High다. 수정 버전은 각각 **22.23.4, 24.22.1, 26.12.1**이다.[1] 여기까지만 읽으면 세 이미지를 같은 방식으로 올리면 될 것처럼 보인다.

하지만 실제 patch 집합은 같지 않다. 24.x와 26.x에만 들어간 TLS 수정이 있고, 26.x에만 해당하는 ZipFile·Permission Model 문제가 있다. Bundled Undici의 major도 line마다 다르며 SQLite update는 22.x에만 포함됐다.[2][3][4] 그러므로 “Node.js 보안 패치 적용”이라는 한 칸짜리 상태로는 무엇을 고쳤고 어떤 runtime이 아직 남았는지 설명할 수 없다.

이 글의 목표는 CVE 목록을 다시 읽는 것이 아니다.

> **Release line별 fixed set을 보존하고, 동일한 비공격성 fixture를 세 line에 실행한 뒤, 요청을 실제로 처리하는 process·container·worker가 새 binary로 교체됐음을 증명한다.**

## 먼저 22·24·26의 fixed set을 분리한다

공통점부터 보면 세 line 모두 다음 영역의 수정이 들어갔다.

- `dns.resolve()`의 NUL 문자 입력 검증
- 비정규 IPv4 표현을 포함한 TLS hostname 검증
- Brotli decoder의 out-of-bounds write
- Keep-Alive socket에서 요청보다 먼저 쓰인 응답을 처리하는 문제
- Snapshot·SEA에 저장된 random cache의 재사용
- `fs.realpathSync()`와 Permission Model 검사

그러나 공통 부분만 합쳐서 “세 버전이 같은 취약점 묶음을 고쳤다”고 쓰면 branch별 경계가 사라진다. 공식 release note를 line 단위로 펼치면 차이는 다음과 같다.[2][3][4]

| 항목 | 22.23.4 | 24.22.1 | 26.12.1 |
|---|---:|---:|---:|
| DNS NUL 입력 검증 | 적용 | 적용 | 적용 |
| 비정규 IP TLS hostname 검증 | 적용 | 적용 | 적용 |
| TLS IP 정규화 회귀 수정 | 해당 없음 | 적용 | 적용 |
| Brotli decoder 수정 | 적용 | 적용 | 적용 |
| Keep-Alive response guard | 적용 | 적용 | 적용 |
| Snapshot·SEA random cache reset | 적용 | 적용 | 적용 |
| `fs.realpathSync()` Permission Model 검사 | 적용 | 적용 | 적용 |
| ZipFile invalid header 처리 | 해당 없음 | 해당 없음 | 적용 |
| Permission wildcard-node tree 수정 | 해당 없음 | 해당 없음 | 적용 |

여기서 `해당 없음`은 “그 line이 안전하다는 일반 판정”이 아니다. 이번 advisory가 그 issue의 affected line으로 지정하지 않았다는 뜻이다. 반대로 표의 `적용`도 application이 해당 API를 사용한다는 뜻은 아니다. **Patch applicability와 workload exposure는 별도 필드**로 둬야 한다.

최고 심각도가 세 line 모두 High라는 사실도 우선순위를 평평하게 만들지 않는다. 외부에서 받은 Brotli payload를 푸는 gateway, 사용자 입력으로 TLS destination을 구성하는 proxy, `--permission`에 filesystem boundary를 의존하는 job runner는 노출이 서로 다르다. Release severity는 배포 순서를 정하는 입력이지 workload별 threat model을 대신하지 않는다.

## Bundled dependency도 같은 이름, 다른 결과다

이번 release에는 Node core 수정뿐 아니라 c-ares, root certificate, OpenSSL, SQLite, Undici update가 함께 들어갔다. 이때 “Undici도 업데이트됨”처럼 component 이름만 저장하면 검증에 실패한다.

| Component | 22.23.4 | 24.22.1 | 26.12.1 |
|---|---|---|---|
| c-ares | 1.34.9 | 1.34.9 | 1.34.9 |
| Root CA | NSS 3.131.1 | NSS 3.131.1 | NSS 3.131.1 |
| OpenSSL | 3.5.9 | 3.5.9 | release note에 별도 upgrade 없음 |
| SQLite | 3.53.4 | release note에 별도 update 없음 | release note에 별도 update 없음 |
| Undici | 6.29.1 | 7.30.1 | 8.12.2 |

이 차이는 npm lockfile만 봐서는 잡히지 않을 수 있다. Node binary에 포함된 dependency와 application이 직접 설치한 npm package는 다른 inventory다. 예를 들어 global `fetch`가 사용하는 bundled Undici를 확인하려고 `npm ls undici`만 실행하면 “없음”이 나올 수 있다. 그렇다고 runtime에 Undici가 없는 것은 아니다.

또한 이 글은 Axios에서 Fetch로 바꾸거나 Fetch API의 동작 차이를 설명하지 않는다. 이번 검증에서 Undici version은 **release artifact identity의 일부**다. HTTP client migration 판단과 섞으면 보안 patch read-back이 application refactoring 프로젝트로 번진다.

## Version pin은 major tag가 아니라 exact artifact다

`node:22`, `node:24`, `node:26` 같은 mutable tag를 다시 pull하는 것만으로 배포 receipt를 만들지 않는다. 각 workload가 어느 fixed line을 쓰는지 먼저 확정한다.

```text
runtime_line | minimum_fixed | artifact_ref
22.x         | 22.23.4       | registry.example/app@sha256:<digest-22>
24.x         | 24.22.1       | registry.example/app@sha256:<digest-24>
26.x         | 26.12.1       | registry.example/app@sha256:<digest-26>
```

Official binary를 직접 배포한다면 release page가 제공하는 signed `SHASUMS256.txt`와 내려받은 archive digest를 대조한다. Container base image를 사용한다면 Node release archive hash가 아니라 **최종 application image digest**를 promotion 단위로 고정한다. Base image digest와 최종 image digest는 같은 값이 아니다.

Node의 release 상태도 line 선택에 영향을 준다. 공식 schedule은 현재 22.x를 Maintenance LTS, 24.x를 Active LTS, 26.x를 Current로 구분한다.[5] 이 분류는 “26이 숫자가 크므로 세 workload를 모두 즉시 26으로 올리자”는 근거가 아니다. 이번 긴급 작업의 1차 목표는 각 line 안에서 fixed version으로 이동하는 것이다. Major migration은 별도 compatibility gate로 다룬다.

## 같은 inert fixture를 세 line에 실행한다

보안 검증 때문에 실제 exploit, 공격자 인증서, 손상된 Brotli stream을 production 근처에서 재생할 필요는 없다. 특히 memory corruption issue를 확인하겠다고 malformed 압축 payload를 넣는 방식은 patch 배포 확인과 incident simulation을 혼동한다.

대신 공개 API의 안전한 입력 거부 계약 하나를 세 fixed line에 동일하게 실행한다. 다음 fixture는 NUL이 든 예약 도메인 문자열을 사용하고 resolver destination을 local discard port로 제한한다. 외부 DNS 요청, credential, production hostname, code execution을 포함하지 않는다.

```js
// fixtures/dns-nul-rejection.mjs
import { Resolver } from 'node:dns/promises';
import assert from 'node:assert/strict';

const resolver = new Resolver();
resolver.setServers(['127.0.0.1:9']);

assert.throws(
  () => resolver.resolve4('node-runtime-fixture.invalid\0ignored.invalid'),
  { code: 'ERR_INVALID_ARG_VALUE' },
);

console.log(JSON.stringify({
  fixture: 'dns-nul-rejection-v1',
  node: process.version,
  execPath: process.execPath,
  versions: process.versions,
}));
```

세 target을 같은 command로 실행한다.

```bash
set -euo pipefail

# 이 tag들은 release별 동작 fixture용이다. Promotion 증거에는 resolve된 digest를 별도로 고정한다.
for v in 22.23.4 24.22.1 26.12.1; do
  docker run --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    -v "$PWD/fixtures:/fixtures:ro" \
    "node:${v}-bookworm-slim" \
    node /fixtures/dns-nul-rejection.mjs
done
```

`--network none`은 fixture가 실수로 외부 lookup을 만들지 못하게 한다. 기대 결과는 세 실행 모두 assertion 통과, 출력의 `node`가 각각 정확한 fixed version과 일치하는 것이다. 예시의 version tag는 이 동작 fixture를 재현하기 위한 입력이지 immutable artifact identity 증거가 아니다. 실제 promotion에서는 실행 결과와 함께 registry에서 resolve한 image digest를 기록한다. 이 fixture는 DNS NUL fix의 안전한 regression check일 뿐 TLS, Brotli, Permission Model 또는 ZipFile issue의 exploitability를 증명하지 않는다.

Branch-specific issue는 별도 applicability matrix로 관리한다. 22.x에서 26.x 전용 ZipFile test를 억지로 통과시키거나 `not_applicable`을 `pass`로 바꾸지 않는다.

```text
check_id                 22.23.4        24.22.1        26.12.1
dns-nul-rejection-v1     pass           pass           pass
tls-ip-normalization     not_applicable reviewed       reviewed
zip-invalid-header       not_applicable not_applicable reviewed
permission-wildcard-node not_applicable not_applicable reviewed
```

여기서 `reviewed`는 공격 payload를 실행했다는 뜻이 아니다. Official release note에서 해당 fix가 target line에 포함됐고, artifact identity가 그 release와 연결됐음을 확인했다는 뜻이다. 행동 regression test가 필요하다면 격리된 보안 test repository에서 별도 승인과 stop condition을 두고 설계한다.

## `node --version`은 누가 실행했는지가 중요하다

운영자가 laptop이나 CI shell에서 `node --version`을 실행해 `v24.22.1`을 봤다고 하자. 이 값은 그 shell의 binary를 설명할 뿐 load balancer 뒤 process, old pod, PM2 worker, `cluster` child process를 설명하지 않는다.

배포된 application은 시작할 때 다음 receipt를 만들 수 있다.

```js
// startup receipt의 예시. 공개 endpoint가 아니라 내부 telemetry로 보낸다.
const receipt = {
  service: process.env.SERVICE_NAME,
  deployment: process.env.DEPLOYMENT_ID,
  imageDigest: process.env.IMAGE_DIGEST,
  node: process.version,
  execPath: process.execPath,
  versions: {
    openssl: process.versions.openssl,
    uv: process.versions.uv,
    zlib: process.versions.zlib,
  },
  pid: process.pid,
  ppid: process.ppid,
  startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
};

process.stdout.write(`${JSON.stringify({ event: 'runtime_start', ...receipt })}\n`);
```

`process.version`과 `process.execPath`는 process가 실제 사용 중인 Node binary를 보여 준다. `imageDigest`는 platform이 pod 또는 task에 주입한 immutable digest여야 한다. Dockerfile의 label이나 mutable tag를 process가 자기 주장으로 읽는 방식은 부족하다. `deployment`, PID, 시작 시각을 함께 남겨야 새 process가 떴는지와 오래된 process가 계속 살아 있는지를 구분할 수 있다.

`process.versions`도 만능 SBOM은 아니다. OpenSSL처럼 노출되는 bundled version은 확인할 수 있지만 모든 dependency가 같은 방식으로 나타나지는 않는다. 따라서 release note의 dependency matrix, artifact digest, runtime receipt를 함께 보존한다.

## Container update와 process replacement는 다른 상태다

Registry에 새 image를 push해도 running container의 filesystem과 memory는 바뀌지 않는다. Deployment manifest의 tag를 바꿔도 scheduler가 old replica를 종료하지 못하면 취약한 process가 계속 traffic을 받을 수 있다. 다음 상태를 분리한다.

```text
artifact_ready
  → deployment_spec_updated
  → new_replica_ready
  → traffic_shifted
  → old_replica_zero
  → runtime_receipt_complete
```

Kubernetes에서는 spec의 `image`보다 각 container status의 `imageID`를 읽는다.

```bash
set -euo pipefail

kubectl get pods -n "$NS" -l app="$APP" -o json \
  | jq -r '.items[] as $pod
    | $pod.status.containerStatuses[]
    | [$pod.metadata.uid, $pod.metadata.name, .name, .imageID, .containerID, .ready]
    | @tsv'
```

그 뒤 application telemetry에서 같은 pod UID 또는 platform task ID에 연결된 `runtime_start` receipt를 조회한다. 기대 조건은 다음과 같다.

1. Ready replica의 `imageID`가 승인한 digest 집합에만 속한다.
2. 각 replica의 `process.version`이 그 digest에 매핑한 fixed version과 일치한다.
3. Rollout 시작 전 생성된 old pod·task가 0개다.
4. Service endpoint 또는 load balancer target에 old replica가 0개다.
5. 새 replica마다 startup receipt가 정확히 하나 이상 있고 fixture 결과가 연결된다.

`kubectl rollout status` 성공은 rollout controller의 조건을 만족했다는 뜻이다. Old ReplicaSet이 0인지, 외부 load balancer가 deregistration을 끝냈는지, 별도 CronJob·Job·sidecar가 같은 old image를 쓰는지는 추가로 확인해야 한다.

## Worker는 restart 명령이 아니라 새 runtime receipt로 센다

Node service의 “worker”는 여러 형태일 수 있다. `worker_threads`는 독립 Node binary가 아니라 한 process 안의 thread다. Parent process를 교체하지 않은 채 thread만 다시 만들면 Node runtime patch가 바뀌지 않는다. 반면 `cluster`, PM2 cluster mode, queue consumer, systemd instance는 별도 process일 수 있다. 이 경우 supervisor 설정을 reload한 것과 child process를 실제로 교체한 것도 다르다.

Worker가 online될 때 parent와 같은 identity schema를 내보낸다.

```js
import { isMainThread, threadId } from 'node:worker_threads';

process.stdout.write(`${JSON.stringify({
  event: 'worker_online',
  node: process.version,
  execPath: process.execPath,
  pid: process.pid,
  ppid: process.ppid,
  isMainThread,
  threadId,
  deployment: process.env.DEPLOYMENT_ID,
  imageDigest: process.env.IMAGE_DIGEST,
})}\n`);
```

판정은 worker 종류별로 달라진다.

| Worker model | 교체 증거 |
|---|---|
| `worker_threads` | Parent PID와 runtime receipt가 새 process에서 생성됐고, 기대한 thread가 다시 online |
| `cluster` | Old worker PID 0, 새 worker PID 모두 fixed `process.version`, master도 fixed version |
| PM2 | `pm2 reload` 명령 성공이 아니라 process list의 새 PID·start time·runtime receipt |
| Queue consumer | Broker consumer group에서 old member 0, 새 member receipt와 정상 ack 확인 |
| CronJob·batch | 다음 실행 image digest와 runtime receipt 확인, 이미 실행 중인 old Job 별도 종료 판단 |

Graceful reload 중에는 old와 new가 동시에 존재할 수 있다. 이 구간을 실패로 간주할 필요는 없지만 deadline 뒤에도 old receipt가 heartbeat를 보내거나 target group에 남으면 rollout을 완료 처리하면 안 된다. “재시작 요청 성공”이 아니라 **old runtime population이 0이 된 시점**이 보안 교체의 끝이다.

## 혼합 line 환경은 하나의 최소 버전으로 판정하지 않는다

조직에 22.x, 24.x, 26.x가 동시에 있다면 `node >= 22.23.4` 같은 비교식은 잘못된 green을 만들 수 있다. 예를 들어 24.21.x는 숫자 비교상 22.23.4보다 크지만 24.x fixed version인 24.22.1보다 낮다. 허용 집합은 line별로 계산한다.

```js
const minimumFixed = new Map([
  [22, [22, 23, 4]],
  [24, [24, 22, 1]],
  [26, [26, 12, 1]],
]);
```

실제 gate에서는 semver parser를 사용하고 prerelease를 자동 허용하지 않는다. Version 문자열만으로 artifact를 허용하지 않는 것이 더 중요하다. 승인된 final image digest와 runtime version의 pair를 registry로 관리한다.

```text
approved_runtime = {
  image_digest,
  node_line,
  node_version,
  fixture_revision,
  fixture_result,
  promoted_at
}
```

같은 Node version이라도 OS package maintainer가 backport한 build, source build, distroless 조합은 artifact가 다르다. Official version string과 최종 digest를 모두 확인해야 한다.

## Rollout을 중단해야 하는 조건

다음 중 하나라도 남으면 완료로 승격하지 않는다.

- [ ] 22.x, 24.x, 26.x를 하나의 최소 version 비교식으로 평가한다.
- [ ] 24·26 전용 또는 26 전용 issue를 세 line 공통으로 기록한다.
- [ ] Mutable image tag만 있고 최종 digest가 없다.
- [ ] CI shell의 `node --version`만 있고 replica 내부 runtime receipt가 없다.
- [ ] 새 pod는 Ready지만 old pod·task·load balancer target이 남아 있다.
- [ ] `worker_threads`만 재생성하고 parent Node process는 교체하지 않았다.
- [ ] Cluster·PM2·queue worker의 old PID 또는 consumer member가 남아 있다.
- [ ] DNS fixture가 외부 network를 사용할 수 있거나 production hostname을 포함한다.
- [ ] Brotli memory corruption이나 TLS bypass를 production에서 재현하려 한다.
- [ ] Release note의 bundled dependency와 npm dependency inventory를 같은 것으로 취급한다.

## 결론

Node.js 10월 보안 release의 fixed version은 22.23.4, 24.22.1, 26.12.1이다.[1][2][3][4] 세 line의 최고 심각도는 모두 High지만 fixed set은 동일하지 않다. TLS IP 정규화 회귀 수정은 24·26에, invalid ZIP local header 처리와 Permission Model의 wildcard-node tree 수정은 26에만 포함됐다. Undici도 6.29.1, 7.30.1, 8.12.2로 갈린다.

따라서 배포 기록도 line별이어야 한다. Exact image digest를 고정하고, 같은 inert DNS fixture를 network가 차단된 container에서 실행하며, process가 내보낸 `process.version`·`process.execPath`·시작 시각을 platform의 image ID와 연결한다. 그런 다음 pod, task, load balancer target, cluster worker와 queue consumer에서 old runtime 수가 0인지 확인한다.

패치 파일이 registry에 존재하는 시점과 취약한 runtime이 사라지는 시점은 다르다. 이번 update의 완료 조건은 “새 version을 받았다”가 아니라 **실제 요청과 작업을 처리하는 모든 Node process가 해당 line의 fixed binary로 교체됐고, branch별 검증 결과를 다시 읽을 수 있다**는 것이다.

## Sources

[1] https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
[2] https://nodejs.org/en/blog/release/v22.23.4
[3] https://nodejs.org/en/blog/release/v24.22.1
[4] https://nodejs.org/en/blog/release/v26.12.1
[5] https://github.com/nodejs/Release/blob/main/README.md
