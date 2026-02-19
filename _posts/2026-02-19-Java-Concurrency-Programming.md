---
title: 'Java 동시성 프로그래밍 완벽 가이드: synchronized부터 Virtual Thread까지'
date: 2026-02-19 00:00:00
description: 'Java 동시성 프로그래밍의 핵심인 synchronized, ReentrantLock, ConcurrentHashMap, CompletableFuture, 그리고 Java 21 Virtual Thread까지 실전 예제와 함께 완벽 정리합니다.'
featured_image: '/images/2026-02-19-Java-Concurrency-Programming/cover.jpg'
---

![Java 동시성 프로그래밍](/images/2026-02-19-Java-Concurrency-Programming/cover.jpg)

Java 동시성 프로그래밍은 멀티코어 환경에서 성능을 극대화하기 위한 필수 역량입니다. 이 가이드에서는 가장 기본적인 synchronized 키워드부터 Java 21에서 정식 도입된 Virtual Thread까지, 동시성 프로그래밍의 모든 것을 실전 코드와 함께 다룹니다.

## synchronized: 동시성의 출발점

### synchronized의 동작 원리

`synchronized`는 Java에서 가장 기본적인 동기화 메커니즘입니다. 모든 Java 객체는 내부에 **모니터(Monitor)**를 가지고 있으며, synchronized는 이 모니터의 잠금(lock)을 획득하는 방식으로 동작합니다.

```java
public class Counter {
    private int count = 0;

    // 메서드 레벨 synchronized - this 객체의 모니터 잠금
    public synchronized void increment() {
        count++;  // read → modify → write (원자적이지 않은 연산)
    }

    // 블록 레벨 synchronized - 더 세밀한 제어 가능
    public void incrementWithBlock() {
        // 다른 비동기 로직 수행 가능
        synchronized (this) {
            count++;
        }
    }

    public synchronized int getCount() {
        return count;
    }
}
```

### synchronized의 한계

```java
// 문제 1: 공정성(Fairness) 보장 불가
// synchronized는 어떤 스레드가 다음에 lock을 획득할지 보장하지 않음
// → 특정 스레드가 계속 대기(starvation) 가능

// 문제 2: 타임아웃 불가
// lock 획득을 기다리는 중 취소할 수 없음
synchronized (lock) {
    // 이 블록에 진입하기 위해 무한 대기...
}

// 문제 3: 조건부 대기의 복잡성
// wait/notify 패턴은 사용이 어렵고 버그 발생 소지가 높음
synchronized (lock) {
    while (!condition) {
        lock.wait();  // spurious wakeup 가능
    }
}
```

## ReentrantLock: 진화된 동기화

`ReentrantLock`은 synchronized의 한계를 극복하기 위해 `java.util.concurrent.locks` 패키지에 도입되었습니다.

```java
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.TimeUnit;

public class AdvancedCounter {
    private final ReentrantLock lock = new ReentrantLock(true); // fair=true
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();

    private int count = 0;
    private static final int MAX = 100;

    // 타임아웃 지원
    public boolean tryIncrement(long timeout, TimeUnit unit)
            throws InterruptedException {
        if (lock.tryLock(timeout, unit)) {
            try {
                while (count >= MAX) {
                    if (!notFull.await(timeout, unit)) {
                        return false;  // 타임아웃
                    }
                }
                count++;
                notEmpty.signal();
                return true;
            } finally {
                lock.unlock();  // finally에서 반드시 해제!
            }
        }
        return false;
    }

    public int decrement() throws InterruptedException {
        lock.lock();
        try {
            while (count <= 0) {
                notEmpty.await();
            }
            count--;
            notFull.signal();
            return count;
        } finally {
            lock.unlock();
        }
    }
}
```

### ReadWriteLock: 읽기 성능 극대화

읽기가 많고 쓰기가 적은 시나리오에서는 `ReadWriteLock`이 효과적입니다.

```java
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.HashMap;
import java.util.Map;

public class ThreadSafeCache<K, V> {
    private final ReadWriteLock rwLock = new ReentrantReadWriteLock();
    private final Map<K, V> cache = new HashMap<>();

    public V get(K key) {
        rwLock.readLock().lock();   // 여러 스레드 동시 읽기 가능
        try {
            return cache.get(key);
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public void put(K key, V value) {
        rwLock.writeLock().lock();  // 쓰기 시 독점 잠금
        try {
            cache.put(key, value);
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    // StampedLock (Java 8+) - 낙관적 읽기로 더 높은 성능
    // private final StampedLock stampedLock = new StampedLock();
}
```

![스레드 풀과 동시성 제어](/images/2026-02-19-Java-Concurrency-Programming/thread-pool.jpg)

## ConcurrentHashMap: 동시성 컬렉션의 핵심

### 내부 구조와 동작 원리

Java 8 이후 ConcurrentHashMap은 **Bucket별 세분화된 잠금(fine-grained locking)**과 **CAS(Compare-And-Swap)** 연산을 결합합니다.

```java
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

public class WordCounter {
    // 올바른 사용법: 원자적 연산 메서드 활용
    private final ConcurrentHashMap<String, LongAdder> wordCounts =
            new ConcurrentHashMap<>();

    public void countWord(String word) {
        // computeIfAbsent + increment = 원자적 + 효율적
        wordCounts.computeIfAbsent(word, k -> new LongAdder()).increment();
    }

    // ❌ 잘못된 패턴: check-then-act는 원자적이지 않음!
    public void countWordWrong(String word) {
        if (!wordCounts.containsKey(word)) {        // 체크
            wordCounts.put(word, new LongAdder());   // 삽입 (경합 발생!)
        }
        wordCounts.get(word).increment();
    }

    // 집계
    public long getTotalCount() {
        return wordCounts.reduceValuesToLong(
            Long.MAX_VALUE,        // parallelism threshold
            LongAdder::sum,        // transformer
            0L,                    // identity
            Long::sum              // reducer
        );
    }
}
```

### ConcurrentHashMap vs Hashtable vs Collections.synchronizedMap

| 특성 | ConcurrentHashMap | Hashtable | synchronizedMap |
|------|------------------|-----------|-----------------|
| 잠금 범위 | Bucket 단위 | 전체 Map | 전체 Map |
| null 허용 | Key/Value 모두 불가 | 모두 불가 | Key/Value 모두 가능 |
| 반복자 안전성 | Weakly Consistent | Fail-fast | Fail-fast |
| 성능 (동시 읽기) | ★★★★★ | ★★ | ★★ |
| 원자적 연산 | compute, merge 등 | 없음 | 없음 |

## CompletableFuture: 비동기 프로그래밍의 핵심

`CompletableFuture`는 Java 8에서 도입된 비동기 프로그래밍 프레임워크로, 콜백 체이닝과 조합이 가능합니다.

```java
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AsyncOrderService {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);

    public CompletableFuture<OrderResult> processOrder(Order order) {
        return CompletableFuture
            // 1단계: 재고 확인 (비동기)
            .supplyAsync(() -> checkInventory(order), executor)
            // 2단계: 결제 처리
            .thenComposeAsync(inventory -> {
                if (!inventory.isAvailable()) {
                    return CompletableFuture.failedFuture(
                        new OutOfStockException(order.getItemId()));
                }
                return processPayment(order);
            }, executor)
            // 3단계: 배송 요청
            .thenComposeAsync(payment -> requestShipping(order, payment), executor)
            // 에러 처리
            .exceptionally(ex -> {
                log.error("주문 처리 실패: {}", order.getId(), ex);
                return OrderResult.failed(ex.getMessage());
            });
    }

    // 여러 비동기 작업 조합
    public CompletableFuture<ProductDetail> getProductDetail(String productId) {
        CompletableFuture<Product> productFuture =
            CompletableFuture.supplyAsync(() -> getProduct(productId), executor);
        CompletableFuture<List<Review>> reviewsFuture =
            CompletableFuture.supplyAsync(() -> getReviews(productId), executor);
        CompletableFuture<PriceInfo> priceFuture =
            CompletableFuture.supplyAsync(() -> getPrice(productId), executor);

        // 3개의 비동기 작업을 모두 기다린 후 합침
        return productFuture.thenCombine(reviewsFuture, (product, reviews) ->
            new ProductWithReviews(product, reviews)
        ).thenCombine(priceFuture, (productWithReviews, price) ->
            new ProductDetail(productWithReviews, price)
        );
    }

    // 타임아웃 처리 (Java 9+)
    public CompletableFuture<String> fetchWithTimeout(String url) {
        return CompletableFuture
            .supplyAsync(() -> httpGet(url), executor)
            .orTimeout(5, TimeUnit.SECONDS)            // 5초 타임아웃
            .completeOnTimeout("default", 3, TimeUnit.SECONDS); // 3초 후 기본값
    }
}
```

### CompletableFuture 주요 메서드 정리

| 메서드 | 설명 | 반환 타입 |
|--------|------|-----------|
| `supplyAsync(Supplier)` | 비동기 작업 시작 (값 반환) | `CompletableFuture<T>` |
| `thenApply(Function)` | 결과 변환 | `CompletableFuture<U>` |
| `thenCompose(Function)` | 결과로 새 Future 생성 (flatMap) | `CompletableFuture<U>` |
| `thenCombine(Future, BiFunction)` | 두 결과 합침 | `CompletableFuture<V>` |
| `allOf(Future...)` | 모든 Future 완료 대기 | `CompletableFuture<Void>` |
| `anyOf(Future...)` | 가장 빠른 결과 | `CompletableFuture<Object>` |
| `exceptionally(Function)` | 예외 처리 | `CompletableFuture<T>` |
| `handle(BiFunction)` | 성공/실패 모두 처리 | `CompletableFuture<U>` |

## Virtual Thread (Java 21): 동시성의 패러다임 전환

Virtual Thread는 Java 21에서 정식 도입된 경량 스레드입니다. OS 스레드(Platform Thread)와 달리 JVM이 직접 관리하며, **수백만 개**를 동시에 생성할 수 있습니다.

![Virtual Thread 아키텍처](/images/2026-02-19-Java-Concurrency-Programming/virtual-thread.jpg)

### Virtual Thread 기본 사용법

```java
// 방법 1: Thread.ofVirtual()
Thread vThread = Thread.ofVirtual()
    .name("worker-", 0)
    .start(() -> {
        System.out.println(Thread.currentThread());
        // VirtualThread[#21,worker-0]/runnable@ForkJoinPool-1-worker-1
    });

// 방법 2: Executors.newVirtualThreadPerTaskExecutor()
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    // 100만 개의 동시 작업도 OK
    List<Future<String>> futures = new ArrayList<>();
    for (int i = 0; i < 1_000_000; i++) {
        futures.add(executor.submit(() -> {
            Thread.sleep(Duration.ofSeconds(1)); // blocking이지만 OK
            return "done";
        }));
    }
    // 모든 결과 수집
    futures.forEach(f -> {
        try { f.get(); } catch (Exception e) { /* handle */ }
    });
}

// 방법 3: Structured Concurrency (Preview in Java 21)
// try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
//     Subtask<User> userTask = scope.fork(() -> findUser(userId));
//     Subtask<Order> orderTask = scope.fork(() -> findOrder(orderId));
//     scope.join().throwIfFailed();
//     return new UserOrder(userTask.get(), orderTask.get());
// }
```

### Virtual Thread vs Platform Thread

| 항목 | Platform Thread | Virtual Thread |
|------|----------------|----------------|
| 스레드 생성 비용 | ~1MB 스택 메모리 | ~수 KB |
| 최대 동시 스레드 수 | 수천 개 | 수백만 개 |
| 스케줄링 | OS 커널 | JVM (ForkJoinPool) |
| Blocking I/O 시 | OS 스레드 점유 | Carrier Thread 해제 |
| 적합한 작업 | CPU 집약적 | I/O 집약적 |
| `synchronized` 호환 | 완벽 | **pinning 발생 가능** |

### Virtual Thread 주의사항

```java
// ❌ 문제: synchronized 내에서 blocking → pinning 발생
// Carrier Thread가 해제되지 않아 Virtual Thread의 장점 상실
public synchronized String fetchData() {
    return httpClient.send(request);  // pinning!
}

// ✅ 해결: ReentrantLock 사용
private final ReentrantLock lock = new ReentrantLock();

public String fetchData() {
    lock.lock();
    try {
        return httpClient.send(request);  // Virtual Thread가 unmount됨
    } finally {
        lock.unlock();
    }
}

// ❌ 주의: ThreadLocal 남용 금지 (메모리 누수 위험)
// Virtual Thread는 수백만 개 → ThreadLocal도 수백만 개 복사본
private static final ThreadLocal<SimpleDateFormat> formatter =
    ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));

// ✅ 대안: ScopedValue (Preview in Java 21)
// private static final ScopedValue<UserContext> CONTEXT = ScopedValue.newInstance();
```

### Spring Boot에서 Virtual Thread 적용

```yaml
# application.yml (Spring Boot 3.2+)
spring:
  threads:
    virtual:
      enabled: true   # Tomcat이 Virtual Thread로 요청 처리
```

```java
@Configuration
public class VirtualThreadConfig {

    // 비동기 작업도 Virtual Thread로
    @Bean
    public AsyncTaskExecutor applicationTaskExecutor() {
        return new TaskExecutorAdapter(Executors.newVirtualThreadPerTaskExecutor());
    }

    // @Scheduled 작업도 Virtual Thread로
    @Bean
    public TaskScheduler taskScheduler() {
        return new SimpleAsyncTaskScheduler();  // Virtual Thread 기반
    }
}
```

## 데드락 방지 전략

### 데드락 발생 조건 (4가지 모두 충족 시)

1. **상호 배제(Mutual Exclusion)**: 자원은 하나의 스레드만 사용 가능
2. **점유와 대기(Hold and Wait)**: 자원을 가진 채 다른 자원 대기
3. **비선점(No Preemption)**: 다른 스레드의 자원을 강제 해제 불가
4. **순환 대기(Circular Wait)**: 스레드 간 자원 대기가 원형 구조

```java
// ❌ 데드락 발생 코드
public class DeadlockExample {
    private final Object lockA = new Object();
    private final Object lockB = new Object();

    public void method1() {
        synchronized (lockA) {           // lockA 획득
            sleep(100);
            synchronized (lockB) {       // lockB 대기 → 데드락!
                // ...
            }
        }
    }

    public void method2() {
        synchronized (lockB) {           // lockB 획득
            sleep(100);
            synchronized (lockA) {       // lockA 대기 → 데드락!
                // ...
            }
        }
    }
}

// ✅ 해결 1: Lock 순서 고정 (순환 대기 방지)
public void method1() {
    synchronized (lockA) {
        synchronized (lockB) { /* ... */ }
    }
}

public void method2() {
    synchronized (lockA) {               // lockA 먼저!
        synchronized (lockB) { /* ... */ }
    }
}

// ✅ 해결 2: tryLock으로 타임아웃 적용
public boolean transferMoney(Account from, Account to, int amount)
        throws InterruptedException {
    while (true) {
        if (from.getLock().tryLock(1, TimeUnit.SECONDS)) {
            try {
                if (to.getLock().tryLock(1, TimeUnit.SECONDS)) {
                    try {
                        from.debit(amount);
                        to.credit(amount);
                        return true;
                    } finally {
                        to.getLock().unlock();
                    }
                }
            } finally {
                from.getLock().unlock();
            }
        }
        Thread.sleep(ThreadLocalRandom.current().nextInt(100)); // 백오프
    }
}
```

### 데드락 탐지

```bash
# jstack으로 스레드 덤프 확인
jstack <PID> | grep -A 5 "deadlock"

# 출력 예시:
# Found one Java-level deadlock:
# =============================
# "Thread-1":
#   waiting to lock monitor 0x00007f8c3c003f08 (object 0x00000000d7f45e08)
#   which is held by "Thread-0"
# "Thread-0":
#   waiting to lock monitor 0x00007f8c3c006008 (object 0x00000000d7f45e18)
#   which is held by "Thread-1"
```

## 마무리

Java 동시성 프로그래밍은 점점 더 강력하고 사용하기 쉬운 방향으로 진화하고 있습니다.

| 시대 | 핵심 기술 | 키워드 |
|------|-----------|--------|
| Java 1.0 | synchronized, wait/notify | 기본 동기화 |
| Java 5 | java.util.concurrent, Lock, Executor | 고수준 동시성 |
| Java 8 | CompletableFuture, Parallel Stream | 비동기/함수형 |
| Java 21 | Virtual Thread, Structured Concurrency | 경량 스레드 |

**실전 가이드라인:**
1. 단순 동기화 → `synchronized` (가장 쉽고 충분한 경우가 많음)
2. 세밀한 제어 필요 → `ReentrantLock` + `Condition`
3. 동시성 컬렉션 → `ConcurrentHashMap`, `CopyOnWriteArrayList`
4. 비동기 파이프라인 → `CompletableFuture`
5. 대량 I/O 동시 처리 → **Virtual Thread** (Java 21+)
6. **데드락 방지**: Lock 순서 고정, tryLock 타임아웃, 최소 범위 잠금

## 참고 자료

- [Java Concurrency in Practice - Brian Goetz](https://jcip.net/)
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
- [JEP 453: Structured Concurrency (Preview)](https://openjdk.org/jeps/453)
- [Oracle Java Concurrency Tutorial](https://docs.oracle.com/javase/tutorial/essential/concurrency/)
- [Baeldung - Guide to CompletableFuture](https://www.baeldung.com/java-completablefuture)
