---
title: 'Alpine Linux는 침해 의심 GitLab을 어떻게 다시 열었나: 키 회전 뒤 복구 체크리스트'
date: 2026-10-30 09:00:05 +0900
categories: ["개발/도구"]
description: 'Alpine Linux의 GitLab 재구축 사례를 바탕으로 데이터 복원과 신뢰 재수립을 분리하고 사용자·프로젝트·CI 자격 증명을 계층별로 복구하는 체크리스트를 만듭니다.'
featured_image: 'https://picsum.photos/seed/news-2026-10-30-alpinelinux-posts-gitlab-reopened-after-security-incident/1600/900'
tags: [alpine-linux, gitlab, incident-response, secret-rotation, ssh, ci-cd]
---

![새벽 산 아래 다시 켜진 건물의 불빛](https://picsum.photos/seed/news-2026-10-30-alpinelinux-posts-gitlab-reopened-after-security-incident/1600/900)

Alpine Linux는 CVE-2026-97229 악용 시도 뒤 GitLab을 새 서버에 처음부터 구축하고 GitLab 19.3.7과 수정이 포함된 Ruby 3.3.13으로 다시 열었다. 계정·project·issue·merge request는 복원했지만 GitLab secret key를 교체했기 때문에 password, 2FA, token과 일부 저장 secret은 다시 설정해야 했다.[1]

이 사례의 핵심은 **데이터가 돌아왔다고 신뢰까지 복원된 것은 아니라는 점**이다. Backup은 object를 되살릴 수 있지만 이전 key로 암호화된 값, 유출 가능성이 있는 credential, 새 server identity는 별도 절차가 필요하다.

## 먼저 사건 표현을 제한한다

Alpine의 공식 incident report가 설정한 경계는 정확하다. **Exploit이 성공했다는 증거는 없지만 성공 가능성을 배제할 수도 없어서 instance를 compromised로 취급하고 처음부터 재구축했다.** 한편 GitLab 밖의 developer clone과 45개 builder 등 외부 기록으로 대조한 결과, aports repository와 검사 범위의 package·10월 21일 release가 변조됐다는 흔적은 없었다.[2] 따라서 이를 package 변조가 확정된 사건으로 넓혀 쓰면 안 된다. 운영 대응은 불확실성을 보수적으로 다룰 수 있고, 사후 설명은 확인된 사실과 가능성을 구분해야 한다.

## 자격 증명을 계층별로 분류한다

| 계층 | Alpine 사례의 상태 | 복구 행동 |
|---|---|---|
| 사용자 인증 | password·2FA reset | 새 password, 2FA, recovery code 발급 |
| Git HTTPS/API | 기존 PAT 무효 | 최소 scope·만료를 가진 새 token |
| SSH server identity | host key 변경 | 공식 fingerprint 확인 후 known_hosts 교체 |
| 사용자 공개키 | SSH·GPG key 유지 | 무조건 재업로드하지 말고 read-back |
| Feed·메일 | RSS/calendar token·private email reset | 새 URL·주소 배포 |
| CI/CD | variable 이름·설정 유지, 값은 비어 있음 | 새 credential로 값 재입력 |
| Integration | token·password 재입력 | webhook·mirror secret도 회전 |
| OAuth app | secret 교체 필요 | 새 secret 배포 후 이전 값 폐기 |

공식 안내는 password 재설정과 2FA 재등록, 기존 recovery code 폐기를 요구한다. SSH host key는 바뀌었지만 사용자의 SSH·GPG 공개키는 유지됐다. CI/CD variable은 이름과 설정은 남고 값은 비어 있다.[1]

## 복구 runbook은 object와 secret을 분리한다

아래 목록은 **실행 결과가 아닌 훈련용 제안 fixture**다.

```yaml
restore_inventory:
  objects:
    - users
    - projects
    - issues
    - merge_requests
  server_identity:
    - ssh_host_keys
    - tls_certificate
  user_credentials:
    - passwords
    - two_factor_seeds
    - recovery_codes
    - personal_access_tokens
  project_secrets:
    - ci_cd_variables
    - schedule_variables
    - integration_secrets
    - webhook_tokens
    - mirror_passwords
    - oauth_secrets
```

각 항목에 `restored`, `intentionally_invalidated`, `must_rotate`, `verified` 상태를 둔다. “복원됨” 하나로 통합하면 값이 빈 CI variable과 정상 복구된 issue를 구분할 수 없다.

## SSH 경고를 자동으로 지우지 않는다

새 server에서 host key 경고가 뜬다고 `StrictHostKeyChecking=no`로 우회하면 재구축 과정의 중요한 identity 검증을 없앤다. Alpine은 새 ED25519·ECDSA·RSA fingerprint를 공식 글에 게시했다.[1] 운영자는 별도 신뢰 경로에서 fingerprint를 확인하고 exact hostname의 old entry만 제거한 뒤 새 key를 등록해야 한다.

## CI는 이름이 남아 있어 더 위험하다

Variable 이름과 protection·mask 설정이 보존되더라도 값이 비면 pipeline은 즉시 실패하거나, 더 나쁘게 fallback credential로 동작할 수 있다. 복구 전에 pipeline schedule과 deploy job을 일시 중지하고 다음 순서로 처리한다.

1. Credential owner와 destination을 확인한다.
2. 가능하면 이전 값 재사용 대신 새 값을 발급한다.
3. Scope·expiry·environment protection을 축소한다.
4. 값을 입력한 뒤 secret 자체가 아니라 인증 성공과 대상 identity를 확인한다.
5. 이전 credential이 provider 쪽에서 폐기됐는지 read-back한다.

Alpine은 webhook과 push mirror가 이동 후 동작할 수 있어도 secret token과 password가 노출됐을 가능성을 고려해 교체하라고 했다. Integration과 OAuth application secret도 다시 설정해야 한다.[1]

## 재개 승인 기준

서비스 health check만으로 재개하지 않는다. 사용자 로그인, 2FA, Git over SSH·HTTPS, API token, scheduled pipeline, protected deployment, webhook signature, mirror destination을 각각 canary로 확인한다. 새 계정의 admin approval 정책처럼 사건 뒤 바뀐 운영 정책도 문서화한다.[1]

복구의 끝은 “GitLab 화면이 열린 시각”이 아니다. 어떤 object가 복원됐고 어떤 credential은 의도적으로 무효화됐으며, 새 server identity를 누가 어떤 공식 근거로 승인했는지가 남아야 한다. 그 구분이 있어야 backup 복원과 trust re-establishment를 같은 완료 체크박스로 처리하지 않는다.

## Sources

[1] https://alpinelinux.org/posts/gitlab-reopened-after-security-incident/

[2] https://alpinelinux.org/posts/gitlab-security-incident-cve-2026-97229/
