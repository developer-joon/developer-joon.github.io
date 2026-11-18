---
title: 'LLMJacking 탐지 런북: 클라우드 감사 로그에서 모델 자원 탈취 신호 찾기'
date: 2026-11-02 09:00:28 +0900
categories: ["클라우드"]
description: 'Mandiant가 관찰한 LLMJacking 수명주기를 바탕으로 AWS·GCP·Azure의 identity·model·logging·compute 신호를 상관 분석하고 격리·회전·비용 차단 절차를 만든다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-google-threat-intelligence-llmjacking-monetizing-compromised-cloud-models/1600/900'
tags: [llmjacking, cloud-security, threat-detection, iam, audit-log, finops, incident-response]
---

![LLMJacking의 identity 탈취와 모델 사용량 탐지 흐름](https://picsum.photos/seed/news-2026-11-02-google-threat-intelligence-llmjacking-monetizing-compromised-cloud-models/1600/900)

Google Threat Intelligence Group과 Mandiant는 2026년 대응한 복수 사건에서 탈취한 cloud identity와 model credential로 LLM 자원을 재판매하는 “LLMJacking” 수명주기를 공개했다. 관찰된 초기 접근에는 IAM credential, service account key, GitHub PAT, active session token이 포함됐고 공격자는 repository와 datastore에서 추가 secret을 찾고 새 IAM account·service account·SSH key로 지속성을 만들었다.[1]

공개 사건 중에는 하루 10만 달러를 넘는 부정 사용과 차단 전 누적 100만 달러에 이른 사례가 있었다.[1] 이는 모든 사용량 급증이 공격이라는 통계가 아니다. Mandiant가 대응한 사례의 관찰값이며 환경별 정상 batch, evaluation, agent burst와 구분해야 한다.

## 단일 비용 경보보다 공격 chain을 본다

모델 token 급증은 마지막 신호일 수 있다. 더 이른 단계는 identity enumeration, logging 약화, 새 credential과 compute persistence다. 탐지 ledger를 다음 단계로 연결한다.

```text
credential use
  → model/service discovery
  → agreement·quota·deployment change
  → logging disable or audit weakening
  → new IAM/service account/SSH key
  → high-rate model POST or GPU provisioning
  → proxying and resale
```

한 신호만으로 차단하지 않고 같은 principal, source IP, session, user-agent와 짧은 시간창에서 상관 분석한다. 반대로 logging disable과 새 admin identity가 겹치면 비용 임계치 도달 전에도 높은 severity로 올린다.

## Cloud별 fixture

Mandiant가 공개한 관찰 API와 IOC를 기반으로 격리된 sample log에서 다음 규칙을 제안한다.[1]

- AWS: Bedrock model enumeration, agreement 생성, 비정상 region 순회, audit 설정 변경
- Google Cloud: service account·key 생성, 다른 service account token 생성, project SSH key 변경, model endpoint 대량 호출
- Azure: model deployment 쓰기, credential·role 변경, 비정상 model request
- 공통: 새로운 SDK user-agent, 대량 POST, 평소와 다른 ASN·국가, quota·billing alert 변경

Rule test는 malicious sample만 넣지 않는다. 정상 Terraform apply, model catalog inventory, disaster recovery, load test와 CI를 negative fixture로 넣어 false positive를 계산한다. API 이름과 resource type은 실제 audit schema의 service·method field로 고정하고 search string만 쓰지 않는다.

## 조사와 차단 순서

첫 대응은 billing cap 하나가 아니다. Compromised principal을 disable하고 active session과 key를 revoke하며, 같은 repository·secret store에서 노출된 credential을 범위별로 회전한다. 새로 만든 IAM identity, SSH key, model deployment와 GPU instance를 inventory하고 승인 기록이 없는 resource를 격리한다.

동시에 audit log를 보존한다. 공격자가 logging을 끈 흔적이 있다면 cloud provider의 organization-level log, network flow, billing export, repository audit와 endpoint log를 시간축으로 합친다. 모델 prompt·response 원문은 조사 필요성과 개인정보를 따져 최소 수집한다.

단순 key rotation만으로 닫지 않는다. 공격자가 고권한 service account token 생성 권한이나 persistence identity를 남겼다면 새 key도 다시 탈취할 수 있다. Root cause, lateral movement, data access와 비용 charge dispute 증거를 따로 닫는다.

## 예방 통제

장기 static key를 줄이고 workload identity와 짧은 token을 사용한다. Model 사용 principal은 deploy, invoke, quota 변경과 logging 관리 권한을 분리한다. Generated code나 query를 실행해야 하는 agent는 process·network가 격리된 sandbox에 둬야 한다는 것이 Mandiant의 권고 중 하나다.[1]

FinOps control도 security control로 다룬다. Principal·model·region·project별 rate와 spend anomaly를 만들고 billing alert 변경은 별도 보안 이벤트로 남긴다. 그러나 hard cap이 production을 함께 끊을 수 있으므로 자동 조치는 신규 deployment와 suspect identity 차단, 기존 고객 traffic 유지 같은 단계로 나눈다.

완료 조건은 사용량이 정상으로 돌아온 것이 아니다. 최초 credential 경로가 설명되고, 공격자가 만든 persistence가 제거되며, 모든 관련 secret과 session이 회전되고, audit coverage가 복구되고, 같은 sample에서 rule이 다시 탐지해야 한다. LLMJacking은 모델 비용 사건이면서 identity incident다. 두 장부를 함께 닫아야 재발을 막을 수 있다.

## Sources

[1] https://cloud.google.com/blog/topics/threat-intelligence/llmjacking-monetizing-compromised-cloud-models
