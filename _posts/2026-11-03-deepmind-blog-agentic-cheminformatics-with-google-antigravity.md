---
title: '화학 계산은 결정론적으로, 가설은 에이전트에게: Antigravity Cheminformatics 검증 설계'
date: 2026-11-03 09:00:01 +0900
categories: ["AI 에이전트"]
description: 'Google Antigravity Cheminformatics Skills의 접근 조건과 RDKit·ChEMBL·PubChem 및 LLM의 역할 분리를 살펴보고, 아직 실행하지 않은 분자 계산·가설 생성 검증을 설계한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-deepmind-blog-agentic-cheminformatics-with-google-antigravity/1600/900'
tags: [google-deepmind, antigravity, cheminformatics, rdkit, chembl, pubchem, ai-agent]
---

![분자 구조식과 실험 도구 사이를 연결하는 빛나는 작업 흐름](https://picsum.photos/seed/news-2026-11-03-deepmind-blog-agentic-cheminformatics-with-google-antigravity/1600/900)

화학에서 원자 하나나 결합 하나가 바뀌면 다른 물질이 된다. 그래서 자연어 모델이 SMILES를 그럴듯하게 생성했다는 사실과, 화학 구조가 유효하고 계산 결과가 재현된다는 사실을 같은 것으로 볼 수 없다.

Google DeepMind는 2026년 11월 3일 Google Antigravity용 Cheminformatics Skills를 공개했다. LLM은 workflow orchestration, database 탐색, 과학적 reasoning을 맡고, RDKit 같은 결정론적 도구가 분자 계산을 수행한다. ChEMBL과 PubChem connector도 함께 사용한다.[1]

## 역할 분리가 핵심이다

공개 사례는 폐암 치료제 crizotinib과 lorlatinib를 중심으로 문헌·화합물 데이터를 모으고, matched molecular pair analysis(MMPA), 예측 모델, 새로운 macrocycle과 합성 경로 제안까지 연결한다.[1]

이 workflow를 안전하게 읽는 방법은 결과를 세 종류로 나누는 것이다.

| 결과 | 생성 주체 | 검증 방식 |
|---|---|---|
| 분자 표준화·descriptor | RDKit 등 도구 | 같은 입력·버전으로 재실행 |
| 문헌·database 사실 | 외부 source | identifier와 원문 확인 |
| 설계·합성 가설 | LLM과 모델 | 독립 계산과 실험 검증 |

LLM 설명이 유창해도 descriptor 값의 출처가 되지는 않는다. 반대로 RDKit이 계산한 rotatable bond 수가 맞아도 해당 분자가 실제 약효가 있다는 뜻은 아니다.

## 같은 분자를 같은 입력으로 만드는 단계

화합물은 이름, SMILES, InChI, SDF처럼 여러 표현으로 들어온다. Salt, tautomer, stereochemistry, protonation을 어떻게 처리하는지에 따라 중복 제거와 검색 결과가 달라진다.

따라서 계산 전에 normalization contract를 고정해야 한다.

```text
source_record_id
original_representation
parser_version
sanitization_result
salt_policy
tautomer_policy
stereochemistry_policy
canonical_smiles
structure_hash
```

원본 표현을 버리지 않는다. Canonical SMILES만 남기면 normalization 오류가 발생했을 때 source로 돌아가기 어렵다. Parser가 실패한 구조를 LLM이 임의로 “고쳐서” 통과시키는 것도 금지해야 한다.

## MMPA는 한 번의 변화 효과를 보려는 도구다

Matched molecular pair analysis는 작은 구조 변화 하나만 다른 분자 쌍을 찾아 그 변화와 속성 차이의 관계를 본다. DeepMind 사례에서는 cyclization 여부가 다른 쌍을 비교해 rotatable bond 감소와 potency 변화를 분석했다.[1]

여기서 agent가 “작은 변화”를 자연어로 판단하게 두면 비교 기준이 흔들린다. Fragmentation rule, 최대 변환 크기, assay 단위, 동일 target 조건을 코드로 고정해야 한다. 서로 다른 assay나 실험실의 값을 섞으면 구조 변화보다 측정 차이를 학습할 수 있다.

## 작은 공개 corpus용 fixture

아래는 **실행하지 않은 검증 fixture 제안**이다. 공개 identifier가 있는 소수 화합물만 사용하고, 결과는 새로운 약물 발견이 아니라 tool contract 검사로 제한한다.

```text
1. PubChem 또는 ChEMBL에서 고정 ID 목록을 가져온다.
2. 원본 구조와 source body hash를 보관한다.
3. RDKit으로 sanitize·canonicalize·deduplicate한다.
4. molecular weight와 rotatable bond를 계산한다.
5. 정해진 rule로 MMPA를 실행한다.
6. agent는 어떤 tool을 왜 호출했는지 설명만 한다.
```

실패 주입도 포함한다.

- 닫히지 않은 ring을 가진 잘못된 SMILES
- 같은 분자의 salt form 중복
- stereochemistry가 다른 구조
- 단위가 다른 potency 값
- 단일 결합 변화가 아닌 분자 쌍
- 존재하지 않는 database identifier

기대 결과는 agent가 모두 복구하는 것이 아니다. Parser 오류, 범위 밖 비교, source 불일치를 정확히 분류하고 계산을 중단해야 한다.

## 예측 모델이 높게 맞아도 신약은 아니다

DeepMind는 여러 feature와 model architecture를 사용하고 held-out set에서 검증했으며, 가능하면 chronological split, 그렇지 않으면 scaffold split을 사용한다고 설명한다.[1]

Random split은 비슷한 scaffold가 train과 test에 동시에 들어가 성능을 부풀릴 수 있다. Chronological split은 과거 화합물로 미래 화합물을 예측하는 실제 discovery 흐름에 더 가깝지만, assay protocol 변화의 영향도 받는다. 평가 보고서에는 split 방식과 중복 제거 기준을 반드시 남겨야 한다.

공개 글도 sparse data, 실험실 간 assay noise, 좁은 dynamic range가 예측 정밀도를 제한하며 계산 설계는 완성된 약물이 아니라 testable hypothesis라고 명시한다.[1] 합성 가능성, 독성, 선택성, 약동학은 별도 검증 대상이다.

## “한 시간”은 제품 SLA가 아니다

Google 사례는 agent가 수천 개 화합물을 찾고 분석해 새로운 rigidified macrocycle과 합성 경로를 한 시간 안에 제안했다고 설명한다.[1] 이 시간은 선택한 사례와 환경의 공급자 보고치다. 모든 chemistry project가 한 시간에 끝난다는 의미가 아니다.

재현 시간에는 다음이 포함돼야 한다.

- source download와 rate limit
- 구조 parsing 실패의 수동 adjudication
- model training과 seed 반복
- 결과 export와 audit
- 사람이 문헌과 합성 경로를 검토한 시간

실험 합성과 assay 시간은 더더욱 포함되지 않는다.

## 접근 경로와 연구자 프로그램의 경계

Cheminformatics Skills는 Antigravity App에 Science plugin을 설치해 사용할 수 있다. Enterprise 사용자는 앱에서 `Use Business Account`를 선택하고 Google Cloud credential로 로그인하는 경로가 안내돼 있다.[1]

Google은 별도로 과학자 10,000명에게 Antigravity 최고 usage tier를 6개월간 무료 제공하는 프로그램의 신청을 받는다고 밝혔다. 그러나 이는 신청자 전원에게 즉시 보장되는 일반 access가 아니다. Rolling basis로 onboarding하며 eligibility, capacity, selection 조건이 적용된다.[1]

따라서 재현 계획에는 계정 유형, 승인 상태, 실제 tier와 quota, 지역·조직 정책을 기록해야 한다. “10,000명 제공”이라는 총정원은 개별 연구자의 선정이나 특정 시점의 가용 capacity를 보장하지 않는다.

## 권한과 provenance

Antigravity Skills가 local tool과 database connector를 호출한다면 각 action의 입력·출력 hash, tool version, source identifier를 남겨야 한다. LLM transcript만으로는 계산을 재현할 수 없다.

권장 artifact chain은 다음과 같다.

```text
source ID → retained record → normalized structure
→ deterministic calculation → model artifact
→ agent interpretation → human decision
```

각 화살표에서 입력과 출력의 identity를 고정한다. Agent가 새로운 합성 경로를 제안하면 “문헌에서 확인됨”, “database에서 유사 반응 발견”, “모델이 생성한 가설”을 서로 다른 상태로 표시한다.

Google의 Cheminformatics Skills는 범용 LLM과 도메인 도구를 섞는 좋은 경계를 보여준다. 언어 모델은 질문을 분해하고 결과를 설명할 수 있다. 그러나 구조 validation과 descriptor 계산은 버전이 고정된 도구가 맡고, 최종 분자와 합성 경로는 실험이 확인해야 한다. 과학 agent의 신뢰성은 더 그럴듯한 문장이 아니라 이 역할 분리를 끝까지 보존하는 데서 나온다.

## Sources

[1] https://deepmind.google/blog/agentic-cheminformatics-with-google-antigravity/
