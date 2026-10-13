---
title: '문서가 정확해도 AI 에이전트는 API를 틀린다: Agent Experience를 측정하는 방법'
date: 2026-10-13 08:00:00 +0900
categories: ["AI 에이전트"]
description: 'Microsoft AX Practitioner Playbook의 propensity·efficacy 구분과 trajectory 진단을 바탕으로, SDK·API 제품 변경을 실행 가능한 gate와 반복 가능한 회귀 평가로 운영하는 방법을 설계한다.'
featured_image: 'https://picsum.photos/seed/agent-experience-evaluation-sdk-api/1600/900'
tags: [agent-experience, ax, evaluation, sdk, api, trajectory, regression-testing, microsoft]
---

![Agent Experience 평가에서 결과와 trajectory를 함께 보는 운영 설계](https://picsum.photos/seed/agent-experience-evaluation-sdk-api/1600/900)

SDK 문서가 기술적으로 정확하다는 사실과 AI 코딩 에이전트가 그 SDK를 올바르게 사용한다는 사실은 다르다. 에이전트는 학습 데이터, 작업공간, harness가 조립한 문맥, 설치된 확장, 검색한 문서를 함께 보고 기술과 버전, 구현 패턴을 고른다.[1][2] 그래서 최신 인증 예제가 공식 문서에 있어도 에이전트가 문서를 읽지 않거나, 읽기 전에 이미 낡은 계획을 세웠거나, 올바른 내용을 잘못 적용하면 결과는 틀릴 수 있다.[1]

Microsoft가 2026년 10월 공개한 **Agent Experience(AX) Practitioner Playbook**은 이 간극을 평가하고 원인을 찾아 원천 surface를 고치는 방법을 정리한다.[3][1]

Microsoft DevRel은 2025년 가을부터 Azure, Cosmos DB, SharePoint Framework(SPFx), Microsoft 365 Copilot extension을 대상으로 수백 회의 agent session을 평가했다고 설명한다.[3][1]

공개 글은 이 작업이 Cosmos DB Agent Kit의 46개 개선과 SPFx 관련 문서·harness 개선으로 이어졌다고 보고한다.[3][1]

다만 이것을 “Microsoft 방식대로 하면 에이전트 정확도가 몇 퍼센트 오른다”는 보편 성능 주장으로 읽으면 안 된다. Playbook의 SPFx 수치는 특정 scenario, profile, 시점에 묶인 공급자 평가이고, 함께 공개된 AX Practitioner skill의 평균 95%도 playbook 내용에 관한 330개 질문에서 얻었다고 Microsoft가 발표한 공급자 보고 점수다.[3][1] 이 글은 그 수치를 제품 성능으로 일반화하지 않는다. 대신 **발견할 가능성(propensity)**과 **사용 품질(efficacy)**을 분리하고, 최종 결과가 아니라 trajectory로 실패 단계를 찾으며, 실제 실행 gate를 통과한 변화만 같은 fixture에서 다시 측정하는 운영 구조에 집중한다.

## 첫 질문은 “정확한가”가 아니라 “무엇을 측정했는가”다

AX 평가에서 가장 먼저 갈라야 할 축은 propensity와 efficacy다. Playbook은 제품명을 지정하지 않은 현실적인 요청에서 에이전트가 해당 기술을 발견하고 선택하는지를 propensity로, 기술을 명시한 요청에서 올바른 버전과 패턴으로 사용하는지를 efficacy로 정의한다.[1] 예를 들어 “고객 데이터를 저장할 document database 기반 API를 만들어라”는 어떤 제품을 고르는지 묻지만, “Cosmos DB hierarchical partition key로 다중 tenant를 분리하라”는 Cosmos DB를 얼마나 바르게 쓰는지 묻는다.[1]

둘을 한 점수로 합치면 처방이 틀어진다. 제품이 선택되지 않은 run의 SDK 품질을 채점하거나, 제품명을 prompt에 넣어 놓고 발견 성능을 주장해서는 안 된다. Microsoft는 scenario가 실제 개발자의 prompt에 가까워야 하고 rubric이나 평가 힌트를 섞지 않아야 한다고 명시한다.[1][4]

제품 회귀 평가에서는 두 suite를 독립적으로 유지하는 편이 낫다. 다음 구분은 Playbook의 용어를 제품 운영에 옮긴 이 글의 제안이다.

| suite | prompt가 고정하는 것 | 핵심 판정 | 실패가 가리키는 owner |
|---|---|---|---|
| Propensity | 사용자 목표와 제약, 기존 workspace | 목표 기술의 선택 여부와 선택 시점 | 제품명·분류·발견 surface·비교 문서 |
| Efficacy | 목표 SDK·API 또는 제품 | 지원 버전, API 사용, 인증·구성 패턴, 실행 결과 | SDK·API·문서·sample·extension 내용 |
| Composition | 목표 기술과 실제 extension 조합 | 단독 대비 결합 시 lift 또는 drag | 충돌하는 설명·반환 내용·harness 조립 |
| Regression | 과거에 고친 구체적 실패 | 같은 fixture에서 재발하지 않는가 | 변경한 source와 그 배포 경로 |

중요한 것은 propensity가 단순 브랜드 언급률이 아니라는 점이다. “후보로 한 번 말함”, “최종 계획으로 채택함”, “실제 dependency와 code에 반영함”은 서로 다른 상태다. 따라서 이 글이 제안하는 propensity gate는 `mentioned → selected → instantiated`를 분리한다. 경쟁 제품을 검토한 뒤 목표 기술을 선택한 run과, 말만 하고 다른 database로 구현한 run을 같은 성공으로 세지 않는다.

Efficacy도 “SDK 이름이 코드에 있다”로 끝나지 않는다. Playbook은 criteria가 문자열 존재가 아니라 의미를 판단해야 하며, package·version·API·명시적인 잘못된 pattern을 적으라고 요구한다.[1] 또한 build·test·run·필요한 경우 deploy는 의미 판단 criterion이 아니라 기계적인 gate로 확인해야 한다고 구분한다.[1] 이것이 readout의 점수와 실행 가능한 제품을 분리하는 핵심이다.

## 결과 점수보다 먼저 prerequisite gate를 세운다

Microsoft의 평가 모델은 scenario, criteria, profile, gate 네 요소로 구성된다.[1] 여기서 gate는 criterion의 또 다른 이름이 아니다. Criterion은 “권장 인증 pattern을 사용했는가”처럼 domain 의미를 판단하고, gate는 “목표 기술을 선택했는가”, “build가 성공했는가”, “test가 통과했는가”, “app이 실행되는가”처럼 실제 결과를 기계적으로 막는다.[1]

Playbook은 prerequisite를 먼저 확인한 뒤 build, test, run, 필요한 경우 deploy 순으로 gate를 쌓으라고 설명한다.[1] Microsoft가 이 순서를 모든 SDK에 강제하는 산업 표준으로 제정한 것은 아니다. 이는 Playbook의 평가 방법이며, 각 제품은 lifecycle에 맞춰 실행 단계를 조정해야 한다. 예를 들어 client library라면 deploy보다 package consumer test가 중요할 수 있고, HTTP API라면 schema validation 뒤 sandbox request와 response contract 검사가 중요할 수 있다.

이 글이 제안하는 SDK·API 회귀 gate는 다음처럼 fail-closed로 구성한다.

```text
G0 scenario integrity
   fixture hash, profile manifest, criteria version이 승인된 값과 같은가?

G1 prerequisite
   목표 기술을 선택했고 금지된 대체 구현으로 우회하지 않았는가?

G2 dependency contract
   허용 package와 version range를 사용하고 deprecated package를 배제했는가?

G3 build and static contract
   restore/install/build와 schema·type 검사가 성공했는가?

G4 behavior
   fixture 기반 test와 local emulator 또는 mock API contract가 통과했는가?

G5 runtime
   process가 시작되고 대표 request가 기대 response와 side effect를 만드는가?

G6 semantic criteria
   인증, tenancy, retry, pagination 등 제품팀이 정의한 사용 방식이 맞는가?
```

이 순서는 Microsoft의 산업 표준이나 고정 field schema가 아니다. Playbook의 평가 방법을 필자가 CI에 옮긴 것이며, client library는 consumer test, HTTP API는 schema와 sandbox contract처럼 lifecycle에 맞는 단계를 택해야 한다.

## Criterion은 제품 지식을 판정 가능한 계약으로 바꾸는 일이다

좋은 criterion은 추상적인 “best practice를 따른다”가 아니다. Playbook은 하나의 criterion에 확인 대상, pass 조건, fail 조건, skip 조건이 있어야 하며, package명·version 범위·API와 구체적인 잘못된 pattern을 적으라고 제안한다.[1] 같은 artifact를 반복 채점했을 때 verdict가 뒤집히면 agent 품질이 아니라 criterion 또는 judge가 불안정한 것이다.[1][4]

예를 들어 다음 criterion은 회귀 gate로 쓰기 어렵다.

```yaml
criterion: 최신 인증 방식을 올바르게 사용한다
```

`최신`, `올바르게`를 judge가 채워야 하므로 제품팀의 기준이 측정기에 들어가지 않았다. 다음은 이 글이 제안하는 더 좁은 형태다.

```yaml
id: auth-identity-001
checks:
  - subject: application code의 credential 구성
    pass:
      - 허용한 identity credential class를 실제 client 생성에 사용
      - secret literal이나 account key가 source에 없음
    fail:
      - deprecated credential class 사용
      - connection string의 secret을 source literal로 저장
    skip:
      - scenario가 인증된 service 호출을 만들지 않음
mechanical_gates:
  - build
  - secret_fixture_scan
owner: sdk-auth
criteria_version: 3
```

이 schema 역시 Playbook의 공식 format이 아니라 필자의 운영 예시다. 핵심은 judge에게 “현재가 무엇인지 알아서 판단하라”고 맡기지 않고, 제품 owner가 허용·금지 경계를 version으로 소유하는 데 있다. Microsoft는 criterion을 알려진 good artifact와 bad artifact에 적용하고, 동일 artifact를 반복 판정하며, domain 전문가가 기술 정확성을 확인한 뒤 잠그는 calibration 절차를 권한다.[1] Criteria를 고칠 때 calibration run과 실제 AX 측정 run을 분리하라는 경계도 둔다.[1]

기계 판정과 LLM judge의 역할도 나눠야 한다. Microsoft 글은 build, 구조화된 package 검사처럼 기계적으로 검증할 수 있는 항목에는 deterministic check를, 코드 문맥 속 의미가 필요한 판단에는 명시적 pass·fail·skip 조건을 가진 LLM judge를 쓸 수 있다고 설명한다.[1][5]

같은 글은 단순 문자열 검사도 comment 안의 import를 실제 사용으로 오인할 수 있고, LLM judge도 semantic version 계산 같은 작업에서 실패할 수 있다고 경고한다.[5][4]

Playbook 원칙을 제품 verifier에 옮기는 이 글의 운영 제안은 판정 대상을 가장 단순한 verifier로 보내는 것이다. version range, JSON schema, exit code, HTTP status와 response body invariant는 code로 검사한다. 인증 flow나 multi-tenant partition 설계처럼 여러 file과 호출 관계를 읽어야 하는 판단만 judge에게 맡긴다. 총점 계산도 judge에게 시키지 말고 개별 verdict를 받은 뒤 code에서 계산한다. Microsoft 팀도 judge에게 pass·fail·skip과 증거만 반환하게 하고 aggregate 계산은 deterministic code로 옮겼다고 보고한다.[4]

## Trajectory는 실패의 위치를 알려 주는 진단 자료다

Readout은 어떤 criterion이 몇 회 실패했는지 보여주지만, 그 자체로 원인을 말하지 않는다. Playbook은 trajectory를 한 run에서 수행된 tool call, file read, decision의 전체 기록으로 설명하고, generated output과 verdict뿐 아니라 run별 trajectory를 보존하라고 요구한다.[1] Microsoft의 단계 구분은 extension이 아예 load되지 않은 **discovery failure**, load됐지만 호출되지 않은 **lack of invocation**, 호출됐지만 잘못 적용된 **application failure**다.[1]

세 실패는 최종 code만 보면 모두 “낡은 SDK 사용”으로 보일 수 있다. 그러나 고칠 곳은 완전히 다르다. Load 실패는 packaging·registration·startup·harness limit을 먼저 봐야 하고, 미호출은 tool 또는 skill 설명과 사용자 vocabulary의 연결을 봐야 하며, 오적용은 반환 내용·문서·instruction을 봐야 한다.[1] Microsoft는 source가 문서라면 skill로 우회하기보다 문서를 직접 고치고, source를 바꿀 수 없을 때만 임시 bridge extension을 고려하라고 제안한다.[1]

제품팀이 trajectory를 자유 형식 로그로만 저장하면 회귀 분석이 어렵다. 다음 event와 파생 상태를 별도 index로 만드는 것은 이 글의 운영 제안이다.

| 진단 상태 | trajectory에서 찾을 증거 | 먼저 검토할 surface |
|---|---|---|
| not exposed | session manifest에 extension/tool 없음, load error 존재 | package·registration·harness |
| exposed, not selected | manifest에는 있으나 관련 call 없음 | 이름·description·task vocabulary |
| selected, call failed | call은 있으나 argument/schema/transport 실패 | tool contract·error response |
| call succeeded, ignored | 유효한 response 뒤 기존 계획을 그대로 실행 | response의 우선순위·plan invalidation |
| applied incorrectly | response 일부를 읽었지만 version·pattern 오적용 | 문서 구조·example·criteria에 잡힌 gap |
| correct then regressed | 중간에는 맞았으나 후속 수정에서 깨짐 | feedback loop·later context·test coverage |
| blocked by gate | 결과 주장과 달리 build/test/runtime 실패 | 실행 환경·error affordance·agent iteration |

위 표는 Playbook의 3단계 구분과 9개 failure pattern을 바탕으로 필자가 확장한 CI triage 모델이다. 각 상태에는 서로 다른 owner와 재현 경로를 연결해야 한다. 그래야 dashboard의 한 개 실패율이 문서팀, SDK팀, evaluation platform팀 사이에서 떠돌지 않는다.

특히 “extension이 호출됨”을 성공으로 세지 않아야 한다. Microsoft는 동일 scenario를 bare profile과 extension profile에서 통제 비교하고, 결과가 좋아지면 lift, 같거나 나빠지면 drag로 보라고 한다.[1][5]

Extension은 호출되면서도 불필요한 내용으로 비용과 turn을 늘리거나, 원래 맞던 지식을 잘못된 방향으로 덮어써 결과를 악화시킬 수 있다.[1][2][5] 그러므로 invocation rate는 원인 진단 지표이지 최종 제품 품질 지표가 아니다.

## Fixture를 고정하지 않으면 제품 회귀가 아니라 환경 변화를 잰다

동일 prompt라는 말만으로 반복 가능성이 생기지는 않는다. Playbook의 profile에는 운영체제, harness, model과 설정, extension 및 그 version이 포함된다.[1] Microsoft는 같은 prompt가 운영체제에 따라 다른 language stack 선택으로 이어진 사례, `azureuser` 같은 사용자명과 `poc`·`test` 같은 directory 이름이 기술 선택이나 품질 가정에 영향을 준 사례, LSP 유무가 generation 중 self-correction을 바꾼 사례를 공개했다.[6]

따라서 회귀 run에는 `scenario_version`, `fixture_digest`, `criteria_version`, `gate_bundle_version`, OS image, harness·model·extension·SDK·LSP version, reasoning 설정과 network policy를 manifest로 남기는 것이 좋다. 이 field들은 Microsoft의 mandatory schema가 아니라, Playbook의 profile·environment 기록을 비교 가능한 artifact로 만든 필자의 설계다. 완전한 재현성을 보장하지는 않지만 score 변화가 문서 수정 때문인지 model·harness·LSP 교체 때문인지 조사할 출발점은 된다.

Fixture에는 시작 repository만이 아니라 외부 응답도 포함해야 한다. `latest` package version, mutable documentation, live API 상태를 그대로 읽게 두면 같은 commit에서도 평가 입력이 달라진다. Capability 평가에서 최신 정보 탐색 자체를 시험하려면 network를 열 수 있지만, 제품 회귀 gate에서는 docs snapshot, package registry metadata, API response를 고정하거나 변경을 명시적으로 새 measurement boundary로 올리는 편이 낫다. 이것은 Playbook의 “동일 starting workspace와 environment” 원칙을 더 엄격한 CI로 옮긴 필자의 제안이다.

반복 횟수도 한 번으로는 부족하다. Playbook은 같은 scenario-profile 조합을 적어도 다섯 번 실행하되, 다섯 번이 통계적 유의성을 보장하지는 않고 pattern과 명백한 실패를 찾는 실용적 시작점이라고 한정한다.[1] Microsoft의 별도 글도 5회에서 pattern이 보이기 시작한다고 설명하고, 3/5 대 2/5처럼 차이가 작으면 run을 늘리거나 효과가 불명확하다고 받아들이라고 제안한다.[4] 따라서 `5회`를 보편적인 통계 보증으로 쓰지 말고, 불확실할 때 추가 실행하는 최소 관측 예산으로 다뤄야 한다.

## 제품 변경은 한 번에 하나의 가설로 승격한다

평가가 고장 난 surface를 지목하면 곧바로 문서를 대대적으로 다시 쓰고 싶어진다. 그러나 여러 surface를 한꺼번에 바꾸면 어느 변화가 lift를 만들었는지 알 수 없다. Playbook은 한 surface씩 변경하고 같은 evaluation을 다시 실행하며, 결과를 개선하지 않는 변경을 문장이 좋아 보인다는 이유로 배포하지 말라고 한다.[1]

Microsoft의 SPFx 사례는 이 과정을 구체적으로 보여 준다. 2026년 4월 baseline에서는 `release-1.22.md`를 읽은 4개 run 중 어느 것도 1.22.2 page로 이어지지 않았고, 문서명 변경과 중간 proxy simulation을 거친 뒤 9월 live-doc 재실행에서는 5개 run 중 4개가 1.22.2 page를 찾았다고 Playbook은 보고한다.[1] 또 CLI 사용을 권하는 tip은 계획을 바꾸지 못했으나, `package.json`만 수동 수정하면 build failure가 난다는 warning과 migration guide 개편을 배포한 뒤 재평가에서는 모든 bare run이 CLI를 발견해 사용했다고 한다.[1]

이 결과는 SPFx upgrade라는 특정 scenario와 당시 profile에서 나온 Microsoft의 평가다.[1] “warning은 항상 tip보다 낫다”거나 “파일명에 patch version을 쓰면 모든 agent가 최신 문서를 찾는다”는 일반 법칙이 아니다. 일반화할 수 있는 것은 문구 변경을 취향으로 승인하지 않고, **기존 trajectory에서 관찰한 결정 지점에 대한 가설**로 만든 뒤 같은 scenario·profile 정의로 재실행하되 시점과 환경 차이를 기록한 방식이다.

제품팀의 change record에는 최초로 잘못된 event, 당시 노출된 source, 한 surface에 대한 변경 가설, 반증 조건, 동일 fixture의 전후 결과를 함께 남기는 편이 좋다. 이는 Microsoft가 요구하는 issue template가 아니라 필자의 운영 계약이다. 관찰과 가설을 분리하고 변경 뒤 같은 평가를 반복해야, 그럴듯한 문구가 아니라 행동을 바꾼 수정만 승격할 수 있다.

## 평균 점수가 아니라 scenario별 회귀 gate를 운영한다

여러 criterion을 한 평균으로 합치면 치명적인 실패가 가려진다. 다섯 scenario 중 네 개가 좋아지고 인증 scenario 하나가 무너져도 평균은 상승할 수 있다. Playbook의 readout은 prerequisite와 실행 gate, criterion별 pass 수, profile 간 lift·drag, task cost를 함께 보라고 한다.[1] Criteria가 5/5면 강한 결과, 2/5면 불안정, 0/5면 일관된 gap으로 읽는 예를 제시하지만, 이 숫자도 tested run 안의 진단이지 보편 성공 확률은 아니다.[1]

실제 release gate는 aggregate 하나보다 계층적으로 두는 편이 낫다. 다음은 필자의 제안이다.

- **불변 gate:** prerequisite, build, contract test, runtime health는 모든 run에서 통과해야 한다.
- **Golden regression:** 과거에 고객 영향 또는 지원 비용을 만든 실패는 scenario별 허용 실패를 0으로 둔다.
- **Propensity·efficacy:** 선택률은 승인 baseline보다 하락하지 않고, 변경은 같은 criteria version에서 lift를 보여야 한다.
- **Variance budget:** pass와 fail이 섞인 scenario는 평균으로 숨기지 않고 unstable로 분류해 추가 run 또는 보류로 보낸다.
- **Cost ceiling:** 품질 lift가 있어도 task당 비용과 latency가 사전 상한을 넘으면 자동 승격하지 않는다.
- **Evidence completeness:** 실패 run마다 output, gate log, verdict evidence, trajectory가 없으면 평가 자체를 invalid로 처리한다.

이 gate들은 Playbook의 공식 합격 기준이 아니다. 조직이 risk에 맞춰 수치와 차단 강도를 정한다. Microsoft 방법의 핵심은 baseline 없이 효과를 주장하지 않고, cost와 품질을 함께 보며, run-level evidence를 보존하고, 같은 잠긴 정의로 반복 측정하는 규율이다.[1][5]

이 글이 제안하는 회귀 suite는 기능 목록이 아니라 실패 기억이어야 한다. Deprecated SDK 선택, extension load 실패, tool 미호출, 올바른 response 오적용, build되지 않는 고득점 같은 실제 failure가 발견될 때마다 최소 재현 scenario와 fixture, criterion, gate를 추가한다. 제품 release가 correct usage의 정의를 바꾸면 criteria version을 올리고 old result와 새 result를 한 추세선으로 잇지 않는다. Model이나 harness만 바뀌어도 reference profile을 다시 측정한 뒤 제품 regression과 platform drift를 분리한다.

## 95%는 제품 성능 점수가 아니다

Microsoft는 AX Practitioner skill이 playbook 내용만 답하고 범위를 벗어나면 이를 알린 뒤 다른 source 사용 허가를 묻도록 설계했으며, 330개 질문에서 평균 95%를 기록했다고 발표했다.[3] 이 값은 skill이 SDK project를 생성해 build·run gate를 통과한 비율도, 다른 조직의 API에서 얻을 AX 개선률도 아니다. 공개 글에는 330개 질문의 전체 dataset, judge 구성, run별 분산, 독립 재현 결과가 제시되지 않는다.[3]

따라서 95%를 Playbook 방법의 효능 증명으로 쓰지 않는다. 평가 단위를 scenario·criteria·profile·gate로 나누고, SPFx 사례의 prompt·profile·run·trajectory·변경 후 결과를 함께 공개한 점이 실무적으로 더 유용하다.[1] 그 사례도 Microsoft가 수행한 공급자 평가이지 독립 benchmark는 아니다.

도입 판단은 자체 artifact로 내려야 한다. Propensity와 efficacy가 별도 scenario인지, 최초 이탈 event를 찾을 수 있는지, semantic score와 실행 gate가 분리되는지, 같은 fixture에서 bare·현재판·후보판을 반복 비교할 수 있는지 확인한다. Score가 올라도 cost·variance·golden regression이 악화되면 승격을 막고, 배포 후 같은 scenario로 source 수정 효과를 다시 읽는다. 이는 Microsoft의 공식 checklist를 인용한 것이 아니라 이 글의 운영 제안이다.

## 결론: AX는 문서 KPI가 아니라 제품 회귀 평가다

Agent Experience를 “에이전트가 읽기 좋은 문서 만들기”로 축소하면 호출 수와 언급 수가 KPI가 된다. Microsoft Playbook의 더 중요한 기여는 평가 질문을 분해한 데 있다. 제품을 발견하고 선택하는 propensity와, 선택한 기술을 올바르게 적용하는 efficacy는 다른 scenario를 필요로 한다.[1] Readout은 실패를 보여 주지만, extension 미로딩·미선택·오적용을 구분하려면 trajectory가 필요하다.[1] 의미 criterion이 높아도 build·test·run gate가 실패하면 실행 가능한 성공이 아니다.[1]

운영의 끝은 보고서가 아니라 재현 가능한 변경 승인이다. 동일 fixture와 profile에서 bare baseline을 만들고, 변경 surface를 하나만 바꾸고, 여러 run의 verdict·gate·cost·trajectory를 보존한다. 그 뒤 propensity 하락, efficacy drag, golden scenario 재발, 실행 gate 실패를 차단 조건으로 둔다. 이 구조는 Microsoft가 공개한 제품 요구사항이 아니라 Playbook 원칙을 CI와 release 관리로 확장한 필자의 제안이다.

문서, SDK, API, CLI, MCP, skill 가운데 무엇을 고칠지는 미리 정할 수 없다. Trajectory가 최초 이탈 지점을 가리키고, 통제된 전후 평가가 실제 lift를 보여 줄 때만 고친 surface를 승격한다. 그렇게 해야 AX는 일회성 agent demo나 모호한 만족도 점수가 아니라, 제품이 바뀌고 model과 harness가 교체되어도 같은 실패를 다시 잡아내는 **제품 회귀 평가 체계**가 된다.

## Sources

[1] https://raw.githubusercontent.com/microsoft/scope/20a2cbe64d3f135988ec328de325fe92d3d0b3a0/docs/ax-playbook/ax-playbook.pdf
[2] https://developer.microsoft.com/blog/how-ai-coding-agents-actually-use-your-technology
[3] https://developer.microsoft.com/blog/introducing-the-agent-experience-ax-practitioner-playbook
[4] https://developer.microsoft.com/blog/building-ax-evals-that-actually-work
[5] https://developer.microsoft.com/blog/is-your-agent-extension-actually-working
[6] https://developer.microsoft.com/blog/the-hidden-variables-in-your-agent-eval
