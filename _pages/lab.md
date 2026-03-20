---
title: 0 → 1
subtitle: 105만원에서 시작하는 수익 실험
description: '개발자가 코드로 돈을 버는 실험. AI 트레이딩봇, 블로그 수익화, 로또 자동구매까지 — 아이디어에서 수익까지의 여정을 투명하게 기록합니다.'
permalink: /lab/
featured_image: /images/2026-02-24-Zero-To-One-Dashboard/cover.jpg
---

<!-- 종합 대시보드 -->
<div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 20px; padding: 36px; margin-bottom: 40px; color: #fff;">
  <div style="text-align: center; margin-bottom: 24px;">
    <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 3px; color: #94a3b8;">Portfolio Overview</span>
    <div style="font-size: 2.8em; font-weight: 800; margin-top: 8px;">₩3,005,000</div>
    <div style="color: #48bb78; font-size: 1.1em; margin-top: 4px;">▲ +5,000원 (+0.17%)</div>
    <div style="color: #94a3b8; font-size: 0.85em; margin-top: 4px;">시작: ₩1,050,000 (2026.02.23~) · 추가 입금 ₩1,950,000</div>
  </div>

  <!-- 목표 금액 프로그레스 -->
  <div style="background: rgba(255,255,255,0.04); border-radius: 16px; padding: 24px; margin-bottom: 8px;">
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;">
      <span style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px;">🎯 목표</span>
      <span style="font-size: 1.4em; font-weight: 700; color: #f6e05e;">₩10,000,000,000</span>
    </div>
    <div style="background: rgba(255,255,255,0.08); border-radius: 99px; height: 28px; overflow: hidden; position: relative;">
      <div style="background: linear-gradient(90deg, #f6e05e, #f6ad55); height: 100%; border-radius: 99px; width: 0.03%; min-width: 4px; transition: width 1s ease;"></div>
    </div>
    <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.8em; color: #94a3b8;">
      <span>달성률 0.03%</span>
      <span>₩3,005,000 / ₩10,000,000,000</span>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 24px;">
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">트레이딩봇</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">🟢 LIVE</div>
      <div style="color: #48bb78; font-size: 0.9em;">v4 LIVE 운영 중 (3/14~)</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">블로그</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">81편</div>
      <div style="color: #48bb78; font-size: 0.9em;">✅ 애드센스 승인 완료</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">로또</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">🎰 자동</div>
      <div style="color: #94a3b8; font-size: 0.9em;">매주 금 5장 구매</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">제휴마케팅</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">📋 기획</div>
      <div style="color: #94a3b8; font-size: 0.9em;">쿠팡파트너스 예정</div>
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

---

<!-- 프로젝트별 상세 -->
## 🤖 AI 트레이딩봇

v4 "듀얼 익절" 전략 — 업비트 롱 + 바이빗 숏 양방향 동시 진입.  
뉴스 감성분석으로 포지션 동적 조절 + 2단계 DCA 물타기.

**현재 상태:** BTC 단일 코인 · LIVE 운영 시작 · 감성역설 방지 로직 적용

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

## 🎰 로또 자동구매 & 분석

AI 에이전트가 매주 금요일 동행복권에서 로또 5장 자동 구매.  
안티봇 우회, 브라우저 자동화의 실전기.

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

- 81개 포스트 발행 완료
- ✅ 애드센스 승인 완료 (2026.03)
- 쿠팡파트너스 연동 기획 중

---

## 🤖 AI 에이전트 자동화

OpenClaw 기반 AI 비서 **브래드**가 블로그 포스팅, 트레이딩 모니터링, 로또 구매를 24시간 자동 수행.

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
2. **코드로** — 모든 수익 파이프라인은 자동화 기반
3. **복리로** — 수익은 재투자, 급하지 않게
4. **기록으로** — 과정 자체가 콘텐츠

---

*이 페이지는 AI 에이전트 🤖 브래드가 변동사항 발생 시 자동으로 업데이트합니다. 최근 업데이트: 2026-03-21*
