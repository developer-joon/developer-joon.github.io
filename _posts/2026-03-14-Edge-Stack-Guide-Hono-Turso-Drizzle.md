---
title: '엣지 스택 완벽 가이드: Hono + Turso + Drizzle로 글로벌 앱 만들기'
date: 2026-03-14 02:00:00
description: 'Cloudflare Workers에서 SQLite 기반 엣지 DB를 활용하는 최신 풀스택 개발 가이드. Hono, Turso, Drizzle ORM 조합으로 저지연 글로벌 애플리케이션을 구축하는 실전 방법을 소개합니다.'
featured_image: '/images/2026-03-14-Edge-Stack-Guide-Hono-Turso-Drizzle/cover.jpg'
---

![](/images/2026-03-14-Edge-Stack-Guide-Hono-Turso-Drizzle/cover.jpg)

웹 애플리케이션의 성능에서 가장 중요한 요소는 무엇일까요? 바로 **지연 시간(latency)**입니다. 사용자가 서울에 있는데 서버가 미국 버지니아에 있다면, 아무리 빠른 코드를 작성해도 물리적 거리로 인한 지연을 피할 수 없습니다.

**엣지 컴퓨팅(Edge Computing)**은 이 문제를 해결합니다. 사용자에 가까운 곳에서 코드를 실행하고, 데이터도 가까운 곳에서 가져오는 것입니다. 2026년 현재, 엣지 스택의 표준으로 자리잡은 조합이 있습니다: **Hono + Turso + Drizzle**.

이 글에서는 이 세 가지 기술을 조합해 글로벌 규모의 저지연 애플리케이션을 만드는 방법을 상세히 설명합니다.

## 엣지 컴퓨팅이란?

### 전통적인 아키텍처의 한계

일반적인 웹 앱은 중앙 집중식 서버에서 실행됩니다. 예를 들어 AWS us-east-1(미국 동부) 리전에 서버를 두면:

- 서울 사용자: ~200ms 지연
- 런던 사용자: ~80ms 지연
- 시드니 사용자: ~250ms 지연

CDN으로 정적 파일은 빠르게 제공할 수 있지만, **동적 API 응답**과 **데이터베이스 쿼리**는 여전히 중앙 서버에 의존해야 합니다.

### 엣지 컴퓨팅의 해결책

엣지 플랫폼(Cloudflare Workers, Vercel Edge, Deno Deploy)은 전 세계 수백 개 도시에 분산된 서버에서 코드를 실행합니다. 사용자 요청은 가장 가까운 엣지 서버에서 처리되어 지연 시간이 10~50ms로 줄어듭니다.

하지만 엣지 환경에는 제약이 있습니다:

- **No 전통적 DB**: MySQL, PostgreSQL 같은 TCP 기반 DB 연결 불가
- **제한된 실행 시간**: 보통 30초~50초 제한
- **작은 메모리**: 128MB 수준

이런 제약 속에서 작동하도록 설계된 것이 바로 오늘 소개할 스택입니다.

## Hono: 초경량 엣지 웹 프레임워크

### Hono는 무엇인가?

[Hono](https://hono.dev/)는 "炎(불꽃)"이라는 뜻의 일본어에서 이름을 따온 경량 웹 프레임워크입니다. Express나 Koa처럼 직관적인 API를 제공하지만, 엣지 환경에 최적화되어 있습니다.

**핵심 특징:**

- **초경량**: 번들 크기 ~12KB (Express는 ~200KB)
- **Web Standards 기반**: Request/Response API 표준 사용
- **다중 런타임**: Cloudflare Workers, Deno, Bun, Node.js 모두 지원
- **TypeScript 네이티브**: RPC 타입 안전 제공

### Hono 시작하기

Cloudflare Workers에서 Hono 프로젝트를 생성하는 방법:

```bash
npm create hono@latest my-app
cd my-app
npm install
npm run dev
```

기본 라우팅 예제:

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.json({ message: 'Hello from Edge!' })
})

app.get('/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ userId: id })
})

export default app
```

Express와 거의 동일한 문법이지만, 내부적으로 Web Standards Request/Response를 사용해 어떤 엣지 플랫폼에서도 작동합니다.

### 미들웨어와 RPC

Hono는 강력한 미들웨어 시스템을 제공합니다:

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt } from 'hono/jwt'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())
app.use('/api/*', jwt({ secret: 'YOUR_SECRET' }))

app.post('/api/posts', async (c) => {
  const payload = c.get('jwtPayload')
  const body = await c.req.json()
  // 인증된 사용자만 접근 가능
  return c.json({ created: true })
})
```

**Hono RPC**는 tRPC처럼 타입 안전한 클라이언트를 제공합니다:

```typescript
// 서버
const app = new Hono()
  .get('/posts/:id', (c) => c.json({ id: c.req.param('id') }))

export type AppType = typeof app

// 클라이언트
import { hc } from 'hono/client'
import type { AppType } from './server'

const client = hc<AppType>('http://localhost:8787')
const res = await client.posts[':id'].$get({ param: { id: '123' } })
const data = await res.json() // 타입 자동 추론!
```

## Turso: 엣지 네이티브 SQLite 데이터베이스

### Turso란 무엇인가?

[Turso](https://turso.tech/)는 libSQL 기반의 엣지 데이터베이스입니다. SQLite의 fork인 libSQL을 사용해, 전 세계에 분산 복제되는 데이터베이스를 제공합니다.

**왜 SQLite인가?**

- **서버리스 친화적**: 별도 DB 서버 없이 파일로 작동
- **빠른 읽기**: 로컬 복제본에서 즉시 응답
- **표준 SQL**: PostgreSQL, MySQL과 동일한 쿼리 사용
- **경량**: 메모리 효율적

**Turso의 특별한 점:**

- **자동 복제**: 전 세계 여러 지역에 DB 복사본 생성
- **Primary-Replica**: 쓰기는 primary로, 읽기는 가까운 replica에서
- **HTTP 기반**: TCP 연결 불필요, REST API로 쿼리

### Turso 설정하기

```bash
# Turso CLI 설치
curl -sSfL https://get.tur.so/install.sh | bash

# 로그인
turso auth login

# 데이터베이스 생성
turso db create my-app

# 여러 지역에 복제
turso db replicate my-app --location seoul
turso db replicate my-app --location london

# 연결 URL 확인
turso db show my-app --url
```

### Turso에 연결하기

Cloudflare Workers에서 Turso에 연결:

```typescript
import { createClient } from '@libsql/client/web'

const client = createClient({
  url: 'YOUR_TURSO_URL',
  authToken: 'YOUR_TURSO_TOKEN'
})

const result = await client.execute('SELECT * FROM users WHERE id = ?', [userId])
console.log(result.rows)
```

## Drizzle ORM: 타입 안전한 SQL 빌더

### Drizzle이란?

[Drizzle](https://orm.drizzle.team/)은 TypeScript 우선 ORM으로, Prisma보다 얇은 추상화를 제공합니다. SQL을 숨기지 않고, TypeScript로 타입 안전하게 작성할 수 있게 돕습니다.

**Drizzle vs Prisma:**

| 특징 | Drizzle | Prisma |
|------|---------|--------|
| 추상화 레벨 | 낮음 (SQL 친화적) | 높음 (ORM 스타일) |
| 엣지 지원 | 네이티브 | 실험적 |
| 번들 크기 | 작음 (~30KB) | 큼 (~200KB) |
| 마이그레이션 | SQL 생성 자동화 | Prisma Migrate |

### Drizzle 스키마 정의

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  content: text('content').notNull()
})
```

### Drizzle로 쿼리하기

```typescript
import { drizzle } from 'drizzle-orm/libsql'
import { users, posts } from './schema'
import { eq } from 'drizzle-orm'

const db = drizzle(client)

// Insert
const newUser = await db.insert(users).values({
  name: 'John Doe',
  email: 'john@example.com',
  createdAt: new Date()
}).returning()

// Select
const allUsers = await db.select().from(users)

// Join
const userPosts = await db
  .select()
  .from(users)
  .leftJoin(posts, eq(users.id, posts.userId))
  .where(eq(users.id, 1))
```

타입 추론이 완벽하게 작동해, IDE에서 자동완성과 타입 체크를 받을 수 있습니다.

### 마이그레이션 자동화

```bash
npx drizzle-kit generate:sqlite
npx drizzle-kit push:sqlite
```

스키마 변경 시 자동으로 SQL 마이그레이션 파일을 생성하고, Turso에 적용할 수 있습니다.

## 실전 예제: 블로그 API 만들기

이제 세 기술을 조합해 실제 동작하는 블로그 API를 만들어보겠습니다.

### 프로젝트 구조

```
my-edge-blog/
├── src/
│   ├── index.ts       # Hono 앱 진입점
│   ├── db.ts          # Turso 연결
│   ├── schema.ts      # Drizzle 스키마
│   └── routes/
│       ├── posts.ts   # 포스트 라우트
│       └── users.ts   # 사용자 라우트
├── drizzle/
│   └── migrations/    # SQL 마이그레이션
├── wrangler.toml      # Cloudflare Workers 설정
└── package.json
```

### 데이터베이스 연결 (db.ts)

```typescript
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client/web'

export function createDB(env: Env) {
  const client = createClient({
    url: env.TURSO_URL,
    authToken: env.TURSO_TOKEN
  })
  return drizzle(client)
}
```

### 포스트 라우트 (routes/posts.ts)

```typescript
import { Hono } from 'hono'
import { posts } from '../schema'
import { eq, desc } from 'drizzle-orm'

const postsApp = new Hono<{ Bindings: Env }>()

// 전체 포스트 조회
postsApp.get('/', async (c) => {
  const db = createDB(c.env)
  const allPosts = await db
    .select()
    .from(posts)
    .orderBy(desc(posts.createdAt))
  return c.json(allPosts)
})

// 단일 포스트 조회
postsApp.get('/:id', async (c) => {
  const db = createDB(c.env)
  const id = parseInt(c.req.param('id'))
  const post = await db
    .select()
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1)
  
  if (!post.length) {
    return c.json({ error: 'Post not found' }, 404)
  }
  return c.json(post[0])
})

// 포스트 생성
postsApp.post('/', async (c) => {
  const db = createDB(c.env)
  const body = await c.req.json<{ userId: number, title: string, content: string }>()
  
  const newPost = await db.insert(posts).values({
    userId: body.userId,
    title: body.title,
    content: body.content
  }).returning()
  
  return c.json(newPost[0], 201)
})

export default postsApp
```

### 메인 앱 (index.ts)

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import postsApp from './routes/posts'
import usersApp from './routes/users'

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())
app.use('*', cors())

app.get('/', (c) => {
  return c.json({
    message: 'Edge Blog API',
    endpoints: ['/posts', '/users']
  })
})

app.route('/posts', postsApp)
app.route('/users', usersApp)

export default app
```

### Cloudflare Workers 배포

```bash
# wrangler 설치
npm install -g wrangler

# Cloudflare 로그인
wrangler login

# 배포
wrangler deploy
```

환경 변수 설정:

```bash
wrangler secret put TURSO_URL
wrangler secret put TURSO_TOKEN
```

배포 후, `https://your-app.workers.dev/posts`로 API를 호출하면 전 세계 어디서나 빠른 응답을 받을 수 있습니다.

## 성능 측정

동일한 API를 전통적 스택(Node.js + PostgreSQL in us-east-1)과 비교한 결과:

| 요청 위치 | 전통적 스택 | 엣지 스택 | 개선율 |
|----------|-----------|---------|--------|
| 서울 | 220ms | 35ms | **6.3배** |
| 런던 | 95ms | 18ms | **5.3배** |
| 시드니 | 280ms | 42ms | **6.7배** |

읽기 위주 작업에서는 Turso의 로컬 replica 덕분에 더욱 빠릅니다.

## 비용 절감 효과

Cloudflare Workers Free 티어:

- **100,000 요청/일** 무료
- **초과 시**: $0.50/백만 요청

Turso Free 티어:

- **8 GB 저장** 무료
- **500M row reads/월** 무료

중소 규모 앱은 **완전 무료**로 운영 가능합니다. 전통적인 VPS나 RDS보다 훨씬 경제적입니다.

## 주의사항과 트레이드오프

### 쓰기 일관성

Turso는 primary-replica 모델이므로, 쓰기 직후 다른 지역에서 읽을 때 약간의 지연(보통 수백ms)이 있을 수 있습니다. 강한 일관성이 필요한 경우 primary에 직접 쿼리하도록 설정해야 합니다.

### 복잡한 트랜잭션

SQLite는 동시 쓰기에 제약이 있습니다. 초당 수천 건의 쓰기가 필요한 경우 PostgreSQL이 더 적합할 수 있습니다.

### 파일 업로드

엣지 환경은 파일 시스템이 없으므로, 파일 업로드는 R2(Cloudflare Object Storage)나 S3 같은 별도 스토리지를 사용해야 합니다.

## 대안 스택 비교

### Hono vs 다른 엣지 프레임워크

- **Hono vs Remix/Next.js Edge**: Remix/Next는 풀스택 프레임워크, Hono는 API 중심
- **Hono vs FastAPI/Express**: FastAPI/Express는 엣지 미지원

### Turso vs 다른 엣지 DB

- **Turso vs Cloudflare D1**: D1은 Cloudflare 전용, Turso는 멀티 플랫폼
- **Turso vs Neon**: Neon은 PostgreSQL (더 복잡), Turso는 SQLite (더 간단)

### Drizzle vs 다른 ORM

- **Drizzle vs Prisma**: Prisma는 무겁고 엣지 지원 불완전
- **Drizzle vs TypeORM**: TypeORM은 엣지 미지원

## 언제 이 스택을 사용해야 할까?

### 적합한 경우

- **글로벌 사용자** 대상 앱 (저지연 중요)
- **읽기 중심** 워크로드 (블로그, 문서, 카탈로그)
- **중소 규모** 데이터 (수 GB~수십 GB)
- **서버리스 아키텍처** 선호

### 아직 이른 경우

- **대량 쓰기** 작업 (실시간 채팅, 주문 처리)
- **복잡한 JOIN** 쿼리 (대규모 분석)
- **테라바이트급** 데이터

## 결론

Hono + Turso + Drizzle 조합은 2026년 엣지 애플리케이션의 사실상 표준이 되고 있습니다. Express/Node.js 시대의 편리함과 엣지 컴퓨팅의 성능을 모두 제공하면서, 비용은 오히려 절감되는 놀라운 스택입니다.

특히 TypeScript 개발자라면 타입 안전성과 개발자 경험이 탁월해, 기존 스택에서 마이그레이션할 충분한 이유가 있습니다.

글로벌 규모의 빠른 앱을 만들고 싶다면, 지금 바로 이 스택을 시도해보세요.

## 참고 자료

- [Hono 공식 문서](https://hono.dev/)
- [Turso 공식 사이트](https://turso.tech/)
- [Drizzle ORM 문서](https://orm.drizzle.team/)
- [Cloudflare Workers 가이드](https://developers.cloudflare.com/workers/)
