---
title: 'Node.js 백엔드에서 Axios를 걷어내도 될까 — Fetch 내장 시대의 마이그레이션 기준'
date: 2026-06-06 10:20:00
categories: ["백엔드 개발"]
description: 'Node.js의 WHATWG Fetch 흐름과 Node.js 24 LTS/26 Current 업데이트를 바탕으로, 백엔드에서 Axios를 계속 쓸지 내장 fetch로 옮길지 판단하는 기준과 마이그레이션 주의점을 정리한다.'
featured_image: 'https://picsum.photos/seed/nodejs-fetch-backend-migration/1600/900'
tags: [nodejs, backend, fetch, axios, migration]
---

![Node.js Fetch 마이그레이션](https://picsum.photos/seed/nodejs-fetch-backend-migration/1600/900)

Node.js 백엔드에서 HTTP 클라이언트를 고를 때 오랫동안 Axios가 기본 선택지였다. API가 단순하고, 브라우저와 Node.js 양쪽에서 쓸 수 있고, JSON 처리와 에러 모델이 익숙했기 때문이다. 하지만 Node.js에 WHATWG Fetch가 내장되면서 선택지가 달라졌다.

Node.js 공식 블로그에는 Axios에서 WHATWG Fetch로 옮기는 마이그레이션 글이 올라왔고, Node.js 24 LTS와 26 Current 라인도 계속 업데이트되고 있다. 이제 백엔드 프로젝트에서 질문은 "무조건 Axios를 써야 하는가"가 아니라 "이 프로젝트에는 Axios가 아직 필요한가"에 가까워졌다.

결론부터 말하면, 새 프로젝트라면 내장 `fetch`를 기본값으로 검토할 만하다. 다만 기존 백엔드에서 Axios를 무리하게 걷어내는 것은 별개의 문제다. 에러 처리, 타임아웃, 인터셉터, retry, observability가 얽혀 있다면 마이그레이션 비용이 생각보다 커질 수 있다.

## 내장 fetch의 장점

가장 큰 장점은 의존성이 줄어든다는 것이다. HTTP 호출은 백엔드의 기본 기능이다. 이 기능을 위해 외부 라이브러리를 추가하지 않아도 된다면 공급망 위험과 유지보수 부담이 줄어든다.

또 하나의 장점은 표준 API라는 점이다. 브라우저, edge runtime, serverless, Node.js 사이에서 같은 모델을 공유할 수 있다. `Request`, `Response`, `Headers`, `AbortController` 같은 개념을 익히면 여러 환경에서 재사용할 수 있다.

예시는 간단하다.

```js
const response = await fetch('https://api.example.com/users', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ name: 'bread' }),
});

if (!response.ok) {
  throw new Error(`API request failed: ${response.status}`);
}

const data = await response.json();
```

겉으로 보기에는 Axios와 크게 다르지 않다. 하지만 실제 마이그레이션에서는 차이가 중요하다.

## Axios와 fetch의 차이

가장 흔한 함정은 에러 처리다. Axios는 4xx/5xx 응답을 기본적으로 reject한다. 반면 fetch는 네트워크 오류가 아닌 HTTP 오류 상태를 reject하지 않는다. `response.ok`를 직접 확인해야 한다.

```js
const response = await fetch(url);

// 이 검사를 빼먹으면 500 응답도 정상 흐름처럼 지나갈 수 있다.
if (!response.ok) {
  throw new Error(`HTTP ${response.status}`);
}
```

두 번째는 타임아웃이다. Axios에는 timeout 옵션이 익숙하지만, fetch에서는 `AbortController`를 사용해야 한다.

```js
function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
}
```

세 번째는 인터셉터다. Axios interceptor를 인증 토큰 삽입, 로깅, retry, 에러 변환에 쓰고 있다면 fetch로 단순 치환하기 어렵다. 이 경우 프로젝트 내부에 작은 wrapper를 만드는 편이 낫다.

## 백엔드에서는 wrapper가 필요하다

실무 백엔드에서 `fetch`를 그대로 여러 파일에 흩뿌리는 것은 추천하지 않는다. 최소한 공통 wrapper를 두는 편이 좋다.

```js
export async function requestJson(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 5000,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
```

이 wrapper는 완성형 라이브러리가 아니다. 실제 운영에서는 retry 정책, tracing, metric, structured logging, redaction을 추가해야 한다. 중요한 것은 fetch를 직접 쓰지 말고 프로젝트의 HTTP 정책을 한 곳에 모으는 것이다.

## 언제 Axios를 유지할까

Axios를 이미 잘 쓰고 있다면 무조건 제거할 필요는 없다. 다음 경우에는 유지가 합리적이다.

- interceptor 기반 인증/로깅/retry가 이미 안정적으로 구축되어 있다.
- multipart upload, progress, proxy 등 Axios 특화 기능을 많이 쓴다.
- 브라우저 구버전 지원이 중요하다.
- 에러 모델을 바꾸면 기존 코드 영향이 크다.
- 테스트 mock이 Axios 중심으로 구성되어 있다.

의존성을 줄이는 것은 좋은 방향이지만, 안정적인 운영 코드를 흔드는 비용도 고려해야 한다. 특히 백엔드 공통 HTTP 클라이언트는 장애 반경이 넓다. 작은 차이가 결제, 알림, 인증 연동 장애로 이어질 수 있다.

## 언제 fetch로 옮길까

반대로 다음 경우에는 fetch 전환을 검토할 만하다.

- 새 Node.js 백엔드 프로젝트다.
- edge runtime이나 serverless와 코드를 공유한다.
- 외부 의존성을 줄이고 싶다.
- HTTP 호출 패턴이 단순하다.
- 공통 wrapper를 새로 설계할 수 있다.
- 표준 API 기반으로 팀 컨벤션을 맞추고 싶다.

특히 신규 프로젝트라면 Axios를 기본으로 넣기 전에 한 번 멈춰볼 필요가 있다. 지금은 Node.js 런타임 자체가 충분한 HTTP 클라이언트를 제공하는 시대다.

## 마이그레이션 전략

기존 프로젝트에서 마이그레이션한다면 한 번에 바꾸지 않는 편이 좋다.

1. 현재 Axios 사용 패턴을 검색한다.
2. interceptor, timeout, retry, 에러 처리 의존성을 정리한다.
3. fetch 기반 wrapper를 만든다.
4. 신규 코드부터 wrapper를 사용한다.
5. 위험이 낮은 호출부터 옮긴다.
6. HTTP 상태별 테스트를 추가한다.
7. 관측성 지표가 동일하게 남는지 확인한다.

가장 중요한 테스트는 실패 케이스다. 400, 401, 404, 429, 500, timeout, invalid JSON, empty body를 확인해야 한다. 성공 응답만 테스트하면 마이그레이션 리스크를 잡지 못한다.

## 결론

Node.js 백엔드에서 Axios는 여전히 좋은 도구다. 하지만 더 이상 습관적으로 추가해야 하는 기본 의존성은 아니다. Node.js의 내장 fetch가 성숙해지면서, 새 프로젝트에서는 표준 API를 기본값으로 삼을 이유가 충분해졌다.

다만 마이그레이션은 단순 치환이 아니다. Axios와 fetch는 에러 처리와 타임아웃 모델이 다르다. 운영 백엔드에서는 이 차이가 장애로 이어질 수 있다.

정리하면 이렇다.

- 새 프로젝트: fetch + 내부 wrapper를 기본으로 검토한다.
- 기존 프로젝트: Axios 사용 이유와 의존성을 먼저 파악한다.
- 공통 원칙: HTTP 호출 정책은 한 곳에 모으고, 실패 케이스를 테스트한다.

의존성을 줄이는 것보다 중요한 것은 예측 가능한 HTTP 클라이언트 계층을 갖는 것이다.

## 참고

- Node.js Blog: Axios to WHATWG Fetch
- Node.js Blog: Node.js 24 LTS, Node.js 26 Current release notes
