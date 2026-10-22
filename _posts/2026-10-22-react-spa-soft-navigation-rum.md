---
title: 'React SPA의 LCP는 왜 틀릴까: soft navigation을 navigationId로 다시 측정하기'
date: 2026-10-22 09:00:00 +0900
categories: ["개발/프론트엔드"]
description: 'Chrome 151 Soft Navigations API를 React SPA RUM에 연결하고, browser navigationId와 route hook을 대조해 오탐·누락을 분리하는 측정 설계를 다룬다.'
featured_image: 'https://picsum.photos/seed/react-spa-soft-navigation-rum/1600/900'
tags: [react, spa, soft-navigation, rum, lcp, navigationid, chrome-151, web-vitals]
---

![단풍 든 숲 사이로 난 한 줄기 도로를 수직으로 내려다본 모습](https://picsum.photos/seed/react-spa-soft-navigation-rum/1600/900)

React SPA에서 `/products`를 연 뒤 `/products/42`로 이동해도 document는 다시 로드되지 않는다. 기존 RUM이 최초 진입 URL과 page-load LCP만 저장한다면, 상세 화면이 늦게 나타나도 그 지연은 `/products/42`의 LCP로 남지 않는다. 반대로 route hook이 실행될 때마다 LCP 측정을 임의로 초기화하면 filter query 변경이나 redirect까지 새 페이지로 세어 버릴 수 있다.

Chrome 151은 `soft-navigation`과 `interaction-contentful-paint`를 Performance Timeline에 추가했다.[1] 이제 SPA route 전환을 browser가 식별한 navigation 단위로 나누고, 각 entry를 `navigationId`에 귀속할 수 있다. 하지만 “React Router가 route를 바꿨다”와 “browser가 soft navigation을 감지했다”는 같은 사건이 아니다. 이 글의 목표는 둘 중 하나를 정답으로 고르는 것이 아니라, 두 신호를 함께 저장해 **route hook의 false positive와 false negative를 관측 가능한 데이터로 만드는 것**이다.

## route hook만으로 LCP를 나누면 왜 틀리는가

React Router의 `location` 변경은 application이 route commit으로 간주한 시점을 알려 준다. 그러나 그 callback 하나로는 사용자가 시작했는지, 화면에 실제 contentful paint가 있었는지, browser가 어느 paint를 전환에 귀속했는지 알 수 없다.

다음 상황은 모두 route hook을 실행할 수 있다.

- 검색 조건을 query string에 반영했지만 본문은 거의 그대로인 경우
- 인증 guard가 `/checkout`을 거쳐 즉시 `/login`으로 redirect한 경우
- 동일 route에서 tab 상태만 URL에 기록한 경우
- background code가 사용자 입력 없이 `history.replaceState()`를 호출한 경우
- route는 commit됐지만 error boundary나 suspended fetch 때문에 새 본문이 paint되지 않은 경우

이들을 전부 “새 page view”로 세면 application 기준 event 수는 늘어나지만 browser가 본 사용자 경험과 분모가 달라진다. 특히 route callback 시각을 LCP 시작점으로 삼으면 click handler, router guard, data fetch 중 어디까지 포함했는지가 application마다 달라져 서로 비교하기 어렵다.

Chrome의 soft-navigation heuristic은 **사용자 interaction**, **사용자에게 보이는 URL 변경**, **보이는 content paint**가 함께 발생할 때 전환을 감지한다.[2] Framework가 route event를 직접 browser에 선언하는 방식이 아니다. 이 조건은 기존 SPA에도 공통 기준을 적용하기 위한 선택이며, 공식 문서도 site에 따라 false positive와 false negative가 생길 수 있다고 명시한다.[2]

따라서 route hook은 버릴 신호가 아니라 browser 신호와 대조할 별도 관측값이다.

## `navigationId`는 URL보다 강한 attribution key다

`soft-navigation` entry에는 새 URL인 `name`, 이를 시작한 `interactionId`, 해당 navigation을 식별하는 `navigationId`가 들어간다.[2] WICG 명세는 같은 document 안의 performance entry를 navigation별로 나누기 위해 `PerformanceEntry`에 `navigationId`를 부여한다.[3]

URL만 key로 쓰면 다음 sequence를 구분하지 못한다.

```text
/products → /products/42 → /products → /products/42
```

두 번 방문한 `/products/42`는 같은 문자열이지만 별개의 사용자 전환이다. `navigationId`는 이 page lifetime 안에서 각 navigation을 가리키므로, URL 재방문과 back/forward를 별도 sample로 저장할 수 있다.[2]

반대로 `navigationId`를 영구 사용자 ID처럼 다루면 안 된다. RUM row의 navigation partition key로는 유용하지만 session을 넘는 route identity는 아니다. 분석용 route 이름은 `/products/:id`처럼 별도로 정규화하고, 원본 URL은 개인정보와 high-cardinality query를 제거한 뒤 저장한다.

권장 key 구조는 다음과 같다.

```text
rum_session_id       RUM이 만든 page-lifetime 식별자
navigation_id        browser PerformanceEntry.navigationId
navigation_url       soft-navigation.name의 정규화된 URL
route_pattern        /products/:id 같은 application route
app_transition_id    route 시작 때 application이 만든 UUID
interaction_id       soft navigation을 시작한 browser interaction
```

`route_pattern`과 `navigation_id`를 합치지 않는 것이 핵심이다. 전자는 집계 dimension이고 후자는 개별 전환의 attribution key다.

## Observer callback 시점의 현재 URL을 믿지 않는다

`PerformanceObserver` callback은 entry가 만들어진 즉시 실행된다고 보장되지 않는다. Main thread가 바쁘면 observer가 entry를 받기 전에 다음 route까지 진행할 수 있다. Chrome 문서도 entry 생성과 관측 사이에 시간이 흐를 수 있으므로 `navigationId`로 올바른 navigation에 귀속해야 한다고 설명한다.[2]

그러므로 callback에서 `location.href`나 전역 `currentNavigationId`를 읽어 과거 entry에 붙이면 안 된다. 각 entry가 가진 값을 그대로 저장해야 한다.

```js
const supportsSoftNavigation =
  globalThis.PerformanceObserver?.supportedEntryTypes?.includes(
    'soft-navigation',
  ) ?? false;

if (supportsSoftNavigation) {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      enqueueRum({
        type: 'browser_soft_navigation',
        navigationId: entry.navigationId,
        interactionId: entry.interactionId,
        navigationUrl: normalizeUrl(entry.name),
        startTime: entry.startTime,
        observedAt: performance.now(),
      });
    }
  }).observe({type: 'soft-navigation', buffered: true});
}
```

`buffered: true`는 observer 등록 전에 생긴 buffered entry도 받기 위한 장치다. 다만 `performance.getEntriesByType('soft-navigation')`만 나중에 조회하는 방식은 browser buffer 한도 때문에 오래 열린 SPA session의 전환을 잃을 수 있다. 공식 문서는 모든 entry를 받으려면 observer로 도착할 때 수집하라고 권고한다.[2]

## LCP는 `navigationId`만 보고 직접 조립하지 않는다

대부분의 performance entry는 자기 `navigationId`로 navigation partition에 들어간다. 그러나 soft-navigation LCP의 source인 `interaction-contentful-paint`에는 중요한 예외가 있다.

Paint가 URL 변경보다 먼저 일어나면 해당 `interaction-contentful-paint`는 이전 URL의 `navigationId`를 가질 수 있다. URL 변경이 먼저라면 새 ID를 가질 수 있다. 게다가 이후의 다른 interaction에서도 `interaction-contentful-paint`가 계속 나올 수 있으므로, 같은 `navigationId`라는 이유만으로 모두 route LCP 후보에 넣어서는 안 된다.[2]

Chrome 문서는 soft-navigation LCP를 연결할 때 `interaction-contentful-paint`와 `soft-navigation`의 `interactionId`를 대조하라고 안내한다.[2] `soft-navigation` entry가 제공하는 `getLargestInteractionContentfulPaint()`도 entry가 확정되기 전에 나온 가장 큰 paint를 처리하기 위한 경로다.[2]

즉 attribution 규칙은 두 층이다.

1. `navigationId`로 일반 performance entry와 navigation lifecycle을 나눈다.
2. Soft-navigation LCP의 paint 후보는 initiating `interactionId`로 해당 navigation과 연결한다.

이 순서를 생략한 자체 구현은 paint-before-URL 순서에서 LCP를 이전 route에 붙일 수 있다. Production RUM에서는 최신 `web-vitals` library가 반환하는 `navigationId`와 `navigationURL`을 저장하는 편이 안전하다. Chrome 문서는 이 library가 URL 귀속과 soft-navigation의 여러 edge case를 처리한다고 설명한다.[2]

```js
import {onLCP} from 'web-vitals';

onLCP((metric) => {
  enqueueRum({
    type: 'lcp',
    metricId: metric.id,
    value: metric.value,
    navigationType: metric.navigationType,
    navigationId: metric.navigationId,
    navigationUrl: normalizeUrl(metric.navigationURL),
  });
}, {reportAllChanges: true, reportSoftNavs: true});
```

Library version과 option은 lockfile에 고정하고, 실제 callback schema는 채택한 version의 type definition으로 확인해야 한다. Raw API를 직접 다룬다면 performance timestamp가 최초 hard navigation 기준이라는 점도 보정해야 한다. Soft navigation의 loading metric은 해당 `soft-navigation.startTime`을 기준으로 계산해야 한다.[2]

## React route hook은 별도 transition ledger로 남긴다

Browser observer만으로는 application이 어느 route를 의도했는지, loader가 성공했는지, redirect가 있었는지 알 수 없다. React 쪽에는 독립적인 transition ledger를 둔다.

```jsx
function RouteRumBridge() {
  const location = useLocation();
  const navigation = useNavigation();
  const previousUrlRef = useRef(null);

  useEffect(() => {
    const toUrl = normalizeUrl(
      location.pathname + location.search + location.hash,
    );

    enqueueRum({
      type: 'app_route_commit',
      appTransitionId: crypto.randomUUID(),
      fromUrl: previousUrlRef.current,
      toUrl,
      routePattern: matchRoutePattern(location),
      routerState: navigation.state,
      committedAt: performance.now(),
    });

    previousUrlRef.current = toUrl;
  }, [location.key]);

  return null;
}
```

이 예시는 application commit을 기록할 뿐 soft navigation을 선언하지 않는다. `location.key`가 실제 router 구성에서 redirect와 replace를 어떻게 표현하는지 fixture로 확인해야 한다. Start 시각이 필요하면 link click, router subscription 또는 transition API에서 `app_route_start`를 별도로 기록하고 같은 `appTransitionId`로 commit과 묶는다.

Browser event와 application event는 client에서 성급하게 하나로 합치지 않는 편이 낫다. 원본 두 stream을 보낸 뒤 ingestion 단계에서 URL, 시간 범위, interaction 정보를 이용해 match하고, 결과와 match 이유를 함께 저장한다.

## false positive와 false negative를 네 상태로 분류한다

5초 동안 발생한 event를 단순히 같은 URL이라는 이유로 join하면 빠른 redirect나 같은 route 재방문에서 잘못 연결된다. 우선 page lifetime을 같게 제한하고, 정규화 URL과 시간 순서를 확인하되 1:1 대응만 자동 확정한다.

| 분류 | app route hook | browser soft navigation | 해석 |
|---|---:|---:|---|
| `matched` | 1 | 1 | 두 계층이 같은 전환을 관측 |
| `app_only` | 1 | 0 | route hook false positive 후보 또는 heuristic 조건 미충족 |
| `browser_only` | 0 | 1 | route instrumentation false negative 후보 |
| `ambiguous` | N | M | redirect, replace, 빠른 연속 전환으로 자동 귀속 불가 |

`app_only`를 즉시 browser bug라고 부르면 안 된다. 사용자 interaction 없이 시작됐거나, URL이 바뀌지 않았거나, 새 content가 paint되지 않았을 수 있다. 반대로 browser heuristic은 사용자에게 페이지 전환처럼 보이는 모든 application state change를 포함하겠다고 약속하지 않는다.[2]

`browser_only`는 router 밖의 `history.pushState()`, micro-frontend의 독립 router, back/forward listener 누락, observer와 hook의 초기화 순서 차이에서 생길 수 있다. Browser가 URL·interaction·paint를 감지했는데 React ledger에 없다면 RUM wiring의 누락을 먼저 의심한다.

`ambiguous`는 버리지 말고 별도 비율로 공개한다. 다음처럼 `/checkout → /login` redirect가 한 번의 click 안에 일어나면 application commit 두 건과 browser soft navigation 한 건이 대응할 수 있다.

```text
click
  ├─ app_route_commit /checkout
  ├─ guard redirect
  ├─ app_route_commit /login
  └─ browser_soft_navigation /login
```

이 경우 `/checkout`을 LCP 분모에 억지로 넣기보다 `redirect_collapsed` reason을 남긴다. Product analytics page view와 performance navigation의 수가 같아야 한다는 요구부터 버려야 한다.

## 검증 fixture는 숫자보다 mismatch를 먼저 본다

Production 배포 전에 작은 route matrix를 자동화한다.

| Fixture | app hook 예상 | browser soft navigation 예상 | 확인할 것 |
|---|---:|---:|---|
| Link click 후 URL과 본문 교체 | 1 | 1 | 같은 전환으로 match |
| Query만 변경하고 visible content 유지 | 1 | 조건에 따라 0 | `app_only` reason |
| 사용자 click 없이 programmatic redirect | 1 이상 | 0 가능 | user interaction 조건 보존 |
| Router 밖에서 URL과 본문 교체 | 0 | 1 가능 | `browser_only` 검출 |
| Paint 후 URL 변경 | 1 | 1 | LCP가 `interactionId`로 새 route에 연결 |
| URL 변경 후 delayed paint | 1 | 1 | observer 지연에도 entry 자체 ID로 귀속 |
| 같은 상세 URL 재방문 | 2 | 2 | 서로 다른 `navigationId` 유지 |
| 본문 교체 없이 hash만 변경 | 1 가능 | 0 가능 | navigation으로 과대 집계하지 않음 |

각 fixture는 `app_transition_id`, `navigation_id`, `interaction_id`, normalized URL과 timestamp를 함께 snapshot한다. “LCP callback이 왔다”만 확인해서는 attribution 오류를 찾지 못한다. 특히 paint-before-URL과 URL-before-paint를 둘 다 실행해야 한다.

운영 dashboard에서는 다음 비율을 browser support cohort별로 나눈다.

```text
match_rate        = matched / browser_soft_navigation
app_only_rate     = app_only / app_route_commit
browser_only_rate = browser_only / browser_soft_navigation
ambiguous_rate    = ambiguous / candidate_transition
```

분모가 0인 cohort는 값 0으로 채우지 말고 unavailable로 둔다. Release 전후에는 route별 p75 LCP만 비교하기 전에 mismatch 비율이 바뀌지 않았는지 확인한다. Instrumentation 변화로 sample 구성이 달라졌다면 성능 개선처럼 보이는 숫자를 바로 제품 개선으로 해석할 수 없다.

## Chrome 151, 다른 browser, CrUX를 한 표에 섞지 않는다

Chrome 151 stable은 `PerformanceSoftNavigation`과 `InteractionContentfulPaint` entry를 제공한다.[1] 하지만 2026년 10월 현재 다른 browser engine은 이 API를 지원하지 않아 soft navigation 기준 Core Web Vitals를 측정할 수 없다.[4]

따라서 UA 이름만으로 강제 분기하지 말고 capability를 기록한다.

```js
const softNavCapability =
  globalThis.PerformanceObserver?.supportedEntryTypes?.includes(
    'soft-navigation',
  ) &&
  globalThis.PerformanceObserver?.supportedEntryTypes?.includes(
    'interaction-contentful-paint',
  ) &&
  typeof globalThis.PerformanceSoftNavigation?.prototype
    ?.getLargestInteractionContentfulPaint === 'function';
```

지원 cohort에서는 browser-attributed metric을 수집한다. 미지원 cohort에서는 route hook 기반 진단치를 별도 namespace에 저장할 수 있지만, 그것을 동일한 표의 공식 LCP처럼 합치지 않는다. 이름도 `app_route_render_latency`처럼 다른 측정임을 드러내야 한다.

CrUX는 2026년 10월부터 hard navigation과 soft navigation을 섞은 LCP·INP·CLS의 **experimental** field를 제공한다.[5] 그러나 stable Core Web Vitals score는 아직 바뀌지 않았고, 이 experimental 지표가 평가되는 동안 Search Console도 기존 stable data를 사용한다. Web.dev는 graduation 목표를 2027년 5월로 제시하지만 feedback에 따라 달라질 수 있으며, 그때 graduation이 이뤄져야 Search Console이 새 data로 전환한다고 설명한다.[5]

이 경계는 dashboard 이름에 그대로 반영한다.

- `rum_softnav_*`: 자사 RUM, 지원 browser만 포함
- `crux_experimental_*_with_softnavs`: CrUX experimental field
- `search_console_cwv`: 현재 stable Search Console signal

세 지표가 같은 방향으로 움직일 것이라고 가정하지 않는다. RUM은 배포 직후 route와 release를 세밀하게 볼 수 있고, CrUX experimental은 공개 집계의 eligibility와 기간을 따르며, Search Console은 아직 soft-navigation experimental data를 stable 판정에 쓰지 않는다.[5]

## 결론: route event는 주장이고 `navigationId`는 browser attribution이다

React route hook은 application이 전환을 commit했다는 기록이다. Chrome의 soft-navigation entry는 사용자 interaction, URL 변경, visible paint라는 browser heuristic을 만족한 전환이다. 둘은 목적이 다르므로 하나를 다른 하나로 대체하면 오탐이나 누락이 숨는다.

RUM의 중심 key는 callback 시점의 URL이 아니라 entry 자체의 `navigationId`여야 한다. 같은 URL을 여러 번 방문해도 sample을 분리하고, observer가 늦게 실행돼도 과거 entry를 현재 route에 붙이지 않기 위해서다. 다만 soft-navigation LCP에서는 paint와 URL 변경 순서가 엇갈릴 수 있으므로 `interaction-contentful-paint`를 initiating `interactionId`로 연결해야 한다.

마지막으로 `matched`, `app_only`, `browser_only`, `ambiguous`를 성능 숫자와 함께 저장한다. 그래야 LCP가 좋아졌다는 그래프가 실제 route rendering 개선인지, route hook이 일부 전환을 잃었는지, browser support cohort가 바뀐 결과인지 구분할 수 있다.

**SPA RUM의 성공 기준은 route마다 숫자 하나를 만드는 것이 아니라, 그 숫자가 어느 navigation에 속했고 어떤 전환이 분모에서 빠졌는지를 다시 설명할 수 있는 것이다.**

## Sources

[1] https://developer.chrome.com/release-notes/151 — Chrome 151 release notes
[2] https://developer.chrome.com/docs/web-platform/soft-navigations — Measuring soft navigations
[3] https://wicg.github.io/soft-navigations/ — Soft Navigations and Interaction Contentful Paint draft specification
[4] https://web.dev/articles/vitals-spa-faq — How SPA architectures affect Core Web Vitals
[5] https://web.dev/blog/crux-experimental-soft-navs — Experimental soft navigation metrics now available in CrUX
