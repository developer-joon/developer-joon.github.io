---
title: 'NGINX Gateway Fabric AccessPolicy 실전: Gateway 전체 차단과 Route별 허용을 분리한다'
date: 2026-11-04 09:00:09 +0900
categories: ["개발/도구"]
description: 'NGINX Gateway Fabric 2.8.0의 v1alpha1 AccessPolicy로 Gateway denylist와 HTTPRoute allowlist를 분리하고 client IP rewrite 경계를 검증합니다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-nginx-blog-allow-and-block-client-ips-in-nginx-gateway-fabric-with-accesspolicy/1600/900'
tags: [nginx-gateway-fabric, gateway-api, accesspolicy, kubernetes, cidr, zero-trust]
---

![큰 관문 아래 여러 차선이 갈라지는 도로](https://picsum.photos/seed/news-2026-11-04-nginx-blog-allow-and-block-client-ips-in-nginx-gateway-fabric-with-accesspolicy/1600/900)

NGINX Gateway Fabric 2.8.0의 AccessPolicy는 Gateway, HTTPRoute, GRPCRoute에 client IP 또는 CIDR 기반 Allow·Deny rule을 붙인다. API version은 `gateway.nginx.org/v1alpha1`이므로 이후 release에서 field가 바뀔 수 있다.[1]

정책 설계의 핵심은 범위다. Gateway에 붙인 inherited policy는 연결된 모든 route에 적용되고 route policy는 해당 route에만 적용된다.[1] 공통 차단과 application별 허용을 한 policy로 합치지 않아야 변경 영향과 실패 원인을 읽을 수 있다.

## 두 policy를 분리한다

아래 manifest는 **제안 fixture이며 cluster에서 실행한 결과가 아니다**. 문서용 TEST-NET 주소를 사용하므로 실제 허용 대역으로 교체해야 한다.

```yaml
apiVersion: gateway.nginx.org/v1alpha1
kind: AccessPolicy
metadata:
  name: gateway-denylist
spec:
  targetRefs:
  - group: gateway.networking.k8s.io
    kind: Gateway
    name: gateway
  action: Deny
  rules:
  - name: blocked-range
    source:
      type: IPAddress
      ipAddress:
        address: 198.51.100.0/24
```

Gateway denylist는 모든 attached route에 공통인 위협 대역을 막는다. Application별 office-only 조건은 HTTPRoute에 별도 allowlist로 둔다.

```yaml
apiVersion: gateway.nginx.org/v1alpha1
kind: AccessPolicy
metadata:
  name: coffee-allowlist
spec:
  targetRefs:
  - group: gateway.networking.k8s.io
    kind: HTTPRoute
    name: coffee
  action: Allow
  rules:
  - name: office-v4
    source:
      type: IPAddress
      ipAddress:
        address: 192.0.2.0/24
```

공식 예시는 `kubectl describe accesspolicies.gateway.nginx.org`에서 `Accepted=True`를 확인하고, 유효한 policy가 target을 가리키면 Gateway에도 `AccessPolicyAffected` condition이 생긴다고 설명한다.[1] Resource가 생성됐다는 사실만 보지 말고 controller condition과 observed generation을 확인한다.

## 조합 결과를 matrix로 검증한다

| Client | Gateway denylist | Route allowlist | 기대 |
|---|---:|---:|---|
| office CIDR | 통과 | 허용 | 2xx |
| 외부 일반 IP | 통과 | 불허 | 차단 |
| deny CIDR | 차단 | 무관 | 차단 |
| IPv6 office | 별도 rule 필요 | 구성에 따름 | 명시값 |

각 요청에서 source IP, Host, path, response status, matched policy·rule을 기록한다. 한 pod 안에서 `curl`한 결과는 외부 client 경로를 대표하지 않는다.

## 앞단 proxy가 있으면 입력 주소부터 검증한다

Load balancer나 CDN 뒤에서는 NGINX가 socket peer, forwarded header, PROXY protocol 중 어느 값을 client IP로 채택하는지가 policy 결과를 결정한다. `rewriteClientIP` 설정 전후로 known canary client를 호출하고 access log에서 policy input이 기대한 주소인지 확인한다.

신뢰할 proxy 목록이 너무 넓으면 공격자가 전달한 header를 client identity로 오인할 수 있다. 반대로 rewrite를 하지 않으면 모든 요청이 load balancer 주소로 보여 allowlist 전체가 무력화되거나 정상 사용자가 함께 차단될 수 있다. Policy manifest 검증과 client-IP provenance 검증은 별도 gate다.

## 보안 경계

IP allowlist는 application 인증을 대체하지 않는다. NAT·VPN·공유 proxy에서는 여러 사용자가 같은 주소를 쓰며, 허용 대역 안의 침해 host도 통과한다. AccessPolicy는 coarse network gate로 쓰고 사용자·workload identity, authorization, audit log를 함께 유지한다.

또한 `v1alpha1` status를 감안해 CRD와 controller image version을 고정한다. Upgrade 전에는 schema diff, dry-run apply, condition, IPv4·IPv6 matrix, rollback manifest를 확인한다.[1]

좋은 정책은 YAML 한 장이 아니라 범위와 입력 신호가 설명되는 정책이다. Gateway 공통 deny와 route별 allow를 분리하고, 앞단 proxy가 만든 client IP를 먼저 검증해야 “허용된 주체”가 실제 요청자와 일치한다.

## Sources

[1] https://blog.nginx.org/blog/allow-and-block-client-ips-in-nginx-gateway-fabric-with-accesspolicy
