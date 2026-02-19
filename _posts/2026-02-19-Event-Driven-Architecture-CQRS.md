---
title: '이벤트 드리븐 아키텍처와 CQRS 패턴 실전 적용'
date: 2026-02-19 00:00:00
description: '이벤트 드리븐 아키텍처(EDA)와 CQRS 패턴의 핵심 개념부터 실전 적용까지 다룹니다. 이벤트 소싱, Kafka와 RabbitMQ 비교, Saga 패턴, 최종 일관성까지 코드 예시와 함께 정리했습니다.'
featured_image: '/images/2026-02-19-Event-Driven-Architecture-CQRS/cover.jpg'
---

![이벤트 드리븐 아키텍처와 CQRS 커버 이미지](/images/2026-02-19-Event-Driven-Architecture-CQRS/cover.jpg)

이벤트 드리븐 아키텍처(Event-Driven Architecture, EDA)는 시스템 컴포넌트 간의 결합도를 낮추고 확장성을 극대화하는 아키텍처 패턴입니다. 여기에 CQRS(Command Query Responsibility Segregation) 패턴을 결합하면, 읽기와 쓰기를 독립적으로 최적화할 수 있어 대규모 시스템에서 강력한 성능을 발휘합니다. 이 글에서는 이벤트 소싱, CQRS, Saga 패턴, 그리고 Kafka/RabbitMQ 비교까지 실전에 필요한 핵심 내용을 다루겠습니다.

## 이벤트 드리븐 아키텍처란?

이벤트 드리븐 아키텍처는 상태 변화를 **이벤트**로 표현하고, 이벤트를 중심으로 시스템을 구성하는 패턴입니다. 전통적인 요청-응답 방식과 달리, 이벤트를 발행(publish)하면 관심 있는 서비스가 구독(subscribe)하여 반응합니다.

```
[전통적 동기 방식]
주문 서비스 → 결제 서비스 호출 → 재고 서비스 호출 → 알림 서비스 호출
(하나가 실패하면 전체 실패)

[이벤트 드리븐 방식]
주문 서비스 → "주문생성됨" 이벤트 발행
  ├── 결제 서비스: 이벤트 수신 → 결제 처리
  ├── 재고 서비스: 이벤트 수신 → 재고 차감
  └── 알림 서비스: 이벤트 수신 → 알림 발송
(서비스 간 독립적으로 동작)
```

### 이벤트의 3가지 유형

| 유형 | 설명 | 예시 |
|------|------|------|
| **Domain Event** | 비즈니스 도메인에서 발생한 사실 | `OrderCreated`, `PaymentCompleted` |
| **Integration Event** | 서비스 간 통신을 위한 이벤트 | `OrderCreatedIntegrationEvent` |
| **Event Notification** | 알림 목적의 경량 이벤트 | `{ "type": "ORDER_CREATED", "orderId": "123" }` |

## 이벤트 소싱(Event Sourcing)

![이벤트 소싱 개념 다이어그램](/images/2026-02-19-Event-Driven-Architecture-CQRS/event-sourcing.jpg)

이벤트 소싱은 엔티티의 현재 상태를 저장하는 대신, **상태 변화의 이력(이벤트)**을 모두 저장하는 패턴입니다. 현재 상태는 이벤트들을 순서대로 재생(replay)하여 도출합니다.

### 이벤트 소싱 구현

```java
// 도메인 이벤트 정의
public sealed interface OrderEvent {
    String orderId();
    LocalDateTime occurredAt();

    record OrderCreated(String orderId, String customerId, List<OrderItem> items,
                        BigDecimal totalAmount, LocalDateTime occurredAt) implements OrderEvent {}

    record OrderPaid(String orderId, String paymentId,
                     LocalDateTime occurredAt) implements OrderEvent {}

    record OrderShipped(String orderId, String trackingNumber,
                        LocalDateTime occurredAt) implements OrderEvent {}

    record OrderCancelled(String orderId, String reason,
                          LocalDateTime occurredAt) implements OrderEvent {}
}

// 이벤트 소싱 기반 Aggregate
public class Order {
    private String id;
    private String customerId;
    private OrderStatus status;
    private BigDecimal totalAmount;
    private List<OrderItem> items;
    private final List<OrderEvent> uncommittedEvents = new ArrayList<>();

    // 이벤트를 통한 상태 변경 (Command → Event)
    public static Order create(String orderId, String customerId,
                                List<OrderItem> items, BigDecimal totalAmount) {
        Order order = new Order();
        order.apply(new OrderEvent.OrderCreated(
                orderId, customerId, items, totalAmount, LocalDateTime.now()));
        return order;
    }

    public void pay(String paymentId) {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException("결제할 수 없는 상태: " + status);
        }
        apply(new OrderEvent.OrderPaid(id, paymentId, LocalDateTime.now()));
    }

    public void cancel(String reason) {
        if (status == OrderStatus.SHIPPED || status == OrderStatus.CANCELLED) {
            throw new IllegalStateException("취소할 수 없는 상태: " + status);
        }
        apply(new OrderEvent.OrderCancelled(id, reason, LocalDateTime.now()));
    }

    // 이벤트 적용 (Event → State)
    private void apply(OrderEvent event) {
        when(event);
        uncommittedEvents.add(event);
    }

    private void when(OrderEvent event) {
        switch (event) {
            case OrderEvent.OrderCreated e -> {
                this.id = e.orderId();
                this.customerId = e.customerId();
                this.items = e.items();
                this.totalAmount = e.totalAmount();
                this.status = OrderStatus.CREATED;
            }
            case OrderEvent.OrderPaid e -> this.status = OrderStatus.PAID;
            case OrderEvent.OrderShipped e -> this.status = OrderStatus.SHIPPED;
            case OrderEvent.OrderCancelled e -> this.status = OrderStatus.CANCELLED;
        }
    }

    // 이벤트 이력에서 상태 복원
    public static Order rehydrate(List<OrderEvent> events) {
        Order order = new Order();
        events.forEach(order::when);
        return order;
    }
}
```

### 이벤트 저장소(Event Store)

```java
@Repository
public class EventStore {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public void saveEvents(String aggregateId, List<OrderEvent> events, int expectedVersion) {
        int currentVersion = getCurrentVersion(aggregateId);
        if (currentVersion != expectedVersion) {
            throw new OptimisticLockingException(
                    "동시성 충돌: 예상 버전 " + expectedVersion + ", 실제 버전 " + currentVersion);
        }

        for (OrderEvent event : events) {
            currentVersion++;
            jdbcTemplate.update(
                "INSERT INTO event_store (aggregate_id, version, event_type, payload, created_at) " +
                "VALUES (?, ?, ?, ?::jsonb, ?)",
                aggregateId,
                currentVersion,
                event.getClass().getSimpleName(),
                serialize(event),
                event.occurredAt()
            );
        }
    }

    public List<OrderEvent> getEvents(String aggregateId) {
        return jdbcTemplate.query(
            "SELECT * FROM event_store WHERE aggregate_id = ? ORDER BY version ASC",
            (rs, rowNum) -> deserialize(rs.getString("event_type"), rs.getString("payload")),
            aggregateId
        );
    }
}
```

### 이벤트 소싱의 장단점

| 장점 | 단점 |
|------|------|
| 완전한 감사 로그(Audit Trail) | 이벤트 스키마 진화 관리 필요 |
| 시간 여행(Time Travel) 가능 | 학습 곡선이 가파름 |
| 이벤트 리플레이로 버그 재현 | 최종 일관성에 대한 이해 필요 |
| 도메인 이벤트 기반 통합 자연스러움 | 조회 성능을 위해 CQRS 필요 |

## CQRS 패턴: 읽기와 쓰기의 분리

CQRS(Command Query Responsibility Segregation)는 데이터 쓰기(Command)와 읽기(Query) 모델을 분리하는 패턴입니다. 이벤트 소싱과 결합하면 쓰기는 이벤트 저장소에, 읽기는 최적화된 뷰 모델에서 수행합니다.

### CQRS 구현

```java
// Command 측: 쓰기 모델
@Service
public class OrderCommandService {

    private final EventStore eventStore;
    private final EventPublisher eventPublisher;

    public String createOrder(CreateOrderCommand command) {
        String orderId = UUID.randomUUID().toString();
        Order order = Order.create(orderId, command.getCustomerId(),
                command.getItems(), command.getTotalAmount());

        eventStore.saveEvents(orderId, order.getUncommittedEvents(), 0);
        eventPublisher.publish(order.getUncommittedEvents());

        return orderId;
    }

    public void cancelOrder(CancelOrderCommand command) {
        List<OrderEvent> events = eventStore.getEvents(command.getOrderId());
        Order order = Order.rehydrate(events);

        order.cancel(command.getReason());

        eventStore.saveEvents(command.getOrderId(),
                order.getUncommittedEvents(), events.size());
        eventPublisher.publish(order.getUncommittedEvents());
    }
}

// Query 측: 읽기 모델
@Service
public class OrderQueryService {

    private final OrderReadRepository readRepository;

    public OrderDetailView getOrderDetail(String orderId) {
        return readRepository.findById(orderId)
                .orElseThrow(() -> new OrderNotFoundException(orderId));
    }

    public Page<OrderSummaryView> getOrderList(String customerId, Pageable pageable) {
        return readRepository.findByCustomerId(customerId, pageable);
    }
}

// 읽기 모델 업데이트 (이벤트 핸들러 = Projector)
@Component
public class OrderProjector {

    private final OrderReadRepository readRepository;

    @EventHandler
    public void on(OrderEvent.OrderCreated event) {
        OrderDetailView view = OrderDetailView.builder()
                .orderId(event.orderId())
                .customerId(event.customerId())
                .items(event.items())
                .totalAmount(event.totalAmount())
                .status("CREATED")
                .createdAt(event.occurredAt())
                .build();
        readRepository.save(view);
    }

    @EventHandler
    public void on(OrderEvent.OrderPaid event) {
        readRepository.updateStatus(event.orderId(), "PAID");
    }

    @EventHandler
    public void on(OrderEvent.OrderCancelled event) {
        readRepository.updateStatus(event.orderId(), "CANCELLED");
        readRepository.updateCancelReason(event.orderId(), event.reason());
    }
}
```

## Kafka vs RabbitMQ: 메시지 브로커 비교

![Kafka와 RabbitMQ 비교](/images/2026-02-19-Event-Driven-Architecture-CQRS/kafka-comparison.jpg)

이벤트 드리븐 아키텍처의 핵심 인프라인 메시지 브로커를 선택할 때, Kafka와 RabbitMQ는 가장 많이 비교되는 선택지입니다.

### 아키텍처 차이

```
[Apache Kafka]
Producer → Topic (Partition 0, 1, 2...) → Consumer Group
- 로그 기반: 이벤트가 디스크에 순서대로 기록
- Pull 방식: 컨슈머가 원하는 속도로 읽기
- 이벤트 보존: 설정된 기간 동안 이벤트 유지

[RabbitMQ]
Producer → Exchange → Queue → Consumer
- 브로커 기반: 메시지를 큐에 저장 후 전달
- Push 방식: 브로커가 컨슈머에게 메시지 전달
- 메시지 소비 후 삭제 (기본)
```

### 상세 비교표

| 항목 | Apache Kafka | RabbitMQ |
|------|-------------|----------|
| 처리량 | 수백만 msg/sec | 수만 msg/sec |
| 메시지 보존 | 설정 기간 동안 보존 | 소비 후 삭제 (기본) |
| 순서 보장 | 파티션 내 보장 | 큐 내 보장 |
| 소비 방식 | Pull (컨슈머 주도) | Push (브로커 주도) |
| 라우팅 | 토픽 기반 (단순) | Exchange 기반 (유연) |
| 프로토콜 | 자체 바이너리 프로토콜 | AMQP, MQTT, STOMP |
| 재처리 | 오프셋 리셋으로 쉬움 | Dead Letter Queue |
| 적합한 경우 | 이벤트 스트리밍, 로그 수집 | 태스크 큐, 복잡한 라우팅 |

### Kafka 이벤트 발행/구독 구현

```java
// Kafka Producer
@Service
public class KafkaEventPublisher implements EventPublisher {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    @Override
    public void publish(List<OrderEvent> events) {
        events.forEach(event -> {
            String topic = "order-events";
            String key = event.orderId();
            String payload = serialize(event);

            kafkaTemplate.send(topic, key, payload)
                    .whenComplete((result, ex) -> {
                        if (ex != null) {
                            log.error("이벤트 발행 실패: {}", event, ex);
                        } else {
                            log.info("이벤트 발행 성공: topic={}, offset={}",
                                    topic, result.getRecordMetadata().offset());
                        }
                    });
        });
    }
}

// Kafka Consumer
@Component
public class OrderEventConsumer {

    private final OrderProjector projector;

    @KafkaListener(
        topics = "order-events",
        groupId = "order-query-service",
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void consume(ConsumerRecord<String, String> record) {
        try {
            OrderEvent event = deserialize(record.value());
            log.info("이벤트 수신: type={}, orderId={}, offset={}",
                    event.getClass().getSimpleName(), event.orderId(), record.offset());

            projector.handle(event);
        } catch (Exception e) {
            log.error("이벤트 처리 실패: offset={}", record.offset(), e);
            // Dead Letter Topic으로 전송
            throw e;
        }
    }
}
```

### RabbitMQ 구현 (비교)

```java
// RabbitMQ Producer
@Service
public class RabbitEventPublisher implements EventPublisher {

    private final RabbitTemplate rabbitTemplate;

    @Override
    public void publish(List<OrderEvent> events) {
        events.forEach(event -> {
            String routingKey = "order." + event.getClass().getSimpleName().toLowerCase();
            rabbitTemplate.convertAndSend("order-exchange", routingKey, event,
                    message -> {
                        message.getMessageProperties().setMessageId(UUID.randomUUID().toString());
                        message.getMessageProperties().setTimestamp(new Date());
                        return message;
                    });
        });
    }
}

// RabbitMQ Consumer
@Component
public class RabbitOrderEventConsumer {

    @RabbitListener(queues = "order-query-queue")
    public void consume(OrderEvent event, Channel channel,
                        @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag) {
        try {
            projector.handle(event);
            channel.basicAck(deliveryTag, false);
        } catch (Exception e) {
            // nack → Dead Letter Queue로 이동
            channel.basicNack(deliveryTag, false, false);
        }
    }
}
```

## Saga 패턴: 분산 트랜잭션 관리

마이크로서비스 환경에서는 여러 서비스에 걸친 트랜잭션을 관리하기 위해 Saga 패턴을 사용합니다. Saga는 각 서비스의 로컬 트랜잭션을 순차적으로 실행하고, 실패 시 보상 트랜잭션(Compensation)을 실행합니다.

### Orchestration Saga 구현

```java
@Service
public class OrderSagaOrchestrator {

    private final OrderService orderService;
    private final PaymentService paymentService;
    private final InventoryService inventoryService;
    private final NotificationService notificationService;

    public Mono<SagaResult> executeOrderSaga(CreateOrderCommand command) {
        String sagaId = UUID.randomUUID().toString();
        log.info("Saga 시작: {}", sagaId);

        return createOrder(command)
                .flatMap(order -> reserveInventory(order)
                        .flatMap(inventory -> processPayment(order)
                                .map(payment -> SagaResult.success(order, payment))
                                // 결제 실패 → 재고 보상
                                .onErrorResume(e -> compensateInventory(order)
                                        .then(compensateOrder(order))
                                        .then(Mono.error(e))))
                        // 재고 실패 → 주문 보상
                        .onErrorResume(e -> compensateOrder(order)
                                .then(Mono.error(e))))
                .doOnSuccess(result -> {
                    log.info("Saga 성공: {}", sagaId);
                    notificationService.sendOrderConfirmation(result.getOrder());
                })
                .doOnError(e -> log.error("Saga 실패: {}", sagaId, e));
    }

    private Mono<Order> createOrder(CreateOrderCommand command) {
        return orderService.create(command)
                .doOnSuccess(order -> log.info("Step 1: 주문 생성 완료 - {}", order.getId()));
    }

    private Mono<InventoryReservation> reserveInventory(Order order) {
        return inventoryService.reserve(order.getItems())
                .doOnSuccess(r -> log.info("Step 2: 재고 예약 완료 - {}", order.getId()));
    }

    private Mono<Payment> processPayment(Order order) {
        return paymentService.charge(order.getCustomerId(), order.getTotalAmount())
                .doOnSuccess(p -> log.info("Step 3: 결제 완료 - {}", order.getId()));
    }

    // 보상 트랜잭션
    private Mono<Void> compensateOrder(Order order) {
        return orderService.cancel(order.getId(), "Saga 보상")
                .doOnSuccess(v -> log.info("보상: 주문 취소 - {}", order.getId()));
    }

    private Mono<Void> compensateInventory(Order order) {
        return inventoryService.release(order.getItems())
                .doOnSuccess(v -> log.info("보상: 재고 복원 - {}", order.getId()));
    }
}
```

### Choreography Saga (이벤트 기반)

```java
// 각 서비스가 이벤트를 수신하고 자체적으로 다음 단계 진행
@Component
public class PaymentSagaParticipant {

    @KafkaListener(topics = "order-created-events")
    public void onOrderCreated(OrderCreatedEvent event) {
        try {
            Payment payment = paymentService.charge(event.customerId(), event.totalAmount());
            kafkaTemplate.send("payment-completed-events",
                    new PaymentCompletedEvent(event.orderId(), payment.getId()));
        } catch (PaymentException e) {
            kafkaTemplate.send("payment-failed-events",
                    new PaymentFailedEvent(event.orderId(), e.getMessage()));
        }
    }
}

@Component
public class InventorySagaParticipant {

    @KafkaListener(topics = "payment-completed-events")
    public void onPaymentCompleted(PaymentCompletedEvent event) {
        inventoryService.confirm(event.orderId());
        kafkaTemplate.send("order-completed-events",
                new OrderCompletedEvent(event.orderId()));
    }

    @KafkaListener(topics = "payment-failed-events")
    public void onPaymentFailed(PaymentFailedEvent event) {
        inventoryService.release(event.orderId());
        // 재고 복원 후 주문 취소 이벤트 발행
    }
}
```

### Orchestration vs Choreography

| 항목 | Orchestration | Choreography |
|------|--------------|-------------|
| 제어 방식 | 중앙 오케스트레이터 | 각 서비스가 자율적 |
| 결합도 | 오케스트레이터에 의존 | 서비스 간 느슨한 결합 |
| 디버깅 | 중앙에서 흐름 추적 용이 | 이벤트 추적 복잡 |
| 적합한 경우 | 복잡한 비즈니스 프로세스 | 단순한 이벤트 체인 |

## 최종 일관성(Eventual Consistency)

이벤트 드리븐 아키텍처에서는 강한 일관성(Strong Consistency) 대신 **최종 일관성(Eventual Consistency)**을 수용합니다. 모든 이벤트가 처리되면 결국 일관된 상태에 도달한다는 개념입니다.

### 최종 일관성 보장 전략

```java
// 1. Outbox 패턴: DB 트랜잭션과 이벤트 발행의 원자성 보장
@Service
public class OutboxService {

    private final OutboxRepository outboxRepository;

    @Transactional
    public Order createOrderWithOutbox(CreateOrderCommand command) {
        // 주문 저장과 아웃박스 이벤트를 같은 트랜잭션에서 처리
        Order order = orderRepository.save(Order.from(command));

        OutboxEvent outboxEvent = OutboxEvent.builder()
                .aggregateId(order.getId())
                .aggregateType("Order")
                .eventType("OrderCreated")
                .payload(serialize(order))
                .status(OutboxStatus.PENDING)
                .build();
        outboxRepository.save(outboxEvent);

        return order;
    }
}

// Outbox Relay: 미발행 이벤트를 주기적으로 발행
@Component
public class OutboxRelay {

    @Scheduled(fixedDelay = 1000)
    public void publishPendingEvents() {
        List<OutboxEvent> pendingEvents = outboxRepository
                .findByStatusOrderByCreatedAtAsc(OutboxStatus.PENDING);

        for (OutboxEvent event : pendingEvents) {
            try {
                kafkaTemplate.send("domain-events", event.getAggregateId(),
                        event.getPayload()).get(5, TimeUnit.SECONDS);
                event.markAsPublished();
                outboxRepository.save(event);
            } catch (Exception e) {
                log.error("Outbox 이벤트 발행 실패: {}", event.getId(), e);
                event.incrementRetryCount();
                outboxRepository.save(event);
            }
        }
    }
}
```

```java
// 2. 멱등성(Idempotency) 보장
@Component
public class IdempotentEventHandler {

    private final ProcessedEventRepository processedEventRepository;

    public void handle(OrderEvent event, String eventId) {
        // 이미 처리된 이벤트인지 확인
        if (processedEventRepository.existsById(eventId)) {
            log.info("이미 처리된 이벤트 스킵: {}", eventId);
            return;
        }

        // 이벤트 처리
        processEvent(event);

        // 처리 완료 기록
        processedEventRepository.save(new ProcessedEvent(eventId, LocalDateTime.now()));
    }
}
```

## 실전 아키텍처 종합

이벤트 드리븐 + CQRS + 이벤트 소싱을 조합한 전체 아키텍처를 정리합니다:

```
┌─────────────┐         ┌──────────────┐
│  Client App  │────────▶│  API Gateway  │
└─────────────┘         └──────┬───────┘
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │  Command  │ │  Query   │ │  Query   │
             │  Service  │ │ Service  │ │ Service  │
             └────┬─────┘ └────┬─────┘ └────┬─────┘
                  │            │             │
                  ▼            ▼             ▼
           ┌──────────┐ ┌──────────┐ ┌──────────┐
           │  Event   │ │  Read DB │ │  Search  │
           │  Store   │ │(Postgres)│ │ (Elastic)│
           └────┬─────┘ └──────────┘ └──────────┘
                │              ▲             ▲
                ▼              │             │
           ┌──────────┐       │             │
           │  Kafka   │───────┴─────────────┘
           │  Broker  │   (Event → Read Model 투영)
           └──────────┘
```

## 마무리

이벤트 드리븐 아키텍처와 CQRS는 대규모 분산 시스템의 확장성과 유연성을 크게 향상시키는 강력한 패턴입니다. 하지만 최종 일관성, 이벤트 스키마 관리, 분산 트랜잭션 등 새로운 복잡성도 함께 가져옵니다.

핵심 정리:
- **이벤트 소싱**: 상태 변화 이력을 완전히 보존하여 감사, 디버깅, 시간 여행 가능
- **CQRS**: 읽기/쓰기를 분리하여 각각 독립적으로 최적화
- **Kafka**: 대용량 이벤트 스트리밍에 적합, 이벤트 재처리 용이
- **RabbitMQ**: 복잡한 라우팅과 태스크 큐에 적합
- **Saga 패턴**: 분산 트랜잭션을 보상 트랜잭션으로 관리
- **Outbox 패턴**: DB 트랜잭션과 이벤트 발행의 원자성 보장

도입 시에는 팀의 역량과 시스템 요구사항을 면밀히 분석하고, 단순한 이벤트 발행/구독부터 시작하여 점진적으로 이벤트 소싱과 CQRS를 도입하는 것을 권장합니다.

## 참고 자료

- [Martin Fowler - Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Martin Fowler - CQRS](https://martinfowler.com/bliki/CQRS.html)
- [Apache Kafka 공식 문서](https://kafka.apache.org/documentation/)
- [RabbitMQ 공식 문서](https://www.rabbitmq.com/docs)
- [Chris Richardson - Saga Pattern](https://microservices.io/patterns/data/saga.html)
- [Vaughn Vernon - Implementing Domain-Driven Design](https://www.oreilly.com/library/view/implementing-domain-driven-design/9780133039900/)
