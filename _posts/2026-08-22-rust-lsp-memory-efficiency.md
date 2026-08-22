---
title: 'Rust LSP의 RAM 100배 절감 주장을 어떻게 검증할까'
date: 2026-08-22 10:30:00 +0900
categories: ["개발/인프라"]
description: 'Rust Glancer의 저메모리 LSP 구조를 살펴보고, 100배 절감이라는 프로젝트 주장을 동일 기능·동일 워크로드 조건에서 검증하는 벤치마크를 설계한다.'
featured_image: 'https://picsum.photos/seed/rust-lsp-memory-efficiency/1600/900'
tags: [rust, lsp, rust-analyzer, memory, benchmark, developer-tools]
---

![Rust LSP 메모리 효율](https://picsum.photos/seed/rust-lsp-memory-efficiency/1600/900)

Rust 프로젝트가 커질수록 에디터보다 언어 서버가 더 많은 메모리를 쓰는 장면을 어렵지 않게 만난다. 소스 파일, 의존성, 매크로, 타입 관계와 참조 그래프를 계속 추적해야 하므로 어느 정도는 자연스러운 비용이다. 그러나 개발 장비가 8GB 노트북이거나 여러 워크스페이스를 동시에 열어야 한다면 자연스럽다는 설명만으로는 부족하다.

Rust Glancer는 이 문제를 정면으로 겨냥한 대안 Rust LSP다. 프로젝트는 합리적인 규모의 프로젝트에서 100MB 미만을 목표로 하고, 상황에 따라 rust-analyzer보다 RAM을 100배 가까이 줄일 수 있다고 주장한다. 여기서 **100배는 Rust Glancer 프로젝트가 제시하는 주장이지, 독립 기관이 모든 조건에서 재현한 보편적 결과가 아니다.** 무엇보다 현재 Rust Glancer는 완성된 rust-analyzer 대체품이 아니라고 개발자 스스로 명시한다.

흥미로운 것은 숫자보다 구조다. 왜 메모리를 줄일 수 있었으며, 그 대가로 무엇을 포기했을까. 그리고 팀이 이 주장을 검증하려면 어떤 조건을 맞춰야 할까.

## 문제는 인덱스의 크기만이 아니다

Rust 언어 서버는 함수와 구조체 이름만 저장하지 않는다. 모듈 관계, 타입 추론 결과, trait 구현, 함수 본문, 참조 위치, 매크로가 만든 코드까지 질의 가능한 형태로 유지한다. `find references`, completion, hover와 inlay hint가 즉시 동작하려면 이 정보가 빠르게 접근 가능한 곳에 있어야 한다.

rust-analyzer는 salsa 기반의 증분 질의 구조와 rowan 기반 syntax tree를 사용한다. 변경된 부분만 다시 계산하고 키 입력 직후에도 정교한 결과를 돌려주는 데 유리한 선택이다. 반대로 계산 결과와 tree가 메모리에 오래 남고, 많은 작은 객체가 allocator 단편화를 만들 수 있다. 운영체제가 보고하는 RSS는 실제 유효 데이터보다 커질 수 있다.

따라서 두 구현의 차이를 단순히 “한쪽이 최적화를 못 했다”로 해석하면 틀린다. 메모리와 상호작용 지연시간 사이에서 서로 다른 우선순위를 택한 것이다. rust-analyzer는 풍부한 기능과 세밀한 증분 갱신을, Rust Glancer는 제한된 메모리와 재시작 뒤 빠른 재사용을 우선한다.

## Rust Glancer의 핵심은 얼린 분석 결과다

Rust Glancer의 기본 아이디어는 전체 분석 상태를 항상 살아 있는 증분 데이터베이스로 유지하지 않는 것이다. 워크스페이스를 한 번 인덱싱한 뒤 결과를 파일시스템에 보존하고, 질의가 들어올 때 필요한 조각만 읽어 메모리에 올린다.

```text
소스 코드
  ↓ 최초 인덱싱
불변에 가까운 분석 스냅샷
  ↓ 직렬화
디스크의 sharded cache
  ↓ 질의 시 필요한 부분만 로드
hover / definition / completion 결과
```

이 구조에는 두 가지 직접적인 효과가 있다. 첫째, 사용하지 않는 분석 데이터가 RSS를 계속 차지하지 않는다. 둘째, 저장된 인덱스를 에디터 재시작 뒤에도 재사용할 수 있다. 프로젝트 블로그는 재시작 시 재인덱싱 없이 즉시 사용할 수 있다는 점을 주요 기능으로 내세운다.

대신 파일을 읽고 역직렬화하는 비용이 생긴다. 메모리 조회보다 디스크 조회가 느린 것은 피할 수 없다. Rust Glancer는 입력 중인 현재 함수 본문을 얕게 분석하고 이전의 완전한 인덱스를 재사용해 completion 지연을 줄인다. 새로운 import, 구조체나 trait 같은 항목은 저장하기 전까지 전체 인덱스에 반영되지 않을 수 있다. 키 입력마다 완전한 최신 상태를 요구하는 사용자는 차이를 느낄 수 있다.

프로젝트는 엔진을 별도 프로세스로 분리하고, cache를 shard로 나누며, 비슷한 수명의 allocation을 정렬해 단편화를 줄이는 방법도 설명한다. 이들은 단순한 “디스크로 옮기기”보다 실제 RSS 안정성에 중요하다. 프로세스를 끝내면 allocator가 잡고 있던 메모리도 운영체제에 확실히 반환할 수 있기 때문이다.

## 공개 수치가 말하는 것과 말하지 않는 것

프로젝트 소개 글의 표에서는 MacBook Pro M4 Max에서 Rust Glancer가 기본 사용 가능 상태까지 5초, 전체 인덱싱까지 8초가 걸렸고 rust-analyzer는 각각 6초와 13초가 걸렸다고 적었다. M1 8GB 장비에서는 각각 6초·9초와 7초·14초였다. 글에 포함된 시연에서는 Rust Glancer의 사용 RAM이 100MB 아래에 머물렀다고 설명한다.

그러나 이 표만으로 “항상 100배”를 결론 내릴 수는 없다. 테스트 저장소, cache 상태, rust-analyzer 설정, proc macro와 build script 활성화 여부, 완료된 LSP 기능 집합, 메모리 정의가 모두 제시돼야 한다. 개발자가 개인 워크플로에서 두 IDE와 여러 프로젝트를 열었을 때 rust-analyzer가 16GB를 사용했다고 적은 부분도 유용한 문제 사례이지만, 통제된 비교 실험은 아니다.

특히 기능 동등성이 핵심이다. Rust Glancer는 일반적인 syntax, goto definition, hover, inlay hint와 completion을 지원한다고 설명하지만, 알려진 버그와 누락 기능이 있고 proc macro 실행이나 build script 지원을 의도적으로 제한할 가능성이 있다. 분석하지 않은 것을 저장하지 않으면 당연히 메모리는 줄어든다. 같은 기능 조건이 아니면 절감률은 제품 선택 근거가 될 수 없다.

## 100배 주장을 검증하는 벤치마크 설계

첫 단계는 “동일 기능”을 문장으로 고정하는 것이다. 단지 두 서버를 실행하는 것으로 끝내지 말고, 비교할 기능을 명시한다.

- workspace symbols, hover, goto definition, references
- completion과 completion resolve
- inlay hints와 diagnostics
- 파일 저장 뒤 신규 symbol 반영
- 외부 프로세스가 대량 수정한 뒤 재동기화
- proc macro와 build script는 양쪽에서 지원 가능한 공통 범위만 사용

두 번째는 세 종류의 저장소를 준비하는 것이다. 작은 단일 crate, 수십 crate의 일반 workspace, 대규모 monorepo를 고정 commit으로 checkout한다. generated file과 `target` directory도 동일한 상태로 맞춘다. 실제 사내 저장소를 쓸 수 없다면 공개 프로젝트를 복제하되 commit SHA와 Rust toolchain을 기록해야 한다.

세 번째는 cold와 warm을 분리한다. cold run에서는 LSP cache와 OS page cache의 조건을 통제하고 최초 인덱싱을 측정한다. warm run에서는 보존된 cache로 재시작해 사용 가능 상태까지 시간을 잰다. Rust Glancer의 설계상 이 둘을 섞으면 장점이 과장되거나 반대로 사라질 수 있다.

네 번째는 메모리 정의를 통일한다. macOS Activity Monitor의 한 숫자와 Linux `top`의 다른 숫자를 섞어서는 안 된다. 가능하면 동일 OS에서 프로세스 tree 전체의 RSS, proportional set size, peak RSS와 steady-state RSS를 기록한다. 별도 engine, proc-macro server, build script process처럼 LSP가 만든 자식 프로세스도 합산한다.

```text
총 메모리 = LSP 본체 RSS
          + 자식 분석 프로세스 RSS
          + proc-macro/build-script 관련 프로세스 RSS
```

다섯 번째는 자동화된 LSP client로 같은 질의를 같은 순서에 보낸다. 200개 파일에서 hover, definition과 references를 호출하고, 50개 함수 본문을 편집한 뒤 completion latency를 측정한다. 새 struct와 import를 추가해 저장 전·후 정확도도 비교한다. 각 작업의 성공 여부와 결과 개수까지 확인해야 “응답은 빨랐지만 비어 있었다”는 오류를 막을 수 있다.

여섯 번째는 시간축을 넣는다. 최초 인덱싱 직후, 10분 유휴 후, 1시간 편집 후, 대량 branch 전환 후의 메모리를 측정한다. 평균뿐 아니라 peak와 p95 latency를 보고, 최소 10회 반복해 중앙값과 분산을 제시한다. 결과는 다음처럼 기능·성능·메모리를 한 표에 묶는 편이 좋다.

| 지표 | Rust Glancer | rust-analyzer |
|---|---:|---:|
| 공통 기능 성공률 | 측정값 | 측정값 |
| cold index p50 | 측정값 | 측정값 |
| warm restart p50 | 측정값 | 측정값 |
| steady RSS p50 | 측정값 | 측정값 |
| peak RSS p95 | 측정값 | 측정값 |
| completion p95 | 측정값 | 측정값 |
| 저장 전 신규 symbol 정확도 | 측정값 | 측정값 |

절감 배수는 `rust-analyzer의 총 메모리 / Rust Glancer의 총 메모리`로 계산하되 cold peak, warm idle, 장시간 편집을 따로 제시해야 한다. 하나의 가장 좋은 구간만 골라 “100배”라고 부르면 재현 가능한 평가가 아니다.

## 트레이드오프를 사용자 경험으로 번역하기

RAM 절감은 명확한 이점이다. 8GB 장비에서 browser, container와 IDE를 함께 유지할 수 있고, 여러 workspace를 여는 개발자에게도 도움이 된다. cache 재사용은 에디터를 자주 재시작하거나 branch를 오가는 환경에서 CPU burst와 배터리 사용을 줄일 가능성이 있다.

대가는 최신성, 완전성, disk I/O다. 저장 전 신규 item이 검색되지 않을 수 있고, 복잡한 nightly 문법이나 macro 기반 framework에서 결과가 부족할 수 있다. 네트워크 홈 디렉터리나 느린 SSD에서는 cache 조회 지연이 커질 수 있으며, 저장된 분석 결과가 disk 용량과 cache invalidation 문제를 만든다.

보안 관점도 있다. build script와 proc macro 실행을 피하는 제한은 호환성을 낮추지만, 신뢰하지 않는 저장소의 코드를 IDE가 자동 실행하는 위험을 줄인다. 어느 쪽이 무조건 우월한 것이 아니라 개발 환경의 위협 모델과 framework 의존도에 따라 평가해야 한다.

## 도입 전 실무 체크리스트

- [ ] 프로젝트가 요구하는 macro, build script, nightly 기능을 목록화했다.
- [ ] 팀이 매일 쓰는 LSP 기능을 자동화된 acceptance test로 만들었다.
- [ ] 동일 commit, toolchain, OS와 editor 설정으로 비교했다.
- [ ] LSP가 만든 모든 자식 프로세스의 메모리를 합산했다.
- [ ] cold index와 warm restart를 분리해 최소 10회 측정했다.
- [ ] 평균뿐 아니라 peak RSS와 p95 interaction latency를 확인했다.
- [ ] 저장 전·후 completion, diagnostics와 symbol 최신성을 비교했다.
- [ ] branch 전환과 agent의 대량 파일 수정 시나리오를 재현했다.
- [ ] cache disk 사용량, 삭제 정책과 오래된 cache의 무효화를 확인했다.
- [ ] 일부 개발자에게 먼저 적용하고 생산성 저하 사례를 기록했다.
- [ ] 결과표에 누락 기능과 실패율을 메모리 수치 옆에 표시했다.

## 결론

Rust Glancer의 의미는 “rust-analyzer가 잘못 설계됐다”는 데 있지 않다. 언어 서버가 모든 분석 결과를 메모리에 둔 증분 시스템이어야 한다는 전제를 바꾸고, 파일시스템의 불변 스냅샷과 필요 시 로드를 선택했다는 데 있다. 이 선택은 매우 낮은 RAM과 재시작 뒤 빠른 재사용을 가능하게 하지만, 저장 전 최신성과 기능 완전성에는 비용을 남긴다.

100배라는 숫자는 주목할 만한 프로젝트 주장이다. 다만 그 숫자를 받아들이려면 동일 저장소와 동일 기능, 동일 cache 상태, 동일 프로세스 범위에서 다시 측정해야 한다. 메모리 절감률만큼 기능 성공률과 p95 latency를 함께 공개해야 비교가 정직해진다.

저사양 장비, 많은 workspace, 제한된 container 환경에서는 Rust Glancer가 실용적인 선택이 될 수 있다. proc macro와 키 입력 단위 정확도가 중요한 대규모 Rust 제품에서는 rust-analyzer가 여전히 안전한 기본값일 수 있다. 좋은 벤치마크의 목적은 승자를 선언하는 것이 아니라 우리 workload가 어느 트레이드오프를 감당할 수 있는지 확인하는 것이다.

## 참고 자료

- [Rust Glancer: Hello, world!](https://rust-glancer.github.io/blog/hello-world/)
