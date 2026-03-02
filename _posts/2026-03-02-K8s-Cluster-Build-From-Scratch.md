---
title: '집에서 K8s 클러스터 6노드 구축한 삽질기 — kubeadm, Cilium, ArgoCD까지'
date: 2026-03-02 00:00:00
description: '온프레미스 환경에서 Kubernetes 6노드 클러스터를 kubeadm으로 직접 구축하며 겪은 삽질 기록. HAProxy HA 구성, Cilium CNI, ArgoCD GitOps까지 시행착오와 해결 과정을 공유합니다.'
featured_image: '/images/2026-03-02-K8s-Cluster-Build-From-Scratch/cover.jpg'
tags: [kubernetes, k8s, 삽질기, devops, 수익실험]
---

![K8s 클러스터 구축](/images/2026-03-02-K8s-Cluster-Build-From-Scratch/cover.jpg)

## 왜 굳이 온프레미스 K8s를?

클라우드에 EKS 한 방이면 끝나는 걸 왜 집에서 직접 구축했냐고? 솔직히 말하면 **돈** 때문이다.

사이드 프로젝트를 하다 보니 돌려야 할 게 점점 많아졌다. [트레이딩봇](/blog/trading-bot-development-guide), [AI 에이전트](/blog/rocky-linux-ai-agent-server-setup), 각종 크론 작업들... 단일 서버에 Docker Compose로 올려놓고 쓰고 있었는데, 서비스가 5개를 넘어가면서 한계가 왔다. 서버 한 대가 죽으면 전부 멈추고, 배포할 때마다 SSH 들어가서 `docker-compose pull && up -d` 하는 게 점점 귀찮아졌다.

AWS EKS를 계산해봤더니 **월 15만 원**은 기본이었다. 컨트롤 플레인 비용만 월 7만 원, 거기에 EC2 노드, EBS, NAT Gateway... 사이드 프로젝트에 매달 15만 원은 좀 아까웠다. 근데 집에 4코어 32GB 서버가 6대나 놀고 있었다. 이걸 안 쓸 이유가 없었다.

> 💡 나중에 코딩 에이전트 팀을 올릴 기반으로도 쓸 계획이었다. AI 에이전트 여러 개가 각자 IDE 환경을 가지고 협업하려면 격리된 Pod가 필수적이다.

---

## 아키텍처 설계 — 정답이 너무 많은 게 문제

![하드웨어 구성](/images/2026-03-02-K8s-Cluster-Build-From-Scratch/hardware.jpg)

### 노드 구성

처음에 가장 고민한 건 마스터/워커 비율이었다.

| 역할 | 대수 | 스펙 | 용도 |
|------|------|------|------|
| Control Plane | 3대 | 4C / 32GB | API Server, etcd, 스케줄러 |
| Worker | 3대 | 4C / 32GB | 워크로드 실행 |

마스터 3대는 HA(High Availability) 때문이다. etcd가 Raft 합의 프로토콜을 쓰기 때문에 **홀수 노드**가 필요하고, 최소 3대여야 1대가 죽어도 클러스터가 살아남는다. 처음에 "마스터 1대 + 워커 5대"로 갈까 했는데, 예전 회사에서 마스터 단일 장애점(SPOF) 때문에 새벽에 호출당한 트라우마가 있어서 포기했다.

### 왜 kubeadm?

K8s를 설치하는 방법은 너무 많다:

- **kubeadm** — 공식 도구, 가장 기본
- **k3s** — 경량, 단일 바이너리
- **RKE2** — Rancher 기반
- **kubespray** — Ansible 기반 자동화

k3s가 가장 편하다는 건 알고 있었다. 하지만 이번에는 **K8s의 구조를 제대로 이해하고 싶었다**. kubeadm은 각 컴포넌트(API Server, Controller Manager, Scheduler, etcd)를 하나씩 세팅하면서 동작 원리를 체감할 수 있다. 삽질할 거 알면서도 kubeadm을 선택한 건 순전히 공부 목적이었다.

그리고 K8s 1.35.x를 선택했다. 최신 안정 버전이고, 특히 게이트웨이 API가 GA가 된 버전이라 Ingress 대신 Gateway API를 쓸 수 있었다.

---

## 첫 번째 삽질: HAProxy + Keepalived

마스터 노드 3대 앞에 로드밸런서가 필요하다. kubelet이 API Server에 연결할 때 단일 엔드포인트가 있어야 하기 때문이다.

```
              ┌──────────────┐
              │  VIP (가상 IP)  │
              └──────┬───────┘
                     │
          ┌──────────┼──────────┐
          │          │          │
     ┌────▼────┐ ┌───▼────┐ ┌──▼─────┐
     │HAProxy 1│ │HAProxy 2│ │HAProxy 3│
     │(Master1)│ │(Master2)│ │(Master3)│
     └─────────┘ └────────┘ └────────┘
```

Keepalived가 VIP(가상 IP)를 관리하고, HAProxy가 API Server 3대에 라운드로빈으로 요청을 분산한다.

### VIP가 안 떠요

Keepalived를 설치하고 설정했는데 VIP가 할당이 안 됐다. `ip addr`로 확인해보면 가상 IP가 안 보였다.

```bash
$ ip addr show eth0
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500
    inet 192.168.X.10/24 brd 192.168.X.255 scope global eth0
    # VIP가 없다...
```

로그를 뒤져보니 원인은 **firewalld**였다. VRRP 프로토콜(IP 프로토콜 112번)이 방화벽에 막혀서 마스터 선출이 안 되고 있었다.

```bash
# 이걸 해줘야 했다
$ sudo firewall-cmd --add-rich-rule='rule protocol value="vrrp" accept' --permanent
$ sudo firewall-cmd --reload
```

Ubuntu였으면 ufw에서 금방 열었을 텐데, Rocky Linux의 firewalld는 `rich-rule` 문법이 좀 까다롭다. [서버 세팅 삽질기](/blog/rocky-linux-ai-agent-server-setup)에서도 방화벽 때문에 한참 고생했는데, 또 당했다.

### HAProxy 헬스체크가 이상해요

VIP 문제를 해결하고 나니 이번엔 HAProxy 헬스체크가 제대로 안 됐다. API Server가 분명 살아있는데 `DOWN`으로 표시되는 거다.

원인은 헬스체크 포트 설정이었다. kubeadm 기본 API Server는 6443 포트를 쓰는데, 헬스체크 엔드포인트는 `/healthz`다. 근데 이게 **HTTPS**라서 HAProxy에서 SSL 체크를 해줘야 했다.

```
# haproxy.cfg
backend k8s-api
    option httpchk GET /healthz
    http-check expect status 200
    # 이 한 줄이 핵심이었다
    server master1 192.168.X.10:6443 check check-ssl verify none
    server master2 192.168.X.11:6443 check check-ssl verify none
    server master3 192.168.X.12:6443 check check-ssl verify none
```

`check-ssl verify none` — 이 옵션 하나를 몰라서 2시간을 날렸다. K8s API Server의 self-signed 인증서를 HAProxy가 검증하려다 실패하는 거였다. 프로덕션에선 인증서를 제대로 설정해야 하지만, 온프레미스 사이드 프로젝트에선 `verify none`이 현실적인 선택이었다.

---

## 두 번째 삽질: kubeadm init의 함정

![네트워크 구성](/images/2026-03-02-K8s-Cluster-Build-From-Scratch/network.jpg)

HAProxy가 드디어 정상 작동하자 본격적으로 kubeadm init을 실행했다.

```bash
$ sudo kubeadm init \
    --control-plane-endpoint "VIP_ADDRESS:6443" \
    --upload-certs \
    --pod-network-cidr=10.244.0.0/16
```

### cgroup 드라이버 불일치

첫 번째 init이 바로 실패했다. 에러 메시지:

```
[ERROR CRI]: container runtime is not running:
output: time="..." level=fatal msg="validate service connection:
CRI v1 runtime API is not implemented..."
```

containerd의 config가 기본 상태여서 cgroup 드라이버가 `cgroupfs`로 되어 있었는데, Rocky Linux 9는 시스템이 `systemd` cgroup을 쓴다. 불일치하면 kubelet이 제대로 안 뜬다.

```toml
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
  SystemdCgroup = true
```

이 설정을 빠뜨리면 kubeadm init은 되는데 나중에 Pod가 랜덤하게 죽는 유령 같은 증상이 나타난다. 처음에 이걸 모르고 넘어갔다가 3번째 노드 조인할 때 원인 모를 CrashLoopBackOff를 만나서 처음부터 다시 했다. `kubeadm reset`을 한 3번은 쳤을 거다.

### etcd 조인 타이밍 이슈

마스터 1대를 init하고, 나머지 2대를 `--control-plane`으로 조인시키는데 또 문제가 생겼다.

```
[ERROR EtcdClusterHealth]: etcd cluster is not healthy:
failed to dial endpoint: context deadline exceeded
```

원인은 간단했다. init 직후 바로 조인하면 etcd가 아직 완전히 초기화되지 않아서 실패한다. **2~3분 기다렸다가** 조인하면 깔끔하게 된다. 근데 이 "기다리세요"라는 게 공식 문서에 안 나와 있어서, Stack Overflow를 한참 뒤져야 알았다.

```bash
# 첫 번째 마스터 init 후 이 명령으로 etcd 상태 확인
$ sudo crictl ps | grep etcd
# etcd 컨테이너가 Running이면 그때 조인
```

---

## 세 번째 삽질: CNI — Cilium 선택과 대가

CNI(Container Network Interface) 선택은 꽤 고민됐다. 가장 무난한 건 Calico지만, 요즘 트렌드인 **Cilium**을 써보고 싶었다.

Cilium을 선택한 이유:
- **eBPF 기반**이라 kube-proxy 없이 서비스 라우팅 가능
- 네트워크 정책이 L7까지 지원
- Hubble UI로 트래픽 모니터링
- 무엇보다... 공부하고 싶었다

### Helm 설치 후 Pod가 안 뜬다

```bash
$ helm install cilium cilium/cilium \
    --namespace kube-system \
    --set kubeProxyReplacement=true \
    --set k8sServiceHost=VIP_ADDRESS \
    --set k8sServicePort=6443
```

Helm으로 설치했는데 cilium-agent Pod들이 `Init:CrashLoopBackOff` 상태에 빠졌다.

```bash
$ kubectl -n kube-system logs cilium-xxxxx -c mount-cgroup
mount: /run/cilium/cgroupv2: special device cgroup2 does not exist.
```

cgroup v2 마운트 문제였다. Rocky Linux 9는 기본적으로 cgroup v2를 쓰지만, 마운트 포인트가 Cilium이 기대하는 위치와 달랐다. 커널 파라미터를 추가해야 했다.

```bash
# /etc/default/grub에 추가
GRUB_CMDLINE_LINUX="... systemd.unified_cgroup_hierarchy=1"
$ sudo grub2-mkconfig -o /boot/grub2/grub.cfg
$ sudo reboot
```

리부트 후에야 Cilium이 정상적으로 올라왔다. 6노드 전부 리부트해야 하니까 한 30분은 날아갔다.

### kube-proxy 제거의 함정

Cilium의 `kubeProxyReplacement=true` 옵션을 쓰면 kube-proxy가 필요 없다. 근데 kubeadm은 기본으로 kube-proxy를 DaemonSet으로 깔아놓는다. 둘 다 있으면 **iptables 규칙이 꼬인다**.

```bash
# kube-proxy DaemonSet 제거
$ kubectl -n kube-system delete ds kube-proxy
# iptables 규칙 정리 (각 노드에서)
$ sudo iptables-save | grep -v KUBE | sudo iptables-restore
```

이걸 안 하면 서비스 디스커버리가 간헐적으로 실패하는 기괴한 증상이 나온다. ClusterIP로 접근이 되다가 안 되다가를 반복하는데, kube-proxy와 Cilium이 서로 다른 규칙을 만들어서 충돌하는 거였다. 이 원인을 찾는 데 반나절은 쓴 것 같다.

---

## 네 번째 삽질: 스토리지 — 온프레미스의 영원한 숙제

클라우드에서는 PVC 하나 만들면 EBS가 알아서 붙는다. 온프레미스에선? **직접 다 해야 한다**.

### Local Path Provisioner로 시작

처음에는 Rancher의 Local Path Provisioner를 썼다. 간단하고 빠르다.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
spec:
  storageClassName: local-path
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 10Gi
```

잘 돌아간다... 단일 노드에서는. 문제는 Pod가 다른 노드로 스케줄되면 데이터가 따라가지 않는다는 거다. `nodeAffinity`로 묶어놓으면 되지만, 그러면 HA의 의미가 없어진다.

### Longhorn으로 갈아타기

결국 Longhorn을 도입했다. Rancher에서 만든 분산 블록 스토리지로, 데이터를 자동으로 복제해준다.

```bash
$ helm install longhorn longhorn/longhorn \
    --namespace longhorn-system \
    --create-namespace \
    --set defaultSettings.defaultReplicaCount=2
```

복제 수를 2로 한 건 디스크 용량 때문이다. 32GB 메모리는 넉넉하지만 디스크는 각 노드당 256GB SSD라서, 3중 복제를 하면 실제 사용 가능 용량이 1/3로 줄어든다. 2중이면 1대까지 장애 허용되니까 사이드 프로젝트엔 충분했다.

Longhorn 설치 후 `iscsid` 서비스가 안 떠서 또 삽질했다. Rocky Linux에서는 기본 설치가 안 되어 있다.

```bash
$ sudo dnf install iscsi-initiator-utils
$ sudo systemctl enable --now iscsid
```

이걸 모든 워커 노드에 해줘야 한다. 하나라도 빠뜨리면 해당 노드에 PVC가 마운트 안 되면서 Pod가 `ContainerCreating`에서 영원히 대기한다.

---

## GitOps: ArgoCD + Kargo

![ArgoCD 설정](/images/2026-03-02-K8s-Cluster-Build-From-Scratch/argocd.jpg)

클러스터가 안정되면서 배포 파이프라인을 구축했다. SSH로 접속해서 `kubectl apply`하는 건 Docker Compose 시절이랑 다를 게 없으니까.

### ArgoCD 설치

```bash
$ kubectl create namespace argocd
$ kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

ArgoCD는 Git 저장소를 감시하다가 매니페스트가 변경되면 자동으로 클러스터에 반영해준다. **Push 기반이 아니라 Pull 기반**이라 보안적으로도 낫다. CI 파이프라인에 클러스터 접근 권한을 줄 필요가 없다.

### 초기 비밀번호를 못 찾겠다

ArgoCD 웹 UI에 접속하려면 초기 비밀번호가 필요하다. 근데 설치 직후에 Secret을 조회해도 안 나온다.

```bash
$ kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
Error from server (NotFound): secrets "argocd-initial-admin-secret" not found
```

ArgoCD v2.x부터는 설치 직후 Secret 생성에 시간이 걸린다. `argocd-server` Pod가 완전히 Ready가 되어야 Secret이 만들어진다. kubectl로 30초 정도 기다리면서 watch 걸어두니까 나타났다.

```bash
$ kubectl -n argocd get secret -w
# 잠시 후...
argocd-initial-admin-secret   Opaque   1   0s
```

### Kargo로 환경별 승격 자동화

ArgoCD만으로도 충분하지만, **Kargo**를 추가로 도입했다. Kargo는 ArgoCD 위에서 동작하는 프로모션 엔진으로, `dev → staging → prod` 같은 환경 승격을 자동화해준다.

솔직히 사이드 프로젝트에 staging까지 있을 필요는 없다. 근데 나중에 코딩 에이전트 팀을 올리면 "에이전트가 만든 코드를 dev에서 테스트 → 통과하면 prod로 자동 승격" 같은 워크플로우를 만들고 싶었다. 미리 깔아놓은 셈이다.

---

## cert-manager로 인증서 자동화

외부에서 서비스에 접근하려면 HTTPS가 필수다. Let's Encrypt 인증서를 cert-manager로 자동 관리하도록 설정했다.

```bash
$ helm install cert-manager jetstack/cert-manager \
    --namespace cert-manager \
    --create-namespace \
    --set crds.enabled=true
```

### DNS01 챌린지의 벽

HTTP01 챌린지는 인그레스가 잘 뚫려 있어야 하는데, 집 네트워크라 포트포워딩이 복잡했다. DNS01로 가기로 했다. Cloudflare DNS를 쓰고 있어서 API 토큰으로 자동 인증이 되는데...

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v2.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - dns01:
        cloudflare:
          apiTokenSecretRef:
            name: cloudflare-api-token
            key: api-token
```

처음엔 API **Key**를 넣었다가 안 됐다. Cloudflare는 전역 API Key와 API Token이 다르다. cert-manager가 필요한 건 **API Token** (Zone:DNS:Edit 권한)이지, 전역 Key가 아니다. 이거 구분 못 해서 인증서 발급이 계속 Pending에 머물렀다. 에러 메시지도 불친절해서 원인 찾기가 힘들었다.

---

## 최종 결과 — 뭘 올렸나

2주간의 삽질 끝에 클러스터가 안정화됐다. 현재 돌리고 있는 워크로드:

```
$ kubectl get pods --all-namespaces | grep Running | wc -l
42
```

Pod 42개가 돌아가고 있다. 주요 서비스:

- **트레이딩봇** — DCA 전략 자동매매 ([관련 포스트](/blog/trading-bot-lessons-learned))
- **AI 에이전트** — 크론 작업, 로또 자동구매 등
- **모니터링 스택** — Prometheus + Grafana
- **ArgoCD + Kargo** — GitOps 파이프라인
- **Longhorn** — 분산 스토리지
- **cert-manager** — 인증서 자동 갱신

### 리소스 사용률

```
$ kubectl top nodes
NAME       CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
master-1   350m         8%     4120Mi          12%
master-2   280m         7%     3890Mi          12%
master-3   310m         7%     3950Mi          12%
worker-1   890m         22%    8200Mi          25%
worker-2   750m         18%    7100Mi          22%
worker-3   420m         10%    5500Mi          17%
```

전체적으로 여유롭다. 코딩 에이전트 Pod들을 올려도 충분히 감당할 수 있는 수준이다.

---

## 삽질하면서 배운 교훈들

### 1. 온프레미스 K8s는 클라우드의 3배 이상 손이 간다

EKS에서는 5분이면 되는 일이 온프레미스에서는 2시간이다. 로드밸런서, 스토리지, 인증서, DNS — 클라우드가 자동으로 해주는 것들을 전부 직접 구성해야 한다. 대신 K8s의 동작 원리를 확실히 이해하게 됐다.

### 2. 방화벽은 항상 먼저 확인하자

이번 삽질의 반은 방화벽 때문이었다. 새 서비스를 올릴 때마다 포트부터 열어놓는 습관이 들었다. VRRP, etcd 피어링, NodePort, BGP... 예상 못한 포트가 필요할 때가 많다.

### 3. `kubeadm reset`은 친구다

잘못된 설정으로 init하면 깨끗하게 리셋하고 다시 하는 게 빠르다. 반쯤 꼬인 상태에서 고치려고 삽질하면 2배 3배로 시간이 든다. 이번에 reset을 최소 5번은 한 것 같다.

### 4. 문서보다 실전이 다르다

kubeadm 공식 문서는 잘 되어 있지만, "이것도 해야 합니다"라고 안 알려주는 게 꽤 있다. containerd cgroup 설정, etcd 조인 타이밍, kube-proxy 충돌 같은 건 전부 삽질하면서 알아냈다.

---

## 다음 단계

클러스터는 안정됐지만 아직 할 게 남았다:

- **코딩 에이전트 Pod 구성** — 각 에이전트가 격리된 환경에서 코드를 작성/실행
- **모니터링 고도화** — 알림 규칙 세분화, 슬랙/텔레그램 연동
- **백업 자동화** — Velero로 클러스터 상태 + PV 정기 백업
- **네트워크 정책** — Cilium L7 정책으로 Pod 간 통신 제어

온프레미스 K8s는 분명 힘들다. 하지만 클라우드 비용 없이 프로덕션급 오케스트레이션을 돌리는 만족감은 꽤 크다. 무엇보다, 이 삽질 과정에서 배운 것들이 클라우드 K8s를 쓸 때도 직접적으로 도움이 된다. "왜 이 옵션이 필요한지" 아는 것과 모르는 것의 차이는 꽤 크니까.

삽질은 끝이 없다. 근데 솔직히? 좀 재밌다. 😄

---

## 참고 자료

- [Kubernetes 공식 문서 - kubeadm으로 클러스터 생성](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/)
- [Cilium 공식 문서 - Getting Started](https://docs.cilium.io/en/stable/gettingstarted/)
- [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/)
- [Longhorn 설치 가이드](https://longhorn.io/docs/)
- [cert-manager 문서 - Cloudflare DNS01](https://cert-manager.io/docs/configuration/acme/dns01/cloudflare/)
