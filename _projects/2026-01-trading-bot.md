---
title: '📈 암호화폐 트레이딩 자동화 실험'
subtitle: '자동화가 멈춘 순간과 수동 개입까지 기록한다'
date: 2026-02-01 00:00:00
description: 업비트 현물과 Bybit 선물을 함께 운용하며 자동화, 수동 개입, 포지션 동기화 실패를 검증하는 트레이딩 실험
featured_image: '/images/project-trading-bot/cover.jpg'
---

<div class="project-meta" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 32px; margin-bottom: 40px; color: #fff;">
  <div style="display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center;">
    <div>
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">Status</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">🟠 수동 개입 · 숏 HOLD</div>
    </div>
    <div style="text-align: center;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">Bybit 미실현</span>
      <div style="font-size: 1.8em; font-weight: 700; margin-top: 4px; color: #fc8181;">-297.01 USDT</div>
    </div>
    <div style="text-align: right;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">업비트 확인 자산</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">₩1,535,625</div>
    </div>
  </div>
</div>

## 💡 한 줄 요약

> 자동매매 전략뿐 아니라 수동 청산과 남은 헤지 포지션까지 하나의 수명주기로 관리할 수 있는지 검증한다.

## 2026-08-22 현재 스냅샷

| 계좌 | 상태 | 확인된 값 |
|------|------|-----------|
| 업비트 | 8월 21일 상승 구간 수동 익절, 전액 KRW | 1,535,625원 |
| Bybit | ETHUSDT Short, Isolated 1x, 0.46 ETH | 진입 1,862.45 · 마크 2,508.14 |
| Bybit 손익 | 포지션 유지 중 | -297.01 USDT (-34.63%) |
| Bybit 위험 | 예상 청산가 | 3,712.64 USDT |

Bybit 전체 지갑 잔고가 확인되지 않았기 때문에 두 계좌를 합친 총자산과 누적 수익률은 표시하지 않는다. 이번 상태의 핵심은 업비트 수동 익절 자체가 아니라, 반대쪽 Bybit 숏을 같은 전략 라운드에서 즉시 재평가하지 못했다는 점이다.

---

## 🎯 문제 정의

암호화폐 시장은 24시간 돌아가지만, 자동화도 항상 정상 작동하지는 않는다. 특히 현물 롱과 선물 숏을 서로 다른 거래소에 보유하면 한쪽의 수동 청산이 다른 쪽을 즉시 위험 포지션으로 바꿀 수 있다.

**필요한 것:**
- 🔍 두 거래소의 잔고·주문·포지션을 주기적으로 대조하는 reconciliation
- 🤖 양쪽 포지션을 하나의 전략 라운드로 묶는 상태 관리
- 🛡️ 자동 주문과 수동 개입을 모두 기록하고 남은 포지션을 재평가하는 방어 체계

---

## 🏗️ 아키텍처

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  뉴스 수집   │────▶│  감성 분석    │────▶│  비중 정책    │
│  (RSS/API)  │     │  (보조 신호)  │     │  (롱/숏)     │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌──────────────┐     ┌──────▼──────┐
                    │  라운드 상태  │◀───▶│  2단계 DCA   │
                    │ (양쪽 수명주기)│     │  + 고정 TP   │
                    └──────┬───────┘     └──────┬──────┘
                           │                    │
                    ┌──────▼───────┐     ┌──────▼──────┐
                    │ 알림·승인·감사 │◀────│ 거래소 API   │
                    │ (수동 개입 포함)│     │ Upbit+Bybit │
                    └──────────────┘     └─────────────┘
```

---

## 🛡️ 현재 필요한 방어 정책

시스템의 핵심은 가격 예측이 아니라 **상태 불일치를 빨리 발견하는 것**이다.

| 트리거 | 확인할 상태 | 대응 |
|--------|-------------|------|
| 한쪽 포지션 종료 | 반대 계좌에 잔여 포지션이 있는가 | 신규 주문 중지 + 즉시 경고 |
| 수동 주문 감지 | 자동화가 알고 있는 라운드와 실제 계좌가 같은가 | reconciliation 실행 |
| 평가손실 확대 | 진입가·마크가·청산가·증거금 여유 | 유지/축소/종료를 사람에게 승인 요청 |
| 데이터 누락 | 지갑 잔고나 주문 조회 실패 | 통합 수익률 숨김 + 상태를 미확인으로 표시 |

---

## 🔧 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | Python 3.11+ |
| 거래소 | Upbit (현물), Bybit (선물/헤지) |
| AI | Claude API (뉴스 감성 분석) |
| 전략 | 업비트 현물 롱 + Bybit 격리 1x 숏, 2단계 DCA + 고정 TP |
| 알림 | Telegram Bot |
| 인프라 | Rocky Linux, systemd |

---

## 📅 로드맵

| 단계 | 기간 | 내용 | 상태 |
|------|------|------|------|
| **Phase 0** | 2026.02 | 아키텍처 설계 + 거래소 비교 | ✅ 완료 |
| **Phase 1** | 2026.03 | 거래소 연동 + 뉴스 수집기 | ✅ 완료 |
| **Phase 2** | 2026.03 | 감성 분석 엔진 + 백테스트 | ✅ 완료 |
| **Phase 3** | 2026.03 | PAPER 운영 | ✅ 완료 |
| **Phase 4** | 2026.03~ | 실전 소액 운영 | ✅ 진행 |
| **Phase 5** | 2026.08~ | 수동 개입 감지 + 계좌 reconciliation | 🔄 개선 필요 |

---

## 💰 수익 리포트

| 기준일 | 업비트 확인 잔고 | Bybit 미실현 손익 | 통합 수익률 | 메모 |
|--------|-------------------|---------------------|-------------|------|
| 2026-08-22 | 1,535,625원 | -297.01 USDT (-34.63%) | 산출 안 함 | 업비트 익절, Bybit 숏 보유 |

> 통화가 다르고 Bybit 전체 지갑 잔고가 확인되지 않아 통합 수익률을 임의 계산하지 않는다.

---

## 📝 관련 포스트

{% assign trading_posts = site.posts | where_exp: "post", "post.tags contains 'trading-bot'" %}
{% for post in trading_posts limit: 6 %}
- [{{ post.title }}]({{ post.url | relative_url }})
{% endfor %}

- [수익 실험실 최신 계좌 현황](/lab/)
