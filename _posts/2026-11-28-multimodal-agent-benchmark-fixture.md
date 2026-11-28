---
title: 'PDF·도면·스프레드시트를 넘나드는 에이전트를 어떻게 채점할까: MKA 공개 10문제 fixture'
date: 2026-11-28 07:40:00 +0900
categories: ["AI"]
description: 'MKA의 비공개 200문제 평가와 공개 10문제 showcase를 구분하고, 근거 위치·중간 변환·최종 artifact를 함께 채점하는 로컬 fixture를 설계한다.'
featured_image: 'https://picsum.photos/seed/multimodal-agent-benchmark-fixture/1600/900'
tags: [mka, multimodal-agent, benchmark, document-ai, evaluation]
---

![바위 절벽 아래 푸른 물로 떨어지는 폭포](https://picsum.photos/seed/multimodal-agent-benchmark-fixture/1600/900)

PDF에서 표를 읽고, 도면의 기호를 찾고, 여러 파일의 값을 join한 뒤 스프레드시트나 보고서를 완성하는 일은 단일 이미지 질의응답과 다르다. 최종 문장 하나가 맞아도 잘못된 페이지를 근거로 삼았거나 요구된 수식을 값으로 덮어썼다면 실무 과제는 실패할 수 있다.

Google DeepMind와 Artificial Analysis가 공개한 Multimodal Knowledge Agent(MKA) benchmark는 이런 시각적 knowledge work를 대상으로 한다. 본 평가는 10개 산업군과 83개 직업의 전문가가 만든 200개 task이며 Artificial Analysis가 비공개로 운영한다. 별도로 형식을 살펴보고 agent를 시험할 수 있는 10개 showcase task가 공개됐다.[1] 이 글은 공개 10문제로 로컬 fixture를 만드는 방법을 제안하지만, 실제 실행 결과나 공식 leaderboard 재현을 주장하지 않는다.

## 비공개 200개와 공개 10개는 다른 평가다

본 평가를 비공개로 두는 이유는 task가 학습 데이터나 검색으로 유출되는 것을 줄이기 위해서다. deliverable은 non-Google model 기반 agentic autorater가 파일을 열고, page를 render하고, spreadsheet formula를 검사하며 expert rubric과 대조해 채점한다. Google 발표에 따르면 domain expert가 model output을 직접 채점했을 때 autorater와 96%의 agreement를 보였다.[1]

이 96%는 “모든 rubric 항목에서 96% 정확”이나 “사람을 대체한다”는 뜻으로 확대하면 안 된다. agreement의 상세 단위와 불일치 분포는 technical report의 정의를 따라야 한다. 또한 공개 10개는 본 평가의 일부를 그대로 공개한 것이 아니라 별도 showcase set이다.[1]

공개 dataset card는 10개 task가 GIS, 건축, RF 설계, 기계·제어, 생화학, HR 분석, 투자 분석, 역사·지도, 공공정책, 데이터 과학이라는 서로 다른 domain을 다룬다고 명시한다. 입력 workspace에는 CAD blueprint, schematic, geospatial raster, chart 같은 시각 정보가 포함되고, 산출물은 XLSX·PPTX·DOCX·JSON 또는 구조화된 보고서가 될 수 있다.[2]

따라서 로컬 10문제 점수는 “MKA 공식 점수”가 아니라 `MKA 공개 showcase 기반 내부 fixture`라고 이름 붙여야 한다.

## 최종 답만 채점하면 실패 원인을 잃는다

멀티파일 과제는 네 층으로 나누어 채점할 수 있다.

| 층 | 질문 | 실패 예시 |
|---|---|---|
| 입력 완전성 | 요구된 파일을 모두 열었는가 | 도면 부록을 누락 |
| 근거 위치 | 값이 어느 파일·페이지·영역·셀에서 왔는가 | OCR이 비슷한 표의 값을 선택 |
| 변환·join | 단위, key, 계산을 올바르게 연결했는가 | mm와 inch 혼합, 이름 충돌 |
| 최종 artifact | 형식·수식·레이아웃·내용이 요구를 충족하는가 | XLSX가 열리지만 formula가 없음 |

최종 숫자가 우연히 맞아도 근거 위치가 틀리면 회귀 시 재현하기 어렵다. 반대로 올바른 근거를 찾았지만 artifact가 깨졌다면 perception이 아니라 생성 pipeline 문제다. 한 점수로 합치기 전에 각 층의 상태를 남겨야 고칠 위치를 찾을 수 있다.

근거 record는 조직이 정의한 내부 schema임을 표시한다. 예를 들어 `evidence_id`, `source_file`, `page`, `region`, `cell_range`, `extraction_method`, `content_digest`는 MKA provider field라고 가정하지 않는다. 공개 dataset의 실제 Prompt, input path와 rubric을 원본으로 보관하고 내부 trace와 분리한다.[2]

## fixture는 task snapshot부터 고정한다

제안 fixture의 첫 artifact는 실행 로그가 아니라 snapshot manifest다. task ID, input file 목록, 각 파일 digest, rubric digest, agent·model·tool 버전, 실행 시각과 output directory를 기록한다. 공개 dataset이 이후 갱신되면 같은 task 이름 아래 다른 입력을 비교하는 일을 막기 위해 revision도 pin한다.

실행 전 검증은 다음 순서가 안전하다.

1. 10개 expected task ID와 실제 directory를 대조한다.
2. input file이 root 밖을 가리키는 symlink인지 확인한다.
3. rubric JSON이 parse되고 criterion ID가 중복되지 않는지 확인한다.
4. output directory를 task별 새 경로로 만들고 기존 정답 artifact와 격리한다.
5. 외부 network가 필요한 task인지 명시하고 기본은 차단한다.
6. timeout, 최대 tool call, 저장 용량과 허용 file type을 정한다.

공개 task에는 전문 domain 파일이 포함되므로 extension만으로 안전한 파일이라고 가정하지 않는다. macro가 있는 office 문서, 비정상 archive와 parser 취약점을 고려해 격리된 환경에서 read-only input으로 연다. agent에게 host 전체 filesystem 권한을 주지 않는다.

## 제안 rubric: evidence와 artifact를 따로 점수화한다

rubric은 공개 criterion을 보존한 채 내부 진단 항목을 추가한다. 공개 criterion의 weight를 임의로 바꾼 결과를 공식 점수처럼 쓰지 않는다. 내부 점수 예시는 다음과 같다.

- **Task completion 40:** 요구된 질문과 deliverable 항목 충족
- **Evidence grounding 25:** file·page·region·cell 근거가 실제 내용과 일치
- **Artifact integrity 20:** 파일이 열리고 schema·formula·slide·style 조건 충족
- **Transformation correctness 10:** 단위 변환, join, 계산 과정 검증
- **Operational validity 5:** timeout·parser error·누락 file 없이 종료

criterion마다 `pass`, `fail`, `not_applicable`, `invalid`를 분리한다. parser가 output을 열지 못했다면 내용상 fail과 섞기보다 invalid로 표시하고 aggregate promotion을 막는다. 정답을 알 수 없는 항목을 임의로 pass 처리하지 않는다.

spreadsheet는 표시된 값만 읽지 말고 formula와 reference를 확인한다. PDF와 slide는 text extraction뿐 아니라 render된 page에서 clipping·overlap·빈 chart를 검사한다. JSON은 schema validation 뒤 값의 근거를 본다. 이러한 검사기는 제안이며, 실제 task별 rubric과 맞춰 구현·검증하기 전에는 채점 결과를 만들 수 없다.

## OCR·시각 이해·join 실패를 분류한다

오답 하나에 여러 원인이 붙을 수 있다. 최소 taxonomy는 다음과 같다.

- **Discovery:** 필요한 file 또는 page를 열지 못함
- **Perception:** 도면 기호, chart axis, 색·위치 정보를 잘못 읽음
- **OCR:** 숫자, 단위, footnote를 잘못 인식함
- **Reference:** 맞는 값을 다른 row·legend·도면 revision에 연결함
- **Join:** 파일 간 entity key를 잘못 결합함
- **Reasoning:** 근거는 맞지만 계산·해석이 틀림
- **Artifact:** 내용은 맞지만 요구 파일이 깨지거나 상태가 다름
- **Grader:** 실제로는 맞는데 parser 또는 rubric이 실패시킴

하나의 run을 분석할 때 evidence ID에서 artifact criterion까지 연결한다. 예를 들어 spreadsheet 셀 `Summary!F12`의 값이 어느 PDF page와 원본 workbook cell에서 왔는지 trace한다. 중간 변환을 저장하지 않는 agent는 최종 답을 맞혀도 grounding 점수를 받지 못하도록 내부 정책을 세울 수 있다. 다만 이 정책은 공식 MKA 규칙이라고 부르지 않는다.

## grader도 회귀 테스트 대상이다

MKA 발표는 agentic autorater가 page render와 formula 검사까지 수행한다고 설명한다.[1] 로컬 grader 역시 model이나 parser를 쓰게 되면 자체 오류를 낼 수 있다. 그래서 작은 gold set을 사람이 검토해 grader를 먼저 시험해야 한다.

제안하는 grader control은 세 종류다.

1. **정상 artifact:** 모든 기준을 통과하도록 사람이 만든 최소 파일
2. **단일 결함 artifact:** 값, formula, page evidence, layout 중 하나만 의도적으로 깨뜨린 파일
3. **적대적 artifact:** 숨은 sheet, 흰색 글자, stale cached value, 잘못된 extension처럼 parser를 속일 수 있는 파일

각 control에서 기대 criterion만 바뀌는지 본다. grader model을 교체하거나 office renderer 버전을 올리면 control 전체를 다시 실행한다. 사람과의 agreement가 높아도 특정 domain, file type 또는 실패 유형에서 편향될 수 있으므로 aggregate 하나만 보고 승인하지 않는다.

**결과 보고는 공식 leaderboard와 선을 그어야 한다.** 결과표 제목에는 dataset revision, 공개 showcase, agent build, tool set와 실행 예산을 넣는다. Google 발표에 따르면 본 평가에서 시험한 model들은 task당 평균 30~130 turn을 사용해 효율 차이가 컸다.[1] 따라서 성공률만 비교하면 turn과 비용 차이를 숨긴다.

보고할 항목은 task 성공률, rubric criterion 통과율, invalid run, 평균·p95 turn, tool call, wall time, token과 비용이다. 실패 사례에는 입력 digest와 output artifact를 연결하되 민감 정보가 없는 공개 task에만 공유한다.

다음 표현은 피한다.

- “MKA를 재현했다” — 비공개 200개와 공식 운영 grader를 재현하지 않았다.
- “전문가 수준이다” — 10개 showcase는 일반 직무 능력의 충분한 표본이 아니다.
- “96% 정확한 자동 채점” — 발표의 expert agreement 맥락을 정확도 보증으로 바꾼다.
- “PDF benchmark” — MKA는 여러 시각 파일과 deliverable 상태를 함께 다룬다.

## 실행 전 판정표

- 공개 10개와 비공개 200개를 이름과 결과표에서 분리한다.
- dataset revision, task·input·rubric digest를 고정한다.
- 원본 rubric과 내부 진단 rubric을 별도 namespace로 둔다.
- evidence 위치, 변환, 최종 artifact를 서로 다른 상태로 채점한다.
- office·PDF·도면 parser를 격리하고 input을 read-only로 연다.
- 정상·단일 결함·적대적 control로 grader를 먼저 시험한다.
- 10문제 결과를 공식 leaderboard나 일반 업무 성능으로 확대하지 않는다.
- fixture를 실제로 실행하기 전에는 수치나 성공 사례를 쓰지 않는다.

멀티모달 agent 평가는 “답이 맞나”에서 끝나지 않는다. 어느 파일의 어느 시각 근거를 사용했고, 파일 간 변환이 맞았으며, 요구된 artifact가 실제로 열리고 편집 가능한 상태인지까지 봐야 한다. MKA 공개 10문제는 이 pipeline을 설계할 재료가 되지만, 비공개 본 평가의 대체물은 아니다.

## Sources

[1] https://blog.google/innovation-and-ai/models-and-research/gemini-models/multimodal-knowledge-agent-benchmark/
[2] https://huggingface.co/datasets/google/multimodal-knowledge-agent
