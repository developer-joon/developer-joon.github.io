---
title: '엣지 스택 완벽 가이드: Hono + Turso + Drizzle로 글로벌 저지연 앱 만들기'
date: 2026-03-14 02:00:00
description: 'Hono, Turso, Drizzle ORM을 활용한 엣지 컴퓨팅 스택 구축 가이드. Cloudflare Workers와 Deno Deploy에서 사용자에게 가장 가까운 서버로 밀리초 단위 응답을 제공하는 방법을 소개합니다.'
featured_image: '/images/2026-03-14-Edge-Stack-Guide-Hono-Turso-Drizzle/cover.jpg'
---

![](/images/2026-03-14-Edge-Stack-Guide-Hono-Turso-Drizzle/cover.jpg)

클라우드 컴퓨팅의 다음 진화는 **엣지(Edge)**입니다. 중앙 서버에서 모든 요청을 처리하는 대신, 전 세계 수백 개의 엣지 로케이션에서 사용자와 가장 가까운 곳에서 코드를 실행하는 것이죠. 이를 통해 지연 시간(latency)을 획기적으로 줄이고, 글로벌 사용자에게 일관된 경험을 제공할 수 있습니다.

하지만 엣지 환경은 제약이 많습니다. 전통적인 Node.js 런타임이나 MySQL 데이터베이스를 그대로 사용할 수 없고, 콜드 스타트 시간도 중요합니다. 이런 환경에서 최적화된 스택이 바로 **Hono + Turso + Drizzle**입니다.

이 글에서는 각 기술의 특징과 조합의 시너지, 그리고 실제 엣지 앱을 구축하는 방법을 상세히 다루겠습니다.

## 엣지 컴퓨팅이란?

### 전통 클라우드 vs 엣지

전통적인 클라우드 아키텍처에서는 애플리케이션이 몇 개의 리전(예: us-east-1, ap-northeast-2)에서만 실행됩니다. 한국 사용자가 미국 서버에 접속하면 수백 밀리초의 네트워크 지연이 발생하죠.

엣지 컴퓨팅은 이 문제를 해결합니다. 코드를 전 세계 수백 개의 데이터센터(PoP, Point of Presence)에 배포해, 사용자 요청을 가장 가까운 엣지 노드에서 처리합니다. 서울 사용자는 서울 엣지에서, 뉴욕 사용자는 뉴욕 엣지에서 응답을 받습니다.

### 엣지의 제약사항

하지만 엣지 환경은 제한적입니다:

- **런타임 제약**: Node.js API를 모두 지원하지 않음 (파일 시스템, 네이티브 모듈 등)
- **짧은 실행 시간**: 요청당 수초 이내 제한
- **메모리 제약**: 보통 128MB 이하
- **콜드 스타트**: 첫 요청 시 빠르게 시작해야 함

이런 제약 때문에 Express나 NestJS 같은 무거운 프레임워크는 엣지에서 비효율적입니다. 경량화되고 Web Standards를 따르는 도구가 필요합니다.

## Hono: 엣지 네이티브 웹 프레임워크

### Hono란?

Hono는 "炎(ほのお, 불꽃)"이라는 뜻의 일본어에서 유래한 이름으로, 엣지 환경을 위해 설계된 초경량 웹 프레임워크입니다. 현재 20,000개 이상의 GitHub 스타를 받으며 빠르게 성장하고 있습니다.

### 핵심 특징

**다중 런타임 지원**: Hono의 가장 큰 장점은 플랫폼 중립성입니다. 하나의 코드베이스로 다양한 환경에서 실행할 수 있습니다:

- Cloudflare Workers
- Deno / Deno Deploy
- Bun
- Node.js
- AWS Lambda
- Vercel Edge Functions

**Web Standards 기반**: Hono는 `Request`와 `Response` 같은 Web API 표준을 사용합니다. 플랫폼 특정 API에 의존하지 않아 이식성이 뛰어납니다.

**초경량 번들**: Express 대비 1/10 이하의 번들 크기로 콜드 스타트가 빠릅니다.

**TypeScript 네이티브**: RPC 타입 안전을 제공하는 Hono RPC로 클라이언트-서버 타입을 자동 추론합니다.

### Hono 시작하기

Cloudflare Workers에서 Hono 앱을 만들어봅시다:

```bash
# Wrangler (Cloudflare CLI) 설치
npm install -g wrangler

# Hono 프로젝트 생성
npm create hono@latest my-edge-app
cd my-edge-app

# 로컬 개발
npm run dev
```

간단한 API 예제:

```typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.json({ message: 'Hello from the Edge!' })
})

app.get('/users/:id', async (c) => {
  const id = c.req.param('id')
  // 여기서 DB 조회 (Turso 연결 예정)
  return c.json({ id, name: 'User ' + id })
})

export default app
```

Express와 비슷하지만 더 간결합니다. `c`는 Context 객체로 요청/응답 헬퍼를 제공합니다.

### 미들웨어와 플러그인

Hono는 풍부한 미들웨어 생태계를 제공합니다:

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt } from 'hono/jwt'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

app.use('/api/*', jwt({
  secret: 'YOUR_SECRET'
}))

app.get('/api/protected', (c) => {
  const payload = c.get('jwtPayload')
  return c.json({ user: payload })
})
```

## Turso: 엣지 네이티브 SQLite 데이터베이스

### Turso란?

Turso는 libSQL 기반의 분산 SQLite 데이터베이스입니다. ChiselStrike에서 개발하여 2023년 Turso로 리브랜딩했으며, 엣지 환경에 최적화되어 있습니다.

### 왜 SQLite를 엣지에서?

전통적인 PostgreSQL이나 MySQL은 중앙 서버에서만 실행됩니다. 엣지 함수가 미국 서버의 DB에 접속하면 여전히 지연이 발생하죠. Turso는 이 문제를 해결합니다:

**글로벌 복제**: 데이터를 여러 리전에 자동 복제하여 사용자와 가장 가까운 DB 복제본에서 읽기 작업을 수행합니다.

**SQLite 호환**: 기존 SQLite 도구와 쿼리를 그대로 사용할 수 있습니다.

**서버리스 친화적**: HTTP 기반 연결로 콜드 스타트가 빠르고, 연결 풀 관리가 필요 없습니다.

**자동 백업과 시점 복구**: 엔터프라이즈급 안정성을 제공합니다.

### Turso 설정

```bash
# Turso CLI 설치
curl -sSfL https://get.tur.so/install.sh | bash

# 로그인
turso auth login

# 데이터베이스 생성
turso db create my-edge-db

# 연결 URL 및 토큰 확인
turso db show my-edge-db
```

TypeScript에서 Turso 연결:

```typescript
import { createClient } from '@libsql/client'

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
})

const result = await client.execute('SELECT * FROM users WHERE id = ?', [userId])
console.log(result.rows)
```

### 엣지 복제 전략

Turso는 Primary 리전(쓰기)과 Replica 리전(읽기)을 분리합니다:

```bash
# Primary: 서울 (쓰기)
turso db create my-db --location icn

# Replica 추가: 도쿄, 싱가포르
turso db replicate my-db --location nrt
turso db replicate my-db --location sin
```

읽기 요청은 자동으로 가장 가까운 Replica로 라우팅되고, 쓰기는 Primary로 전달됩니다. 최종적 일관성(eventual consistency)을 따릅니다.

## Drizzle ORM: 타입 안전한 엣지 ORM

### Drizzle이란?

Drizzle은 TypeScript 우선 ORM으로, Prisma보다 얇은 추상화를 제공합니다. SQL에 가까운 문법으로 강력한 타입 추론과 성능을 동시에 얻을 수 있습니다.

### Prisma vs Drizzle

**Prisma**는 스키마 언어(Prisma Schema)를 사용하고 마이그레이션을 자동 생성하지만, 엣지 환경에서는 무겁고 연결 풀 관리가 복잡합니다.

**Drizzle**은 TypeScript로 스키마를 정의하고, 엣지 런타임(Turso, Cloudflare D1, Neon)을 네이티브 지원합니다. 번들 크기도 훨씬 작습니다.

### Drizzle 스키마 정의

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  authorId: integer('author_id').references(() => users.id),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
})
```

TypeScript로 스키마를 정의하면 타입이 자동으로 추론됩니다.

### Drizzle과 Turso 통합

```typescript
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from './schema'

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
})

const db = drizzle(client, { schema })

// 타입 안전 쿼리
const allUsers = await db.select().from(schema.users)
const user = await db.select().from(schema.users).where(eq(schema.users.id, 1))

// 관계 조회
const postsWithAuthors = await db.select()
  .from(schema.posts)
  .leftJoin(schema.users, eq(schema.posts.authorId, schema.users.id))
```

### 마이그레이션

Drizzle은 스키마 변경을 자동으로 감지해 SQL 마이그레이션을 생성합니다:

```bash
# 마이그레이션 생성
npx drizzle-kit generate:sqlite

# 마이그레이션 적용
npx drizzle-kit push:sqlite
```

## 엣지 스택 통합: 실전 예제

이제 Hono + Turso + Drizzle을 결합한 완전한 API를 만들어봅시다.

### 프로젝트 구조

```
my-edge-app/
├── src/
│   ├── index.ts       # Hono 앱
│   ├── db/
│   │   ├── schema.ts  # Drizzle 스키마
│   │   └── client.ts  # DB 연결
│   └── routes/
│       ├── users.ts
│       └── posts.ts
├── wrangler.toml      # Cloudflare 설정
└── package.json
```

### DB 클라이언트 설정

```typescript
// src/db/client.ts
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from './schema'

export const createDb = (env: { DATABASE_URL: string; DATABASE_AUTH_TOKEN: string }) => {
  const client = createClient({
    url: env.DATABASE_URL,
    authToken: env.DATABASE_AUTH_TOKEN,
  })
  return drizzle(client, { schema })
}
```

### Hono 라우터

```typescript
// src/routes/users.ts
import { Hono } from 'hono'
import { createDb } from '../db/client'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'

const app = new Hono()

app.get('/', async (c) => {
  const db = createDb(c.env)
  const allUsers = await db.select().from(users)
  return c.json(allUsers)
})

app.get('/:id', async (c) => {
  const db = createDb(c.env)
  const id = parseInt(c.req.param('id'))
  const user = await db.select().from(users).where(eq(users.id, id))
  
  if (!user.length) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  return c.json(user[0])
})

app.post('/', async (c) => {
  const db = createDb(c.env)
  const { name, email } = await c.req.json()
  
  const newUser = await db.insert(users).values({
    name,
    email,
    createdAt: new Date(),
  }).returning()
  
  return c.json(newUser[0], 201)
})

export default app
```

### 메인 앱

```typescript
// src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import usersRoute from './routes/users'
import postsRoute from './routes/posts'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

app.route('/users', usersRoute)
app.route('/posts', postsRoute)

app.get('/', (c) => {
  return c.json({ 
    message: 'Edge API running!',
    location: c.req.header('cf-ray')?.split('-')[1] || 'unknown'
  })
})

export default app
```

### Cloudflare Workers 배포

```bash
# 환경 변수 설정
wrangler secret put DATABASE_URL
wrangler secret put DATABASE_AUTH_TOKEN

# 배포
wrangler deploy
```

배포하면 전 세계 300+ 엣지 로케이션에 즉시 코드가 배포됩니다!

## 성능 최적화 팁

### 1. 읽기 중심 캐싱

엣지에서는 Cloudflare Cache API를 활용할 수 있습니다:

```typescript
app.get('/posts/:id', async (c) => {
  const cache = caches.default
  const cacheKey = new Request(c.req.url)
  
  let response = await cache.match(cacheKey)
  
  if (!response) {
    const db = createDb(c.env)
    const post = await db.select().from(posts).where(eq(posts.id, id))
    
    response = new Response(JSON.stringify(post), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    })
    
    await cache.put(cacheKey, response.clone())
  }
  
  return response
})
```

### 2. 연결 재사용

Turso는 HTTP 연결을 사용하므로 연결 풀이 필요 없지만, 클라이언트 인스턴스는 재사용하는 것이 좋습니다:

```typescript
let dbInstance: ReturnType<typeof createDb> | null = null

export const getDb = (env: any) => {
  if (!dbInstance) {
    dbInstance = createDb(env)
  }
  return dbInstance
}
```

### 3. 쿼리 최적화

Drizzle은 SQL에 가까워 명시적 최적화가 쉽습니다:

```typescript
// N+1 문제 회피
const postsWithAuthors = await db
  .select({
    post: posts,
    author: users,
  })
  .from(posts)
  .leftJoin(users, eq(posts.authorId, users.id))
  .limit(10)
```

## Deno Deploy에서 실행하기

Hono는 Deno Deploy에서도 동일하게 작동합니다:

```typescript
// main.ts
import { Hono } from 'hono'
import { serve } from 'https://deno.land/std/http/server.ts'

const app = new Hono()

app.get('/', (c) => c.json({ message: 'Deno Edge!' }))

serve(app.fetch)
```

배포:

```bash
deno deploy --project=my-edge-app main.ts
```

## 언제 엣지 스택을 사용해야 할까?

### 적합한 경우

- **글로벌 사용자**: 전 세계에 분산된 사용자에게 일관된 저지연 제공
- **읽기 중심 앱**: 블로그, 뉴스, 전자상거래 카탈로그
- **API Gateway**: 마이크로서비스 앞단 라우팅
- **A/B 테스팅**: 엣지에서 사용자 분기 처리

### 부적합한 경우

- **복잡한 트랜잭션**: 다중 테이블 원자적 쓰기
- **긴 실행 시간**: 배치 처리, 데이터 분석
- **파일 업로드**: 대용량 파일 처리는 중앙 서버가 유리

## 비용 비교

**전통 클라우드 (AWS EC2 + RDS)**:
- EC2 t3.medium: ~$30/월
- RDS PostgreSQL: ~$50/월
- 총 ~$80/월 (최소)

**엣지 스택 (Cloudflare Workers + Turso)**:
- Workers: $5/월 (10M 요청까지 무료)
- Turso: $0~29/월 (500MB까지 무료)
- 총 ~$5~34/월

트래픽이 적을 때는 거의 무료로 시작할 수 있고, 확장성도 뛰어납니다.

## 커뮤니티와 생태계

- **Hono**: Discord 채널, GitHub Discussions 활발
- **Turso**: 공식 문서 풍부, Slack 커뮤니티
- **Drizzle**: Discord, Twitter에서 활발한 업데이트

모두 오픈소스이며 빠르게 발전하고 있습니다.

## 결론

Hono + Turso + Drizzle 스택은 엣지 컴퓨팅의 이상적인 조합입니다. Hono의 경량성과 다중 런타임 지원, Turso의 글로벌 복제, Drizzle의 타입 안전성이 시너지를 이룹니다.

전통적인 중앙 서버 아키텍처에서 벗어나 전 세계 사용자에게 밀리초 단위 응답을 제공하고 싶다면, 이 스택을 시도해보세요. 특히 Next.js나 Remix 같은 풀스택 프레임워크와 결합하면 정적 페이지는 CDN에서, 동적 API는 엣지에서 처리하는 완벽한 하이브리드 아키텍처를 구축할 수 있습니다.

엣지는 선택이 아닌 필수가 되어가고 있습니다.

## 참고 자료

- [Hono 공식 사이트](https://hono.dev/)
- [Turso 공식 문서](https://docs.turso.tech/)
- [Drizzle ORM 문서](https://orm.drizzle.team/)
- [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
- [Deno Deploy 가이드](https://deno.com/deploy)
