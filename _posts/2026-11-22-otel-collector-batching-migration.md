---
title: 'batch processor를 지우면 같은 숫자의 큐가 더 작아질 수 있다: OTel Collector 무손실 전환 검증안'
date: 2026-11-22 07:40:00 +0900
categories: ["관측성"]
description: 'OpenTelemetry Collector batch processor 제거 때 큐 용량, backpressure, 오류 전달 의미가 바뀌는 지점을 짚고 무손실 전환을 위한 설정과 장애 주입 검증안을 정리한다.'
featured_image: 'https://picsum.photos/seed/hotnews-otel-batching-queue/1600/900'
tags: [opentelemetry, otel-collector, batch-processor, queue, backpressure, observability, migration]
---

![콘크리트 벽 사이로 나란히 이어지는 두 줄의 철도 선로](https://picsum.photos/seed/hotnews-otel-batching-queue/1600/900)

OpenTelemetry Collector의 `batch` processor가 deprecated 단계에 들어갔다. 권장 경로는 대부분의 pipeline에서 batch를 exporter의 `sending_queue` 안으로 옮기고, 꼭 필요한 경우 새 `queue_batch` processor를 쓰는 것이다.[1]

하지만 `processors: [batch]` 한 줄을 지우고 `sending_queue.batch.enabled: true`를 더하는 것만으로는 같은 시스템이 되지 않는다. batching의 위치가 queue 앞에서 뒤로 이동하면 `queue_size: 1000`이 담는 데이터 양부터 달라진다. 안전한 migration의 단위는 YAML 문장이 아니라 **queue capacity, backpressure, error semantics**다.

## 먼저 일정부터 고정한다

2026년 11월 11일 공식 블로그에 따르면 `batch` processor는 deprecated이며 다음 release부터 warning을 낸다. 대부분의 exporter에서 batching을 기본 활성화하는 목표는 `v0.171.0`(2027년 2월), core와 distribution에서 processor를 제거하는 목표는 `v0.177.0`(2027년 5월)이다.[1]

고정 commit의 RFC에는 `v0.160.0` deprecation, `v0.166.0` distribution 제거·기본 활성화, `v0.172.0` core 제거라는 옛 단계안이 있다. adopter 조건에 따라 연장되는 **계획 문서**다.[2] 운영 일정은 최신 공지의 `v0.171.0`·`v0.177.0` 목표로 추적하되, 이 역시 “planned”이므로 upgrade 전에 release note와 distribution manifest를 확인한다.

## 왜 같은 1000인데 큐가 더 작아지는가

기존 `receiver → batch processor → sending_queue`에서는 queue가 이미 커진 request 1000개를 담는다. 새 `receiver → sending_queue → batch → exporter`에서는 같은 `queue_size: 1000`이 batching 전의 작은 request 1000개만 담는다.[1]

기존 batch가 평소 5,000 items이고 입력 request가 100 items라면, 1000-slot queue의 명목 데이터량은 약 5,000,000에서 100,000 items로 줄 수 있다. 이는 산정을 위한 **운영 가정**일 뿐이다. timeout과 signal별 객체 크기에 따라 실제 값은 달라진다.

따라서 queue `sizer`를 `items`나 `bytes`로 바꾸고 backlog를 그 단위로 명시한다. 둘 다 `requests`보다 CPU 비용이 크며 `bytes`가 가장 비싸다.[1][3] backend 제한이 bytes 기준이면 `bytes`, record 수가 핵심이면 `items`를 시험한다.

## 보존해야 할 세 가지 계약

첫째는 **용량**이다. 숫자를 복사하지 말고 몇 초의 입력 또는 몇 items/bytes를 버틸지 정한다. `otelcol_exporter_queue_size`와 `otelcol_exporter_queue_capacity`로 peak ingest의 장애 허용 시간을 계산한다.[1]

둘째는 **backpressure**다. 기본 `block_on_overflow: false`에서는 full queue가 새 데이터를 거절하며 exporter retry에도 넣지 않는다. `true`면 공간이나 deadline까지 caller를 막는다.[3] 기존 processor의 blocking에 의존했다면 receiver의 압력 전달 능력을 확인하고 값을 명시한다.

셋째는 **오류 의미**다. `wait_for_result: false`는 queue 입장까지만, `true`는 export 결과까지 기다리지만 persistent storage와 함께 쓸 수 없다.[2][4] 옛 processor는 downstream 오류를 억제했다.[2] 오류 전파 개선과 기존 계약 보존을 분리하고, 동기 전환은 별도 변경으로 측정한다.

## before와 after는 이렇게 비교한다

다음 before는 5,000 items를 목표로 묶은 뒤 request 단위 queue에 넣는다.

```yaml
processors:
  memory_limiter:
    limit_mib: 512
  batch:
    timeout: 200ms
    send_batch_size: 5000
    send_batch_max_size: 10000

exporters:
  otlp:
    endpoint: backend.example:4317
    sending_queue:
      enabled: true
      sizer: requests
      queue_size: 1000
      num_consumers: 10
      block_on_overflow: true
      wait_for_result: false

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp]
```

아래 `5_000_000`은 1000 slot에 평소 5,000 items씩 있었다는 가정의 초기값이다. staging에서 memory와 drain time을 재야 한다.

```yaml
processors:
  memory_limiter:
    limit_mib: 512

exporters:
  otlp:
    endpoint: backend.example:4317
    sending_queue:
      enabled: true
      sizer: items
      queue_size: 5_000_000
      num_consumers: 10
      block_on_overflow: true
      wait_for_result: false
      batch:
        enabled: true
        sizer: items
        min_size: 5000
        max_size: 10000
        flush_timeout: 200ms

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter]
      exporters: [otlp]
```

before와 after 모두 full queue에서 공간이나 deadline까지 기다리고 export 완료는 기다리지 않도록 명시했다. 용량 단위와 batching 위치만 먼저 비교하기 위해 overflow 정책을 분리한 것이다. exporterhelper를 지원하지 않거나 pull·순서 보장·자체 queue 특성 때문에 기본 batching 대상이 아닌 exporter도 있다.[2]

## `queue_batch`가 더 맞는 경우

여러 exporter가 하나의 batch를 공유해 메모리를 아껴야 하거나, `groupbyattrs` 같은 aggregation processor 앞에서 큰 batch가 필요한 pipeline은 processor 형태를 유지할 이유가 있다. 이때 `batch`의 직접 대체 후보가 `queue_batch`다.[1][2]

RFC에는 `wait_for_result: true` 제안이 남아 있지만, 같은 revision의 component 문서는 기본값을 `block_on_overflow: true`, `wait_for_result: false`, `queue_size: 10`, `num_consumers: 1`로 설명한다.[2][4] 계획에서 runtime을 추론하지 말고 배포 버전의 docs와 effective config를 확인한다. 10 requests는 기존 1000 requests와 같은 용량이 아니다.

## 제안하는 부하·장애 fixture

아래는 실행 결과가 아닌 staging 검증안이다. 내부 fixture의 `/mode`는 sink를 `ok`·`fail-503`으로 바꾸고, `/load`는 `run_id`와 연속 `seq`를 가진 OTLP trace를 보낸다. `/result/<run_id>`는 전송·수신·중복·queue 지표를 JSON으로 반환한다. 이는 OpenTelemetry 표준 API가 아니다.

```bash
set -euo pipefail

: "${FIXTURE_URL:=https://fixture.example}"
: "${RUN_ID:=otel-batch-migration-001}"

curl -fsS -X PUT "$FIXTURE_URL/mode" \
  -H 'content-type: application/json' \
  -d '{"sink":"fail-503"}' >/dev/null

curl -fsS -X POST "$FIXTURE_URL/load" \
  -H 'content-type: application/json' \
  -d "{\"run_id\":\"$RUN_ID\",\"count\":200000,\"rate_per_second\":10000}" \
  >/dev/null

sleep 30
curl -fsS -X PUT "$FIXTURE_URL/mode" \
  -H 'content-type: application/json' \
  -d '{"sink":"ok"}' >/dev/null

for _ in $(seq 1 90); do
  result=$(curl -fsS "$FIXTURE_URL/result/$RUN_ID")
  if jq -e '.received == .sent' <<<"$result" >/dev/null; then
    break
  fi
  sleep 1
done

jq -e '
  .sent == 200000 and
  .received == .sent and
  .unique == .sent and
  .duplicates == 0 and
  .enqueue_failed == 0 and
  .queue_size <= .queue_capacity
' <<<"$result" >/dev/null
```

두 설정에 같은 fixture를 적용해 최대 queue, producer 지연, enqueue failure, drain time, RSS와 CPU를 비교한다. blocking이면 receiver timeout과 upstream retry도 보고, non-blocking이면 drop 정책과 alert를 확인한다. persistent queue 시험에는 강제 재시작을 추가하되 `wait_for_result: true`와 결합하지 않는다.[3][4]

## rollout gate는 YAML diff보다 넓다

먼저 exporter 한 종류와 signal 하나만 canary로 옮긴다. 정상 부하, 503, 느린 응답, Collector 재시작을 각각 분리하고 다음 조건을 모두 만족할 때 범위를 넓힌다.

- 목표 backlog 시간 동안 queue overflow와 허용 밖 drop이 없다.
- queue capacity 단위와 dashboard·alert의 단위가 일치한다.
- p95 receiver 지연, exporter latency, CPU, RSS가 사전 한계를 넘지 않는다.
- 장애 해제 뒤 승인한 시간 안에 queue가 drain된다.
- upstream이 보는 success/failure가 선택한 `wait_for_result` 계약과 일치한다.
- startup log에 double batching warning이 없고 pipeline에 옛 `batch`가 남지 않는다.[1]

Rollback에는 processor뿐 아니라 queue 단위·용량·압력·오류 정책과 alert까지 담은 versioned config가 필요하다. 성공 기준은 YAML 시작 여부가 아니라 장애 중 telemetry 보존량, 압력 전달, 오류 노출 경계가 승인 계약과 맞는지다.

## Sources

[1] https://opentelemetry.io/blog/2026/collector-batching-migration/
[2] https://github.com/open-telemetry/opentelemetry-collector/blob/302c933caa8c66f7ebf35ea42238b261bc3e5fc6/docs/rfcs/batching-migration.md
[3] https://github.com/open-telemetry/opentelemetry-collector/blob/302c933caa8c66f7ebf35ea42238b261bc3e5fc6/exporter/exporterhelper/README.md
[4] https://github.com/open-telemetry/opentelemetry-collector/blob/302c933caa8c66f7ebf35ea42238b261bc3e5fc6/processor/queuebatchprocessor/README.md
