---
title: 'Agentic Web의 봇 신원과 콘텐츠 경제 — 식별·정책·과금 체계 설계'
date: 2026-10-05 07:00:00 +0900
categories: ["AI 에이전트"]
description: 'Agentic Web에서 Search·Agent·Training 트래픽을 구분하고 Web Bot Auth, 콘텐츠 정책, 사용량 측정, Pay Per Use와 HTTP 402 과금 체계를 연결하는 운영 모델을 분석한다.'
featured_image: 'https://picsum.photos/seed/agentic-web-bot-identity-content-economy/1600/900'
tags: [agentic-web, web-bot-auth, ai-crawl-control, pay-per-use, x402, webmcp, content-economy]
---

![Agentic Web의 봇 신원과 콘텐츠 경제](https://picsum.photos/seed/agentic-web-bot-identity-content-economy/1600/900)

Agentic Web에서는 자동화 트래픽을 검색 봇과 악성 봇으로 나누던 이분법이 무너진다. 검색 인덱스를 만드는 수집, 모델을 개선하는 학습, 사용자의 현재 과업을 대신하는 방문은 가치와 요구 권리가 다르다. 출발점은 “AI 봇인가”가 아니라 **누가, 어떤 목적으로, 어느 자원을, 어떤 조건에서 사용했는가**를 요청 단위로 설명하는 것이다.

Cloudflare는 2026년 9월 30일 자사 네트워크에서 AI 에이전트의 일일 요청이 1년 동안 1,700% 넘게 증가했고 비인간 트래픽이 절반을 넘었다고 밝혔다.[1] 이는 Cloudflare의 네트워크와 분류 체계에서 나온 공급자 측 관측치이지 인터넷 전체 통계는 아니다. 다만 자동 요청을 별도 정책과 손익을 가진 방문자 집단으로 다뤄야 한다는 신호는 분명하다.

## 목적이 다른 세 종류의 자동 요청

Cloudflare가 사이트 소유자에게 제시한 AI use case는 Search, Agent, Training이다.[2] Search는 향후 질의를 위해 콘텐츠를 색인하고, Agent는 사용자의 현재 과업을 대신해 실시간으로 방문하며, Training은 모델 학습이나 미세 조정에 콘텐츠를 쓴다.[2] 이는 전체 BotBase의 배타적 분류가 아니다. Transact, Data Collection 등 다른 범주가 있고 한 봇에 여러 행동이 붙을 수 있다.[2]

세 범주는 경제적 계약도 다르다. Search에는 발견과 유입, Agent에는 예약·비교·구매 같은 현재 수요, Training에는 장기 모델 자산 형성이 연결된다. 모두 허용하거나 차단하면 검색 노출을 위해 학습까지 허용하거나, 학습을 막다가 잠재 고객인 에이전트까지 잃는다.

같은 공개 기사도 Search에는 무료 색인을, Agent에는 실시간 읽기를, Training에는 별도 라이선스를 요구할 수 있다. URL별 allowlist보다 `identity × purpose × resource × contract`로 결정하고, 복수 목적에는 각 목적에 허용된 권한의 교집합을 적용하는 편이 안전하다.

분류 라벨만 믿을 수도 없다. 운영자가 밝힌 목적과 실제 사용이 다를 수 있으므로 검증된 신원, 선언된 분류, URL·콘텐츠 유형, 요청 패턴, 계약 상태를 함께 평가해야 한다. 세 가지 제어는 모든 Cloudflare 요금제에서 제공되지만, Cloudflare가 식별한 행동에 대한 관리형 제어이지 모든 자동화의 실제 목적을 증명하는 범용 표준은 아니다.[1][2]

## 암호학적 신원과 권한을 분리하기

User-Agent는 복사할 수 있고 IP 범위는 바뀌거나 공유된다.[3] Web Bot Auth는 RFC 9421 HTTP Message Signatures를 바탕으로 요청과 공개 키를 연결한다.[3]

2026년 10월 5일 기준 `draft-ietf-webbotauth-httpsig-protocol-00`은 Working Group이 채택한 active Internet-Draft로 `Signature-Agent`, JWKS 디렉터리, 서명·검증 절차를 정의한다.[9] `draft-meunier-webbotauth-registry-03`은 Signature Agent Card와 registry를 제안하는 별도의 active 개인 초안이다.[10] 둘 다 RFC가 아니며 registry 초안도 핵심 요청 서명의 확정된 필수 요소가 아니다.

Cloudflare 구현 범위 역시 IETF 작업 전체와 다르다. Verified Bots 등록에서는 봇 운영자가 Ed25519 키 쌍을 생성하고 공개 키가 든 서명된 JWKS를 `/.well-known/http-message-signatures-directory`에 호스팅한 뒤 그 디렉터리 URL을 제출한다. Cloudflare는 디렉터리에서 유효한 Ed25519 공개 키를 수용하며, `Signature-Agent`, `Signature-Input`, `Signature`를 edge에서 검증한다.[3] 현재 verifier는 이전 초안의 `Signature-Agent` structured string을 요구해 최신 dictionary 형식을 거부하고, RFC 9421의 일부 component·parameter도 지원하지 않는다.[3] 따라서 지원 여부를 최신 초안 전체 호환이나 범용 origin 서명 검증으로 해석하면 안 된다.

`@query-params`와 `sf`, `bs`, `key`, `req`, `name` parameter를 넣으면 현재 검증은 실패한다.[3] 초안과 edge 구현의 차이를 테스트하고 키 회전·만료·디렉터리 조회 실패를 정상적인 거부 경로로 다뤄야 한다.

서명이 증명하는 것은 특정 운영자 키가 요청에 서명했다는 사실이다. 정책 준수, 목적 제한, 최종 사용자의 적법한 위임까지 보증하지는 않는다. 운영자는 다음 순서로 신원과 권한을 연결할 수 있다.

1. 서명으로 운영자 신원을 확인한다.
2. Search·Agent·Training 분류와 복수 목적 여부를 조회한다.
3. URL, 콘텐츠 등급, 로그인·계약 상태를 결합한다.
4. 무료 허용, 차단, 라이선스, 요청별 결제 중 하나를 결정한다.
5. 결정 ID, 정책 버전, 가격과 계량 키를 기록한다.

Web Bot Auth는 신원을, 행동 분류는 정책을 다룬다. credential은 행위 권한과 감사 증거를 대신하지 않는다.

## 전달 형식도 정책이다

Markdown for Agents를 활성화한 zone에서 클라이언트가 `Accept: text/markdown`을 보내면 Cloudflare가 HTML을 Markdown으로 변환하고 예상 토큰 수를 `x-markdown-tokens`로 전달한다. 2026년 10월 기준 Pro·Business·Enterprise 및 SSL for SaaS 고객 대상 Beta다.[6]

`Content-Type`, 토큰 추정치, Content Signals, 신원과 URL을 묶으면 응답 비용을 계량할 수 있다. 다만 Content Signals의 `ai-train`, `search`, `ai-input`은 측정치나 차단 장치가 아니라 게시자의 사용 선호다. 모든 운영자의 준수도 보장하지 않는다.[11] 실제 형식·바이트·토큰과 응답에 적용된 정책 버전을 분리해 기록해야 한다.

이 구분이 없으면 `ai-train=no`를 실제 차단 건수로 잘못 집계하거나, 토큰 추정치를 다운스트림 사용량으로 오인한다. 전자는 선언된 정책이고 후자는 전달량의 근사치일 뿐이다. 인용·전환·학습 사용 같은 결과 지표는 별도 증거와 연결해야 한다.

더 주의할 점은 기본값이다. Origin이 따로 설정하지 않은 변환 응답에는 현재 `Content-Signal: ai-train=yes, search=yes, ai-input=yes`가 붙는다.[6] Cloudflare가 **향후 제공한다고 밝힌 것은 대시보드의 사용자 정의 Content Signals 정책 옵션**이다.[6] 따라서 HTML·robots.txt 정책과 별개로 실제 edge 응답 헤더를 검사하고, 원하는 선호를 표현할 수 없다면 해당 경로의 변환을 보류해야 한다. HTML 대비 80% 토큰 감소도 한 게시물의 사례이지 일반 보장은 아니다.[6]

WebMCP는 페이지가 브라우저 에이전트에 명시적 도구와 입력 스키마를 노출하게 한다. Cloudflare 기능은 developer preview이고 WebMCP도 Chrome 146의 실험적 표준이다.[7] 기존 사용자 세션으로 실행될 수 있으므로 도구 노출을 호출 권한으로 보지 말고, 상태 변경에는 재인증·사용자 승인·멱등성·결과 확인을 둬야 한다.[7]

## Pay Per Use와 요청 시점 결제

콘텐츠 가치는 요청 횟수와 일치하지 않는다. Pay Per Use에서는 구매자가 유료 사용의 정의와 가격을 제안하고 게시자가 참여를 선택하며, 구매자가 사용 시각·URL·event ID를 보고한다. Cloudflare가 이를 게시자 참여 정보와 대조해 청구와 지급을 처리한다. 2026년 9월 30일 기준 beta이며 사용량은 구매자가 스스로 보고한다.[4]

인용, 검색 결과 포함, 추천 입력, 요약은 가치가 다르므로 총횟수만으로 비교하기 어렵다. `buyer_id`, `program_id`, `use_type`, `source_url`, `used_at`, `event_id`, 가격 버전, 정정·취소를 보존하고 중복 event와 수집량 대비 보고량을 감사해야 한다. Cloudflare의 대조 절차를 독립적인 완전 계측으로 확대 해석해서도 안 된다.

계약에는 무엇을 한 번의 사용으로 보는지, 같은 원문이 여러 답변에 쓰인 경우를 어떻게 세는지, 지연 보고와 정정을 어느 기간까지 받는지를 명시해야 한다. 그래야 구매자의 자체 보고를 게시자의 접근 로그·referral·샘플 감사와 비교할 수 있다.

API·데이터·MCP tool처럼 요청 자체가 사용인 자원은 Monetization Gateway로 요청 시점에 과금할 수 있다. 정확한 순서는 다음과 같다.[12]

1. 구매자가 `402 Payment Required`의 조건에 맞춰 암호학적 authorization을 서명하고 재요청한다.
2. Gateway가 authorization과 가격 조건을 검증한다.
3. Gateway가 서명된 JWT인 `PAYMENT-CONTEXT`를 origin에 전달한다.
4. Origin이 `PAYMENT-CONTEXT`를 검증한 뒤 유료 응답을 생성한다.
5. Gateway가 결제를 settlement한다.
6. 정산 성공 뒤 origin 응답을 구매자에게 전달한다.

즉 `buyer authorization → Gateway verification → signed PAYMENT-CONTEXT → origin verification·response → settlement → buyer delivery`다. 응답 생성과 구매자 공개를 분리하고 idempotency key를 써야 재시도 시 중복 결제와 미정산 응답 유출을 줄일 수 있다. 2026년 9월 30일 기준 미국 기반 적격 판매자·구매자 대상 closed beta이며 Base의 USDC와 Coinbase x402 Facilitator를 사용한다.[5][12]

두 모델은 대체재가 아니다. Pay Per Use는 수집 이후의 사용을 구매자 보고로 계량하고, Monetization Gateway는 요청 시 결제를 확인한 뒤 자원을 제공한다.

## 페이지뷰 이후의 최소 측정 모델

페이지뷰만 보면 비용은 보여도 가치가 보이지 않고, 결제액만 보면 무료 검색 노출과 후속 전환을 놓친다.

| 층 | 최소 측정값 | 질문 |
|---|---|---|
| 신원 | 검증된 운영자, 서명 결과 | 누가 왔는가 |
| 정책 | 목적, URL 등급, allow/block/pay 결정 | 어떤 조건을 적용했는가 |
| 소비 | 응답 형식, 토큰 추정치, tool 호출·사용 보고 | 무엇을 얼마나 썼는가 |
| 가치 | 인용·전환, 수익·원가, 정산·환불 | 무엇이 돌아왔는가 |

핵심 지표는 검증 요청 비율, 목적별 허용률, 처리 비용, 검색 유입, 에이전트 전환, 유료 사용, 402 결제 성공률과 순수익이다. 변하지 않은 페이지를 다시 가져오는 good bot crawl이 50%를 넘는다는 Cloudflare 관측도 있지만, 사이트별 cache hit와 변경 주기를 직접 측정해 재수집 정책을 정해야 한다.[8]

요청·정책·정산 로그는 같은 결정 ID로 이어져야 한다. 그래야 운영자별 트래픽이 origin 비용, 후속 방문, 결제와 환불에 미친 영향을 재구성할 수 있다. 공급자 평균은 사이트의 가격이나 차단 기준을 대신하지 않는다.

## breadlab.ai 최소 정책 제안

다음은 배포 사실이나 Cloudflare 자동 설정이 아니라 이 글을 운영에 옮긴 제안이다.

| 대상 | 최소 정책 | 확인 |
|---|---|---|
| Search | 공개 글 색인·짧은 excerpt·원문 링크 허용, 비공개 경로 제외 | `search=yes`, 유입·재수집률 |
| Agent | 공개 읽기는 허용하되 상태 변경은 인증과 호출 시점 승인 요구 | read/write route 분리 |
| Training | 기본 거부, 별도 라이선스 계약만 예외 | `ai-train=no`, buyer·기간·URL 기록 |
| Markdown | Search와 허용된 read-only Agent에만 제공 | 실제 `Content-Signal`, 토큰 헤더 회귀 검사 |
| 미검증 요청 | category 우대와 유료 자원 접근 금지, 민감·상태 변경 경로 fail-closed | 실패 원인·fallback 기록 |
| 과금 | API·tool·고가 데이터는 Gateway, 수집 뒤 사용은 Pay Per Use | 가격 버전·멱등성·정산 대조 |

핵심은 라벨 하나가 아니라 검증된 운영자, 경로, 행위, 응답 정책과 계약 상태를 같은 결정 ID로 묶는 것이다. 공개 글 전체를 갑자기 닫아 검색 유입을 잃지 않으면서 미검증 요청의 권한은 단계적으로 제한해야 한다.

## 체계 사이의 계약을 소유하기

Cloudflare의 발표는 신원, 정책, 표현 형식, 행위 인터페이스, 계량과 결제를 한 흐름으로 잇는다. 그러나 Beta·closed beta·developer preview는 기능·지역·정산·호환성이 바뀔 수 있다는 뜻이다. Web Bot Auth는 목적을 보증하지 않고 Pay Per Use도 실제 사용을 독립적으로 모두 관측하지 않는다.

사이트는 복수 목적 crawler와 미검증 요청의 처리, 검색과 학습의 경계, 결제 후 환불·분쟁 절차를 정해야 한다. **신원은 요청자를 설명하고, 정책은 허용 범위를 정하며, 계량은 소비를 기록하고, 과금은 합의된 교환을 집행한다.** 네 체계를 같은 결정 ID와 증거로 연결해야 자동화 트래픽과 조건을 협상할 수 있다.

## Sources

[1] https://blog.cloudflare.com/agentic-web — The Internet has a second audience
[2] https://blog.cloudflare.com/content-independence-day-ai-options — Your site, your rules: new AI traffic options for all customers
[3] https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth — Web Bot Auth
[4] https://blog.cloudflare.com/pay-per-use — Pay Per Use: when AI uses your work, you should get paid
[5] https://blog.cloudflare.com/monetization-gateway-beta — Monetization Gateway beta: charge AI agents for consumption with HTTP 402
[6] https://blog.cloudflare.com/markdown-for-agents — Introducing Markdown for Agents
[7] https://blog.cloudflare.com/webmcp — Give any website a WebMCP interface
[8] https://blog.cloudflare.com/making-ai-search-smarter — Making AI search smarter
[9] https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol — HTTP Message Signatures for automated traffic
[10] https://datatracker.ietf.org/doc/draft-meunier-webbotauth-registry — Registry and Signature Agent card for Web bot auth
[11] https://contentsignals.org — Content Signals categories, semantics, and limitations
[12] https://developers.cloudflare.com/monetization-gateway/x402/ — Monetization Gateway x402 payment, origin validation, and settlement flow
