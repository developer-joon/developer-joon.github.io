---
title: '클라우드 모델과 로컬 모델을 함께 쓸 때 라우팅 기준은 무엇이어야 하는가'
date: 2026-10-11 07:55:00 +0900
categories: ["AI 에이전트"]
description: 'GitHub Copilot CLI의 Ollama 모델 발견을 계기로 데이터 민감도, 작업 가역성, 지연시간, 비용, 도구 권한을 분리해 local/cloud routing matrix와 fallback, fail-closed, 결정 로그를 설계한다.'
featured_image: '/images/posts/2026-10-11-cloud-local-model-routing-criteria.png'
tags: [github-copilot-cli, ollama, local-llm, model-routing, privacy, fail-closed, observability]
---

![클라우드 모델과 로컬 모델의 정책 기반 라우팅](/images/posts/2026-10-11-cloud-local-model-routing-criteria.png)

GitHub Copilot CLI 1.0.94-0부터 실행 중인 로컬 Ollama의 지원 모델을 `/model` 화면에서 설정된 모델·Copilot 클라우드 모델과 함께 발견할 수 있다.[1] 같은 발표는 로컬 모델을 포함한 intelligent routing도 예고했지만, 시점은 “stay tuned”라고만 밝혔다.[1] **모델 발견이 출시됐다는 사실과 지능형 라우팅이 이미 제공된다는 주장은 다르다.**

여기서는 기존 멀티모델 글의 비용·품질 서열을 반복하지 않는다. **한 요청의 데이터가 어디로 이동하고, 어떤 결과가 실제 상태를 바꾸며, 선택한 모델에 어떤 도구가 연결되는가**를 다룬다.

`local`과 `cloud`는 안전 등급이 아니라 실행 위치다. 라우터는 데이터 민감도, 작업 가역성, 지연시간, 비용, 도구 권한을 각각 판정해야 한다. 정책을 만족하지 못하면 비슷한 모델로 fallback하지 말고 fail-closed해야 한다.

## 먼저 공식 사실과 운영 해석을 분리한다

### 공식 사실: Copilot CLI가 새로 제공하는 것

GitHub 발표가 확인한 범위는 좁다. 실행 중인 로컬 Ollama의 모델을 `/model`에 표시한다. Runtime과 모델 설치는 별도이며, 사용할 모델은 tool calling과 streaming을 지원해야 한다. 그렇지 않으면 CLI가 오류를 반환하고, GitHub는 최선의 결과를 위해 최소 128K context window를 권장한다.[1][2]

BYOK 문서는 `COPILOT_PROVIDER_BASE_URL`과 `COPILOT_MODEL`로 Ollama 같은 OpenAI-compatible endpoint를 연결하는 방식을 설명한다. 로컬 Ollama처럼 인증을 사용하지 않는 provider에는 API key가 필수가 아니다.[2] 이 사실은 설정이 간단하다는 뜻이지, endpoint 접근 통제가 자동으로 완성됐다는 뜻은 아니다.

Offline mode도 별도 설정이다. `COPILOT_OFFLINE=true`에서는 GitHub 인증 없이 설정된 BYOK provider에만 request를 보내고 telemetry를 끈다. 이를 켜지 않은 BYOK에서는 telemetry가 전송된다. Provider base URL이 원격이면 offline mode여도 prompt와 code context가 이동하므로, provider까지 같은 격리 환경에 있어야 air-gapped라고 할 수 있다.[2][3]

### 해석: 발견, 배치, 네트워크, 기록은 서로 다른 축이다

위 사실에서 얻을 수 있는 첫 번째 운영 해석은 다음 네 문장을 분리해야 한다는 것이다.

1. **모델이 로컬 목록에서 발견됐다.**
2. **추론 endpoint가 현재 기기 또는 사내망에 있다.**
3. **외부 network egress가 차단됐다.**
4. **telemetry와 transcript 같은 2차 기록이 남지 않는다.**

첫 문장은 나머지 세 문장을 보장하지 않는다. `localhost`에 모델이 있어도 CLI가 offline mode가 아니면 telemetry 경로가 남을 수 있고,[3] 선택한 provider가 원격 OpenAI-compatible gateway를 가리킬 수도 있다.[2] 반대로 사내 GPU cluster는 노트북 밖에 있어도 정책상 허용된 private placement일 수 있다. 라우팅 정책은 `local | cloud`가 아니라 `endpoint_zone`, `egress_policy`, `telemetry_mode`, `retention_contract`로 쪼개야 한다.

### 운영 제안: 모델 이름보다 route bundle을 등록한다

등록 단위는 모델 하나가 아니라 다음 **검증된 route bundle**이다. GitHub나 Ollama의 표준 schema가 아닌 조직의 운영 계약이다.

```yaml
route_id: local-ollama-qwen-readonly-v3
placement:
  endpoint_zone: developer_device
  base_url_class: loopback_only
  offline_required: true
  telemetry: disabled
model:
  provider: ollama
  name: qwen3-coder
  digest: <ollama-api-digest>
  context_limit: <verified_context_limit>
capabilities:
  streaming: true
  tool_calling: true
authority:
  tools: [read_repo, search_docs]
  filesystem: read_only
  network: deny
  external_write: deny
budgets:
  deadline_ms: 45000
  max_input_tokens: 90000
  max_output_tokens: 6000
policy_version: route-policy-17
```

Ollama model 목록 API는 이름, digest, 크기, format, family, parameter size, quantization level을 반환한다.[8] 이름뿐 아니라 digest를 decision log에 남긴다. Digest는 실행 artifact 식별자이지 provenance·license·안전 인증은 아니다.

## 로컬 모델은 자동으로 안전하지 않다

“데이터가 로컬에 있으니 안전하다”는 말은 위협 모델을 생략한다. 추론 위치만 보면 다음 경로를 놓친다.

### 1. 로컬 endpoint도 노출될 수 있다

Ollama는 기본적으로 `127.0.0.1:11434`에 bind하지만 `OLLAMA_HOST`로 주소를 바꿀 수 있고, FAQ는 `0.0.0.0:11434` 예시도 제공한다.[7] 인증 없는 로컬 Ollama에는 API key가 필수가 아니다.[2] 따라서 server를 전체 interface에 열고 network control을 두지 않으면 다른 host도 접근할 수 있다. 이는 취약성 주장이 아니라 **bind 범위와 인증·방화벽을 별도로 검증해야 한다**는 운영 해석이다.

### 2. 로컬 추론도 도구를 통해 외부 효과를 만든다

Ollama는 function calling을 지원하며 모델이 tool call을 반환하고 application이 그 결과를 다시 대화에 넣는 흐름을 공식 문서로 제공한다.[5] Streaming에서도 tool call chunk를 감지해 도구를 실행하고 그 결과를 다음 요청에 포함할 수 있다.[6] 즉 weights와 inference가 로컬이어도 연결된 shell, browser, database, GitHub, cloud credential이 외부 effect를 만들 수 있다.

`delete_file`이나 `deploy_prod`를 호출할 수 있는지는 모델 위치가 아니라 harness의 authorization이 결정해야 한다. Copilot CLI도 `--available-tools`, `--allow-tool`, `--deny-tool`, `--allow-url`, `--deny-url`로 도구와 실행 허가를 제한한다.[4] `--allow-all`은 모든 tool·path·URL permission을 허용하므로 local route의 기본값으로 삼아서는 안 된다.[4]

### 3. 로컬 장비의 기록도 유출면이다

Prompt를 외부 provider로 보내지 않는 것과 prompt가 disk·session transcript·log에 남지 않는 것은 다르다. Copilot CLI의 `--share`는 transcript를 파일로 내보내며, 공식 reference도 민감 정보가 포함될 수 있다고 경고한다.[4] 로컬 route도 application과 model server의 retention을 확인해야 한다.

따라서 “로컬 모델이니 민감 데이터 허용”이 아니라 다음 조건문이 맞다.

```text
민감 데이터 허용 =
  승인된 endpoint zone
  AND 외부 egress 차단
  AND telemetry 정책 충족
  AND prompt/transcript 보존 정책 충족
  AND 필요한 tool만 최소 권한으로 연결
  AND 승인된 model artifact 식별
```

하나라도 `unknown`이면 허용으로 간주하지 않는다.

## 라우팅의 다섯 기준

아래부터는 공식 제품 설명이 아니라 운영 설계 제안이다. 핵심은 다섯 점수를 합산해 가장 높은 모델을 고르는 것이 아니다. **민감도와 권한은 hard constraint로, 지연시간과 비용은 그 안에서 최적화 변수로** 취급한다.

### 1. 데이터 민감도: prompt만 보지 말고 context의 합집합을 본다

라우터 입력에는 repository file, terminal output, environment variable 이름, stack trace, retrieval 문서, tool 결과, 이전 대화도 합쳐진다. 각각 평범해도 결합하면 고객 identity나 미공개 취약점을 드러낼 수 있다.

민감도는 예를 들어 네 등급으로 나눌 수 있다.

| 등급 | 예시 | 허용 placement |
|---|---|---|
| D0 Public | 공개 문서, 공개 OSS 코드 | 승인된 local 또는 cloud |
| D1 Internal | 사내 coding convention, 미공개 일반 코드 | 계약된 cloud 또는 관리형 local |
| D2 Restricted | 고객 데이터, 미공개 취약점, credential 인접 정보 | egress 차단 local/on-prem 우선 |
| D3 Prohibited | secret 원문, 규제로 model 입력 금지된 데이터 | 어떤 모델에도 전달 금지 |

여기서 D3를 local로 보내는 것은 해결책이 아니다. 먼저 redact, tokenize, structured lookup으로 바꿔야 한다. Route 선택 뒤 tool이 더 민감한 데이터를 반환하면 재분류하며, 첫 prompt의 등급을 session 전체에 고정하지 않는다.

### 2. 작업 가역성: 답변과 실제 변경을 분리한다

같은 “코드 작업”도 effect가 다르다.

- **A0 Read**: 설명, 검색, 요약
- **A1 Draft**: patch 후보 생성, 아직 적용 안 함
- **A2 Reversible write**: branch·임시 worktree·staging 환경 변경
- **A3 External write**: issue 작성, 메시지 전송, API mutation
- **A4 Destructive/regulated**: production 배포, 데이터 삭제, IAM 변경

A0와 A1은 결과를 거부할 수 있지만 A3와 A4는 전달된 메시지, 변경된 권한, 삭제된 데이터의 복구 문제다. 가역성이 낮을수록 모델 선택보다 approval, idempotency, dry-run, transaction boundary가 우선한다.

### 3. 지연시간: TTFT와 완료 시간을 작업 종류별로 본다

대화형 설명은 첫 token 지연이, repository 분석은 완료 시간과 tool round trip이 중요하다. 로컬 모델도 model load, GPU contention, 긴 context prefill 때문에 항상 빠르지는 않다.

Route별로 최소한 `time_to_first_token`, `tokens_per_second`, `tool_round_trip`, `end_to_end_p95`, `cold_load`를 실제 workload에서 측정한다. deadline이 5초인 completion과 10분인 background refactor에 같은 임계값을 쓰지 않는다.

### 4. 비용: token 단가가 아니라 제한 조건을 통과한 route끼리 비교한다

D2 데이터를 내보낼 수 없거나 A4 권한을 부여할 수 없다면 저렴한 cloud route도 후보가 아니다. Hard constraint를 통과한 후보끼리 marginal cloud charge와 local GPU 점유, 전력, queue opportunity cost를 비교한다.

로컬 비용을 0원으로 기록하면 GPU 포화와 대기시간이 보이지 않고, cloud 비용을 token bill로만 기록하면 계약·audit 비용이 빠진다. `inference_charge`, `local_compute_seconds`, `queue_delay`, `human_approval_time`을 분리해 기록한다.

### 5. 도구 권한: 모델보다 먼저 route를 제한한다

모델이 사용할 tool set은 라우팅의 부속 옵션이 아니라 독립 입력이다. 같은 prompt라도 `read_repo`만 있으면 A0이지만 `shell`, `write`, `url`, MCP mutation tool이 붙으면 위험 등급이 달라진다. Copilot CLI reference가 tool의 availability와 permission을 별도 옵션으로 나눈 것처럼, 모델에게 보이는 도구와 실행 가능한 도구를 구분해야 한다.[4]

권장 순서는 다음과 같다.

```text
요청 분류
  -> 데이터 정책으로 가능한 placement 계산
  -> effect class로 가능한 authority profile 계산
  -> 두 집합의 교집합에 등록된 route bundle만 후보화
  -> latency SLO를 만족하는 후보 필터
  -> 마지막에 비용으로 선택
```

비용이 첫 기준이 되지 않도록 이 순서를 정책 엔진에 고정한다.

## 실제 routing matrix

다음 표의 값은 조직 정책에 맞게 바꿔야 한다. `Local`은 loopback 또는 승인된 on-prem endpoint, offline/telemetry 조건, model digest, tool profile이 검증된 route bundle이다.

| 작업 | 데이터 | 가역성·권한 | 우선 route | fallback | 차단 조건 |
|---|---|---|---|---|---|
| 공개 API 문서 요약 | D0 | A0, read only | 빠른 local | 승인 cloud | 둘 다 context 한도 미달 |
| 공개 OSS 오류 설명 | D0 | A0, repo read | latency SLO를 만족하는 최저비용 route | 다른 zone route | 필요한 tool capability 없음 |
| 사내 코드 patch 초안 | D1 | A1, isolated worktree | 관리형 local | 계약된 cloud | D1 cloud 계약·retention 미확인 |
| 고객 incident log 분석 | D2 | A0, network deny | egress 차단 local/on-prem | **없음** | local capacity·model 미가용 |
| dependency 최신 정보 조회 | D1 | A0 + allowlisted URL | 계약된 cloud 또는 network-enabled local | read-only 대체 route | URL allowlist 불일치 |
| branch에 patch 적용 | D1 | A2, write 제한 | 검증된 coding route + sandbox | 동일 권한 profile의 다른 모델 | test·base revision 확인 실패 |
| GitHub issue 생성 | D1 | A3, external write | 어느 모델이든 draft까지만 | 사람 승인 뒤 executor | 승인 payload와 실제 payload 불일치 |
| production DB 삭제 | D2 | A4, destructive | 자동 route 없음 | 없음 | 항상 change procedure로 이관 |
| secret 원문 분류 | D3 | 입력 금지 | 모델 호출 없음 | deterministic scanner | prompt에 secret 포함 |

핵심은 D2 요청에서 local model이 내려가도 cloud로 fallback하지 않는 것이다. 반면 D0 read-only는 데이터·effect 경계가 유지되는 cloud fallback을 허용할 수 있다.

## Fallback은 모델 목록이 아니라 보장 관계다

`local-small → cloud-large → 아무 응답 가능한 모델` 순서는 위험하다. Fallback은 품질뿐 아니라 데이터 처리자, network path, telemetry, retention, context 한도, tool-call 형식, 권한 profile도 바꿀 수 있다.

Fallback edge는 다음 조건을 모두 만족할 때만 등록한다.

1. 대상 route의 data policy가 원래 route와 같거나 더 엄격하다.
2. tool set과 실행 권한이 같거나 더 좁다.
3. 필요한 streaming·tool calling·context capability가 검증됐다.[2]
4. deadline과 budget 안에서 시도할 가치가 있다.
5. 동일한 output validator와 effect gate를 통과한다.
6. route 변경 사실을 사용자와 decision log에 남긴다.

```text
허용:
  local-readonly-D1 -> contracted-cloud-readonly-D1
  cloud-public-read -> local-public-read

금지:
  isolated-local-D2 -> public-cloud-D0
  read-only-route -> allow-all-tools-route
  pinned-model-digest -> 이름만 같은 미검증 artifact
```

오류 원인도 구분한다. Local server connection failure와 GPU OOM은 다른 route를 검토할 수 있다. 반면 policy mismatch, D3 탐지, 승인 없는 external write, model digest 불일치는 재시도로 고쳐지지 않는다. 이런 오류를 `retryable=false`로 표시하지 않으면 시스템은 금지된 route를 계속 탐색하게 된다.

## Fail-closed가 필요한 순간

Fail-closed는 실패를 떠넘기는 것이 아니라 **보장을 유지할 대체 경로가 없을 때 성공처럼 진행하지 않는 것**이다. 다음 조건에서는 중단이 맞다.

- D2 이상인데 승인된 private route가 없다.
- offline이 필수인데 effective 설정과 network policy를 확인할 수 없다.
- telemetry/retention 상태가 `unknown`이다.
- 요청한 model name은 같지만 승인 digest와 다르다.
- tool calling이 필요한데 선택 모델에서 검증되지 않았다.
- 요청은 read-only인데 effective tool profile에 write가 포함됐다.
- external write 승인 뒤 target, arguments, revision이 바뀌었다.
- fallback이 provider zone이나 data contract를 완화한다.
- context truncation으로 필수 정책 문서나 승인 범위가 빠졌다.

중단 메시지도 “모델을 사용할 수 없음”보다 구체적이어야 한다.

```json
{
  "status": "blocked",
  "reason_code": "NO_ROUTE_PRESERVES_DATA_POLICY",
  "data_class": "D2",
  "required": ["private_endpoint", "egress_deny", "telemetry_disabled"],
  "available_routes": ["cloud-public-v5"],
  "safe_next_actions": ["redact_input", "wait_for_local_capacity", "request_policy_review"]
}
```

Redaction 뒤 재분류하거나 local capacity를 기다리거나 정책 예외 절차로 이동하게 한다. 대화창의 즉석 동의를 규제·계약 정책의 대체물로 삼지 않는다.

## 관측 가능한 결정 로그를 남긴다

`model=ollama/qwen`만으로는 선택 이유를 알 수 없다. 입력 분류, 제외 후보, 정책, fallback 이유를 재구성하되 prompt와 code 원문을 중앙 log에 복제하지 않는다.

권장 decision event는 다음과 같다. 이것 역시 조직 확장 schema다.

```json
{
  "decision_id": "rtd_01J...",
  "trace_id": "tr_01J...",
  "policy_version": "route-policy-17",
  "request": {
    "data_class": "D2",
    "action_class": "A0",
    "latency_slo_ms": 60000,
    "context_tokens_estimate": 42000
  },
  "authority": {
    "available_tools_hash": "sha256:...",
    "effective_profile": "repo-read-network-deny-v4"
  },
  "candidates": [
    {"route_id": "local-qwen-read-v3", "result": "selected"},
    {"route_id": "cloud-coding-v5", "result": "rejected", "reason": "DATA_ZONE_MISMATCH"}
  ],
  "selected": {
    "endpoint_zone": "developer_device",
    "model_digest": "sha256:...",
    "offline_effective": true,
    "telemetry_effective": "disabled"
  },
  "fallback": {"attempt": 0, "allowed_edges": []},
  "payload": {
    "prompt_hash": "sha256:...",
    "content_stored": false
  },
  "outcome": "completed"
}
```

반드시 남길 값은 `policy_version`, 분류 결과, effective 권한, 후보별 거절 이유, endpoint zone, model artifact 식별자, offline/telemetry의 **effective state**, fallback 횟수, 최종 outcome이다. 사용자가 의도한 requested state만 남기지 않는다. 환경변수를 설정했다는 사실보다 실제 process가 읽은 설정과 network enforcement 결과가 중요하다.

반대로 기본 log에서 빼야 할 것은 prompt 원문, 전체 source code, secret 값, tool output 전문이다. 필요하면 data class별로 암호화된 제한 저장소와 짧은 보존 기간을 따로 둔다. Copilot CLI가 JSONL output과 session transcript를 제공한다는 사실은 audit에 유용할 수 있지만, transcript 자체에 민감 정보가 들어갈 수 있다는 공식 경고를 함께 적용해야 한다.[4]

관측 지표도 local/cloud 사용 비율에서 끝내지 않는다.

- `no_eligible_route`와 data class별 egress 거절
- fallback 보장 동등성 검사 거절
- route별 cold load, TTFT, end-to-end p95
- local OOM·queue saturation, cloud rate limit
- tool profile mismatch, 승인 payload drift, model digest 변경
- route별 validator 실패와 사람 반려

이 값이 있어야 “local이 느려 cloud 비율을 높이자” 같은 제안이 D2 traffic을 침범하는지 알 수 있다.

## 도입 순서: 자동 라우팅보다 정책 라우팅이 먼저다

처음에는 classifier 대신 audit 가능한 명시적 규칙으로 시작한다.

1. **Route inventory**: endpoint, provider, model digest, context, tool calling, streaming, egress, telemetry, retention, tool profile을 등록한다.
2. **Hard policy**: D3 model-input 금지, D2 private-only, A4 자동 실행 금지처럼 예외 없는 규칙을 코드화한다.
3. **Static matrix**: repository, task type, data label로 결정론적 route를 선택한다.
4. **Shadow decision**: 실제 실행 route는 유지하고 새 라우터의 선택·거절 이유만 기록한다.
5. **Read-only canary**: D0/D1의 A0부터 local/cloud 자동 선택을 연다.
6. **Draft 확대**: A1 patch 후보까지 허용하되 적용은 분리한다.
7. **Reversible write**: isolated worktree, validator, 사람 승인 조건에서 A2를 연다.
8. **외부 write 유지**: A3/A4는 모델 route와 별도의 effect gate를 유지한다.

정책과 authority profile 변경도 model version처럼 canary하고 rollback해야 한다. 같은 model이라도 D1 cloud 범위나 network tool을 넓히면 보장이 달라진다.

## 결론

GitHub Copilot CLI의 Ollama model discovery는 로컬과 클라우드 모델을 같은 workflow에서 선택하기 쉽게 만든다.[1] 하지만 발견은 routing policy가 아니며, local provider 선택은 offline mode나 telemetry 차단을 자동으로 뜻하지 않는다.[2][3] Intelligent routing도 발표 시점에는 예고됐을 뿐 가용 기능으로 단정할 수 없다.[1]

운영에서는 데이터 민감도로 처리 위치를, 작업 가역성과 tool authority로 effect를 제한한다. 그 교집합에서 latency SLO를 충족한 뒤 비용을 최적화한다. 순서를 뒤집으면 싼 route와 “로컬” label이 정책 예외를 만든다.

좋은 hybrid router는 매번 가장 강한 모델을 고르는 시스템이 아니다. 왜 이 데이터가 이 endpoint로 갔는지, 왜 이 모델에는 이 도구만 보였는지, 왜 fallback을 거절했는지 설명할 수 있는 시스템이다. 그리고 보장을 유지할 경로가 없을 때는 더 느리거나 덜 편리하더라도 멈춘다. Local과 cloud를 함께 쓰는 운영의 핵심은 선택지의 확대가 아니라 **위치·네트워크·기록·권한을 분리한 뒤, 그 경계를 보존하는 선택만 허용하는 것**이다.

## Sources

[1] https://github.blog/changelog/2026-10-07-discover-local-models-in-github-copilot-cli/
[2] https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models
[3] https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli
[4] https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference
[5] https://docs.ollama.com/capabilities/tool-calling
[6] https://docs.ollama.com/capabilities/streaming
[7] https://docs.ollama.com/faq
[8] https://docs.ollama.com/api/tags
