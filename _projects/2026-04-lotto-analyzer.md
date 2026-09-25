---
title: '🎰 로또 자동 구매 & 분석 실험'
subtitle: '구매와 결과 확인 자동화를 검증한 기록'
date: 2026-02-01 00:03:00
description: 동행복권 구매와 결과 확인 과정에 AI 에이전트와 브라우저 자동화를 적용해 본 구현·검증 기록
featured_image: '/images/project-lotto-analyzer/cover.jpg'
---

<div class="project-meta" style="background: linear-gradient(135deg, #b8860b 0%, #2c1810 100%); border-radius: 16px; padding: 32px; margin-bottom: 40px; color: #fff;">
  <div style="display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center;">
    <div>
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">Status</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">📚 자동화 실험 기록</div>
    </div>
    <div style="text-align: center;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">기록 범위</span>
      <div style="font-size: 1.8em; font-weight: 700; margin-top: 4px;">구현·검증 과정</div>
    </div>
    <div style="text-align: right;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #ffd700;">현재 구매 여부</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">공개하지 않음</div>
    </div>
  </div>
</div>

## 💡 한 줄 요약

> 로또 구매와 당첨 확인 과정을 AI 에이전트로 자동화해 본 구현·검증 기록이다.

이 페이지는 자동화 실험을 정리한 문서이며, 현재 구매나 자동 실행 여부를 나타내지 않는다.

---

## 🎯 왜 자동화했나

- 매주 사이트 가서 로그인 → 번호 선택 → 결제... **귀찮다**
- 까먹고 안 사서 후회한 적 있다
- 당첨 확인도 까먹는다
- **어차피 자동번호인데 AI가 사면 되지 않나?**

---

## ⚙️ 구현했던 자동화 흐름

```
구매 작업                             결과 확인 작업
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

## 📅 실험 진행 기록

| 단계 | 기간 | 내용 | 상태 |
|------|------|------|------|
| **Phase 0** | 2026.02 | 수동 구매 테스트 | ✅ 실험 완료 |
| **Phase 1** | 2026.02 | 자동 구매 흐름 구축 | ✅ 구현 완료 |
| **Phase 2** | 2026.02 | 브라우저 자동화 제약 대응 | ✅ 검증 완료 |
| **후속 아이디어** | — | 당첨 통계·번호 패턴 분석 | ⚪ 미정 |

---

## 🧾 당시 실험 기록

| 회차 | 구매일 | 당첨번호 | 결과 | 당첨금 | 메모 |
|------|--------|----------|------|--------|------|
| 1212 | 2026.02.20 | **5, 8, 25, 31, 41, 44** + 보너스 45 | ❌ 낙첨 | ₩0 | 자동 구매 흐름을 검증한 당시 기록 |

이 기록만으로 현재 구매 여부, 누적 투자금, 누적 당첨금 또는 수익률을 추정하지 않는다.

---

## 📝 관련 포스트

- [AI 에이전트로 로또 자동 구매 자동화하기](/blog/lotto-auto-purchase-ai-agent)
- [로또 자동 구매 1개월 실험 보고서](/blog/lotto-auto-purchase-1month-report)
