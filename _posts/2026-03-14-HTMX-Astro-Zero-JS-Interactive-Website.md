---
title: 'HTMX + Astro로 Zero-JS 인터랙티브 웹사이트 만들기'
date: 2026-03-14 03:00:00
description: 'SPA 없이도 인터랙티브한 웹사이트를 만들 수 있습니다. HTMX와 Astro의 조합으로 JavaScript 번들 없이 서버 렌더링 HTML로 모던 UX를 구현하는 방법을 실전 예시와 함께 소개합니다. SEO 최적화와 빠른 초기 로딩까지 덤으로.'
featured_image: '/images/2026-03-14-HTMX-Astro-Zero-JS-Interactive-Website/cover.jpg'
---

![](/images/2026-03-14-HTMX-Astro-Zero-JS-Interactive-Website/cover.jpg)

React로 간단한 블로그를 만들려다 500KB의 JavaScript 번들을 내려받게 된 경험, 있으신가요? SPA(Single Page Application)는 강력하지만, 많은 웹사이트에는 과도한 스펙입니다. 이제 웹 개발 트렌드는 **서버 중심 회귀**로 돌아서고 있습니다. HTMX와 Astro는 이 흐름을 선도하며, JavaScript 없이도 인터랙티브한 사용자 경험을 제공하는 방법을 제시합니다.

## SPA 피로감: 왜 다시 서버로 돌아가는가?

### SPA의 문제

```
React 블로그 번들 크기:
- React Runtime: 130KB
- React DOM: 40KB
- Router: 30KB
- 앱 코드: 300KB+
총: ~500KB
```

사용자는 블로그 글 하나 읽으려고 500KB를 다운로드합니다. 초기 로딩이 느리고, SEO는 복잡하며, JavaScript가 로드되기 전까지는 빈 화면만 보입니다.

### 서버 렌더링의 재발견

- **즉시 콘텐츠 표시**: HTML이 즉시 렌더링됨
- **SEO 네이티브**: 검색 엔진이 바로 인덱싱
- **낮은 클라이언트 부담**: 저사양 기기에서도 빠름
- **Progressive Enhancement**: JavaScript 없이도 동작

## HTMX: 하이퍼미디어로 돌아가기

[HTMX](https://htmx.org/)는 **HTML 속성만으로 AJAX, WebSocket, Server-Sent Events를 사용**할 수 있게 하는 라이브러리입니다. 크기는 14KB에 불과합니다.

### 핵심 개념

#### 모든 요소가 HTTP 요청을 보낼 수 있다

```html
<!-- 버튼 클릭 시 서버에서 HTML을 가져와 교체 -->
<button hx-get="/api/users" hx-target="#user-list">
  사용자 목록 불러오기
</button>

<div id="user-list">
  <!-- 여기에 서버 응답 HTML이 삽입됨 -->
</div>
```

JavaScript 한 줄 없이 동적 콘텐츠 로딩이 가능합니다.

![](/images/2026-03-14-HTMX-Astro-Zero-JS-Interactive-Website/htmx.jpg)

#### HTTP 메서드 확장

```html
<!-- POST 요청으로 폼 제출 -->
<form hx-post="/api/comments" hx-target="#comment-list">
  <input name="text" />
  <button type="submit">댓글 작성</button>
</form>

<!-- DELETE 요청 -->
<button hx-delete="/api/items/123" hx-target="closest tr">
  삭제
</button>
```

REST API를 HTML 속성으로 직접 호출합니다.

#### 폴링과 WebSocket

```html
<!-- 3초마다 서버에서 최신 데이터 가져오기 -->
<div hx-get="/api/notifications" 
     hx-trigger="every 3s"
     hx-swap="innerHTML">
  <!-- 실시간 알림 -->
</div>

<!-- WebSocket 연결 -->
<div hx-ws="connect:/ws/chat">
  <form hx-ws="send">
    <input name="message" />
  </form>
  <div hx-ws="receive" id="chat-messages"></div>
</div>
```

복잡한 JavaScript 없이 실시간 기능을 구현합니다.

### 실전 예시: 무한 스크롤

```html
<!-- 스크롤 시 다음 페이지 로딩 -->
<div id="post-list">
  <article>...</article>
  <article>...</article>
  
  <div hx-get="/posts?page=2" 
       hx-trigger="revealed" 
       hx-swap="afterend">
    <!-- 화면에 보이면 자동 로딩 -->
  </div>
</div>
```

서버는 단순히 HTML 조각을 반환합니다:

```html
<!-- GET /posts?page=2 응답 -->
<article>...</article>
<article>...</article>

<div hx-get="/posts?page=3" 
     hx-trigger="revealed" 
     hx-swap="afterend">
</div>
```

## Astro: 아일랜드 아키텍처

[Astro](https://astro.build/)는 **Zero-JS by default** 철학을 가진 웹 프레임워크입니다.

### 핵심 원칙

#### 1. 기본은 정적 HTML

```astro
---
// src/pages/index.astro
const posts = await fetch('/api/posts').then(r => r.json());
---

<html>
  <body>
    <h1>블로그</h1>
    {posts.map(post => (
      <article>
        <h2>{post.title}</h2>
        <p>{post.summary}</p>
      </article>
    ))}
  </body>
</html>
```

빌드 시 완전한 HTML로 렌더링됩니다. 클라이언트에 JavaScript가 전송되지 않습니다.

![](/images/2026-03-14-HTMX-Astro-Zero-JS-Interactive-Website/astro.jpg)

#### 2. 아일랜드 아키텍처

필요한 부분만 인터랙티브하게 만듭니다.

```astro
---
import SearchBox from '../components/SearchBox.svelte';
import Counter from '../components/Counter.react';
---

<html>
  <body>
    <!-- 정적 콘텐츠: JS 없음 -->
    <header>
      <h1>내 사이트</h1>
    </header>
    
    <!-- 인터랙티브 "섬": JS 하이드레이션 -->
    <SearchBox client:load />
    
    <!-- 뷰포트 진입 시만 로드 -->
    <Counter client:visible />
  </body>
</html>
```

`SearchBox`와 `Counter`만 JavaScript를 포함하며, 나머지는 순수 HTML입니다.

#### 3. 프레임워크 혼용

```astro
---
import ReactButton from './Button.react';
import VueModal from './Modal.vue';
import SvelteForm from './Form.svelte';
---

<html>
  <body>
    <ReactButton client:idle />
    <VueModal client:visible />
    <SvelteForm client:load />
  </body>
</html>
```

React, Vue, Svelte를 한 페이지에서 함께 사용할 수 있습니다. 각 프레임워크는 해당 컴포넌트만 하이드레이션합니다.

### 클라이언트 디렉티브

- `client:load`: 페이지 로드 즉시 하이드레이션
- `client:idle`: 브라우저 유휴 시 하이드레이션
- `client:visible`: 뷰포트 진입 시 하이드레이션
- `client:media`: 미디어 쿼리 조건 만족 시 하이드레이션
- `client:only`: SSR 생략, 클라이언트만 렌더링

## HTMX + Astro 통합: 최강의 조합

### 왜 함께 사용하는가?

- **Astro**: 정적 HTML 생성, SEO 최적화
- **HTMX**: 동적 인터랙션, 14KB만 추가

```astro
---
// src/pages/todos.astro
---

<html>
  <head>
    <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  </head>
  <body>
    <h1>할 일 목록</h1>
    
    <form hx-post="/api/todos" hx-target="#todo-list" hx-swap="beforeend">
      <input name="text" placeholder="새 할 일" required />
      <button type="submit">추가</button>
    </form>
    
    <ul id="todo-list">
      <!-- 서버 렌더링된 초기 목록 -->
      <li>첫 번째 할 일</li>
    </ul>
  </body>
</html>
```

### API 라우트 (서버 사이드)

```typescript
// src/pages/api/todos.ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const data = await request.formData();
  const text = data.get('text');
  
  // DB 저장 로직
  await saveTodo(text);
  
  // HTML 조각 반환
  return new Response(
    `<li>${text} <button hx-delete="/api/todos/${id}">삭제</button></li>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
};

export const DELETE: APIRoute = async ({ params }) => {
  await deleteTodo(params.id);
  return new Response('', { status: 200 });
};
```

HTMX는 이 HTML 응답을 받아 페이지에 삽입합니다. 전체 페이지 리로드 없이, JSON 파싱도 없이.

### 실전: 검색 자동완성

```astro
---
// src/pages/search.astro
---

<html>
  <head>
    <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  </head>
  <body>
    <input 
      type="search" 
      name="q"
      placeholder="검색..."
      hx-get="/api/search"
      hx-trigger="keyup changed delay:300ms"
      hx-target="#search-results"
    />
    
    <div id="search-results">
      <!-- 검색 결과가 여기에 -->
    </div>
  </body>
</html>
```

```typescript
// src/pages/api/search.ts
export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q');
  const results = await searchDB(q);
  
  const html = results.map(r => 
    `<a href="${r.url}">${r.title}</a>`
  ).join('');
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
};
```

300ms 디바운싱, 자동완성, 부분 업데이트가 모두 HTML 속성만으로 구현됩니다.

## Zero-JS의 장점

### 성능

```
전통적 SPA (React):
- 번들 크기: 500KB
- First Contentful Paint: 1.8초
- Time to Interactive: 3.2초

Astro + HTMX:
- 번들 크기: 14KB (HTMX만)
- First Contentful Paint: 0.3초
- Time to Interactive: 0.5초
```

초기 로딩이 **6배 빠릅니다**.

### SEO

검색 엔진은 HTML을 즉시 인덱싱합니다. SPA처럼 JavaScript 실행을 기다릴 필요가 없습니다.

```html
<!-- Astro 빌드 결과: 완전한 HTML -->
<html>
  <head>
    <title>내 블로그 - SEO 최적화</title>
    <meta name="description" content="..." />
  </head>
  <body>
    <article>
      <h1>포스트 제목</h1>
      <p>본문 내용...</p>
    </article>
  </body>
</html>
```

Google, Bing이 이 HTML을 바로 읽습니다.

### 접근성

JavaScript가 비활성화되어도 기본 기능이 동작합니다. Progressive Enhancement의 교과서적 예시입니다.

### 저사양 기기

500KB 번들을 파싱하고 실행하는 대신, 14KB만 파싱합니다. 저사양 폰, 느린 네트워크에서 극적인 차이를 만듭니다.

## 언제 사용해야 하는가?

### HTMX + Astro가 적합한 경우

- **콘텐츠 중심 사이트**: 블로그, 문서, 마케팅 페이지
- **공개 웹사이트**: SEO가 중요한 경우
- **단순한 인터랙션**: 폼 제출, 필터링, 무한 스크롤
- **빠른 초기 로딩 필수**: 모바일 우선, Core Web Vitals 최적화

### SPA가 여전히 필요한 경우

- **복잡한 상태 관리**: 대시보드, 관리자 패널
- **실시간 협업**: Google Docs 스타일
- **오프라인 동작**: PWA, 로컬 DB 동기화
- **풍부한 애니메이션**: 복잡한 트랜지션, 3D 렌더링

## 실전: Astro + HTMX 프로젝트 시작하기

### 프로젝트 생성

```bash
npm create astro@latest
cd my-htmx-site
npm install
```

### HTMX 추가

```astro
---
// src/layouts/Layout.astro
---

<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <script src="https://unpkg.com/htmx.org@1.9.10"></script>
    <title>{Astro.props.title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>
```

### 페이지 작성

```astro
---
// src/pages/index.astro
import Layout from '../layouts/Layout.astro';
---

<Layout title="홈">
  <h1>환영합니다</h1>
  
  <button hx-get="/api/time" hx-target="#time">
    현재 시간 확인
  </button>
  
  <div id="time"></div>
</Layout>
```

### API 라우트

```typescript
// src/pages/api/time.ts
import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const now = new Date().toLocaleString('ko-KR');
  return new Response(`<p>현재 시간: ${now}</p>`, {
    headers: { 'Content-Type': 'text/html' }
  });
};
```

### 빌드 및 배포

```bash
npm run build
npm run preview
```

Netlify, Vercel, Cloudflare Pages 등 어디든 배포 가능합니다.

## 마무리

HTMX와 Astro는 웹 개발의 복잡도를 극적으로 낮춥니다. 500KB React 앱 대신 14KB로 같은 UX를 제공하며, SEO는 덤으로 얻습니다.

모든 웹사이트가 SPA일 필요는 없습니다. 콘텐츠 중심 사이트, 블로그, 마케팅 페이지, 문서 사이트라면 HTMX + Astro는 **현명한 선택**입니다. 빠른 초기 로딩, 완벽한 SEO, 낮은 유지보수 비용을 동시에 얻을 수 있습니다.

주말 하루면 블로그를 Astro로 마이그레이션하고, HTMX로 몇 가지 인터랙션을 추가할 수 있습니다. Lighthouse 점수 100점과 함께 번들 크기가 10분의 1로 줄어드는 경험을 직접 해보세요.

## 참고 자료

- [HTMX 공식 문서](https://htmx.org/docs/)
- [Astro 공식 문서](https://docs.astro.build/)
- [Astro 아일랜드 아키텍처 설명](https://docs.astro.build/en/concepts/islands/)
- [HTMX 예시 모음](https://htmx.org/examples/)
