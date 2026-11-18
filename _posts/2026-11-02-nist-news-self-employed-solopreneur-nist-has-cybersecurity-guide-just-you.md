---
title: '1인 사업자를 위한 NIST CSF 2.0: 백업·업데이트·기본 비밀번호부터 시작하기'
date: 2026-11-02 09:00:38 +0900
categories: ["개발/보안"]
description: '최종본 NIST CSWP 50의 대상을 보존하며, 1인 온라인 상점이 자산·백업·업데이트·기본 비밀번호를 주간 증거로 관리하는 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-nist-news-self-employed-solopreneur-nist-has-cybersecurity-guide-just-you/1600/900'
tags: [nist-csf-2-0, cswp-50, solopreneur, small-business, backup, cyber-hygiene]
---

![작은 작업실 책상 위 노트북과 포장 상자](https://picsum.photos/seed/news-2026-11-02-nist-news-self-employed-solopreneur-nist-has-cybersecurity-guide-just-you/1600/900)

1인 사업자는 보안팀이 없는 작은 회사가 아니라, 영업·회계·고객지원·IT를 한 사람이 동시에 맡는 조직이다. 긴 통제 목록보다 다음 주에도 반복할 수 있는 작은 루틴이 필요하다.

NIST는 2026년 11월 2일 최종본 `Small Business Cybersecurity: Non-Employer Firms`(NIST CSWP 50)를 공개했다. 보수를 받는 직원이 소유자 외에는 없고 IT 복잡성이 낮은 non-employer firm이 CSF 2.0으로 사이버보안 위험을 관리하도록 돕는 자료다.[1][2]

최종 문서는 NIST IR 7621 Rev.1을 대체한다. 모든 사업자의 필요를 포괄하지 않으며, sector·규모·자원·계약·규제에 따라 구현이 달라진다고 명시한다.[2][3]

## 먼저 범위를 그린다

가상의 1인 온라인 상점을 생각해 보자.

| 자산 | 잃었을 때 영향 | 첫 통제 |
|---|---|---|
| 쇼핑몰 관리자 | 주문·고객정보 노출 | MFA와 별도 관리자 계정 |
| 이메일 | 비밀번호 reset 장악 | phishing-resistant MFA 가능성 검토 |
| 노트북 | 업무 중단·정보 유출 | 암호화와 자동 update |
| 고객·주문 DB | 영업 중단·신뢰 손상 | backup과 복원 시험 |
| 공유기 | 전체 network 노출 | 기본 비밀번호 변경, firmware update |
| 결제·배송 SaaS | 공급자 장애 | 연락처·export·대체 절차 |

NIST는 정기 backup, software update, 제조사 기본 password 변경을 중요한 첫 행동으로 제시한다.[1]

## 주간 한 장 체크리스트

```text
[ ] 핵심 SaaS와 기기 목록에 새 항목이 없는가
[ ] 운영체제·브라우저·쇼핑몰 plugin update가 대기 중인가
[ ] backup job이 성공했는가
[ ] 샘플 파일 하나를 별도 위치에 복원했는가
[ ] 관리자·이메일 계정에 MFA가 켜져 있는가
[ ] 공유기·카메라·프린터의 기본 비밀번호가 남아 있지 않은가
[ ] 지난주 의심 로그인·결제·배송 알림을 검토했는가
[ ] 공급자 장애 시 연락처와 수동 업무 절차가 최신인가
```

이 목록은 NIST의 공식 worksheet를 그대로 옮긴 것이 아니라, 핵심 행동을 주간 운영으로 바꾼 **제안 템플릿**이다.

## 백업은 성공 알림보다 복원이 중요하다

Cloud sync는 삭제·암호화를 그대로 동기화할 수 있다. 최소 하나는 운영 계정과 다른 credential·보존 정책을 가진 backup이어야 한다. 매주 작은 파일을 복원하고, 분기마다 주문 export나 전체 설정을 별도 환경에서 읽을 수 있는지 확인한다.

기록에는 `backup_started`, `backup_completed`, `restore_verified`를 나눈다. 마지막 성공 시각만 있고 restore 결과가 없으면 복구 가능성을 증명하지 못한다.

## 업데이트는 소유자와 기한을 붙인다

1인 사업자에게도 update queue는 여러 개다.

- 노트북 OS와 browser
- 쇼핑몰 core·theme·plugin
- 공유기·NAS·printer firmware
- mobile 앱
- SaaS의 보안 설정 변경

자동 update를 기본으로 두되, 영업 중단 위험이 큰 항목은 backup과 rollback을 준비한다. 장기 pin은 편의가 아니라 만료일 있는 예외다.

## 기본 비밀번호 제거를 한 번의 캠페인으로 끝내지 않는다

NIST 예시는 제조사 기본 password를 공격자가 쉽게 찾아 기기에 접근할 수 있다고 설명한다.[1] 새 기기 onboarding 때 다음 gate를 둔다.

1. 기본 credential 변경
2. 고유한 긴 password 또는 관리형 secret 사용
3. MFA 지원 여부 확인
4. 불필요한 remote administration 끄기
5. owner와 firmware update 경로 기록

성장해 직원을 고용하면 개인 계정, onboarding/offboarding, 권한 검토 절차로 확장한다.[1][3]

## 한국 사업자에게 적용할 때의 경계

CSWP 50은 미국 독자를 중심으로 쓴 사이버보안 지침이다.[3] 이를 한국 개인정보보호법의 준수 체크리스트나 인증 기준이라고 부르면 안 된다. 다만 자산 목록, backup, update, account 보호 같은 일반 운영 원칙은 현지 법률·계약 의무와 함께 참고할 수 있다.

또한 2,800만 개 이상이라는 수치는 미국의 non-employer firm 맥락이다.[1] 국내 사업체 수로 옮겨 쓰지 않는다.

## 성장 시 추가할 것

- 직원별 계정과 퇴사 즉시 offboarding
- 중앙 password manager와 device management
- incident 연락망과 외부 지원 계약
- 공급자 risk review
- 개인정보 보존·삭제 정책
- 정기 restore와 phishing 훈련

NIST의 최종본 지위도 중요하다. 2026년 4월 initial public draft는 11월 2일 최종본으로 대체됐다. 구현 근거는 draft가 아니라 최종 DOI와 publication page를 사용한다.[2][3]

1인 조직의 보안은 거대한 framework를 전부 채우는 일이 아니다. 가장 중요한 자산을 알고, backup을 실제 복원하고, update를 미루지 않으며, 기본 credential을 없애는 반복 가능한 주간 시스템을 만드는 일이다.

## Sources

[1] https://www.nist.gov/news-events/news/2026/11/self-employed-solopreneur-nist-has-cybersecurity-guide-just-you
[2] https://csrc.nist.gov/pubs/cswp/50/small-business-cybersecurity-non-employer-firms/final
[3] https://doi.org/10.6028/NIST.CSWP.50
