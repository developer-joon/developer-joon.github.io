---
title: '계정도 텔레메트리도 없는 로컬-first 데스크톱 도구의 귀환'
date: 2026-08-22 11:30:00 +0900
categories: ["개발/인프라"]
description: 'OpenLogi를 사례로 계정 없는 로컬 하드웨어 제어의 구조, HID와 운영체제 권한, 프라이버시 이점과 업데이트·지원의 현실적 비용을 살펴본다.'
featured_image: 'https://picsum.photos/seed/local-first-desktop-tools/1600/900'
tags: [local-first, desktop, privacy, hid, rust, open-source, hardware]
---

![로컬-first 데스크톱 도구](https://picsum.photos/seed/local-first-desktop-tools/1600/900)

마우스 버튼 하나를 바꾸거나 웹캠 노출을 조정하는 데 계정 로그인이 필요한 시대가 됐다. 주변기기 설정 앱은 device discovery, profile 동기화, firmware update, 제품 추천과 고객 지원을 하나의 cloud service로 묶는다. 여러 PC에서 설정이 자동으로 따라오는 편리함은 있지만, 단순한 hardware control까지 vendor account와 상시 background service에 의존해야 하는가라는 반론도 커졌다.

OpenLogi는 이 질문에 대한 오픈소스 실험이다. 프로젝트는 Logitech Options+의 native, local-first 대안을 표방하며 Rust로 작성됐다. Logitech mouse, keyboard와 webcam을 HID++, UVC를 통해 제어하고, 계정과 telemetry가 없다는 점을 전면에 내세운다. macOS, Linux와 Windows를 대상으로 하며 button remapping, DPI, SmartShift, camera image control, application별 profile과 CLI를 제공한다고 설명한다.

다만 “local-first”는 자동으로 안전하고 완전하다는 뜻이 아니다. 하드웨어를 직접 제어하려면 민감한 로컬 권한이 필요하고, cloud 서비스가 제공하던 동기화·업데이트·지원 비용을 사용자와 community가 나눠 부담해야 한다. OpenLogi도 아직 active development 단계이며 기능과 config가 바뀔 수 있다고 경고한다.

## 로컬-first가 다시 매력적인 이유

첫 번째 이유는 계정 피로다. peripheral 설정은 본질적으로 해당 컴퓨터와 연결된 장치의 상태를 바꾸는 작업이다. 로그인 server가 장애를 일으키거나 회사가 서비스를 종료했다고 해서 mouse DPI를 조정할 수 없어서는 안 된다는 요구는 합리적이다.

두 번째는 데이터 최소화다. 어떤 device를 사용하고 어느 application에서 어떤 profile을 활성화했는지는 생각보다 민감할 수 있다. telemetry가 제품 개선에 도움을 줄 수 있지만, 사용자가 수집 범위와 보존 기간을 검증하기 어렵다면 로컬 처리 자체가 단순한 privacy architecture가 된다. 보내지 않은 데이터는 cloud breach로 유출되지 않는다.

세 번째는 성능과 수명이다. native application과 local agent는 network round trip 없이 hardware event를 처리할 수 있다. vendor의 account API나 analytics SDK가 바뀌어도 핵심 기능이 영향을 받지 않는다. plain-text config와 CLI가 있으면 설정을 version control하거나 사용자가 선택한 동기화 도구로 옮길 수 있다.

네 번째는 Linux와 오래된 장치 지원이다. 상용 앱은 시장 규모와 지원 비용에 따라 운영체제와 device 세대를 선택한다. community project는 사용자가 직접 driver 지식과 patch를 공유해 빈틈을 메울 수 있다. 그러나 이는 가능성이지 보장된 SLA는 아니다.

## 계정 없는 하드웨어 제어의 아키텍처

OpenLogi의 README가 보여주는 구조는 GUI 하나로 끝나지 않는다. background agent가 device I/O를 소유하고 GUI와 CLI가 agent에 명령을 전달한다. Windows portable 배포에서도 GUI와 agent 실행 파일을 함께 두어야 한다고 명시하며, Linux에서는 user service로 agent를 실행한다.

```text
GUI / CLI
   ↓ 로컬 IPC
background agent
   ├── HID++ → mouse / keyboard / light
   ├── UVC   → webcam controls
   └── OS input hook → remapping / application profile

TOML configuration
   ↕ 로컬 파일 또는 사용자가 고른 동기화 방식
```

HID는 Human Interface Device의 표준 통신 계층이다. keyboard와 mouse의 기본 입력은 운영체제가 공통 방식으로 처리하지만, DPI, battery, SmartShift나 특수 button 같은 vendor 기능은 추가 protocol이 필요하다. Logitech 계열에서는 HID++가 그 역할을 한다. webcam의 zoom, focus, exposure와 white balance는 UVC control을 통해 다룰 수 있다.

이 접근의 장점은 cloud API가 data path에 들어오지 않는다는 것이다. 설정 요청은 같은 장비의 process 사이를 이동하고, 결과는 USB receiver, Bluetooth 또는 wired device로 전달된다. camera control도 hardware에 직접 기록하면 Meet, Zoom, OBS 같은 다른 application이 같은 설정을 사용할 수 있다.

하지만 local이라는 말과 offline이라는 말도 구분해야 한다. package 설치, release 확인, issue 지원이나 firmware file 확보에는 network가 필요할 수 있다. 특정 기능이 완전히 offline인지 판단하려면 실행 중 network connection을 측정하고 source와 binary가 일치하는지 확인해야 한다. repository 설명만으로 모든 build와 미래 version의 무통신을 영구 보장할 수는 없다.

## HID 접근은 강한 로컬 권한을 요구한다

cloud credential이 없다고 attack surface가 사라지는 것은 아니다. hardware configuration app은 일반 application보다 운영체제 깊숙한 곳에 접근한다.

Linux package는 `/dev/hidraw*`, `/dev/uinput`, Logitech mouse의 `/dev/input/event*`에 사용자 접근을 허용하는 udev rule을 설치한다. `hidraw`는 장치와 낮은 수준의 report를 주고받게 하고, `uinput`은 software가 입력 event를 생성하게 한다. `/dev/input/event*`를 읽을 수 있으면 사용자의 입력을 관찰할 가능성도 생긴다. rule 범위가 너무 넓으면 같은 group의 다른 process까지 권한을 얻을 수 있다.

macOS와 Windows에서도 button remapping과 global shortcut은 accessibility, input monitoring, driver 또는 hook에 해당하는 권한을 요구할 수 있다. 이런 권한은 제품 기능에 필요하지만, 악성 update가 들어오면 key 입력 관찰이나 의도하지 않은 자동화에 악용될 수 있다. “계정이 없으니 신뢰할 것이 없다”가 아니라 신뢰 대상이 cloud operator에서 local binary와 update maintainer로 이동한 것이다.

GUI와 background agent 분리는 책임을 나누는 데 유리하지만 IPC가 새로운 경계가 된다. 어떤 local process나 user가 agent에 명령을 보낼 수 있는지, message가 인증되는지, 위험한 device write를 제한하는지 확인해야 한다. root daemon보다 user service가 대체로 blast radius를 줄이지만, 입력 권한 자체는 여전히 강하다.

## local-first의 privacy는 검증 가능한가

좋은 local-first 도구는 “telemetry 없음” 문구만 내세우지 않고 구조적으로 확인할 수 있어야 한다. source code가 공개돼 있고 build dependency와 release workflow를 볼 수 있으면 출발점은 좋다. 재현 가능한 build, 서명된 release와 network access 문서가 더해지면 신뢰가 강해진다.

실무에서는 다음처럼 검증할 수 있다.

1. 깨끗한 VM에 공식 package를 설치하고 생성되는 service와 권한을 기록한다.
2. idle, device discovery, 설정 변경, update 확인 시 DNS와 outbound connection을 관찰한다.
3. config, log와 crash dump에 device identifier나 application 이름이 남는지 확인한다.
4. update checker를 끌 수 있는지, 끈 상태에서 핵심 기능이 계속 동작하는지 시험한다.
5. binary signature와 published checksum을 확인하고 source build와 동작을 비교한다.

네트워크 연결이 하나 발견됐다고 telemetry라고 단정해서도 안 된다. release check, image asset 또는 package manager metadata일 수 있다. 반대로 application process가 직접 연결하지 않아도 OS crash reporter나 package manager가 정보를 보낼 수 있다. claim의 범위와 data flow를 구체적으로 구분해야 한다.

## cloud가 사라지며 잃는 것

계정이 없는 설계는 privacy뿐 아니라 기능의 손실도 만든다. 대표적인 것이 자동 동기화다. laptop과 desktop에서 같은 button profile을 쓰려면 TOML 파일을 Git, Syncthing, iCloud Drive 같은 별도 수단으로 복제해야 한다. 충돌 해결, secret 포함 여부와 운영체제별 action 차이도 사용자가 관리한다.

두 번째는 지원이다. 상용 vendor는 device compatibility matrix, QA lab, signed driver, installer, localization과 고객 센터를 운영할 수 있다. community project는 issue와 pull request가 빠르게 문제를 해결할 때도 있지만, 특정 device나 운영체제 update에 대한 응답 시간을 보장하지 않는다. maintainer가 떠나면 release가 멈출 수도 있다.

세 번째는 update 책임이다. 자동 강제 update가 없으면 사용자는 취약한 binary를 오래 실행할 수 있다. 반대로 자동 update channel을 추가하면 local-first 도구에도 중앙 신뢰 지점이 생긴다. maintainer account나 signing key가 탈취되면 강한 input 권한을 가진 악성 binary가 배포될 수 있다. 서명, checksum, staged rollout과 rollback이 필요한 이유다.

네 번째는 firmware와 vendor 지식이다. reverse-engineered protocol은 새 device에서 동작하지 않거나 잘못된 command가 예상치 못한 상태를 만들 수 있다. firmware update는 특히 실패 시 device를 사용할 수 없게 만들 수 있으므로, community tool이 지원하지 않는다면 공식 도구를 병행해야 할 수 있다.

다섯 번째는 UX 일관성이다. README에 나열된 기능은 운영체제별로 차이가 있다. 예를 들어 application별 profile은 Linux에서 X11 또는 XWayland 조건이 있고, 일부 platform action은 대응 기능이 없어 no-op일 수 있다. “cross-platform”은 모든 플랫폼의 모든 기능이 동일하다는 의미가 아니다.

## OpenLogi를 평가할 때 확인할 것

OpenLogi는 Bolt receiver, Unifying receiver, Bluetooth와 wired 연결을 설명하고 mouse, keyboard, light와 webcam 기능을 폭넓게 나열한다. 그러나 도입 결정은 프로젝트 전체 기능 목록이 아니라 내가 가진 정확한 model과 OS 조합으로 내려야 한다.

먼저 기존 Options+를 종료해야 한다. README는 두 application이 HID++ access를 두고 충돌하며 하나만 receiver를 소유할 수 있다고 경고한다. 동시에 실행한 상태에서 생긴 오류를 제품 결함으로 오인하지 않아야 한다.

그다음 핵심 기능을 작은 표로 만든다. device discovery, battery, 기본 button remap, gesture, DPI, SmartShift, application profile, sleep/wake 복구를 각각 시험한다. webcam은 preview를 닫았을 때 camera가 release되고 LED가 꺼지는지, 설정이 다른 video application에도 반영되는지 확인한다.

설정 파일은 backup하고 schema 변경에 대비한다. 프로젝트가 아직 안정화되지 않았으므로 update 전 changelog를 읽고 이전 binary와 config로 rollback할 방법을 남겨야 한다. 업무용 장비라면 회의 직전이 아니라 별도 사용자 계정이나 예비 장치에서 먼저 시험하는 편이 안전하다.

## 실무 체크리스트

- [ ] 정확한 device model, receiver 종류와 운영체제 version을 기록했다.
- [ ] 필요한 기능이 해당 platform과 연결 방식에서 지원되는지 확인했다.
- [ ] 기존 vendor application을 완전히 종료한 뒤 테스트했다.
- [ ] 설치 package의 출처, signature와 checksum을 확인했다.
- [ ] background agent가 어떤 사용자와 권한으로 실행되는지 확인했다.
- [ ] Linux udev rule이 불필요하게 넓은 장치 접근을 허용하지 않는지 검토했다.
- [ ] macOS·Windows의 accessibility와 input 권한을 최소화했다.
- [ ] local IPC가 다른 process의 임의 명령을 제한하는지 살펴봤다.
- [ ] idle, 설정 변경과 update check의 outbound traffic을 측정했다.
- [ ] config와 log에 민감한 application 이름이나 입력 내용이 남는지 확인했다.
- [ ] 핵심 button, DPI, profile과 sleep/wake 시나리오를 실제 장치로 시험했다.
- [ ] update 전 config backup과 이전 version rollback 절차를 준비했다.
- [ ] firmware update와 긴급 복구를 위해 공식 도구가 필요한지 판단했다.
- [ ] 유지보수 중단 시 사용할 대체 도구와 기본 hardware 설정을 남겼다.

## 결론

로컬-first 데스크톱 도구의 귀환은 cloud 자체에 대한 거부라기보다 의존성의 재배치다. device control처럼 로컬에서 끝낼 수 있는 작업을 계정, analytics와 remote service에서 분리하면 privacy, 응답성, offline 내구성과 사용자 통제권을 얻을 수 있다. plain-text config와 CLI는 자동화와 장기 보존에도 유리하다.

대신 사용자는 더 많은 책임을 맡는다. 강한 HID와 input 권한을 검토하고, release 출처를 확인하며, 동기화와 backup을 선택하고, community support의 불확실성을 감수해야 한다. telemetry가 없다는 사실은 update 공급망과 local privilege 위험까지 없애지 않는다.

OpenLogi는 이 균형을 관찰하기 좋은 사례다. 계정 없이 다양한 Logitech 장치를 직접 제어하고 Linux를 일급 platform으로 다루려는 방향은 매력적이다. 동시에 프로젝트가 아직 안정화 단계가 아니며 platform별 기능 차이와 권한 요구가 분명하다.

좋은 local-first 도구를 고르는 기준은 “cloud가 없는가” 하나가 아니다. 핵심 기능이 network 없이 지속되는지, 권한이 최소화됐는지, build와 update를 검증할 수 있는지, 유지보수가 멈춰도 데이터와 장치를 되찾을 수 있는지를 함께 봐야 한다. local-first의 진짜 가치는 모든 책임을 없애는 데 있지 않고, 그 책임을 사용자가 이해하고 선택 가능한 곳으로 돌려놓는 데 있다.

## 참고 자료

- [OpenLogi GitHub Repository](https://github.com/AprilNEA/OpenLogi)
