---
title: 'GPT가 PCB와 케이스까지 설계한 뒤 반복 검토가 필요했던 이유: 제조 가능성 검증법'
date: 2026-11-03 09:00:03 +0900
categories: ["AI 에이전트"]
description: 'OpenAI의 Astra 장치 설계 사례를 바탕으로 CAD·PCB·firmware 생성과 실제 제조 가능성을 분리하고, 공차·간섭·BOM·조립 규칙을 검증하는 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-openai-index-accelerating-engineering-for-the-physical-world/1600/900'
tags: [openai, gpt-6-astra, cad, pcb, kicad, freecad, manufacturing, engineering-agent]
---

![회로기판과 분해된 케이스 부품 위에 놓인 설계 도면](https://picsum.photos/seed/news-2026-11-03-openai-index-accelerating-engineering-for-the-physical-world/1600/900)

화면에 멋진 3D rendering이 나왔다고 제품을 제조할 수 있는 것은 아니다. Connector가 케이스에 가려지거나, 나사 boss가 PCB 부품과 충돌하거나, 공정의 최소 벽 두께를 지키지 않으면 CAD 파일이 열려도 설계는 실패다.

OpenAI는 2026년 11월 3일 GPT-6 Astra로 enclosure, PCB, firmware, Codex 연동을 포함한 test device를 설계한 사례를 공개했다. 두 명의 팀원이 side project로 일주일 이내 설계했고 contract manufacturer가 한 달 이내 소량 prototype을 제작했다고 설명한다.[1]

## 데모 성공과 제조 성공은 다르다

Astra는 외형, 내부 component 고정 구조, electrical component 선택과 PCB 배치·연결, UI와 firmware를 만들었다.[1] 이 범위는 인상적이지만 OpenAI는 제조 준비 과정에서 여러 차례 review와 iteration이 필요했다고 함께 밝혔다.

특히 Astra가 manufacturer의 생산 한계, tolerance, assembly detail을 일관되게 반영하지 못했다.[1] 이 문장이 물리 engineering agent 평가의 핵심이다. 설계 파일 생성과 manufacturability는 별도 gate여야 한다.

| Gate | 질문 |
|---|---|
| 형식 | CAD·PCB 파일이 tool에서 열리는가 |
| 기하 | 부품 간섭과 clearance가 맞는가 |
| 전기 | ERC·DRC와 power 조건을 통과하는가 |
| 제조 | 공정의 최소 치수·공차를 지키는가 |
| 조립 | 공구 접근과 순서가 가능한가 |
| 공급 | BOM 부품을 실제로 구할 수 있는가 |
| 검증 | Prototype이 요구 기능을 수행하는가 |

앞 gate를 통과했다고 뒤 gate를 건너뛰지 않는다.

## 요구사항을 자연어로만 남기지 않는다

“작고 튼튼한 sensor enclosure”는 검사할 수 없다. Agent에게 주는 요구사항을 machine-checkable constraint로 바꿔야 한다.

```text
enclosure_max_mm = [100, 70, 30]
minimum_wall_mm = 1.6
pcb_clearance_mm = 1.0
connector_keepout_mm = 3.0
screwdriver_access_deg = 15
assembly_count_max = 8
operating_temperature_c = [0, 45]
```

숫자는 예시이며 실제 공정과 material에서 가져와야 한다. 요구사항 source와 owner, 변경 이유도 version control에 둔다. Agent가 constraint를 바꿔 문제를 “해결”하지 못하게 한다.

## CAD와 PCB 검사는 서로 연결돼야 한다

Mechanical CAD만 검사하면 component 높이와 connector 위치를 놓치고, PCB DRC만 검사하면 enclosure 간섭을 놓친다. Board outline, mounting hole, keepout, tallest component, cable bend radius를 공통 coordinate system으로 교환해야 한다.

간단한 sensor board fixture에서는 다음 검사를 자동화할 수 있다.

- PCB가 enclosure 내부 volume 안에 있는가
- mounting hole 축이 standoff와 일치하는가
- component bounding box가 lid와 충돌하지 않는가
- USB·전원 connector 앞에 삽입 공간이 있는가
- 나사와 드라이버가 다른 부품을 통과하지 않는가
- ventilation opening이 금지 영역을 침범하지 않는가

FreeCAD나 KiCad의 built-in 검사 결과와 제조사별 rule checker를 분리한다. Built-in DRC 통과는 특정 제조사의 capability 승인과 같지 않다.

## 검증 fixture는 작은 장치부터 시작한다

아래는 **실행하지 않은 제안 fixture**다. 실제 판매 제품이 아니라 낮은 위험의 sensor enclosure를 대상으로 한다.

```text
Input
- 고정된 sensor board와 connector 위치
- enclosure 외형 상한
- printer 또는 CNC의 제조 규칙
- screw와 insert catalog

Output
- parametric CAD
- PCB outline/placement
- BOM
- assembly drawing
- rule-check report
```

실패를 의도적으로 주입한다.

1. Connector cutout을 2mm 옮긴다.
2. Lid를 얇게 만들어 최소 벽 두께를 위반한다.
3. Screw head가 component와 겹치게 한다.
4. BOM의 connector를 단종 부품으로 바꾼다.
5. 조립 마지막 단계에서 screwdriver가 들어갈 수 없게 한다.

좋은 agent는 보기 좋은 rendering을 다시 만드는 것이 아니라 어느 rule이 어떤 geometry에서 깨졌는지 보여주고, 수정 뒤 검사를 다시 실행해야 한다.

## BenchCAD 점수의 경계

OpenAI는 BenchCAD 2.0이 3D part와 assembly 재구성, circuit board connection 식별을 평가한다고 설명했다. 더 새로운 내부 모델은 평균 0.875, GPT-6 Astra의 최고 reasoning 설정은 0.594를 기록했다고 발표했다.[1]

이는 OpenAI 내부 평가다. 점수가 0.875라고 해서 실제 제조 성공률이 87.5%라는 뜻은 아니다. Engineering lifecycle에는 material, tolerance stack-up, thermal, compliance, supply chain, test fixture처럼 benchmark 밖 요소가 많다.

모델 비교에는 benchmark score와 실제 gate pass rate를 따로 둔다.

```text
benchmark_score
cad_parse_success
geometric_rule_pass
pcb_erc_drc_pass
manufacturer_review_findings
assembly_attempts
prototype_functional_tests
```

## 사람 review는 실패가 아니라 설계 요소다

OpenAI 사례에서 제조까지 사람의 여러 차례 review가 필요했다.[1] 이를 “완전 자동화 실패”로만 볼 필요는 없다. 물리 제품은 수정 비용과 안전 영향이 커서 독립 review가 정상적인 gate다.

중요한 것은 review가 informal chat에만 남지 않는 것이다. Finding마다 artifact revision, 위치, 규칙, severity, 수정 결과를 기록한다. Agent가 만든 다음 revision이 앞 finding을 되살리지 않았는지 regression check한다.

권한 경계도 분명해야 한다.

- Agent는 설계와 simulation job을 제안할 수 있다.
- Tool은 deterministic rule을 실행한다.
- Engineer가 제조 drawing과 BOM을 승인한다.
- Manufacturer가 process capability를 확인한다.
- Prototype test가 기능을 검증한다.

## 물리 세계에서는 실행 비용이 비대칭이다

Software bug는 rollback할 수 있지만 잘못 제작한 PCB와 금형은 물리 비용과 시간이 든다. 그래서 agent의 속도가 빨라질수록 제조 전 gate를 더 명확히 해야 한다.

OpenAI 사례가 보여주는 가장 현실적인 결론은 AI가 CAD와 PCB를 만들 수 있다는 사실과, 제조 가능한 제품을 독립적으로 검증해야 한다는 사실이 동시에 참이라는 점이다. 평가 목표를 rendering 품질이나 파일 생성 성공에 두지 말고, 요구사항 traceability, 자동 검사, 제조사 rule, assembly review, prototype test까지 이어지는 evidence chain에 둬야 한다.

## Sources

[1] https://openai.com/index/accelerating-engineering-for-the-physical-world
