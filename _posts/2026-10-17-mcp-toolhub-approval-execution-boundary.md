---
title: '승인은 실행 권한이 아니라 한 번 소비되는 상태다: MCP ToolHub의 로컬 실행 경계'
date: 2026-10-17 07:50:00 +0900
categories: ["AI 보안"]
description: 'MCP ToolHub v0.1.0의 14개 stdio 도구, workspace·Git·shell 경계, human-only approval, consume-before-execute와 replay rejection을 소스와 테스트로 검증한다.'
featured_image: 'https://picsum.photos/seed/mcp-toolhub-approval-execution-boundary/1600/900'
tags: [mcp, toolhub, human-approval, replay-protection, local-tools, process-containment, ai-security]
---

![MCP ToolHub의 로컬 승인과 단일 사용 실행 경계](https://picsum.photos/seed/mcp-toolhub-approval-execution-boundary/1600/900)

에이전트에게 로컬 파일과 command를 열어 주는 순간 MCP server는 단순한 adapter가 아니다. 어떤 path를 읽을 수 있는지, 어떤 command가 즉시 실행되는지, 승인이 무엇에 묶이는지, timeout 뒤 child process가 남는지 결정하는 local execution boundary가 된다. MCP ToolHub는 이 문제를 작고 구체적인 surface로 다룬다. Canonical repository는 `zhihaochen67/mcp-toolhub`이고 GitHub repository ID는 `1347408505`다.[1] 2026년 10월 17일 직접 확인한 `main` HEAD는 `930024f8ee5b4c2743675ed30102951095217d1b`다.[2]

이 프로젝트를 “MCP 도구 catalog”로 소개하면 핵심을 놓친다. ToolHub가 하는 일은 많은 도구를 찾아 prompt에 넣는 것이 아니다. ToolHub는 **로컬 stdio process 안에서 bounded read와 approval-gated mutation을 분리하는 execution gateway**다. 그러므로 이 글은 context 절감 제품이라는 주장을 하지 않는다. Tool 개수가 14개로 작다는 사실도 token 절감 성능을 증명하지 않는다.

**승인은 command를 실행할 수 있는 장기 권한이 아니라, 고정된 action snapshot을 한 번 시도하도록 허용하고 실행 전에 소비되는 상태다.** 실행이 실패해도 승인은 되살아나지 않는다. Replay는 새 시도로 해석되지 않는다. 다시 실행하려면 새 request와 새 human decision이 필요하다.

## 무엇을 직접 확인했나

Repository API에서 canonical owner/name, numeric ID, default branch와 license detection 값을 확인했다.[1] `main` tree에는 `LICENSE`가 없다.[2] Source checkout의 HEAD도 같은 `930024f...`였다. Release `v0.1.0`은 commit `e4a9f290838d42f0eebbacb7cf06a34c4b2e7b9f`를 가리켰다. Release artifact tree에는 `LICENSE`가 있었다.[3]

현재 main의 README는 local stdio-only gateway, 14 production tools, immutable·expiring·single-use request, separate admin process를 명시한다.[4] Architecture 문서는 workspace, trusted state, process containment와 non-goal을 더 정확히 정의한다.[5] Approval lifecycle 문서는 Contract V1의 status와 outcome을 분리한다.[6] Operations 문서는 설치, 환경 변수, POSIX·Windows 경로와 maintenance를 설명한다.[7]

소스 주장만 읽고 끝내지 않았다. 현재 main에서 `uv sync --all-groups` 뒤 전체 test suite를 실행했다. 실제 결과는 `896 passed, 12 skipped`였다. 실행 시간은 약 4분 21초였다. Skip은 현재 Linux host에서 Windows 전용 case 등이 실행되지 않은 결과이므로 “모든 OS 동작을 이 host에서 실증했다”고 쓰지 않는다. 대신 Windows semantics는 source와 Windows CI용 test를 함께 검토한다.

## 설치는 source checkout에 고정한다

현재 운영 문서는 Python 3.12 이상과 `uv`를 요구한다.[7] 일반 source install은 checkout에서 `uv tool install .`을 사용한다. 개발자는 `uv sync --all-groups`로 locked test와 lint dependency를 만든다. 이 둘은 목적이 다르다. Editable development environment를 production install처럼 설명하면 안 된다.

검토 시점의 안전한 설치는 mutable branch가 아니라 확인한 commit에 고정한다.

```bash
mkdir -p "$HOME/toolhub-lab"
cd "$HOME/toolhub-lab"
git clone https://github.com/zhihaochen67/mcp-toolhub.git source
cd source
git checkout 930024f8ee5b4c2743675ed30102951095217d1b
uv sync --all-groups
uv run pytest -q
```

실습 workspace와 trusted state는 repository 바깥의 sibling directory로 만든다. 실제 프로젝트나 home 전체를 workspace로 지정하지 않는다. State root를 workspace 안에 두면 server가 fail-closed해야 한다. 아래 예시는 삭제해도 되는 scratch 범위만 사용한다.

```bash
mkdir -p "$HOME/toolhub-lab/runtime/workspace"
mkdir -p "$HOME/toolhub-lab/runtime/state"
printf '검증용 파일입니다.\n' > "$HOME/toolhub-lab/runtime/workspace/seed.txt"
export TOOLHUB_WORKSPACE_ROOT="$HOME/toolhub-lab/runtime/workspace"
export TOOLHUB_STATE_ROOT="$HOME/toolhub-lab/runtime/state"
uv run mcp-toolhub serve
```

다른 terminal의 admin CLI에도 동일한 두 환경 변수를 설정해야 한다. Server와 admin은 같은 OS user로 실행해야 한다. Current working directory가 같다는 사실은 충분하지 않다. ToolHub는 workspace를 current directory로 자동 추정하지 않는다. `TOOLHUB_WORKSPACE_ROOT`는 absolute, existing directory여야 한다.

## stdio-only라는 말의 정확한 범위

ToolHub server는 MCP protocol message만 stdout에 쓴다. HTTP listener를 열지 않는다. SSE transport도 제공하지 않는다. Remote multi-user gateway도 아니다. MCP client가 `mcp-toolhub serve`를 child process로 실행하는 구조다.[4]

Stdio-only는 network isolation을 뜻하지 않는다. Approved external command는 local account 권한으로 network에 접근할 수 있다. ToolHub 자체가 HTTP endpoint를 열지 않는 것과 child program의 egress는 다른 경계다. Architecture는 approved process에 general filesystem sandbox나 network sandbox를 제공하지 않는다고 명시한다.[5] 따라서 “local이니 외부 유출이 불가능하다”는 결론은 틀리다.

Stdio-only는 authentication platform도 아니다. Multi-user identity, RBAC와 remote tenant isolation은 non-goal이다. Human boundary는 local admin CLI와 OS account trust에 의존한다. 같은 account를 agent가 완전히 장악했다면 trusted state도 완전한 보호 대상이 아니다. 이 threat assumption을 빼고 “안전한 MCP server”라고만 부르면 과장이다.

## 정확히 14개인 production tool surface

현재 server는 정확히 14개 tool을 노출한다.[4] Transport integration test도 list 결과가 같은 14개인지 검사한다.[8] `toolhub.approve`는 목록에 없다. `admin.*` namespace도 없다. Maintenance command 역시 MCP tool이 아니다.

첫 번째 그룹은 direct control과 read-only inspection이다. `toolhub.ping`은 reachability를 확인한다. `toolhub.capabilities`는 contract version, transport, public limit과 approval mapping을 반환한다. `toolhub.request_status`는 request state를 관찰한다. `toolhub.audit_recent`는 최근 sanitized event를 읽는다.

두 번째 그룹은 bounded workspace와 Git read다. `filesystem.list_directory`는 workspace 안의 entry를 나열한다. `filesystem.read_file`은 bounded UTF-8 regular file과 hash를 읽는다. `git.status`는 fixed read-only status를 실행한다. `git.diff`는 staged 또는 unstaged diff를 읽는다.

세 번째 그룹은 approval submission이다. `filesystem.write_file`은 exact write를 제출한다. `filesystem.apply_patch`는 single-file patch를 제출한다. `shell.run`은 단 하나의 LOW intrinsic을 제외하면 external command request를 만든다. 이 initial call들은 mutation을 실행하지 않는다.

네 번째 그룹은 single-use resume다. `filesystem.write_file_approved`는 저장된 write를 재개한다. `filesystem.apply_patch_approved`는 저장된 patch를 재개한다. `shell.run_approved`는 저장된 command를 재개한다. Resume tool에는 `request_id`만 전달한다.

이 구성이 중요한 이유는 agent가 approval 후 payload를 바꿀 자리가 없기 때문이다. Path를 staging에서 production으로 교체할 수 없다. File content를 승인 후 추가할 수 없다. Program과 argument를 바꿀 수 없다. Timeout과 working directory도 교체할 수 없다.

## Workspace bound는 chroot가 아니다

Workspace root는 process 시작 때 canonicalize되고 frozen된다.[5] API path는 relative여야 한다. POSIX와 Windows 양쪽의 portable parent traversal을 검사한다. Absolute path는 거부한다. Mutation path는 symlink component도 거부한다.

Read는 workspace 안의 UTF-8 regular file에 제한된다. Directory listing에는 entry count bound가 있다. File read와 write payload limit은 256KiB다. Patch text limit도 256KiB character다. Directory list는 최대 2,048 entry다.

이 경계는 ToolHub API path에 대한 confinement다. Approved program이 workspace 밖의 file을 읽지 못하게 하는 OS sandbox는 아니다. Command가 `/etc`나 home을 읽을 권한을 local account에서 받았다면 ToolHub가 자동으로 막지 않는다. 그래서 command approval 화면에 program, argument, working directory와 executable identity가 필요하다.

Workspace confinement에도 residual race가 있다. Architecture는 local adversary가 ancestor를 바꾸는 좁은 race에 대해 atomic compare-and-swap을 제공하지 않는다고 밝힌다.[5] Ownership, extended attribute와 ACL 보존도 보장하지 않는다. Windows ACL은 POSIX mode bit와 동등하지 않다. 이 제한은 문서에 공개돼 있으며 운영자가 보완해야 한다.

Trusted state root는 workspace 밖에 있어야 한다. Default state는 platform user-state directory 아래에 workspace canonical path의 hash namespace를 만든다. Hash는 directory name에서 path를 숨길 뿐 authentication secret은 아니다. Binding file은 state namespace를 한 canonical workspace에 영구 연결한다. 다른 workspace가 같은 state root를 재사용하려 하면 fail-closed한다.

POSIX에서는 managed state directory와 file을 각각 `0700`과 `0600`으로 normalize한다. Windows에서는 mode bit가 ACL policy를 만들지 않는다. 운영자는 Windows에서 적절히 보호된 state location을 골라야 한다. “Cross-platform”은 보안 primitive가 완전히 동일하다는 뜻이 아니다.

## Git read-only는 `git`이라는 이름만 믿지 않는다

`git.status`와 `git.diff`는 agent가 arbitrary Git argument를 전달하는 구조가 아니다.[5] ToolHub가 fixed command를 만든다. Pager를 끈다. External diff와 textconv를 막는다. Fsmonitor와 prompt도 제한한다. Missing object가 transport helper를 시작하는 경로를 막는다.

Repository의 clean/process filter는 executable helper가 될 수 있다. ToolHub는 적용 가능한 위험 filter를 preflight에서 거부한다. Gitlink와 submodule도 거부한다. Parent repository가 workspace 밖에 있으면 repository root escape로 처리한다. Nested repository가 workspace 안에 완전히 들어 있으면 허용될 수 있다.

이 정책은 hostile repository에 대한 완전한 atomic snapshot이 아니다. 다른 local process가 config, attribute, index를 race하는 threat는 남는다. 그러나 단순히 `git status`를 read-only shell command라고 믿는 것보다 경계가 훨씬 구체적이다. Source에는 이 behavior를 검증하는 Git filter test가 있다.[2]

Git output도 무한히 보존하지 않는다. Public result field는 20,000 character까지만 유지한다. Capture layer는 stdout과 stderr 각각 256KiB를 보존하고 excess는 drain 후 버린다. Pipe를 읽지 않아 child가 block되는 문제를 피하면서 agent response 크기를 제한한다. Preflight와 execution budget은 20초다.

## Shell risk classification은 allowlist보다 더 좁다

`shell.run`은 program string과 argument array를 받는다. Shell command line을 조립하지 않는다. `shell=False`로 실행한다. Current main에서 direct LOW operation은 ToolHub process 안에서 반환하는 Python version query 하나다.[5] 이 intrinsic은 subprocess를 시작하지 않는다.

Agent가 선택한 모든 external command는 MEDIUM 또는 HIGH이고 human approval이 필요하다. `git --version`처럼 harmless해 보이는 command도 external process면 승인 경로를 탄다. 이 정책은 command 이름 목록을 길게 만들고 위험도를 추측하는 대신 “외부 실행 자체”를 명시적 경계로 둔다. 따라서 arbitrary command가 LOW path로 조용히 내려갈 공간이 작다.

Submission은 structured argument, relative working directory, timeout과 workspace identity를 저장한다. Primary executable의 resolved absolute path, size와 SHA-256도 저장한다. Sanitized environment snapshot도 저장한다. Resume 직전 primary executable을 다시 검사한다.

이 revalidation은 loader 전체의 attestation이 아니다. DLL, interpreter, helper, plugin, configuration, dynamically loaded dependency와 descendant까지 증명하지 않는다. Check-to-exec race도 완전히 제거하지 않는다. “실행 파일 hash가 같으니 command 전체가 안전하다”는 결론을 내리면 안 된다.

Environment는 parent process를 그대로 복제하지 않는다. Integration test는 parent에 넣은 secret variable이 stored request와 child output에 나타나지 않는지 확인한다.[8] `PATH` 의존도 제거하고 absolute executable로 launch한다. 그래도 program 자체가 local file이나 network에서 secret을 찾는 권한은 별도 sandbox가 없으면 남는다.

## Human-only admin은 UI 문구가 아니라 surface 분리다

Agent는 request를 만들고 status를 poll할 수 있다. Agent는 request ID도 안다. 그러나 request ID 소유는 approval authority가 아니다. Approval과 rejection은 별도 `mcp-toolhub-admin` process에서만 일어난다.[6]

Admin은 candidate를 terminal에 표시한다. Approve command는 operator가 `APPROVE`를 정확히 입력해야 한다. Reject는 request ID로 terminal decision을 기록한다. MCP surface에는 이 code path가 없다. Client가 admin CLI를 자동화해서는 안 된다는 contract도 문서에 명시돼 있다.

Human-only는 사람이 payload를 충분히 이해한다는 보장은 아니다. File mutation 화면은 path, size, hash, concurrency field를 보여 준다. Shell 화면은 requested program, canonical executable identity, working directory와 JSON-escaped argument를 분리해 보여 준다. 그래도 script 내부 동작과 downstream effect는 사람이 별도로 검토해야 한다.

Admin process와 server는 같은 state namespace를 공유한다. 둘의 workspace나 state 환경 변수가 다르면 pending request가 보이지 않는다. 이 동작은 불편이 아니라 workspace binding의 결과다. 다른 workspace의 request 존재 여부도 agent에 노출하지 않는다. Unknown ID와 다른 workspace의 ID는 같은 `REQUEST_NOT_FOUND` shape를 반환한다.[6]

## Immutable request의 실제 의미

`filesystem.write_file` request에는 exact path, content, expected hash, parent creation flag와 workspace snapshot이 들어간다. Patch request에는 exact path, unified diff, expected hash와 workspace snapshot이 들어간다. Shell request에는 program, argument boundaries, cwd, timeout, workspace, executable과 environment snapshot이 들어간다.[6]

Agent에게 돌아오는 approval handle은 더 작다. `request_id`, current status, `expires_at`, server-derived `resume_tool`만 담는다. Protected payload를 status API로 다시 읽을 수 없다. State directory도 workspace filesystem tool로 읽을 수 없다. 이 분리는 agent가 stored action을 수정하거나 secret content를 status path로 회수하는 일을 줄인다.

Request ID는 cryptographically random하게 만든다. Request status는 cross-process lock 아래에서 바뀐다. Protected action snapshot은 status가 바뀌어도 immutable하다. Store write는 same-directory temporary file, flush와 atomic replacement를 사용한다. Approval store에는 10,000 record와 16MiB serialized limit이 있다.

Default request lifetime은 300초다. `TOOLHUB_APPROVAL_TTL_SECONDS`로 operator가 server 시작 전에 바꿀 수 있다. Agent tool argument로 TTL을 늘릴 수 없다. Polling은 expiry를 연장하지 않는다. Expired request는 새 submission 없이는 실행할 수 없다.

## Consume-before-execute가 replay를 막는 방식

Human approval 뒤 status는 `APPROVED`가 된다. Client는 server가 제공한 matching resume tool을 `request_id` 하나로 호출한다. Store lock 아래에서 ToolHub는 `APPROVED`를 `CONSUMED`로 먼저 바꾼다. 이 transition을 이긴 caller만 stored action을 받는다.[6]

그 다음에 executable revalidation과 실제 action이 수행된다. 순서가 중요하다. 실행한 뒤 consume하면 network timeout이나 process crash 때 같은 approval이 다시 실행될 수 있다. ToolHub는 그 ambiguity를 피하기 위해 approval을 먼저 태운다. 그래서 result를 받지 못했을 때도 request가 이미 consumed일 수 있다.

Concurrent resume 두 개가 들어오면 하나만 transition을 이긴다. 나머지는 `APPROVAL_CONSUMED`를 받는다. Later replay도 같은 outcome을 받는다. File write가 성공했는지와 approval이 재사용 가능한지는 서로 다른 상태다. Approval은 성공 coupon이 아니라 one-attempt authorization이다.

이 설계는 at-most-once **attempt**에 가깝다. Business side effect의 exactly-once를 보장하지 않는다. Approved command가 외부 API를 호출한 뒤 process가 죽으면 ToolHub는 그 API가 반영됐는지 알 수 없다. 재시도하려면 외부 상태를 read-back하고 새 request를 제출해야 한다. Idempotency key는 downstream contract에서 별도로 설계해야 한다.

Execution 직전 target hash가 바뀌면 file mutation은 `CONFLICT`가 될 수 있다. 이 경우에도 approval은 이미 consumed다. Executable snapshot mismatch로 `REFUSED`가 되어도 되살아나지 않는다. Command가 nonzero exit로 `COMMAND_FAILED`를 반환해도 consumed다. Timeout도 consumed다.

이 behavior는 source test로 고정돼 있다. Contract test는 conflict 뒤 status가 `APPROVAL_CONSUMED`이고 replay도 consumed인지 확인한다.[9] 같은 test는 submission부터 pending, approved, execution, consumed와 replay까지 하나의 `trace_id`가 이어지는지도 검사한다. 14개 production inventory와 admin tool 부재도 검증한다.

## Contract V1의 12개 outcome

Contract version은 `1.0`이고 package version `0.1.0`과 독립적이다. Client는 package version이 올라갔다고 contract가 바뀌었다고 가정하면 안 된다. 반대로 contract version이 유지돼도 implementation bug fix는 있을 수 있다. `toolhub.capabilities`를 읽고 실제 mapping을 확인해야 한다.

Contract V1의 outcome은 정확히 12개다.[6] `APPROVAL_REQUIRED`는 새 protected request가 저장됐다는 뜻이다. `APPROVAL_PENDING`은 human decision 전이다. `APPROVAL_APPROVED`는 expiry 전 resume가 가능하다는 뜻이다. `APPROVAL_REJECTED`는 human rejection이다.

`APPROVAL_EXPIRED`는 더 이상 실행할 수 없다는 뜻이다. `APPROVAL_CONSUMED`는 single-use request가 이미 소비됐다는 뜻이다. `SUCCEEDED`는 stored action이 완료됐다는 뜻이다. `COMMAND_FAILED`는 approved command가 nonzero로 끝났다는 뜻이다.

`TIMED_OUT`은 bounded timeout을 넘었다는 뜻이다. `CONFLICT`는 mutation concurrency나 target state가 snapshot과 맞지 않는다는 뜻이다. `REFUSED`는 policy 또는 request-state validation이 action을 거부했다는 뜻이다. `FAILED`는 approved action이 완료되지 못했다는 뜻이다.

이 12개는 MCP `structuredContent`의 machine-readable branch다. Display message나 rendered text를 parsing해서 상태를 결정하면 안 된다. Input schema violation과 unexpected internal failure는 MCP/tool error로 남을 수 있다. Domain outcome과 transport error를 하나의 exception으로 합치면 client recovery가 부정확해진다.

Protected request의 internal status는 `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CONSUMED`다. Status와 outcome은 같은 enum이 아니다. `CONSUMED` status 뒤 실행 결과는 `SUCCEEDED`나 `CONFLICT`일 수 있다. Later status observation은 `APPROVAL_CONSUMED` outcome을 반환한다.

## Process-tree containment는 sandbox가 아니다

Approved external command와 fixed Git helper는 OS-backed process-tree lifetime containment 안에서 실행된다.[5] POSIX에서는 새 session과 process group을 사용한다. Timeout 때 isolated group에 signal을 보낸다. Windows에서는 process를 suspended 상태로 시작해 kill-on-close Job Object에 넣은 뒤 resume한다.

이 mechanism의 목표는 timeout 뒤 child와 grandchild를 남기지 않는 것이다. Source test는 child와 grandchild가 60초 sleep하도록 만든 뒤 1.5초 timeout으로 tree가 종료되는지 확인한다.[10] POSIX test는 `SIGTERM`이 ToolHub 자신의 process group이 아닌 isolated group으로 가는지 검사한다. Windows test는 Job Object를 configure하고 process를 assign한 뒤에만 resume하는 call order를 검사한다.

Linux에서 실행한 전체 suite에서는 실제 POSIX descendant cleanup test가 통과했다. Windows-specific execution test는 이 host에서 skip됐다. Repository CI는 Ubuntu와 Windows, Python 3.12와 3.13을 대상으로 한다고 문서화돼 있다.[4] 따라서 Windows 지원 주장은 source·test와 CI contract에 근거하지만 이번 local run으로 Windows kernel behavior를 직접 재현한 것은 아니다.

Process tree를 죽이는 기능은 code isolation과 다르다. Command가 timeout 전에 workspace 밖을 읽거나 network로 전송하면 containment가 되돌리지 못한다. Child가 OS primitive를 이용해 containment를 벗어나는 모든 경우를 막는 general sandbox도 아니다. CPU, memory, disk와 network quota도 제공하지 않는다.

그래서 제품을 “sandbox”라고 단독 소개하면 안 된다. 더 정확한 표현은 **bounded local gateway with process-lifetime containment**다. 일반 filesystem·network sandbox가 필요하면 container, restricted OS user, VM, seccomp, egress policy 같은 별도 control을 추가해야 한다. ToolHub approval은 그 control을 대체하지 않는다.

## Audit는 bounded metadata이고 enforcement가 아니다

Audit event는 trusted state의 JSON Lines에 append된다.[5] Event에는 lifecycle을 잇는 `trace_id`가 있다. Field와 collection 크기는 bounded다. Recognizable secret argument는 redact한다. Raw stdout과 stderr는 audit log에 저장하지 않는다.

Agent-facing `toolhub.audit_recent`는 최대 100개 recent event만 반환한다. Tail scan도 1,000,000 byte로 제한한다. Audit compaction input은 64MiB limit이 있다. Retention은 startup 때 자동으로 돌지 않는다. Admin이 dry-run maintenance를 확인한 뒤 `--apply`해야 한다.

Bound가 있다는 사실은 완전한 confidentiality를 뜻하지 않는다. Redaction은 모든 secret format을 알아내지 못한다. Path와 argument metadata만으로도 민감한 정보가 드러날 수 있다. Audit access와 retention을 별도 정책으로 관리해야 한다. Prompt와 raw command output을 저장하지 않는 선택은 조사 detail과 data exposure 사이의 trade-off다.

더 중요한 제한은 audit append 실패가 tool action을 fail시키지 않는다는 점이다. Action success는 audit success의 증거가 아니다. Disk full이나 permission error가 있으면 side effect는 발생했지만 event가 없을 수 있다. Compliance가 fail-closed audit를 요구하면 이 현재 설계만으로는 부족하다.

운영자는 `started`와 terminal event 수를 비교할 수 있지만 양쪽 append가 모두 실패하면 이 비교도 gap을 놓친다. 고정 SHA 구현은 audit 예외를 잡아 `False`를 반환할 뿐 내장 stderr나 metric 신호를 보장하지 않는다.[5] Operations 문서가 stderr 확인을 권고하더라도 이를 구현 계약으로 간주하면 안 된다. 별도 wrapper의 disk·state probe와 supervisor 계측이 필요하다. State root backup도 live file copy가 아닌 documented maintenance 절차를 따라야 한다. Agent에게 state directory를 읽게 해서 audit gap을 메우려 하면 trust boundary를 깨뜨린다.

## 안전한 end-to-end 실습

Repository의 demo client는 public stdio API만 사용하고 approval capability를 갖지 않는다.[7] Scratch workspace에서 submit 단계는 tool list가 14개인지 확인한다. `seed.txt`를 읽는다. `approved.txt` write request를 제출한다. 이 시점에는 file이 생기지 않아야 한다.

```bash
uv run python examples/demo_client.py submit
```

출력의 `REQUEST_ID`를 사람이 별도 terminal에서 검토한다. Admin list로 candidate를 본다. Approve command에서 exact `APPROVE`를 입력한다. 이 terminal action은 agent가 대신 실행해서는 안 된다.

```bash
uv run mcp-toolhub-admin list
uv run mcp-toolhub-admin approve REQUEST_ID
```

그 뒤 resume client를 실행한다. Expected sequence는 status `APPROVAL_APPROVED`, write result `SUCCEEDED`, replay result `APPROVAL_CONSUMED`다. 마지막으로 MCP read를 통해 `approved.txt`를 확인한다. Host shell의 file existence만 보고 protocol result를 생략하지 않는다.

```bash
uv run python examples/demo_client.py resume REQUEST_ID
```

실제 repository transport test는 이 흐름을 더 넓게 검증한다.[8] Write, patch, rejection, approved shell, secret environment 제거, oversized output drain, timeout child cleanup과 two-workspace isolation을 stdio level에서 확인한다. 이 test가 통과했다는 사실은 현재 checkout의 contract 구현에 대한 강한 신호다. 그것이 approved arbitrary program의 안전성을 증명하지는 않는다.

실습 후에는 두 ToolHub process가 종료됐는지 확인한다. 삭제 범위는 처음 만든 `$HOME/toolhub-lab/runtime`으로 제한한다. Shared state directory나 실제 project를 cleanup target으로 쓰지 않는다. Request와 audit evidence가 필요한 경우 먼저 보존 정책을 확인한다.

## 성능을 어떻게 측정할까

ToolHub는 throughput benchmark 제품으로 소개되지 않는다. Direct read와 approval-gated mutation은 latency profile이 근본적으로 다르다. Human approval 시간이 들어간 write p95를 server serialization 성능처럼 해석하면 의미가 없다. 그래서 queue time, human decision time, resume execution time을 분리한다.

Read path에서는 file 크기별 latency와 refusal rate를 잰다. Directory entry 수가 2,048 limit에 접근할 때 result와 error를 확인한다. Git에서는 small clean repository, large diff, risky filter와 submodule fixture를 분리한다. Output truncation 뒤 client가 결과를 완전한 diff로 오인하지 않는지도 본다.

Approval path에서는 submission write latency와 lock contention을 잰다. Admin decision time은 사람 workflow metric으로 분리한다. Resume concurrency test는 같은 request에 동시에 두 caller를 넣고 exactly one transition만 성공하는지 확인한다. Replay rejection은 성공 count가 아니라 consumed response의 determinism으로 본다.

Shell path에서는 process startup, command runtime, timeout cleanup과 output drain 시간을 나눈다. Child가 256KiB보다 큰 stdout과 stderr를 동시에 쓰는 fixture가 필요하다. Timeout 뒤 descendant가 살아 있는지 OS-level probe로 확인한다. 평균보다 p99 lock wait와 cleanup failure를 더 중요하게 본다.

성능 test 자체도 workspace 밖의 resource를 건드리지 않아야 한다. Network benchmark를 하려면 destination을 명시적으로 통제한다. Real credential은 주입하지 않는다. Windows와 POSIX 결과를 같은 숫자로 합치지 않는다. Job Object와 process group은 startup overhead와 failure mode가 다르다.

## 비용과 운영 부담

ToolHub 자체는 cloud request meter를 제공하지 않는다. Local process CPU, memory와 disk는 host 비용에 포함된다. Approval store는 10,000 record·16MiB capacity에서 신규 요청을 거부할 수 있지만, `audit.jsonl`은 자동 rotation이나 pruning 없이 계속 증가할 수 있다.[5] 64MiB는 성장 상한이 아니라 일반 compaction path가 읽을 수 있는 상한이므로 이를 넘으면 recovery runbook이 필요하다. Operator maintenance 시간이 실질 비용이다.

Human review는 가장 큰 latency와 labor cost일 수 있다. 모든 external command를 승인하도록 설계했으므로 command-heavy agent에는 승인 피로가 생길 수 있다. 이 비용을 줄이기 위해 admin CLI를 agent가 자동 승인하게 만들면 제품의 핵심 boundary를 제거한다. 더 많은 LOW command를 쉽게 추가하는 것도 같은 위험을 만든다.

운영 비용에는 Python runtime과 dependency update가 포함된다. Source install을 쓰면 checkout provenance를 관리해야 한다. Built wheel을 배포하면 artifact hash와 smoke test를 보존해야 한다. CI가 통과했다는 사실과 local installation이 같은 wheel이라는 사실을 연결해야 한다.

State store가 full limit에 도달하면 새 request가 fail할 수 있다. Audit log가 compaction read ceiling을 넘으면 documented recovery가 필요하다. Disk full은 audit gap을 만들 수 있다. On-call runbook에는 approval capacity, state permission, lock contention과 malformed file 복구가 들어가야 한다.

## 라이선스는 release와 current main을 분리한다

`v0.1.0` release commit에는 MIT License file이 있다.[3] 따라서 그 release artifact의 license를 MIT로 기술할 근거가 있다. Release page도 version `0.1.0`을 alpha delivery로 다룬다.[11] 당시 package classifier는 Alpha였다.

그러나 현재 `main` HEAD tree에는 `LICENSE`가 없다.[2] `pyproject.toml`에도 현재 license field가 없다.[12] GitHub API의 current license detection도 `null`이다.[1] 그러므로 **v0.1.0 artifact는 MIT였지만 current main 전체를 자동으로 MIT라고 단정할 수 없다.**

이 차이는 단순 문서 실수가 아닐 수 있다. License file이 빠진 이후 commit의 재사용 조건을 조직이 추정해서는 안 된다. Production adoption은 tag 또는 reviewed commit을 고정하고 그 tree의 license를 확인해야 한다. Current main을 배포하려면 maintainer에게 license 상태를 확인하는 편이 안전하다.

Dependency license도 별도다. `mcp`, `platformdirs`, `pydantic`과 transitive dependency의 조건이 project LICENSE 하나로 대체되지 않는다. Wheel SBOM과 notice obligation을 확인해야 한다. “GitHub에 공개돼 있다”는 말은 오픈소스 라이선스가 있다는 뜻이 아니다.

## 실패 모드

첫 번째 실패 모드는 workspace를 너무 넓게 잡는 것이다. Home directory를 root로 지정하면 bounded path라도 민감 파일이 workspace 안에 들어온다. 작은 project-specific scratch를 사용한다. State root는 반드시 그 밖에 둔다.

두 번째 실패 모드는 status polling을 approval로 오인하는 것이다. `APPROVAL_APPROVED`는 아직 execution success가 아니다. Resume를 호출해야 한다. Resume response와 external side effect를 다시 확인해야 한다.

세 번째 실패 모드는 timeout 뒤 무조건 재제출하는 것이다. Approval은 이미 consumed일 수 있다. External command가 side effect를 일부 만들었을 수 있다. 먼저 downstream을 read-back하고 새 request가 필요한지 판단한다.

네 번째 실패 모드는 `SUCCEEDED`를 business success로 확대하는 것이다. Command exit code 0은 expected artifact나 remote state가 맞다는 뜻이 아니다. Artifact hash, Git status, API read-back 같은 acceptance check를 별도로 둔다. ToolHub는 업무 완료 조건을 알지 못한다.

다섯 번째 실패 모드는 output truncation을 무시하는 것이다. 20,000 character 뒤의 error나 diff가 잘릴 수 있다. Truncation marker가 있으면 결과를 complete로 처리하지 않는다. 더 좁은 query나 artifact file을 승인된 절차로 만든다.

여섯 번째 실패 모드는 audit redaction을 완전한 DLP로 믿는 것이다. Unknown secret format은 남을 수 있다. Argument에 secret을 넣지 않는 설계가 먼저다. Credential broker나 short-lived file descriptor가 더 적합할 수 있다.

일곱 번째 실패 모드는 executable hash를 dependency attestation으로 오인하는 것이다. Interpreter script, DLL, plugin과 config가 바뀔 수 있다. Container나 hermetic environment가 필요한 workload에는 별도 provenance layer를 둔다. ToolHub snapshot은 primary executable boundary만 제공한다.

여덟 번째 실패 모드는 Windows ACL을 POSIX mode와 같다고 가정하는 것이다. State root ACL을 운영자가 직접 확인한다. Shared user profile이나 broadly writable directory를 피한다. Windows test가 CI에서 통과해도 deployment machine의 ACL은 별도다.

아홉 번째 실패 모드는 human approval을 rubber stamp로 만드는 것이다. Argument가 너무 길거나 encoded payload면 사람이 의미를 판단하기 어렵다. High-risk command는 script file diff와 expected effect를 함께 검토한다. 이해할 수 없는 request는 reject한다.

열 번째 실패 모드는 license drift를 무시하는 것이다. `v0.1.0`의 MIT만 보고 current main을 vendor package에 포함하면 provenance가 끊긴다. Exact tree를 archive하고 license file 존재와 dependency notice를 release gate로 둔다. Maintainer 확인 전에는 current main의 법적 상태를 추정하지 않는다.

## ToolHub가 맞는 로컬 승인 환경과 맞지 않는 요구

**적합한 팀**은 local developer workspace에서 agent read를 허용하되 mutation과 external command에 사람 승인을 요구하는 팀이다. MCP client가 stdio child process를 실행할 수 있는 환경에도 맞는다. Small tool surface와 source-level audit를 선호하는 팀에도 맞는다. POSIX와 Windows 양쪽을 지원해야 하지만 각 OS 차이를 운영할 수 있는 팀에도 유용하다.

Repository patch를 agent가 제안하고 사람이 exact snapshot을 승인하는 workflow는 특히 잘 맞는다. Local code review assistant의 write boundary로도 쓸 수 있다. CI가 아닌 developer workstation에서 state를 별도 관리할 수 있다면 deployment가 단순하다. Replay rejection을 client state machine에 반영할 수 있는 개발 역량은 필요하다.

**부적합한 팀**은 remote multi-user MCP gateway가 필요한 팀이다. OAuth, tenant RBAC와 centralized policy decision이 필요하면 다른 계층이 필요하다. Network와 filesystem을 강하게 격리해야 하는 untrusted code execution에도 이것만으로는 부족하다. Automated high-throughput command runner에서 매번 human approval을 요구하면 workflow가 맞지 않는다.

Tool catalog discovery와 prompt 최적화가 주목적인 팀에도 맞지 않는다. ToolHub는 context 절감 결과를 제공하는 제품이 아니다. General shell allowlist가 필요한 batch farm에도 현재 policy는 너무 보수적일 수 있다. Compliance가 action success와 audit append의 atomicity를 요구한다면 non-fatal audit model이 맞지 않는다.

## 도입 gate

첫 gate는 exact commit과 license 상태다. `v0.1.0`을 쓸지 current main을 쓸지 정한다. Main을 택하면 license 불확실성을 해결한다. Package와 Contract version을 둘 다 기록한다.

두 번째 gate는 scratch workspace다. Traversal, absolute path, symlink mutation과 state-inside-workspace fixture를 돌린다. 실제 repository는 아직 연결하지 않는다. Refusal result가 structured outcome인지 확인한다.

세 번째 gate는 14-tool inventory다. Unexpected tool이 하나라도 나오면 deployment를 중단한다. Approve·admin·prune MCP tool이 없어야 한다. Capabilities의 `transport=stdio`, `human_only=true`, contract `1.0`을 read-back한다.

네 번째 gate는 write lifecycle이다. Submit 때 file이 없어야 한다. Human approval 뒤 resume에서만 file이 생겨야 한다. Replay는 `APPROVAL_CONSUMED`여야 한다. Concurrent resume에서도 한 caller만 action을 받아야 한다.

다섯 번째 gate는 conflict와 expiry다. Approved file의 target을 바꿔 `CONFLICT`를 만든다. 그 approval이 consumed됐는지 확인한다. TTL 0 fixture가 execute되지 않는지도 확인한다.

여섯 번째 gate는 shell environment다. Parent에 fake secret을 넣는다. Stored request, admin display, child output과 audit에 값이 없는지 확인한다. Primary executable을 승인 뒤 바꿔 refusal과 consumption을 확인한다.

일곱 번째 gate는 process tree다. Child와 grandchild를 만든다. Timeout 뒤 둘 다 사라지는지 OS handle이나 pid identity로 검사한다. Unrelated process는 살아 있어야 한다.

여덟 번째 gate는 audit gap이다. Audit append failure를 주입한다. Action result와 audit failure가 독립적임을 runbook에 반영한다. SIEM이 event 누락을 탐지할 수 있는지 확인한다.

아홉 번째 gate는 OS별 배포다. Ubuntu 결과만으로 Windows를 승인하지 않는다. Windows Job Object와 ACL fixture를 Windows runner에서 실행한다. POSIX file mode와 lock도 Linux runner에서 확인한다.

열 번째 gate는 실제 project canary다. Read-only tools부터 연다. Write는 낮은 위험 file 하나에 제한한다. External command는 deterministic fixture부터 시작한다. Rollback은 ToolHub state 삭제가 아니라 external artifact 복구까지 포함한다.

## 결론

MCP ToolHub는 많은 tool을 제공하기보다 정확히 14개인 작은 surface에서 read, proposal, human decision, single-use resume를 분리하는 데 가치가 있다. Workspace path는 bounded다. Git inspection은 fixed read-only path다. External command는 한 intrinsic을 제외하면 모두 승인 대상이다.

가장 중요한 설계는 consume-before-execute다. Approval은 exact action snapshot에 묶인다. Resume는 request ID만 받는다. `APPROVED → CONSUMED` transition을 이긴 caller만 실행을 시도한다. Conflict, refusal, timeout과 command failure 뒤에도 approval은 재사용되지 않는다.

그러나 이 제품을 sandbox로 과장해서는 안 된다. Approved program은 local account의 filesystem과 network 권한을 사용할 수 있다. Process-tree containment는 timeout cleanup boundary다. Audit는 bounded·redacted metadata지만 append failure는 action을 막지 않는다. Same-user adversary와 loader dependency는 완전한 보호 모델 밖에 있다.

도입 판단은 간단한 질문으로 정리할 수 있다. 로컬 stdio 환경에서 사람만 mutation과 command를 승인해야 하는가. Exact snapshot과 replay rejection이 필요한가. 별도 OS sandbox와 identity platform은 다른 계층에서 제공할 수 있는가. 세 질문에 모두 그렇다고 답할 수 있다면 ToolHub의 작은 경계가 유용하다.

마지막으로 license 경계를 기억해야 한다. `v0.1.0` release artifact에는 MIT License가 있다. 2026년 10월 17일의 current main에는 명시적 `LICENSE`가 없고 GitHub license detection도 비어 있다. 실행 contract를 정밀하게 검토한 것처럼 재사용 contract도 exact tree 기준으로 검토해야 한다.

## Sources

[1] https://api.github.com/repositories/1347408505
[2] https://github.com/zhihaochen67/mcp-toolhub/tree/930024f8ee5b4c2743675ed30102951095217d1b
[3] https://github.com/zhihaochen67/mcp-toolhub/blob/e4a9f290838d42f0eebbacb7cf06a34c4b2e7b9f/LICENSE
[4] https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/README.md
[5] https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/docs/architecture.md
[6] https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/docs/approval-lifecycle.md
[7] https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/docs/operations.md
[8] https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/tests/test_stdio_integration.py
[9] https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/tests/test_contract.py
[10] https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/tests/test_process_containment.py
[11] https://github.com/zhihaochen67/mcp-toolhub/releases/tag/v0.1.0
[12] https://github.com/zhihaochen67/mcp-toolhub/blob/930024f8ee5b4c2743675ed30102951095217d1b/pyproject.toml
