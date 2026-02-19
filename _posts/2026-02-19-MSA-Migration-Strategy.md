---
title: '모놀리스에서 마이크로서비스로: MSA 전환 실전 전략'
date: 2026-02-19 00:00:00
description: '모놀리식 아키텍처에서 마이크로서비스(MSA)로 전환하는 실전 전략을 소개합니다. 스트랭글러 패턴, 도메인 분리, API Gateway, 서비스 메시, 분산 트레이싱, Circuit Breaker까지 단계별로 정리했습니다.'
featured_image: '/images/2026-02-19-MSA-Migration-Strategy/cover.jpg'
---

![MSA 전환 전략 커버 이미지](/images/2026-02-19-MSA-Migration-Strategy/cover.jpg)

마이크로서비스 아키텍처(MSA)는 현대 소프트웨어 개발의 핵심 패러다임으로 자리잡았습니다. 하지만 모놀리스에서 마이크로서비스로의 전환은 단순히 코드를 쪼개는 것이 아닙니다. 조직 구조, 데이터 분리, 통신 방식, 장애 전파 방지까지 고려해야 하는 복잡한 여정입니다. 이 글에서는 MSA 전환을 위한 실전 전략과 핵심 패턴들을 다루겠습니다.

## 왜 MSA로 전환해야 하는가?

모놀리식 아키텍처는 초기 개발 속도에서 유리하지만, 시스템이 성장하면서 여러 한계에 직면합니다.

| 문제 | 모놀리스 | 마이크로서비스 |
|------|---------|--------------|
| 배포 단위 | 전체 애플리케이션 | 개별 서비스 |
| 장애 영향 | 전체 시스템 다운 | 해당 서비스만 영향 |
| 기술 스택 | 단일 기술 강제 | 서비스별 최적 기술 선택 |
| 확장성 | 전체를 스케일링 | 필요한 서비스만 스케일링 |
| 팀 독립성 | 코드 충돌 빈번 | 팀별 독립 개발/배포 |
| 빌드 시간 | 수십 분 | 수 분 |

### 전환 시점의 신호들

MSA 전환을 고려해야 할 시점은 다음과 같습니다:

- 배포 주기가 2주 이상 걸리기 시작할 때
- 하나의 기능 변경이 예상치 못한 곳에서 장애를 일으킬 때
- 개발팀이 10명을 넘어 코드 충돌이 빈번해질 때
- 특정 모듈만 트래픽이 급증하는데 전체를 스케일링해야 할 때

## 스트랭글러 패턴(Strangler Fig Pattern)으로 점진적 전환

![스트랭글러 패턴 아키텍처 다이어그램](/images/2026-02-19-MSA-Migration-Strategy/strangler-pattern.jpg)

스트랭글러 패턴은 Martin Fowler가 제안한 점진적 시스템 전환 전략입니다. 모놀리스를 한 번에 교체하는 것이 아니라, 새로운 마이크로서비스를 하나씩 만들면서 기존 시스템의 기능을 점진적으로 대체합니다.

### 3단계 전환 프로세스

**1단계: Transform** — 새로운 서비스를 별도로 구축

```yaml
# 기존 모놀리스의 주문 기능을 새 서비스로 추출
# docker-compose.yml (예시)
services:
  legacy-monolith:
    image: monolith-app:latest
    ports:
      - "8080:8080"

  order-service:
    image: order-service:latest
    ports:
      - "8081:8081"
    environment:
      - SPRING_PROFILES_ACTIVE=production
```

**2단계: Coexist** — 프록시를 통해 트래픽을 점진적으로 라우팅

```nginx
# nginx.conf - 트래픽 라우팅 예시
upstream legacy {
    server legacy-monolith:8080;
}

upstream order_service {
    server order-service:8081;
}

server {
    listen 80;

    # 새 서비스로 라우팅
    location /api/v2/orders {
        proxy_pass http://order_service;
    }

    # 나머지는 기존 모놀리스로
    location / {
        proxy_pass http://legacy;
    }
}
```

**3단계: Eliminate** — 기존 코드 제거

```bash
# 모놀리스에서 주문 관련 코드 제거 후 배포
# 이 단계에서 기존 DB 테이블 접근도 정리
```

### 전환 우선순위 결정 매트릭스

| 기준 | 가중치 | 평가 방식 |
|------|--------|----------|
| 비즈니스 가치 | 30% | 매출/사용자 영향도 |
| 변경 빈도 | 25% | 최근 6개월 커밋 수 |
| 결합도 | 25% | 다른 모듈과의 의존성 수 |
| 기술 부채 | 20% | 테스트 커버리지, 코드 품질 |

## 도메인 주도 설계(DDD) 기반 서비스 분리

MSA 전환의 핵심은 **올바른 경계**로 서비스를 나누는 것입니다. DDD의 Bounded Context가 서비스 분리의 기준이 됩니다.

### 이벤트 스토밍으로 도메인 발견

```
[이벤트 스토밍 결과 예시]

📦 주문 컨텍스트 (Order Context)
  → 주문생성됨, 주문확인됨, 주문취소됨
  → Entity: Order, OrderItem
  → 담당팀: 주문팀

📦 결제 컨텍스트 (Payment Context)
  → 결제요청됨, 결제완료됨, 결제실패됨
  → Entity: Payment, PaymentMethod
  → 담당팀: 결제팀

📦 배송 컨텍스트 (Shipping Context)
  → 배송시작됨, 배송완료됨, 반품요청됨
  → Entity: Shipment, TrackingInfo
  → 담당팀: 물류팀
```

### 데이터 분리 전략

각 마이크로서비스는 자체 데이터베이스를 소유해야 합니다(Database per Service 패턴).

```java
// 주문 서비스 - 자체 DB 사용
@Configuration
public class OrderDataSourceConfig {

    @Bean
    @ConfigurationProperties("spring.datasource.order")
    public DataSource orderDataSource() {
        return DataSourceBuilder.create().build();
    }
}

// 공유 데이터가 필요한 경우 → API 호출로 해결
@Service
public class OrderService {

    private final ProductClient productClient;

    public Mono<OrderResponse> createOrder(OrderRequest request) {
        // 상품 정보는 Product 서비스에서 API로 조회
        return productClient.getProduct(request.getProductId())
                .flatMap(product -> {
                    Order order = Order.create(request, product.getPrice());
                    return orderRepository.save(order);
                })
                .map(OrderResponse::from);
    }
}
```

## API Gateway 패턴

API Gateway는 마이크로서비스의 단일 진입점으로, 인증/인가, 라우팅, 로드밸런싱, 속도 제한 등을 담당합니다.

### Spring Cloud Gateway 구성

```java
@Configuration
public class GatewayConfig {

    @Bean
    public RouteLocator customRoutes(RouteLocatorBuilder builder) {
        return builder.routes()
                .route("order-service", r -> r
                        .path("/api/orders/**")
                        .filters(f -> f
                                .stripPrefix(1)
                                .addRequestHeader("X-Gateway", "true")
                                .retry(config -> config
                                        .setRetries(3)
                                        .setStatuses(HttpStatus.SERVICE_UNAVAILABLE))
                                .circuitBreaker(config -> config
                                        .setName("orderCircuitBreaker")
                                        .setFallbackUri("forward:/fallback/orders")))
                        .uri("lb://ORDER-SERVICE"))
                .route("payment-service", r -> r
                        .path("/api/payments/**")
                        .filters(f -> f
                                .stripPrefix(1)
                                .requestRateLimiter(config -> config
                                        .setRateLimiter(redisRateLimiter())))
                        .uri("lb://PAYMENT-SERVICE"))
                .build();
    }

    @Bean
    public RedisRateLimiter redisRateLimiter() {
        return new RedisRateLimiter(10, 20); // 초당 10건, 버스트 20건
    }
}
```

### Gateway 인증 필터

```java
@Component
public class JwtAuthenticationFilter implements GatewayFilter {

    private final JwtTokenProvider tokenProvider;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = extractToken(exchange.getRequest());

        if (token == null) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        return tokenProvider.validateToken(token)
                .flatMap(claims -> {
                    exchange.getRequest().mutate()
                            .header("X-User-Id", claims.getUserId())
                            .header("X-User-Role", claims.getRole())
                            .build();
                    return chain.filter(exchange);
                })
                .onErrorResume(e -> {
                    exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
                    return exchange.getResponse().setComplete();
                });
    }
}
```

## 서비스 메시(Service Mesh)와 분산 트레이싱

서비스 간 통신이 복잡해지면 서비스 메시가 필요합니다. Istio나 Linkerd 같은 서비스 메시는 네트워크 레벨에서 트래픽 관리, mTLS, 관측성을 제공합니다.

### Istio 기반 트래픽 관리

```yaml
# VirtualService - 카나리 배포 예시
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service
spec:
  hosts:
    - order-service
  http:
    - match:
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination:
            host: order-service
            subset: v2
    - route:
        - destination:
            host: order-service
            subset: v1
          weight: 90
        - destination:
            host: order-service
            subset: v2
          weight: 10
```

### 분산 트레이싱 with Micrometer Tracing

```java
// Spring Boot 3.x + Micrometer Tracing
// application.yml
management:
  tracing:
    sampling:
      probability: 1.0  # 개발 환경에서는 100%
  zipkin:
    tracing:
      endpoint: "https://YOUR_ZIPKIN_HOST/api/v2/spans"

// 커스텀 스팬 추가
@Service
public class OrderService {

    private final Tracer tracer;

    public Mono<Order> createOrder(OrderRequest request) {
        Span span = tracer.nextSpan().name("create-order").start();

        return Mono.defer(() -> {
            span.tag("order.type", request.getType());
            span.event("validation-start");

            return validateOrder(request)
                    .flatMap(this::processPayment)
                    .flatMap(this::saveOrder)
                    .doOnSuccess(order -> {
                        span.tag("order.id", order.getId().toString());
                        span.event("order-created");
                    })
                    .doOnError(e -> span.error(e))
                    .doFinally(signal -> span.end());
        }).contextWrite(Context.of(Span.class, span));
    }
}
```

## 장애 전파 방지: Circuit Breaker 패턴

![Circuit Breaker 패턴 다이어그램](/images/2026-02-19-MSA-Migration-Strategy/circuit-breaker.jpg)

마이크로서비스에서 하나의 서비스 장애가 연쇄적으로 전파되는 것(Cascading Failure)을 방지하려면 Circuit Breaker가 필수입니다.

### Resilience4j Circuit Breaker 구현

```java
@Configuration
public class CircuitBreakerConfig {

    @Bean
    public Customizer<Resilience4JCircuitBreakerFactory> defaultCustomizer() {
        return factory -> factory.configureDefault(id ->
                new Resilience4JConfigBuilder(id)
                        .circuitBreakerConfig(io.github.resilience4j.circuitbreaker.CircuitBreakerConfig
                                .custom()
                                .failureRateThreshold(50)        // 50% 실패 시 차단
                                .waitDurationInOpenState(Duration.ofSeconds(30))
                                .slidingWindowSize(10)            // 최근 10건 기준
                                .minimumNumberOfCalls(5)          // 최소 5건 이후 판단
                                .permittedNumberOfCallsInHalfOpenState(3)
                                .build())
                        .timeLimiterConfig(TimeLimiterConfig.custom()
                                .timeoutDuration(Duration.ofSeconds(3))
                                .build())
                        .build());
    }
}

@Service
public class PaymentService {

    private final CircuitBreakerFactory circuitBreakerFactory;
    private final PaymentClient paymentClient;

    public Mono<PaymentResponse> processPayment(PaymentRequest request) {
        CircuitBreaker circuitBreaker = circuitBreakerFactory.create("payment");

        return Mono.fromCallable(() ->
                circuitBreaker.run(
                    () -> paymentClient.charge(request),
                    throwable -> fallbackPayment(request, throwable)
                ));
    }

    private PaymentResponse fallbackPayment(PaymentRequest request, Throwable t) {
        log.warn("Payment service unavailable, using fallback: {}", t.getMessage());
        return PaymentResponse.pending(request.getOrderId(),
                "결제 서비스 일시 장애. 잠시 후 재시도됩니다.");
    }
}
```

### Circuit Breaker 상태 변화

```
CLOSED (정상) → 실패율 임계값 초과 → OPEN (차단)
   ↑                                      ↓
   └──── 성공 ← HALF_OPEN (시험) ←── 대기 시간 경과
```

### Bulkhead 패턴 (격벽 패턴)

```java
// 서비스별 스레드 풀 격리
@Bean
public Customizer<Resilience4JCircuitBreakerFactory> bulkheadCustomizer() {
    return factory -> factory.configure(builder ->
            builder.circuitBreakerConfig(CircuitBreakerConfig.ofDefaults()),
            "payment", "inventory");
}

// 세마포어 기반 Bulkhead
BulkheadConfig bulkheadConfig = BulkheadConfig.custom()
        .maxConcurrentCalls(25)           // 최대 동시 호출 25건
        .maxWaitDuration(Duration.ofMillis(500))
        .build();

Bulkhead paymentBulkhead = Bulkhead.of("payment", bulkheadConfig);
```

## MSA 전환 체크리스트

성공적인 MSA 전환을 위해 다음 항목들을 점검하세요:

- [ ] 도메인 이벤트 스토밍 완료 및 서비스 경계 정의
- [ ] 서비스별 독립 데이터베이스 분리 계획 수립
- [ ] API Gateway 구축 및 인증/인가 중앙화
- [ ] Circuit Breaker, Retry, Timeout 정책 수립
- [ ] 분산 트레이싱 및 중앙 로깅 인프라 구축
- [ ] CI/CD 파이프라인 서비스별 독립 구성
- [ ] 서비스 디스커버리 및 로드밸런싱 구성
- [ ] 헬스 체크 및 모니터링 대시보드 구축
- [ ] 장애 시나리오별 대응 런북(Runbook) 작성
- [ ] 팀 구조를 서비스 경계에 맞게 재편

## 마무리

모놀리스에서 마이크로서비스로의 전환은 기술적 결정이자 조직적 결정입니다. 스트랭글러 패턴을 통한 점진적 전환, DDD 기반의 올바른 서비스 경계 설정, API Gateway와 서비스 메시를 통한 안정적인 통신, 그리고 Circuit Breaker를 통한 장애 전파 방지까지 — 이 모든 요소가 조화를 이뤄야 성공적인 MSA 전환이 가능합니다.

가장 중요한 것은 **Big Bang 전환을 피하고 점진적으로 전환하는 것**입니다. 작은 서비스부터 시작하여 경험을 쌓고, 팀이 마이크로서비스 운영 역량을 갖춘 뒤에 범위를 확대하세요.

## 참고 자료

- [Martin Fowler - Strangler Fig Application](https://martinfowler.com/bliki/StranglerFigApplication.html)
- [Sam Newman - Building Microservices (2nd Edition)](https://samnewman.io/books/building_microservices_2nd_edition/)
- [Spring Cloud Gateway 공식 문서](https://docs.spring.io/spring-cloud-gateway/reference/)
- [Resilience4j 공식 문서](https://resilience4j.readme.io/docs)
- [Istio 공식 문서](https://istio.io/latest/docs/)
