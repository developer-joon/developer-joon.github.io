---
title: 'openSUSE Leap 16.1 Immutable Mode 실전: 스냅샷 업데이트와 한 명령 롤백을 검증한다'
date: 2026-11-03 09:00:02 +0900
categories: ["개발/도구"]
description: 'Leap 16.1의 일반 모드와 Immutable Mode를 나란히 설치해 transactional-update 스냅샷, 재부팅 경계, rollback, 컨테이너 기반 소프트웨어 설치와 Leap Micro 마이그레이션 경계를 검증합니다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-opensuse-leap-unites-traditional-and-immutable/1600/900'
tags: [opensuse, leap-16-1, immutable-linux, transactional-update, rollback, podman]
---

![산 능선을 가로지르는 두 갈래 길과 밝은 하늘](https://picsum.photos/seed/news-2026-11-03-opensuse-leap-unites-traditional-and-immutable/1600/900)

openSUSE Leap 16.1은 별도 배포판이던 Leap Micro의 방식을 정규 설치 이미지 안의 **Immutable Mode**로 통합했다. Agama 설치기에서 일반 모드와 읽기 전용 루트 파일시스템 기반 모드 중 하나를 고르고, Immutable Mode의 업데이트는 `transactional-update`로 새 스냅샷을 만든다.[1]

중요한 변화는 “immutable이 더 안전하다”는 표어가 아니다. 업데이트가 현재 실행 중인 root를 직접 덮지 않고 다음 부팅에 적용될 스냅샷을 만든다는 운영 계약이다. 따라서 성공 판정도 명령 종료 코드 하나가 아니라 스냅샷 생성, 재부팅 전후 버전, 실패 시 이전 스냅샷 복귀까지 포함해야 한다.

## 두 VM으로 차이를 고정한다

동일한 CPU·메모리·디스크를 가진 VM 두 대를 만들고 하나는 Traditional, 다른 하나는 Immutable Mode로 설치한다. 설치 매체, 체크섬, 선택한 pattern, 네트워크 저장소를 기록한다. Leap 16.1은 하나의 배포판 이미지에서 desktop, 전통 서버, container·VM host, edge 역할을 포괄하므로 “같은 ISO”만으로 설치 결과가 같다고 가정하면 안 된다.[1]

아래 명령은 **실행하지 않은 제안 fixture**다. `TEST_PACKAGE`는 이 VM에 아직 설치되지 않은 안전한 테스트 패키지로 고정하고, 단계마다 evidence를 보존한다. `transactional-update pkg install`, `rollback last`, 각 변경 뒤 재부팅이 필요하다는 절차는 공식 SUSE 문서와 openSUSE man page의 명령 계약에 맞췄다.[2]

```bash
# 1단계: 변경 전 기준선과 다음 부팅 snapshot을 기록한다.
set -euo pipefail
mkdir -p evidence
TEST_PACKAGE='tree'

cat /etc/os-release > evidence/os-release.before
findmnt -no SOURCE,FSTYPE,OPTIONS / > evidence/root.before
sudo snapper --iso list --columns number,default,active,date,description \
  > evidence/snapshots.before
sudo btrfs subvolume get-default / > evidence/default-subvolume.before
if rpm -q "$TEST_PACKAGE" > evidence/package.before 2>&1; then
  echo "$TEST_PACKAGE must be absent before this test" >&2
  exit 64
fi

sudo transactional-update pkg install "$TEST_PACKAGE" \
  2>&1 | tee evidence/install.log
sudo snapper --iso list --columns number,default,active,date,description \
  > evidence/snapshots.after-install
sudo btrfs subvolume get-default / > evidence/default-subvolume.after-install
if rpm -q "$TEST_PACKAGE" > evidence/package.before-reboot 2>&1; then
  echo "running snapshot changed before reboot" >&2
  exit 65
fi

echo 'STOP: reboot is required; continue with phase 2 after boot.'
sudo systemctl reboot
```

재부팅 뒤에는 같은 `TEST_PACKAGE` 값을 사용해 새 snapshot이 실제로 active가 됐고 package가 보이는지 확인한다. 검증을 통과한 뒤에만 마지막 working snapshot을 rollback 대상으로 지정한다.

```bash
# 2단계: 새 snapshot 활성화 확인 후 rollback을 예약한다.
set -euo pipefail
mkdir -p evidence
TEST_PACKAGE='tree'

findmnt -no SOURCE,FSTYPE,OPTIONS / > evidence/root.after-install-reboot
sudo snapper --iso list --columns number,default,active,date,description \
  > evidence/snapshots.after-install-reboot
sudo btrfs subvolume get-default / \
  > evidence/default-subvolume.after-install-reboot
rpm -q "$TEST_PACKAGE" > evidence/package.after-install-reboot

sudo transactional-update rollback last \
  2>&1 | tee evidence/rollback.log
sudo snapper --iso list --columns number,default,active,date,description \
  > evidence/snapshots.after-rollback-command
sudo btrfs subvolume get-default / \
  > evidence/default-subvolume.after-rollback-command

echo 'STOP: rollback also requires a reboot; continue with phase 3 after boot.'
sudo systemctl reboot
```

```bash
# 3단계: rollback snapshot과 package 상태를 최종 확인한다.
set -euo pipefail
mkdir -p evidence
TEST_PACKAGE='tree'

findmnt -no SOURCE,FSTYPE,OPTIONS / > evidence/root.after-rollback-reboot
sudo snapper --iso list --columns number,default,active,date,description \
  > evidence/snapshots.after-rollback-reboot
sudo btrfs subvolume get-default / \
  > evidence/default-subvolume.after-rollback-reboot
if rpm -q "$TEST_PACKAGE" > evidence/package.after-rollback-reboot 2>&1; then
  echo "rollback verification failed: $TEST_PACKAGE is still installed" >&2
  exit 66
fi
```

Immutable Mode에서는 install 직후 `active`와 `default`가 갈라지고 실행 중인 root의 package 상태는 아직 바뀌지 않았는지 먼저 본다. 첫 재부팅 뒤에는 둘이 새 snapshot을 가리키며 package가 설치됐는지, rollback 재부팅 뒤에는 이전 snapshot이 active이고 package가 다시 사라졌는지 확인한다. 일반 모드 VM에서는 같은 package 작업의 반영 시점과 filesystem 상태를 비교한다.

## rollback은 장애 종류를 한정해서 시험한다

공식 발표는 문제가 생기면 한 명령으로 system rollback이 가능하다고 설명한다.[1] 그러나 이것을 디스크 손상, bootloader 파손, application data corruption까지 모두 복구한다는 뜻으로 넓히면 안 된다. Snapshot이 포함하는 system state와 별도 persistent data의 경계를 먼저 적는다.

안전한 실험은 테스트 package나 설정 하나를 의도적으로 바꾼 snapshot으로 부팅한 뒤 이전 snapshot으로 되돌아가는 것이다. 각 단계에서 다음을 보존한다.

- 활성 snapshot ID와 기본 subvolume
- 변경 전후 package version
- 재부팅 횟수와 선택한 boot entry
- rollback 명령의 stdout·stderr와 exit code
- `/var`, container volume, 사용자 데이터의 보존 여부

“한 번 복구됐다”를 만능 복구 보증으로 쓰지 않는다. Kernel·driver·bootloader처럼 장애 표면이 다른 항목은 별도 fixture가 필요하다.

## 추가 소프트웨어는 root 변경과 분리한다

Leap 16.1 발표는 Immutable Mode의 추가 소프트웨어 경로로 Podman·Distrobox, desktop에서는 Flatpak을 제시한다.[1] 운영 도구를 무조건 host package로 넣기보다 container image digest, volume, network, update 책임을 따로 기록한다. Distrobox가 편리해도 host kernel과 device 권한을 공유하는 범위는 별도 보안 검토 대상이다.

## Leap Micro 이동은 아직 실험 경로다

기존 Leap Micro 6.2는 openSUSE Migration Tool로 Leap 16.1 Immutable Mode에 이동할 수 있지만 공식 발표가 이 경로를 **experimental**로 규정하고 백업을 먼저 만들라고 명시한다. Leap Micro 6.3이나 7.0은 나오지 않고 Immutable Mode가 그 역할을 잇는다.[1]

운영 migration 전에 VM clone에서 다음을 검증한다.

1. 복원 가능한 block·application backup을 만든다.
2. 현재 repository, extension, custom unit, container volume을 inventory한다.
3. Migration tool과 source revision을 고정한다.
4. 변환 뒤 boot, network, remote access, workload health를 확인한다.
5. 원본 환경으로 되돌리는 시간과 절차를 실제로 잰다.

Leap 16.1의 통합은 설치 선택지를 단순하게 만들지만, Traditional과 Immutable의 운영 의미까지 같게 만들지는 않는다. 도입 기준은 기능 목록이 아니라 **업데이트가 언제 활성화되고 어떤 상태가 snapshot에 묶이며, 실패했을 때 어디까지 복원되는지**를 관찰 가능한 증거로 남기는 것이다.

## Sources

[1] https://news.opensuse.org/2026/11/03/leap-unites-traditional-and-immutable/

[2] https://documentation.suse.com/en-us/sle-micro/6.0/html/Micro-transactional-updates/index.html
