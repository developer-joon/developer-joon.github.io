---
title: 'MCP 서버를 허용했는데 왜 보이지 않는가 — Shadow MCP 트래픽 보안'
date: 2026-08-16 09:30:00
categories: ["AI 에이전트"]
description: 'MCP 요청은 일반 HTTPS 트래픽처럼 보일 수 있다. Shadow MCP가 생기는 이유와 클라이언트·네트워크·서버를 함께 통제하는 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/shadow-mcp-traffic-security/1600/900'
tags: [mcp, ai-agent, zero-trust, network-security, json-rpc, cloudflare]
---

![Shadow MCP 트래픽 보안](https://picsum.photos/seed/shadow-mcp-traffic-security/1600/900)

Model Context Protocol은 에이전트와 도구를 연결하는 공통 인터페이스로 빠르게 자리 잡았다. Claude Code, Codex, Cursor, VS Code 같은 클라이언트에 MCP 서버 주소를 추가하면 에이전트가 SaaS, 데이터베이스, 사내 API를 도구처럼 호출할 수 있다.

문제는 연결이 쉬운 만큼 조직의 승인 경로를 우회하기도 쉽다는 점이다. 직원이 개인 설정에 MCP 서버 한 줄을 추가하면 보안팀이 모르는 도구 연결이 생길 수 있다. 이른바 Shadow MCP다.

단순히 알려진 MCP 서버 도메인을 차단하거나 허용하는 방식으로는 충분하지 않다. MCP는 고정 hostname이나 반드시 사용해야 하는 `/mcp` 경로가 없어서 일반 HTTPS API 트래픽처럼 보일 수 있기 때문이다.

## MCP 도구 호출은 세 가지 모습으로 이동한다

하나의 MCP 도구 호출은 위치에 따라 다르게 보인다.

클라이언트 안에서는 "어떤 도구를 어떤 인자로 호출한다"는 에이전트의 결정이다. 네트워크에서는 JSON-RPC 메시지를 포함한 HTTP 요청이다. 서버에서는 데이터 읽기, 상태 변경, 외부 작업을 수행하는 handler 호출이 된다.

예를 들어 날씨 도구 호출은 네트워크에서 대략 다음처럼 보일 수 있다.

```http
POST /mcp HTTP/1.1
Host: tools.example.com
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "city": "Seoul"
    }
  }
}
```

이 예시는 식별하기 쉽다. URL에 `/mcp`가 있고 payload에 `tools/call`이 있다. 하지만 실제 구현은 다른 경로를 쓰거나 streaming transport를 사용하고, TLS 안에서 payload가 암호화될 수 있다. endpoint 이름만 보고 MCP 여부를 판단하는 방식은 쉽게 빠져나간다.

## Shadow MCP는 왜 생기는가

Shadow IT는 승인되지 않은 SaaS를 직원이 사용하는 문제였다. Shadow MCP는 그보다 영향 범위가 넓을 수 있다. MCP 서버 하나가 여러 도구와 권한을 에이전트에 노출하기 때문이다.

주요 발생 경로는 다음과 같다.

- 개발자가 개인 설정 파일에 외부 MCP 서버를 추가한다.
- 공식 서버와 이름이 비슷한 비공식 package를 설치한다.
- 승인된 서버에 직접 연결해 조직의 gateway나 portal을 우회한다.
- 로컬 stdio MCP가 별도 child process를 실행하고 외부로 통신한다.
- 하나의 MCP 서버가 내부에서 다시 여러 SaaS API를 호출한다.
- 에이전트가 repository 문서나 prompt injection을 따라 새로운 연결을 시도한다.

여기서 위험은 서버 존재 자체가 아니다. 서버가 가진 실제 권한, 사용하는 credential, 호출 가능한 도구, network reach가 보이지 않는 것이 문제다.

사람에게 부여했던 권한을 그대로 에이전트에 전달하면 속도의 차이도 고려해야 한다. 사람이 하루에 몇 번 실행할 작업을 에이전트는 짧은 시간에 반복할 수 있다. 잘못된 판단 하나가 수천 번의 호출로 확대될 수 있다.

## URL allowlist만으로 부족한 이유

가장 단순한 통제는 승인된 MCP 서버 URL 목록을 만드는 것이다. 출발점으로는 필요하지만 완전한 해결책은 아니다.

첫째, MCP는 고정된 domain이나 path 규칙이 없다. 같은 서버가 일반 API와 MCP endpoint를 하나의 host에서 제공할 수 있다. 반대로 여러 tenant가 공유 domain을 쓸 수도 있다.

둘째, redirect, proxy, DNS 변경, CDN 뒤의 origin처럼 URL과 실제 목적지가 다를 수 있다. hostname만 허용하면 예상하지 못한 route가 열릴 수 있다.

셋째, 승인된 서버라고 해서 모든 도구가 안전한 것은 아니다. 읽기 전용 검색 도구와 production 배포 도구가 같은 endpoint에 있을 수 있다. 서버 단위 허용은 tool 단위 권한을 표현하지 못한다.

넷째, 로컬 stdio transport는 네트워크 장비에 MCP로 보이지 않는다. MCP client와 server가 같은 장비에서 process 간 통신을 하고, server process가 일반 HTTPS로 외부 API를 호출할 수 있다.

따라서 네트워크 탐지만으로 모든 MCP를 찾을 수 있다고 말하면 과장이다. 클라이언트 설정, endpoint 트래픽, 서버 등록 정보를 함께 봐야 한다.

## 통제 지점은 클라이언트·네트워크·서버다

MCP 보안은 세 계층으로 나누는 편이 이해하기 쉽다.

### 클라이언트 통제

클라이언트는 에이전트가 어떤 도구를 보았고 왜 호출했는지 가장 잘 안다. 조직 관리 설정으로 설치 가능한 MCP 서버와 plugin을 제한하고, permission bypass를 차단하며, 위험 도구에 사용자 승인을 요구할 수 있다.

그러나 모든 클라이언트가 같은 관리 기능을 제공하지는 않는다. 사용자가 다른 harness를 설치하거나 로컬 설정을 변경하면 우회가 생길 수 있다.

### 네트워크 통제

네트워크 계층은 여러 클라이언트의 트래픽을 한 곳에서 관찰할 수 있다. Cloudflare는 protocol-level heuristic으로 MCP 요청을 분류하고, 승인된 MCP Portal을 거친 요청과 직접 연결을 구분하는 기능을 발표했다.

이 방식은 가시성을 높이지만 TLS inspection 범위, 로컬 stdio, false positive와 false negative를 고려해야 한다. 제품이 MCP를 식별한다고 해서 모든 변형을 완벽히 잡는다는 뜻은 아니다.

### 서버 통제

서버는 실제 tool handler와 downstream credential을 통제한다. tool별 scope, rate limit, audit log, input validation, idempotency, approval gate를 구현할 수 있다.

하지만 조직이 관리하지 않는 외부 서버에는 동일한 정책을 강제하기 어렵다. 그래서 신뢰할 수 있는 서버 catalog와 승인된 proxy 경로가 필요하다.

세 계층 중 하나만 완벽하게 만들기보다 각 계층이 놓친 것을 다른 계층이 보완하도록 설계해야 한다.

## 승인된 Portal 경로의 의미

MCP Portal 또는 gateway는 에이전트가 여러 서버에 직접 연결하는 대신 중앙 경로를 거치게 한다. 이 구조는 다음 장점을 준다.

- 승인된 서버와 도구 catalog 제공
- 인증과 token 교환 중앙화
- 사용자·에이전트·도구별 정책 적용
- 요청과 응답에 대한 공통 감사 로그
- rate limit과 비정상 반복 호출 차단
- 서버 교체 시 client 설정 변경 최소화

대신 새로운 단일 장애 지점과 신뢰 경계가 생긴다. Portal이 탈취되면 여러 도구에 대한 접근이 한꺼번에 노출될 수 있다. 장애가 나면 모든 에이전트 작업이 멈출 수도 있다. 중앙화는 관리 편의와 blast radius를 동시에 키운다.

따라서 고가용성, credential 격리, policy 변경 감사, 비상 차단, 우회 경로 탐지까지 함께 설계해야 한다.

## 운영팀이 먼저 수집할 데이터

MCP를 통제하기 전에 무엇이 연결돼 있는지 알아야 한다. 최소 인벤토리는 다음 필드를 포함하는 편이 좋다.

- MCP server 이름과 endpoint
- owner와 업무 목적
- transport 유형: remote HTTP, streaming, stdio
- 제공하는 tool 목록과 read/write 구분
- 사용하는 identity와 credential scope
- 접근 가능한 데이터와 network destination
- client 또는 agent 종류
- 마지막 사용 시점과 호출량
- 승인 상태와 만료일

감사 로그에는 prompt 전문을 무조건 저장할 필요가 없다. 내부 코드, 개인정보, secret이 포함될 수 있기 때문이다. 대신 actor, agent session, server, tool, request ID, policy decision, 결과 상태, latency를 우선 남긴다. 민감한 인자는 마스킹하거나 hash로 추적해야 한다.

도구 호출이 상태를 변경한다면 idempotency key와 dry-run도 중요하다. 네트워크 탐지는 호출을 발견할 뿐, 중복 실행으로 생기는 운영 사고까지 해결하지 않는다.

## 현실적인 도입 순서

처음부터 모든 MCP 트래픽을 차단하면 개발자는 통제를 우회할 가능성이 높다. 단계적으로 가는 편이 낫다.

1. 관리 장비와 저장소에서 MCP 설정을 inventory 한다.
2. 네트워크에서 의심되는 MCP 신호를 관찰 모드로 수집한다.
3. 업무상 필요한 서버와 owner를 확인한다.
4. read-only 도구부터 승인된 catalog에 등록한다.
5. write 도구에는 별도 승인과 짧은 credential을 적용한다.
6. Portal을 통한 경로가 안정된 뒤 직접 연결을 제한한다.
7. false positive와 누락 사례를 정기적으로 검토한다.
8. 사용하지 않는 연결과 token은 자동 만료한다.

차단 정책은 반드시 예외 절차와 함께 제공해야 한다. 그렇지 않으면 개발자는 개인 장비나 별도 proxy 같은 더 보이지 않는 경로를 선택한다.

## 결론

Shadow MCP의 본질은 새로운 프로토콜이 위험하다는 것이 아니다. 사람이 사용하던 권한과 API가 에이전트에게 더 빠르고 반복 가능한 형태로 연결되는데, 조직의 inventory와 통제가 그 속도를 따라가지 못하는 문제다.

고정 URL allowlist만으로는 충분하지 않다. 클라이언트에서는 설치와 승인을 관리하고, 네트워크에서는 직접 연결과 승인 경로를 관찰하며, 서버에서는 tool 단위 권한과 감사·rate limit을 강제해야 한다.

Cloudflare의 발표는 MCP 트래픽을 네트워크 계층에서 분류하려는 한 가지 접근이다. 이를 만능 탐지로 받아들이기보다 기존 Zero Trust와 API 보안에 MCP라는 새로운 actor와 protocol signal을 추가하는 흐름으로 보는 편이 정확하다.

## 참고 자료

- [Cloudflare Blog: How Cloudflare detects MCP traffic and helps secure it](https://blog.cloudflare.com/mcp-security-updates/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/)
