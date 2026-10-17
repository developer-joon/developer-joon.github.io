---
title: 'Amazon Bedrock AgentCore 딥다이브: 비용과 실행 경계'
date: 2026-10-17 07:40:00 +0900
categories: ["AI 에이전트"]
description: 'Bedrock 모델 호출과 AgentCore Runtime·Gateway·Identity·Memory·Observability·Browser·Code Interpreter·Evaluations를 별도 API, quota, IAM, SLO, meter로 분해하고 실제 비용과 실패 경계를 계산한다.'
featured_image: 'https://picsum.photos/seed/amazon-bedrock-agentcore-deep-dive/1600/900'
tags: [amazon-bedrock, agentcore, agent-runtime, gateway, identity, memory, observability, evaluations, finops]
---

![Amazon Bedrock AgentCore의 모델 호출과 실행 인프라 비용 경계](https://picsum.photos/seed/amazon-bedrock-agentcore-deep-dive/1600/900)

에이전트 한 번의 응답은 하나의 제품처럼 보이지만 청구와 장애는 하나가 아니다. Amazon Bedrock AgentCore는 특정 모델이나 프레임워크에 묶이지 않고 에이전트를 구축하고 연결하고 운영하기 위한 모듈형 서비스다.[1] 이 설명의 중요한 단어는 **모듈형**이다. 모델 추론, agent compute, 도구 호출, credential 교환, 기억, telemetry, 브라우저, 코드 실행, 평가는 서로 다른 데이터 plane이다. 따라서 “AgentCore 요청 1회”라는 단일 비용 단위도 없고, 모든 구성 요소에 공통인 단일 quota나 IAM action도 없다.

**모델 토큰과 AgentCore 실행 시간을 먼저 분리하고, 각 capability를 별도 API·quota·IAM·SLO·meter로 예산화해야 한다.** 한 trace로 연결하는 것은 필요하지만 한 서비스처럼 합산해 원인을 숨겨서는 안 된다. 이 경계를 지키면 느린 응답이 모델 때문인지 cold start 때문인지 구분할 수 있다. Gateway 오류와 downstream 오류도 분리할 수 있고, “메모리를 켰더니 왜 모델 비용이 늘었나”라는 질문에도 retrieved context token이라는 연결 고리를 찾을 수 있다.

## 2026년 10월 17일 기준으로 무엇을 다루는가

이 글은 이번 주의 단일 출시 소식을 요약한 뉴스가 아니다. 2026년 10월 17일 현재의 AgentCore 가운데 일반적인 serverless agent 경로에 직접 연결되는 **선정한 아홉 capability**를 묶어 보는 사용자 지정 딥다이브다. Runtime은 agent 또는 tool 코드를 올리는 compute layer다. Gateway는 API·Lambda·서비스를 MCP 도구 등으로 노출하고 호출을 중개하는 connectivity layer다. Identity는 inbound subject와 outbound credential을 관리한다. Memory는 short-term event와 long-term record를 관리한다. Observability는 CloudWatch에 trace·log·metric을 보낸다. Browser와 Code Interpreter는 Runtime 안에 포함된 무료 함수가 아니라 독립적으로 meter되는 built-in tool이다. Evaluations는 trace 또는 session을 품질 점수로 바꾸는 별도 평가 plane이다.

AgentCore 전체 목록을 모두 열거하는 글은 아니다. Harness, Runtime Instances, Web Search, Policy, Optimization, Registry와 Payments도 현재 서비스 catalog에 존재하며 각각 별도 API·quota·meter가 될 수 있다.[1] 특히 EC2 기반 Runtime Instances나 Web Search를 채택한다면 아래 아홉 줄의 합계에 해당 비용을 추가해야 한다. 이 글의 계산은 이들을 사용하지 않는 serverless Runtime V2 중심 시나리오로 한정한다.

AgentCore Runtime 문서는 runtime version과 platform version도 분리한다.[2] Runtime version은 배포 구성을 캡처한 immutable version이다. Platform version `V1`과 `V2`는 환경을 시작하고 memory를 관리하는 방식이다. 이름이 비슷하지만 rollout과 성능 분석에서 서로 바꿔 쓸 수 없다. Endpoint는 특정 runtime version을 가리킨다. 기본 endpoint는 update 때 새 version으로 이동하므로 production에서 재현성을 원하면 endpoint가 실제로 가리키는 version을 read-back해야 한다.

## 선정한 경로에서 먼저 분리할 아홉 meter

첫 번째 meter는 **Bedrock model invocation**이다. `Converse`, `InvokeModel`, streaming API 또는 다른 provider endpoint가 입력·출력 token을 계산한다. 한 번의 사용자 invocation 안에서 agent loop가 모델을 다섯 번 호출하면 모델 meter도 다섯 번 움직인다. Tool schema와 memory retrieval 결과가 prompt에 들어가면 모델 input token이 늘어난다. Runtime CPU가 I/O wait 동안 0에 가까워져도 모델 token 청구는 사라지지 않는다.

두 번째 meter는 **AgentCore Runtime**이다. MicroVM consumption 방식에서는 실제 CPU와 매초의 memory 사용량을 측정한다. Runtime session은 ready, initialization, active processing, idle, termination까지 생명주기를 가진다. CPU가 모델이나 API 응답을 기다리며 실제로 일하지 않으면 CPU 청구가 없을 수 있다. 그러나 session이 살아 있는 동안 memory는 계속 청구될 수 있다. System overhead도 사용량에 포함된다.

세 번째 meter는 **Gateway**다. `ListTools`, `InvokeTool`, `Ping` 같은 API operation, semantic search query, indexed tool 수가 서로 다른 가격 항목이다. Gateway가 model routing을 하더라도 underlying model token은 별도다. Gateway를 통해 Knowledge Base를 호출하면 Gateway operation과 Knowledge Base 비용이 함께 발생할 수 있다. Customer VPC로 나가는 data processing과 network transfer도 별도다.

네 번째 meter는 **Identity**다. Runtime 또는 Gateway를 통해 쓰는 Identity에는 추가 charge가 없다는 조건이 있다. 그 밖의 시나리오에서는 non-AWS resource용 OAuth token 또는 API key 요청 성공 건수가 meter다. “Identity가 무료”라는 문장은 조건을 떼면 틀린다. AWS IAM 권한 검사와 third-party OAuth consent도 같은 절차가 아니다.

다섯 번째 meter는 **Memory**다. Short-term memory는 event ingestion, TTL 동안의 storage, retrieval byte를 분리한다. Long-term memory는 record storage와 retrieval request를 분리한다. Built-in strategy가 raw event에서 memory를 추출하면 그 processing contract도 봐야 한다. 조직이 선택한 model과 prompt로 override하는 strategy에는 model charge가 추가될 수 있다.

여섯 번째 meter는 **Observability**다. AgentCore 자체의 trace 화면이 무료 저장소를 뜻하지 않는다. Telemetry는 고객 CloudWatch account로 들어간다. Ingestion, storage, query와 PII masking이 CloudWatch meter를 따른다. Trace를 더 자세히 남기면 장애 분석력과 동시에 비용과 민감정보 면적이 커진다.

일곱 번째 meter는 **Browser**다. Browser session은 CPU와 memory를 초 단위로 측정한다. Browser profile을 저장하면 S3 비용이 생긴다. Session recording도 S3 object와 보존 정책을 요구한다. Browser의 network transfer도 Runtime 모델 token과 무관한 별도 비용이다.

여덟 번째 meter는 **Code Interpreter**다. Code session 역시 CPU와 memory를 초 단위로 측정한다. 모델이 코드를 세 번 고쳐 실행하면 세션 resource와 모델 token이 모두 증가할 수 있다. S3에서 큰 파일을 읽으면 storage request와 transfer 경계도 확인해야 한다. 실행이 끝났다는 응답만으로 임시 파일과 세션이 정리됐다고 가정하면 안 된다.

아홉 번째 meter는 **Evaluations**다. Built-in evaluator는 evaluation input·output token으로 과금한다. Custom evaluator는 evaluation 횟수와 그 evaluator가 사용하는 model inference를 분리한다. Batch evaluation에는 할인된 token rate가 있다. Evaluation이 production agent의 원래 model call을 대체하는 것이 아니라 사후에 하나의 추가 model workload를 만든다는 점이 핵심이다.

## Runtime V2의 cold start 수치를 읽는 법

AWS는 Runtime V2의 cold start를 V1과 비교한 자체 benchmark를 공개했다.[3] Client는 `us-west-2`의 EC2 instance에서 `us-east-1` agent를 호출했다. 통신은 public internet을 지났고 VPC peering은 사용하지 않았다. SDK는 `boto3`였다. Agent는 입력을 되돌리는 빈 echo workload였다. 모델도 호출하지 않았고 tool도 호출하지 않았다.

Image 크기는 200MB부터 2GB까지 다섯 구간이었다. 각 agent와 version 조합마다 5,000회의 cold invocation을 보냈다. 수치는 client side에서 측정했으므로 두 region 사이 왕복이 포함된다. Default account quota 안에서 시험했다. 결과는 Runtime V2의 P75가 image 크기 전 구간에서 약 2초였다는 AWS 보고다.

V1은 같은 조건에서 image가 커질수록 약 5.4초에서 거의 30초까지 늘었다. Echo code 자체는 P75 약 34ms였다. 따라서 이 실험은 platform start path를 상대적으로 깨끗하게 분리한다. 반대로 production agent의 end-to-end latency를 증명하지는 않는다. Prompt 구성, model queue, token generation, Gateway, SaaS API, Memory, Browser와 Code Interpreter는 모두 빠져 있다.

이 수치를 “AgentCore agent가 2초 안에 답한다”로 확대하면 안 된다. 이 수치는 평균도 p99도 아니다. 이 수치는 `us-east-1` 내부 client의 same-AZ 측정도 아니다. 이 수치는 private networking을 켠 VPC path도 아니다. 이 수치는 5,000 cold invocations를 쓴 공급자 자체 benchmark다. 그래서 도입 실험에서는 benchmark 조건을 보존한 cold-start fixture와 실제 end-to-end trace를 별도로 운영해야 한다.

Runtime V2는 준비된 환경을 snapshot으로 만든 뒤 새 instance마다 복원한다.[2] `/ping`이 처음 healthy를 반환하는 시점이 snapshot 기준이 된다. 초기화가 끝나기 전에 healthy를 반환하면 필요한 static state가 snapshot에 담기지 않을 수 있다. 반대로 120초 안에 healthy를 반환하지 못하면 creation이 실패한다. V2 create와 update는 snapshot 준비 때문에 수 분이 걸릴 수 있다.

V2를 쓰려면 `platformVersion`을 명시해야 한다. 현재 문서는 V1을 default로 설명한다. Create response만 보고 V2 적용을 믿지 말고 `get-agent-runtime`으로 platform version을 확인해야 한다. V2의 환경 변수 총크기는 direct code deployment 1.5KB, container agent 2.5KB로 제한돼 있고 V1의 4KB보다 작다는 현재 제약도 있다.[2] CloudFormation과 CDK가 현재 `platformVersion` 설정을 지원하지 않는다는 문서 제약은 IaC drift를 만들 수 있다.

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id "$RUNTIME_ID" \
  --query '{status:status,platformVersion:platformVersion,version:agentRuntimeVersion}'
```

이 명령의 목적은 생성 요청 성공을 확인하는 것이 아니다. Effective platform version과 terminal status를 읽는 것이다. `CREATING` 상태에서 다음 update를 보내면 conflict가 날 수 있다. 배포 pipeline은 `READY` 또는 실패 terminal state까지 poll해야 한다.

## API·quota·IAM·SLO를 표로 분리한다

| 계층 | 대표 API/행위 | 주요 quota·수명 | IAM·인증 경계 | 따로 볼 SLO | meter |
|---|---|---|---|---|---|
| Bedrock model | `Converse`, `InvokeModel` | model별 TPM/RPM, context, output | `bedrock:InvokeModel*`, Marketplace 조건 | first-token, tokens/s, throttling | input/output token |
| Runtime | create/update/invoke runtime | microVM session 최대 8시간, idle 종료 | control role, execution role, inbound IAM/OAuth | cold start, invoke success, session recovery | vCPU-hour, GB-hour |
| Gateway | list/search/invoke target | target·search·API rate quota | inbound auth와 target outbound auth | routing latency, target error | operation, search, index |
| Identity | workload identity, token/API key 요청 | provider·consent·token lifetime | user-delegated와 autonomous 구분 | token acquisition, consent failure | successful credential request 조건부 |
| Memory | create event, retrieve, long-term record | event 크기·TTL·strategy capacity | memory resource와 actor/session key | ingest lag, retrieval hit·freshness | GB, GB-month, record, retrieval |
| Observability | trace/log/metric ingest와 query | CloudWatch quota·retention | telemetry execution role | trace completeness, query latency | CloudWatch usage |
| Browser | start/session/stream/stop | 기본 15분, 최대 8시간, disk 10GB | browser execution role·network mode | startup, action success, recording completeness | CPU·memory·S3·network |
| Code Interpreter | start/execute/file/stop | sync 15분, async 최대 8시간, disk 10GB | code execution role·network mode | startup, command success, cleanup | CPU·memory·S3·network |
| Evaluations | on-demand/online/batch | config·token throughput·job quota | evaluator resource policy와 identity policy | scoring delay, coverage, false gate | eval token 또는 evaluation count |

하나의 dashboard에서 이 표의 모든 값을 보여 줄 수는 있다. 그러나 하나의 error budget으로 합치면 안 된다. Model throttling과 Runtime start failure는 owner가 다르다. Gateway `InvokeTool` 성공 뒤 SaaS가 500을 반환하는 경우도 있다. Memory retrieval 성공 뒤 stale record를 반환하는 품질 실패도 있다. Evaluation job 성공 뒤 evaluator가 업무 기준을 잘못 측정하는 semantic failure도 있다.

## Gateway는 도구 catalog가 아니라 호출 경계다

Gateway는 OpenAPI, Smithy, Lambda와 기존 서비스를 MCP-compatible tool로 변환할 수 있다.[4] 다른 agent나 HTTP service에 대한 passthrough도 지원한다. Model provider routing도 한 endpoint 뒤에 구성할 수 있다. 그래서 Gateway latency는 단순 MCP serialization 시간만이 아니다. Inbound authentication, tool discovery, semantic search, credential exchange와 downstream 호출 시간이 합쳐질 수 있다.

운영자는 `ListTools`와 `InvokeTool`을 같은 SLO로 묶지 않는 편이 좋다. Discovery가 느려도 cached tool list로 invocation이 진행될 수 있다. 반대로 list가 성공해도 target credential이 만료되면 invocation은 실패한다. Semantic search를 켜면 search API 비용과 tool indexing 비용이 추가된다. Tool 수가 많다는 사실이 agent가 올바른 tool을 선택한다는 품질 증거도 아니다.

Gateway execution role과 target credential도 분리해야 한다. Gateway를 만들 권한이 target SaaS의 write 권한을 의미해서는 안 된다. Agent가 Gateway endpoint를 invoke할 권한이 모든 target을 호출할 권한을 의미해서도 안 된다. Tool schema의 `readOnly` 설명은 IAM enforcement가 아니다. 외부 상태를 바꾸는 target은 downstream scope와 resource condition을 함께 negative test해야 한다.

## Identity는 인증과 credential vending을 이어 주지만 합치지는 않는다

AgentCore Identity는 agent identity를 workload identity로 구현하고 Runtime·Gateway와 통합한다.[5] Inbound에서는 IAM SigV4 또는 OAuth bearer token으로 caller를 확인할 수 있다. Outbound에서는 user-delegated mode와 autonomous mode를 구분한다. 이 둘은 “누구 대신 행동하는가”가 다르다. 따라서 같은 OAuth provider를 쓰더라도 consent와 audit principal을 공유하면 안 된다.

User-delegated token은 사용자 의도와 resource scope에 묶여야 한다. Autonomous credential은 service-level policy와 session purpose에 묶여야 한다. 모델 prompt에 user ID가 있다는 사실은 credential binding이 아니다. Agent가 credential 원문을 log에 남기지 않는 것도 별도 검증 항목이다. Runtime execution role, Identity workload identity, downstream subject를 trace에서 서로 다른 field로 남겨야 한다.

Identity가 Runtime 또는 Gateway 경유일 때 추가 요금이 없더라도 IAM 설계 비용은 사라지지 않는다. Token refresh 실패가 agent reasoning 실패처럼 보일 수 있다. Consent portal 장애가 Gateway target 장애처럼 보일 수도 있다. Identity SLO에는 token acquisition latency와 provider error를 포함하고, tool success SLO와 별도로 alert해야 한다.

## Memory는 session durability와 같은 말이 아니다

Memory는 short-term과 long-term 두 유형을 제공한다.[6] Short-term memory는 한 session의 turn event를 저장한다. Long-term memory는 여러 session에서 preference·fact·summary를 추출해 record로 만든다. Runtime microVM의 filesystem과 process memory는 session이 종료되면 장기 durability의 근거가 되지 않는다. 그래서 `runtimeSessionId`를 재사용하는 것과 Memory에서 과거 record를 복원하는 것은 다른 동작이다.

Short-term event에는 최소 12KB와 최대 64KB의 과금 단위가 적용된다.[7] 작은 event를 많이 쪼개면 실제 payload보다 큰 ingestion 단위가 생길 수 있다. Storage는 actual size와 TTL에 따라 hourly prorating된다. Retrieval도 event당 같은 12KB minimum과 64KB maximum을 사용한다. Event count와 byte를 모두 기록해야 비용을 설명할 수 있다.

Long-term memory는 저장 record 수와 retrieval request 수로 계산한다. Built-in strategy가 모든 문장을 장기 record로 만들도록 두면 personalization보다 noise와 비용이 먼저 늘 수 있다. 삭제와 retention은 privacy 요구와 연결된다. Memory hit rate만 높이면 오래된 사실을 더 자주 주입할 위험도 있다. Quality gate에는 freshness, provenance, user별 isolation, deletion propagation을 포함해야 한다.

Memory가 model token 비용을 간접적으로 키우는 경로도 측정해야 한다. Retrieval 자체가 저렴해도 반환한 record가 매 model turn에 붙으면 input token이 반복된다. “Memory 비용” dashboard만 보면 이 증가가 보이지 않는다. Trace에는 retrieved bytes, selected records, prompt에 실제 포함된 token을 함께 남기는 편이 좋다.

## Observability는 측정 plane이지 billing ledger가 아니다

AgentCore는 Runtime, Memory, Gateway, built-in tools, Identity에 기본 metric을 제공한다.[8] 자세한 trace와 custom metric에는 ADOT instrumentation이 필요할 수 있다. CloudWatch Transaction Search를 한 번 활성화해야 전체 view를 볼 수 있다. Memory resource의 service-provided span에는 생성 시 tracing 설정이 필요하다. 설정이 빠진 뒤 trace가 없다고 호출이 없었다고 판단하면 안 된다.

Observability trace는 왜 비용이 발생했는지 설명하는 evidence다. 실제 청구 원장은 Cost Explorer와 Cost and Usage Report다. Sampling이나 export 실패가 있으면 trace 합계와 bill이 다를 수 있다. Sensitive payload masking은 비용과 조사 가능성을 동시에 바꾼다. Prompt 전문을 무조건 보존하면 observability account가 새 secret store가 된다.

SLO를 계산하려면 correlation ID가 필요하다. 사용자 request ID, Runtime session ID, model invocation ID, Gateway call ID, downstream transaction ID, evaluation job ID를 연결한다. 그렇다고 ID를 하나로 덮어쓰면 안 된다. 한 user request가 여러 model invocation과 tool call을 만드는 one-to-many 관계를 보존해야 한다.

## Browser는 managed Chrome이고 권한 위임기는 아니다

AgentCore Browser는 managed Chrome session을 제공한다.[9] 기본 timeout은 15분이고 최대 8시간까지 구성할 수 있다. Automation stream으로 navigate, click, fill, screenshot을 수행할 수 있다. Live View로 사람이 관찰하거나 개입할 수 있다. Custom browser에서는 DOM 변화, 사용자 action, console log, network event를 session recording으로 S3에 저장할 수 있다.

이 기능은 웹사이트의 authorization을 대신하지 않는다. 로그인 cookie를 profile에 저장하면 profile object가 credential 자산이 된다. Live View가 있다는 사실은 사람이 모든 action을 승인했다는 뜻이 아니다. Session replay가 있다는 사실도 network side effect를 되돌리지는 않는다. 민감 form에서는 submit 직전 target·amount·recipient를 별도 승인 대상으로 두어야 한다.

Browser session의 CPU와 memory는 Runtime과 분리해 계산한다. Model이 screenshot을 해석하는 vision token도 별도다. Profile S3 storage와 recording retention도 별도다. Website bot policy와 이용약관도 검토해야 한다. Browser가 기술적으로 클릭할 수 있다는 사실이 자동화 권리를 부여하지 않는다.

## Code Interpreter는 격리된 계산 도구지만 무제한 sandbox가 아니다

Code Interpreter는 Python, JavaScript, TypeScript 실행 환경을 제공한다.[10] Inline upload는 최대 100MB다. Terminal command로 S3를 사용할 때는 최대 5GB 파일 경로가 안내된다. Synchronous request timeout은 15분이고 asynchronous command는 최대 8시간이다. Session disk는 현재 quota 문서상 10GB다.[11]

문서는 이 환경을 sandbox라고 부르지만 운영자는 network mode와 execution role을 확인해야 한다. Internet access를 허용하면 계산 결과와 외부 전송 경계가 연결된다. S3 execution role에 broad write가 있으면 arbitrary code가 그 범위를 사용할 수 있다. Preinstalled package가 있다는 사실이 dependency provenance를 보장하지 않는다. Output file을 artifact store로 옮길 때 hash와 source session을 기록해야 한다.

Code execution 성공과 계산 정확성도 다르다. Decimal이 필요한 금액 계산을 binary float로 수행하면 명령은 성공해도 결과가 틀릴 수 있다. Model이 만든 code에는 input fixture와 expected result를 제공해야 한다. Long command timeout 뒤 descendant process와 file cleanup이 완료됐는지도 확인해야 한다. Session을 닫지 않으면 memory billing과 임시 data retention이 예상보다 길어질 수 있다.

## Evaluations의 세 가지 mode와 공개 상태 충돌

AgentCore Evaluations는 OpenTelemetry/OpenInference trace를 공통 형식으로 바꾸고 built-in 또는 custom evaluator로 점수를 낸다.[12] On-demand는 caller가 한 session의 span을 제공하는 synchronous path다. Online은 sampling rule에 맞는 production trace를 계속 평가한다. Batch는 time range나 session ID 집합을 대상으로 server-side discovery와 scoring을 수행하는 asynchronous path다.

현재 문서에는 중요한 상태 충돌이 있다. 2026년 6월 17일 AWS 발표는 batch evaluations, recommendations, A/B tests가 14개 region에서 GA라고 명시한다.[13] 그러나 현재 Batch Evaluation 개발자 문서는 해당 기능이 public preview이며 API가 바뀔 수 있다고 적는다.[14] 같은 문서는 Batch Evaluation API가 CloudTrail을 지원하지 않으므로 audit trail이 필요한 workload에 쓰지 말라고 경고한다.[14]

이 글은 어느 한쪽을 조용히 선택하지 않는다. **공식 GA 발표와 일부 현재 preview 문서가 충돌한다.** Production gate를 설계할 때는 account·region에서 실제 API status와 support 답변을 확인해야 한다. CloudTrail 부재 경고는 문서상 명시된 현재 제한으로 취급해야 한다. Compliance control이 Batch API call의 CloudTrail evidence를 요구한다면 상태가 해소될 때까지 별도 승인 기록이나 다른 evaluation mode가 필요하다.

Evaluation score는 SLO가 아니라 품질 신호다. Evaluator 자체가 drift할 수 있다. Built-in judge의 token 사용량과 sampling denominator를 남겨야 한다. Average score만 보면 특정 intent의 심각한 실패가 묻힐 수 있다. CI gate에는 score distribution, evaluator version, dataset digest, false-positive review를 함께 고정해야 한다.

## us-east-1 가격을 Decimal로 계산한다

다음 단가는 2026년 10월 17일 현재 AgentCore 공식 가격표를 다시 확인한 값이다.[7] Runtime V2 consumption은 vCPU-hour당 `$0.1276`, GB-hour당 `$0.0169`다. Browser와 Code Interpreter는 각각 vCPU-hour당 `$0.0895`, GB-hour당 `$0.00945`다. Gateway 일반 API는 1,000회당 `$0.005`다. Long-term memory built-in record storage는 월 1,000개당 `$0.75`, retrieval은 1,000회당 `$0.50`다. Batch evaluation은 input 1,000 token당 `$0.0018`, output 1,000 token당 `$0.009`다.

모델 예시는 Amazon Nova 2 Lite standard on-demand의 input 1M token당 `$0.30`, output 1M token당 `$2.50`을 사용한다.[15] 계산은 Python `Decimal`로 수행했고 중간값을 binary float로 반올림하지 않았다. 세금, free tier, enterprise discount, CloudWatch, S3, ECR, network transfer, Guardrails와 support는 제외했다. 따라서 아래 합계는 invoice 예측이 아니라 meter 분해 예제다.

### 시나리오 A: 짧은 고객지원 agent 월 100,000회

가정은 invocation당 Runtime CPU `0.5 vCPU × 2초`, memory `0.5GB × 15초`다. 모델은 invocation당 input 2,000 token과 output 500 token을 사용한다. Gateway operation은 invocation당 2회다. Long-term memory는 평균 10,000 record를 저장하고 invocation당 retrieval 1회를 수행한다.

| 항목 | Decimal 계산 | 월 비용 |
|---|---:|---:|
| Runtime CPU | `100000 × 0.5 × 2 / 3600 × 0.1276` | `$3.5444` |
| Runtime memory | `100000 × 0.5 × 15 / 3600 × 0.0169` | `$3.5208` |
| Nova input | `100000 × 2000 / 1000000 × 0.30` | `$60.0000` |
| Nova output | `100000 × 500 / 1000000 × 2.50` | `$125.0000` |
| Gateway | `100000 × 2 / 1000 × 0.005` | `$1.0000` |
| Long-term storage | `10000 / 1000 × 0.75` | `$7.5000` |
| Long-term retrieval | `100000 / 1000 × 0.50` | `$50.0000` |
| **부분 합계** | 반올림 전 원시값의 합 | **`$250.5653`** |

이 workload에서는 모델 token과 long-term retrieval이 Runtime보다 크다. Runtime wall-clock 15초를 CPU 15초로 계산하면 비용을 과대평가한다. 반대로 memory를 CPU active 2초만큼만 계산하면 비용을 과소평가한다. Idle session timeout이 길어지면 memory 비용은 더 커질 수 있다. Retrieved record가 prompt를 늘리면 여기 적지 않은 추가 model input도 생긴다.

### 시나리오 B: 조사형 agent 월 10,000회

가정은 Runtime CPU `1 vCPU × 60초`, memory `2GB × 600초`다. 모델은 invocation당 input 10,000 token과 output 2,000 token을 쓴다. Gateway operation은 5회다. Browser는 평균 CPU `0.5 vCPU × 10초`, memory `0.5GB × 30초`다. Code Interpreter는 CPU `1 vCPU × 20초`, memory `1GB × 60초`다. 모든 session을 Batch Evaluation하며 session당 evaluator input 2,000 token과 output 200 token을 쓴다.

| 항목 | Decimal 계산 | 월 비용 |
|---|---:|---:|
| Runtime CPU | `10000 × 1 × 60 / 3600 × 0.1276` | `$21.2667` |
| Runtime memory | `10000 × 2 × 600 / 3600 × 0.0169` | `$56.3333` |
| Nova input | `10000 × 10000 / 1000000 × 0.30` | `$30.0000` |
| Nova output | `10000 × 2000 / 1000000 × 2.50` | `$50.0000` |
| Gateway | `10000 × 5 / 1000 × 0.005` | `$0.2500` |
| Browser CPU | `10000 × 0.5 × 10 / 3600 × 0.0895` | `$1.2431` |
| Browser memory | `10000 × 0.5 × 30 / 3600 × 0.00945` | `$0.3938` |
| Code CPU | `10000 × 1 × 20 / 3600 × 0.0895` | `$4.9722` |
| Code memory | `10000 × 1 × 60 / 3600 × 0.00945` | `$1.5750` |
| Batch eval input | `10000 × 2000 / 1000 × 0.0018` | `$36.0000` |
| Batch eval output | `10000 × 200 / 1000 × 0.009` | `$18.0000` |
| **부분 합계** | 반올림 전 원시값의 합 | **`$220.0340`** |

두 번째 시나리오에서는 Runtime memory와 evaluation이 무시하기 어려운 비중이다. Browser와 Code Interpreter를 Runtime CPU에 합쳐 한 줄로 적으면 어느 session이 오래 열린 것인지 알 수 없다. Batch evaluation 100%는 rollout 초기에 유용할 수 있지만 production 전체에 영구 적용할지는 sampling과 위험도를 보고 결정해야 한다. CloudWatch telemetry 비용을 제외했으므로 trace volume이 큰 agent에서는 실제 합계가 더 커진다.

## 최소 IAM 설계

Control plane 배포 role과 data plane execution role을 분리한다. Runtime을 create·update하는 CI role이 production tool을 호출할 필요는 없다. Runtime execution role이 다른 runtime을 update할 필요도 없다. Gateway target role은 target별로 나누고 resource condition을 사용한다. Browser와 Code Interpreter execution role은 Runtime의 broad role을 그대로 복제하지 않는다.

Model access도 명시적으로 제한한다. 허용 model ID와 inference profile을 policy에 고정한다. `InvokeModelWithResponseStream`이 필요 없다면 열지 않는다. Evaluator resource policy는 custom evaluator owner와 caller를 분리한다. CloudWatch log group, trace, S3 recording bucket, memory resource와 KMS key는 각각 resource policy를 검토한다.

Inbound OAuth의 audience와 allowed client를 negative test한다. 다른 audience의 서명 유효 token이 거부돼야 한다. Outbound credential은 user-delegated와 autonomous mode를 섞지 않는다. Tool response나 trace에 token이 노출되지 않아야 한다. Session ID를 authorization boundary로 오인하지 않는다.

## 실패 모드와 복구 gate

첫 번째 실패는 V2 snapshot이 stale initialization을 고정하는 경우다. Snapshot 전에 가져온 credential이나 mutable configuration을 process global에 저장하면 복원된 instance가 오래된 값을 물려받을 수 있다. Snapshot-safe initialization과 per-session initialization을 나눈다. Credential은 가능한 한 호출 시점에 짧게 얻는다.

두 번째 실패는 cold start 개선을 end-to-end 개선으로 오해하는 경우다. Runtime P75가 줄어도 model first-token이나 SaaS p99가 병목이면 사용자 체감은 거의 달라지지 않는다. Cold start span과 agent loop span을 분리한다. Warm session과 cold session을 같은 percentile에 섞지 않는다.

세 번째 실패는 Gateway success를 business success로 처리하는 경우다. Gateway가 target을 호출했어도 downstream이 partial write를 만들 수 있다. Retry 전에 external state를 read-back한다. Idempotency key가 없는 write tool은 자동 재시도를 제한한다.

네 번째 실패는 Identity refresh storm이다. Provider 장애 때 여러 session이 동시에 refresh하면 더 큰 throttling을 만든다. Token cache key에 subject, audience, scope와 expiry를 넣는다. Refresh failure를 model retry budget과 분리한다.

다섯 번째 실패는 Memory poisoning 또는 stale preference다. 한 session의 잘못된 사실이 long-term record가 되어 다음 session prompt에 반복될 수 있다. Record provenance와 confidence를 남긴다. 사용자가 수정하거나 삭제할 경로를 제공한다.

여섯 번째 실패는 telemetry gap이다. Transaction Search가 꺼졌거나 execution role이 잘못되면 trace가 비어도 agent는 동작할 수 있다. Trace completeness SLO를 별도로 둔다. Bill과 trace의 표본 합계를 정기적으로 대조한다.

일곱 번째 실패는 Browser profile이 장기 credential store가 되는 경우다. Profile bucket에 retention과 encryption을 적용한다. Production과 test profile을 분리한다. Session recording에 입력값이 남을 수 있으므로 access를 제한한다.

여덟 번째 실패는 Code Interpreter의 broad egress다. 계산 도구가 arbitrary upload tool로 바뀔 수 있다. Network mode와 destination을 제한한다. S3 prefix와 KMS key도 session purpose에 맞게 좁힌다.

아홉 번째 실패는 evaluation gate가 스스로 검증되지 않는 경우다. Judge prompt나 evaluator version이 바뀌면 같은 dataset의 score가 달라질 수 있다. Dataset digest와 evaluator ARN·version을 release artifact에 남긴다. Human-labeled holdout으로 evaluator를 주기적으로 교정한다.

열 번째 실패는 GA·preview 상태 충돌을 무시하는 경우다. Batch Evaluation은 현재 공식 자료끼리 상태가 맞지 않는다. Region과 account에서 API를 확인한다. CloudTrail이 필수인 workload에는 문서 경고가 해소되기 전까지 fail-closed한다.

Rollout gate는 다음 순서가 현실적이다. 먼저 model-only fixture로 token과 response latency를 잰다. 다음으로 Runtime echo fixture로 cold·warm start를 분리한다. 세 번째로 Gateway와 Identity를 stub target에 연결한다. 네 번째로 Memory를 켜되 retrieval을 prompt에 넣지 않은 상태를 비교한다. 다섯 번째로 Browser와 Code Interpreter를 각각 한 개씩 추가한다. 마지막으로 evaluation sampling을 켜고 telemetry와 bill을 대조한다.

각 단계는 quota snapshot을 남겨야 한다. Service Quotas의 adjustable 값과 문서의 hard limit을 구분한다. Quota increase 요청이 승인됐다는 사실과 application concurrency가 안전하다는 사실도 다르다. Load test는 downstream rate limit을 넘지 않게 구성한다. Error budget은 계층별로 따로 계산한다.

## AgentCore 도입에 맞는 팀과 맞지 않는 팀

**적합한 팀**은 여러 agent framework와 model을 운영하면서 공통 runtime과 tool gateway가 필요한 팀이다. AWS IAM, CloudWatch, KMS와 조직의 운영 체계를 연결할 수 있는 팀에도 맞는다. Session isolation과 장시간 비동기 실행이 실제 요구인 팀에도 유용하다. Memory와 evaluation을 제품 품질 loop에 넣을 데이터가 있는 팀도 이점을 얻을 수 있다. 각 capability를 독립적으로 예산화하고 실패를 추적할 platform team이 있다면 모듈성이 장점이 된다.

**부적합한 팀**은 단일 prompt와 단일 read-only API만 호출하는 작은 서비스다. 이런 경우 Lambda나 기존 application server가 더 단순할 수 있다. CloudWatch와 여러 control plane을 운영할 인력이 없다면 관리형 구성 요소가 오히려 분석 면적을 늘린다. Browser와 arbitrary code 실행이 필요 없는데 기본 architecture에 넣는 것도 부적절하다. Evaluation dataset과 품질 기준 없이 judge score만 원하는 팀도 비용 대비 가치를 얻기 어렵다.

규제상 모든 data-plane 호출에 CloudTrail evidence가 필요한 팀은 Batch Evaluation의 현재 문서 경고를 먼저 해소해야 한다. Cross-cloud portability가 최우선인 팀은 Memory record, trace schema, Gateway target contract의 export를 사전에 시험해야 한다. Strict cost ceiling이 있는 팀은 agent loop의 최대 iteration, token, session lifetime, tool count와 evaluation sampling을 hard limit으로 둬야 한다. AgentCore를 쓴다고 runaway loop가 자동으로 사라지지는 않는다.

## 결론

선정한 AgentCore 경로를 한 상자처럼 구매하면 비용과 장애를 설명하기 어렵다. Bedrock model invocation은 token meter다.

이 아홉 줄은 AgentCore 전체 catalog가 아니다. Harness, Runtime Instances, Web Search, Policy, Optimization, Registry와 Payments를 추가하면 별도의 책임·가격·실패 도메인이 더 생긴다. Architecture review는 실제로 활성화한 capability 목록을 가격표와 대조해 누락 meter를 다시 찾아야 한다. Runtime은 CPU와 memory meter다. Gateway는 operation·search·index meter다. Identity는 경로에 따라 credential request meter다. Memory는 event byte·record·retrieval meter다. Observability는 CloudWatch meter다. Browser와 Code Interpreter는 각자의 CPU·memory·storage meter다. Evaluations는 평가 token 또는 evaluation count meter다.

성능도 같은 방식으로 분리해야 한다. AWS Runtime V2 echo benchmark는 200MB~2GB image, 조합당 5,000 cold invocation, `us-west-2` client에서 `us-east-1` agent로 public internet을 거친 조건이다. 모델과 tool이 없었으므로 end-to-end agent latency로 확대할 수 없다. 이 정직한 경계가 오히려 유용하다. Platform start를 재현하고 그 위에 model, Gateway, Memory와 tool을 하나씩 더하면 자기 workload의 병목을 찾을 수 있다.

도입을 최종 판단할 때는 “AgentCore가 빠른가”만 묻지 말고 어느 API가 어떤 quota와 IAM 아래에서 어떤 SLO를 지키며 얼마를 청구했는지 설명할 수 있는지 물어야 한다. 그 질문에 계층별로 답할 수 있을 때만 managed agent infrastructure가 운영 가능한 시스템이 된다.

## Sources

[1] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html
[2] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html
[3] https://aws.amazon.com/blogs/machine-learning/the-new-agentcore-runtime-elastic-optimized-and-consistently-fast-starts/
[4] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html
[5] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity.html
[6] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html
[7] https://aws.amazon.com/bedrock/agentcore/pricing/
[8] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html
[9] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html
[10] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-tool.html
[11] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html
[12] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations.html
[13] https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-agentcore-new-optimization-capabilities/
[14] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/batch-evaluations.html
[15] https://aws.amazon.com/bedrock/pricing/
