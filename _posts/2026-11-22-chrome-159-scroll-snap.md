---
title: '가로 캐러셀 안의 세로 페이지가 엉뚱하게 스냅되는 이유: Chrome 159 단일축 비교'
date: 2026-11-22 08:10:00 +0900
categories: ["개발/프론트엔드"]
description: 'Chrome 159 Beta가 단일축 스크롤 컨테이너의 snap area를 축별로 처리하는 변화를 재현하고, 가로 캐러셀과 세로 페이지 스냅이 중첩될 때 확인할 수동 비교 절차를 정리한다.'
featured_image: 'https://picsum.photos/seed/hotnews-chrome159-snap/1600/900'
tags: [chrome-159, css, scroll-snap, carousel, frontend, browser-compatibility]
---

![나무가 터널처럼 늘어선 흑백 숲길](https://picsum.photos/seed/hotnews-chrome159-snap/1600/900)

가로 캐러셀의 카드 스냅은 되는데 바깥 세로 페이지 스냅만 빠질 수 있다. 문제는 **어느 스크롤 컨테이너가 어느 축의 snap area를 가져가느냐**에 있다.

2026년 11월 22일 기준 Chrome 159는 **Beta**다. Chrome for Developers는 11월 12일 Beta 진입을 알렸고 Chrome Status는 Stable 일정을 12월 8일로 표시한다. 아직 GA 동작으로 전제하면 안 된다.[1][2]

## Chrome 159에서 달라지는 축별 소유권

바깥 페이지는 y축으로 움직이고, 안쪽 `overflow: auto clip` 캐러셀은 x축만 스크롤한다. 카드의 `scroll-snap-align: start` 한 값은 두 축에 적용되므로 snap area는 x와 y 정렬 후보를 함께 갖는다.

Chrome 159 이전에는 단일축 컨테이너가 움직일 수 없는 축까지 snap area를 붙잡았다. 가로 캐러셀이 x와 y 후보를 모두 캡처하면 x축 정렬은 하지만 y축은 움직일 수 없고 바깥 페이지도 그 카드 위치를 스냅 지점으로 쓸 수 없다.

159의 릴리스 노트는 이 처리를 축별로 나눈다. 단일축 컨테이너는 자신이 스크롤하는 축만 처리하고 다른 축의 정렬은 그 방향으로 스크롤할 수 있는 가장 가까운 조상 컨테이너로 넘긴다.[2] CSS Scroll Snap 명세도 `scroll-snap-align`을 block축과 inline축의 정렬값으로 정의하며 한 값만 주면 두 축에 같은 값이 적용된다.[3] 즉 같은 카드 한 장이 x축에서는 캐러셀의 스냅 대상이고 y축에서는 바깥 페이지의 스냅 대상이 될 수 있다.

## 복사해서 여는 단일 파일 fixture

아래 코드는 외부 라이브러리 없이 저장해 열 수 있는 하나의 HTML 파일이다. 이 글에서는 fixture를 Chrome 159 Beta와 이전 버전에서 직접 실행하지 않았다. 표에 적은 것은 공식 릴리스 설명에서 도출한 **예상 관찰값**이며, 실제 결과 칸은 독자가 수동 비교로 채워야 한다.

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>single-axis scroll snap probe</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui; }
  #pages {
    height: 100vh;
    overflow-y: auto;
    scroll-snap-type: y mandatory;
    overscroll-behavior: contain;
  }
  .screen {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #eef2ff;
    scroll-snap-align: start none;
  }
  .screen:last-child { background: #ecfdf5; }
  #stage {
    min-height: 100vh;
    padding: 20vh 0;
    background: #111827;
  }
  #carousel {
    display: flex;
    gap: 16px;
    width: 100%;
    overflow: auto clip;
    scroll-snap-type: x mandatory;
    padding: 0 10vw;
  }
  .card {
    flex: 0 0 80vw;
    min-height: 60vh;
    display: grid;
    place-items: center;
    border-radius: 24px;
    color: white;
    font-size: clamp(2rem, 8vw, 6rem);
    background: #2563eb;
    scroll-snap-align: start;
  }
  .card:nth-child(2) { background: #7c3aed; }
  .card:nth-child(3) { background: #db2777; }
  #panel {
    position: fixed;
    z-index: 2;
    right: 8px;
    bottom: 8px;
    max-width: min(92vw, 540px);
    padding: 10px;
    color: white;
    background: rgb(0 0 0 / .8);
    font: 12px/1.45 ui-monospace, monospace;
    white-space: pre-wrap;
  }
</style>
<div id="pages">
  <section class="screen"><p>여기서 아래로 천천히 스크롤</p></section>
  <section id="stage">
    <div id="carousel" aria-label="가로 카드 캐러셀">
      <article class="card">A</article>
      <article class="card">B</article>
      <article class="card">C</article>
    </div>
  </section>
  <section class="screen"><p>마지막 세로 페이지</p></section>
</div>
<output id="panel"></output>
<script>
  const pages = document.querySelector('#pages');
  const stage = document.querySelector('#stage');
  const carousel = document.querySelector('#carousel');
  const panel = document.querySelector('#panel');
  const supported = CSS.supports('named-feature(single-axis-scroll-container)');

  function report() {
    const targetY = carousel.getBoundingClientRect().top
      - pages.getBoundingClientRect().top + pages.scrollTop;
    panel.textContent = [
      `UA: ${navigator.userAgent}`,
      `named feature: ${supported}`,
      `outer scrollTop: ${pages.scrollTop.toFixed(0)}`,
      `expected card Y: ${targetY.toFixed(0)}`,
      `Y delta: ${Math.abs(pages.scrollTop - targetY).toFixed(0)}`,
      `carousel scrollLeft/scrollTop: ${carousel.scrollLeft.toFixed(0)} / ${carousel.scrollTop.toFixed(0)}`
    ].join('\n');
  }

  pages.addEventListener('scroll', report, { passive: true });
  carousel.addEventListener('scroll', report, { passive: true });
  report();
</script>
```

핵심은 `.card`의 `scroll-snap-align: start`를 `start none`처럼 축별로 회피하지 않은 점이다. fixture는 두 축 후보를 의도적으로 유지해 브라우저의 축별 캡처 차이를 드러낸다. `#stage` 자체에는 snap 정렬을 주지 않았으므로 중간 위치의 y축 후보는 카드에서만 온다.

## 정확한 수동 관찰 순서와 판정표

새 탭에서 확대율을 100%로 맞추고 다음 순서를 반복한다.

1. 첫 화면에서 트랙패드나 마우스 휠로 **세로 방향만** 천천히 내려 중간 캐러셀 근처에서 입력을 놓는다.
2. 움직임이 완전히 멈추면 패널의 `Y delta`와 `carousel scrollTop`을 기록한다.
3. 카드 위에서 **가로 방향만** 움직여 B 카드가 왼쪽에 스냅되는지 확인한다.
4. 다시 세로로 내려 마지막 화면까지 이동한 뒤, 위로 돌아와 같은 값을 한 번 더 기록한다.
5. Chrome 159 Beta와 비교 버전에서 viewport 크기와 입력 장치를 동일하게 유지한다.

| 비교 대상 | capability 표시 | 세로 입력 후 예상 | 가로 입력 후 예상 | 판정 |
|---|---|---|---|---|
| Chrome 159 Beta | `true` 예상 | 카드의 y 시작점으로 이동해 `Y delta`가 0에 근접, `carousel scrollTop`은 0 | B 또는 C 카드가 x축으로 스냅 | 축별 전달 동작과 일치 |
| Chrome 156~158 | `true`일 수 있음 | 안쪽 컨테이너가 y 후보까지 캡처해 중간 카드 위치가 바깥 스냅 후보에서 빠질 수 있음 | x축 카드 스냅은 동작 | 159 전후 차이 후보 |
| named feature 미지원 브라우저 | `false` | 단일축 의미 자체가 같지 않을 수 있어 전후 판정에서 제외 | 구현별 기록만 보존 | 비교군 부적합 |

레이아웃 반올림을 고려해 `Y delta` 2px 이하면 정렬로 판정한다. 그보다 크면 `outer scrollTop`, 확대율, OS 설정을 함께 남기고 아래→위 왕복을 각각 3회 반복한다.

## capability와 버전은 같은 검사가 아니다

단일축 컨테이너 자체는 `CSS.supports('named-feature(single-axis-scroll-container)')`로 확인하는 것이 권장된다. `CSS.supports('overflow', 'auto clip')`는 문법을 파싱하는지만 보여 주며 수정된 동작까지 증명하지 못한다.[4] 다만 named feature가 `true`여도 Chrome 159의 scroll snap 축별 변경까지 들어갔다는 뜻은 아니다. Chrome Status에는 단일축 컨테이너의 Chromium shipping milestone이 156으로 기록돼 있고, snap area 처리 변경은 159 릴리스 노트에 따로 실렸다.[2][4]

UA 문자열이나 named feature 하나만으로 snap 수정까지 있다고 가정하면 안 된다.

- 우선 `scroll-snap-align: start none`처럼 필요 없는 축을 명시해 구형 동작에서도 모호성을 줄인다.
- 두 축 정렬이 반드시 필요할 때만 위 fixture와 실제 컴포넌트 회귀 테스트를 함께 돌린다.
- Beta 결과는 호환성 검토 자료로 사용하고, Stable 출시와 실제 대상 브라우저 통과 전에는 일반 사용자 기준선으로 올리지 않는다.
- 스크롤 종료 위치뿐 아니라 키보드, 터치, `scrollIntoView()` 경로도 별도로 확인한다.

## 배포 전에 확인할 회귀 범위

단일축 스크롤 컨테이너는 `position: sticky`, overscroll, DOM 스크롤 API, flex/grid 자동 최소 크기에도 영향을 줄 수 있다.[4] snap만 확인하면 같은 `overflow: auto clip` 주변의 다른 회귀를 놓친다.

공유 컴포넌트라면 x/y 휠과 터치, Home·End·화살표 키, 초점 자동 스크롤, RTL, 세로쓰기, 확대 200%, reduced motion, 중첩 scroller를 확인한다. 성공 기준은 지원 브라우저별 종료 좌표와 포커스가 정한 범위에 드는 것이다.

## 결론

Chrome 159의 핵심은 snap 강도를 바꾸는 것이 아니다. 가로로만 움직이는 컨테이너가 x축 snap area만 맡고 y축 후보는 실제로 세로 스크롤할 수 있는 조상에게 넘기도록 **소유권을 축별로 나누는 것**이다. 그래서 같은 `scroll-snap-align: start` 카드가 가로 캐러셀과 세로 페이지에 각각 의미 있는 정렬점을 제공할 수 있다.

하지만 2026년 11월 22일 현재는 Beta다. fixture와 표는 재현 절차이지 실행 결과가 아니다. Stable 예정일인 12월 8일 전에는 GA 동작으로 서술하지 말고 필요한 컴포넌트만 버전·capability·실제 좌표를 함께 기록한다.

## Sources

[1] https://developer.chrome.com/blog/chrome-159-beta
[2] https://chromestatus.com/release-notes/159
[3] https://drafts.csswg.org/css-scroll-snap-1/#propdef-scroll-snap-align
[4] https://developer.chrome.com/blog/single-axis-scroll-containers-ready-for-testing
