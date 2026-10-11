---
title: '명령을 승인해도 효과는 승인되지 않았다 — 에이전트 샌드박스의 4계층'
date: 2026-10-11 09:00:00 +0900
categories: ["AI 에이전트"]
description: 'GitHub Copilot local sandbox GA와 developer preview인 Strands Box를 비교해 OS containment, effect-level interception, credential injection, temporal tool policy를 하나의 실행 경계로 설계한다.'
featured_image: '/images/posts/2026-10-11-agent-sandbox-four-layer-boundary.png'
tags: [github-copilot, strands-box, dogwood, agent-sandbox, runtime-policy, credential-injection]
---

![에이전트 샌드박스의 네 계층 실행 경계](/images/posts/2026-10-11-agent-sandbox-four-layer-boundary.png)

사람에게 다음 명령을 실행해도 되는지 묻는 승인 창이 떴다고 하자.

```text
python scripts/release.py --channel staging
```

하지만 `release.py`는 symlink 대상 파일을 덮어쓰고, package hook과 HTTP 요청을 거쳐, 토큰으로 원격 release를 만들 수 있다. 승인한 것은 한 줄의 command인가, 그 command가 일으킬 실제 효과인가?

GitHub는 2026년 10월 7일 Copilot CLI, GitHub Copilot app, VS Code Agent Host의 **local sandboxing을 GA**로 발표했다. MXC가 공통 정책을 Windows·macOS·Linux의 native control로 번역한다.[1] 같은 날 AWS는 Strands Box를 Apache 2.0 **developer preview**로 공개했다. Box는 OS containment에 더해 shell·Python·HTTP egress·MCP 효과를 Dogwood 정책으로 판정한다.[5]

둘을 단일 강도 축으로 비교하면 핵심을 놓친다. GitHub는 여러 surface와 OS에 배포된 containment를, macOS Apple silicon 중심의 초기 Box는 command와 효과 사이의 집행 지점을 보여준다.[6] 일반 sandbox론이나 OCI capability 대신 실행 경계를 네 계층으로 나눠 보자.

1. **OS containment**: 프로세스가 닿을 수 있는 최대 범위
2. **Effect-level interception**: 실제 file·process·HTTP·MCP 효과의 판정
3. **Credential injection**: 비밀을 agent에게 주지 않고 허용된 요청에만 부착
4. **Temporal tool policy**: 현재 호출을 과거 행동의 순서·시간·누적량과 함께 판정

핵심은 이렇다. **명령 승인은 의도에 대한 판단이고, 효과 집행은 실행 경계의 일이다.** 둘은 같은 기록에 연결돼야 하지만 같은 통제로 취급해서는 안 된다.

## 먼저 상태표부터 분리하자

2026년 10월 11일 기준으로 제품 상태를 한 단어로 합치면 문서의 불일치를 숨기게 된다.

| 대상 | 발표 상태 | 실제로 구분해야 할 surface |
|---|---|---|
| GitHub Copilot local sandbox | 10월 7일 CLI·Copilot app·VS Code Agent Host에서 GA[1] | CLI, app, VS Code Agent Host, OS backend별 지원 범위 |
| GitHub Copilot cloud sandbox | local GA와 별개 | Canonical overview에서 **cloud만** public preview이고, CLI 실행 경로도 experimental로 설명한다.[2] |
| GitHub 문서 surface | 동시 갱신으로 가정할 수 없음 | 같은 시점의 filesystem-policy 세부 문서에는 local public preview와 Windows Insider build 문구가 남아 있다.[3] |
| Strands Box | developer preview[5] | 현재 Apple silicon의 macOS 15 이상을 출발점으로 하며 Linux는 계획 상태다.[6] |

따라서 “GitHub sandbox가 experimental이다”도, “관련 문서가 전부 GA로 정리됐다”도 정확하지 않다. 발표는 **local sandbox의 세 제품 surface GA**를 명시하고, canonical overview의 preview 표시는 cloud에만 붙는다.[1][2] 반면 filesystem-policy 세부 문서의 local preview·Windows 문구는 stale 상태다.[3] 운영 기준에는 발표, 사용 surface와 client version, 실제 `/sandbox status`·`/sandbox policy` 결과를 함께 고정해야 한다.

Strands Box에는 이런 해석 여지가 더 적다. 공식 발표가 developer preview라고 명시하고 저장소도 early-stage 범위와 현재 플랫폼 제약을 공개한다.[5][6]

## 비교 단위는 제품이 아니라 집행 계층이다

두 제품의 차이는 기능 체크리스트보다 “누가 무엇을 관찰하고 어디서 거부하는가”로 읽는 편이 정확하다.

| 계층 | GitHub Copilot local sandbox | Strands Box | 이 계층만으로 남는 공백 |
|---|---|---|---|
| OS containment | MXC가 OS별 native backend로 path·network·system capability를 제한[1][2] | macOS Seatbelt로 agent가 직접 닿는 host·network 범위를 제한[5] | 허용된 command 내부의 의미적 효과 |
| Effect interception | child process는 OS가 집행하지만 CLI의 built-in file tool은 software check, OS backstop 없음[2][3] | Shell·Monty·egress gateway·MCP broker가 정규화된 action을 Dogwood에 질의[5][7] | interception point를 우회하는 직접 접근 |
| Credential injection | placeholder와 local proxy로 Git·`gh`·지정 env secret을 승인 destination에 공급[4] | egress gateway가 bearer·header·Basic·query 또는 SigV4를 허용 요청에 부착[5] | credential이 허용하는 원격 권한 자체 |
| Temporal policy | 공개 local sandbox 설명의 중심은 현재 effective policy와 operation 제약 | 공유 event history로 순서·시간창·횟수·결과를 판정[5][8] | history 무결성, 동시성, crash recovery |

GitHub의 강점은 여러 local product surface에 배포된 containment이고, Box의 preview 설계는 구체적 효과를 별도 policy plane에서 다룬다는 점이다. 어느 쪽이든 네 계층을 `sandbox=true`로 압축해서는 안 된다.

## 1계층: OS containment는 최대 피해 반경을 닫는다

첫 번째 질문은 간단하다.

> 이 프로세스가 정책 엔진을 속이거나 예상과 다른 코드를 실행해도, OS가 허용하는 최대 범위는 어디까지인가?

GitHub Copilot local sandbox에서 MXC는 공통 sandbox policy를 native control로 번역한다. 현재 overview는 macOS의 Seatbelt, Linux의 bubblewrap, Windows의 **BaseContainer tier of the ProcessContainer backend**를 설명하며 AppContainer fallback은 쓰지 않는다고 명시한다.[2] 설정 문서도 지원되는 Windows 11 build와 update, BaseContainer 지원을 prerequisite로 고정한다.[4] 이 local sandbox는 별도 VM이나 container 안에서 command를 돌리는 방식이 아니라 host의 process·filesystem·network 격리를 사용하는 가벼운 쪽의 경계다.[2]

여기서 GA는 모든 OS에서 동일한 보안 의미를 보장한다는 뜻이 아니다. macOS와 Linux에서는 host rule이나 credential masking을 위한 local proxy로 outbound를 강제할 수 있지만, Windows의 일부 구성은 프로그램이 proxy 설정을 따르는 데 의존한다. Linux bubblewrap은 spawned process의 local network를 별도로 세밀하게 통제하지 못하는 제한도 문서화돼 있다. 지원하지 않는 정책을 조용히 약화하는지, operation을 실패시키는지도 surface와 managed setting에 따라 확인해야 한다.[2][4]

Copilot CLI 전체가 sandbox 안에 들어가는 것도 아니다. Shell command와 local MCP·LSP 같은 child process는 OS 경계를 받지만, CLI 안의 built-in file read/edit는 같은 policy를 software로 확인한다. 이 경로에는 OS-level backstop이 없다.[2][3]

Strands Box의 containment도 “모든 것을 policy event로 바꾼다”는 마법이 아니다. `box.toml`에서 agent에게 직접 grant한 path는 OS가 경계를 집행하지만 Dogwood decision history에는 나타나지 않는다. 별도 tool sandbox에 직접 허용한 파일 접근, `shell:spawn`으로 허용한 host program 내부의 file operation도 모두 세부 policy decision으로 자동 승격되지 않는다.[5][7]

Containment의 계약은 모든 효과를 설명하는 것이 아니라 **보이지 않는 효과까지 포함해 최대 reach를 제한하는 것**이다. 검증할 것은 OS별 실제 restriction, unsupported policy의 fail-closed 여부, in-process tool의 검사 주체, direct grant와 spawned tool의 log 공백이다. 이 답이 없으면 “sandbox에서 실행했다”는 말은 실제 경계를 말하지 않는다.

## 2계층: command 문자열 대신 실제 효과를 판정한다

명령 기반 승인의 가장 큰 약점은 문자열과 효과가 일대일이 아니라는 점이다.

```text
npm test
```

이 한 줄은 `package.json`의 script, lifecycle hook, child process, test runner plugin으로 확장된다. 오늘의 `npm test`와 dependency update 뒤의 `npm test`는 같은 문자열이지만 다른 프로그램이다. 반대로 `curl`, Python `requests`, SDK client가 모두 같은 `POST /api/releases` 효과를 만들 수도 있다. 문자열을 정책의 최종 단위로 삼으면 **같은 문자열의 다른 효과**와 **다른 문자열의 같은 효과**를 동시에 놓친다.

Strands Box가 흥미로운 지점은 interpreter와 gateway를 agent process 밖의 집행 지점으로 둔 데 있다. Strands Shell은 `rm -rf build/`을 opaque command 하나로만 보지 않고, 삭제할 각 파일을 `fs:delete` decision으로 올릴 수 있다. Monty 기반 Python interpreter의 file access, egress gateway의 host·port·HTTP method·path, MCP broker의 tool call도 공통 형식으로 Dogwood에 전달한다. Shell의 `curl`과 Python의 HTTP client가 같은 요청을 만들면 둘 다 `http:request`로 기록할 수 있다.[5]

이 정규화는 정책을 도구 이름에서 `fs:read`, `fs:write`, `shell:spawn`, `http:request(host, method, path)`, `mcp:call(server, tool)` 같은 효과로 옮긴다.

예를 들어 승인 화면에 `python analyze.py`가 보였다고 해서 외부 전송을 승인한 것은 아니다. `analyze.py`가 customer-data를 읽는 것은 `fs:read`, 그 뒤 telemetry endpoint로 보내는 것은 별도 `http:request`로 판정해야 한다. 사람은 task 의도를 승인할 수 있지만, gateway는 실제 destination과 method/path를 기준으로 최종 집행해야 한다.

다만 Box의 interception coverage도 완전하지 않다. Agent에게 직접 grant한 project path를 harness의 built-in file tool이 열면 containment가 제한할 뿐 Dogwood history에는 잡히지 않는다. 허용된 외부 binary가 내부에서 수행하는 syscall도 `shell:spawn` 이후의 세부 action으로 자동 분해되지 않는다.[5][7] 따라서 “정책 엔진이 file action을 이해한다”와 “모든 file access가 정책 엔진을 지난다”는 다른 주장이다.

GitHub에서도 같은 구분이 필요하다. `/sandbox policy`는 saved setting 복사본이 아니라 automatic grant, 현재 working directory, dev tool access, managed restriction을 합성한 effective policy를 보여준다.[3] 하지만 built-in file tool은 OS가 아니라 application code가 검사한다. 그러므로 운영 기록에는 최소한 다음 세 필드가 있어야 한다.

```text
request:  사용자가 보거나 agent가 제안한 command/tool call
verdict:  어느 policy version이 무엇을 근거로 허용했는가
result:   실제로 관찰된 file/process/network/remote effect
```

`verdict=allow`는 `result=예상한 효과`를 뜻하지 않는다. 실행 뒤 변경된 file, 실제 HTTP response, 생성된 remote object를 read-back해야 승인과 결과를 결합할 수 있다.

## 3계층: credential은 환경이 아니라 경계에서 주입한다

Filesystem과 network가 잘 제한돼도 real token이 agent environment에 들어가면 경계가 다시 넓어진다. Agent는 token을 출력하고, subprocess에 넘기고, trace나 generated file에 남길 수 있다. 더구나 사람은 “GitHub에 접근”을 허용했다고 생각해도, token 자체는 그보다 넓은 repository나 API scope를 가질 수 있다.

GitHub Copilot CLI의 local sandbox는 sandboxed process에 placeholder를 주고 local proxy가 허용된 HTTPS 요청에 실제 credential을 넣는 방식을 제공한다. Git 인증은 원래 host·port·repository path에, `gh` token은 `github.com`, `api.github.com`, `uploads.github.com`에 제한된다. 사용자가 지정한 masked environment variable도 injection host를 설정할 수 있다. Host를 credential injection 목록에 넣는 것만으로 network access가 열리지는 않는다. Network policy와 credential binding을 둘 다 통과해야 한다.[4]

Strands Box도 비슷한 원칙을 더 일반적인 egress binding으로 드러낸다. Agent는 placeholder만 보고, gateway가 policy를 통과한 요청에 bearer token, custom header, HTTP Basic, query parameter를 넣거나 agent 밖에서 얻은 AWS credential로 SigV4 signing을 수행한다.[5] `box.toml`의 credential binding은 destination permit을 대신하지 않는다. “어떤 secret을 사용할 수 있다”와 “어디로 요청할 수 있다”를 별도 조건으로 둔다.

좋은 credential injection은 destination, method·path, 대신하는 identity, lifetime·횟수, redirect·retry에서의 재주입 조건을 한 binding으로 묶는다.

여기서도 command 승인은 부족하다. `gh pr create` 문자열을 승인해도 실제 proxy가 `api.github.com`의 어떤 path로 요청했는지, redirect가 있었는지, 어느 repository에 object가 생겼는지는 별도 사실이다. 반대로 credential injection을 썼다는 이유로 원격 side effect가 안전해지는 것도 아니다. Gateway는 token 노출을 줄이지만, 그 token으로 허용된 잘못된 API 요청까지 자동으로 이해하지 않는다. 그래서 2계층의 effect interception과 3계층의 credential binding을 함께 적용해야 한다.

## 4계층: 한 번의 allow가 안전해도 trajectory는 위험할 수 있다

정적 allowlist는 현재 요청만 본다. 하지만 허용된 Slack post도 10분에 수백 번이면 incident channel을 마비시키고, 허용된 file read와 HTTP request도 **민감 파일을 읽은 뒤 외부 전송**이라는 순서로 결합되면 위험하다. Temporal policy는 순서, 경과 시간, 누적량, 결과를 현재 verdict의 입력으로 만든다.[5][8]

이때 `request`와 `response` 중 무엇을 세는지가 보안 의미를 바꾼다. Box의 공식 security 문서는 `response` 기반 budget은 완료되지 않은 여러 in-flight 요청이 같은 count를 보고 통과해 초과될 수 있다고 경고한다. `request` 기반 budget은 그 race를 닫지만, 허용되지 않은 시도까지 request event로 기록하므로 거부된 attempt도 quota를 소비한다.[7] 성공 결과를 세는 한도와 시도·노출을 제한하는 한도는 같은 정책이 아니다.

Temporal verdict도 history에 들어온 효과만 볼 수 있다. Direct grant의 file read가 event를 만들지 않으면 이후 outbound 금지 규칙은 작동하지 않는다. 이 글에서는 이 경계만 남기고, request/response 선택, 동시성의 total order, durable log·crash recovery, atomic policy update는 [Dogwood Temporal Policy 글]({% post_url 2026-10-11-dogwood-temporal-policy-agent-authorization %})에서 다룬다. 여기서 필요한 결론은 하나다. **현재 command가 허용됐다는 사실은 세션 전체 trajectory가 허용됐다는 뜻이 아니다.**

## 운영 설계안: 체크리스트보다 coverage map을 만든다

여기서부터의 `executable digest`, single-use capability, 승인과 read-back의 4단계는 GitHub Copilot이나 Strands Box가 공통으로 제공한다고 확인된 기능이 아니다. 두 제품의 경계를 조합해 조직이 추가할 **운영 설계안**이다.

1. 승인 화면에 command와 함께 executable digest, working directory, 예상 write·network·remote effect, credential binding을 표시한다.
2. 승인 결과를 `session + digest + cwd + effect + destination + expiry/max-count`에 묶인 single-use 또는 단기 capability로 발급한다.
3. OS와 interpreter·broker·gateway가 실제 effect를 다시 판정하며, 보지 못하는 경로를 coverage map에 남긴다.
4. 실행 뒤 file hash, Git HEAD, API response·생성 object를 read-back해 예상 효과와 관찰 효과를 비교한다.

이 네 단계의 목적은 승인 항목을 늘리는 것이 아니라, **어느 효과가 어느 경계를 실제로 통과하는지**를 빠짐없이 드러내는 데 있다.

| 진입 경로 | OS containment | Effect event | Credential·history | 반드시 기록할 공백 |
|---|---|---|---|---|
| Shell·Python interpreter | 허용 path·process 범위 제한 | Box trusted process를 거치면 file·spawn·HTTP 판정 | Gateway 주입과 Dogwood history 연결 가능 | 직접 grant path, interpreter 밖 syscall |
| GitHub CLI built-in file tool | 동일 filesystem policy를 software로 확인 | OS backstop 없음[3] | 제품별 network·credential 정책과 별도 확인 | child process와 다른 집행 주체 |
| 허용된 external binary | binary 실행까지 제한 | `shell:spawn` 뒤 내부 file operation은 세분화되지 않음[7] | 직접 network 경로가 있으면 gateway history 누락 가능 | spawn 이후 syscall·destination |
| HTTP client·cloud CLI | network reach 제한 | Gateway를 통과하면 host·method·path 판정 | 허용 요청에만 credential 주입 | redirect·retry·직접 socket |
| Local·remote MCP | local process 여부에 따라 다름 | Broker가 본 tool call만 판정 | Broker event가 history에 들어가야 함 | remote server 내부 side effect |

검증도 제품 이름별 체크리스트 대신 이 표의 빈칸을 공격해야 한다. 같은 금지 endpoint를 `curl`과 Python client로 호출하고, built-in file tool과 child process의 deny가 일치하는지 비교한다. External binary 내부 효과와 remote MCP 결과가 어디서 사라지는지 찾고, placeholder 출력·redirect·retry로 credential binding을 우회해 본다. Response quota에는 동시 요청을, unsupported OS restriction에는 silent downgrade를 주입한다. 이것은 sandbox 탈출만 찾는 시험이 아니라 **의도, verdict, 실제 효과 사이의 관측·집행 공백**을 찾는 시험이다.

## 결론: 승인할 것은 command가 아니라 제한된 효과다

GitHub local sandbox의 GA는 local agent 실행이 실험 기능만은 아니라는 변화를 보여준다. 그러나 모든 문서 surface와 OS backend가 같은 상태·보장을 갖는 것은 아니다. Local GA, cloud preview/experimental, filesystem-policy 세부 문서의 stale local preview·Windows 문구를 분리하고 실제 client와 effective policy를 확인해야 한다.[1][2][3]

Strands Box는 반대편의 중요한 설계 질문을 보여준다. 아직 developer preview이고 플랫폼 범위도 좁지만, OS containment 바깥에 effect-level interception, credential injection, shared temporal history를 놓음으로써 harness의 command prompt가 놓치는 효과를 정책 대상으로 만든다.[5][6] 동시에 direct grant와 spawned program 내부처럼 policy가 보지 못하는 경로, 넓어진 trusted computing base도 공개한다.[5][7]

네 계층은 대체 관계가 아니다. OS containment는 모르는 효과의 최대 반경을 닫는다. Effect interception은 command를 file·host·HTTP path·MCP tool이라는 실제 action으로 바꾼다. Credential injection은 비밀을 agent에서 분리한다. Temporal policy는 개별 allow가 누적돼 위험한 trajectory가 되는 것을 막는다.

따라서 승인 창의 질문도 바뀌어야 한다.

> “이 command를 실행할까요?”

에서 끝내지 말고,

> “이 session이 이 executable과 credential binding으로, 이 시간과 횟수 안에서, 이 file·host·HTTP path에만 효과를 내도록 허용할까요?”

라고 물어야 한다. 그리고 그 답은 prompt에 저장하는 문장이 아니라 OS, interpreter, broker, gateway, event history가 함께 집행하는 제한된 capability여야 한다.

## Sources

[1] https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available/
[2] https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes
[3] https://docs.github.com/en/copilot/concepts/agents/copilot-cli/understanding-local-sandboxing
[4] https://docs.github.com/en/copilot/how-tos/cloud-and-local-sandboxes/configuring-local-sandbox-settings
[5] https://aws.amazon.com/blogs/opensource/introducing-strands-box-ai-agent-sandboxes-powered-by-dogwood/
[6] https://github.com/strands-agents/box/tree/ff8e8091ad7d5367d6826b41ebef4bda2510b829
[7] https://github.com/strands-agents/box/blob/ff8e8091ad7d5367d6826b41ebef4bda2510b829/docs/user/security.md
[8] https://aws.amazon.com/blogs/opensource/introducing-the-dogwood-local-engine-temporal-governance-for-agent-actions/
