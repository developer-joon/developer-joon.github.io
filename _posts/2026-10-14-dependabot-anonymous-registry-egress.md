---
title: '토큰이 없어도 registry 설정은 필요하다: Dependabot anonymous mirror와 egress 경계'
date: 2026-10-14 05:20:00 +0900
categories: ["개발/보안"]
description: 'Dependabot이 인증 없는 사내 패키지 미러를 사용할 때 credential, registry 선언, repository scope, egress allowlist를 분리하고 안전한 전환 절차를 설계한다.'
featured_image: 'https://picsum.photos/seed/dependabot-anonymous-registry-egress/1600/900'
tags: [github, dependabot, private-registry, package-mirror, egress, supply-chain, dependency-confusion]
---

![Dependabot anonymous registry와 egress 경계](https://picsum.photos/seed/dependabot-anonymous-registry-egress/1600/900)

사내 npm 미러가 로그인 없이 읽기를 허용한다면 Dependabot에도 토큰이 필요 없다는 결론은 맞다. 그러나 여기서 “아무 설정도 필요 없다”로 한 걸음 더 나가면 업데이트 job은 실패한다. GitHub는 2026년 10월 12일 organization-level private registry의 인증 방식으로 **Anonymous**를 추가했다. 자격 증명 없이 도달할 수 있는 내부 package mirror가 대표 용도다.[1]

이 변화의 핵심은 빈 토큰 입력란이 아니다. Dependabot job에는 서로 다른 세 경계가 있다.

1. **인증 경계**: registry가 요청자에게 credential을 요구하는가.
2. **선언·권한 경계**: 어느 organization registry를 어느 repository의 보안 기능이 사용할 수 있는가.
3. **네트워크 경계**: job의 outbound proxy가 어느 host로 나가는 요청을 허용하는가.

Anonymous가 없애는 것은 첫 번째 경계의 credential뿐이다. Organization owner는 여전히 registry의 URL·type·인증 방식을 등록하고 repository access를 부여해야 하며, job은 허용된 host로만 나갈 수 있다. **No-auth는 no-policy가 아니다.** 이 글은 토큰 보관 일반론이나 패키지 서명 체크리스트를 반복하지 않고, anonymous mirror를 도입할 때 흔히 섞이는 선언·scope·egress의 경계를 분리한다.

## 먼저 출시 상태를 고정한다

2026년 10월 12일 발표 기준 Anonymous organization-level registry는 **github.com에서 generally available**다. GitHub Enterprise Server에는 이미 들어간 기능이 아니라 **GHES 3.24에서 제공될 예정**이다.[1] 따라서 GHES 3.23 이하에 Anonymous 선택을 가능한 절차로 적거나, github.com의 GA 상태를 GHES까지 일반화하면 안 된다.

여기서 “예정”은 설치된 기능이 아니다. GHES 운영자는 3.24 release note와 자기 인스턴스의 실제 UI·API를 확인한 뒤 migration을 시작해야 한다. GHES 3.23 이하에서 placeholder token을 즉시 제거할 수 있다고 가정해서도 안 된다.

## `registry를 안다`와 `host에 갈 수 있다`는 다르다

Package manager는 `.npmrc`, `nuget.config`, `pip.conf`, Maven `settings.xml` 같은 ecosystem-native 파일에서 registry URL을 읽는다. 하지만 github.com의 Dependabot update job은 HTTP/HTTPS proxy 뒤에서 실행되고, proxy는 모든 outbound request의 host를 egress allowlist와 비교한다. 허용되지 않은 host는 차단된다.[2]

따라서 repository에 다음 설정이 있어도 그것만으로는 충분하지 않다.

```ini
# .npmrc
registry=https://packages.example.internal/npm/
```

npm은 이 파일을 읽고 해당 주소로 요청하려 한다. 그러나 registry가 Dependabot에 별도로 선언되지 않았다면 proxy는 host를 허용하지 않는다. 공식 문서는 ecosystem-native 파일에만 정의된 registry를 구성된 registry로 보지 않으며, 이 경우 package manager가 요청을 시도해도 proxy가 막는다고 설명한다.[2] `.npmrc`가 틀린 것이 아니라 **package resolution 설정과 job egress 허가가 서로 다른 층**인 것이다.

Repository 단위 설정에서는 registry를 `dependabot.yml`의 top-level `registries`에 선언하고 해당 `updates` entry에서 참조해야 per-job host가 허용된다. 문서가 강조하듯 credential 존재가 아니라 registry 선언이 host를 도달 가능하게 만든다.[2] Anonymous mirror도 예외가 아니다.

Organization-level registry는 이 선언을 중앙화하는 또 다른 경로다. Organization settings의 **Secrets and variables → Private registries**에서 URL·type·인증 방식을 등록하고, 사용할 repository에 access를 부여한다.[1][3] 이번 변경은 바로 이 organization-level object에 Anonymous 인증 방식을 추가한 것이다. “토큰이 없으니 `.npmrc`만 둔다”가 아니라 “토큰은 없지만 registry object와 repository binding은 둔다”가 올바른 모델이다.

## 두 설정 경로를 한 YAML로 뭉개지 않는다

Dependabot의 private registry 접근에는 repository가 관리하는 `dependabot.yml` 경로와 organization이 관리하는 registry 경로가 있다. 전자는 top-level `registries`에 type·URL과 필요한 인증 정보를 정의하고, `updates` block에서 사용할 registry를 선택한다.[4] 후자는 organization owner가 중앙 registry를 만들고 repository access를 부여한다.[1][3]

둘은 운영 책임과 적용 단위가 다르다. Repository configuration은 해당 `updates` entry가 참조한 job에 적용되고 필요한 credential은 Dependabot secret에서 읽는다. Organization-level registry는 organization owner가 인증 방식과 repository access를 관리하며, 부여된 repository의 중앙 trust binding으로 동작한다.

특히 GitHub 발표는 organization-level registry가 access를 부여한 모든 repository에 적용되며, **Dependabot security updates만 사용하고 `dependabot.yml`이 없는 repository도 포함**한다고 설명한다.[1] 그러므로 “모든 repository가 YAML에서 registry 이름을 참조해야 한다”는 설명 역시 틀리다.

반대로 organization registry를 만들었다는 이유로 organization의 모든 repository가 자동으로 그 host를 사용할 수 있다고 가정해서도 안 된다. 실제 적용 집합은 registry에 access를 부여한 repository다.[1] 중앙 객체의 존재와 repository binding을 분리해서 inventory 해야 한다.

Dependabot secret과 organization-level private registry도 같은 객체가 아니다. Dependabot secret은 repository 또는 organization 수준에서 credential을 저장하고 `dependabot.yml`이 `${{secrets.NAME}}`으로 참조하는 경로다. Organization secret은 all, private, selected repositories 같은 access policy로 노출 범위를 제한할 수 있다.[4] Anonymous organization registry에는 전달할 credential 자체가 없지만, 그렇다고 repository access 선택이 사라지는 것은 아니다. **Credential scope가 비어 있는 것과 registry usage scope가 무제한인 것은 전혀 다른 상태**다.

## Organization access는 편의 기능이 아니라 두 번째 allowlist다

Anonymous mirror를 organization 수준에 한 번 만들면 중복 토큰과 repository별 URL drift를 줄일 수 있다. 하지만 중앙화의 반대편에는 blast radius가 있다. 잘못된 URL이나 너무 넓은 repository access가 설정되면 여러 Dependabot job이 같은 mirror를 신뢰하게 된다.

필자의 운영 권고는 organization registry의 repository access를 **network allowlist와 별도의 usage allowlist**로 다루는 것이다. GitHub 제품의 내부 구현을 그렇게 부른다는 뜻이 아니라, 검토 모델을 두 목록으로 나누자는 제안이다.

```text
Network reachability set
  = 기본 허용 host + job에 허용된 registry host

Registry usage set
  = organization registry access가 부여된 repository
    또는 repository update가 명시적으로 참조한 registry
```

첫 목록은 “어디로 요청할 수 있는가”에 답하고, 둘째 목록은 “어느 repository의 dependency resolution이 그 registry를 사용할 수 있는가”에 답한다. 한 목록이 좁아도 다른 목록이 과도하게 넓으면 통제 목적이 무너진다.

예를 들어 `packages.corp.example`이 network상 도달 가능하더라도 payments repository가 그 mirror를 사용하도록 승인됐다는 뜻은 아니다. 반대로 payments repository에 organization registry access를 부여했어도 mirror가 private network 안에만 있고 github.com hosted job에서 라우팅되지 않는다면 실제 요청은 성공하지 않는다. GitHub 문서는 private network나 내부 network에 제한된 registry에 접근하려면 Dependabot을 GitHub Actions self-hosted runner에서 실행하도록 안내한다.[4] Anonymous는 network path를 만들어 주는 기능이 아니다.

필자의 권고 inventory는 `registry_id`, type, canonical URL, expected hosts, repository access set, platform, auth mode, owner, last verified time을 함께 둔다. 이는 GitHub가 요구하는 schema가 아니다. Secret 목록이 아니라 URL, host, repository binding과 owner를 연결하기 위한 운영 제안이다.

## Anonymous는 mirror를 신뢰하지 않는다는 뜻이 아니다

인증이 없는 mirror도 Dependabot이 package metadata와 artifact를 받는 공급망 endpoint다. 누구나 읽을 수 있다는 것은 “누구에게나 같은 내용을 주는가”, “upstream의 어느 package를 보존하는가”, “어떤 시점의 metadata를 제공하는가”를 보장하지 않는다.

여기서부터는 GitHub가 Anonymous 기능으로 보장한다고 발표한 내용이 아니라 **필자의 mirror 운영 제안**이다. Organization registry를 승인할 때 다음 provenance를 함께 기록한다.

- mirror의 운영 주체와 변경 승인자
- upstream source와 동기화 방식
- metadata와 artifact cache의 보존·삭제 규칙
- upstream outage 때 stale artifact를 제공하는 조건
- redirect·object storage·CDN을 포함한 실제 download host 집합
- 같은 package name과 version이 upstream과 mirror에 동시에 있을 때 선택 규칙
- incident 시 마지막으로 정상 확인된 snapshot 또는 digest 목록

이 목록은 패키지 서명 일반론을 다시 쓰기 위한 것이 아니다. Dependabot이 **어느 registry에서 어떤 후보 버전을 발견했고 어떤 URL에서 artifact를 받았는지**를 재구성하기 위한 최소한의 mirror provenance다. Anonymous는 credential rotation 부담을 없애지만 registry 운영자와 content origin에 대한 신뢰를 없애지 않는다.

## Public fallback과 dependency confusion은 별도 결정이다

Dependabot은 기본적으로 public registry에 접근할 수 있고, 지원되는 일부 ecosystem은 public registry 호출을 제거해 private registry만 사용하도록 구성할 수 있다.[5] 따라서 anonymous mirror를 추가하는 것과 public registry access를 끄는 것은 같은 작업이 아니다.

다음 세 정책은 서로 다른 결과를 만든다.

1. **Mirror 추가 + public 유지**: mirror에 없는 dependency를 public source에서 해결할 수 있다.
2. **Mirror가 base를 대체**: package manager의 기본 source 대신 지정 mirror를 우선 사용한다.
3. **Private-only**: ecosystem별 설정을 통해 public registry 호출 자체를 제거한다.[5]

어느 정책이 맞는지는 mirror의 목적에 달려 있다. Pull-through cache라면 public fallback을 mirror 내부에서 수행할 수 있고, air-gapped curated repository라면 외부 fallback이 정책 위반일 수 있다. 이 결정 없이 Anonymous만 켜면 “토큰이 사라졌다”는 변경이 dependency source 정책까지 바꾼 것처럼 오해할 수 있다.

Dependency confusion에 대한 다음 항목은 GitHub 기능 보장이 아니라 **필자의 위협 모델 제안**이다. 내부 package 이름이 public registry에도 존재할 때 resolver가 어느 source와 version을 고르는지 fixture로 검증한다. Private package namespace, scope, source replacement, lockfile의 resolved URL, mirror miss 때 fallback을 함께 본다. 성공 조건도 “PR이 열렸다”가 아니라 **기대한 source에서 기대한 package가 선택됐다**로 둔다.

예를 들어 내부 `@corp/payments-sdk`는 scope가 mirror로 고정되어야 하고, unscoped package는 mirror miss 때 public으로 나가도 되는지 별도 정책이 필요하다. npm의 scoped dependency는 project `.npmrc`에서 private registry를 정의해야 하는 경우가 있으며, private-only 구성도 `.npmrc`와 `dependabot.yml`의 역할을 함께 요구할 수 있다.[5] 그래서 `.npmrc`는 불필요한 파일이 아니다. 다만 `.npmrc`만으로 egress host가 허용되지 않는다는 점과 동시에 이해해야 한다.[2]

## Egress allowlist는 redirect 뒤의 host까지 관찰해야 한다

Dependabot proxy의 기본 host 집합에는 지원 ecosystem의 public registry, mirror, CDN, download host와 GitHub infrastructure가 포함된다. Job별 host 집합은 해당 job에 구성된 registry에서 온다.[2] 공식 문서는 이 egress allowlist가 악성 dependency나 build script가 repository content 또는 registry credential을 승인되지 않은 destination으로 보내는 위험을 줄이지만, **허용됐거나 침해된 host로의 전송까지 막지는 못한다**고 명시한다.[2]

이 제한은 Anonymous에서도 중요하다. 전달할 registry token이 없어도 job이 읽는 manifest, package name, version 요청과 repository에서 파생된 정보가 outbound request에 포함될 수 있다. “secret이 없으니 egress 위험도 없다”는 결론은 성립하지 않는다.

또한 registry URL 하나가 실제 host 하나를 뜻하지 않을 수 있다. Metadata endpoint가 artifact를 object storage나 CDN으로 redirect하면 첫 host는 허용돼도 두 번째 host에서 `403`이 날 수 있다. Blocked-host 문서는 job log의 `proxy |` 행과 `egress not allowlisted` 메시지에서 정확한 host를 확인하고, registry redirect로 추가 host가 나타나는지 점검하라고 안내한다.[2]

문제가 생겼을 때 인증 실패부터 의심하면 시간을 낭비한다. 진단 순서는 다음이 낫다.

```text
1. Dependabot job log에서 package manager 오류 확인
2. 같은 시각의 `proxy |` 행 확인
3. `egress not allowlisted <host>`와 403 여부 확인
4. 최초 registry host인지 redirect/download host인지 분류
5. organization registry access 또는 repository registry 참조 확인
6. 그 뒤에만 registry의 anonymous read 응답과 TLS·routing 확인
```

`401`과 `403`도 기계적으로 auth와 egress로 단정하지 않는다. Package manager가 보여 주는 상위 오류는 network 또는 authentication failure처럼 보일 수 있으므로 proxy log가 실제 차단 원인을 말하는지 확인한다.[2] 반대로 proxy allowlist를 통과한 `403`은 registry 자체 정책의 응답일 수 있다.

Organization-specific host를 모든 Dependabot job의 shared default allowlist에 넣어 달라고 요청하는 것도 잘못된 해결이다. 공식 문서는 여러 사용자의 job에 정당하게 필요한 public registry·CDN·download host는 defaults 후보지만, private 또는 organization-specific registry는 job registry로 구성해 필요한 job에만 허용하라고 구분한다.[2]

## Placeholder token 전환은 in-place edit가 아니다

Anonymous option이 없던 시기에 인증 없는 mirror를 등록하기 위해 의미 없는 placeholder token을 넣은 조직이 있을 수 있다. GitHub의 migration 지침은 명확하다. 기존 registry를 지우고 **Anonymous authentication으로 다시 생성**해야 한다. 기존 registry의 authentication method는 바꿀 수 없기 때문이다.[1] Organization private registry 문서도 authentication type은 생성 후 변경할 수 없으며 다른 방식으로 전환하려면 삭제 후 다시 만들라고 설명한다.[3]

따라서 이 작업을 “token 값을 빈 문자열로 업데이트”로 구현하면 안 된다. 올바른 상태 전이는 다음과 같다.

```text
기존 registry inventory와 repository access export
  → 영향받는 repository·security update job 식별
  → 변경 창과 rollback 기준 설정
  → placeholder registry 삭제
  → 같은 canonical URL/type으로 Anonymous registry 생성
  → 기존 repository access 재부여
  → 대표 job 재실행
  → proxy host·resolved source·PR 결과 확인
```

가장 큰 위험은 credential이 아니라 **binding 유실**이다. 삭제 후 새 object를 만들 때 이전 selected repositories가 자동으로 이어진다고 가정하지 않는다. 발표가 organization-level registry를 access를 부여한 repository에 적용한다고 명시하므로, 재생성 뒤 repository access set을 다시 읽어 이전 목록과 비교해야 한다.[1]

이름 재사용도 identity 보존이 아니다. 자동화가 registry name만 보고 성공했다고 판단하지 말고 canonical URL, type, auth mode, repository access count와 실제 selected repository 식별자를 비교한다. API가 Anonymous auth type을 노출하는 방식은 사용하는 API version의 공식 schema에서 확인하며, 아직 문서화되지 않은 값을 추측해 production payload로 보내지 않는다.

Rollback도 “옛 token을 다시 넣는다”가 아니다. 기존 object를 삭제했으므로 rollback은 이전 설정 값을 바탕으로 token 방식 registry를 새로 만들고 repository access를 복원하는 재생성 절차다. Placeholder token이 실제 권한을 갖지 않았더라도 값 자체는 로그와 ticket에 복사하지 않는다. 이 글의 핵심은 secret hygiene가 아니라 immutable authentication method가 만드는 교체 semantics다.

## Security updates를 별도 fixture로 시험한다

Version update는 보통 `.github/dependabot.yml`의 schedule과 `updates` block이 명시적이어서 registry 참조를 찾기 쉽다. Security update는 `dependabot.yml` 없이도 동작할 수 있고, 이번 organization registry가 그런 repository에도 적용된다는 점이 변경의 중요한 부분이다.[1]

따라서 pilot을 `dependabot.yml`이 있는 repository 하나로 끝내면 중앙 registry의 고유 경로를 검증하지 못한다. 최소 fixture를 둘로 나눈다.

- **Fixture A — version update**: 명시적 update configuration이 있는 repository에서 mirror package의 새 버전을 발견하는지 확인한다.
- **Fixture B — security update only**: `dependabot.yml` 없이 Dependabot security updates가 활성화된 repository에 organization registry access를 부여하고, private dependency의 보안 업데이트 경로를 확인한다.

둘 다 같은 결과만 볼 필요는 없다. Version update는 schedule과 grouping 설정 영향을 받고, security update는 advisory와 vulnerable range가 있어야 PR 후보가 생긴다. 따라서 단순히 PR이 즉시 열리지 않았다는 이유로 Anonymous 접근 실패라고 판정하지 않는다. Job log, proxy host, registry request와 dependency resolution 결과를 단계별로 확인한다.

필자의 권고 acceptance evidence는 다음과 같다.

```text
platform/version
registry auth mode = anonymous
repository access = expected
job type = version | security
proxy decision = allowed
resolved registry host = expected
resolved package/version = expected
public fallback = expected policy와 일치
update result = PR | no-update | actionable error
```

이는 GitHub가 제공하는 단일 report format이 아니라 조직의 검증 기록 제안이다. `no-update`와 `registry unreachable`을 같은 “PR 없음”으로 합치지 않는 것이 목적이다.

## Rollout은 token 삭제가 아니라 trust 변경으로 다룬다

Anonymous 전환의 성공 지표를 “Dependabot secret 하나 감소”로 잡으면 repository scope와 mirror content를 놓친다. 먼저 placeholder registry, 접근 가능한 repository, `dependabot.yml` 없는 security-update-only repository와 redirect host를 찾는다. 영향이 작은 repository 집합에서 Anonymous registry를 재생성해 access를 복원하고 version·security update fixture를 각각 실행한다. 그다음 mirror hit·miss, public fallback, scoped internal package와 같은 이름의 public package를 재현한다. 이 source-policy 시험은 GitHub 제품 보장이 아니라 필자의 dependency confusion·mirror provenance 검증 권고다.

확대 뒤에는 repository access set, canonical URL, auth mode, 관찰된 outbound host를 비교한다. `egress not allowlisted` 발생, 예상 밖 source resolution, 누락된 binding, security-update-only repository의 실패를 따로 센다. 새 CDN redirect나 mirror topology 변경도 내부 사정으로 넘기지 않고 Dependabot egress 계약 변경으로 취급한다.

## 결론

GitHub의 Anonymous organization-level registry는 인증 없는 사내 mirror를 위해 가짜 token을 유지하던 불필요한 우회를 없앤다. 이 옵션은 github.com에서 GA이고 GHES에는 3.24에서 제공될 예정이다.[1] 기존 placeholder registry는 인증 방식을 수정할 수 없으므로 삭제한 뒤 Anonymous 방식으로 다시 만들어야 한다.[1][3]

하지만 Anonymous가 없애는 것은 credential뿐이다. `.npmrc`나 `nuget.config`에 URL을 쓰는 것만으로 Dependabot proxy의 egress가 열리지 않는다. Repository-level 구성이라면 top-level registry 선언과 update 참조가 필요하고, organization-level 구성이라면 registry object와 repository access binding이 필요하다.[1][2] 특히 organization registry는 `dependabot.yml` 없는 security-update-only repository에도 적용될 수 있으므로 중앙 access scope를 실제 repository 집합으로 검증해야 한다.[1]

마지막 경계는 mirror 자체다. 인증 없이 읽을 수 있어도 package source가 무정책이 되는 것은 아니다. **어느 repository가 어느 host에 갈 수 있는지, mirror가 어떤 upstream과 artifact를 제공하는지, public fallback에서 같은 이름의 package를 어떻게 선택하는지**는 별도의 운영 계약이다. Anonymous 도입을 secret 제거 작업이 아니라 egress·scope·source trust를 다시 고정하는 migration으로 다뤄야 하는 이유다.

## Sources

[1] https://github.blog/changelog/2026-10-12-anonymous-organization-level-registries-for-dependabot
[2] https://docs.github.com/en/enterprise-cloud@latest/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/resolve-a-blocked-host
[3] https://docs.github.com/en/code-security/how-tos/secure-at-scale/configure-organization-security/manage-usage-and-access/giving-org-access-private-registries
[4] https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-access-to-private-registries
[5] https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/removing-dependabot-access-to-public-registries
