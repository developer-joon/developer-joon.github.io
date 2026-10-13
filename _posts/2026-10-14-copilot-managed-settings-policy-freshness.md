---
title: '정책을 바꿔도 클라이언트는 모를 수 있다: Copilot 관리 설정의 freshness와 fail-closed 시작'
date: 2026-10-14 05:00:00 +0900
categories: ["개발/보안"]
description: 'GitHub Copilot 관리 설정의 강제 원격 갱신과 sandbox 최소 버전을 정책 freshness, 장애 대응, 단계적 rollout 관점에서 설계한다.'
featured_image: 'https://picsum.photos/seed/copilot-managed-settings-policy-freshness/1600/900'
tags: [github-copilot, managed-settings, policy-freshness, fail-closed, client-version, rollout, governance]
---

![GitHub Copilot 관리 정책의 freshness와 시작 차단](https://picsum.photos/seed/copilot-managed-settings-policy-freshness/1600/900)

관리자가 금지 정책을 저장하고 배포 파이프라인도 성공했다. 그런데 개발자의 Copilot 클라이언트는 한 시간 전 정책을 캐시에 가진 채 오프라인으로 시작한다. 중앙 저장소를 보면 통제는 켜져 있지만, 실행 시점의 클라이언트가 그 사실을 확인했는지는 알 수 없다. **정책의 존재와 최신 정책의 집행은 다른 상태**다.

GitHub는 2026년 10월 13일 이 간극을 다루는 관리 설정 변경을 발표했다. `forceRemoteSettingsRefresh`를 켜면 지원되는 클라이언트가 시작할 때 현재 server-managed 설정을 다시 가져오도록 요구할 수 있고, 캐시된 정책만으로 freshness 요구를 충족할 수 없다. 확인에 실패하면 오래됐거나 확인되지 않은 정책으로 계속 실행하지 않고 fail-closed한다.[1] 동시에 GitHub는 governance 중심 key에 최소 클라이언트 버전을 순차 적용하기 시작했으며, 첫 대상은 `sandbox`다.[1]

이 글의 초점은 sandbox가 막는 파일·네트워크·자격 증명 목록이 아니다. 그 내용은 기존 글에서 이미 다뤘다. 여기서는 더 앞단의 질문을 본다. **어떤 클라이언트가, 어느 시작 시점에, 어떤 출처의 정책을 확인해야 실행할 수 있는가?** 그리고 원격 확인 실패와 구형 버전 차단을 장애·rollout·break-glass 절차에 어떻게 넣을 것인가?

먼저 경계를 분명히 하자. 강제 갱신을 지원한다고 공식 발표된 클라이언트는 Copilot CLI, VS Code, GitHub Copilot app이다.[1] 최소 버전 강제의 첫 대상도 `sandbox` key라고 발표됐다.[1] 이를 모든 Copilot 클라이언트, 모든 관리 key, 모든 정책 전달 방식에 이미 적용되는 보편 기능으로 확대해서는 안 된다.

## 정책 값에 freshness 차원을 추가하라

일반적인 정책 모델은 `allow`, `deny`, 제한 값처럼 내용만 저장한다. 하지만 분산된 로컬 클라이언트가 집행 주체라면 값만으로는 부족하다. 같은 `deny`도 언제 받은 값인지, 이후 변경이 있었는지, 시작할 때 원격 원본을 다시 확인했는지에 따라 신뢰 수준이 달라진다.

운영 모델에서는 최소한 다음 상태를 분리할 필요가 있다.

```text
policy value      : 클라이언트가 집행할 설정 내용
policy source     : server / MDM / file
observed revision : 클라이언트가 마지막으로 확인한 정책 식별자
observed at       : 마지막 성공 확인 시각
startup checked at: 현재 시작 과정의 확인 시각
client version    : 집행 코드를 포함한 클라이언트 버전
startup decision  : allowed / restricted / blocked
```

이 필드들은 GitHub가 공개한 표준 telemetry schema가 아니라 **필자의 운영 제안**이다. 핵심은 revision 형식을 추측하는 데 있지 않다. GitHub가 공식 revision ID를 제공하지 않는다면 조직은 배포 commit, 정규화된 설정 digest, MDM profile version처럼 자신이 실제로 관찰할 수 있는 식별자를 사용해야 한다. 값이 없으면 만들어 낸 서버 revision처럼 기록하지 말고 `unknown`과 “수집 미지원”을 구분한다.

Freshness는 단순 TTL과 다르다. 최근 cache도 현재 원격 정책과 같다고 보장하지 않는다. Server-managed 설정은 보통 약 한 시간 안에 자동 적용되고, 재시작이나 재로그인이 즉시 갱신을 유발한다.[2] `forceRemoteSettingsRefresh`는 시간 민감 변경에서 시작 시 새 다운로드를 요구한다.[2][3]

따라서 정책 상태를 다음처럼 생각하는 편이 정확하다.

```text
유효성 = 값의 제한 강도
       × 현재 시작에서 확인된 freshness
       × 그 값을 집행할 수 있는 client capability
```

셋 가운데 하나가 0이면 중앙 파일의 내용만 보고 “집행 중”이라고 말할 수 없다. 최신 값을 받았어도 구형 client가 key를 이해하지 못하면 통제가 아니고, 최신 client여도 stale cache만 읽었다면 긴급 변경의 효력이 불확실하다.

## `forceRemoteSettingsRefresh`가 바꾸는 시작 계약

GitHub 공식 reference는 이 key를 `true`로 설정하면 Copilot CLI, VS Code, GitHub Copilot app이 시작할 때 server-managed 설정의 fresh download를 요구한다고 설명한다.[3] 다만 실패 표현은 client별로 같지 않다.

- Copilot CLI와 GitHub Copilot app은 평상시의 1시간 cache를 건너뛰고, 다운로드 실패 때 오래된 cached policy로 fallback하지 않는다. 갱신이 실패하면 정책이 확인되지 않은 상태가 되며 영향을 받는 operation이 제한된다.[3]
- VS Code는 요구된 refresh가 성공할 때까지 Copilot 기능을 차단한다.[3]
- 이 요구를 켠 사용자는 client 시작 시 network connection이 필요하다.[3]

여기서 “fail-closed”를 모든 프로세스가 동일한 오류 코드로 완전히 종료된다고 단정하면 안 된다. 공식 문서가 밝힌 범위는 CLI·app의 **영향 받는 operation 제한**과 VS Code의 **Copilot 기능 차단**이다.[3] 조직의 runbook은 client마다 실제 사용자 경험, 오류 문구, 재시도 방식, 이미 열린 session에 미치는 영향을 별도 fixture로 확인해야 한다.

반대로 이 key를 사용하지 않으면 지원 client는 빠른 시작과 일시적 장애 회복을 위해 평상시 managed-settings cache를 이용한다.[1] 관리자는 특정 정책군에서 이전 응답보다 현재 정책 확인을 우선할 수 있다.

이 선택에는 비용이 있다. 원격 정책 서비스나 client network path가 고장 나면 Copilot을 쓰지 못할 수 있다. 그러나 key를 급히 내리거나 local cache로 우회하면 freshness 통제는 가장 필요한 순간에 사라진다. 장애를 미리 설계할 운영 상태로 다뤄야 한다.

## 최초 sign-in 경계가 전달 방식마다 다르다

가장 놓치기 쉬운 부분은 server-managed 값이 자기 자신을 처음부터 강제할 수 없다는 점이다. GitHub 발표와 배포 문서는 MDM-managed 또는 file-based 전달이면 client가 처음 sign-in하기 전부터 freshness 요구를 적용할 수 있다고 설명한다. 반면 server-managed 값은 client가 그 값을 한 번 받은 뒤의 **후속 시작**부터 refresh를 요구한다.[1][2]

이는 순환 의존성 때문이다. 아직 로그인하지 않았고 server-managed 정책을 한 번도 받은 적 없는 장치는 “서버에 `forceRemoteSettingsRefresh=true`가 있다”는 사실을 알 수 없다. 첫 수신 이전의 bootstrap 통제가 필요하다면 장치 쪽에 먼저 놓이는 MDM 또는 file 전달을 사용해야 한다.

전달 방식의 일반 경계도 함께 봐야 한다. Server-managed 설정은 사용자의 로그인 계정과 연결되고 enterprise에서 Copilot license를 받은 사용자에게 적용된다. MDM·file 설정은 장치에서 읽기 때문에 server round trip이나 sign-in 전에 적용될 수 있고, 사용자가 계정을 전환해도 활성 상태를 유지한다.[2] MDM은 macOS와 Windows의 native policy location을 사용하며 Linux에서는 native MDM 대신 file-based 방식을 써야 한다.[2]

이 차이를 표로 정리하면 rollout 책임이 선명해진다.

| 전달 방식 | 최초 sign-in 전 freshness 요구 | 적용 축 | 운영상 주의점 |
|---|---|---|---|
| Server-managed | 불가. 값을 한 번 받은 뒤 후속 시작부터 가능 | 로그인 계정·enterprise license | bootstrap 공백과 원격 서비스 의존성 |
| MDM-managed | 가능 | 관리 장치 | OS별 배포 형식과 device-group 적용 확인 |
| File-based | 가능 | 파일을 받은 로컬 환경 | 미배포 장치는 제한되지 않으며 파일 무결성 확인 필요 |

표의 마지막 열은 공식 동작을 운영 관점에서 해석한 것이다. 특히 “file-based를 선택했다”는 선언만으로 모든 장치에 파일이 존재한다는 뜻은 아니다. GitHub 문서도 파일을 받지 못한 machine은 해당 정책으로 제한되지 않는다고 명시한다.[2] Bootstrap 보장을 주장하려면 장치 inventory와 실제 배포 read-back이 필요하다.

여러 전달 방식을 조합할 수도 있지만 precedence를 모르면 예상과 다른 값이 적용된다. 공식 문서의 일반 우선순위는 MDM, server, file, user 순서다. 다만 `sandbox`와 `permissions.deny`·`ask`·`allow`는 여러 전달 방식의 제한을 더 엄격한 방향으로 합성하는 예외다.[2] `forceRemoteSettingsRefresh`가 이 제한적 합성 예외 목록에 포함된다고 추정해서는 안 된다. 이 key는 일반 precedence와 client별 형식을 기준으로 검증해야 한다.

## cached policy 실패를 “정책 없음”과 구분하라

평상시 Copilot CLI에서 server-managed 요청이 실패하고 cached response도 없으면, 그 session에서는 server-managed policy를 사용할 수 없다. 서버 응답 없이도 반드시 남아 있어야 하는 제한은 MDM 또는 file-based 설정으로 배포하라는 것이 GitHub의 공식 안내다.[2]

여기에 `forceRemoteSettingsRefresh=true`가 이미 적용되면 조건이 달라진다. 오래된 cache가 존재해도 그것으로 freshness 요구를 충족하지 못한다. CLI·app은 cache fallback을 막고 영향을 받는 operation을 제한하며, VS Code는 필요한 refresh 성공 전 Copilot 기능을 차단한다.[1][3]

운영 화면에서는 적어도 아래 실패를 따로 보여 줘야 한다.

1. **첫 수신 전**: server-managed freshness key 자체를 아직 알지 못한다.
2. **cache 없음**: server-managed 요청 실패, 사용할 cached response도 없다.
3. **cache 있음·freshness 미요구**: 평상시 cache 정책으로 시작할 수 있다.
4. **cache 있음·freshness 요구**: cache는 존재하지만 현재 시작의 확인 근거가 될 수 없다.
5. **refresh 성공**: 현재 시작에서 원격 정책 확인을 마쳤다.
6. **refresh 실패·차단**: client별 fail-closed 동작으로 operation 또는 Copilot 기능이 제한된다.

이 상태 이름은 **필자의 runbook 제안**이다. 제품 로그가 같은 이름을 제공한다고 주장하는 것이 아니다. 목적은 help desk가 “cache 파일이 있는데 왜 실행이 안 되나”라는 문의에 cache corruption과 의도된 freshness 차단을 구분해 답하게 하는 데 있다.

Cached response를 수동 복사하거나 freshness key를 제거하면 장애 원인을 구분할 증거가 사라진다. 먼저 client·version·policy source·마지막 성공 시각·실패 단계를 보존하고, 재시도 후에도 실패하면 승인된 비상 절차로 전환해야 한다.

## 최소 버전은 현재 `sandbox` key의 집행 조건이다

정책 freshness는 “최신 값을 확인했는가”를 다루고, 최소 client version은 “그 값을 해석하고 집행할 코드가 있는가”를 다룬다. 두 통제는 겹치지 않는다. 최신 정책을 성공적으로 내려받은 구형 client가 key를 무시한다면 freshness만으로는 부족하다.

GitHub는 governance 중심 managed key에 최소 버전 요구를 점차 추가한다고 발표했지만, 현재 구체적으로 문서화된 강제 대상은 `sandbox`다.[1][3] Managed settings에 `sandbox` key를 추가하면 범위 안의 사용자에게 local sandbox가 강제되고, 지원 최소 버전으로 update하기 전까지 Copilot 연결이 차단된다.[3]

공식 reference가 공개한 최소 버전은 다음과 같다.[3]

| 지원 client | `sandbox` managed key 최소 버전 |
|---|---:|
| VS Code | 1.141.0 |
| Copilot CLI | 1.0.93 |
| GitHub Copilot App | 1.1.26 |

이 표를 “모든 managed setting의 최소 버전”으로 재사용하면 안 된다. 또한 supported key 표에는 VS Code의 `sandbox` 지원에 Agent Host 1.138.0+라는 별도 표기가 있지만, `sandbox` key를 managed settings에 넣을 때 연결 차단을 피하기 위한 최소 버전 표는 VS Code 1.141.0을 제시한다.[3] Rollout gate에는 더 직접적인 minimum-version enforcement 표를 사용하고, Agent Host 표기를 그것과 합쳐 임의의 단일 버전으로 만들지 않는 편이 안전하다.

버전 강제의 운영 의미는 “업데이트 권장 배너”보다 강하다. 구형 client 사용자는 update할 때까지 연결이 막힌다.[3] 따라서 장기 고정된 개발 container, golden image, offline workstation, 중앙 패키지 저장소, extension update 금지 정책이 있는 조직은 `sandbox` key를 넣기 전에 버전 inventory를 먼저 확보해야 한다.

## Rollout은 값 배포가 아니라 두 개의 차단면 배포다

`forceRemoteSettingsRefresh`와 `sandbox` 최소 버전을 동시에 전체 조직에 켜면 실패 원인을 분리하기 어렵다. 사용자는 원격 정책 확인 실패로 막혔을 수도 있고, client version이 낮아 막혔을 수도 있다. 그래서 **필자는** 두 차단면을 따로 관찰하고 단계적으로 결합할 것을 권한다.

### 0단계: 지원 matrix와 inventory 고정

공식 지원 범위를 기준으로 Copilot CLI, VS Code, GitHub Copilot app을 구분한다.[1][3] 사용자 수만 세지 말고 다음 차원으로 inventory를 만든다.

- client 종류와 실제 version
- OS와 device management 여부
- server·MDM·file 가운데 적용 가능한 policy source
- 첫 sign-in 전 bootstrap이 필요한 장치인지
- 평상시 시작에 outbound network를 보장할 수 있는지
- 자동 update, 고정 version, offline image 사용 여부
- business-critical workflow와 허용 가능한 차단 시간

이 목록은 GitHub가 요구하는 고정 schema가 아니라 조직별 사전 점검안이다. Unknown client를 “최신”으로 간주하지 않고 별도 미확인 집합으로 둔다.

### 1단계: 원격 확인 경로만 canary에서 검증

비핵심 사용자와 장치군에 `forceRemoteSettingsRefresh`를 적용한다. Server-only canary와 MDM/file bootstrap canary를 분리해야 최초 sign-in 차이를 확인할 수 있다. 정상 network, DNS 실패, proxy 인증 실패, GitHub service 접근 실패, 첫 sign-in, 후속 startup을 각각 재현한다.

성공 기준은 “설정 파일이 merge됐다”가 아니다. 지원 client가 시작 시 refresh를 수행하고, 성공 전에는 보호된 기능을 열지 않으며, 실패 시 공식 문서의 client별 제한 형태와 일치하는지 확인하는 것이다.[3] 같은 장치에서 cache가 있는 경우와 없는 경우도 나눠 시험한다.

### 2단계: version readiness를 먼저 끌어올린다

`sandbox` key를 넣기 전에 VS Code 1.141.0, Copilot CLI 1.0.93, GitHub Copilot App 1.1.26 미만을 찾아 update한다.[3] 단순 설치율보다 “다음 startup에 실제 선택되는 binary”를 확인한다. PATH에 구버전 CLI가 남거나, container image가 예전 extension을 다시 배포하거나, VDI snapshot이 rollback하면 inventory의 최신 버전과 실행 버전이 달라질 수 있다.

이는 **필자의 운영 제안**이며 GitHub가 특정 inventory API를 보장한다는 뜻이 아니다. 조직은 실제로 확보 가능한 증거를 선택해야 한다.

### 3단계: `sandbox` key를 소규모 범위에 추가

이 단계에서만 최소 버전 차단을 실제로 관찰한다. 구형 client fixture 하나는 의도적으로 남겨 update 요구와 연결 차단이 재현되는지 확인한다. 최신 client fixture에서는 정책 수신과 local sandbox 시작을 별도 단계로 본다. 이 글은 sandbox 내부 제한 목록을 다시 설명하지 않는다. 여기서 검증할 것은 key 추가가 version gate를 만들고, 지원 version으로 update한 뒤 연결이 회복되는지다.[3]

### 4단계: freshness와 version gate를 결합

두 단독 실험이 끝난 뒤에만 “현재 정책을 확인한 지원 version”을 시작 조건으로 결합한다. 확대는 team·device cohort 단위로 하고, 각 cohort마다 차단율, 원인 분포, 복구 시간, 정책 원격 서비스 오류, 업데이트 실패를 기록한다. 목표는 차단 0건이 아니라 **잘못된 client가 조용히 실행되는 0건**과 **정상 client의 예측 가능한 복구**다.

## Break-glass는 stale 정책 허용이 아니라 별도 능력이어야 한다

정책 서비스 장애가 길어지면 “어제 cache도 충분히 안전하니 잠시 허용하자”는 압력이 생긴다. 그러나 긴급 정책 변경 때문에 freshness를 강제한 시점이라면 stale cache 허용은 바로 그 변경을 무효화할 수 있다.

필자의 권고는 break-glass를 `forceRemoteSettingsRefresh=false`로 되돌리는 일반 절차와 분리하는 것이다. 예외가 필요하다면 다음 조건을 가진 별도 경로로 취급한다.

- 승인된 incident ID와 업무상 필요
- 대상 사용자·장치·시간의 최소 범위
- 읽기 중심 또는 위험 operation 제거
- 별도 격리 환경이나 대체 도구
- 짧은 만료와 자동 회수
- 사용 전후 local change·remote write read-back
- 원격 정책 경로 회복 뒤 즉시 정상 client로 재검증

이는 GitHub 제품 기능 설명이 아니라 **조직의 비상 운영 설계**다. 특히 제품이 제공하지 않는 bypass token이나 특정 API가 있다고 가정하지 않는다. 기존 개발 환경에서 제한된 대체 수단을 준비하고, 없으면 Copilot 중단을 감수하는 것이 fail-closed의 실제 의미다.

정책 원격 서비스를 시작 조건으로 삼았다면 가용성 운영도 보안 운영의 일부다. 조직 proxy, certificate, DNS, device clock, SSO를 함께 진단하되 TLS 검증이나 정책 파일 권한을 느슨하게 만들지 않는다.

## 변경 승인서에는 effective time을 따로 적어라

관리자가 server-managed 파일을 commit한 시각은 모든 client의 집행 시작 시각이 아니다. 공식 문서상 일반 server-managed 변경은 약 한 시간 안에 적용되며 restart 또는 sign-in이 즉시 refresh를 유발한다.[2] `forceRemoteSettingsRefresh`도 server source에서 처음 받은 뒤 후속 startup부터 요구된다는 bootstrap 경계가 있다.[1][2]

따라서 변경 기록에는 하나의 “배포 완료” 대신 다음 milestone을 두는 편이 좋다.

```text
T0  정책 변경 승인
T1  server / MDM / file 원본 배포 완료
T2  대상 장치가 freshness requirement 최초 수신
T3  대상 client가 후속 startup에서 fresh policy 확인
T4  최소 version 미달 client 차단 또는 update 완료
T5  대상 cohort의 집행 증거 확인
```

이 시각 모델은 **필자의 제안**이다. 모든 client에서 T2~T5를 자동 수집할 수 있다고 단정하지 않는다. 수집할 수 없는 단계는 “완료”로 채우지 말고 측정 공백으로 표시한다. 긴급 변경의 effective time은 T1이 아니라 요구한 비율의 대상이 T3·T4를 통과한 시점으로 정의하는 편이 정직하다.

## 운영 지표는 설정 보급률보다 시작 판정을 본다

`managed-settings.json` 최신 commit은 중앙 작성 상태만 보여 준다. 실제 통제에는 client startup 결과가 필요하다. 제품이 이 telemetry를 모두 제공한다고 가정하지 않고 다음 지표를 내부 진단과 inventory로 조합할 수 있다.

- 지원 client별 현재 시작의 refresh 성공·실패·미확인 비율
- 마지막 성공 확인 이후 경과 시간
- policy source별 최초 수신 전 장치 수
- cached policy가 있으나 freshness 때문에 차단된 startup 수
- `sandbox` minimum version 미달 client 수와 update까지 걸린 시간
- 차단 원인별 MTTR: network, authentication, policy service, outdated client
- break-glass 승인·사용·만료·정상 복귀의 연결률
- 정책 변경 T1부터 cohort T5까지 걸린 시간

이는 GitHub 공식 metric 이름이 아니라 **운영 제안**이다. Refresh 실패가 곧 공격을 뜻하지 않으므로 장치 상태, version downgrade, 정책 파일 제거 같은 맥락과 함께 판단한다.

## Runbook: 사용자가 시작하지 못할 때

현장 대응은 다음 순서로 단순화할 수 있다.

1. **지원 범위 확인**: Copilot CLI, VS Code, GitHub Copilot app 가운데 무엇인지 확인한다.[1][3]
2. **실행 version 확인**: 설치 목록이 아니라 실제 실행 binary·extension version을 확인한다. `sandbox` key가 적용됐다면 공식 최소 버전과 비교한다.[3]
3. **policy source 확인**: server, MDM, file 가운데 어떤 source가 key를 공급했는지와 일반 precedence를 확인한다.[2]
4. **bootstrap 여부 확인**: 최초 sign-in 전인지, server-managed 값을 이전에 한 번 받았는지 구분한다.[1][2]
5. **cache 상태 구분**: cache 없음, cache 존재하지만 freshness 미충족, refresh 성공을 분리한다.[2][3]
6. **원격 경로 확인**: 일반 인터넷 연결 여부가 아니라 정책 fetch에 필요한 실제 network·authentication 경로를 점검한다.
7. **제품 동작 확인**: CLI·app의 operation 제한인지 VS Code의 Copilot 기능 차단인지 확인한다.[3]
8. **승인된 복구 선택**: update, network 복구, policy source 재배포를 우선하고 stale cache 우회는 기본 절차에서 제외한다.
9. **Read-back**: 재시작 뒤 fresh policy와 지원 version 조건을 모두 다시 확인한다.

6번 이후의 구체적 진단 필드와 8번의 예외 정책은 조직별 제안이다. 공식 문서가 제공하지 않는 오류 code나 원격 revision을 runbook 필수값으로 만들면 오히려 현장에서 허구의 증거를 채우게 된다.

## 과장하지 말아야 할 네 가지

첫째, `forceRemoteSettingsRefresh`는 모든 Copilot surface의 일반 기능이 아니다. 현재 공식 범위는 Copilot CLI, VS Code, GitHub Copilot app이다.[1][3]

둘째, server-managed 값은 첫 sign-in 전부터 스스로를 강제하지 못한다. 최초 startup부터 freshness가 필요하면 MDM 또는 file-based 전달이 필요하고, server-managed는 한 번 받은 뒤 후속 startup부터 요구한다.[1][2]

셋째, cached policy 실패를 모든 client의 동일한 “앱 완전 종료”로 표현하면 안 된다. CLI·app은 정책 미확인 시 영향을 받는 operation을 제한하고, VS Code는 refresh 성공까지 Copilot 기능을 차단한다고 문서화돼 있다.[3]

넷째, minimum client version enforcement를 모든 managed key로 일반화하면 안 된다. GitHub는 확대 방향을 밝혔지만 현재 공개된 구체적 강제와 버전 표는 `sandbox` key 범위다.[1][3]

이 네 경계를 지키면 공식 기능과 운영 해석을 섞지 않을 수 있다. 나머지 revision schema, rollout cohort, SLO, break-glass 승인 필드는 조직이 설계하고 검증할 영역이다.

## 결론

중앙 정책 파일이 존재한다는 사실은 시작 시점의 집행 증거가 아니다. Copilot 같은 로컬 client 통제에서는 **무슨 값을 받았는가**, **현재 시작에서 최신임을 확인했는가**, **그 값을 집행할 version인가**를 함께 봐야 한다.

`forceRemoteSettingsRefresh`는 평상시 cache가 주는 속도와 장애 회복력 대신, 시간 민감 변경에서 현재 server-managed 정책 확인을 시작 조건으로 선택하게 한다.[1][3]

그러나 최초 sign-in부터 요구하려면 MDM 또는 file 전달이 필요하고, server-managed 값은 한 번 수신한 뒤 후속 시작부터 효력이 생긴다.[1][2]

`sandbox` key의 최소 버전 강제는 freshness와 별개로 구형 집행 코드를 연결 단계에서 제거한다.[3]

도입의 핵심은 두 설정을 한 번에 켜는 것이 아니다. 지원 client inventory를 만들고, bootstrap source를 정하고, cache 유무별 실패를 재현하고, `sandbox` minimum version을 먼저 충족한 뒤, freshness와 version gate를 단계적으로 결합해야 한다. 장애 때 stale 정책을 허용하는 대신 제한된 대체 경로를 준비하고, 정책 commit 시각이 아니라 client가 fresh policy와 지원 version을 확인한 시각을 effective time으로 다뤄야 한다.

정책 freshness는 “최신이면 좋다”는 운영 품질 지표가 아니다. 최신 정책을 확인하지 못한 client가 실행되지 않는지, 그리고 정책을 이해하지 못하는 구형 client가 집행 surface에 남지 않는지를 묻는 통제다. 중앙 정책의 진짜 효력은 저장소의 JSON이 아니라 client startup의 allow·restrict·block 판정에서 드러난다.

## Sources

[1] https://github.blog/changelog/2026-10-13-enterprise-managed-settings-enforcement-updates/
[2] https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/deploy-managed-settings
[3] https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/enterprise-administrators/enterprise-managed-settings
