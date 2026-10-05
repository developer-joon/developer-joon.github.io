---
title: '음성 에이전트 latency budget: 빠른 partial과 안전한 실행을 분리하라'
date: 2026-10-05 09:00:00 +0900
categories: ["개발/인공지능"]
description: 'MAI-Transcribe-2-Streaming과 Voice 2.1 발표를 바탕으로 partial correction, stable transcript, barge-in, STT·reasoning·TTS 지연 예산과 되돌릴 수 없는 도구 실행 게이트를 설계한다.'
featured_image: 'https://picsum.photos/seed/voice-agent-streaming-latency-budget/1600/900'
tags: [voice-agent, speech-to-text, text-to-speech, streaming, latency, barge-in, ai-agent]
---

![음성 에이전트 latency budget](https://picsum.photos/seed/voice-agent-streaming-latency-budget/1600/900)

빠른 자막과 빠른 행동은 같은 목표가 아니다. 자막은 다음 partial로 고칠 수 있지만 송금·예약·발송은 되돌리기 어렵다. Microsoft는 MAI-Transcribe-2-Streaming이 오디오 수신 100ms 남짓 뒤 첫 partial을 내고, 문맥에 따라 수정한 뒤 stable transcript를 확정한다고 발표했다.[1] 첫 partial은 속도 신호이지 의도 확정이 아니다.

초점은 **partial을 어디까지 선행 작업에 쓰고, stable 이후 무엇을 확정하며, barge-in 때 무엇을 멈출 것인가**다. 아래 상태 머신·운영 schema·gate·지표는 Microsoft 사양이 아닌 필자의 제안이다.

## 첫 partial과 stable transcript는 서로 다른 계약이다

“내일 부산행 표를 취소하지 말고 시간만 바꿔 줘”의 초기 partial은 “내일 부산행 표를 취소”일 수 있다. 이때 취소 API를 호출하면 뒤의 부정 표현이 늦는다.

Microsoft 출시 발표문에는 event 계약이 나오지 않지만,[1] 공식 Realtime API 문서는 이를 공개한다.[2] `conversation.item.input_audio_transcription.intermediate`는 직전 `delta` 이후의 **전체 provisional suffix**이므로 새 event가 오면 이전 suffix를 교체한다. `delta`는 새로 확정된 텍스트라 누적하고, `completed`는 commit 구간의 전체 최종 transcript다. `input_audio_buffer.committed`는 버퍼 commit 확인일 뿐 finalization은 뒤에도 이어질 수 있다.[2]

이 공개 wire event와 운영 schema를 섞지 않는다. 다음은 공급자 event를 받은 뒤 내부에서 쓰는 **예시 정규화 schema**이며, `is_stable`과 `revision`은 Microsoft API 필드가 아니다.

```text
turn_id, segment_id, revision
text, is_stable
received_at, audio_end_at
language, confidence_if_available
```

`revision`이 증가하면 이전 partial 자막과 추론 입력을 교체한다. `is_stable=false`는 수정 가능한 가설이다. stable도 정확성이나 사용자 권한을 보장하지 않는다.

각 추론과 도구 후보에는 `turn_id`와 입력 revision을 붙이고, 최신 revision과 다르면 폐기한다.

## Partial correction은 취소 가능한 일에만 선행 사용한다

Partial 선행 작업의 기준은 “틀렸을 때 값싸게 버릴 수 있는가”다.

Partial에는 자막, 로컬 intent 후보, 취소 가능한 검색, TTS warm-up만 허용한다. 검색 결과는 최신 stable과 다시 대조한다. Partial 수정 시 speculative request를 취소하거나 revision 불일치로 폐기한다.

Stable에서 intent와 slot을 다시 계산하고 애매하면 되묻는다. Stable은 실행 검토를 **시작할 조건**이지 자동 승인이 아니다.

| 단계 | 가능한 작업 | 금지할 작업 |
|---|---|---|
| Partial | 자막, 취소 가능한 검색, cache·connection warm-up | 결제, 발송, 삭제, 예약 변경 |
| Stable | intent·slot 재계산, 읽기 전용 조회, 응답 초안 | 사용자 확인 없는 비가역 변경 |
| Confirmed | 승인된 parameter와 권한을 다시 검증한 실행 | 다른 revision·turn의 후보 재사용 |

## Latency budget은 모델 세 개가 아니라 대화 한 턴으로 잡는다

음성 응답의 체감 지연은 STT 숫자 하나로 설명되지 않는다. 사용자가 말을 끝낸 시점부터 첫 응답 음성이 재생될 때까지를 하나의 경로로 측정해야 한다.

```text
speech end
  → endpoint 판정
  → stable transcript
  → reasoning·tool decision
  → 필요하면 tool read
  → TTS 첫 audio chunk
  → client buffer·playback
```

운영 지표는 `time-to-first-partial`, `speech-end-to-stable`, `stable-to-decision`, `decision-to-first-audio`, `speech-end-to-first-playback`으로 나눈다. 각 구간의 p50·p95·p99와 **jitter=같은 조건에서 관측한 지연의 p95-p50**을 본다. 이 글에서 jitter는 이 정의만 사용한다.

전체 목표 뒤 endpoint·STT 안정화·reasoning·TTS·network에 상한을 배정한다. 초과 시 짧은 filler를 재생할 수 있지만, 처리가 끝났다는 인상을 주거나 추가 발화를 막아서는 안 된다.

선행 실행으로 줄일 수 있는 시간도 분리한다. Partial에서 retrieval을 시작해 stable 직후 결과를 재검증하는 것은 지연을 겹칠 수 있다. 그러나 partial 시점부터 잰 숫자를 “응답 지연”으로 보고하면 사용자의 발화 시간까지 성능 향상처럼 섞인다. 외부 보고에서는 측정 시작점, 마지막 audio packet과 endpoint event의 정의, client buffer 포함 여부를 함께 공개해야 한다.

## Barge-in은 재생 중단보다 큰 상태 전이다

사용자가 에이전트의 말을 끊는 barge-in은 TTS player만 멈추는 기능이 아니다. 새 음성이 감지되면 현재 출력 turn을 `interrupted`로 바꾸고, 아직 전송하지 않은 TTS chunk를 버리며, 진행 중인 생성과 취소 가능한 읽기 작업을 중단해야 한다. 새 입력에는 새 `turn_id`를 발급한다.

이미 실행된 외부 변경은 barge-in으로 되돌아가지 않는다. 그래서 “네, 예약을 변경할게요”를 읽는 동안 실제 변경을 먼저 적용하는 구조는 위험하다. 사용자에게 confirmation prompt를 끝까지 들려주고, 그 뒤 들어온 확인 발화를 별도 turn의 stable transcript로 받아야 한다. “네”처럼 짧은 확인도 어떤 대상·날짜·금액에 대한 승인인지 서버가 보관한 pending action과 결합한다. 이전 turn의 action candidate를 새 turn이 암묵적으로 상속하게 해서는 안 된다.

Barge-in 지표도 따로 둔다. 이는 Microsoft 제품 KPI가 아니라 운영 제안이다. 음성 감지부터 playback 정지까지, 취소 뒤 추가 재생된 audio, 폐기되지 않은 speculative task를 측정한다. 외부 action 실패 지표는 **확인 turn의 stable transcript와 pending action digest 검증이 끝나기 전에 시작된 action**, 그리고 **barge-in 취소 승인 event 뒤 새로 시작된 action**을 센다. 적법한 확인 뒤 이미 시작돼 취소 승인 시점에 중단할 수 없었던 action은 별도 `non-cancellable in-flight`로 기록한다. 실패 지표의 목표는 0이다.

## 비가역 tool action에는 stable 밖의 게이트가 더 필요하다

다음 실행 게이트도 Microsoft 사양이 아니라 비가역 작업을 위한 운영 제안이다. Transcript 상태, 의미 완결성, 사용자 승인, 권한, 중복 방지를 차례로 확인한다.

```text
latest stable transcript
  + complete intent and slots
  + explicit confirmation bound to action digest
  + current authorization and policy check
  + idempotency key
  → execute once
  → read back result
```

`action digest`에는 도구 이름과 destination, amount, date 같은 정규화된 parameter를 넣는다. 확인을 요청한 뒤 parameter가 바뀌면 기존 확인은 폐기한다. 실행 직전 최신 stable revision과 digest를 다시 대조하고, 도구에는 idempotency key를 전달한다. 성공 응답만 믿지 말고 가능한 작업은 읽어 와서 실제 상태를 확인한다.

이 게이트도 latency budget의 일부다. 읽기 전용 질의와 초안은 빠른 경로로, 비가역 작업만 명시적 확인 경로로 나눈다.

## Preview endpoint 제약을 rollout 조건으로 둔다

공식 문서상 MAI-Transcribe-2-Streaming은 **public preview**이며 SLA가 없고 production workload에 권장되지 않는다.[2][3] Realtime endpoint는 세션당 최대 1시간이고, `turn_detection`과 `noise_reduction`은 `null`만 지원한다. 즉 server-side speech detection과 automatic commit이 없어 client가 VAD 등으로 자연스러운 pause를 찾고 `input_audio_buffer.commit`을 보내야 한다.[2] 이 한계는 구현 세부가 아니라 endpoint 선택과 rollout 범위를 제한하는 조건이다. 장시간 통화에는 1시간 전 재연결·상태 이관을 시험하고, production 승인은 GA/SLA와 장애·재연결 결과를 별도 gate로 둔다. SDK 경로도 preview이며 SDK 1.52.0이 필요하고, intermediate는 교체하고 final만 누적하라고 명시한다.[3]

## 공급업체 수치와 가격은 자체 trace로 다시 검증한다

공식 발표에 따르면 MAI-Transcribe-2-Streaming은 60개 언어와 연속 언어 감지를 지원한다. MAI-Voice-2.1과 Flash는 23개 언어·26개 locale을 지원하며 같은 voice identity로 언어를 바꾸는 사용 사례를 제시한다.[1] 그러나 지원 목록은 모든 억양, code-switching, 소음, 전화 음질에서 같은 오류율을 보장하지 않는다.

“단어가 경쟁자보다 2배 빠르게 표시된다”와 Flash의 150ms end-to-end latency·55% 빠른 inference·약 60% 낮은 비용은 공급자 주장이다. 발표문에는 비교 모델, hardware, concurrency, codec, network 조건이 없다.[1] p95 보장으로 읽지 말고 실제 발화·침묵·끼어들기 corpus로 correction, stable word error, first playback, action 오류를 비교한다.

발표 시점 가격은 Transcribe가 2026년 말까지 시간당 0.54달러, Voice 2.1이 100만 문자당 22달러, Flash가 15달러다.[1] 장기 원가에는 재연결·재시도, 중복·폐기 audio, network와 reasoning·tool 비용을 더한다.

출시 발표는 몇 초의 reference audio와 consent guardrail을 capability로 소개한다.[1] 실제 MAI-Voice 문서는 instant voice cloning을 **gated** 기능으로 분류하며 limited-access 승인과 consent safeguard 완료를 요구한다.[4] 발표 capability가 곧 API 사용 권한은 아니다. 승인 뒤에도 동의 기록, 허용 voice, 생성물 표시, abuse 신고·폐기는 별도 운영 통제로 둔다.

## Rollout은 속도와 잘못된 행동을 함께 본다

다음 rollout 순서도 Microsoft의 배포 지침이 아니라 이 글의 운영 제안이다. 첫 단계에서는 shadow mode로 partial과 stable의 revision 차이만 기록하고 도구는 실행하지 않는다. 다음에는 읽기 전용 조회와 취소 가능한 speculative work만 허용한다. 마지막에 제한된 비가역 action을 열되 confirmation digest, idempotency, 실행 후 read-back이 모두 있는 경로부터 시작한다.

대시보드에는 속도와 정확성을 같은 화면에 둔다. `speech-end-to-first-playback`이 줄었는데 correction 뒤 잘못된 tool candidate가 늘었다면 개선이 아니다. Stable 이후 slot 변경률, confirmation 재요청률, barge-in 후 orphan task, 중복 실행, read-back 불일치를 함께 봐야 한다.

MAI-Transcribe-2-Streaming의 빠른 partial과 Voice 2.1의 빠른 합성은 대화 지연을 줄일 수 있는 부품이다. 하지만 음성 에이전트의 품질은 가장 빠른 부품 하나가 아니라 수정 가능한 구간과 확정 구간을 나누는 상태 머신에서 결정된다. Partial은 준비에 쓰고, stable에서 의미를 다시 계산하며, 비가역 행동은 별도 확인과 권한 게이트 뒤에 둬야 한다. 그래야 빠른 음성이 성급한 실행으로 바뀌지 않는다.

## Sources

[1] https://microsoft.ai/news/our-first-streaming-transcription-model/
[2] https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe-2-streaming-realtime
[3] https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe-2-streaming-speech-sdk
[4] https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-voices
