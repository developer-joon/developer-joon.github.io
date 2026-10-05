# 최근 일주일 뉴스 5편과 100억 목표 그래프 구현 계획

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 최근 7일 공식 뉴스 기반 포스팅 5편을 추가하고 수익실험실의 장기 100억 목표 그래프를 정직한 스냅샷 기준으로 복원한다.

**Architecture:** 뉴스 후보 조사는 기존 글 전체와의 중복 지도부터 만들고 각 원고를 독립 작성·검토한다. 목표 그래프는 현재 상태 대시보드와 분리하고 마지막 공개 스냅샷만 참고 진척도로 사용한다.

**Tech Stack:** Jekyll, Markdown/Kramdown, Liquid, inline CSS, Docker static build, citation ledger

---

### Task 1: 최근 7일 뉴스 source map

- Create: `docs/research/2026-10-05-weekly-news-source-map.md`
- 2026-09-29~2026-10-05 공식 발표만 후보로 수집한다.
- 기존 147편과 현재 10편의 title, description, tags, headings를 비교한다.
- 직접 중복 없는 5개만 확정하고 출처 날짜·상태·주장 범위를 기록한다.

### Task 2~6: 뉴스 원고 5편

- Create: source map에서 확정한 `_posts/2026-10-05-<slug>.md` 5개
- 편당 4,000~7,000자 내외로 작성한다.
- front matter, seeded Picsum, 번호 인용, `## Sources`를 포함한다.
- 공식 사실, 공급자 주장, 운영 해석을 구분한다.
- 각 글을 별도 스펙·품질 검토한다.

### Task 7: 장기 목표 그래프 복원

- Modify: `_pages/lab.md`
- 상태 대시보드 상단에 `장기 목표 ₩10,000,000,000` 카드를 추가한다.
- `목표 유효 · 수익모델 전환 중`을 표시한다.
- 2026-05-24 마지막 공개 스냅샷 `₩3,085,757`과 참고 진척도 `0.03%`를 표시한다.
- 현재 자산·최종 정산이 아니라는 경고를 카드 안에 표시한다.
- 기존 트레이딩 종료·보류와 다음 모델 연구 상태를 보존한다.

### Task 8: 교차 편집과 humanize-korean

- 뉴스 5편의 중복 문단과 결론을 제거한다.
- 보호 구간을 유지한 Codex `$humanize-korean` 보수 편집을 적용하고 의미가 개선된 변경만 채택한다.

### Task 9: 통합 검증

- 인용·링크·날짜·상태·중복·민감정보를 검사한다.
- Docker artifact를 최신 작업 트리에서 다시 만든다.
- 모든 신규 HTML 15편과 `/lab/`에서 제목·본문·Sources·목표 그래프를 확인한다.
- `scripts/verify-site.mjs`, `git diff --check`, `git status --short`를 실행한다.
- 커밋·push·PR·배포를 하지 않는다.
