---
title: 'dotnetup 공개 미리보기: nvm·rustup처럼 .NET SDK를 관리해도 될까'
date: 2026-10-23 09:00:04 +0900
categories: ["개발/도구"]
description: 'dotnetup 공개 미리보기를 기존 apt·brew·dotnet-install.sh 환경에 도입할 때 user-local 설치, global.json, PATH 우선순위, side-by-side SDK, CI 경계와 uninstall·rollback을 검증하는 운영 가이드.'
featured_image: 'https://picsum.photos/seed/dotnetup-toolchain-manager-preview/1600/900'
tags: [dotnet, dotnetup, sdk, toolchain-manager, global-json, path, ci-cd, public-preview]
---

![구름 아래 산줄기와 케이블 리프트 선로 옆의 목조 건물](https://picsum.photos/seed/dotnetup-toolchain-manager-preview/1600/900)

Microsoft는 2026년 10월 15일 `dotnetup`을 **public preview(공개 미리보기)**로 발표했다. 목표는 `nvm`이나 `rustup`처럼 .NET SDK와 런타임을 사용자 계정 안에서 설치·추적·업데이트하고, stable·preview·daily와 여러 버전을 나란히 두는 것이다.[1] 방향은 매력적이지만 지금 `apt`, `brew`, Visual Studio, `dotnet-install.sh`로 잘 돌아가는 환경을 곧바로 대체할 단계라고 보기는 어렵다. 공식 선택 가이드도 production machine에는 GA인 installer·package manager·Visual Studio를 쓰라고 권한다.[2]

따라서 질문은 “설치 명령이 무엇인가”가 아니다. **기존 `dotnet`을 건드리지 않은 채 후보를 검증하고, 저장소의 `global.json`과 PATH가 같은 SDK를 가리키는지 확인하며, 실패하면 이전 경로로 되돌릴 수 있는가**가 핵심이다. 이 글은 일반 설치 튜토리얼 대신 전환 계약을 만든다.

## 먼저 현재 계약을 동결한다

2026년 10월 23일 기준 공식 소스의 `dotnetup` 문서는 `dotnet/sdk` 저장소의 `release/dnup` 브랜치에 있다. 이 글은 가변 브랜치 대신 검토한 commit `36b4e922df82e6d764fb847cb8ec2995f14700d0`의 README를 기준으로 삼는다. 지원 플랫폼은 Windows·macOS·Linux이며, SDK와 런타임을 system package manager 밖의 user-local root에 관리한다. Windows의 기본 `everywhere` 모드는 system `PATH`를 바꾸기 때문에 elevation이 필요할 수 있고, `none`이나 `shell`은 그 범위를 피할 수 있다.[3]

프로젝트 소스는 MIT License다.[4] 다만 오픈소스 라이선스와 제품 지원 상태는 다른 축이다. MIT라는 사실이 preview CLI의 command·manifest·support lifecycle이 안정됐다는 뜻은 아니다. Microsoft Learn은 기능과 동작이 GA 전에 바뀔 수 있고 GA 지원 주기도 확정되지 않았다고 명시한다.[2]

현재 관리 문서는 `dotnetup`에 self-update command가 없다고 명시하고, executable을 업데이트하려면 bootstrap script를 다시 실행하라고 안내한다.[5] Preview에서는 과거 예시나 기억한 command를 장기 자동화 계약으로 고정하지 말고, 배포 시점의 `dotnetup --version`, `dotnetup --help`와 pin한 문서를 함께 보존해야 한다.

## 0단계: 기존 toolchain의 영수증을 만든다

전환 전에 “원래 잘 되던 상태”를 재현할 정보부터 수집한다. 비밀이 섞인 전체 환경 변수를 덤프하지 말고 executable 경로, SDK 목록, host 정보, 저장소 pin만 남긴다.

```bash
set -euo pipefail

artifact="${PWD}/.dotnetup-pilot/before"
mkdir -p "$artifact"

command -v dotnet > "$artifact/dotnet-command.txt"
type -a dotnet > "$artifact/dotnet-candidates.txt"
dotnet --info > "$artifact/dotnet-info.txt"
dotnet --list-sdks > "$artifact/dotnet-sdks.txt"
dotnet --list-runtimes > "$artifact/dotnet-runtimes.txt"
printf 'DOTNET_ROOT=%s\n' "${DOTNET_ROOT-<unset>}" > "$artifact/dotnet-root.txt"

if test -f global.json; then
  cp global.json "$artifact/global.json"
  sha256sum global.json > "$artifact/global-json.sha256"
fi

test -s "$artifact/dotnet-command.txt"
test -s "$artifact/dotnet-info.txt"
```

`type -a`가 중요한 이유는 같은 이름의 host가 여럿일 수 있기 때문이다. 예를 들어 `/usr/bin/dotnet`, Homebrew 경로, Visual Studio가 설치한 machine-wide copy, user-local root가 동시에 존재할 수 있다. `dotnet --list-sdks`는 **현재 선택된 host가 볼 수 있는 SDK**만 보여 준다. 다른 root에 파일이 있다는 사실과 지금 shell이 그 파일을 고른다는 사실은 같지 않다.

이 baseline에 package manager ownership도 별도로 기록한다. `apt`, `brew`, MSI·Visual Studio가 관리하는 디렉터리를 `dotnetup`의 install root로 재사용하지 않는다. 공식 모델은 tracked root 안에 기존의 추적되지 않은 .NET 설치가 섞여 있으면 기본적으로 실패하게 설계돼 있다.[6]

## 1단계: PATH를 바꾸지 않는 `none` 모드로 시작한다

`dotnetup`은 Windows의 `%LOCALAPPDATA%\dotnetup\dotnet`, macOS의 `~/Library/Application Support/dotnetup/dotnet`, Linux의 `$XDG_DATA_HOME/dotnetup/dotnet` 또는 `~/.local/share/dotnetup/dotnet`을 기본 root로 쓴다. System-managed directory인 `Program Files\dotnet`이나 `/usr/share/dotnet`에는 쓰지 않는다.[6]

Pilot의 첫 access mode는 `none`이 안전하다. 이 모드는 managed `dotnet`을 PATH에 넣거나 `DOTNET_ROOT`를 설정하지 않고, `dotnetup dotnet` forwarding으로만 호출한다.[7]

```bash
set -euo pipefail

dotnetup env set none --dotnetup-on-path true
dotnetup env show
dotnetup dotnet -- --info
dotnetup list --format json > .dotnetup-pilot/managed-list.json

test -s .dotnetup-pilot/managed-list.json
```

이 단계에서는 기존 `dotnet --info`가 바뀌면 안 된다. Baseline의 `dotnet-command.txt`와 현재 `command -v dotnet`을 비교한다. Managed SDK를 호출할 때만 `dotnetup dotnet build`를 사용한다. IDE, background service, 다른 terminal은 여전히 기존 host를 볼 수 있으므로 “설치 성공”을 “machine 전환 완료”로 기록하지 않는다.

## `global.json`은 version 파일이 아니라 요구사항 source다

채널을 생략한 `dotnetup sdk install`은 현재 directory에서 filesystem root 방향으로 가장 가까운 `global.json`을 찾는다. `version: 10.0.103`과 `rollForward: latestPatch`라면 exact `10.0.103` 하나가 아니라 `10.0.1xx` feature band requirement를 추적한다. `latestFeature`는 `10.0`, `latestMinor`는 `10`, `latestMajor`는 `latest`로 매핑된다. 반면 `disable`, `patch`, `feature`, `minor`, `major`는 exact version으로 저장돼 `dotnetup update`가 전진시키지 않는다.[8]

```bash
set -euo pipefail

test -f global.json
dotnetup sdk install
dotnetup list --format json > .dotnetup-pilot/repository-sdk.json
dotnetup dotnet -- --version > .dotnetup-pilot/managed-sdk-version.txt

test -s .dotnetup-pilot/repository-sdk.json
test -s .dotnetup-pilot/managed-sdk-version.txt
```

여기서 `--update-global-json`을 첫 pilot에 붙이지 않는다. 이 option은 새 SDK를 설치하는 데 그치지 않고 `sdk.version`을 쓴다. 설치 도입과 repository pin 변경을 한 diff에 섞으면 build 변화의 원인을 분리하기 어렵다. 먼저 기존 파일 그대로 build·test를 통과시키고, pin 갱신은 별도 review로 처리한다.

Install path에도 우선순위가 있다. 현재 source 기준으로 `--install-path`가 가장 높고, 그다음은 `global.json`의 첫 유효한 `sdk.paths`, 마지막이 기본 managed root다.[6][8] 저장소의 `sdk.paths`가 `.dotnet`을 가리키는데 운영자가 기본 root를 예상하면 SDK가 두 군데로 갈릴 수 있다. Pilot artifact에는 `global.json`, 선택된 root, `dotnetup list --format json`, 실제 `dotnet --info`를 한 묶음으로 둔다.

## Side-by-side의 단위는 “파일”이 아니라 requirement다

`dotnetup`의 장점은 `latest`, `lts`, `10.0.1xx`, exact version 같은 install specification과 실제 설치된 version을 분리하는 데 있다. 여러 requirement가 같은 SDK를 공유할 수 있고, `update`는 rolling channel만 다시 resolve한다. Exact version은 건너뛴다. Uninstall도 디렉터리를 바로 지우는 것이 아니라 먼저 specification을 제거하고, 남은 requirement가 없는 component만 garbage collection한다.[6]

따라서 “10.0 SDK를 지운다”보다 다음 inventory가 먼저다.

```text
requirement_source | requested_channel | resolved_version | install_root | owner
GlobalJson         | 10.0.1xx         | <observed>       | <path>       | repo-a
Explicit           | preview          | <observed>       | <path>       | compatibility-lab
Explicit           | 10.0.103         | 10.0.103         | <path>       | release-rebuild
```

월별 갱신 뒤에는 명령 성공만 보지 않는다.

```bash
set -euo pipefail

dotnetup update
dotnetup list --format json > .dotnetup-pilot/after-update.json
dotnetup dotnet -- --list-sdks > .dotnetup-pilot/after-update-sdks.txt

test -s .dotnetup-pilot/after-update.json
test -s .dotnetup-pilot/after-update-sdks.txt
```

공식 동작상 개별 requirement 갱신이 실패해도 나머지를 처리한 뒤 command 전체는 실패를 보고한다. 그래서 pipeline에서 exit code를 무시하거나 `|| true`를 붙이면 partial update를 green으로 만들 수 있다. `set -euo pipefail`로 실패를 보존하고 before·after JSON diff에서 어느 requirement가 이동했으며 어느 exact pin이 그대로인지 확인한다.[9]

## PATH 전환은 설치 뒤의 별도 변경이다

Pilot이 통과해도 `shell` 또는 Windows `everywhere`로 바꾸는 일은 독립된 rollout이다. `shell`은 profile에 managed block을 쓰며 그 shell에서 시작한 process에만 적용된다. `everywhere`는 Windows user application 전반에 영향을 주고 user-local root가 machine-wide root보다 우선한다. 이때 managed root에 필요한 SDK나 runtime이 없으면 Visual Studio가 설치한 copy가 디스크에 있어도 project build 또는 framework-dependent app 실행이 실패할 수 있다.[7]

전환 뒤 acceptance는 다음 네 값을 같은 terminal과 IDE-launched task에서 읽는 것이다.

1. `command -v dotnet` 또는 Windows의 `Get-Command dotnet` 경로
2. `DOTNET_ROOT`
3. `dotnet --info`의 base path와 host architecture
4. 저장소 안 `dotnet --version`이 `global.json`의 roll-forward 정책으로 허용되는지

PATH 앞에 user-local directory가 있다는 사실만으로 충분하지 않다. Shell startup file의 후반부가 PATH를 다시 덮어쓸 수 있고, IDE는 이미 떠 있는 parent process의 환경을 물려받을 수 있다. 새 terminal과 IDE 재시작 뒤에도 read-back해야 한다.

## CI는 개발자 PC의 자동 확장이 아니다

Microsoft는 non-admin·noninteractive 특성 때문에 ephemeral CI에 적합하다고 설명한다.[1] 그러나 개발자 PC의 tracked manifest를 장기 runner에 공유하는 설계까지 보증하는 것은 아니다. CI에서는 다음 경계를 둔다.

- Job마다 격리된 data directory와 install root를 쓴다.
- Repository의 `global.json`을 source of truth로 두고, build 전에 resolved SDK를 출력한다.
- Cache key에 OS, architecture, `global.json` hash, `dotnetup --version`을 넣는다.
- Cache restore 뒤에도 `dotnetup list --format json`과 `dotnetup dotnet -- --info`를 다시 읽는다.
- Production image의 runtime은 별도 artifact다. Developer runner에서 `dotnetup update`했다고 이미 배포된 framework-dependent app이나 self-contained image가 patch되지는 않는다.[1]

Preview CLI를 CI의 유일한 bootstrap path로 바꾸기 전에 기존 GA 경로와 병렬 job을 둔다. 같은 commit을 두 toolchain으로 build·test하고, output·test count·exit status가 합의한 범위에서 같을 때만 pilot cohort를 넓힌다. Command나 manifest schema가 바뀌면 기존 installer 또는 pin한 container image로 돌아가는 경로를 유지한다.

## Uninstall과 rollback은 다른 작업이다

`dotnetup sdk uninstall <CHANNEL>`은 matching SDK requirement를 제거하고 더는 참조되지 않는 파일을 정리한다. `--source` 기본값은 `explicit`이므로 `global.json`에서 생긴 requirement를 지우려면 source를 명시해야 한다.[10]

```bash
set -euo pipefail

# Pilot에서 명시적으로 추가한 preview requirement만 제거한다.
dotnetup sdk uninstall preview --source explicit
dotnetup list --format json > .dotnetup-pilot/after-uninstall.json

test -s .dotnetup-pilot/after-uninstall.json
```

이것은 PATH rollback이 아니다. 반대로 `dotnetup env clear`는 environment wiring을 제거할 뿐 SDK와 runtime 파일은 지우지 않는다.[5][7] 복구 절차는 다음 순서가 안전하다.

1. `dotnetup list --format json`과 `dotnetup env show`를 저장한다.
2. `dotnetup env clear`로 profile 또는 Windows environment 변경을 제거한다.
3. 새 terminal을 열고 이전 package-manager의 `dotnet` 경로가 baseline과 같은지 확인한다.
4. `dotnet --info`, `--list-sdks`, repository build·test를 다시 실행한다.
5. 복구 확인 뒤에만 불필요한 dotnetup requirement와 data directory를 정리한다.

```bash
set -euo pipefail

baseline="$(cat .dotnetup-pilot/before/dotnet-command.txt)"
dotnetup env clear

printf '%s\n' '새 terminal을 연 뒤 아래 검증 블록만 실행한다.'
printf 'test "$(command -v dotnet)" = %q\n' "$baseline"
```

마지막 snippet은 현재 shell의 PATH를 억지로 재작성하지 않는다. `env clear` 뒤에도 이미 실행 중인 shell은 이전 환경을 들고 있을 수 있기 때문이다. 새 terminal에서 출력된 `test`를 실행하고, 불일치하면 자동으로 성공 처리하지 않는다. Windows `everywhere` rollback은 elevation과 application restart까지 포함해 별도 change window에서 수행한다.

Tool 자체를 완전히 제거할 때도 순서가 있다. 공식 문서는 custom root를 먼저 기록하고, environment 설정을 지운 뒤, managed root와 data directory, 마지막으로 `~/.dotnetup`의 executable directory를 삭제하라고 한다.[5] 경로를 추정해 `rm -rf ~/.dotnet*`처럼 넓게 지우면 기존 `dotnet-install.sh` 자산까지 손상할 수 있다. 삭제는 `dotnetup list`에서 읽은 exact root를 사람이 검토한 뒤 실행해야 한다.

## 도입 판정표

| Gate | 통과 증거 | 실패 시 행동 |
|---|---|---|
| Preview 경계 | 검토한 `dotnetup --version`, commit-pinned 문서 | GA 기능처럼 표준화하지 않음 |
| 기존 host | before/after executable 경로와 `dotnet --info` | `none` 모드로 복귀 |
| Repository pin | `global.json`, derived channel, resolved SDK | 파일 수정 없이 requirement 재검토 |
| Side-by-side | source·channel·resolved version·root inventory | 불명확한 requirement 제거 금지 |
| PATH | 새 shell과 IDE task의 실제 host read-back | rollout 중단, `env clear` |
| CI | 격리 root, cache key, version receipt, 병렬 GA build | 기존 bootstrap 유지 |
| Rollback | baseline host로 build·test 재통과 | managed data 삭제 금지 |

`dotnetup`은 .NET의 user-local toolchain 관리에서 오래 비어 있던 자리를 잘 겨냥한다. 특히 channel intent, `global.json`, side-by-side 설치와 참조가 사라진 component 정리를 하나의 모델로 묶은 점은 `nvm`·`rustup`에 익숙한 개발자에게 자연스럽다. 그러나 2026년 10월 23일 현재 상태는 분명히 **public preview**다. 현재 문서 기준 executable 업데이트는 self-update command가 아니라 bootstrap script 재실행으로 처리한다.

그러므로 지금의 합리적인 결론은 “전사 기본 설치기로 즉시 교체”가 아니라 **PATH를 건드리지 않는 user-local pilot**이다. 기존 host의 영수증을 남기고, `none` 모드에서 repository pin을 검증하고, requirement 단위로 side-by-side 상태를 읽고, CI와 production runtime을 분리한다. 마지막으로 `env clear` 뒤 이전 package-manager 경로에서 build가 다시 통과해야 한다. 그 복구 증거가 있을 때만 `dotnetup`은 편리한 설치 명령을 넘어 운영 가능한 toolchain manager 후보가 된다.

## Sources

[1] https://devblogs.microsoft.com/dotnet/introducing-dotnetup/
[2] https://learn.microsoft.com/en-us/dotnet/core/tools/dotnetup/choose-dotnetup
[3] https://github.com/dotnet/sdk/blob/36b4e922df82e6d764fb847cb8ec2995f14700d0/documentation/general/dotnetup/README.md
[4] https://github.com/dotnet/sdk/blob/36b4e922df82e6d764fb847cb8ec2995f14700d0/LICENSE.TXT
[5] https://learn.microsoft.com/en-us/dotnet/core/tools/dotnetup/usecases/manage-dotnetup
[6] https://github.com/dotnet/sdk/blob/36b4e922df82e6d764fb847cb8ec2995f14700d0/documentation/general/dotnetup/concepts/how-dotnetup-works.md
[7] https://github.com/dotnet/sdk/blob/36b4e922df82e6d764fb847cb8ec2995f14700d0/documentation/general/dotnetup/concepts/environment.md
[8] https://github.com/dotnet/sdk/blob/36b4e922df82e6d764fb847cb8ec2995f14700d0/documentation/general/dotnetup/usecases/install-with-global-json.md
[9] https://learn.microsoft.com/en-us/dotnet/core/tools/dotnetup/usecases/update-installations
[10] https://learn.microsoft.com/en-us/dotnet/core/tools/dotnetup/reference/dotnetup-sdk-uninstall
