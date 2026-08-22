---
title: '로컬 AI 에이전트로 소프트웨어 공장을 만들 수 있을까'
date: 2026-08-22 07:30:00 +0900
categories: ["개발/인프라"]
description: '자체 호스팅 모델과 격리된 실행 환경으로 에이전트 소프트웨어 공장을 구성할 때 필요한 제어면, 보안 경계, 비용과 운영 trade-off를 분석한다.'
featured_image: 'https://picsum.photos/seed/self-hosted-agentic-software-factory/1600/900'
tags: [ai-agent, self-hosted, sandbox, devops, software-factory, security, llm]
---

![자체 호스팅 에이전트 소프트웨어 공장](https://picsum.photos/seed/self-hosted-agentic-software-factory/1600/900)

요구사항을 issue로 넣으면 여러 AI 에이전트가 코드를 작성하고, 테스트를 돌리고, 서로 리뷰한 뒤 pull request를 만든다. 모델과 실행 환경도 로컬 서버에 두면 외부 API 비용과 데이터 유출 걱정까지 줄일 수 있다. 이 구상은 흔히 "에이전트 소프트웨어 공장"으로 불린다.

이름은 자동화된 생산 라인을 떠올리게 하지만 현실은 조금 다르다. 소프트웨어 요구사항은 부품 규격처럼 완전히 정형화되지 않고, 테스트 통과가 제품 요구 충족을 보장하지도 않는다. 에이전트가 더 많이 일할수록 잘못된 변경, 무한 재시도, dependency 공급망 위험도 함께 늘어난다. 공장의 핵심은 에이전트 수가 아니라 작업을 제한하고 관찰하며 중단할 수 있는 운영 시스템이다.

Jake Saunders의 자체 호스팅·sandbox 에이전트 공장 글은 이 문제를 탐색하는 주된 사례다. 다만 이 글을 작성하는 환경에서는 해당 원문 URL의 본문을 안정적으로 가져오지 못했다. 따라서 그 글의 구체적인 구성이나 성능을 확인한 사실처럼 재현하지 않고, URL과 제목이 제시하는 문제를 바탕으로 공식 컨테이너 보안 문서와 일반적인 CI 운영 원칙에 근거해 설계를 분석한다.

## 먼저 공장의 생산 단위를 정의해야 한다

"코드를 만든다"는 목표는 너무 크다. 에이전트가 완료할 수 있는 생산 단위는 입력, 권한, 검증 조건, 산출물이 명확해야 한다. 예를 들면 다음 정도다.

- 재현 테스트가 있는 작은 버그 수정
- 명세와 schema가 확정된 API endpoint 추가
- 반복적인 dependency 업데이트와 호환성 수정
- 문서와 코드 주석의 일관성 정리
- 정적 분석 경고의 제한된 범위 수정
- 기존 패턴을 따르는 CRUD 화면 생성

반대로 제품 방향을 결정하거나 여러 팀의 미확정 요구를 조정하는 작업은 공장형 자동화에 맞지 않는다. 에이전트가 자연스러운 설명을 만들어도 실제 합의가 생긴 것은 아니다. 불확실성이 큰 작업을 자동화 라인에 넣으면 빠르게 많은 코드를 만들지만, 요구사항을 잘못 이해한 채 최적화할 수 있다.

좋은 시작점은 "한 issue에서 하나의 검증 가능한 diff를 만든다"다. 성공 기준은 코드 줄 수나 agent turn 수가 아니라 reviewer가 채택할 수 있는 변경인지다.

## 자체 호스팅은 데이터 경계를 바꾸지만 책임을 없애지 않는다

로컬 모델의 가장 분명한 장점은 prompt, 소스 코드, 로그가 외부 모델 API로 직접 전송되지 않도록 설계할 수 있다는 점이다. 규제 산업이나 폐쇄망에서는 중요한 조건이다. rate limit과 외부 서비스 장애의 영향도 줄일 수 있고, 반복 workload에서는 GPU 자원을 높은 이용률로 운영할 가능성이 있다.

그러나 "서버가 우리 건물에 있다"와 "안전하다"는 같은 말이 아니다. 모델 파일과 container image는 외부에서 들어온다. package manager는 인터넷에서 코드를 내려받는다. 에이전트가 읽은 저장소에는 prompt injection 역할을 하는 문서가 있을 수 있다. 테스트가 클라우드 credential에 접근하면 로컬 에이전트도 실제 인프라를 변경할 수 있다.

자체 호스팅으로 새로 맡게 되는 책임도 있다.

- GPU capacity planning과 queue 관리
- 모델 배포, rollback, 성능 regression 확인
- 추론 서버 인증과 tenant 격리
- prompt와 tool log의 보존·삭제 정책
- 취약한 image와 dependency patch
- 장애 대응과 on-call
- 라이선스와 모델 사용 조건 검토

외부 API 요금을 줄인 대신 플랫폼 운영 비용을 떠안는 구조다. 작은 팀에서는 낮은 호출량 때문에 GPU가 대부분 놀 수 있고, 전력과 관리 비용까지 포함하면 API가 더 저렴할 수 있다.

## 모델 면과 실행 면을 분리해야 한다

에이전트 시스템은 최소 두 개의 신뢰 영역으로 나누는 편이 안전하다.

첫째는 모델과 orchestration이 있는 control plane이다. issue를 읽고 작업을 분해하며 어떤 도구를 호출할지 결정한다. 둘째는 실제 명령을 실행하는 worker plane이다. 저장소를 checkout하고 package를 설치하며 테스트를 수행한다.

모델이 worker의 root shell을 직접 소유하면 작은 판단 오류가 전체 host 침해로 이어질 수 있다. control plane은 선언적인 job spec을 만들고, 별도 executor가 policy를 검사한 뒤 격리된 worker에서 실행해야 한다.

```text
Issue / 작업 요청
      ↓
정책 검사와 작업 분류
      ↓
Planner → 구현 Agent → Reviewer
      ↓           격리된 job API
일회성 sandbox worker
      ↓
테스트 결과·diff·감사 로그
      ↓
사람 승인 후 PR 또는 merge
```

이 구조에서 에이전트끼리 자유롭게 shell을 공유하지 않는다. 각 단계는 필요한 artifact만 전달한다. planner는 요구사항과 계획을, 구현 agent는 diff를, reviewer는 검토 결과를 남긴다. 최종 merge 권한은 별도 승인 단계에 둔다.

## sandbox는 container 하나로 끝나지 않는다

Docker container는 편리한 격리 단위지만 기본 설정만으로 강한 보안 경계가 되지는 않는다. host socket을 mount하거나 privileged mode를 주면 container 내부 agent가 host를 사실상 제어할 수 있다. source directory 전체를 read-write로 공유하는 것도 다른 작업을 오염시킨다.

작업 worker에는 최소한 다음 제한이 필요하다.

- rootless 실행 또는 별도 비특권 사용자
- 읽기 전용 base image와 일회성 writable layer
- 작업별 새로운 checkout과 독립된 임시 디렉터리
- CPU, memory, process 수, disk, 실행시간 제한
- Linux capability 제거와 seccomp/AppArmor/SELinux 정책
- Docker socket과 host device 비노출
- 기본 차단 egress와 목적지 allowlist
- secret의 작업별 단기 발급과 실행 종료 즉시 폐기
- artifact 크기와 log 출력 제한

더 강한 경계가 필요하면 microVM, gVisor, Kata Containers 같은 선택지를 검토할 수 있다. 이들은 격리 강도를 높이는 대신 시작 시간, 운영 복잡도, 일부 workload 호환성 비용이 생긴다. 모든 작업에 가장 무거운 sandbox를 쓰기보다 위험 등급에 따라 실행 class를 나누는 방식이 현실적이다.

## 네트워크는 가장 자주 열리는 우회로다

코딩 agent는 dependency 설치와 문서 검색 때문에 인터넷 접근을 요구한다. egress를 완전히 막으면 빌드가 자주 실패하고, 모두 허용하면 소스와 secret 유출 경로가 된다.

중간 지점은 내부 mirror와 proxy다. package registry, container registry, OS repository를 내부 cache로 제공하고 worker는 해당 주소만 사용한다. 외부 문서가 필요하면 읽기 전용 fetch service가 URL 정책과 응답 크기를 검사해 전달할 수 있다. DNS와 HTTP 요청은 job ID와 함께 기록한다.

이 설계도 완벽하지 않다. 허용된 dependency의 install script가 악성일 수 있고, package 이름을 통한 dependency confusion도 가능하다. lockfile 고정, checksum 확인, artifact 서명, 신규 package 승인 정책을 함께 사용해야 한다.

## secret은 모델의 context에 넣지 않는다

에이전트가 cloud API key를 알아야 배포할 수 있다는 가정부터 의심해야 한다. 대부분의 build와 test에는 production credential이 필요 없다. 배포는 에이전트가 직접 실행하는 대신 검증된 pipeline을 trigger하고, pipeline이 별도 identity로 수행하게 만들 수 있다.

불가피한 secret은 다음 원칙을 따른다.

1. 저장소나 system prompt에 정적 key를 넣지 않는다.
2. job identity에 필요한 최소 scope만 부여한다.
3. 만료 시간이 짧은 token을 실행 직전에 발급한다.
4. log와 model context에서 값을 자동 redaction한다.
5. secret을 읽은 job의 network 목적지를 더 엄격히 제한한다.
6. 실행 후 token 폐기와 사용 내역 감사를 확인한다.

중요한 점은 redaction이 사후 필터일 뿐이라는 사실이다. 모델이 이미 secret을 읽었다면 다른 encoding이나 tool argument로 노출할 수 있다. 가장 안전한 secret은 agent가 볼 수 없는 secret이다.

## 여러 에이전트가 있다고 독립 검증이 되는 것은 아니다

구현 agent와 reviewer agent를 분리하면 한 모델이 자기 오류를 그대로 승인하는 위험을 줄일 수 있다. 하지만 같은 모델, 같은 system prompt, 같은 잘못된 문맥을 사용하면 두 agent가 동일한 실수를 반복할 수 있다. reviewer가 구현 설명을 먼저 읽으면 anchoring도 생긴다.

검토 단계는 가능한 한 독립적인 증거를 사용해야 한다.

- 요구사항 원문과 diff를 직접 비교한다.
- 구현 agent의 자신감보다 테스트 결과를 본다.
- 새 테스트가 변경 전에는 실패했는지 확인한다.
- 보안·dependency·라이선스 scan을 결정론적 도구로 수행한다.
- public API 변경과 migration을 별도 규칙으로 검사한다.
- 고위험 경로는 사람 reviewer를 강제한다.

에이전트 reviewer는 사람을 흉내 내는 마지막 관문이 아니라, 사람이 보기 전에 결함 후보를 압축하는 도구로 두는 편이 좋다.

## 테스트 통과가 충분하지 않은 이유

agent는 주어진 평가 함수에 맞춰 움직인다. "모든 테스트를 통과하라"만 주면 테스트를 약화하거나 문제 코드를 우회해도 목표를 달성한 것으로 해석할 수 있다. 기존 test suite가 요구사항을 충분히 표현하지 못할 수도 있다.

검증은 여러 층으로 구성해야 한다.

1. formatting, lint, type check
2. unit 및 integration test
3. 변경 전 실패·변경 후 성공하는 regression test
4. dependency와 secret scan
5. 성능 budget과 binary size 비교
6. API·schema backward compatibility
7. diff 범위와 금지 경로 변경 검사
8. 사람의 요구사항 검토

테스트 코드 수정 권한도 통제할 필요가 있다. 테스트 변경이 항상 나쁜 것은 아니지만, production code와 assertion을 동시에 바꾼 PR은 더 높은 review 등급으로 올려야 한다.

## 재시도는 품질 향상이 아니라 비용 증폭기가 될 수 있다

에이전트가 실패를 보고 스스로 수정하는 loop는 강력하다. 동시에 동일한 오류를 조금씩 바꾸며 수십 번 실행하는 runaway job을 만들 수 있다. 로컬 GPU는 계속 점유되고 외부 registry와 CI에도 부하를 준다.

작업별 budget을 명시해야 한다.

- 최대 model token 또는 inference 시간
- 최대 tool call과 test 실행 횟수
- 최대 wall-clock time
- 최대 생성 diff 크기
- 연속 동일 오류 횟수
- 외부 요청 수와 전송량

budget을 넘으면 더 큰 모델로 자동 전환하기보다 현재 상태, 시도한 방법, 실패 로그를 묶어 사람에게 escalation한다. 실패를 숨기고 새 agent를 계속 투입하면 원인 분석이 어려워진다.

## 관찰 가능성이 공장의 품질을 결정한다

일반 CI는 명령과 종료 코드가 중심이지만 agent workflow에는 결정 과정도 필요하다. 그렇다고 모든 chain-of-thought를 저장할 필요도, 저장하는 것이 적절하지도 않다. 대신 운영에 필요한 구조화된 사건을 남긴다.

- 입력 issue와 적용된 policy version
- 사용한 model과 설정, prompt template version
- checkout commit과 dependency lock hash
- 실행한 tool, 인자 요약, 시작·종료 시간, 종료 코드
- network destination과 secret scope
- 단계별 artifact와 최종 diff
- reviewer 판정과 사람 승인
- 취소, timeout, retry 이유

이 기록은 디버깅뿐 아니라 비용 계산과 incident 조사에 필요하다. 민감한 source 내용과 prompt를 무기한 저장하지 않도록 보존 기간과 접근 권한도 설정해야 한다.

## 비용 계산은 GPU 가격으로 끝나지 않는다

자체 호스팅 경제성을 비교할 때 흔히 API token 비용과 GPU 구매비만 본다. 실제 비교 단위는 채택된 작업 한 건당 총비용이어야 한다.

```text
총비용 = 추론 + worker compute + storage + network
       + 플랫폼 운영 + 사람 review + 실패 재작업 + 유휴 capacity
```

작은 모델은 저렴하고 빠르지만 복잡한 repository에서 실패율이 높을 수 있다. 큰 모델은 성공률이 높아도 GPU memory와 queue 비용이 커진다. 가장 비싼 모델을 모든 단계에 쓰기보다 작업 분류, 간단한 수정, 리뷰에 서로 다른 모델을 배치하고 실제 성공률을 측정하는 편이 낫다.

비교 지표에는 PR 생성 수보다 merge rate, revert rate, review time, production defect, issue lead time이 포함돼야 한다. 자동 생성된 PR이 많아졌는데 reviewer backlog가 두 배가 되면 공장의 throughput은 개선되지 않았다.

## 단계적으로 도입하는 방법

첫 단계는 읽기 전용 분석이다. agent가 issue를 분류하고 관련 파일과 예상 위험을 제안하되 코드를 쓰지 않는다. 이 단계에서 repository 이해도와 근거 링크 품질을 평가할 수 있다.

두 번째는 sandbox 안에서 patch를 만들지만 외부 write 권한은 주지 않는다. artifact로 diff와 테스트 결과만 내보낸다. 사람이 직접 branch에 적용한다.

세 번째는 bot 계정으로 PR 생성을 허용한다. branch protection, required check, CODEOWNERS를 그대로 유지하며 자동 merge는 금지한다.

네 번째에서만 위험이 낮고 반복적인 작업에 제한적 auto-merge를 검토한다. 변경 경로, diff 크기, test 종류, dependency 변경 여부를 기준으로 allowlist를 만든다. 언제든 feature flag로 전체 라인을 멈출 수 있어야 한다.

## 구축 전 실무 체크리스트

### 작업과 권한

- 자동화할 작업 유형과 제외 대상을 문서화했는가.
- 한 job의 입력, 산출물, 완료 조건이 명확한가.
- 모델과 worker가 production 권한을 직접 갖지 않는가.
- PR, merge, 배포 권한이 각각 분리돼 있는가.
- 고위험 경로에 사람 승인이 강제되는가.

### 격리와 공급망

- worker가 일회성이며 다른 job의 상태를 재사용하지 않는가.
- rootless, resource limit, syscall 정책을 적용했는가.
- Docker socket과 host credential을 노출하지 않았는가.
- egress가 기본 차단이고 registry가 allowlist로 관리되는가.
- lockfile, checksum, image signature를 검증하는가.
- model과 plugin 업데이트도 공급망 변경으로 감사하는가.

### 품질과 운영

- regression test가 변경 전 실패를 보여 주는가.
- agent가 test를 약화한 경우 별도 검토하는가.
- job별 시간·token·재시도 budget이 있는가.
- 모든 tool call과 artifact를 job ID로 추적할 수 있는가.
- 즉시 중단하는 kill switch와 queue drain 절차가 있는가.
- 성공률 외에 merge, revert, defect, review time을 측정하는가.

### 데이터와 비용

- source, prompt, log의 보존 기간이 정해졌는가.
- 민감정보가 model context와 log에 들어가지 않는가.
- tenant와 repository별 데이터 격리가 검증됐는가.
- 유휴 GPU와 플랫폼 인력까지 TCO에 포함했는가.
- 외부 API fallback 시 데이터 정책이 유지되는가.

## 결론

로컬 AI 에이전트로 소프트웨어 공장을 만드는 것은 기술적으로 가능한 구성이다. 자체 호스팅 추론 서버, queue, 일회성 worker, repository bot, CI를 연결하면 issue에서 검증된 patch까지 상당 부분 자동화할 수 있다. 그러나 "완전 자동 공장"이라는 표현은 현재 시스템의 불확실성을 가리기 쉽다.

자체 호스팅은 외부 전송 경계를 줄이지만 GPU 운영과 공급망 보안 책임을 조직 안으로 가져온다. sandbox는 위험을 제한하지만 호환성과 속도 비용을 만든다. 여러 agent의 리뷰는 결함을 줄일 수 있지만 독립된 테스트와 사람의 판단을 대체하지 않는다. 높은 자동화율보다 실패를 작게 가두고 증거를 남기는 능력이 중요하다.

가장 현실적인 목표는 사람 없는 공장이 아니다. 사람이 요구사항과 위험한 결정을 맡고, 에이전트가 반복 구현과 검증을 병렬로 처리하며, 정책 엔진과 sandbox가 권한을 통제하는 생산 라인이다. 첫 번째 성공 지표도 생성한 코드의 양이 아니라 채택된 변경의 lead time과 결함률이어야 한다.

## 참고 자료

- [Jake Saunders: Building an Almost Fully Self-Hosted, Sandboxed Agentic Software Factory](https://blog.jakesaunders.dev/building-an-almost-fully-self-hosted-sandboxed-agentic-software-factory/) — 작성 시점에 본문을 안정적으로 확인하지 못했으므로 구체적 구현 주장에는 사용하지 않았다.
- [Docker Docs: Security](https://docs.docker.com/engine/security/)
- [Kubernetes: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [NIST: Secure Software Development Framework](https://csrc.nist.gov/Projects/ssdf)
- [SLSA: Supply-chain Levels for Software Artifacts](https://slsa.dev/)
