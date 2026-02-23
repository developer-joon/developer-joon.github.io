---
title: 'AI 에이전트로 로또 자동구매 삽질기 - 안티봇 우회부터 MutationObserver까지'
date: 2026-02-24 00:00:00
description: 'AI 에이전트로 동행복권 로또6/45 자동구매를 시도하며 겪은 삽질기. 안티봇 감지 우회, 동적 DOM 변화 대응, MutationObserver 해결 과정을 경험 기반으로 정리했습니다.'
featured_image: '/images/2026-02-24-Lotto-Auto-Purchase-AI-Agent/cover.jpg'
---

![AI 에이전트 로또 자동구매 삽질기 커버](/images/2026-02-24-Lotto-Auto-Purchase-AI-Agent/cover.jpg)

"AI 비서한테 로또 사달라고 시키면 되지 않나?"

단순한 발상이었다. AI 에이전트가 브라우저를 제어할 수 있으니, 동행복권 사이트에 들어가서 자동번호 5장 찍고 구매 버튼 누르면 끝 아닌가? 그렇게 시작된 로또 자동구매 프로젝트는, 예상대로 단순하지 않았다. 이 글은 그 삽질의 기록이다.

## 왜 로또 자동구매를 자동화하려 했나?

매주 금요일마다 동행복권 사이트에 접속해서 로또를 사는 건 솔직히 귀찮다. 금액도 5,000원(5장)이고 어차피 자동번호인데, 이걸 왜 내가 직접 해야 하지? AI 에이전트 서버를 구축한 김에, 크론 잡으로 매주 금요일 저녁 7시에 자동으로 구매하도록 만들면 완벽하지 않을까.

계획은 심플했다:

1. 크론 잡이 매주 금요일 19:00에 에이전트를 깨운다
2. 에이전트가 브라우저를 열고 동행복권 구매 페이지로 이동
3. 자동번호 5장 선택 → 구매 → 결과 캡처
4. 텔레그램으로 결과 알림

끝. 이론적으로는.

## 첫 번째 벽: 브라우저 제어 환경 구축

![브라우저 자동화 환경 구축](/images/2026-02-24-Lotto-Auto-Purchase-AI-Agent/browser-automation.jpg)

### 크롬 확장 릴레이? 리눅스에서는 불안정

처음에는 크롬 확장(Browser Relay) 방식으로 브라우저를 제어하려 했다. 데스크톱 환경에서는 잘 동작하는 방식인데, 리눅스 서버 환경에서는 이야기가 달랐다.

```
Error: No tab attached. Click the Browser Relay toolbar icon to attach.
```

이 에러를 수도 없이 봤다. 확장 프로그램이 탭을 잡지 못하거나, 잡더라도 중간에 연결이 끊기는 일이 빈번했다. 특히 크론 잡처럼 무인 환경에서는 "툴바 아이콘을 클릭하라"는 안내가 아이러니의 극치다. 클릭할 사람이 없는데.

### CDP 직접 연결로 전환

결국 Chrome DevTools Protocol(CDP)을 직접 사용하는 방식으로 바꿨다. 크롬을 `--remote-debugging-port` 옵션으로 실행하고, 에이전트가 CDP로 직접 연결하는 구조다.

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/path/to/debug-profile \
  --no-first-run \
  --disable-default-apps &
```

여기서 중요한 삽질 포인트: **기존 크롬 프로필로는 디버깅 포트가 안 열린다.** 이미 실행 중인 크롬 인스턴스가 있으면 새 인스턴스가 기존 것에 합류해버려서 디버깅 포트 옵션이 무시된다. 반드시 별도 `--user-data-dir`을 지정해야 한다.

이것만 알아내는 데 한참 걸렸다. 크롬이 조용히 실패하거든. 에러도 안 뱉고 그냥 기존 창이 하나 더 뜰 뿐이다.

```
# 이렇게 하면 안 됨 (기존 프로필)
google-chrome --remote-debugging-port=9222

# 이렇게 해야 함 (별도 프로필)
google-chrome --remote-debugging-port=9222 --user-data-dir=/별도/경로
```

별도 프로필을 만든 뒤에는 동행복권 사이트에 다시 로그인해야 했다. 쿠키가 없으니 당연한 건데, 이걸 깜빡해서 "왜 구매 페이지가 안 뜨지?" 하고 또 삽질했다.

## 두 번째 벽: 동행복권 사이트의 안티봇 감지

![디버깅 과정](/images/2026-02-24-Lotto-Auto-Purchase-AI-Agent/debugging.jpg)

브라우저 연결에 성공하고 동행복권 구매 페이지에 접근했다. 이제 버튼만 누르면 되겠지? 아니, 그렇지 않았다.

### PC 버전 vs 모바일 버전

동행복권은 PC 버전(`ol.dhlottery.co.kr`)과 모바일 버전의 DOM 구조가 완전히 다르다. 모바일 버전으로 접근하면 에이전트가 요소를 찾지 못한다. User-Agent나 뷰포트 크기에 따라 리다이렉트되는 경우가 있어서, PC 버전 URL을 명시적으로 지정해야 했다.

### 동적 DOM과의 전쟁

동행복권 구매 페이지는 상당히 동적이다. 번호 선택 영역이 처음에는 비어 있다가, 자바스크립트로 렌더링된다. 에이전트가 페이지 로드 직후 버튼을 클릭하려고 하면:

```
Error: Element not found - selector '#num1'
```

요소가 아직 렌더링되지 않은 것이다. 단순히 `setTimeout`으로 기다리는 것도 한계가 있다. 네트워크 상태에 따라 렌더링 시간이 달라지기 때문이다.

### 로또 구매 UI의 함정

로또 구매 프로세스는 생각보다 단계가 많다:

1. 구매 페이지 접속
2. "자동" 선택
3. 매수(장 수) 설정
4. "확인" 클릭
5. 구매 확인 팝업에서 "확인" 클릭
6. 최종 결과 확인

각 단계마다 DOM이 변하고, 팝업이 뜨고, 확인 버튼의 위치와 selector가 달라진다. 특히 구매 확인 팝업은 `layer` 방식으로 뜨는데, 일반적인 `alert`이나 `confirm`이 아니라 커스텀 레이어라서 에이전트가 처리하는 방식이 달랐다.

## 세 번째 벽: MutationObserver로 동적 DOM 대응

여기서 핵심 삽질이 있었다. 구매 버튼을 클릭한 뒤, 결과가 DOM에 반영되는 시점을 어떻게 알 수 있을까?

### 폴링(Polling)의 한계

처음에는 단순 폴링을 시도했다:

```javascript
// 이런 식으로 결과를 기다림
let retries = 0;
while (retries < 10) {
  const result = document.querySelector('.result-area');
  if (result && result.textContent.trim()) break;
  await sleep(1000);
  retries++;
}
```

문제는 타이밍이다. 너무 일찍 체크하면 아직 결과가 없고, 너무 늦게 체크하면 시간 낭비다. 그리고 네트워크 지연이 크면 10초도 부족할 수 있다.

### MutationObserver 도입

결국 `MutationObserver`를 사용해서 DOM 변화를 감지하는 방식으로 전환했다. 특정 요소의 하위 트리가 변경되면 콜백을 받는 구조다.

```javascript
// DOM 변화를 감지해서 구매 결과를 확인
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      const resultElement = document.querySelector('.buy-result');
      if (resultElement) {
        // 구매 결과 감지 완료
        observer.disconnect();
        resolve(resultElement.textContent);
      }
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
```

이 방식은 폴링보다 훨씬 안정적이었다. DOM이 변경되는 즉시 반응하니까 타이밍 문제가 사라졌다.

### 하지만 또 다른 함정

MutationObserver가 **너무 많은 변화를 감지**하는 문제가 있었다. 동행복권 사이트는 백그라운드에서도 계속 DOM을 업데이트하고 있었고, 의미 없는 변화까지 전부 콜백으로 들어왔다. 필터링 로직을 추가해서 구매 결과와 관련된 변화만 처리하도록 수정해야 했다.

## 네 번째 벽: 구매 결과 캡처

![코드로 해결한 순간](/images/2026-02-24-Lotto-Auto-Purchase-AI-Agent/code-solution.jpg)

구매까지는 성공했다. 이제 구매한 번호를 캡처해서 기록으로 남겨야 한다. 여기서도 삽질이 있었다.

### 5장 전부 캡처하기

로또 5장을 사면 A~E까지 5개 게임의 번호가 표시된다. 처음에는 화면에 보이는 부분만 캡처했더니 E번 게임이 잘려서 안 보였다. 스크롤이 필요한 영역이었던 것이다.

첫 구매 때 E번 번호를 확인하지 못한 채 지나갔고, 나중에 당첨 확인을 할 때 "혹시 E번이 당첨이었으면 어쩌지?" 하는 쓸데없는 걱정을 해야 했다. (물론 낙첨이었다.)

교훈: **구매 시 반드시 5장 전부 번호를 텍스트로 추출해서 저장하자.** 스크린샷에만 의존하면 안 된다.

### 텍스트 추출 방식으로 전환

결국 DOM에서 직접 번호를 추출하는 방식으로 바꿨다:

```javascript
// 각 게임별 번호를 텍스트로 추출
const games = document.querySelectorAll('.game-numbers');
games.forEach((game, index) => {
  const label = String.fromCharCode(65 + index); // A, B, C, D, E
  const numbers = game.querySelectorAll('.ball');
  const numList = Array.from(numbers).map(n => n.textContent.trim());
  console.log(`${label}: ${numList.join(', ')}`);
});
```

이렇게 하면 화면 캡처에 의존하지 않고 정확한 번호를 기록할 수 있다. 실제로 이 방식으로 전환한 뒤로는 번호 누락 없이 매주 기록이 남고 있다.

## 최종 구조: 크론 → 에이전트 → 브라우저 → 텔레그램

우여곡절 끝에 완성된 자동구매 플로우는 이렇다:

| 단계 | 동작 | 비고 |
|------|------|------|
| 1 | 크론 잡 (금 19:00) | 에이전트 세션 트리거 |
| 2 | 에이전트 브라우저 오픈 | CDP 직접 연결 |
| 3 | 구매 페이지 이동 | PC 버전 URL 명시 |
| 4 | 자동번호 5장 선택 | DOM 로드 대기 |
| 5 | 구매 실행 | 팝업 처리 포함 |
| 6 | 결과 캡처 | 텍스트 + 스크린샷 |
| 7 | 텔레그램 알림 | 번호 + 예치금 잔액 |

예치금이 부족하면 구매를 시도하지 않고 바로 알림만 보낸다. 불필요한 에러를 방지하기 위해서다.

## 삽질에서 얻은 교훈들

### 1. 리눅스 서버에서 브라우저 자동화는 생각보다 어렵다

데스크톱 환경에서 잘 되던 것이 서버에서는 안 되는 경우가 많다. Wayland 환경, 디스플레이 설정, 한글 입력(IBus) 등 신경 쓸 것이 한둘이 아니다. "브라우저 하나 띄우는 게 뭐가 어렵겠어"라고 생각했는데, 그 자체가 하루짜리 삽질이었다.

### 2. 금융/복권 사이트는 자동화에 적대적이다

동행복권 사이트는 일반적인 웹 자동화 도구에 친화적이지 않다. 커스텀 레이어 팝업, 동적 DOM, 비표준적인 UI 패턴 등 자동화를 어렵게 만드는 요소가 많다. 이건 의도적인 안티봇 정책일 수도 있고, 단순히 레거시 코드일 수도 있다.

### 3. 스크린샷보다 텍스트 추출이 낫다

화면 캡처는 직관적이지만, 스크롤 영역이나 오버레이에 가려진 정보를 놓칠 수 있다. 중요한 데이터는 DOM에서 직접 텍스트로 추출해서 저장하는 것이 훨씬 안정적이다.

### 4. MutationObserver는 강력하지만 필터링이 핵심

MutationObserver는 DOM 변화를 실시간으로 감지할 수 있는 강력한 도구지만, 무분별하게 쓰면 불필요한 콜백이 폭주한다. 관심 있는 변화만 정확히 필터링하는 것이 핵심이다.

### 5. 자동화는 한 번에 안 된다

"간단하겠지"라고 시작한 프로젝트가 며칠간의 삽질로 이어졌다. 하지만 한 번 완성하고 나면 매주 손가락 하나 까딱하지 않아도 로또가 구매된다. 그 편안함은 삽질의 대가로 충분하다.

## 현재 운영 상황

이 자동구매 시스템은 현재 매주 금요일 19:00에 동작하고 있다. 월요일 아침에는 자동으로 당첨 확인까지 해준다. 지금까지의 성적은... 음, 로또니까. 그래도 매주 까먹지 않고 꼬박꼬박 사고 있다는 것 자체가 성과다.

예치금 관리도 알아서 해준다. 잔액이 부족하면 알려주니까 충전만 하면 된다. 사실 로또 자동구매 자체보다, 이 과정에서 배운 브라우저 자동화 기술과 삽질 경험이 더 큰 자산이었다.

다음에 기회가 되면 당첨 번호 분석이나 통계 기반 번호 추천 같은 기능도 붙여볼 생각이다. 물론 로또는 완전한 랜덤이라 의미 없다는 걸 알지만, 만드는 재미가 있으니까.

---

> 이 글은 실제로 AI 에이전트(OpenClaw + Claude)를 활용해 동행복권 로또 자동구매를 구현한 경험을 바탕으로 작성되었습니다. 자동화 코드의 세부 구현은 보안상 생략했습니다.

## 참고

- [Chrome DevTools Protocol 문서](https://chromedevtools.github.io/devtools-protocol/)
- [MDN - MutationObserver](https://developer.mozilla.org/ko/docs/Web/API/MutationObserver)
- [동행복권 공식 사이트](https://dhlottery.co.kr/)
