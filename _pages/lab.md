---
title: 0 → 1
subtitle: 수익모델의 진행·종료·연구 상태를 기록하는 실험실
description: '개발자와 AI가 수익모델을 검증하는 실험실. 종료한 트레이딩 실험의 교훈과 블로그 운영, 자동화 기록, 다음 수익모델 연구를 투명하게 공개합니다.'
permalink: /lab/
featured_image: /images/2026-02-24-Zero-To-One-Dashboard/cover.jpg
---

<!-- 상태 대시보드 -->
<div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 20px; padding: 36px; margin-bottom: 40px; color: #fff;">
  <div style="text-align: center; margin-bottom: 24px;">
    <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 3px; color: #94a3b8;">Revenue Experiment Status</span>
    <div style="font-size: 2.2em; font-weight: 800; margin-top: 8px;">현재 수익 실험 상태</div>
    <div style="color: #cbd5e1; font-size: 0.95em; margin-top: 8px;">확정되지 않은 수익 대신 각 실험의 운영 상태와 검증 결과를 공개합니다.</div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 24px;">
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">트레이딩봇</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">종료·보류</div>
      <div style="color: #cbd5e1; font-size: 0.9em;">상태: 자동매매 중단</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">포지션</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">정리 완료</div>
      <div style="color: #cbd5e1; font-size: 0.9em;">상태: 기존 포지션 없음</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">블로그</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">운영</div>
      <div style="color: #68d391; font-size: 0.9em;">상태: {{ site.posts | size }}편 공개</div>
    </div>
    <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; text-align: center;">
      <div style="font-size: 0.8em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">다음 수익모델</div>
      <div style="font-size: 1.6em; font-weight: 700; margin-top: 6px;">연구 중</div>
      <div style="color: #f6e05e; font-size: 0.9em;">상태: 후보 탐색·검증</div>
    </div>
  </div>
</div>

<!-- 과거 공개 스냅샷 -->
## 📌 과거 공개 스냅샷

아래 금액은 당시 페이지에 공개했던 시점별 기록입니다. **현재 자산이나 트레이딩 실험의 최종 정산값이 아닙니다.** 종료 시점의 최종 손익은 확정해 공개하지 않았습니다.

| 날짜 | 공개 스냅샷 | 비고 |
|------|--------------|------|
| 2026-04-02 | 3,070,000원 | 당시 공개된 추정 총액 · 최종 정산 아님 |
| 2026-05-24 | 3,085,757원 | 당시 공개된 총액 스냅샷 · 최종 정산 아님 |
| 2026-09-25 | - | 자동매매 종료·보류 전환 · 기존 포지션 정리 완료 · 최종 손익 미공개 |

---

<!-- 프로젝트별 상세 -->
## 🤖 AI 트레이딩봇

뉴스 감성분석, RSI, DCA, 현물 롱과 선물 숏 헤지를 조합한 자동매매 전략을 운영했으나, 2026년 9월 25일부로 실험을 종료·보류했습니다. 기존 포지션은 모두 정리했으며 최종 손익 숫자는 확정해 공개하지 않습니다.

**현재 상태: 종료·보류 · 포지션 정리 완료**

운영 과정에서 전략 자체보다 데이터 품질, 거래소별 실행 차이, 장애 대응, 손실 한도와 중단 기준이 자동매매의 핵심이라는 교훈을 얻었습니다. 새로운 자금을 투입하기보다 이 기록을 다음 수익모델의 검증 기준으로 활용합니다.

[트레이딩 자동화 실험 종료·보류 기록 보기 →](/blog/crypto-trading-experiment-on-hold)

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

## 🎰 로또 자동화 실험 기록

동행복권 구매 과정에 브라우저 자동화를 적용하며 확인한 제약과 실패 사례를 기록합니다. 현재 수익 발생이나 정기 자동 구매 운영을 의미하지 않습니다.

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

Jekyll + GitHub Pages 블로그를 운영하며 콘텐츠 기반 수익모델을 검증합니다. 애드센스 승인과 제휴 채널 가입은 수익 발생 자체와 구분해 기록합니다.

- {{ site.posts | size }}개 포스트 공개
- 상태: 블로그 운영
- 애드센스 승인 완료 (2026.03) · 실제 수익과 별개
- 쿠팡파트너스 가입 완료 (2026.03) · 제휴 채널 구축 단계

---

## 🤖 AI 에이전트 자동화

AI 에이전트는 콘텐츠 초안, 자료 정리, 반복 작업을 보조합니다. 자동으로 수익을 만들거나 모든 채널을 무인 운영한다는 의미는 아닙니다.

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

## 🔎 다음 수익모델 연구

트레이딩 실험에서 얻은 운영 교훈을 바탕으로, 손실 한도와 중단 기준을 먼저 정하고 결과를 검증할 수 있는 새로운 수익모델을 연구하고 있습니다. 후보가 검증되기 전에는 예상 수익을 현재 수익처럼 공개하지 않습니다.

---

## 💡 원칙

1. **투명하게** — 수익이든 손실이든 있는 그대로 공개
2. **코드로** — 모든 수익 파이프라인은 자동화 기반
3. **복리로** — 수익은 재투자, 급하지 않게
4. **기록으로** — 과정 자체가 콘텐츠

---

*이 페이지는 검증 가능한 변경이 있을 때 수동 검토 후 업데이트합니다. 최근 업데이트: 2026-09-25*
