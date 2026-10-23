---
title: 'Dependabot 경고의 404와 410 Gone은 왜 다른가'
date: 2026-10-23 09:00:10 +0900
categories: ["개발/보안"]
description: '철회된 Dependabot 경고를 410 Gone과 withdrawn webhook으로 식별하고, 보안 데이터 레이크와 티켓 동기화에서 tombstone·race·idempotency를 안전하게 다루는 방법을 설계한다.'
featured_image: 'https://picsum.photos/seed/dependabot-withdrawn-alert-410-gone/1600/900'
tags: [github, dependabot, security-alert, webhook, rest-api, 410-gone, tombstone, idempotency]
---

![고층 빌딩 사이로 내려다본 넓은 도심 공원과 빽빽한 도시 전경](https://picsum.photos/seed/dependabot-withdrawn-alert-410-gone/1600/900)

Dependabot 경고를 보안 데이터 레이크나 이슈 트래커로 복제하는 팀은 보통 `open`, `dismissed`, `fixed` 같은 상태를 저장한다. 그런데 어제까지 있던 경고를 오늘 단건 조회했더니 `404 Not Found`가 나오면 어떻게 해야 할까. 원본에서 사라졌다는 이유로 내부 행과 티켓을 지우면 감사 이력도 함께 사라진다. 반대로 계속 열린 취약점으로 남기면 더는 유효하지 않은 advisory 때문에 잘못된 대응을 이어 간다.

GitHub는 2026년 10월 13일 철회된 Dependabot 경고를 구분하는 두 신호를 추가했다. `dependabot_alert` webhook에는 `withdrawn` action이 생겼고, 철회된 경고의 조회·수정 요청은 기존 `404` 대신 `410 Gone`을 반환한다. 이 변경은 github.com의 모든 repository에 제공되며 GitHub Enterprise Server 3.24에 포함될 예정이다.[1]

핵심은 HTTP 상태 코드 개론이 아니다. 여기서 `410`은 **Dependabot의 철회된 개별 alert를 get 또는 update할 때의 제품 계약**이다. 모든 GitHub resource의 삭제, 모든 `404`의 영구 부재, 또는 모든 advisory 철회를 같은 규칙으로 해석해서는 안 된다. 이 글은 정확히 이 경계 안에서 webhook과 REST 동기화가 경고의 부재를 어떻게 보존해야 하는지 다룬다.

## `fixed`, `dismissed`, `withdrawn`은 서로 다른 결론이다

`fixed`는 manifest 변경으로 취약한 dependency가 제거된 경우다. `dismissed`는 사용자가 위험 수용, 허용된 위험 등 판단을 내려 경고를 닫은 경우다. 반면 `withdrawn`은 그 경고를 만든 advisory 또는 vulnerable version range가 더는 유효하지 않아 Dependabot이 경고를 철회하고 제거한 경우다. 공식 webhook 문서도 이 action의 payload가 다른 action의 전체 alert 표현이 아니라, 삭제 전에 캡처한 식별자 집합이라고 명시한다.[2]

세 상태를 모두 `closed`로 접으면 운영 질문에 답할 수 없다.

- 패치 때문에 닫혔는가, 사람이 위험을 수용했는가, 원본 주장이 철회됐는가.
- 연결된 remediation ticket의 완료 사유는 무엇인가.
- SLA 위반 통계에서 제외할 근거는 무엇인가.
- 과거 snapshot을 재처리할 때 왜 현재 API에서 상세 정보가 나오지 않는가.

따라서 외부 표시용 `closed=true`가 필요하더라도 원인 상태를 별도 열로 보존한다. 이 글에서 쓰는 `open`, `resolved`, `dismissed`, `withdrawn`, `missing`은 **GitHub API가 정의한 enum이 아니라 내부 동기화 모델**이다. 특히 REST 목록 필터의 실제 state에는 `open`, `dismissed`, `fixed`, `auto_dismissed`가 쓰인다.[3] 내부의 `resolved`는 GitHub `fixed` 등을 업무 시스템의 완료 상태로 정규화한 이름이고, `missing`은 결론을 아직 내릴 수 없는 관측 상태다.

## 404와 410을 같은 삭제로 처리하지 않는다

GitHub 발표의 변화는 좁지만 유용하다. 이미 철회된 alert number를 단건 조회하거나 수정하면 `410 Gone`이므로 “그 번호의 경고가 철회됐다”는 tombstone을 만들 수 있다. 반면 `404 Resource not found`만으로는 철회를 확정하지 않는다. 번호가 존재하지 않거나 repository 식별자가 틀렸거나, 호출 주체가 필요한 대상을 보지 못하는 상황을 먼저 분리해야 한다. Dependabot alert REST endpoint의 권한과 token 종류도 범위별로 다르다.[3]

동기화 결과를 다음처럼 나누면 원인을 잃지 않는다.

| 관측 | 내부 판정 | 자동 조치 |
|---|---|---|
| 단건 GET `200` | 응답 state에 맞춰 `open`·`resolved`·`dismissed` | 상세 snapshot 갱신 |
| 단건 GET 또는 PATCH `410` | `withdrawn` | tombstone 생성, ticket을 철회 사유로 종결 |
| 단건 GET `404` | `missing` | 삭제 금지, repository·권한·번호 확인 후 재시도 |
| 목록 snapshot에서만 사라짐 | `missing_candidate` | 다음 완전 동기화까지 보류 |
| `403` | `access_error` | 권한·policy 오류로 격리 |
| `409`·`422` | `write_conflict`·`validation_error` | lifecycle 변경 없이 요청 조사 |

`missing_candidate`, `access_error`, `write_conflict`도 이 글이 제안하는 내부 label이다. 특히 목록에서 안 보인다는 사실을 `withdrawn`으로 바꾸지 않는다. Cursor 누락, filter 변경, 권한 축소, repository 이전, 일시적인 수집 실패가 같은 모양을 만들 수 있다. 철회를 확정하는 근거는 `withdrawn` webhook 또는 해당 개별 Dependabot alert endpoint의 `410`이다.

## 행 삭제 대신 tombstone을 남긴다

철회는 데이터가 불필요해졌다는 뜻이 아니다. 오히려 “왜 활성 경고가 사라졌는가”를 설명하는 최소 증거가 필요해진다. 권장 primary key는 repository 이름 문자열이 아니라 안정적인 repository ID와 alert number의 조합이다. GHSA ID 하나만 key로 쓰면 같은 advisory가 여러 repository, package, manifest에 만든 alert를 합쳐 버린다.

다음은 **조직 내부 저장 형식 예시**다. GitHub webhook의 공식 schema가 아니며, `lifecycle`, `terminal_reason`, `observed_via`, 중첩된 `github_identifiers`와 그 안의 `ghsa_id`까지 모두 내부 저장 field다. 수집기는 공식 payload에서 받은 식별자를 이 구조로 복사하지만, 같은 이름과 위치의 GitHub API field가 있다고 가정해서는 안 된다.

```json
{
  "source": "github_dependabot",
  "repository_id": 123456789,
  "alert_number": 42,
  "lifecycle": "withdrawn",
  "terminal_reason": "source_advisory_or_range_withdrawn",
  "github_identifiers": {
    "ghsa_id": "GHSA-xxxx-yyyy-zzzz",
    "cve_id": "CVE-2099-0001",
    "ecosystem": "npm",
    "package_name": "example-package",
    "manifest_path": "package-lock.json"
  },
  "observed_via": ["api_410", "webhook_withdrawn"],
  "withdrawn_observed_at": "2099-01-02T03:04:05Z",
  "last_full_snapshot_ref": "sha256:<internal-snapshot-digest>"
}
```

`withdrawn_observed_at`은 GitHub가 발생 시각으로 제공한다고 가정한 값이 아니라 **수집기가 철회를 관측한 내부 시각**이다. Payload의 식별자는 삭제 전 매칭을 위한 것이므로 full alert snapshot처럼 덮어쓰지 않는다. GitHub 발표가 예로 드는 alert number, GHSA·CVE ID, package, manifest path를 기존 레코드와 연결하는 데 쓰고, 과거 severity·dismissal comment·assignee를 빈 값으로 덮지 않는다.[1]

Tombstone에는 원본 full payload 전체를 무기한 복제할 필요도 없다. 내부 보존 정책에 맞춰 identity, 철회 근거, 최초·최종 관측 시각, 마지막 정상 snapshot pointer, 연결된 ticket ID를 남긴다. 민감한 private repository 이름이나 manifest path를 중앙 데이터 레이크에 둘 수 있는지도 별도 접근 정책으로 정한다.

## webhook과 API 사이에는 race가 생긴다

Webhook을 받자마자 API를 다시 조회하는 구현은 평소에는 편하다. 그러나 `withdrawn` action은 alert가 제거된 뒤 식별자를 전달하는 사건이다. 따라서 webhook consumer가 단건 GET을 호출해 `410`을 받는 것은 enrichment 실패가 아니라 예상 가능한 확인 결과다. Full object를 가져오지 못했다고 event를 재시도 큐에 영원히 넣으면 정상 철회를 장애로 오인한다.

반대 순서도 가능하다. Poller가 먼저 `410`을 보고 tombstone을 만든 뒤 webhook이 도착할 수 있다. 또는 poll 시작 때 받은 오래된 `200` 응답이 queue 지연 때문에 `withdrawn` event보다 늦게 적용될 수 있다. 안전한 reducer는 도착 순서를 진실 순서로 믿지 않고 다음 우선순위를 둔다.

```text
withdrawn webhook 또는 개별 alert API 410
  > 같은 alert에 대한 일반 snapshot 200
  > 목록에서의 단순 부재
```

이 우선순위는 모든 GitHub event에 적용하는 보편 규칙이 아니다. 이 글의 Dependabot withdrawn tombstone에만 둔 단조 전이 규칙이다. `withdrawn`을 terminal로 정한 뒤에는 늦은 polling snapshot이 `open`으로 되살리지 못하게 한다. 만약 GitHub가 이후 같은 dependency에 새 경고를 만든다면 새 alert number를 별도 identity로 수집한다. 기존 tombstone을 수정해 재개장하는 대신 새 원본 레코드와 필요하면 내부 correlation을 만든다.

작은 reducer는 다음처럼 쓸 수 있다.

```js
function reduceDependabotAlert(current, observation) {
  if (observation.kind === 'withdrawn_webhook' ||
      observation.kind === 'api_410') {
    return {
      ...current,
      lifecycle: 'withdrawn',
      withdrawnObservedAt:
        current.withdrawnObservedAt ?? observation.receivedAt,
      observedVia: [...new Set([
        ...(current.observedVia ?? []),
        observation.kind,
      ])],
    };
  }

  if (current.lifecycle === 'withdrawn') return current;
  if (observation.kind === 'api_200') {
    return {...current, ...observation.normalizedAlert};
  }
  return current;
}
```

이 예시는 signature 검증, persistence transaction, schema validation을 생략한 핵심 전이만 보여 준다. `receivedAt`은 수집기 시각이고, REST 응답의 field를 그대로 spread하지 말고 허용한 `normalizedAlert`만 전달한다. 무엇보다 terminal check와 upsert가 하나의 database transaction 안에서 실행돼야 한다. 두 worker가 동시에 같은 alert를 처리할 때 read-then-write 사이가 벌어지면 늦은 `200`이 tombstone을 덮을 수 있다.

## delivery ID와 alert identity는 역할이 다르다

GitHub webhook은 `X-GitHub-Delivery`에 delivery를 식별하는 GUID를 보낸다.[4] Receiver는 실제로 받은 이 값을 inbox idempotency key로 저장하되, 별도 근거 없이 수동 redelivery가 원래 값과 같다고 가정하지 않는다. Delivery ID를 alert의 primary key로 써서도 안 된다. 같은 alert의 `created`, `dismissed`, `withdrawn` action은 서로 다른 사건이다.

권장 key는 두 층이다.

```text
webhook inbox dedupe key
  = hook installation scope + X-GitHub-Delivery

alert projection key
  = repository_id + alert_number
```

Receiver는 먼저 raw body에 대해 `X-Hub-Signature-256`을 검증하고, event가 `dependabot_alert`인지와 action이 무엇인지 확인한다. 그다음 delivery key를 unique constraint가 있는 inbox에 넣고 queue에 넘긴 뒤 빠르게 `2XX`를 반환한다. GitHub는 webhook endpoint가 10초 안에 `2XX`로 응답할 것을 권장하며, event type은 `X-GitHub-Event`, action은 payload의 최상위 `action`으로 확인하라고 안내한다.[4]

아래 SQL은 제품 schema가 아니라 최소 내부 예시다.

```sql
CREATE TABLE webhook_inbox (
  hook_scope TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  action_name TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  PRIMARY KEY (hook_scope, delivery_id)
);

CREATE TABLE dependabot_alert_projection (
  repository_id INTEGER NOT NULL,
  alert_number INTEGER NOT NULL,
  lifecycle TEXT NOT NULL CHECK (
    lifecycle IN ('open', 'resolved', 'dismissed', 'withdrawn', 'missing')
  ),
  tombstone_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repository_id, alert_number)
);
```

동일 delivery가 다시 오면 payload digest가 같은지 확인하고 이미 처리됐다면 성공 응답만 돌려준다. 같은 delivery ID인데 digest가 다르면 조용히 overwrite하지 않고 보안 오류로 격리한다. 반대로 delivery가 다르더라도 동일 alert에 `withdrawn`이 반복 관측되면 tombstone upsert는 같은 결과를 내야 한다. 즉 inbox idempotency와 projection idempotency를 둘 다 시험한다.

## 티켓도 “삭제”가 아니라 철회 사유로 닫는다

동기화 대상이 Jira나 사내 remediation system이면 `withdrawn`을 “fixed” resolution으로 보내지 않는다. 패치를 적용하지 않았는데 fixed 통계가 올라가기 때문이다. 내부 ticket resolution에 `upstream_withdrawn` 같은 별도 값을 두고, 이것도 GitHub field가 아니라 조직 mapping임을 문서화한다.

권장 전이는 다음과 같다.

```text
open alert
  → ticket open
  → withdrawn 관측
  → ticket resolution = upstream_withdrawn
  → alert tombstone과 ticket link 보존
```

이미 `dismissed` 또는 `resolved`였던 alert가 나중에 철회돼도 과거 결정을 삭제하지 않는다. Projection의 현재 lifecycle은 `withdrawn`으로 바꾸되 history에는 `dismissed → withdrawn` 또는 `resolved → withdrawn` sequence를 남긴다. 그래야 “우리의 조치로 닫힌 시점”과 “원본 advisory가 무효화된 시점”을 구분할 수 있다.

Ticket API 호출도 outbox pattern으로 분리하는 편이 안전하다. 같은 `(repository_id, alert_number, target_system, desired_resolution)`에 unique key를 두고, 외부 호출 성공 뒤 remote ticket을 다시 읽어 실제 resolution을 확인한다. Webhook redelivery 때 comment가 여러 번 달리거나 ticket이 반복 close되는 것을 막기 위해서다. 철회 후 ticket을 자동 삭제하는 동작은 금지한다. 감사와 비용 지표에는 “작업이 필요 없어진 경고” 자체도 중요한 사실이다.

## 완전 동기화는 부재를 확정하는 작업이 아니다

정기 poll은 webhook 손실을 보완하지만, list endpoint의 현재 결과만으로 철회를 복원할 수 있다고 가정하면 안 된다. Withdrawn alert는 제거되므로 목록에서 사라진 하나의 번호가 왜 사라졌는지는 list diff만으로 확정할 수 없다. 차이를 발견하면 각 candidate에 단건 GET을 실행하고 `410`일 때만 철회 tombstone으로 승격한다.

다만 과거에 수집하지 않았던 경고는 alert number 자체를 모를 수 있다. 그러므로 webhook 보존 기간과 수집기 outage가 겹치면 영구적인 관측 공백이 남을 수 있다. 운영상 다음 수치를 따로 본다.

- `withdrawn_webhook_count`: webhook으로 직접 확인한 철회 수
- `api_410_count`: 단건 API에서 확인한 철회 수
- `missing_candidate_count`: list diff 뒤 아직 원인을 확정하지 못한 수
- `duplicate_delivery_count`: inbox unique key로 제거한 재전송 수
- `late_snapshot_suppressed_count`: tombstone 이후 거부한 오래된 `200` 수
- `ticket_reconciliation_error_count`: 외부 ticket 상태가 목표와 다른 수

이 이름들도 내부 metric이다. `missing_candidate_count`를 withdrawn count에 합치지 않고, 0이 아닌 상태가 일정 시간 지속되면 권한 변경, pagination, webhook failure를 조사한다. “현재 open alert 수가 맞다”만 확인하면 철회 이력을 잃어도 알아차리기 어렵다.

## 배포 전 race fixture를 만든다

실제 advisory를 철회시켜 시험하려 하지 말고, 저장된 안전 payload와 HTTP fixture로 reducer를 검증한다. 최소 matrix는 다음과 같다.

| 순서 | 입력 | 기대 결과 |
|---|---|---|
| A | `200 open` → `withdrawn webhook` | `withdrawn`, 식별자 보존 |
| B | `api 410` → `withdrawn webhook` | tombstone 1개, 관측 경로 2개 |
| C | `withdrawn webhook` → 늦은 `200 open` | resurrection 거부 |
| D | 같은 delivery ID 두 번 | inbox 1개, side effect 1회 |
| E | 다른 delivery ID의 동일 `withdrawn` 두 번 | tombstone 1개, 결과 동일 |
| F | list omission → 단건 `404` | `missing`, 자동 ticket 종결 금지 |
| G | list omission → 단건 `410` | `withdrawn`, 철회 사유로 종결 |
| H | PATCH `410` | update 실패가 아니라 철회로 reconciliation |

각 fixture는 최종 row만 보지 말고 history event 수, ticket outbox 수, duplicate counter까지 검사한다. Worker를 두 개 띄워 같은 identity를 동시에 처리하는 test도 필요하다. Database lock이나 compare-and-set이 없으면 단일 process test는 통과하면서 production에서 tombstone이 되살아날 수 있다.

API `410` fixture는 임의의 모든 endpoint에 적용하지 않는다. 정확히 `GET /repos/{owner}/{repo}/dependabot/alerts/{alert_number}`와 해당 alert update 경로의 응답을 흉내 낸다. 공식 REST 문서는 이 개별 endpoint의 가능한 응답으로 `410 Gone`을 열거한다.[3] 다른 API의 `410`을 같은 lifecycle reducer로 보내는 router 자체가 버그다.

## 마이그레이션 순서

기존 시스템이 `404 = deleted`로 처리한다면 먼저 schema부터 바꾼다. 행 삭제를 멈추지 않은 채 webhook만 구독하면 race 중 하나는 여전히 history를 없앤다.

1. Projection에 `withdrawn`, `missing`과 tombstone metadata를 추가한다.
2. 기존 hard delete를 `missing_candidate` quarantine으로 바꾼다.
3. `410` fixture와 tombstone terminal precedence를 배포한다.
4. `dependabot_alert.withdrawn` consumer와 delivery dedupe inbox를 켠다.
5. Ticket resolution에 `upstream_withdrawn` mapping을 추가한다.
6. Webhook/API 순서를 뒤집은 race test를 통과시킨다.
7. 마지막으로 list diff reconciliation과 dashboard를 활성화한다.

기존 `404` 기록을 일괄 `withdrawn`으로 backfill하면 안 된다. 당시 응답에는 이번에 추가된 구분 정보가 없었기 때문이다. 과거 record는 `legacy_missing_unclassified` 같은 내부 상태로 보존하고, 현재 단건 조회에서 실제 `410`이 확인되는 항목만 철회로 승격한다. 이 label 역시 GitHub 용어가 아니라 증거 부족을 정직하게 표시하는 migration용 이름이다.

## 결론

이번 변경이 주는 정보는 명확하다. Dependabot이 advisory 또는 vulnerable range가 더는 유효하지 않다고 보고 alert를 철회하면 `withdrawn` webhook을 보내고, 제거된 그 alert를 get·update하려는 REST 요청에는 `410 Gone`을 반환한다.[1][2] 이는 github.com 전체 repository에 제공되며 GHES는 3.24부터 대상이다.[1]

그러나 이 신호를 안전하게 쓰려면 “사라짐”을 곧바로 “삭제”로 번역하지 않아야 한다. `404`와 목록 부재는 `missing`으로 격리하고, 정확한 개별 Dependabot alert의 `410` 또는 `withdrawn` action만 tombstone 근거로 삼는다. Webhook의 축약 식별자는 과거 full snapshot과 merge하고, 철회 상태는 늦은 `200`이 되살리지 못하게 한다.

마지막으로 delivery와 resource의 identity를 분리한다. `X-GitHub-Delivery`는 재전송을 한 번만 처리하기 위한 key이고, `repository_id + alert_number`는 alert lifecycle을 모으는 key다. 두 단계 모두 idempotent해야 webhook/API race, redelivery, ticket side effect가 한 번의 철회로 수렴한다. 410의 가치는 오류를 더 세분화하는 데 있지 않다. **없어진 경고에도 설명 가능한 마지막 상태를 남길 수 있게 된 것**에 있다.

## Sources

[1] https://github.blog/changelog/2026-10-13-improved-detection-for-withdrawn-dependabot-alerts
[2] https://docs.github.com/en/webhooks/webhook-events-and-payloads
[3] https://docs.github.com/en/rest/dependabot/alerts
[4] https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
