---
title: 'Spring Data 2026: Redis Pub/Sub 어노테이션, MongoDB Bulk API의 진화'
date: 2026-03-16 00:00:00
description: 'Spring Data 2026.0.0 M2가 출시되었습니다. Redis Pub/Sub 어노테이션 리스너, MongoDB 멀티 컬렉션 Bulk Write, Type-Safe Property Paths 등 핵심 변경사항을 정리합니다.'
featured_image: '/images/2026-03-16-Spring-Data-2026-Redis-PubSub-MongoDB-Bulk/cover.jpg'
---

Spring Data 2026.0.0 릴리즈 트레인의 두 번째 마일스톤이 출시되었습니다. M1에서 선보인 Type-Safe Property Paths에 이어, M2에서는 Redis Pub/Sub 어노테이션 리스너와 MongoDB 멀티 컬렉션 Bulk Write API라는 두 가지 메이저 기능이 추가되었습니다. 이번 포스트에서는 Spring Data 2026의 핵심 변경사항들을 코드 예시와 함께 살펴보겠습니다.

## 릴리즈 트레인 개요

Spring Data 2026.0.0은 다음 모듈들을 포함합니다:

- **Spring Data Commons**
- **Spring Data JPA**
- **Spring Data MongoDB**
- **Spring Data Redis**
- **Spring Data Cassandra**
- **Spring Data Elasticsearch**
- **Spring Data Neo4j**
- **Spring Data Couchbase**
- **Spring Data LDAP**
- **Spring Data REST**
- **Spring Data KeyValue**
- **Spring Data Relational** (JDBC/R2DBC)

이번 릴리즈는 **Spring Boot 4.1 M2**에 포함될 예정이며, 현재 M2 단계입니다.

---

## 1. Type-Safe Property Paths (M1)

Spring Data 2026 M1에서 가장 눈에 띄는 변화는 **타입 안전한 프로퍼티 경로(Type-Safe Property Paths)** 지원입니다. 기존에는 문자열로 프로퍼티를 지정해야 했지만, 이제는 메서드 레퍼런스를 활용할 수 있습니다.

### Java 예시

```java
import org.springframework.data.domain.Sort;
import org.springframework.data.mapping.PropertyPath;

// 기존 방식 (문자열 기반)
Sort oldSort = Sort.by("firstName", "lastName");

// 새로운 방식 (타입 안전)
Sort newSort = Sort.by(Person::getFirstName, Person::getLastName);

// 중첩 프로퍼티
PropertyPath path = PropertyPath.of(Person::getAddress)
    .nested(Address::getCity);
```

### Kotlin 예시

Kotlin에서는 `/` 연산자를 활용한 더욱 간결한 문법을 지원합니다:

```kotlin
import org.springframework.data.mapping.PropertyPath

// Kotlin 방식
val path = PropertyPath.of(Person::address / Address::city)

// Sort도 동일하게
val sort = Sort.by(Person::firstName, Person::lastName)
```

### 지원 모듈

다음 모듈들에서 Type-Safe Property Paths를 지원합니다:

- Spring Data Cassandra
- Spring Data JDBC / R2DBC
- Spring Data JPA
- Spring Data MongoDB

이제 리팩토링 시 IDE의 도움을 받을 수 있고, 컴파일 타임에 오류를 잡을 수 있어 안전성이 크게 향상되었습니다.

---

## 2. Redis Pub/Sub 어노테이션 리스너 (M2) ⭐

Redis를 사용하는 개발자들에게 가장 반가운 소식입니다. **어노테이션 기반 Redis Pub/Sub 리스너**가 드디어 추가되었습니다. 이 기능은 2017년부터 요청되어 온 것으로([#1004](https://github.com/spring-projects/spring-data-redis/issues/1004)), 9년 만에 실현되었습니다.

### 기존 방식 vs 새로운 방식

#### 기존 방식 (MessageListener 인터페이스)

```java
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

@Configuration
public class RedisConfig {
    
    @Bean
    RedisMessageListenerContainer container(RedisConnectionFactory factory) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);
        container.addMessageListener(new MessageListener() {
            @Override
            public void onMessage(Message message, byte[] pattern) {
                System.out.println("Received: " + new String(message.getBody()));
            }
        }, new ChannelTopic("orders"));
        return container;
    }
}
```

#### 새로운 방식 (어노테이션 기반)

```java
import org.springframework.data.redis.listener.annotation.RedisListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEventListener {
    
    @RedisListener(topics = "orders")
    public void handleOrderEvent(String message) {
        System.out.println("Received order: " + message);
    }
    
    @RedisListener(topics = "orders", serializer = "jacksonSerializer")
    public void handleOrderObject(Order order) {
        System.out.println("Order ID: " + order.getId());
    }
    
    @RedisListener(patterns = "user.*")
    public void handleUserEvents(String message, String channel) {
        System.out.println("User event from " + channel + ": " + message);
    }
}
```

### 주요 기능

1. **콘텐츠 협상 (Content Negotiation)**: `RedisListenerEndpointRegistrar`를 통해 메시지 타입에 따라 적절한 역직렬화 수행 ([#3321](https://github.com/spring-projects/spring-data-redis/issues/3321))
2. **유연한 메서드 시그니처**: 메시지만 받거나, 메시지 + 채널명 조합 가능
3. **패턴 매칭**: `patterns` 속성으로 여러 채널 구독
4. **커스텀 직렬화**: 메서드별로 다른 직렬화 전략 지정 가능

---

## 3. Redis 8.4 지원 및 기타 개선사항

### DELEX 커맨드 지원

Redis 8.4의 새로운 `DELEX` 커맨드를 지원합니다 ([#3318](https://github.com/spring-projects/spring-data-redis/issues/3318)):

```java
// DELEX: 키 삭제 후 만료 시간 반환
Long ttl = redisTemplate.delete("myKey").getExpire();
```

### SET 커맨드 CAS 옵션 리팩토링

Compare-And-Set 옵션이 더욱 명확하게 개선되었습니다 ([#3324](https://github.com/spring-projects/spring-data-redis/issues/3324)):

```java
// 기존 값이 없을 때만 설정 (SET NX)
redisTemplate.opsForValue().setIfAbsent("key", "value");

// 기존 값이 있을 때만 설정 (SET XX)
redisTemplate.opsForValue().setIfPresent("key", "newValue");
```

### TimeUnit → Duration/Expiration 전환

레거시 `TimeUnit` 대신 `Duration` 및 `Expiration` 타입을 사용하도록 권장됩니다 ([#3319](https://github.com/spring-projects/spring-data-redis/issues/3319)):

```java
// Deprecated
redisTemplate.expire("key", 10, TimeUnit.SECONDS);

// Recommended
redisTemplate.expire("key", Duration.ofSeconds(10));
```

### 라이브러리 업그레이드

- **Jedis 7.4.0**
- **Lettuce 7.5.0**

---

## 4. MongoDB Bulk Write API - 멀티 컬렉션 지원 (M2) ⭐

MongoDB 8.0+에서 도입된 **멀티 컬렉션 Bulk Write**를 Spring Data에서 네이티브로 지원합니다 ([#5169](https://github.com/spring-projects/spring-data-mongodb/issues/5169), [#5087](https://github.com/spring-projects/spring-data-mongodb/issues/5087)).

### 기존 방식 (단일 컬렉션)

```java
BulkOperations bulkOps = mongoTemplate.bulkOps(BulkMode.ORDERED, Jedi.class);
bulkOps.insert(new Jedi("Luke"));
bulkOps.insert(new Jedi("Yoda"));
bulkOps.updateOne(Query.query(where("name").is("Luke")), 
                  Update.update("rank", "Master"));
bulkOps.execute();
```

### 새로운 방식 (멀티 컬렉션)

MongoDB 8.0 이상에서는 **여러 컬렉션에 대한 작업을 하나의 트랜잭션처럼** 처리할 수 있습니다:

```java
import org.springframework.data.mongodb.core.BulkOperations.Bulk;
import static org.springframework.data.mongodb.core.query.Criteria.where;
import static org.springframework.data.mongodb.core.query.Query.query;
import static org.springframework.data.mongodb.core.query.Update.update;

Bulk bulk = Bulk.create(builder -> builder
    .inCollection(Jedi.class, spec -> spec
        .insert(new Jedi("Luke Skywalker"))
        .insert(new Jedi("Yoda"))
        .updateOne(query(where("name").is("Luke Skywalker")), 
                   update("rank", "Grand Master"))
    )
    .inCollection(Sith.class, spec -> spec
        .insert(new Sith("Darth Vader"))
        .deleteOne(query(where("name").is("Darth Sidious")))
    )
);

mongoTemplate.bulkOps(bulk).execute();
```

### 주요 특징

- **MongoDB 8.0+**: 멀티 컬렉션 Bulk Write 지원
- **MongoDB 8.0 미만**: 자동으로 단일 컬렉션 모드로 폴백
- **혼합 작업**: Insert, Update, Delete를 자유롭게 조합 가능
- **유연한 순서 제어**: `BulkMode.ORDERED` 또는 `BulkMode.UNORDERED` 선택

이 기능은 마이크로서비스 환경에서 여러 엔티티를 원자적으로 처리해야 할 때 매우 유용합니다.

---

## 5. MongoDB 쿼리 키워드 확장: IsEmpty / IsNotEmpty

컬렉션/배열 필드의 빈 상태를 체크하는 쿼리 메서드가 추가되었습니다 ([#5147](https://github.com/spring-projects/spring-data-mongodb/issues/5147), [#4606](https://github.com/spring-projects/spring-data-mongodb/issues/4606)):

```java
public interface OrderRepository extends MongoRepository<Order, String> {
    
    // 주문 항목이 없는 주문 찾기
    List<Order> findByItemsIsEmpty();
    
    // 주문 항목이 있는 주문 찾기
    List<Order> findByItemsIsNotEmpty();
}
```

생성되는 MongoDB 쿼리:

```javascript
// IsEmpty
{ "items": { "$size": 0 } }

// IsNotEmpty
{ "items": { "$not": { "$size": 0 } } }
```

---

## 6. JSpecify 어노테이션 마이그레이션

Spring Data Redis는 null-safety를 강화하기 위해 **JSpecify** 어노테이션으로 마이그레이션했습니다 ([#3092](https://github.com/spring-projects/spring-data-redis/issues/3092)). 이는 Kotlin과의 상호운용성을 개선하고, IDE에서 더 나은 null 체크를 제공합니다.

---

## 7. 라이브러리 업그레이드

### MongoDB

- **MongoDB Java Driver 5.7.0**

### Redis

- **Jedis 7.4.0**
- **Lettuce 7.5.0**

---

## 마이그레이션 가이드

### 1. Type-Safe Property Paths 도입

기존 문자열 기반 Sort를 점진적으로 교체하세요:

```java
// Before
Sort.by("user.address.city");

// After
Sort.by(User::getAddress).nested(Address::getCity);
// 또는 Kotlin: PropertyPath.of(User::address / Address::city)
```

### 2. Redis Pub/Sub 리스너 전환

`MessageListener` 구현체를 `@RedisListener` 어노테이션으로 교체하세요:

```java
// Before
container.addMessageListener(new MessageListener() {
    public void onMessage(Message message, byte[] pattern) {
        // ...
    }
}, new ChannelTopic("events"));

// After
@RedisListener(topics = "events")
public void handleEvent(String message) {
    // ...
}
```

### 3. TimeUnit Deprecation 대응

`TimeUnit`을 `Duration`으로 교체하세요:

```java
// Before
redisTemplate.expire(key, 10, TimeUnit.MINUTES);

// After
redisTemplate.expire(key, Duration.ofMinutes(10));
```

### 4. MongoDB Bulk Write 최적화

MongoDB 8.0 이상을 사용 중이라면, 멀티 컬렉션 Bulk Write를 활용하여 성능을 개선할 수 있습니다:

```java
// 여러 컬렉션에 대한 작업을 하나의 Bulk로 통합
Bulk bulk = Bulk.create(builder -> builder
    .inCollection(Order.class, spec -> /* ... */)
    .inCollection(Inventory.class, spec -> /* ... */)
);
mongoTemplate.bulkOps(bulk).execute();
```

---

## 참고 링크

- [Spring Data 2026.0.0 M1 Release Notes](https://spring.io/blog/2026/02/13/spring-data-2026-0-0-m1-released)
- [Spring Data 2026.0.0 M2 Release Notes](https://spring.io/blog/2026/03/13/spring-data-2026-0-0-m2-released)
- [Spring Data Redis #3303 - Annotation-based Pub/Sub Listeners](https://github.com/spring-projects/spring-data-redis/issues/3303)
- [Spring Data MongoDB #5169 - Multi-Collection Bulk Write](https://github.com/spring-projects/spring-data-mongodb/issues/5169)
- [Spring Boot 4.1 M2 Release Notes](https://spring.io/blog/2026/03/13/spring-boot-4-1-0-m2-available-now)

---

## 마치며

Spring Data 2026은 개발자 경험을 크게 개선하는 릴리즈입니다. Type-Safe Property Paths는 컴파일 타임 안전성을 높이고, Redis Pub/Sub 어노테이션은 보일러플레이트 코드를 대폭 줄여줍니다. MongoDB의 멀티 컬렉션 Bulk Write는 복잡한 비즈니스 로직을 더 효율적으로 처리할 수 있게 해줍니다.

아직 M2 단계이므로 프로덕션 환경에 바로 적용하기보다는, 테스트 환경에서 먼저 검증해보시길 권장합니다. GA 릴리즈가 기대되는 만큼, 지금부터 마이그레이션 계획을 세워두는 것도 좋겠습니다.
