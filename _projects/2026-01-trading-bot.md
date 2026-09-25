---
title: '📈 뉴스 기반 암호화폐 트레이딩 봇 실험'
subtitle: 'PAPER부터 실전까지 검증하고 운영을 종료한 기록'
date: 2026-02-01 00:00:00
description: 뉴스 감성 분석과 자동매매 전략을 PAPER부터 실전까지 검증한 뒤 운영을 종료·보류하고 포지션을 정리한 프로젝트 기록
featured_image: '/images/project-trading-bot/cover.jpg'
---

<div class="project-meta" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 32px; margin-bottom: 40px; color: #fff;">
  <div style="display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center;">
    <div>
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">Status</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">⏸️ 실전 운영 종료 · 보류</div>
    </div>
    <div style="text-align: center;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">포지션</span>
      <div style="font-size: 1.8em; font-weight: 700; margin-top: 4px;">정리 완료</div>
    </div>
    <div style="text-align: right;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">현재 방향</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">다른 수익모델 연구</div>
    </div>
  </div>
</div>

## 💡 한 줄 요약

> 뉴스 감성 분석과 자동매매 전략을 PAPER부터 실전까지 검증한 뒤 운영을 종료하고 보류한 실험이다.

현재 트레이딩은 중단했으며, 보유 포지션은 모두 정리했다. 최종 손익은 별도로 확정해 공개하지 않는다.

---

## 🎯 문제 정의

암호화폐 시장은 24시간 돌아가지만, 사람은 잠을 잔다. 뉴스 한 줄에 10%가 빠지는 시장에서 감정적 매매는 독이다.

**필요한 것:**
- 🔍 뉴스를 실시간으로 읽고 해석하는 AI
- 🤖 감정 없이 규칙대로 매매하는 봇
- 🛡️ 급락 시 자동으로 자산을 보호하는 방어 체계

---

## 🏗️ 실험 당시 아키텍처

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

## 📅 진행 기록

| 단계 | 진행 내용 | 상태 |
|------|-----------|------|
| **PAPER** | 모의 환경에서 전략과 리스크 관리 검증 | ✅ 완료 |
| **LIVE** | 소액 실전 운영으로 주문·방어 로직 검증 | ✅ 완료 |
| **v4** | 운영 결과를 반영해 전략과 자동화 고도화 | ✅ 완료 |
| **종료** | 자동매매 중단, 포지션 전량 정리 | ⏸️ 종료·보류 |

---

## 💰 정산 안내

실전 운영은 종료했지만 최종 정산값은 공개하지 않았다. 따라서 이 페이지에서는 최종 손익이나 수익률을 추정하지 않는다.

---

## 📝 관련 포스트

- [암호화폐 자동매매 봇 만들기 - 아키텍처 편](/blog/trading-bot-development-guide)
- [암호화폐 트레이딩 실험을 보류하며](/blog/crypto-trading-experiment-on-hold)
