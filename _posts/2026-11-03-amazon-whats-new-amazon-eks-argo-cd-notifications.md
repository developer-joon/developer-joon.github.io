---
title: 'EKS 관리형 Argo CD 알림을 EventBridge로 연결해 배포 실패 자동화하기'
date: 2026-11-03 09:00:24 +0900
categories: ["클라우드"]
description: 'EKS Capability for Argo CD의 Notifications를 EventBridge·SQS·Slack에 연결하고 IAM Capability Role, Secrets Manager, 중복 이벤트와 자동 대응 경계를 검증한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-amazon-whats-new-amazon-eks-argo-cd-notifications/1600/900'
tags: [aws, eks, argocd, gitops, eventbridge, sqs, notifications, incident-response]
---

![EKS Argo CD 알림과 EventBridge 자동 대응 흐름](https://picsum.photos/seed/news-2026-11-03-amazon-whats-new-amazon-eks-argo-cd-notifications/1600/900)

Amazon EKS Capability for Argo CD가 Argo CD Notifications를 지원한다. Trigger와 message template을 cluster에 정의하고 Application annotation으로 구독하는 upstream 방식을 유지하면서 Slack, PagerDuty, Opsgenie, SQS, EventBridge를 포함한 16개 서비스로 상태를 보낼 수 있다.[1] 발표 범위는 자체 관리 Argo CD 전체가 아니라 **EKS Capability for Argo CD**다.

AWS 서비스인 SQS와 EventBridge는 IAM Capability Role로 인증하므로 cluster 안에 장기 AWS credential을 넣지 않아도 된다. Slack처럼 제3자 token이 필요한 서비스는 Kubernetes Secret의 평문 대신 AWS Secrets Manager ARN을 지정할 수 있고 EKS가 대신 사용한다.[1]

## 알림과 자동 대응을 분리한다

`sync failed` 이벤트를 받았다고 즉시 rollback하면 위험하다. 같은 Application의 오래된 실패가 늦게 도착했거나, 이미 새 revision이 healthy일 수 있다. EventBridge target은 알림 payload를 명령으로 신뢰하지 말고 현재 Application revision, sync status, health와 deployment generation을 다시 읽어야 한다.

제안하는 상태 모델은 다음과 같다.

```text
RECEIVED → DEDUPED → CURRENT_STATE_READ → POLICY_APPROVED → ACTIONED → VERIFIED
                     ↘ STALE / NOOP / NEEDS_HUMAN
```

Event ID와 application UID, revision, trigger를 idempotency key로 저장한다. 동일 event 재전송은 같은 record를 읽고, 현재 revision이 다르면 `STALE`로 끝낸다. Rollback이나 sync 재시도 뒤에는 Argo CD status와 실제 workload readiness를 다시 읽어 `VERIFIED`를 기록한다.

## 실패 fixture

Staging Application에 존재하지 않는 image digest를 넣어 sync 또는 health failure를 만들고 EventBridge 수신을 확인하는 실험을 제안한다. 다음 변형을 따로 실행한다.

- 같은 event를 두 번 전달한다.
- EventBridge target이 5xx를 반환하게 한다.
- 실패 직후 새 healthy revision을 배포한다.
- Capability Role의 EventBridge 권한을 제거한다.
- Secrets Manager에서 Slack token 참조를 잘못 지정한다.

판정은 “메시지가 왔다”가 아니다. 중복 대응이 한 번으로 수렴하고, 오래된 failure가 새 revision을 되돌리지 않으며, 권한 실패가 cluster Secret fallback으로 조용히 바뀌지 않아야 한다.

## 자격증명 경계

Capability Role에는 필요한 bus·queue와 action만 허용한다. EventBridge를 쓸 수 있다는 이유로 모든 bus의 `PutEvents`를 주거나 target 자동화에 cluster-admin을 주면 관리형 인증의 이점이 사라진다. Slack token은 Secrets Manager ARN으로 참조하되 rotation 후 새 delivery가 성공하는지 확인한다.[1]

CloudTrail, EventBridge archive 또는 별도 audit store에는 notification ID, application, revision, policy decision과 action result를 연결한다. Payload에 repository credential이나 manifest 전체를 싣지 않는다. Notification template도 운영 데이터 유출 경로가 될 수 있다.

## 가용성과 비용

Notifications 기능은 해당 EKS Capability가 제공되는 모든 AWS 리전에서 추가 기능 요금 없이 제공된다. 하지만 SQS, EventBridge, Secrets Manager와 target compute의 표준 요금은 별도다.[1] “무료 알림”이라고 쓰기보다 월 event 수, retry, archive, Lambda invocation과 로그 보존을 합산한다.

또한 notification delivery는 deployment 성공의 transaction이 아니다. EventBridge가 일시적으로 실패해도 Argo CD sync는 진행될 수 있고, 알림 성공이 workload health를 보장하지 않는다. 운영 gate는 delivery rate, end-to-end latency, stale-event 비율, 자동 action의 verified rate를 따로 본다.

이 기능의 안전한 사용법은 실패 이벤트를 더 빠르게 행동으로 바꾸는 것이 아니라, **이벤트를 현재 상태와 대조한 뒤 멱등한 행동만 실행하고 결과를 다시 읽는 것**이다. IAM Capability Role과 Secrets Manager 참조는 credential 배치를 줄이지만 상태 검증과 rollback 정책까지 대신 만들지는 않는다.

## Sources

[1] https://aws.amazon.com/about-aws/whats-new/2026/11/amazon-eks-argo-cd-notifications/
