---
title: 'Karpathy가 말한 "Claws" — LLM 에이전트 위의 새로운 AI 레이어'
date: 2026-02-21 00:00:00
description: 'Andrej Karpathy가 정의한 Claws 개념을 분석합니다. LLM에서 LLM Agent, 그리고 Claw로 이어지는 AI 스택의 진화와 주요 Claw 프로젝트 비교, 그리고 이 기술이 왜 지금 주목받는지 정리합니다.'
featured_image: '/images/2026-02-21-Karpathy-Claws-AI-New-Layer/cover.jpg'
tags: [ai-news]
---

![Karpathy가 정의한 Claws — AI 스택의 새로운 레이어](/images/2026-02-21-Karpathy-Claws-AI-New-Layer/cover.jpg)

2026년 2월 21일, Andrej Karpathy가 트위터에 올린 글 하나가 AI 커뮤니티를 뜨겁게 달구고 있다. Mac Mini를 사서 **"Claw"**를 돌려보겠다는 이야기였는데, 이 짧은 트윗이 AI 스택의 새로운 레이어를 정의하는 순간이 됐다.

"vibe coding"이라는 용어를 만들어 개발 문화를 바꿨고, "agentic engineering"이라는 개념으로 AI 에이전트 패러다임을 정리한 Karpathy. 그가 이번에 주목한 키워드는 **Claws** 🦞다.

---

## Karpathy는 뭐라고 했나

Karpathy의 원문을 보자:

> *"LLM agents were a new layer on top of LLMs, Claws are now a new layer on top of LLM agents, taking the orchestration, scheduling, context, tool calls and a kind of persistence to a next level."*

그는 Apple Store에서 Mac Mini를 구매하면서 (직원 말로는 "핫케이크처럼 팔리는데 다들 왜 사는지 모르겠다"고 했다고 😄) Claw를 직접 돌려보려는 계획을 밝혔다. 동시에 OpenClaw에 대해서는 "살짝 의심스럽다(sus'd)"고 하면서도, **Claw라는 개념 자체는 AI 스택의 흥미진진한 새 레이어**라고 평가했다.

---

## Claw란 무엇인가? — AI 스택의 진화

![AI 스택의 진화: LLM에서 Claw까지](/images/2026-02-21-Karpathy-Claws-AI-New-Layer/evolution.jpg)

AI 기술은 레이어 단위로 진화해왔다. 각 레이어는 아래 레이어를 기반으로, 이전에 불가능했던 것을 가능하게 만든다.

### LLM → LLM Agent → Claw

| 레이어 | 등장 시기 | 핵심 역할 | 예시 |
|--------|----------|-----------|------|
| **LLM** | 2022~ | 텍스트 생성, 추론 | GPT-4, Claude, Gemini |
| **LLM Agent** | 2023~ | 도구 호출, 단일 작업 수행 | AutoGPT, Claude Code |
| **Claw** | 2025~ | 오케스트레이션, 스케줄링, 영속성 | OpenClaw, NanoClaw |

### Agent와 Claw, 뭐가 다른가?

**LLM Agent**는 사용자가 명령하면 도구를 호출해서 작업을 수행한다. 대화가 끝나면 컨텍스트도 사라진다. "시키면 하는" 단발성 작업자다.

**Claw**는 다르다. Karpathy가 정의한 핵심 특성을 정리하면:

| 특성 | Agent | Claw |
|------|-------|------|
| **오케스트레이션** | 단일 작업 | 복수 작업을 조율 |
| **스케줄링** | 없음 (요청 시 실행) | 크론, 타이머, 이벤트 기반 자동 실행 |
| **컨텍스트 영속성** | 대화 종료 시 소멸 | 파일 기반 메모리로 세션 간 유지 |
| **도구 호출** | API 호출 수준 | 브라우저, 파일시스템, 메시징 통합 |
| **메시징 통합** | 없음 | Telegram, Discord, Signal 등 양방향 |
| **실행 환경** | 클라우드 API | 개인 하드웨어 (로컬 우선) |

한 마디로, Claw는 **"항상 켜져 있는 AI 비서"**다. 잠자는 동안에도 스케줄에 따라 작업하고, 어제 대화한 내용을 기억하며, 필요하면 메신저로 먼저 연락한다.

---

## 주요 Claw 프로젝트 비교

![주요 Claw 프로젝트 비교](/images/2026-02-21-Karpathy-Claws-AI-New-Layer/comparison.jpg)

Karpathy가 언급한 것처럼, 이미 다양한 Claw 프로젝트들이 등장하고 있다. 주요 프로젝트를 비교해보자.

### OpenClaw

가장 먼저 이름을 알린 Claw 프로젝트. Karpathy가 "살짝 의심스럽다"면서도 주목한 이유가 있다.

- **특징**: 풀스택 Claw — 메시징, 브라우저 제어, 크론, 파일 메모리, 서브 에이전트
- **모델 지원**: Claude, GPT, Gemini 등 멀티 프로바이더
- **메시징**: Telegram, Discord, WhatsApp, Signal, Slack 등 다수 지원
- **장점**: 가장 풍부한 기능, 활발한 커뮤니티
- **단점**: 코드베이스가 크고, 보안 감사가 어려울 수 있음

### NanoClaw

Karpathy가 "정말 흥미롭다"고 직접 언급한 프로젝트.

- **특징**: 코어 엔진 ~4,000줄 — 사람 머리에도, AI 에이전트 컨텍스트에도 들어가는 크기
- **철학**: 감사 가능(auditable), 유연(flexible), 관리 가능(manageable)
- **실행 환경**: 모든 것을 컨테이너에서 실행 (보안 격리)
- **장점**: 코드를 전부 읽고 이해할 수 있음, 보안에 유리
- **단점**: 기능이 제한적

### 기타 프로젝트들

Karpathy가 "lol @ prefixes"라고 웃으며 나열한 것처럼, 접두사 경쟁이 한창이다:

| 프로젝트 | 특징 |
|---------|------|
| **nanobot** | 경량, 단일 파일 구성 |
| **zeroclaw** | 제로 설정(zero-config) 지향 |
| **ironclaw** | 보안 중심, 러스트 기반 |
| **picoclaw** | 초경량, 임베디드 대응 |

각각의 프로젝트가 서로 다른 철학과 설계 결정을 가지고 있으며, 아직은 시장이 어떤 방향으로 수렴할지 불분명하다.

### 어떤 Claw를 선택해야 할까?

| 요구사항 | 추천 |
|---------|------|
| 풍부한 기능, 빠른 시작 | OpenClaw |
| 코드를 전부 이해하고 싶다 | NanoClaw |
| 보안이 최우선 | NanoClaw (컨테이너) or ironclaw |
| 가볍게 실험만 | picoclaw, nanobot |

---

## 왜 지금 Claw인가?

### 1. 로컬 AI의 성능이 충분해졌다

Mac Mini 하나로 쓸만한 AI를 돌릴 수 있는 시대가 됐다. Karpathy가 Mac Mini를 산 이유이기도 하다.

공교롭게도 오늘(2월 21일), **GGML(llama.cpp 창시 조직)이 Hugging Face에 합류**한다는 뉴스가 나왔다. GGML은 로컬 AI 추론의 핵심 엔진이다. llama.cpp가 없었다면 개인 컴퓨터에서 LLM을 돌리는 건 아직도 꿈이었을 것이다.

이 합류는 로컬 AI 생태계가 더 빠르게 성숙할 것이라는 신호다. **로컬에서 강력한 LLM을 돌릴 수 있다면, 그 위에 Claw를 올리는 것은 자연스러운 다음 단계**다.

### 2. 개인정보 통제 욕구

클라우드 AI 서비스에 모든 대화를 맡기는 것에 대한 불안감이 커지고 있다. Claw는 **개인 하드웨어에서 돌아가기 때문에**, 데이터가 내 손을 떠나지 않는다.

Karpathy조차 OpenClaw에 대해 "sus'd"하다고 한 이유도 여기에 있다. 자기 컴퓨터에서 돌아가는 소프트웨어인 만큼, **코드를 읽고 신뢰할 수 있어야 한다.** NanoClaw의 4,000줄이 매력적인 이유다.

### 3. AI 에이전트의 한계가 보이기 시작했다

Agent는 "시키면 하는" 수준에 머물러 있다. 하지만 실제로 필요한 건:

- 매일 아침 뉴스를 요약해서 보내주는 AI
- 서버 보안을 주기적으로 점검하는 AI
- 일정을 관리하고 먼저 알림을 보내는 AI

이건 Agent로는 불가능하다. **"항상 켜져 있고, 스스로 스케줄을 관리하며, 맥락을 기억하는"** 시스템이 필요하다. 그게 Claw다.

---

## 전망과 과제

![Claw의 미래와 과제](/images/2026-02-21-Karpathy-Claws-AI-New-Layer/future.jpg)

### 🔒 보안 리스크

Claw는 파일시스템, 브라우저, 메시징에 접근한다. 강력한 만큼 위험하다. Karpathy가 "sus'd"라고 한 건 당연하다. 해결 방향:

- **코드 감사**: 작은 코드베이스일수록 유리 (NanoClaw 접근)
- **컨테이너 격리**: 모든 작업을 샌드박스에서 실행
- **권한 최소화**: 필요한 만큼만 접근 허용
- **오픈소스**: 커뮤니티 감사가 가능한 구조

### 🧩 생태계 파편화

OpenClaw, NanoClaw, zeroclaw, ironclaw, picoclaw... 너무 많다. 초기 시장의 전형적인 양상이다. 결국 2~3개로 수렴하거나, 공통 프로토콜이 등장할 것이다.

**MCP(Model Context Protocol)**가 도구 호출의 표준을 만들었듯이, Claw 레이어에서도 비슷한 표준화가 필요하다. 예를 들면:

- 메모리 포맷의 표준화
- 스케줄링 인터페이스 통일
- 에이전트 간 통신 프로토콜
- 스킬/플러그인 호환성

### 🚀 Claw가 바꿀 것들

단기적으로 Claw는 개발자와 파워 유저의 도구다. 하지만 장기적으로는:

- **개인 비서의 민주화**: 비서를 고용할 수 없는 사람도 AI 비서를 가질 수 있다
- **자동화의 대중화**: 코딩 없이도 반복 작업을 자동화할 수 있다
- **디지털 자아의 확장**: 내 취향, 습관, 업무 방식을 학습한 AI가 대리 작업

---

## Claw 시작하기

Claw에 관심이 생겼다면, 시작하는 방법은 간단하다.

### 빠른 시작 (5단계)

1. **하드웨어 준비** — 개인 서버, Mac Mini, 라즈베리 파이 등
2. **Claw 프로젝트 선택** — 풀스택이면 OpenClaw, 경량이면 NanoClaw
3. **설치** — 대부분 `npm install` 또는 Docker 한 줄로 설치
4. **메시징 연결** — Telegram Bot 등 원하는 메신저 연동
5. **첫 자동화 설정** — 크론 작업으로 주기적 작업 등록

### 참고 자료

더 자세한 설치 가이드는 아래 포스트를 참고:

👉 [OpenClaw로 나만의 AI 에이전트 만들기 — 설치부터 자동화까지 완전 가이드](/blog/openclaw-ai-agent-setup-guide)

---

## 마무리

Karpathy의 한 마디가 AI 업계에 새로운 용어를 정착시키고 있다. **LLM → Agent → Claw**. 이 진화는 단순한 기능 추가가 아니라, AI를 사용하는 방식 자체의 변화다.

Agent가 "시키면 하는 AI"였다면, Claw는 **"알아서 하는 AI"**다. 스케줄링, 메모리 영속성, 메시징 통합이 합쳐져서, 비로소 AI가 진짜 "비서"가 될 수 있게 됐다.

아직 초기 단계인 만큼 보안과 표준화 과제가 남아있지만, 방향은 분명하다. 개인 하드웨어 위에서 돌아가는, 나만의 AI 비서. 그게 Claw의 약속이다.

> *"Claws are an awesome, exciting new layer of the AI stack."* — Andrej Karpathy

🦞

---

## 참고 링크

- [Andrej Karpathy 트윗 원문](https://twitter.com/karpathy/status/2024987174077432126)
- [Simon Willison의 분석](https://simonwillison.net/2026/Feb/21/claws/)
- [GGML이 Hugging Face에 합류](https://github.com/ggml-org/ggml)
- [OpenClaw 공식 사이트](https://openclaw.ai)
- [NanoClaw GitHub](https://github.com/nanoclaw/nanoclaw)
- [MCP(Model Context Protocol) 소개](/blog/mcp-what-is-model-context-protocol)
