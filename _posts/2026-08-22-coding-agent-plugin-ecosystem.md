---
title: '코딩 에이전트의 경쟁축이 플러그인 생태계로 넓어지는 이유'
date: 2026-08-22 11:00:00 +0900
categories: ["AI 에이전트"]
description: 'Cursor 플러그인 저장소를 바탕으로 MCP·Skills·플러그인의 역할을 구분하고, 코딩 에이전트 생태계의 확장성과 공급망 보안 과제를 분석한다.'
featured_image: 'https://picsum.photos/seed/coding-agent-plugin-ecosystem/1600/900'
tags: [coding-agent, plugin, mcp, agent-skills, cursor, supply-chain-security]
---

![코딩 에이전트 플러그인 생태계](https://picsum.photos/seed/coding-agent-plugin-ecosystem/1600/900)

코딩 에이전트 시장은 오랫동안 모델 성능으로 설명됐다. 더 긴 context, 더 높은 benchmark 점수, 더 빠른 token 생성이 제품의 차이를 만들었다. 하지만 실제 개발팀이 에이전트를 매일 사용할 때 성패를 가르는 것은 모델 하나가 아니다. 저장소 규칙을 얼마나 잘 이해하는지, Jira와 GitHub에 연결되는지, 테스트와 배포 절차를 반복 가능하게 수행하는지, 조직의 승인을 어떻게 반영하는지가 더 중요해지고 있다.

Cursor가 공개한 `cursor/plugins` 저장소는 이 변화를 보여주는 사례다. 저장소에는 학습, 지속적 memory 갱신, 팀 workflow, 보안 review, 병렬 agent orchestration 같은 공식 plugin과 Gmail, Google Drive, Salesforce, Playwright, GitHub 등 외부 서비스 통합이 함께 나열돼 있다. 각 plugin은 manifest를 가진 독립 directory이며 skills, rules와 MCP 설정을 한 배포 단위로 묶을 수 있다.

이 구조가 곧 특정 제품이 시장을 지배한다는 뜻은 아니다. 저장소는 현재의 공식 구현과 예시를 보여줄 뿐이다. 다만 경쟁의 단위가 “어떤 모델을 호출하는가”에서 “어떤 능력을 안전하게 설치하고 운영하는가”로 넓어지고 있다는 신호로 읽을 수 있다.

## 모델만으로는 팀의 마지막 20%를 해결하기 어렵다

좋은 모델은 일반적인 코드를 만들고 오류를 해석할 수 있다. 그러나 조직마다 다른 branch 규칙, release checklist, 내부 CLI, incident 절차와 데이터 접근 정책은 학습 데이터에 존재하지 않거나 계속 바뀐다. 모든 정보를 매 prompt에 붙이면 context가 비대해지고, 복사된 문서는 곧 낡는다.

제품이 이런 차이를 자체 기능으로 모두 구현하면 release 속도가 느려진다. 반대로 사용자가 임의 script와 prompt를 흩어 놓으면 재현성과 보안이 무너진다. plugin 생태계는 그 중간에 있다. 설치 가능한 package가 지침, 도구 연결, 정책과 보조 script를 일정한 구조로 제공한다.

이때 plugin의 경쟁력은 개수만으로 결정되지 않는다. 필요한 순간에 정확히 발견되는가, 여러 plugin이 충돌하지 않는가, upgrade가 workflow를 깨뜨리지 않는가, 관리자에게 권한과 provenance가 보이는가가 더 중요하다. 앱스토어의 성공 조건과 닮았지만, 에이전트 plugin은 코드를 읽는 것을 넘어 명령 실행과 SaaS 변경까지 할 수 있어 위험 범위가 훨씬 넓다.

## MCP, Skills, 플러그인은 같은 것이 아니다

세 용어가 자주 섞이지만 역할을 분리해야 설계와 보안 경계를 이해할 수 있다.

### MCP는 연결 프로토콜이다

Model Context Protocol은 agent client가 외부 server의 tools, resources와 prompts를 발견하고 호출하는 인터페이스다. 예를 들어 GitHub issue를 읽거나 CRM record를 수정하는 능력을 표준화된 요청으로 노출할 수 있다. MCP는 “무엇을 할 수 있는가”를 기계가 호출 가능한 형태로 만든다.

하지만 MCP server가 있다고 해서 agent가 언제 그 도구를 써야 하는지, 호출 전 어떤 검증을 해야 하는지까지 자동으로 정해지지는 않는다. 인증, scope, 사용자 승인과 audit 정책도 구현과 배포가 책임져야 한다. 프로토콜은 연결 규약이지 조직의 완성된 workflow가 아니다.

### Skills는 수행 절차다

Skill은 특정 작업을 수행하는 방법을 문서와 script로 묶은 지식 단위다. “장애를 조사할 때 먼저 어떤 dashboard를 보고, 어떤 명령을 실행하며, 완료 전 무엇을 검증할 것인가” 같은 절차를 제공한다. tool 자체보다 판단 순서, 품질 기준과 실패 대응을 전달하는 데 적합하다.

Skill은 반드시 새로운 네트워크 권한을 만들 필요가 없다. 이미 허용된 shell이나 MCP tool을 더 일관되게 사용하는 지침일 수 있다. 반대로 지침 속에 위험한 shell command나 외부 다운로드가 포함될 수 있으므로 단순한 markdown이라고 무조건 안전하지도 않다.

### 플러그인은 배포와 수명주기의 경계다

Plugin은 MCP 설정, Skills, rules, agent 정의, script와 metadata를 한 번에 설치·업데이트·제거하는 package다. Cursor 저장소의 예시 구조에는 개별 `.cursor-plugin/plugin.json`, `skills/`, `rules/`, `mcp.json`, README, changelog와 license가 포함될 수 있다.

```text
Plugin
├── manifest: 이름, 버전, 작성자, 진입점
├── Skills: 작업 절차와 품질 기준
├── Rules: 지속 적용할 정책과 맥락
├── MCP config: 외부 도구 연결
└── scripts/assets: 실제 실행 보조물
```

즉 MCP는 통신 면, Skill은 행동 지식 면, Plugin은 배포 면을 담당한다. 하나의 plugin이 MCP 없이 skills만 제공할 수도 있고, remote MCP server는 특정 plugin과 무관하게 사용될 수도 있다. 이 구분이 없으면 “plugin을 허용했으니 MCP도 안전하다”거나 “markdown skill이라 실행 위험이 없다”는 잘못된 결론에 도달한다.

## 생태계 경쟁에서 중요한 네 가지 층

첫째는 **능력의 폭**이다. source control, database, browser, observability, design tool과 사내 시스템이 연결될수록 agent가 작업을 끝까지 완수할 수 있다. 모델이 같아도 한 제품은 코드 초안에서 멈추고 다른 제품은 issue, test, review와 배포까지 이어질 수 있다.

둘째는 **발견과 조합**이다. plugin이 수천 개여도 이름을 알아야만 쓸 수 있으면 가치가 낮다. 현재 repository와 task에 맞는 skill을 선택하고, 중복 rules의 우선순위를 설명하며, 최소한의 context만 불러와야 한다. plugin 간 dependency와 충돌 해결도 package manager 수준으로 발전해야 한다.

셋째는 **운영 가능성**이다. 조직은 특정 version 고정, 중앙 allowlist, 강제 update, 사용량 audit, 긴급 revoke가 필요하다. 개인 개발자는 클릭 한 번 설치를 원하지만, 기업 관리자는 동일한 클릭이 production credential까지 연결하지 않기를 원한다. 좋은 생태계는 두 요구를 별도 policy layer로 풀어야 한다.

넷째는 **이식성**이다. MCP와 공개적인 Skill 형식은 특정 client에 갇히지 않을 가능성을 높인다. 그러나 manifest, UI, permission model과 lifecycle hook은 제품마다 다를 수 있다. “표준을 사용한다”와 “plugin 전체가 호환된다”는 같은 말이 아니다. 실제 이전 테스트 없이 portability를 약속하면 과장이다.

## 확장성이 만드는 트레이드오프

플러그인 생태계는 core product가 모든 integration을 직접 개발하지 않아도 되는 대신 품질 통제를 외부 publisher와 나눈다. 선택지가 늘수록 사용자는 자신에게 맞는 workflow를 만들 수 있지만, 비슷한 이름과 중복 기능 사이에서 검증 비용도 커진다. 빠른 update는 새로운 API를 즉시 지원하지만 어제 동작하던 자동화를 오늘 깨뜨릴 수 있다.

조직 중앙 registry는 위험한 package를 차단하고 version을 통일하는 데 유리하다. 반면 승인 대기시간이 길어지면 ecosystem의 속도 이점을 잃고 개발자의 우회 설치를 부를 수 있다. 완전한 개방과 완전한 폐쇄 가운데 하나를 택하기보다 read-only plugin은 빠르게 승인하고, production write 권한은 더 강하게 심사하는 계층화가 필요하다.

호환성에도 비용이 있다. 공통 MCP와 Skill 형식만 사용하면 여러 client로 옮기기 쉽지만 각 제품의 고유 UI, hook와 cloud agent 기능을 충분히 활용하기 어렵다. 반대로 vendor 전용 기능을 깊게 쓰면 경험은 좋아져도 migration 비용이 커진다. 팀은 plugin 수가 아니라 교체 가능성, 운영 비용과 실패 시 blast radius를 함께 평가해야 한다.

## 플러그인은 새로운 소프트웨어 공급망이다

plugin은 prompt 모음이 아니라 실행 가능한 공급망 artifact로 취급해야 한다. 설치 시점에는 안전해 보여도 update로 MCP endpoint, script 또는 instruction이 바뀔 수 있다. maintainer account 탈취, dependency confusion, typo-squatting, 악성 post-install, remote server의 동작 변경이 모두 공격 경로가 된다.

위험을 구성 요소별로 나누면 대응이 선명해진다.

| 구성 요소 | 주요 위험 | 필요한 통제 |
|---|---|---|
| manifest | 이름 위장, 권한 은폐 | schema 검증, 고유 publisher identity |
| Skill/Rule | prompt injection, 위험 절차 | code review, 허용 명령 정책 |
| script/binary | 악성 코드, dependency 취약점 | 서명, SBOM, sandbox, hash 고정 |
| MCP config | 임의 endpoint, 과도한 scope | endpoint allowlist, OAuth scope 검토 |
| remote MCP | 설치 후 server 동작 변경 | tool schema pinning, runtime audit |
| update channel | maintainer 탈취, 자동 오염 | 서명된 release, staged rollout, rollback |

가장 먼저 필요한 것은 provenance다. 누가 만들었고 어떤 repository와 commit에서 build됐는지, marketplace의 publisher와 source maintainer가 같은 주체인지 확인해야 한다. 이름과 별점은 신뢰의 충분조건이 아니다.

두 번째는 version과 content 고정이다. `latest`를 자동으로 받기보다 승인된 version과 digest를 lockfile에 기록한다. MCP가 remote server라면 package hash만으로 server 동작을 고정할 수 없다는 점도 인정해야 한다. tool 목록과 input schema의 변경을 감지하고, 새 write tool이 등장하면 재승인을 요구하는 방식이 필요하다.

세 번째는 최소 권한이다. plugin이 Gmail 검색과 draft 작성만 필요하다면 메일 삭제 권한까지 주지 않는다. GitHub review plugin에 organization admin token을 제공하지 않는다. read, write, destructive action을 구분하고 write에는 사용자 확인, 짧은 token, rate limit과 idempotency를 적용한다.

네 번째는 runtime 격리다. local script는 workspace, home directory, secret store와 network에 기본적으로 접근하지 못하게 하고 필요한 capability만 연다. MCP response와 repository 문서도 신뢰할 수 없는 입력으로 다룬다. agent가 읽은 텍스트가 다음 tool 호출을 유도할 수 있기 때문이다.

다섯 번째는 감사와 회수다. 어떤 사용자와 agent session이 어느 plugin version의 어떤 tool을 호출했는지 남겨야 한다. 민감한 prompt 전문을 모두 저장할 필요는 없지만 actor, plugin, server, tool, policy decision, request ID와 결과 상태는 추적 가능해야 한다. 문제가 생기면 특정 plugin version과 credential을 즉시 revoke할 수 있어야 한다.

## 실무 도입 아키텍처

조직에서는 marketplace를 곧바로 모든 개발자에게 개방하기보다 내부 catalog를 두는 편이 안전하다.

```text
공개 marketplace / Git repository
          ↓ 수집
정적 검사 · malware scan · license 검토
          ↓ 승인
내부 plugin registry + version lock
          ↓ 설치 정책
관리형 agent client
          ↓ runtime policy
sandbox / MCP gateway / audit log
```

정적 검사에서는 manifest schema, 외부 URL, shell command, bundled binary와 dependency를 확인한다. 동적 검사에서는 임시 계정과 sandbox로 plugin을 실행해 실제 network destination과 파일 접근을 관찰한다. 승인 뒤에도 자동 update를 production에 바로 배포하지 말고 canary 사용자에게 먼저 적용한다.

MCP gateway를 사용하면 인증, tool allowlist와 audit를 중앙화할 수 있다. 다만 local stdio MCP나 plugin script는 gateway 밖에서 동작할 수 있으므로 client policy와 endpoint monitoring을 함께 써야 한다. 중앙 gateway 하나가 모든 위험을 해결한다고 말하면 안 된다.

개발 경험도 중요하다. 승인이 너무 느리면 사용자는 개인 token과 임의 설정으로 우회한다. read-only integration은 빠른 경로로 승인하고, production write와 customer data 접근은 강화된 검토로 나누는 risk-based process가 현실적이다.

## 팀을 위한 체크리스트

- [ ] MCP, Skill, Rule, script와 Plugin의 권한 경계를 문서화했다.
- [ ] plugin publisher, source repository와 build provenance를 확인했다.
- [ ] 승인 version과 artifact digest를 lockfile에 고정했다.
- [ ] bundled dependency의 license, 취약점과 SBOM을 검토했다.
- [ ] 설치·update 시 추가되는 MCP endpoint와 tool schema diff를 검사한다.
- [ ] read, write, destructive tool에 서로 다른 승인 정책을 적용했다.
- [ ] OAuth token은 최소 scope와 짧은 만료시간을 사용한다.
- [ ] local script를 filesystem·network capability가 제한된 sandbox에서 실행한다.
- [ ] remote content와 tool result를 신뢰하지 않는 입력으로 처리한다.
- [ ] plugin version별 tool call과 policy decision을 감사할 수 있다.
- [ ] staged rollout, 자동 중지와 이전 version rollback 절차가 있다.
- [ ] 사용하지 않는 plugin, server와 token을 정기적으로 회수한다.
- [ ] 개발자가 필요한 plugin을 빠르게 요청할 예외 절차가 있다.

## 결론

모델 성능 경쟁은 끝나지 않는다. 더 정확하고 빠른 모델은 여전히 중요하다. 그러나 모델이 상향 평준화될수록 제품 차이는 팀의 실제 workflow를 얼마나 넓고 안정적으로 연결하는지에서 커진다. plugin은 모델에 조직별 지식과 도구를 붙이고, 독립 개발자가 새로운 사용 사례를 빠르게 배포하게 하는 핵심 단위가 될 수 있다.

Cursor의 공개 저장소는 skills, rules와 MCP 설정을 plugin이라는 수명주기 안에 묶는 한 가지 구현을 보여준다. 이것을 모든 agent의 표준으로 일반화할 수는 없지만, 공식 plugin과 third-party integration을 함께 관리하려는 방향은 분명하다.

다음 경쟁의 승자는 plugin 수가 가장 많은 제품이 아닐 가능성이 크다. 설치 전에 출처와 권한을 설명하고, 실행 중에는 최소 권한과 감사가 적용되며, 문제 발생 시 즉시 회수할 수 있는 생태계가 더 오래 살아남는다. 에이전트 plugin은 앱스토어인 동시에 CI runner, package registry와 OAuth integration이다. 편의성만 보고 열면 새로운 Shadow IT가 되고, 공급망으로 다루면 조직의 개발 운영체제가 될 수 있다.

## 참고 자료

- [Cursor plugins: specification and official plugins](https://github.com/cursor/plugins)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/)
- [Agent Skills Specification](https://agentskills.io/specification)
- [GitHub Docs: Supply chain security](https://docs.github.com/en/code-security/concepts/supply-chain-security/supply-chain-security)
