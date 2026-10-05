---
title: 'GitHub Copilot Computer Use 보안: 데스크톱 자동화의 승인 경계를 다시 설계하라'
date: 2026-10-05 09:00:00 +0900
categories: ["AI 에이전트"]
description: 'GitHub Copilot Computer Use의 데스크톱 제어 범위와 OS 권한, 앱별 승인 수명, GUI 자동화의 비결정성을 분석하고 비가역 작업 전 최종 확인과 read-back 원칙을 제안한다.'
featured_image: 'https://picsum.photos/seed/github-copilot-computer-use-desktop-security/1600/900'
tags: [github-copilot, computer-use, desktop-automation, gui-agent, agent-security, human-approval]
---

![GitHub Copilot Computer Use 데스크톱 보안](https://picsum.photos/seed/github-copilot-computer-use-desktop-security/1600/900)

2026년 10월 1일 GitHub는 Copilot Computer Use를 public preview로 공개했다.[1] 지원 범위는 **macOS와 Windows의 로컬 세션에서 실행되는 Copilot CLI와 GitHub Copilot 앱**이다.[3][4] Linux 지원 여부를 이 발표만으로 확대 해석해서는 안 된다.

이번 변화의 핵심은 새 채팅 기능이 아니다. Copilot은 접근 가능한 앱 콘텐츠와 시각적 문맥을 읽고, 컨트롤을 클릭하며, 텍스트를 입력·수정하고, 키 입력·스크롤·드래그를 수행할 수 있다. 여러 앱 사이의 workflow도 탐색한다.[1][2] API, CLI, MCP 연동이 없는 레거시 또는 GUI-only 소프트웨어까지 자동화 범위에 들어온 셈이다.

하지만 GUI는 구조화된 API와 다른 실패 방식을 가진다. 같은 목표라도 창의 위치, 포커스, 팝업, 렌더링 지연, 앱 버전에 따라 다음 클릭이 달라진다. 따라서 Computer Use의 보안은 “에이전트에게 무엇을 허용할 것인가”만으로 끝나지 않는다. **지금 보고 있는 화면이 맞는지, 저장된 승인이 아직 유효한지, 돌이킬 수 없는 행동 직전에 사람이 결과를 다시 확인하는지**까지 설계해야 한다.

## 공식 기능의 범위부터 정확히 읽자

GitHub 문서에 따르면 Computer Use는 운영체제의 accessibility tree와, 시각적 문맥이 필요할 때의 screenshot을 이용해 앱을 해석한다. 이후 클릭, 텍스트 편집, 키 입력, 스크롤, 드래그를 조합한다.[2] 프레젠테이션 내용을 고치거나 레거시 데스크톱 앱의 정보를 요약하고, 여러 앱 사이에서 정보를 옮기는 작업이 대표 사례다.[2]

여기에는 두 가지 경계가 있다.

첫째, public preview는 변경 가능성이 있는 단계다.[2] 둘째, 공식 문서도 API, MCP server, terminal command, filesystem tool, 전용 browser tool로 작업할 수 있다면 그런 도구가 더 구조화된 정보와 예측 가능한 결과를 제공한다고 설명한다.[2] 즉 Computer Use는 구조화된 인터페이스의 대체재가 아니라, **시각 인터페이스밖에 없는 구간을 연결하는 최후의 어댑터**로 보는 편이 안전하다.

GitHub의 발표는 “You remain in control”이라고 설명하면서 앱 제어 전에 Copilot이 승인을 요청하고, 사용자가 항상 허용한 앱을 검토하거나 초기화할 수 있다고 강조한다.[1] 다만 실제 승인 동작은 각 surface의 tool permission 설정을 따른다. Copilot 앱에서는 Tool Permissions, CLI에서는 현재 permission mode가 앱 제어 전 질문 여부를 결정한다.[2][3][4] 따라서 이 문구는 공급자의 통제 설명으로 이해해야지, 모든 클릭마다 사람 확인이 보장된다는 뜻으로 읽어서는 안 된다.

## GUI-only workflow는 같은 입력에도 같은 결과를 보장하지 않는다

API 호출은 endpoint, parameter, response schema를 기준으로 검증할 수 있다. GUI 자동화는 화면 상태 자체가 입력이다. GitHub도 앱 버전, 운영체제, 창 상태에 따라 인터페이스가 달라질 수 있으며, Computer Use가 잘못된 컨트롤을 선택하거나 다른 위치에 텍스트를 넣을 수 있다고 경고한다. 비표준·동적 컨트롤이나 복잡한 workflow에서는 진행이 어려울 수 있고, timing이나 창 상태 변화가 행동 반복 또는 중단을 만들 수 있다.[2]

이 비결정성을 단순 정확도 문제로 취급하면 위험하다. “저장”을 두 번 누르는 오류는 중복 레코드를 만들 수 있고, 포커스를 잃은 입력은 다른 고객의 창에 내용을 넣을 수 있다. 로딩이 끝나지 않은 상태에서 다음 단계로 넘어가면 승인 대상과 실제 대상이 달라질 수도 있다.

그러므로 workflow를 클릭 순서가 아니라 **관찰 가능한 상태 전이**로 정의해야 한다.

```text
대상 앱·창 확인
  → 현재 값 읽기
  → 변경안 입력
  → 제출 직전 예상 효과 요약
  → 사람의 최종 확인
  → 한 번만 실행
  → 결과 화면과 대상 시스템 read-back
```

“버튼을 눌렀다”는 완료 조건이 아니다. 저장 후 레코드를 다시 열어 값이 바뀌었는지, 전송 후 outbox나 대상 시스템에서 수신 상태가 확인되는지, 업로드 후 올바른 계정과 폴더에 객체가 존재하는지 읽어야 한다. 이는 GitHub가 정의한 제품 protocol이 아니라 GUI 자동화의 비결정성을 다루기 위한 운영 원칙이다. Sandbox·managed permissions·OTel의 일반 통제는 [코딩 에이전트 운영 통제 글](/blog/coding-agent-operations-sandbox-permissions-opentelemetry)로 넘기고, 여기서는 GUI의 화면 상태 전이에 집중한다.

## OS 권한은 기능 설정이 아니라 관찰·행동의 상한이다

macOS에서는 Computer Use가 두 권한 부여를 안내한다. **Accessibility**는 애플리케이션 컨트롤과 상호작용하기 위한 권한이고, **Screen Recording**은 시각적 문맥이 필요할 때 애플리케이션 창을 검사하기 위한 권한이다.[2][3][4] 둘을 “화면 자동화 허용” 하나로 뭉개면 무엇을 볼 수 있고 무엇을 조작할 수 있는지 설명하기 어렵다.

특히 화면에는 작업 대상 외의 정보가 함께 나타난다. 알림 배너, 다른 고객의 탭, 개인 메시지, 금융 정보가 screenshot이나 접근 가능한 콘텐츠의 문맥에 포함될 수 있다. GitHub 문서도 앱 창에 다른 사람의 정보를 포함한 민감 정보가 표시될 수 있으며, Copilot에 문맥으로 제공해도 되는 앱과 작업에서만 사용하라고 경고한다.[2]

실무에서는 전용 OS 계정이나 최소한의 desktop workspace를 사용하고, 불필요한 앱과 알림을 닫은 뒤 시작하는 편이 좋다. 입력 자료를 준비한 창과 결과를 기록할 창만 남기고, password manager·개인 메신저·관리자 console처럼 영향도가 큰 앱은 Computer Use 대상에서 제외한다. 이는 sandbox 설정의 반복이 아니라, **desktop visibility 자체를 최소화하는 원칙**이다.

## Always allow는 편의 기능이 아니라 수명이 긴 권한이다

Computer Use는 기본적으로 비활성화되어 있으며 사용자가 먼저 켜야 한다.[2] 승인이 필요한 경우 특정 앱에 현재 computer-use session 동안 접근을 허용하거나, **Always allow**로 향후 session까지 승인을 저장하거나, 거부할 수 있다.[2][3][4]

Always allow의 수명은 특히 주의해야 한다. 결정은 로컬에 저장되고 같은 컴퓨터의 Copilot CLI와 Copilot 앱 모두에 적용된다. 앱 설정에서 특정 앱을 목록에서 제거하면 두 surface의 향후 session에 저장된 승인은 삭제된다. 그러나 이미 실행 중인 session에 부여된 접근은 철회되지 않는다. 현재 작업을 멈추려면 Stop 또는 Esc를 사용하고, 해당 session에 부여된 앱 접근을 끝내려면 session을 종료해야 한다.[2][3]

여기서 앱 접근 요청을 decline·cancel하는 것과 CLI deny rule은 구분해야 한다. 앱 접근 거부는 요청된 앱을 제어하도록 허용하지 않는 선택이다.[3][4] 반면 GitHub가 저장 승인보다 우선한다고 설명하는 deny rule은 앱 이름별 영구 차단 목록이 아니라, CLI에서 특정 tool 또는 tool operation을 대상으로 설정하는 permission rule이다. `--deny-tool`로 지정한 규칙은 해당 CLI session에만 적용된다.[2][4][6]

따라서 승인 기록은 단순 체크박스가 아니라 다음 수명 주기를 가진다.

| 상태 | 의미 | 운영 조치 |
|---|---|---|
| 이번 session만 허용 | 현재 작업 범위의 일시적 접근 | 민감 앱의 기본 선택으로 사용 |
| Always allow | 같은 컴퓨터의 앱·CLI 향후 session에 재사용 | 저위험 앱에만 제한하고 정기 검토 |
| 저장 승인 삭제 | 향후 session의 자동 승인 제거 | 실행 중 session은 별도로 중단·종료 |
| 앱 접근 거부 | 현재 승인 요청에서 앱 제어를 허용하지 않음 | Always allow와 별개의 요청 단위 판단 |
| CLI deny rule | 특정 tool·tool operation에 적용되고 저장 승인보다 우선 | 필요한 operation pattern을 명시하고 앱별 영구 차단으로 해석하지 않음 |

앱이 업데이트되거나 계정이 바뀌고, 해당 앱에 새 관리 기능이 추가되면 과거 승인의 위험도도 달라진다. 그래서 “누가 언제 승인했는가”뿐 아니라 **어떤 앱·계정·업무 목적을 전제로 했는가**를 기록하고, OS 사용자 변경·앱 재설치·직무 변경·사고 대응 시 저장 승인을 재검토해야 한다.

## 비가역 행동 앞에서는 앱 접근 승인과 실행 승인을 분리하라

앱 제어를 허용했다는 사실은 그 앱 안의 모든 업무 결과를 승인했다는 뜻이 아니다. 발표의 앱 접근 승인은 제어 가능 여부의 경계다. 결제 제출, 메시지 발송, 계정 삭제, 외부 공개, 전자서명처럼 되돌리기 어렵거나 다른 사람에게 영향을 주는 행동은 별도의 최종 확인이 필요하다.

최종 확인 화면에는 최소한 다음 정보가 있어야 한다.

1. 실제 대상 앱과 로그인된 계정
2. 변경할 객체와 현재 값
3. 변경 후 값 또는 발송할 원문
4. 예상되는 외부 영향
5. 취소 가능 여부와 취소 기한
6. 실행 후 확인할 read-back 위치

확인 뒤 창 상태나 대상 값이 변했다면 승인을 재사용하지 말고 다시 멈춰야 한다. 승인과 실행 사이에 popup이 나타났거나 포커스가 다른 창으로 이동한 경우도 마찬가지다. 사람은 추상적인 목표가 아니라 **실행 직전의 대상과 효과**를 승인해야 한다.

GitHub 문서는 예상 밖 행동이 시작되면 Copilot 앱에서 Stop 또는 Esc, CLI에서 Esc 두 번으로 active operation을 중단할 수 있다고 안내한다.[2][3][4] 중단 기능은 피해를 줄이는 수단이지 이미 발생한 변경의 rollback은 아니다. 따라서 중단 후에는 대상 시스템을 다시 읽어 “실행 전”, “일부 반영”, “완료” 중 어느 상태인지 확인해야 한다.

## 조직 정책은 기능 사용 가능 여부를 닫는 상위 경계다

기업 관리자는 managed settings로 Computer Use를 비활성화할 수 있으며, 로컬에서 기능을 켜도 이 정책을 우회할 수 없다.[2][4] 설정 레퍼런스의 `features.computerUse: false`는 사용자가 **Copilot CLI와 GitHub Copilot 앱에서** Computer Use를 활성화하지 못하게 한다.[5] 반대로 `true`로 두거나 key를 생략하면 사용자가 로컬 설정으로 사용 여부를 정할 수 있다.[5]

이 범위를 넘어 “모든 desktop automation이 차단된다”고 해석해서는 안 된다. 문서가 보장하는 것은 해당 Copilot 기능의 활성화 통제다. 조직은 허용 전에 지원 OS, 대상 앱 목록, 민감 데이터 노출 기준, Always allow 사용 조건, 비가역 행동 목록, read-back 절차를 별도로 정해야 한다.

도입 순서는 간단하다. 먼저 조회·요약처럼 변경이 없는 단일 앱 작업으로 시작한다. 다음으로 입력은 허용하되 제출은 사람이 하는 workflow를 운영한다. 충분한 실패 사례와 복구 절차가 쌓인 뒤에만 제한된 제출 동작을 열어야 한다. GUI 자동화의 생산성은 클릭 수를 줄이는 데 있지만, 안전성은 **마지막 클릭을 언제 자동화하지 않을지** 결정하는 데 있다.

## Sources

[1] https://github.blog/changelog/2026-10-01-github-copilot-can-now-interact-with-desktop-apps/ — GitHub Changelog, “GitHub Copilot can now interact with desktop apps with computer use,” 2026-10-01
[2] https://docs.github.com/en/copilot/concepts/agents/computer-use — GitHub Docs, “About computer use in GitHub Copilot”
[3] https://docs.github.com/en/copilot/how-tos/github-copilot-app/computer-use — GitHub Docs, “Using the GitHub Copilot app to interact with desktop applications”
[4] https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/computer-use — GitHub Docs, “Using GitHub Copilot CLI to interact with desktop applications”
[5] https://docs.github.com/en/copilot/reference/enterprise-managed-settings-reference#featurescomputeruse — GitHub Docs, “Enterprise managed settings” — `features.computerUse`
[6] https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools — GitHub Docs, “Allowing and denying tool use”
