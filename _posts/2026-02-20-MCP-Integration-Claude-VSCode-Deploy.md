---
title: 'MCP 실전 연동 가이드 — Claude Desktop, VS Code에서 내 서버 연결하기'
date: 2026-02-20 00:00:00
description: 'MCP 서버를 Claude Desktop과 VS Code에 연동하고, 원격 배포와 보안까지. MCP 시리즈 완결편.'
featured_image: '/images/2026-02-20-MCP-Integration-Claude-VSCode-Deploy/cover.jpg'
---

![커버 이미지](/images/2026-02-20-MCP-Integration-Claude-VSCode-Deploy/cover.jpg)

드디어 MCP 시리즈의 마지막 편입니다. 지금까지 MCP가 무엇인지, 그리고 어떻게 서버를 만드는지 알아봤습니다. 이제 가장 중요한 단계가 남았죠. **실제로 AI 클라이언트에 연결해서 사용하는 것**입니다.

솔직히 말하면, 처음에 제가 MCP 서버를 만들고 나서 "이걸 어떻게 쓰지?"라고 한참 헤맸던 기억이 납니다. 문서를 읽어봐도 STDIO니 HTTP니 하는 용어들이 낯설고, 설정 파일은 어디에 뭘 써야 하는지 막막했죠. 그래서 이번 편에서는 제가 직접 겪은 시행착오를 바탕으로, **실전에서 바로 써먹을 수 있는 연동 가이드**를 정리했습니다.

## Claude Desktop 연동: 가장 쉬운 첫 시작

![Claude Desktop 설정](/images/2026-02-20-MCP-Integration-Claude-VSCode-Deploy/setup.jpg)

Claude Desktop은 MCP를 가장 쉽게 체험할 수 있는 방법입니다. Anthropic이 직접 만든 클라이언트이다 보니, MCP 지원이 완벽하거든요.

### 설정 파일 찾기

첫 번째 허들은 설정 파일을 찾는 것입니다. 운영체제마다 위치가 다른데요:

**macOS:**
```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

처음 설치했다면 이 파일이 없을 수도 있습니다. 그럼 직접 만들면 됩니다. VS Code로 열어보겠습니다:

```bash
# macOS 기준
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

### STDIO 방식으로 로컬 서버 등록

MCP는 크게 두 가지 전송 방식을 지원합니다:
- **STDIO**: 표준 입출력을 통한 통신 (로컬 서버용)
- **HTTP**: HTTP 프로토콜을 통한 통신 (원격 서버용)

처음에는 STDIO 방식이 훨씬 쉽습니다. Claude Desktop이 알아서 서버 프로세스를 띄워주고 관리해주거든요.

예를 들어, 지난 편에서 만든 날씨 서버를 연결한다면:

```json
{
  "mcpServers": {
    "weather": {
      "command": "uv",
      "args": [
        "--directory",
        "/Users/joon/projects/weather-server",
        "run",
        "weather.py"
      ]
    }
  }
}
```

여기서 실수하기 쉬운 부분이 몇 가지 있습니다:

**1. 절대 경로 사용하기**
`~/projects/weather-server` 이렇게 쓰면 안 됩니다. `~`가 제대로 확장되지 않아요. 반드시 `/Users/joon/projects/weather-server` 같은 절대 경로를 써야 합니다.

**2. command와 args 구분**
처음엔 이걸 하나로 합쳐서 `"command": "uv --directory ..."` 이런 식으로 쓰기 쉬운데, 그러면 작동하지 않습니다. 명령어와 인자는 반드시 분리해야 합니다.

**3. 파이썬 가상환경 주의**
`uv` 대신 `python`을 직접 쓴다면, 어떤 파이썬 인터프리터를 쓰는지 확인하세요:

```json
{
  "command": "/Users/joon/.pyenv/versions/3.11.0/bin/python",
  "args": ["/Users/joon/projects/weather-server/weather.py"]
}
```

### TypeScript/Node.js 서버 연결

Node.js로 만든 서버도 비슷합니다. 단, 먼저 빌드를 해야 한다는 걸 잊지 마세요:

```bash
cd /path/to/weather-server
npm install
npm run build
```

그리고 설정:

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/Users/joon/projects/weather-server/build/index.js"]
    }
  }
}
```

실제로 해보면 이런 실수를 자주 합니다: 빌드 안 하고 `src/index.ts` 파일을 직접 실행하려고 하는 것. TypeScript는 컴파일이 필요하니까, 반드시 빌드된 `.js` 파일을 실행해야 합니다.

### 연결 확인하기

설정을 저장하고 Claude Desktop을 재시작하세요. (완전히 종료했다가 다시 켜야 합니다!)

제대로 연결되었다면, 채팅창 하단에 작은 🔌 아이콘이 나타납니다. 클릭하면 연결된 MCP 서버 목록과 사용 가능한 도구들이 보여요.

만약 안 보인다면? 문제가 생긴 겁니다. 로그를 확인해봅시다:

**macOS/Linux:**
```bash
tail -f ~/Library/Logs/Claude/mcp*.log
```

제가 자주 본 에러들:
- `command not found`: 경로가 잘못되었거나 실행 파일이 없음
- `Module not found`: 의존성 설치 안 됨 (`npm install` 또는 `uv sync` 필요)
- `stdout corruption`: 서버 코드에서 `console.log()` 또는 `print()` 사용 (절대 금지!)

### STDIO의 황금률: stdout은 MCP 메시지만!

STDIO 방식의 가장 중요한 규칙: **stdout에는 MCP JSON-RPC 메시지만 출력해야 합니다.**

이걸 어기면 프로토콜이 깨집니다. 로그를 찍고 싶다면:

**Python:**
```python
import sys

# ❌ 나쁜 예
print("서버 시작됨")

# ✅ 좋은 예
print("서버 시작됨", file=sys.stderr)

# 또는 logging 라이브러리 사용
import logging
logging.basicConfig(level=logging.INFO)
logging.info("서버 시작됨")  # 자동으로 stderr로 출력됨
```

**TypeScript:**
```typescript
// ❌ 나쁜 예
console.log("Server started");

// ✅ 좋은 예
console.error("Server started");
```

처음에 저도 이거 몰라서 한참 헤맸습니다. 서버가 시작조차 안 되길래 디버깅용 `console.log`를 여기저기 박았는데, 그게 오히려 문제를 더 악화시켰던 거죠.

## VS Code / Cursor 연동: 코딩하면서 바로 쓰기

![VS Code 연동](/images/2026-02-20-MCP-Integration-Claude-VSCode-Deploy/deploy.jpg)

Claude Desktop도 좋지만, 개발자라면 IDE에서 바로 쓰고 싶을 겁니다. VS Code나 Cursor에서 MCP를 쓰는 방법을 알아봅시다.

### Copilot과 MCP의 만남

GitHub Copilot은 아직 공식적으로 MCP를 지원하진 않습니다만, Copilot Chat의 Agent Mode에서 실험적으로 사용할 수 있습니다.

프로젝트 루트에 `.vscode/mcp.json` 파일을 만들어주세요:

```json
{
  "mcpServers": {
    "weather": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/server", "run", "server.py"]
    },
    "notion": {
      "command": "node",
      "args": ["/absolute/path/to/notion-server/build/index.js"],
      "env": {
        "NOTION_API_KEY": "${env:NOTION_API_KEY}"
      }
    }
  }
}
```

환경변수를 쓸 때는 `${env:VAR_NAME}` 문법을 씁니다. 실제 값을 하드코딩하면 절대 안 됩니다! (깃에 올리는 순간 API 키 유출)

### Cursor의 경우

Cursor는 좀 더 적극적으로 MCP를 지원합니다. 설정 방법은 비슷하지만, `settings.json`에 직접 추가할 수도 있어요:

```json
{
  "cursor.mcp.servers": {
    "weather": {
      "command": "uv",
      "args": ["--directory", "/path/to/server", "run", "weather.py"]
    }
  }
}
```

에디터를 재시작하면, Cursor의 AI 채팅에서 MCP 도구를 호출할 수 있습니다.

### 실전 팁: workspace별 설정

여러 프로젝트를 다룬다면, 각 프로젝트마다 다른 MCP 서버를 쓰고 싶을 수 있습니다. 그럴 때는 워크스페이스별로 `.vscode/mcp.json`을 두면 됩니다.

예를 들어, 백엔드 프로젝트에는 DB 조회 서버를, 프론트엔드 프로젝트에는 디자인 시스템 서버를 연결하는 식이죠.

## 원격 서버 배포: HTTP 전송으로 확장하기

로컬에서만 쓰기엔 아쉽죠. 팀원들과 공유하거나, 서버리스로 배포하고 싶다면 HTTP 전송을 써야 합니다.

### STDIO → HTTP 전환

기존 STDIO 서버를 HTTP로 바꾸는 건 생각보다 간단합니다.

**Python (FastMCP):**
```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("weather")

# ... 도구 정의 ...

if __name__ == "__main__":
    # STDIO 대신 HTTP로
    mcp.run(transport="streamable-http", port=8000)
```

**TypeScript:**
```typescript
import { HttpServerTransport } from "@modelcontextprotocol/sdk/server/http.js";

const server = new McpServer({ name: "weather", version: "1.0.0" });

// ... 도구 정의 ...

const transport = new HttpServerTransport({
  port: 8000,
  path: "/mcp"
});
await server.connect(transport);
```

### Streamable HTTP의 이해

MCP의 HTTP 전송은 일반적인 REST API와 좀 다릅니다. "Streamable HTTP"라고 부르는데, 특징은:

- **POST**: 클라이언트 → 서버 메시지 (요청, 응답, 알림)
- **GET**: 서버 → 클라이언트 SSE(Server-Sent Events) 스트림
- **Session Management**: `Mcp-Session-Id` 헤더로 세션 관리

클라이언트가 요청을 보낼 때마다 새로운 POST를 보내고, 서버는 응답과 함께 추가 메시지들을 SSE로 스트리밍할 수 있습니다.

예를 들어, 긴 작업을 진행 상황을 실시간으로 알려주거나, 서버에서 먼저 이벤트를 푸시할 수 있죠.

### 인증 추가하기

공개 인터넷에 노출한다면 인증은 필수입니다.

간단한 API 키 방식:

```python
from fastapi import FastAPI, Header, HTTPException

app = FastAPI()

async def verify_api_key(x_api_key: str = Header()):
    if x_api_key != os.getenv("MCP_API_KEY"):
        raise HTTPException(status_code=401, detail="Invalid API key")

# MCP 핸들러에 의존성 추가
@app.post("/mcp", dependencies=[Depends(verify_api_key)])
async def handle_mcp(request: Request):
    # ...
```

실전에서는 JWT나 OAuth를 쓰는 게 더 좋습니다만, 간단한 내부 도구라면 API 키로도 충분합니다.

### Docker로 패키징

배포를 위해 Docker 이미지로 만들어봅시다.

**Dockerfile:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# uv 설치
RUN pip install uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen

COPY . .

EXPOSE 8000

CMD ["uv", "run", "weather.py"]
```

빌드 & 실행:
```bash
docker build -t mcp-weather-server .
docker run -p 8000:8000 -e OPENAI_API_KEY=sk-... mcp-weather-server
```

클라우드에 배포한다면 Cloud Run, Fly.io, Railway 등이 좋은 선택입니다. MCP 서버는 기본적으로 stateless하기 때문에 서버리스와 궁합이 잘 맞아요.

## 실전 예제: 나만의 MCP 서버 아이디어들

이론은 충분히 봤으니, 이제 실제로 어떤 서버를 만들 수 있는지 아이디어를 공유해드릴게요.

### 1. 사내 DB 조회 서버

회사 DB를 AI가 직접 쿼리할 수 있게 만들면 엄청나게 편합니다.

```python
@mcp.tool()
async def query_users(email: str) -> str:
    """사용자 이메일로 정보 조회"""
    async with get_db_connection() as conn:
        result = await conn.fetch(
            "SELECT * FROM users WHERE email = $1", email
        )
        return json.dumps(result, ensure_ascii=False)
```

"test@example.com 사용자의 마지막 로그인 시각 알려줘" 같은 질문에 AI가 바로 답할 수 있습니다.

**주의사항:**
- 읽기 전용 권한만 주세요
- 개인정보는 마스킹 처리
- SQL injection 방지 (parameterized query 사용)

### 2. Slack/Notion 연동

팀 노션이나 Slack의 내용을 AI가 검색할 수 있게 만들면 정말 유용합니다.

```python
@mcp.tool()
async def search_notion(query: str) -> str:
    """노션 페이지 검색"""
    notion = Client(auth=os.getenv("NOTION_API_KEY"))
    results = notion.search(query=query)
    # 결과 포매팅...
    return formatted_results
```

"지난주 회의록에서 다음 분기 계획 찾아줘" 같은 요청을 처리할 수 있죠.

### 3. 주식/코인 시세 조회

실시간 금융 데이터를 AI에게 연결하는 것도 인기 있는 사용례입니다.

```python
@mcp.tool()
async def get_stock_price(symbol: str) -> str:
    """주식 현재가 조회"""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.example.com/quote/{symbol}",
            headers={"Authorization": f"Bearer {API_KEY}"}
        )
        data = resp.json()
        return f"{symbol}: ${data['price']:.2f}"
```

### 4. 스마트홈 제어

이건 제가 개인적으로 가장 재밌게 쓰는 예제입니다. HomeAssistant나 SmartThings API를 연결하면 AI로 집을 제어할 수 있어요.

```python
@mcp.tool()
async def control_light(room: str, state: str) -> str:
    """전등 제어 (on/off)"""
    # HomeAssistant API 호출
    await ha_client.call_service(
        "light", "turn_on" if state == "on" else "turn_off",
        entity_id=f"light.{room}"
    )
    return f"{room} 전등을 {state}로 변경했습니다"
```

"거실 불 꺼줘" → AI가 알아서 MCP 도구를 호출합니다.

## 보안 체크리스트: 안전하게 운영하기

![보안 체크리스트](/images/2026-02-20-MCP-Integration-Claude-VSCode-Deploy/security.jpg)

MCP 서버는 AI에게 강력한 권한을 주는 만큼, 보안에 신경 써야 합니다. 제가 실전에서 배운 체크리스트입니다.

### 1. 로컬 서버는 localhost만 바인딩

STDIO가 아닌 HTTP로 로컬에서 돌릴 때:

```python
# ❌ 나쁜 예
app.run(host="0.0.0.0", port=8000)  # 모든 인터페이스에서 접근 가능

# ✅ 좋은 예
app.run(host="127.0.0.1", port=8000)  # localhost만
```

`0.0.0.0`으로 바인딩하면 같은 네트워크의 누구나 접근할 수 있습니다. 로컬 개발용이라면 `127.0.0.1`만 쓰세요.

### 2. Origin 헤더 검증 (DNS Rebinding 방지)

원격 웹사이트가 로컬 MCP 서버를 공격하는 DNS rebinding 공격을 막으려면:

```python
from fastapi import Request, HTTPException

@app.middleware("http")
async def verify_origin(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and origin not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    return await call_next(request)

ALLOWED_ORIGINS = ["https://claude.ai", "http://localhost:*"]
```

### 3. API 키는 환경변수로

절대로 코드에 하드코딩하지 마세요!

```python
# ❌ 나쁜 예
OPENAI_API_KEY = "sk-proj-abc123..."

# ✅ 좋은 예
import os
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY 환경변수가 필요합니다")
```

`.env` 파일을 쓴다면:
```bash
# .env
OPENAI_API_KEY=sk-proj-abc123...
```

그리고 `.gitignore`에 추가:
```
.env
```

### 4. 도구 실행 전 사용자 확인 (Human-in-the-loop)

위험한 작업(삭제, 결제 등)은 사용자 확인을 받아야 합니다.

MCP는 "prompts" 기능으로 이를 지원합니다:

```python
@mcp.tool()
async def delete_file(path: str) -> str:
    """파일 삭제 (위험)"""
    # 실제 삭제 전에 사용자에게 확인 요청
    # (Claude Desktop은 자동으로 확인 UI를 띄움)
    return f"{path}를 삭제했습니다"
```

또는 명시적으로:

```python
@mcp.tool()
async def charge_payment(amount: float) -> str:
    """결제 처리 - 사용자 확인 필수"""
    # 설명에 명시하여 AI가 먼저 사용자에게 물어보게 유도
    return f"${amount}를 결제했습니다"
```

### 5. 읽기 전용 우선

처음 만들 때는 읽기 전용 도구만 제공하세요. 수정/삭제 기능은 충분히 테스트한 후에 추가하는 게 안전합니다.

```python
# 1단계: 읽기만
@mcp.tool()
async def get_user(email: str) -> str:
    """사용자 조회"""
    # ...

# 2단계: 나중에 추가
@mcp.tool()
async def update_user(email: str, name: str) -> str:
    """사용자 정보 수정 (주의)"""
    # ...
```

### 6. Rate Limiting

특히 외부 API를 호출하는 도구는 rate limit을 꼭 걸어두세요:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@app.post("/mcp")
@limiter.limit("100/hour")
async def handle_mcp(request: Request):
    # ...
```

## MCP 생태계 현황: 함께 성장하는 커뮤니티

MCP는 아직 젊은 프로토콜이지만, 생태계가 빠르게 성장하고 있습니다.

### 공식 레지스트리

Anthropic이 운영하는 공식 서버 목록:
- https://github.com/modelcontextprotocol/servers

여기에는 검증된 서버들이 올라와 있어요:
- `@modelcontextprotocol/server-filesystem`: 파일 시스템 접근
- `@modelcontextprotocol/server-github`: GitHub API
- `@modelcontextprotocol/server-postgres`: PostgreSQL
- 등등...

### awesome-mcp-servers

커뮤니티가 만든 멋진 서버들 모음:
- https://github.com/punkpeye/awesome-mcp-servers

여기서 영감을 얻거나, 직접 기여할 수도 있습니다.

### Discord/Reddit 커뮤니티

- [MCP Discord](https://discord.gg/modelcontextprotocol)
- r/ClaudeAI subreddit의 MCP 스레드들

실시간으로 질문하고 답변받을 수 있는 커뮤니티입니다. 제가 막힐 때 여기서 많은 도움을 받았어요.

### 실전 팁: 기존 서버 포크해서 시작하기

처음부터 만들기 부담스럽다면, 공식 레지스트리의 서버를 포크해서 수정하는 것도 좋은 방법입니다.

```bash
git clone https://github.com/modelcontextprotocol/servers.git
cd servers/src/filesystem
# 코드를 내 용도에 맞게 수정...
```

이미 검증된 코드 구조를 참고하면서 배울 수 있으니까요.

## 시리즈 마무리: MCP가 바꿀 미래

세 편에 걸친 MCP 시리즈를 여기서 마칩니다. 처음 MCP를 접했을 때의 설렘이 아직도 생생한데, 이렇게 시리즈를 마무리하게 되니 뭔가 뿌듯하면서도 아쉽네요.

### MCP의 진짜 가치

솔직히 처음엔 "이거 그냥 API wrapper 아니야?"라고 생각했습니다. 기존 도구들과 뭐가 다르지?

하지만 직접 써보니 알겠더라고요. MCP의 진짜 가치는 **표준화**에 있습니다.

예전엔 Claude용, ChatGPT용, Copilot용 플러그인을 각각 따로 만들어야 했어요. 이제는? MCP 서버 하나만 만들면 됩니다. 어떤 AI 클라이언트든 MCP를 지원하면 바로 쓸 수 있죠.

이건 마치 USB가 등장했을 때와 비슷합니다. 예전엔 키보드, 마우스, 프린터마다 다른 포트를 썼지만, USB 하나로 통일되었잖아요. MCP도 그런 역할을 AI 생태계에서 하게 될 것 같습니다.

### 개인적인 전망

2026년 현재, MCP를 지원하는 클라이언트는:
- Claude Desktop (Anthropic)
- VS Code / Cursor (실험적 지원)
- 몇몇 오픈소스 프로젝트들

하지만 1-2년 후면 훨씬 많아질 거라고 봅니다. OpenAI, Google, 그리고 수많은 AI 스타트업들이 MCP를 채택하게 될 가능성이 높아요.

왜냐하면? **네트워크 효과** 때문입니다. 이미 MCP 서버가 수백 개 만들어지고 있고, 클라이언트 입장에서는 이 생태계를 활용하지 않을 이유가 없거든요.

### 여러분의 첫 MCP 서버를 만들어보세요

이 시리즈를 읽으셨다면, 이제 여러분도 충분히 MCP 서버를 만들 수 있습니다.

작게 시작하세요. 거창한 기능은 필요 없어요:
- 자주 쓰는 API 래핑하기
- 회사 내부 도구 연결하기
- 개인 데이터 조회하기

뭐든 좋습니다. 직접 만들어보면서 배우는 게 가장 빠릅니다.

그리고 만든 서버를 깃허브에 올려주세요. awesome-mcp-servers에 PR 날리고, 커뮤니티와 공유하세요. 함께 성장하는 생태계니까요.

### 마치며

긴 글 읽어주셔서 감사합니다. MCP 시리즈 세 편이 여러분의 AI 개발 여정에 조금이나마 도움이 되었기를 바랍니다.

질문이나 피드백은 언제든 환영입니다. 댓글이나 트위터(@developer_joon)로 연락주세요!

**MCP 시리즈 전체 링크:**
- [1편: MCP란 무엇인가 — AI와 도구를 연결하는 새로운 표준](/blog/MCP-What-Is-Model-Context-Protocol)
- [2편: MCP 서버 만들기 — Python과 TypeScript로 직접 구축하기](/blog/MCP-Build-Server-Python-TypeScript)
- **3편: 실전 MCP 연동 — Claude Desktop, VS Code, 원격 배포까지 (이 글)**

Happy Coding! 🚀
