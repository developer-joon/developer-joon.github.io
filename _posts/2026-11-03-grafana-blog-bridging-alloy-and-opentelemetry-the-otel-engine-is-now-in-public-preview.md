---
title: 'Grafana Alloy를 OTel Collector처럼 교체 실행하기: 설정 호환성·Fleet 관리 검증'
date: 2026-11-03 09:00:26 +0900
categories: ["클라우드"]
description: 'Grafana Alloy 1.21의 OTel 엔진 Public Preview를 기존 Collector YAML로 병행 실행하고 데이터 동등성, 배포 방식, 원격 구성과 롤백 경계를 검증한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-grafana-blog-bridging-alloy-and-opentelemetry-the-otel-engine-is-now-in-public-preview/1600/900'
tags: [grafana-alloy, opentelemetry, observability, collector, otlp, fleet-management, migration]
---

![Grafana Alloy OTel 엔진과 Collector의 병행 검증](https://picsum.photos/seed/news-2026-11-03-grafana-blog-bridging-alloy-and-opentelemetry-the-otel-engine-is-now-in-public-preview/1600/900)

Grafana Alloy 1.21.0의 OpenTelemetry 엔진이 Public Preview로 승격됐다. 기존 OpenTelemetry Collector의 YAML과 CLI 흐름을 유지하면서 `alloy otel`로 native OTel pipeline을 실행할 수 있다.[1] Alloy의 기본 엔진을 OTel 엔진으로 바꾼 것이 아니라 한 binary 안에 두 실행 경로가 공존한다.

상태를 정확히 적어야 한다. **Alloy 제품이나 기본 엔진의 성숙도와 별개로 OTel 엔진은 Public Preview**다.[1] `alloyengine` extension과 `otel-supervisor`처럼 주변 기능에는 experimental 표시가 남아 있다. Database Observability와 Cloud Provider Observability 연계도 실험 범위여서 production support로 확대하면 안 된다.[1]

## “같은 YAML을 읽는다”와 “같은 결과다”는 다르다

Migration은 config parse 성공으로 끝나지 않는다. 동일한 OTLP fixture를 upstream Collector와 Alloy OTel 엔진에 동시에 보내고 export 결과를 비교해야 한다. Trace ID, span 수, resource attribute, histogram temporality, log severity, retry와 queue 동작을 신호별로 확인한다.

제안하는 shadow 절차는 다음과 같다.

1. Production config의 secret을 제거한 복제본을 만든다.
2. 같은 receiver 입력을 두 process에 복제한다.
3. 서로 다른 test tenant 또는 bucket으로 export한다.
4. Signal별 record count와 normalized payload를 diff한다.
5. Exporter 429·timeout·TLS 오류를 주입한다.
6. Alloy를 중지하고 기존 Collector가 단독으로 처리하는 rollback을 확인한다.

이 절차는 제안 fixture이며 여기서 실제 실행한 결과가 아니다.

## 배포 표면별 차이

Upstream Helm chart에서는 OTel mode를 켜는 values를 사용할 수 있다. OpenTelemetry Operator는 0.153.0 이상에서 `spec.command`를 지원해 Alloy image의 실행 명령을 지정할 수 있다.[1] Version 조건을 생략하면 manifest는 유효해 보여도 operator가 원하는 command를 실행하지 못할 수 있다.

비컨테이너 service 설치는 `ALLOY_OTEL_MODE=1`로 `config.yaml`을 읽게 할 수 있다.[1] 환경 변수 하나가 runtime 선택을 바꾸므로 package upgrade 뒤 service unit과 environment file을 inventory한다. Rollback 문서에는 binary version뿐 아니라 mode와 config path를 함께 적는다.

## Fleet Management는 configuration control plane이다

Alloy 1.19부터 OTel engine configuration을 Fleet Management로 중앙 관리할 수 있고 embedded OpAMP supervisor는 experimental `otel-supervisor` subcommand를 사용한다.[1] 중앙 배포는 편하지만 잘못된 config의 blast radius도 커진다.

원격 변경에는 immutable revision, canary cohort, validation result, 적용 성공률과 rollback revision을 남긴다. Client가 control plane에 연결되지 못했을 때 마지막 정상 config를 계속 쓰는지, 빈 config로 시작하는지, 만료 정책이 있는지를 장애 주입으로 확인한다. Config 배포 성공과 telemetry export 성공은 별도 상태다.

## 두 엔진 사이의 경계

`alloyengine` extension은 OTel process 안에서 Alloy configuration을 실행하는 escape hatch지만 experimental이다.[1] 두 엔진 사이에 process 내부의 직접 데이터 전달이 있다고 가정해서는 안 된다. Extension을 추가할수록 “순수 Collector YAML로 언제든 되돌아간다”는 exit path가 약해질 수 있다.

Component inventory를 만들어 upstream Collector component, Alloy default component, extension 의존성을 구분한다. Rollback target이 upstream Collector라면 Alloy 전용 component가 없는 최소 config도 지속적으로 테스트한다.

## Promotion gate

Public Preview 채택은 production 전체 교체보다 bounded canary가 적합하다. Config validation, signal parity, backpressure, memory limiter, persistent queue, TLS와 credential rotation, Fleet outage를 각각 통과시킨다. 같은 load에서 CPU·memory와 dropped telemetry를 비교하되 vendor benchmark를 우리 결과로 쓰지 않는다.

최종 질문은 “Alloy가 Collector YAML을 실행했는가”가 아니다. **동일 입력이 동등한 telemetry와 실패 의미를 만들고, 중앙 config가 잘못돼도 blast radius를 제한하며, 기존 Collector로 되돌아갈 수 있는가**다. Preview라는 상태를 유지한 채 이 세 조건을 증명해야 교체 실험이 관측 공백으로 바뀌지 않는다.

## Sources

[1] https://grafana.com/blog/bridging-alloy-and-opentelemetry-the-otel-engine-is-now-in-public-preview/
