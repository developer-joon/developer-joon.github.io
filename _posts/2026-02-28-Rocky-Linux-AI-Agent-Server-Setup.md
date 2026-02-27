---
title: 'Rocky Linux에서 AI 에이전트 서버 세팅 삽질기 — Chrome CDP, 한글 입력, Wayland까지'
date: 2026-02-28 00:00:00
description: 'Rocky Linux 서버에 AI 에이전트를 올리면서 겪은 삽질 기록. Chrome CDP 원격 디버깅 연결, IBus 한글 입력 문제, Wayland 환경 이슈까지 시행착오와 해결 과정을 공유합니다.'
featured_image: '/images/2026-02-28-Rocky-Linux-AI-Agent-Server-Setup/cover.jpg'
tags: [ai-agent, linux, 삽질기, 수익실험]
---

![Rocky Linux AI 에이전트 서버 세팅](/images/2026-02-28-Rocky-Linux-AI-Agent-Server-Setup/cover.jpg)

## 왜 Rocky Linux였나

AI 에이전트를 24시간 돌릴 서버가 필요했다. AWS나 GCP 같은 클라우드도 고려했지만, 이미 집에 놀고 있는 서버가 있었고, 무엇보다 **월 비용 0원**이라는 매력을 이길 수 없었다.

OS 선택은 사실 고민할 것도 없었다. 회사에서 RHEL 계열을 쓰고 있어서 손에 익은 Rocky Linux를 선택했다. CentOS가 사라진 자리를 Rocky가 잘 메워주고 있어서 신뢰도 있었다. Ubuntu가 더 편하다는 건 인정하지만, SELinux랑 firewalld에 이미 길들여진 몸이라... 😅

근데 이 선택이 나중에 꽤나 많은 삽질을 불러올 줄은 몰랐다.

---

## Chrome CDP 연결 — 생각보다 험난한 길

![Chrome CDP 디버깅](/images/2026-02-28-Rocky-Linux-AI-Agent-Server-Setup/chrome-cdp.jpg)

AI 에이전트가 웹 브라우저를 제어하려면 **Chrome DevTools Protocol(CDP)** 연결이 필수다. 웹사이트 자동 조작, 스크린샷 촬영, 폼 입력 등 거의 모든 브라우저 자동화가 CDP를 통해 이루어진다.

### 첫 번째 벽: Chrome 설치부터 막힘

Rocky Linux에서 Chrome 설치는 Ubuntu만큼 깔끔하지 않다. `yum`이나 `dnf`로 바로 설치할 수 있긴 한데, 의존성 문제가 발목을 잡는다.

```bash
# Google Chrome 저장소 추가
sudo dnf install -y google-chrome-stable

# 근데 이런 에러가...
Error: Package google-chrome-stable requires libvulkan.so.1
```

GPU 관련 라이브러리가 없다고 난리를 친다. 서버에 GPU가 없으니 당연한 건데, Chrome은 GPU 없어도 돌아가거든. 해결은 간단했다:

```bash
sudo dnf install -y vulkan-loader mesa-libGL
```

### 두 번째 벽: headless vs headed

서버니까 당연히 headless로 돌리면 된다고 생각했다. 근데 AI 에이전트가 하는 일 중에 **실제 화면이 필요한 작업**이 있다. 예를 들어 동행복권 같은 사이트는 headless 브라우저를 감지해서 차단한다.

그래서 결국 **Xvfb(가상 디스플레이)** 없이 실제 데스크톱 환경을 올리기로 했다.

```bash
# GNOME 데스크톱 설치 (최소)
sudo dnf groupinstall -y "Server with GUI"
sudo systemctl set-default graphical.target
sudo systemctl start gdm
```

여기서 문제가 시작된다. Rocky Linux 9부터 기본 디스플레이 서버가 **Wayland**다.

### 세 번째 벽: CDP 원격 디버깅 포트

Chrome을 CDP 모드로 띄우는 건 간단하다:

```bash
google-chrome-stable --remote-debugging-port=9222
```

근데 AI 에이전트 프로세스에서 이 포트에 접속이 안 된다. `curl http://localhost:9222/json/version` 하면 **connection refused**.

원인은 두 가지였다:

1. **Chrome이 이미 떠있으면** 새 인스턴스가 기존 프로세스에 합류해서 디버깅 포트가 무시됨
2. **user-data-dir 충돌** — 같은 프로필 디렉토리를 쓰면 안 됨

해결:

```bash
# 기존 Chrome 프로세스 전부 종료
pkill -f chrome

# 전용 user-data-dir로 실행
google-chrome-stable \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-ai-agent \
  --no-first-run \
  --disable-default-apps \
  --disable-blink-features=AutomationControlled
```

마지막 `--disable-blink-features=AutomationControlled` 플래그는 자동화 감지를 우회하기 위한 건데, 이것만으로는 부족하다는 걸 나중에 [로또 자동구매 삽질](/blog/lotto-auto-purchase-ai-agent)에서 뼈저리게 배웠다.

### 네 번째 벽: systemd 서비스로 등록

Chrome을 수동으로 매번 띄울 수는 없다. 서버 재부팅하면 꺼지니까. systemd 서비스로 만들었는데, 여기서 또 삽질:

```ini
[Unit]
Description=Chrome Browser for AI Agent
After=graphical.target

[Service]
Type=simple
Environment=DISPLAY=:0
ExecStart=/usr/bin/google-chrome-stable --remote-debugging-port=9222 ...
Restart=on-failure

[Install]
WantedBy=graphical.target
```

이렇게 하면 될 것 같지? **안 된다.** `DISPLAY=:0`만으로는 Wayland 환경에서 GUI 앱을 띄울 수 없다. `DBUS_SESSION_BUS_ADDRESS`도 필요하고, 로그인한 사용자의 세션 컨텍스트가 있어야 한다.

결국 `systemd --user` 서비스로 바꿔야 했다:

```bash
# ~/.config/systemd/user/chrome-cdp.service
systemctl --user enable chrome-cdp.service
systemctl --user start chrome-cdp.service

# 로그인 없이도 user 서비스가 돌게
loginctl enable-linger $(whoami)
```

이 `enable-linger`를 몰라서 3시간은 날린 것 같다. 서버 재부팅할 때마다 Chrome이 안 뜨길래 미칠 뻔했는데, `linger`가 꺼져 있으면 사용자가 로그인하지 않은 상태에서 user 서비스가 시작되지 않는다.

---

## Wayland — 예상 밖의 복병

![Wayland 이슈](/images/2026-02-28-Rocky-Linux-AI-Agent-Server-Setup/wayland-issue.jpg)

Rocky Linux 9의 기본 디스플레이 서버는 X11이 아니라 **Wayland**다. 개발 환경에서는 큰 차이를 못 느꼈는데, 서버에서 AI 에이전트를 돌리니까 곳곳에서 문제가 터졌다.

### 스크린샷이 안 찍힌다

AI 에이전트가 현재 화면 상태를 확인하려면 스크린샷을 찍어야 한다. X11에서는 `xdotool`이나 `scrot`으로 간단하게 되는데, Wayland에서는 이것들이 **전혀 동작하지 않는다**.

```bash
# X11에서는 잘 되던 것들이...
$ scrot /tmp/screenshot.png
# → 검은 화면만 캡처됨

$ xdotool getactivewindow
# → 에러: XGetInputFocus returned revert_to 1
```

Wayland는 보안 모델이 X11과 근본적으로 다르다. 한 애플리케이션이 다른 애플리케이션의 윈도우를 마음대로 캡처하거나 조작할 수 없다. 보안적으로는 좋은 건데, 자동화 관점에서는 재앙이다.

해결책은 GNOME의 D-Bus 인터페이스를 사용하는 것이었다:

```bash
# Wayland에서 스크린샷 찍기
DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \
  gnome-screenshot -w -f /tmp/screenshot.png
```

`DBUS_SESSION_BUS_ADDRESS`를 환경변수로 꼭 넘겨줘야 한다. 이걸 빼먹으면 "Failed to connect to the bus" 에러가 뜬다. 크론이나 systemd에서 실행할 때 자주 빠트리는 부분이다.

### 키보드 입력 자동화가 안 된다

`xdotool type "hello"` — X11에서는 이걸로 끝이었다. Wayland? 안 된다.

Wayland에서 키보드 입력 시뮬레이션을 하려면 `wtype`이나 `ydotool` 같은 별도 도구가 필요한데, Rocky Linux 공식 저장소에는 없다.

사실 AI 에이전트가 CDP를 통해 브라우저를 제어하기 때문에 브라우저 안에서의 입력은 문제가 없다. 문제는 브라우저 **밖**에서 뭔가를 해야 할 때인데, 대부분의 작업은 CDP로 해결되니까 우선순위를 낮추고 넘어갔다.

> **교훈**: Rocky Linux에서 AI 에이전트 서버를 세팅한다면, 가능하면 X11 세션으로 로그인하는 걸 추천한다. GDM 로그인 화면에서 톱니바퀴를 누르면 "GNOME on Xorg" 옵션이 있다. Wayland의 보안 모델은 서버 자동화와 상극이다.

---

## IBus 한글 입력 — 보이지 않는 함정

![한글 입력 문제](/images/2026-02-28-Rocky-Linux-AI-Agent-Server-Setup/ibus-hangul.jpg)

AI 에이전트가 한국 웹사이트에서 한글을 입력해야 하는 상황이 있다. 검색창에 한글을 치거나, 폼에 한글 이름을 넣거나. CDP의 `Input.dispatchKeyEvent`로 키 입력을 보내면 되는데... **한글이 깨진다**.

### 증상

CDP로 "안녕하세요"를 입력하면 `ㅇㅏㄴㄴㅕㅇㅎㅏㅅㅔㅇㅛ`가 들어간다. 자모가 조합되지 않고 하나씩 풀어져서 들어가는 것이다.

### 원인

Linux에서 한글 입력은 **IBus(Intelligent Input Bus)** 입력기를 거쳐야 한다. CDP의 키 이벤트는 이 입력기를 바이패스하기 때문에 조합이 안 되는 것.

### 해결

결론부터 말하면, CDP로 한글을 입력할 때는 `Input.dispatchKeyEvent` 대신 **`Input.insertText`**를 써야 한다:

```javascript
// ❌ 이렇게 하면 자모가 풀린다
await cdp.send('Input.dispatchKeyEvent', {
  type: 'keyDown', key: '안'
});

// ✅ 이렇게 해야 조합된 한글이 들어간다
await cdp.send('Input.insertText', {
  text: '안녕하세요'
});
```

`insertText`는 IME를 거치지 않고 **이미 조합된 텍스트를 직접 삽입**하기 때문에 한글이 정상적으로 들어간다.

근데 이것만으로 끝이 아니다. 일부 사이트는 `insertText`로 입력하면 **React의 onChange 이벤트가 발생하지 않는** 경우가 있다. 이때는 입력 후에 수동으로 이벤트를 디스패치해줘야 한다:

```javascript
// insertText 후 이벤트 트리거
await cdp.send('Runtime.evaluate', {
  expression: `
    const input = document.querySelector('#search-input');
    const event = new Event('input', { bubbles: true });
    input.dispatchEvent(event);
  `
});
```

### IBus 설정도 해줘야 한다

서버에 IBus Hangul이 설치되어 있지 않으면 GUI에서 한글 입력 자체가 안 된다:

```bash
sudo dnf install -y ibus-hangul
ibus write-cache
```

그리고 `/etc/environment`에 IME 관련 환경변수를 추가:

```bash
GTK_IM_MODULE=ibus
QT_IM_MODULE=ibus
XMODIFIERS=@im=ibus
```

VNC나 원격 데스크톱으로 접속할 때도 이 설정이 빠져 있으면 한글 입력이 안 되니 참고하자.

---

## SELinux와 방화벽 — 잊을 만하면 찾아오는 친구

Rocky Linux의 SELinux는 기본이 **enforcing**이다. 보안 면에서는 훌륭한데, AI 에이전트 같은 비표준 서비스를 돌릴 때는 온갖 "Permission denied"의 향연이 펼쳐진다.

### CDP 포트 접근 차단

Chrome의 9222 포트에 로컬에서 접근하는 것도 SELinux가 막는 경우가 있다:

```bash
# audit 로그에서 차단 기록 확인
sudo ausearch -m avc -ts recent

# type=AVC msg=audit(...): avc:  denied  { name_connect } for  
# dest=9222 scontext=system_u:system_r:... tcontext=...
```

해결은 SELinux 정책을 추가하거나, 해당 포트를 허용 타입으로 등록:

```bash
sudo semanage port -a -t http_port_t -p tcp 9222
```

`setenforce 0`으로 끄고 싶은 유혹이 매번 들지만, **절대 권장하지 않는다**. SELinux를 끄는 건 현관문 열어놓고 자는 것과 같다. 정책 추가가 귀찮아도 enforcing을 유지하자.

### firewalld 설정

외부에서 CDP 포트에 접근하면 안 되니까 방화벽 설정도 확인:

```bash
# CDP 포트는 로컬에서만 접근 가능하게
sudo firewall-cmd --zone=public --list-ports
# 9222가 열려있으면 절대 안 됨!
```

기본적으로 닫혀 있지만, 삽질하다가 테스트용으로 열어놓고 까먹는 경우가 있다. **CDP 포트가 외부에 노출되면 누구나 내 브라우저를 제어할 수 있다.** 주기적으로 확인하자.

---

## 시행착오 모음 — 이것만은 기억하자

![트러블슈팅](/images/2026-02-28-Rocky-Linux-AI-Agent-Server-Setup/troubleshooting.jpg)

서버 세팅하면서 겪은 잡다한 시행착오들을 정리해본다. 각각은 사소하지만, 합치면 하루 이틀은 쉽게 날아간다.

### 1. `dnf update` 후 Chrome이 안 뜸

시스템 업데이트 후 Chrome이 시작되지 않는 경우가 있다. 대부분 **NSS(Network Security Services)** 라이브러리 버전 불일치가 원인이다:

```bash
# Chrome 에러 로그
[ERROR:nss_util.cc] Failed to load NSS libraries

# 해결
sudo dnf reinstall -y nss nss-util nss-sysinit
```

### 2. 타임존 문제

크론 작업이 이상한 시간에 돌거나, 로그 타임스탬프가 안 맞으면 타임존을 확인하자:

```bash
timedatectl set-timezone Asia/Seoul
```

당연한 거 아니냐고? 서버 초기 세팅할 때 UTC로 놔두고 까먹는 사람이 생각보다 많다. 나도 그랬다.

### 3. `/tmp` 자동 정리

systemd-tmpfiles가 `/tmp`를 주기적으로 정리한다. Chrome의 `user-data-dir`을 `/tmp` 하위에 뒀더니, **어느 날 갑자기 Chrome이 초기화**된다. 세션, 쿠키, 다 날아갔다.

```bash
# /tmp 대신 영구적인 경로 사용
--user-data-dir=/home/YOUR_USER/.chrome-ai-agent
```

### 4. swap 부족으로 Chrome 크래시

Chrome은 메모리를 많이 먹는다. 서버 RAM이 넉넉하지 않으면 swap을 충분히 잡아놓자:

```bash
# swap 상태 확인
free -h

# swap이 부족하면 추가
sudo dd if=/dev/zero of=/swapfile bs=1G count=4
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### 5. journald 로그 폭발

AI 에이전트와 Chrome이 로그를 엄청나게 쏟아낸다. 며칠 지나면 `/var/log/journal`이 몇 GB씩 차 있다:

```bash
# 로그 용량 제한
sudo journalctl --vacuum-size=500M

# 영구 설정: /etc/systemd/journald.conf
SystemMaxUse=500M
```

---

## 최종 아키텍처

삽질 끝에 안정화된 구조를 정리하면 이렇다:

| 구성 요소 | 선택 | 비고 |
|-----------|------|------|
| **OS** | Rocky Linux 9 | RHEL 호환, SELinux enforcing |
| **디스플레이** | Wayland (GNOME) | 가능하면 X11 추천 |
| **브라우저** | Google Chrome | CDP 9222 포트 (로컬 전용) |
| **한글 입력** | IBus Hangul | CDP에서는 insertText 사용 |
| **프로세스 관리** | systemd --user | linger 활성화 필수 |
| **보안** | SELinux + firewalld | CDP 포트 외부 차단 |
| **AI 에이전트** | OpenClaw | Claude 기반 |

이 구조로 한 달 넘게 운영하고 있는데, 안정적이다. 가끔 Chrome이 메모리 누수로 느려지면 에이전트가 알아서 재시작하도록 크론을 걸어두었고, 시스템 업데이트 후에는 수동으로 확인하는 습관을 들였다.

---

## 마치며 — 리눅스 서버 삽질의 교훈

솔직히 처음에는 "서버에 Chrome 띄우고 에이전트 연결하면 끝 아닌가?" 싶었다. **세상에 끝인 것은 없다.** Wayland, SELinux, IBus, systemd... 각각은 다 이유 있는 기술들인데, 이걸 한꺼번에 엮으니까 예상 못한 조합의 문제가 터진다.

돌이켜보면 가장 큰 교훈은 이거다:

> **"공식 문서에 없는 문제는 대부분 환경 조합에서 온다."**

Chrome CDP 공식 문서에는 Linux 서버 환경을 크게 다루지 않는다. IBus 문서에는 CDP 연동 이야기가 없다. Wayland 문서에는 자동화 도구 호환성이 잘 안 나온다. 근데 이 세 개를 조합하면 새로운 차원의 삽질이 열린다.

그래도 한번 세팅해놓으면 편하다. 24시간 돌아가는 AI 비서가 [로또도 사주고](/blog/lotto-auto-purchase-ai-agent), [트레이딩봇도 돌려주고](/blog/trading-bot-lessons-learned), 블로그 글도 써준다(이 글도 사실...). 초기 삽질 비용을 충분히 회수하고 있다.

Rocky Linux에서 AI 에이전트 서버를 세팅하려는 분들에게 이 글이 삽질 시간을 줄여주길 바란다. 🐧

---

## 참고 링크

- [Chrome DevTools Protocol 공식 문서](https://chromedevtools.github.io/devtools-protocol/)
- [Rocky Linux 9 공식 문서](https://docs.rockylinux.org/)
- [IBus 한글 GitHub](https://github.com/libhangul/ibus-hangul)
- [Wayland 프로토콜 문서](https://wayland.freedesktop.org/docs/html/)
- [systemd 사용자 서비스 가이드](https://wiki.archlinux.org/title/Systemd/User)
