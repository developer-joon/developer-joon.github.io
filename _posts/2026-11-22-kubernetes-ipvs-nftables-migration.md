---
title: 'Kubernetes IPVS 종료 대비: nftables 전환을 왕복 검증했다'
date: 2026-11-22 06:55:00 +0900
categories: ["개발/인프라"]
description: 'Kubernetes kube-proxy IPVS의 정확한 종료 일정을 확인하고, v1.37 2노드 클러스터에서 nftables 전환·회귀 테스트·IPVS 롤백·재전환을 검증한 운영 런북을 정리한다.'
featured_image: 'https://picsum.photos/seed/kube-proxy-service-routing/1600/900'
tags: [kubernetes, kube-proxy, ipvs, nftables, networking, migration, devops]
---

![야간 도로를 흐르는 차량 불빛](https://picsum.photos/seed/kube-proxy-service-routing/1600/900)

Kubernetes SIG Network는 kube-proxy의 `ipvs` 백엔드를 더 이상 장기 유지하지 않기로 했다. IPVS는 대규모 클러스터에서 `iptables`의 성능 문제를 줄였지만, Kubernetes Service API의 모든 동작을 온전히 구현하지 못했고 일부 기능은 결국 iptables에 의존했다.[1]

이번 글에서는 소식만 옮기지 않는다. Kubernetes v1.37.0 2노드 클러스터를 `ipvs` 모드로 만들고 `nftables`로 전환한 뒤, ClusterIP·NodePort·ClientIP 세션 어피니티를 확인했다. 이어서 IPVS로 롤백하고 다시 nftables로 전환해 커널 데이터 플레인까지 확인했다.

먼저 일정부터 바로잡아야 한다. 2026년 11월 16일 공식 블로그 본문에는 “Kubernetes 1.40에서 제거”한다고 적혀 있지만, KEP-5495의 최신 고정 리비전과 v1.37 kube-proxy 경고는 더 세분된 일정을 제시한다. **v1.40에서는 IPVS가 기본 비활성화되고 feature gate로 다시 켤 수 있으며, v1.43에서 완전히 사용할 수 없게 된다.**[1][2] 운영 계획은 제목이나 요약 문구보다 KEP의 단계와 실제 릴리스 동작을 기준으로 잡는 편이 안전하다.

## 왜 IPVS를 떠나는가

IPVS는 Service와 endpoint를 해시 테이블 기반으로 조회해 iptables의 선형 규칙 탐색 문제를 피했다. 하지만 kube-proxy의 IPVS 구현은 기본 로드밸런싱만으로 Kubernetes Service 전체를 표현할 수 없었다. 부가 동작을 위해 iptables와 ipset을 함께 사용했고, IPVS API에는 일괄 갱신 기능이 없어 대량 변경에서 별도 병목도 생겼다.[1]

IPVS scheduler도 기대만큼 결정적인 이점이 아니었다. kube-proxy는 노드마다 독립적으로 실행되며 scheduler 상태를 노드 사이에서 공유하지 않는다. 한 노드의 연결 수를 보고 선택한 “최소 연결” endpoint가 클러스터 전체에서도 최소 연결이라는 보장이 없다.[1]

nftables 모드는 Kubernetes 1.29에서 도입됐고 1.33에서 GA가 됐다.[1] verdict map과 증분 갱신을 사용해 Service 수가 커질 때의 데이터 플레인 조회와 제어 플레인 규칙 갱신 문제를 함께 줄이는 방향이다.[3][4] 그렇다고 “nftables가 모든 클러스터에서 무조건 더 빠르다”고 결론 내리면 안 된다. 공식 자료의 비교 조건과 실제 CNI, Service 수, endpoint churn, 커널 버전이 다르므로 성능은 자체 부하로 측정해야 한다.

## 전환 전에 확인할 네 가지

### 1. 선언값과 실제 실행 모드를 함께 본다

kubeadm 클러스터라면 현재 설정은 다음처럼 확인할 수 있다.

```bash
set -euo pipefail

config=$(kubectl -n kube-system get configmap kube-proxy \
  -o jsonpath='{.data.config\.conf}')
grep -qx 'mode: ipvs' <<<"$config"

proxy_pods_output=$(kubectl -n kube-system get pods \
  -l k8s-app=kube-proxy -o name)
test -n "$proxy_pods_output"
mapfile -t proxy_pods < <(printf '%s\n' "$proxy_pods_output")

desired=$(kubectl -n kube-system get daemonset kube-proxy \
  -o jsonpath='{.status.desiredNumberScheduled}')
test "${#proxy_pods[@]}" -eq "$desired"

for pod in "${proxy_pods[@]}"; do
  kubectl -n kube-system logs "$pod" --tail=200 \
    | grep -q 'Using ipvs Proxier'
done
```

ConfigMap의 `mode`만 보면 아직 재시작되지 않은 Pod를 놓칠 수 있다. 반대로 로그만 보면 다음 재시작 때 적용될 선언값을 놓친다. 두 결과가 모두 `ipvs`인지 확인한다.

### 2. 커널과 도구 버전을 확인한다

Kubernetes 1.37의 nftables 모드는 Linux 커널 5.13 이상과 `nft` 1.0.1 이상을 요구한다. 개발·테스트 목적으로는 설정을 통해 더 오래된 커널을 허용할 수 있지만, 공식 문서는 이를 운영 환경에 권장하지 않는다.[5]

```bash
set -euo pipefail

uname -r
nft --version
```

배포판이 기능을 backport할 수 있으므로 버전 문자열만으로 모든 기능을 단정하지 않는다. 실제 후보 노드에서 kube-proxy 시작 로그와 규칙 생성을 확인해야 한다.

### 3. NodePort의 주소 계약이 달라진다

`nodePortAddresses`를 지정하지 않았을 때 IPVS와 iptables는 기본적으로 모든 로컬 IP에서 NodePort를 받지만, nftables는 노드의 primary IP만 사용한다. 로컬 방화벽을 자동으로 열어 주는 동작도 nftables에는 없다.[3][6]

다음 의존성을 먼저 찾는다.

- secondary IP나 별도 NIC로 NodePort에 접속하는 클라이언트
- `127.0.0.1:<NodePort>`에 의존하는 node-local agent
- NodePort 범위를 별도로 허용하지 않은 호스트 방화벽
- source IP 보존에 의존하는 `externalTrafficPolicy: Local` Service

운영 계약이 primary IP뿐이라면 이를 명시한다.

```yaml
nodePortAddresses:
  - primary
```

모든 주소가 반드시 필요하면 `all`을 명시할 수 있지만, 접근 표면이 넓어지는 만큼 방화벽 정책을 함께 검토해야 한다. localhost NodePort는 v1.37에서 별도 Alpha gate와 `localhost` 주소 지정이 필요한 TCP 전용 경로다.[3][6]

### 4. CNI·NetworkPolicy·관측 도구의 호환성을 확인한다

CNI나 NetworkPolicy 엔진이 kube-proxy의 iptables 규칙을 직접 참조하거나 덮어쓴다면 전환 후 동작이 달라질 수 있다. 규칙 수를 iptables에서만 세는 모니터링도 nftables 전환 뒤 거짓 정상 또는 거짓 장애를 만들 수 있다.[3] 관리형 Kubernetes는 kube-proxy 설정을 직접 바꿀 수 없거나 공급자가 별도 절차를 제공할 수 있으므로, 이 런북을 그대로 적용하지 말고 공급자 문서를 우선해야 한다.

## 실험 환경과 범위

이번에는 다음 환경에서 검증했다.

- kind v0.33.0
- Kubernetes client/server v1.37.0
- control-plane 1대, worker 1대
- Linux kernel 6.12.0
- echo backend 4개, 노드별 2개 배치
- ClusterIP Service 1개
- `sessionAffinity: ClientIP`인 NodePort Service 1개
- Docker host `127.0.0.1:30080`을 control-plane의 NodePort로 전달하는 kind `extraPortMappings`

이 실험은 **기능 전환과 롤백 경로**를 검증한다. Service 수가 적고 kind가 Docker 네트워크를 사용하므로 성능, 실제 cloud load balancer, 다중 NIC, SCTP, 대규모 endpoint churn까지 검증했다고 보지 않는다.

IPVS 상태에서 두 노드의 `/proc/net/ip_vs`에는 DNS, API, 테스트 Service를 포함해 각각 8개의 virtual service가 있었다. kube-proxy 로그에도 다음 경고가 남았다.

```text
The ipvs proxier has been deprecated and will be disabled by default in Kubernetes 1.40 and removed in Kubernetes 1.43.
```

## kubeadm 클러스터 전환 절차

kubeadm은 `kube-system/kube-proxy` ConfigMap의 `data.config.conf`를 kube-proxy DaemonSet에 제공한다. ConfigMap 문자열은 저장할 때 API 스키마 검증을 받지 않으므로, 오타나 들여쓰기를 운영자가 직접 막아야 한다.[7]

### 1. 원본 설정과 기준 결과를 보존한다

```bash
set -euo pipefail

kubectl -n kube-system get configmap kube-proxy \
  -o jsonpath='{.data.config\.conf}' > kube-proxy-ipvs.conf

kubectl -n kube-system get configmap kube-proxy -o yaml \
  > kube-proxy-configmap-before.yaml

sha256sum kube-proxy-ipvs.conf \
  > kube-proxy-ipvs.conf.sha256

kubectl -n kube-system get daemonset kube-proxy -o wide
kubectl -n kube-system get pods -l k8s-app=kube-proxy -o wide
```

전환 전에 실제 Service 회귀 테스트 결과와 kube-proxy 지표를 저장한다. 최소한 `kubeproxy_sync_proxy_rules_duration_seconds`, `kubeproxy_network_programming_duration_seconds`, kube-proxy health endpoint, Service 오류율과 연결 지연을 기록한다.

### 2. 설정을 바꾼다

대화형 편집 대신 원본과 후보 파일을 분리하고, 정확히 한 개의 `mode`만 바뀌는지 검사한 뒤 merge patch를 만든다.

```bash
set -euo pipefail

cp kube-proxy-ipvs.conf kube-proxy-nftables.conf

python3 -c '
from pathlib import Path
p = Path("kube-proxy-nftables.conf")
s = p.read_text()
old = "mode: ipvs"
if s.count(old) != 1:
    raise SystemExit("expected exactly one mode: ipvs")
p.write_text(s.replace(old, "mode: nftables"))
'

python3 -c '
import json
from pathlib import Path
print(json.dumps({"data": {"config.conf": Path("kube-proxy-nftables.conf").read_text()}}))
' > kube-proxy-nftables-patch.json

kubectl -n kube-system patch configmap kube-proxy \
  --type=merge --patch-file=kube-proxy-nftables-patch.json

kubectl -n kube-system get configmap kube-proxy \
  -o jsonpath='{.data.config\.conf}' > kube-proxy-applied.conf
cmp kube-proxy-nftables.conf kube-proxy-applied.conf
```

적용되는 변경은 다음 한 줄이다.

```diff
-mode: ipvs
+mode: nftables
```

IPVS 전용 값을 그대로 nftables 설정으로 옮기면 안 된다. 예를 들어 `ipvs.scheduler`, `strictARP`, IPVS timeout은 nftables 설정이 아니다. nftables 쪽에서 조정 가능한 항목은 `masqueradeAll`, `masqueradeBit`, `minSyncPeriod`, `syncPeriod`이며 의미는 현재 구성 API를 기준으로 확인한다.[6]

### 3. kube-proxy를 재시작하고 데이터 플레인을 확인한다

```bash
set -euo pipefail

kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy \
  --timeout=5m

proxy_pods_output=$(kubectl -n kube-system get pods \
  -l k8s-app=kube-proxy -o name)
test -n "$proxy_pods_output"
mapfile -t proxy_pods < <(printf '%s\n' "$proxy_pods_output")

desired=$(kubectl -n kube-system get daemonset kube-proxy \
  -o jsonpath='{.status.desiredNumberScheduled}')
test "${#proxy_pods[@]}" -eq "$desired"

for pod in "${proxy_pods[@]}"; do
  kubectl -n kube-system logs "$pod" --tail=200 \
    | grep -q 'Using nftables Proxier'
done
```

공식 kubeadm 재구성 문서는 ConfigMap을 바꾼 뒤 kube-proxy Pod를 삭제해 새 설정을 읽게 한다.[7] 여기서는 같은 목적의 DaemonSet rollout restart를 사용했다.

`rollout status` 성공만으로 끝내지 않는다. 다음 검사는 각 Linux 노드에서 실행하고, 노드별 원문을 별도 파일로 보존한다. `/proc/net/ip_vs` 읽기 자체가 실패하면 성공으로 바꾸지 않는 것이 핵심이다.

```bash
set -euo pipefail

sudo nft list table ip kube-proxy
sudo nft list table ip6 kube-proxy

ipvs_state=$(sudo cat /proc/net/ip_vs)
printf '%s\n' "$ipvs_state"
if grep -qE '^(TCP|UDP)[[:space:]]' <<<"$ipvs_state"; then
  echo 'ERROR: IPVS virtual services remain' >&2
  exit 1
fi

iptables_state=$(sudo iptables-save)
ip6tables_state=$(sudo ip6tables-save)
grep -E '(^:KUBE-|KUBE-)' <<<"$iptables_state" || :
grep -E '(^:KUBE-|KUBE-)' <<<"$ip6tables_state" || :
```

이번 실험에서는 두 노드 모두 `table ip kube-proxy`와 `table ip6 kube-proxy`가 생겼고, `/proc/net/ip_vs`의 virtual service는 8개에서 0개로 줄었다. 다만 실제 Service probe는 IPv4 경로만 검사했으며 IPv6 table 생성이 IPv6 Service 기능 검증을 뜻하지는 않는다.

재전환 시작 로그에는 두 노드 합계로 `iptables-restore` cleanup 오류 8건과 초기 nftables set 조회 오류 4건이 있었다. 이후 검사에서는 오류가 가리킨 `KUBE-MARK-MASQ`, `KUBE-PROXY-FIREWALL` 체인이 남아 있지 않았고 Service probe도 통과했다. 반면 kubelet canary와 `KUBE-FIREWALL`처럼 kube-proxy 전환만으로 없어지지 않는 `KUBE-*` 규칙은 남았다. 그러므로 “`KUBE-*`가 0개”를 성공 기준으로 쓰지 말고, 오류가 지목한 체인의 소유자와 잔존 여부를 구분해 확인해야 한다.

rollout 직후보다 규칙 동기화가 늦을 수 있으므로, 변경 창의 성공 조건은 Pod Ready가 아니라 **모든 노드의 모드 로그, 커널 규칙, 시작 오류 조사, Service probe가 함께 통과하는 것**으로 잡는다.

## 회귀 테스트 결과

동일한 workload를 IPVS와 nftables에서 각각 검사했다.

| 검증 항목 | IPVS | nftables |
|---|---:|---:|
| ClusterIP 20회 요청 | 성공, backend 4개 도달 | 성공, backend 4개 도달 |
| ClientIP affinity 10회 요청 | 성공, 한 backend 유지 | 성공, 한 backend 유지 |
| kind Docker host-port mapping 10회 요청 | 성공 | 성공 |
| 커널 데이터 플레인 | IPVS virtual service 8개/노드 | nftables table 존재, IPVS 0개/노드 |

이 숫자는 성능 비교가 아니다. 20회 요청은 routing과 분산의 최소 기능 확인이고, 10회 affinity 요청에서는 같은 client IP가 동일 backend에 고정되는지 확인했다. Docker host-port mapping 성공은 실제 노드의 localhost NodePort gate나 firewalld·ufw 호환성을 검증하지 않는다.

운영 환경에서는 다음 항목을 추가한다.

1. TCP뿐 아니라 실제 사용하는 UDP·SCTP Service
2. `externalTrafficPolicy: Cluster`와 `Local`
3. LoadBalancer ingress와 health check node port
4. primary·secondary·localhost를 구분한 NodePort 접근
5. source IP 보존과 SNAT 결과
6. `sessionAffinity: ClientIP` timeout
7. endpoint 추가·삭제 중 연결 오류와 규칙 동기화 지연
8. 장기 TCP 연결에서 `Connection reset by peer` 증가 여부

Linux 6.1 이전 커널에는 장기 TCP 연결 reset을 일으킬 수 있는 conntrack 문제가 있다. 공식 문서의 “전환 후 드러날 수 있음” 경고는 iptables→nftables 전환에 관한 것이며, 이번 IPVS→nftables 실험에서는 그 차이를 검증하지 않았다.[3] 구형 커널에서는 장기 연결을 별도로 시험하고, 문제가 관측될 때만 `conntrack.tcpBeLiberal`을 검토한다.[6]

## 롤백도 실제로 왕복시켰다

전환 전 저장한 `config.conf`를 merge patch로 되돌릴 수 있다.

```bash
set -euo pipefail

sha256sum -c kube-proxy-ipvs.conf.sha256

python3 -c '
import json
from pathlib import Path
print(json.dumps({"data": {"config.conf": Path("kube-proxy-ipvs.conf").read_text()}}))
' > kube-proxy-ipvs-rollback.json

kubectl -n kube-system patch configmap kube-proxy \
  --type=merge --patch-file=kube-proxy-ipvs-rollback.json

kubectl -n kube-system get configmap kube-proxy \
  -o jsonpath='{.data.config\.conf}' > kube-proxy-rollback-applied.conf
cmp kube-proxy-ipvs.conf kube-proxy-rollback-applied.conf

kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy \
  --timeout=5m

proxy_pods_output=$(kubectl -n kube-system get pods \
  -l k8s-app=kube-proxy -o name)
test -n "$proxy_pods_output"
mapfile -t proxy_pods < <(printf '%s\n' "$proxy_pods_output")

desired=$(kubectl -n kube-system get daemonset kube-proxy \
  -o jsonpath='{.status.desiredNumberScheduled}')
test "${#proxy_pods[@]}" -eq "$desired"

for pod in "${proxy_pods[@]}"; do
  kubectl -n kube-system logs "$pod" --tail=200 \
    | grep -q 'Using ipvs Proxier'
done
```

롤백은 rollout 성공으로 끝내지 않는다. 다음 역검사를 각 노드에서 실행한다.

```bash
set -euo pipefail

ipvs_state=$(sudo cat /proc/net/ip_vs)
printf '%s\n' "$ipvs_state"
if ! grep -qE '^(TCP|UDP)[[:space:]]' <<<"$ipvs_state"; then
  echo 'ERROR: IPVS virtual services were not restored' >&2
  exit 1
fi

nft_tables=$(sudo nft list tables)
if grep -qx 'table ip kube-proxy' <<<"$nft_tables"; then
  echo 'ERROR: nftables kube-proxy table remains' >&2
  exit 1
fi
```

마지막으로 전환 전에 저장한 것과 같은 ClusterIP·NodePort·LoadBalancer probe를 다시 실행하고 오류율 회복을 확인한다. 5분 안에 데이터 플레인이 수렴하지 않거나 일부 노드만 다른 모드인 mixed state가 남으면 변경을 중단하고 kube-proxy 로그와 ConfigMap mount부터 조사한다.

실험에서는 롤백 후 두 노드에 IPVS virtual service 8개가 다시 생성됐고 nftables의 `kube-proxy` table은 사라졌다. ClusterIP 10회와 kind host-port mapping 5회도 성공했다. 이후 nftables로 재전환해 ClusterIP 20회, affinity 10회, host-port mapping 10회를 다시 실행했다. 최종 상태는 두 노드 모두 nftables table 존재, IPVS virtual service 0개였다.

이 롤백은 IPVS를 다시 켤 수 있는 버전에서만 유효하다. KEP 일정대로라면 v1.40에서는 `KubeProxyIPVS` gate를 명시적으로 켜야 하고, v1.43 이후에는 IPVS 코드가 제거되어 같은 롤백을 사용할 수 없다.[2] 따라서 Kubernetes 업그레이드와 proxy mode 변경을 한 번에 묶지 말고, 먼저 현재 버전에서 nftables 전환과 관찰 기간을 끝낸 뒤 업그레이드하는 편이 안전하다.

## 배포 게이트

다음 조건을 모두 만족할 때만 전환을 완료로 본다.

- 모든 kube-proxy Pod가 새 revision으로 교체됐다.
- 모든 노드 로그에 `Using nftables Proxier`가 있다.
- 모든 노드에 nftables `kube-proxy` table이 있다.
- IPVS virtual service가 남아 있지 않다.
- ClusterIP·NodePort·LoadBalancer와 traffic policy 회귀 테스트가 통과했다.
- 시작 로그의 cleanup·초기화 오류를 조사했고, 오류가 지목한 legacy 체인의 최종 상태를 확인했다.
- 5분 단기 창과 30분 관찰 창에서 Service 오류율, 연결 지연, rule sync 지연이 **변경 전에 승인한** 기준을 넘지 않는다.
- 지표 표본이 없거나 telemetry가 끊기면 성공으로 간주하지 않는다.
- secondary IP·localhost NodePort 의존성 또는 방화벽 차이를 해결했다.
- 롤백 설정 파일의 checksum·소유자·권한을 확인했고 변경 창 동안 별도 위치에 보존한다.

중요한 것은 “ConfigMap을 바꿨다”가 아니라 “각 노드의 데이터 플레인이 새 모드로 수렴했고 사용자 경로가 정상이다”라는 증거다.

## 결론

IPVS 종료 대응은 설정 한 줄을 바꾸는 작업이지만, 안전한 전환은 한 줄로 끝나지 않는다. v1.40 기본 비활성화와 v1.43 완전 제거를 구분하고, 커널·CNI·NodePort 주소·방화벽 차이를 먼저 확인해야 한다. 그다음 모드 로그, 커널 규칙, 실제 Service probe를 하나의 배포 게이트로 묶는다.

이번 v1.37 실험에서는 IPVS→nftables→IPVS→nftables 기능 왕복과 최종 회귀 probe가 통과했다. 시작 단계의 cleanup·set 조회 오류도 발견했으며, 지목된 legacy 체인의 최종 부재까지 확인한 뒤에야 기능 성공으로 판정했다. 작은 kind 클러스터의 검증은 운영 성능이나 실제 방화벽·localhost NodePort 호환성 보증이 아니다. 실제 전환에서는 클러스터별 Service 계약과 관측 지표가 마지막 판단 기준이다.

## Sources

[1] https://kubernetes.io/blog/2026/11/16/ipvs-removal
[2] https://github.com/kubernetes/enhancements/blob/cdd3c6af0780ed150d05e426eb65cba05e794874/keps/sig-network/5495-deprecate-ipvs-mode-in-kube-proxy/README.md
[3] https://kubernetes.io/docs/reference/networking/virtual-ips
[4] https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy
[5] https://kubernetes.io/docs/reference/node/kernel-version-requirements
[6] https://kubernetes.io/docs/reference/config-api/kube-proxy-config.v1alpha1
[7] https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-reconfigure
