---
title: '🤖 AI 에이전트 운영 실험'
subtitle: '자동 실행보다 검증 가능한 실행'
date: 2026-02-01 00:02:00
description: Hermes Agent 기반 AI 파트너와 콘텐츠, 개발, 운영 작업을 수행하고 검증 가능한 자동화 경계를 만드는 프로젝트
featured_image: '/images/project-ai-agent/cover.jpg'
---

<div class="project-meta" style="background: linear-gradient(135deg, #2d1b69 0%, #11998e 100%); border-radius: 16px; padding: 32px; margin-bottom: 40px; color: #fff;">
  <div style="display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-between; align-items: center;">
    <div>
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #a8e6cf;">Status</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">🟢 운영 중 · 사람 검증</div>
    </div>
    <div style="text-align: center;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #a8e6cf;">운영 원칙</span>
      <div style="font-size: 1.8em; font-weight: 700; margin-top: 4px;">검증 후 반영</div>
    </div>
    <div style="text-align: right;">
      <span style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 2px; color: #a8e6cf;">현재 파트너</span>
      <div style="font-size: 1.4em; font-weight: 700; margin-top: 4px;">Hermes Agent · 코난</div>
    </div>
  </div>
</div>

## 💡 한 줄 요약

> AI 에이전트가 조사, 작성, 개발과 검증을 지원하되 금융 거래와 외부 변경은 사람이 상태를 확인하고 책임진다.

---

## 🎯 현재 운영 경계

| 작업 | 실행 방식 | 2026-08 상태 |
|------|-----------|--------------|
| 📝 기술 블로그 조사·작성 | 요청 기반 + 빌드 검증 | 운영 중 |
| 🔍 최신 기술 주제 탐색 | 날짜 확인 + 복수 소스 조사 | 운영 중 |
| 🌐 브라우저 자동화 | 격리 세션, 필요 시 실행 | 운영 중 |
| 🔄 GitHub 변경 | diff·빌드 확인 후 커밋 | 사람 검증 필수 |
| 📊 트레이딩 계좌 모니터링 | 거래소별 상태 대조 필요 | reconciliation 개선 필요 |
| 💸 금융 거래 | 에이전트 단독 실행 금지 | 사람이 판단·개입 |

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
│              Hermes Agent                │
├──────────┬──────────┬───────────────────┤
│  크론 잡  │  브라우저 │  메시징 (Telegram) │
│  스케줄러 │  제어(CDP)│  양방향 통신       │
├──────────┴──────────┴───────────────────┤
│        모델 + 도구 + 검증 워크플로        │
│      작업별 실행 증거와 승인 경계         │
└─────────────────────────────────────────┘
```

---

## 📅 로드맵

| 단계 | 기간 | 내용 | 상태 |
|------|------|------|------|
| **Phase 0** | 2026.02 | 당시 OpenClaw 설치 + 기본 자동화 | ✅ 완료 |
| **Phase 1** | 2026.02 | 크론 작업 5종 구축 (보안/블로그/로또) | ✅ 완료 |
| **Phase 2** | 2026.02 | 브라우저 자동화 (CDP + 안티봇 우회) | ✅ 완료 |
| **Phase 3** | 2026.02 | 트레이딩봇 연동 (크론 8종, 15분/4시간) | ✅ 완료 |
| **Phase 4** | 2026.02 | 블로그 포스팅 자동화 (PR 워크플로우) | ✅ 완료 |
| **Phase 5** | 2026.03 | 자동화 사례 블로그 시리즈화 | 🔄 진행중 |
| **Phase 6** | 2026.04~ | 컨설팅/서비스 모델 검증 | ⬜ 대기 |

> 초기 자동화는 OpenClaw로 시작했으며, 현재 운영 파트너와 검증 워크플로는 Hermes Agent·코난으로 전환했다.

### 운영하면서 확인한 것

- **트레이딩 자동화**는 양쪽 계좌가 함께 종료되지 않으면 헤지가 독립 위험으로 바뀐다.
- **수동 개입**도 자동 주문과 같은 이벤트로 기록하고 반대 포지션을 재평가해야 한다.
- **블로그 포스팅**은 주제 선정과 작성만으로 끝나지 않고 출처 확인과 Jekyll 빌드가 필요하다.
- **브라우저 자동화**는 로그인 상태와 화면 변화 때문에 실패를 기본값으로 설계해야 한다.
- **서브에이전트 병렬 작업**은 속도를 높이지만 최종 통합 리뷰가 없으면 문체와 사실관계가 흔들린다.
- **블로그 {{ site.posts | size }}편**을 운영하며 자동화보다 검증 가능한 결과물이 중요하다는 점을 확인했다.

---

## 🔧 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Hermes Agent |
| AI 모델 | 작업별 모델/provider 선택 |
| 브라우저 | 격리된 browser-use 세션 |
| 스케줄링 | Hermes Cron |
| 메시징 | Telegram Bot |
| OS | Rocky Linux 9.7 |

---

## 🧪 다음 실험 목록

아직 테스트해볼 만한 자동화 아이디어:

| 아이디어 | 난이도 | 기대 효과 |
|----------|--------|-----------|
| 📧 이메일 자동 분류/요약 | ⭐⭐ | 매일 10분 절감 |
| 📅 캘린더 일정 자동 관리 | ⭐⭐ | 스케줄 충돌 방지 |
| 🐦 SNS 자동 포스팅 (X/LinkedIn) | ⭐⭐⭐ | 블로그 유입 증가 |
| 📰 뉴스 큐레이션 + 텔레그램 브리핑 | ⭐ | 정보 수집 자동화 |
| 🏠 IoT 스마트홈 연동 | ⭐⭐⭐ | 음성 명령 → 에이전트 |
| 📊 GitHub 활동 주간 리포트 | ⭐ | 개발 생산성 추적 |
| 🔍 경쟁사/기술 트렌드 모니터링 | ⭐⭐ | 시장 인사이트 자동 수집 |
| 💬 고객 문의 자동 응대 (챗봇) | ⭐⭐⭐ | 서비스화 첫 단계 |

> 각 아이디어는 실험 → 블로그 포스팅 → 노하우 축적 → 서비스화 파이프라인으로 연결

---

## 📝 관련 포스트

{% assign agent_posts = site.posts | where_exp: "post", "post.tags contains 'ai-agent'" %}
{% for post in agent_posts limit: 8 %}
- [{{ post.title }}]({{ post.url | relative_url }})
{% endfor %}
