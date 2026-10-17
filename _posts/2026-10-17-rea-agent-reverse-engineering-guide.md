---
title: 'REA 딥다이브: AI 에이전트의 역공학 도구와 안전 경계'
date: 2026-10-17 13:10:00 +0900
categories: ["AI 보안"]
description: 'REA 6.5.0의 분석 도구, Evidence 흐름, 정적·런타임 경계와 허가된 평가 실험실을 근거 중심으로 정리한다.'
featured_image: 'https://picsum.photos/seed/rea-agent-reverse-engineering-guide/1600/900'
tags: [rea-6-5-0, agent-reverse-engineering, evidence-ledger, static-runtime-boundary, authorized-analysis, safe-evaluation-lab]
---

![서리 낀 들판 사이로 이어지는 검은 도로](https://picsum.photos/seed/rea-agent-reverse-engineering-guide/1600/900)

“AI가 앱을 역공학한다”는 문장은 두 가지를 섞기 쉽다. 하나는 바이너리만 넣으면 원본 소스가 되살아난다는 기대다. 다른 하나는 여러 분석기의 관찰을 에이전트가 연결하고, 결론마다 근거와 한계를 남기는 워크플로다. **REA(Reverse Engineer Anything)는 후자에 가깝다.**

이 글의 기준점은 2026년 10월 17일이며, `rea-agents-6.5.0` 태그가 가리키는 커밋 `3b79af28e80785afce9f5998d8f03289402a1847`을 고정해 읽었다. GitHub 릴리스는 6.5.0을 2026년 10월 14일 공개 릴리스로 표시한다.[1] npm 레지스트리의 같은 버전 메타데이터도 패키지명 `rea-agents`, 버전 `6.5.0`, MIT 라이선스와 Node.js 엔진 범위를 `^22.19.0 || ^24.11.0 || >=26.0.0`으로 기록한다.[2]

## REA의 본체는 “디컴파일러”보다 조율 계층이다

REA는 에이전트가 MCP 또는 CLI를 통해 로컬 분석 도구를 호출하고, 그 결과를 다시 질문·비교·검증에 쓰게 만드는 계층이다. 프로젝트 문서상 native 분석은 Hopper·Ghidra·IDA 같은 기존 엔진을 사용하며, JavaScript/Electron, .NET, 웹 관찰, Android, 펌웨어, 네트워크·패킷 기록, 프로세스 동작 등은 대상별 workflow와 provider로 나뉜다.[3]

따라서 “REA가 원본 소스를 복구했다”보다 다음 표현이 정확하다.

1. 분석기가 함수·명령·참조·모듈 관계를 **관찰**한다.
2. REA가 결과를 대상 digest, 위치, provider, coverage, limitation과 함께 **Evidence**로 묶는다.
3. 에이전트가 관련 Evidence를 따라가며 다음 질문이나 비교를 **조율**한다.
4. 관찰로 확인되지 않은 부분은 추정 또는 residual unknown으로 **분리**한다.

6.5.0의 MCP prompt는 `investigate_feature`, `compare_application_versions`, `verify_reconstruction`, `trace_crash`, `audit_residual_unknowns`, `prepare_bounded_process_capture` 같은 여섯 가지 provider-neutral 조사 흐름을 제공한다. 이 prompt들은 도구를 새로 만들거나 자동 실행하는 권한이 아니라, 관찰·추론·unknown을 구분하도록 에이전트의 조사 순서를 안내한다.[4]

여기서 중요한 것은 “그럴듯한 설명”이 아니라 **claim-to-evidence 연결**이다. REA의 Evidence 지침은 authority, limitation, coverage, residual unknown을 보존하고, 부분 결과에서 부재나 동등성을 단정하지 말라고 요구한다. `verify_reconstruction`도 선언된 유한 specification만 평가하며 전체 동등성을 증명하지 않는다.[5]

## 무엇을 볼 수 있나: 대상 이름보다 질문으로 고른다

지원 목록을 전부 외우는 것보다 질문을 세 범주로 나누는 편이 실용적이다.

| 질문 | 대표 대상 | 기대할 수 있는 결과 | 먼저 확인할 조건 |
|---|---|---|---|
| “정적으로 무엇이 들어 있는가?” | native binary, JavaScript/Electron bundle, .NET assembly, APK, WASM, firmware image | 함수·명령·문자열·metadata·모듈 관계·추출된 artifact | 형식별 provider, host OS, 완전성·truncation |
| “실행 중 무엇이 관찰됐는가?” | 웹·Electron page, Android device, 선택한 process scenario | DOM·network·log·terminal·filesystem snapshot 등 제한된 관찰 | 실행 권한, 계정·데이터 범위, side effect |
| “두 결과가 어디까지 같은가?” | 버전 A/B, 원본/재구현, capture A/B | 명시된 비교 항목의 일치·차이·unknown | 동일한 비교 contract, 충분한 coverage, 재현 환경 |

Native 조사에서는 pseudocode와 assembly를 함께 보고 call/reference/type evidence를 따라갈 수 있다. 다만 정적 call resolution은 실제 실행을 입증하지 않고, provider가 복구한 switch나 type도 원본 소스의 구조를 보장하지 않는다.[6] 재컴파일·ABI·동작·byte identity의 판정 기준은 별도 글인 [AI 역공학의 정답 조건]({% post_url 2026-10-17-ai-reverse-engineering-recompilation-proof %})에서 다룬다.

JavaScript application graph도 같은 원칙을 쓴다. 정적 관계의 `resolved`는 분석 범위에서 target이 하나였다는 뜻이지 해당 path가 실행됐다는 뜻이 아니다. Function fingerprint 역시 행동 동등성의 증명이 아니며, runtime 의미가 필요하면 별도의 browser·Electron·process 관찰을 수행해야 한다.[7]

## REA 보고서는 관찰·추론·미확정을 분리한다

좋은 보고서는 사실을 최소 세 칸으로 나눈다.

```text
OBSERVED  : artifact digest X의 함수 F에서 문자열 S와 call edge E를 관찰
INFERRED  : E가 기능 Q의 후보 경로일 가능성이 있음
UNKNOWN   : 실제 사용자 흐름에서 E가 실행되는지, 다른 경로가 있는지 미확인
```

Process Capture를 추가해도 `UNKNOWN`이 자동으로 사라지지 않는다. 선택한 명령의 terminal·process lifetime·filesystem 상태를 제한된 증거로 기록하지만 snapshot 사이의 짧은 변경, 잘린 출력, 보지 않은 path는 남는다.[8] 여기서는 REA 보고 형식의 경계만 확인하고, 결과의 동등성 판정은 위의 별도 글로 넘긴다.

## Provider 요구사항은 기능의 일부다

REA 설치 성공과 특정 분석 workflow의 준비 완료는 다르다. 기본 런타임은 앞서 본 Node.js 범위를 요구한다.[2] Deep native 분석은 기존 Hopper·Ghidra·IDA 설치와 대상·호스트에 맞는 provider 구성이 필요하지만, 정적 JavaScript와 .NET 검사는 native 분석 엔진 없이도 가능하다.[3] 펌웨어, Android, 패킷처럼 외부 엔진이나 host 제약이 있는 분야는 각각 별도 prerequisite를 만족해야 한다.

운영에서는 작업 전 다음 네 가지를 고정하는 편이 안전하다.

- REA 버전과 태그 커밋
- 대상 파일 digest와 획득 경로
- provider 이름·버전·host OS
- 요청한 operation과 결과의 coverage·limitation

이 정보가 없으면 같은 명령어처럼 보여도 재현 조건이 달라질 수 있다.

## 로컬 분석은 격리와 같은 말이 아니다

REA의 bridge는 세션별 capability token과 private local transport를 사용하지만, 프로젝트 보안 정책은 같은 OS 사용자로 이미 실행 중인 악성 프로세스로부터 보호하는 sandbox가 아니라고 선을 긋는다. 신뢰할 수 없는 바이너리를 열면 선택한 local provider가 현재 사용자 권한으로 파싱·분석한다. 임시 project와 resource bound는 우발적 잔류와 사용량을 줄일 뿐, provider를 격리 경계로 바꾸지는 않는다.[9]

“로컬에서 처리한다”는 설명도 데이터 흐름 전체를 뜻하지 않는다. Target 분석은 로컬이어도 Evidence가 연결된 에이전트와 모델 provider로 전달될 수 있으므로, 그 provider의 보존·학습·지역 정책을 따로 검토해야 한다.[3] 비공개 바이너리, 고객 데이터, token이 결과에 섞이지 않도록 입력과 출력 양쪽을 분류해야 한다.

## 안전한 평가 실험실: 제품 기능이 아니라 운영 권고

아래 구성은 REA가 자동 제공한다고 주장하는 기능이 아니라 **허가된 sample로 도구의 관찰 품질을 평가하기 위한 운영 권고**다.

1. **권한을 먼저 문서화한다.** 직접 만든 fixture, 명시적 라이선스가 있는 공개 sample, 또는 서면 승인을 받은 artifact만 사용한다. 소유한 파일이라는 사실만으로 실행·트래픽 가로채기·device 조작 권한까지 생기지는 않는다.
2. **일회성 VM을 쓴다.** 개인 계정과 개발자 home이 없는 snapshot에서 시작하고, host 공유 폴더·clipboard·USB 연결은 기본 차단한다.
3. **egress를 기본 거부한다.** 재현에 필요한 목적지가 있으면 고정 목록으로 열고, 실제 credential 대신 폐기 가능한 test identity를 쓴다.
4. **정적 검사를 먼저 수행한다.** Digest, file type, provider readiness를 기록한 뒤 runtime 단계는 별도 승인한다.
5. **capture 범위를 작게 만든다.** 하나의 질문, 짧은 timeout, 지정한 작업 디렉터리와 관찰 path, 제한된 synthetic input으로 scenario를 구성한다.
6. **Evidence와 unknown을 함께 보존한다.** 명령, 설정, artifact digest, provider 버전, output hash, truncation과 residual unknown을 같은 평가 기록에 둔다.
7. **재현 후 폐기한다.** 결과를 read-back한 다음 VM과 test credential을 폐기하고, 공유할 Evidence에서는 proprietary text·개인정보·secret을 제거한다.

평가 지표도 “앱을 복제했는가” 하나로 잡지 않는다. `근거 위치를 다시 찾을 수 있는가`, `정적 관찰과 런타임 관찰을 구분했는가`, `unknown이 결과에서 사라지지 않는가`, `동일 contract로 반복했을 때 차이를 설명하는가`를 따로 본다. 조직이 쓰는 evidence ledger schema나 점수는 **REA 표준이 아니라 조직 확장**이라고 표시해야 한다.

## 법적·라이선스 경계

프로젝트의 책임 있는 사용 범위는 소유하거나 분석 권한을 받은 소프트웨어의 연구·교육·상호운용성·보존·감사다. 공식 disclaimer는 DRM·license check 우회, credential 절취, 무단 access-control 우회, proprietary code·asset 복제 등을 지원 대상에서 제외하며, artifact를 검사할 권한이 실행·interception·device 변경 권한까지 뜻하지 않는다고 명시한다.[10]

그러므로 REA 도입 검토의 첫 질문은 “무엇까지 할 수 있나?”가 아니라 다음이어야 한다.

> 이 artifact, 계정, device, traffic에 대해 **누가 어떤 관찰과 실행을 승인했는가?**

## 결론

REA 6.5.0의 가치는 원본 소스를 마법처럼 되살리는 데 있지 않다. 서로 다른 분석기와 관찰 workflow를 에이전트가 호출하고, 결과를 Evidence·coverage·limitation·unknown으로 묶어 다음 조사와 검증으로 넘기는 데 있다.

도입 판단도 showcase의 성공 장면만으로 끝내면 안 된다. 프로젝트가 제시하는 reconstruction 사례는 **프로젝트가 보고한 사례**로 읽고, 우리 환경에서는 provider 준비 상태와 Evidence 추적 가능성을 별도의 허가된 fixture로 평가해야 한다.[3] 재구현의 정확성을 판정할 때는 앞서 연결한 동등성 검증 사다리를 적용한다.

## Sources

[1] https://github.com/morluto/rea/releases/tag/rea-agents-6.5.0 — Release rea-agents: v6.5.0
[2] https://registry.npmjs.org/rea-agents/6.5.0 — rea-agents 6.5.0 package metadata
[3] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/README.md — REA: Reverse Engineer Anything
[4] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/mcp-prompts.md — Guided MCP prompts and completion
[5] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/.agents/skills/reverse-engineer-anything/references/evidence-workflows.md — Evidence, comparison, and verification workflows
[6] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/native-investigation.md — Native binary investigation
[7] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/javascript-application-workflows.md — Cross-layer JavaScript application workflows
[8] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/docs/process-capture.md — Process capture
[9] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/SECURITY.md — Security Policy
[10] https://github.com/morluto/rea/blob/3b79af28e80785afce9f5998d8f03289402a1847/DISCLAIMER.md — Disclaimer
