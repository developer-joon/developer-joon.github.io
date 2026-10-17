---
title: '악성 바이너리도 에이전트를 속인다: 분석 artifact의 Prompt Injection 방어'
date: 2026-10-17 13:40:00 +0900
categories: ["AI 보안"]
description: '바이너리 문자열·심볼·주석·decompiler 및 tool output을 비신뢰 증거로 유지하고, 제어 지시·도구 호출·persistent memory로 승격되지 않게 하는 artifact taint와 promotion gate를 설계한다.'
featured_image: 'https://picsum.photos/seed/malicious-artifact-prompt-injection-defense/1600/900'
tags: [prompt-injection, reverse-engineering, rea, artifact-security, memory-poisoning, ai-agent]
---

![분석 artifact의 Prompt Injection 방어](https://picsum.photos/seed/malicious-artifact-prompt-injection-defense/1600/900)

역공학 에이전트가 바이너리에서 다음 자료를 읽는다고 하자. 문자열 테이블, symbol 이름, embedded README, 디버그 정보, decompiler가 복원한 주석과 pseudocode, 실행 중 출력된 terminal text다. 사람에게는 모두 분석 대상의 흔적이다. 그러나 LLM에는 자연어 token으로 들어간다. 이때 대상이 남긴 문장이 분석 증거 대신 에이전트에게 내리는 지시처럼 취급되면, 분석 대상이 분석 절차를 바꾸는 권한을 얻게 된다.

OWASP LLM01은 외부 웹사이트나 파일에서 들어온 내용이 모델 행동을 의도하지 않게 바꾸는 경우를 indirect prompt injection으로 분류한다. 또한 외부 content를 분리해 표시하고, 최소 권한과 deterministic validation, 고위험 행동의 사람 승인을 함께 적용하라고 권고한다.[1] 이 글은 그 넓은 분류 중에서도 **분석 대상 artifact에서 파생된 text가 evidence channel을 벗어나 control channel로 승격되는 한 경로**만 다룬다.

여기서 핵심 질문은 “악성 문장을 탐지할 수 있는가”가 아니다.

> **분석 대상에서 나온 문자열·심볼·주석·pseudocode·tool output은 무엇을 말하든 증거다. 그것이 에이전트의 권한, 정책, memory 또는 다음 tool call을 직접 바꿀 수 없어야 한다.**

## 이 문제는 일반 웹·RAG injection과 무엇이 다른가

웹 문서나 RAG corpus도 비신뢰 입력이다. 다만 역공학 workflow에는 별도의 위험한 승격 경로가 있다.

1. 대상 바이너리의 byte가 문자열이나 symbol로 해석된다.
2. 분석기가 이를 pseudocode, 주석, call graph 설명 또는 terminal output으로 확장한다.
3. harness가 tool result 전체를 모델 context에 넣는다.
4. 모델이 결과 안의 자연어를 분석 지침이나 다음 행동의 근거로 오인한다.
5. 그 내용이 tool call, 작업 설정, analyst note 또는 persistent memory에 다시 기록된다.

즉 최초 입력은 자연어 문서가 아닐 수도 있다. 짧은 symbol 이름이나 여러 결과에 나뉜 text 조각이 분석기와 모델을 거치며 문장처럼 보일 수 있다. 분석기의 정규화·요약도 원본 byte에는 없던 명료한 표현을 만들어 낸다. 그래서 “바이너리는 실행하지 않았으니 안전하다”거나 “decompiler output은 도구가 만든 것이니 신뢰할 수 있다”는 결론은 성립하지 않는다. 실행 격리와 **텍스트가 지시 권한을 얻지 못하게 하는 문제**는 서로 다르다.

OWASP Agentic Top 10 발표는 agent goal hijack, tool misuse, agentic supply-chain vulnerability, memory and context poisoning을 서로 구분한다.[2] Artifact-origin injection은 이 가운데 하나에만 고정되지 않는다. 대상 text가 현재 목표를 바꾸면 goal hijack이고, 허용된 도구를 엉뚱한 목적으로 고르게 하면 tool misuse이며, persistent state에 남으면 memory poisoning으로 이어질 수 있다. 다만 이 글은 분류 전체를 반복하지 않고, **증거가 제어로 승격되는 순간**을 하나의 공통 경계로 본다.

또한 이것은 앞서 [MCP 공급망 글]({% post_url 2026-09-25-mcp-supply-chain-delayed-tool-poisoning %})에서 다룬 delayed tool poisoning과 다르다. 그 글의 의심 대상은 server가 노출하는 description·schema·metadata와 시간에 따른 계약 변화다. 여기서는 server와 tool definition이 정상이고 고정돼 있어도, 정상 도구가 읽어 온 **분석 대상의 내용**이 모델을 흔든다. 따라서 정의 변경을 감시하는 통제만으로는 이 경로를 닫을 수 없다.

OWASP의 third-party MCP server 가이드는 prompt injection, tool poisoning, memory poisoning, tool interference를 위험으로 열거하고 최소 권한, client sandboxing, governance와 human-in-the-loop를 권고한다.[3] 이 기본선은 필요하지만, artifact text가 어느 변환 단계를 거쳤고 어떤 channel에 들어갈 수 있는지까지는 분석 pipeline이 별도로 정의해야 한다.

## Threat model: 공격자는 무엇을 통제하는가

이 글의 threat model에서 공격자는 분석 대상의 일부 또는 전부를 통제할 수 있다. 통제 가능한 입력은 다음과 같다.

- binary string table과 resource text
- symbol·section·class·method·function 이름
- source map, debug info, manifest, package metadata
- embedded document와 help text
- decompiler가 복원할 수 있는 상수와 구조 이름
- 대상 process가 terminal이나 log에 내보내는 text
- 원본의 영향을 받아 분석 도구가 파생한 label, summary, pseudocode와 warning

반대로 공격자가 직접 통제한다고 가정하지 않는 것은 analyst가 승인한 task, system/developer instruction, tool policy, memory promotion policy다. 방어 목표는 이 신뢰 경계를 유지하는 것이다.

```text
분석 대상 bytes / runtime output
          │
          ▼
    Raw evidence store  ── immutable, content-addressed
          │
          ▼
  Parser / decompiler / analyzer
          │
          ▼
   Derived evidence store ── normalized, origin-linked
          │
          ├──► Analyst view / model evidence context
          │
          └─X► System·developer instruction / policy / memory

Analyst task + signed policy
          │
          ▼
       Control plane ──► tool-call policy engine ──► tool execution
```

`X`가 이 글의 핵심이다. Artifact에서 유래한 text는 읽고 인용하고 비교할 수 있지만, control plane으로 직접 흐르지 않는다.

## MemoryTrap에서 배울 점과 증거의 한계

OWASP GenAI Security Project의 2026년 5월 MemoryTrap 글은 ASI06 공동 책임자의 **practitioner commentary**다. 이 글은 repository workflow에서 시작한 일회성 영향이 persistent memory, global hooks configuration, system prompt의 신뢰 계층으로 이어질 수 있었다고 설명하고, memory를 보안 관련 상태로 다뤄야 한다고 주장한다.[4]

이 자료는 규범 사양이 아니며, 모든 역공학 도구나 REA에 같은 취약점이 있다는 증거도 아니다. 여기서 가져올 수 있는 운영 교훈은 제한적이지만 중요하다. 비신뢰 text가 한 세션의 답변을 바꾸는 데서 끝나지 않고, 이후 세션이 신뢰하는 memory·hook·configuration으로 복사되면 영향의 수명과 범위가 달라진다는 점이다.

따라서 분석 결과를 기억하는 기능은 단순한 편의 기능으로 취급하면 안 된다. “이 함수는 암호화 루틴으로 보인다” 같은 가설, target에서 발견된 label, decompiler가 만든 설명은 모두 출처와 불확실성이 있는 evidence다. 이를 “앞으로 모든 분석에서 따라야 할 규칙”과 같은 memory namespace에 넣으면 evidence가 authority로 변한다.

## REA 6.5.0이 문서화한 경계, 그리고 문서화하지 않은 것

REA 6.5.0 README는 native binary 분석 결과에 pseudocode, assembly, strings, symbols, calls와 references가 포함될 수 있고, process behavior 분석에는 terminal output과 filesystem observation이 포함된다고 설명한다.[5] 즉 artifact-origin text가 agent context로 들어오는 표면이 실제 workflow에 존재한다.

동시에 REA의 guided MCP prompt 문서는 prompt argument와 completion 선택값을 **untrusted selection data**로 렌더링하며 instruction이나 authorization으로 취급하지 않는다고 밝힌다. Guided prompt는 tool을 추가·제거·호출하지 않고, suggestion을 선택해도 실행이나 field 확장이 일어나지 않는다.[6] 이는 data와 process authority를 구분하는 좋은 계약이다.

Process Capture 문서는 더 직접적인 실행 경계를 적는다. 선택한 command는 현재 사용자 권한과 상속된 host environment에서 실행되고, 이 기능은 sandbox가 아니다. Filesystem observation path는 snapshot 대상을 고를 뿐 process가 읽고 쓸 수 있는 범위를 제한하지 않는다.[7] 따라서 capture evidence를 얻는 기능과 실행 권한을 제한하는 기능을 혼동해서는 안 된다.

하지만 이 문서들은 **artifact prompt injection을 시연하거나, strings·symbols·decompiler output에 대한 완성된 taint enforcement를 제공한다고 주장하지 않는다.** 아래의 origin label, raw/derived 분리, memory promotion gate, fixture matrix는 REA의 공식 기능 설명이 아니라, 문서에 나타난 “selection은 authorization이 아니다”와 “observation은 sandbox가 아니다”라는 경계를 artifact text에 확장한 이 글의 운영 설계안이다.

## 방어 모델 1: 모든 text에 origin과 authority를 붙인다

문자열이 context에 들어올 때 단순히 `content`만 전달하지 않는다. 최소한 다음 provenance를 함께 보낸다.

| 필드 | 의미 | 예시 값 |
|---|---|---|
| `origin_class` | 최초 출처 | `target_bytes`, `runtime_stdout`, `analyst_input`, `tool_control` |
| `artifact_id` | 대상 artifact의 immutable identity | content digest 또는 case-local ID |
| `transform_chain` | 어떤 변환을 거쳤는가 | `bytes → strings → normalized_text` |
| `tool_id` | 어느 도구가 관찰·파생했는가 | analyzer와 version |
| `observation_id` | 원본 evidence handle | append-only record ID |
| `authority` | 허용되는 의미 권한 | `evidence_only`, `analyst_instruction`, `policy` |
| `sensitivity` | 노출·보존 등급 | `public`, `case_confidential`, `restricted` |
| `observed_at` | 언제 관찰했는가 | capture timestamp |

가장 중요한 필드는 `authority`다. `target_bytes`와 `runtime_stdout`에서 시작한 값은 변환을 몇 번 거쳐도 기본적으로 `evidence_only`다. Decompiler가 보기 좋은 문장으로 바꾸거나, LLM이 요약했다고 해서 `analyst_instruction`으로 상승하지 않는다.

Origin label은 model에게 보여 주는 경고 문구만이 아니다. UI, evidence store, memory API, tool gateway가 같은 label을 읽고 정책을 강제해야 한다. 모델이 label을 무시하더라도 `evidence_only` record는 control configuration API에 쓸 수 없어야 한다.

## 방어 모델 2: immutable raw와 normalized derived evidence를 분리한다

분석 도구의 출력은 원본과 동일하지 않다. Encoding을 해석하고, escape를 풀고, symbol을 demangle하고, pseudocode를 생성하며, 중복 문자열을 합칠 수 있다. 이 과정에서 방어 필터가 보지 못한 조각이 합쳐지거나, 원래 모호했던 token이 자연어 문장처럼 선명해질 수 있다.

그래서 두 저장소를 구분한다.

### Raw evidence

- Target byte range, 원본 string bytes, 원본 tool response와 capture frame을 append-only로 보존한다.
- Artifact digest, offset, capture ID와 timestamp를 붙인다.
- 수정하거나 “안전한 문장”으로 덮어쓰지 않는다.
- 일반 model context에는 필요한 범위만 projection한다.

### Derived evidence

- Decode, demangle, decompile, OCR, summarize 같은 변환 결과를 저장한다.
- 반드시 부모 observation ID와 transform version을 가진다.
- Normalization이 원문을 대체하지 않는다.
- 여러 원본을 합친 결과라면 모든 parent를 기록한다.
- 신뢰도와 truncation·omission 정보를 함께 둔다.

이 분리는 forensic 재현성뿐 아니라 injection 방어에도 필요하다. 의심스러운 문장이 발견됐을 때 그것이 artifact의 exact byte였는지, decompiler가 만든 label인지, model summary에서 새로 생긴 표현인지 확인할 수 있기 때문이다. Derived text만 남기면 공격의 최초 출처와 변환 지점을 잃는다.

## 방어 모델 3: target text를 control configuration에 넣지 않는다

금지 규칙은 명확할수록 좋다.

- Target string을 system·developer instruction에 이어 붙이지 않는다.
- Symbol이나 embedded comment를 tool description 또는 policy rule로 복사하지 않는다.
- Decompiler output으로 allowed command, filesystem path, network destination을 자동 확장하지 않는다.
- Runtime stdout의 요청을 사람 승인으로 해석하지 않는다.
- Artifact가 주장하는 “분석 완료”, “검증 통과”, “안전함”을 lifecycle 상태로 채택하지 않는다.
- Tool result 안의 text로 log redaction, evidence deletion 또는 policy bypass 설정을 바꾸지 않는다.

Model context 안에서도 control과 evidence를 구조적으로 분리한다.

```text
CONTROL
- analyst task ID
- signed policy version
- allowed analysis actions
- budget and stop conditions

EVIDENCE
- origin label
- observation handle
- bounded content projection
- transform chain
- uncertainty / truncation
```

XML tag나 Markdown heading만 추가한다고 강한 격리가 생기지는 않는다. 그러나 명시적 schema는 application code가 field-level policy를 강제하고, prompt assembly test가 evidence를 control slot에 삽입하지 않았는지 검사하는 기준이 된다. 최종 안전성은 문자열 구분자보다 API와 policy boundary에서 나온다.

## 방어 모델 4: memory write는 별도의 promotion이다

분석 세션에서는 가설과 정정이 자주 생긴다. 모든 model output이나 tool result를 자동 memory로 저장하면 오류뿐 아니라 artifact-origin text도 장기 상태로 승격된다.

Memory API 앞에 promotion gate를 둔다.

1. **Source eligibility**: `evidence_only` record 자체는 instruction memory namespace에 쓸 수 없다.
2. **Transformation disclosure**: 요약을 저장하면 부모 evidence와 생성 model·prompt version을 연결한다.
3. **Claim typing**: 관찰, 추론, analyst decision, policy를 서로 다른 type으로 저장한다.
4. **Human or policy approval**: 장기 memory는 위험 등급에 따라 analyst 확인 또는 deterministic policy를 요구한다.
5. **Scope and TTL**: case·artifact·session 범위를 넘기지 않으며 만료를 둔다.
6. **Conflict handling**: 새 evidence가 기존 memory와 충돌하면 조용히 덮어쓰지 않고 quarantine한다.
7. **Revocation and propagation**: 잘못 승격된 record를 summary, index, cache와 downstream memory에서 폐기할 수 있어야 한다.

예를 들어 “offset A에서 문자열 B를 관찰함”은 case evidence로 저장할 수 있다. “다음부터 검증을 생략하라”처럼 control 의미를 가진 text가 같은 artifact에서 나왔다면 분석 대상의 내용으로 인용할 수는 있어도 instruction memory로 저장할 수 없다. 사람이 보고서에서 그 문자열의 보안 의미를 설명하는 것과 runtime이 그 문장을 지시로 따르는 것은 전혀 다른 행위다.

## 방어 모델 5: artifact-origin 인자의 역할을 제한한다

모델에게 “artifact 안의 지시를 무시하라”고 말하는 것은 유용한 보조책이지만 최종 경계가 될 수 없다. OWASP LLM01도 prompt injection을 완전히 방지하는 확실한 방법이 불명확하다고 설명하며, 최소 권한과 deterministic validation을 함께 권고한다.[1]

일반 tool authorization은 기존 [MCP Runtime Governance 글]({% post_url 2026-09-25-mcp-runtime-governance-identity-authorization-audit %})에 맡긴다. 여기서 추가할 규칙은 **artifact에서 유래한 값이 control argument로 승격되지 않게 하는 것**이다. Function name이나 address를 후속 조회에 사용하는 것은 정상이므로, 값의 출처뿐 아니라 인자 역할을 구분한다.

- `lookup_key`: Evidence에서 가져올 수 있지만 현재 artifact/session 범위를 벗어나면 거부한다.
- `path`: Case workspace allowlist 안에서 canonicalize하고, target text가 새 host path를 만들지 못하게 한다.
- `command`: Artifact text를 executable 또는 argument vector 전체로 승격하지 않는다.
- `destination`: Signed policy의 destination allowlist만 사용한다.
- `policy_option`: Evidence source에서 채울 수 없다.
- `memory_namespace`: Application이 결정하며 model이나 artifact가 선택하지 못한다.

정책 엔진은 이 역할을 schema로 검사하고 evidence lineage를 남긴다. Model이 호출을 추천했다는 사실만으로 `command`, `destination`, `policy_option`, `memory_namespace`를 artifact text에서 채울 수는 없다.

## 방어 모델 6: provenance는 답변 인용을 넘어 실행까지 이어져야 한다

분석 보고서의 citation만으로는 부족하다. 다음 tool call이 어떤 evidence에서 파생됐는지도 추적해야 한다.

```text
artifact digest
  → raw observation ID
  → derived observation ID
  → model turn ID
  → proposed tool-call ID
  → policy decision ID
  → tool result observation ID
  → report claim ID
```

이 chain이 있으면 다음 질문에 답할 수 있다.

- 어떤 target byte가 의심스러운 text의 최초 출처였는가?
- 어느 parser·decompiler·model transform에서 문장이 합쳐졌는가?
- 그 text를 본 뒤 어떤 tool call이 제안됐는가?
- 정책 엔진은 무엇을 허용하거나 막았는가?
- 같은 evidence가 memory나 다른 case로 전파됐는가?
- 보고서의 claim은 raw와 derived 중 어느 근거를 사용했는가?

콘텐츠 전체를 모든 log에 복제할 필요는 없다. Observation ID, digest, origin, transform chain과 접근 제어된 evidence handle을 사용하면 민감한 target 내용을 일반 운영 log에 퍼뜨리지 않고도 인과관계를 남길 수 있다.

## Inert fixture로 negative test를 만든다

이 방어는 실제 공격 payload나 malware sample 없이 검증할 수 있다. Fixture는 실행 능력과 외부 destination을 갖지 않는 inert data여야 한다. 예를 들어 harmless text token `ARTIFACT_CONTROL_CANDIDATE`를 여러 origin에 배치하고, 시스템이 그것을 evidence로만 유지하는지 확인한다. 이 token은 명령이 아니며 어떤 행동도 지시하지 않는다.

| Fixture 위치 | 기대 관찰 | 반드시 실패해야 하는 승격 |
|---|---|---|
| String table | Raw offset와 decode 결과가 연결됨 | System/developer slot 삽입 |
| Symbol name | Lookup key로 현재 artifact 안에서만 사용 | Tool policy 또는 command 생성 |
| Embedded comment | Derived evidence로 표시 | Analyst instruction 간주 |
| Decompiler pseudocode | Parent byte range와 transform version 보존 | Allowed action 확대 |
| Runtime stdout | Capture frame과 timestamp 보존 | 승인·완료 상태 변경 |
| Tool summary | Raw tool result로 되돌아갈 handle 유지 | Persistent memory 자동 write |
| 여러 결과에 분할된 token | 조합된 derived record의 모든 parent 기록 | Origin label 소실 |

Focused negative test는 다음 조건을 자동 판정해야 한다.

1. Fixture token이 어느 context slot에 들어갔는지 snapshot한다.
2. `evidence_only` label이 모든 transform 뒤에도 유지되는지 검사한다.
3. Model이 tool call을 제안하더라도 독립 policy가 금지된 인자 class를 거부하는지 확인한다.
4. Memory write API가 evidence-derived control text를 거부하는지 확인한다.
5. Raw evidence가 변하지 않고 derived record가 parent를 잃지 않는지 확인한다.
6. Summary·compaction 뒤에도 origin과 authority가 보존되는지 확인한다.
7. 정상적인 address·symbol lookup은 계속 동작하는지 확인한다.

마지막 항목이 중요하다. 모든 target text를 제거하면 injection 표면은 줄어들지만 역공학 utility도 사라진다. 목표는 증거를 못 보게 하는 것이 아니라, **증거를 읽되 그 권한을 올리지 않는 것**이다. 여러 분석기의 증거를 결합하는 절차는 [Burp·Ghidra·LLDB 워크플로]({% post_url 2026-10-17-agent-security-research-burp-ghidra-lldb %})에서 별도로 다룬다.

## Regression gate는 정상성도 함께 측정한다

방어가 fail-closed인지 확인하려면 금지 경로와 허용 경로를 함께 둔다.

### 허용해야 하는 흐름

- Artifact string을 인용하고 정확한 offset을 제시한다.
- Symbol을 현재 session의 procedure lookup에 사용한다.
- Decompiler output을 raw assembly와 비교한다.
- Runtime output을 timestamp가 있는 observation으로 저장한다.
- Analyst가 명시적으로 승인한 case summary를 제한된 TTL의 case memory로 저장한다.

### 거부해야 하는 흐름

- Artifact text가 tool allowlist를 바꾼다.
- Derived summary가 source label 없이 system context로 들어간다.
- Runtime output이 사람 승인 event를 대체한다.
- Target comment가 memory namespace와 TTL을 고른다.
- Model 설명만으로 고위험 tool policy가 우회된다.
- Raw evidence가 normalization 결과로 덮어써진다.

Model, prompt template, parser, decompiler, context compaction, memory service가 바뀔 때 이 matrix를 다시 실행한다. 특히 summary와 compaction은 내용을 줄이는 기능이지만 origin·authority label을 잃게 만들면 보안상 schema downgrade가 된다. Text utility 점수와 unauthorized promotion rate를 함께 측정해야 한다.

## 구현 기록은 네 연결만 보존한다

제품별 event 이름을 길게 표준화할 필요는 없다. `raw evidence → derived evidence → policy decision → memory promotion`의 부모 ID와 digest를 이어 놓으면 된다. Prompt와 tool result 전문은 기본 감사 필드가 아니며, 원문은 접근 통제된 evidence store에서 handle로 참조한다. Quarantine은 삭제가 아니라 기본 model projection과 memory promotion에서 제외하는 상태다. 잘못 승격된 record는 연결된 memory·summary·cache까지 폐기하고, 그 record에서 파생된 tool decision과 report claim을 다시 검토한다.

## 배포를 막아야 하는 8가지 조건

- [ ] Target-derived text가 system·developer instruction, tool description, policy rule로 복사된다.
- [ ] Raw evidence가 변경되거나 derived evidence가 parent·transform version을 잃는다.
- [ ] `evidence_only` label이 summary·compaction 뒤 사라진다.
- [ ] Artifact 값이 `command`, `destination`, `policy_option`, `memory_namespace`를 채운다.
- [ ] Tool result나 model output이 promotion gate 없이 persistent memory가 된다.
- [ ] Quarantine·revocation이 downstream summary·cache·memory에 전파되지 않는다.
- [ ] Inert fixture가 control slot에 들어가거나 승인 상태를 바꾼다.
- [ ] 금지 승격을 막는 과정에서 정상 address·symbol lookup과 근거 인용도 함께 깨진다.

## 결론

역공학 에이전트가 다루는 대상은 수동적인 byte 덩어리가 아니다. String, symbol, comment, pseudocode와 runtime output은 model에게 읽을 수 있는 언어가 된다. 위험은 그 언어의 존재 자체가 아니라 **분석 대상의 말이 analyst와 policy의 말과 같은 권한을 얻는 순간**에 생긴다.

OWASP LLM01의 indirect prompt injection 분류와 외부 content 분리 원칙은 이 문제의 출발점이다.[1] Agentic Top 10은 goal, tool, supply chain, memory가 서로 다른 피해 경로임을 보여 주며,[2] third-party MCP guide는 최소 권한과 governance의 기본선을 제공한다.[3] MemoryTrap 해설은 일회성 비신뢰 입력이 persistent state로 이동할 때 영향이 세션을 넘어설 수 있음을 보여 주지만, 이는 practitioner commentary이지 REA에 대한 취약점 증명이나 규범 사양이 아니다.[4]

REA 6.5.0 문서는 prompt selection을 authorization과 분리하고, process observation을 sandbox와 구분한다.[6][7] 그러나 REA 문서가 artifact prompt injection을 시연했다고 말해서는 안 된다. 이 글의 artifact taint model은 그 권한 분리를 strings·symbols·decompiler와 tool output까지 확장한 운영 제안이다.

구현 원칙은 단순하다. Raw evidence를 변경하지 말고, derived evidence의 provenance를 잃지 말며, target text를 control configuration에 넣지 않는다. Memory write는 별도 promotion으로 만들고, tool-call policy는 model 밖에서 집행한다. 마지막으로 공격 payload가 아닌 inert fixture와 negative test로 “증거는 읽히지만 지시로 승격되지 않는다”는 계약을 계속 검증한다.

## Sources

[1] https://genai.owasp.org/llmrisk/llm01-prompt-injection/ — LLM01: Prompt Injection
[2] https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/ — OWASP Top 10 for Agentic Applications announcement
[3] https://genai.owasp.org/resource/cheatsheet-a-practical-guide-for-securely-using-third-party-mcp-servers-1-0 — Securely Using Third-Party MCP Servers
[4] https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/ — Memory Is a Feature. It Is Also an Attack Surface
[5] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/README.md — REA 6.5.0 README
[6] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/mcp-prompts.md — Guided MCP prompts and completion
[7] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/process-capture.md — Process capture
