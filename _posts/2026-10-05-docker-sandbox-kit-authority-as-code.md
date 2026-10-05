---
title: 'Docker Sandbox Kit v3 — Authority as Code를 OCI 이미지로 운반하기'
date: 2026-10-05 09:00:00 +0900
categories: ["개발/인프라"]
description: 'Docker Sandbox Kit v3가 에이전트의 권한 요청을 OCI 이미지에 선언하고, workload·mixin 조합과 capability diff, conforming runtime 집행으로 연결하는 방식을 분석한다.'
featured_image: 'https://picsum.photos/seed/docker-sandbox-kit-v3-authority-as-code/1600/900'
tags: [docker, sandbox-kit, ai-agent, oci, authority-as-code, capability, runtime-security]
---

![Docker Sandbox Kit v3 Authority as Code](https://picsum.photos/seed/docker-sandbox-kit-v3-authority-as-code/1600/900)

Dockerfile은 파일과 시작 명령은 잘 표현하지만, 에이전트가 접근할 도메인·자격 증명·볼륨 같은 외부 권한은 실행 플래그와 운영자의 기억에 흩어지기 쉽다. Docker가 2026년 9월 24일 공개한 Sandbox Kit Specification v3는 이 요구를 코드로 선언해 실행 콘텐츠와 함께 배포한다.[1] 단, Kit는 권한 증서가 아니라 **host가 판정할 요청서**다.

## v3 Kit는 일반 OCI image다

Kit는 전용 media type이 아니다. OCI image manifest의 `vnd.docker.sandbox.kit.descriptor` annotation에 published descriptor를, layer에 콘텐츠를 싣는다. Registry·이미지 도구로 저장하고 서명할 수 있으며 artifact digest를 고정하면 콘텐츠와 published descriptor가 함께 고정된다.[1][3]

그러나 digest가 최종 권한까지 고정하지는 않는다. Create-phase {% raw %}`${{ kit.args.* }}`{% endraw %}는 sandbox 생성 시 descriptor 전역에서 확장되므로 같은 artifact도 arg에 따라 effective descriptor와 permission surface가 달라질 수 있다.[3]

Annotation을 읽지 않는 일반 image engine에서는 descriptor가 inert하다. Root filesystem은 실행돼도 confinement·credential mediation·lifecycle hook은 저절로 생기지 않는다. 일부 type만 지원하는 runtime은 부분 구현이다. Required request를 지원하지 못할 때 조용히 실행하지 않고 거부하는지도 확인해야 한다.[3][4]

## workload 하나와 mixin들의 닫힌 집합

Published Kit는 실행 기반인 `workload`와 CLI·설정·capability request를 보태는 `mixin`으로 나뉜다. 한 composition에는 workload가 정확히 하나, mixin은 0개 이상이어야 한다. 여러 Kit를 한 reference로 공유하는 `kind: set`도 publish 결과는 ordinary workload 또는 mixin이고 내부 reference는 digest로 고정된다.[2][3]

Resolver는 CLI 입력 순서가 아니라 dependency graph로 조합 순서를 정한다. `provides`는 Kit가 제공하는 기능, `requires`는 선택된 집합 안에서 충족해야 할 조건이다. Registry에서 빠진 의존성을 자동 설치하지 않는다. Workload가 둘이거나 같은 normalized name의 provider가 둘이면 실패하고, 충돌을 마지막 입력으로 덮지 않는다.[1][3]

`provides/requires`는 콘텐츠 조합 계약이고, `capabilities`는 host를 향한 typed·versioned request다. 후자는 `com.docker.sandbox/network-policy@2`처럼 namespace·name·version을 가지며, host는 지원 범위·정책·사용자 승인에 따라 accept 또는 reject한다. Required capability를 제공할 수 없는 conforming runtime은 실행을 거부해야 한다. Optional request를 건너뛰면 그 선택을 기록한다.[3][4]

## 이름이 비슷해도 모두 권한 grant는 아니다

Pinned `v3.0.0-m.6`의 capability 계약은 세 유형을 명확히 구분한다.

- `privileged@1`은 **config가 없는 sandbox 전체 단위 요청**이다. Composition 중 하나라도 요구하면 전체 sandbox가 privileged가 되며 더 좁은 범위가 없다. Permission surface에서 가장 강한 단일 widening이고, host는 거부할 수 있다. Grant하면 runtime은 플랫폼의 elevated-privilege mode로 실행해야 한다.[7]
- `usb-device@1`은 실제 **permission grant**다. 요청은 `vendorId`+`productId` 쌍 또는 `class` 중 정확히 하나로 제한한다. Grant도 그 match에만 적용돼 ID grant가 다른 장치를, class grant가 무관한 class를 허용해서는 안 된다. 새 match나 ID에서 class로의 확대는 widening이다.[6]
- `agent-sessions@1`은 grant가 아니다. Workload의 기존 launch argv에 prompt·resume·continue tail을 어떻게 붙일지, session list 명령을 어떻게 실행할지 host/harness에 알려 주는 **workload CLI argv·control metadata**다. Permission surface에 포함되지 않으며 선언 자체가 권한을 부여하지 않는다.[8]

즉 `capabilities`라는 목록에 함께 있어도 permission 의미는 type별 페이지가 결정한다. `agent-sessions@1`을 권한 확대 목록에 넣거나 USB 범위를 “장치 접근” 한 줄로 뭉개면 실제 계약을 잃는다.

## Permission surface와 update gate를 분리하라

사양 §7.4는 effective descriptor에서 permission-bearing capability를 정규화해 permission surface를 계산한다. 이는 capability 의미와 widening 판정을 위한 사양 모델이다. 하지만 **모든 consumer가 update gate를 채택해야 한다는 보편적 MUST는 아니다.** 문구의 주어는 “Consumers that gate updates”다.[3]

Update gate를 채택한 consumer는 이전 surface를 lock에 저장하고 후보와 diff한다. 그 gate 안에서는 새 privilege, USB match, network host, credential, writable path 같은 widening을 승인 없이 통과시켜서는 안 된다. 반면 `agent-sessions@1`처럼 permission surface가 아닌 workload control metadata는 권한 diff 항목이 아니다.[3][6][7][8]

리뷰 입력은 artifact digest 하나로 끝나지 않는다. `args`의 제약과 실제 create arg, arg 확장 뒤 effective descriptor, host가 granted·skipped·refused한 결과, 그 descriptor에서 계산한 surface diff를 함께 본다. `network-policy@1`과 `@2`도 이름 변경으로 취급하지 말고 version별 config와 runtime 의무를 비교해야 한다.[3][5]

## TCK의 거부 관찰과 type별 의미를 분리하라

규범 사양, TCK가 관찰하는 범위, 특정 runtime의 결과는 서로 다르다. `v3.0.0-m.6`의 공식 `sbx` adapter는 `privileged@1`을 claimed 목록에 포함한다.[10] 그렇다고 claim만으로 모든 규범 동작의 통과가 증명되지는 않는다.

여기서 `usb-device@1`과 `agent-sessions@1` 전체가 TCK 밖에 있는 것은 아니다. Pinned TCK의 `checks.go` 168–218행은 claimed 목록에 없는 **모든 well-known type**을 각각 required fixture로 생성해, `RefusedError`가 아닌 실패나 sandbox 수락을 fail로 기록한다. 그 목록에는 두 type도 들어 있다.[12] `conformance.md` 역시 type별 동작 검사는 unclaimed type이면 건너뛰되, 그 type을 required로 선언한 Kit는 거부한다고 명시한다.[4]

따라서 두 층을 따로 읽어야 한다. USB의 실제 device-match grant 집행과 agent session의 launch/list argv 의미는 host hardware 또는 소비 주체를 전제하므로 capability-specific 관찰이 waived·skipped된다.[11] 반면 **required-unclaimed refusal**은 두 type 모두 관찰된다.[4][12] 이 결과가 증명하는 것은 미지원이라고 선언한 type을 조용히 수락하지 않았다는 사실까지다. 해당 type을 claimed한 runtime의 USB grant 범위나 agent-session argv 동작까지 증명하지는 않으므로, 그 부분은 별도 통합 시험으로 확인해야 한다.

## Conformance가 선언을 enforcement로 바꾼다

Kit conformance는 artifact publish 규칙을, runtime conformance는 지원한다고 주장한 capability의 관찰 가능한 집행을 검증한다.[3][4] 안전 경계가 닫히려면 reviewed published descriptor와 create arg, validated effective descriptor와 surface diff, host decision, runtime enforcement, selection/refusal 기록이 이어져야 한다.

같은 sandbox에서 v3 Kit를 v1·v2 Kit와 섞을 수 없다. `claude`, `codex` built-in shortcut은 현재 v2를 선택하므로 v3 workload와 mixin을 명시적으로 맞춰야 한다.[2] 또한 v3는 final 목표가 Q4 2026인 experimental specification이다. Production policy와 검증은 floating `main`이 아니라 검토한 tag 또는 commit에 고정해야 한다.[9]

운영 기록에서는 descriptor의 `requested`, host의 `granted/refused`, runtime의 `enforced`를 구분하자. Authority as Code의 가치는 선언 자체가 아니라, 어떤 입력으로 만들어진 effective descriptor를 누가 판정했고 어떤 구현이 집행했는지 재현하는 데 있다.

## Sources

[1] https://www.docker.com/blog/docker-sandbox-kit-spec/
[2] https://docs.docker.com/ai/sandboxes/customize/kits-v2/
[3] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/docs/spec/SPEC-v3.md
[4] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/docs/spec/conformance.md
[5] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/docs/spec/capabilities/com.docker.sandbox/network-policy@2.md
[6] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/docs/spec/capabilities/com.docker.sandbox/usb-device@1.md
[7] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/docs/spec/capabilities/com.docker.sandbox/privileged@1.md
[8] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/docs/spec/capabilities/com.docker.sandbox/agent-sessions@1.md
[9] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/README.md
[10] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/tck/adapters/sbx
[11] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/tck/sandbox/coverage_test.go
[12] https://github.com/docker/sandbox-kit-spec/blob/v3.0.0-m.6/tck/sandbox/checks.go#L168-L218
