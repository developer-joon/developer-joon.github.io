---
title: 'IBM Cloud Vault Dedicated GA 검증: 동적 DB 자격증명과 전용 네트워크 구성'
date: 2026-11-03 09:00:30 +0900
categories: ["클라우드"]
description: 'IBM Cloud Secrets Manager Vault Dedicated의 GA 범위와 과금, 단일 테넌트 책임, VPE 연결과 동적 database credential 발급·폐기 경계를 공식 문서 충돌까지 포함해 정리한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-hashicorp-blog-introducing-ibm-cloud-secrets-manager-vault-dedicated/1600/900'
tags: [ibm-cloud, hashicorp-vault, secrets-management, dynamic-credentials, vpe, platform-engineering]
---

![IBM Cloud Vault Dedicated의 전용 연결과 동적 자격증명](https://picsum.photos/seed/news-2026-11-03-hashicorp-blog-introducing-ibm-cloud-secrets-manager-vault-dedicated/1600/900)

IBM은 2026년 11월 3일 Secrets Manager Vault Dedicated를 HashiCorp Vault Enterprise 기반의 IBM 관리형 단일 테넌트 서비스로 소개했다.[1] IBM Cloud 공식 release notes는 **Vault Dedicated plan이 2026년 11월 1일 GA**가 됐다고 명시하고, instance와 resource unit 과금을 기록한다.[2]

이 상태는 조사 중 충돌했다. 검색 index와 일부 과거 문서 snapshot은 여전히 “public beta”, 계정당 1개, Dallas·Frankfurt, 무료, beta instance 삭제라는 문구를 노출했다. 반면 2026년 11월 15일에 다시 가져온 IBM release notes는 11월 1일 GA를 명시하고 현재 pricing 문서는 월 과금을 제공한다.[2][3] 따라서 이 글은 **현재 GA release note와 live pricing을 상태 근거로 사용하되, cached beta 문구가 완전히 사라졌다고 주장하지 않는다.** 구매·provisioning 전에는 계정 catalog와 대상 region 자격을 다시 확인해야 한다.

## GA 범위를 정확히 나눈다

GA인 것은 IBM Cloud의 Vault Dedicated **plan**이다.[2] IBM이 control plane과 전용 Vault Enterprise cluster의 managed operation을 제공하지만 tenant가 namespace, auth method, secret engine, policy와 application integration을 설계해야 한다.[1] “Managed”는 secret consumer 권한과 rotation 정책까지 IBM이 대신 운영한다는 뜻이 아니다.

현재 pricing 문서는 Enterprise Vault Installation을 instance당 월 7,000달러, resource unit을 월 4달러로 설명한다.[3] 새 instance는 provision된 일수만 과금된다고 release note가 적는다.[2] 계약·region·세금과 실제 RU 정의는 구매 시점 문서를 다시 확인한다. 고가 전용 서비스이므로 무료 실습을 전제해서는 안 된다.

## 네트워크부터 검증한다

Private-only 구성에서는 Vault API에 VPE gateway가 필요하고 browser에서 private Vault UI를 쓰려면 IBM Cloud private network로 route하는 Client-to-Site VPN이 필요하다.[4] Cloud Service Endpoint를 VPE와 같은 것으로 취급하면 안 된다. DNS가 private instance endpoint를 올바른 VPE로 해석하고 public egress 없이 API와 UI에 도달하는지 확인한다.

제안하는 network fixture는 다음과 같다.

- 승인된 VPC workload에서 Vault API TLS 연결 성공
- 인터넷 host에서 private endpoint 연결 실패
- VPE security group이 대상 port·source만 허용
- VPN 없는 browser에서 private UI 접근 실패
- VPE 또는 DNS 장애 때 application이 cached secret을 얼마나 유지하는지 확인

이 항목은 실행 결과가 아니라 유상 instance를 준비했을 때 수행할 검증안이다.

## Admin token은 bootstrap 수단이다

초기 admin token은 Vault UI와 기본 auth를 설정하는 데 사용하되 일상 application credential로 남기지 않는다. AppRole 또는 조직의 승인된 auth method로 전환하고 token TTL, policy와 namespace를 제한한다. Break-glass token은 별도 보관, 다중 승인, 사용 경보와 즉시 rotation 절차를 가진다.

Audit event가 IBM Cloud Logs로 전달되는지 확인하고 request ID, namespace, auth accessor, path와 result를 보존한다. Secret 값과 raw token은 log에 남기지 않는다. IBM이 infrastructure를 관리해도 tenant policy의 wildcard와 잘못된 namespace grant는 그대로 위험하다.

## 동적 database credential의 실제 경계

현재 Vault Dedicated secret-engine 문서는 database engine이 PostgreSQL, MySQL 등을 위한 dynamic credential을 만들 수 있다고 설명한다. 사용 전 target database로 private network link를 만드는 destination을 구성해야 한다.[5] 이 기능은 application에 영구 password를 배포하지 않는 데 유용하지만 database admin credential과 revoke 권한의 blast radius를 먼저 제한해야 한다.

제안 fixture는 role에 read-only SQL만 주고 TTL 15분 credential을 발급하는 흐름이다. 발급 직후 connect와 허용 query를 확인하고 write query는 실패해야 한다. Lease revoke 후 기존 connection과 새 connection을 각각 시험하고, TTL 만료 뒤 pool이 새 credential을 받아 재연결하는지 본다. Database outage와 destination 장애 때 Vault가 credential을 발급했지만 적용하지 못한 경우도 구분한다.

Dynamic credential은 “비밀번호가 없다”는 뜻이 아니다. 짧은 수명의 credential이 생성되며 application memory, driver log, APM span에 노출될 수 있다. Rotation 주기보다 connection pool lifetime이 길면 revoke가 기존 session을 즉시 끊지 않을 수도 있으므로 database별 semantics를 측정한다.

## 자체 운영 Vault와 비교할 것

관리형 전용 cluster는 patch, HA infrastructure와 service operation 부담을 줄일 수 있다.[1] 대신 월 고정비, 지원 region, IBM network·logging·billing integration과 service lifecycle에 의존한다. 비교표에는 node 비용만이 아니라 on-call, upgrade rehearsal, backup·DR, audit export, HSM·KMS, support와 exit 비용을 포함한다.

도입 승인은 GA label 하나로 닫지 않는다. Catalog에서 해당 account·region에 유상 GA plan이 실제 보이고, VPE-only 연결이 통과하며, auth·policy·audit와 dynamic credential revoke가 검증돼야 한다. 과거 beta instance가 있었다면 GA instance로 자동 upgrade된다고 가정하지 말고 별도 migration·삭제 증거를 확인한다. 이번 충돌에서 얻을 교훈은 간단하다. **상태는 announcement 제목이나 검색 snippet이 아니라 dated release note, live pricing, 실제 provisioning eligibility를 함께 읽어야 한다.**

## Sources

[1] https://www.ibm.com/new/announcements/introducing-ibm-cloud-secrets-manager-vault-dedicated-hashicorp-vault-enterprise-managed-by-ibm
[2] https://cloud.ibm.com/docs/secrets-manager?topic=secrets-manager-release-notes
[3] https://cloud.ibm.com/docs/secrets-manager?topic=secrets-manager-pricing
[4] https://cloud.ibm.com/docs/secrets-manager?topic=secrets-manager-setting-up-vault-dedicated-instance
[5] https://cloud.ibm.com/docs/secrets-manager?topic=secrets-manager-vault-dedicated-secrets-engines
