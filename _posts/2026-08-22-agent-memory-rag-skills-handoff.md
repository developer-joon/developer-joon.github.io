---
title: '에이전트 메모리 전쟁: RAG·Skills·작업 기록을 하나로 합칠 수 있을까'
date: 2026-08-22 08:00:00 +0900
categories: ["AI 에이전트"]
description: '코딩 에이전트의 단기 컨텍스트·장기 기억·RAG·Skills·실행 로그를 구분하고, 여러 에이전트 사이의 handoff와 provenance·만료·삭제·보안을 운영 관점에서 설계한다.'
featured_image: 'https://picsum.photos/seed/agent-memory-rag-skills-handoff/1600/900'
tags: [ai-agent, memory, rag, agent-skills, handoff, provenance, coding-agent]
---

![에이전트 메모리와 handoff](https://picsum.photos/seed/agent-memory-rag-skills-handoff/1600/900)

코딩 에이전트를 하루 이상 사용하면 모델의 코딩 능력보다 먼저 부딪히는 문제가 있다. 어제 합의한 설계를 오늘 다시 설명해야 하고, 이미 실패한 접근을 다른 에이전트가 반복하며, 한 세션에서 발견한 운영 규칙이 다음 세션으로 넘어가지 않는다. Claude Code에서 시작한 작업을 Codex로 이어받거나, 로컬 에이전트가 조사한 내용을 원격 에이전트가 구현하도록 넘기면 이 단절은 더 선명해진다.

그래서 시장은 모든 것을 “메모리”라는 이름으로 묶기 시작했다. 대화창의 이전 메시지도 메모리, 벡터 검색 결과도 메모리, 저장소의 `AGENTS.md`도 메모리, 반복 작업을 담은 Skill도 메모리, 터미널 로그도 메모리라고 부른다. 그러나 운영 관점에서 이들을 하나로 취급하면 품질보다 오염이 빠르게 커진다. 모델에게 지금 필요한 정보, 나중에 재사용할 지식, 검색 가능한 원문, 실행 가능한 절차, 감사용 증거는 수명과 신뢰도가 서로 다르기 때문이다.

OpenViking은 memories, resources, skills를 `viking://` 가상 파일시스템 아래에 배치하는 “context database”를 제안한다. `ls`, `tree`, `find`처럼 탐색하고 L0 요약, L1 개요, L2 원문을 필요에 따라 불러오며, 검색 경로를 남긴다는 설명이다. ai-memory는 코딩 에이전트의 lifecycle observation을 정리해 Git으로 버전 관리되는 Markdown wiki와 제한된 handoff로 만들고, 여러 에이전트 사이의 작업 연속성을 목표로 한다. 두 프로젝트는 접근 방식이 다르지만 공통된 질문을 던진다. **에이전트가 읽는 모든 컨텍스트를 한 운영 체계에서 관리할 수 있는가?**

먼저 경계를 분명히 해야 한다. 이 글에서 언급하는 기능과 수치는 각 프로젝트의 공식 저장소가 설명하는 제품 주장이다. OpenViking의 계층형 로딩, 검색 trajectory, benchmark 결과와 ai-memory의 지원 클라이언트, capture·handoff·만료 동작을 독립적으로 재현한 결과가 아니다. 설계 아이디어는 참고할 가치가 있지만, 도입 판단에는 팀 데이터로 별도 검증이 필요하다.

## 문제 정의: 잊지 않는 에이전트가 아니라 안전하게 이어받는 에이전트

코딩 업무의 연속성은 전체 대화 복사로 해결되지 않는다. 긴 transcript에는 결정뿐 아니라 추측, 취소된 지시, 비밀이 포함된 tool output, 중복된 오류와 모델의 잘못된 설명이 섞여 있다. 다음 에이전트에게 전부 넘기면 token 비용이 늘고 핵심이 묻히며, 오래된 지시가 현재 source code보다 높은 권위를 가진 것처럼 작동할 수 있다.

필요한 것은 “많이 기억하기”가 아니라 다음 네 질문에 답하는 handoff다.

1. 현재 작업의 목표와 범위는 무엇인가?
2. 어떤 결정이 내려졌고, 그 근거와 확인 시점은 언제인가?
3. 무엇을 시도했고 어떤 관찰 때문에 실패로 판단했는가?
4. 다음 에이전트가 가장 먼저 확인하고 실행할 일은 무엇인가?

이 네 질문은 개인화 메모리의 UX 문제와 다르다. 사용자의 말투나 취향을 저장하는 것이 아니라, 변화하는 코드와 도구를 여러 실행 주체가 안전하게 넘겨받도록 만드는 운영 문제다. 진실의 기준은 기억 저장소 자체가 아니라 현재 checkout, build, test, 배포 상태와 관찰된 runtime이다. 메모리는 탐색을 줄이는 증거와 방향표이지, 코드 위에 군림하는 명령 저장소가 아니다.

## “메모리”로 불리는 다섯 층을 분리하라

### 1. 단기 컨텍스트: 지금 추론하기 위한 작업대

단기 컨텍스트는 현재 prompt, 최근 대화, 열어 본 코드 조각, 직전 tool result와 system instruction이다. 가장 즉각적이고 풍부하지만 세션 종료나 context compaction과 함께 사라질 수 있다. 여기에는 현재 수정 중인 함수, 방금 실패한 테스트와 사용자 승인처럼 다음 몇 분 동안 중요한 정보가 들어간다.

단기 컨텍스트의 장점은 최신성과 세밀함이다. 단점은 비용과 휘발성이다. 모든 로그를 계속 붙이면 attention이 분산되고, 잘못된 초반 가정이 뒤의 관찰보다 오래 살아남는다. 따라서 세션 중에도 “현재 목표, 확정 사실, 미확정 가설, 다음 단계”를 주기적으로 분리해야 한다. compaction은 단순 축약이 아니라 상태 전이여야 한다.

### 2. 장기 기억: 반복해서 쓸 수 있는 결정과 교훈

장기 기억은 세션이 끝난 뒤에도 남아 다른 작업에서 검색되는 지식이다. 예를 들어 “이 서비스는 요청 ID를 gateway에서 생성한다”, “이 migration은 lock 때문에 production에서 중단됐다”, “release 전 특정 계약 테스트를 실행한다” 같은 내용이다. 오래 유지할 가치가 있지만, 생성 당시의 branch·commit·환경과 분리되면 위험해진다.

좋은 장기 기억은 문장만 저장하지 않는다. scope, 생성자, 원본 관찰, 확인 시점, 관련 commit, 신뢰 상태, 만료 조건과 대체된 기억을 함께 갖는다. “Postgres를 쓴다”보다 “ADR-0007에서 주문 원장에 Postgres를 선택했고 commit `abc…` 이후 유효하며 현재 production config에서 재확인이 필요하다”가 안전하다.

### 3. RAG: 기억이 아니라 후보를 찾는 검색 계층

RAG는 문서, 코드, issue, wiki와 과거 세션을 chunk로 나누고 query와 가까운 후보를 찾아 모델 입력에 넣는 방식이다. 벡터 검색은 표현이 다른 유사 내용을 찾는 데 유리하지만, 최신성·권위·정확성을 자동으로 보장하지 않는다. “검색됐다”와 “사실이다”는 다른 사건이다.

코딩 에이전트에서는 lexical search, symbol index, graph 관계와 vector search를 함께 쓰는 편이 현실적이다. 함수명과 오류 코드는 exact match가 강하고, 과거 결정의 다른 표현은 embedding이 유리하며, call graph와 dependency는 구조 검색이 낫다. ai-memory도 설명상 FTS5, entity match, graph neighbor와 선택적 vector stream을 결합하고 authority signal을 조정한다. 중요한 점은 높은 rank가 instruction 권한으로 바뀌지 않는다는 원칙이다.

### 4. Skills: 검색할 사실이 아니라 재현할 절차

Skill은 “무엇을 알고 있는가”보다 “어떻게 수행하는가”를 담는다. 장애 조사 순서, release 절차, 문서 포맷, 검증 명령과 실패 시 fallback 같은 반복 가능한 workflow다. Skill을 장기 기억의 자유 형식 문장으로 저장하면 실행 조건과 안전장치가 사라진다. 반대로 모든 과거 사실을 Skill에 넣으면 절차가 프로젝트 상태를 오염시킨다.

Skill에는 trigger, prerequisite, 허용 도구, 단계, 중단 조건, 검증과 rollback이 필요하다. 버전과 maintainer도 있어야 한다. “테스트를 실행하라”가 아니라 “변경 범위가 API schema일 때 `make contract-test`를 실행하고, fixture update는 사용자 승인 없이는 하지 않으며, 성공 기준은 exit code와 생성 diff가 모두 깨끗한 것”처럼 적어야 한다.

### 5. 실행 로그: 결론이 아니라 감사 가능한 원재료

tool call, shell command, file diff, test output와 API response는 실행 로그다. 가장 구체적인 provenance를 제공하지만 양이 많고 비밀과 노이즈가 섞인다. 로그를 통째로 장기 기억에 넣는 것도, 요약 뒤 원문을 모두 버리는 것도 문제다.

운영적으로는 관찰과 해석을 분리해야 한다. “`pytest` exit code 1, `test_auth.py::test_refresh` 실패”는 관찰이고, “refresh token 구현이 깨졌다”는 해석이다. 다음 에이전트는 관찰 원문과 당시 commit을 확인할 수 있어야 한다. 요약은 탐색용 index이고, 원본 로그는 보존 정책이 적용된 증거 저장소다.

## 하나로 합친다는 말의 올바른 의미

다섯 층을 하나의 blob이나 vector index에 넣는 것은 통합이 아니다. 올바른 통합은 **공통 주소 체계, 공통 provenance, 공통 lifecycle과 일관된 접근 정책**을 제공하면서 데이터 종류별 의미를 유지하는 것이다.

```text
Agent session
├── Working context        짧은 수명, 높은 상세도
├── Handoff packet         단일 작업 흐름, 제한된 크기
├── Durable memory         결정·교훈, 검토·만료 대상
├── Resources / RAG        원문 후보, 최신성·권위별 rank
├── Skills                 버전 있는 실행 절차
└── Execution evidence     append-only 로그, 민감정보 정제
          ↓
   provenance graph + policy + audit
```

OpenViking의 가상 파일시스템은 이 통합을 사람이 탐색 가능한 namespace로 표현한다. README는 memories, resources와 skills에 URI를 주고, 각 항목을 L0·L1·L2로 가공해 필요한 깊이만 읽는다고 설명한다. directory 자체에도 abstract와 overview를 두는 구조는 “검색 결과 한 조각만 던지는 black box”를 줄이려는 시도다. 검색 trajectory를 보존한다는 주장도 왜 특정 정보가 prompt에 들어왔는지 조사하는 데 유용한 방향이다.

다만 파일처럼 보인다고 데이터의 의미가 같아지는 것은 아니다. Skill 수정은 code review가 필요할 수 있고, session log는 append-only여야 하며, 장기 기억은 supersede와 expiry가 필요하다. 공통 UI 아래에서 서로 다른 write policy를 적용해야 한다. URI는 주소를 통일하지만 신뢰 모델까지 자동으로 통일하지 않는다.

## 여러 코딩 에이전트 사이의 handoff

에이전트 교체에는 두 종류의 연속성이 있다. 첫째는 native session resume다. 같은 제품이 자체 transcript와 hidden state를 다시 읽는 방식으로 fidelity가 높지만 다른 제품으로 이동하기 어렵다. 둘째는 portable handoff다. 제품 중립적인 요약과 증거 링크를 넘겨 Claude Code에서 Codex, Cursor 또는 다른 agent로 이어 가는 방식이다.

ai-memory는 README에서 lifecycle hook의 제한된 관찰을 정제해 wiki와 handoff로 만들고, 선택적인 managed workstream에서는 agent별 native session과 portable visible-event ledger를 함께 사용한다고 설명한다. 또한 클라이언트마다 진짜 session-end hook 지원 여부와 handoff injection 방식이 다르다고 상세히 구분한다. 이 차이는 중요하다. hook이 없으면 “세션이 끝났다”는 사건을 자동으로 확정할 수 없어 수동 finalize가 필요하고, session-start stdout을 무시하는 client는 MCP 호출로 handoff를 받아야 할 수 있다.

실무 handoff packet은 다음처럼 작고 typed해야 한다.

```yaml
workstream: checkout-uuid / task-uuid
from: claude-code session-42
to: any-compatible-agent
base_revision: 7f409fd
objective: 결제 retry 정책 수정
status: implementation_in_progress
confirmed:
  - retry budget은 gateway가 소유함
attempts:
  - exponential backoff 5회: integration test에서 SLA 초과
changed_paths:
  - src/payment/retry.rs
open_questions:
  - timeout을 merchant별로 override할 것인가
next_actions:
  - checkout과 git diff 재확인
  - contract test 실행
provenance:
  - observation://session-42/tool-118
expires_at: 2026-08-29T00:00:00Z
```

핵심은 수신 에이전트가 이 packet을 명령이 아니라 **검증해야 할 이전 작업자의 진술**로 읽는 것이다. `base_revision`이 현재 HEAD와 다르면 코드 관련 기억의 신뢰도를 낮추고, 변경 파일을 다시 읽고, test를 재실행해야 한다. handoff를 받았다는 이유만으로 완료 상태를 계승해서는 안 된다.

동시 세션도 별도 문제다. 같은 저장소에서 두 에이전트가 병렬로 작업하면 “가장 최근 세션”이 내가 이어받을 세션이라는 보장이 없다. project ID만으로 scope를 잡지 말고 workstream ID와 session ID를 분리해야 한다. branch, worktree, issue와 사용자도 연결하되, 로컬 경로만 identity로 쓰지 않는 편이 여러 머신에서 안전하다.

## Provenance가 없는 기억은 캐시보다 위험하다

메모리 항목마다 최소한 다음 계보가 필요하다.

- 누가 만들었는가: 사용자, 특정 agent, 자동 consolidation job
- 무엇에서 파생됐는가: prompt, tool result, file, commit, URL, test run
- 언제 관찰하고 언제 요약했는가
- 어느 workspace·repository·branch·workstream에 속하는가
- 원문이 정제됐는지, 어떤 filter와 model version이 요약했는가
- 사실, 결정, 가설, 실패, 선호, 절차 중 어떤 type인가
- 현재 상태가 active, disputed, superseded, expired 중 무엇인가

Provenance는 citation 장식이 아니다. 검색 rank, 충돌 해결과 삭제 전파에 쓰이는 실행 데이터다. 현재 repository의 ADR과 과거 세션 요약이 충돌하면 authority와 freshness를 이용해 ADR을 우선 보여줄 수 있다. 같은 결정의 새 버전이 생기면 이전 항목을 삭제하지 않고 superseded chain으로 연결해 “왜 바뀌었는지”를 추적할 수 있다.

OpenViking이 설명하는 observable retrieval trajectory도 이 맥락에서 봐야 한다. 어떤 directory를 거쳐 L0에서 L2로 내려갔는지 알면 잘못된 답의 원인이 query, index, summary, path 선택 중 어디에 있는지 조사할 수 있다. 하지만 trajectory가 있다는 것과 원문의 진실성이 검증됐다는 것은 다르다. 외부 문서가 악성이거나 이미 낡았다면 검색 경로를 잘 기록해도 결과는 틀릴 수 있다.

## 기억 오염: 모델의 추측이 조직의 사실이 되는 순간

기억 오염은 단순한 오타보다 넓다. 한 에이전트의 추측이 consolidation 과정에서 확정 사실로 바뀌거나, test fixture의 값이 production 규칙으로 일반화되거나, 악성 repository 문서가 장기 Skill로 승격되는 현상까지 포함한다.

대표적인 오염 경로는 다음과 같다.

1. **자기 강화 루프**: 모델이 만든 요약을 다음 세션이 읽고 같은 내용을 다시 기록해 근거가 많은 것처럼 보인다.
2. **scope 누출**: 고객 A의 규칙이 고객 B 프로젝트나 global preference로 올라간다.
3. **권위 세탁**: raw transcript의 추측이 `decisions/` 경로에 저장되며 승인된 결정처럼 보인다.
4. **시간 오염**: 과거 branch의 실패가 현재 HEAD에도 유효한 gotcha로 남는다.
5. **prompt injection의 영속화**: 검색한 README나 issue의 지시문이 Skill 또는 rule로 저장된다.

대응은 capture 단계부터 시작한다. secret과 제외 경로는 local spool에 들어가기 전에 필터링하고, 외부 텍스트와 model output에는 `untrusted` provenance를 붙인다. durable decision과 Skill 변경은 자동 승인하지 않거나, 최소한 staged proposal과 diff review를 거친다. 같은 결론이 여러 번 등장해도 origin이 동일한 transcript라면 독립 증거로 count하지 않아야 한다.

정기적인 contamination audit도 필요하다. project 간 고유명사 누출, secret pattern, 존재하지 않는 path, 현재 code와 충돌하는 API 이름, 출처 없는 명령형 문장, 비정상적으로 자주 recall되는 페이지를 검사한다. 검색 hit가 많다는 이유로 신뢰도를 올리는 popularity loop를 피해야 한다.

## 만료, 삭제와 “잊기”의 운영

코딩 기억에는 서로 다른 시계가 흐른다. 사용자 coding style은 오래 유지될 수 있지만, incident 상태는 몇 시간, branch 이름은 며칠, release workaround는 특정 version까지만 유효하다. 모든 항목에 같은 TTL을 적용하면 중요한 결정은 사라지고 임시 상태는 너무 오래 남는다.

type별 기본 정책을 두는 것이 현실적이다.

| 종류 | 기본 수명 | 만료 시 동작 |
|---|---:|---|
| handoff | 수일 또는 수락 1회 | 검색 제외 후 짧은 감사 보존 |
| 세션 관찰 | 수주 | 요약에 연결된 증거만 정책에 따라 보존 |
| 실패한 시도 | 관련 code 변경까지 | 재검증 또는 historical 전환 |
| 결정·ADR | 명시적 supersede까지 | chain 유지, 기본 검색에서 구버전 강등 |
| Skill | version lifecycle | 이전 버전 revoke·rollback 가능하게 보존 |
| secret 포함 가능 로그 | 최소 기간 | cryptographic erasure와 backup 전파 |

ai-memory는 README에서 페이지에 `expires_at`을 줄 수 있고, 만료 뒤 기본 검색에서 제외한 다음 forget sweep에서 파일과 row를 삭제한다고 설명한다. 또한 project purge와 Git 기반 page history를 제공한다고 주장한다. 이 구조를 도입할 때는 “검색에서 안 보임”과 “물리적으로 삭제됨”을 구분해야 한다. Git history, backup, embedding index, cache, handoff packet, 로그 export와 replica에 사본이 남을 수 있기 때문이다.

삭제는 provenance graph를 따라 전파돼야 한다. 원본 관찰을 삭제했을 때 파생 요약을 그대로 둘지, 출처만 제거할지, 함께 삭제할지 정책을 정해야 한다. 법적 삭제 요구나 secret 유출이면 derived artifact와 backup key까지 다뤄야 하고, 일반적인 품질 정정이면 tombstone과 supersession을 남기는 편이 감사에 유리하다. 한 버튼으로 “완전히 잊었다”고 표시하기 전에 실제 저장 층을 열거해야 한다.

## 보안: 메모리는 새로운 control plane이다

에이전트 메모리는 저장소 구조, 고객 이름, 실패한 보안 통제, shell command와 때로는 credential 조각을 모은다. 공격자에게는 source code보다 탐색하기 쉬운 조직 지식 지도다. 여러 agent와 machine이 같은 서버를 쓰면 공격 표면은 capture hook, MCP endpoint, web UI, vector database, wiki Git remote와 backup으로 넓어진다.

최소한 project·workspace·operator 사이의 인증과 권한 분리가 필요하다. ai-memory가 설명하는 per-operator slot은 context injection 격리일 뿐 RBAC가 아니라고 명시한다. 이런 제한을 제품의 “멀티유저 지원” 문구와 혼동하면 안 된다. exact read와 search가 project-wide라면 같은 project 사용자 사이의 기밀 분리는 별도 authorization layer가 필요하다.

네트워크 보안도 중요하다. loopback bind는 외부 host 접근을 줄이지만 같은 장비의 악성 process를 막지 못한다. LAN이나 cloud에 노출하면 bearer token과 TLS, host allowlist, rate limit, credential rotation이 필요하다. 저장 데이터는 encryption at rest와 key 분리를 적용하고, web UI는 검색 결과를 통해 secret이 노출되지 않도록 redaction과 audit를 제공해야 한다.

가장 까다로운 위험은 기억을 instruction으로 실행하는 것이다. 검색 문서에 “다음 명령을 실행하라”가 있어도 data로 취급하고, Skill만 제한된 instruction authority를 갖게 해야 한다. Skill 역시 publisher, version, review와 signature를 검증하고 shell·network·filesystem 권한을 별도로 승인한다. 기억 namespace나 높은 rank만으로 실행 권한이 생겨서는 안 된다.

## 무엇을 벤치마크해야 하는가

OpenViking README는 자체 benchmark에서 LoCoMo와 tau2-bench 성능, token과 latency 개선 수치를 제시한다. 유용한 출발점이지만 프로젝트가 선택한 model, embedding, integration과 평가 설정에 의존하는 공식 결과다. 우리 팀의 polyrepo, 사내 명명법, 긴 build와 민감 데이터 조건을 독립적으로 증명하지 않는다.

실무 평가는 “답을 잘 찾았는가” 외에 다음 지표를 포함해야 한다.

- handoff 후 첫 유효 action까지 걸린 시간
- 이미 실패한 접근을 반복한 비율
- 현재 code와 충돌하는 stale memory 사용률
- recall된 항목 중 provenance를 원문까지 추적 가능한 비율
- session당 추가 token, capture latency와 storage 증가량
- project·operator 간 contamination 발생률
- secret redaction의 false negative와 false positive
- 삭제 요청 뒤 index·cache·backup에서 사라지는 데 걸린 시간
- memory가 없는 baseline 대비 task success와 human correction 횟수

평가 세트는 같은 task를 무메모리, 단순 transcript, RAG, typed handoff, RAG+Skill 조합으로 나눠 비교해야 한다. 모델과 tool 권한, base revision을 고정하고, 성공한 run만 골라 보지 않아야 한다. “더 많은 정보를 회수했다”보다 “같은 품질을 더 적은 token과 재작업으로 달성했다”가 운영 지표다.

## 실무 도입 체크리스트

- [ ] 단기 컨텍스트, 장기 기억, RAG resource, Skill과 실행 로그의 schema를 분리했다.
- [ ] 현재 source·build·test·runtime을 최종 operational truth로 명시했다.
- [ ] project, repository, worktree, workstream과 session ID의 관계를 정의했다.
- [ ] handoff에 base revision, 완료 상태, 실패한 시도, open question과 next action이 포함된다.
- [ ] 수신 에이전트가 checkout과 diff를 재확인한 뒤 작업하도록 한다.
- [ ] 모든 durable memory가 creator, source observation, timestamp와 scope를 가진다.
- [ ] fact, hypothesis, decision, procedure와 preference를 type으로 구분한다.
- [ ] lexical·symbol·graph·vector 검색의 역할과 우선순위를 테스트했다.
- [ ] 높은 검색 rank나 namespace가 instruction authority를 부여하지 않는다.
- [ ] Skill 변경에는 version, review, 검증 명령과 rollback이 있다.
- [ ] capture 전에 secret, ignored path와 민감 tool output을 필터링한다.
- [ ] 외부 문서와 모델 요약을 untrusted content로 표시한다.
- [ ] 자동 consolidation 결과가 durable decision으로 승격되기 전에 review한다.
- [ ] self-reinforcement와 project 간 contamination을 정기적으로 감사한다.
- [ ] 기억 종류별 TTL, supersede, archive와 hard-delete 정책이 있다.
- [ ] 삭제가 wiki, Git history, vector index, cache, backup과 파생 요약에 전파된다.
- [ ] shared server의 인증·RBAC·TLS·rate limit·audit log를 검증했다.
- [ ] 메모리 장애 시에도 repository와 기본 개발 workflow가 계속 동작한다.
- [ ] 공식 benchmark와 별개로 팀의 실제 task와 threat model로 평가했다.
- [ ] 시스템을 제거할 때 hook, MCP 설정, token과 저장 데이터까지 회수할 수 있다.

## 결론

RAG, Skills, 작업 기록과 장기 기억은 하나의 “컨텍스트 운영 체계” 아래에서 관리할 수 있다. 그러나 하나의 index, 하나의 prompt 또는 하나의 무제한 저장소로 합쳐서는 안 된다. 통합해야 할 것은 주소, provenance, 정책과 관찰 가능성이고, 보존해야 할 것은 각 데이터 종류의 수명과 신뢰 경계다.

OpenViking은 파일시스템 형태의 namespace, 계층형 로딩과 검색 trajectory로 context를 탐색 가능하게 만드는 방향을 보여준다. ai-memory는 코딩 에이전트 lifecycle에서 관찰을 수집하고 Markdown wiki, 제한된 handoff와 managed workstream으로 서로 다른 agent를 잇는 방향을 제시한다. 둘 다 공식 프로젝트 설명상 흥미로운 설계지만, 제품이 제시한 benchmark와 지원 범위는 독립 검증 결과로 읽어서는 안 된다.

에이전트 메모리의 진짜 경쟁은 누가 더 오래 기억하는가가 아니다. 현재 코드보다 기억을 덜 믿고, 필요한 근거를 더 빨리 찾으며, 작업을 다른 에이전트에게 손실 없이 넘기고, 틀린 기억을 추적해 만료·정정·삭제할 수 있는가의 경쟁이다. 좋은 시스템은 에이전트에게 과거를 주입하는 데서 끝나지 않는다. 과거가 왜 현재 prompt에 들어왔는지 설명하고, 현재와 충돌할 때 스스로 물러날 수 있어야 한다.

## 참고 자료

- [OpenViking GitHub Repository — context database, 계층형 로딩과 retrieval trajectory에 대한 공식 설명](https://github.com/volcengine/OpenViking)
- [ai-memory GitHub Repository — 코딩 에이전트 lifecycle capture, wiki와 cross-agent handoff에 대한 공식 설명](https://github.com/akitaonrails/ai-memory)
