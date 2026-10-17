---
title: 'Service Graph를 끄지 않고 메트릭 비용 줄이기: latency histogram의 실제 cardinality'
date: 2026-10-17 07:10:00 +0900
categories: ["관측성"]
description: 'Grafana Cloud connection KPI GA 설정을 all KPI, requests+errors, topology-only로 나누고, stack-wide 변경·retention·label cardinality·tail latency 손실을 수치와 쿼리로 검증한다.'
featured_image: 'https://picsum.photos/seed/grafana-connection-kpi-metrics-cost/1600/900'
tags: [grafana-cloud, service-graph, prometheus, cardinality, histogram, metrics-cost, tail-latency]
---

![Grafana connection KPI와 latency histogram cardinality](https://picsum.photos/seed/grafana-connection-kpi-metrics-cost/1600/900)

Service Graph 비용이 커졌다고 graph 전체를 끄는 것은 가장 큰 스위치부터 내리는 대응이다. 연결 topology까지 사라지면 incident 때 “어느 서비스가 어느 서비스를 부르는가”라는 첫 질문에 답하기 어려워진다. Grafana Labs는 2026년 10월 14일 Grafana Cloud에서 **connection KPI 선택 기능을 GA로 공개**했다.[1] 이 기능은 inbound·outbound service connection마다 생성하는 성능 지표의 양을 줄이면서 service graph 자체는 유지하게 한다. 선택지는 all KPIs, requests and errors, no KPIs의 세 단계다.[1]

Latency histogram은 counter보다 훨씬 많은 series를 만든다. Histogram을 제거하면 request와 error 흐름은 남지만 connection별 p95·p99를 계산할 재료는 없어진다. KPI를 모두 끄면 연결 관계만 남고 request, error, latency series는 생성되지 않는다. 이 변경은 service별 자체 RED metric을 건드리지 않는다.[1] 그러나 “service 자체 latency가 남는다”와 “어느 downstream 연결이 tail을 만들었는지 알 수 있다”는 같은 말이 아니다.

이 글은 connection KPI를 단순한 비용 toggle로 다루지 않는다. 먼저 어떤 metric family와 label tuple이 series를 만드는지 센다. 그다음 all KPI, requests+errors, topology-only의 진단력을 비교한다. 마지막으로 stack-wide 변경과 retention 때문에 생기는 관측 지연을 rollout 조건에 넣는다. 결론은 **histogram을 끄는 일은 topology 보존과 tail-latency 포기의 교환이며, 절감률은 bucket 수보다 label tuple 수에 더 크게 흔들린다**는 것이다.

## 이번 GA가 바꾸는 범위

Connection KPI 설정은 Grafana Cloud의 **Observability → Configuration → Traces metrics generation → Service graph**에서 바꾼다.[2] Knowledge graph가 활성화돼 있고 traces가 Grafana Cloud로 들어오며 admin 권한이 있어야 한다.[2] 설정은 개별 service나 개별 connection이 아니라 **stack-wide**로 적용된다.[1] 한 팀이 비용을 줄이려고 바꾸면 같은 stack을 쓰는 다른 팀의 connection latency panel도 영향을 받는다. 따라서 개인 dashboard 최적화처럼 변경하면 안 된다.

`Generate all KPIs`는 request, error, latency를 유지한다.[1] `Generate requests and errors`는 latency histogram을 제거하고 traffic과 error를 남긴다.[1] `Don’t generate KPIs`는 연결 관계만 남긴다.[1] 이 마지막 모드는 service graph를 완전히 비활성화하는 것과 다르다. Topology를 그리는 관계 정보는 유지하지만 connection table의 성능 수치는 비어진다.

Connection KPI 선택은 connected-service metric만 바꾼다. 각 service 자체의 rate, error, duration metric과 operations view는 그대로 남는다.[1][2] 기존에 수집하던 application metric이나 span metric도 이 toggle 하나로 삭제되지 않는다. 이미 생성된 connection series 역시 즉시 삭제되지 않는다. 새 sample 생성이 멈춰도 과거 sample은 retention이 끝날 때까지 query에 남는다.[1]

Grafana Cloud 기능이라는 범위도 지켜야 한다. 이 GA 발표를 self-managed Grafana, Mimir, Tempo의 동일한 UI 기능 출시로 확대하면 안 된다. Self-managed 환경은 Tempo metrics-generator나 Alloy servicegraph connector의 processor·histogram 설정으로 비슷한 결과를 만들 수 있지만 운영 계약이 다르다.[3] Cloud stack의 중앙 UI, billing, retention 동작을 self-managed 설치에 그대로 적용할 수 없다.

## Service Graph가 만드는 metric family

Service graph processor는 trace의 parent-child 관계에서 client와 server pair를 찾는다. Grafana 문서는 연결별 request counter, failed request counter, client 관측 latency histogram, server 관측 latency histogram을 설명한다.[4] 대표 이름은 `traces_service_graph_request_total`, `traces_service_graph_request_failed_total`, `traces_service_graph_request_client_seconds`, `traces_service_graph_request_server_seconds`다.[4] Classic histogram이면 latency metric마다 `_bucket`, `_sum`, `_count` series가 생긴다. Native histogram이면 저장 모델과 series 계산이 달라지므로 classic 공식에 그대로 넣으면 안 된다.

모든 series에는 최소한 client와 server label이 붙는다.[3] `connection_type` 같은 label이 추가될 수 있다. Cloud 설정에서 instance label과 additional dimension을 켜면 가능한 label 조합이 더 늘어난다.[2] Label cardinality를 볼 때는 각 label의 unique value 수를 단순 곱한 최댓값만으로 판단하지 않아야 한다. 실제로 관측된 조합 수가 series 수를 결정한다. 그래도 배포 전 upper bound와 실측 tuple count를 함께 계산하면 갑작스러운 폭증을 막을 수 있다.

Connection 한 개는 화면의 선 하나처럼 보이지만 metric tuple은 하나가 아닐 수 있다. Production과 staging이 같은 client-server pair를 호출하면 environment label로 둘이 된다. HTTP method를 dimension으로 넣으면 GET, POST, DELETE가 별도 tuple이 된다. Instance ID를 넣으면 replica 수만큼 늘 수 있다. Trace ID나 request ID처럼 사실상 무한한 값을 metric label로 켜면 connection KPI보다 dimension 선택이 비용의 지배 항이 된다.

Grafana Cloud 설정 화면은 dimension별 cardinality를 보여 주고 high-cardinality attribute가 bill을 늘릴 수 있다고 경고한다.[2] Region이나 cloud provider는 보통 instance ID나 trace ID보다 variation이 작다. Cardinality Management와 Metrics Detail dashboard에서 실제 series를 확인할 수 있다.[2] 새 dimension은 유용성 증거 없이 켜지 않는다. Connection KPI를 낮추기 전에 불필요한 dimension과 duplicate generator가 없는지도 본다.

## 세 가지 모드의 series를 계산한다

다음 추산은 **classic histogram**을 쓰는 가상의 stack이다. Directed client→server edge가 40개라고 가정한다. 각 edge에는 environment와 connection type 조합이 실제로 3개씩 관측된다고 가정한다. 따라서 label tuple은 `40 × 3 = 120`개다. Classic latency bucket은 10개라고 가정한다. Grafana Cloud 문서의 기본 classic bucket 목록도 10개 경계를 제시하지만 조직이 수정할 수 있다.[2]

Counter 두 개는 tuple당 2 series다. 명시한 경계 10개 외에 자동 `+Inf` bucket이 하나 더 생기므로 Client latency histogram 하나는 bucket 11개, sum 1개, count 1개로 13 series다. Server latency histogram도 같은 13 series다. 따라서 all KPI는 tuple당 `2 + 13 + 13 = 28` series다. 전체 추산은 `120 × 28 = 3,360 active series`다. Requests+errors는 `120 × 2 = 240 active series`다. Connection KPI 관점의 topology-only는 request·error·latency series를 만들지 않으므로 0개다.

```text
assumptions:
  directed_edges = 40
  observed_label_tuples_per_edge = 3
  classic_buckets = 10
  latency_histograms = 2  # client + server

all_kpi = 40 × 3 × (2 counters + 2 × (10 explicit buckets + Inf + sum + count))
        = 3,360 series

requests_errors = 40 × 3 × 2 counters
                = 240 series

topology_only_connection_kpi = 0 series
```

이 가정에서 histogram을 내리면 3,120 series가 줄고 connection KPI series 기준 감소율은 **92.86%**다. Grafana Cloud Pro 공개 list price인 월 1,000 series당 6.50달러를 단순 적용하면 월 **20.28달러 상당**이다.[5] 그러나 이 금액을 실제 invoice 절감으로 단정하면 안 된다. Free allowance, platform fee, host-hour product billing, volume discount, contract, 이미 포함된 usage가 다를 수 있다. Knowledge graph 문서도 별도 제품 가격 대신 기존 metrics usage나 host/container 기반 청구와 연결된다고 설명한다.[6]

가정이 바뀌면 결과가 크게 달라진다. Edge당 label tuple이 1개면 all KPI는 1,120 series이고 requests+errors는 80 series다. Tuple이 12개면 각각 13,440 series와 960 series다. Bucket을 10개에서 20개로 늘리는 것보다 instance 같은 dimension이 tuple을 3개에서 30개로 늘리는 편이 더 큰 폭증을 만들 수 있다. 따라서 bucket 수와 label tuple 수를 같은 표에서 관리해야 한다.

이 계산에는 dropped-span이나 unpaired-span 같은 processor 자체 상태 metric이 포함되지 않았다. Service 자체 span metric도 포함하지 않았다. Native histogram의 내부 bucket 비용도 포함하지 않았다. Dual classic+native 모드는 migration 외에는 비용을 높일 수 있고 Grafana 문서는 두 형식을 함께 쓰면 bucket 수와 비용이 늘어난다고 경고한다.[2] 실제 invoice와 맞추려면 Mimir usage, active-series export, contract 단가를 함께 읽어야 한다.

## 실제 series inventory를 만드는 쿼리

설정 전에는 metric name별 active series를 센다. Grafana Cloud의 Prometheus-compatible backend에서는 현재 활성 series를 직접 조회하는 cardinality dashboard를 우선 사용한다. Dashboard가 없다면 제한된 시간 범위에서 series tuple을 group하고 count하는 recording query를 만든다. Query 비용이 큰 production stack에서 무제한 label enumeration을 실행하지 않는다. 먼저 metric family와 environment를 좁힌다.

```promql
count({__name__=~"traces_service_graph_request_(total|failed_total|client_seconds_bucket|client_seconds_sum|client_seconds_count|server_seconds_bucket|server_seconds_sum|server_seconds_count)"})
```

Backend의 naming이 `_seconds` 대신 다른 suffix를 쓸 수 있으므로 실제 metric explorer에서 이름을 확인한다. 다음 query는 classic server histogram의 edge·environment별 bucket 수를 보여 주는 예시다.

```promql
count by (client, server, deployment_environment) (
  traces_service_graph_request_server_seconds_bucket
)
```

Bucket series는 `le` label 때문에 같은 edge tuple 안에서도 여러 줄이다. `_sum`과 `_count`를 빼면 histogram 총 series를 과소 계산한다. Client와 server histogram 가운데 하나만 세도 절감량을 절반 가까이 놓친다. Requests와 failures counter가 label set을 정확히 공유하는지도 확인한다. Missing server span이나 virtual node 때문에 family별 tuple 수가 다를 수 있다.

변경 전 inventory에는 최소 일주일의 peak를 포함한다. Deployment 때 잠깐 생기는 canary service, autoscaling instance, batch namespace가 평시 snapshot에는 빠질 수 있다. Active series는 traffic이 없는 edge에서 사라질 수 있으므로 business peak와 incident window를 함께 본다. Cost estimate에는 평균뿐 아니라 일별 maximum을 기록한다. Cardinality limit에 닿아 series가 이미 drop되고 있다면 관측값이 실제 demand보다 낮을 수 있다.[7]

## Tail latency를 잃는다는 뜻

Request counter로 rate를 계산할 수 있다. Failed counter로 error ratio를 계산할 수 있다. 하지만 이 둘로 duration distribution을 복원할 수는 없다. Requests+errors 모드는 느리지만 성공한 호출과 빠른 성공 호출을 같은 성공으로 센다. 그래서 downstream timeout 직전의 p99 악화가 error가 발생하기 전까지 보이지 않을 수 있다.

Histogram은 관측값을 bucket에 누적한다. Classic histogram의 p95나 p99는 `histogram_quantile`과 bucket rate로 추정한다. Bucket boundary가 거칠면 quantile 정확도도 거칠다. Tail을 보존하려면 SLO 경계 주변에 의미 있는 bucket이 있어야 한다. Bucket을 많이 두면 해상도는 좋아지지만 series는 늘어난다.

Connection latency는 service 자체 latency와 질문이 다르다. Service RED duration은 “이 service operation이 얼마나 걸렸는가”를 보여 줄 수 있다. Connection histogram은 “client A에서 server B로 가는 edge가 얼마나 걸렸는가”를 보여 준다. 한 service가 여러 downstream을 호출할 때 자체 p99만으로 어느 edge가 tail을 만들었는지 분리하기 어렵다. Requests+errors로 내리기 전에 trace query가 이 gap을 감당할 수 있는지 시험해야 한다.

Trace가 남아 있으면 slow trace를 찾아 edge latency를 조사할 수 있다. 하지만 sampling이 있으면 rare tail이 보존되지 않을 수 있다. Metrics histogram은 모든 생성 대상 span의 집계 신호이고 trace search는 retained sample의 개별 증거다. 둘은 대체 관계가 아니다. Head sampling 비율을 inverse multiplier로 보정해 count를 추정해도 누락된 tail distribution을 복구하지는 못한다.[2]

Topology-only는 더 큰 교환이다. 연결이 존재한다는 사실은 보이지만 traffic volume도 error burst도 알 수 없다. Low-traffic 의존성인지 핵심 hot path인지 graph만 보고 구분하기 어렵다. Incident 때 topology 탐색은 가능하지만 우선순위 정렬은 다른 metric이나 trace query에 의존한다. 이 모드는 connection performance를 이미 별도 metric source에서 신뢰성 있게 제공하는 stack에 더 맞다.

## 세 모드를 같은 incident fixture로 비교한다

가상의 checkout service가 payment와 inventory를 호출한다고 하자. 정상 상태에서 payment p99는 180ms이고 error ratio는 0.2%다. 장애 주입으로 payment 응답의 1%만 4초 지연시키되 실패 status는 반환하지 않는다. Inventory는 그대로 둔다. 이 fault는 평균과 error rate보다 tail을 먼저 흔든다.

All KPI에서는 checkout→payment client/server histogram의 상위 bucket이 늘어난다. 적절한 bucket이 있다면 p99 상승을 edge 단위로 alert할 수 있다. Requests+errors에서는 request rate와 error ratio가 거의 그대로라 이 fault를 connection KPI로는 놓친다. Service 자체 duration이나 trace search가 대신 포착할 수 있지만 connection attribution이 약해질 수 있다. Topology-only에서는 payment edge가 존재한다는 사실만 남는다.

두 번째 fault는 payment 요청의 5%에 명시적 error를 반환한다. All KPI와 requests+errors는 failed counter로 이 변화를 본다. Topology-only는 performance KPI가 없으므로 별도 service metric이나 trace가 필요하다. 세 번째 fault는 checkout에서 payment 호출을 완전히 제거한다. Graph relationship의 expiration과 generation window를 지나면 topology 자체가 달라져야 한다. 이 시험은 KPI 숫자와 topology lifecycle을 분리해 검증한다.

네 번째 fault는 high-cardinality `instance_id` dimension을 켠 뒤 replica를 10배 늘린다. 요청량이 같아도 label tuple 수가 증가한다. Histogram을 유지하면 tuple당 client/server bucket이 모두 복제된다. Requests+errors로 낮추면 증가 폭은 줄지만 불필요한 dimension 문제는 남는다. 따라서 KPI mode 변경이 label hygiene의 대체책은 아니다.

## Stack-wide 변경은 retention 때문에 즉시 보이지 않는다

설정을 바꾼 뒤 새 histogram sample 생성은 멈출 수 있다. 그러나 기존 series와 sample은 retention이 끝날 때까지 남는다.[1] Grafana Cloud Free metrics retention은 현재 14일이고 Pro는 13개월이라고 공개 가격 페이지가 설명한다.[5] Enterprise는 custom retention을 사용할 수 있다.[5] 따라서 변경 다음 날 storage와 query 결과가 0이 되지 않아도 설정 실패라고 단정하지 않는다.

Active-series billing과 historical retention 비용은 같은 곡선으로 줄지 않을 수 있다. Series가 더 이상 sample을 받지 않으면 active 상태에서 빠지는 시점이 backend 정의에 따라 먼저 올 수 있다. 과거 sample은 retention window 안에서 계속 query된다. Dashboard의 긴 time range는 변경 전 histogram과 변경 후 빈 구간을 한 panel에 섞어 보여 줄 수 있다. Rollout 검증은 ingestion freshness와 historical availability를 따로 본다.

Stack-wide 설정이므로 change record에 stack ID와 변경 시각을 남긴다. 변경 전 24시간, 변경 후 24시간의 새 sample rate를 비교한다. 최소 한 retention window 동안 “old histogram이 검색된다”는 이유만으로 rollback하지 않는다. 반대로 새 timestamp의 histogram sample이 계속 들어오면 duplicate generator를 의심한다. Cloud generator를 껐어도 Alloy나 OpenTelemetry Collector가 같은 metric을 remote_write할 수 있다.

중복 생성은 비용뿐 아니라 query correctness도 깨뜨린다. 같은 labels로 두 source가 counter를 보내면 out-of-order sample이나 중복 집계가 생길 수 있다. Labels가 다르면 dashboard에서 두 집합이 합산돼 rate가 두 배처럼 보일 수 있다. Service graph metrics toggle 문서도 외부에서 생성할 때 충돌을 피하려고 Cloud generation을 끌 수 있다고 설명한다.[2] Generator inventory에는 Cloud, Tempo, Alloy, OTel Collector를 모두 넣는다.

## 비용을 cardinality 하나로만 설명하면 놓치는 것

Grafana Cloud metrics 비용은 active series가 중요한 축이다.[5] 그러나 trace ingestion과 retention은 connection KPI toggle로 자동 감소하지 않는다. 같은 trace를 계속 보내면 traces GB 비용은 그대로일 수 있다. Metrics query CPU, dashboard load, recording rule, alert evaluation 비용도 contract에 따라 다르게 나타난다. 운영자가 series를 줄이는 데 쓴 시간과 잃은 진단 신호의 incident 비용도 총비용에 포함해야 한다.

Knowledge graph는 보통 기존 metrics 대비 5%에서 10%의 active series를 더한다고 Grafana 문서가 설명한다.[6] 이 값은 전형적 범위이지 모든 stack의 보장치가 아니다. 우리의 3,360 series 추산이 조직 전체 metrics의 5%인지 50%인지는 baseline에 달렸다. 공급자 비율을 자기 invoice에 그대로 적용하지 않는다. 변경 전후 실제 series delta로 검증한다.

비용 목표는 “series를 최대한 없애기”가 아니다. Incident를 필요한 시간 안에 진단하는 최소 신호 집합을 찾는 것이다. Tail-sensitive checkout edge가 열 개뿐이고 나머지 batch edge가 수백 개라면 stack-wide 세 단계 선택만으로 최적점을 만들기 어렵다. 현재 GA 설정이 stack-wide이므로 edge별 예외를 기대하면 안 된다.[1] 중요한 edge의 latency를 custom application histogram으로 별도 유지하는 보완책을 검토할 수 있다.

그 보완책도 무료가 아니다. Custom histogram에 route, tenant, status, region을 모두 붙이면 connection histogram보다 더 비쌀 수 있다. SLO에 필요한 edge와 bucket만 남기고 label allowlist를 둔다. Exemplar나 trace link가 필요하면 sampling과 privacy를 함께 검토한다. 동일 latency를 Cloud-generated metric과 custom metric에서 중복 저장하지 않는다.

## 보안과 데이터 경계

Trace attribute를 metric dimension으로 승격하면 값이 장기 metric label에 남는다. User ID, email, order ID, full URL처럼 민감하거나 고유한 값을 dimension으로 켜지 않는다. Cardinality 폭증과 개인정보 확산이 동시에 생길 수 있다. Grafana 설정의 cardinality 표시가 privacy 적합성을 판정해 주지는 않는다. Attribute allowlist는 telemetry schema review에서 관리한다.

Stack-wide 설정을 바꾸려면 admin 권한이 필요하다.[2] 이 권한을 모든 dashboard editor에게 주지 않는다. 변경자는 비용 절감 목표, 영향을 받는 team, rollback 조건을 기록해야 한다. UI 저장 성공만으로 실제 generator 적용을 증명하지 않는다. 새 metric timestamp와 connection table 상태를 read-back한다.

Service name과 namespace도 신뢰 경계다. 잘못 instrumented된 client가 임의의 `service.name`을 보내면 가짜 node와 edge가 생길 수 있다. Topology-only로 낮추면 performance anomaly가 없어 이런 오염을 더 늦게 발견할 수 있다. Allowed service registry와 environment naming rule로 unknown node를 감시한다. Metric label은 authorization identity가 아니므로 graph에 보인다고 trusted service로 취급하지 않는다.

## 실패 모드와 대응

첫째, all KPI에서 requests+errors로 바꾼 뒤 p99 alert가 `No data`가 된다. 이것은 query 장애가 아니라 의도한 histogram 제거 결과일 수 있다. 변경 전에 affected rules와 dashboards를 inventory하고 대체 signal이 없는 alert는 mode 전환을 막는다.

둘째, 비용이 즉시 줄지 않는다. Existing series는 retention까지 남고 invoice window도 늦게 닫힌다.[1] Ingestion stop, active-series delta, retained historical data, invoice를 서로 다른 시계로 추적한다.

셋째, service 자체 RED가 남았으니 edge latency도 남았다고 착각한다. 한 service가 여러 downstream을 호출하면 attribution이 사라진다. Tail fault fixture로 실제 gap을 보여 준 뒤 승인한다.

넷째, histogram을 끄고도 series가 많다. Instance label이나 additional dimension이 request·error counter를 수천 tuple로 늘릴 수 있다. Cardinality dashboard에서 metric name과 label 조합을 다시 분해한다.

다섯째, Cloud generator 외에 Alloy가 같은 metric을 쓴다. UI mode를 바꿔도 external series는 계속 들어온다. `__name__`, cluster, source label과 remote_write configuration을 확인한다.

여섯째, native와 classic을 동시에 켠 migration이 끝나지 않는다. Grafana 문서는 both가 bucket을 이중 생성해 비용을 높인다고 경고한다.[2] Query와 alert가 native를 읽는지 확인한 뒤 종료 시점을 정한다.

일곱째, topology-only graph를 traffic graph로 읽는다. Edge 존재는 volume을 말하지 않는다. Node 크기나 선 굵기가 다른 source를 쓰는지 panel query를 확인한다.

여덟째, sampling multiplier가 count는 보정하지만 tail도 복원한다고 믿는다. 확률적으로 빠진 rare slow trace는 scalar multiplier로 되살릴 수 없다. Tail-sensitive service에는 sampling policy와 metrics source를 별도로 설계한다.

아홉째, 과거 histogram이 남아 새 histogram도 있다고 판단한다. Query의 latest sample timestamp를 본다. Retention 안의 오래된 sample과 현재 ingestion을 구분한다.

## Rollout playbook

첫 단계는 현재 mode, histogram type, bucket 경계, enabled dimensions, instance label, filter rule을 export하는 것이다. 두 번째는 generator source를 Cloud, Alloy, Tempo, OTel Collector로 나눠 inventory하는 것이다. 세 번째는 7일 이상 peak window에서 four metric family의 active series와 label tuple을 센다. 네 번째는 alert와 dashboard가 client/server histogram을 참조하는지 검색한다. 다섯 번째는 tail fault fixture를 staging stack에 주입한다.

Requests+errors 후보라면 request와 error panel이 유지되는지 확인한다. 동시에 edge p95·p99 panel이 사라지는 것을 의도된 변화로 승인한다. Service 자체 duration이나 trace query가 incident 요구 시간을 만족하는지 측정한다. 만족하지 않으면 중요한 edge에 제한된 custom histogram을 먼저 만든다. Custom metric의 bucket과 labels도 series budget에 포함한다.

변경은 업무 시간에 stack owner와 함께 수행한다. 저장 직후 설정 UI 값을 다시 읽는다. 15분과 24시간 뒤 새 histogram sample timestamp, request/error freshness, graph topology를 확인한다. Alert `No data`와 dashboard error를 점검한다. Rollback은 mode를 all KPI로 되돌리는 것뿐 아니라 중간에 바꾼 alert와 custom metric도 원상 복구해야 한다.

비용 검증은 retention 만료 전후로 나눈다. 먼저 active-series delta가 계산치와 비슷한지 본다. 다음으로 historical histogram이 plan retention에 따라 age out되는지 본다. 마지막으로 invoice의 metric usage가 계약 단위에서 줄었는지 확인한다. 3,360에서 240으로 줄 것이라는 추산과 실제 delta가 다르면 label tuple, duplicate source, native histogram을 다시 조사한다.

## Connection KPI 축소가 맞는 팀과 신중해야 할 팀

**Requests+errors가 적합한 팀**은 connection topology와 error attribution이 필요하지만 edge별 tail latency는 service RED나 traces로 충분히 조사할 수 있는 팀이다. 많은 batch connection이 있고 latency SLO가 service 단위인 환경에도 맞을 수 있다. Metrics budget이 빡빡하고 classic histogram이 connection series 대부분을 차지할 때 효과가 크다. 다만 tail fault test에서 진단 시간이 허용 범위 안이어야 한다.

**Topology-only가 적합한 팀**은 connection performance를 이미 다른 trusted metric source에서 만들고 graph에는 관계만 필요한 팀이다. 아주 낮은 traffic의 dependency catalog로 graph를 쓰는 경우도 후보가 된다. Request volume과 error를 connection table에서 보지 않아도 되는 운영 모델이어야 한다. 다른 source가 사라졌을 때 fallback이 있는지도 확인한다.

**All KPI를 유지할 팀**은 downstream별 latency SLO와 tail alert가 incident 대응의 핵심인 팀이다. Payment, authentication, database proxy처럼 error 전에 latency가 악화되는 edge가 중요하면 histogram 가치가 크다. Trace sampling 때문에 rare tail이 자주 빠지는 환경도 all KPI 쪽이 안전할 수 있다. Series 비용은 dimension 정리와 bucket 조정으로 먼저 줄여 볼 수 있다.

**부적합한 접근**은 비용 숫자를 모른 채 stack-wide toggle을 바꾸는 것이다. Self-managed Tempo에 Cloud UI 기능이 그대로 있다고 가정하는 것도 부적합하다. Grafana의 5~10% 일반 범위를 자기 절감액으로 확정하는 것도 부적합하다.[6] Retention이 끝나기 전에 효과가 없다고 결론 내리는 것도 피해야 한다.

## 결론: topology를 남기는 대신 잃는 신호를 숫자로 적어라

Connection KPI GA는 service graph를 전부 끄는 선택과 모든 histogram을 유지하는 선택 사이에 중간 지점을 만들었다.[1] Requests+errors는 연결 traffic과 failure를 남기면서 client/server latency histogram을 제거한다. Topology-only는 관계만 남긴다. Service 자체 RED는 유지되지만 connection별 tail latency와 같은 진단 질문은 약해질 수 있다.[1][2]

가상의 40 edge, edge당 3 label tuple, 명시적 classic bucket 경계 10개 조건에서는 all KPI 3,360 series가 requests+errors 240 series로 줄었다. 92.86% 감소는 histogram 두 개의 `+Inf` bucket·명시적 bucket·sum·count를 모두 셌기 때문에 나온다. 그러나 tuple이 1개인지 12개인지에 따라 절대 수치는 1,120에서 13,440으로 변한다. 그러므로 bucket 수만 줄이는 계획보다 label 조합을 실측하는 작업이 먼저다.

변경 성공의 기준도 invoice 한 줄이 아니다. **새 histogram ingestion이 멈췄는지, request·error와 topology가 남았는지, tail fault를 다른 신호로 제때 찾는지, retention 뒤 실제 usage가 줄었는지**를 각각 검증해야 한다. 이 네 질문에 답하면 connection KPI는 비용 제어 수단이 된다. 답하지 못하면 series는 줄었지만 incident 때 가장 비싼 몇 분을 잃을 수 있다.

## Sources

[1] https://grafana.com/whats-new/2026-10-14-choose-connection-kpis-to-control-metrics-cost/
[2] https://grafana.com/docs/grafana-cloud/platform/knowledge-graph/configure/traces-metrics-generation/
[3] https://grafana.com/docs/grafana-cloud/send-data/alloy/reference/components/otelcol/otelcol.connector.servicegraph/
[4] https://grafana.com/docs/grafana-cloud/observe-and-act/connect-externally-hosted/data-sources/tempo/service-graph/
[5] https://grafana.com/pricing/
[6] https://grafana.com/docs/grafana-cloud/knowledge-graph/get-started/knowledge-graph-pricing/
[7] https://grafana.com/docs/grafana-cloud/send-data/traces/metrics-generator/
