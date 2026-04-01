---
title: 'Mistral Small 4 — 119B 파라미터 MoE, 4개 모델 통합한 오픈소스 AI'
date: 2026-04-02 00:00:00
description: 'Mistral AI가 출시한 Mistral Small 4는 119B 파라미터 MoE 구조로 추론, 멀티모달, 코딩을 단일 모델에 통합했습니다. Apache 2.0 라이선스, 40% 빠른 레이턴시, 3배 높은 처리량을 자랑하는 오픈소스 AI의 새로운 기준을 분석합니다.'
featured_image: '/images/mistral-small-4-open-source-ai/cover.jpg'
tags: [ai, open-source, llm, mistral, moe]
---

![Mistral Small 4](/images/mistral-small-4-open-source-ai/cover.jpg)

2026년 3월 16일, Mistral AI가 **Mistral Small 4**를 출시했습니다. 119B 파라미터 Mixture-of-Experts (MoE) 구조로, **4개의 특화 모델을 단일 배포에 통합**한 오픈소스 AI입니다. Apache 2.0 라이선스로 공개되며, **40% 빠른 레이턴시, 3배 높은 처리량**을 달성했습니다.

## 4개 모델의 통합 — 하나로 끝내는 AI

Mistral Small 4는 이전에 **별도로 관리해야 했던 4개 모델 계열**을 하나로 합쳤습니다:

1. **Mistral Small** — 빠른 명령 수행 (instruction following)
2. **Magistral** — 단계별 추론 (step-by-step reasoning)
3. **Pixtral** — 멀티모달 이해 (텍스트 + 이미지)
4. **Devstral** — 에이전트 코딩 워크플로

이제 개발자는 **작업별로 모델을 선택하거나 라우팅할 필요 없이**, 단일 배포로 다음을 모두 처리할 수 있습니다:
- 일반 대화
- 문서 분석
- 코드 생성
- 복잡한 추론 작업

이는 **운영 복잡도를 대폭 낮추고, 인프라 비용을 절감**하는 실용적 설계입니다.

## MoE 아키텍처 — 119B 파라미터, 6.5B만 활성화

Mistral Small 4는 **세밀한 MoE (Mixture-of-Experts)** 구조를 사용합니다:

- **총 파라미터**: 119B
- **전문가(Experts) 수**: 128개
- **토큰당 활성 전문가**: 4개
- **토큰당 활성 파라미터**: 6.5B (임베딩 레이어 포함 8B)
- **컨텍스트 윈도우**: 256K 토큰
- **입력**: 텍스트 + 이미지

이는 **거대한 파라미터를 유지하면서도 추론 비용을 낮게 유지**하는 전략입니다. 매 토큰마다 관련 전문가만 활성화되므로, 풀 모델 대비 **계산량이 훨씬 적습니다.**

### 성능 vs 비용 트레이드오프
일반적인 밀집(Dense) 모델:
- GPT-4급: 수백 B 파라미터 전체 활성화 → 비싸고 느림

Mistral Small 4 MoE:
- 119B 총 파라미터, 6.5B만 활성화 → 프론티어급 성능 + 낮은 비용/지연

## 성능 벤치마크

### 1. 전작 대비 개선
Mistral Small 3 대비:
- **레이턴시**: 40% 감소 (레이턴시 최적화 설정)
- **처리량**: 3배 증가 (처리량 최적화 설정)

### 2. GPT-OSS 120B와 비교
다음 벤치마크에서 GPT-OSS 120B와 동등하거나 우수:
- **AA LCR**: 0.72 점 (출력 1.6K 문자)  
  → Qwen 모델은 비슷한 점수에 5.8-6.1K 문자 필요
- **LiveCodeBench**: GPT-OSS 120B 초과, 출력 20% 적음
- **AIME 2025**: 비슷하거나 높은 점수

특히 **짧고 간결한 출력**으로 동등한 성능을 낸다는 점이 중요합니다. 토큰 비용, 레이턴시, 사용자 경험 모두 개선됩니다.

## 설정 가능한 추론 깊이 — `reasoning_effort`

Mistral Small 4의 가장 혁신적인 기능은 **요청별 추론 깊이 제어**입니다:

```python
# 빠른 응답 (Mistral Small 3.2 수준)
response = client.chat(
    model="mistral-small-4",
    messages=[{"role": "user", "content": "Hello"}],
    reasoning_effort="none"
)

# 깊은 추론 (Magistral 수준)
response = client.chat(
    model="mistral-small-4",
    messages=[{"role": "user", "content": "복잡한 수학 문제"}],
    reasoning_effort="high"
)
```

### 실전 활용 전략
- **간단한 질문**: `reasoning_effort="none"` → 빠르고 저렴
- **복잡한 추론**: `reasoning_effort="high"` → 정확도 우선
- **API 단일화**: 별도의 빠른 모델 + 추론 모델 배포 불필요

이는 **인프라 복잡도를 크게 줄이고, 운영 오버헤드를 제거**합니다. 하나의 엔드포인트로 모든 작업을 처리할 수 있습니다.

## 셀프 호스팅 — 상대적으로 낮은 하드웨어 요구사항

119B 파라미터 모델치고는 **비교적 적은 GPU로 실행 가능**합니다:

### 최소 요구사항
- 4x NVIDIA HGX H100
- 2x HGX H200
- 1x DGX B200

### 지원 프레임워크
- **vLLM** (추천 — 빠르고 효율적)
- **llama.cpp** (로컬 배포, 양자화 지원)
- **SGLang**
- **Transformers**

### 배포 옵션
- Mistral API (클라우드)
- Azure AI Studio
- Hugging Face
- **NVIDIA build.nvidia.com** (무료 프로토타이핑)
- **NVIDIA NIM 컨테이너** (프로덕션 배포)

특히 NVIDIA NIM 컨테이너는 **엔터프라이즈 프로덕션 환경에 최적화**되어 있으며, 자동 스케일링, 모니터링, 보안이 내장되어 있습니다.

## Apache 2.0 라이선스 — 진짜 오픈소스

Mistral Small 4는 **Apache 2.0 라이선스**로 공개됩니다. 이는:
- ✅ 상업적 사용 가능
- ✅ 수정 및 재배포 가능
- ✅ 파생 작품 생성 가능
- ✅ 소스 코드 공개 의무 없음

이는 **진정한 오픈소스**입니다. OpenAI가 Astral을 인수하며 오픈소스 커뮤니티의 우려를 산 것과 대조적으로, Mistral AI는 **오픈소스 우선 전략**을 유지하고 있습니다.

### 오픈소스 생태계에 미치는 영향
1. **경쟁 압박**: 상업 모델(GPT, Claude)도 성능을 더 높이거나 가격을 낮춰야 함
2. **연구 가속화**: 연구자들이 119B MoE 구조를 직접 실험 가능
3. **커스터마이징**: 기업이 자체 데이터로 파인튜닝 가능
4. **투명성**: 모델 가중치, 아키텍처, 학습 방법 공개

## 멀티모달 지원 — 텍스트 + 이미지

Mistral Small 4는 **네이티브 멀티모달** 입력을 지원합니다. Pixtral 모델 계열의 능력을 통합해:
- 이미지 설명
- 차트/그래프 분석
- 문서 스캔 파싱
- 코드 스크린샷 이해

이는 **별도의 비전 모델 없이** 텍스트와 이미지를 함께 처리할 수 있음을 의미합니다.

## 실전 활용 시나리오

### 1. 스타트업 — 단일 모델로 모든 작업
기존:
- 일반 채팅: GPT-4o
- 추론: Claude Opus
- 코딩: GPT-5.3-Codex
→ 여러 API 키, 복잡한 라우팅, 높은 비용

Mistral Small 4:
- **단일 배포**로 모든 작업 처리
- 셀프 호스팅으로 **API 비용 제로화**
- `reasoning_effort` 로 요청별 최적화

### 2. 기업 — 온프레미스 배포
규제 산업(금융, 헬스케어)에서:
- 데이터 외부 유출 금지
- 클라우드 API 사용 불가
- 셀프 호스팅 필수

Mistral Small 4 + NVIDIA NIM:
- 프라이빗 데이터센터에 배포
- Apache 2.0 라이선스로 법적 부담 없음
- 256K 컨텍스트로 대용량 문서 처리

### 3. 연구자 — 커스터마이징
- 특정 도메인(의료, 법률, 과학)에 파인튜닝
- MoE 구조 실험 (전문가 수, 라우팅 전략)
- 지식 증류(Knowledge Distillation)로 더 작은 모델 생성

## 경쟁 구도 — Mistral vs 클로즈드 모델

| 기능 | Mistral Small 4 | GPT-5.4 | Claude Opus 4.6 |
|------|-----------------|---------|-----------------|
| 파라미터 | 119B (6.5B 활성) | 비공개 | 비공개 |
| 라이선스 | Apache 2.0 | 독점 | 독점 |
| 셀프 호스팅 | ✅ | ❌ | ❌ |
| 컨텍스트 | 256K | 1M (실험적) | 200K |
| 멀티모달 | ✅ | ✅ | ✅ |
| 추론 제어 | `reasoning_effort` | 고정 | 고정 |
| 가격 | 무료 (셀프) | $2.5/M | $15/M |

### Mistral의 전략적 우위
1. **진짜 오픈소스** — 투명성, 커스터마이징 가능
2. **설정 가능한 추론** — 단일 모델로 다양한 작업
3. **비용 효율성** — 셀프 호스팅 시 API 비용 제로
4. **규제 산업 대응** — 데이터 주권, 프라이버시 보장

### 클로즈드 모델의 우위
1. **더 긴 컨텍스트** — GPT-5.4는 1M 토큰 (실험적)
2. **툴 에코시스템** — OpenAI의 툴 서치, Codex 통합
3. **사용 편의성** — API로 즉시 사용 가능, 인프라 관리 불필요

## 한계 및 과제

### 1. 하드웨어 장벽
119B MoE 모델은 여전히 **H100급 GPU**가 필요합니다. 개인 개발자나 소규모 스타트업에게는 진입 장벽이 높습니다.

**대안**:
- 양자화(Quantization)로 더 작은 GPU에서 실행 (llama.cpp)
- 클라우드 API 사용 (Mistral API, Azure AI Studio)
- NVIDIA build.nvidia.com에서 무료 프로토타이핑

### 2. 256K 컨텍스트 vs 1M 컨텍스트
GPT-5.4는 1M 토큰(실험적)을 지원하지만, Mistral Small 4는 256K에 머물러 있습니다. 초장문 작업에서는 불리합니다.

### 3. 툴 생태계 미성숙
OpenAI의 툴 서치, MCP 통합 같은 에이전트 기능은 아직 Mistral 생태계에 부족합니다.

## 결론 — 오픈소스 AI의 새로운 기준

Mistral Small 4는 **오픈소스 AI가 상업 모델과 어깨를 나란히 할 수 있음**을 증명합니다:

1. **4개 모델 통합** — 운영 복잡도 제거
2. **119B MoE** — 프론티어 성능 + 낮은 비용
3. **설정 가능한 추론** — 요청별 최적화
4. **Apache 2.0** — 진짜 오픈소스
5. **40% 빠른 레이턴시, 3배 높은 처리량** — 실전 성능 입증

특히 **규제 산업, 프라이버시 중시 기업, 커스터마이징이 필요한 연구자**에게 이상적입니다. OpenAI와 Anthropic이 클로즈드 전략을 고수하는 동안, Mistral AI는 **오픈소스 우선 접근**으로 차별화하고 있습니다.

앞으로 Mistral이 **툴 생태계, 1M+ 컨텍스트, 더 작은 양자화 모델**을 제공한다면, 오픈소스 AI는 상업 모델의 진정한 대안이 될 것입니다.

## 참고 자료
- [Introducing Mistral Small 4 — Mistral AI 공식 발표](https://mistral.ai/news/mistral-small-4)
- [Mistral Small 4: Four Models Unified — NYU Shanghai](https://rits.shanghai.nyu.edu/ai/mistral-small-4-four-models-unified-in-one-open-source-moe/)
- [mistralai/Mistral-Small-4-119B-2603 — Hugging Face](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603)
- [Mistral Small 4 Review 2026 — ComputerTech](https://computertech.co/mistral-small-4-review/)
- [119B Parameters, 6.5B Activated — BaristaLabs](https://www.baristalabs.io/blog/mistral-small-4-moe-apache-2026)
