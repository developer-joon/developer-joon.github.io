---
title: '🤖 AI 에이전트 자동화 서비스'
subtitle: '잠자는 동안에도 일하는 비서'
date: 2026-02-01 00:02:00
description: OpenClaw 기반 AI 에이전트로 반복 업무를 자동화하고, 노하우를 서비스화하는 프로젝트
featured_image: '/images/project-ai-agent/cover.jpg'
---

<div class="project-meta" style="background: linear-gradient(135deg, #2d1b69 0%, #11998e 100%); border-radius: 16px; padding: 32px; margin-bottom: 40px; color: #fff;">
  <div style="display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center;">
    <div>
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #a8e6cf;">Status</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">🟢 운영 중</div>
    </div>
    <div style="text-align: center;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #a8e6cf;">자동화 작업</span>
      <div style="font-size: 1.8em; font-weight: 700; margin-top: 4px;">5개 크론</div>
    </div>
    <div style="text-align: right;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #a8e6cf;">절감 시간</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">주 3~5시간</div>
    </div>
  </div>
</div>

## 💡 한 줄 요약

> AI 에이전트가 블로그 작성, 보안 점검, 복권 구매까지 자동 처리. 이 경험을 콘텐츠와 서비스로 확장한다.

---

## 🎯 무엇을 자동화하나

| 작업 | 주기 | 절감 시간 |
|------|------|-----------|
| 🔒 서버 보안 점검 | 매일 + 주간 | 30분/주 |
| 📝 AI 뉴스 블로그 발행 | 월 2회 | 3시간/월 |
| 🎰 로또 자동 구매 | 매주 금요일 | 10분/주 |
| 🏆 당첨 결과 확인 | 매주 월요일 | 5분/주 |
| 🌐 브라우저 자동화 | 수시 | 가변 |

---

## 🚀 확장 계획

```
현재 (자체 사용)              향후 (서비스화)
───────────────             ───────────────
내 서버 자동화         ──▶   자동화 컨설팅/구축 대행
블로그 콘텐츠 작성     ──▶   AI 글쓰기 워크플로우 판매
보안 점검 자동화       ──▶   소규모 서버 관리 서비스
```

---

## 🏗️ 현재 시스템 구조

```
┌─────────────────────────────────────────┐
│              OpenClaw Gateway            │
├──────────┬──────────┬───────────────────┤
│  크론 잡  │  브라우저 │  메시징 (Telegram) │
│  스케줄러 │  제어(CDP)│  양방향 통신       │
├──────────┴──────────┴───────────────────┤
│           AI 모델 (Claude)              │
│     Opus (고품질) / Sonnet (효율)        │
└─────────────────────────────────────────┘
```

---

## 📅 로드맵

| 단계 | 기간 | 내용 | 상태 |
|------|------|------|------|
| **Phase 0** | 2026.02 | OpenClaw 설치 + 기본 자동화 | ✅ 완료 |
| **Phase 1** | 2026.02 | 크론 작업 5종 구축 | ✅ 완료 |
| **Phase 2** | 2026.03 | 브라우저 자동화 고도화 | 🔄 진행중 |
| **Phase 3** | 2026.04 | 자동화 사례 블로그 시리즈화 | ⬜ 대기 |
| **Phase 4** | 2026.05~ | 컨설팅/서비스 모델 검증 | ⬜ 대기 |

---

## 🔧 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | OpenClaw |
| AI 모델 | Claude Opus 4.6 / Sonnet 4.5 |
| 브라우저 | Chrome CDP (headful) |
| 스케줄링 | OpenClaw Cron |
| 메시징 | Telegram Bot |
| OS | Rocky Linux 9.7 |

---

## 📝 관련 포스트

- [OpenClaw로 나만의 AI 에이전트 만들기](/blog/OpenClaw-AI-Agent-Setup-Guide)
- [MCP 시리즈 1편: 개념과 원리](/blog/MCP-What-Is-Model-Context-Protocol)
- [MCP 시리즈 2편: 서버 구축](/blog/MCP-Build-Server-Python-TypeScript)
- [MCP 시리즈 3편: 실전 연동](/blog/MCP-Integration-Claude-VSCode-Deploy)
