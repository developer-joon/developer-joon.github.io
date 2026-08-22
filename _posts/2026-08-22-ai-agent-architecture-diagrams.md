---
title: 'Mermaid 다음 단계: AI 코딩 에이전트가 만드는 실전 아키텍처 다이어그램'
date: 2026-08-22 09:00:00 +0900
categories: ["AI 에이전트"]
description: 'AI 코딩 에이전트가 아키텍처 다이어그램을 만들 때 예쁜 그림보다 검증 가능한 구조와 코드 diff 연계를 우선해야 하는 이유와 실전 운영 방식을 정리한다.'
featured_image: 'https://picsum.photos/seed/ai-agent-architecture-diagrams/1600/900'
tags: [ai-agent, architecture, diagram, mermaid, svg, code-review, documentation]
---

![AI 코딩 에이전트 아키텍처 다이어그램](https://picsum.photos/seed/ai-agent-architecture-diagrams/1600/900)

Mermaid는 개발 문서의 다이어그램 제작 방식을 바꿨다. 텍스트로 작성하고 Git에 저장하며, pull request에서 변경 내용을 검토할 수 있다. 별도 디자인 파일을 찾지 않아도 되고 Markdown 안에서 코드와 설명을 함께 관리할 수 있다는 장점도 크다.

하지만 실제 시스템을 설명하는 그림에서는 곧 한계가 드러난다. 자동 layout이 중요한 흐름을 엉뚱한 위치에 놓고, 노드가 늘어날수록 선이 교차하며, 제품 경계와 trust boundary가 비슷한 상자로 표현된다. 결국 개발자는 "문법상 맞는 그림"을 얻지만 독자는 무엇을 먼저 봐야 하는지 알기 어렵다.

최근 AI 코딩 에이전트는 이 빈틈을 채우기 시작했다. 저장소를 읽고 시스템 구조를 추론한 뒤 HTML과 SVG로 편집 품질에 가까운 시각 자료를 생성한다. `diagram-design` 프로젝트는 다양한 diagram type, 브랜드 token, Mermaid와 draw.io 가져오기, 자체 검사와 export workflow를 제공하는 사례다.[1] 중요한 변화는 그림을 더 화려하게 만드는 데 있지 않다. 시각 자료도 코드처럼 **근거를 추적하고 diff를 검토하며 재생성할 수 있는 artifact**가 된다는 데 있다.

## 문제는 표현력이 아니라 신뢰성이다

아키텍처 다이어그램은 대개 사실과 해석이 섞인 문서다. 서비스 이름, API 연결, database 종류는 저장소에서 확인할 수 있는 사실이다. 반면 "핵심 경로", "보안 경계", "병목", "향후 분리할 영역"은 작성자의 해석이다. AI가 둘을 구분하지 않으면 그럴듯하지만 존재하지 않는 구성 요소를 추가하거나, 실제 dependency를 보기 좋다는 이유로 생략할 수 있다.

예를 들어 에이전트가 다음 자료를 읽었다고 하자.

- `docker-compose.yml`에는 API, PostgreSQL, Redis가 있다.
- Kubernetes manifest에는 worker deployment가 있다.
- 애플리케이션 코드에는 외부 결제 API client가 있다.
- 오래된 README에는 더 이상 사용하지 않는 message broker가 남아 있다.

단순한 생성 prompt는 이 정보를 한 장에 섞을 가능성이 높다. 그러면 그림은 풍부해 보이지만 현재 상태를 나타내는지, 계획 상태를 나타내는지 알 수 없다. 아키텍처 문서에서 가장 위험한 오류는 못생긴 상자가 아니라 **사실처럼 보이는 추정**이다.

따라서 에이전트에게 "우리 시스템을 예쁘게 그려줘"라고 요청하기 전에 source of truth와 표현 규칙을 정해야 한다. 파일에서 확인된 구성 요소, 실행 중인 환경에서 관찰된 연결, 사람이 제공한 설계 의도를 서로 다른 provenance로 다루는 편이 안전하다.

## 실전 구조는 수집·정규화·표현·검증으로 나뉜다

AI 다이어그램 workflow를 한 번의 생성 단계로 만들면 수정할 때마다 결과가 흔들린다. 운영 가능한 구조는 최소 네 단계로 나누는 것이 좋다.

```text
Repository / IaC / API spec / runtime inventory
                    ↓
          Evidence collection
                    ↓
       Architecture IR + provenance
                    ↓
       HTML/SVG visual rendering
                    ↓
       Structural and visual checks
```

첫 단계는 evidence collection이다. 에이전트는 package dependency, deployment manifest, network policy, OpenAPI 문서, Terraform resource를 읽고 후보 관계를 수집한다. 이때 파일 경로와 line range, commit SHA를 함께 남겨야 한다.

두 번째는 중간 표현, 즉 architecture IR이다. 화면 좌표를 바로 만들지 말고 component, relation, group, direction, evidence를 YAML이나 JSON으로 구조화한다.

세 번째가 visual rendering이다. 여기서 architecture, sequence, data flow, deployment 같은 문법을 선택하고 정보 우선순위에 따라 위치, 크기, accent를 정한다. `diagram-design`처럼 semantic behavior와 layout type을 분리하면 queue나 trust boundary를 무조건 새로운 모양으로 만들지 않고 기존 시각 문법에 일관되게 표현할 수 있다.[1]

마지막은 검증이다. SVG가 브라우저에서 보인다는 사실만으로는 부족하다. source component가 모두 표현됐는지, 존재하지 않는 관계가 들어갔는지, label이 잘리지 않는지, 연결선이 의미 없이 교차하지 않는지 확인해야 한다.

## 검증 가능성을 그림 안에 설계한다

좋은 AI 생성 다이어그램은 독자가 "왜 이렇게 그렸는가"를 확인할 수 있다. 이를 위해 세 종류의 검증 장치를 둘 수 있다.

### 1. 구성 요소별 evidence ledger

각 node와 edge에 근거 ID를 연결한다. 최종 PNG에는 모든 경로를 노출할 필요가 없지만, 원본 HTML이나 동반 Markdown에는 evidence table을 둔다.

| 요소 | 주장 | 근거 | 상태 |
| --- | --- | --- | --- |
| `web → api` | HTTPS 요청 | `frontend/src/client.ts` | 확인 |
| `api → redis` | cache read/write | `api/cache.py` | 확인 |
| `api → billing` | 결제 승인 호출 | `clients/billing.ts` | 확인 |
| `worker → warehouse` | 비동기 적재 | 설계 문서만 존재 | 계획 |

이 표가 있으면 reviewer는 그림의 미학보다 사실 여부를 먼저 검토할 수 있다. 확인된 현재 상태와 계획 상태는 선 모양이나 label로도 구분해야 한다.

### 2. machine-readable source 유지

HTML/SVG만 저장하면 다음 수정에서 에이전트가 다시 그림을 해석해야 한다. architecture IR을 별도 YAML이나 JSON으로 유지하면 구조 변경과 시각 변경을 분리할 수 있다. component 추가는 IR diff로, 색상과 간격 변경은 template diff로 드러난다.

### 3. 검증 결과를 영수증처럼 남기기

생성 결과에는 입력 commit, 읽은 파일, 제외한 파일, 합치거나 생략한 요소, 실행한 검사와 결과를 남긴다. Mermaid나 draw.io를 다시 그릴 때도 어떤 node를 유지하고 어떤 annotation을 버렸는지 fidelity ledger를 제공해야 한다. `diagram-design`이 import 과정의 collapse·drop 내역을 기록하는 방식은 이런 검증 가능성에 초점을 둔 예다.[1]

## 코드 diff와 그림 diff를 한 PR에서 연결한다

다이어그램이 저장소와 분리되는 가장 흔한 순간은 기능 변경 PR이다. 새 queue를 추가하고도 그림을 업데이트하지 않거나, 그림만 바꿨는데 실제 배포 manifest에는 변화가 없는 경우다. 에이전트는 이 간극을 자동으로 탐지하는 역할에 적합하다.

PR workflow는 다음처럼 구성할 수 있다.

1. base와 head commit 사이의 코드·IaC diff를 수집한다.
2. architecture 관련 변화만 분류한다.
3. 기존 IR의 영향받는 node와 edge를 찾는다.
4. 최소 변경 patch를 제안한다.
5. HTML/SVG를 deterministic하게 재생성한다.
6. 구조 diff와 render preview를 PR에 첨부한다.
7. reviewer가 code change와 diagram change를 함께 승인한다.

핵심은 전체 그림을 매번 새로 생성하지 않는 것이다. 에이전트가 모든 좌표와 문구를 다시 결정하면 작은 코드 변경도 거대한 visual diff를 만든다. stable ID, 고정된 layout grammar, deterministic token과 sort order를 사용해야 실제 변화만 보인다.

PR 설명에는 코드 경로, IR 요소, 그림에서 바뀐 group, evidence line과 변경되지 않은 영역을 함께 적을 수 있다. 이 정도 연결성이 있으면 다이어그램 리뷰가 주관적인 감상에서 변경 검증으로 이동한다.

## 시각 품질과 정보 보존 사이의 트레이드오프

AI 에이전트는 한 화면에 모든 정보를 넣으려는 경향이 있다. 그러나 아키텍처 그림은 inventory가 아니다. 정보량이 늘수록 정확해질 것 같지만 실제로는 핵심 경로가 묻힌다.

첫 번째 trade-off는 **충실도와 가독성**이다. 모든 sidecar와 topic을 표시하면 운영자에게는 유용하지만 신규 개발자는 흐름을 읽기 어렵다. 해결책은 한 장의 만능 그림이 아니라 audience별 view다. executive overview, developer component view, deployment view를 같은 IR에서 생성하면 사실은 공유하면서 detail만 조절할 수 있다.

두 번째는 **자동 layout과 수동 제어**다. 완전 자동은 유지보수가 쉽지만 중요한 구성 요소의 위치가 자주 흔들린다. 완전 수동 좌표는 품질이 좋지만 변경 비용이 높다. group과 rank만 사람이 고정하고 세부 배치는 deterministic rule에 맡기는 혼합 방식이 현실적이다.

세 번째는 **브랜드 일관성과 접근성**이다. 제품 색상을 그대로 가져오면 작은 label에서 contrast가 부족할 수 있다. 배경, 본문, muted, accent를 semantic token으로 나누고 WCAG contrast, SVG `title`과 `desc`, reduced-motion fallback을 검사해야 한다. 화려한 animation은 설명 순서가 중요한 경우에만 쓰고 static first frame만으로도 전체 의미가 전달돼야 한다.

## 실패를 먼저 가정한 운영 방식

에이전트가 잘못된 그림을 만들 수 있다는 전제에서 pipeline을 설계해야 한다. 다음과 같은 failure mode가 자주 발생한다.

- 이름이 비슷한 서비스를 하나로 합친다.
- static dependency를 runtime 호출로 오해한다.
- test fixture의 외부 endpoint를 production dependency로 표시한다.
- 오래된 문서를 현재 구조로 판단한다.
- 양방향 관계를 임의로 만든다.
- 보이지 않는 label overflow와 겹친 edge를 남긴다.
- 실제 변경과 무관한 위치를 대량으로 재배치한다.

구조 검사는 schema validation, duplicate ID, dangling edge, evidence 없는 relation, 허용하지 않은 external domain을 확인해야 한다. render 검사는 headless browser에서 viewport별 clipping, font loading, contrast, overlapping을 확인한다. 마지막으로 사람은 trust boundary, 데이터 분류, 장애 전파처럼 코드만으로 확정하기 어려운 의미를 검토한다.

"검사를 통과했다"는 표현도 범위를 명확히 해야 한다. HTML 문법과 element overlap을 통과한 것이 아키텍처 사실성을 보장하지 않는다. 자동 검증 결과와 사람 승인 영역을 분리해서 기록해야 한다.

## 실무 체크리스트

### 입력과 근거

- 현재 상태와 목표 상태를 분리했는가
- source of truth의 우선순위를 정했는가
- 각 node와 edge에 file·line·commit 근거가 있는가
- test, example, archived 문서를 입력에서 제외했는가
- 근거가 없는 추정을 명시적으로 표시했는가

### 구조와 표현

- audience와 다이어그램 목적이 한 문장으로 설명되는가
- architecture, sequence, deployment 중 맞는 문법을 선택했는가
- component ID와 group이 재생성 후에도 안정적인가
- 핵심 경로와 trust boundary가 시각적으로 구분되는가
- 삭제하거나 합친 정보가 ledger에 남는가

### PR과 자동화

- code diff에서 architecture impact를 탐지하는가
- IR diff와 render diff를 모두 제공하는가
- 무관한 node 재배치를 막는 deterministic rule이 있는가
- preview가 동일 commit에서 생성됐는가
- 다이어그램 미갱신을 warning으로 할지 required check로 할지 정했는가

### 품질과 접근성

- 여러 viewport에서 label clipping을 검사했는가
- 색상만으로 상태를 구분하지 않는가
- SVG에 접근 가능한 제목과 설명이 있는가
- motion 없이도 전체 의미를 이해할 수 있는가
- PNG export와 원본 HTML/SVG가 같은 revision인가

## 결론

Mermaid의 가장 큰 장점은 다이어그램을 코드 review 흐름으로 가져온 것이다. AI 코딩 에이전트의 다음 단계는 이를 버리고 더 예쁜 그림을 만드는 일이 아니다. 구조화된 근거, editorial layout, 자동 검증을 결합해 **시각 품질을 높이면서도 code diff와의 연결을 잃지 않는 것**이다.

실전에서 신뢰할 수 있는 그림은 한 번 잘 그린 그림이 아니다. 어떤 source에서 어떤 주장을 가져왔는지, 코드가 바뀌었을 때 무엇이 달라졌는지, 에이전트가 무엇을 생략했는지 확인할 수 있는 그림이다.

다이어그램을 binary asset가 아니라 build artifact로 취급하면 문서 부채도 줄일 수 있다. 다만 최종 목표는 자동 생성률이 아니다. reviewer가 시스템의 실제 구조와 그림 사이의 차이를 빠르게 발견하도록 만드는 것이 목표다. 예쁜 결과는 그 위에 올라가는 품질이지, 검증 가능성을 대체하는 근거가 아니다.

## 참고자료

- [1] [GitHub: cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)
