---
title: 'TypeScript 6.0 RC 분석: ES5 폐기와 TypeScript 7.0 Go 포트 준비'
date: 2026-04-02 00:00:00
description: 'TypeScript 6.0 RC의 주요 변경사항과 breaking changes를 분석합니다. ES5 deprecated, strict 기본값, baseUrl 폐기, types 기본값 변경 등 TypeScript 7.0 Go 네이티브 포트를 위한 전환 전략을 안내합니다.'
featured_image: '/images/2026-04-02-typescript-6-rc-migration-guide/cover.jpg'
tags: [typescript, frontend, javascript]
---

![TypeScript 6.0 RC 주요 변경사항](/images/2026-04-02-typescript-6-rc-migration-guide/cover.jpg)

TypeScript 6.0 RC가 2026년 3월에 공개되었습니다. 이번 릴리스는 단순한 버전 업데이트가 아닌, **TypeScript 7.0 Go 네이티브 포트**를 위한 전환점(transition release)입니다. Microsoft TypeScript 팀은 TypeScript 7.0부터 컴파일러와 언어 서비스를 JavaScript에서 Go로 재작성하여, 네이티브 코드의 속도와 공유 메모리 멀티스레딩을 활용할 계획입니다.

TypeScript 6.0은 기존 JavaScript 코드베이스를 기반으로 한 **마지막 메이저 릴리스**이며, 5.9와 7.0 사이를 연결하는 다리 역할을 합니다. 이번 포스트에서는 6.0 RC의 주요 변경사항과 breaking changes, 그리고 7.0 준비 전략을 상세히 살펴보겠습니다.

## 왜 Breaking Changes가 많은가?

TypeScript 6.0은 의도적으로 많은 deprecated 기능과 기본값 변경을 포함하고 있습니다. 그 이유는 명확합니다:

1. **TypeScript 7.0 Go 재작성**: 완전히 새로운 코드베이스에서 레거시 기능을 지원하는 것은 비효율적
2. **생태계 현대화**: ES5, AMD, UMD 등 오래된 타겟은 거의 사용되지 않음
3. **성능 최적화**: 불필요한 옵션 제거로 컴파일 속도 향상
4. **더 나은 기본값**: 2년간의 베스트 프랙티스를 반영

## 주요 Breaking Changes와 마이그레이션

### 1. ES5 타겟 Deprecated

**변경 사항:**
- `target: es5`가 deprecated됨
- TypeScript의 최소 타겟이 **ES2015 (ES6)**로 상향

**배경:**
- ES2015는 10년 전에 릴리스됨
- Internet Explorer 종료 후 모든 주요 브라우저가 ES6+ 지원
- 실제 ES5가 필요한 사용 사례는 거의 없음

**마이그레이션:**
```json
// ❌ Deprecated
{
  "compilerOptions": {
    "target": "es5"
  }
}

// ✅ 권장
{
  "compilerOptions": {
    "target": "es2015"  // 또는 es2020, es2022 등
  }
}
```

**여전히 ES5가 필요한 경우:**
- 외부 컴파일러 사용 (Babel, esbuild 등)
- TypeScript → ES2015+ → Babel → ES5 파이프라인 구성

### 2. strict 기본값이 true로 변경

**변경 사항:**
- 새 프로젝트에서 `strict` 모드가 **기본적으로 활성화**됨
- 기존 프로젝트는 명시적으로 `false` 설정 필요

**strict 모드에 포함된 옵션:**
- `strictNullChecks`: null/undefined 엄격 검사
- `strictFunctionTypes`: 함수 타입 엄격 검사
- `strictBindCallApply`: bind/call/apply 타입 검사
- `noImplicitAny`: 암시적 any 금지
- `noImplicitThis`: this 타입 명시 강제

**마이그레이션 전략:**
```json
// 기존 프로젝트: 명시적으로 false 설정
{
  "compilerOptions": {
    "strict": false
  }
}

// 또는 점진적 마이그레이션
{
  "compilerOptions": {
    "strictNullChecks": true,
    "strictFunctionTypes": false,  // 하나씩 활성화
    "noImplicitAny": true
  }
}
```

### 3. types 기본값이 빈 배열([])로 변경

**변경 사항:**
- 이전: `node_modules/@types` 아래 모든 패키지를 자동 로드
- 현재: **기본적으로 아무것도 로드하지 않음**

**성능 영향:**
- 대부분의 프로젝트에서 20~50% 빌드 시간 단축
- 수백 개의 불필요한 타입 선언 파일 로드 방지

**마이그레이션:**
```json
// ✅ 명시적으로 필요한 타입만 지정
{
  "compilerOptions": {
    "types": ["node", "jest"]
  }
}

// 또는 기존 동작 유지 (권장하지 않음)
{
  "compilerOptions": {
    "types": ["*"]
  }
}
```

**흔한 에러와 해결:**
```
Cannot find name 'process'. Do you need to install type definitions for node?
→ "types": ["node"] 추가

Cannot find name 'describe'. Do you need to install type definitions for a test runner?
→ "types": ["node", "jest"] 또는 "mocha" 추가

Cannot find module 'fs' or its corresponding type declarations.
→ "types": ["node"] 추가
```

### 4. baseUrl Deprecated

**변경 사항:**
- `baseUrl`은 더 이상 모듈 해석 룩업 루트로 사용되지 않음
- `paths`의 접두사로만 사용되던 것을 명시적으로 변경

**문제점:**
```json
{
  "compilerOptions": {
    "baseUrl": "./src",
    "paths": {
      "@app/*": ["app/*"]
    }
  }
}
```

위 설정에서 `import "someModule.js"`는 의도치 않게 `src/someModule.js`로 해석될 수 있었습니다.

**마이그레이션:**
```json
// ❌ Before
{
  "compilerOptions": {
    "baseUrl": "./src",
    "paths": {
      "@app/*": ["app/*"],
      "@lib/*": ["lib/*"]
    }
  }
}

// ✅ After
{
  "compilerOptions": {
    "paths": {
      "@app/*": ["./src/app/*"],
      "@lib/*": ["./src/lib/*"]
    }
  }
}
```

**baseUrl을 룩업 루트로 사용했던 경우:**
```json
{
  "compilerOptions": {
    "paths": {
      "*": ["./src/*"],  // catch-all 매핑 추가
      "@app/*": ["./src/app/*"]
    }
  }
}
```

### 5. rootDir 기본값이 . (현재 디렉토리)로 변경

**변경 사항:**
- 이전: 모든 입력 파일의 공통 디렉토리를 자동 추론
- 현재: **tsconfig.json이 있는 디렉토리가 기본값**

**영향:**
- 출력 파일 구조가 변경될 수 있음
- `./dist/src/index.js` → `./dist/index.js` 같은 변화

**마이그레이션:**
```json
{
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"  // 명시적으로 설정
  },
  "include": ["./src"]
}
```

### 6. 기타 Deprecated 기능

**모듈 시스템:**
- `--module amd` ❌
- `--module umd` ❌
- `--module systemjs` ❌
- `--module none` ❌

**모듈 해석:**
- `--moduleResolution node` (node10) ❌ → `nodenext` 또는 `bundler` 사용
- `--moduleResolution classic` ❌

**기타:**
- `--downlevelIteration` ❌ (ES5 전용이므로)
- `--outFile` ❌ (번들러 사용 권장)
- `module Foo {}` 구문 ❌ → `namespace Foo {}` 사용
- `import ... asserts { type: "json" }` ❌ → `with` 키워드 사용

## 새로운 기능과 개선사항

### 1. Temporal API 타입 지원

오랫동안 기다려온 [Temporal proposal](https://github.com/tc39/proposal-temporal)이 Stage 3에 도달했고, TypeScript 6.0에서 빌트인 타입을 제공합니다.

```typescript
// ✅ TypeScript 6.0에서 사용 가능
let yesterday = Temporal.Now.instant().subtract({
  hours: 24,
});

let tomorrow = Temporal.Now.instant().add({
  hours: 24,
});

console.log(`Yesterday: ${yesterday}`);
console.log(`Tomorrow: ${tomorrow}`);
```

**설정:**
```json
{
  "compilerOptions": {
    "target": "esnext",
    "lib": ["esnext.temporal"]
  }
}
```

### 2. Map/WeakMap의 upsert 메서드

ECMAScript의 upsert proposal이 Stage 4에 도달하여 새로운 메서드들이 추가되었습니다:

```typescript
// Before: 번거로운 패턴
function processOptions(compilerOptions: Map<string, unknown>) {
  let strictValue: unknown;
  if (compilerOptions.has("strict")) {
    strictValue = compilerOptions.get("strict");
  } else {
    strictValue = true;
    compilerOptions.set("strict", strictValue);
  }
}

// After: getOrInsert 사용
function processOptions(compilerOptions: Map<string, unknown>) {
  let strictValue = compilerOptions.getOrInsert("strict", true);
}

// 비싼 연산의 경우: getOrInsertComputed
someMap.getOrInsertComputed("someKey", () => {
  return computeSomeExpensiveValue();
});
```

### 3. RegExp.escape

정규식에서 특수 문자를 이스케이프하는 표준 방법이 추가되었습니다:

```typescript
function matchWholeWord(word: string, text: string) {
  const escapedWord = RegExp.escape(word);
  const regex = new RegExp(`\\b${escapedWord}\\b`, "g");
  return text.match(regex);
}

// 예시
matchWholeWord("hello?", "Say hello? or hello!");
// RegExp.escape("hello?") → "hello\\?"
```

### 4. this-less 함수의 문맥 민감도 개선

화살표 함수가 아닌 메서드 구문에서도 타입 추론이 개선되었습니다:

```typescript
declare function callIt<T>(obj: {
  produce: (x: number) => T,
  consume: (y: T) => void,
}): void;

// ✅ TypeScript 6.0에서 모두 작동
callIt({
  consume(y) { return y.toFixed(); },  // y가 number로 올바르게 추론됨
  produce(x: number) { return x * 2; },
});
```

### 5. 서브패스 임포트 #/ 지원

Node.js 20+에서 지원하는 `#/`로 시작하는 서브패스 임포트를 지원합니다:

```json
// package.json
{
  "name": "my-package",
  "type": "module",
  "imports": {
    "#": "./dist/index.js",
    "#/*": "./dist/*"
  }
}
```

```typescript
// 이제 가능
import * as utils from "#/utils.js";
```

## TypeScript 7.0 준비 전략

### 1. ignoreDeprecations 옵션 사용

TypeScript 6.0에서는 일시적으로 deprecated 경고를 무시할 수 있습니다:

```json
{
  "compilerOptions": {
    "ignoreDeprecations": "6.0"
  }
}
```

**주의:** TypeScript 7.0에서는 이 옵션이 작동하지 않으며, deprecated 기능들이 완전히 제거됩니다.

### 2. ts5to6 코드모드 도구

자동 마이그레이션을 위한 실험적 도구가 제공됩니다:

```bash
npx @andrewbranch/ts5to6
```

이 도구는 `baseUrl`과 `rootDir` 설정을 자동으로 조정해줍니다.

### 3. --stableTypeOrdering 플래그

TypeScript 6.0과 7.0 간의 타입 순서 차이를 줄이기 위한 플래그입니다:

```json
{
  "compilerOptions": {
    "stableTypeOrdering": true
  }
}
```

**주의:** 타입 체킹이 최대 25% 느려질 수 있으므로, 6.0과 7.0 간 차이 진단 용도로만 사용하세요.

### 4. 단계적 마이그레이션 체크리스트

**Phase 1: 평가 (현재 ~ 2026년 5월)**
- [ ] 현재 프로젝트에서 deprecated 기능 사용 여부 확인
- [ ] `tsc --showConfig`로 실제 적용되는 설정 확인
- [ ] 테스트 커버리지 확인 (마이그레이션 시 회귀 방지)

```bash
# Deprecated 기능 사용 여부 확인
tsc --noEmit 2>&1 | grep -i deprecat
```

**Phase 2: 설정 업데이트 (2026년 6~7월)**
- [ ] `strict: true` 추가 (또는 점진적 활성화)
- [ ] `types` 배열 명시적 설정
- [ ] `baseUrl` 제거 및 `paths` 업데이트
- [ ] `rootDir` 명시적 설정
- [ ] `target` ES2015 이상으로 변경

**Phase 3: 코드 수정 (2026년 8~9월)**
- [ ] `module Foo {}` → `namespace Foo {}` 변경
- [ ] `import ... asserts` → `import ... with` 변경
- [ ] AMD/UMD 모듈을 ESM이나 CommonJS로 전환
- [ ] `externalIPs` 사용 제거 (Service 관련)

**Phase 4: 테스트 및 검증 (2026년 10월)**
- [ ] 전체 테스트 스위트 실행
- [ ] 타입 에러 수정
- [ ] 번들 크기 및 성능 검증
- [ ] TypeScript 7.0 네이티브 프리뷰 테스트

## 실전 마이그레이션 예시

### 예시 1: 레거시 프로젝트 (ES5 + UMD)

**Before (tsconfig.json):**
```json
{
  "compilerOptions": {
    "target": "es5",
    "module": "umd",
    "moduleResolution": "node",
    "lib": ["es5", "dom"],
    "baseUrl": "./src",
    "paths": {
      "@app/*": ["app/*"]
    }
  }
}
```

**After (tsconfig.json):**
```json
{
  "compilerOptions": {
    "target": "es2015",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2015", "dom", "dom.iterable"],
    "strict": false,  // 점진적 마이그레이션
    "types": ["node"],
    "rootDir": "./src",
    "paths": {
      "@app/*": ["./src/app/*"]
    }
  }
}
```

**추가 작업:**
- Webpack/Vite 설정에서 ES5 트랜스파일 처리
- 또는 Babel 파이프라인 추가

### 예시 2: 모던 프로젝트 (Node.js 앱)

**Before:**
```json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true
  }
}
```

**After:**
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "types": ["node"],
    "rootDir": "./src",
    "outDir": "./dist"
  }
}
```

## 마무리: 변화를 기회로 삼기

TypeScript 6.0 RC는 단순한 버전 업그레이드가 아닌, **TypeScript 7.0 Go 네이티브 포트**를 위한 준비 과정입니다. 많은 breaking changes가 있지만, 이는 모두 다음을 위한 것입니다:

- **더 빠른 컴파일**: Go 네이티브 코드와 병렬 타입 체킹
- **더 나은 기본값**: 현대적인 개발 환경 반영
- **레거시 제거**: 불필요한 복잡도 감소

**지금 해야 할 일:**
1. TypeScript 6.0 RC 설치 및 테스트
2. Deprecated 경고 확인 및 마이그레이션 계획 수립
3. `types`, `baseUrl`, `rootDir` 설정 명시적으로 변경
4. TypeScript 7.0 네이티브 프리뷰 모니터링

**TypeScript 7.0 타임라인:**
- 2026년 Q2 예상 (6.0 직후)
- 네이티브 프리뷰는 이미 [npm](https://www.npmjs.com/package/@typescript/native-preview)과 [VS Code 확장](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview)에서 사용 가능

TypeScript 생태계는 계속 진화하고 있으며, 이러한 변화에 적극적으로 대응하는 것이 현대적인 프론트엔드 개발의 핵심입니다. 6.0 RC를 통해 7.0을 미리 준비한다면, 더 빠르고 안정적인 개발 환경을 구축할 수 있을 것입니다.

## 참고 자료

- [Announcing TypeScript 6.0 RC (공식 블로그)](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-rc/)
- [TypeScript Native Port 진행 상황](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)
- [TypeScript 6.0 Breaking Changes 전체 목록](https://github.com/microsoft/TypeScript/wiki/Breaking-Changes)
- [ts5to6 마이그레이션 도구](https://github.com/andrewbranch/ts5to6)
- [Temporal API 문서 (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)
