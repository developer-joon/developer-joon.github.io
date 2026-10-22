---
title: 'npm install 전에 막는 GitHub Package Firewall: 정책보다 요청 경로를 먼저 검증하라'
date: 2026-10-22 08:00:00 +0900
categories: ["개발/보안"]
description: 'GitHub Package Firewall 공개 프리뷰를 도입할 때 npm의 실제 registry 경로, direct bypass, cache, negative fixture, 차단 사유와 만료되는 예외를 검증하는 운영 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/github-package-firewall-npm-supply-chain/1600/900'
tags: [github, package-firewall, npm, supply-chain, registry, cooldown, ci-cd, public-preview]
---

![창가 테이블의 유리병에 꽂힌 흰 꽃과 초록 잎](https://picsum.photos/seed/github-package-firewall-npm-supply-chain/1600/900)

악성 npm 패키지는 애플리케이션이 그 모듈을 `import`할 때까지 기다리지 않을 수 있다. 설치 단계에서 lifecycle script가 실행되면 테스트나 배포 전에 개발자 PC와 CI runner의 자격 증명이 노출될 수 있다. GitHub는 이런 요청을 upstream registry 앞에서 검사하는 **Package Firewall**을 2026년 10월 20일 public preview로 공개했다.[1]

발표만 보면 enterprise 정책에서 malware 차단과 cooldown을 켜면 끝날 것처럼 보인다. 그러나 이 기능은 endpoint가 package manager의 요청을 firewall URL로 보내도록 별도로 구성해야 작동한다. 정책이 켜져 있어도 `npm`이 `registry.npmjs.org`로 직접 나가거나, 기존 Artifactory remote가 public registry를 계속 바라보거나, cache가 network 요청을 없애면 그 설치는 방금 설정한 정책의 평가를 받지 않는다.

따라서 첫 질문은 “어떤 규칙을 켤까?”가 아니다. **“이 설치가 실제로 어느 registry와 cache를 거쳐 어떤 정책 판정을 받았는가?”**다. 이 글은 package firewall을 새로운 공급망 만능 해법으로 다루지 않는다. effective registry path, direct bypass, cache, 실패해야 하는 fixture, block reason, 그리고 만료되는 예외를 하나의 검증 계약으로 묶는다.

## 먼저 제품 경계를 고정한다

2026년 10월 22일 현재 Package Firewall은 **public preview**다. 대상은 GitHub Enterprise Cloud와 data residency를 사용하는 GitHub Enterprise Cloud 고객이며, 현재 지원 ecosystem은 npm뿐이다. Preview 기간에는 무료지만 GA 뒤에는 GitHub Actions와 비슷한 metered usage 방식으로 과금될 수 있다.[1] 이 문장을 다음처럼 축약하면 안 된다.

- 모든 GitHub plan에서 사용할 수 있는 GA 기능이 아니다.
- GitHub Enterprise Server에 설치하는 기능으로 발표되지 않았다.
- Maven, PyPI, NuGet, RubyGems까지 보호한다고 말할 수 없다.
- Preview의 무료 상태를 장기 가격 계약처럼 예산에 넣으면 안 된다.

공식 문서가 설명하는 현재 policy control은 known malware, vulnerability severity, attestation downgrade, 새로 추가된 install script, minimum package age다. Known malware, attestation downgrade, newly introduced install scripts는 기본값이 On이다. Vulnerability 기준은 기본 Critical only이고, minimum age 기본값은 1일이며 1~365일 또는 비활성화를 뜻하는 0으로 설정할 수 있다.[2]

여기서도 이름보다 판정 범위를 정확히 읽어야 한다. Attestation downgrade는 “모든 패키지는 attestation이 있어야 한다”는 요구가 아니다. 이전 버전에 SLSA attestation이 있었는데 요청 버전에는 없을 때의 하락을 비교한다. Newly introduced install script도 모든 lifecycle script를 일괄 금지한다는 설명이 아니다. 최근 버전에서 `preinstall`이나 `postinstall` 같은 script가 새로 생겼는지를 보는 신호다.[2]

## 정책 화면과 실제 요청 경로는 서로 다른 상태다

Firewall 정책은 그 firewall을 통과한 요청에만 적용된다. GitHub 문서도 enterprise policy를 구성한 다음 endpoint의 package manager가 default public registry 대신 enterprise별 firewall URL을 사용하도록 설정하라고 요구한다.[2]

```text
개발자 PC / CI runner / coding agent
        │
        ├─ npm metadata 요청
        └─ npm tarball 다운로드
                 │
                 ▼
https://package-firewall.githubapp.com/npm/enterprises/ENTERPRISE
                 │
          enterprise policy 평가
                 │
          허용 또는 사유와 함께 차단
                 │
                 ▼
        public npm upstream
```

이 그림은 **희망 경로**일 뿐이다. 실제 경로에는 다음 우회가 끼어들 수 있다.

1. Command line의 `--registry`가 firewall 설정을 덮어쓴다.
2. `NPM_CONFIG_REGISTRY` 환경 변수가 runner image의 `.npmrc`와 다른 값을 준다.
3. 실행 job이 repository에서 예상한 파일과 다른 npm config source를 읽는다.
4. `@scope:registry`가 특정 scope만 별도 registry로 보낸다.
5. Custom registry에서 생성된 lockfile의 resolved URL이 계속 그 registry를 가리킨다.
6. Artifactory virtual repository 안에 public npm을 직접 조회하는 remote가 남아 있다.
7. Cache hit 때문에 이번 install에서는 registry 요청 자체가 발생하지 않는다.

npm은 package scope에 따라 registry를 선택하며, scope가 없으면 `registry` 설정을 사용한다. Default registry에서 만든 lockfile은 현재 설정 registry로 전환될 수 있지만 custom registry에서 만든 lockfile은 설정을 바꾼 뒤에도 그 custom registry에서 설치될 수 있다.[3] 즉 `npm config get registry` 하나가 정상이라고 해서 모든 scoped package와 모든 lockfile tarball URL이 같은 경로를 쓴다고 단정할 수 없다.

npm 설정은 command line, 환경 변수와 여러 config file source의 영향을 받을 수 있고, `--userconfig`나 `NPM_CONFIG_USERCONFIG`는 읽을 user config file 자체를 바꿀 수 있다.[4] Golden image의 `$HOME/.npmrc`를 고쳤다는 작업 기록보다 **실제 job의 working directory와 환경에서 계산된 값**을 읽어야 하는 이유다.

## 인증 토큰은 경로 증명의 일부일 뿐이다

공식 npm 구성은 user-level `.npmrc`에 enterprise 전용 firewall URL과 해당 경로에 scope된 token을 둔다. 요청 token은 enterprise 구성원인 user 또는 bot account와 연결돼야 하며 public repository read-only를 넘는 elevated permission은 필요하지 않다.[2]

```ini
registry=https://package-firewall.githubapp.com/npm/enterprises/ENTERPRISE
//package-firewall.githubapp.com/npm/enterprises/ENTERPRISE/:_authToken=${GITHUB_TOKEN}
```

이 예시의 `ENTERPRISE`와 `GITHUB_TOKEN`은 placeholder다. 실제 token을 repository, build log, diagnostic bundle에 쓰지 않는다. Token 권한을 최소화해도 direct public registry를 허용하는 network path가 남아 있다면 enforcement는 우회될 수 있다. 반대로 egress를 닫아도 firewall token이 잘못 scope됐거나 runtime identity가 enterprise member가 아니면 정상 install이 실패한다.

따라서 인증 성공을 “보호 적용”으로 번역하지 않는다. 최소한 다음 세 상태를 따로 기록한다.

```text
identity accepted
  ≠ effective registry가 firewall임
  ≠ upstream direct egress가 차단됨
```

## effective registry를 실행 환경에서 read-back한다

Repository의 `.npmrc`만 code review해서는 부족하다. 실제 install 직전에 secret을 출력하지 않는 read-back을 실행한다.

```bash
set -eu

expected='https://package-firewall.githubapp.com/npm/enterprises/ENTERPRISE/'
actual="$(npm config get registry)"

printf 'effective npm registry: %s\n' "$actual"
test "$actual" = "$expected"

printf 'npm cache path: %s\n' "$(npm config get cache)"
```

Trailing slash가 CLI version에 따라 어떻게 정규화되는지는 pilot에서 고정하고, 문자열 비교기는 그 관찰 결과에 맞춘다. 기대값 불일치를 warning으로 흘려보내지 않는 것이 중요하다. 이 check는 token을 읽거나 출력하지 않는다.

그다음 scope별 경로를 별도로 본다. 사내 private package scope가 private registry로 가야 한다면 그것은 정상 예외일 수 있다. 그러나 public package를 가져오는 scope가 firewall 대신 public npm으로 가면 정책 우회다.

```bash
npm config get @acme:registry
npm config get @vendor:registry
```

Scope 목록은 `package.json` 하나에서 끝나지 않는다. Workspace 전체의 direct dependency, lockfile의 transitive package name, repository의 `.npmrc`, base image의 user config를 함께 inventory한다. 결과는 token이 아니라 `scope → effective registry host` mapping으로 저장한다.

Lockfile도 URL 관점에서 검사한다. 여기서 목적은 dependency를 다시 고정하는 일반 lockfile 논의가 아니다. `resolved` URL 또는 package-manager가 해석한 tarball endpoint가 firewall, 승인한 private registry, 또는 승인한 internal proxy 중 하나인지 확인하는 것이다.

```text
허용 예시
- package-firewall.githubapp.com/npm/enterprises/ENTERPRISE/...
- packages.corp.example/npm-private/...

조사 대상
- registry.npmjs.org/...
- 승인하지 않은 mirror·CDN host
- 예전 Artifactory remote URL
```

`registry.npmjs.org` 문자열이 보인다는 사실만으로 곧바로 runtime bypass라고 판정하지 않는다. npm의 lockfile registry replacement semantics와 사용하는 CLI version을 함께 확인해야 한다.[3] 최종 증거는 static URL scan, effective config, 그리고 network access log가 같은 경로를 가리키는지다.

## direct-registry bypass를 실패하도록 만든다

Positive test는 firewall을 통과한 정상 package 설치가 성공하는지만 보여 준다. 진짜 enforcement는 direct path가 실패하는 negative test로 확인한다.

Pilot runner에서 다음 두 경로를 분리한다.

```text
A. firewall URL → 허용
B. public npm registry 직접 지정 → network policy로 거부
```

B를 시험할 때 실제 운영 dependency를 설치할 필요는 없다. 별도 fixture environment에서 harmless public metadata 요청을 사용하고 artifact 실행은 하지 않는다. 예를 들어 보안팀이 승인한 package name에 대해 direct registry endpoint의 metadata 요청이 실패하는지 확인한다. Command 결과뿐 아니라 egress gateway나 proxy log에서 목적지, decision, rule ID를 read-back한다.

Acceptance criterion은 “명령이 non-zero였다”가 아니다.

```text
request_id = <sanitized correlation id>
source = pilot runner identity
requested_host = registry.npmjs.org
expected_decision = deny
observed_decision = deny
reason = direct public npm path is not approved
artifact_downloaded = false
```

DNS 장애, TLS 오류, rate limit도 non-zero를 만들 수 있다. 예상한 network rule이 차단했다는 evidence가 없으면 bypass test는 통과가 아니다. 개발자 laptop, ephemeral CI runner, self-hosted runner, coding agent container는 network boundary가 다르므로 대표 endpoint마다 반복한다.

### Artifactory를 쓸 때 생기는 두 번째 경로

GitHub 문서는 Artifactory remote가 Package Firewall을 upstream으로 사용하도록 구성할 수 있다고 설명한다. Endpoint는 계속 Artifactory를 사용하고 public package만 firewall을 경유하게 할 수 있다. 다만 이 지원은 현재 experimental이며, virtual repository에서 public registry를 직접 가져오는 다른 remote를 제외해 우회를 막으라고 명시한다.[2]

```text
endpoint
  → Artifactory virtual npm
      ├─ private local repository
      └─ GitHub Package Firewall remote
            → public npm
```

검토 대상은 새 remote 하나가 아니라 virtual repository의 전체 member list와 routing order다. `npmjs-direct`, legacy remote, emergency fallback이 남아 있으면 firewall 장애 때 자동 우회하는 fail-open 구조가 될 수 있다. Firewall unavailable 상태에서 direct remote로 넘어가지 않고 예상한 오류를 내는지도 negative fixture에 포함한다.

## cache hit는 정상 응답이 아니라 관측 공백일 수 있다

npm cache는 HTTP 응답과 package 데이터를 content-addressable cache에 저장한다. `--prefer-offline`은 cached data의 staleness check를 건너뛰고 없는 데이터만 network에서 가져오며, `--offline`은 network request를 하지 않는다.[4] Warm cache에서 install이 성공했는데 firewall access log가 없다면 “firewall이 허용했다”가 아니라 **이번 실행에는 평가할 요청이 없었을 가능성**을 먼저 봐야 한다.

이 구분은 실제 사고 대응에서도 중요하다. GitHub Advisory Database의 Nx 악성 version 대응 지침은 dependency tree와 lockfile 확인뿐 아니라 package-manager cache, internal registry와 build artifact를 함께 정리하라고 권고한다.[5] 즉 upstream 차단을 켠 뒤에도 이미 내려받은 artifact의 존재를 별도 상태로 다뤄야 한다.

따라서 firewall pilot 결과를 다음 두 mode로 나눈다.

### Cold-path fixture

- 격리된 새 cache directory를 사용한다.
- `--offline`과 `--prefer-offline`을 끈다.
- Metadata와 tarball 요청이 firewall access path에 나타나는지 확인한다.
- Allow 또는 block decision의 package, version, policy reason을 기록한다.

```bash
cache_dir="$(mktemp -d)"
trap 'rm -rf "$cache_dir"' EXIT

npm --cache "$cache_dir" config get registry
# 이어지는 fixture install은 승인된 inert package만 사용한다.
```

### Warm-path fixture

- 같은 cache로 동일 install을 반복한다.
- Firewall request가 줄거나 사라지는지 확인한다.
- “요청 없음”을 allow decision과 구분한다.
- Shared CI cache key, restore source, 생성 시각, 마지막 검증 시각을 남긴다.

Cache integrity 검사는 content가 손상되지 않았다는 신호이지 현재 enterprise policy를 통과했다는 신호가 아니다. 이미 cache에 들어온 package가 나중에 malware advisory 대상이 돼도 cache-only install에는 새로운 firewall lookup이 없을 수 있다. 따라서 고위험 build는 cache restore 뒤 advisory refresh 또는 cold revalidation이 필요한지 별도 정책으로 정한다.

GitHub Advisory Database의 Nx incident 문서는 영향받은 version을 제거하는 것 외에 npm·Yarn·pnpm cache를 지우고 internal registry나 npm proxy에서도 compromised version을 purge하라고 안내했다.[5] 이 사례가 모든 cache를 항상 비우라는 뜻은 아니다. **Block policy를 배포한 뒤에도 내부 mirror와 cache가 이미 받은 artifact를 계속 제공할 수 있다는 실패 경로**를 보여 준다.

## negative fixture는 “차단될 이유”까지 고정한다

실패해야 하는 test는 실제 malware package를 만들거나 내려받아서는 안 된다. Pilot용 enterprise-owned inert package와 공개된 제품 정책을 이용해 실행 payload 없이 판정 경로를 확인한다.

| Fixture | 안전한 준비 | 기대 결과 | 반드시 읽을 증거 |
|---|---|---|---|
| Fresh version | 내용이 없는 inert package의 새 version을 격리 scope에 게시 | Minimum age로 차단 | `version cooldown`, package, version, request URL |
| Aged version | 같은 package의 cooldown보다 오래된 clean version | 허용 | Firewall 경유와 allow 결과 |
| Attestation downgrade | 기존 attested fixture 다음에 실행 코드 없는 non-attested version 게시 | 해당 policy가 On이면 차단 | Attestation downgrade라는 구체적 reason |
| Direct public registry | 승인한 metadata-only 요청을 public npm에 직접 보냄 | Network deny | Egress rule과 목적지 host |
| Legacy Artifactory remote | Pilot virtual repository에만 direct remote를 의도적으로 둔 뒤 제거 전후 비교 | 제거 전 경로 발견, 제거 후 direct path 실패 | Remote selection과 upstream access log |
| Warm cache | 허용 fixture를 cold install한 뒤 같은 cache로 반복 | Network request가 없을 수 있음 | Cache hit와 firewall decision 부재의 구분 |
| Expired override | 만료된 조직 예외 레코드의 package version 요청 | 예외 제거 뒤 다시 차단 | Reconciliation 결과와 block reason |

Attestation downgrade fixture는 attestation이 없는 package가 악성이라는 주장을 시험하는 것이 아니다. 이전에 있던 provenance signal이 새 version에서 사라졌을 때 제품이 문서대로 차단하는지 보는 것이다. 실제 package 내용은 비어 있거나 정적 파일만 포함하고 lifecycle script를 넣지 않는다.

Newly introduced install script policy는 별도 sandbox와 법무·보안 승인을 거친 fixture가 없으면 production package로 재현하지 않는다. 차단 기능을 시험하려고 실제 credential 접근이나 network call을 하는 script를 만들 이유는 없다. 공개 preview에 vendor-provided safe test fixture가 생기면 그 공식 절차를 우선한다.

## block reason을 exit code와 분리해 저장한다

공식 문서의 예시에서는 npm output 또는 CI/CD log에 package name, 차단된 version 수, `version cooldown` 같은 policy reason과 exception 요청 URL이 나타난다.[2] 운영 pipeline이 `npm install failed` 한 줄만 남기면 security block과 registry outage를 구분할 수 없다.

필자의 권고 event schema는 다음과 같다. 이것은 GitHub가 제공한다고 약속한 audit schema가 아니라 조직 내부의 정규화 형식이다.

```json
{
  "observed_at": "<UTC timestamp>",
  "endpoint_class": "ci-runner",
  "repository": "<repository identifier>",
  "ecosystem": "npm",
  "package": "<package name>",
  "version": "<requested version>",
  "effective_registry_host": "package-firewall.githubapp.com",
  "decision": "blocked",
  "reason": "version_cooldown",
  "fixture": true,
  "request_id": "<sanitized correlation id>"
}
```

Token, full environment dump, user home의 `.npmrc`, private package tarball URL query는 evidence에 넣지 않는다. Log parser는 최소한 다음 상태를 서로 다른 값으로 보존한다.

- `blocked_malware_advisory`
- `blocked_vulnerability_threshold`
- `blocked_attestation_downgrade`
- `blocked_new_install_script`
- `blocked_version_cooldown`
- `authentication_failed`
- `firewall_unreachable`
- `direct_egress_denied`
- `cache_hit_no_firewall_request`
- `unknown_failure`

이 reason vocabulary 역시 조직의 관측 모델이다. 실제 preview output 문구가 바뀌면 parser가 조용히 `allowed`로 넘어가지 말고 `unknown_failure`로 실패하게 한다. Preview upgrade 때 sample log fixture를 갱신한다.

## 예외는 승인보다 만료가 더 어렵다

Package Firewall이 package를 잘못 차단하거나, cooldown 안에 긴급 보안 수정 version을 받아야 할 수 있다. 공식 flow는 block output의 URL에서 repository, ecosystem, package, version, reason과 comment를 채워 bypass를 요청하고 enterprise administrator 또는 enterprise security manager가 승인하는 방식이다. Reviewer는 요청 version을 range로 바꾸거나 `*`로 넓혀 모든 version을 허용할 수도 있다.[2]

문제는 현재 문서에 자동 expiration 또는 TTL 입력란이 설명돼 있지 않다는 점이다. 승인된 bypass는 policy의 package override에 추가되고 관리자가 오래되거나 불필요한 예외를 검토해 수동 제거할 수 있다고만 되어 있다.[2] 따라서 제품이 자동으로 만료시킨다고 가정하면 안 된다.

TTL은 조직 control로 보완한다.

```text
GitHub package override
  + external exception record
      - package and exact version/range
      - policy reason bypassed
      - requester and approver
      - business reason
      - created_at
      - expires_at
      - owner
      - evidence link
      - removal status
```

`expires_at`은 GitHub Package Firewall의 공식 field라고 부르면 안 된다. Ticket, policy-as-code repository, GRC system 등 조직이 관리하는 reconciliation record다. Scheduled job 또는 정기 review가 만료 대상을 찾고, 관리자가 실제 override를 제거한 뒤 동일 negative fixture가 다시 차단되는지 확인한다.

예외 기본값은 exact version으로 둔다. `*`는 새 version에도 같은 신뢰 결정을 자동 적용하므로 enterprise-owned package처럼 범위 확대 근거가 명확할 때만 허용한다. Cooldown 우회라면 시간이 지나면 정상 policy로 설치할 수 있으므로 짧은 TTL이 자연스럽다. Malware나 vulnerability 차단 우회는 편의 예외가 아니라 명시적 risk acceptance로 다루고 security owner를 요구한다.

예외 lifecycle의 성공 기준은 승인 버튼이 아니다.

```text
request → review → exact-scope approval → 사용 확인
        → expires_at 도달 → GitHub override 제거
        → cold-cache negative fixture 재실행 → 다시 차단됨
```

마지막 재차단까지 확인해야 예외가 실제로 닫혔다고 말할 수 있다. Warm cache가 package를 제공하면 override 제거 뒤에도 install이 성공할 수 있으므로 expiration test는 새 cache와 direct-egress deny 상태에서 실행한다.

## rollout dashboard는 정책 개수가 아니라 경로를 세야 한다

Enterprise 전체에서 “malware policy On”만 집계하면 false assurance가 생긴다. Endpoint별로 다음 네 수를 구분한다.

1. **Expected endpoints**: npm install 가능성이 있는 developer image, runner, agent, proxy 수
2. **Configured endpoints**: firewall URL과 token path가 배포된 수
3. **Observed endpoints**: cold fixture 요청이 firewall log에 실제 나타난 수
4. **Enforced endpoints**: direct public registry negative fixture가 예상 reason으로 실패한 수

`configured / expected`는 배포율이고 `observed / expected`는 경로 증명률이다. 가장 중요한 값은 `enforced / expected`다. Cache-only endpoint는 observed에 억지로 넣지 않고 별도 상태로 둔다.

운영 지표는 다음처럼 잡을 수 있다.

- Policy reason별 block 수와 unknown reason 수
- Direct-registry egress deny 수
- Firewall bypass request 수, 승인율, 평균 처리 시간
- Active override 수, exact version 대비 wildcard 비율
- TTL 초과 override 수와 제거 지연
- Cache hit로 firewall decision이 없었던 install 비율
- Firewall latency와 availability
- GA 전 월별 request volume과 예상 metered cost 범위

마지막 항목은 preview가 무료라는 사실과 분리한다. 현재 request 수를 측정해도 GA 단가가 발표되지 않았다면 비용은 `requests × unknown unit price`인 scenario일 뿐이다. 다른 GitHub 서비스의 단가를 가져와 확정 예산처럼 쓰지 않는다.

## 도입 순서: 정책보다 먼저 우회를 재현한다

실제 rollout은 다음 순서가 안전하다.

### 1. Endpoint와 registry path를 inventory한다

개발자 image, GitHub-hosted·self-hosted runner, coding agent, Artifactory virtual repository, base container를 나눈다. 각 환경에서 npm version, effective registry, scope registry, cache path, proxy와 outbound policy를 기록한다.

### 2. Direct path를 먼저 실패시킨다

Pilot endpoint에서 public npm direct metadata path가 egress rule 때문에 거부되는지 확인한다. Firewall을 끄면 public npm으로 fallback하는 구성이 없어야 한다.

### 3. Firewall URL과 최소 권한 identity를 배포한다

Token은 repository에 저장하지 않는다. Bot 또는 user identity가 enterprise member인지 확인하고, 설치 직전에 effective registry assertion을 실행한다.

### 4. Cold-path allow와 block fixture를 실행한다

Aged inert version은 허용되고 fresh version은 cooldown으로 차단돼야 한다. 결과에 package, version, block reason과 exception URL이 나타나는지 본다.

### 5. Cache와 proxy 경계를 별도로 시험한다

Fresh cache와 warm cache 결과를 분리한다. Artifactory virtual repository에서는 direct public remote가 없는지 읽고 firewall 장애 시 fail-closed인지 확인한다.

### 6. Exception lifecycle을 끝까지 실행한다

Exact version override를 승인하고, 조직 TTL이 지난 뒤 실제 override를 제거한다. 새 cache에서 같은 요청이 다시 차단되는지 확인한다. `*` override는 pilot 성공을 쉽게 만들기 위해 사용하지 않는다.

### 7. 범위를 넓히기 전에 관측 공백을 계산한다

Expected·configured·observed·enforced endpoint를 비교한다. Unknown block reason, missing access log, direct egress success, stale override가 하나라도 있으면 coverage를 확대하기 전에 원인을 닫는다.

## 이 기능이 막지 않는 것

Package Firewall은 통과한 npm metadata와 download 요청을 enterprise policy로 평가한다. 이것을 공급망 전체의 완결된 보증으로 확대하면 안 된다.

- Firewall을 거치지 않는 registry 요청은 평가되지 않는다.
- Existing cache나 internal mirror가 제공한 artifact는 새 요청 없이 재사용될 수 있다.
- Advisory가 아직 등록되지 않은 공격은 known-malware check만으로 잡히지 않을 수 있다.
- Attestation이 존재한다는 사실만으로 publish workflow와 source가 정당했다는 결론은 나오지 않는다. Firewall의 attestation downgrade 검사는 이전 version보다 증명 수준이 낮아졌는지를 보는 정책이지 package 내용 전체의 안전성 인증이 아니다.[2]
- Install script 차단만으로 import-time payload나 application runtime behavior를 모두 통제하지 못한다.
- Private package source, internal registry ACL, runtime secret 최소화와 incident response는 별도 통제다.

이 경계는 기능을 평가절하하는 것이 아니다. Download 전에 policy decision을 내릴 수 있는 위치는 의미가 크다. 다만 그 위치를 실제 트래픽이 지나고 있는지, 지나지 않는 경로를 network가 닫았는지, cache와 예외가 그 결정을 오래 우회하지 않는지를 함께 증명해야 효과가 생긴다.

## 결론

GitHub Package Firewall의 핵심은 policy toggle이 아니라 **요청 경로의 강제성**이다. 2026년 10월 22일 현재 이 기능은 GitHub Enterprise Cloud 대상 public preview이며 npm만 지원한다. Preview 기간에는 무료지만 GA 뒤 metered billing 가능성이 있고, 제품 계약도 바뀔 수 있다.[1]

도입 증거는 세 줄로 요약할 수 있다.

1. 실제 job의 effective registry와 network log가 firewall 경로를 가리킨다.
2. Direct public registry, fresh cooldown version, expired override 같은 negative fixture가 예상한 이유로 실패한다.
3. Warm cache의 “요청 없음”과 firewall의 “허용”을 구분하고, 예외에는 조직이 관리하는 TTL과 제거 후 재차단 검증이 있다.

정책을 켠 화면은 의도를 보여 준다. **Cold cache에서 firewall을 통과한 요청, direct path의 명시적 deny, 구체적인 block reason, 만료 후 제거된 override가 enforcement를 증명한다.**

## Sources

[1] https://github.blog/changelog/2026-10-20-github-package-firewall-in-public-preview/ — GitHub Package Firewall public preview 발표, 대상·npm 한정·preview 가격 경계
[2] https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/protecting-endpoints-with-package-firewall — 정책 control, npm·Artifactory 구성, bypass 요청과 override 관리
[3] https://docs.npmjs.com/cli/v11/using-npm/registry/ — npm scope별 registry 선택과 lockfile registry 의미
[4] https://docs.npmjs.com/cli/v11/using-npm/config/ — npm config 우선순위, cache·offline·prefer-offline 동작
[5] https://github.com/advisories/GHSA-cxm3-wv7p-598c — Nx 악성 version 대응, package-manager cache와 internal registry purge 지침
