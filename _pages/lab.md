---
title: 0 → 1
subtitle: 105만원에서 시작한 수익 실험의 실제 기록
description: '개발자가 코드로 돈을 버는 실험. 자동화가 멈춘 기간, 수동 익절, 미실현 손실까지 숨기지 않고 기록합니다.'
permalink: /lab/
featured_image: /images/2026-02-24-Zero-To-One-Dashboard/cover.jpg
---

<!-- 종합 대시보드 -->
<div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 20px; padding: 36px; margin-bottom: 40px; color: #fff;">
  <div style="text-align: center; margin-bottom: 24px;">
    <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 3px; color: #94a3b8;">Upbit Confirmed KRW Balance</span>
    <div style="font-size: 2.8em; font-weight: 800; margin-top: 8px;">₩1,535,625</div>
    <div style="color: #fbd38d; font-size: 0.82em; margin-top: 2px;">업비트 확인 잔고 · 전체 총자산 아님</div>
    <div style="color: #fc8181; font-size: 1.1em; margin-top: 4px;">Bybit 미실현 -297.01 USDT (-34.63%)</div>
    <div style="color: #94a3b8; font-size: 0.85em; margin-top: 4px;">확인 자산: 업비트 KRW · Bybit 전체 지갑 잔고는 미확인이라 총자산에서 제외</div>
  </div>

  <!-- 목표 금액 프로그레스 -->
  <div style="background: rgba(255,255,255,0.04); border-radius: 16px; padding: 24px; margin-bottom: 8px;">
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;">
      <span style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px;">🎯 목표</span>
      <span style="font-size: 1.4em; font-weight: 700; color: #f6e05e;">₩10,000,000,000</span>
    </div>
    <div style="background: rgba(255,255,255,0.08); border-radius: 99px; height: 28px; overflow: hidden; position: relative;">
      <div style="background: linear-gradient(90deg, #f6e05e, #f6ad55); height: 100%; border-radius: 99px; width: 0.015356%; min-width: 4px; transition: width 1s ease;"></div>
    </div>
    <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.8em; color: #94a3b8;">
      <span>확인 자산 기준 0.0154%</span>
      <span>₩1,535,625 / ₩10,000,000,000</span>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 24px;">
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">트레이딩봇</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">🟠 HOLD</div>
      <div style="color: #f6ad55; font-size: 0.9em;">업비트 수동 익절 · Bybit 숏 보유</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">블로그</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">{{ site.posts | size }}편</div>
      <div style="color: #48bb78; font-size: 0.9em;">✅ 애드센스 승인 완료</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">로또</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">🟡 검증 중</div>
      <div style="color: #94a3b8; font-size: 0.9em;">최근 실행 상태 재확인 필요</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">제휴마케팅</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">🟢 운영</div>
      <div style="color: #48bb78; font-size: 0.9em;">쿠팡파트너스 가입완료</div>
    </div>
  </div>
</div>

<!-- 자산 추이 -->
## 📈 자산 추이

| 날짜 | 총 자산 | 변동 | 비고 |
|------|--------|------|------|
| 2/23 (시작) | 1,050,000원 | - | v3 LIVE 전환 |
| 2/24 | 1,055,000원 | +5,000원 | 헤지 수익 |
| 3/01 | 3,005,000원 | +1,950,000원 입금 | v4 전략 전환 · PAPER 시작 |
| 3/14 | 3,005,000원 | - | v4 LIVE 전환 · 감성역설 방지 적용 |
| 3/20 | ~3,015,000원 | +10,000원 | 숏 익절 +4.47% · 롱 P2 DCA 진행중 |
| 3/22 | ~3,015,000원 | - | ETH 전환 · 라운드 #2 시작 |
| 4/1 | ~3,065,000원 | +50,000원 | 고정 TP 전환 · 숏 익절 +2.2% · Earn 이자 포함 |
| 4/2 | ~3,070,000원 | +5,000원 | 롱 +2.5% 보유 · TP 0.5% 남음 |
| 8/21 | 계좌별 분리 집계 | - | 코인 상승 시 업비트 포지션 수동 익절 · Bybit 숏 대응 누락 |
| 8/22 | 업비트 1,535,625원 | Bybit 미실현 -297.01 USDT | 업비트 전액 KRW · Bybit ETH 숏 유지 |

---

<!-- 프로젝트별 상세 -->
## 🤖 AI 트레이딩봇

v4 "듀얼 익절" 전략은 업비트 롱과 Bybit 숏을 함께 관리하는 구조다.

이번 상승 구간에서는 자동 대응이 일어나지 않아 업비트 포지션만 수동 익절했고, Bybit 숏은 대응 시점을 놓쳐 미실현 손실 상태로 남았다.

**현재 상태:** 업비트 전액 KRW · Bybit ETHUSDT 격리 1배 숏 0.46 ETH 보유 · 자동매매 신규 주문 없이 관찰 중

### 2026-08-22 계좌별 현황

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 20px 0;">
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px;">
    <div style="font-size: 0.85em; color: #64748b;">업비트</div>
    <div style="font-size: 1.7em; font-weight: 700; color: #0f172a; margin: 6px 0;">₩1,535,625</div>
    <div style="color: #475569;">보유 KRW 100% · 주문 가능 1,535,625원</div>
    <div style="color: #15803d; margin-top: 8px;">8월 21일 상승 구간에서 수동 익절</div>
  </div>
  <div style="background: #fff7f7; border: 1px solid #fecaca; border-radius: 14px; padding: 20px;">
    <div style="font-size: 0.85em; color: #64748b;">Bybit ETHUSDT</div>
    <div style="font-size: 1.7em; font-weight: 700; color: #b91c1c; margin: 6px 0;">-297.01 USDT</div>
    <div style="color: #475569;">Short · Isolated 1x · 0.46 ETH</div>
    <div style="color: #475569; margin-top: 8px;">진입 1,862.45 · 마크 2,508.14 · 예상 청산 3,712.64</div>
    <div style="color: #b91c1c; margin-top: 8px;">미실현 수익률 -34.63% · 포지션 유지 중</div>
  </div>
</div>

> **집계 원칙:** Bybit 화면에는 전체 지갑 잔고가 표시되지 않았다. 따라서 두 거래소를 원화로 합산한 총자산이나 확정 손익을 임의로 계산하지 않는다. 위 수치는 2026년 8월 22일 캡처에서 확인한 계좌별 스냅샷이다.
>
> 이 기록은 자동매매 시스템 운영 회고이며 투자 조언이 아니다. 포지션 유지 여부에 대한 권고가 아니라 당시 사용자의 결정을 그대로 기록한다.

### 이번 수동 개입에서 드러난 운영 문제

이번 결과는 단순히 숏 방향을 틀렸다는 문제보다 양쪽 거래소의 포지션 수명주기가 동기화되지 않았다는 점이 더 중요하다. 한쪽을 수동 청산하면 반대쪽 헤지 포지션의 목적과 위험 한도가 즉시 다시 계산되어야 한다. 그러나 업비트 익절 이후 Bybit 숏은 독립 포지션처럼 남았다.

다음 개선 항목은 명확하다.

1. 어느 한쪽이 수동 또는 자동으로 종료되면 반대 계좌에 즉시 경고한다.
2. 거래소별 포지션이 아니라 하나의 전략 라운드로 묶어 상태를 저장한다.
3. 수동 개입도 이벤트로 기록하고 남은 포지션의 손절·유지 기준을 다시 승인받는다.
4. 신규 주문보다 먼저 미체결·잔여 포지션·청산가를 확인하는 reconciliation을 실행한다.
5. Bybit 전체 지갑 잔고를 확인하기 전에는 통합 수익률을 표시하지 않는다.

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin: 20px 0;">

{% assign trading_posts = site.posts | where_exp: "post", "post.tags contains 'trading-bot'" %}
{% for post in trading_posts %}
<a href="{{ post.url | relative_url }}" style="display: block; background: #f8f9fa; border-radius: 12px; padding: 16px; text-decoration: none; color: inherit; border: 1px solid #e2e8f0; transition: all 0.2s;">
  <div style="font-size: 0.8em; color: #94a3b8;">{{ post.date | date: "%Y.%m.%d" }}</div>
  <div style="font-weight: 600; margin-top: 4px; color: #2d3748;">{{ post.title }}</div>
</a>
{% endfor %}

</div>

---

## 🎰 로또 자동구매 & 분석 실험

브라우저 자동구매 워크플로를 구축했지만 최근 성공 여부는 이번 업데이트에서 확인하지 않았다.
실행 전후 구매 결과와 실패 상태를 사람이 확인하는 운영 실험으로 관리한다.

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin: 20px 0;">

{% assign lotto_posts = site.posts | where_exp: "post", "post.tags contains 'lotto'" %}
{% for post in lotto_posts %}
<a href="{{ post.url | relative_url }}" style="display: block; background: #f8f9fa; border-radius: 12px; padding: 16px; text-decoration: none; color: inherit; border: 1px solid #e2e8f0; transition: all 0.2s;">
  <div style="font-size: 0.8em; color: #94a3b8;">{{ post.date | date: "%Y.%m.%d" }}</div>
  <div style="font-weight: 600; margin-top: 4px; color: #2d3748;">{{ post.title }}</div>
</a>
{% endfor %}

</div>

---

## 📝 블로그 수익화

Jekyll + GitHub Pages 블로그로 애드센스 + 제휴마케팅 수익 달성을 목표.

- 총 포스트 수: **{{ site.posts | size }}편**
- ✅ 애드센스 승인 완료 (2026.03)
- ✅ 쿠팡파트너스 가입완료 (2026.03)

---

## 🤖 AI 에이전트 자동화

Hermes Agent 기반 AI 파트너 **코난**이 블로그 포스팅과 운영 기록 정리를 지원한다. 금융 거래는 자동화 결과를 그대로 신뢰하지 않고 사람이 계좌 상태를 확인하고 개입한다.

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin: 20px 0;">

{% assign agent_posts = site.posts | where_exp: "post", "post.tags contains 'ai-agent'" %}
{% for post in agent_posts %}
<a href="{{ post.url | relative_url }}" style="display: block; background: #f8f9fa; border-radius: 12px; padding: 16px; text-decoration: none; color: inherit; border: 1px solid #e2e8f0; transition: all 0.2s;">
  <div style="font-size: 0.8em; color: #94a3b8;">{{ post.date | date: "%Y.%m.%d" }}</div>
  <div style="font-weight: 600; margin-top: 4px; color: #2d3748;">{{ post.title }}</div>
</a>
{% endfor %}

</div>

---

## 💡 원칙

1. **투명하게** — 수익이든 손실이든 있는 그대로 공개
2. **코드로** — 자동화를 지향하되 사람의 검증·개입과 실패도 함께 기록
3. **복리로** — 수익은 재투자, 급하지 않게
4. **기록으로** — 과정 자체가 콘텐츠

---

*이 페이지는 확인 가능한 계좌 자료를 기준으로 업데이트합니다. 최근 업데이트: 2026-08-22*
