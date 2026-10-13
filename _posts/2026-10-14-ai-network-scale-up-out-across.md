---
title: 'AI 클러스터 네트워크는 하나가 아니다: scale-up·scale-out·scale-across를 분리해야 하는 이유'
date: 2026-10-14 05:40:00 +0900
categories: ["AI 인프라"]
description: 'Meta와 OCP의 2026년 공개 자료를 바탕으로 AI 클러스터의 scale-up·scale-out·scale-across 평면을 나누고, 각 평면의 장애·혼잡·텔레메트리·운영 책임을 설계한다.'
featured_image: 'https://picsum.photos/seed/ai-network-scale-up-out-across/1600/900'
tags: [ai-infrastructure, networking, scale-up, scale-out, scale-across, fboss, ocp, ethernet]
---

![AI 클러스터의 scale-up·scale-out·scale-across 세 네트워크 평면](https://picsum.photos/seed/ai-network-scale-up-out-across/1600/900)

AI 클러스터 네트워크를 “GPU 사이를 빠르게 잇는 망” 하나로 표현하면 운영 경계가 사라진다. 랙 안 accelerator 경로, cluster backend fabric, 건물·지역을 잇는 경로는 지연 예산과 장애 반경, 혼잡 전파 방식이 다르다.

Meta는 OCP Global Summit 2026 발표에서 이 구분을 **scale-up, scale-out, scale-across**로 제시했다. Scale-up에는 MTIA 300용 Ethernet switch인 Tahan과 차세대 rack 설계, scale-out에는 IcePack·IceCube와 Flattened Planar Fabric(FPF), scale-across에는 backend aggregation(BAG)과 FBOSS 기반 SRv6 regional backbone을 배치했다.[1] 이 목록을 서로 다른 운영 계약의 세 network plane으로 읽어야 한다.

다만 발표의 시제부터 구분해야 한다. Tahan은 Meta가 현재 shipping 중이라고 밝힌 설계지만, 72-accelerator rack은 preview이고 그 이후 세대에 ESUN data plane을 채택한다는 내용은 계획이다. FPF는 Meta 내부에서 NVIDIA와 개발하고 cloud partner에 학습을 공유하는 구조이지, 발표만으로 모든 cloud에 공통 배포된 표준이 된 것은 아니다. IcePack·IceCube는 이번에 공개한 차세대 hardware이고, OSPA는 OCP에 제출된 새 initiative다.[1] **발표, 내부 배포, 공개 specification, 후보안, 향후 채택 계획은 같은 성숙도 표지가 아니다.**

## 세 평면은 거리보다 책임으로 나눈다

세 평면을 단순히 `짧음·중간·김`으로 분류하면 경계가 흐려진다. 이 글에서는 다음 질문으로 구분한다.

| 평면 | 주된 범위 | 보호하려는 것 | 대표 장애 단위 | 먼저 봐야 할 신호 |
|---|---|---|---|---|
| scale-up | rack 또는 pod 안 accelerator domain | 매우 짧은 지연과 accelerator 간 진행 | link·switch blade·accelerator·rack | link retry, FEC, queue, endpoint stall |
| scale-out | 여러 domain을 묶는 cluster backend fabric | collective의 균형과 fabric 가용성 | NIC·plane·leaf/spine·fabric | plane별 loss/ECN, path imbalance, collective tail |
| scale-across | 건물·campus·region 사이 | 제한된 장거리 capacity와 locality | fiber·BAG·site·region | RTT, headroom, available bandwidth, route churn |

표의 범위와 대표 구현은 Meta 발표에서 가져왔지만, “보호하려는 것”과 운영 신호는 이 글의 분석이다.[1] 핵심은 장애가 발생한 물리 위치가 아니라 **누가 탐지하고, 어느 범위까지 우회하며, 어떤 상위 scheduler에 capacity 저하를 알릴 책임이 있는가**다.

Scale-up에서 한 link의 microburst는 accelerator의 연산 진행을 바로 늦출 수 있다. Scale-out에서 한 plane의 성능 저하는 다른 plane이 살아 있어도 packet 분산의 비대칭으로 collective tail을 늘릴 수 있다. Scale-across에서 region 간 경로가 degraded되면 routing은 연결 가능 상태를 유지해도, 멀리 떨어진 replica를 계속 같은 비율로 쓰는 배치는 경제적이지 않을 수 있다. 세 경우 모두 “ping 성공”으로는 부족하지만, 같은 alert와 같은 복구 절차를 써서도 안 된다.

## Scale-up: rack 안의 빠른 길도 독립된 failure domain이다

Meta가 정의한 scale-up domain은 rack 또는 pod 안 accelerator 사이의 고대역폭·초저지연 interconnect다. Tahan은 Broadcom Tomahawk 5 기반 51.2 Tbps Ethernet switch로, 64×800G 총 capacity 가운데 절반을 backplane을 통한 accelerator 연결에 사용한다. 네 대의 Tahan이 16개 accelerator를 non-blocking topology로 연결하며, Meta는 scale-out과 같은 routed IPv6·PFC·AI-tuned QoS 기반 lossless RoCE transport를 재사용한다고 설명한다.[1]

“같은 transport를 재사용한다”는 말은 scale-up과 scale-out의 운영 목표가 같다는 뜻이 아니다. Scale-up은 accelerator가 촘촘히 결합된 domain이므로 한 구성 요소의 성능 저하가 해당 rack의 collective 진행을 직접 제한할 수 있다. 링크가 완전히 down되기 전 FEC correction 증가, 신호 품질 저하, 특정 egress queue의 지속 점유, 반복되는 link retrain이 나타날 수 있다. 따라서 rack owner는 단순한 up/down보다 **성능이 나빠진 구성 요소를 domain에서 제외할 수 있는지**를 먼저 정의해야 한다.

OCP ESUN 1.0은 2026년 2월 공개된 network operator requirements의 초기 base specification이다. 범위는 XPU endpoint의 memory ordering이나 workload partition 전체가 아니라 scale-up network controller와 switch가 제공해야 할 network 측 기능이며, Ethernet framing, lossless delivery, error handling, congestion management 요구를 다룬다.[2] ESUN 문서는 functional baseline을 제공하지만, 특정 accelerator가 이를 구현했고 여러 vendor 조합이 상호운용 검증을 마쳤다는 보증서는 아니다.[2]

이 구분은 Meta의 다음 세대 발표를 읽을 때 특히 중요하다. Meta는 102.4 Tbps Tomahawk6C 기반 216×400G blade 여덟 대로 rack당 72개 accelerator를 연결하는 설계를 **preview**했고, 그보다 미래 세대가 ESUN을 scale-up data plane으로 채택할 **계획**이라고 밝혔다.[1] 현재 shipping이라고 표현된 것은 Tahan이며, 72-accelerator 설계와 future ESUN adoption까지 현재 가용한 동일 제품으로 묶어서는 안 된다.

Scale-up 운영 책임은 세 층으로 나눌 수 있다. Accelerator·NIC owner는 endpoint stall과 retry를, switch·platform owner는 port error·FEC·queue·thermal과 firmware lifecycle을, training runtime owner는 accelerator 제외 뒤 job 재구성 여부를 맡는다. 이는 OCP 표준이 아니라 운영 제안이다. 공통 incident key에 rack, switch blade, port, accelerator, job step을 연결하지 않으면 세 팀은 같은 사건을 각각 link 정상, step 지연, kernel 대기로 처리하게 된다.

PFC가 켜져 있다는 사실만으로 lossless 운영이 완성되지는 않는다. Scale-up 시험에서는 receiver slowdown과 link error recovery를 주입해 **정상 domain 밖으로 backpressure가 얼마나 퍼지는지** 측정해야 한다.

## Scale-out: plane가 많아지면 장애가 사라지는 것이 아니라 보인다

Scale-out은 여러 accelerator domain을 하나의 backend cluster로 묶는 fabric이다. Meta의 FPF는 기존 NSF의 3-tier Clos를 2-tier Clos로 평탄화하고, 각 GPU를 서로 다른 switch에 연결된 8개의 독립 100G link, 즉 8개 network plane에 연결한다. NIC가 packet을 8개 plane에 hardware로 분산하고, host와 switch를 함께 포함한 control plane이 down된 plane을 피해 steering하도록 설계됐다고 Meta는 설명한다.[1]

이 구조의 중요한 변화는 link 수가 아니라 **host도 fabric control loop에 들어온다**는 점이다. Switch가 ECMP만 수행하는 모델에서는 network team이 path 선택을 대부분 소유할 수 있다. FPF에서는 NIC의 packet spraying과 host steering이 실제 plane 사용을 바꾸므로, host software와 NIC firmware, switch state 사이에 하나의 관찰 계약이 필요하다. Plane 장애를 switch만 알거나 host만 알면 우회가 늦거나 서로 다른 결론으로 oscillation이 생길 수 있다.

Multiplane은 fault tolerance를 제공하지만 “한 plane이 죽어도 무조건 영향이 없다”는 뜻은 아니다. 완전 down은 비교적 분명하다. 더 어려운 경우는 packet loss·ECN·지연·available capacity가 plane마다 어긋나는 degraded state다. NIC가 모든 plane에 동일하게 packet을 뿌리는데 한 plane만 느리면 out-of-order와 tail이 늘 수 있고, 그 plane을 너무 빨리 제외하면 남은 plane에 load가 몰린다. 복구 직후 즉시 원래 비율로 되돌리면 flap이 collective 전체로 전파될 수 있다.

따라서 scale-out의 상태 모델은 `healthy/down` 두 값보다 다음에 가까워야 한다.

```text
plane_state = healthy | degraded | draining | isolated | recovering
observed = loss, ECN, RTT, queue, link capacity, host delivery progress
policy = steering weight, isolation threshold, damping window, return ramp
```

이 schema는 Meta가 공개한 FPF API가 아니라 이 글의 운영 제안이다. 공개 발표는 host가 downed plane을 피할 수 있다고 설명하지만, 구체적인 field와 threshold를 공개하지 않는다.[1] 구현자는 추측한 `plane_health` API를 표준처럼 만들지 말고 실제 NIC·FBOSS·switch interface가 노출하는 값과 미지원 상태를 구분해야 한다.

FPF 발표는 NVIDIA Spectrum-X Multiplane 기술과 함께 Meta infrastructure 안에서 개발됐고, joint cloud partner가 FPF 학습을 바탕으로 multiplane 구현을 표준화하도록 협력 중이라고 설명한다.[1] 이것은 partner enablement의 방향을 보여 주지만, cloud별 topology·buffer·traffic class·RDMA transport가 이미 동일하다는 뜻은 아니다. Meta도 cloud 환경은 topology, shallow buffering, congestion/loss 동작, RDMA transport가 서로 다르다고 적고, 공통 point-to-point 및 collective benchmark와 traffic-class·congestion parameter normalization이 필요하다고 밝혔다.[1]

Scale-out acceptance test도 최고 throughput 한 숫자로 끝내면 안 된다. Plane별 link 제거, loss, switch lifecycle event를 주입하고 NIC와 switch의 상태가 일치하는지, steering이 다른 plane의 queue·ECN을 얼마나 늘리는지, 격리된 plane이 ramp와 damping을 거쳐 복귀하는지 확인한다. 이는 Meta의 공식 conformance suite가 아니라, **부분 장애 때 여러 관찰자와 control loop가 한 가지 안전한 수렴을 만드는지** 보는 운영 검증안이다.

## Scale-across: 거리와 locality가 control plane의 입력이 된다

Scale-across는 cluster를 건물, campus, region에 걸쳐 연결한다. Meta의 BAG는 여러 spine-layer fabric을 잇는 중앙 Ethernet super-spine layer다. Prometheus 사례에서 BAG는 서로 다른 DSF와 NSF fabric을 연결하고, region pair의 inter-BAG capacity가 16~48 Pbps 범위에 이를 수 있다고 Meta는 보고했다.[3] 이 수치는 Meta 설계의 공개값이지 일반적인 multi-region cluster의 기준 용량이 아니다.

Scale-across에서 거리는 배경 정보가 아니라 buffer와 scheduling 입력이다. Meta는 lossless Ethernet의 buffer headroom이 cable length의 영향을 받기 때문에 FBOSS가 혼잡하지 않은 queue에 probe를 보내 round-trip distance를 측정하고, 그 측정값에 맞춰 headroom을 할당한다고 설명한다.[1] BAG는 eBGP link-bandwidth signaling으로 실제 available capacity에 비례해 traffic을 배분하고, 단일 link failure의 routing churn이 넓게 퍼지지 않도록 damping을 둔다.[1]

BAG의 physical topology도 failure domain을 바꾼다. Meta의 별도 설명에 따르면 planar inter-BAG 연결은 plane을 따라 switch를 일대일로 잇기 때문에 관리가 단순한 대신 잠재 장애 영역이 집중될 수 있고, spread topology는 여러 BAG switch와 plane에 link를 분산해 path diversity와 resilience를 높인다.[3] 따라서 region pair의 총 bandwidth가 같아도 어떤 fiber·switch·plane을 공유하는지에 따라 실제 장애 반경은 다르다.

이 평면에서 “route가 있다”는 것은 최소 조건일 뿐이다. Inter-fabric latency가 intra-fabric보다 커지면 distance를 모르는 collective algorithm이 부적절한 path를 선택할 수 있다. Meta는 adaptive routing으로 latency penalty를 줄이는 동시에 scheduler가 BAG를 건너는 collective traffic 자체를 줄이는 방향을 설명한다.[1] 즉 scale-across congestion은 network team이 routing만 조정해서 끝낼 문제가 아니라 placement·replica 구성·collective algorithm이 함께 다뤄야 할 자원 문제다.

운영 책임도 두 control loop로 나누는 편이 안전하다.

- **Network loop**는 fiber·link·BAG·route의 상태, RTT, available bandwidth, headroom, churn을 관리한다.
- **Workload loop**는 그 상태를 받아 job placement, replica 수, cross-site traffic budget, checkpoint·재시작 결정을 관리한다.

Network loop가 “연결 가능”만 내보내고 workload loop가 region 간 비용을 모르면 살아 있지만 느린 path를 계속 사용한다. 반대로 scheduler가 순간 RTT만 보고 replica를 이동하면 transient congestion이 대규모 재배치로 증폭될 수 있다. 두 loop 사이에는 raw counter가 아니라 `site-pair capacity`, `latency class`, `degraded reason`, `valid-until`, `confidence` 같은 versioned contract가 필요하다. 이는 Meta가 공개한 BAG API가 아니라 이 글의 제안이다.

Scale-across 복구 시험에서는 region pair의 capacity 감소, latency 증가, route flap, telemetry 지연을 따로 주입한다. 복구 완료도 BGP session up이 아니라 **허용한 cross-site traffic budget과 collective tail 범위로 돌아왔는지**로 판정한다.

## Congestion control은 평면마다 닫힌 loop를 가져야 한다

세 평면이 Ethernet과 RDMA를 공유하면 하나의 congestion profile을 복사하고 싶어진다. 그러나 feedback의 거리, 관찰 단위, 효과를 적용하는 주체가 다르다.

- Scale-up은 짧은 domain에서 endpoint와 switch가 빠르게 반응해야 하며, 한 receiver의 정체가 rack 전체 pause로 확대되는지를 본다.
- Scale-out은 여러 path와 plane 사이의 분산이 핵심이며, per-plane imbalance와 out-of-order를 함께 본다.
- Scale-across는 긴 RTT와 제한된 장거리 link를 고려해 path별 capacity와 fairness, routing damping, workload locality를 함께 본다.

MetaRoCE 발표는 이 차이를 endpoint 중심 transport로 다루려는 시도다. Meta는 packet이 여러 path에 분산돼 out of order로 도착하는 것을 정상으로 보고, endpoint가 logical path별 RTT·ECN·utilization telemetry를 유지한다고 설명한다.[4] Scale-up에서는 reorder buffer와 PFC 의존을 줄이는 방향을, scale-across에서는 path를 first-class entity로 다루고 장거리 contention을 공정하게 나누는 과제를 제시했다.[4]

여기에도 성숙도 경계가 있다. Meta는 2026년 8월 specification, DPDK 기반 reference implementation, production compliance framework를 OCP Summit에서 공개하겠다고 예고했고, 10월 발표에서는 open-source implementation을 발표했다고 밝혔다.[4][1] 이로부터 모든 NIC·switch가 MetaRoCE를 지원하거나 OCP가 interoperability를 인증했다는 결론은 나오지 않는다. Specification 공개, reference code 존재, vendor implementation, hardware offload, multi-vendor conformance, production deployment는 각각 별도 증거가 필요하다.

또한 transport telemetry가 switch telemetry를 대체하지 않는다. Endpoint는 path별 진행과 RTT를 잘 볼 수 있지만 어느 optic의 FEC가 악화됐는지, 어느 switch queue가 잘못 매핑됐는지, power·thermal event가 port에 영향을 줬는지는 platform 관찰이 필요하다. 반대로 switch counter만으로는 특정 collective가 왜 느린 path에 묶였는지 알기 어렵다. Incident timeline에는 endpoint path ID, network plane, switch·port, job·collective ID를 함께 연결해야 한다.

## Open interface는 한 층이 아니라 세 층이다

“Open networking”도 하나의 상태가 아니다. Meta가 사용하는 FBOSS는 switch CPU에서 동작하는 modular software stack이며, agent와 여러 microservice로 switch를 제어한다.[5] OCP SAI는 switching ASIC·NPU·software switch 같은 forwarding element를 vendor-independent 방식으로 제어하기 위한 API다.[6] 두 프로젝트는 switch data plane programmability와 network OS portability의 경계를 연다.

그러나 switch ASIC 위 software가 portable해도 power sequencing, sensor, fan, inventory, out-of-band interface, firmware update 같은 platform layer는 hardware별 통합 작업으로 남을 수 있다. OSPA는 이 틈을 대상으로 power management, hardware access·inventory, environment control, firmware maintenance·recovery, debugging, security의 reference architecture를 정의하려는 OCP 작업이다.[7]

OSPA 상태를 “완성된 업계 표준”이라고 쓰면 안 된다. OCP의 2026년 공지는 Meta·Microsoft·Alibaba가 시작한 **in-progress contribution**이며 Revision 1.0.0 candidate가 OCP contribution process에서 Foundation review 중이라고 명시한다.[7] Meta 발표의 “specification v1.0 submitted”도 제출을 뜻하지 승인·구현·상호운용 완료를 뜻하지 않는다.[1]

Hardware 자체의 open base도 별도 층이다. IcePack은 OCP Open Rack V3 HPRv1 기반이라고 Meta가 설명하고, IceCube는 128×800G non-blocking capacity의 102.4 Tbps switch blade로 Tomahawk6C와 Spectrum-6 두 variant를 제시한다.[1] Open Rack V3 base specification은 rack frame family의 기계·전력 상호 결합 요구를 정의한다.[8] Rack 규격 준수, switch platform interface, SAI 지원, FBOSS port가 모두 같은 “호환”을 의미하지 않는다.

따라서 도입 검토에서는 hardware specification, platform interface, SAI baseline과 extension, upstream·vendor·사내 FBOSS fork, transport specification·reference implementation·offload·conformance, telemetry·upgrade·rollback owner를 각각 기록해야 한다. 이는 OCP maturity model이 아니라 “Open” 한 칸 뒤에 숨은 구현·시험·지원 책임을 드러내기 위한 운영 제안이다.

## 한 대시보드가 아니라 평면 간 handoff를 설계한다

세 평면의 metric을 한 화면에 모으는 것만으로 end-to-end observability가 생기지는 않는다. 공통 event에 `job`, `collective`, `accelerator`, `NIC`, `rack`, `plane`, `switch/port`, `fabric`, `site pair`, software·firmware version과 관찰 시각을 연결해야 한다. Scale-up은 제외 가능한 endpoint를 runtime에, scale-out은 plane capacity 감소를 scheduler에, scale-across는 site-pair capacity·latency class를 placement에 전달한다. 이는 공개 표준이 아니라 조직별 관찰 계약이다.

Alarm owner와 remediation owner는 다를 수 있다. Endpoint가 먼저 감지해도 switch 교체는 platform team이 하고, network가 scale-across congestion을 찾아도 traffic 감축은 scheduler가 결정할 수 있다. Alert에는 이상 신호뿐 아니라 **안전하게 적용 가능한 action과 만료 시각**이 있어야 한다.

## 배포 gate는 세 평면을 따로 망가뜨려야 한다

새 switch, NIC firmware, FBOSS build, congestion profile, transport를 한 번에 검증하면 실패 원인을 찾기 어렵다. Scale-up에는 receiver slowdown·FEC 증가·blade restart를, scale-out에는 plane loss·degradation·복귀를, scale-across에는 site-pair capacity 감소·RTT 증가·route flap을 주입한다. 이어 rack drain이 scale-out과 scale-across capacity에 중복 반영되지 않는지와 endpoint부터 scheduler까지 한 timeline을 재구성할 수 있는지를 교차 시험한다.

통과 기준은 최고 bandwidth가 아니다. **영향이 예상한 failure domain 안에 머무는지, congestion feedback이 다른 평면으로 번지지 않는지, telemetry가 같은 사건을 가리키는지, owner가 정해진 시간 안에 격리·복귀하는지**를 본다. 공개되지 않은 Meta threshold를 추측하지 말고 자기 topology와 workload에서 baseline을 만든다.

## 결론: 최고 링크 속도보다 경계의 품질을 본다

Meta의 2026년 발표는 102.4T IceCube, liquid-cooled IcePack, Tahan, FPF, BAG, SRv6 backbone, MetaRoCE, ESUN, OSPA를 한 자리에서 보여 준다.[1] 중요한 것은 목록이 길어진 사실보다 scale-up·scale-out·scale-across가 서로 다른 문제를 해결한다는 점이다.

Scale-up은 rack 안 accelerator domain의 짧은 feedback과 진행을 지킨다. Scale-out은 여러 plane에서 부분 장애와 load imbalance를 수렴시킨다. Scale-across는 거리·buffer·available capacity를 routing과 workload locality의 입력으로 만든다. 세 평면은 transport와 switch software를 공유할 수 있지만 failure domain, congestion loop, telemetry, remediation owner까지 같아지지는 않는다.

Open specification도 배포 완료를 대신하지 않는다. ESUN 1.0은 공개된 초기 network 요구 specification이고, OSPA 1.0.0 candidate는 review 중인 contribution이며, Meta의 차세대 72-accelerator 설계와 future ESUN adoption은 preview와 계획이다.[2][7][1] FBOSS·SAI·MetaRoCE가 열어 놓은 interface마다 실제 hardware 지원, conformance, upgrade, rollback, support owner를 별도로 확인해야 한다.

결국 AI infrastructure의 확장성은 한 링크의 최고 속도보다 **어느 평면이 느려졌는지 알아내고, 장애를 그 평면에 가두고, 남은 capacity를 상위 scheduler에 정확히 전달하며, 복구 때 안전하게 traffic을 되돌리는 능력**에서 나온다. 세 평면을 하나의 bandwidth 숫자로 합치지 않을 때 비로소 네트워크는 accelerator의 부속품이 아니라 운영 가능한 분산 시스템이 된다.

## Sources

[1] https://engineering.fb.com/2026/10/12/open-source/ocp-summit-2026-powering-ai-with-open-innovations-in-scale-up-scale-out-and-scale-across-networks/
[2] https://www.opencompute.org/documents/ocp-esun-network-operator-requirements-base-specification-rev-1-0-final-pdf/
[3] https://engineering.fb.com/2026/02/09/data-center-engineering/building-prometheus-how-backend-aggregation-enables-gigawatt-scale-ai-clusters/
[4] https://engineering.fb.com/2026/08/24/networking-traffic/metaroce-rdma-transport-ai-ethernet/
[5] https://facebook.github.io/fboss/docs/about_fboss/
[6] https://github.com/opencomputeproject/SAI
[7] https://www.opencompute.org/news/introducing-ospa-unifying-the-switch-platform-layer-for-open-networking/
[8] https://www.opencompute.org/documents/open-rack-base-specification-version-3-pdf/
