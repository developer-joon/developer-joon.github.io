---
title: 'MCP(Model Context Protocol)란 무엇인가? — AI의 USB-C 포트'
date: 2026-02-20 00:00:00
description: 'MCP(Model Context Protocol)의 개념, 아키텍처, 핵심 기능을 알기 쉽게 정리합니다. AI 앱과 외부 시스템을 연결하는 표준 프로토콜의 모든 것.'
featured_image: '/images/2026-02-20-MCP-What-Is-Model-Context-Protocol/cover.jpg'
---

AI 비서에게 "내 구글 캘린더 확인해서 이번 주 미팅 정리해줘"라고 말하면, AI는 어떻게 내 캘린더에 접근할까? 데이터베이스에서 특정 데이터를 끌어오거나, GitHub 이슈를 생성하거나, 스마트홈 기기를 제어하는 건 어떻게 가능한 걸까?

지금까지는 이런 기능 하나하나를 AI 플랫폼마다 개별적으로 개발해야 했다. Claude용 캘린더 연동, ChatGPT용 캘린더 연동, Copilot용 캘린더 연동… 같은 걸 세 번, 네 번 만드는 거다. 개발자 입장에선 지옥이지.

**MCP(Model Context Protocol)**는 바로 이 문제를 해결하기 위해 등장했다. Anthropic이 만든 오픈소스 프로토콜로, AI 앱과 외부 시스템을 연결하는 **표준 규격**이다.

![MCP Connection](/images/2026-02-20-MCP-What-Is-Model-Context-Protocol/usb-connection.jpg)

## USB-C 비유가 딱이다

MCP 공식 문서에서 쓰는 비유가 있는데, 이게 정말 직관적이다.

> "MCP는 AI 애플리케이션을 위한 USB-C 포트 같은 거다."

USB-C 나오기 전을 생각해보자. 노트북 충전기, 스마트폰 충전기, 태블릿 충전기 다 달랐다. 제조사마다, 기기마다 다른 케이블과 포트. 가방에 케이블만 몇 개씩 들고 다녔던 그 시절.

지금은? **USB-C 하나면 끝**이다. 노트북도, 스마트폰도, 태블릿도, 심지어 모니터까지 하나의 포트로 연결된다.

MCP도 마찬가지다. AI 앱이 데이터베이스든, API든, 로컬 파일이든 **하나의 프로토콜로 연결**할 수 있게 해준다. 개발자는 MCP 서버 하나만 만들면, Claude든 ChatGPT든 VS Code든 어디서든 쓸 수 있는 거다.

솔직히 이건 꽤 혁신적이라고 봅니다. 2026년 현재, AI가 단순 챗봇을 넘어서 실제 도구(tool)로 자리잡으려면 이런 표준화가 필수거든요.

## 왜 MCP가 필요했을까?

### N×M 문제

기존 방식의 문제점을 간단한 수식으로 표현하면:

```
AI 플랫폼 N개 × 외부 시스템 M개 = N×M개의 통합 코드
```

예를 들어:
- AI 플랫폼: Claude, ChatGPT, Gemini, Copilot (4개)
- 외부 시스템: Google Calendar, Notion, PostgreSQL, GitHub, Slack (5개)

**총 20개의 통합 코드**를 작성하고 유지보수해야 한다는 뜻이다. 미친 짓이지.

### MCP의 해결책: N+M

MCP는 이걸 **N+M 문제로 줄여준다**.

```
┌─────────────┐       ┌──────────────┐       ┌─────────────────┐
│             │       │              │       │                 │
│   Claude    │◄──────┤              │       │  Google Cal     │
│             │       │              │       │  MCP Server     │
└─────────────┘       │              │       └─────────────────┘
                      │   MCP        │
┌─────────────┐       │   Protocol   │       ┌─────────────────┐
│             │       │              │       │                 │
│  ChatGPT    │◄──────┤              │       │    Notion       │
│             │       │              │       │  MCP Server     │
└─────────────┘       │              │       └─────────────────┘
                      │              │
┌─────────────┐       │              │       ┌─────────────────┐
│             │       │              │       │                 │
│   VS Code   │◄──────┤              │◄──────┤   PostgreSQL    │
│             │       │              │       │  MCP Server     │
└─────────────┘       └──────────────┘       └─────────────────┘
```

이제 개발자는:
- **MCP 서버 하나**만 만들면 → 모든 AI 플랫폼에서 사용 가능
- **MCP 클라이언트 하나**만 구현하면 → 모든 데이터 소스에 접근 가능

4개 AI × 5개 시스템 = **9개 구현**으로 끝난다. 20개에서 9개로. 이게 바로 표준의 힘이다.

## MCP 아키텍처 — 어떻게 동작하는가

MCP는 기본적으로 **클라이언트-서버 아키텍처**다. 구조를 뜯어보면:

```
┌──────────────────────────────────────────────────────┐
│                      Host                            │
│  (AI Application: Claude Desktop, VS Code, etc.)     │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │           MCP Client                           │  │
│  │  - Connection Management                       │  │
│  │  - Protocol Handling                           │  │
│  │  - Request/Response Routing                    │  │
│  └───────────────┬────────────────────────────────┘  │
└──────────────────┼───────────────────────────────────┘
                   │
                   │ JSON-RPC 2.0
                   │ (STDIO or HTTP)
                   │
┌──────────────────┼───────────────────────────────────┐
│  ┌───────────────▼────────────────────────────────┐  │
│  │           MCP Server                           │  │
│  │  - Tools (함수 호출)                            │  │
│  │  - Resources (데이터 읽기)                      │  │
│  │  - Prompts (프롬프트 템플릿)                    │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│                Context Provider                      │
│  (Database, API, File System, Smart Home, etc.)      │
└──────────────────────────────────────────────────────┘
```

### 구성 요소

1. **Host (호스트)**  
   AI 애플리케이션 그 자체. Claude Desktop, VS Code, Cursor, Claude Code 같은 것들.

2. **Client (클라이언트)**  
   Host 내부에서 MCP 연결을 관리하는 레이어. 요청을 보내고 응답을 받아 처리한다.

3. **Server (서버)**  
   실제 컨텍스트를 제공하는 프로그램. 데이터베이스 쿼리, API 호출, 파일 읽기 등의 작업을 수행.

### 통신 방식

MCP는 **JSON-RPC 2.0** 프로토콜을 사용한다. 요청과 응답이 JSON 형태로 오가는 방식이다.

**전송 레이어**는 두 가지:

1. **STDIO (Standard Input/Output)**  
   로컬 프로세스 간 통신. 파이프로 데이터 주고받는 방식. 빠르고 간단해서 로컬 개발 환경에 적합.

2. **Streamable HTTP**  
   원격 서버와 통신할 때 사용. SSE(Server-Sent Events) 기반으로 실시간 스트리밍 지원.

```json
// 예시: MCP 요청 (JSON-RPC 2.0)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "city": "Seoul"
    }
  }
}
```

## 3가지 핵심 기능 — Tools, Resources, Prompts

MCP는 세 가지 주요 기능을 제공한다. 각각 역할이 명확히 다르다.

### 1. Tools (도구)

AI가 **능동적으로 실행할 수 있는 함수**다. "날씨 조회", "DB 쿼리 실행", "파일 생성" 같은 작업들.

```typescript
// MCP Tool 정의 예시
{
  name: "query_database",
  description: "PostgreSQL 데이터베이스에 쿼리 실행",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "SQL 쿼리" },
      params: { type: "array", description: "쿼리 파라미터" }
    },
    required: ["query"]
  }
}
```

AI가 이 tool을 "호출"하면, MCP 서버가 실제로 DB에 쿼리를 날리고 결과를 돌려준다.

### 2. Resources (리소스)

AI가 **읽을 수 있는 데이터**다. 파일, API 응답, 데이터베이스 레코드 등. Tool과 달리 "실행"이 아니라 "조회"가 목적이다.

```typescript
// MCP Resource 예시
{
  uri: "file:///home/user/notes/meeting-notes.md",
  name: "Meeting Notes",
  mimeType: "text/markdown",
  description: "팀 미팅 기록"
}
```

AI가 context를 파악할 때 이런 resource를 읽어서 판단에 활용한다.

### 3. Prompts (프롬프트)

**재사용 가능한 프롬프트 템플릿**이다. 자주 쓰는 지시사항을 미리 정의해두는 것.

```typescript
// MCP Prompt 예시
{
  name: "code_review",
  description: "코드 리뷰 프롬프트",
  arguments: [
    { name: "language", description: "프로그래밍 언어", required: true },
    { name: "code", description: "리뷰할 코드", required: true }
  ]
}
```

이걸 호출하면 미리 짜둔 코드 리뷰 프롬프트가 자동으로 채워진다. 일종의 매크로 같은 거다.

## 실제 사용 사례

MCP로 뭘 할 수 있는지 구체적으로 보자.

### 날씨 조회

```typescript
// 날씨 MCP 서버
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_weather") {
    const city = request.params.arguments.city;
    const weather = await fetchWeatherAPI(city);
    
    return {
      content: [{
        type: "text",
        text: `${city} 날씨: ${weather.temp}°C, ${weather.condition}`
      }]
    };
  }
});
```

AI: "서울 날씨 어때?"  
→ MCP Tool 호출: `get_weather("Seoul")`  
→ 서버가 날씨 API 호출  
→ AI가 결과 받아서 답변: "서울은 현재 15°C, 맑음입니다."

### 데이터베이스 쿼리

```python
# PostgreSQL MCP 서버
@server.call_tool()
async def query_database(query: str, params: list = None):
    async with db_pool.acquire() as conn:
        result = await conn.fetch(query, *params)
        return {"rows": [dict(row) for row in result]}
```

AI: "지난달 매출 상위 10개 제품 보여줘"  
→ AI가 SQL 생성  
→ MCP를 통해 DB 쿼리  
→ 결과를 테이블로 정리해서 보여줌

### GitHub 연동

Issue 생성, PR 코멘트, 코드 검색 등을 MCP 서버로 구현하면, AI가 직접 GitHub를 조작할 수 있다.

"이 버그 수정하고 PR 만들어줘" → AI가 코드 수정 + GitHub API 호출 + PR 자동 생성.

### 스마트홈 제어

"거실 불 꺼줘", "온도 23도로 맞춰줘" 같은 명령을 MCP를 통해 IoT 기기와 연결. 

사실 이 부분은 아직 초기 단계지만, 가능성은 무궁무진하다고 본다. AI가 물리적 세계와 연결되는 인터페이스가 표준화되면, 진짜 "AI 비서"가 현실이 될 수 있다.

![Architecture](/images/2026-02-20-MCP-What-Is-Model-Context-Protocol/architecture.jpg)

## 지원 클라이언트

2026년 2월 현재, MCP를 지원하는 주요 클라이언트는:

- **Claude Desktop** — Anthropic 공식 데스크톱 앱
- **Claude Code** — CLI 기반 코딩 어시스턴트 (내가 지금 쓰고 있는 것)
- **VS Code MCP Extension** — Visual Studio Code 확장
- **Cursor** — AI 코드 에디터
- **Zed** — 차세대 코드 에디터

그리고 개발자라면 **직접 클라이언트를 만들 수도 있다**. Anthropic이 공식 SDK를 TypeScript, Python으로 제공한다.

```bash
# TypeScript
npm install @modelcontextprotocol/sdk

# Python
pip install mcp
```

## 내가 보는 MCP의 미래

개인적으로 MCP는 AI 생태계에서 **게임 체인저**가 될 가능성이 크다고 본다.

왜냐면:

1. **표준의 힘** — USB-C가 전자기기 업계를 바꿨듯, MCP도 AI 통합의 판도를 바꿀 수 있다.
2. **오픈소스** — Anthropic이 만들었지만, 오픈 프로토콜이다. 누구나 쓸 수 있고, 기여할 수 있다.
3. **타이밍** — 2024년부터 AI가 단순 챗에서 "Agent" 단계로 넘어가고 있는데, 딱 필요한 시점에 나왔다.

물론 한계도 있다:
- 아직 초기 단계라 서버 생태계가 부족함
- 보안 이슈 (AI가 DB나 파일에 접근한다는 건 민감한 문제)
- 기업 환경에서 도입하려면 거버넌스, 감사 로그 등 고려할 게 많음

하지만 방향성은 확실히 옳다. AI가 진짜 유용한 도구가 되려면, **현실 세계와 연결**되어야 하고, 그 연결이 **표준화**되어야 한다.

## 다음 편 예고

이번 글에서는 MCP가 뭔지, 왜 필요한지, 어떻게 동작하는지 전체 그림을 그려봤다.

**다음 편(2편)**에서는 직접 **MCP 서버를 만들어볼 거다**. TypeScript로 간단한 날씨 조회 서버를 구현하고, Claude Desktop에서 실제로 써보는 실습 포스트가 될 예정이다.

**3편**에서는 실전 레벨로 들어가서, PostgreSQL 연동, 파일 시스템 접근, 그리고 보안 이슈까지 다룰 계획이다.

MCP에 관심 있다면 다음 편도 기대해주시길!

---

## MCP 시리즈 전체 링크

- **1편: MCP란 무엇인가 — AI와 도구를 연결하는 새로운 표준 (이 글)**
- [2편: MCP 서버 만들기 — Python과 TypeScript로 직접 구축하기](/blog/mcp-build-server-python-typescript)
- [3편: 실전 MCP 연동 — Claude Desktop, VS Code, 원격 배포까지](/blog/mcp-integration-claude-vscode-deploy)

---

**참고 자료:**
- [MCP 공식 문서](https://modelcontextprotocol.io)
- [MCP GitHub Repository](https://github.com/modelcontextprotocol)
- [Anthropic MCP 발표 블로그](https://www.anthropic.com/news/model-context-protocol)
