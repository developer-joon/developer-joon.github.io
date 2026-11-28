---
title: 'Valkey 9.2 Path Hash가 LLM 캐시 라우팅을 단순화할까: 메모리·적중률 실험'
date: 2026-11-28 07:15:00 +0900
categories: ["AI"]
description: 'Valkey 9.2 Path Hash를 기존 문자열 키와 비교해 LLM prefix 캐시의 라우팅 적중률, 메모리, tail latency와 hot-key 편향을 검증하는 실험을 설계한다.'
featured_image: 'https://picsum.photos/seed/valkey-path-hash-llm-cache/1600/900'
tags: [valkey, path-hash, llm-cache, inference, caching, benchmark]
---

![풀밭 옆에 놓인 낡은 붉은색 금속 통](https://picsum.photos/seed/valkey-path-hash-llm-cache/1600/900)

LLM inference cache의 key는 금방 복잡해진다. Tenant, model revision, system prompt, tool schema, prompt prefix와 decoding policy를 한 문자열에 붙이면 exact lookup은 쉽지만 “가장 긴 공통 경로”를 찾으려면 client가 여러 후보 key를 만들어 순서대로 조회하거나 별도 index를 관리해야 한다. 이때 Valkey 9.2의 새 Path Hash가 라우팅을 단순화할 수 있다.

Valkey 9.2.0은 2026년 11월 19일, 9.2.1은 11월 26일 공개됐다. 공식 download page는 Path Hash, forkless snapshot, 대형 sorted set의 B+ tree, ACL role, hot-key detection을 주요 기능으로 제시한다.[1] Path Hash는 binary-safe path에 대해 exact lookup, longest-prefix matching과 prefix traversal을 제공하는 radix-tree 기반 data type이며 `PH*` command를 사용한다.[2]

하지만 “LLM inference cache용”이라는 use case가 곧 semantic cache를 뜻하지는 않는다. Path Hash는 정규화된 계층 path의 가장 구체적인 prefix를 찾는 도구다. 임베딩 거리가 가까운 문장을 찾거나 임의 token sequence의 의미 유사성을 판단하지 않는다. 이 글은 feature를 직접 실행해 얻은 benchmark 결과가 아니라, 기존 key 설계와 비교할 때 무엇을 측정해야 하는지 정리한 검증안이다.

## Path Hash가 줄이는 것은 검색 단계다

기존 문자열 key 방식에서 `/tenant/model/prefix/segment`의 가장 긴 match를 찾으려면 client가 전체 path부터 상위 segment까지 잘라 `GET`을 반복하거나 Lua·sorted set·별도 trie를 사용한다. 이 로직은 retry와 network round trip을 늘리고 client마다 normalization이 달라질 위험이 있다.

Valkey 9.2 release 글의 예시는 `/api/v2`와 `/api/v2/billing`을 저장한 뒤 `PHPREFIXES ... COUNT 1 WITHVALUES`로 `/api/v2/billing/invoices/123`에 가장 구체적으로 일치하는 `/api/v2/billing` 값을 한 번에 찾는다.[2] LLM cache에서는 이를 다음과 같은 논리 path로 응용할 수 있다.

```text
/tenant/acme/model/qwen-rev-42/template/chat-v3/prefix-v1/c0000-8f2a.../c0001-19bd.../c0002-a470...
```

Raw prompt를 path에 그대로 넣지 않는다. 개인정보와 secret 노출, path 길이 폭증, normalization 차이 때문이다. Tenant·model·template 같은 routing dimension은 명시적인 안전한 segment로 둔다. Canonical token ID sequence는 고정 크기 `N` token chunk로 앞에서부터 나누고, 각 chunk의 digest를 순서와 함께 **개별 path segment**로 직렬화한다. 첫 chunk까지의 path, 첫 두 chunk까지의 path처럼 재사용 가능한 누적 경계를 각각 `PHSET`해야 query path와 저장 path의 prefix 관계가 보존된다.

계약에는 tokenizer·normalization revision, `N`, digest algorithm·encoding, segment 순서, 최소 재사용 chunk 수와 최대 path 길이를 넣는다. 끝의 부분 chunk는 기본적으로 LPM index에 넣지 않고 exact artifact 검증에만 사용한다. 부분 chunk도 재사용하려면 길이를 segment에 포함하는 별도 version을 정의하고 같은 token 경계에서만 match시킨다. 전체 token prefix를 digest 하나로 만든 `/exact-v1/<full-prefix-digest>` key는 exact lookup 비교군이다. 입력의 연장 관계가 digest의 path prefix 관계로 보존되지 않으므로 Path Hash LPM arm으로 부르지 않는다.

Data plane과 routing index를 분리하면 Valkey entry 크기를 줄일 수 있지만 locator가 stale해지는 새 실패 모양이 생긴다. Hit 판정은 index match가 아니라 실제 artifact가 존재하고 revision·checksum이 맞을 때만 성공으로 기록한다.

## 비교군은 자료구조보다 같은 의미를 가져야 한다

공정한 실험은 세 arm을 둔다.

- **Exact digest:** 전체 canonical token prefix의 digest 하나로 완전 일치 key만 조회한다.
- **Client prefix walk:** client가 가장 긴 후보부터 줄여 여러 `GET`을 시도한다.
- **Path Hash:** 같은 logical prefix set을 `PHSET`으로 넣고 가장 구체적인 match를 한 command로 조회한다.

세 arm은 동일한 entry, TTL, tenant isolation과 eviction policy를 가져야 한다. Exact digest는 기능이 다르므로 longest-prefix 정확도를 직접 비교하지 않고 exact-only workload의 비용 하한으로 사용한다. Prefix walk와 Path Hash는 같은 canonicalizer, chunk 경계와 longest-prefix semantics를 가져야 한다. Golden test는 `N-1`, `N`, `N+1`, `2N`, `2N+1` token 입력에서 생성되는 segment와 누적 `PHSET` path를 exact fixture로 고정하고, 한 token만 다른 chunk·tokenizer revision mismatch·최소 재사용 길이 미달·최대 path 길이 초과가 match되지 않는지 확인한다. Empty segment, trailing slash, percent encoding, Unicode normalization과 binary zero도 포함해 client와 server의 해석 차이를 먼저 잡는다.

실제 LLM 응답이나 KV block을 쓰지 않아도 routing 실험은 가능하다. 합성 prefix tree와 value locator를 만들고 Zipf형 인기, tenant별 model 분포, prompt 길이와 shared-prefix depth를 조절한다. Query set에는 exact hit, ancestor hit, miss, expired locator와 잘못된 model revision을 섞는다. Ground truth resolver를 별도 순수 함수로 구현해 세 arm의 반환값을 비교한다.

한 workload만 쓰면 결론이 편향된다. Shared system prompt가 긴 chat service, tenant별 prompt가 거의 다른 service, model revision이 자주 교체되는 배포를 별도 strata로 둔다. Prefix 공유가 거의 없다면 Path Hash가 정확해도 hit-rate 이득은 작을 수 있다.

## 적중률은 두 단계로 나눠 계산한다

Cache 실험에서 “match를 찾았다”와 “재사용할 수 있다”를 섞으면 stale entry가 hit로 계산된다. 다음 두 지표를 나눈다.

```text
routing_match_rate = prefix resolver가 locator를 반환한 query / 전체 query
usable_hit_rate = revision·token boundary·artifact 검증까지 통과한 query / 전체 query
```

여기에 `false_route_rate`를 둔다. 다른 tenant, model, tokenizer, chat template나 tool schema의 entry를 반환하면 응답 품질 문제가 아니라 isolation 위반이므로 평균 hit-rate와 무관하게 0건이어야 한다. Cache key에는 model name만이 아니라 immutable revision과 tokenizer·template digest가 필요하다.

Longest-prefix가 항상 최적 cache hit도 아니다. 너무 짧은 ancestor는 재사용 token이 적어 lookup·transfer 비용보다 이득이 작을 수 있다. `matched_prefix_tokens`, `reused_tokens`, `lookup_latency`, `artifact_fetch_latency`, `saved_prefill_ms`를 기록해 순이익을 계산한다. 사전에 최소 재사용 token threshold를 정하고 그보다 짧은 match는 miss로 처리하는 arm도 비교한다.

Hit-rate는 warm-up, steady state와 churn 구간을 따로 낸다. 전체 평균 하나는 배포 직후 cache가 찬 과정과 안정된 서비스를 섞는다. Model rollout로 namespace가 바뀌는 순간 old entry가 안전하게 miss가 되는지도 본다.

## 메모리는 entry 수가 아니라 server 전체로 잰다

공식 자료는 대형 sorted set이 skiplist 대신 B+ tree를 사용하며 특정 benchmark에서 member당 memory overhead가 50.3 byte에서 28.5~32.0 byte로 줄었다고 설명한다. 조건은 20-byte element 500만 개이고 절감 폭은 36~43%다.[2] Download page의 “최대 43%”를 Path Hash나 전체 LLM cache의 일반적인 절감으로 인용하면 안 된다.[1]

Path Hash 실험에서는 logical route당 memory, process RSS, allocator fragmentation과 persistence artifact 크기를 따로 측정한다. 같은 logical mapping을 string key, prefix-walk용 다중 key와 Path Hash로 표현했을 때 client 방식이 ancestor 후보를 중복 저장하는지에 따라 차이가 커질 수 있다. Value payload가 매우 크면 index 자료구조 절감은 전체 RSS에서 작게 보일 수 있다.

Dataset scale은 1만, 10만, 100만 route처럼 늘린다. Insert·update·delete 뒤 memory가 회수되는지, TTL expiration과 churn에서 fragmentation이 어떻게 변하는지 본다. `MEMORY USAGE` 합계와 process RSS는 같은 값이 아니므로 둘 다 기록한다.

Persistence 시험에서는 RDB·AOF 설정과 측정 시점을 고정한다. Snapshot 중 메모리와 latency를 볼 때 새 forkless 기능을 별도 축으로 둔다. Path Hash와 forkless snapshot을 동시에 켜고 기존 버전과 비교하면 어떤 기능이 차이를 만들었는지 알 수 없다.

## Forkless snapshot은 opt-in 비용까지 포함한다

Valkey 9.2는 opt-in forkless RDB snapshot과 replica full sync를 추가했다. `forkless-infrastructure-enabled`와 `forkless-policy`로 설정하며 background thread에서 snapshot을 만들어 write-heavy workload에서 fork의 copy-on-write memory overhead를 피하려는 기능이다.[2] Infrastructure 활성화에는 key당 4 byte가 추가되고 startup config가 필요하며, `prefer-forkless`는 forkless로 실행할 수 없을 때 fork로 fallback한다.[2]

따라서 snapshot 실험은 네 조건을 분리한다.

| 조건 | Path Hash | Forkless |
|---|---:|---:|
| 기준 | 없음 | 없음 |
| routing만 | 있음 | 없음 |
| snapshot만 | 없음 | 있음 |
| 조합 | 있음 | 있음 |

각 조건에서 snapshot 전·중·후 RSS, used memory, write throughput, command p95·p99, snapshot duration과 결과 type을 기록한다. `INFO persistence`의 `rdb_last_bgsave_type`을 확인해 실제로 forkless였는지 검증한다.[2] 정책 이름만 보고 성공으로 판정하면 fallback run이 섞일 수 있다.

이 기능이 항상 메모리를 줄인다고 가정하지 않는다. Key당 4 byte의 상시 비용, background thread contention과 workload 특성을 함께 본다. Read-heavy하고 key 수가 많지만 write가 적은 cache에서는 trade-off가 다를 수 있다. Replica full sync와 BGSAVE도 별도 scenario로 나눈다.

## Tail latency와 hot key 편향을 같이 본다

평균 latency가 낮아도 특정 tenant의 긴 path와 hot prefix가 한 shard를 몰아치면 p99가 나빠질 수 있다. Query generator는 uniform뿐 아니라 실제 cache에 가까운 skew를 포함하고 command latency histogram을 client와 server 양쪽에서 수집한다. Pipeline depth, connection 수, concurrency와 network RTT를 고정한다.

Valkey 9.2의 hot-key detection은 `HOTKEYS GET`과 `HOTKEYS RESET`을 제공하며 `hotkeys-top-k` 설정으로 켠다. Space-Saving algorithm으로 고정 크기 summary에서 가장 뜨거운 key K개를 추적하므로 access-rate threshold를 직접 정하는 방식은 아니다.[2] 이것은 exact한 전체 frequency table이 아니라 heavy hitter 관찰 도구다.

Path Hash container key 하나 아래 많은 path를 저장할 때 hot-key 관찰의 단위가 원하는 route와 같은지 실제 command output으로 확인해야 한다. Top-level key만 보이면 내부 prefix의 hotspot을 구분하지 못할 수 있다. 이 경우 application trace에서 matched path와 tenant를 별도 metric으로 남긴다. 공개 문서가 내부 path별 hotness를 보장한다고 확대하지 않는다.

운영 통제로는 hot route의 replica 분산, TTL jitter, namespace sharding과 per-tenant rate limit을 고려할 수 있다. 하지만 shard 수를 늘리면 longest-prefix search가 shard 경계를 넘지 않는지 확인해야 한다. Parent와 child path가 서로 다른 shard로 갈 수 있는 hash policy는 한 번의 lookup이라는 장점을 없앨 수 있다.

## ACL role과 rollback을 실험의 끝에 둔다

Valkey 9.2의 ACL role은 permission policy를 한 번 정의해 여러 user에게 적용하고 role 변경을 보유 user에게 즉시 반영한다. User는 role 위에 permission을 더할 수 있지만 role보다 제한적으로 만들 수는 없다고 release 글은 설명한다.[2] Cache reader, writer, operator를 분리할 때 편리하지만 기존 user의 추가 selector가 예상보다 넓은 권한을 만들지 audit해야 한다.

Path Hash pilot에서는 application user가 필요한 `PH*` command와 namespace만 접근하게 하고 snapshot·ACL·debug command는 operator role로 분리한다. Role 변경 regression은 기존 connection과 신규 connection에서 모두 확인한다. “role이 있다”는 사실만으로 tenant data isolation이 완성되는 것은 아니다. Key pattern과 application-level tenant binding을 함께 검증한다.

Upgrade와 rollback도 중요하다. 공식 글은 9.2가 minor release지만 edge-case behavior change가 있고 새 기능이 older version과 호환되지 않는 data format이나 동작을 만들 수 있으므로 release note를 읽고 downgrade 필요가 사라지기 전 새 기능을 켜지 말라고 권고한다.[2] LZ4·Zstd로 작성된 AOF base 등은 지원 version이 필요하다는 구체적 주의도 있다.[2]

따라서 canary replica에서 9.2 binary와 client support를 확인하고, Path Hash data를 만들기 전 backup·restore와 downgrade plan을 검증한다. Older client가 `PH*` response를 올바르게 decode하는지 보고, feature flag를 끌 때 index rebuild 경로를 준비한다.

## 결론: 한 번의 lookup이 전체 cache의 답은 아니다

Path Hash는 longest-prefix routing을 server의 한 command로 옮겨 client의 반복 조회와 normalization 분산을 줄일 가능성이 있다. Valkey는 이를 LLM inference cache의 use case로 명시하고 radix tree 기반 `PH*` command를 제공한다.[1][2] 그러나 semantic similarity search나 KV artifact lifecycle, tenant isolation과 stale locator 문제까지 해결하는 기능은 아니다.

검증은 같은 logical mapping을 exact string, client prefix walk, Path Hash로 표현하고 routing match와 usable hit를 나눠야 한다. 그 위에 memory per route와 RSS, snapshot 중 p99, hot-key 편향, ACL과 rollback을 측정한다. Forkless는 key당 상시 비용과 실제 fallback 여부를 포함해 독립 축으로 시험하고, B+ tree의 최대 43% 절감 수치는 해당 sorted-set 조건에만 귀속한다.[2]

실행하지 않은 수치를 채우지 말고 query generator, ground truth와 합격 기준을 먼저 공개한다. 최종 판단은 “새 command가 존재한다”가 아니라 **같은 workload에서 잘못된 route 없이 더 적은 왕복과 허용 가능한 메모리·tail latency로 usable hit를 만들었는가**여야 한다.

## Sources

[1] https://valkey.io/download/9.2/
[2] https://valkey.io/blog/valkey-9.2-release/
