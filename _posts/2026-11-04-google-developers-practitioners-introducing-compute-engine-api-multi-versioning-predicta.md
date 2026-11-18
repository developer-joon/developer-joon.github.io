---
title: 'Compute Engine API를 날짜로 고정하면 Terraform 드리프트와 장애 반경이 줄어들까'
date: 2026-11-04 09:00:25 +0900
categories: ["클라우드"]
description: 'Compute Engine의 불변 날짜 기반 API 버전을 v1과 비교하고 REST·SDK·gcloud·Terraform의 선택 경로와 업그레이드 증거를 검증한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-google-developers-practitioners-introducing-compute-engine-api-multi-versioning-predicta/1600/900'
tags: [google-cloud, compute-engine, api-versioning, terraform, gcloud, platform-engineering, drift]
---

![Compute Engine 날짜 기반 API 버전의 단계적 업그레이드](https://picsum.photos/seed/news-2026-11-04-google-developers-practitioners-introducing-compute-engine-api-multi-versioning-predicta/1600/900)

Google Compute Engine은 날짜 기반 API multi-versioning을 GA로 공개했다. 첫 stable snapshot은 `2026-09-01`, preview는 `2026-10-01-preview`이며 기존 `/v1`은 계속 지원되고 version을 지정하지 않으면 기본값으로 남는다.[1] Stable 날짜 버전은 발표 뒤 breaking change를 받지 않는 point-in-time contract이고 현재 지원 종료일이 없지만, 이를 영구 지원 약속으로 확대하면 안 된다.[1]

새 버전은 URL path를 바꾸지 않는다. REST 호출은 `X-Goog-Api-Version` header 또는 `$apiVersion` query parameter로 target을 선택한다.[1] 이 특성은 selfLink를 일정하게 유지하지만, log에 version selector를 남기지 않으면 어떤 semantics로 실행됐는지 사후 확인하기 어렵다.

## `/v1`과 stable을 같은 요청으로 비교한다

가장 작은 fixture는 `AggregatedList`다. `/v1`에서는 `returnPartialSuccess` 기본값이 false지만 날짜 기반 버전은 true다.[1] 한 zone의 일시 오류가 있을 때 전체 요청을 실패시킬지 나머지 결과를 반환할지가 달라질 수 있다. 결과 개수만 비교하지 말고 warning과 누락 scope를 기록해야 한다.

잘못된 version identifier도 호출해 본다. 날짜 기반 API는 `google.rpc.ErrorInfo`의 `reason`, `domain`, metadata로 지원 version을 machine-readable하게 전달한다.[1] 기존 automation이 error string regex에 의존한다면 새 structured error로 전환하되, error class와 retry policy가 변하지 않는지 검증한다.

다음 matrix는 **실행 결과가 아니라 제안하는 시험 항목**이다.

| Caller | 비교 대상 | 남길 증거 |
|---|---|---|
| REST | `/v1`, `2026-09-01`, preview | request version, response schema, partial success |
| Client library | 이전·새 dependency | package version과 실제 bound API version |
| gcloud | `gcloud compute`, `gcloud preview compute` | CLI version, invoked surface, request log |
| Terraform | `google`, `google-beta` provider | lockfile, plan JSON, API request trace, state diff |

## Terraform에서는 HCL보다 provider가 version을 고른다

Google의 설명에 따르면 `google` provider는 stable 날짜 API, `google-beta`는 preview API를 내부적으로 사용한다.[1] HCL에 날짜 문자열이 보이지 않아도 provider upgrade가 API contract 채택 시점이 될 수 있다. 따라서 provider version bump와 resource 변경을 한 pull request에 섞지 않는 편이 좋다.

Lockfile을 고정한 상태에서 현재 state를 refresh-only plan하고, provider만 올린 plan을 별도 생성한다. Default 변경, 새 computed field, error model 변화가 plan에 나타나는지 본다. Preview provider에서 만든 field를 stable provider가 보존·무시·삭제하는지도 disposable resource로 확인한다.

## SDK와 CLI의 숨은 선택을 기록한다

Client library는 기존 `compute_v1` 또는 `apiv1` namespace를 유지하면서 release별 날짜 version에 bind된다. Import가 같다는 사실은 semantics가 같다는 뜻이 아니다.[1] Dependency SBOM과 startup log에 library version을 남기고 대표 request의 API version을 trace attribute로 기록한다.

`gcloud compute`는 bundled stable을, `gcloud preview compute`는 bundled preview를 대상으로 한다.[1] CI runner가 자동으로 Cloud SDK를 갱신하면 같은 script가 다른 stable snapshot을 쓸 수 있다. Runner image digest와 gcloud version을 고정하고 upgrade job에서만 새 version을 검증한다.

## Rollout gate

Platform 팀은 production을 `/v1`에서 즉시 옮길 필요가 없다. Staging에서 날짜 version을 명시하고 schema diff, IAM permission, error classification, partial-result 처리와 quota를 검사한다. Canary account에서 read-only inventory부터 시작한 뒤 create/update/delete fixture로 확대한다.

Promotion 조건은 “새 버전 호출이 200을 반환했다”가 아니다. 같은 desired state가 같은 resource를 만들고, 실패가 자동화가 이해하는 형태로 분류되며, partial success에서 누락을 성공으로 오인하지 않고, provider rollback 뒤 state가 파괴되지 않아야 한다. 날짜 고정은 드리프트를 자동 제거하지 않지만 **공급자 변경 시점과 우리 업그레이드 시점을 분리해 장애 반경을 측정 가능하게 만든다.**

## Sources

[1] https://cloud.google.com/blog/topics/developers-practitioners/introducing-compute-engine-api-multi-versioning-predictable-evolution-without-breaking-production
