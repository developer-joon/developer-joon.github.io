---
title: 'Vercel Runtime Cache의 회로 차단기는 왜 잠깐 오래된 데이터를 허용하는가'
date: 2026-10-30 09:00:02 +0900
categories: ["개발/백엔드"]
description: 'Vercel Runtime Cache의 지역별 저장소·태그 무효화·회로 차단기 경계를 분리하고, 트래픽 급증 때 지연과 stale read를 함께 관측하는 검증 설계.'
featured_image: 'https://picsum.photos/seed/news-2026-10-30-vercel-blog-simplifying-runtime-caching-on-vercel/1600/900'
tags: [vercel, runtime-cache, nextjs, caching, circuit-breaker, stale-data, web-performance]
---

![Vercel Runtime Cache 글의 대표 이미지](https://picsum.photos/seed/news-2026-10-30-vercel-blog-simplifying-runtime-caching-on-vercel/1600/900)

캐시 무효화 직후 오래된 값이 한 번이라도 보이면 실패일까. 재고 차감이나 권한 회수라면 그렇다. 반면 상품 설명처럼 짧은 stale window가 허용되는 데이터에서는 origin과 cache control plane이 동시에 흔들릴 때 모든 요청을 느리게 만드는 것보다 제한된 stale read가 나을 수 있다.

Vercel은 Next.js Data Cache를 Runtime Cache로 통합하면서 지역별 Redis fleet, tag timestamp, 트래픽 급증 때의 circuit breaker를 공개했다.[1] 중요한 점은 p99 개선만 떼어 읽지 않는 것이다. **지연을 낮춘 경로가 freshness 계약을 어떻게 바꾸는지 같은 그래프에서 확인해야 한다.**

## CDN cache와 Runtime Cache는 다른 층이다

CDN cache는 완성된 HTTP response를 저장한다. Runtime Cache는 response를 만드는 데 쓰는 데이터나 함수 결과를 저장한다. 개인화된 HTML을 매번 렌더링하더라도 catalog data는 재사용할 수 있다.[1]

Runtime Cache는 지역별로 분리된다. 한 region에서 miss가 나면 다른 region의 copy를 찾지 않고 application이 origin에서 값을 계산해 그 region에 쓴다. Entry에는 tag와 write time이 있고, read 때 같은 region의 tag store에서 invalidation timestamp를 확인한다. Tag가 entry보다 나중에 무효화됐다면 stale이다.[1]

이 구조에서 관측 단위는 전역 hit rate 하나가 아니다.

```text
region + cache_key + value_version + written_at
region + tag + invalidated_at
request + hit/miss + served_version + origin_version
```

Region A에서 invalidation이 보였다고 Region B의 다음 request가 반드시 같은 시각에 miss가 되는 것은 아니다. 전파 지연을 독립 지표로 둬야 한다.

## 회로 차단기가 보호하는 대상

Vercel 설명에 따르면 무효화 확인 경로가 traffic spike 동안 병목이 되면 circuit breaker가 최근 invalidation을 잠시 보수적으로 다루어 cache read 경로를 살린다. 그 결과 일부 최근 무효화된 entry가 짧게 fresh처럼 취급될 수 있다.[1] 이는 strong consistency 선언이 아니라 availability와 tail latency를 위한 degradation mode다.

Vercel이 공개한 “p99가 종전의 약 5분의 1”이라는 수치도 공급자 측정이다. 가장 큰 region의 큰 traffic spike 구간을 비슷한 traffic과 비교한 결과이며, 모든 project·region·key distribution의 보장이 아니다.[1]

따라서 acceptance criterion을 둘로 나눈다.

1. 정상 상태: invalidation 후 허용 시간 안에 모든 관측 region이 새 version을 반환한다.
2. 과부하 상태: p99 상한과 함께 stale response 비율·최대 stale age가 business budget 안에 든다.

지연만 통과하고 freshness가 실패하면 성공이 아니다.

## 버전 값을 response에 싣는다

Cache behavior를 검사할 때 body가 같아 보이는지만 확인하면 stale을 놓친다. Origin record에 단조 증가 `version`과 `updated_at`을 넣고 response header에도 관측값을 싣는다.

```text
X-Data-Version: 42
X-Data-Updated-At: 2026-10-30T00:00:00Z
X-Cache-Region: iad1
X-Trace-Id: ...
```

`X-Cache-Region`은 예시용 내부 관측 필드이지 Vercel이 제공한다고 주장하는 header가 아니다. 실제 region 정보는 runtime이 노출하는 지원된 field와 server log에서 수집해야 한다.

## 제안 fixture: invalidate와 burst를 분리한다

다음 fixture는 **이 글에서 실행하지 않은 제안**이다. Production key나 실제 고객 데이터를 쓰지 않고 전용 project·전용 tag로 수행한다.

1. `catalog-test` tag로 version 1을 각 대상 region에서 warm한다.
2. Origin을 version 2로 바꾸고 tag invalidation을 한 번 호출한다.
3. Region별 저부하 요청으로 정상 전파 시간을 잰다.
4. 별도 실행에서 invalidation 직후 병렬 burst를 넣는다.
5. 각 response의 version, latency, region, trace ID를 저장한다.

Runtime Cache 공식 문서는 item 최대 2MB, item당 tag 128개, tag 최대 256 bytes를 명시한다. Tag purge 호출은 plan별 rate limit이 있으며 초과 시 일부 API는 429를 던지고 cache는 변경되지 않는다.[2] 무효화 호출을 보냈다는 사실이 성공을 뜻하지 않으므로 status와 재시도를 기록해야 한다.

```js
// 제안용 관측 구조. 실제 배포 전 채택한 SDK 버전의 타입을 확인한다.
{
  traceId,
  region,
  cacheKey,
  requestedAt,
  latencyMs,
  servedVersion,
  originVersionAtCheck,
  invalidationId,
  invalidationAcceptedAt
}
```

Fixture는 CDN response cache를 끄거나 별도 key로 격리해야 한다. 그렇지 않으면 Runtime Cache hit를 측정한다고 생각하면서 CDN의 완성 response를 재사용할 수 있다.

## 배포와 무효화를 혼동하지 않는다

Runtime Cache entry는 deployment가 바뀌어도 storage에 남을 수 있다. 다만 key 구성에 build identity가 포함되는 API는 새 build에서 예전 entry를 읽지 않을 수 있다. Vercel 문서는 직접 고른 key로 `getCache`를 쓰는 경우 deployment 사이에서도 읽을 수 있고, Next.js `use cache: remote`의 동작은 현재 Next.js 16 기준이라고 경계를 둔다.[2]

따라서 배포 시험은 세 가지를 나눈다.

- 같은 build에서 tag invalidation
- 새 build가 같은 application key를 읽는지
- value schema가 바뀐 뒤 오래된 entry를 안전하게 거부하는지

Schema version을 key에 넣지 않고 return shape만 바꾸면 deployment를 넘은 cache reuse가 malformed data를 낼 수 있다. 반대로 build마다 key를 바꾸면 hit rate가 떨어져도 invalidation 문제로 오인할 수 있다.

## stale 허용 데이터와 금지 데이터를 분류한다

모든 key에 같은 정책을 적용하지 않는다.

| 데이터 | stale 허용 기본값 | 이유 |
|---|---:|---|
| 공개 문서·카탈로그 설명 | 짧은 창 검토 가능 | 사용자 피해가 제한적 |
| 가격·재고 | 매우 제한적 | 주문 결과와 충돌 가능 |
| 권한·차단 상태 | 금지에 가깝게 | 접근 제어 우회 위험 |
| feature flag | flag별 상이 | kill switch는 즉시성 필요 |

강한 freshness가 필요한 key는 cache를 건너뛰거나 별도의 authoritative check를 둔다. Circuit breaker의 존재를 application correctness의 예외 승인으로 오해하면 안 된다.

Runtime Cache의 성능 주장은 “더 빠른 캐시”에서 끝나지 않는다. 지역 격리, tag timestamp, purge rate limit, degradation mode를 포함한 계약이다. 운영 dashboard도 hit rate와 p99 옆에 invalidation acceptance, region propagation, stale age를 놓아야 이 교환관계가 보인다.

## Sources

[1] https://vercel.com/blog/simplifying-runtime-caching-on-vercel
[2] https://vercel.com/docs/caching/runtime-cache
