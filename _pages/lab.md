---
title: 수익 실험실
subtitle: 코드와 AI 자동화로 0에서 1을 만드는 운영 기록
description: '개발자가 코드로 돈을 버는 실험. AI 트레이딩봇, 블로그 수익화, 로또 자동구매, AI 에이전트 자동화까지 — 아이디어에서 수익까지의 여정을 투명하게 기록합니다.'
permalink: /lab/
featured_image: /images/demo/home.jpg
---

<!-- 종합 대시보드 -->
<div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 20px; padding: 36px; margin-bottom: 40px; color: #fff;">
  <div style="text-align: center; margin-bottom: 24px;">
    <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 3px; color: #94a3b8;">Revenue Lab Overview</span>
    <div style="font-size: 2.8em; font-weight: 800; margin-top: 8px;">₩3,085,757</div>
    <div style="color: #48bb78; font-size: 1.1em; margin-top: 4px;">▲ +85,757원 (+2.86%)</div>
    <div style="color: #94a3b8; font-size: 0.85em; margin-top: 4px;">원금: ₩3,000,000 · 시작 ₩1,050,000 + 추가 입금 ₩1,950,000 · 2026.05.24 기준</div>
  </div>

  <!-- 목표 금액 프로그레스 -->
  <div style="background: rgba(255,255,255,0.04); border-radius: 16px; padding: 24px; margin-bottom: 8px;">
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;">
      <span style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px;">🎯 목표</span>
      <span style="font-size: 1.4em; font-weight: 700; color: #f6e05e;">₩10,000,000,000</span>
    </div>
    <div style="background: rgba(255,255,255,0.08); border-radius: 99px; height: 28px; overflow: hidden; position: relative;">
      <div style="background: linear-gradient(90deg, #f6e05e, #f6ad55); height: 100%; border-radius: 99px; width: 0.0309%; min-width: 4px; transition: width 1s ease;"></div>
    </div>
    <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.8em; color: #94a3b8;">
      <span>달성률 0.0309%</span>
      <span>₩3,085,757 / ₩10,000,000,000</span>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 24px;">
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">트레이딩봇</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">🟡 관찰</div>
      <div style="color: #f6e05e; font-size: 0.9em;">ETH 롱 P2 DCA 5/6 · 숏 미보유</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">블로그</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">{{ site.posts | size }}편</div>
      <div style="color: #48bb78; font-size: 0.9em;">애드센스 승인 · 제휴 실험 중</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">로또</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">🎰 실험</div>
      <div style="color: #94a3b8; font-size: 0.9em;">자동구매 안정화 과제 유지</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">AI 에이전트</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">🟢 운영</div>
      <div style="color: #48bb78; font-size: 0.9em;">블로그·업무 자동화 확대</div>
    </div>
  </div>
</div>

## 📈 자산 추이

| 날짜 | 총 자산 | 변동 | 비고 |
|------|--------|------|------|
| 2/23 (시작) | 1,050,000원 | - | v3 LIVE 전환 |
| 2/24 | 1,055,000원 | +5,000원 | 헤지 수익 |
| 3/01 | 3,005,000원 | +1,950,000원 입금 | v4 전략 전환 · PAPER 시작 |
| 3/14 | 3,005,000원 | - | v4 LIVE 전환 · 감성역설 방지 적용 |
| 3/20 | ~3,015,000원 | +10,000원 | 숏 익절 +4.47% · 롱 P2 DCA 진행 |
| 3/22 | ~3,015,000원 | - | ETH 전환 · 라운드 #2 시작 |
| 4/01 | ~3,065,000원 | +50,000원 | 고정 TP 전환 · 숏 익절 +2.2% · Earn 이자 포함 |
| 4/02 | ~3,070,000원 | +5,000원 | 롱 +2.5% 보유 · TP 0.5% 남음 |
| 5/24 | 3,085,757원 | +15,757원 | ETH 롱 P2 DCA 5/6 · 숏 미보유 · 총 수익 +85,757원 |

---

## 🤖 AI 트레이딩봇

v4는 원래 **업비트 현물 롱 + 바이빗 1x 숏**을 함께 운용하는 듀얼 구조다. 다만 2026년 5월 24일 기준 현재 라운드는 **업비트 ETH 롱만 보유**하고 있고, 바이비트 숏은 비어 있다.

**현재 상태:** ETH 롱 P2 DCA 5/6 · 롱 평단 3,263,624원 · 현재가 3,179,000원 · 고정 TP 3,312,579원

- 총자산: 3,085,757원
- 원금 대비 수익: +85,757원 (+2.86%)
- 롱 평가손익: -2.59%
- 평단 회복까지 필요한 상승: 약 +2.66%
- 고정 TP까지 필요한 상승: 약 +4.20%
- 핵심 리스크: 숏이 비어 있어 듀얼 헤지 방어력이 약한 상태

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

AI 에이전트가 동행복권 자동구매를 시도하는 실험이다. 최근 공개 리포트 기준으로는 자동화 안정성이 아직 핵심 과제다. 안티봇 우회, 크롬 실행 상태, 예치금 감지, 사이트 변경 대응처럼 외부 사이트 자동화의 실패 모드를 계속 기록하고 있다.

**최근 공개 상태:** 1개월 리포트 기준 실제 구매 2회 · 투자금 10,000원 · 수익금 0원

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

Jekyll + GitHub Pages 블로그를 수익 파이프라인으로 운영하는 실험이다. 단순히 글 수를 늘리는 것이 아니라, AI/개발/자동화/운영기 클러스터를 쌓아 검색 유입과 제휴 전환 가능성을 함께 테스트한다.

- {{ site.posts | size }}개 포스트 발행
- ✅ 애드센스 승인 완료
- ✅ 쿠팡파트너스 가입 완료
- 최근 방향: AI 에이전트 운영기, Jira/Claude Code 워크플로우, 트레이딩봇 실전 리포트 강화

---

## 🤖 AI 에이전트 자동화

AI 에이전트는 블로그 포스팅, 트레이딩 리포트 정리, 개발 업무 기록, 반복 운영 작업을 보조한다. 최근에는 Jira Issue를 에이전트 업무 인터페이스로 쓰는 방식과 Claude Code 연동 흐름을 집중적으로 기록하고 있다.

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin: 20px 0;">

{% assign agent_posts = site.posts | where_exp: "post", "post.tags contains 'ai-agent'" %}
{% for post in agent_posts limit: 12 %}
<a href="{{ post.url | relative_url }}" style="display: block; background: #f8f9fa; border-radius: 12px; padding: 16px; text-decoration: none; color: inherit; border: 1px solid #e2e8f0; transition: all 0.2s;">
  <div style="font-size: 0.8em; color: #94a3b8;">{{ post.date | date: "%Y.%m.%d" }}</div>
  <div style="font-weight: 600; margin-top: 4px; color: #2d3748;">{{ post.title }}</div>
</a>
{% endfor %}

</div>

---

## 💡 운영 원칙

1. **투명하게** — 수익이든 손실이든 숫자를 숨기지 않는다.
2. **코드로** — 수익 파이프라인은 가능한 한 자동화한다.
3. **작게 검증** — 큰돈을 넣기 전에 작은 실험으로 실패 모드를 찾는다.
4. **복리로** — 수익은 재투자하되, 무리한 레버리지는 피한다.
5. **기록으로** — 과정 자체가 콘텐츠이자 다음 개선의 근거다.

---

*이 페이지는 수익 실험의 공개 대시보드입니다. 최근 업데이트: 2026-05-24*
