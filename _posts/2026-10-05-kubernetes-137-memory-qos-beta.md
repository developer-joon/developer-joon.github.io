---
title: 'Kubernetes 1.37 Memory QoS Beta: 기본 활성화와 실제 메모리 정책을 구분하기'
date: 2026-10-05 08:00:00 +0900
categories: ["개발/인프라"]
description: 'MemoryQoS의 Beta 기본 활성화와 memory.high·memory.min·memory.low의 실제 적용 조건을 구분하고, cgroup 값과 throttling·reclaim·OOM 신호로 검증하는 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/kubernetes-137-memory-qos-beta/1600/900'
tags: [kubernetes, memory-qos, cgroup-v2, kubelet, throttling, oom, linux]
---

![Kubernetes 1.37 Memory QoS Beta](https://picsum.photos/seed/kubernetes-137-memory-qos-beta/1600/900)

Kubernetes 1.37에서 `MemoryQoS`가 Beta로 승격되고 feature gate도 기본 활성화됐다. 그러나 업그레이드 직후 모든 Pod에 메모리 보호와 throttling이 적용된다는 뜻은 아니다. 기본 `KubeletConfiguration`은 `memoryThrottlingFactor: null`, `memoryReservationPolicy: None`이며, 이 상태에서는 kubelet이 `memory.high`, `memory.min`, `memory.low`를 새 정책 값으로 기록하지 않는다.[1][3]

완료 기준은 “gate=true”가 아니라 실제 cgroup 값과 throttling, reclaim, OOM의 변화다. Memory QoS는 커널에 힌트를 주는 기능이지 OOM 제거 또는 latency 개선을 보장하지 않는다. 보호가 과하면 다른 cgroup의 reclaim 여지를 줄이고, throttling 비용은 응답 시간에 나타날 수 있다.[2][5]

## Beta 기본 활성화는 준비 상태다

1.37의 기본 상태는 두 층으로 나눠야 한다.

| 항목 | 1.37 기본값 | 의미 |
|---|---|---|
| `MemoryQoS` feature gate | 활성화 | kubelet이 Memory QoS 설정을 사용할 수 있음 |
| `memoryThrottlingFactor` | `null` | `memory.high` throttling을 적용하지 않음 |
| `memoryReservationPolicy` | `None` | `memory.min`·`memory.low` 보호를 적용하지 않음 |

Alpha 시기의 기본 factor `0.9`는 1.37에서 `null`로 바뀌었다. 기존 workload를 자동으로 throttle하지 않기 위한 변경이며 실제 정책은 운영자가 명시해야 한다.[1][2]

업그레이드 전에 `memoryThrottlingFactor`를 명시했다면 값과 throttling은 보존된다. 필드가 없었던 노드는 새 `null` 기본값을 사용한다.[1] 같은 버전이라도 설정 이력에 따라 결과가 달라지므로 기본값과 명시 값을 따로 조사해야 한다.

## `high`, `min`, `low`는 서로 다른 제어다

Linux cgroup v2의 `memory.high`는 사용량이 경계를 넘을 때 해당 cgroup의 프로세스를 throttle하고 강한 reclaim 압력을 가한다. 이 경계를 넘었다는 사실만으로 OOM killer가 호출되지는 않으며 극단적인 상황에서는 값 초과도 가능하다. `memory.max`는 hard limit이며, 사용량을 줄일 수 없으면 cgroup OOM으로 이어질 수 있다.[5]

`memory.min`은 hard protection이다. 유효 경계 안의 메모리는 reclaim하지 않으며, 보호되지 않은 회수 가능 메모리가 부족하면 OOM killer가 호출될 수 있다. `memory.low`는 best-effort protection이어서 다른 비보호 cgroup에서 회수할 수 없을 때는 보호 범위 안도 reclaim 대상이 될 수 있다.[5]

Kubernetes는 이를 QoS class에 따라 적용한다.[2][3]

- **Guaranteed:** `memory.high`를 설정하지 않는다. `TieredReservation`을 켜면 request에 해당하는 `memory.min`을 container와 Pod 계층에 적용한다.
- **Burstable:** factor를 명시하면 container별 `memory.high`를 계산한다. `TieredReservation`에서는 request를 기준으로 `memory.low`를 적용한다.
- **BestEffort:** factor를 명시하면 request를 0, limit 대신 node allocatable memory를 사용해 `memory.high`를 계산한다. reservation 보호는 없다.

Burstable container의 개념식은 다음과 같고 실제 값은 page size에 맞춰 내림 처리된다.[2][3]

```text
memory.high = request + factor × (limit - request)
```

limit이 없으면 node allocatable memory가 대신 들어간다. factor `1.0`은 `memory.high`를 limit과 같은 지점에 두어 early throttling을 사실상 없애지만 `null`과 완전히 같지는 않다. `null`은 kubelet이 `memory.high`를 설정하지 않는 상태이고 cgroup 기본값은 `max`다.[2][5]

## TieredReservation은 node-wide 정책이다

다음 설정은 throttling과 reservation을 각각 명시적으로 켠다.

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
memoryThrottlingFactor: 0.9
memoryReservationPolicy: TieredReservation
```

두 필드는 독립적이다. factor를 생략한 채 `TieredReservation`만 쓰거나, reservation을 `None`으로 유지한 채 throttling만 켤 수 있다.[1][3]

cgroup v2 보호는 계층적이다. kubelet은 Guaranteed request를 `memory.min`, Burstable request를 `memory.low`로 container·Pod cgroup에 반영하고, 상위 kubepods와 Burstable QoS cgroup에도 합계에 맞는 보호 값을 구성한다.[2][3] 상위 cgroup의 보호 한도가 부족하면 leaf 값만 보고 기대한 보호가 작동한다고 판단할 수 없다.[5]

`memoryReservationPolicy`는 Pod별 opt-in이 아니라 **node-wide 정책**이다. `TieredReservation`은 그 노드의 모든 Guaranteed·Burstable Pod에 적용된다.[1] 일부 Pod만 제외할 수 없다.

Guaranteed Pod는 request와 limit이 같아 `TieredReservation`에서 `memory.min`과 `memory.max`가 같아진다. page cache도 container cgroup에 charge되므로 파일 읽기가 많은 workload는 OOM을 겪을 수 있다.[1][3] heap뿐 아니라 native memory와 page cache를 포함한 cgroup 사용량으로 시험해야 한다.

## rollback은 stale 값을 남길 수 있다

설정을 되돌렸다고 실행 중인 모든 cgroup 값이 즉시 초기화되는 것은 아니다. gate를 끄거나 reservation을 `TieredReservation`이 아닌 값으로 바꾸면 kubelet은 cgroup v2 노드 시작 시 kubepods root의 `memory.min`·`memory.low`, Burstable QoS cgroup의 `memory.low`를 0으로 reset한다.[1][3]

container의 stale `memory.high`는 새 container 생성, 재시작, in-place resize처럼 runtime이 resource configuration을 다시 적용할 때 `max`로 돌아간다. 재시작이나 resize가 없는 기존 container에는 이전 값이 남을 수 있다.[2][3] Pod·container의 오래된 `memory.min`·`memory.low`가 파일에 남더라도 상위 보호가 0이면 실효 보호는 없다.[3] rollback 검증은 상위와 leaf cgroup을 함께 읽어야 한다.

feature gate 자체를 끌 때는 `TieredReservation`을 제거하거나 `None`으로 바꾸고 호환되지 않는 throttling 설정을 정리해야 한다. 1.37 kubelet은 gate가 꺼진 상태에서 `TieredReservation`이 남아 있거나 허용되지 않는 factor 조합이면 설정을 거부할 수 있다.[1]

## cgroup 값과 event를 함께 검증한다

다음은 실행 결과가 아니라 점검 명령 예시다. 먼저 node의 cgroup version을 확인한다.[4]

```bash
stat -fc %T /sys/fs/cgroup/
```

cgroup v2의 filesystem type은 `cgroup2fs`다. throttling을 사용할 node는 kernel 5.9 이상이 권장된다. 더 오래된 kernel에는 `memory.high` 관련 알려진 livelock 위험이 있어 kubelet이 시작 시 경고를 남긴다.[2][3]

container PID를 확보했다면 프로세스가 속한 cgroup에서 값을 직접 읽는다. 경로는 cgroup driver와 runtime에 따라 달라지므로 고정된 디렉터리명을 가정하지 않는다.

```bash
CG=$(awk -F: '$1 == "0" {print $3}' /proc/$PID/cgroup)
DIR="/sys/fs/cgroup${CG}"

for f in memory.current memory.min memory.low memory.high memory.max \
         memory.events memory.events.local memory.pressure; do
  printf '\n== %s ==\n' "$f"
  cat "$DIR/$f"
done
```

`memory.events`의 `high`는 high 경계 때문에 throttling과 direct reclaim 경로를 거친 횟수, `max`는 max 경계 도달 횟수, `oom`과 `oom_kill`은 cgroup OOM과 kill 신호다. `memory.events`는 하위 계층을 포함할 수 있으므로 leaf 자체의 변화는 `memory.events.local`과 함께 본다.[5] 한 번의 절대값보다 부하 구간 전후 delta를 수집해야 한다.

| 질문 | 직접 확인할 값 | 함께 볼 신호 |
|---|---|---|
| threshold가 적용됐는가 | leaf `memory.high`·`memory.max` | kubelet 설정의 명시 값 |
| 보호 계층이 연결됐는가 | container·Pod·QoS·kubepods의 `memory.min`·`memory.low` | request 합계, node allocatable |
| throttling이 발생했는가 | `memory.events{,.local}`의 `high` delta | `memory.pressure`, CPU, 처리량, p95/p99 latency |
| OOM 경로가 바뀌었는가 | `oom`, `oom_kill`, `max` delta | `container_oom_events_total`, 재시작 수, kernel·kubelet event |

`high` 증가를 성공으로만 판정하면 안 된다. 목표는 throttling 자체가 아니라 node pressure와 workload 성능 사이의 허용 가능한 균형이다. OOM 횟수가 줄어도 동일한 request·limit, workload, node pressure 조건에서 비교하지 않았다면 Memory QoS의 효과라고 단정할 수 없다. latency와 처리량 저하도 함께 기록해야 한다.

## 결론

Kubernetes 1.37 Memory QoS의 Beta 승격은 기능을 기본으로 **사용 가능하게** 만들었지만 메모리 정책을 기본으로 **적용한 것**은 아니다. `memoryThrottlingFactor: null`과 `memoryReservationPolicy: None`이 그 경계를 만든다.[1][3]

도입 판단은 gate 상태가 아니라 cgroup 계층의 실제 값으로 시작해야 한다. `memory.high`, `memory.min`, `memory.low`, 상위 보호 합계와 stale reset을 확인한 뒤 throttling·pressure·OOM event와 workload latency를 함께 비교해야 한다. `TieredReservation`은 node-wide이므로 서로 다른 reclaim 요구를 가진 workload를 같은 node에 배치할지도 검토해야 한다. 결론은 “OOM이 사라진다”가 아니라 “어떤 압력에서 어떤 cgroup이 보호·제한되고, 그 비용이 허용 범위인가”여야 한다.

## Sources

[1] https://kubernetes.io/blog/2026/09/14/kubernetes-v1-37-memory-qos-graduates-to-beta — Kubernetes v1.37: Memory QoS Graduates to Beta
[2] https://github.com/kubernetes/enhancements/blob/ff00d8b92da7afa924e1bb38faf7653db148dcbe/keps/sig-node/2570-memory-qos/README.md — KEP-2570: Support Memory QoS with cgroups v2
[3] https://kubernetes.io/docs/concepts/workloads/pods/pod-qos — Pod Quality of Service Classes
[4] https://kubernetes.io/docs/concepts/architecture/cgroups — About cgroup v2
[5] https://docs.kernel.org/admin-guide/cgroup-v2.html — Control Group v2
