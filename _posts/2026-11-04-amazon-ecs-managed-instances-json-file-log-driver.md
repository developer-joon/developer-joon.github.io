---
title: 'ECS Managed Instances 로그를 벤더 중립적으로 수집하기: json-file과 Managed Daemon 검증'
date: 2026-11-04 09:00:21 +0900
categories: ["클라우드"]
description: 'ECS Managed Instances의 json-file 로그와 Managed Daemon 전용 볼륨을 이용해 비루트 수집기를 구성하고, 누락·중복·보존·비용 경계를 검증하는 방법을 정리한다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-04-amazon-ecs-managed-instances-json-file-log-driver/1600/900'
tags: [aws, ecs, observability, logging, managed-instances, managed-daemons, json-file, opentelemetry]
---

![ECS Managed Instances의 컨테이너 로그 수집 경로](https://picsum.photos/seed/news-2026-11-04-amazon-ecs-managed-instances-json-file-log-driver/1600/900)

AWS는 2026년 11월 4일 ECS Managed Instances의 애플리케이션 컨테이너가 Docker 표준 `json-file` 형식으로 로컬 로그를 쓰고, ECS Managed Daemon이 전용 log-driver volume을 통해 이를 읽을 수 있다고 발표했다.[1] 수집기는 host bind mount 경로나 root 권한 없이 인스턴스의 대상 로그에 접근할 수 있다. 한 인스턴스의 daemon이 해당 driver를 쓰는 여러 컨테이너 로그를 모아 원하는 목적지로 전달하는 구조다.[1]

이 변화의 핵심은 “CloudWatch 대신 다른 제품을 쓸 수 있다”보다 책임 경계가 분명해졌다는 데 있다. ECS는 컨테이너 ID별 전용 디렉터리에 로그를 두고 컨테이너가 제거될 때까지 보존한다.[1] 그러나 원격 전송 성공, offset 복구, multiline 결합, 민감정보 마스킹, 목적지 보존 기간은 수집기와 운영팀의 책임이다.

## 먼저 확인할 계약

애플리케이션 task definition은 `logConfiguration`에서 `json-file`을 선택한다. Daemon task definition은 `logDriverVolumeConfiguration`으로 volume을 선언하고 수집기 container에 mount한다.[1] 이 두 설정은 함께 있어야 한다. 일반 host volume을 임의로 열어 주거나 Docker 내부 경로를 추측하는 방식으로 바꾸면 이번 기능의 비루트·관리형 경계를 잃는다.

다음은 **실행한 예제가 아니라 검토용 구성 원칙**이다.

- 애플리케이션별 로그에는 service, environment, task ARN을 구조화 필드로 기록한다.
- 수집기는 읽기 전용 volume과 필요한 네트워크 목적지만 가진다.
- Container ID와 ECS task metadata를 함께 보내 재시작 전후의 출처를 구분한다.
- 원격 sink 장애 때 disk 사용 상한과 backpressure 정책을 정한다.
- Container 제거 전에 마지막 offset이 전송됐는지 확인할 drain 시간을 둔다.

## 검증 fixture

Staging에서 같은 task definition으로 짧은 sequence 번호를 1부터 10,000까지 기록하도록 제안한다. 수집기를 정상 종료한 경우, 강제 종료한 경우, sink가 429를 반환한 경우를 분리한다. 목적지에서 `(taskArn, containerId, sequence)`의 누락과 중복을 계산하면 “로그가 보인다”보다 강한 판정이 된다.

새 task가 시작될 때 이전 container의 파일을 다시 읽어 중복되는지, daemon이 재시작된 뒤 offset checkpoint를 복구하는지 확인한다. JSON 한 줄이 최대 크기를 넘거나 stack trace가 여러 줄일 때 parser가 어떻게 처리하는지도 별도 fixture로 둔다. ECS가 container별 디렉터리를 제공한다는 사실은 record 단위 exactly-once를 보장하지 않는다.[1]

## 비용과 보존의 함정

기능 자체에는 추가 요금이 없지만, Managed Instances, 수집기 CPU·메모리, 네트워크 전송, 외부 저장소와 검색 비용은 남는다.[1] 특히 로컬 파일 보존은 장기 archive가 아니다. Container가 제거되면 ECS가 해당 로그를 계속 보관한다고 발표하지 않았다. 규정 보존이 필요하면 원격 sink의 immutable retention과 삭제 증거를 따로 설계한다.

Disk pressure도 관측해야 한다. Sink 장애가 길어질수록 로컬 로그가 쌓이고, 무제한 재시도는 애플리케이션과 같은 인스턴스 자원을 압박한다. `bytes_pending`, `oldest_unshipped_age`, `export_errors`, `local_log_bytes`를 경보 후보로 두고 실제 허용치는 부하 시험으로 정한다.

## 도입 판정

이 기능은 ECS Managed Instances와 Managed Daemons가 제공되는 상용 리전에서 사용할 수 있다.[1] 모든 ECS launch type의 공통 기능으로 확대해서는 안 된다. 또한 `json-file` 선택은 애플리케이션 stdout/stderr 수집 경로를 바꾸므로 기존 `awslogs`나 FireLens와 이중 전송되지 않는지 확인해야 한다.

도입 승인은 세 조건으로 닫는 편이 안전하다. 첫째, 비루트 daemon이 필요한 로그만 읽는다. 둘째, daemon과 sink 장애를 주입해 누락·중복·지연 상한을 측정했다. 셋째, container 제거와 인스턴스 교체 뒤에도 필요한 보존 증거가 원격에 남는다. 이 세 가지가 없으면 driver 교체는 관측 가능성 개선이 아니라 로그 경로의 책임 이전일 뿐이다.

## Sources

[1] https://aws.amazon.com/about-aws/whats-new/2026/11/amazon-ecs-managed-instances-json-file-log-driver/
