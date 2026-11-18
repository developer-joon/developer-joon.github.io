---
title: '내가 호출한 LLM이 정말 그 모델일까: Anthropic FlashProve로 추론 결과 검증하기'
date: 2026-11-02 09:00:01 +0900
categories: ["AI 보안"]
description: 'Anthropic FlashProve가 모델 가중치와 응답을 zkSNARK로 묶는 방식을 살펴보고, 검증 가능한 범위와 아직 운영 보증으로 볼 수 없는 경계를 정리한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-02-anthropic-research-provable-inference/1600/900'
tags: [anthropic, flashprove, zksnark, provable-inference, llm-security, model-provenance]
---

![어두운 서버실에서 빛나는 증명서 형태의 회로](https://picsum.photos/seed/news-2026-11-02-anthropic-research-provable-inference/1600/900)

LLM API의 응답 품질이 좋아 보여도, 계약한 모델이 실제로 그 응답을 만들었다는 사실까지 증명되지는 않는다. 라우터가 더 싼 모델로 바꿨거나, 중간 시스템이 토큰 스트림을 손댔거나, 운영자가 잘못된 가중치를 배포했을 가능성은 출력만 보고 구분하기 어렵다.

Anthropic이 2026년 11월 2일 공개한 FlashProve는 이 문제를 **암호학적 추론 증명**으로 다루는 오픈소스 연구 프로토타입이다.[1]
Anthropic은 실행 가능한 prover·verifier 코드, Lean 형식화와 증명, protocol 문서와 기술 설명을 Apache 2.0으로 공개했다.[1]
공급자가 특정 모델 가중치에 commitment를 만들고, 각 응답이 그 가중치로 계산됐음을 zkSNARK로 증명하면 사용자는 모델 가중치 자체를 받지 않고도 증명을 확인할 수 있다.[1]

## 검증 대상은 “답이 좋다”가 아니라 “계산이 일치한다”다

FlashProve가 답하려는 질문은 사실성이나 안전성이 아니다. 입력, 출력, 모델 commitment 사이에 정의된 계산 관계가 성립하는지를 확인한다. 잘못된 사실을 자신 있게 생성한 응답도 지정된 모델이 정확히 계산했다면 증명은 유효할 수 있다.

운영 계약을 세 층으로 나누면 혼동을 줄일 수 있다.

| 층 | 확인하는 질문 | FlashProve가 직접 답하는가 |
|---|---|---|
| 모델 동일성 | 약속한 가중치가 응답을 계산했는가 | 연구 범위에서 그렇다 |
| 전송 무결성 | 입력·출력 토큰이 증명과 같은가 | 증명 statement에 묶인 범위에서 그렇다 |
| 답변 품질 | 사실이고 안전하며 유용한가 | 아니다 |

따라서 provable inference는 평가, 필터링, 접근 통제를 대체하지 않는다. 오히려 “어느 모델의 출력을 평가하고 있는가”를 고정하는 기반에 가깝다.

## 공개 수치는 강력하지만 조건이 좁다

Anthropic은 4비트 정수화된 Llama 4 Maverick 400B MoE를 대상으로 단일 H100에서 약 110 tokens/s의 proof 생성 속도, 1,024토큰 요청당 약 19MB proof, vLLM 추론 대비 약 70~95배 GPU 시간 오버헤드를 보고했다.[1]

이 숫자를 상용 API의 일반 성능으로 옮기면 안 된다.

- 문맥 길이는 최대 1,024토큰이다.
- 공개 결과는 정수 연산과 4비트 양자화 조건에 묶여 있다.
- 출력 생성 전체를 실시간으로 감싸는 범용 서비스 지표가 아니다.
- proof 생성 비용은 원래 추론보다 훨씬 크다.
- 측정치는 Anthropic 연구진의 환경에서 나온 공급자 보고치다.

FlashProve는 한 대의 GPU에 맞추기 위해 레이어별 가중치를 나눠 증명하고, 호스트 메모리에서 GPU로 스트리밍한다. 모델 가중치 commitment를 batch마다 반복해서 열지 않는 등 시스템 최적화도 사용한다.[1] 이 설계는 “zkSNARK라서 자동으로 빠르다”가 아니라, 증명 시스템과 GPU 실행을 함께 최적화해야 한다는 뜻이다.

## Lean 증명이 보장하는 범위

Anthropic은 completeness, soundness, zero knowledge라는 상위 보안 명제를 Lean으로 기술하고 기계 검증 가능한 증명을 제공한다고 설명한다.[1]

- **Completeness**: 올바른 statement에서 생성한 proof는 verifier가 받아들인다.
- **Soundness**: 틀린 statement의 위조 proof는 무시할 수 있는 확률을 제외하면 거부된다.
- **Zero knowledge**: 응답에서 이미 알 수 있는 것 외에 모델 가중치 정보가 proof로 누출되지 않는다.

그러나 Lean 명세가 빠른 GPU 구현의 모든 줄을 자동으로 보증한다는 뜻은 아니다. 형식화된 프로토콜과 실제 구현 사이의 연결, 컴파일러와 하드웨어, side channel은 별도 신뢰 경계다. Anthropic도 proof 생성 시간 같은 side channel을 이번 공개 범위 밖으로 두었다.[1]

## 작은 fixture로 확인할 운영 계약

전체 400B 모델 proof를 재현하는 것은 일반 개발팀의 첫 검증 과제로 적합하지 않다. 공개 저장소가 제공하는 작은 fixture를 사용해 다음 상태 전이를 확인하는 편이 낫다. 아래는 **실행 결과가 아니라 제안된 검증 절차**다.

```text
1. 고정된 toy model과 입력으로 model commitment를 만든다.
2. 같은 입력·출력으로 proof를 생성한다.
3. 빠른 verifier와 Lean verifier가 정상 proof를 수락하는지 확인한다.
4. 출력 토큰 한 개를 바꾼 뒤 같은 proof가 거부되는지 확인한다.
5. 다른 model commitment로 바꿨을 때 거부되는지 확인한다.
6. proof byte 한 곳을 훼손했을 때 fail-closed인지 확인한다.
```

결과 기록에는 `model_commitment`, 입력과 출력의 canonical encoding hash, proof hash, verifier 버전, 검증 결과를 함께 남긴다. 단순히 `verified=true`만 저장하면 어느 모델과 어느 토큰 열을 검증했는지 사후에 재구성하기 어렵다.

## 라우터와 batch에서 생기는 실무 문제

실제 서비스에는 한 모델만 있지 않다. 여러 quantization, adapter, tokenizer, system prompt, speculative decoding 설정이 섞인다. 이때 “모델 ID” 문자열 하나로 commitment를 대신하면 안 된다. 증명이 묶는 계산과 운영자가 약속한 제품 구성을 별도 manifest로 연결해야 한다.

또한 proof를 batch 단위로 생성하면 한 요청의 응답 시점과 증명 제공 시점이 달라질 수 있다. 제품은 최소한 다음을 명시해야 한다.

- 응답과 proof가 함께 도착하는가, 나중에 도착하는가
- proof 생성 실패 때 응답도 실패시키는가
- verifier가 모르는 commitment를 만났을 때 허용하는가
- commitment 회전과 폐기 기록을 얼마나 보관하는가
- streaming 응답에서 최종 proof 전 토큰을 신뢰해도 되는가

고위험 환경에서는 `proof_missing`, `commitment_unknown`, `verification_failed`를 모두 정상 응답과 다른 상태로 처리해야 한다. 검증 실패를 observability 경고로만 남기고 결과를 소비하면 암호학적 증명을 붙인 의미가 사라진다.

## 지금 도입할 수 있는 것

FlashProve는 코드·Lean 증명·문서가 공개된 프로토타입이지, Anthropic이 운영하는 production assurance service나 완성된 상용 보증 체계가 아니다.[1] 하지만 모델 provenance를 품질 추정이 아니라 검증 가능한 계산 관계로 바꾼다는 점에서 운영 설계에 중요한 기준을 제시한다.

당장 400B proof를 production에 넣지 않더라도 다음 준비는 가능하다.

1. 요청·응답의 canonical encoding과 hash를 보존한다.
2. 모델 버전 문자열과 실제 artifact digest를 분리한다.
3. 라우터가 선택한 모델과 사용자에게 표시한 모델을 함께 기록한다.
4. proof 부재와 검증 실패를 `clean`으로 처리하지 않는다.
5. 작은 fixture에서 정상·변조·알 수 없는 commitment를 반복 시험한다.

핵심은 “이 답이 그럴듯한가”와 “이 답을 약속한 모델이 계산했는가”를 분리하는 것이다. FlashProve는 두 번째 질문에 대한 공개 연구의 진전을 보여준다. 첫 번째 질문은 여전히 평가와 사람의 판단, 도메인별 안전 통제가 맡아야 한다.

## Sources

[1] https://www.anthropic.com/research/provable-inference
