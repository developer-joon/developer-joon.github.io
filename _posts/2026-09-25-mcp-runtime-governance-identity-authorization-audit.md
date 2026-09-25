---
title: 'MCP 런타임 거버넌스 — Identity, Call-time Authorization, Audit 설계'
date: 2026-09-25 08:00:00 +0900
categories: ["AI 보안"]
description: 'MCP 운영에서 사람, 에이전트 런타임, 클라이언트, 서버, 권한 부여 서버, downstream SaaS identity를 분리하고 호출 시점 정책·감사·격리·복구를 설계하는 방법을 다룬다.'
featured_image: 'https://picsum.photos/seed/mcp-runtime-governance-identity-authorization-audit/1600/900'
tags: [mcp, oauth, identity, authorization, audit, ai-security, runtime-governance]
---

![MCP 런타임 거버넌스](https://picsum.photos/seed/mcp-runtime-governance-identity-authorization-audit/1600/900)

MCP 도입 초기에 조직이 묻는 질문은 대개 “어떤 서버를 연결해도 되는가”다. 운영 단계에 들어가면 질문이 달라진다. 누가 어떤 에이전트에게 어떤 업무를 위임했는가, 실제 호출을 만든 런타임은 무엇인가, 그 순간 어떤 권한이 허용됐는가, MCP 서버가 다시 접근한 SaaS에서는 누구의 identity가 사용됐는가를 설명해야 한다. 서버 catalog와 접속 허용 목록은 출발점일 뿐이다. 권한이 실행되는 순간을 통제하지 못하면 catalog에 등록된 정상 서버도 과도한 권한을 빠르게 소비하는 통로가 된다.

MCP authorization 사양은 모든 구현에 인증을 의무화하지 않는다. HTTP transport를 보호할 때 적용할 OAuth 기반 상호운용 규칙을 제공하고, stdio에는 환경에서 credential을 얻는 별도 모델을 제시한다.[4] 그러나 인증 프로토콜을 구현하는 것과 기업 정책·감사 체계를 갖추는 것은 별개의 운영 책임이다. 따라서 조직이 해야 할 일은 사양을 준수하는 인증 흐름 위에 identity 분리, 호출 시점 정책 판단, 승인, 응답 통제, 감사, 폐기와 복구를 운영 체계로 올리는 것이다.

이 글의 초점은 네트워크에서 MCP 트래픽을 발견하는 방법이 아니다. 이미 승인된 연결 안에서 권한이 어떻게 생성되고 이동하며 소비되는지, 그리고 사고가 났을 때 어떤 단위로 멈추고 되살릴지를 실행 설계 관점에서 다룬다.

## 먼저 여섯 identity를 분리한다

“사용자가 MCP를 호출했다”는 문장은 운영 기록으로는 너무 거칠다. 한 번의 도구 호출에는 최소 여섯 주체가 관여할 수 있다. 이들을 하나의 `user_id`나 하나의 bearer token으로 합치면 최소 권한도, 책임 추적도, 선택적 폐기도 어려워진다.

### 1. 사람 또는 resource owner

사람은 업무 목적을 가진 요청자이며, 데이터와 행위에 대한 동의를 제공하는 resource owner일 수 있다. 사람의 identity에는 조직 계정, 소속, 직무, 고용 상태, 인증 강도 같은 속성이 붙는다. 그러나 사람이 요청했다는 사실이 모든 후속 행위를 승인한다는 뜻은 아니다. “고객 현황을 요약해 줘”라는 위임은 고객 레코드 수정이나 외부 전송까지 포함하지 않는다.

운영 기록에는 사람의 안정적인 subject identifier와 tenant를 남기되, 이메일 주소 같은 변경 가능한 표시값만을 기본키로 삼지 않는 편이 좋다. 사용자 세션 종료와 에이전트 작업 종료도 구분해야 한다. 사람이 화면을 닫은 뒤에도 장기 실행 작업이 계속될 수 있기 때문이다.

### 2. agent runtime

agent runtime은 모델 호출, 계획, 재시도, 메모리, 작업 큐를 관리하는 실행 주체다. 같은 사람이 같은 MCP client를 쓰더라도 runtime 배포 버전, 시스템 지침, 실행 환경, 세션 상태가 다르면 위험이 달라진다. 따라서 `agent_runtime_id`, `agent_definition_version`, `session_id`, `run_id`를 독립적으로 식별해야 한다.

런타임은 사람의 대리인이지만 사람 그 자체가 아니다. 정책은 “사용자가 관리자이므로 허용”에서 끝나면 안 된다. 해당 런타임이 승인된 이미지로 실행되는지, 격리 수준은 무엇인지, 호출 반복 횟수가 정상 범위인지, 현재 작업이 처음 위임받은 목적과 이어지는지까지 판단 재료로 삼아야 한다.

### 3. MCP client

MCP client는 protocol을 통해 server와 통신하는 주체다. authorization을 사용하는 보호된 HTTP transport에서는 MCP server가 OAuth resource server, MCP client가 OAuth client, authorization server가 token 발급자로 동작한다.[4] stdio client에는 이 OAuth 역할을 일반화할 수 없다. 한 agent runtime 안에 여러 MCP client 인스턴스가 있을 수 있고, 데스크톱 앱 하나가 여러 사용자와 서버 연결을 관리할 수도 있다.

따라서 공통 client identity에는 설치 주체, 소프트웨어 이름과 버전, 배포 채널, device posture를 연결해야 한다. HTTP OAuth를 사용하는 경우에는 별도의 client registration으로 redirect URI와 공개 또는 기밀 client 여부를 기록한다. 사람의 동의가 있어도 등록되지 않은 HTTP OAuth client나 변조된 build가 token을 받는 상황은 별도로 차단할 수 있어야 한다.

### 4. MCP server 또는 resource server

MCP server는 도구 목록을 노출하고 실제 호출을 받아 처리하는 resource server다. 서버 identity는 단순 hostname보다 구체적이어야 한다. 환경, tenant, service instance, 배포 버전, tool catalog digest를 함께 식별해야 한다. 같은 도메인의 개발 환경과 운영 환경은 서로 다른 resource이며, 동일 서버의 읽기 도구와 변경 도구도 정책상 다른 위험 등급을 가질 수 있다.

서버는 자신을 대상으로 발급되지 않은 token을 거부해야 한다. MCP authorization은 client가 대상 resource를 authorization 요청에 포함하고, 서버가 token audience를 검증하도록 요구한다.[4] 이 검증이 빠지면 한 서버용 token이 다른 서버에서 재사용되는 confused deputy와 횡적 이동의 여지가 커진다.

### 5. authorization server

authorization server는 사람과 client를 인증하고, 동의와 정책 결과에 따라 token을 발급한다. 서버가 여러 개라면 issuer trust list, signing key 회전, metadata cache, 장애 시 fail-closed 기준을 명시해야 한다. MCP 서버가 authorization server 역할까지 한 프로세스에서 구현할 수 있더라도 논리적 책임은 분리해야 한다.

권한 부여 서버의 결정은 “로그인 성공”이 아니라 특정 client가 특정 resource에 특정 scope로 접근하도록 허용했다는 보안 사건이다. 발급 기록에는 subject, client, resource, audience, scope, 인증 시각, 인증 강도, token 식별자와 만료를 연결해야 한다. 원문 token 값은 감사 로그에 남기지 않는다.

### 6. downstream SaaS identity

MCP server가 GitHub, Slack, CRM, 데이터베이스 같은 downstream에 접근할 때 또 하나의 identity가 생긴다. 이 identity가 최종적으로 데이터를 읽고 상태를 바꾼다. 조직은 MCP ingress에서 사용자와 client를 잘 구분하고도, 서버 내부에서 모든 요청을 하나의 광범위한 SaaS service account로 합쳐 책임성과 최소 권한을 잃을 수 있다.

downstream에는 사용자 위임 token, workload identity, 제한된 service account 등 업무에 맞는 별도 credential을 사용한다. 어떤 방식을 택하든 MCP access token을 그대로 downstream API에 전달하면 안 된다. Token passthrough는 금지되며, 서로 다른 trust boundary에는 audience가 맞는 별도 token과 검증이 필요하다.[5] ingress token은 MCP resource server에서 끝나고, downstream credential은 서버가 검증된 호출 문맥과 정책 결과에 따라 별도로 선택하거나 교환해야 한다.

## 하나의 호출을 identity chain으로 기록한다

여섯 identity는 독립적이지만 서로 연결돼야 한다. 운영팀이 원하는 것은 여섯 개의 흩어진 로그가 아니라 한 요청의 인과관계다. 다음과 같은 identity chain을 기준 모델로 둘 수 있다.

```text
human_subject
  -> delegation_id
  -> agent_runtime_id / run_id
  -> mcp_client_id
  -> mcp_resource_id / tool_id
  -> authorization_decision_id
  -> downstream_principal_id
```

이 이름들은 MCP 표준 필드가 아니라 조직이 감사와 정책 집행을 위해 정의하는 확장 모델의 예시다. `delegation_id`는 사람이 승인한 업무 목적과 범위를 나타낸다. `run_id`는 실행 단위, `request_id`는 개별 protocol 요청, `tool_call_id`는 도구 실행 단위다. 하나의 run이 여러 tool call을 만들 수 있으므로 이들을 혼용하지 않는다. 재시도도 원래 `tool_call_id`와 새 attempt를 연결해 중복 실행 여부를 확인할 수 있어야 한다.

이 chain은 token 안에 모든 정보를 우겨 넣으라는 뜻이 아니다. 개인정보와 내부 정책 속성을 과도하게 bearer token에 넣으면 노출 면적과 결합도가 커진다. token에는 검증에 필요한 최소 claim만 담고, 상세 위임 문맥과 정책 증거는 신뢰할 수 있는 내부 저장소에서 decision ID로 연결하는 편이 낫다.

## HTTP OAuth와 stdio는 같은 통제면이 아니다

HTTP와 stdio를 같은 “MCP 연결”로 묶어 동일한 체크리스트를 적용하면 빈틈이 생긴다. HTTP transport의 authorization은 OAuth 2.1과 관련 RFC를 기반으로 하며, 보호된 서버와 authorization server 사이의 discovery와 token 검증 흐름을 가진다.[4] 반면 사양은 stdio 구현이 credential을 환경에서 가져오도록 권고한다.[4] stdio 연결에 HTTP OAuth redirect 흐름이 당연히 존재한다고 가정해서는 안 된다.

### HTTP에서 지켜야 할 경계

HTTP에서는 MCP server가 protected resource metadata를 제공해야 하고, client는 이 metadata를 이용해 authorization server를 발견한다.[4] 운영자는 metadata를 단순 호환성 파일이 아니라 신뢰 bootstrap으로 취급해야 한다. metadata가 가리키는 issuer가 조직 trust list에 있는지, resource identifier가 예상 endpoint와 일치하는지, redirect와 discovery 경로가 임의 외부 host로 바뀌지 않았는지를 검증한다.

client는 authorization 과정에서 접근 대상 resource를 명시해야 한다. 발급된 token의 audience 또는 resource binding은 MCP server와 정확히 맞아야 하며, 서버는 자신을 위해 발급되지 않은 token을 거부한다.[4] “서명이 유효하다”는 검증만으로는 부족하다. issuer, audience, 만료, 활성 상태, 필요한 scope를 함께 검사해야 한다.

인증 실패의 운영 의미도 구분한다. 잘못됐거나 만료된 token은 `401`, 필요한 권한이 부족한 token은 `403`으로 처리한다.[4] client는 `401`을 받았다고 무조건 로그인 창을 반복해서 띄우거나 무한 재시도해서는 안 된다. `403`을 받았다고 기존 token을 버리고 더 넓은 scope를 자동 요청해서도 안 된다. 오류 코드는 재인증, step-up 후보, 정책 거부, 잘못된 resource 설정을 분기하는 입력이어야 한다.

### stdio에서 지켜야 할 경계

stdio 서버는 로컬 child process로 실행되는 경우가 많고, client의 OS 권한과 환경을 상속할 수 있다. 보안 권고는 로컬 서버를 client 권한으로 실행되는 코드로 보고, 정확한 실행 command를 사용자에게 보여 주고 명시적 승인을 받으며, filesystem과 network를 sandbox 또는 제한하도록 제안한다.[5]

따라서 stdio의 주요 통제점은 OAuth discovery가 아니라 process launch다. 실행 binary의 경로와 digest, package 출처, 인자, 작업 directory, 상속 환경 변수, mount, filesystem allowlist, egress 목적지, 실행 사용자, 자원 제한을 승인 대상으로 만든다. `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, 클라우드 credential directory 전체를 편의상 상속하는 구성을 피하고, 해당 서버와 작업에 필요한 짧은 credential만 주입한다.

stdio server가 외부 SaaS에 연결한다면 그 순간 HTTP downstream identity가 다시 등장한다. 로컬 process라는 이유로 감사와 audience binding을 생략할 수 없다. 오히려 MCP client와 server의 process 경계가 좁아 보여도, downstream SaaS는 별도 trust boundary다. 실행 승인, credential 주입, outbound 호출을 각각 기록해야 한다.

## Protected Resource Metadata를 운영 자산으로 본다

Protected resource metadata는 client가 올바른 authorization server를 찾도록 하는 사양 요소다.[4] 기업 운영에서는 여기에 lifecycle을 더해야 한다. 자산 inventory에 resource identifier, metadata URL, 허용 issuer, 지원 scope, owner, 환경, 데이터 등급, 만료 검토일을 등록한다.

등록 시점에는 metadata를 가져와 검증하고 snapshot digest를 남긴다. 이후 issuer, resource identifier, authorization server 목록처럼 신뢰에 영향을 주는 값이 바뀌면 단순 설정 갱신이 아니라 보안 변경으로 처리한다. 자동 반영 전에 검토하거나, 최소한 기존 값과 차이를 alert하고 고위험 도구의 신규 호출을 보류한다.

metadata 조회 실패 때 오래된 cache를 무기한 신뢰하면 폐기된 issuer를 계속 사용할 수 있다. 반대로 매번 실시간 조회만 요구하면 authorization server 장애가 전체 도구 장애로 확대된다. 짧은 cache 수명, 마지막 검증 시각, 허용 가능한 stale window, 고위험 resource의 fail-closed 기준을 환경별로 정한다. 이 정책은 MCP 사양이 대신 결정해 주지 않는다.

## Audience와 resource binding이 token의 이동 반경을 정한다

범용 access token 하나로 여러 MCP server와 downstream SaaS를 호출하는 설계는 구현은 쉽지만 사고 반경이 크다. Token passthrough는 금지되며, MCP server는 자신을 대상으로 발급된 token만 받아야 한다.[4][5] 핵심은 token을 identity의 만능 증명서가 아니라 특정 resource에서 제한된 행위를 위한 capability로 보는 것이다.

예를 들어 `https://mcp.example.com/crm`용 token은 `https://mcp.example.com/deploy`나 CRM vendor API에서 사용할 수 없어야 한다. hostname이 같아도 resource identifier가 다르면 audience를 분리할 수 있다. 운영과 개발 환경도 별도 resource로 둔다. 서버가 downstream API를 호출할 때는 ingress token을 전달하지 않고, 서버 자신의 workload identity 또는 검증된 사용자 위임에 기반해 downstream audience용 credential을 얻는다.

이 구조는 token 수와 교환 횟수를 늘린다. 대신 한 credential이 유출됐을 때 재사용 가능한 위치를 줄이고, resource 단위 revoke와 분석을 가능하게 한다. 성능 때문에 token cache를 사용하더라도 key를 `subject + client + resource + scope + assurance`처럼 충분히 구체화한다. 서로 다른 사용자나 환경의 token이 같은 cache entry를 공유하지 않게 한다.

## 최소 권한은 설치 시점이 아니라 실행 중에 좁혀 간다

MCP authorization은 least-privilege scope 선택과 step-up authorization을 다룬다.[4] 보안 권고도 점진적인 최소 scope와 runtime step-up을 권장한다.[5] 이를 운영에 옮기려면 처음부터 “이 서버가 언젠가 쓸 수 있는 모든 권한”을 요청하는 방식을 버려야 한다.

기본 연결에는 서버 정보 조회나 읽기 전용 검색처럼 낮은 위험 scope만 부여한다. 실제 계획에 변경 작업이 포함됐을 때 필요한 resource와 scope를 추가로 요청한다. 대량 export, 권한 변경, 배포, 삭제, 외부 메시지 발송처럼 영향이 큰 행위는 인증 강도와 승인 수준을 높인다. 작업이 끝나면 상승한 권한을 장기 유지하지 않는다.

scope 이름만 세밀하게 나눈다고 최소 권한이 완성되지는 않는다. `write` 하나가 모든 레코드 수정과 삭제를 포함하면 실질적으로 거친 권한이다. 서버의 tool schema와 downstream API 권한을 맞추고, tenant, project, repository, environment, 데이터 분류 같은 조건을 정책으로 제한한다. `deploy:write`가 있어도 production은 별도 승인, 허용 시간대, 검증된 artifact digest 조건을 요구할 수 있다.

step-up은 실패 뒤에 더 강한 token을 자동 발급하는 기능이 아니다. 호출 문맥을 다시 평가하고 필요한 사용자 상호작용을 거치는 보안 경계다. 승인 화면에는 서버 이름만 보여 주지 말고 tool, 대상 resource, 영향 범위, 주요 인자, 요청 scope, 만료, downstream principal을 표시한다. 사용자가 무엇이 바뀌는지 이해할 수 없으면 동의는 형식적 절차가 된다.

## Consent는 사용자별이 아니라 client별 문맥을 가진다

보안 권고는 consent와 scope 최소화를 중요한 통제로 다룬다.[5] 같은 사람이 같은 MCP server를 사용해도 client가 다르면 위험이 다르다. 조직이 관리하는 IDE와 개인이 설치한 자동화 harness는 업데이트 경로, plugin, 저장소 접근, 세션 유지 방식이 다르다. 한 client에 준 동의를 다른 client가 재사용해서는 안 된다.

동의 레코드는 최소한 `subject`, `client_id`, `resource`, `scope`, `purpose`, `issued_at`, `expires_at`, `policy_version`을 묶는다. 위험 도구는 `tool_id`나 action class까지 포함한다. 서버에 새 tool이 추가되거나 tool 의미가 바뀌고, client 소유자나 redirect URI가 바뀌며, downstream principal이 변경되면 기존 동의를 재검토한다.

사용자에게 매 호출마다 무차별적으로 팝업을 띄우면 승인 피로가 생긴다. 낮은 위험의 반복 읽기는 제한된 기간과 목적 안에서 묶어 동의하고, 상태 변경과 외부 공개는 실행 직전에 구체적으로 승인받는 계층형 모델이 현실적이다. 자동 승인이 허용되는 범위도 policy decision으로 기록한다. “팝업이 없었다”와 “승인이 필요 없었다”를 같은 의미로 취급하지 않는다.

## Call-time Policy Decision이 런타임 거버넌스의 중심이다

로그인과 token 발급만 통과하면 token 만료까지 모든 호출을 허용하는 모델은 에이전트의 동적 실행에 맞지 않는다. 정책은 최소 세 시점에서 평가돼야 한다. 연결과 token 발급 시점, tool 호출 직전, downstream 변경 직전이다. 특히 call-time decision은 모델이 만든 구체적인 인자와 현재 상태를 볼 수 있는 마지막 공통 통제점이다.

Policy Enforcement Point는 MCP client gateway, MCP server middleware, 또는 두 곳에 둘 수 있다. client 측은 계획과 사용자 문맥을 잘 알고, server 측은 실제 tool과 downstream 효과를 안다. 한쪽만 신뢰하기보다 client에서 사전 차단하고 server에서 최종 강제하는 편이 안전하다. 외부 client가 server 정책을 우회할 수 없어야 한다.

Policy Decision Point에 전달할 입력은 다음과 같이 구성할 수 있다.

- 사람: subject, tenant, role, 고용 상태, 인증 강도
- 런타임: agent definition, build digest, session, sandbox 등급, device posture
- client: client ID, 등록 상태, software version, redirect와 배포 채널
- resource: MCP server ID, 환경, data classification, owner
- action: tool ID와 version, read/write 분류, 입력의 정규화된 요약
- downstream: 대상 SaaS, tenant, principal, API action
- context: 시간, 위치, 작업 ticket, delegation ID, 최근 호출량과 실패
- evidence: consent ID, token jti, scope, audience, policy bundle version

결과는 `allow`와 `deny` 두 개만으로 부족하다. `allow_with_filter`, `require_step_up`, `require_human_approval`, `dry_run_only`, `rate_limit`, `quarantine` 같은 obligation을 반환할 수 있어야 한다. Enforcement Point는 obligation을 실행한 뒤에만 도구를 호출한다. 실행할 수 없는 obligation은 무시하지 말고 deny로 처리한다.

정책 평가가 지연되거나 PDP가 장애 나면 무엇을 할지도 정해야 한다. 공개 문서 검색 같은 저위험 읽기는 짧게 cache한 결정을 사용할 수 있지만, 송금·삭제·production 변경은 fail-closed가 적절하다. cache key에는 정책 버전과 호출 위험 등급을 넣고, 고위험 인자 변경이 이전 결정을 재사용하지 않게 한다.

## 위험 도구는 승인 단위를 결과에 가깝게 만든다

위험 도구 승인은 “이 MCP server를 신뢰합니까?”라는 설치 질문과 달라야 한다. 서버 신뢰는 코드와 운영자에 대한 판단이고, 행위 승인은 지금 실행할 효과에 대한 판단이다. 배포 도구를 승인했다고 모든 cluster, namespace, image, replica 변경을 포괄해서는 안 된다.

승인 요청에는 자연어 설명과 구조화된 diff를 함께 제공한다. 삭제라면 대상 수와 복구 가능성, 메시지 발송이라면 수신자와 채널, 배포라면 환경과 artifact digest, 데이터 export라면 행 수와 분류, 목적지를 표시한다. secret과 개인정보는 그대로 노출하지 않되 승인자가 영향 범위를 판단할 수 있을 만큼 구체적이어야 한다.

승인 이후 인자가 바뀌면 승인을 무효화한다. 승인 hash를 정규화된 tool name, schema version, resource, 중요 인자, downstream target, 만료 시각에 binding한다. 에이전트가 승인 후 수신자를 추가하거나 staging을 production으로 바꿨다면 새 승인이 필요하다. 동일 호출의 재시도는 idempotency key와 승인 ID를 연결해 중복 효과를 막는다.

break-glass는 승인 우회가 아니라 별도 고강도 절차여야 한다. 제한된 담당자, 강한 인증, 짧은 만료, 구체적 incident ID, 사후 검토를 요구한다. break-glass로 실행된 모든 호출은 일반 호출보다 높은 보존 등급과 alert 우선순위를 갖는다.

## Response Filtering도 authorization의 일부다

요청을 허용했더라도 응답 전체를 agent runtime에 돌려줘도 된다는 뜻은 아니다. 검색 도구가 요청 범위보다 넓은 레코드를 반환하거나, 서버 오류가 내부 endpoint와 token 일부를 포함하거나, downstream API가 민감한 필드를 기본 응답에 넣을 수 있다. 따라서 response path에도 정책 집행 지점을 둔다.

필터는 schema allowlist, field-level masking, tenant 경계 검증, 최대 행 수, content type, secret pattern, 데이터 분류를 적용할 수 있다. 원본 응답을 로그에 복제한 뒤 마스킹하는 순서는 피한다. 가능하면 source에서 최소 필드만 요청하고, MCP server 안에서 필터링한 뒤, client 경계에서 다시 검증한다.

필터링 결과 때문에 모델이 잘못된 결론을 낼 수 있으므로 조용히 데이터를 지우기만 해서는 안 된다. 조직 확장 필드인 `filtered_fields`, `truncated`, `policy_reason` 같은 메타데이터를 안전한 형태로 알려 줄 수 있다. 다만 숨긴 필드명 자체가 민감성을 드러내는 경우에는 일반화된 이유 코드를 사용한다. 원본이 사고 조사에 필요하다면 별도 암호화 저장소에 제한된 기간 보관하고 일반 application log와 분리한다.

## 감사 event는 호출 전후의 결정을 연결해야 한다

OAuth 기반 MCP authorization을 적용하는 것과 조직의 완전한 audit trail을 만드는 것은 별개의 운영 과제다. 조직은 MCP 표준으로 오해되지 않도록 자체 공통 event schema를 명시하고, authorization server, MCP client, policy engine, MCP server, downstream connector의 사건을 연결해야 한다. 로그의 목적은 모든 prompt를 저장하는 것이 아니라 “누가, 어떤 위임으로, 어떤 정책 아래, 무엇을 시도했고, 어디에서 허용 또는 거부됐으며, 어떤 효과가 발생했는가”를 재구성하는 것이다.

권장하는 공통 envelope는 다음과 같다.

```json
{
  "event_id": "evt_...",
  "event_type": "mcp.tool.completed",
  "occurred_at": "2026-09-25T08:13:21.482+09:00",
  "trace_id": "trc_...",
  "request_id": "req_...",
  "tool_call_id": "call_...",
  "attempt": 1,
  "human": {"subject_id": "usr_...", "tenant_id": "ten_..."},
  "delegation": {"id": "dlg_...", "purpose": "support-case-summary"},
  "runtime": {"id": "agr_...", "definition_version": "42", "run_id": "run_..."},
  "client": {"client_id": "mcpcli_...", "software_version": "3.7.1"},
  "resource": {"resource_id": "https://mcp.example.com/crm", "server_id": "srv_..."},
  "tool": {"id": "crm.update_case", "schema_version": "7", "risk": "high"},
  "authorization": {"issuer": "https://auth.example.com", "audience": "https://mcp.example.com/crm", "scope": ["case:write"], "token_jti_hash": "..."},
  "policy": {"decision_id": "dec_...", "result": "allow", "bundle_version": "2026.09.25.3", "obligations": ["human_approval"]},
  "approval": {"approval_id": "apr_...", "actor_id": "usr_...", "expires_at": "..."},
  "downstream": {"service": "crm", "principal_id": "wli_...", "operation": "cases.update"},
  "result": {"status": "success", "effect": "state_changed", "latency_ms": 384},
  "data": {"classification": "confidential", "request_fingerprint": "...", "response_filtered": true}
}
```

실제 schema에서는 event type을 `authorization.requested`, `authorization.issued`, `policy.evaluated`, `approval.requested`, `approval.resolved`, `mcp.tool.started`, `mcp.tool.completed`, `response.filtered`, `credential.revoked`, `runtime.quarantined`처럼 나눈다. 하나의 거대한 완료 event만 남기면 실행 중 중단이나 부분 실패가 사라진다.

민감한 tool 인자, prompt 전문, access token, refresh token, downstream secret은 기본 로그 필드가 아니다. 대신 정규화된 request fingerprint, 데이터 분류, 레코드 수, 대상의 비민감 identifier를 기록한다. 정확한 원문이 규제나 포렌식상 필요하다면 접근 제어, 암호화, 보존 기간, 열람 감사가 있는 별도 evidence store에 둔다.

로그 자체의 무결성도 중요하다. 서버 운영자가 호출 기록을 삭제할 수 있으면 조사 근거가 약해진다. append 중심 저장, producer 인증, 시간 동기화, sequence 또는 hash chain, 별도 보안 계정으로의 전송을 검토한다. 누락 탐지는 `started`에 대응하는 `completed` 또는 `failed`가 없는 경우, policy decision 없이 downstream 변경이 발생한 경우, 서로 다른 subject가 같은 token fingerprint를 사용한 경우를 찾아야 한다.

## Revoke는 token 하나보다 넓은 그래프 연산이다

사고 대응에서 “token을 폐기했다”는 말만으로는 충분하지 않다. 어떤 객체를 폐기할지에 따라 영향과 복구 시간이 달라진다. 사용자 session, 특정 client consent, access token, refresh token family, MCP resource 연결, downstream credential, agent run, runtime instance를 각각 끊을 수 있어야 한다.

예를 들어 client가 변조됐다면 해당 client에서 발급된 token과 consent를 폐기하되 사용자의 다른 정상 client까지 모두 중단할 필요는 없을 수 있다. downstream service account가 유출됐다면 MCP ingress token 폐기만으로는 효과가 없다. 반대로 사용자 퇴사나 계정 탈취라면 subject에 연결된 active run과 장기 작업, refresh token, downstream delegation을 함께 찾아 중지해야 한다.

폐기 event는 전파 지연을 가진다. 짧은 access token 수명, introspection 또는 revocation 신호, gateway denylist, downstream credential rotation을 조합한다. 고위험 도구는 stale authorization을 오래 cache하지 않는다. 폐기 요청 시각, 각 enforcement point 적용 시각, 마지막 성공 호출 시각을 기록해야 실제 차단 시간을 계산할 수 있다.

## Quarantine은 증거를 보존하며 실행 능력을 제거한다

Quarantine은 곧바로 모든 데이터를 삭제하는 조치가 아니다. 의심되는 runtime이나 server를 격리해 추가 피해를 막으면서 조사에 필요한 상태를 보존하는 단계다. 격리 대상은 runtime instance, client registration, MCP server deployment, tool version, downstream principal 중 하나 또는 조합일 수 있다.

격리된 runtime에는 신규 token 발급을 막고, 기존 credential을 폐기하며, tool 호출과 outbound network를 차단한다. 작업 queue의 pending action도 멈춘다. 다만 메모리, 실행 trace, policy decision, 승인 기록, binary digest는 읽기 전용 evidence로 보존한다. 격리 이후 운영자가 조사 도구로 접근할 때도 별도 identity와 감사 event를 사용한다.

서버 전체 격리가 과도하면 특정 tool이나 schema version만 비활성화할 수 있다. 이때 tool catalog cache와 장기 실행 client가 이전 정의를 계속 사용하지 않도록 version denylist를 배포한다. 읽기 도구만 제한적으로 유지하는 degraded mode도 가능하지만, 어떤 응답 데이터가 오염됐을 가능성이 있다면 결과 신뢰도 표시와 재검증 절차가 필요하다.

## Recovery는 재연결이 아니라 신뢰의 재수립이다

복구를 “프로세스를 다시 시작하고 token을 재발급하는 일”로 끝내면 사고 원인을 그대로 되살릴 수 있다. 먼저 침해 범위와 최초 신뢰 파괴 지점을 확인한다. client build가 문제였는지, MCP server code인지, authorization server 설정인지, downstream credential인지에 따라 복구 root가 달라진다.

복구 순서는 보통 credential rotation, 취약 구성 수정, 깨끗한 artifact 검증, policy 업데이트, metadata와 issuer 재검증, 제한된 canary 연결, read-only 호출, 고위험 호출의 수동 승인, 정상 운영 전환으로 구성할 수 있다. 기존 consent가 변경된 client나 tool에 자동 승계되지 않게 한다. 정책과 schema version이 바뀌었다면 새 동의를 요구한다.

복구 검증에는 negative test가 포함돼야 한다. 잘못된 audience token이 거부되는지, 만료 token이 `401`인지, 부족한 scope가 `403`인지, token passthrough가 차단되는지, 승인 후 인자 변경이 실패하는지, response filter가 민감 필드를 제거하는지, revoke가 모든 enforcement point에 전파되는지 확인한다. 사양이 정의한 HTTP authorization 오류와 audience 검증은 이 테스트의 기준점이 된다.[4]

이후 quarantine을 한 번에 풀지 않는다. 작은 사용자 집단과 낮은 위험 tool부터 활성화하고 event 누락, 비정상 재시도, 정책 latency, downstream principal 사용을 관찰한다. 정상 기준이 확인되면 단계적으로 scope와 tool을 확대한다. 복구 완료 조건은 서비스가 응답한다는 사실이 아니라 identity chain, 정책 집행, 감사 연결, 폐기 기능이 다시 검증됐다는 것이다.

## 구현 순서: 인증보다 운영 폐루프를 완성한다

현실적인 도입은 다음 순서로 진행할 수 있다.

1. 사람, runtime, client, MCP resource, authorization server, downstream principal의 inventory와 owner를 만든다.
2. HTTP resource마다 protected resource metadata와 허용 issuer를 등록하고 audience validation을 테스트한다.
3. stdio 서버에는 실행 command, binary digest, 환경 변수, filesystem, network 정책을 적용한다.
4. ingress MCP token과 downstream credential을 분리하고 token passthrough를 차단한다.
5. tool을 read, write, destructive, external-disclosure 같은 위험 등급으로 분류한다.
6. 최소 scope로 시작하고 위험 상승 시 step-up과 구체적 승인을 요구한다.
7. consent를 subject뿐 아니라 client, resource, purpose, policy version에 binding한다.
8. server 측 call-time PEP를 먼저 강제하고 client 측 사전 PEP를 보완한다.
9. response filtering과 공통 audit event schema를 함께 배포한다.
10. token, consent, runtime, downstream credential별 revoke와 quarantine runbook을 훈련한다.
11. audience 오류, scope 부족, 정책 장애, 승인 변조, 부분 실패를 포함한 recovery test를 정기 실행한다.

각 단계에는 관측 가능한 완료 조건이 있어야 한다. “OAuth 적용” 대신 잘못된 audience 거부율과 token passthrough 테스트 결과를 본다. “감사 로그 구축” 대신 임의의 downstream 변경에서 human subject와 decision ID를 역추적할 수 있는지 확인한다. “사고 대응 준비” 대신 특정 client 하나를 격리하고 다른 client는 유지한 채 credential을 회전할 수 있는지 훈련한다.

## 운영 체크리스트

배포 전에는 다음 질문에 답할 수 있어야 한다.

- 사람과 agent runtime을 서로 다른 identifier로 추적하는가?
- MCP client registration과 runtime 배포 identity를 연결할 수 있는가?
- 각 HTTP resource의 metadata, issuer, audience가 inventory와 일치하는가?
- stdio process가 받는 command, 환경 변수, filesystem, network 권한을 검토했는가?
- MCP access token이 downstream SaaS로 전달되지 않는가?
- downstream principal을 tool call과 human delegation까지 역추적할 수 있는가?
- 기본 scope가 읽기 중심이며 권한 상승은 runtime step-up을 거치는가?
- consent가 client와 resource별로 분리되고 만료되는가?
- 위험 도구 승인이 구체적인 대상과 인자에 binding되는가?
- call-time PDP 장애 때 위험 등급별 fail-open 또는 fail-closed 기준이 있는가?
- response filtering이 로그 기록보다 먼저 수행되는가?
- `401`과 `403`을 client가 서로 다른 복구 흐름으로 처리하는가?
- 감사 event가 policy decision, approval, downstream effect를 같은 trace로 연결하는가?
- token 원문과 민감 prompt가 일반 로그에 남지 않는가?
- subject, client, resource, runtime, downstream credential을 독립적으로 revoke할 수 있는가?
- quarantine 중 신규 실행은 막고 조사 증거는 보존하는가?
- recovery 과정에서 기존 consent를 무조건 재사용하지 않는가?

## 결론

MCP 런타임 거버넌스의 핵심은 인증 화면을 추가하는 일이 아니다. 사람의 위임에서 시작해 agent runtime, MCP client, resource server, authorization server, downstream SaaS principal로 이어지는 identity chain을 분리하고 다시 연결하는 일이다. 각 경계에서 token의 대상과 scope를 좁히고, 호출 직전에 실제 tool과 인자를 정책으로 판단하며, 고위험 효과는 승인에 binding해야 한다.

HTTP OAuth에서는 protected resource metadata, resource 지정, audience 검증, `401`과 `403`의 구분이 상호운용의 기반이다.[4] stdio에서는 같은 흐름을 억지로 가정하지 말고 process 실행 권한, 환경 credential, filesystem과 network를 통제해야 한다.[4][5] 어느 경우든 token passthrough를 금지하고 downstream identity를 분리해야 한다.[5]

마지막으로 사양의 역할과 조직의 책임을 혼동하지 않아야 한다. MCP authorization은 OAuth 기반 보호 흐름과 필요한 protocol 규칙을 제공한다.[4] 여기서 더 나아가 조직의 세밀한 enterprise policy, 위험 도구 승인, response filtering, 완전한 감사, quarantine과 recovery 운영을 갖추는 것은 별도 설계 책임이다. 안전한 운영은 연결 허용으로 끝나는 선형 절차가 아니라, 매 호출에서 결정하고 기록하며 이상 시 폐기하고 격리한 뒤 신뢰를 검증해 복구하는 폐루프다.

## Sources

[4] https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index — MCP Authorization specification
[5] https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices — MCP Security Best Practices
