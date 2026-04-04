---
title: 'Spring Boot 4 & Spring Framework 7 — 뭐가 달라졌나?'
date: 2026-04-04 00:00:00
description: 'Spring Boot 4.0 GA부터 4.1-M3까지의 주요 변경사항을 정리합니다. Jakarta EE 11, JDK 21+ 필수, Spring gRPC, GraalVM Native 개선 등 최신 Spring 생태계를 한눈에 파악하세요. BreadDesk 프로젝트의 마이그레이션 계획도 포함됩니다.'
featured_image: '/images/2026-04-04-spring-boot-4-spring-framework-7-whats-new/cover.jpg'
tags: spring-boot, java, backend, spring-framework
---

![Spring Boot 4 & Spring Framework 7](/images/2026-04-04-spring-boot-4-spring-framework-7-whats-new/cover.jpg)

2025년 11월 Spring Boot 4.0 GA가 출시되고, 2026년 3월 4.1-M3이 공개되면서 Spring 생태계가 새로운 시대를 맞이했습니다. 이번 글에서는 Spring Boot 4와 Spring Framework 7의 주요 변경사항을 정리하고, 실무 마이그레이션 전략을 살펴봅니다.

## Spring Boot 4.0 → 4.1-M3 변경사항

### 주요 릴리스 타임라인
- **2025년 11월**: Spring Boot 4.0 GA 출시
- **2026년 3월**: Spring Boot 4.1-M3 (현재 최신 마일스톤)
- **2026년 Q3 예정**: Spring Boot 4.1 GA

Spring Boot 4는 **Spring Framework 7 기반**으로 전면 재구축됐으며, Java 생태계의 최신 표준을 전폭 수용합니다.

## 핵심 변경사항

### 1. Jakarta EE 11 정렬 — JDK 21+ 필수

Spring Boot 4는 **Jakarta EE 11**로 정렬되며, JDK 17/20 지원을 중단하고 **JDK 21 이상을 필수**로 요구합니다.

#### 주요 영향
```xml
<!-- Spring Boot 3 -->
<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>javax.servlet-api</artifactId>
</dependency>

<!-- Spring Boot 4 -->
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>6.1.0</version>
</dependency>
```

- **패키지명 변경**: `javax.*` → `jakarta.*` (Servlet, JPA, Validation 등 전 영역)
- **Virtual Threads 지원**: JDK 21의 가상 스레드를 Spring MVC/WebFlux 모두 네이티브 지원
- **Record Pattern 지원**: Java 21의 레코드 패턴 매칭을 Spring Data와 통합

### 2. AMQP 1.0 지원 — RabbitMQ 고급 기능 활용

Spring Boot 4는 AMQP 1.0 프로토콜을 공식 지원합니다. 기존 AMQP 0.9.1 (RabbitMQ 기본)과 함께 사용 가능합니다.

#### 주요 기능
- **Apache Qpid Proton 통합**: AMQP 1.0 클라이언트 자동 구성
- **Azure Service Bus 지원**: Azure 환경에서 RabbitMQ 없이 메시징 인프라 구축 가능
- **메시지 라우팅 개선**: 더욱 유연한 메시지 흐름 제어

```java
@Configuration
public class AmqpConfig {
    
    @Bean
    public ConnectionFactory connectionFactory() {
        // AMQP 1.0 설정 자동 감지
        return new CachingConnectionFactory("amqp://localhost");
    }
}
```

### 3. Spring gRPC — 네이티브 gRPC 지원

Spring Framework 7은 **Spring gRPC**를 정식 프로젝트로 도입했습니다. 이제 REST API처럼 간편하게 gRPC 서비스를 구축할 수 있습니다.

#### 기존 방식 vs Spring gRPC
```java
// 기존: 수동 gRPC 설정
Server server = ServerBuilder.forPort(9090)
    .addService(new MyServiceImpl())
    .build();

// Spring gRPC: 자동 구성 + 애노테이션
@GrpcService
public class MyServiceImpl extends MyServiceGrpc.MyServiceImplBase {
    
    @Override
    public void sayHello(HelloRequest req, StreamObserver<HelloReply> res) {
        res.onNext(HelloReply.newBuilder()
            .setMessage("Hello " + req.getName())
            .build());
        res.onCompleted();
    }
}
```

#### 주요 장점
- **자동 서버 구성**: `spring.grpc.server.port=9090` 설정만으로 서버 시작
- **Spring Security 통합**: gRPC 요청에도 `@PreAuthorize` 등 보안 애노테이션 적용 가능
- **Observability**: Spring Boot Actuator와 자동 통합 (메트릭, 트레이싱)

### 4. GraalVM Native 개선 — 빌드 속도 2배 향상

Spring Boot 4는 GraalVM Native Image 빌드 성능을 대폭 개선했습니다.

#### 성과
- **빌드 속도 2배 향상**: 평균 빌드 시간 8분 → 4분
- **이미지 크기 30% 감소**: 최적화된 힌트 시스템으로 불필요한 클래스 제거
- **런타임 메모리 20% 절감**: 시작 메모리 60MB → 48MB (샘플 앱 기준)

#### 주요 개선사항
```bash
# Spring Boot 3
./mvnw native:compile -Pnative
# 빌드 시간: ~8분, 이미지 크기: 120MB

# Spring Boot 4
./mvnw native:compile -Pnative
# 빌드 시간: ~4분, 이미지 크기: 85MB
```

- **Ahead-of-Time (AOT) 엔진 최적화**: 컴파일 타임 분석 강화
- **Reachability Metadata 통합**: 써드파티 라이브러리 Native 지원 대폭 확대

### 5. 보안 패치 — CVE-2026-22731/22733 Actuator 인증 우회

Spring Boot 4.1-M2 이후 버전에서는 **Actuator 인증 우회 취약점**이 패치됐습니다.

#### CVE-2026-22731
- **영향**: Spring Boot Actuator 엔드포인트에서 특정 HTTP 헤더 조작 시 인증 우회 가능
- **버전**: Spring Boot 4.0.0 ~ 4.0.5
- **패치**: 4.0.6, 4.1-M2 이상

#### CVE-2026-22733
- **영향**: `/actuator/env` 엔드포인트에서 민감 정보 노출 가능
- **버전**: Spring Boot 4.0.0 ~ 4.0.7
- **패치**: 4.0.8, 4.1-M3 이상

**권장 조치**: Spring Boot 4 사용 중이라면 **최소 4.1-M3 이상으로 업그레이드** 필수!

## BreadDesk 마이그레이션 계획

제가 최근 개발한 [BreadDesk 프로젝트](/blog/breaddesk-ai-service-desk-development)는 현재 **Spring Boot 3.5**를 사용하고 있습니다. Spring Boot 4로의 마이그레이션을 계획 중입니다.

### 마이그레이션 로드맵
1. **Phase 1: JDK 21 업그레이드** (2026년 4월)
   - 현재 JDK 17 → JDK 21 전환
   - Virtual Threads 성능 테스트

2. **Phase 2: Jakarta EE 11 대응** (2026년 5월)
   - `javax.*` → `jakarta.*` 패키지 일괄 변경
   - Spring Data JPA, Hibernate 6.x 호환성 검증

3. **Phase 3: Spring Boot 4.1 GA 적용** (2026년 Q3)
   - 안정화 버전 출시 후 프로덕션 전환
   - Spring gRPC 도입 검토 (현재 REST API 일부를 gRPC로 전환)

### 예상 이슈
- **Hibernate 6.x 변경사항**: 일부 네이티브 쿼리 수정 필요
- **Spring Security**: 인증 필터 체인 구조 변경 가능성
- **테스트 호환성**: Testcontainers, Mockito 등 테스트 프레임워크 업데이트 필요

## 마이그레이션 체크리스트

Spring Boot 3 → 4 마이그레이션 시 확인해야 할 항목:

### 필수 사항
- [ ] JDK 21 이상으로 업그레이드
- [ ] `javax.*` → `jakarta.*` 패키지 전환
- [ ] Hibernate 6.x 호환성 검증
- [ ] Spring Security 6.x 변경사항 적용
- [ ] Actuator 보안 설정 재검토

### 선택 사항
- [ ] Virtual Threads 적용 (`spring.threads.virtual.enabled=true`)
- [ ] Spring gRPC 도입 검토
- [ ] GraalVM Native Image 빌드 테스트
- [ ] AMQP 1.0 활용 (Azure 환경)

### 테스트
- [ ] 통합 테스트 전체 재실행
- [ ] 성능 벤치마크 (특히 Virtual Threads)
- [ ] 보안 스캔 (CVE 패치 확인)

## 참고 자료

### 공식 문서
- [Spring Boot 4.1 Release Notes](https://spring.io/blog/2026/03/spring-boot-4-1-m3-released)
- [Spring Framework 7 What's New](https://docs.spring.io/spring-framework/reference/7.0/whatsnew.html)
- [Jakarta EE 11 Specification](https://jakarta.ee/specifications/platform/11/)

### 커뮤니티 리소스
- [Baeldung: Migrating to Spring Boot 4](https://www.baeldung.com/spring-boot-4-migration)
- [GitHub: Spring Boot 4.1 Milestone](https://github.com/spring-projects/spring-boot/releases)
- [Spring Blog: Spring gRPC Introduction](https://spring.io/blog/2025/12/introducing-spring-grpc)

## 마무리

Spring Boot 4는 단순 버전 업그레이드가 아닌, **Java 생태계의 차세대 표준을 적극 수용한 대규모 개편**입니다. JDK 21의 Virtual Threads, Jakarta EE 11, GraalVM Native 최적화 등 모던 자바 개발의 모든 것이 담겨 있습니다.

아직 Spring Boot 3를 사용 중이라면, 지금부터 마이그레이션 계획을 세우는 것을 권장합니다. 특히 **보안 패치가 포함된 4.1-M3 이상**으로 업그레이드하여 CVE 취약점을 예방하세요.

BreadDesk 프로젝트의 마이그레이션 과정은 추후 별도 포스트로 정리하겠습니다. Spring Boot 4로의 전환, 함께 준비해요! 🚀
