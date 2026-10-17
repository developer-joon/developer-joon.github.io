---
title: 'AI 역공학의 정답 조건: 재컴파일과 동작 동등성 검증'
date: 2026-10-17 13:20:00 +0900
categories: ["AI 보안"]
description: '읽기 쉬운 의사코드를 복원 성공으로 착각하지 않기 위해 컴파일·ABI·동작·부작용·바이트 유사도·결정적 환경을 분리해 검증하는 방법.'
featured_image: 'https://picsum.photos/seed/ai-reverse-engineering-recompilation-proof/1600/900'
tags: [reverse-engineering, recompilation, binary-equivalence, behavioral-equivalence, rea, ai-security]
---

![AI 역공학의 재컴파일·동작 동등성 검증](https://picsum.photos/seed/ai-reverse-engineering-recompilation-proof/1600/900)

LLM이 만든 의사코드가 자연스럽게 읽힌다고 해서 바이너리를 복원한 것은 아니다. 함수 이름과 타입이 그럴듯해도 경계값에서 분기가 달라질 수 있고, 반환값이 같아도 파일·계정 상태나 호출 순서가 달라질 수 있다. 반대로 재컴파일한 파일의 해시가 같아도 사람이 이해할 수 있는 원래 설계를 되찾았다고 단정할 수는 없다.

OtterSec은 2026년 10월 15일 공개한 GoonFi V2 사례에서 내부 도구로 복원한 Rust 소스가 온체인 프로그램과 같은 바이너리를 만들었다고 보고했다. 그 소스를 검토해 **한 사례에서** `$6.1M`(약 610만 달러)가 위험에 놓인 치명적 취약점을 발견했고 팀에 책임 있게 알렸다고도 밝혔다.[1] 이 수치는 OtterSec이 보고한 단일 GoonFi 사례의 결과다. 다른 Solana 프로그램이나 일반 바이너리로 확대할 benchmark가 아니다.

여기서는 **어떤 증거가 쌓여야 복원 결과를 어느 수준까지 정확하다고 판정할 수 있는가**를 묻는다. 취약점 후보를 접수하고 재현해 patch·공개로 넘기는 일반 보안 파이프라인과도 범위가 다르다. 승인받은 artifact의 재구성 정확도를 판정하며, 실제 시스템을 공격하는 방법은 다루지 않는다.

## 선행 사례가 보여 준 것: 설명과 검증 사이의 간격

OtterSec의 2026년 6월 Hyperliquid 위험 엔진 분석은 바이너리, 런타임 직렬화 자료, 교차 참조와 에이전트를 결합해 복잡한 Rust 로직을 읽을 수 있는 형태로 재구성했다. 동시에 작성자는 대표 모델이 작업의 약 60%까지 도왔지만 상당한 수작업이 남았고, 도구 hook이 타입 offset과 data flow 같은 구체 속성을 확인하는 데 유용했다고 평가했다.[2] 즉, 대규모 이름 복구와 탐색은 빨라졌어도 “그럴듯함”을 자동으로 “정답”으로 바꾸지는 못했다.

GoonFi 사례는 여기서 정지 조건을 더 강하게 잡았다. 원래 toolchain과 dependency 조합을 찾고, 복원 소스를 반복해서 컴파일해 대상과의 차이를 줄였다.[1] 분석 기반에는 Solana eBPF 명령을 LLIL로 올리고, Solana 메모리 맵·ELF relocation·syscall signature를 제공하는 Binary Ninja plugin도 포함된다. 공개 저장소의 이 기능 범위는 commit `c3fe0de45d37eb68dcb08f2498c6e1f986056572`로 고정해 확인할 수 있다.[3]

여기서 배울 점은 특정 도구의 우열이 아니다. 모델 출력 뒤에 **서로 별도로 실패할 수 있는 검증 단계**를 둬야 한다. 한 단계를 통과했다고 다음 단계까지 자동으로 참이 되지 않는다.

## 검증 사다리: “읽힌다”에서 “같다고 말할 수 있다”까지

아래 사다리는 REA의 공식 점수 체계가 아니라 이 글이 제안하는 운영 gate다. 각 단계는 `pass`, `fail`, `unknown`을 구분한다. 증거가 부족한 상태를 통과로 올리지 않는다.

| 단계 | 확인 질문 | 대표 증거 | 통과해도 아직 모르는 것 |
|---|---|---|---|
| 1. 읽기 가능한 의사코드 | 제어 흐름과 데이터 의미를 사람이 검토할 수 있는가 | 함수 경계, call graph, 타입·상수 근거, assembly 대응표 | 컴파일 가능성, 실제 동작 |
| 2. 컴파일 | 고정된 source tree가 오류 없이 build되는가 | build 명령, compiler·linker 버전, lockfile, exit code | ABI 호환성, 동작 동등성 |
| 3. ABI·형식 | 외부가 관찰하는 호출 계약과 artifact 구조가 맞는가 | symbol, calling convention, layout, serialization, section·relocation 비교 | 내부 계산과 부작용 |
| 4. 기능·경계값 | 같은 입력 집합에서 같은 결과와 실패를 내는가 | 정상·경계·오류 fixture, differential test, negative control | 관찰하지 않은 입력 전체 |
| 5. 부작용 | 결과 외 상태 변화와 순서까지 같은가 | 파일·계정·로그·하위 프로세스·외부 호출의 전후 diff | 미관찰 채널, timing 전체 |
| 6. 명령·바이트 유사도 | 함수와 전체 artifact가 얼마나 가까운가 | CFG·instruction mapping, section diff, byte diff, hash | 원본 작성 의도와 원래 소스 |
| 7. 결정적 재현 | 다른 검토자가 같은 환경에서 같은 판정을 얻는가 | image digest, toolchain, flags, 경로, 환경 변수, 재실행 기록 | 다른 플랫폼·compiler로의 일반화 |

이 순서는 단순히 점수를 누적하는 방식이 아니다. 낮은 단계가 높은 단계보다 덜 중요하다는 뜻도 아니다. 바이트가 같아도 의사코드가 inline assembly 덩어리라면 유지보수 가능한 복원이 아니다. 반대로 읽기 좋은 구현이 같은 테스트를 통과해도 ABI가 달라 drop-in replacement가 되지 못할 수 있다.

### 1. 읽기 가능성은 검토의 시작점이다

의사코드에는 최소한 각 주장과 machine-level 근거를 연결할 수 있어야 한다. 함수 이름은 “복원된 symbol”, “분석가가 붙인 이름”, “추론”을 나누고, 타입도 offset·load width·호출부 중 어떤 관찰에서 왔는지 표시한다. 모순된 call site나 해석되지 않은 indirect call은 숨기지 않고 `unknown`으로 둔다.

REA 6.5.0에 고정된 README는 native 분석 결과를 pseudocode·assembly·symbol·string·관계로 설명한다. 같은 문서의 DX-Ball showcase는 3,205개 원본 x86 case와 63개 compiled function byte를 별도 축으로 검증한 사례를 제시한다.[4] 이는 원본 소스 복구나 애플리케이션 자동 복제를 보장한다는 문장이 아니라, 읽기 가능성과 실행·바이트 증거를 별도로 검토해야 한다는 프로젝트 사례다.

### 2. “컴파일된다”는 재현 가능한 build 계약이어야 한다

단발성 local build 성공은 약하다. 최소 기록은 source revision, dependency lockfile, compiler·linker와 target 버전, optimization·link flag, build script, working directory, 환경 변수와 산출물 digest다. 경로와 line number가 panic 문자열에 들어가거나 함수 배치가 source order에 좌우될 수 있으므로, container image만 고정하고 source path를 바꾸면 동일한 결과를 얻지 못할 수 있다.[1]

따라서 compile gate는 “내 노트북에서 성공”이 아니라 깨끗한 환경에서 명시된 한 명령으로 다시 만들 수 있는지를 본다. 네트워크에서 mutable dependency를 받거나 lockfile 밖 도구를 자동 갱신한다면 결과는 아직 `unknown`이다.

### 3. ABI는 소스 모양보다 외부 계약에 가깝다

ABI gate에서는 exported symbol과 entry point, calling convention, argument·return layout, alignment와 padding, error code, serialization, section·relocation, 외부 syscall·library boundary를 비교한다. Solana 프로그램이라면 instruction data와 account layout, signer·writable 조건처럼 호출자가 의존하는 형식도 대상이다.

여기서 “함수 시그니처가 비슷하다”는 충분하지 않다. 구조체 field가 맞아 보여도 padding 하나가 달라지면 외부 입력 해석이 어긋날 수 있다. 반대로 내부 helper 이름과 분할 방식은 달라도 외부 계약은 같을 수 있다. 무엇이 public contract이고 무엇이 compiler가 만든 내부 구조인지 나눠야 한다.

### 4. 기능 동등성은 정상 입력보다 경계에서 갈린다

Differential test harness는 권위 실행물과 복원물을 같은 fixture로 실행해 반환값, 오류 종류, 출력 serialization을 비교한다. 사례는 최소한 다음 네 묶음으로 나눈다.

1. 문서화된 정상 입력과 대표 workload
2. 0, 최댓값, 정렬 경계, 비어 있는 collection 같은 경계값
3. 잘못된 tag·길이·권한·상태 조합에 대한 실패 경로
4. 서로 다른 결과가 나와야 하는 negative control

테스트를 먼저 공개 fixture에 맞춘 뒤 그 fixture만 통과하도록 코드를 조정하면 과적합을 놓친다. 평가용 holdout fixture와 property·metamorphic test를 분리하고, mismatch는 평균 점수로 덮지 않고 입력·분기·첫 divergence를 남긴다. 모든 관찰 입력이 같다는 결과는 **그 입력 집합에서의 동등성**이지 전체 입력 공간의 증명이 아니다.

### 5. 부작용은 반환값 밖에서 비교한다

동작에는 stdout 외에도 여러 변화가 포함된다. 파일 생성·삭제·권한, 계정 잔액과 storage, 로그 순서, 하위 프로세스, network request, callback, resource consumption처럼 호출자가 관찰할 수 있는 변화가 포함된다. 같은 값을 반환하면서 상태를 한 번 더 쓰거나 외부 호출 순서를 바꾸는 구현은 동등하지 않을 수 있다.

REA 6.5.0의 Process Capture 문서는 두 direct run의 terminal, interaction, exit, filesystem, process 관찰을 같은 comparison contract 아래 비교한다. 관찰이 잘리거나 residual unknown이 남으면 complete equivalence를 주장하지 않으며, filesystem snapshot은 syscall trace가 아니어서 사이에 잠깐 생겼다 사라진 변화는 놓칠 수 있다고 명시한다.[5] 또한 이 capture 자체는 sandbox가 아니다.[5] 따라서 승인된 fixture도 별도 격리 환경에서 실행하고, 관찰 도구의 범위를 보안 경계로 오해하지 않아야 한다.

### 6. instruction·byte similarity는 여러 해상도로 본다

바이트 비교는 전체 해시 하나로 끝내기보다 층별로 기록한다.

- 함수 매핑 coverage와 매핑하지 못한 영역
- CFG edge와 basic block 구조
- address를 정규화한 instruction sequence
- section별 크기·내용·relocation 차이
- 전체 artifact의 byte diff와 최종 hash

함수별 100% 일치가 전체 바이너리 일치를 뜻하지는 않는다. GoonFi 사례에서도 함수별 일치 뒤에 함수 배치, pointer·vtable, panic location 같은 요소 때문에 전체 artifact 차이가 남았고, 이를 조정한 뒤 hash-perfect recompilation에 도달했다고 OtterSec은 설명한다.[1] 따라서 함수 점수와 전체 파일 판정을 같은 숫자로 섞지 않는다.

## exact match가 강한 증거이면서도 최종 답은 아닌 이유

동일한 결정적 환경에서 `byte diff == 0`으로 확인하고 cryptographic digest까지 같다면 byte identity의 매우 강한 증거다. Digest 일치만으로 수학적인 byte identity를 증명했다고 단정하지는 않는다. 그러나 byte identity를 확인해도 다음 두 문장은 성립하지 않는다.

첫째, “복원 소스가 원래 소스다”는 결론은 나오지 않는다. 컴파일은 일대일 함수가 아니다. 서로 다른 변수명·주석·모듈 경계는 같은 binary가 될 수 있고, optimization이 서로 다른 source 표현을 같은 code로 합칠 수 있다. OtterSec 글도 같은 binary를 만드는 source 조합은 여러 개일 수 있다고 명시한다.[1] 복원한 것은 원본의 유일한 역사적 텍스트가 아니라, 고정된 compiler 아래 같은 결과를 내는 **한 후보 구현**이다.

둘째, exact match도 목표 함수에 과적합할 수 있다. 대상 instruction을 `asm!`에 그대로 넣거나, 불필요한 `no_mangle`, volatile write, `transmute`, layout 강제 같은 장치로 점수만 끌어올리면 bytes는 맞아도 의미 있는 복원은 아니다. OtterSec은 GoonFi 작업에서 이런 가능성을 “cheating”으로 다루고 비자연적 construct를 억제하며, 전체 score가 좋아지고 어떤 함수도 악화하지 않는지를 judge로 확인했다고 설명한다.[1]

그래서 exact match 옆에는 최소한 다음 심사를 둔다.

- source가 목표 bytes를 직접 복사·주입하지 않는가
- 저수준 construct마다 ABI·성능·메모리 안전상 필요한 이유가 있는가
- library code를 자체 구현해 점수를 부풀리지 않았는가
- holdout 동작 fixture에서도 같은 결과와 부작용을 내는가
- 사람이 domain invariant와 failure path를 설명할 수 있는가

정답 조건은 `hash == target` 하나가 아니라 **바이트 동일성 + 의미 검토 + 과적합 방지 + 재현 가능한 환경**의 결합이다.

## 실행 가능한 판정 기록

최종 보고서는 “복원 성공” 한 줄 대신 축별 판정을 남긴다.

```text
artifact_id / target_digest / reconstruction_revision
toolchain + dependency lock + build environment digest
pseudocode_coverage: pass|fail|unknown + residual unknowns
compile: pass|fail|unknown + command + artifact digest
abi: pass|fail|unknown + checked surfaces
functional: pass|fail|unknown + fixture/holdout coverage
side_effects: pass|fail|unknown + observed channels
instruction_similarity: metric + unmatched regions
byte_identity: pass|fail|unknown + normalization rules
overfit_review: pass|fail|unknown + prohibited/justified constructs
reviewer / authorization / evidence locations
```

`unknown`은 실패를 숨기는 값이 아니라 주장 범위를 지키는 값이다. 예를 들어 반환값과 선택한 파일 snapshot이 같아도 network와 short-lived process를 관찰하지 않았다면, 확인한 채널만 일치했다고 써야 한다. 다른 architecture·compiler·최적화 수준으로의 일반화도 별도 실험 없이는 주장하지 않는다.

## 방어적·법적 경계

이 절차는 소유하거나 명시적으로 분석 권한을 받은 artifact, 공개 연구 fixture, 상호운용성과 보존 목적의 허용된 대상에만 적용한다. 상용 분석 도구와 대상 소프트웨어의 라이선스, 접근 통제, 영업비밀, 지역별 역공학 예외를 사전에 검토한다. 실제 자산을 겨냥한 공격, credential 사용, 자금 이동, 무단 network interaction은 검증 범위에서 제외한다.

발견한 취약점은 최소 증거와 영향 경계만 보존해 비공개 신고하고, 공개 시점과 세부 수준은 owner와 조정한다. 이 글의 GoonFi 수치와 exact-binary 결과도 OtterSec의 단일 보고 사례로만 취급한다.[1] 재현되지 않은 영향이나 다른 프로그램의 위험을 추정해 덧붙이지 않는다.

## 결론

AI 역공학의 성공 기준을 “설명이 자연스럽다”에 두면 가장 검증하기 어려운 출력이 가장 완성돼 보이는 역설이 생긴다. 반대로 hash 하나만 목표로 두면 의미를 버린 채 bytes에 맞춘 구현을 정답으로 받아들일 수 있다.

실용적인 정답 조건은 사다리다. 의사코드의 근거를 읽고, 고정 환경에서 컴파일하고, ABI와 정상·경계·오류 동작을 비교하고, 반환값 밖의 부작용을 관찰하고, instruction과 bytes를 별도 해상도로 대조한다. 마지막으로 exact match가 직접 byte 주입이나 fixture 과적합이 아닌지 심사한다.

이 과정을 통과해도 표현은 신중해야 한다. “원래 소스를 복구했다”가 아니라 “명시한 환경과 관찰 범위에서 ABI·동작·부작용을 검증했고, 이 toolchain에서 byte-identical artifact를 재현했다”라고 말한다. AI 역공학의 진전은 더 자신 있게 답하는 모델보다, 틀렸을 때 어느 층에서 왜 틀렸는지를 재현 가능한 증거로 보여 주는 체계에서 나온다.

## Sources

[1] https://osec.io/blog/goonfi-decompilation/ — Breaking open a propAMM
[2] https://osec.io/blog/hyperliquid-risk-engine/ — Auto reverse-engineering the Hyperliquid risk engine, with some agentic help
[3] https://github.com/otter-sec/bn-ebpf-solana/tree/c3fe0de45d37eb68dcb08f2498c6e1f986056572 — otter-sec/bn-ebpf-solana at c3fe0de45d37eb68dcb08f2498c6e1f986056572
[4] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/README.md — REA README at rea-agents-6.5.0
[5] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/process-capture.md — REA Process Capture at rea-agents-6.5.0
