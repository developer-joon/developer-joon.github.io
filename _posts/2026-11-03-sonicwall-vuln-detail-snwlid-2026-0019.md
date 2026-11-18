---
title: '패치가 없는 EOL 보안관리 서버: SonicWall GMS를 교체 대상으로 판정하는 법'
date: 2026-11-03 09:00:32 +0900
categories: ["개발/보안"]
description: 'SonicWall GMS 9.5.2 이하의 두 취약점과 무패치 EOL 경계를 구분하고, NSM 전환과 철거 증거까지 포함한 교체 런북을 만든다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-sonicwall-vuln-detail-snwlid-2026-0019/1600/900'
tags: [sonicwall, gms, cve-2026-109593, cve-2026-109594, end-of-life, migration]
---

![안개 낀 산길 끝에 놓인 오래된 표지판](https://picsum.photos/seed/news-2026-11-03-sonicwall-vuln-detail-snwlid-2026-0019/1600/900)

보안관리 서버는 방화벽보다 눈에 덜 띄지만, 여러 장비의 설정과 로그를 모으는 만큼 침해 시 파급력이 크다. SonicWall GMS는 이제 “어느 버전으로 패치할까”가 아니라 “언제 어떻게 퇴출할까”를 물어야 하는 제품이 됐다.

SonicWall은 2026년 11월 3일 GMS Virtual Appliance와 Windows 배포의 9.5.2 이하에 두 취약점이 있다고 공개했다.[1]

- CVE-2026-109593: 네트워크 접근이 가능한 인증되지 않은 공격자가 내부 GMS 파일을 읽을 수 있다. CVSS 9.1이다.
- CVE-2026-109594: 인증 후 특정 조건에서 SQL injection으로 GMS DB 정보를 읽거나 바꿀 수 있다. CVSS 6.8이다.[1]

두 항목을 모두 “무인증 RCE”로 부르면 안 된다. 첫 번째는 인증 없는 파일 읽기, 두 번째는 높은 권한이 필요한 SQL 주입이며, advisory는 실제 악용을 주장하지 않는다.[1]

## 수정 버전이 없는 이유

영향 범위는 GMS 9.5.2 이하이고 workaround도 없다. 제품이 EOL이라 SonicWall은 보안 업데이트를 내지 않으며, Network Security Manager(NSM)로 전환하라고 권고한다.[1]

이때 `patch_status=not_available`을 예외 승인으로 끝내면 위험이 무기한 남는다. 상태는 최소한 다음처럼 분리한다.

```text
product_state: supported | end_of_life
exposure_state: internet_reachable | internal_only | isolated | unknown
migration_state: not_started | planned | dual_run | cutover | retired
evidence_state: inventoried | preserved | deletion_verified
```

이 schema는 SonicWall 제품 field가 아니라 내부 운영 제안이다.

## 1. GMS 자산을 appliance와 Windows로 나눈다

CMDB 이름에 `SonicWall`이 없을 수도 있다. Virtual Appliance image, Windows service, DNS, load balancer, backup, hypervisor inventory를 함께 조회한다. 발견한 행에는 다음을 남긴다.

| 필드 | 예시 |
|---|---|
| 배포 형태 | Virtual Appliance / Windows |
| 실행 버전 | 9.5.2 이하 / 확인 불가 |
| 관리 UI 도달성 | 인터넷 / VPN / 관리망 / 미확인 |
| 관리 대상 | firewall 수와 tenant |
| 로그 보존 | 위치와 보존 기간 |
| 소유자 | 운영 팀과 승인자 |

버전을 확인하지 못한 EOL 인스턴스를 안전으로 분류하지 않는다. `unknown`은 교체 우선순위를 낮추는 값이 아니라 조사 미완료다.

## 2. 즉시 완화는 접근 경계를 줄이는 일이다

공식 workaround는 없지만, 마이그레이션이 끝날 때까지 운영 노출을 줄이는 보조 조치는 필요하다.

- 관리 UI를 인터넷에서 제거한다.
- 지정된 관리 jump host와 VPN에서만 접근시킨다.
- GMS service account와 firewall 관리 계정의 권한을 재검토한다.
- EOL 서버에서 새로운 기능·tenant 추가를 중단한다.
- 변경 전에 VM snapshot만 믿지 말고 설정과 로그를 별도 보존한다.

이 조치는 취약점을 수정하지 않는다. `isolated`와 `fixed`는 다른 상태다.

## 3. 전환 전에 보존할 것과 버릴 것을 정한다

관리 플랫폼 이동은 단순 VM 교체가 아니다. 현재 정책, device group, 관리자 역할, scheduled report, syslog 경로, alert recipient를 먼저 목록화한다. 비밀 값은 평문 export에 남기지 않고 새 플랫폼에서 다시 발급한다.

전환 계획에는 다음 gate가 필요하다.

1. NSM 또는 승인된 대체 관리면의 기능·라이선스 적합성 확인
2. 소수 장비로 onboarding과 정책 read-back 시험
3. 동일 변경의 GMS·신규 플랫폼 동시 수행 금지 시점 결정
4. rollback 조건과 책임자 지정
5. 전체 장비의 관리 연결과 로그 수신 검증
6. GMS 계정·API token 폐기와 DNS·방화벽 route 제거
7. backup과 snapshot의 보존·삭제 일정 승인

## 4. 철거 완료를 관찰 가능한 증거로 만든다

전환 후에도 오래된 GMS VM이 켜져 있거나 snapshot에서 쉽게 복원된다면 공격 표면은 남아 있다. 완료 receipt에는 최소한 다음이 들어간다.

- 실행 중 GMS instance 0건
- DNS와 load balancer target 제거
- inbound·outbound firewall rule 제거
- GMS service account와 인증서 폐기
- NSM에서 관리 대상 전체가 보이는지 read-back
- 필요한 감사 로그 보존 위치와 접근 권한
- backup 만료일 또는 법적 보존 근거

EOL 제품은 “패치 불가”가 끝이 아니라 교체를 시작하라는 입력이다. SonicWall advisory의 핵심은 심각도 숫자보다 **수정 release가 존재하지 않는다는 제품 생명주기 경계**다.[1]

## Sources

[1] https://psirt.global.sonicwall.com/vuln-detail/SNWLID-2026-0019
