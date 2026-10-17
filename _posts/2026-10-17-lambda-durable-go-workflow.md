---
title: 'Lambda Durable Go로 승인 대기 배포 만들기: 재시작돼도 부작용을 반복하지 않는 법'
date: 2026-10-17 07:00:00 +0900
categories: ["클라우드"]
description: 'GA가 된 AWS Lambda Durable Execution SDK for Go로 승인 대기 배포를 구성하고, checkpoint와 외부 배포 API 사이의 실패 창을 주입해 멱등성·비용·보안 경계를 검증한다.'
featured_image: 'https://picsum.photos/seed/lambda-durable-go-workflow/1600/900'
tags: [aws-lambda, durable-functions, golang, idempotency, deployment, callback, failure-injection]
---

![Lambda Durable Go 승인 대기 배포와 멱등성 경계](https://picsum.photos/seed/lambda-durable-go-workflow/1600/900)

배포 자동화에서 어려운 부분은 API를 한 번 호출하는 일이 아니다. 계획을 만들고, 사람이 검토할 때까지 멈추고, 승인된 변경만 실행하고, 중간 장애 뒤에도 같은 배포를 두 번 만들지 않는 일이 어렵다. AWS는 2026년 10월 15일 **AWS Lambda Durable Execution SDK for Go를 정식 출시(GA)**했다.[1] 이 SDK는 step, callback, durable invocation, wait를 Go 코드에서 사용하게 한다. `durabletest`는 AWS 자격 증명이나 네트워크 없이 전체 흐름을 로컬에서 검사하게 하고, `durablelint`는 재개 시 깨질 수 있는 코드를 찾는다.[1] 배포물은 `provided.al2023` 런타임에서 단일 정적 바이너리로 실행할 수 있다.[1]

하지만 정식 출시가 외부 시스템의 exactly-once 실행을 보장한다는 뜻은 아니다. Lambda durable function은 완료된 operation의 결과를 checkpoint에 저장하고 replay 때 그 결과를 돌려준다.[2] 아직 완료가 기록되지 않은 step은 장애 뒤 다시 실행될 수 있다. **Checkpoint는 workflow 진행 상태를 내구화하지만, checkpoint 밖의 배포 API·결제 API·데이터베이스 쓰기를 자동으로 원복하거나 멱등화하지 않는다.**

이 차이를 승인 대기 배포 fixture로 직접 드러내 보자. 흐름은 `plan → approval callback → deploy → verify`다. 성공 경로보다 중요한 것은 deploy API가 성공한 직후 step 완료 checkpoint가 확정되기 전에 런타임이 끊기는 경로다. 이 창을 주입하면 같은 step body가 재실행될 수 있다. 외부 배포 API가 idempotency key를 받지 않으면 두 번째 release가 생긴다.

## Go 지원의 현재 상태와 배포 가능 리전

Go SDK의 상태는 preview가 아니라 GA다.[1] Durable functions 서비스 자체도 GA이며 execution 하나는 여러 Lambda invocation을 거쳐 최대 1년 동안 진행될 수 있다.[2] Wait 중에는 on-demand function의 compute duration이 청구되지 않는다.[2] 다만 resume 때 handler는 처음부터 replay되므로 step 밖의 일반 코드는 다시 실행된다. 완료된 operation은 저장 결과로 대체되지만, 코드 구조가 결정적이어야 같은 checkpoint log와 일치한다.

2026년 10월 17일 기준 지원 리전은 공식 확장 발표를 합치면 **31개 상용 리전**이다. 최초 GA 리전은 US East (Ohio)였다.[3] 2025년 12월에는 US East (N. Virginia), US West (Oregon), Europe (Ireland), Europe (Frankfurt), Europe (Milan), Europe (Stockholm), Europe (Spain), Asia Pacific (Sydney), Asia Pacific (Hong Kong), Asia Pacific (Tokyo), Asia Pacific (Singapore), Asia Pacific (Mumbai), Asia Pacific (Malaysia), Asia Pacific (Thailand)이 추가됐다.[4] 2026년 4월에는 Africa (Cape Town), Asia Pacific (Hyderabad), Asia Pacific (Jakarta), Asia Pacific (Melbourne), Asia Pacific (Osaka), Asia Pacific (Seoul), Asia Pacific (Taipei), Canada (Central), Canada West (Calgary), Europe (London), Europe (Paris), Europe (Zurich), Israel (Tel Aviv), Mexico (Central), South America (São Paulo), US West (N. California)이 추가됐다.[5]

이 목록은 일반 Lambda 지원 리전 목록과 같다고 가정하면 안 된다. GovCloud, China, Middle East의 다른 리전처럼 위 31개 발표에 없는 곳은 배포 전에 AWS Capabilities by Region에서 다시 확인해야 한다. 서울 리전은 2026년 4월 확장에 포함되므로 한국 서비스가 데이터 경계를 서울에 둘 수 있다.[5] 반면 cross-account durable invoke는 현재 기본 개념 문서가 지원하지 않는 경로로 분류하므로 계정 분리 전략은 별도 proxy나 event boundary를 검토해야 한다.[2]

## Durable execution이 실제로 저장하는 것

Durable function은 평범한 Lambda handler에 checkpoint와 replay 계약을 붙인다. `Step`은 작업을 실행하고 결과를 JSON으로 저장한다. `Wait`는 invocation을 끝내고 시간이 되면 새 invocation으로 재개한다. `WaitForCallback`은 callback을 만들고 외부 입력을 받을 때까지 실행을 정지한다. `Invoke`는 다른 Lambda 호출 결과를 checkpoint한다. `Parallel`, `Map`, child context도 각자 operation과 상태를 만든다.[6]

Replay는 과거 코드를 건너뛰는 것이 아니라 handler 코드를 처음부터 다시 따라간다. 다만 이미 완료된 operation을 만나면 body를 실행하지 않고 checkpoint 결과를 반환한다. 그래서 현재 시각, 난수, 환경 변수, 순서가 바뀌는 map iteration을 step 밖에서 분기 기준으로 쓰면 과거 실행과 다른 operation 순서가 생길 수 있다. 비결정적 입력은 named step 안에서 얻고 그 결과를 다음 분기에 전달해야 한다. Step 이름은 실행 기록을 읽을 수 있게 만드는 운영 계약이므로 배포 버전 사이에서 함부로 바꾸지 않는다.

Execution 시작에는 이름을 줄 수 있다. 같은 계정과 리전에서 같은 execution name과 같은 payload를 다시 보내면 Lambda는 기존 실행이나 완료 결과를 반환한다.[7] 같은 이름에 다른 payload를 보내면 `DurableExecutionAlreadyStartedException`이 난다.[7] 이 기능은 시작 요청의 중복을 막는다. 그러나 event source mapping은 출시 시 execution-name 멱등성을 지원하지 않아 retry마다 새 durable execution을 시작할 수 있다.[7] SQS나 EventBridge 경로라면 dispatcher Lambda가 안정적인 execution name을 넣거나 함수 안에서 별도 멱등성 저장소를 사용해야 한다.

## 승인 대기 배포 fixture

다음 구조는 핵심 operation과 함수 signature만 남긴 **설계용 pseudocode**다. `buildPlan`, `publishApprovalRequest`, `deployWithIdempotencyKey`, `verifyRelease` 구현을 생략했으므로 그대로는 컴파일되지 않는다. 실제 조직에서는 plan digest, 대상 환경, 승인자, 만료 시각을 callback payload와 별도 정책 저장소에서 검증해야 한다. Callback ID만 아는 사람이 production 배포를 승인할 수 있게 만들면 안 된다.

```go
package main

import (
    "fmt"
    "time"

    "github.com/aws/aws-durable-execution-sdk-go/durable"
)

type Event struct {
    ChangeID string `json:"changeId"`
    Env      string `json:"env"`
}

type Plan struct {
    Digest string `json:"digest"`
}

type Approval struct {
    Decision   string `json:"decision"`
    PlanDigest string `json:"planDigest"`
    Approver   string `json:"approver"`
}

type Release struct {
    ID string `json:"id"`
}

func handler(ctx durable.Context, in Event) (Release, error) {
    plan, err := durable.Step(ctx, "plan", func(sc durable.StepContext) (Plan, error) {
        return buildPlan(sc, in.ChangeID, in.Env)
    })
    if err != nil {
        return Release{}, err
    }

    approval, err := durable.WaitForCallback[Approval](ctx, "approval",
        func(sc durable.StepContext, callbackID string) error {
            return publishApprovalRequest(sc, callbackID, in, plan)
        },
        durable.WithCallbackTimeout(48*time.Hour),
        durable.WithCallbackSerdes(durable.JSONSerdes),
    )
    if err != nil {
        return Release{}, err
    }
    if approval.Decision != "approved" || approval.PlanDigest != plan.Digest {
        return Release{}, fmt.Errorf("approval does not match plan")
    }

    release, err := durable.Step(ctx, "deploy", func(sc durable.StepContext) (Release, error) {
        key := "deploy/" + in.Env + "/" + in.ChangeID + "/" + plan.Digest
        return deployWithIdempotencyKey(sc, key, plan)
    })
    if err != nil {
        return Release{}, err
    }

    _, err = durable.Step(ctx, "verify", func(sc durable.StepContext) (bool, error) {
        return verifyRelease(sc, release.ID, plan.Digest)
    })
    return release, err
}

func main() { durable.Start(handler) }
```

이 fixture에서 plan은 승인 대상의 immutable digest를 만든다. Approval은 단순한 `true`가 아니라 그 digest를 되돌려준다. 예시의 `Approver` 문자열은 신뢰 증거가 아니다. 실제 callback gateway는 SSO로 검증한 subject, environment, decision ID와 만료 시각을 서명하거나 별도 정책 저장소에 기록하고, handler는 그 검증 결과를 읽어야 한다. Deploy의 idempotency key에는 환경, change ID, plan digest를 모두 넣는다. 같은 변경을 staging과 production에 적용할 때 키가 충돌하지 않는다. Plan이 바뀌면 과거 승인을 재사용할 수 없다. Verify는 배포 API의 `200 OK`가 아니라 실제 release ID와 적용 digest를 다시 읽는다.

`go get github.com/aws/aws-durable-execution-sdk-go`로 module을 추가할 수 있다.[1] 현재 공식 저장소의 quickstart도 `durable.Start(handler)`, `durable.Step`, `durable.Wait` 형태를 사용한다.[8] AWS가 제공한 `pause-resume` 예제는 reserve step, manager callback, ship step을 연결한다.[8] 그 예제의 local test는 callback이 열리기 전과 후의 `PENDING`, 최종 `SUCCEEDED` 상태를 각각 확인한다. 이 글의 fixture는 같은 수명주기에 plan digest와 외부 idempotency key를 추가한 운영 변형이다.

## 실패를 주입하면 checkpoint 경계가 보인다

기본 step semantics는 `AtLeastOncePerRetry`다.[7] Step body가 외부 배포를 성공시킨 뒤 결과 checkpoint가 기록되기 전에 function timeout이나 runtime crash가 발생할 수 있다. 다음 invocation은 완료 결과를 찾지 못하므로 body를 다시 실행할 수 있다. 이것은 문서가 명시한 동작이지 드문 구현 우연이 아니다.[7][8]

실험은 외부 deploy adapter를 작은 fake server로 바꾸면 된다. Server는 요청을 받을 때마다 release row를 추가하고 응답을 보낸다. 첫 요청에서는 응답 전송 직후 client process를 강제로 종료해 step 완료 checkpoint가 남지 않은 상황을 만든다. Replay가 같은 요청을 보내면 멱등성 없는 endpoint에는 release row가 두 개 남는다. 같은 테스트에서 `Idempotency-Key`를 unique index로 저장하면 두 번째 요청은 기존 release ID를 반환하고 row는 하나만 남는다.

```text
case A: key 없음
  deploy call #1 -> release-101 생성 -> 응답 직후 runtime kill
  replay        -> deploy call #2 -> release-102 생성
  assertion     -> release_count(change-42) == 2  # 실패를 재현

case B: key = deploy/prod/change-42/sha256:abc...
  deploy call #1 -> release-201 생성 -> 응답 직후 runtime kill
  replay        -> 같은 key로 call #2 -> release-201 반환
  assertion     -> release_count(key) == 1        # 멱등성 경계 통과
```

이 failure injection이 입증하는 것은 checkpoint가 쓸모없다는 말이 아니다. 완료 checkpoint 뒤의 replay에서는 deploy body가 생략되므로 불필요한 반복이 줄어든다. 입증되는 사실은 외부 성공과 checkpoint 성공이 하나의 원자적 transaction이 아니라는 점이다. 외부 서비스가 idempotency key를 지원하지 않으면 별도 command ledger가 필요하다. Ledger는 key를 조건부 insert하고 `PENDING`, `APPLIED`, `VERIFIED` 상태와 외부 resource ID를 보관해야 한다. Retry는 새 명령을 만들지 않고 같은 ledger row를 읽어야 한다.

`AtMostOncePerRetry`도 exactly-once의 다른 이름이 아니다. 이 설정은 step 시작 checkpoint를 body보다 먼저 확정하고, 중간에 끊긴 attempt를 다시 실행하지 않고 실패로 처리한다.[8] Retry strategy가 다음 attempt를 허용하면 전체 step에서는 다시 실행될 수 있다. Retry를 끄면 중복 가능성 대신 “실제로 배포됐는지 모르는” 불확실한 결과를 운영자가 해결해야 한다. 돈 이동이나 irreversible device command에서는 이 교환이 유용할 수 있지만, 결과 조회 API와 reconciliation이 반드시 따라야 한다.

## Callback은 승인 UI가 아니다

`WaitForCallback`은 callback 생성, submitter step, child context를 묶는다. SDK metering 표에서는 시작 시 `3 + N retries` durable operations로 계산된다.[6] Callback payload는 callback record와 `WaitForCallback` 결과에 두 번 저장될 수 있다.[6] 승인 문서 전체나 secret을 payload에 넣으면 저장 비용과 노출 면이 함께 커진다. Payload에는 decision, immutable digest, approver subject, policy decision ID처럼 작은 참조만 넣는 편이 낫다.

Callback ID는 capability처럼 취급해야 한다. 공개 채팅, ticket 본문, 일반 application log에 원문을 남기지 않는다. 승인 endpoint는 조직 SSO를 통과하고 approver group을 검증해야 한다. 승인자가 callback을 제출할 수 있다는 사실과 production deploy role을 직접 가질 수 있다는 사실도 분리해야 한다. Callback 처리 계층은 signed decision을 만들고 Lambda API 호출 권한만 가져야 한다.

만료도 business rule과 durable timeout을 함께 맞춰야 한다. 48시간 뒤 승인 callback이 만료됐는데 change window가 2시간이었다면 기술적 callback 성공만으로 배포하면 안 된다. Approval payload의 plan digest와 environment가 현재 요청과 같은지 검증한다. 사람 이름 문자열 대신 immutable identity subject와 인증 강도를 감사 기록에 남긴다. 거절과 만료는 실패 stack trace가 아니라 정상적인 terminal business outcome으로 모델링하는 편이 운영 화면을 명확하게 한다.

## 비용은 Lambda 실행 시간 외에 세 줄이 더 붙는다

Durable function에는 기존 Lambda request·duration 요금이 그대로 적용된다.[9] Wait 중 on-demand compute는 청구되지 않지만, resume sub-invocation의 request와 replay compute는 청구된다.[9] 여기에 durable operation, checkpoint data written, data retention 요금이 추가된다. US East (N. Virginia) 가격 예시는 operation 100만 건당 8달러, data written GB당 0.25달러, retained data GB-month당 0.15달러를 사용한다.[9] 리전별 실제 가격은 배포 리전의 가격표로 다시 계산해야 한다.

가정이 분명한 작은 계산을 해 보자. 월 10만 execution이 각각 execution start 1회, plan step 1회, `WaitForCallback` 3회 상당, deploy step 1회, verify step 1회를 기록한다고 가정한다. Retry와 추가 poll이 없으면 70만 operation이고 N. Virginia 단가로 **5.60달러**다. Execution당 input 2KB, plan 4KB, callback payload 두 사본 2KB, deploy 1KB, verify 1KB를 합쳐 10KB를 쓴다고 가정한다. AWS 가격 예시와 같은 decimal 단위로 계산하면 월 data written은 1.0GB이고 **0.25달러**다. 평균 2일 대기와 완료 후 14일 보존을 단순 합산하면 0.5333GB-month이고 **약 0.08달러**다. 이 세 항목 합계는 약 5.93달러지만 Lambda compute, request, CloudWatch Logs, KMS, callback 전송, 배포 대상 서비스 비용은 포함하지 않는다.

작은 payload의 승인 흐름에서는 durable operation 수가 data 비용보다 클 수 있다. 반대로 LLM 응답이나 배포 manifest를 step 결과로 그대로 저장하면 data written과 retention이 빠르게 커진다. `WaitForCallback` payload가 두 번 저장될 수 있다는 점도 견적에 넣어야 한다.[6] 큰 artifact는 S3에 두고 content digest와 object reference만 checkpoint하는 방식을 검토한다. 다만 S3 요청·저장·KMS·data transfer 비용과 수명주기 정책은 별도다.

Retention은 완료 후 1일에서 90일로 설정할 수 있고 기본값은 14일이다.[9] 실행 중 보관과 완료 후 보관이 모두 GB-month에 반영된다. 감사 요건 때문에 durable history를 90일 두는 결정과 application audit record를 법정 기간 보관하는 결정은 같지 않다. Durable history가 영구 감사 원장이라고 가정하지 않는다. 필요한 승인 증거는 별도의 immutable audit sink에 최소 정보로 보낸다.

## 성능을 무엇으로 측정할까

Durable workflow 성능은 한 invocation의 평균 duration 하나로 설명되지 않는다. 승인 대기는 대부분 사람 시간이고 compute latency와 분리해야 한다. `plan_ready_latency`, `approval_queue_age`, `resume_latency`, `deploy_api_latency`, `verification_latency`를 따로 기록한다. 각 구간은 p50뿐 아니라 p95와 p99를 본다. Callback 제출 시점부터 다음 live code 실행까지의 resume tail은 change window가 짧을수록 중요하다.

Replay가 길어질수록 완료 checkpoint를 역직렬화하고 handler control flow를 다시 따라가는 비용도 생긴다. Operation 수가 많은 workflow는 history 크기, replay duration, checkpoint API throttling을 관측해야 한다. Step 결과를 크게 만들지 않는 이유는 저장비뿐 아니라 serialization과 replay 부담 때문이다. Load test에는 정상 실행, callback burst, checkpoint throttling, downstream 429, Lambda timeout을 각각 넣는다. 평균 성공 경로만 측정하면 production tail을 설명하지 못한다.

Go SDK가 기존 Go 도구와 맞는다는 발표는 특정 workflow latency를 보장하지 않는다.[1] 로컬 `durabletest`는 control flow와 failure state를 빠르게 검사하지만 AWS network, Lambda cold start, IAM, KMS, downstream latency를 재현하지 않는다. 따라서 local deterministic test와 실제 리전 canary를 분리한다. Canary는 고정된 version과 alias를 호출하고 execution ARN별 history를 수집한다. Cost per verified deployment를 최종 단위로 삼으면 실패한 retry와 사람이 수습한 시간도 분모 밖으로 숨지 않는다.

## 보안과 권한 경계

Durable function execution role에는 checkpoint와 state 조회 권한이 필요하다. 이 권한은 application deploy role과 같을 필요가 없다. Handler가 production 배포를 실행한다면 대상 environment별 role assumption과 session tag를 사용해 blast radius를 줄인다. Plan step은 read-only inventory 권한만 가져야 한다. Deploy step이 모든 계정의 관리자 권한을 공유하면 step 구분은 보안 경계가 아니다.

Checkpoint에는 input, step result, callback payload, error가 저장될 수 있다.[6] Secret, access token, 고객 원문, private key를 result로 반환하지 않는다. 저장 데이터는 암호화되지만 KMS key policy와 decrypt 권한이 넓으면 application-level 최소화 책임은 남는다. CloudWatch log에도 callback ID와 전체 approval payload를 출력하지 않는다. Error serializer가 downstream response body를 통째로 저장하지 않는지 확인한다.

새 코드 version은 진행 중 execution의 replay compatibility를 깨뜨릴 수 있다. Operation 이름을 바꾸거나 조건문 사이에 step을 삽입하면 과거 history와 새 코드가 다른 순서를 기대할 수 있다. 장기 실행은 시작한 function version에 고정하고, 새 workflow는 새 published version으로 보낸다. 1년 execution을 허용한다고 1년 동안 mutable `$LATEST`를 재생해도 안전하다는 뜻은 아니다. Deployment artifact digest, SDK version, operation schema version을 execution metadata와 audit record에 연결한다.

## 자주 만나는 실패 모드

첫째, 승인 전에 plan이 바뀐다. Approval이 change ID만 담으면 같은 ID의 새 plan이 과거 승인을 통과할 수 있다. Plan digest를 callback과 deploy key 양쪽에서 비교해 막는다.

둘째, deploy는 성공했지만 step이 실패로 보인다. 외부 API 응답 뒤 checkpoint 전에 runtime이 끊기면 생긴다. 같은 idempotency key로 조회하고 기존 resource ID를 복구해야 한다.

셋째, `AtMostOncePerRetry`를 exactly-once로 오해한다. 중단된 attempt를 재실행하지 않으면 중복 위험은 줄지만 outcome이 unknown인 채 남을 수 있다. Reconciler가 외부 상태를 확인하지 않으면 workflow가 안전해진 것이 아니라 멈춘 것이다.

넷째, callback이 인증됐지만 승인 범위가 틀린다. 로그인한 개발자가 staging 권한만 있는데 production plan을 승인할 수 있을 수 있다. Identity, environment, risk class, separation-of-duties를 policy decision에 넣는다.

다섯째, event source retry가 durable execution을 중복 생성한다. Execution name이 없는 ESM 경로는 각 retry가 새 실행이 될 수 있다.[7] Dispatcher나 business key ledger로 시작 멱등성을 보강한다.

여섯째, local test만 통과한다. Local runner는 Lambda timeout과 실제 checkpoint service 장애를 모두 같게 흉내 내지 않는다. Official `interrupted-no-retry` example도 로컬 runner에는 function timeout이 없어 cloud 결과와 local 결과가 다름을 명시한다.[8]

일곱째, 검증 step이 단순 health check만 본다. 새 release ID, artifact digest, configuration generation, 실제 traffic slice를 읽지 않으면 이전 healthy release를 보고 성공할 수 있다. Verification result도 근거 필드를 checkpoint한다.

여덟째, 실패한 callback submitter가 승인 요청을 여러 번 보낸다. Submitter step도 retry될 수 있으므로 notification에 안정적인 request ID를 사용한다. 이메일 중복 방지와 approval 중복 방지는 별개로 시험한다.

## Rollout gate

먼저 plan·approval·deploy·verify operation 이름과 result schema를 고정한다. 다음으로 동일 execution name의 같은 payload와 다른 payload를 각각 호출해 시작 멱등성을 확인한다. 그다음 callback 만료, 거절, 잘못된 digest, 권한 없는 승인자를 negative test로 넣는다. Deploy adapter에는 idempotency key unique constraint를 건다. 외부 성공 직후 process kill을 주입해 release row가 하나인지 확인한다. 같은 시험을 key 없이 실행해 row가 두 개 생기는 red case도 보존한다.

이후 checkpoint throttling과 Lambda timeout을 주입한다. `AtLeastOncePerRetry`와 `AtMostOncePerRetry`의 결과를 따로 기록한다. 진행 중 execution을 남긴 채 새 function version을 배포하고 과거 version replay가 유지되는지 검사한다. Operation count, data written, retention, compute, downstream 비용을 execution sample에서 산출한다. 마지막으로 실제 production 권한보다 좁은 canary environment에서 한 번의 승인 window를 통과시킨다.

중요한 release gate는 “workflow status가 SUCCEEDED인가” 하나가 아니다. 외부 release count가 하나인지, 승인 digest와 배포 digest가 같은지, verifier가 그 release를 읽었는지 함께 본다. Audit sink에는 execution ARN, execution name, plan digest, callback decision ID, external release ID, verifier evidence를 연결한다. 어느 하나라도 빠지면 자동 확대를 멈춘다.

## Durable Go가 맞는 workflow와 다른 선택이 나은 경우

**적합한 팀**은 이미 Lambda와 Go를 운영하고 짧은 compute 사이에 긴 승인 대기가 있는 팀이다. Infrastructure rollout, 계정 provisioning, AI 결과 human review처럼 step과 wait가 자연스러운 업무에도 맞는다. Function 수명주기, IAM, CloudWatch, KMS를 운영할 역량이 있고 외부 API에 idempotency key를 설계할 수 있어야 한다. Workflow를 Go의 순차 코드로 유지하려는 팀에는 학습 비용이 낮을 수 있다.

**부적합한 팀**은 외부 시스템이 멱등 호출도 상태 조회도 지원하지 않는데 exactly-once를 요구하는 팀이다. 사람이 graph를 시각적으로 편집하고 수백 서비스 integration을 low-code로 연결해야 한다면 다른 orchestration 제품이 더 맞을 수 있다. 초 단위 초저지연 request path에 많은 checkpoint를 넣는 것도 적절하지 않다. 이미 Step Functions나 Temporal을 안정적으로 운영하며 migration 이익이 불분명한 팀은 단지 Lambda 기능이 새롭다는 이유로 옮길 필요가 없다.

단일 15분 이내 작업을 한 번 실행하고 retry도 필요 없다면 일반 Lambda가 더 단순하다. 반대로 복잡한 compensation graph, cross-account activity worker, 상세한 workflow 검색이 핵심이면 서비스별 계약을 비교해야 한다. Durable Go는 모든 orchestrator를 대체하기보다 Lambda 안에서 익숙한 Go 코드로 checkpoint, wait, callback을 연결할 수 있다는 데 가치가 있다.

## 결론: 재개 가능성과 한 번만 실행은 다른 보장이다

Go SDK의 GA는 Go 팀이 durable function을 실험 기능이 아니라 지원되는 개발 경로로 채택할 수 있게 했다.[1] 서울을 포함한 31개 공식 발표 리전에서 배포할 수 있고, wait 중 compute를 멈추며 최대 1년 execution을 구성할 수 있다.[2][3][4][5] `durabletest`와 official examples도 plan·callback·resume 흐름을 로컬에서 검증할 기반을 제공한다.[8]

그러나 외부 부작용의 경계는 바뀌지 않는다. Step body가 성공하고 완료 checkpoint가 확정되기 전의 작은 창은 존재한다. Failure injection에서 key 없는 deploy가 두 release를 만들고, 같은 key의 conditional write가 한 release만 남기는 차이가 핵심 증거다. Checkpoint는 이미 완료된 일을 replay에서 생략하지만, 아직 완료로 기록되지 않은 외부 호출을 추론해 주지 않는다.

따라서 승인 대기 배포의 안전 기준은 callback이 동작하는지가 아니다. **승인한 plan과 실행한 plan이 같은지, 같은 command가 반복돼도 외부 resource가 하나인지, unknown outcome을 조회로 복구할 수 있는지, 실제 적용 상태를 다시 읽었는지**가 기준이다. 이 네 조건을 갖추면 Lambda Durable Go는 긴 대기를 견디는 단순한 Go workflow가 된다. 갖추지 못하면 durable execution은 중복 가능한 부작용을 더 오래 기억하는 시스템일 뿐이다.

## Sources

[1] https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-durable-go-sdk-support/
[2] https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html
[3] https://aws.amazon.com/about-aws/whats-new/2025/12/lambda-durable-multi-step-applications-ai-workflows/
[4] https://aws.amazon.com/about-aws/whats-new/2025/12/lambda-durable-functions-14-additional-regions/
[5] https://aws.amazon.com/about-aws/whats-new/2026/04/lambda-durable-functions-16-new-regions/
[6] https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html
[7] https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html
[8] https://github.com/aws/aws-durable-execution-sdk-go/tree/e8c24d2a81bbd275fe53746b6c28e1ac08acd720
[9] https://aws.amazon.com/lambda/pricing/
