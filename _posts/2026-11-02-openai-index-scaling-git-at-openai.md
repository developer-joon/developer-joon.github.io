---
title: '코딩 에이전트가 Git을 압박하는 방식: OpenAI Pando의 병렬 push와 packfile 재사용'
date: 2026-11-02 09:00:02 +0900
categories: ["AI 개발 도구"]
description: 'OpenAI Pando가 동시 push와 대규모 fetch를 처리하는 구조를 살펴보고, 에이전트 규모에서 refs·packfile·compaction 병목을 측정하는 방법을 제안한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-openai-index-scaling-git-at-openai/1600/900'
tags: [openai, pando, git, codex, packfile, source-control, coding-agent]
---

![수많은 가지가 병렬로 뻗은 빛나는 저장소 그래프](https://picsum.photos/seed/news-2026-11-02-openai-index-scaling-git-at-openai/1600/900)

코딩 에이전트를 여러 개 붙이면 모델 호출량만 늘어나는 것이 아니다. 각 에이전트가 branch를 만들고 push하며, CI와 개발 환경이 같은 commit을 반복 fetch하면 source control의 읽기·쓰기 패턴 자체가 달라진다.

OpenAI는 이런 부하를 처리하기 위해 Git protocol과 client 호환성을 유지하는 새 backend **Pando**를 구축했다고 공개했다. Pando는 서로 다른 branch로 들어오는 push를 수평 확장하고, clone과 fetch가 client network를 채울 만큼 빠르게 데이터를 전달하는 것을 목표로 한다.[1]

## 에이전트는 Git 부하의 동시성을 바꾼다

사람 한 명이 한 변경을 마친 뒤 push하던 흐름에서는 branch update가 비교적 드물었다. Codex 같은 에이전트가 병렬 작업을 만들면 한 엔지니어에게 동시에 여러 변경이 준비되고, push 하나가 여러 CI job의 fetch를 유발한다.

OpenAI는 기존 monorepo 지원 시스템에서 느린 fetch와 push, merge 실패를 겪었고 reliability가 때때로 90% 아래로 내려갔다고 설명한다.[1] 이것은 Git object format 자체가 실패했다는 뜻이 아니다. Git-compatible workflow를 유지하면서 backend의 refs와 object serving을 다시 설계할 여지가 있었다는 뜻이다.

## 쓰기 병목은 repository 전체 lock으로 나타난다

일반적인 Git server는 object를 받아 저장한 뒤 refs를 갱신한다. 서로 다른 branch를 바꾸는 push도 repository 단위의 lock이나 shared maintenance 경로 때문에 직렬화될 수 있다.

Pando의 목표는 branch별 동시 쓰기를 허용하면서도 다음 원자성을 보존하는 것이다.

- push가 기대한 old ref에서 출발했는지 확인한다.
- 필요한 object가 모두 저장된 뒤 ref를 공개한다.
- 같은 branch를 동시에 바꾼 두 push는 충돌을 감지한다.
- 다른 branch push는 불필요하게 서로 막지 않는다.

OpenAI의 Git build에는 server가 branch tip을 별도로 알리는 `explicit haves`와 독립 pack을 병렬 다운로드·index하는 변경이 포함됐다. Pando에서는 이를 이용해 client가 trunk를 기준으로 pack을 만들면서도 `--force-with-lease`로 feature branch 이동을 확인할 수 있다.[1]

## 읽기 병목은 packfile 생성 비용이다

Git fetch는 client가 가진 object(`have`)와 원하는 object(`want`)를 기준으로 packfile을 만든다. 매 요청마다 큰 pack을 새로 계산하면 CPU가 병목이 되고, 모든 history를 담은 범용 pack만 제공하면 전송량이 커진다.

Pando는 push가 만든 작은 L0 pack부터 여러 ref version을 덮는 L4 cover까지 packfile을 background compaction한다. 기존 pack을 모든 level에 보존하고 client의 have/want에 맞춰 조합해 제공한다.[1]

이 구조는 LSM-tree와 비슷한 trade-off를 가진다.

| 선택 | 이점 | 비용 |
|---|---|---|
| 작은 L0 pack | 최신 변경을 빠르게 제공 | 오래 뒤처진 client는 파일 수 증가 |
| 큰 cover pack | 여러 변경을 한 번에 전달 | 생성·저장 비용과 첫 byte 지연 |
| 여러 level 보존 | client 상태별 최적 조합 | 저장 공간과 planner 복잡도 증가 |

Pando는 packfile URI와 cache를 사용해 표준 cloud VM 사이에서 10Gbps link를 포화한 결과를 보고한다.[1] 이는 특정 설계 검증치이지 모든 Git host가 같은 속도를 낸다는 보장은 아니다.

## 공개 성능 숫자의 경계

OpenAI는 production에서 median push latency가 거의 5배 개선됐고 하루 약 1PB의 Git 데이터를 전달한다고 밝혔다.[1]

이 수치는 OpenAI monorepo와 workload의 내부 측정이다. 저장소 크기, branch churn, CI fan-out, network, object 중복률이 다른 조직에 그대로 적용할 수 없다. Pando 자체도 현재 설치 가능한 공개 제품으로 발표된 것이 아니다. 공개된 것은 설계 설명, OpenAI의 Git fork, 일부 upstream 기여다.

## 로컬 fixture로 먼저 확인할 것

Pando를 재현한다고 주장하기보다, 현재 Git server가 에이전트형 부하에서 어디서 무너지는지 측정하는 fixture가 실용적이다. 아래는 **제안된 실험이며 실행 결과가 아니다**.

```text
1. 고정 크기의 bare repository와 seed history를 만든다.
2. N개 worker가 각자 다른 branch를 checkout한다.
3. barrier 뒤 동시에 작은 commit을 push한다.
4. 별도 worker M개가 clone 또는 fetch를 반복한다.
5. 동일 branch 충돌도 별도 phase에서 주입한다.
```

측정값은 평균 latency 하나로 끝내지 않는다.

```text
push_p50_ms, push_p95_ms, push_failures
fetch_p50_ms, fetch_p95_ms, bytes_sent
pack_objects_cpu_seconds, pack_bytes_created
ref_lock_wait_ms, concurrent_connections
repository_size_before_after
```

Branch마다 다른 commit을 push하는 phase는 수평 쓰기 가능성을 본다. 같은 branch에 동시에 push하는 phase는 compare-and-swap과 `force-with-lease` 안전성을 본다. 둘을 섞으면 처리량 개선이 충돌 무시에서 나온 것인지 알 수 없다.

## cache hit만 높이면 안 되는 이유

Packfile cache는 많은 client가 비슷한 history를 가져갈 때 효과가 크다. 하지만 cache key가 client의 exact wants와 capabilities를 충분히 반영하지 않으면 필요 없는 object를 과도하게 보내거나 잘못된 pack 조합을 제공할 수 있다.

운영 dashboard에는 다음을 함께 둔다.

- planner가 선택한 pack level과 개수
- cache hit ratio와 실제 전송 byte
- time to first byte와 전체 fetch 시간
- compaction backlog와 새 branch 반영 지연
- object integrity 검증 실패

처리량이 좋아져도 최신 ref가 보이지 않거나 object가 빠지면 source control로서 실패다.

## Pando에서 가져올 설계 원칙

모든 조직이 새 Git backend를 만들 필요는 없다. 다만 코딩 에이전트 도입 전에 다음 질문은 해야 한다.

1. 서로 다른 branch push가 repository-wide lock에서 대기하는가?
2. CI job마다 같은 pack을 다시 생성하는가?
3. clone 대신 incremental fetch를 강제할 수 있는가?
4. agent workspace의 shallow clone과 partial clone이 실제 workload에 맞는가?
5. 유지보수·repack·GC가 peak push 시간과 겹치는가?

에이전트 수를 늘렸는데 merge와 CI가 느려졌다면 모델이 아니라 Git backend가 병목일 수 있다. OpenAI Pando의 중요한 메시지는 Git을 버리라는 것이 아니다. Git protocol의 익숙한 계약을 유지하면서, refs update와 packfile serving을 에이전트 시대의 동시성에 맞게 다시 설계할 수 있다는 것이다.

## Sources

[1] https://openai.com/index/scaling-git-at-openai
