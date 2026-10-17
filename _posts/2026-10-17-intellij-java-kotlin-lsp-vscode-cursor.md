---
title: 'Cursor와 VS Code에서 IntelliJ JVM 엔진 쓰기: Java·Kotlin LSP 1.0 검증'
date: 2026-10-17 06:50:00 +0900
categories: ["개발 도구"]
description: 'Java and Kotlin by IntelliJ IDEA 1.0의 stable 범위와 preview·예정 기능을 분리하고, 동일 Maven·Gradle fixture로 indexing·rename·debug 정확도와 CPU·메모리 비용을 검증한다.'
featured_image: 'https://picsum.photos/seed/intellij-java-kotlin-lsp-vscode-cursor/1600/900'
tags: [intellij-idea, java, kotlin, lsp, dap, vscode, cursor, developer-tools]
---

![Cursor와 VS Code의 IntelliJ Java Kotlin LSP 검증](https://picsum.photos/seed/intellij-java-kotlin-lsp-vscode-cursor/1600/900)

JetBrains는 2026년 10월 15일 **Java and Kotlin by IntelliJ IDEA 1.0**을 첫 stable release로 발표했다.[1] 이 extension은 IntelliJ IDEA의 Java·Kotlin 언어 기술을 LSP 서버와 Debug Adapter 형태로 VS Code와 Cursor에 제공한다. Java, Kotlin, mixed-language project를 지원하고 Maven, Gradle, Bazel project import를 다룬다.[1] 하지만 stable이라는 말이 IntelliJ IDEA desktop의 모든 기능이 동일하게 옮겨졌다는 뜻은 아니다.

1.0을 평가할 때는 기능 목록보다 결과의 재현성이 중요하다. 같은 repository를 열었을 때 같은 symbol을 찾는가. Java 선언을 rename하면 Kotlin call site까지 정확히 바뀌는가. Debugger가 build 결과와 같은 bytecode를 실행하는가. Monorepo indexing이 업무용 노트북의 memory와 CPU budget을 넘지 않는가.

이 질문은 “VS Code와 IntelliJ IDEA 중 무엇이 더 좋은가”라는 취향 비교와 다르다. Agent 생산성에 대한 일반 주장도 반복하지 않는다. 에디터 UI를 바꿔도 project model, index, refactoring transaction, DAP launch contract가 틀리면 JVM 개발 품질은 좋아지지 않는다. 반대로 그 네 계약이 안정적이면 개발자는 원하는 VS Code 계열 shell을 사용하면서 IntelliJ 기반 분석을 활용할 수 있다.

## Stable extension과 아직 preview인 경로를 분리한다

Stable인 것은 editor 안에서 사용하는 **Java and Kotlin by IntelliJ IDEA 1.0 extension**이다.[1] 발표된 1.0 범위에는 completion, navigation, code analysis, refactoring, Maven·Gradle·Bazel support, JUnit 관련 test runner, debugging이 포함된다.[1] Cursor에는 Agents Window를 위한 별도 지원도 있고, 이 창이 자체 language server instance를 사용할 수 있다고 발표문은 설명한다.[1] 이 현재 기능을 향후 agent direct-call 계획과 섞으면 안 된다.

JetBrains는 다음 release 중 하나에서 VS Code나 Cursor의 Agents view가 코드를 작성할 때 LSP를 직접 호출하도록 할 계획이라고 밝혔다.[1] Claude Code나 Codex 같은 terminal-based agent가 같은 intelligence를 직접 쓰는 경로도 실험 중이라고 했다.[1] 두 항목은 1.0 stable editor extension의 현재 보장 범위가 아니다. “이제 모든 terminal agent가 IntelliJ LSP를 호출한다”는 문장은 시점을 앞당긴다.

Pure Kotlin project를 위한 **Kotlin LSP**도 별도 제품이다. JetBrains는 이 server의 source가 Apache 2.0이고 subscription 없이 사용할 수 있다고 설명한다.[2] Java and Kotlin by IntelliJ IDEA는 Java와 mixed-language project까지 포괄하고 stable 1.0부터 IntelliJ IDEA Ultimate subscription을 요구한다.[1][2] 이름이 비슷하다는 이유로 라이선스와 기능 범위를 합치면 안 된다.

문서 surface 사이의 기능 시차도 있다. Stable 발표문은 JUnit test runner support를 1.0 목록에 넣었다.[1] 반면 2026년 10월 17일 확인한 Run and debug 문서의 limitation은 test running과 discovery가 아직 지원되지 않는다고 적었다.[3] 어느 쪽을 조용히 골라 사실로 만들기보다 version을 고정한 실제 fixture 결과를 기록해야 한다. Stable label은 문서 불일치를 없애 주지 않는다.

## Extension을 설치하는 것과 project를 이해하는 것은 다르다

Extension은 지원 build file이 있는 directory를 열면 project import를 시작한다.[4] Import는 build configuration을 읽고 dependency를 resolve하며 source root, module, library가 포함된 project model을 만든다.[4] Code insight는 이 model과 index가 준비된 뒤에야 완전히 동작한다. Syntax highlighting이 보인다고 import가 성공한 것은 아니다.

Workspace root에 여러 build system의 file이 있으면 사용자가 하나를 고르거나 project structure를 설정할 때까지 import가 시작되지 않을 수 있다.[4] 이 상태에서는 extension feature도 사용할 수 없다.[4] 따라서 “처음 열었는데 go to definition이 안 된다”는 사건을 LSP correctness bug로 바로 분류하면 안 된다. 먼저 import pending인지, build tool selection pending인지, indexing 중인지 구분해야 한다.

Monorepo는 root directory와 logical project의 경계가 다르다. JetBrains 문서는 `intellij.projects`에 import할 project를 명시해 working set을 줄일 수 있다고 안내한다.[4] Root 전체를 자동 import하면 필요하지 않은 module까지 model과 index에 들어와 memory를 크게 사용할 수 있다.[4] 성능 비교에서 이 설정을 숨기면 한 editor는 full graph를, 다른 editor는 subproject만 읽는 불공정한 결과가 나온다.

Index는 workspace별로 생성·유지된다.[4] 같은 absolute path를 사용할 때 machine 간 index 재사용이 가능하다는 문서 설명도 있다.[4] 동시에 한 workspace에는 하나의 backend만 접근해야 하며 여러 backend의 concurrent access는 지원되지 않는다.[4] Cursor와 VS Code를 같은 checkout에 동시에 열어 놓은 시험은 제품 제한을 위반한 결과가 될 수 있다.

## 비교 fixture는 코드보다 project graph를 먼저 고정한다

Fixture repository는 `app-java`, `lib-kotlin`, `shared-api` 세 module로 만든다. Maven variant와 Gradle variant는 같은 source tree와 dependency graph를 표현한다. Java application은 Kotlin library를 호출하고 Kotlin library는 Java interface를 구현한다. Shared test fixture에는 동일 이름의 class와 overloaded method를 둔다.

두 variant의 compile target, JDK vendor, JDK version, Kotlin version, dependency version을 lock한다. Gradle wrapper와 Maven wrapper도 repository에 넣는다. Remote cache는 첫 cold run에서는 끄고 warm run에서만 켠다. Generated source와 annotation processor output은 별도 directory에 둔다.

```text
jvm-lsp-fixture/
  shared-api/       Java interface + records
  lib-kotlin/       Kotlin implementation + extension functions
  app-java/         Java caller + async worker
  fixtures/rename/  expected file and symbol edits
  fixtures/debug/   expected breakpoint and variable values
  expected.json     import, navigation, rename, debug assertions
```

Fixture의 목적은 실제 회사 monorepo를 축소해 흉내 내는 것이다. 작고 쉬운 hello-world만 쓰면 indexing과 cross-language rename의 경계를 보지 못한다. 반대로 비공개 production repository 하나만 쓰면 다른 팀이 결과를 재현할 수 없다. 공개 가능한 synthetic graph와 내부 representative graph를 둘 다 운영하는 편이 낫다.

Maven과 Gradle 결과가 같아야 한다는 기대도 무조건적이지 않다. 각 build가 실제로 같은 source set과 compiler option을 표현하는지 먼저 확인한다. Build tool 자체의 model 차이를 LSP bug로 오인하지 않는다. Command-line clean build가 서로 다른 classpath를 만들면 editor 비교를 중단한다.

## Indexing은 시작 시간과 steady state를 분리해 잰다

Cold indexing은 extension cache와 build cache가 없는 새 workspace에서 시작한다. Workspace open 시각, import 완료 시각, first correct navigation 시각, diagnostics stable 시각을 각각 기록한다. UI가 idle처럼 보여도 background index가 계속될 수 있다. 첫 completion popup만으로 ready를 선언하지 않는다.

Warm indexing은 같은 absolute path와 같은 dependency graph에서 editor를 재시작해 측정한다. Incremental indexing은 Java file 하나, Kotlin file 하나, build file 하나를 순서대로 바꾼다. 각 변화 뒤 영향받지 않은 module까지 재분석되는지 본다. Delete와 branch switch도 포함한다.

Resource measurement는 extension host와 language server process를 분리한다. Process tree에서 PID, parent PID, command line을 snapshot한다. 1초 간격으로 RSS, CPU time, read bytes, write bytes를 수집한다. Workspace별 index directory size와 cache growth도 전후로 잰다.

```text
phase = cold_import | warm_open | java_edit | kotlin_edit | build_change
metrics = wall_time, time_to_navigation, time_to_stable_diagnostics
          process_rss_peak, process_cpu_seconds, io_read_bytes, io_write_bytes
          index_bytes, server_restart_count
```

평균 하나로 보고하지 않는다. 같은 machine에서 최소 다섯 번 반복하고 median과 p95를 기록한다. OS page cache가 결과를 바꾸므로 cold run의 reset 방법을 명시한다. Laptop power mode와 background build도 고정한다.

JetBrains는 large project와 monorepo에서 빠르고 안정적인 performance를 제공한다고 발표했다.[1] 이는 vendor claim이며 특정 hardware에서의 숫자를 제공하지 않는다. 자체 fixture의 수치가 곧 모든 repository의 결과도 아니다. Project 수, generated source, annotation processor, dependency resolver와 disk 성능이 달라지면 경계가 이동한다.

## Rename은 성공 toast가 아니라 semantic diff로 평가한다

Extension 문서는 F2 Rename이 declaration과 모든 reference를 project 전체에서 갱신한다고 설명한다.[5] 이 약속을 확인하려면 단일 file의 local variable보다 cross-module symbol이 낫다. Java interface method를 rename하고 Kotlin override와 Java·Kotlin call site가 모두 바뀌는지 본다. Kotlin property를 rename하고 generated accessor를 사용하는 Java call site도 확인한다.

첫 fixture는 `PaymentGateway.charge`를 `authorize`로 바꾼다. Expected diff에는 interface, Kotlin implementation, Java caller, Kotlin test를 넣는다. String literal과 JSON field는 바뀌지 않아야 한다. 동일한 이름의 unrelated method도 그대로 남아야 한다.

두 번째 fixture는 Kotlin extension function을 rename한다. Import alias가 있는 call site와 fully qualified call을 함께 둔다. Java에서 보이는 static bridge가 어떻게 처리되는지도 기록한다. 제품이 지원하지 않는 경로라면 silent partial success 대신 limitation으로 표시돼야 한다.

세 번째 fixture는 overload와 method reference를 사용한다. Type resolution이 다른 overload를 같은 text match로 바꾸면 실패다. Rename 뒤 `git diff`만 보지 않고 Maven과 Gradle clean build를 실행한다. Test compile까지 통과해야 semantic edit로 인정한다.

네 번째 fixture는 stale index를 만든다. External command로 branch를 바꾸고 symbol declaration 위치를 이동한다. Index가 갱신되기 전에 rename을 요청했을 때 extension이 대기, 거부, stale edit 중 무엇을 하는지 확인한다. Stale edit를 성공으로 보고하면 가장 위험하다.

평가 결과는 `all_expected_edits`, `unexpected_edits`, `missed_references`, `build_result`, `index_state`로 나눈다. UI notification은 evidence가 아니다. Refactoring preview가 있다면 사용자에게 표시된 대상과 실제 filesystem diff도 비교한다. Agent가 rename을 호출하는 미래 경로에서도 같은 assertion을 재사용할 수 있어야 한다.

## Debug는 DAP 연결보다 build와 bytecode 일치를 본다

1.0 발표에는 emulated breakpoint와 async stack trace를 포함한 debugging capability가 명시돼 있다.[1] 공식 문서는 Java와 Kotlin application을 editor에서 시작하거나 running JVM에 attach할 수 있다고 설명한다.[3] DAP session이 열렸다는 사실만으로 정확한 debug가 증명되지는 않는다. 최신 source가 실제 실행 bytecode에 반영됐는지 먼저 확인해야 한다.

문서는 실행 전 code를 build하라고 안내한다.[3] Maven과 Gradle project에는 `intellij: build` task를 제공하며 `launch.json`의 `preLaunchTask`로 연결할 수 있다.[3] Gradle에는 compile과 run을 함께 수행하는 `intellij_gradle` configuration도 있다.[3] Plain JVM 실행을 세밀하게 제어하려면 `intellij_jvm`과 별도 build task를 사용할 수 있다.[3]

Debug fixture는 네 경로로 나눈다. 첫째는 Java main의 line breakpoint다. 둘째는 Kotlin suspend function의 breakpoint와 async stack이다. 셋째는 exception breakpoint다. 넷째는 이미 실행 중인 JVM attach다.

각 경로에서 source line, class name, thread, local variable 값, stack frame 순서를 expected manifest에 기록한다. Source를 수정한 뒤 build 없이 debug를 다시 시작하는 negative case도 둔다. Old bytecode를 실행하면 UI가 어떤 warning을 주는지 확인한다. Warning이 없다면 운영 문서에 mandatory preLaunch build를 넣는다.

Build script가 run parameter를 override하는 프로젝트도 주의해야 한다. 현재 Run and debug 문서의 limitation은 extension이 execution을 build tool에 위임하지 않는 경로에서 Maven이나 Gradle script의 custom launch parameter를 적용하지 않을 수 있다고 설명한다.[3] `intellij_gradle`과 `intellij_jvm`이 같은 환경 변수와 JVM option을 쓴다고 가정하지 않는다. Production-like launch는 command line baseline과 출력·system property를 비교한다.

JUnit도 version fixture로 확인한다. Stable announcement에는 JUnit runner support가 있다고 적혀 있지만 현재 세부 문서에는 test running과 discovery 미지원 문구가 남아 있다.[1][3] JUnit 4, JUnit 5, parameterized test를 열어 discovery, single-test run, debug 결과를 기록한다. 실제 설치 version에서 실패하면 stable 전체를 부정하지 말고 그 feature와 documentation skew를 issue로 남긴다.

## VS Code와 Cursor 비교는 같은 backend 조건을 유지한다

VS Code와 Cursor에서 extension version을 정확히 같게 고정한다. JDK, repository path, `settings.json`, disabled extension 목록도 맞춘다. Red Hat과 Oracle Java extension은 analysis와 quick-fix가 겹칠 수 있어 JetBrains가 함께 사용할 때 비활성화를 권고한다.[1] 중복 language server를 켠 상태에서 duplicate diagnostics가 나온 결과를 IntelliJ server의 단독 결과로 보고하면 안 된다.

Cursor의 Agents Window는 별도 language server instance를 사용할 수 있다.[1] 이 경로는 일반 editor session보다 process와 memory가 늘어날 수 있다. Agent window를 닫은 baseline과 연 상태를 분리한다. 같은 workspace에 unsupported concurrent backend가 생기는지는 process tree와 log로 확인한다.

Editor shell 비교에서는 rendering latency와 language intelligence latency를 나눈다. Keypress부터 popup rendering까지는 shell 비용이 포함된다. LSP request부터 response까지는 protocol과 server 비용에 가깝다. 정확도는 최종 symbol, diagnostic, edit와 debug state로 비교한다.

Cursor agent가 semantic search를 사용했다는 vendor 설명만으로 token 절감률을 만들지 않는다. JetBrains는 agent의 LSP direct call이 더 빠르고 deterministic하며 token을 줄일 수 있다는 방향을 제시했지만 향후 release와 experiment도 함께 언급했다.[1] 공개된 controlled benchmark가 없으므로 “몇 퍼센트 저렴하다”는 숫자를 쓰면 안 된다. Agent 비용은 실제 request trace와 model billing을 확보한 뒤에만 비교한다.

## Memory 설정은 성능 knob이면서 장애 경계다

Extension setting `intellij.additionalJvmArgs`로 language server JVM argument를 전달할 수 있고 `-Xmx4g` 같은 heap 상한 예시가 공식 문서에 있다.[6] Heap을 크게 주면 모든 문제가 해결된다는 뜻은 아니다. RSS에는 heap 외 native memory, mapped index, JIT code cache가 들어간다. OS memory pressure와 extension host도 함께 봐야 한다.

Heap fixture는 default, 2 GiB, 4 GiB, 8 GiB로 나눈다. 같은 cold import와 rename suite를 반복한다. GC pause, out-of-memory, server restart, indexing completion과 peak RSS를 기록한다. 가장 빠른 값이 laptop 전체를 swap으로 보내면 적합한 설정이 아니다.

Project scope 축소와 heap 증가도 비교한다. `intellij.projects`로 active module만 import했을 때의 정확도와 resource를 잰다.[4][6] Scope를 줄여 빠르게 만들었지만 rename 대상 reference가 import 밖으로 빠지면 project-wide refactoring 요구를 만족하지 못한다. 성능 개선과 semantic coverage를 같은 그래프에 놓아야 한다.

비용은 subscription과 hardware를 나눠 본다. Stable 1.0 발표문은 30일 trial 뒤 IntelliJ IDEA Ultimate subscription이 필요하다고 설명하지만,[1] 현재 Licensing and activation 문서는 60일 trial이라고 안내한다.[6] 공식 자료가 서로 다르므로 한 숫자를 계약값으로 단정하지 말고 실제 계정의 entitlement와 만료일을 확인해야 한다. 같은 license로 desktop IDE와 지원되는 VS Code-based 환경의 Java·Kotlin capability를 사용할 수 있다.[1] 정확한 금액은 지역, 계약, 시점에 따라 달라지므로 공식 견적에서 확인한다.

Hardware 비용에는 memory upgrade, indexing 중 battery와 CPU 사용, remote workspace 크기가 들어간다. Developer가 editor를 바꿔도 language server가 큰 heap을 요구하면 절감이 아닐 수 있다. 반대로 desktop IDE와 VS Code extension이 같은 license로 대체 가능한 workflow라면 별도 도구 비용을 줄일 수도 있다. 실제 seat와 concurrent use 조건은 계약 문구로 확인해야 한다.

## 보안과 라이선스 경계는 server process에서 시작한다

Language server는 source tree와 build configuration을 읽고 dependency를 resolve한다.[4] 따라서 repository source, internal package name, build credential과 network path에 접근할 수 있다. Extension 설치를 단순한 syntax plugin으로 취급하면 권한 검토가 부족하다. Process와 cache directory를 endpoint security inventory에 넣는다.

Data sharing 설정은 Full, Anonymous, None을 제공한다.[6] Full은 anonymous usage statistics와 exception message 및 attachment를 포함한 full error report를 전송할 수 있다.[6] Anonymous는 exception message, user data, attachment를 제거한 anonymized error report를 보낸다.[6] None은 usage statistics와 error report를 보내지 않는다.[6]

조직은 source sensitivity에 맞는 default를 정한다. Support case에 log를 첨부할 때도 token, path, source fragment가 들어 있는지 검토한다. `intellij.trace.server=verbose`는 모든 protocol message를 기록할 수 있으므로 troubleshooting 뒤 반드시 원복한다.[6] Verbose trace를 장기 보관하는 것을 performance telemetry와 혼동하지 않는다.

Build tool import는 외부 repository와 plugin code를 실행하거나 resolve할 수 있다. 새 branch를 열기만 해도 background import가 시작될 수 있다는 점을 threat model에 넣는다.[4] Untrusted repository는 network와 credential이 제한된 workspace에서 먼저 연다. Gradle init script, Maven extension, Bazel rule을 source code와 같은 신뢰 수준으로 보지 않는다.

라이선스 측면에서도 인간 사용과 purely agentic use를 분리해야 한다. JetBrains는 1.0 license가 명시적으로 human use를 위해 설계됐고 purely agentic use의 licensing model은 추후 업데이트하겠다고 밝혔다.[1] 사람이 Cursor나 VS Code에서 쓰는 stable extension entitlement를 unattended agent farm의 권리로 확대하면 안 된다. Terminal agent integration이 기술적으로 가능해져도 상업적 사용 권한은 별도로 확인해야 한다.

## 실패 모드는 import, index, edit, execution으로 나눈다

Import failure는 build model이 만들어지지 않은 상태다. Multiple build system 선택 대기, dependency resolution 오류, 잘못된 JDK가 원인일 수 있다. 이때 completion accuracy를 측정하지 않는다. Import log와 command-line build를 먼저 비교한다.

Index failure는 project model은 있지만 symbol data가 incomplete하거나 stale한 상태다. Navigation이 일부 동작해 더 위험할 수 있다. Diagnostics count가 안정됐는지, known symbol fixture가 모두 resolve되는지 확인한다. Server restart loop도 별도 상태로 기록한다.

Edit failure는 rename이나 quick-fix가 partial diff를 만든 상태다. Build가 실패하면 명확하지만 unrelated symbol까지 바꾼 경우 build가 통과할 수도 있다. Expected semantic diff와 negative assertion이 필요하다. Undo가 모든 file을 하나의 transaction으로 되돌리는지도 본다.

Execution failure는 build output과 launch configuration이 어긋난 상태다. Breakpoint가 회색이 되거나 예상 line에서 멈추지 않을 수 있다. Environment variable과 JVM option이 다른 process에 적용될 수도 있다. DAP connected를 성공으로 쓰지 말고 expected runtime value를 읽는다.

Resource failure는 correctness가 유지돼도 업무를 막을 수 있다. Continuous re-indexing, high CPU idle, index disk growth, memory pressure를 관찰한다. Threshold를 넘으면 heap만 올리지 말고 project scope, generated directory, competing extension과 branch-switch behavior를 조사한다. Issue report에는 extension version과 reproducible fixture를 붙인다.

Documentation skew도 운영 실패다. Announcement와 detailed help가 다르면 release note, installed version, observed behavior를 한 ticket에 남긴다. 문서가 고쳐질 때까지 내부 runbook에 확인 날짜를 적는다. 오래된 limitation을 영구 사실로 복사하지 않는다.

## Rollout은 정확도 fixture를 먼저 통과시킨다

첫 단계는 synthetic Maven·Gradle fixture다. Cold import, warm open, navigation, rename, debug, resource test를 같은 machine에서 실행한다. Stable announcement의 기능별 pass와 세부 문서 limitation을 구분해 report한다. 실패한 항목은 editor별로 재현한다.

두 번째 단계는 대표 monorepo의 read-only evaluation이다. 기존 extension과 동시에 켜지 않는다. Working set을 명시하고 full graph baseline도 한 번 측정한다. Developer가 실제로 쓰는 JDK와 build credential 경로를 포함한다.

세 번째 단계는 소수 팀의 opt-in이다. Rename은 preview diff와 clean build를 필수로 한다. Debug launch는 checked-in `launch.json`과 preLaunch build를 사용한다. Memory threshold와 rollback 절차를 정한다.

네 번째 단계는 표준화 여부 결정이다. 성공률만 보지 않는다. Import p95, stale diagnostic incident, rename defect, debug mismatch, peak RSS, server restart, support ticket와 subscription utilization을 함께 본다. 기존 desktop IDE를 계속 써야 하는 workflow도 목록으로 남긴다.

Rollback은 extension disable과 workspace cache 처리로 구성한다. Competing Java extension을 다시 켤 때도 둘이 동시에 active가 되지 않게 한다. Edited source는 Git diff와 clean build로 확인한다. Index cache 삭제가 source rollback을 대신하지 않는다.

## 이 LSP 구성이 맞는 팀과 도입이 어려운 팀

이 extension은 VS Code나 Cursor를 표준 shell로 쓰면서 Java와 Kotlin mixed project의 semantic intelligence가 필요한 팀에 적합하다. Maven, Gradle, Bazel graph를 갖고 cross-language navigation과 refactoring을 중요하게 보는 monorepo에도 검토 가치가 있다. IntelliJ IDEA Ultimate seat를 이미 보유하고 desktop과 editor workflow를 오가는 개발자에게도 자연스럽다. Reproducible fixture와 resource telemetry를 운영할 수 있다면 도입 위험을 줄일 수 있다.

반대로 pure Kotlin만 다루고 subscription이 필요 없는 경량 LSP를 원하는 팀은 별도 Kotlin LSP와 비교해야 한다.[2] Unsupported build system이나 특수 generated model에 의존하는 팀은 import 전제부터 맞지 않을 수 있다. Test discovery나 custom Gradle launch semantics가 핵심인 팀은 설치 version의 limitation을 먼저 재현해야 한다.[3] Memory가 제한된 remote container에서 full monorepo를 매번 여는 팀도 scope 설계 없이 도입하면 어렵다.

IntelliJ desktop의 모든 inspection, plugin, UI workflow가 필요하다면 editor extension을 완전 대체재로 가정하지 않는다. Purely agentic unattended environment도 현재 human-use license 설명만으로 배포하면 안 된다.[1] 여러 editor가 같은 workspace를 동시에 열어야 하는 workflow는 one-backend limitation과 충돌할 수 있다.[4] “LSP니까 어디서나 동일하다”는 기대가 오히려 부적합 신호다.

## 결론

Java and Kotlin by IntelliJ IDEA 1.0은 VS Code와 Cursor에서 사용하는 editor extension으로 stable이 됐다.[1] Java·Kotlin mixed project, Maven·Gradle·Bazel import, code analysis, refactoring과 debugging이 현재 범위다.[1][7][3] Agent의 direct LSP call과 terminal agent workflow는 향후 release 또는 experiment로 남아 있다.[1] Pure Kotlin용 Apache-2.0 Kotlin LSP도 별도 선택지다.[2]

도입 판단은 feature 체크박스가 아니라 동일 fixture의 결과로 내려야 한다. Cold·warm indexing, cross-language rename의 semantic diff, build와 bytecode가 일치한 debug, process별 CPU·RSS·I/O를 함께 측정한다. Cursor Agents Window의 추가 server와 competing Java extension도 통제한다. Announcement와 help page가 다른 JUnit 상태는 설치 version에서 직접 시험한다.

가장 중요한 질문은 에디터 이름이 아니다. **같은 build graph를 읽고, 같은 symbol을 고치고, 같은 bytecode를 실행하면서, 감당할 수 있는 resource budget 안에서 그 결과를 반복하는가**가 핵심이다. 이 계약이 통과하면 1.0은 JVM 개발 환경을 선택할 폭을 넓힌다. 계약이 통과하지 않으면 stable label만으로 production workflow를 바꿀 이유는 없다.

## Sources

[1] https://blog.jetbrains.com/idea/2026/10/intellij-idea-s-java-and-kotlin-for-cursor-and-vs-code-hits-1-0/
[2] https://blog.jetbrains.com/idea/2026/08/intellij-idea-goes-lsp/
[3] https://www.jetbrains.com/help/intellij-vscode/Run-and-debug.html
[4] https://www.jetbrains.com/help/intellij-vscode/Project-import.html
[5] https://www.jetbrains.com/help/intellij-vscode/Refactoring-and-code-generation.html
[6] https://www.jetbrains.com/help/intellij-vscode/IntelliJ-lsp-settings.html
[7] https://www.jetbrains.com/help/intellij-vscode/About-instance.html
