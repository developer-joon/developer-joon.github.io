---
title: 'Feature Flag를 로컬에서만 뒤집기: Cloudflare Flagship의 원격 오염 없는 테스트'
date: 2026-11-02 09:00:10 +0900
categories: ["개발/도구"]
description: 'Cloudflare Flagship local store의 빈 초기 상태, 원격 flag 복사, 로컬 변경과 remote mode를 같은 test suite로 비교해 운영 flag를 건드리지 않는 개발 경계를 만듭니다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-cloudflare-post-2026-11-02-local-flag-store/1600/900'
tags: [cloudflare-flagship, feature-flags, local-development, wrangler, vite, vitest]
---

![작은 스위치가 놓인 책상과 분리된 두 개의 조명](https://picsum.photos/seed/news-2026-11-02-cloudflare-post-2026-11-02-local-flag-store/1600/900)

Cloudflare Flagship binding은 `wrangler dev`, Vite plugin, Vitest, `cf dev`에서 remote application 대신 local flag store를 평가할 수 있다. Local store는 빈 상태로 시작하며 code가 제공한 default value를 반환한다.[1]

이 기능의 가치는 “offline에서도 flag를 쓸 수 있다”보다 **개발자가 test를 위해 production flag를 바꾸지 않아도 된다는 점**이다. Remote와 local을 같은 이름으로 다루더라도 state source와 mutation 범위는 명시적으로 분리해야 한다.

## 네 상태를 같은 suite로 비교한다

| 상태 | 준비 | 검증 |
|---|---|---|
| Empty local | 아무 flag도 저장하지 않음 | code default 반환 |
| Pulled local | `npx wrangler flagship flags pull "$APP_ID"` | 복사 시점의 값 재현 |
| Mutated local | local 값만 변경 | test branch만 변화 |
| Remote | `remote: true` | 실제 remote evaluation, 별도 승인 |

먼저 remote application ID를 명시해 local store를 채운다. `APP_ID`는 Flagship application 설정에서 얻은 non-production ID로 바꾸고, production account에 쓰기 권한이 없는 test identity를 사용한다.[1]

```bash
set -euo pipefail
APP_ID='replace-with-non-production-app-id'
npx wrangler flagship flags pull "$APP_ID"
```

아래 TypeScript는 binding 초기화나 local-state directory를 제공하지 않는 **실행 불가능한 제안 pseudocode**다. `evaluateCheckoutFlag`는 실제 project의 Flagship binding adapter로 교체하고, 위에서 pull한 store와 local override를 test setup에서 명시적으로 연결해야 한다.

```ts
import { describe, expect, it } from "vitest";

const cases = [
  { user: "baseline", expected: false },
  { user: "local-on", expected: true },
];

describe("checkout-v2", () => {
  for (const c of cases) {
    it(c.user, async () => {
      const result = await evaluateCheckoutFlag(c.user, false);
      expect(result).toBe(c.expected);
    });
  }
});
```

Empty local 상태에서는 두 case 모두 code default로 귀결되는지 먼저 확인한다. 그다음 pull한 snapshot과 local override를 각각 별도 directory에 두고 같은 suite를 실행한다. Test가 통과했다는 이유로 remote state가 바뀌지 않았다고 가정하지 말고 실행 전후 remote flag revision을 read-back한다.

## Offline 재현성을 증명한다

Local state를 만든 뒤 network를 끊고 test를 다시 실행한다. DNS failure나 API 차단에도 같은 결과가 나와야 “local evaluation” 증거가 된다. Build cache나 이전 remote response가 결과를 대신하지 않도록 fresh workspace에서도 반복한다.

Snapshot에는 secret이나 개인 식별 targeting data를 넣지 않는다. Flag key, variant, default, 필요한 test attribute만 최소화하고 repository에 commit할지 여부를 별도 검토한다. 원격 state 전체 dump는 편리하지만 production rule과 사용자 segment를 과도하게 복제할 수 있다.

## 도구별 결과를 맞춘다

공식 발표는 local store를 Wrangler, Vite plugin, Vitest, Local Explorer 경로에서 제공한다.[1] Dev server에서만 통과하고 Vitest adapter가 다른 store를 읽으면 test가 deployment behavior를 대표하지 못한다. 동일한 fixture state와 evaluation context를 각 adapter에 주고 variant, reason, default 사용 여부를 비교한다.

## 최소 version과 rollout 경계

Local development 지원의 최소선은 Wrangler `4.135.0` 또는 Vite plugin `1.56.0`이다. Local Explorer는 더 높은 최소 version을 요구한다.[1] “Cloudflare 개발 환경이면 모두 동작한다”고 쓰지 말고 package lock과 CLI version을 artifact에 남긴다.

Remote mode는 local 검증의 마지막 단계로만 사용한다. `remote: true`를 기본 configuration에 남기면 offline test가 우연히 production state에 의존하고, flag 변경 시간에 따라 flaky해질 수 있다. CI에서는 network egress와 credential scope로 remote 접근을 차단하고 필요한 integration job만 명시적으로 허용한다.

## 승인 체크리스트

1. Empty store가 documented default를 반환한다.
2. Pull snapshot의 생성 시각과 source environment를 기록한다.
3. Local mutation이 remote revision을 바꾸지 않았음을 read-back한다.
4. Network-off test가 fresh workspace에서 재현된다.
5. Wrangler·Vite·Vitest가 같은 context에서 같은 variant를 낸다.
6. Remote integration은 별도 credential과 non-production flag로 제한한다.

Feature flag test의 신뢰성은 toggle 수보다 상태 소유권에서 나온다. Local store를 기본으로 두고 remote 접근을 예외로 만들면 개발 속도를 유지하면서 운영 flag 오염과 시간 의존성을 줄일 수 있다.

## Sources

[1] https://developers.cloudflare.com/changelog/post/2026-11-02-local-flag-store/
