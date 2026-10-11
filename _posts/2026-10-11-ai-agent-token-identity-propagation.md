---
title: '사용자 토큰을 LLM에 노출하지 않는 위임 identity 전파 설계'
date: 2026-10-11 11:20:00 +0900
categories: ["AI 보안"]
description: '사용자 id_token을 모델 문맥 밖의 HTTP transport로 전달하고, Lambda에서 검증·교환해 Lake Formation 권한과 CloudTrail 감사를 실제 사용자에게 연결하는 방법.'
featured_image: '/images/posts/2026-10-11-ai-agent-token-identity-propagation.png'
tags: [ai-agent, delegated-identity, oauth, bedrock-agentcore, lake-formation, trusted-identity-propagation, cloudtrail]
---

![AI 에이전트의 사용자 identity 전파](/images/posts/2026-10-11-ai-agent-token-identity-propagation.png)

데이터 에이전트가 자연어를 SQL로 바꿔 Athena를 호출한다고 하자. 공용 IAM role만 사용하면 Lake Formation이 보는 주체도 직원이 아니라 그 role이다. 해결 목표는 사용자별 권한을 agent 코드에 복제하는 것이 아니라, **인증 증거를 foundation model에 노출하지 않고 최종 data plane에 실제 사용자 identity를 전달하는 것**이다.

AWS가 제시한 패턴은 사용자 `id_token`을 prompt나 tool argument가 아닌 HTTP header로 운반하고, Lambda에서 검증·교환한 뒤 identity-enhanced role session으로 Athena를 호출한다.[1] 다만 이 흐름은 token 전달만 구현한다고 안전해지지 않는다. Lake Formation의 강제 여부, Athena 결과 bucket, ID token 검증, STS trust와 감사 범위를 각각 닫아야 한다.

## 두 token과 두 channel

- `access_token`: AgentCore Runtime 또는 Gateway **ingress 자체**를 호출할 권한을 증명한다.
- `id_token`: 요청 배후 사용자를 나타내며 Lambda의 identity exchange 입력으로만 쓴다.

Runtime 호출의 `Authorization: Bearer <access_token>`과, 별도 custom header인 `X-Amzn-Bedrock-AgentCore-Runtime-Custom-IdToken: <id_token>`을 같은 것으로 취급하면 안 된다. Gateway가 OAuth/JWT authorizer로 검증하는 `Authorization` 값은 Gateway 접근용 access token이고, Lambda로 전달할 custom header의 ID token은 별도 검증·교환 대상이다. 둘 다 JSON body 밖에 두되 수신자와 audience가 다르다.

```text
model-visible tool contract
  query, database

trusted transport metadata
  Authorization: Bearer <gateway access_token>
  X-Amzn-Bedrock-AgentCore-Runtime-Custom-IdToken: <user id_token>
```

“모델이 보지 않는다”는 agent process가 token에 접근할 수 없다는 뜻은 아니다. AgentCore code는 allowlist된 header를 읽어 다음 hop에 붙인다. Container, HTTP client와 Lambda는 trusted computing base이며 request context 전체를 log·trace에 남기지 않아야 한다.[1]

## 전체 흐름과 선행 조건

```text
User/UI → Runtime → agent container → Gateway → Lambda
   access_token: 각 ingress 인증
   id_token: custom header로만 전달
Lambda: ID token 검증 → CreateTokenWithIAM(JWT Bearer grant)
      → STS AssumeRole(ProvidedContexts)
      → 고정 Athena workgroup → Lake Formation → S3 result
```

이 흐름의 선행 조건은 IAM Identity Center에 trusted token issuer(TTI), customer-managed OAuth 2.0 application, 해당 TTI와 audience, 필요한 scope와 trusted application을 구성하는 것이다. `CreateTokenWithIAM` 호출 주체에는 SigV4 자격과 application resource policy가 필요하고, JWT Bearer grant를 활성화해야 한다. Application이 assignment를 요구한다면 사용자 또는 group assignment도 먼저 존재해야 한다.[4][5]

`CreateTokenWithIAM`의 JWT Bearer grant는 RFC 7523 프로파일이다. 즉 외부 JWT를 `assertion`으로 IAM Identity Center token/context로 교환하는 grant를 설명한다.[4][9] 이를 RFC 8693의 일반 OAuth Token Exchange나 “OBO 표준”과 같은 흐름으로 부르면 안 된다. RFC 8693은 별도의 subject/actor token 기반 token exchange 표준이며 이 구현의 API 계약이 아니다.[10]

## 세 가지 AgentCore 전달 경계

### 1. Runtime allowlist

Runtime의 `requestHeaderAllowlist`에는 필요한 custom ID-token header만 넣는다. Runtime 자체의 inbound OAuth 설정은 access token을 검증한다. 누락됐을 때 body로 token을 복사하는 fallback은 두지 않고 fail-closed한다.[2]

```json
{"requestHeaderConfiguration":{"requestHeaderAllowlist":[
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-IdToken"
]}}
```

### 2. Gateway target allowlist

Gateway target의 `metadataConfiguration.allowedRequestHeaders`도 identity exchange Lambda에만 같은 custom header를 허용한다. 모든 target에 wildcard처럼 전파하지 않는다.[3]

```json
{"metadataConfiguration":{"allowedRequestHeaders":[
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-IdToken"
]}}
```

Tool schema에는 token뿐 아니라 `workgroup`과 `output_location`도 노출하지 않는다. Model이 선택할 수 있는 값은 query와 승인된 logical database 정도로 줄인다.

```json
{"name":"run_athena_query","inputSchema":{
  "query":"string","database":"string"
}}
```

### 3. Lambda handoff

Lambda는 tool event가 아니라 AgentCore 전용 client context에서만 ID token을 읽는다. 같은 이름의 body field가 trusted header를 override하지 못하게 한다.[1]

```python
headers = (context.client_context.custom or {}).get(
    "bedrockAgentCorePropagatedHeaders", {})
id_token = headers.get(
    "X-Amzn-Bedrock-AgentCore-Runtime-Custom-IdToken")
query = event["query"]
```

이 세 항목은 “세 가지 configuration”이라는 제품 묶음이 아니라 Runtime→container, Gateway→target, target→Lambda의 **세 가지 전달 경계**다.

## ID token 검증은 OIDC 규칙으로

Header로 숨겨 운반했다는 사실은 token의 진위를 보장하지 않는다. Lambda는 IdP의 OIDC profile에 맞는 검증 library를 사용해 다음을 fail-closed로 확인한다.

1. 허용한 algorithm과 해당 issuer의 JWKS `kid`로 JWS signature를 검증한다.
2. `iss`가 사전 등록한 issuer와 정확히 일치하는지 확인한다.
3. ID token의 `aud`에 이 Relying Party의 client ID가 포함되는지 확인한다. Audience가 여러 개면 profile에 따라 `azp`도 확인한다.
4. 현재 시간이 `exp` 이전인지 확인하고, profile과 정책에 따라 `iat`의 비정상 미래값, `nbf`, 허용 clock skew를 검사한다.
5. Authorization request에서 `nonce`를 사용했다면 응답 token의 `nonce`가 원 요청과 일치하는지 확인한다.
6. Cognito user pool token이면 `token_use == "id"`, `aud == app client ID`, 예상 user pool `iss`까지 확인한다.

이는 OIDC Core의 RP ID-token validation 규칙과 IdP profile을 적용하는 단계다.[7] Cognito도 signature, expiration, issuer, ID-token audience와 `token_use` 검증을 명시한다.[8] RFC 7523은 이 로컬 ID-token 검증 근거로 대신 인용하지 않고, 검증을 통과한 JWT를 `CreateTokenWithIAM`에 넣는 **JWT Bearer grant**에만 연결한다.[9]

검증 후에는 요청 scope를 `sts:identity_context` 등 필요한 값으로 명시해 downscope한다. 원 ID token, 교환 응답, assertion은 model·browser에 반환하거나 session 간 cache하지 않는다.[4]

## `ProvidedContexts`와 role 경계

`CreateTokenWithIAM` 응답의 `awsAdditionalDetails.identityContext`를 STS 입력의 `ContextAssertion`으로 사용하고, provider는 IAM Identity Center로 고정한다.[4][6]

```json
{"ProvidedContexts":[{
  "ProviderArn":"arn:aws:iam::aws:contextProvider/IdentityCenter",
  "ContextAssertion":"<identityContext>"
}]}
```

`ContextAssertion`은 application이 새로 만들거나 claim을 조립하는 문자열이 아니라 AWS가 발급한 signed·encrypted trusted context assertion이다. TIP role trust policy는 Lambda 실행 role 하나만 principal로 신뢰하고 `sts:AssumeRole`과 `sts:SetContext`만 허용한다. 또한 `sts:RequestContextProviders`가 위 Identity Center provider ARN과 같고 값이 누락되지 않았다는 조건을 둔다. 호출자 policy도 특정 TIP role에 대한 최소 권한만 부여한다.[6][11]

Session duration은 업무에 필요한 최단 시간으로 제한하고 invocation 간 credential을 공유하지 않는다. Identity context가 없거나 잘못되면 일반 role session으로 재시도하지 않는다.

## Lake Formation이 정말 강제되는 조건

Identity-enhanced session만으로 사용자 grant가 자동 강제되지는 않는다. Athena/Lake Formation처럼 user-based authorization을 지원하는 서비스여야 하고, Data Catalog와 S3 location이 Lake Formation 관리 범위에 있어야 한다.[5]

특히 기존 Glue 호환 설정의 `IAMAllowedPrincipals`에 `Super`가 남아 있으면 account principal이 IAM 경로로 접근해 사용자별 LF grant를 우회할 수 있다. 다음 둘 중 하나를 명시적으로 선택한다.

- **LF 전면 강제:** 대상 database/table에서 `IAMAllowedPrincipals` 권한을 제거하고 S3 location을 Lake Formation에 등록한다.
- **Hybrid access mode:** legacy IAM 사용자는 유지하되, TIP principal과 대상 resource 조합을 hybrid access mode에 **opt in**해 그 조합에는 LF 권한이 적용되도록 한다. Opt-in하지 않은 principal은 계속 IAM 경로를 사용할 수 있으므로 이를 LF 강제로 오해하면 안 된다.[12]

사용자·group에는 table `SELECT`, column grant 또는 **data filter에 대한 `SELECT` permission**을 부여한다. Row-level 보안은 독립된 “row-level grant”가 아니라 row expression을 가진 data filter를 만들고 그 filter를 선택해 permission을 grant하는 방식이다.[13]

TIP role은 `athena:StartQueryExecution`, 필요한 catalog read, `lakeformation:GetDataAccess` 등 실행 권한만 갖고 governed source bucket의 직접 `s3:GetObject`나 broad LF data grant는 갖지 않는다. `IAMAllowedPrincipals` 제거/opt-in, identity context 제거, grant 없는 사용자, 서로 다른 data filter를 각각 negative test한다.

## Athena 결과는 별도의 S3/IAM 경계다

Lake Formation은 query source를 통제하지만 Athena query result location은 LF에 등록할 수 없고 LF permission도 적용되지 않는다. 결과 CSV와 metadata는 S3 IAM/KMS 정책의 보호 대상이다.[14] 따라서 source table이 안전해도 result bucket이 공유돼 있으면 데이터가 새어 나간다.

**운영 권고:** 서버가 고정 workgroup을 선택하고 tool schema에서 `workgroup`, `output_location`을 제거한다. Workgroup의 `EnforceWorkGroupConfiguration`(console의 **Override client-side settings**)을 켜서 client가 결과 위치, expected bucket owner, encryption을 바꾸지 못하게 한다.[15]

- 전용 result bucket과 고정 prefix를 사용하고 expected bucket owner를 account ID로 지정한다.
- SSE-KMS 등 workgroup encryption을 강제하고 Lambda role과 허용된 result reader에만 필요한 KMS 권한을 준다.
- 사용자·session·query별 결과 경계가 필요하면 Lambda가 서버 측 mapping으로 미리 구성된 workgroup/prefix를 선택하거나 result broker가 `users/<stable-user-id>/sessions/<session-id>/queries/<query-id>/`에 결과를 격리한다. Enforced workgroup의 output prefix 자체는 query마다 바뀌지 않으므로 model/client가 동적 prefix를 넘기게 해서는 안 된다. Bucket policy와 access path도 같은 경계를 강제하고 token claim 원문이나 email은 object key에 넣지 않는다.
- 결과 조회 API와 S3 `GetObject`를 해당 workgroup/prefix에만 허용하고, lifecycle로 짧게 삭제한다.

Expected bucket owner는 workgroup의 일반 query-result 위치에만 적용된다. CTAS, `INSERT INTO`, `UNLOAD`의 destination에는 적용되지 않는다.[16] 그래서 read-only 분석 Lambda는 SQL parser/AST allowlist로 단일 `SELECT`만 허용하고 CTAS, INSERT, UNLOAD, CREATE, DROP, ALTER, UPDATE, DELETE, MERGE와 다중 statement를 거부한다. 더 중요한 backstop은 execution role과 bucket policy에서 source·임의 bucket 쓰기 권한을 제거하는 것이다. 이 항목들은 Athena가 자동 제공하는 “read-only mode”가 아니라 **운영 권고**다.

## 감사 범위도 끝까지 확인한다

Identity-enhanced role session을 지원하는 AWS service의 CloudTrail event에는 `userIdentity.onBehalfOf`로 Identity Center `userId`와 `identityStoreArn`이 기록될 수 있다. 모든 service와 모든 event가 이 element를 보장하는 것은 아니므로, Athena query ID를 기준으로 실제 환경의 `StartQueryExecution`, Lake Formation credential vending과 후속 event를 확인한다.[5]

S3 object까지 “누가 읽었는가”를 연결하려면 Lake Formation의 **enhanced auditing / Propagate provided context**를 켜고, CloudTrail trail 또는 event data store에서 해당 bucket의 **S3 object data events**를 별도로 활성화해야 한다.[17][18] Data events는 기본적으로 기록되지 않으며 비용도 발생한다. `onBehalfOf` 하나만 보고 object-level 감사가 끝났다고 판단하면 안 된다.

Application audit에는 token 원문 없이 user ID, session ID, normalized SQL hash, query execution ID, workgroup, policy/data-filter version을 남긴다. `onBehalfOf`는 사용자 identity가 credential에 결합됐다는 증거이지 사용자가 생성된 SQL 문장 하나하나를 직접 승인했다는 증거는 아니다.

## 실패를 증명하는 테스트

1. ID token 누락·변조·만료·잘못된 `iss`/`aud`/`nonce`/`token_use`가 query 전에 거부되는가.
2. Tool schema, prompt, trace, memory, event body와 log에 token이 없는가.
3. Identity context를 제거했을 때 TIP role 권한으로 fallback하지 않는가.
4. LF grant 없는 사용자와 다른 data filter 사용자가 서로 다른 결과를 받는가.
5. Client가 workgroup/output location을 바꾸지 못하고 CTAS·INSERT·UNLOAD가 IAM까지 이중으로 거부되는가.
6. Query result object를 다른 사용자/session prefix에서 읽을 수 없는가.
7. Query ID에서 `onBehalfOf`와 S3 `GetObject` data event까지 역추적되는가.

핵심은 header 전달 기법 하나가 아니다. **ID token의 검증과 custody, Lake Formation의 실제 강제, LF 밖의 Athena result boundary, STS 최소 신뢰, object-level audit**가 모두 닫혀야 한다. 이 조건이 함께 유지될 때만 agent가 사용자를 대신해 데이터를 읽으면서도 사람의 권한 경계와 책임성을 보존한다.

## Sources

[1] https://aws.amazon.com/blogs/security/identity-aware-ai-data-agents-with-aws-lake-formation-and-trusted-identity-propagation/
[2] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-header-allowlist.html
[3] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-headers.html
[4] https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_CreateTokenWithIAM.html
[5] https://docs.aws.amazon.com/singlesignon/latest/userguide/trustedidentitypropagation-identity-enhanced-iam-role-sessions.html
[6] https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
[7] https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation
[8] https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html
[9] https://www.rfc-editor.org/rfc/rfc7523.html
[10] https://www.rfc-editor.org/rfc/rfc8693.html
[11] https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html#condition-keys-sts
[12] https://docs.aws.amazon.com/lake-formation/latest/dg/hybrid-access-mode.html
[13] https://docs.aws.amazon.com/lake-formation/latest/dg/data-filtering.html
[14] https://docs.aws.amazon.com/athena/latest/ug/lf-athena-user-permissions.html
[15] https://docs.aws.amazon.com/athena/latest/ug/workgroups-settings-override.html
[16] https://docs.aws.amazon.com/athena/latest/ug/query-results-specify-location-workgroup.html
[17] https://docs.aws.amazon.com/lake-formation/latest/dg/identity-center-ct-logs.html
[18] https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html
