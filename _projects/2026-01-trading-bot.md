---
title: '📈 뉴스 기반 암호화폐 트레이딩 봇'
subtitle: 'AI가 뉴스를 읽고, 봇이 매매한다'
date: 2026-02-01 00:00:00
description: 뉴스 감성 분석 + 그리드 전략 + 리스크 관리를 결합한 자동매매 시스템
featured_image: '/images/project-trading-bot/cover.jpg'
---

<div class="project-meta" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 32px; margin-bottom: 40px; color: #fff;">
  <div style="display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center;">
    <div>
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">Status</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">🟡 설계 완료 · 개발 대기</div>
    </div>
    <div style="text-align: center;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">누적 수익</span>
      <div style="font-size: 1.8em; font-weight: 700; margin-top: 4px;">₩0</div>
    </div>
    <div style="text-align: right;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">투자금</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">₩1,000,000 (예정)</div>
    </div>
  </div>
</div>

## 💡 한 줄 요약

> 뉴스 감성 분석으로 시장 방향을 읽고, 그리드 봇이 자동 매매하며, 방어 정책이 자산을 지킨다.

---

## 🎯 문제 정의

암호화폐 시장은 24시간 돌아가지만, 사람은 잠을 잔다. 뉴스 한 줄에 10%가 빠지는 시장에서 감정적 매매는 독이다.

**필요한 것:**
- 🔍 뉴스를 실시간으로 읽고 해석하는 AI
- 🤖 감정 없이 규칙대로 매매하는 봇
- 🛡️ 급락 시 자동으로 자산을 보호하는 방어 체계

---

## 🏗️ 아키텍처

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  뉴스 수집   │────▶│  감성 분석    │────▶│  매매 시그널  │
│  (RSS/API)  │     │  (LLM 기반)  │     │  (점수화)    │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌──────────────┐     ┌──────▼──────┐
                    │  리스크 관리  │◀───▶│  그리드 봇   │
                    │  (방어 정책)  │     │  (자동매매)  │
                    └──────────────┘     └──────┬──────┘
                                                │
                    ┌──────────────┐     ┌──────▼──────┐
                    │  텔레그램     │◀────│  거래소 API  │
                    │  (알림/리포트)│     │  (Upbit+Bybit)│
                    └──────────────┘     └─────────────┘
```

---

## 🛡️ 방어 정책

시스템의 핵심은 공격이 아니라 **방어**다.

| 트리거 | 조건 | 자동 대응 |
|--------|------|-----------|
| ⚡ 소폭 하락 | -3% | 알림만 발송 |
| ⚠️ 중폭 하락 | -5% | 포지션 50% 자동 축소 |
| 🚨 급락 | -8% | 전량 청산 + 봇 중지 |

---

## 🔧 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | Python 3.11+ |
| 거래소 | Upbit (현물), Bybit (선물/헤지) |
| AI | Claude API (뉴스 감성 분석) |
| 전략 | Grid Trading + DCA |
| 알림 | Telegram Bot |
| 인프라 | Rocky Linux, systemd |

---

## 📅 로드맵

| 단계 | 기간 | 내용 | 상태 |
|------|------|------|------|
| **Phase 0** | 2026.02 | 아키텍처 설계 + 거래소 비교 | ✅ 완료 |
| **Phase 1** | 2026.03 | 거래소 연동 + 뉴스 수집기 | ⬜ 대기 |
| **Phase 2** | 2026.03 | 감성 분석 엔진 + 백테스트 | ⬜ 대기 |
| **Phase 3** | 2026.04 | 테스트넷 1주 운영 | ⬜ 대기 |
| **Phase 4** | 2026.04 | 실전 투입 (소액) | ⬜ 대기 |
| **Phase 5** | 2026.05~ | 스케일업 + 전략 고도화 | ⬜ 대기 |

---

## 💰 수익 리포트

| 월 | 투자금 | 수익 | 수익률 | 메모 |
|----|--------|------|--------|------|
| — | — | — | — | 아직 시작 전 |

> 실전 투입 후 매월 업데이트 예정

---

## 📝 관련 포스트

- [암호화폐 자동매매 봇 만들기 - 아키텍처 편](/blog/crypto-trading-bot-development-guide)

> 개발이 진행되면 시리즈로 포스팅 예정
