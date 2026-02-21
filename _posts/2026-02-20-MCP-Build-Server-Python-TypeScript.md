---
title: 'MCP 서버 직접 만들기 — Python과 TypeScript로 첫 서버 구축'
date: 2026-02-20 00:00:00
description: 'MCP 서버를 Python FastMCP와 TypeScript SDK로 직접 구축하는 실습 가이드. Tools, Resources, Prompts 구현법과 디버깅 팁까지.'
featured_image: '/images/2026-02-20-MCP-Build-Server-Python-TypeScript/cover.jpg'
---

![Cover](/images/2026-02-20-MCP-Build-Server-Python-TypeScript/cover.jpg)

[MCP 시리즈 1편](/blog/mcp-what-is-model-context-protocol)에서 Model Context Protocol의 개념과 구조를 살펴봤다면, 이번 2편에서는 직접 손으로 MCP 서버를 만들어보자. 이론만 아는 것과 실제로 코드를 작성해보는 건 천지 차이다.

이 글에서는 Python과 TypeScript 두 가지 언어로 MCP 서버를 구축하는 방법을 다룬다. 각 언어의 장점을 살려서 실용적인 예제를 만들어볼 것이다.

## 왜 MCP 서버를 직접 만들어야 할까?

기존 MCP 서버를 사용하는 것도 좋지만, 직접 만들면 다음과 같은 이점이 있다:

- **맞춤형 기능**: 내 워크플로우에 딱 맞는 도구를 만들 수 있다
- **데이터 통합**: 회사 내부 DB, API, 파일 시스템 등 무엇이든 연결 가능
- **학습**: MCP 프로토콜을 깊이 이해하고 활용할 수 있다
- **확장성**: 필요에 따라 기능을 추가하거나 수정할 수 있다

그럼 본격적으로 시작해보자!

---

## 환경 설정

### Python 환경 (FastMCP 사용)

Python에서는 `uv`라는 빠른 패키지 관리자와 MCP SDK를 사용한다.

```bash
# uv 설치 (macOS/Linux)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# 프로젝트 생성
uv init my-mcp-server
cd my-mcp-server

# MCP SDK 설치
uv add mcp
```

**삽질 방지 팁**: `uv`를 설치한 후 터미널을 재시작해야 `uv` 명령어가 인식된다. 안 되면 `~/.bashrc` 또는 `~/.zshrc`를 다시 로드하자.

### TypeScript 환경

TypeScript에서는 Node.js와 공식 MCP SDK를 사용한다.

```bash
# Node.js 버전 확인 (16 이상 필요)
node --version
npm --version

# 프로젝트 생성
mkdir my-mcp-server-ts
cd my-mcp-server-ts
npm init -y

# MCP SDK 설치
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node

# TypeScript 설정 파일 생성
npx tsc --init
```

`package.json`에 다음을 추가:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node build/index.js"
  }
}
```

---

## FastMCP로 간단한 서버 만들기 (Python)

![Python Code](/images/2026-02-20-MCP-Build-Server-Python-TypeScript/python-code.jpg)

Python의 FastMCP는 Flask나 FastAPI처럼 간결하고 직관적인 API를 제공한다. 타입 힌트와 docstring만으로 자동으로 스키마를 생성해주는 게 큰 장점이다.

### 기본 서버 구조

`server.py` 파일을 만들고 다음 코드를 작성하자:

```python
from mcp.server.fastmcp import FastMCP

# 서버 인스턴스 생성
mcp = FastMCP("my-first-server")

@mcp.tool()
async def add(a: int, b: int) -> str:
    """두 수를 더합니다."""
    return str(a + b)

@mcp.tool()
async def multiply(a: int, b: int) -> str:
    """두 수를 곱합니다.
    
    Args:
        a: 첫 번째 숫자
        b: 두 번째 숫자
    """
    return str(a * b)

if __name__ == "__main__":
    # STDIO 트랜스포트로 서버 실행
    mcp.run(transport="stdio")
```

**중요 포인트**:

1. **타입 힌트 필수**: `a: int, b: int`처럼 타입을 명시하면 FastMCP가 자동으로 JSON Schema를 생성한다
2. **Docstring이 곧 설명**: 함수의 docstring이 LLM에게 전달되는 도구 설명이 된다
3. **반환 타입도 중요**: `-> str`로 명시하면 클라이언트가 예상 타입을 알 수 있다

### Resources 구현하기

Resources는 파일이나 DB 데이터처럼 "읽을 수 있는 것"을 제공한다. URI 패턴으로 동적 리소스를 만들 수 있다.

```python
@mcp.resource("greeting://{name}")
async def greeting(name: str) -> str:
    """특정 사람에게 인사를 건넵니다."""
    return f"안녕하세요, {name}님! MCP 서버에 오신 것을 환영합니다."

@mcp.resource("file://config")
async def get_config() -> str:
    """서버 설정을 반환합니다."""
    config = {
        "version": "1.0.0",
        "features": ["tools", "resources", "prompts"]
    }
    import json
    return json.dumps(config, indent=2, ensure_ascii=False)
```

**URI 패턴 활용법**:
- `greeting://john` → `name="john"`으로 전달
- `{name}` 같은 경로 변수를 함수 인자로 자동 매핑

### Prompts 구현하기

Prompts는 재사용 가능한 프롬프트 템플릿이다. LLM에게 특정 작업을 할 때 사용할 수 있는 "레시피"를 제공한다고 생각하면 된다.

```python
@mcp.prompt()
async def code_review_prompt(language: str, code: str) -> str:
    """코드 리뷰를 위한 프롬프트를 생성합니다.
    
    Args:
        language: 프로그래밍 언어 (예: Python, JavaScript)
        code: 리뷰할 코드
    """
    return f"""다음 {language} 코드를 리뷰해주세요:

```{language}
{code}
```

다음 항목을 중점적으로 확인해주세요:
1. 버그나 잠재적 오류
2. 성능 개선 가능성
3. 코드 가독성
4. 보안 이슈
"""
```

---

## TypeScript로 서버 만들기

![TypeScript Code](/images/2026-02-20-MCP-Build-Server-Python-TypeScript/typescript-code.jpg)

TypeScript는 타입 안정성과 IDE 지원이 뛰어나다. 프로덕션 환경에서 안정적인 서버를 만들 때 좋은 선택이다.

### 기본 서버 구조

`src/index.ts` 파일을 생성하자:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 서버 인스턴스 생성
const server = new McpServer({
  name: "my-first-server-ts",
  version: "1.0.0",
});

// Tool 등록: 두 수 더하기
server.registerTool(
  "add",
  {
    description: "두 수를 더합니다",
    inputSchema: {
      a: z.number().describe("첫 번째 숫자"),
      b: z.number().describe("두 번째 숫자"),
    },
  },
  async ({ a, b }) => {
    return {
      content: [
        {
          type: "text",
          text: `결과: ${a + b}`,
        },
      ],
    };
  }
);

// Tool 등록: 두 수 곱하기
server.registerTool(
  "multiply",
  {
    description: "두 수를 곱합니다",
    inputSchema: {
      a: z.number().describe("첫 번째 숫자"),
      b: z.number().describe("두 번째 숫자"),
    },
  },
  async ({ a, b }) => {
    return {
      content: [
        {
          type: "text",
          text: `결과: ${a * b}`,
        },
      ],
    };
  }
);

// 서버 실행
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**TypeScript의 장점**:
1. **Zod 스키마**: 런타임 타입 검증까지 제공
2. **타입 안정성**: 컴파일 타임에 오류를 잡을 수 있음
3. **명시적 구조**: 반환 타입이 명확해서 실수가 줄어듦

빌드를 잊지 말자:

```bash
npm run build
```

---

## STDIO vs HTTP Transport

MCP 서버는 두 가지 전송 방식을 지원한다:

### STDIO (Standard Input/Output)

**사용 시나리오**:
- 로컬 환경 (Claude Desktop, VS Code 등)
- 단일 클라이언트 연결
- 프로세스 간 직접 통신

**장점**:
- 설정이 간단함
- 네트워크 없이 빠름
- 보안 걱정 없음

**단점**:
- 원격 접속 불가
- 하나의 클라이언트만 연결 가능

**주의사항** ⚠️:
```python
# ❌ 절대 하지 말 것 (JSON-RPC 깨짐!)
print("서버가 시작되었습니다")

# ✅ 올바른 방법
import sys
print("서버가 시작되었습니다", file=sys.stderr)

# 또는 로깅 라이브러리 사용
import logging
logging.info("서버가 시작되었습니다")  # 기본적으로 stderr로 출력
```

**왜 이런 제약이 있을까?**

STDIO 방식에서는 `stdin`/`stdout`을 JSON-RPC 메시지 교환에 사용한다. 만약 `stdout`에 일반 텍스트를 출력하면 JSON 파싱이 깨져서 서버가 작동하지 않는다. 이 부분에서 삽질하는 사람이 엄청 많다!

### HTTP Transport (SSE)

**사용 시나리오**:
- 원격 서버
- 여러 클라이언트 동시 연결
- 클라우드 배포

**장점**:
- 원격 접속 가능
- 여러 클라이언트 지원
- 확장성 좋음

**단점**:
- 네트워크 설정 필요
- 인증/보안 고려 필요

---

## 실전 예제: 할 일 관리 MCP 서버

이제 실용적인 예제를 만들어보자. 간단한 할 일(TODO) 관리 서버를 Python으로 구현한다.

```python
from mcp.server.fastmcp import FastMCP
from typing import List
import json
import sys

# 서버 인스턴스
mcp = FastMCP("todo-manager")

# 메모리 기반 할 일 저장소
todos: List[dict] = []

@mcp.tool()
async def add_todo(task: str, priority: str = "medium") -> str:
    """할 일을 추가합니다.
    
    Args:
        task: 할 일 내용
        priority: 우선순위 (low, medium, high)
    """
    todo = {
        "id": len(todos) + 1,
        "task": task,
        "priority": priority,
        "completed": False
    }
    todos.append(todo)
    print(f"[DEBUG] 할 일 추가됨: {todo}", file=sys.stderr)
    return f"✅ 할 일이 추가되었습니다 (ID: {todo['id']})"

@mcp.tool()
async def list_todos(filter_priority: str = "all") -> str:
    """할 일 목록을 조회합니다.
    
    Args:
        filter_priority: 우선순위 필터 (all, low, medium, high)
    """
    if filter_priority == "all":
        filtered = todos
    else:
        filtered = [t for t in todos if t["priority"] == filter_priority]
    
    if not filtered:
        return "📋 할 일이 없습니다."
    
    result = "📋 할 일 목록:\n\n"
    for todo in filtered:
        status = "✅" if todo["completed"] else "⬜"
        result += f"{status} [{todo['id']}] {todo['task']} (우선순위: {todo['priority']})\n"
    
    return result

@mcp.tool()
async def complete_todo(todo_id: int) -> str:
    """할 일을 완료 처리합니다.
    
    Args:
        todo_id: 완료할 할 일의 ID
    """
    for todo in todos:
        if todo["id"] == todo_id:
            todo["completed"] = True
            return f"✅ 할 일 #{todo_id}가 완료되었습니다!"
    
    return f"❌ ID {todo_id}인 할 일을 찾을 수 없습니다."

@mcp.tool()
async def delete_todo(todo_id: int) -> str:
    """할 일을 삭제합니다.
    
    Args:
        todo_id: 삭제할 할 일의 ID
    """
    global todos
    original_len = len(todos)
    todos = [t for t in todos if t["id"] != todo_id]
    
    if len(todos) < original_len:
        return f"🗑️ 할 일 #{todo_id}가 삭제되었습니다."
    else:
        return f"❌ ID {todo_id}인 할 일을 찾을 수 없습니다."

@mcp.resource("todos://all")
async def get_all_todos() -> str:
    """모든 할 일을 JSON 형식으로 반환합니다."""
    return json.dumps(todos, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

**실전 팁**:
1. **전역 상태 관리**: 프로덕션에서는 메모리 대신 DB를 사용하자
2. **로깅 활용**: `sys.stderr`로 디버그 메시지를 출력하면 개발이 훨씬 편함
3. **에러 처리**: 실제 서비스에서는 try-except로 예외를 잡아야 함

---

## MCP Inspector로 테스트하기

![Testing](/images/2026-02-20-MCP-Build-Server-Python-TypeScript/testing.jpg)

서버를 만들었으면 제대로 작동하는지 테스트해야 한다. MCP Inspector는 공식 디버깅 도구다.

### MCP Inspector 설치 및 실행

```bash
# npx로 바로 실행 (설치 없이)
npx @modelcontextprotocol/inspector uv run server.py

# TypeScript 서버 테스트
npx @modelcontextprotocol/inspector node build/index.js
```

웹 브라우저가 자동으로 열리면서 Inspector UI가 나타난다.

### Inspector에서 할 수 있는 것들

1. **Tools 목록 확인**: 서버가 제공하는 모든 도구를 볼 수 있음
2. **Tool 실행**: 파라미터를 입력하고 결과 확인
3. **Resources 탐색**: URI로 리소스 접근
4. **Prompts 테스트**: 프롬프트 템플릿 미리보기
5. **실시간 로그**: 서버의 stderr 출력을 실시간으로 확인

**디버깅 꿀팁**:
- Inspector는 JSON-RPC 메시지를 실시간으로 보여줌
- 네트워크 탭에서 요청/응답을 상세히 볼 수 있음
- 에러가 나면 스택 트레이스를 바로 확인 가능

---

## Claude Desktop에 서버 연결하기

실제로 사용하려면 MCP 클라이언트(예: Claude Desktop)에 서버를 연결해야 한다.

### macOS/Linux

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) 또는  
`~/.config/Claude/claude_desktop_config.json` (Linux) 파일을 편집:

```json
{
  "mcpServers": {
    "todo-manager": {
      "command": "uv",
      "args": [
        "--directory",
        "/절대경로/my-mcp-server",
        "run",
        "server.py"
      ]
    },
    "todo-manager-ts": {
      "command": "node",
      "args": [
        "/절대경로/my-mcp-server-ts/build/index.js"
      ]
    }
  }
}
```

### Windows

`%APPDATA%\Claude\claude_desktop_config.json` 파일 편집 (경로 형식만 다름).

**중요 포인트**:
- `command`는 실행 파일의 전체 경로 또는 PATH에 있는 명령어
- `args`는 명령줄 인자 배열
- **절대 경로 사용**: 상대 경로는 작동하지 않음
- 설정 변경 후 Claude Desktop 재시작 필수

Claude를 재시작하면 채팅창에서 🔧 아이콘으로 MCP 도구를 사용할 수 있다!

---

## 자주 하는 실수와 해결법

### 1. "Server not responding"

**원인**: STDIO에서 `print()` 사용  
**해결**: `print(..., file=sys.stderr)` 또는 로깅 라이브러리 사용

### 2. "Command not found"

**원인**: 설정 파일에 상대 경로 사용  
**해결**: 절대 경로로 변경 (`/Users/myname/projects/...`)

### 3. 타입 스키마 오류

**원인**: Python에서 타입 힌트 누락  
**해결**: 모든 함수 인자에 타입 명시 (`a: int, name: str`)

### 4. "Module not found"

**원인**: TypeScript 빌드 안 함  
**해결**: `npm run build` 실행 후 다시 시도

### 5. Resources가 안 보임

**원인**: URI 패턴 오타  
**해결**: `@mcp.resource("scheme://path")` 형식 확인

---

## 성능 최적화 팁

### 비동기 처리 활용

```python
import asyncio
import httpx

@mcp.tool()
async def fetch_multiple_apis(urls: list[str]) -> str:
    """여러 API를 동시에 호출합니다."""
    async with httpx.AsyncClient() as client:
        # 병렬로 요청 실행
        tasks = [client.get(url) for url in urls]
        responses = await asyncio.gather(*tasks)
    
    return f"총 {len(responses)}개 API 호출 완료"
```

### 캐싱 추가

```python
from functools import lru_cache
from datetime import datetime, timedelta

# 간단한 시간 기반 캐시
cache = {}
CACHE_TTL = timedelta(minutes=5)

@mcp.tool()
async def get_weather(city: str) -> str:
    """날씨 정보를 캐싱과 함께 조회합니다."""
    now = datetime.now()
    
    # 캐시 확인
    if city in cache:
        cached_time, cached_data = cache[city]
        if now - cached_time < CACHE_TTL:
            return f"[캐시] {cached_data}"
    
    # 실제 API 호출 (여기서는 더미)
    data = f"{city}의 날씨는 맑음입니다."
    cache[city] = (now, data)
    
    return data
```

---

## 보안 고려사항

MCP 서버를 만들 때 꼭 지켜야 할 보안 원칙:

### 1. 입력 검증

```python
@mcp.tool()
async def read_file(filepath: str) -> str:
    """파일을 읽습니다."""
    # ❌ 위험: 경로 조작 공격 가능
    # with open(filepath) as f:
    #     return f.read()
    
    # ✅ 안전: 허용된 디렉토리만 접근
    import os
    from pathlib import Path
    
    ALLOWED_DIR = Path("/safe/directory")
    full_path = (ALLOWED_DIR / filepath).resolve()
    
    if not full_path.is_relative_to(ALLOWED_DIR):
        return "❌ 허용되지 않은 경로입니다."
    
    with open(full_path) as f:
        return f.read()
```

### 2. 민감 정보 노출 방지

```python
# ❌ 절대 하지 말 것
@mcp.tool()
async def get_api_key() -> str:
    return "sk-abc123..."  # API 키 노출!

# ✅ 환경 변수 사용
import os

@mcp.tool()
async def call_external_api(query: str) -> str:
    api_key = os.getenv("EXTERNAL_API_KEY")
    # API 호출 로직...
```

### 3. Rate Limiting

```python
from collections import defaultdict
from datetime import datetime, timedelta

# 간단한 레이트 리미터
rate_limits = defaultdict(list)
MAX_CALLS_PER_MINUTE = 10

@mcp.tool()
async def expensive_operation(user_id: str) -> str:
    """비용이 큰 작업 (레이트 리밋 적용)"""
    now = datetime.now()
    
    # 1분 이내 호출 기록 확인
    recent_calls = [
        t for t in rate_limits[user_id]
        if now - t < timedelta(minutes=1)
    ]
    
    if len(recent_calls) >= MAX_CALLS_PER_MINUTE:
        return "❌ 요청이 너무 많습니다. 잠시 후 다시 시도하세요."
    
    # 호출 기록
    rate_limits[user_id].append(now)
    
    # 실제 작업...
    return "✅ 작업 완료"
```

---

## 다음 단계

여기까지 따라왔다면 이제 자신만의 MCP 서버를 만들 수 있다! 다음으로 할 수 있는 것들:

1. **DB 연동**: SQLite, PostgreSQL 등과 연결해보자
2. **외부 API 통합**: GitHub, Slack, Notion 등의 API를 MCP로 래핑
3. **복잡한 워크플로우**: 여러 도구를 조합한 자동화 구축
4. **에러 처리 강화**: 프로덕션 레벨의 예외 처리 추가
5. **테스트 작성**: pytest나 jest로 단위 테스트 작성

---

## MCP 시리즈 전체 링크

- [1편: MCP란 무엇인가 — AI와 도구를 연결하는 새로운 표준](/blog/mcp-what-is-model-context-protocol)
- **2편: MCP 서버 만들기 — Python과 TypeScript로 직접 구축하기 (이 글)**
- [3편: 실전 MCP 연동 — Claude Desktop, VS Code, 원격 배포까지](/blog/mcp-integration-claude-vscode-deploy)

---

## 마무리

MCP 서버를 직접 만들어보니 어땠나? 처음에는 복잡해 보이지만, 막상 만들어보면 구조가 꽤 단순하다. Tools, Resources, Prompts라는 세 가지 기본 개념만 이해하면 나머지는 자연스럽게 따라온다.

특히 Python의 FastMCP는 정말 쓰기 편하다. 타입 힌트 몇 개만 추가하면 자동으로 스키마가 생성되고, Claude 같은 LLM이 바로 사용할 수 있는 도구가 된다. TypeScript는 타입 안정성이 필요한 프로덕션 환경에 적합하다.

가장 중요한 건 **실제로 써보는 것**이다. 본인의 워크플로우에서 반복적으로 하는 작업이 있다면, 그걸 MCP 서버로 만들어보자. 처음엔 간단한 할 일 관리부터 시작해서, 점점 복잡한 자동화로 확장하면 된다.

다음 3편에서는 실전에서 MCP 서버를 Claude, VS Code 등 다양한 클라이언트와 연동하고, 유용한 서버 예제들을 더 깊이 파헤쳐볼 예정이다.

Happy coding! 🚀
