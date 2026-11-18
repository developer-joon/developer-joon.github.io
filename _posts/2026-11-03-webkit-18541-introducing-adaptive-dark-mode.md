---
title: 'Safari 27.3 Adaptive Dark Mode가 내 사이트를 망가뜨릴까: color-scheme·SVG·Canvas 실험'
date: 2026-11-03 09:00:04 +0900
categories: ["개발/도구"]
description: 'Safari 27.3 beta의 Adaptive Dark Mode가 CSS 색상, gradient, SVG, bitmap, blend effect와 canvas를 어떻게 다루는지 비교하고 color-scheme 선언 전략을 정리합니다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-webkit-18541-introducing-adaptive-dark-mode/1600/900'
tags: [safari, webkit, adaptive-dark-mode, css, color-scheme, accessibility]
---

![짙은 숲과 밝은 호수가 좌우로 대비되는 풍경](https://picsum.photos/seed/news-2026-11-03-webkit-18541-introducing-adaptive-dark-mode/1600/900)

Safari 27.3 beta의 Adaptive Dark Mode는 사용자가 기능을 켰을 때 자체 dark mode를 선언하지 않은 밝은 페이지를 browser engine에서 어둡게 바꾼다. `color-scheme: light dark`를 선언한 페이지는 바꾸지 않고, 페이지가 이미 어두운지도 분석한다.[1]

이 기능은 CSS source를 다시 쓰는 polyfill이 아니다. 표시되는 색과 JavaScript가 읽는 authored color가 달라질 수 있다. Safari는 사이트가 변환 적용 여부를 탐지하지 못하게 하고, JavaScript의 CSS color query에는 변환 전 값을 반환한다.[1]

## 한 화면에 변환 표면을 모은다

다음 요소를 한 fixture에 배치한다.

- solid background와 본문 text
- CSS gradient와 semantic status color
- 투명 배경 SVG logo와 단색 bitmap logo
- 사진, mask, `mix-blend-mode`
- CSS와 같은 색을 그리는 `<canvas>`
- focus, hover, disabled 상태의 button

이것은 **제안 fixture이며 Safari 27.3 beta에서 실제 실행한 결과를 주장하지 않는다**. 같은 commit을 세 조건으로 캡처하는 것이 목적이다.

```css
/* A: 선언 없음 */
:root { --surface: #fff; --text: #171717; }

/* B: 자체 light·dark 구현 */
:root { color-scheme: light dark; }
@media (prefers-color-scheme: dark) {
  :root { --surface: #111; --text: #eee; }
}

/* C: 의도적인 light-only 영역 */
.brand-proof { color-scheme: light only; }
```

WebKit 설명에 따르면 밝은 CSS gradient도 변환 대상이다. SVG는 필요한 경우 색을 바꾸고, bitmap은 단순한 흑백 logo의 pixel histogram을 분석해 반전할 수 있다. 반면 canvas content는 그대로 두며 mask나 `mix-blend-mode`는 변환 결과를 해칠 때 꺼질 수 있다.[1]

## 보이는 값과 읽히는 값을 분리해 기록한다

각 조건에서 screenshot, pixel sample, WCAG contrast, `getComputedStyle()` 결과를 함께 저장한다. Adaptive Dark Mode가 text contrast에서 목표로 삼는 기준은 4.5:1이지만, 이것이 페이지의 모든 상태와 component가 자동으로 접근성 검사를 통과한다는 보증은 아니다.[1]

```js
const el = document.querySelector('.probe');
console.table({
  authoredComputed: getComputedStyle(el).color,
  background: getComputedStyle(el).backgroundColor,
  mediaDark: matchMedia('(prefers-color-scheme: dark)').matches,
});
```

JavaScript read-back은 original authored color를 돌려주므로 screenshot pixel과 값이 달라도 곧바로 browser bug로 단정하지 않는다. Canvas도 원래 형태로 그려지고 canvas로 가져온 image 역시 원래 모습이므로 주변 transformed background와 대비가 깨지는지 따로 본다.[1]

## `color-scheme` 선택 기준

자체 dark theme이 있다면 HTML head의 meta나 초기 CSS에서 `light dark`를 선언한다. JavaScript가 늦게 주입하면 첫 paint가 잘못될 수 있다. 특정 brand proof나 문서 preview를 반드시 밝게 유지해야 할 때만 `light only`를 좁은 범위에 쓴다.

여기에는 beta 경계가 있다. WebKit은 Safari 27.3 beta 1에서 `only` keyword가 아직 지원되지 않는다고 명시했다.[1] 따라서 beta 1에서 opt-out이 실패한 결과를 최종 Safari 동작으로 일반화하지 말고 build 번호와 설정을 캡처해야 한다.

## 수치와 상태를 과장하지 않는다

WebKit 글의 “약 40% dark-mode 사용자 page load, 10% dark 지원” 수치는 연결된 Chrome usage metric을 인용한 것이다.[1] 전체 웹을 독립 표본으로 조사한 결과처럼 쓰면 안 된다. 또한 현재 대상은 Safari 27.3 **beta**다. 색상 변환 heuristic과 `only` 지원은 정식판까지 달라질 수 있다.

배포 판단은 단순하다. 자체 theme이 있다면 명시적으로 선언하고, 없다면 engine 변환에서 깨지는 surface를 fixture로 찾는다. SVG·bitmap·canvas·blend effect를 같은 범주로 묶지 말고 각각 관찰한다. Adaptive Dark Mode를 탐지해 우회하려 하기보다, authored color와 browser presentation이 달라질 수 있다는 새 rendering 계약을 테스트 체계에 포함하는 편이 오래간다.

## Sources

[1] https://webkit.org/blog/18541/introducing-adaptive-dark-mode/
