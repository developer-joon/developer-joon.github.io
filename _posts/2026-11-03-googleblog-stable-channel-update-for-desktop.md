---
title: '보안 수정 212건이 포함된 Chrome 157 배포를 하루에 검증하는 방법'
date: 2026-11-03 09:00:34 +0900
categories: ["개발/보안"]
description: 'Chrome 157 안정 채널의 플랫폼별 버전과 212건의 보안 수정을 기준으로, 직원 PC와 CI 브라우저 이미지를 함께 검증하는 인벤토리를 만든다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-googleblog-stable-channel-update-for-desktop/1600/900'
tags: [chrome-157, chromium, browser-security, patch-management, playwright, selenium]
---

![여러 갈래 철길이 모이는 도심 역](https://picsum.photos/seed/news-2026-11-03-googleblog-stable-channel-update-for-desktop/1600/900)

Chrome 보안 업데이트는 직원 노트북에서만 끝나지 않는다. Playwright·Selenium runner, kiosk, VDI, 원격 브라우저, container image에도 별도의 Chrome/Chromium binary가 남는다.

Google은 2026년 11월 3일 Chrome 157을 Windows, macOS, Linux 안정 채널로 승격했다. Linux는 157.0.8103.38, Windows와 macOS는 157.0.8103.38/.39이며, 며칠에서 몇 주에 걸쳐 배포된다고 밝혔다.[1][2]

현재 공식 feed는 이 update에 212건의 보안 수정이 포함됐다고 기록한다.[2] 초기 source map의 213건과 달라 이 글은 **현재 canonical feed의 212건**을 따른다. Google이 집계한 수정 수는 독립 검증치가 아니고, 개별 bug detail은 다수 사용자가 수정본으로 이동할 때까지 제한될 수 있다.[2]

## 버전 하나로 모든 플랫폼을 재단하지 않는다

| 대상 | 공식 최초 안정 채널 값 | 운영 확인 |
|---|---|---|
| Linux desktop | 157.0.8103.38 | 실행 중 binary와 package |
| Windows | 157.0.8103.38 또는 .39 | 정책, 재시작 뒤 실행 버전 |
| macOS | 157.0.8103.38 또는 .39 | app bundle과 실행 process |
| CI/container | 이미지마다 다름 | image digest 안의 binary |

단계적 rollout이므로 “stable 발표일에 모든 장비가 같은 build”라고 가정하지 않는다.[2] Enterprise 정책이 update를 지연하거나, 브라우저가 열린 채로 새 binary를 활성화하지 못할 수도 있다.

## 읽기 전용 수집 예시

```bash
#!/usr/bin/env bash
set -euo pipefail

for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then
    path=$(command -v "$candidate")
    printf 'binary=%s path=%s version=%s\n' \
      "$candidate" "$path" "$("$path" --version)"
  fi
done
```

이 snippet은 **제안된 inventory 예시이며 이 글에서 실행한 fixture가 아니다.** macOS와 Windows는 공식 관리 도구나 EDR inventory를 사용하고, browser process를 강제 종료하지 않는다.

## 직원 PC와 CI를 같은 표에 넣는다

브라우저 patch KPI가 endpoint 관리 도구만 보면 CI가 빠진다. 다음 consumer를 별도 행으로 센다.

- 직원용 Chrome stable
- VDI와 kiosk
- Playwright bundled browser
- Selenium grid node
- PDF·screenshot service
- Electron/Chromium embedded application
- build image에 설치된 system Chrome

Playwright가 자체 Chromium revision을 가져올 수 있으므로 `google-chrome --version` 결과를 상속하지 않는다. 각 test job이 실제 실행한 executable path와 image digest를 확인한다.

## 24시간 검증 runbook

### 1단계: 기준선을 고정한다

발표 URL, feed updated 시각, 플랫폼별 목표 build를 저장한다. 수정 수가 바뀌면 headline KPI만 고치지 말고 어떤 snapshot을 사용했는지 남긴다.

### 2단계: 실행 중 버전을 수집한다

설치 package보다 실행 process를 우선한다. 새 binary가 disk에 있어도 재시작하지 않은 process가 이전 build일 수 있다.

### 3단계: update policy를 분류한다

`auto`, `deferred`, `pinned`, `unknown`을 구분한다. 테스트 lab의 의도적 pin과 소유자 없는 장기 지연을 같은 예외로 두지 않는다.

### 4단계: container를 rebuild한다

mutable base tag를 다시 pull하는 것만으로 완료하지 않는다. 새 digest로 build하고, registry와 배포 환경에서 digest가 일치하는지 확인한다.

### 5단계: 기능 smoke test와 security state를 분리한다

로그인, 인증서, proxy, download, WebGL 같은 핵심 flow가 정상인지 확인한다. Smoke test 통과는 CVE별 exploit 부재를 증명하지 않지만 rollout 회귀를 찾는 데 필요하다.

## 완료 상태 모델

```text
inventory_state: found | missing | unknown
artifact_state: below_target | target_or_newer | vendor_backport | unknown
activation_state: installed | restart_required | running_new
policy_state: auto | deferred_approved | pinned_expired | unknown
```

이 상태명은 Chrome provider field가 아니라 운영 제안이다. `installed`를 `running_new`로 자동 승격하지 않는다.

완료 조건은 관리 대상 endpoint 비율 하나가 아니다. CI와 자동화 workload를 포함한 모든 browser consumer에 실행 binary, version, artifact identity, 확인 시각이 있어야 한다. Chrome 157 발표의 실무 가치는 212라는 큰 숫자보다 **브라우저가 숨어 있는 위치를 드러내는 inventory 훈련**에 있다.

## Sources

[1] https://chromereleases.googleblog.com/2026/11/stable-channel-update-for-desktop.html
[2] https://chromereleases.googleblog.com/feeds/posts/default/881706046432431947?alt=json
