---
title: '장애 조사 SQL을 Git에 남기기: Supabase Explorer Notebook 재실행 워크플로'
date: 2026-10-30 09:00:08 +0900
categories: ["개발/데이터베이스"]
description: 'Supabase Explorer와 Notebook을 이용해 DB·로그 조사 쿼리를 Git에서 리뷰하고, 결과 snapshot과 실행 권한을 분리해 재실행하는 운영 워크플로.'
featured_image: 'https://picsum.photos/seed/news-2026-10-30-supabase-blog-explorer-and-notebooks-investigations-your-team-can-rerun/1600/900'
tags: [supabase, notebook, incident-response, sql, logs, git, observability]
---

![Supabase Explorer Notebook 글의 대표 이미지](https://picsum.photos/seed/news-2026-10-30-supabase-blog-explorer-and-notebooks-investigations-your-team-can-rerun/1600/900)

장애가 끝나면 조사 SQL은 Slack snippet과 `untitled query`로 흩어진다. 다음 배포에서 같은 증상이 와도 누가 어떤 순서로 무엇을 확인했는지 재구성해야 한다. Supabase Explorer는 database와 log query를 한 editor에서 다루고, query·chart·markdown을 Notebook file로 저장해 repository에서 versioning하도록 공개됐다.[1]

Explorer는 feature preview이고 Notebook CLI command는 beta channel에 있다.[1] 따라서 이 글은 production 표준을 이미 확정하는 안내가 아니다. **쿼리를 재실행 가능한 운영 자산으로 만들되, 당시 결과 snapshot과 실행 권한은 별도로 보존하는 설계**다.

## Notebook이 저장하는 것은 답이 아니라 질문이다

Supabase 설명은 Notebook file에 query와 markdown을 저장하고 result는 저장하지 않는다고 명시한다. 나중에 실행하면 현재 data를 다시 조회한다.[1] 이것은 반복 조사에는 장점이지만 incident evidence에는 한계다.

```text
notebook file: 무엇을 어떤 순서로 조회할지
run receipt: 누가 어느 project/branch에서 언제 실행했는지
result artifact: 그 실행이 반환한 row·chart·error
```

세 가지를 분리한다. Git에 Notebook만 commit하고 “당시 오류가 37건이었다”는 근거로 쓰면 안 된다. 숫자를 postmortem에 인용하려면 immutable result export, query hash, execution time, project identity를 함께 보존한다.

## Database SQL과 log query의 dialect를 표시한다

Explorer는 database와 log를 한 editor에서 보여 주지만 source가 같아지는 것은 아니다. Cell마다 source type과 target을 명시한다.

```text
cell_id: api-errors-5m
source: logs
scope: project-ref / branch
window: incident_start..incident_end

cell_id: slow-orders
source: postgres
role: incident_readonly
statement_timeout: 10s
```

Database transaction과 log index는 서로 다른 consistency·retention을 가진다. 같은 timestamp 조건을 썼다고 한 snapshot이 되는 것도 아니다. Correlation ID, request ID, database application name을 공통 key로 삼고 clock skew를 기록한다.

## Repository workflow

공식 CLI reference는 Notebook이 `supabase/notebooks/*.json`에 있고 `supabase notebooks pull`과 `push`로 linked project와 동기화된다고 설명한다.[2] Pull은 기본적으로 없는 local file만 쓰며 특정 notebook ID를 지정하면 local copy를 교체할 수 있다. Push는 한 file 또는 directory의 Notebook을 project에 쓴다.[2]

권장 흐름은 다음과 같다.

1. Dashboard에서 investigation을 만들거나 local file로 시작한다.
2. CLI beta version과 project ref를 기록하고 pull한다.
3. PR에서 SQL, log scope, timeout, 개인정보 노출을 review한다.
4. Merge 뒤 승인된 target에 push한다.
5. 실행마다 별도 receipt와 필요한 result artifact를 남긴다.

Notebook JSON을 사람이 직접 대규모 편집하기 전에 schema 안정성을 확인한다. Preview 기간에는 format이 바뀔 수 있으므로 CLI version을 lock하고 generated diff를 작게 유지한다.

## 제안 fixture: 느린 API와 실패 request

아래는 **이 글에서 실행하지 않은 제안 fixture**다. Disposable Supabase project와 synthetic data에서만 수행한다.

- Cell A: fixture request의 correlation ID별 error log
- Cell B: `pg_stat_statements` 또는 지원된 query statistic에서 대상 query 확인
- Cell C: lock·connection 상태의 bounded query
- Cell D: 배포 version과 schema migration marker
- Markdown: 판단 순서, 종료 조건, owner

실험은 두 deployment에서 같은 Notebook을 실행한다.

1. 의도적으로 느린 query와 5xx request를 만든다.
2. Notebook을 실행하고 run receipt/result를 외부 artifact로 저장한다.
3. Fix를 배포한다.
4. 같은 Notebook을 다시 실행한다.
5. Git의 Notebook bytes는 같고 결과만 달라지는지 확인한다.

Acceptance는 “chart가 예뻐졌다”가 아니다. 같은 cell identity와 query hash가 같은 target에서 실행됐고, error count·latency·plan 변화가 receipt에 연결돼야 한다.

## 안전한 SQL을 기본값으로 만든다

Investigation Notebook은 편리해서 위험하다. Assistant가 SQL을 작성해도 저장 전 승인만 보장할 뿐 query가 production에 안전하다는 보장은 아니다.[1]

다음 gate를 둔다.

- 전용 read-only role과 별도 connection
- `statement_timeout`, `lock_timeout`, row limit
- `EXPLAIN ANALYZE`·DDL·DML의 기본 금지
- 개인정보 column과 raw token 출력 금지
- 넓은 log window와 wildcard query 제한
- Project ref와 branch를 실행 전 다시 표시

Write가 필요한 remediation은 Notebook investigation과 분리하고 change procedure로 승인한다. “Assistant가 제안했다”는 authorization이 아니다.

## PR review가 확인할 것

SQL syntax만 review하면 부족하다.

| 항목 | 질문 |
|---|---|
| 목적 | 이 cell은 어떤 가설을 판별하는가 |
| 범위 | project·branch·time window가 명시됐는가 |
| 비용 | full scan, large sort, log scan 상한이 있는가 |
| 개인정보 | 결과에 email, token, payload가 나오는가 |
| 재현성 | extension·view·role prerequisite가 적혔는가 |
| 판정 | 어떤 결과면 다음 cell로 가는가 |

Cell 순서가 reasoning을 표현하도록 markdown에 “관측→가설→분기”를 쓴다. 단순 query 모음이면 사람마다 다른 결론을 낸다.

## Drift와 삭제를 확인한다

Dashboard에서 수정한 Notebook과 repository copy가 갈라질 수 있다. Scheduled job은 `pull` 결과와 Git HEAD를 비교해 drift를 보고하되 자동 overwrite하지 않는다. Remote에만 있는 Notebook을 일괄 push로 삭제하거나 덮지 않도록 CLI prompt와 `--yes` 사용 정책을 검토한다.[2]

Preview 기능을 production incident의 유일한 조사 경로로 두지 않는다. Explorer 장애, CLI schema 변경, 권한 문제 때 사용할 검토된 SQL file과 기존 log console 경로를 유지한다.

Notebook의 가치는 결과를 영구 저장하는 데 있지 않다. 조사 순서와 query를 code review 가능한 file로 만들고, 다음 사건에서 같은 질문을 다시 던질 수 있게 하는 데 있다. Evidence가 필요하면 결과 artifact를 따로 고정해야 그 장점이 약점으로 바뀌지 않는다.

## Sources

[1] https://supabase.com/blog/explorer-and-notebooks-investigations-your-team-can-rerun
[2] https://supabase.com/docs/reference/cli/supabase-notebooks
