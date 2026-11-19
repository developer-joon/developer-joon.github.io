# Benefit Atlas 출처 기반 혜택 적재 구현 계획

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Never promote a research-only lead into `verified_benefits` by copying JSON.

**Goal:** 원장 2,000개를 보존하면서 공식 출처의 *개별* 복지 항목을 출처 기반 `조사 중`으로 표시하고, 기본 목록에서는 표시 가능한 항목이 없는 기업을 제외한다.

**Architecture:** 비공개 취득/검토 JSONL → 권리·법인·의미 검토를 통과한 출처 기반 공개 입력 JSONL → 독립된 정적 sibling manifest/payload → 브라우저 SHA 검증 → 목록·상세의 연구 카드. 기존 base/approved-v2 manifest·shard, 0건의 verified-benefits ledger와 추천 판정은 변경하지 않는다. 새 공개 입력에는 원문 문단/인용문이 없고 짧은 자체 요약, 범위, 안전한 출처 링크만 있다.

**Tech Stack:** Python 3 stdlib, Jekyll/Vite/React/TypeScript, Zod, Vitest, Node test runner, 기존 Docker 정적 빌드.

---

### Task 1: 동결된 시범 입력의 독립 검토·권리 경계

**Files:** 비공개 `${HERMES_HOME}/data/benefit-atomic-wave-{1,2,3,4}/`; 읽기 전용 `docs/research/company-benefits/source-registry.jsonl`, `benefit-taxonomy-v1.json`, `community-app/public/data/company-benefits/manifest.json`. 별도 5차 탐색은 권리·법인 범위 미검토로 공개 입력에 포함하지 않는다.

1. 각 assignment의 SHA·0700/0600 모드·정확한 company ID/URL을 확인한다. 생산자 JSONL 전체를 프로그래밍으로 읽고 ID·원문 단일 문장·분야·중복·범위·출처를 검산한다.
2. 별도 검토자가 정확한 공식 목적지 페이지를 독립적으로 읽고 각 행을 `preview_eligible / rework / reject`로 판정한다. 출처 snippet/metadata 또는 단순 URL 일치만으로 승인하지 않는다. snapshot 금지 출처의 본문은 보존하지 않는다.
3. 검토 파일이 모든 생산자 행을 정확히 한 번씩 가리키는지, 각 `preview_eligible`의 출처 특정 권리·법인·의미·현재성 한계가 적혀 있는지 검사한다. 공개 산출물에는 합격한 자체 요약만 넣는다. 등록되지 않은 혜택은 승인 수 0건을 유지한다.
4. 시범군은 전체 2,000개 완료가 아니다. 진행 원장에는 조사된 고유 기업, atomic producer 행, 미해결, 공개 가능 연구 항목, 승인 혜택의 다섯 분모를 따로 기록한다.

### Task 2: 재현 가능한 연구 sibling 생성기

**Files:** Create `docs/research/company-benefits/acquisition/source-backed-benefits.jsonl`; create `scripts/generate-company-benefits-research.py`; create `scripts/test_company_benefits_research.py`; generated `community-app/public/data/company-benefits/research-leads-v1/{manifest,leads}.json`.

1. RED: fixture에 `(company_id, action)` 중복, 잘못된 법인/분야, HTTP/인증 포함 URL, 출처 특정 권리 없음, 원문 문단/인용을 넣고 생성기가 **출력 파일을 만들기 전에** 거부하는 시험을 작성한다. 유효한 한 기업의 서로 다른 혜택 2개는 서로 다른 항목으로 통과하고 검증 혜택 수에는 포함되지 않는 시험도 작성한다.
2. GREEN: 공개 입력에는 `company_id`, `primary_category`, `benefit_action`(짧은 자체 요약), `source_url`, `source_registry_id`, `scope`(출처에 명시된 값 또는 `미명시`), `currentness`, `observed_at`, `limitations`, `status: research_only`만 허용한다. source registry의 exact source ID/URL/claim-specific reuse와 원장 회사 ID를 검사한다. 공개에 원문 인용/본문을 금지한다.
3. `leads.json`과 `manifest.json`을 canonical JSON+개행으로 결정적으로 생성한다. manifest는 현재 승인 projection을 포함한 기준 `manifest.json`의 SHA256, payload SHA256/byte_count/record_count/고유 회사 수를 명시한다. `--check`는 두 generated 파일을 재생성 값과 비교하고 쓰지 않는다. 기본 2,000개 manifest 및 기존 shard는 수정하지 않는다.
4. 명령: `python3 -m unittest scripts/test_company_benefits_research.py -v`; `python3 scripts/generate-company-benefits-research.py --check`. 각 기능은 RED 실패 → 최소 코드 → GREEN 순서로 작업한다.

### Task 3: 브라우저 연구 artifact의 독립 검증

**Files:** Modify `community-app/src/data/benefitsArtifactClient.ts`, `community-app/src/types/benefits.ts`; test `community-app/src/data/benefitsArtifactClient.test.ts`, `community-app/src/types/benefits.v2.test.ts`.

1. RED: 정상 base와 두 개의 연구 항목을 schema로 파싱하고 loadAtlas가 검증된 항목/고유 회사 ID를 반환하는 시험. 기준 manifest SHA, payload byte_count/hash, 명시 수, HTTPS 출처, 회사 ID, 중복이 하나라도 틀리면 연구 표시를 거부하는 시험을 별도로 추가한다.
2. GREEN: 기존 `loadManifest/loadApprovedV2Projection`과 독립된 bounded GET(`/community/data/company-benefits/research-leads-v1/manifest.json`, `/leads.json`)로 신규 artifact를 로드한다. 기준 manifest SHA와 descriptor를 SubtleCrypto로 확인하고 각 행을 실제 회사 목록과 join한다. 실패 시 연구 결과를 조용히 0으로 대체하지 않고 오류로 보여준다. verified-benefits inventory는 변경하지 않는다.
3. `npm run test -- --run src/data/benefitsArtifactClient.test.ts src/types/benefits.v2.test.ts` → `npm run typecheck`.

### Task 4: 기본 목록과 상세의 분리 표시

**Files:** Modify `community-app/src/lib/benefitsQueryState.ts`, `community-app/src/pages/BenefitsExplorerPage.tsx`, `community-app/src/pages/BenefitsCompanyPage.tsx`, `community-app/src/components/benefits/BenefitsFilterPanel.tsx`; create `community-app/src/components/benefits/SourceBackedResearchGroup.tsx`; tests `community-app/src/components/benefits/BenefitsV2Rendering.test.tsx`, `community-app/src/App.benefits.test.tsx`.

1. RED: 연구 항목 없는 회사는 기본 목록에 없고, `전체 조사 기업` 필터/직접 상세 링크에서는 확인 가능하며, 이를 `복지 없음`으로 부르지 않는 fixture. 서로 다른 두 atomic 항목은 범위/날짜/안전한 출처와 함께 분야별로 보이고 공통 원문은 표시되지 않는 fixture. 독립 승인 카드/확인 수는 그대로 0이며 조사 항목만으로 조건 적합 판정하지 않는 fixture.
2. GREEN: 목록 기본 predicate는 유효한 연구 항목 1개 이상으로 바꾸고 명시적 전체 목록 선택은 보존한다. 상세에는 재사용 가능한 category별 조사 카드만 추가한다. 각 카드에 `회사 출처에 기재 · 조사 중`, 명시된 직군·법인·조건, `현재성 확인 필요`, 출처/관찰일을 노출하고 검증 혜택과 다른 영역을 사용한다. 기존 raw reference/legacy 원문 비노출은 유지한다.
3. `cd community-app && npm run check`; 연구 항목만 있는 회사의 목록/상세 문구와 zero-approved 동작을 검사한다. 새 카드가 적합/비교 수를 허위 상승시키면 실패한다.

### Task 5: 단일 정적 산출물 및 상태 보고

**Files:** Modify `scripts/verify-site.mjs` and its fixture tests only as required by the sibling contract; generated static research artifact; docs research coverage checkpoint.

1. RED: 새 sibling 누락·SHA 변조·회사 ID 치환·비공개 경로/원문 유입이 artifact verifier에서 실패하는 시험.
2. GREEN: verifier에 기준/descriptor/hash/count/URL/고유 혜택 항목 검사 추가. `node --test scripts/*.test.mjs`와 `cd community-app && npm run check`를 거친다.
3. 최종 변경 HEAD에서 `./scripts/build-site-docker.sh`, `node scripts/verify-site.mjs _site-docker`, `git diff --check`를 수행한다. 공개 연구 항목/기업/미해결과 승인 혜택 0을 별도 수치로 검산한다.
4. 전체 2,000개 및 후속 기업의 공식 출처 조사·중복 제외를 계속한다. 부분 시범군을 전체 완료/배포로 발표하지 않는다. 원격 feature branch push는 사용자의 최종 한 번 지시가 충족될 때까지 유보하고, PR/merge/배포는 별도 지시 없이는 하지 않는다.
