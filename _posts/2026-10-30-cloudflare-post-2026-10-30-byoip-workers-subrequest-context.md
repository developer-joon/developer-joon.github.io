---
title: '프록시를 한 번 더 거치면 보안 신호는 누구의 것인가: Workers BYOIP 컨텍스트 보존 실험'
date: 2026-10-30 09:00:06 +0900
categories: ["개발/도구"]
description: 'Cloudflare Workers가 BYOIP 목적지로 보내는 same-zone·cross-zone subrequest에서 CF-Worker, client IP, bot score와 JA3·JA4가 어느 연결을 나타내는지 검증합니다.'
featured_image: 'https://picsum.photos/seed/news-2026-10-30-cloudflare-post-2026-10-30-byoip-workers-subrequest-context/1600/900'
tags: [cloudflare-workers, byoip, bot-management, proxy, client-ip, waf]
---

![겹겹의 다리 아래로 이어지는 도로와 차량 불빛](https://picsum.photos/seed/news-2026-10-30-cloudflare-post-2026-10-30-byoip-workers-subrequest-context/1600/900)

Cloudflare는 BYOIP를 쓰는 Cloudflare-proxied hostname으로 향하는 Workers subrequest가 Workers context와 원래 client signal을 잃던 동작을 수정했다. 이전에는 destination의 security rule이 예상과 다르게 동작하거나 Bot Management가 원 사용자가 아닌 Cloudflare 내부 연결을 평가해 false `403`을 만들 수 있었다.[1]

“원래 client가 보존된다”는 문장을 모든 field에 적용하면 안 된다. Field마다 표현하는 연결과 보안 목적이 다르며 same-zone과 cross-zone도 다르다.

## 먼저 두 경로를 그린다

```text
same-zone:  client -> Cloudflare(zone A Worker) -> zone A BYOIP hostname
cross-zone: client -> Cloudflare(zone A Worker) -> zone B BYOIP hostname
```

수정 뒤 BYOIP destination은 `CF-Worker` header와 `cf.worker.upstream_zone`을 보존한다. Destination zone의 bot score, verified-bot 상태, JA3·JA4 fingerprint는 영향을 받던 요청에서 원래 end-user connection을 나타낸다.[1]

반면 cross-zone의 `CF-Connecting-IP`는 보안상 Workers client IP `2a06:98c0:3600::103`으로 설정된다. Same-zone subrequest는 계속 client IP를 반영한다.[1] 따라서 cross-zone에서 이 header를 원 사용자의 주소라고 기록하면 잘못된 정책이 된다.

## 관찰 matrix를 먼저 만든다

아래 실험은 **실제 Cloudflare account에서 실행하지 않은 제안 fixture**다. 두 zone, BYOIP destination, 허용된 test client를 사용하고 production WAF와 분리해야 한다.

| 경로 | 확인할 신호 | 해석 질문 |
|---|---|---|
| Same-zone | `CF-Worker`, upstream zone | Worker origin이 유지되는가 |
| Same-zone | `CF-Connecting-IP` | 원 client 주소가 반영되는가 |
| Cross-zone | `CF-Connecting-IP` | 고정 Workers client IP인가 |
| 둘 다 | bot score·verified bot | end-user connection 기준인가 |
| 둘 다 | JA3·JA4 | 내부 service TLS가 아닌가 |

Destination Worker나 origin은 요청 header와 WAF log의 field를 request ID로 묶어 저장한다. Bot score를 response로 그대로 노출하지 말고 접근 제한된 log에서 확인한다.

```js
export default {
  async fetch(request) {
    const id = crypto.randomUUID();
    const upstream = new URL(request.url);
    upstream.hostname = "byoip.example.invalid";
    const headers = new Headers(request.headers);
    headers.set("x-fixture-request-id", id);
    return fetch(new Request(upstream, { method: request.method, headers }));
  },
};
```

예시 hostname은 의도적으로 사용할 수 없는 값이다. 실제 fixture에서는 소유한 hostname만 넣고, header 위조 가능성과 Cloudflare가 생성한 metadata를 같은 신뢰 수준으로 다루지 않는다.

## False 403을 재현할 때의 기준

변경 전후 동일한 test client와 route를 호출하고 다음 세 정책을 분리한다.

1. 원 사용자 bot signal을 기준으로 하는 규칙
2. Worker가 어느 zone에서 왔는지 보는 규칙
3. Client IP allowlist·rate limit 규칙

한 규칙에 세 의미를 섞으면 fix 뒤에도 오판이 남는다. 예를 들어 cross-zone `CF-Connecting-IP`로 end-user allowlist를 판단하면 고정 Workers 주소를 사용자 주소로 오해한다. 반대로 bot score와 JA3·JA4는 이번 변경 뒤 원 end-user connection을 나타내므로 내부 service connection 기준 threshold를 그대로 유지하면 결과가 달라질 수 있다.[1]

## 배포 체크리스트

- Same-zone과 cross-zone log를 별도 표로 보존한다.
- `CF-Worker`와 `cf.worker.upstream_zone`의 존재·값을 확인한다.
- Bot Management field가 어느 connection을 표현하는지 rule comment에 적는다.
- Cross-zone `CF-Connecting-IP`의 고정 주소를 사용자 identity로 사용하지 않는다.
- False 403 canary를 만들고 expected status·matched rule ID를 기록한다.
- Rate limit, allowlist, bot rule을 각각 독립적으로 rollback할 수 있게 한다.

다중 proxy 환경에서 header 이름만 읽어서는 신호의 주체를 알 수 없다. **어느 hop이 값을 만들었고, same-zone과 cross-zone 중 어느 경로이며, field가 사용자 연결과 service 연결 중 무엇을 모델링하는지**가 정책의 일부여야 한다.

## Sources

[1] https://developers.cloudflare.com/changelog/post/2026-10-30-byoip-workers-subrequest-context/
