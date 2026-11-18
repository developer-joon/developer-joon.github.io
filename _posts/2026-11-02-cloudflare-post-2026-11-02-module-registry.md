---
title: 'Cloudflare Workers 모듈 로더가 바뀐다: require(ESM)·import.meta·top-level await 호환성 테스트'
date: 2026-11-02 09:00:03 +0900
categories: ["개발/도구"]
description: 'Workers의 새 module registry 기본 전환 전에 require(ESM), top-level await, import attributes와 import.meta 동작을 unbundled fixture로 비교하는 마이그레이션 가이드입니다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-cloudflare-post-2026-11-02-module-registry/1600/900'
tags: [cloudflare-workers, javascript, esm, commonjs, module-registry, compatibility-date]
---

![서로 연결된 금속 구조물과 푸른 하늘](https://picsum.photos/seed/news-2026-11-02-cloudflare-post-2026-11-02-module-registry/1600/900)

2026년 11월 17일부터 compatibility date가 `2026-11-17` 이상인 JavaScript Worker는 새 module registry를 기본 사용한다. 기존 Worker는 날짜나 flag를 바꾸기 전까지 현재 동작을 유지하며 Python Worker는 legacy registry에 남는다.[1]

따라서 배포 중단의 원인은 플랫폼이 어느 날 임의로 바뀌는 것보다, dependency update와 함께 compatibility date를 올려 두 변경을 한 번에 넣는 경우에 가깝다. 날짜 변경을 독립 PR로 만들고 module loading fixture를 먼저 통과시키는 편이 안전하다.

## 네 가지 경계를 따로 시험한다

새 registry는 Node.js compatibility를 쓰는 Worker에서 `require()`로 ES module을 불러올 수 있게 한다. 단, 대상 module이나 dependency 중 하나라도 top-level `await`를 쓰면 `require()`는 실패한다. 새 registry는 잘못된 import attribute도 거부한다.[1]

`import.meta.url`, `import.meta.main`, `import.meta.resolve()`도 사용할 수 있다. 다만 `resolve()`는 bundle 안 URL을 계산할 뿐 파일 존재 여부를 검사하거나 network에서 module을 가져오지 않는다. Build tool이 `import.meta`를 변환할 수도 있으므로 unbundled fixture와 실제 production bundle을 분리해야 한다.[1]

아래 구조는 **제안 fixture이며 여기서는 배포·실행하지 않았다**.

```text
src/
  index.js            # import.meta와 require() 결과를 JSON으로 반환
  sync-esm.js         # 동기 ESM export
  async-leaf.js       # top-level await 사용
  invalid-attr.js     # 잘못된 import attribute 사례
wrangler.jsonc
```

```js
// src/index.js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export default {
  fetch() {
    const sync = require("./sync-esm.js");
    return Response.json({
      value: sync.value,
      url: import.meta.url,
      main: import.meta.main,
      missing: import.meta.resolve("./not-present.js"),
    });
  },
};
```

## 같은 source를 세 구성으로 비교한다

| 구성 | compatibility 설정 | 기대 목적 |
|---|---|---|
| Legacy baseline | 기존 날짜 + `legacy_module_registry` | 현재 production 동작 보존 |
| Opt-in | 기존 날짜 + `new_module_registry` | 날짜 이동 전 영향 분리 |
| New default | `2026-11-17` 이상, registry flag 없음 | 최종 기본 경로 확인 |

각 구성에서 sync ESM은 성공 여부와 export shape를 저장한다. Top-level-await dependency는 실패 phase와 error message를 저장한다. `import.meta.main`은 unbundled entrypoint에서 `true`인지 확인하고, 존재하지 않는 경로도 `resolve()`가 URL을 반환할 수 있음을 검증한다. Invalid import attribute가 legacy에서 우연히 통과하더라도 새 registry에서 거부되면 호출부를 고친다.

## 번들러가 결과를 가리지 않게 한다

먼저 unbundled deployment로 runtime 자체의 동작을 확인한다. 그다음 production bundler를 켜고 emitted module graph, chunk, transformed `import.meta`, externalized dependency를 비교한다. 두 결과가 다르면 “Workers registry 문제”로 단정하지 말고 build-time transform과 runtime resolution을 나눠 조사한다.

`require()`가 한 package에서는 성공했다고 전체 dependency tree가 안전한 것도 아니다. Transitive dependency의 top-level await 하나가 전체 synchronous require 경로를 실패시킬 수 있다.[1] Lockfile에서 reachable graph를 고정하고 실제 entrypoint별로 시험해야 한다.

## 롤아웃과 복구

1. Production compatibility date와 flag를 기록한다.
2. `new_module_registry`만 켠 preview environment에서 fixture와 애플리케이션 테스트를 실행한다.
3. Import attribute와 `require()` 호출을 inventory한다.
4. Bundled·unbundled 결과를 구분해 보존한다.
5. 날짜를 올린 뒤에는 임시 복구용 `legacy_module_registry`가 동작하는지 확인한다.
6. 안정화 후에만 legacy flag 제거 일정을 잡는다.

Compatibility flag는 영구적인 설계 대체물이 아니라 migration 제어 장치다. 최종 목표는 새 registry에서 동기·비동기 module 경계가 명확한 source를 만드는 것이다. 날짜를 미루는 것보다 먼저 “어떤 dependency가 synchronous require를 요구하고, 어느 module부터 top-level await가 들어오는가”를 답할 수 있어야 한다.

## Sources

[1] https://developers.cloudflare.com/changelog/post/2026-11-02-module-registry-default/
