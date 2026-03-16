---
title: 'Kubernetes AI Gateway: AI 워크로드 네트워킹의 새 표준'
date: 2026-03-16 00:00:00
description: 'Kubernetes AI Gateway Working Group이 발족했습니다. 토큰 기반 rate limiting, 프롬프트 가드레일, 시맨틱 라우팅 등 AI 워크로드를 위한 네트워킹 표준화 움직임을 정리합니다.'
featured_image: '/images/2026-03-16-Kubernetes-AI-Gateway-Working-Group/cover.jpg'
---

![](/images/2026-03-16-Kubernetes-AI-Gateway-Working-Group/cover.jpg)

## AI 워크로드가 Kubernetes로 몰리고 있다

2026년 3월 9일, Kubernetes 공식 블로그에서 **AI Gateway Working Group**(WG)의 발족이 공식 발표되었습니다. 생성형 AI와 LLM(Large Language Model) 추론 워크로드가 폭발적으로 증가하면서, Kubernetes 위에서 AI 서비스를 운영하는 기업들이 급증했습니다. 하지만 기존 Gateway API는 HTTP/gRPC 같은 전통적인 요청-응답 패턴에 최적화되어 있었고, AI 워크로드의 독특한 요구사항을 충족하기에는 한계가 있었습니다.

**AI 워크로드의 특성**은 무엇일까요?

- **토큰 기반 rate limiting**: HTTP 요청 수가 아닌, LLM이 생성하는 토큰 수로 과금·제한
- **프롬프트 검사 및 가드레일**: 악의적 프롬프트 인젝션 방어, 콘텐츠 필터링
- **시맨틱 라우팅**: 프롬프트 내용에 따라 적절한 모델로 라우팅 (GPT-4, Claude, Gemini 등)
- **응답 캐싱**: 동일 프롬프트 재사용으로 비용 절감
- **멀티 프로바이더 페일오버**: OpenAI 장애 시 Azure OpenAI로 자동 전환
- **외부 AI 서비스 연결**: 클러스터 외부의 OpenAI, Vertex AI, AWS Bedrock 등과 통합

이런 니즈를 체계적으로 해결하기 위해, Kubernetes 커뮤니티는 **AI Gateway Working Group**을 출범시켰습니다.

![](/images/2026-03-16-Kubernetes-AI-Gateway-Working-Group/gateway-api.jpg)

## AI Gateway란 무엇인가?

**AI Gateway**는 Gateway API의 확장으로, **AI 워크로드 전용 네트워킹 표준**입니다. 기존 Gateway API의 기본 라우팅·필터링 기능 위에, AI 특화 기능을 추가합니다.

### Gateway API와의 관계

- **Gateway API**: Kubernetes의 차세대 Ingress 표준. HTTPRoute, GRPCRoute 등 제공
- **AI Gateway**: Gateway API를 기반으로, AI 전용 CRD(Custom Resource Definition)와 정책 확장

즉, **AI Gateway ⊃ Gateway API** 관계입니다. 기존 Gateway API를 사용하는 클러스터에서 AI 기능을 점진적으로 추가할 수 있습니다.

### 핵심 기능

1. **토큰 기반 rate limiting** — OpenAI처럼 "분당 100만 토큰" 제한
2. **페이로드 검사** — 프롬프트/응답 내용 기반 라우팅·캐싱·가드레일
3. **AI 프로토콜 지원** — OpenAI Chat Completions API, Anthropic Messages API, 기타 추론 API
4. **Egress 통합** — 클러스터 외부의 SaaS AI 서비스와 안전하게 연결

![](/images/2026-03-16-Kubernetes-AI-Gateway-Working-Group/ai-workload.jpg)

## Working Group 차터와 미션

**AI Gateway WG의 미션**은 다음과 같습니다:

1. **표준 개발** — AI Gateway의 API 명세, CRD, 정책 모델 정의
2. **커뮤니티 협업** — Gateway API SIG, SIG Network, SIG Security와 협력
3. **확장 가능한 아키텍처** — 벤더 중립적, 플러그인 친화적 구조
4. **실전 검증** — 초기 채택자(early adopter)들과 프로토타입 구현·피드백

WG는 **Slack `#wg-ai-gateway` 채널**과 **목요일 2PM EST 주간 미팅**을 통해 운영되며, GitHub 저장소 [kubernetes-sigs/wg-ai-gateway](https://github.com/kubernetes-sigs/wg-ai-gateway)에서 모든 제안서(proposal)와 설계 문서를 공개합니다.

## 핵심 제안서 상세

현재 가장 활발히 논의되는 제안서는 두 가지입니다.

### 1. Payload Processing (Proposal #7)

**페이로드 검사 및 변환**은 AI Gateway의 핵심 기능입니다.

#### 주요 기능

- **프롬프트 인젝션 방어**: 악의적 지시문 필터링 (예: "ignore previous instructions")
- **콘텐츠 필터링**: 유해 콘텐츠·개인정보 자동 마스킹
- **시맨틱 라우팅**: 프롬프트를 분석해 적절한 모델로 라우팅
  - 코드 생성 요청 → Claude 또는 GPT-4 Turbo
  - 일반 대화 → Gemini Flash
- **지능형 캐싱**: 프롬프트 유사도 기반 응답 재사용
- **RAG(Retrieval-Augmented Generation) 통합**: 벡터 DB 조회 후 컨텍스트 주입

#### 예시: 프롬프트 가드레일

```yaml
apiVersion: gateway.ai.k8s.io/v1alpha1
kind: AIGatewayPolicy
metadata:
  name: prompt-guardrails
spec:
  targetRef:
    kind: HTTPRoute
    name: openai-chat
  payloadProcessing:
    - name: block-injection
      type: GuardRail
      config:
        patterns:
          - "ignore previous instructions"
          - "system prompt override"
        action: reject
```

이 정책을 적용하면, 의심스러운 프롬프트가 AI 모델에 도달하기 전에 차단됩니다.

### 2. Egress Gateways (Proposal #10)

**Egress Gateway**는 클러스터 내부에서 외부 AI 서비스로 나가는 트래픽을 제어합니다.

#### 주요 기능

- **외부 AI 서비스 연결**: OpenAI, Google Vertex AI, AWS Bedrock, Azure OpenAI 등
- **인증 토큰 주입**: API 키를 Secret으로 관리하고 요청마다 자동 주입
- **리전 컴플라이언스**: EU GDPR 준수를 위해 EU 리전 전용 엔드포인트 라우팅
- **페일오버**: 주 프로바이더 장애 시 백업 프로바이더로 자동 전환

#### 예시: 멀티 프로바이더 구성

```yaml
apiVersion: gateway.ai.k8s.io/v1alpha1
kind: AIEgressGateway
metadata:
  name: multi-llm
spec:
  providers:
    - name: openai
      endpoint: https://api.openai.com/v1
      weight: 80
      secretRef:
        name: openai-api-key
    - name: azure-openai
      endpoint: https://<REGION>.openai.azure.com
      weight: 20
      secretRef:
        name: azure-api-key
  failover:
    enabled: true
    retryAttempts: 2
```

이 설정으로 트래픽의 80%는 OpenAI로, 20%는 Azure OpenAI로 전송되며, OpenAI 장애 시 자동으로 Azure로 전환됩니다.

## 실전 시나리오

AI Gateway를 실제 환경에 어떻게 적용할 수 있을까요?

### 시나리오 1: 토큰 기반 rate limiting

**문제**: 사용자가 무한 루프로 LLM 요청을 보내 월 청구서가 폭발했습니다.

**해결**:

```yaml
apiVersion: gateway.ai.k8s.io/v1alpha1
kind: AIRateLimitPolicy
metadata:
  name: token-limits
spec:
  limits:
    - name: per-user
      type: token
      quota: 1000000  # 분당 100만 토큰
      window: 1m
```

이제 사용자는 분당 100만 토큰을 초과하면 `429 Too Many Requests`를 받습니다.

### 시나리오 2: 프롬프트 가드레일

**문제**: 사용자가 악의적 프롬프트로 모델을 공격하려 시도합니다.

**해결**: Payload Processing에서 패턴 기반 차단 (위 예시 참고). 추가로 LLM 기반 의도 분류기를 통해 더욱 정교한 필터링도 가능합니다.

### 시나리오 3: 멀티 프로바이더 페일오버

**문제**: OpenAI API가 다운되어 서비스 중단이 발생했습니다.

**해결**: Egress Gateway에서 자동 페일오버로 Azure OpenAI로 전환. 사용자는 장애를 인지하지 못합니다.

![](/images/2026-03-16-Kubernetes-AI-Gateway-Working-Group/kubecon.jpg)

## KubeCon EU 2026 Amsterdam 미리보기

AI Gateway WG는 **KubeCon + CloudNativeCon Europe 2026 (Amsterdam)**에서 첫 공개 세션을 진행합니다.

**세션**: _"AI'm at the Gate! Introducing the AI Gateway Working Group in Kubernetes"_

### 주요 논의 주제

- **MCP(Model Context Protocol) 통합**: Anthropic이 주도하는 LLM-외부도구 연결 표준과 AI Gateway의 연계
- **에이전트 네트워킹 패턴**: LangChain, AutoGPT 같은 AI 에이전트 워크플로우를 Kubernetes에서 어떻게 오케스트레이션할지
- **초기 구현체 데모**: 벤더들의 프로토타입과 실제 사용 사례

세션은 5월 중순 예정이며, 슬라이드는 이후 CNCF 사이트에 공개됩니다.

## 참여 방법

AI Gateway는 아직 초기 단계이지만, **지금 참여하면 표준 설계에 직접 영향을 줄 수 있습니다**.

### 참여 채널

- **GitHub**: [kubernetes-sigs/wg-ai-gateway](https://github.com/kubernetes-sigs/wg-ai-gateway)
- **Slack**: Kubernetes Slack 워크스페이스 `#wg-ai-gateway` 채널
- **미팅**: 매주 목요일 2PM EST (한국시간 금요일 새벽 4시) — [미팅 노트](https://docs.google.com/document/d/AI-Gateway-WG-Notes)
- **메일링 리스트**: `wg-ai-gateway@kubernetes.io`

### 누가 참여하면 좋을까?

- **플랫폼 엔지니어**: AI 워크로드를 Kubernetes에서 운영 중이거나 계획 중인 팀
- **네트워킹 전문가**: Gateway API나 Service Mesh 경험자
- **AI 엔지니어**: LLM 추론, 프롬프트 엔지니어링, RAG 파이프라인 구축자
- **보안 전문가**: AI 워크로드 보안 정책 수립자

## 마무리

**Kubernetes AI Gateway Working Group**은 AI 워크로드 네트워킹의 표준을 정의하는 중요한 움직임입니다. 토큰 기반 rate limiting, 프롬프트 가드레일, 멀티 프로바이더 페일오버 같은 실전 기능이 표준으로 제공되면, AI 서비스 운영이 훨씬 쉬워질 것입니다.

아직 초기 단계이므로, **지금이 참여하기 가장 좋은 시점**입니다. Gateway API 확장 방식, CRD 설계, 정책 모델 등 핵심 설계가 앞으로 수개월 내에 결정됩니다. 관심 있는 분들은 GitHub 저장소를 watch하고, Slack 채널에 참여해보세요.

KubeCon EU 2026 Amsterdam 세션도 기대됩니다. AI 에이전트 네트워킹 패턴과 MCP 통합은 2026년 하반기 Kubernetes AI 생태계의 판을 바꿀 수 있는 주제입니다.

---

## 참고 출처

- [Kubernetes Blog: Introducing the AI Gateway Working Group](https://kubernetes.io/blog/2026/03/09/ai-gateway-working-group/)
- [GitHub: kubernetes-sigs/wg-ai-gateway](https://github.com/kubernetes-sigs/wg-ai-gateway)
- [Proposal #7: Payload Processing](https://github.com/kubernetes-sigs/wg-ai-gateway/blob/main/proposals/007-payload-processing.md)
- [Proposal #10: Egress Gateways](https://github.com/kubernetes-sigs/wg-ai-gateway/blob/main/proposals/010-egress-gateways.md)
- [KubeCon + CloudNativeCon Europe 2026 Schedule](https://events.linuxfoundation.org/kubecon-cloudnativecon-europe/)
- [Gateway API Documentation](https://gateway-api.sigs.k8s.io/)
