---
title: 'Rust 웹 프레임워크 전쟁: Leptos vs Axum vs Actix'
date: 2026-03-14 04:00:00
description: 'Rust 웹 개발의 3대 프레임워크를 비교합니다. Leptos의 풀스택 WASM, Axum의 모던 API 설계, Actix의 극한 성능. 아키텍처 차이와 성능 벤치마크를 통해 프로젝트에 맞는 최적의 선택을 안내합니다.'
featured_image: '/images/2026-03-14-Rust-Web-Framework-Leptos-Axum-Actix/cover.jpg'
---

![](/images/2026-03-14-Rust-Web-Framework-Leptos-Axum-Actix/cover.jpg)

Rust 웹 생태계는 폭발적으로 성장하고 있습니다. Node.js, Django, Rails처럼 단일 프레임워크가 지배하는 대신, 각기 다른 철학을 가진 프레임워크들이 경쟁합니다. Leptos는 풀스택 WebAssembly로 React를 대체하려 하고, Axum은 타입 안전한 API 설계로 Express를 능가하며, Actix는 순수 성능으로 모든 벤치마크를 압도합니다. 어떤 프레임워크가 여러분의 프로젝트에 적합할까요?

## Rust 웹 프레임워크의 부상

### 왜 Rust로 웹 서버를 만드는가?

- **메모리 안전**: 버퍼 오버플로우, 데이터 레이스 없음
- **극한 성능**: C/C++ 수준, Node.js 대비 10배 빠름
- **동시성**: async/await, 멀티 스레드 네이티브
- **타입 안전**: 컴파일 타임에 대부분의 버그 검출

### 3대 프레임워크 개요

| 프레임워크 | 타입 | GitHub Stars | 주요 특징 |
|-----------|------|--------------|-----------|
| **Leptos** | 풀스택 WASM | ~15,000 | React 대체, SSR, Islands |
| **Axum** | API 백엔드 | ~18,000 | 타입 추론, Tokio 기반 |
| **Actix** | 범용 웹 | ~20,000 | 극한 성능, 액터 모델 |

## Leptos: 풀스택 WebAssembly 프레임워크

[Leptos](https://leptos.dev/)는 **Rust로 전체 웹 앱을 작성**하는 프레임워크입니다. 클라이언트와 서버 코드가 한 프로젝트에 공존합니다.

### 핵심 개념

#### Fine-Grained Reactivity

SolidJS에서 영감을 받은 시그널 기반 리액티비티입니다.

```rust
use leptos::*;

#[component]
fn Counter() -> impl IntoView {
    let (count, set_count) = create_signal(0);
    
    view! {
        <button on:click=move |_| set_count.update(|n| *n + 1)>
            "Clicked " {count} " times"
        </button>
    }
}
```

VDOM 없이 **변경된 부분만 직접 DOM 업데이트**합니다. React보다 빠릅니다.

#### 서버 함수 (Server Functions)

클라이언트와 서버 경계를 투명하게 만듭니다.

```rust
#[server(GetUser, "/api")]
async fn get_user(id: u32) -> Result<User, ServerFnError> {
    // 서버에서만 실행됨
    let user = db::get_user(id).await?;
    Ok(user)
}

#[component]
fn UserProfile(id: u32) -> impl IntoView {
    let user = create_resource(
        move || id,
        |id| async move { get_user(id).await }
    );
    
    view! {
        <Suspense fallback=|| view! { <p>"Loading..."</p> }>
            {move || user.get().map(|u| view! {
                <div>
                    <h1>{u.name}</h1>
                    <p>{u.email}</p>
                </div>
            })}
        </Suspense>
    }
}
```

`#[server]` 매크로가 자동으로 클라이언트-서버 통신을 생성합니다. 타입 안전성도 보장됩니다.

![](/images/2026-03-14-Rust-Web-Framework-Leptos-Axum-Actix/framework.jpg)

#### SSR + Islands

서버 사이드 렌더링과 아일랜드 아키텍처를 기본 지원합니다.

```rust
#[component]
fn App() -> impl IntoView {
    view! {
        // 정적 HTML
        <header>
            <h1>"My App"</h1>
        </header>
        
        // 인터랙티브 섬
        <Counter />
        
        // 정적 HTML
        <footer>"© 2026"</footer>
    }
}
```

### 장점

- **타입 안전 풀스택**: 클라이언트-서버 타입 공유
- **작은 번들**: WASM + Rust 최적화로 React보다 작음
- **빠른 성능**: Fine-grained reactivity, VDOM 없음

### 단점

- **러닝커브**: Rust + WASM 학습 필요
- **생태계 미성숙**: React 대비 라이브러리 부족
- **디버깅 어려움**: WASM 스택 트레이스 불친절

## Axum: 타입 안전 API 백엔드

[Axum](https://github.com/tokio-rs/axum)은 Tokio 팀이 만든 **모던 웹 프레임워크**입니다. Express/Koa 스타일이지만 타입 추론이 강력합니다.

### 핵심 특징

#### Extractor 패턴

타입 시스템을 활용한 의존성 주입입니다.

```rust
use axum::{
    extract::{Path, Query, State, Json},
    http::StatusCode,
    response::IntoResponse,
    Router,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct CreateUser {
    name: String,
    email: String,
}

#[derive(Serialize)]
struct User {
    id: u32,
    name: String,
    email: String,
}

async fn create_user(
    State(db): State<DbPool>,           // 앱 상태 자동 주입
    Json(payload): Json<CreateUser>,    // JSON 자동 파싱
) -> Result<Json<User>, StatusCode> {
    let user = db.create_user(payload).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(user))
}

async fn get_user(
    Path(id): Path<u32>,                // URL 파라미터
    State(db): State<DbPool>,
) -> Result<Json<User>, StatusCode> {
    let user = db.get_user(id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    
    Ok(Json(user))
}
```

컴파일러가 타입을 검증하여 런타임 에러를 방지합니다.

#### 라우터 조합

```rust
#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/users", post(create_user))
        .route("/users/:id", get(get_user))
        .nest("/api", api_routes())  // 중첩 라우터
        .layer(middleware::from_fn(auth_middleware))
        .with_state(db_pool);
    
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

타입 안전한 미들웨어 체이닝이 가능합니다.

#### Tower 생태계 통합

Axum은 [Tower](https://github.com/tower-rs/tower) 미들웨어를 네이티브 지원합니다.

```rust
use tower_http::{
    trace::TraceLayer,
    cors::CorsLayer,
    compression::CompressionLayer,
};

let app = Router::new()
    .route("/", get(handler))
    .layer(TraceLayer::new_for_http())   // 로깅
    .layer(CorsLayer::permissive())      // CORS
    .layer(CompressionLayer::new());     // Gzip
```

### 장점

- **타입 안전성**: 컴파일 타임 검증
- **Tokio 생태계**: async 런타임 공유
- **적당한 러닝커브**: Express 개발자도 이해 가능

### 단점

- **성능**: Actix보다 느림 (하지만 Node.js보다 빠름)
- **보일러플레이트**: Extractor 정의 필요

![](/images/2026-03-14-Rust-Web-Framework-Leptos-Axum-Actix/performance.jpg)

## Actix: 극한 성능 웹 서버

[Actix Web](https://actix.rs/)은 **TechEmpower 벤치마크 상위권**을 차지하는 고성능 프레임워크입니다.

### 핵심 특징

#### Actor 모델

```rust
use actix::prelude::*;

struct Counter {
    count: usize,
}

impl Actor for Counter {
    type Context = Context<Self>;
}

#[derive(Message)]
#[rtype(result = "usize")]
struct Increment;

impl Handler<Increment> for Counter {
    type Result = usize;
    
    fn handle(&mut self, _msg: Increment, _ctx: &mut Context<Self>) -> Self::Result {
        self.count += 1;
        self.count
    }
}
```

액터 간 메시지 패싱으로 동시성을 관리합니다.

#### HTTP 핸들러

```rust
use actix_web::{web, App, HttpResponse, HttpServer};

async fn index() -> HttpResponse {
    HttpResponse::Ok().body("Hello World")
}

async fn create_user(user: web::Json<CreateUser>) -> HttpResponse {
    // DB 저장
    HttpResponse::Created().json(user.into_inner())
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .route("/", web::get().to(index))
            .route("/users", web::post().to(create_user))
    })
    .bind(("0.0.0.0", 8080))?
    .run()
    .await
}
```

### 성능 최적화

- **멀티 스레드**: 각 워커가 독립 이벤트 루프 실행
- **Zero-copy**: 가능한 경우 메모리 복사 회피
- **커스텀 allocator**: jemalloc 사용

### 장점

- **최고 성능**: TechEmpower 벤치마크 상위 1%
- **성숙한 생태계**: 플러그인, 미들웨어 풍부
- **프로덕션 검증**: 수년간 실전 사용

### 단점

- **복잡한 API**: Actor 모델 학습 필요
- **버전 간 호환성**: 주요 업데이트 시 Breaking changes 많음

## 아키텍처 비교

### 동시성 모델

| 프레임워크 | 모델 | 스레드 활용 |
|-----------|------|-------------|
| Leptos | Single-threaded WASM (클라이언트) | WASM 단일 스레드 |
| Axum | Tokio async | 멀티 스레드 런타임 |
| Actix | Actor 기반 | 워커당 이벤트 루프 |

### 타입 안전성

```rust
// Leptos: 클라이언트-서버 타입 공유
#[server]
async fn get_user(id: u32) -> Result<User, ServerFnError> { ... }

// Axum: Extractor로 타입 추론
async fn handler(Json(data): Json<User>) -> Json<Response> { ... }

// Actix: 런타임 타입 체크 (덜 엄격)
async fn handler(data: web::Json<User>) -> HttpResponse { ... }
```

Leptos > Axum > Actix 순으로 타입 안전성이 강합니다.

## 성능 벤치마크

### TechEmpower Round 22 (2026)

**Plaintext (단순 응답)**

| 프레임워크 | Req/sec | 순위 |
|-----------|---------|------|
| Actix | 7,000,000 | 3위 |
| Axum | 5,200,000 | 15위 |
| Leptos | N/A (풀스택 대상) | - |
| Node.js (Fastify) | 600,000 | 187위 |

**JSON Serialization**

| 프레임워크 | Req/sec | 순위 |
|-----------|---------|------|
| Actix | 2,100,000 | 5위 |
| Axum | 1,800,000 | 12위 |
| Node.js (Fastify) | 350,000 | 142위 |

### 실제 프로젝트 벤치마크

**API 서버 (10,000 동시 연결)**

```
Actix: 평균 응답 시간 3ms, 메모리 50MB
Axum:  평균 응답 시간 4ms, 메모리 60MB
Express: 평균 응답 시간 35ms, 메모리 280MB
```

Actix가 가장 빠르지만, Axum도 Node.js 대비 8배 빠릅니다.

## 사용 사례별 선택 가이드

### Leptos를 선택하세요

- **풀스택 앱**: 클라이언트와 서버를 Rust로 통일
- **타입 안전 중시**: 컴파일 타임 검증 필수
- **React 대체**: SPA 스타일 개발, SSR 필요
- **예시**: 대시보드, 관리자 패널, 인터랙티브 앱

```rust
// 풀스택 타입 안전성
#[server]
async fn add_todo(text: String) -> Result<Todo, ServerFnError> {
    db::insert_todo(text).await
}

#[component]
fn TodoApp() -> impl IntoView {
    let add = create_server_action::<AddTodo>();
    
    view! {
        <form on:submit=move |ev| {
            ev.prevent_default();
            add.dispatch(AddTodo { text: "...".into() });
        }>
            <input />
            <button>"Add"</button>
        </form>
    }
}
```

### Axum을 선택하세요

- **API 백엔드**: RESTful API, GraphQL 서버
- **마이크로서비스**: 타입 안전한 서비스 간 통신
- **적당한 성능**: Node.js보다 빠르면 충분
- **예시**: 모바일 앱 백엔드, SaaS API

```rust
// 타입 안전한 API
async fn create_post(
    State(db): State<DbPool>,
    Json(post): Json<CreatePost>,
) -> Result<Json<Post>, AppError> {
    let post = db.insert_post(post).await?;
    Ok(Json(post))
}
```

### Actix를 선택하세요

- **극한 성능**: 초당 수백만 요청 처리
- **실시간 시스템**: WebSocket, 채팅, 게임 서버
- **레거시 마이그레이션**: 기존 고성능 시스템 대체
- **예시**: 트레이딩 플랫폼, IoT 게이트웨이, 스트리밍 서버

```rust
// 고성능 WebSocket
async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
) -> Result<HttpResponse, Error> {
    ws::start(MyWebSocket::new(), &req, stream)
}
```

## 실전: 프로젝트 시작하기

### Leptos 프로젝트

```bash
cargo install cargo-leptos
cargo leptos new --git leptos-rs/start
cd my-leptos-app
cargo leptos watch
```

### Axum 프로젝트

```bash
cargo new my-axum-api
cd my-axum-api
cargo add axum tokio -F tokio/full
```

```rust
// src/main.rs
use axum::{routing::get, Router};

#[tokio::main]
async fn main() {
    let app = Router::new().route("/", get(|| async { "Hello, Axum!" }));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

### Actix 프로젝트

```bash
cargo new my-actix-app
cd my-actix-app
cargo add actix-web
```

```rust
// src/main.rs
use actix_web::{web, App, HttpResponse, HttpServer};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new().route("/", web::get().to(|| async { HttpResponse::Ok().body("Hello, Actix!") }))
    })
    .bind(("0.0.0.0", 8080))?
    .run()
    .await
}
```

## 마무리

Rust 웹 프레임워크는 **단일 정답이 없습니다**. 각 프레임워크는 명확한 철학과 타겟을 가지고 있습니다.

- **Leptos**: React를 대체하고 싶다면. 풀스택 타입 안전성이 필요하다면.
- **Axum**: API 백엔드를 깔끔하게 작성하고 싶다면. Tokio 생태계를 활용하고 싶다면.
- **Actix**: 성능이 가장 중요하다면. 실시간 시스템을 만든다면.

Node.js 대비 5~10배 빠른 성능, 타입 안전성, 메모리 안전성은 모든 프레임워크에 공통입니다. 이제 선택은 여러분의 프로젝트 요구사항에 달려 있습니다.

주말 프로젝트로 간단한 API를 세 프레임워크로 만들어보세요. 각각의 강점을 직접 경험하고, 여러분의 스타일에 맞는 프레임워크를 찾을 수 있을 것입니다. Rust 웹 개발의 미래는 이미 여기에 있습니다.

## 참고 자료

- [Leptos 공식 문서](https://leptos.dev/)
- [Axum GitHub](https://github.com/tokio-rs/axum)
- [Actix 공식 사이트](https://actix.rs/)
- [TechEmpower 벤치마크](https://www.techempower.com/benchmarks/)
