---
title: 'Burp·Ghidra·LLDB를 연결한 에이전트 보안 연구 워크플로'
date: 2026-10-17 13:30:00 +0900
categories: ["AI 보안"]
description: '한 finding의 Burp HTTP 관찰, Ghidra 정적 구조, LLDB 런타임 값을 claim-to-evidence graph로 결합하고 충돌·미확정을 보존해 재현 가능한 보안 연구로 승격하는 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/agent-security-research-burp-ghidra-lldb/1600/900'
tags: [burp-suite, ghidra, lldb, security-research, ai-agent, evidence-graph, mcp]
---

![Burp HTTP 증거와 Ghidra 정적 구조, LLDB 런타임 값을 결합하는 보안 연구 워크플로](https://picsum.photos/seed/agent-security-research-burp-ghidra-lldb/1600/900)

보안 연구 도구를 에이전트에 많이 연결한다고 finding의 신뢰도가 저절로 올라가지는 않는다. Burp에서 수상한 응답을 봤고, Ghidra의 decompiler가 그럴듯한 조건문을 만들었으며, LLDB에서 예상한 값이 한 번 보였다는 세 문장은 서로 다른 질문에 답한다. 이들을 한 문단으로 합치면 근거가 강해지는 것이 아니라 관찰 범위와 추론이 섞일 수 있다.

Meta는 2026년 10월 1일 Zurp를 오픈소스로 공개하며 Burp 안에서 Meta 트래픽의 식별자·URL·GraphQL operation에 맥락을 붙이고, 요청 재생에 필요한 CSRF token을 다루는 도구라고 설명했다.[1] 함께 공개된 `Muse Code for Security Research` 가이드는 Burp, Ghidra, LLDB와 Zurp의 MCP servers를 한 terminal agent에 연결하는 예시를 보여 준다.[2] 이 구성에서 배울 점은 “에이전트가 네 도구를 쓸 수 있다”가 아니다. **동일한 finding을 HTTP 관찰 → 정적 구조 → 런타임 값 → 통제된 재현으로 좁혀 가는 증거 사슬을 만들 수 있다**는 점이다.

이 글은 그 사슬 하나에만 집중한다. MCP의 일반 개념과 인증·호출 시점 권한은 [MCP Runtime Governance 글]({% post_url 2026-09-25-mcp-runtime-governance-identity-authorization-audit %})로, 범용 sandbox와 effect 경계는 [에이전트 샌드박스 4계층 글]({% post_url 2026-10-11-agent-sandbox-four-layer-boundary %})로 넘긴다. 여기서는 승인된 연구용 lab, 조직이 소유한 test environment, 또는 명시적인 bug bounty scope 안의 자산만 다룬다. 실제 사용자 데이터, 범위 밖 호스트, production process를 대상으로 삼는 절차는 포함하지 않는다.

## 연결 단위는 도구가 아니라 하나의 claim이다

예제로 쓸 finding은 의도적으로 단순화한 **격리된 lab의 교차 계정 metadata 노출 후보**다. 연구자는 사전에 만든 Actor A와 Object B를 사용한다. B의 비공개 필드에는 실제 개인정보 대신 lab 전용 canary 값을 넣는다. 목표는 “A가 B를 조회하면 비공개 필드가 보인다”는 한 문장을 검증하는 것이다.

이 문장을 바로 `confirmed`로 두지 않고 네 개의 하위 claim으로 나눈다.

1. **HTTP claim:** Actor A의 인증 상태로 Object B를 요청했을 때 응답 body에 B의 canary가 포함됐다.
2. **Static claim:** 조사 중인 binary build에서 해당 route와 연결된 handler, authorization 판단, serializer 사이의 가능한 control-flow가 존재한다.
3. **Runtime claim:** 재현 실행에서 실제 `actor_id=A`, `owner_id=B`, authorization 결과와 serializer 진입 값이 관찰됐다.
4. **Reproduction claim:** 새 session과 초기화된 fixture에서도 양성 사례가 반복되고, 소유자 조회 같은 양성 baseline과 존재하지 않는 객체의 음성 대조군이 예상대로 동작했다.

각 도구는 이 중 일부만 지지한다. Burp는 wire에서 오간 byte를 보여 주지만 어느 내부 함수가 원인인지는 증명하지 않는다. Ghidra는 binary의 가능한 구조를 보여 주지만 그 경로가 재현 시점에 실행됐는지는 말하지 않는다. LLDB는 특정 실행의 값을 보여 주지만 그 한 번이 HTTP 계층의 지속 가능한 영향이나 다른 build의 동작까지 증명하지 않는다. 마지막 재현은 관찰의 반복성을 높이지만 root cause를 혼자 확정하지 않는다.

Meta의 공개 저장소를 사용할 때도 경계가 있다. 이 글에서 검토한 Zurp source는 `facebookincubator/Zurp`의 commit `b1552f20e83ada58fc9bcb8c305f92baa62250ec`로 고정한다. 해당 README는 Burp extension과 별도의 `meta-context`, `fbdl`, `sparta` stdio server, allowlist로 제한되는 token 접근을 설명한다.[3] Meta Context·FBDL·SPARTA API는 gated capability지만, CSRF refresh·substitution은 로컬 Burp 기능이며 이에 대응하는 agent-side MCP server는 없다. 따라서 공개 client code를 읽을 수 있다는 사실과 Meta 측 gated capability를 사용할 권한이 있다는 사실은 다르다. 이 글의 lab 설계는 특정 gated endpoint에 접근할 수 있다고 가정하지 않는다.

## Claim-to-evidence graph를 먼저 만든다

에이전트의 대화 기록을 증거 ledger로 쓰면 안 된다. 요약이 다시 요약되면서 “보였다”가 “원인이다”로 바뀌고, 서로 다른 build나 session의 관찰이 합쳐지기 쉽다. Finding마다 다음과 같은 graph를 별도 구조체로 둔다. 아래 schema는 Meta, PortSwigger, Ghidra 또는 LLDB의 표준이 아니라 이 글의 운영 제안이다.

상태 공간을 섞지 않는다. Claim의 증거 상태는 `candidate | observed | corroborated | reproduced | conflicted`, finding lifecycle은 `triage | evidence_collection | reproduction_pending | human_review | closed`다. Run은 결과 `positive | negative | invalid | inconclusive`와 현재 claim에 대한 적용성 `applies | other_build | unknown_conditions`을 별도 필드로 기록한다. `positive`와 `negative`는 유효한 실행에서 각각 현상 관찰과 미관찰, `invalid`는 reset·scope·control 실패, `inconclusive`는 관찰 부족을 뜻한다. 다른 build의 유효한 미관찰은 `outcome=negative`, `applicability=other_build`다. 같은 condition fingerprint에서 `applies`인 유효한 양성·음성 run만 서로 충돌한다.

Claim 승격도 유형별로 고정한다. 공통적으로 `candidate`는 gate를 만족한 직접 증거가 없음, `observed`는 적용 가능한 직접 증거 1개, `corroborated`는 독립 tool 또는 reset session의 두 번째 증거가 있음, `conflicted`는 같은 조건의 유효한 반증이 있음을 뜻한다. `reproduced`는 다음 조건까지 요구한다.

- C1 HTTP 현상: 초기화된 두 session에서 양성이 반복되고 양성 baseline·음성 control이 모두 정상
- C2 정적 경로: fresh static analysis에서 H→G→S mapping이 반복되고, 같은 binary의 runtime이 해당 경로를 관찰
- C3 runtime 경로: 초기화된 두 session에서 같은 correlation·module 조건으로 값과 stack이 반복
- C4 재현성: fresh environment snapshot에서도 C1–C3와 baseline·control이 함께 반복

```yaml
finding_id: F-017
title: cross-account metadata exposure in authorized lab
lifecycle: reproduction_pending
scope:
  lab_id: LAB-42
  target: service-fixture-07
  expires_at: 2026-10-17T18:00:00+09:00
claims:
  - id: C1
    text: actor A received object B's private canary field
    status: corroborated
    supported_by: [E-HTTP-01, E-HTTP-02]
    contradicted_by: []
  - id: C2
    text: handler H can reach serializer S after authorization branch G
    status: observed
    supported_by: [E-STATIC-01, E-STATIC-02]
    contradicted_by: []
  - id: C3
    text: the reproduction executed H with actor=A and owner=B, then entered S
    status: corroborated
    supported_by: [E-RUNTIME-01, E-RUNTIME-02]
    contradicted_by: []
  - id: C4
    text: the behavior repeats from a reset fixture with valid controls
    status: observed
    supported_by: [E-REPRO-01]
    contradicted_by: []
unknowns:
  - cache involvement has not been excluded
  - behavior on other builds and architectures is untested
  - minimal triggering condition is not yet isolated
artifacts:
  - id: E-HTTP-01
    tool: burp
    run_id: R1
    session_id: <http-session-r1>
    sha256: <request-response-bundle-hash>
    actor_label: A
    object_label: B-private
    control_refs: [E-HTTP-CTRL-01]
    captured_at: <timestamp>
  - id: E-HTTP-02
    tool: burp
    run_id: R3
    session_id: <http-session-r3>
    sha256: <second-request-response-bundle-hash>
    actor_label: A
    object_label: B-private
    control_refs: [E-HTTP-CTRL-01]
    captured_at: <timestamp>
  - id: E-HTTP-CTRL-01
    tool: burp
    includes: [B-reads-B-private, A-reads-A-private, A-reads-nonexistent]
    sha256: <baseline-and-control-bundle-hash>
  - id: E-STATIC-01
    tool: ghidra
    binary_sha256: <binary-hash>
    address_space: <image-base-and-symbol-map>
    inference_status: inferred
  - id: E-STATIC-02
    tool: ghidra
    binary_sha256: <same-binary-hash>
    relation: <handler-guard-serializer-map>
    inference_status: inferred
  - id: E-RUNTIME-01
    tool: lldb
    run_id: R1
    binary_sha256: <same-binary-hash>
    session_id: <debug-session-r1>
    fixture_snapshot: <snapshot-id>
    correlation_id: <lab-correlation-id>
    actor: A
    owner: B
    authorization_result: allow
    serializer_entered: true
    stack_hash: <minimal-stack-hash>
  - id: E-RUNTIME-02
    tool: lldb
    run_id: R3
    binary_sha256: <same-binary-hash>
    session_id: <debug-session-r3>
    fixture_snapshot: <reset-snapshot-id>
    correlation_id: <second-lab-correlation-id>
    actor: A
    owner: B
    authorization_result: allow
    serializer_entered: true
    stack_hash: <second-minimal-stack-hash>
  - id: E-REPRO-01
    tool: harness
    fixture_snapshot: <reset-snapshot-id>
    reset_verified: true
    baseline_and_control: E-HTTP-CTRL-01
    runs: [R3]
```

`supported_by`만 두지 않는 것이 중요하다. `contradicted_by`, `unknowns`, `binary_sha256`, session과 capture 시각이 있어야 에이전트가 불편한 관찰을 버리지 못한다. 또한 edge의 방향은 **evidence가 claim을 지지한다**이지, “도구가 finding을 확정했다”가 아니다.

Claim의 정상 전이는 `candidate → observed → corroborated → reproduced`다. `invalid`, `inconclusive`, 또는 `applicability != applies`인 run은 현재 claim 상태를 바꾸지 않는다. 같은 condition fingerprint에서 적용 가능한 유효한 `positive`와 `negative`가 충돌할 때만 관련 claim을 `conflicted`로 만든다. 필수 claim C1–C4가 위 유형별 `reproduced` 조건을 모두 만족하고 미해결 모순이 없을 때 lifecycle을 `human_review`로 옮긴다. 최종 scope·영향·중복·공개 가능성은 연구자가 판정한다.

## 1단계: Burp는 HTTP 사실만 고정한다

첫 단계의 산출물은 “취약하다”는 자연어 결론이 아니라 request·response bundle이다. Burp 쪽 MCP extension은 HTTP/1.1·HTTP/2 요청 전송, proxy history 조회, Repeater·Intruder 연계와 configurable target approval을 제공한다고 설명한다.[4] 하지만 이 기능 목록은 모든 요청을 자동 승인하라는 뜻이 아니다. 조사 시작 시 기본 tool surface는 proxy history와 이미 캡처된 message 읽기로 제한한다.

Lab의 첫 관찰에서는 다음을 함께 고정한다.

- Burp project와 lab fixture ID
- 요청한 host, method, route의 정규화 값
- Actor A를 가리키는 익명화된 session label
- Object B를 가리키는 fixture label
- status, relevant response header, body의 canary field
- request와 response 원문 hash, 캡처 시각
- 같은 session의 직전·직후 요청 가운데 cache나 redirect 해석에 필요한 항목

Cookie나 token 원문은 finding graph에 복사하지 않는다. Burp project의 보호된 원본을 참조하는 handle과 비밀이 제거된 증거 사본을 분리한다. 에이전트에는 “응답에 canary가 있다”는 최소 사실만 넘기고, 자연어 요약에서 빠진 header와 body byte는 원본 bundle로 되돌아가 확인할 수 있게 한다.

양성 한 건만 저장하면 cache hit, 잘못 붙은 session, fixture 오염을 놓친다. 같은 Object B를 소유자인 Actor B가 읽는 baseline, 존재하지 않는 object의 응답, Actor A가 소유한 Object A의 응답을 함께 묶는다. 이 단계에서 안전하게 말할 수 있는 결론은 다음 정도다.

> E-HTTP-01에서 Actor A label의 요청에 Object B canary가 포함된 응답이 관찰됐다. 서버 내부 authorization 결과와 원인은 아직 미확정이다.

연습 대상도 임의의 외부 사이트가 아니라 의도적으로 취약하게 만든 lab을 써야 한다. PortSwigger Web Security Academy는 SQL injection, access control, GraphQL API, race condition 등 주제별 lab 목록을 제공한다.[5] 이 글의 synthetic fixture도 같은 원칙으로 별도 계정·canary·초기화 절차가 있는 폐쇄형 환경에서만 운용한다.

## 2단계: Ghidra는 가능한 구조를 좁힌다

다음에는 “왜 이런 응답이 나왔는가”보다 질문을 더 좁힌다.

> 캡처한 route와 response field를 처리할 가능성이 있는 함수, 호출 관계, 조건 분기는 이 binary 어디에 있는가?

이 글에서 참조하는 `clearbluejar/pyghidra-mcp` commit은 `42d8f80551a765441b1a723f6f1ff45aa3914d5e`다. 이 프로젝트는 Ghidra API를 Python과 MCP로 노출하고, decompile, cross-reference, byte, call graph, symbol·string 검색뿐 아니라 rename·type·prototype·comment 변경과 project operation도 제공한다.[6] **이는 `clearbluejar`가 운영하는 제3자 프로젝트이며 Ghidra의 공식 구성 요소가 아니다.** 편리한 연결 adapter와 분석기 자체의 신뢰 경계를 구분해야 한다.

정적 분석에서는 캡처한 route literal과 canary field의 JSON key를 seed로 삼되, “문자열이 같은 함수에 있다”를 원인으로 승격하지 않는다. 다음 순서로 구조를 좁힌다.

1. Route 또는 field string의 reference를 찾는다.
2. 참조 함수의 caller·callee와 serializer 호출을 기록한다.
3. Actor identity, owner identity, authorization result로 보이는 값이 어느 parameter와 branch를 지나는지 가설을 만든다.
4. 함수 주소만 저장하지 말고 binary hash, image base, symbol·function fingerprint를 함께 저장한다.
5. Decompiler가 복원한 type과 변수 이름은 `inferred`로 표시한다.

이 단계의 증거는 “handler H에서 guard G를 거쳐 serializer S로 갈 수 있는 control-flow가 보인다”까지다. Decompiler output에 `if (allowed)`처럼 읽기 좋은 문장이 있어도 실제 변수 의미, compiler optimization, indirect call, 예외 경로는 아직 미확정이다. 반대로 apparent deny branch가 보여도 HTTP 관찰을 폐기해서는 안 된다. 다른 handler, cache, stale binary 또는 잘못된 symbol mapping일 수 있다.

기본 profile은 read-only로 둔다. `search`, `decompile`, `xrefs`, `bytes`, `callgraph`만 허용하고 rename, comment, type 변경, binary import·delete 같은 mutation tool은 닫는다. 이름을 붙일 필요가 있다면 원본 project가 아니라 hash가 고정된 분석용 복제본에서 수행하고, 변경 전후 snapshot을 evidence와 분리한다. 이 제한은 일반 MCP 보안론을 반복하려는 것이 아니라 **정적 관찰과 분석자가 만든 annotation을 섞지 않기 위한 provenance 규칙**이다.

## 3단계: LLDB는 그 실행의 값을 확인한다

Ghidra가 만든 것은 실행 가설이다. LLDB 단계에서는 그 가설을 가장 적은 관찰점으로 시험한다.

이 글에서 참조하는 `stass/lldb-mcp` commit은 `a610f2d0d3835739c41762352442ba2a13958b38`다. README는 session·breakpoint·watchpoint 관리, 실행 제어, memory·register·variable 검사, stack trace와 thread inspection을 제공한다고 설명하며 arbitrary LLDB command 기능도 열어 둔다.[7] **이 저장소 역시 `stass`가 운영하는 제3자 프로젝트이며 LLVM/LLDB의 공식 구성 요소가 아니다.** 특히 arbitrary command와 process control은 읽기 전용 interface로 볼 수 없다.

따라서 기본값은 production attach가 아니다. 가장 안전한 순서는 core dump 같은 사후 artifact, 전용 lab child process, 격리된 snapshot 순이다. 이 예제에서는 HTTP fixture와 같은 binary hash를 가진 lab process를 새로 시작하고, Ghidra가 제시한 handler entry와 authorization 결과 직후, serializer 직전의 세 지점만 관찰 후보로 둔다. Breakpoint 자체가 timing과 process 상태를 바꿀 수 있다는 사실도 evidence metadata에 남긴다.

LLDB에서 필요한 값은 무차별 memory dump가 아니다.

- 현재 binary와 module UUID가 Ghidra 분석본과 같은가
- 해당 request를 구분하는 lab correlation ID가 맞는가
- Handler 진입 시 actor와 object fixture label이 예상과 같은가
- Authorization 결과가 무엇이며 어느 branch로 이동했는가
- Serializer 직전의 object와 field mask가 무엇인가
- Stack trace가 Ghidra의 예상 caller·callee와 일치하는가

민감한 실제 값 대신 fixture label과 canary만 기록한다. Raw memory에는 unrelated secret이 섞일 수 있으므로 필요한 expression과 frame만 수집하고, dump 전체를 대화 context에 올리지 않는다. 관찰한 address는 ASLR 때문에 단독으로 재사용하지 말고 module UUID, load address, symbol offset과 함께 저장한다.

별도의 유효한 run에서 모순이 나올 수도 있다. 첫 실행에서는 `allowed=true`와 serializer 진입을 봤지만, 같은 build·초기화 조건의 새 session에서는 guard가 deny를 반환했다고 하자. 에이전트는 두 번째 실행을 “불안정한 노이즈”로 삭제하면 안 된다. Condition fingerprint가 같으면 `outcome=negative`, `applicability=applies`로 기록하고 C3를 `conflicted`로 옮긴다. 다른 build라면 `applicability=other_build`, reset 여부를 증명하지 못했다면 `applicability=unknown_conditions`로 두어 현재 claim을 바꾸지 않는다.

## 4단계: 재현은 네 계층의 참조를 다시 묶는다

재현 문서는 공격 스크립트가 아니라 lab 상태와 증거 참조를 다시 만드는 recipe다. 외부 host나 실제 계정에 그대로 적용할 수 있는 payload를 쓰지 않는다. 다음 항목이면 충분하다.

```text
precondition:
  authorized lab LAB-42, fixture snapshot v3
  binary sha256 and module UUID fixed
actors:
  A = non-owner test identity
  B = owner test identity
object:
  B-private = synthetic object with unique canary
positive observation:
  A requests B-private; record E-HTTP-01/02, E-STATIC-01/02 and E-RUNTIME-01/02
positive baselines:
  B requests B-private
  A requests A-private
negative control:
  A requests a nonexistent fixture
reset:
  restore database, session store, cache and process snapshot
success criterion:
  C1, C2, C3 and C4 are reproduced without unresolved contradiction
  and finding lifecycle advances to human_review
stop condition:
  scope mismatch, real user data, unknown build, or unapproved network dispatch
```

재현하려면 똑같은 HTTP request를 여러 번 보내는 데 그치지 않고 `HTTP bundle ↔ binary hash ↔ debugger session ↔ fixture snapshot`의 연결을 반복해야 한다. 새 build에서 같은 body가 나왔다면 기존 static·runtime evidence를 재사용하지 않는다. 같은 binary라도 fixture reset이 안 됐다면 독립 재현으로 세지 않는다.

결과표도 성공 횟수 하나로 압축하지 않는다.

| Run | Claim evidence | HTTP canary | Static mapping | Runtime values | Control result | Outcome | Applicability | Claim 갱신 |
|---|---|---|---|---|---|---|---|---|
| R1 | E-HTTP-01, E-STATIC-01/02, E-RUNTIME-01 | 관찰 | H→G→S 가능 | A/B, allow, S 진입 | 정상 | `positive` | `applies` | C1·C2·C3 `observed` |
| R2 | 없음 | 관찰 | 동일 hash | A/B, deny, S 미진입 | cache 미초기화 | `invalid` | `unknown_conditions` | 승격 없음, reset 후 재실행 |
| R3 | E-HTTP-02, E-RUNTIME-02, E-REPRO-01 | 관찰 | 동일 hash | A/B, allow, S 진입 | 정상 | `positive` | `applies` | C1·C3 `corroborated`, C4 `observed` |
| R4 | 별도 수정 후보 finding | 미관찰 | 수정 후보 build | A/B, deny | 정상 | `negative` | `other_build` | 현재 claim은 유지, 수정 후보 가설 추가 |

R2는 claim 판정에서는 제외하지만 reset 절차의 결함을 보여 주는 운영 증거로 남긴다. R4도 “수정 완료”를 뜻하지 않는다. 다른 build의 단일 미관찰 결과이므로 기존 build의 claim과 직접 충돌하지 않으며, 수정 후보에 대한 별도 finding에서 반복 검증해야 한다. 위 graph는 R1–R4까지 기록한 시점의 snapshot이다.

## 충돌을 해소하는 순서

도구 간 결과가 맞지 않을 때 모델에게 “가장 가능성 높은 설명을 골라라”고 시키면 그럴듯한 서사가 먼저 만들어진다. 대신 충돌 유형별로 다음 검사를 수행한다.

### Burp는 노출을 보지만 LLDB가 handler를 보지 못한다

우선 CDN·reverse proxy·cache, 다른 backend instance, redirect와 retry를 확인한다. HTTP capture의 correlation ID가 debug process log와 연결되는지 본다. 연결되지 않으면 두 증거는 같은 실행을 설명하지 않는다. Finding은 유지하되 root cause claim을 보류한다.

### Ghidra에는 deny branch가 있지만 LLDB에서는 allow가 나온다

Decompiler가 추론한 변수 의미, optimized branch, indirect call target, feature flag와 build hash를 다시 확인한다. Static evidence의 “deny가 실행된다”를 “deny 경로가 존재한다”로 낮춘다. LLDB 값도 expression evaluation이 process state를 바꿨는지 점검한다.

### LLDB 값은 맞지만 Burp response에 canary가 없다

다른 serializer, response filter, field mask, error handling 또는 중간 cache가 결과를 바꿨을 수 있다. Runtime claim과 외부 영향 claim을 분리한다. 내부에서 private object를 읽었다는 사실만으로 wire-level disclosure를 확정하지 않는다.

### 재현은 되지만 최소 조건을 모른다

영향은 재현됐어도 원인과 범위가 미확정인 상태다. `confirmed root cause` 대신 `reproduced behavior; minimal condition unknown`으로 기록한다. 계정 역할, object 상태, cache, flag를 한 번에 여러 개 바꾸지 말고 lab fixture에서 하나씩 분리한다.

모든 경우에 unknown을 빈칸으로 두지 않는다. `not tested`, `not observable`, `conflicted`, `out of scope`를 구분한다. 특히 “증거 없음”을 “안전함”으로 바꾸지 않는다.

## 세 도구의 변경 권한만 따로 묶는다

일반 identity·sandbox 체계는 앞서 링크한 글에 맡기고, 이 workflow에서는 증거 provenance를 바꾸는 세 도구의 차이만 고정한다.

- **Burp:** history·message read 허용, 새 network dispatch는 기본 거부
- **Ghidra:** search·decompile·xref 허용, project·annotation mutation 기본 거부
- **LLDB:** artifact inspection 우선, process start·attach·continue·arbitrary command 기본 거부

Burp dispatch는 승인된 lab host, Ghidra mutation은 고정 binary의 분석 복제본, LLDB attach·continue는 승인된 process와 module UUID에 각각 결박한다. 이 세 효과 호출은 같은 binary hash와 만료되지 않은 연구 scope를 확인한 뒤에만 연다. 일반 OS containment와 credential 처리는 앞서 링크한 sandbox 글을 적용한다.

## Finding 승격 gate

보고서에 올릴 finding은 도구 수가 아니라 claim의 완결성으로 판정한다. 다음 gate는 제품 기능이 아니라 운영 제안이다.

| Gate | 통과 조건 | 실패 시 처리 |
|---|---|---|
| Scope | Lab·target·actor·artifact가 모두 승인 범위와 일치 | 승격 거부·사람 검토 |
| HTTP | 원문 request·response와 hash, actor/object label, 대조군 존재 | 관련 claim의 최대 상태를 `candidate`로 제한 |
| Static | 동일 binary hash에서 handler·guard·serializer 관계와 추론 표시 | C2의 최대 상태를 `candidate`로 제한 |
| Runtime | 같은 build·fixture 실행의 값, stack, correlation ID 존재 | C3의 최대 상태를 `candidate`로 제한 |
| Conflict | 반증 evidence가 graph에 남고 설명 또는 분리 실험이 있음 | `conflicted`가 다른 상태보다 우선하며 lifecycle 승격 중단 |
| Reproduction | Reset된 fixture와 새 session에서 양성 baseline·음성 control 수행 | C1–C4의 최대 상태를 `corroborated`로 제한 |
| Review | 사람이 영향·중복·scope·공개 가능성을 판정 | 외부 보고 금지 |

에이전트가 할 일은 각 gate에 필요한 evidence ID를 채우고 누락을 드러내는 것이다. “세 도구가 동의했으므로 high confidence” 같은 합성 점수는 피한다. Burp와 LLDB가 같은 잘못된 fixture label을 공유하거나, Ghidra와 LLDB가 같은 stale binary를 봤다면 세 증거는 독립적이지 않다. Independence도 graph의 속성으로 기록해야 한다.

## 운영에서 남겨야 할 산출물

한 finding의 최종 bundle은 길 필요가 없지만 서로 다시 연결돼야 한다.

1. **Finding summary:** 영향 문장, 승인 범위, 현재 상태와 남은 unknown
2. **HTTP bundle:** 비밀이 제거된 request·response, 원본 handle, hash와 대조군
3. **Static bundle:** binary hash, function fingerprint, xref·call graph와 inferred annotation
4. **Runtime bundle:** module UUID, breakpoint 위치, 최소 변수, stack, session·correlation ID
5. **Reproduction matrix:** fixture snapshot, reset 여부, 양성·음성 결과
6. **Conflict log:** 반증 evidence, 해소 여부, 다음 분리 실험
7. **Human verdict:** 영향, 중복, scope 준수, disclosure 또는 내부 수정 경로

보존 기간과 접근 권한도 bundle 단위로 정한다. HTTP 원본과 debugger memory는 비밀·개인정보를 포함할 수 있지만, 보고서에는 redacted artifact만 필요할 수 있다. 에이전트가 raw evidence를 장기 memory에 복사하지 않도록 원본 저장소와 대화 context를 분리한다.

## 결론: 세 도구의 합이 아니라 증거의 교차점

Meta의 Zurp 공개와 Muse 연구 가이드는 Burp, Ghidra, LLDB, agent를 하나의 조사 환경에서 연결할 수 있음을 보여 준다.[1][2] 그러나 연결 자체는 finding을 검증하지 않는다. Burp의 HTTP byte, Ghidra의 가능한 정적 경로, LLDB의 특정 실행 값은 서로 대체할 수 없는 증거다.

좋은 workflow는 한 도구의 결론을 다음 도구가 반복하게 하지 않는다. Burp로 외부 현상을 고정하고, Ghidra로 가능한 내부 구조를 좁히며, LLDB로 같은 build와 fixture의 실제 값을 확인하고, 초기화된 lab에서 양성·음성 대조군을 포함해 다시 재현한다. 그 사이의 충돌은 삭제하지 않고 claim-to-evidence graph의 반증 edge와 unknown으로 남긴다.

결국 중요한 질문은 “에이전트가 Burp·Ghidra·LLDB를 모두 호출할 수 있는가”가 아니다. **이 finding의 각 문장이 어느 원본 증거에서 왔고, 어떤 build와 session에만 유효하며, 무엇이 아직 모순되거나 알려지지 않았는가**다. 그 답을 재구성할 수 있을 때 에이전트는 판정자를 흉내 내는 자동화가 아니라, 허가된 연구 안에서 증거를 결합하는 조율자가 된다.

## Sources

[1] https://bugbounty.meta.com/blog/zurp-open-source/ — Zurp is now open source
[2] https://bugbounty.meta.com/learn/articles/muse-code-security-research/ — Muse Code for Security Research
[3] https://github.com/facebookincubator/Zurp/tree/b1552f20e83ada58fc9bcb8c305f92baa62250ec — Zurp pinned source
[4] https://portswigger.net/bappstore/9952290f04ed4f628e624d0aa9dccebc — Burp MCP Server extension
[5] https://portswigger.net/web-security/all-labs — Web Security Academy labs
[6] https://github.com/clearbluejar/pyghidra-mcp/tree/42d8f80551a765441b1a723f6f1ff45aa3914d5e — pyghidra-mcp pinned source
[7] https://github.com/stass/lldb-mcp/tree/a610f2d0d3835739c41762352442ba2a13958b38 — lldb-mcp pinned source
