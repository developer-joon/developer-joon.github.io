---
title: 'AWS Security Hub Remediation Plans: Root Cause를 변경 승인과 검증으로 연결하는 법'
date: 2026-10-05 10:30:00 +0900
categories: ["개발/보안"]
description: 'Security Hub가 exposure finding을 공통 원인별 plan으로 묶는 방식을 살펴보고, 공급자 우선순위와 실행 권한을 분리해 owner 승인·rollback·read-back까지 연결하는 변경 통제를 설계한다.'
featured_image: 'https://picsum.photos/seed/aws-security-hub-remediation-plans-change-control/1600/900'
tags: [aws, security-hub, remediation-plans, cloud-security, change-management, least-privilege, rollback]
---

![AWS Security Hub Remediation Plans 변경 통제](https://picsum.photos/seed/aws-security-hub-remediation-plans-change-control/1600/900)

클라우드 보안 대시보드에 노출 항목이 수백 개 쌓이면 severity가 높은 finding부터 하나씩 닫기 쉽다. 그러나 같은 과도한 IAM policy나 잘못된 resource setting에서 파생됐다면 개별 티켓은 원인을 놓친다.

AWS는 2026년 10월 1일 Security Hub에 **Remediation Plans**를 추가했다. 공통 root cause를 공유하는 exposure finding을 묶고, 하나의 misconfiguration이나 overly permissive policy를 고쳐 여러 exposure를 해결하거나 severity를 낮추도록 안내하는 기능이다. 각 plan은 Critical·High·Medium·Low 우선순위, impact assessment, 단계별 지침, AWS CLI·Terraform·CloudFormation·Python·CDK 예시를 제공한다.[1]

제공 범위와 비용 표현에는 경계가 필요하다. Remediation Plans는 **Security Hub가 제공되는 모든 AWS Region**에서 쓸 수 있고 **Security Hub Essentials plan 안에서 이 기능 때문에 붙는 추가 비용은 없다**.[1] 그렇다고 전체 운영이 무료라는 뜻은 아니다. Essentials 자체는 resource 단위 가격 체계이며,[2] 예를 들어 별도 솔루션인 Automated Security Response on AWS는 수정 실행·workflow·로그에 사용하는 Systems Manager Automation, Lambda, Step Functions, CloudWatch, CloudTrail 등의 비용이 구성과 사용량에 따라 발생할 수 있다고 안내한다.[3]

## Finding 묶음을 실행 단위로 다시 검토한다

공통 원인은 곧 안전한 일괄 변경을 뜻하지 않는다. 같은 policy를 참조해도 resource owner, 배포 pipeline, SLO, maintenance window가 다르고, 제거할 permission에 의존하는 workload가 있을 수 있다. 실행 전에 다음을 확인한다.

1. **원인**: 연결된 finding이 같은 설정과 resource snapshot을 가리키는가.
2. **의존성**: 영향을 받는 workload와 identity를 찾았는가.
3. **소유권**: 한 owner의 승인 범위인가, 공동 승인이 필요한가.
4. **배포 단위**: 같은 canary와 rollback 절차를 적용할 수 있는가.

이는 AWS가 요구하는 schema가 아니라 **조직 내부 검토 기준의 예시**다. 조건이 다르면 실행 ticket을 나누되 공통 원인과 finding 관계는 보존한다.

## 공급자 priority를 사업 영향으로 번역한다

Security Hub는 plan에 priority를 부여하고 risk를 많이 줄이는 plan이 먼저 보이도록 정렬한다.[1] 하지만 공개 발표만으로는 ranking이 조직의 매출 영향, exploitability, 보상 통제, 규제 의무, 변경 실패 비용을 모두 반영한다고 볼 수 없다.

따라서 AWS priority는 후보 정렬 값으로 보존하고, 조직의 실행 순서는 public reachability, cross-account 접근, 사용 중인 credential, 데이터 등급, 복구 목표와 maintenance window를 더해 결정한다. **조직 기록 예시**로 `vendor_priority`와 `approved_execution_order`를 분리하면 순서를 바꾼 책임자와 근거를 남길 수 있다.

## 제공된 예시를 현재 환경의 변경안으로 검증한다

Plan의 impact assessment와 단계별 guidance, 여러 자동화 형식은 구현 출발점이다.[1] 다만 AWS가 **제공한 예시**는 현재 계정의 source of truth나 검증 완료된 명령이 아니다. resource identifier·Region·현재 상태가 실제 대상과 다를 수 있고, Console 변경은 다음 Terraform 배포에서 되돌아갈 수 있다.

실행 전 대상 account·Region·resource ID와 현재 configuration을 조회 시점 snapshot으로 고정하고, 연결 finding, 최소 diff, 실제 IaC 위치를 기록한다. 정상 동작 smoke test, 차단돼야 할 security test, canary·중단 조건, rollback artifact와 담당자도 준비한다. IaC 관리 대상이면 관리 코드를 먼저 바꾸고 guidance의 의도와 diff를 대조한다.

여기서 `organization_plan_record_id`와 `root_cause_snapshot_revision` 같은 이름을 쓴다면 **AWS Remediation Plans의 실제 응답 필드가 아니라 조직 내부 record ID와 조회 시점 snapshot 식별자라는 운영 제안**임을 schema에 명시해야 한다. AWS가 제공하는 필드처럼 문서화하거나 API 계약으로 가정하지 않는다.

## 읽기, 제안, 실행 권한을 분리한다

AWS는 AI agent가 API로 remediation plan을 소비해 보안 수정을 자동화할 수 있다고 설명한다.[1] API로 읽기, 변경안 생성, 실제 resource 수정은 서로 다른 권한이어야 한다. 다음 표 전체는 AWS의 필수 역할 모델이 아닌 **조직별 역할·credential 설계 예시**다.

| 조직 예시 역할 | 별도 credential의 허용 범위 | 금지 범위 |
|---|---|---|
| Plan consumer | plan·finding·대상 metadata 읽기 | resource 변경 |
| Change proposer | IaC branch·change set 생성, simulation·dry run 요청 | 승인 없는 merge·apply |
| Change executor | 승인된 account·Region·resource·시간 안에서 적용하고 증거 기록 | 대상 확대·자체 승인 |

AI agent에는 consumer 또는 proposer credential만 주고, executor는 별도 automation identity로 둔다. **조직별 승인 봉투 예시**는 내부 record ID, 대상 allowlist, artifact digest, 승인 만료 시각을 묶는다. 이때 `artifact_digest`도 AWS plan 필드가 아니라 조직이 승인한 IaC commit, template 또는 change set의 바이트를 식별하는 내부 값이다. Executor는 digest와 범위가 모두 일치할 때만 실행하고, agent가 만든 문자열은 허용 operation과 resource scope로 다시 검증한다.

## 승인은 특정 변경 artifact에 붙인다

Security owner는 exposure와 통제 목표를, resource owner는 workload 의존성과 정상 동작을, platform owner는 배포·rollback 경로를 확인한다. 승인 요청에는 내부 record ID와 조회 시점 snapshot, vendor priority와 내부 순서, root-cause resource와 연결 finding, 대상 allowlist, 예상 diff, test·중단 조건, rollback, 실행 owner, 만료 시각을 넣는다. 이 목록도 **조직 운영 기록의 예시**이며 AWS 필드 목록이 아니다.

승인은 plan 제목이나 “High” label이 아니라 특정 revision의 변경 artifact에 붙는다. snapshot이나 IaC diff가 바뀌면 재승인하고, 실행 중 새 resource를 발견해도 자동으로 범위를 넓히지 않는다.

## 적용 성공과 검증 성공을 분리한다

적용 뒤에는 두 가지 read-back이 필요하다. **Configuration read-back**은 실제 resource와 policy를 다시 읽어 승인된 desired state와 비교한다. API success나 pipeline exit code만으로 완료하지 않는다. **Security read-back**은 연결된 exposure finding이 기대대로 해결되거나 severity가 낮아졌는지 확인한다. AWS는 한 원인 수정으로 여러 exposure를 해결하거나 낮출 수 있다고 설명하지만 모든 finding의 즉시 종료를 보장하지는 않는다.[1]

Rollback 조건은 canary 필수 동작 실패, error rate·latency 임계치 초과, 예상 밖 principal 영향, 부분 적용, configuration 불일치로 미리 정한다. 원복 뒤에도 이전 configuration과 정상 기능을 다시 확인한다.

상태 기록 역시 **조직 예시**로 `received → scope_validated → proposed → approved → canary/rollout → config_verified + security_verified` 정도면 충분하다. 실패는 `rolled_back` 또는 `needs_review`와 근거·다음 owner를 남긴다. 이는 Security Hub 공식 상태 전이 또는 schema가 아니며, 핵심은 `applied`와 `verified`를 같게 취급하지 않는 데 있다.

## 결론

Remediation Plans는 개별 finding queue를 공통 원인 중심의 변경 후보로 압축한다. 하지만 provider ranking은 조직의 사업 영향 순위를 확정하지 않고, API 소비 가능성은 안전한 apply·rollback·drift 처리를 보장하지 않는다. 기능의 추가 비용이 없다는 발표도 Essentials 구독과 실행·자동화·logging 비용까지 무료라는 뜻은 아니다.

조직은 plan을 자동 수정 완료가 아닌 검토 입력으로 다뤄야 한다. 읽기와 실행 credential을 분리하고, 특정 artifact와 범위를 승인하며, canary 뒤 configuration과 finding을 각각 read-back할 때 root-cause grouping이 설명 가능한 변경 통제로 이어진다.

## Sources

[1] https://aws.amazon.com/about-aws/whats-new/2026/10/aws-security-hub-remediation-plans/ — AWS Security Hub introduces remediation plans to prioritize and fix security exposures
[2] https://docs.aws.amazon.com/securityhub/latest/userguide/security-hub-usage-page.html — Monitoring usage and costs in Security Hub
[3] https://docs.aws.amazon.com/solutions/latest/automated-security-response-on-aws/cost.html — Automated Security Response on AWS: Cost
