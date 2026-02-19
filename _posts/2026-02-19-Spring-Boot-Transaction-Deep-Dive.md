---
title: 'Spring Boot 트랜잭션 관리 완벽 이해: @Transactional의 함정과 해결'
date: 2026-02-19 00:00:00
description: 'Spring Boot @Transactional의 동작 원리, 프록시 기반 AOP의 한계, 전파 옵션, 롤백 규칙, 그리고 분산 트랜잭션까지 실전 예제로 완벽하게 정리합니다.'
featured_image: '/images/2026-02-19-Spring-Boot-Transaction-Deep-Dive/cover.jpg'
---

![Spring Boot 트랜잭션 관리](/images/2026-02-19-Spring-Boot-Transaction-Deep-Dive/cover.jpg)

Spring Boot에서 @Transactional은 가장 많이 사용되면서도 가장 많은 함정을 가진 어노테이션입니다. 트랜잭션이 적용되지 않는 상황, 의도치 않은 롤백, 프록시의 한계 등 실무에서 자주 마주치는 문제들을 이 가이드에서 깊이 있게 다룹니다.

## @Transactional 동작 원리: 프록시 기반 AOP

### Spring은 트랜잭션을 어떻게 처리하는가?

Spring의 @Transactional은 **프록시 패턴**으로 동작합니다. 빈이 생성될 때 원본 객체를 감싸는 프록시 객체가 만들어지고, 메서드 호출 시 프록시가 트랜잭션을 시작/종료합니다.

```java
// 개발자가 작성한 코드
@Service
public class OrderService {

    @Transactional
    public void createOrder(OrderRequest request) {
        orderRepository.save(new Order(request));
        paymentService.processPayment(request.getPaymentInfo());
    }
}

// Spring이 내부적으로 생성하는 프록시 (개념적 코드)
public class OrderService$$Proxy extends OrderService {

    private final OrderService target;           // 원본 객체
    private final TransactionManager txManager;

    @Override
    public void createOrder(OrderRequest request) {
        TransactionStatus status = txManager.getTransaction(
            new DefaultTransactionDefinition());
        try {
            target.createOrder(request);         // 원본 메서드 호출
            txManager.commit(status);            // 커밋
        } catch (RuntimeException e) {
            txManager.rollback(status);          // 롤백
            throw e;
        }
    }
}
```

### 프록시 생성 방식

```java
// 1. JDK Dynamic Proxy (인터페이스 기반)
// → 인터페이스를 구현한 클래스에 사용
public interface OrderService {
    void createOrder(OrderRequest request);
}

@Service
public class OrderServiceImpl implements OrderService {
    @Transactional
    public void createOrder(OrderRequest request) { /* ... */ }
}

// 2. CGLIB Proxy (클래스 기반, Spring Boot 기본값)
// → 인터페이스 없이도 프록시 생성 가능
// application.yml에서 설정:
// spring.aop.proxy-target-class: true (기본값)
```

![프록시 기반 트랜잭션 처리 흐름](/images/2026-02-19-Spring-Boot-Transaction-Deep-Dive/proxy.jpg)

## 프록시 방식의 한계와 함정

### 함정 1: 내부 메서드 호출 시 트랜잭션 미적용

가장 흔하고 치명적인 실수입니다.

```java
@Service
public class UserService {

    // ❌ 이 코드는 트랜잭션이 적용되지 않습니다!
    public void registerUser(UserRequest request) {
        // 외부에서 registerUser()를 호출하면
        // 프록시를 통하지 않고 직접 saveUser() 호출
        saveUser(request);  // 내부 호출 → 프록시 우회 → @Transactional 무시!
    }

    @Transactional
    public void saveUser(UserRequest request) {
        userRepository.save(new User(request));
        emailService.sendWelcomeEmail(request.getEmail());
    }
}
```

**왜 이런 일이 발생하는가?**

```
외부 호출: Controller → Proxy → registerUser() → saveUser()
                                    ↑ this.saveUser() = 원본 객체 호출!
                                    프록시를 거치지 않음 → 트랜잭션 미적용
```

**해결 방법:**

```java
// 해결 1: 클래스 분리 (가장 권장)
@Service
public class UserService {
    private final UserInternalService internalService;

    public void registerUser(UserRequest request) {
        internalService.saveUser(request);  // 프록시를 통한 호출
    }
}

@Service
public class UserInternalService {
    @Transactional
    public void saveUser(UserRequest request) {
        userRepository.save(new User(request));
    }
}

// 해결 2: Self-injection
@Service
public class UserService {
    @Lazy @Autowired
    private UserService self;  // 프록시 주입

    public void registerUser(UserRequest request) {
        self.saveUser(request);  // 프록시를 통한 호출
    }

    @Transactional
    public void saveUser(UserRequest request) {
        userRepository.save(new User(request));
    }
}

// 해결 3: ApplicationContext에서 빈 조회
@Service
public class UserService implements ApplicationContextAware {
    private ApplicationContext context;

    public void registerUser(UserRequest request) {
        context.getBean(UserService.class).saveUser(request);
    }

    @Transactional
    public void saveUser(UserRequest request) {
        userRepository.save(new User(request));
    }

    @Override
    public void setApplicationContext(ApplicationContext ctx) {
        this.context = ctx;
    }
}
```

### 함정 2: private 메서드에 @Transactional

```java
@Service
public class ProductService {

    // ❌ CGLIB 프록시는 private 메서드를 오버라이드할 수 없음
    @Transactional
    private void updateStock(Long productId, int quantity) {
        // 트랜잭션이 적용되지 않음!
        productRepository.updateStock(productId, quantity);
    }

    // ✅ public 또는 protected로 변경
    @Transactional
    public void updateStock(Long productId, int quantity) {
        productRepository.updateStock(productId, quantity);
    }
}
```

### 함정 3: Checked Exception은 롤백하지 않음

```java
@Service
public class PaymentService {

    // ❌ IOException 발생 시 롤백되지 않음 (기본 설정)
    @Transactional
    public void processPayment(PaymentRequest request) throws IOException {
        paymentRepository.save(new Payment(request));
        externalApi.callPaymentGateway(request);  // IOException 발생!
        // → 데이터는 커밋됨 (일관성 깨짐)
    }

    // ✅ 해결: rollbackFor 명시
    @Transactional(rollbackFor = Exception.class)
    public void processPayment(PaymentRequest request) throws IOException {
        paymentRepository.save(new Payment(request));
        externalApi.callPaymentGateway(request);
        // → IOException 발생 시 롤백됨
    }
}
```

**Spring @Transactional 롤백 규칙:**

| 예외 타입 | 기본 롤백 여부 | 설정 |
|-----------|---------------|------|
| `RuntimeException` (Unchecked) | ✅ 롤백 | 기본 동작 |
| `Error` | ✅ 롤백 | 기본 동작 |
| `Exception` (Checked) | ❌ 커밋 | `rollbackFor` 필요 |

```java
// 세밀한 롤백 제어
@Transactional(
    rollbackFor = {PaymentException.class, NetworkException.class},
    noRollbackFor = {DuplicateWarningException.class}
)
public void complexPayment(PaymentRequest request) {
    // PaymentException → 롤백
    // NetworkException → 롤백
    // DuplicateWarningException → 커밋 (경고만)
    // NullPointerException → 롤백 (RuntimeException이므로)
}
```

## 전파 옵션(Propagation): 트랜잭션 경계 설계

### 7가지 전파 옵션

```java
@Transactional(propagation = Propagation.REQUIRED) // 기본값
public void methodA() {
    // 기존 트랜잭션이 있으면 참여, 없으면 새로 생성
}

@Transactional(propagation = Propagation.REQUIRES_NEW)
public void methodB() {
    // 항상 새 트랜잭션 생성 (기존 트랜잭션은 일시 중지)
}

@Transactional(propagation = Propagation.NESTED)
public void methodC() {
    // 기존 트랜잭션 내에 중첩 트랜잭션(Savepoint) 생성
}
```

| 전파 옵션 | 기존 트랜잭션 있음 | 기존 트랜잭션 없음 | 사용 사례 |
|-----------|-------------------|-------------------|-----------|
| `REQUIRED` (기본) | 참여 | 새로 생성 | 대부분의 경우 |
| `REQUIRES_NEW` | 새로 생성 (기존 일시중지) | 새로 생성 | 독립 로그, 감사 기록 |
| `NESTED` | 중첩(Savepoint) | 새로 생성 | 부분 롤백 필요 시 |
| `SUPPORTS` | 참여 | 트랜잭션 없이 실행 | 읽기 전용 조회 |
| `NOT_SUPPORTED` | 트랜잭션 없이 실행 (기존 일시중지) | 트랜잭션 없이 실행 | 대량 배치 처리 |
| `MANDATORY` | 참여 | 예외 발생 | 반드시 트랜잭션 내 실행 보장 |
| `NEVER` | 예외 발생 | 트랜잭션 없이 실행 | 트랜잭션 금지 보장 |

### 실전 예시: REQUIRES_NEW 활용

```java
@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final AuditLogService auditLogService;

    @Transactional
    public void createOrder(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));

        try {
            // 감사 로그는 독립 트랜잭션으로 기록
            // → 주문 트랜잭션이 롤백되어도 로그는 남음
            auditLogService.log("ORDER_CREATED", order.getId());
        } catch (Exception e) {
            // 로그 실패해도 주문 트랜잭션에 영향 없음
            log.warn("감사 로그 기록 실패", e);
        }

        paymentService.charge(order);
    }
}

@Service
public class AuditLogService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(String action, Long entityId) {
        auditLogRepository.save(new AuditLog(action, entityId, LocalDateTime.now()));
    }
}
```

### 실전 예시: NESTED 활용 (부분 롤백)

```java
@Service
public class BatchOrderService {

    @Transactional
    public BatchResult processBatch(List<OrderRequest> orders) {
        BatchResult result = new BatchResult();

        for (OrderRequest order : orders) {
            try {
                // 각 주문을 중첩 트랜잭션으로 처리
                // → 개별 주문 실패 시 해당 주문만 롤백
                processOne(order);
                result.addSuccess(order.getId());
            } catch (Exception e) {
                // Savepoint로 롤백 → 전체 트랜잭션은 유지
                result.addFailure(order.getId(), e.getMessage());
            }
        }
        return result;
    }

    @Transactional(propagation = Propagation.NESTED)
    public void processOne(OrderRequest order) {
        orderRepository.save(new Order(order));
        inventoryService.decreaseStock(order.getItemId(), order.getQuantity());
    }
}
```

![트랜잭션 롤백과 전파 흐름](/images/2026-02-19-Spring-Boot-Transaction-Deep-Dive/rollback.jpg)

## @Transactional 최적화 팁

### 읽기 전용 트랜잭션

```java
@Service
@Transactional(readOnly = true)  // 클래스 레벨: 기본 읽기 전용
public class ProductQueryService {

    public List<Product> findAll() {
        return productRepository.findAll();
        // readOnly=true 효과:
        // 1. Hibernate flush 모드 → MANUAL (dirty checking 스킵)
        // 2. DB 레플리카로 라우팅 가능 (DataSource 라우팅 설정 시)
        // 3. 성능 향상 (스냅샷 비교 생략)
    }

    @Transactional  // 메서드 레벨: readOnly=false 오버라이드
    public void updateProduct(Long id, ProductRequest request) {
        Product product = productRepository.findById(id).orElseThrow();
        product.update(request);
    }
}
```

### 트랜잭션 타임아웃

```java
@Transactional(timeout = 5)  // 5초 타임아웃
public void longRunningProcess() {
    // 5초 초과 시 TransactionTimedOutException 발생
    heavyComputation();
    repository.save(result);
}
```

### 격리 수준(Isolation Level)

```java
@Transactional(isolation = Isolation.READ_COMMITTED)  // 기본값 (대부분 DB)
public void normalRead() { /* ... */ }

@Transactional(isolation = Isolation.REPEATABLE_READ)
public void consistentRead() {
    // 같은 트랜잭션 내에서 같은 데이터를 읽으면 항상 같은 결과
}

@Transactional(isolation = Isolation.SERIALIZABLE)
public void strictConsistency() {
    // 가장 강력한 격리 → 성능 저하 주의
}
```

| 격리 수준 | Dirty Read | Non-Repeatable Read | Phantom Read | 성능 |
|-----------|-----------|-------------------|-------------|------|
| READ_UNCOMMITTED | 발생 | 발생 | 발생 | ★★★★★ |
| READ_COMMITTED | 방지 | 발생 | 발생 | ★★★★ |
| REPEATABLE_READ | 방지 | 방지 | 발생 | ★★★ |
| SERIALIZABLE | 방지 | 방지 | 방지 | ★★ |

## 분산 트랜잭션: MSA 환경의 트랜잭션 관리

마이크로서비스 아키텍처에서는 각 서비스가 독립 DB를 가지므로 단일 @Transactional로는 일관성을 보장할 수 없습니다.

### Saga 패턴

```java
// Choreography 기반 Saga (이벤트 기반)
@Service
public class OrderSagaService {

    @Transactional
    public void createOrder(OrderRequest request) {
        Order order = orderRepository.save(
            new Order(request, OrderStatus.PENDING));

        // 이벤트 발행 → 결제 서비스가 수신
        eventPublisher.publish(new OrderCreatedEvent(
            order.getId(), request.getPaymentInfo()));
    }

    // 결제 성공 이벤트 수신
    @TransactionalEventListener
    @Transactional
    public void onPaymentCompleted(PaymentCompletedEvent event) {
        Order order = orderRepository.findById(event.getOrderId()).orElseThrow();
        order.updateStatus(OrderStatus.CONFIRMED);
    }

    // 결제 실패 → 보상 트랜잭션(Compensating Transaction)
    @TransactionalEventListener
    @Transactional
    public void onPaymentFailed(PaymentFailedEvent event) {
        Order order = orderRepository.findById(event.getOrderId()).orElseThrow();
        order.updateStatus(OrderStatus.CANCELLED);  // 주문 취소 (보상)
    }
}
```

### Transactional Outbox 패턴

이벤트 발행의 신뢰성을 보장하는 패턴입니다.

```java
@Service
public class ReliableOrderService {

    @Transactional
    public void createOrder(OrderRequest request) {
        // 1. 주문 저장
        Order order = orderRepository.save(new Order(request));

        // 2. Outbox 테이블에 이벤트 저장 (같은 트랜잭션!)
        outboxRepository.save(new OutboxEvent(
            "OrderCreated",
            objectMapper.writeValueAsString(
                new OrderCreatedEvent(order.getId())),
            OutboxStatus.PENDING
        ));
        // → 별도 폴러(Debezium CDC 등)가 Outbox 테이블을 읽어 이벤트 발행
    }
}

// Outbox 테이블
@Entity
@Table(name = "outbox_events")
public class OutboxEvent {
    @Id @GeneratedValue
    private Long id;
    private String eventType;

    @Column(columnDefinition = "TEXT")
    private String payload;

    @Enumerated(EnumType.STRING)
    private OutboxStatus status;

    private LocalDateTime createdAt;
}
```

### @TransactionalEventListener 활용

```java
@Service
public class OrderService {

    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));

        // 트랜잭션 커밋 후에만 이벤트 실행
        eventPublisher.publishEvent(new OrderCreatedEvent(order));
        return order;
    }
}

@Component
public class OrderEventListener {

    // phase = AFTER_COMMIT: 트랜잭션 커밋 성공 후 실행 (기본값)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleOrderCreated(OrderCreatedEvent event) {
        // 이메일 발송, 알림 등 부수 효과
        // 주의: 이 메서드는 기존 트랜잭션 밖에서 실행됨
        emailService.sendOrderConfirmation(event.getOrder());
    }

    // 롤백 후 실행
    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    public void handleOrderFailed(OrderCreatedEvent event) {
        log.error("주문 생성 실패: {}", event.getOrder().getId());
        alertService.notifyFailure(event);
    }
}
```

## 트러블슈팅 체크리스트

실무에서 트랜잭션 문제를 만났을 때 확인할 항목:

```
□ @Transactional이 public 메서드에 붙어 있는가?
□ 내부 메서드 호출(self-invocation)이 아닌가?
□ 프록시를 통해 호출되고 있는가? (빈 주입 확인)
□ Checked Exception에 대한 rollbackFor 설정이 있는가?
□ try-catch로 예외를 삼키고 있지 않은가?
□ 전파 옵션(propagation)이 의도에 맞는가?
□ readOnly 설정이 쓰기 작업과 충돌하지 않는가?
□ 테스트의 @Transactional이 롤백하여 실제 동작을 숨기지 않는가?
```

```java
// 디버깅: 트랜잭션 로그 활성화
// application.yml
logging:
  level:
    org.springframework.transaction: DEBUG
    org.springframework.orm.jpa: DEBUG

// 출력 예시:
// DEBUG o.s.t.i.TransactionInterceptor - Getting transaction for [OrderService.createOrder]
// DEBUG o.s.t.i.TransactionInterceptor - Completing transaction for [OrderService.createOrder]
```

## 마무리

Spring Boot의 @Transactional은 강력하지만 프록시 기반 동작의 한계를 이해해야 올바르게 사용할 수 있습니다.

**핵심 요약:**
1. **프록시 이해가 핵심** — 내부 호출, private 메서드 함정 주의
2. **Checked Exception은 명시적 rollbackFor 필요** — 기본은 RuntimeException만 롤백
3. **전파 옵션을 상황에 맞게** — REQUIRED가 기본, 독립 기록은 REQUIRES_NEW
4. **읽기 전용은 readOnly=true** — 성능 최적화 + DB 라우팅 활용
5. **분산 환경은 Saga + Outbox** — 단일 @Transactional로는 불가
6. **트랜잭션 로그 활성화** — 문제 발생 시 빠른 디버깅 가능

## 참고 자료

- [Spring Framework Transaction Management](https://docs.spring.io/spring-framework/reference/data-access/transaction.html)
- [Baeldung - @Transactional 가이드](https://www.baeldung.com/transaction-configuration-with-jpa-and-spring)
- [Microservices Patterns - Chris Richardson (Saga 패턴)](https://microservices.io/patterns/data/saga.html)
- [Transactional Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- [Spring Boot 공식 문서 - Data Access](https://docs.spring.io/spring-boot/docs/current/reference/html/data.html)
