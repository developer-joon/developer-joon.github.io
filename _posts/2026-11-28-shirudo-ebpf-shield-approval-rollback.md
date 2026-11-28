---
title: 'AI가 만든 eBPF 방패를 어디까지 믿을까: Shirudo 승인·롤백 실험'
date: 2026-11-28 07:05:00 +0900
categories: ["AI"]
description: 'Pre-release Shirudo를 공식 test VM에서 검증하고, bpf-next 계열 kernel patch·TPM 2.0 전제를 확인한 뒤 향후 canary 승인과 롤백 절차를 설계한다.'
featured_image: 'https://picsum.photos/seed/shirudo-ebpf-shield-approval-rollback/1600/900'
tags: [shirudo, ebpf, ai-security, runtime-security, approval, rollback]
---

![키보드와 스마트폰, 펼친 책이 놓인 책상](https://picsum.photos/seed/shirudo-ebpf-shield-approval-rollback/1600/900)

치명적인 취약점이 공개됐지만 서비스 재시작과 정식 patch 배포에는 시간이 걸린다. 이 틈에 AI가 eBPF 방어 코드를 만들고 실행 중인 host에 올릴 수 있다면 대응 시간은 줄어든다. 동시에 잘못된 조건 하나가 정상 요청을 차단하거나 kernel event path에 예상하지 못한 부하를 더할 수 있다. 생성 속도가 빨라진 만큼 승인과 회수의 기준은 더 엄격해야 한다.

OpenAI와 Cisco는 2026년 11월 23일 Linux runtime 보호 프로젝트 Shirudo를 공개했다. 공식 설명에 따르면 shield는 eBPF를 이용해 실행 중인 system을 관찰하고 취약 동작을 겨냥한 임시 보호를 적용하며, 운영자가 후보 shield의 application 영향을 확인하고 승인한 뒤 enforcement할 수 있다.[1] 프로젝트는 BSD 2-Clause로 공개됐고 BPF program은 BSD와 GPL dual license를 사용한다.[1]

Shirudo는 현재 **pre-release이며 production-ready가 아니다**. 공식 저장소는 production target에 signed-loader ABI와 Shirudo kernel patch를 포함한 Linux kernel 및 TPM 2.0이 필요하다고 밝힌다.[2] FAQ는 현재 bpf-next kernel과 프로젝트가 별도로 유지하는 patch가 필요하고 모든 target에 TPM 2.0이 필요하다고 설명하며, 먼저 software TPM을 포함한 공식 test VM에서 시험하도록 안내한다.[3] System requirements에는 older kernel용 compatibility mode나 fallback이 없다고 명시돼 있다.[4]

이 글은 Shirudo를 직접 production에 배포한 결과가 아니다. 현재 단계의 실습은 공식 test VM 또는 동등하게 격리된 전용 환경만을 대상으로 한다. 공개 구조를 바탕으로 무엇을 검증하고, 향후 지원 경계가 바뀐 뒤 어떤 증거가 있어야 관찰 모드에서 강제 모드로 넘어갈지 절차를 제안한다. 핵심은 AI 생성 방어를 patch의 대체품이 아니라 **만료 시각과 회수 조건이 있는 임시 통제**로 취급하는 것이다.

## Shield와 patch는 해결하는 시간이 다르다

정식 patch는 취약한 application이나 dependency의 원인을 수정한다. Shield는 patch를 준비하고 검증하고 순차 배포하는 동안 exploit에 필요한 동작을 runtime에서 막거나 감시한다. 공식 발표도 Shirudo를 “patch를 rollout하는 동안” system을 보호하는 runtime으로 설명한다.[1] 따라서 shield가 exploit fixture를 막았다는 사실만으로 취약점이 제거됐다고 기록하면 안 된다.

OpenAI는 통제된 시험에서 Codex가 만든 shield가 실행 중인 Elasticsearch service를 재시작하지 않고 Java4Shell exploit attempt를 차단했다고 보고한다.[1] 이는 특정 application, 공격 경로와 환경에서 나온 공급자 측 사례다. 모든 Java 취약점, 모든 kernel, 다른 Elasticsearch build나 우회 변형까지 차단한다는 보증이 아니다. 해당 결과를 자체 환경의 pass로 복사하지 말고 같은 application image와 정상 요청을 포함한 로컬 fixture에서 다시 확인해야 한다.

수명주기는 네 상태로 분리하는 편이 안전하다.

```text
candidate → observe → enforce → retire
               ↘ reject      ↘ rollback
```

`candidate`는 agent가 제안했지만 아직 host에 적용하지 않은 artifact다. `observe`는 차단하지 않고 어떤 event가 일치하는지 기록한다. `enforce`는 명시적 사람 승인을 거쳐 실제 동작을 막는다. `retire`는 정식 patch 배포와 검증 뒤 shield를 제거한 상태다. 어느 상태에서도 자동으로 다음 단계로 넘어가지 않으며 artifact hash, approver, target group, 시작·만료 시각과 근거를 남긴다.

## AI는 후보를 만들고 운영자가 경계를 정한다

공식 설명에서 agent는 취약점을 조사하고 targeted shield를 개발하고 exploit과 실제 workload에 대해 효과를 검증할 수 있도록 설계되지만, 무엇을 배포할지는 security team이 통제한다.[1] 이 문장을 “AI가 안전한 eBPF를 자동 생성한다”로 줄이면 중요한 책임 경계가 사라진다.

Guardian agent에게 production credential이나 무제한 cluster write 권한을 주지 않는다. Agent가 읽을 수 있는 입력은 CVE 설명, 최소 재현 fixture, application binary와 symbol metadata, 허용된 source tree처럼 목적에 필요한 범위로 제한한다. 출력은 source, compile log, verifier log, 예상 hook, map·memory 한도, 차단 조건과 rollback command를 포함한 candidate package로 만든다. Package가 불완전하면 배포자가 추측으로 값을 채우지 않고 실패시킨다.

사람 승인도 단순 버튼 하나가 아니다. Security reviewer는 차단 조건이 exploit primitive와 연결되는지 보고, service owner는 정상 workload의 false positive를 보고, platform owner는 kernel·distribution·BTF·capability 호환성과 resource limit를 확인한다. 고위험 fleet에서는 작성자와 승인자를 분리하고 긴급 승인이라도 사후 검토와 자동 만료를 요구한다.

Shirudo repository는 runtime security와 observability, BPF upatch 기반 live mitigation, container·Kubernetes Pod·LLM agent를 위한 policy enforcement를 use case로 제시한다.[2] Use case 목록은 지원 matrix와 다르다. 일반 배포판의 stock kernel을 전제로 해서는 안 되며, bpf-next 계열 source commit, signed-loader ABI, 프로젝트가 유지하는 kernel patch, LSM hook·BTF·kernel config와 TPM 2.0을 공식 요구사항에 맞춰 고정해야 한다.[3][4]

## 공격 차단과 정상 요청 보존을 같은 fixture에서 본다

보안 시험은 exploit 하나가 막히면 끝나기 쉽다. 그러나 exploit과 정상 요청이 같은 syscall, library path나 application operation을 공유하면 넓은 차단은 service outage를 만들 수 있다. 공식 발표도 이 trade-off를 Shirudo가 다루려는 문제로 설명한다.[1]

Fixture는 공식 quickstart test VM을 기본으로 하고, 필요하면 외부로 나갈 수 없는 동등한 disposable VM으로 확장한다.[3] Stock distribution kernel에 곧바로 설치하는 절차가 아니다. 취약 service image, 공식 요구사항을 충족하는 고정 kernel·runtime, software 또는 hardware TPM 2.0, 합성 data와 두 종류의 traffic을 준비한다. 악성군은 승인된 무해한 재현으로 취약 path 도달 여부만 확인하고 shell 획득이나 외부 callback을 만들지 않는다. 정상군은 read, write, 인증 실패, 큰 payload, health check, backup, rolling restart 등 production에서 필요한 대표 흐름을 포함한다.

측정 표는 다음처럼 공격과 정상성을 나란히 둔다.

| 영역 | 지표 | 합격 방향 |
|---|---|---|
| 공격 fixture | 취약 동작 도달, canary event | enforce에서 0건 |
| 정상 fixture | 성공률, response code | baseline 허용 범위 |
| 성능 | p50·p95·p99 latency, CPU | 사전 한도 이내 |
| kernel | verifier reject, map pressure, lost event | 0 또는 명시 한도 |
| 운영 | load·unload 성공, 상태 조회 | 반복 가능 |
| 감사 | artifact hash, 승인·제거 event | 누락 없음 |

이 표의 threshold는 Shirudo 공식 기본값이 아니라 조직별 검증안이다. Baseline을 먼저 여러 차례 측정하고 workload 변동을 반영해 한도를 정한다. 실험을 실행하지 않았다면 기대 결과와 실제 관찰 칸을 분리해 비워 둔다. 공급자 Java4Shell 사례를 자체 fixture 결과처럼 기입해서는 안 된다.

## 관찰 모드에서 false positive의 모양을 찾는다

첫 적용은 차단 없는 관찰 모드가 원칙이다. 동일한 candidate를 소수 canary host에 올리고 exploit signature와 일치할 event가 정상 traffic에서 얼마나 발생하는지 본다. 단순 count뿐 아니라 process, cgroup, executable digest, namespace, hook, argument의 필요한 최소 projection을 기록한다. 민감한 payload 전체나 credential을 audit log에 남기지 않는다.

관찰 모드는 안전을 자동 보장하지 않는다. BPF program을 load하고 event를 수집하는 것 자체가 resource를 사용하며 잘못된 probe가 system behavior에 영향을 줄 수 있다. 따라서 load 전 verifier 통과, instruction·map·ring buffer 한도, event loss, CPU 사용과 loader 실패를 검사한다. Canary에서 telemetry가 끊기면 “문제 없음”이 아니라 관찰 불능으로 판정한다.

False positive review에서는 hit 수가 아니라 이유를 본다. Backup agent, health checker, JVM maintenance thread처럼 정상인데 취약 path와 닮은 흐름을 분류한다. 예외를 추가할 때는 process 이름 같은 쉽게 바뀌는 문자열 하나에만 의존하지 않고 executable digest, cgroup identity와 배포 단위를 조합한다. 예외가 exploit에 재사용될 수 있는지도 다시 공격 fixture로 검사한다.

Observe에서 enforce로 넘어가는 최소 조건은 `악성 fixture hit > 0`, `정상 fixture hit = 0 또는 승인된 좁은 예외`, `telemetry completeness 충족`, `load overhead 한도 이내`, `rollback dry-run 성공`이다. 이 중 하나라도 측정되지 않으면 긴급하다는 이유로 미측정값을 0으로 해석하지 않는다.

## 서명과 verifier가 보장하는 범위를 구분한다

Shirudo는 shield를 cryptographically sign하고 load 전에 verify하도록 설계됐다. Linux eBPF verifier는 program이 kernel의 safety rule을 만족하는지 검사하며 kernel security control은 무단 변경을 제한한다.[1] Shirudo는 TPM을 이용해 protection이 load되거나 제거된 사실에 대한 검증 가능한 기록을 지원한다고도 설명한다.[1]

이 장치들은 서로 다른 질문에 답한다. Signature는 승인된 artifact bytes인지 확인하지만 그 방어 logic이 취약점을 정확히 막는지는 증명하지 않는다. eBPF verifier는 program의 허용 가능한 실행 특성을 검사하지만 application-level false positive가 없다는 보증은 아니다. TPM evidence는 특정 측정과 event의 진위를 강화하지만 정책 자체가 옳다는 판단을 대신하지 않는다.

그래서 배포 manifest에는 최소한 다음 값을 고정한다.

- shield source와 compiled object의 digest
- signer identity, signature algorithm, key version과 expiry
- target kernel·architecture·application digest
- attach point, map limit와 expected event schema
- observe·enforce mode와 대상 host selector
- 승인 ticket, approver, 시작·만료 시각
- rollback artifact와 제거 후 검증 query

Loader는 manifest와 실제 host가 다르면 fail closed한다. 긴급 상황에서도 `latest` tag나 mutable branch를 배포하지 않는다. 서명 key가 폐기되거나 target binary가 교체되면 기존 승인을 자동 승계하지 않고 재검증한다.

## 향후 production 도입은 작게 시작하고 즉시 되돌릴 수 있어야 한다

이 절은 현재 pre-release build의 production 배포 지침이 아니라, 프로젝트가 production-ready 상태와 조직의 별도 승인을 충족한 뒤 적용할 **향후 도입 절차 제안**이다. 그때도 enforcement는 canary 한 대나 작은 shard에서 시작한다. 정상 request error rate, latency, kernel·application log와 shield hit를 같은 timeline으로 본다. Error budget을 넘거나 telemetry가 끊기거나 예상하지 못한 process가 차단되면 자동으로 rollout을 멈추고, 사전 승인된 경우에만 shield를 detach한다. 상태가 애매한데 전체 fleet으로 계속 확장하는 default를 두지 않는다.

Rollback은 파일을 삭제하는 명령 한 줄이 아니다. Detach가 성공했는지, pin된 map·link가 남지 않았는지, policy state가 원래대로 돌아왔는지, 정상 traffic이 회복됐는지를 확인해야 한다. 제거 실패 때 host reboot가 필요한지도 미리 정하고, reboot 자체가 더 큰 위험이면 traffic drain 절차를 준비한다. Rollback command도 candidate와 같은 review·서명 대상이어야 한다.

다음 failure injection을 staging에서 제안할 수 있다.

1. 서명이 틀린 object와 만료된 key를 load해 거부되는지 본다.
2. 지원하지 않는 kernel·BTF에서 호환성 오류가 명확히 나는지 본다.
3. Observe telemetry sink를 끊어 rollout이 중단되는지 본다.
4. Enforce 중 정상 traffic threshold를 넘겨 자동 정지와 rollback을 확인한다.
5. Loader process를 중간에 종료해 partial attachment가 남는지 본다.
6. 정식 patch image로 교체한 뒤 shield 제거와 취약 fixture 재검증을 수행한다.

이는 실행 결과가 아니라 안전한 시험 계획이다. Production exploit code, 실제 credential이나 외부 callback 없이 합성 canary와 승인된 재현만 사용해야 한다.

## 정식 patch 뒤 제거까지가 incident의 끝이다

임시 방어는 유용해서 오래 남기 쉽다. Shield가 살아 있는 동안 application team이 patch를 미루거나, 몇 달 뒤 새 binary에서 낡은 hook이 정상 기능을 막을 수 있다. 모든 shield에 expiry와 owner를 두고, 만료 전에 연장 근거가 없으면 자동으로 재승인을 요구한다.

Patch 배포 뒤에는 shield를 켠 상태와 끈 상태에서 취약 fixture와 정상 regression을 모두 실행한다. Patch 자체가 exploit을 막는 것이 확인된 뒤 canary에서 shield를 제거하고 fleet으로 확대한다. 제거 후에도 취약 path가 닫혀 있고 정상 traffic과 성능이 회복됐는지 확인한다. `candidate 생성 → review → observe → approve → enforce → patch → retire`의 event를 artifact digest와 함께 보존해야 사후에 무엇이 어느 host에 있었는지 재구성할 수 있다.

Shirudo의 공개성과 서명·TPM·verifier 구조는 검토 가능한 기반을 제공한다.[1][2] 그러나 open source라는 사실은 모든 환경에서 검증됐다는 뜻이 아니며, cryptographic provenance는 semantic correctness를 대신하지 않는다. 가장 중요한 통제는 agent가 빠르게 후보를 만들더라도 실제 배포 권한과 위험 수용 결정은 별도 경계에 남기는 것이다.

## 결론: 빠른 방패일수록 만료와 회수가 선명해야 한다

AI가 생성한 runtime shield는 patch를 기다리는 위험한 시간을 줄일 수 있다. OpenAI와 Cisco의 통제된 Java4Shell 사례는 실행 중 service에 restart 없이 임시 방어를 적용하는 가능성을 보여 준다.[1] 다만 그 사례를 일반적 효과나 자체 환경의 검증으로 읽어서는 안 된다.

안전한 도입 순서는 candidate를 격리하고, 공격과 정상 fixture를 함께 실행하고, 관찰 모드에서 false positive와 overhead를 측정하고, exact artifact를 서명한 뒤 사람이 작은 canary에 승인하는 것이다. 강제 모드에는 자동 정지 조건과 검증된 rollback이 있어야 하며 정식 patch가 배포되면 shield를 제거하고 두 경로를 다시 시험한다.

결국 신뢰할 대상은 “AI가 만든 코드”라는 이름이 아니라 evidence chain이다. 어떤 source에서 어떤 object가 만들어졌고, 누가 무엇을 보고 승인했으며, 어느 host에 언제 load·remove됐고, 공격 차단과 정상성 보존을 어떤 fixture로 확인했는지가 남아야 한다. 임시 통제의 품질은 설치 속도보다 **안전하게 거부하고 되돌리고 끝낼 수 있는 능력**으로 판단해야 한다.

## Sources

[1] https://openai.com/index/introducing-shirudo/
[2] https://github.com/shirudo-dev/shirudo
[3] https://docs.shirudo.dev/start/faq.html
[4] https://docs.shirudo.dev/operate/plan/system-requirements.html
