---
title: 'Gleam으로 시작하는 타입 안전 함수형 프로그래밍'
date: 2026-03-14 01:00:00
description: 'Gleam은 Erlang VM 위에서 동작하는 타입 안전 함수형 언어입니다. Elixir의 확장성과 OCaml의 타입 시스템을 결합하면서도 낮은 학습 곡선을 자랑합니다. 함수형 프로그래밍 입문자와 Erlang 생태계 개발자 모두를 위한 가이드.'
featured_image: '/images/2026-03-14-Gleam-Type-Safe-Functional-Programming/cover.jpg'
---

![](/images/2026-03-14-Gleam-Type-Safe-Functional-Programming/cover.jpg)

함수형 프로그래밍은 강력하지만 가파른 학습 곡선으로 유명합니다. Haskell은 너무 학술적이고, OCaml은 문법이 낯설며, Elixir는 타입 안전성이 부족합니다. 이 모든 문제에 대한 해답으로 Gleam이 등장했습니다. Erlang VM의 검증된 신뢰성 위에서, 친절한 타입 시스템과 읽기 쉬운 문법으로 함수형 프로그래밍의 진입 장벽을 낮춥니다.

## Gleam이란?

Gleam은 **"빠르고 친절하며 확장 가능한 타입 안전 시스템을 구축하기 위한"** 함수형 프로그래밍 언어입니다. 2020년 첫 릴리스 이후 꾸준히 성장하여 현재 v1.0 이상의 안정 버전을 제공합니다.

### 핵심 특징

- **Erlang VM(BEAM) 기반**: WhatsApp 급 확장성과 내결함성
- **정적 타입 시스템**: 컴파일 타임에 대부분의 버그 검출
- **낮은 러닝커브**: 명확한 문법, 친절한 컴파일러 메시지
- **멀티 타겟**: Erlang VM + JavaScript 컴파일 지원
- **상호 운용성**: Erlang/Elixir 라이브러리 직접 사용 가능

## Erlang VM: WhatsApp이 선택한 이유

Gleam이 동작하는 Erlang VM(BEAM)은 30년 이상 실전에서 검증된 플랫폼입니다.

### 확장성

WhatsApp은 단 50명의 엔지니어로 9억 명의 사용자를 처리했습니다. Erlang VM의 액터 모델과 경량 프로세스 덕분입니다.

```gleam
import gleam/otp/actor

pub fn start() {
  // 수백만 개의 경량 프로세스를 동시에 실행 가능
  actor.start(fn() {
    // 각 프로세스는 독립적인 메모리 공간
    // 메시지 패싱으로 통신
  })
}
```

하나의 Erlang VM 인스턴스에서 수백만 개의 동시 연결을 처리할 수 있습니다.

### 내결함성

"Let it crash" 철학으로 유명합니다. 한 프로세스의 실패가 전체 시스템을 멈추지 않습니다.

```gleam
import gleam/otp/supervisor

pub fn main() {
  supervisor.start(
    init: fn() {
      // 자식 프로세스가 크래시하면 자동 재시작
      supervisor.worker(worker_fn)
    }
  )
}
```

통신사 인프라에서 99.9999999% (9 nines) 가동률을 달성한 검증된 모델입니다.

![](/images/2026-03-14-Gleam-Type-Safe-Functional-Programming/erlang-vm.jpg)

### 핫 코드 스왑

서비스를 중단하지 않고 런타임에 코드를 업데이트할 수 있습니다. 이는 Erlang VM의 독특한 강점입니다.

## 타입 안전 함수형 프로그래밍

Gleam의 타입 시스템은 ML 계열 언어(OCaml, Haskell)에서 영감을 받았지만, 훨씬 읽기 쉽습니다.

### 타입 추론

대부분의 경우 타입을 명시하지 않아도 컴파일러가 추론합니다.

```gleam
pub fn add(a, b) {
  a + b  // 컴파일러가 Int로 추론
}

// 명시적 타입도 가능
pub fn multiply(a: Int, b: Int) -> Int {
  a * b
}
```

![](/images/2026-03-14-Gleam-Type-Safe-Functional-Programming/type-system.jpg)

### Result 타입으로 에러 처리

예외 대신 명시적인 Result 타입을 사용합니다.

```gleam
import gleam/result

pub fn divide(a: Int, b: Int) -> Result(Int, String) {
  case b {
    0 -> Error("Division by zero")
    _ -> Ok(a / b)
  }
}

pub fn main() {
  let result = divide(10, 2)
  case result {
    Ok(value) -> io.println("Result: " <> int.to_string(value))
    Error(msg) -> io.println("Error: " <> msg)
  }
}
```

컴파일러가 모든 에러 케이스를 처리했는지 검증합니다. 런타임 크래시 가능성이 획기적으로 줄어듭니다.

### 패턴 매칭

복잡한 데이터 구조를 간결하게 처리합니다.

```gleam
pub type User {
  Admin(name: String, level: Int)
  Guest(name: String)
}

pub fn greet(user: User) -> String {
  case user {
    Admin(name, level) if level > 5 -> 
      "Welcome, Super Admin " <> name
    Admin(name, _) -> 
      "Welcome, Admin " <> name
    Guest(name) -> 
      "Hello, " <> name
  }
}
```

## 낮은 러닝커브: 함수형 입문자에게 친절한 이유

### 1. 읽기 쉬운 문법

Haskell이나 OCaml의 학술적 문법 대신, 현대적이고 직관적인 문법을 제공합니다.

```gleam
// Gleam
pub fn sum(list: List(Int)) -> Int {
  list.fold(0, fn(acc, x) { acc + x })
}

// vs Haskell
sum :: [Int] -> Int
sum = foldl (+) 0
```

JavaScript나 Python 개발자도 쉽게 이해할 수 있습니다.

### 2. 친절한 컴파일러

Gleam 컴파일러는 Rust처럼 친절한 에러 메시지를 제공합니다.

```
error: Type mismatch

  ┌─ /src/main.gleam:5:10
  │
5 │   let x = "hello" + 1
  │           ^^^^^^^^^^^
  │
  The + operator expects both arguments to be Int,
  but the left side is String.

  Hint: Did you mean to use the <> operator for string concatenation?
```

초보자가 막히지 않도록 문제와 해결책을 명확히 제시합니다.

### 3. 빌트인 도구

별도의 도구 설치 없이 모든 것이 기본 제공됩니다.

```bash
gleam new my_app     # 프로젝트 생성
gleam build          # 빌드
gleam test           # 테스트
gleam format         # 코드 포맷팅
gleam run            # 실행
```

Node.js처럼 npm, eslint, prettier를 따로 설치할 필요가 없습니다.

## 실전 예시: HTTP 서버

```gleam
import gleam/http/response
import gleam/http/request.{Request}
import wisp.{Request, Response}

pub fn handle_request(req: Request) -> Response {
  case request.path_segments(req) {
    ["api", "users", id] -> get_user(id)
    ["api", "health"] -> health_check()
    _ -> response.new(404)
      |> response.set_body("Not Found")
  }
}

fn get_user(id: String) -> Response {
  // DB 조회 로직
  response.new(200)
    |> response.set_body("{\"id\": \"" <> id <> "\"}")
}

fn health_check() -> Response {
  response.new(200)
    |> response.set_body("OK")
}
```

타입 안전성을 유지하면서도 읽기 쉬운 코드를 작성할 수 있습니다.

## 생태계와 상호 운용성

### Erlang/Elixir 라이브러리 활용

Gleam은 Erlang과 Elixir의 수천 개 라이브러리를 직접 사용할 수 있습니다.

```gleam
// Erlang 라이브러리 사용
import erlang/crypto

pub fn hash(data: String) -> String {
  crypto.hash("sha256", data)
}
```

Phoenix(Elixir 웹 프레임워크)와 함께 사용하거나, 기존 Erlang 프로젝트에 Gleam 모듈을 추가할 수 있습니다.

### JavaScript 타겟

브라우저나 Node.js에서도 실행 가능합니다.

```bash
gleam build --target javascript
```

프론트엔드와 백엔드를 같은 언어로 작성할 수 있습니다.

### 주요 라이브러리

- **wisp**: 웹 프레임워크
- **gleam_json**: JSON 파싱
- **gleam_http**: HTTP 클라이언트/서버
- **gleam_otp**: OTP 행위 (Actor, Supervisor)

## Gleam vs Elixir vs Erlang

| 특징 | Gleam | Elixir | Erlang |
|------|-------|--------|--------|
| 타입 시스템 | 정적 타입 | 동적 타입 (Dialyzer) | 동적 타입 |
| 문법 | 현대적, ML 스타일 | Ruby 스타일 | Prolog 스타일 |
| 러닝커브 | 낮음 | 중간 | 높음 |
| 생태계 | 성장 중 | 성숙 | 매우 성숙 |
| 적합한 경우 | 타입 안전 + 함수형 입문 | 빠른 개발 | 레거시 시스템 |

Elixir의 동적 타이핑이 불편하거나, 함수형 프로그래밍을 타입 안전하게 배우고 싶다면 Gleam이 최적의 선택입니다.

## Gleam 시작하기

### 설치

```bash
# macOS/Linux
brew install gleam

# 또는 공식 사이트에서 다운로드
# https://gleam.run/getting-started/installing/
```

### Hello World

```bash
gleam new hello_world
cd hello_world
```

`src/hello_world.gleam`:
```gleam
import gleam/io

pub fn main() {
  io.println("Hello, Gleam!")
}
```

```bash
gleam run
```

### 학습 리소스

- [공식 튜토리얼](https://gleam.run/book/)
- [Language Tour](https://tour.gleam.run/)
- [Exercism Gleam Track](https://exercism.org/tracks/gleam)
- [Awesome Gleam](https://github.com/gleam-lang/awesome-gleam)

## 마무리

Gleam은 함수형 프로그래밍과 타입 안전성을 동시에 제공하면서도 낮은 진입 장벽을 유지합니다. Erlang VM의 검증된 확장성과 내결함성을 활용하면서, 현대적인 타입 시스템으로 버그를 컴파일 타임에 잡아냅니다.

Elixir의 동적 타이핑에 불안함을 느끼는 개발자, 또는 Haskell/OCaml의 가파른 학습 곡선 없이 함수형 프로그래밍을 배우고 싶은 입문자에게 Gleam은 완벽한 선택지입니다.

백엔드 서비스, 리얼타임 시스템, 분산 애플리케이션을 개발한다면, Gleam으로 타입 안전한 함수형 프로그래밍의 세계에 발을 들여보세요. WhatsApp이 증명한 Erlang VM의 강력함을, 더 안전하고 읽기 쉬운 코드로 경험할 수 있습니다.

## 참고 자료

- [Gleam 공식 사이트](https://gleam.run/)
- [Gleam GitHub](https://github.com/gleam-lang/gleam)
- [Erlang VM 아키텍처](https://www.erlang.org/doc/reference_manual/processes.html)
- [Gleam vs Elixir 비교](https://gleam.run/frequently-asked-questions/)
