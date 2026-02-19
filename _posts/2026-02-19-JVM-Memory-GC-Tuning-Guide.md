---
title: 'JVM 메모리 구조와 GC 튜닝 실전 가이드'
date: 2026-02-19 00:00:00
description: 'JVM 메모리 구조(Heap, Stack, Metaspace)를 깊이 이해하고 G1GC, ZGC 비교 분석과 GC 로그 해석법, jstat·jmap·VisualVM을 활용한 실전 튜닝 사례를 다룹니다.'
featured_image: '/images/2026-02-19-JVM-Memory-GC-Tuning-Guide/cover.jpg'
---

![JVM 메모리 구조와 GC 튜닝](/images/2026-02-19-JVM-Memory-GC-Tuning-Guide/cover.jpg)

JVM 메모리 구조를 정확히 이해하는 것은 Java 애플리케이션의 성능 최적화와 안정적 운영의 핵심입니다. 이 가이드에서는 Heap, Stack, Metaspace의 내부 구조부터 G1GC와 ZGC의 동작 원리 비교, GC 로그 분석법, 그리고 실전 튜닝 사례까지 체계적으로 다룹니다.

## JVM 메모리 구조란 무엇인가?

JVM(Java Virtual Machine)은 운영체제 위에서 Java 바이트코드를 실행하는 가상 머신입니다. JVM이 관리하는 메모리는 크게 **Heap**, **Stack**, **Metaspace**, **Code Cache**, **Direct Memory** 영역으로 나뉩니다.

### Heap 영역

Heap은 객체 인스턴스가 할당되는 공간으로, GC(Garbage Collection)의 주요 대상입니다.

```
+--------------------------------------------------+
|                    Heap                            |
|  +-------------+  +-------------+  +----------+  |
|  | Young Gen   |  | Old Gen     |  | Humongous|  |
|  | +----+----+ |  |             |  | Objects  |  |
|  | |Eden|S0|S1||  |             |  |          |  |
|  | +----+----+ |  |             |  |          |  |
|  +-------------+  +-------------+  +----------+  |
+--------------------------------------------------+
```

- **Young Generation**: 새로 생성된 객체가 할당됨. Eden과 두 개의 Survivor 영역으로 구성
- **Old Generation**: Young Generation에서 살아남은 객체가 승격(Promotion)되는 공간
- **Humongous Objects**: Region 크기의 50% 이상인 대형 객체 전용 (G1GC)

### Stack 영역

각 스레드마다 독립적으로 할당되며, 메서드 호출 시 프레임(Frame)이 쌓입니다.

```java
public class StackExample {
    public static void main(String[] args) {    // Frame 1
        int result = calculate(10, 20);          // Frame 2 push
        System.out.println(result);              // Frame 2 pop 후 실행
    }

    static int calculate(int a, int b) {         // Frame 2
        int sum = a + b;                         // 로컬 변수는 Stack에 저장
        return sum;
    }
}
```

Stack에는 **로컬 변수**, **오퍼랜드 스택**, **프레임 데이터**(상수 풀 참조, 예외 테이블 등)가 저장됩니다.

| 구분 | 저장 위치 | 설명 |
|------|-----------|------|
| 기본형 변수 (int, long 등) | Stack | 값 자체가 저장됨 |
| 참조형 변수 (Object) | Stack (참조) + Heap (객체) | 참조 주소만 Stack에 저장 |
| static 변수 | Metaspace | 클래스 로딩 시 할당 |

### Metaspace 영역

Java 8부터 PermGen이 제거되고 Metaspace로 대체되었습니다. **네이티브 메모리**를 사용하므로 기본적으로 크기 제한이 없습니다.

```bash
# Metaspace 크기 설정
-XX:MetaspaceSize=256m          # 초기 크기 (GC 트리거 임계치)
-XX:MaxMetaspaceSize=512m       # 최대 크기 (OOM 방지)
```

Metaspace에 저장되는 데이터:
- 클래스 메타데이터 (필드, 메서드 정보)
- 상수 풀 (Constant Pool)
- 메서드 바이트코드
- 어노테이션 정보

![JVM 메모리 영역 상세 구조](/images/2026-02-19-JVM-Memory-GC-Tuning-Guide/memory-structure.jpg)

## G1GC vs ZGC: 어떤 GC를 선택해야 하는가?

### G1GC (Garbage First GC)

Java 9부터 기본 GC로 채택된 G1GC는 Heap을 동일 크기의 **Region**으로 분할하여 관리합니다.

```bash
# G1GC 활성화 및 기본 설정
-XX:+UseG1GC
-XX:G1HeapRegionSize=16m        # Region 크기 (1MB~32MB, 2의 거듭제곱)
-XX:MaxGCPauseMillis=200        # 목표 pause time
-XX:G1NewSizePercent=20         # Young Gen 최소 비율
-XX:G1MaxNewSizePercent=60      # Young Gen 최대 비율
```

**G1GC 동작 단계:**

1. **Young GC**: Eden이 가득 차면 실행. STW(Stop-The-World) 발생
2. **Concurrent Marking**: Old Gen 사용률이 임계치(`InitiatingHeapOccupancyPercent`)를 넘으면 시작
3. **Mixed GC**: Young + 가비지가 많은 Old Region을 함께 수집
4. **Full GC**: 최후의 수단. 전체 Heap을 대상으로 STW 수집

```java
// G1GC에서 Humongous Object 할당 예시 - 주의 필요
byte[] largeArray = new byte[32 * 1024 * 1024]; // 32MB → Humongous Object
// Region 크기(예: 16MB)의 50% 이상이면 Humongous로 분류
// Humongous Object는 Old Gen에 바로 할당되어 GC 부담 증가
```

### ZGC (Z Garbage Collector)

Java 15에서 프로덕션 준비가 완료된 ZGC는 **최대 pause time 1ms 이내**를 목표로 합니다.

```bash
# ZGC 활성화
-XX:+UseZGC
-XX:+ZGenerational              # Java 21+ Generational ZGC (권장)
-Xmx16g                         # 최대 Heap 크기
-XX:SoftMaxHeapSize=12g         # Soft 제한 (가능하면 이 이하 유지)
```

**ZGC 핵심 기술:**

- **Colored Pointers**: 포인터의 상위 비트에 메타데이터 저장 (Marked, Remapped, Finalizable)
- **Load Barriers**: 참조 읽기 시 배리어를 통해 동시성 보장
- **Region 기반 메모리 관리**: Small(2MB), Medium(32MB), Large(가변) 세 종류 Region

### G1GC vs ZGC 비교표

| 항목 | G1GC | ZGC |
|------|------|-----|
| 최대 Pause Time | 수십~수백 ms | < 1 ms |
| Heap 크기 지원 | 수 GB ~ 수십 GB | 수 MB ~ 16 TB |
| CPU 오버헤드 | 낮음 | 중간 (Load Barrier) |
| 처리량(Throughput) | 높음 | G1GC 대비 ~5% 낮음 |
| 적합한 워크로드 | 범용, 배치 처리 | 저지연 필수, 대용량 Heap |
| Java 최소 버전 | Java 9+ (기본) | Java 15+ (프로덕션) |
| Generational 지원 | 기본 내장 | Java 21+ (-XX:+ZGenerational) |

**선택 가이드:**
- **응답 시간이 중요한 API 서버** → ZGC
- **배치 처리, 처리량 우선** → G1GC
- **Heap 4GB 이하** → G1GC (ZGC 오버헤드가 상대적으로 큼)
- **Heap 8GB 이상 + 저지연 요구** → ZGC

## GC 로그 분석법: 문제를 진단하는 핵심 기술

### GC 로그 활성화

```bash
# Java 17+ 통합 로깅 (Unified Logging)
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m

# 상세 로그 (튜닝 시 권장)
-Xlog:gc*,gc+phases=debug,gc+age=trace:file=/var/log/app/gc-detail.log:time,uptime,level,tags
```

### G1GC 로그 읽기

```
[2026-02-19T10:15:30.123+0900][info][gc] GC(42) Pause Young (Normal) (G1 Evacuation Pause)
[2026-02-19T10:15:30.123+0900][info][gc] GC(42)   Pre Evacuate Collection Set: 0.2ms
[2026-02-19T10:15:30.123+0900][info][gc] GC(42)   Merge Heap Roots: 0.3ms
[2026-02-19T10:15:30.123+0900][info][gc] GC(42)   Evacuate Collection Set: 12.5ms
[2026-02-19T10:15:30.123+0900][info][gc] GC(42)   Post Evacuate Collection Set: 1.1ms
[2026-02-19T10:15:30.123+0900][info][gc] GC(42)   Other: 0.4ms
[2026-02-19T10:15:30.123+0900][info][gc] GC(42) Pause Young (Normal) 512M->128M(1024M) 14.5ms
                                                                       ^Eden  ^After ^Total ^Pause
```

주의해야 할 패턴:
- **Pause Young (Concurrent Start)**: Mixed GC 사이클 시작 → Old Gen 압박
- **Full GC**: 절대 발생하면 안 되는 이벤트. 즉시 원인 분석 필요
- **To-space exhausted**: Survivor/Old 공간 부족. Heap 증설 또는 튜닝 필요

### ZGC 로그 읽기

```
[2026-02-19T10:15:30.456+0900][info][gc] GC(107) Garbage Collection (Proactive)
[2026-02-19T10:15:30.456+0900][info][gc] GC(107) Pause Mark Start 0.021ms
[2026-02-19T10:15:30.567+0900][info][gc] GC(107) Concurrent Mark 110.234ms
[2026-02-19T10:15:30.567+0900][info][gc] GC(107) Pause Mark End 0.018ms
[2026-02-19T10:15:30.789+0900][info][gc] GC(107) Concurrent Process Non-Strong References 5.123ms
[2026-02-19T10:15:30.890+0900][info][gc] GC(107) Concurrent Relocate 100.456ms
[2026-02-19T10:15:30.890+0900][info][gc] GC(107) Pause Relocate Start 0.015ms
[2026-02-19T10:15:30.890+0900][info][gc] GC(107)     Used: 8192M->4096M
[2026-02-19T10:15:30.890+0900][info][gc] GC(107) Garbage Collection (Proactive) 8192M->4096M
```

ZGC에서는 **Pause** 부분만 STW이며, 나머지는 모두 Concurrent입니다.

![GC 튜닝 모니터링 대시보드](/images/2026-02-19-JVM-Memory-GC-Tuning-Guide/gc-tuning.jpg)

## 실전 GC 튜닝 사례

### 사례 1: API 서버의 P99 응답시간 급증

**증상**: 평소 P99 50ms → 간헐적으로 500ms 이상 스파이크

**진단 과정:**

```bash
# 1. GC 로그에서 Full GC 확인
grep "Full GC" /var/log/app/gc.log
# 결과: [info][gc] GC(1523) Pause Full (G1 Compaction Pause) 2048M->1536M(2048M) 3245.678ms

# 2. Heap 사용 패턴 확인
jstat -gcutil <PID> 1000 10
#  S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
#  0.00  98.72  45.23  95.11  93.45  90.12   5432   45.123    3   9.876   54.999

# 3. Old Gen 95% → 거의 가득 참 → Full GC 발생 원인
```

**해결:**

```bash
# Before
-Xmx2g -XX:+UseG1GC

# After - Heap 증설 + IHOP 조정 + Mixed GC 적극 수행
-Xmx4g
-XX:+UseG1GC
-XX:InitiatingHeapOccupancyPercent=35    # 기본 45 → 35로 낮춰 Mixed GC 일찍 시작
-XX:G1MixedGCCountTarget=16             # Mixed GC 횟수 증가
-XX:G1HeapWastePercent=5                # 가비지 5%만 남아도 Mixed GC 수행
-XX:MaxGCPauseMillis=100                # 목표 pause time 단축
```

### 사례 2: 대용량 캐시 서버의 메모리 문제

**증상**: ConcurrentHashMap 기반 로컬 캐시 사용 중 OOM 발생

```java
// 문제 코드: 크기 제한 없는 캐시
private static final Map<String, byte[]> cache = new ConcurrentHashMap<>();

public void put(String key, byte[] value) {
    cache.put(key, value);  // 계속 쌓임 → OOM
}
```

**해결: Weak Reference + 크기 제한 적용**

```java
// 개선 1: Caffeine 캐시 사용 (크기 제한 + 만료 정책)
private final Cache<String, byte[]> cache = Caffeine.newBuilder()
    .maximumWeight(512 * 1024 * 1024)  // 최대 512MB
    .weigher((String k, byte[] v) -> v.length)
    .expireAfterAccess(Duration.ofMinutes(30))
    .recordStats()
    .build();

// 개선 2: GC 튜닝 - ZGC 전환 (대용량 Heap에 유리)
// -XX:+UseZGC -XX:+ZGenerational -Xmx16g -XX:SoftMaxHeapSize=12g
```

### 사례 3: 메모리 릭 탐지

```bash
# 1. Heap Dump 생성
jmap -dump:live,format=b,file=/tmp/heapdump.hprof <PID>

# 2. OOM 시 자동 Heap Dump
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof

# 3. 클래스별 인스턴스 수 확인
jmap -histo <PID> | head -20
#  num     #instances         #bytes  class name
#    1:       5234567      125629608  [B (byte[])
#    2:       3456789       82962936  java.lang.String
#    3:       1234567       39506144  java.util.HashMap$Node
```

## jstat, jmap, VisualVM 활용법

### jstat: 실시간 GC 모니터링

```bash
# GC 통계 1초 간격 출력
jstat -gcutil <PID> 1000

# GC 원인 확인
jstat -gccause <PID> 1000
#  S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT    GCT    LGCC                 GCC
#  0.00  45.23  67.89  34.56  95.12  92.34   123    1.234    0    0.000   1.234  G1 Evacuation Pause  No GC

# Heap 세대별 용량 확인
jstat -gccapacity <PID>
```

| jstat 옵션 | 설명 |
|------------|------|
| `-gcutil` | GC 통계 (사용률 %) |
| `-gccause` | GC 통계 + 마지막 GC 원인 |
| `-gccapacity` | 세대별 용량 (바이트) |
| `-gcnew` | Young Generation 상세 |
| `-gcold` | Old Generation 상세 |

### jmap: 메모리 스냅샷

```bash
# Heap 히스토그램 (라이브 객체만)
jmap -histo:live <PID> > /tmp/histo.txt

# Heap Dump 생성 (주의: 애플리케이션 일시 중지)
jmap -dump:live,format=b,file=/tmp/heap.hprof <PID>

# Heap 요약 정보
jmap -heap <PID>
```

### VisualVM: GUI 기반 종합 모니터링

VisualVM은 JDK에 포함된(또는 별도 다운로드) GUI 모니터링 도구입니다.

```bash
# 원격 JMX 연결 설정 (애플리케이션 JVM 옵션)
-Dcom.sun.management.jmxremote
-Dcom.sun.management.jmxremote.port=YOUR_JMX_PORT
-Dcom.sun.management.jmxremote.ssl=false
-Dcom.sun.management.jmxremote.authenticate=true
-Dcom.sun.management.jmxremote.password.file=YOUR_PASSWORD_FILE
```

**VisualVM 주요 기능:**
- **Monitor 탭**: CPU, Heap, Metaspace, 스레드 수 실시간 그래프
- **Sampler 탭**: CPU/메모리 샘플링 (프로파일링 대비 저오버헤드)
- **Profiler 탭**: 메서드 레벨 CPU/메모리 프로파일링
- **Heap Dump 분석**: 가장 많은 메모리를 차지하는 객체 트리 탐색

## 프로덕션 환경 GC 튜닝 체크리스트

```bash
# 1. 기본 JVM 옵션 템플릿 (API 서버, G1GC 기준)
-server
-Xms4g -Xmx4g                           # Heap 크기 고정 (Xms = Xmx)
-XX:+UseG1GC
-XX:MaxGCPauseMillis=100
-XX:InitiatingHeapOccupancyPercent=35
-XX:+ParallelRefProcEnabled              # Reference 처리 병렬화
-XX:+UseStringDeduplication              # String 중복 제거

# 2. GC 로깅 (필수)
-Xlog:gc*,gc+phases=debug:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m

# 3. OOM 대비
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/

# 4. JMX 모니터링
-Dcom.sun.management.jmxremote
-Dcom.sun.management.jmxremote.port=YOUR_JMX_PORT
```

```bash
# ZGC 전환 시 템플릿 (Java 21+)
-server
-Xms8g -Xmx8g
-XX:+UseZGC
-XX:+ZGenerational
-XX:SoftMaxHeapSize=6g
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/
```

## 마무리

JVM 메모리 구조와 GC 튜닝은 단순히 옵션을 복사해서 붙여넣는 작업이 아닙니다. **애플리케이션의 메모리 사용 패턴을 이해**하고, **GC 로그를 통해 병목을 진단**하며, **점진적으로 튜닝**해나가는 과정입니다.

핵심 요약:
1. **Heap 구조를 이해**하고 Young/Old Gen 비율을 워크로드에 맞게 조정
2. **G1GC는 범용**, **ZGC는 저지연** — 워크로드 특성에 따라 선택
3. **GC 로그는 항상 활성화** — 문제가 생기기 전에 모니터링
4. **jstat으로 실시간 감시**, **jmap으로 스냅샷**, **VisualVM으로 심층 분석**
5. **Full GC는 경고 신호** — 발생 시 즉시 원인 분석

## 참고 자료

- [Oracle JVM Garbage Collection Tuning Guide](https://docs.oracle.com/en/java/javase/21/gctuning/)
- [OpenJDK ZGC Wiki](https://wiki.openjdk.org/display/zgc)
- [G1GC Fundamentals - Oracle Blog](https://blogs.oracle.com/javamagazine/post/understanding-the-jdk-garbage-collectors)
- [VisualVM 공식 사이트](https://visualvm.github.io/)
- [jstat 명령어 레퍼런스](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jstat.html)
