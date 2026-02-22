---
title: '🎰 로또 자동 구매 & 분석기'
subtitle: '매주 까먹지 않고, 데이터로 분석까지'
date: 2026-02-01 00:03:00
description: 동행복권 자동 구매 + 당첨 확인 + 통계 분석을 AI 에이전트가 자동 처리
featured_image: '/images/project-lotto-analyzer/cover.jpg'
---

<div class="project-meta" style="background: linear-gradient(135deg, #b8860b 0%, #2c1810 100%); border-radius: 16px; padding: 32px; margin-bottom: 40px; color: #fff;">
  <div style="display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center;">
    <div>
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">Status</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">🟢 자동 운영 중</div>
    </div>
    <div style="text-align: center;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">누적 당첨금</span>
      <div style="font-size: 1.8em; font-weight: 700; margin-top: 4px;">₩0</div>
    </div>
    <div style="text-align: right;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">누적 투자</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">₩5,000 (1회)</div>
    </div>
  </div>
</div>

## 💡 한 줄 요약

> AI 에이전트가 매주 금요일 로또를 사고, 월요일에 당첨을 확인해준다. 사람은 꿈만 꾸면 된다.

---

## 🎯 왜 자동화했나

- 매주 사이트 가서 로그인 → 번호 선택 → 결제... **귀찮다**
- 까먹고 안 사서 후회한 적 있다
- 당첨 확인도 까먹는다
- **어차피 자동번호인데 AI가 사면 되지 않나?**

---

## ⚙️ 자동화 흐름

```
매주 금요일 19:00                    매주 월요일 09:00
─────────────                       ─────────────
┌──────────────┐                    ┌──────────────┐
│  사이트 접속  │                    │  결과 조회    │
│  (CDP 브라우저)│                   │  (API/크롤링) │
├──────────────┤                    ├──────────────┤
│  팝업 우회    │                    │  당첨 여부    │
│  (자동화 감지)│                    │  확인         │
├──────────────┤                    ├──────────────┤
│  자동 5장 구매│                    │  텔레그램     │
│  (자동번호)   │                    │  결과 알림    │
├──────────────┤                    └──────────────┘
│  텔레그램     │
│  구매 알림    │
└──────────────┘
```

---

## 🧩 기술적 도전

### 안티 자동화 우회

동행복권은 자동화 접속을 감지하고 차단한다. 단순히 CDP 감지만이 아닌 **브라우저 핑거프린팅** 기반이라 까다로웠다.

**해결:**
1. `#popupLayerAlert` DOM 요소 강제 제거
2. `MutationObserver`로 재생성 차단
3. `showRealPage()` 호출로 구매 버튼 활성화

> 이 삽질기만으로도 블로그 포스트 하나 나올 분량 😅

---

## 📅 로드맵

| 단계 | 기간 | 내용 | 상태 |
|------|------|------|------|
| **Phase 0** | 2026.02 | 수동 구매 테스트 | ✅ 완료 |
| **Phase 1** | 2026.02 | 자동 구매 크론 구축 | ✅ 완료 |
| **Phase 2** | 2026.02 | 안티봇 우회 해결 | ✅ 완료 |
| **Phase 3** | 2026.03 | 당첨 통계 대시보드 | ⬜ 대기 |
| **Phase 4** | 2026.04 | 번호 패턴 분석 (재미용) | ⬜ 대기 |
| **Phase 5** | 미정 | 1등 당첨 🎉 | ⬜ ... |

---

## 💰 당첨 기록

| 회차 | 구매일 | 당첨번호 | 결과 | 당첨금 | 메모 |
|------|--------|----------|------|--------|------|
| 1212 | 2026.02.20 | **5, 8, 25, 31, 41, 44** + 보너스 45 | ❌ 낙첨 | ₩0 | 첫 자동 구매. 5장 전부 최대 2개 일치 |

**누적 성적표**

| 항목 | 값 |
|------|-----|
| 총 구매 횟수 | 1회 (5장) |
| 누적 투자금 | ₩5,000 |
| 누적 당첨금 | ₩0 |
| 수익률 | -100% 😂 |
| 최다 번호 일치 | 2개 |

> 매주 자동 업데이트 예정. 1등 나오면 이 페이지 대대적 리뉴얼 🎊
> 
> 현실: 수익률 -100%에서 시작하는 모든 로또 투자자의 숙명...

---

## 📝 관련 포스트

> 로또 자동화 삽질기 포스트 준비 중
