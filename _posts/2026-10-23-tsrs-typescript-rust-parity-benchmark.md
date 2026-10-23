---
title: 'TypeScript를 Rust로 옮기면 정말 8배 빨라질까: tsrs 호환성부터 검증하기'
date: 2026-10-23 09:00:16 +0900
categories: ["개발/도구"]
description: '실험적 Rust TypeScript 컴파일러 tsrs를 도입하기 전에 타입 의미, 진단, 종료 코드의 동등성을 먼저 검증하고 cold·warm·worker 조건을 분리해 성능과 메모리를 재는 방법을 정리합니다.'
featured_image: 'https://picsum.photos/seed/tsrs-typescript-rust-parity-benchmark/1600/900'
tags: [typescript, tsrs, rust, compiler, type-checking, benchmark, diagnostic-parity, ci]
---

![어두운 밤 눈밭에서 마주 선 두 사람과 역광에 반짝이는 눈송이](https://picsum.photos/seed/tsrs-typescript-rust-parity-benchmark/1600/900)

“Rust로 다시 썼으니 빠르다”는 설명은 흥미롭지만, 컴파일러 교체의 승인 근거로는 부족하다. 타입 검사기는 같은 소스에서 같은 타입 의미를 적용하고, 같은 진단을 내며, CI가 해석하는 같은 종료 코드를 반환해야 한다. 이 세 가지가 어긋나면 1초가 100밀리초로 줄어도 개발자는 더 빠르게 잘못된 결론에 도착할 뿐이다.

Cloudflare는 2026년 10월 20일 `tsrs`를 공개하면서, 같은 수의 type-check worker를 사용한 초기 비교에서 TypeScript 7.0보다 **최대 8배 빠르고 메모리를 약 70% 적게 사용했다**고 밝혔다. 동시에 배포물을 명시적으로 experimental release라고 불렀고, 현재 upstream과 진단 출력 순서 같은 차이가 남아 있다고 적었다.[1] 따라서 이 숫자는 제품 보증이나 모든 저장소의 평균이 아니다. 특정 프로젝트, 하드웨어, compiler revision, PGO 빌드, worker 수, 측정 방식 아래에서 얻은 vendor 결과다.

이 글의 결론은 “당장 `tsc`를 지우자”가 아니다. 먼저 호환성 게이트를 통과시키고, 그다음 동일 조건에서 시간을 재며, 마지막에만 CI 역할을 바꾸자는 것이다. TypeScript 6 마이그레이션이나 TypeScript 7 전환 항목은 다루지 않는다. 대상은 오직 `tsrs`가 현재 프로젝트에서 기존 기준 컴파일러와 같은 판정을 내리는지, 그리고 그 판정을 얼마나 적은 시간과 메모리로 만드는지다.

## 먼저 프로젝트의 신원을 고정한다

이름이 짧고 프로젝트가 젊을수록 저장소, npm 패키지, 소스 revision을 한 묶음으로 기록해야 한다. 이 글에서 확인한 정식 저장소는 `oxc-project/tsrs`이고, 작성 시점의 `main` HEAD는 `d9e5b1f683f2826d93f24552fef9819d421150ba`다. 해당 revision의 README는 `tsrs`를 Rust로 작성한 TypeScript 7 compiler·language server의 drop-in replacement로 소개하지만, 100% conformance는 현재 상태가 아니라 목표로 표현한다.[2]

라이선스도 “GitHub에 Apache 배지가 보인다”에서 멈추면 안 된다. 위 `main` revision의 루트 `LICENSE`는 Apache License 2.0 전문이다.[3] npm에서 확인한 최신 배포물은 `tsrs@0.18.0-ts7.1.0-dev.20260929`이며, metadata에는 저장소가 `oxc-project/tsrs`, 라이선스가 `Apache-2.0`, Node.js 요구 버전이 `>=16.20.0`, 포팅 대상 TypeScript commit이 `b85298b6a81f772d080b0455de0ca9d744cd6fd6`로 기록돼 있다.[4] 이 배포물에 대응하는 Git tag `v0.18.0`은 commit `5f92808bc92bb97b06212153ab73d28d551c0b9b`를 가리키며, 그 tag의 `LICENSE` 역시 Apache-2.0이다.[5]

이 구분이 중요한 이유는 `main`이 이미 배포물보다 앞서 움직일 수 있기 때문이다. 현재 소스의 라이선스, 실제 설치한 tarball의 metadata와 동봉 `LICENSE`·`NOTICE`, release tag를 각각 확인해야 “라이선스가 있는 저장소”와 “내가 실행한 artifact의 라이선스”를 혼동하지 않는다. 이번 확인에서는 release tarball에도 `LICENSE`와 `NOTICE.txt`가 들어 있었고, NOTICE는 이 프로젝트가 Microsoft TypeScript의 파생물이며 번들된 `lib.*.d.ts`의 귀속을 명시했다. 다만 이 사실은 다음 release에도 자동 승계되는 보증이 아니므로 버전을 올릴 때 다시 확인해야 한다.

## 성능보다 먼저 통과해야 할 네 가지 parity

첫 번째는 **타입 의미 parity**다. 단순히 오류 개수만 같아서는 안 된다. discriminated union narrowing, generic constraint, overload 선택, conditional type, module resolution, declaration emit처럼 프로젝트가 실제로 의존하는 의미가 같아야 한다. 오류 12개 대 12개라도 서로 다른 위치에서 서로 다른 코드를 지적한다면 동등하지 않다.

두 번째는 **diagnostic parity**다. 최소 비교 단위는 파일 경로, 행·열, diagnostic code, message와 관련 정보다. 멀티스레드 실행에서는 출력 순서가 흔들릴 수 있으므로 원문 전체를 한 줄 diff하는 방식만 고집하면 거짓 불일치가 생긴다. 반대로 오류 code만 정렬해 비교하면 위치와 message가 달라진 진짜 회귀를 놓친다. 진단 한 건을 구조화한 뒤 순서만 정규화해야 한다.

세 번째는 **exit-code parity**다. CI는 사람이 읽는 문장보다 프로세스 상태를 먼저 본다. 정상 프로젝트, 타입 오류가 있는 프로젝트, 잘못된 `tsconfig`, 찾을 수 없는 입력, 지원하지 않는 명령을 별도 fixture로 만들고 두 도구의 종료 코드를 비교해야 한다. `tsrs` 문서는 같은 pinned compiler와 비교할 때 진단의 순서, 문구, 종료 코드 차이를 버그로 간주하지만, `--init`과 `--showConfig`는 지원하지 않는다고 명시한다.[6] 그러므로 이 두 명령을 사용하는 bootstrap job까지 무심코 교체해서는 안 된다.

네 번째는 **artifact parity**다. `--noEmit`만 쓰는 CI라면 타입 판정이 핵심이지만, JavaScript, declaration, source map, `.tsbuildinfo`를 생성한다면 파일 목록과 내용도 비교해야 한다. 프로젝트가 compiler API, editor language server, content mapper를 사용한다면 CLI 성공만으로 범위를 넓혀서는 안 된다. 각 소비 경로가 별도의 승인 대상이다.

현재 호환성 문서는 conformance suite에서 13,462개 error baseline 중 13,458개가 reference와 일치하고, 나머지 네 개는 test-harness artifact라고 설명한다. `.types`와 `.symbols` baseline 12,779개는 모두 일치한다고 보고한다.[6] 이는 강한 upstream 증거지만, 우리 저장소의 plugin, 생성 코드, 경로 규칙, monorepo reference까지 동일하다는 증명은 아니다. upstream 통과율은 도입 검토를 시작할 근거이고, 로컬 corpus parity가 실제 승인 근거다.

## 안전하게 재현하는 작은 fixture

아래 fixture는 임시 디렉터리 안에서만 동작하고, 두 버전을 정확히 고정하며, lifecycle script를 실행하지 않는다. 의도적으로 세 종류의 타입 오류를 만든다. benchmark용 대형 workload가 아니라 parity 수집 파이프라인이 제대로 실패를 포착하는지 확인하는 smoke test다.

```bash
set -euo pipefail

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
mkdir -p src

cat > package.json <<'JSON'
{
  "private": true,
  "devDependencies": {
    "tsrs": "0.18.0-ts7.1.0-dev.20260929",
    "typescript": "7.1.0-dev.20260930.4"
  }
}
JSON

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "incremental": false,
    "pretty": false,
    "skipLibCheck": false
  },
  "include": ["src/**/*.ts"]
}
JSON

cat > src/index.ts <<'TS'
type DomainEvent =
  | { kind: "created"; id: string }
  | { kind: "deleted"; id: number };

function consume(event: DomainEvent): string {
  if (event.kind === "created") return event.id;
  return event.id;
}

const port = "443" satisfies number;
consume({ kind: "deleted", id: "7" });
TS

npm install --ignore-scripts --package-lock=false

set +e
LC_ALL=C NO_COLOR=1 npx tsc -p tsconfig.json --noEmit --pretty false \
  > tsc.out 2>&1
tsc_status=$?
LC_ALL=C NO_COLOR=1 npx tsrs -p tsconfig.json --noEmit --pretty false \
  --checkers 4 --checkerAssignment go --noLazyMembers > tsrs.out 2>&1
tsrs_status=$?
set -e

printf 'tsc=%s tsrs=%s\n' "$tsc_status" "$tsrs_status"
test "$tsc_status" -eq "$tsrs_status"
python3 - <<'PY'
from pathlib import Path

def normalized(path: str) -> list[str]:
    return sorted(
        line.rstrip()
        for line in Path(path).read_text().splitlines()
        if line.strip()
    )

left = normalized("tsc.out")
right = normalized("tsrs.out")
if left != right:
    raise SystemExit("diagnostic mismatch")
print("diagnostics match")
PY
```

`typescript@7.1.0-dev.20260930.4`는 실제 npm metadata에서 `tsc` binary를 제공하는 버전이다.[7] 위 조합을 Linux x64에서 실행했을 때 두 프로세스는 모두 status `2`를 반환했고, TS2322·TS1360·TS2345 진단의 위치와 문구가 일치했다. 이것은 fixture 세 건에 대한 확인이지 “tsrs 전체가 동등하다”는 선언은 아니다.

`--checkerAssignment go --noLazyMembers`는 `tsrs`가 가장 가까운 비교를 위해 안내하는 옵션이다. 기본 `tsrs`는 machine에 맞춰 worker를 더 많이 선택하고 checker history를 canonicalize하며 lazy member 최적화를 켠다. 그 기본값은 빠른 경로를 찾는 데 유용하지만, 첫 parity 실험에는 변수를 늘린다. JavaScript `tsc`에는 `--checkers`가 없으므로 같은 worker 수라고 주장하지 않는다. 먼저 `tsc` 기본 실행과 명시한 `tsrs` 구성을 비교해 의미를 확인하고, 그다음 `tsrs` 옵션을 하나씩 기본값으로 되돌려 차이를 관찰한다.[2][6]

실제 저장소에서는 단순 행 정렬 대신 diagnostic block parser를 쓰는 편이 안전하다. 여러 줄짜리 related information을 부모 진단에 묶고, 작업 디렉터리의 절대 경로만 상대 경로로 바꾸며, 파일명·행·열·code·message는 보존한다. normalization 규칙 자체도 version control에 넣어야 비교기가 compiler 차이를 숨기는 일을 막을 수 있다.

## CI 전환은 shadow부터 시작한다

첫 단계에서 기존 `tsc` job은 유일한 blocking gate로 남긴다. 같은 checkout과 lockfile에서 `tsrs`를 non-blocking shadow job으로 실행하고, 원문 출력·정규화 출력·종료 코드·compiler version·commit·worker 수를 artifact로 보존한다. 실패 여부를 Slack 한 줄로만 보내지 말고, 어떤 진단이 추가·삭제·이동했는지 확인할 수 있어야 한다.

두 번째 단계에서는 저장소의 대표 corpus를 고정한다. 정상 build, 의도된 type error, project references, generated declarations, path alias, package boundary, 대형 conditional type, incremental build를 포함한다. production source만 재면 “오류가 없어서 둘 다 0”인 약한 검사가 되기 쉽다. 과거 장애를 일으킨 타입 패턴을 작은 fixture로 환원하면 compiler upgrade 때마다 같은 의미를 재검증할 수 있다.

세 번째 단계에서는 일정 기간 shadow 결과를 누적한다. 한 번의 일치는 부족하다. dependency update, generated code 변화, clean checkout, cache restore, merge queue 환경에서도 parity를 확인해야 한다. 불일치가 생기면 `tsrs`를 성공으로 강제 변환하지 말고, 기준 compiler 결과를 유지한 채 최소 재현을 만든다. experimental tool의 bug를 애플리케이션 코드 변경으로 우회하면 나중에 기준 compiler와 더 멀어질 수 있다.

마지막 단계에서만 역할을 조정한다. 먼저 빠른 pre-check로 `tsrs`를 blocking 처리하고 공식 `tsc`를 최종 authority로 유지할 수 있다. 완전 교체는 프로젝트 corpus, emit artifact, exit code, 운영 기간을 모두 통과한 뒤의 별도 결정이다. language server나 compiler API 교체는 CLI type check와 같은 승인으로 묶지 않는다.

## benchmark 전에 비교 대상을 맞춘다

Cloudflare 발표의 “최대 8배”에는 중요한 조건이 붙는다. TypeScript 7.0과 비교했고, 같은 수의 type-check worker를 사용했다.[1] 저장소의 historical benchmark도 16 vCPU, 63GB RAM, Linux x86_64, AMD EPYC 환경에서 `-p <project> --noEmit`을 실행하고, PGO 최적화된 `tsrs` build와 `typescript@7.0.2`를 비교했다고 기록한다. 공개 표는 default 설정과 `--checkers 4`, `8`, `16`을 분리하며, 프로젝트별 결과가 크게 다르다.[8]

같은 문서의 default 표에서는 `tsgo`가 worker 4개, `tsrs`가 최대 16개를 선택한다. 반면 동일 worker 표는 두 도구에 같은 수를 준다.[8] default 대 default는 “사용자가 옵션 없이 경험할 시간”을 답하고, equal worker는 “구현 효율 차이”에 더 가까운 질문을 답한다. 둘은 모두 유효하지만 같은 그래프에서 조건 표시 없이 섞으면 안 된다.

revision도 맞춰야 한다. historical 결과는 `tsgo` 7.0.2와 더 늦은 TypeScript 7.1-dev를 포팅한 `tsrs`를 비교한다. 일부 프로젝트의 오류 개수가 달랐지만, 해당 7.1 nightly는 `tsrs`와 같은 오류를 냈다고 benchmark 문서가 설명한다.[8] 시간 비교에서 version skew를 허용할 수는 있어도, 그 결과로 semantic parity를 판단해서는 안 된다. parity gate는 같은 upstream commit 계열로 맞추고, 시장에서 쓰는 stable version과의 성능 비교는 별도 표로 둔다.

benchmark harness는 프로젝트 checkout commit, lockfile hash, overlay, compiler binary hash, 명령 인자, 환경 변수, machine, 모든 sample을 기록해야 한다. `tsrs` 저장소의 harness도 준비된 checkout과 dependency를 고정하고, `run.json`에 machine·project commit·compiler version과 binary hash·argument·sample을 남기도록 설계되어 있다.[9] 평균 숫자 하나보다 이 provenance가 재현에 더 중요하다.

## cold, warm, worker를 서로 다른 실험으로 분리한다

**Cold process**는 새 compiler process가 처음부터 parse·resolve·check하는 시간을 본다. `.tsbuildinfo`와 tool 전용 cost cache를 제거하고, 두 도구 모두 같은 파일 상태에서 실행한다. 그러나 일반 사용자 권한으로 OS page cache까지 비우지 않았다면 “완전한 cold disk”라고 부르면 안 된다. 정확한 이름은 “fresh process, no compiler cache”다. 첫 실행 한 번은 package launcher와 binary page-in 잡음이 크므로 결과와 함께 그대로 보고하고, 통계적 중앙값처럼 포장하지 않는다.

**Warm process 반복**은 매 sample마다 프로세스는 새로 시작하지만, dependency와 OS page cache가 데워진 상태를 잰다. warm-up 3회 뒤 10회 이상을 interleave하고 median과 분산을 기록한다. 이 값은 watch mode나 장기 실행 language server의 warm latency가 아니다. 단지 동일 CLI를 반복 호출하는 CI 환경에 가깝다.

**Incremental 또는 watch warm**은 별도 실험이다. initial build, 첫 편집, 동일 종류의 반복 편집, 오류 추가, 오류 제거를 구분한다. 편집 시각부터 해당 cycle의 진단 완료까지 재고, watcher가 파일 write 시작과 close 중 어느 이벤트를 기준으로 삼는지도 기록한다. initial build와 edit latency를 평균 내면 둘 다 설명하지 못하는 숫자가 된다.

**Worker scaling**은 `tsrs`에만 `1`, `4`, `8`, `16`을 주고 시간을 잰다. JavaScript `tsc`는 고정된 기본 baseline으로 한 번 측정하며, 이 표를 equal-worker 비교라고 부르지 않는다. 각 점에서 peak RSS도 함께 남긴다. worker를 늘렸더니 시간이 줄어도 메모리 한도를 넘거나 CI의 실제 CPU quota보다 많은 thread가 경쟁하면 운영상 이득이 아니다. Vendor가 `tsgo`와 수행한 equal-worker 결과는 별도 vendor 자료로만 표시한다.

```bash
set -euo pipefail

# 성공하는 실제 프로젝트에서 실행한다. 모든 명령은 같은 checkout과 lockfile을 사용한다.
hyperfine --warmup 3 --runs 10 --shell=none \
  "./node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false" \
  --export-json "bench-tsc-default.json"
for workers in 1 4 8 16; do
  hyperfine --warmup 3 --runs 10 --shell=none \
    "./node_modules/.bin/tsrs -p tsconfig.json --noEmit --pretty false --checkers $workers --checkerAssignment go --noLazyMembers" \
    --export-json "bench-checkers-${workers}.json"
done
```

위 명령은 `tsc` 기본 baseline과 `tsrs` worker별 결과를 별도 JSON으로 남긴다. 실제 benchmark 전에 모든 명령의 exit code가 0인지 확인해야 한다. 하나가 실패했는데 `--ignore-failure`로 시간을 재면 빠르게 실패한 도구가 우승하는 잘못된 표가 만들어진다. 의도적으로 오류가 있는 corpus의 성능을 재려면 먼저 같은 진단과 같은 실패 code를 확인한 뒤, 성공 corpus와 분리해 명시한다.

메모리는 wall time과 다른 pass에서 측정해도 되지만 corpus와 실행 환경은 같아야 한다. 아래 예시는 `tsc`에는 존재하지 않는 `--checkers`를 전달하지 않고, `tsrs`에만 worker 수를 지정한다. 따라서 equal-worker 비교가 아니라 각 도구의 명시된 실행 구성을 비교하는 별도 실험이며, worker parity를 주장하려면 두 구현이 실제로 지원하는 동등한 동시성 계약을 먼저 정의해야 한다. Linux에서는 `/usr/bin/time -v`의 maximum resident set size를 사용할 수 있다. container memory limit, cgroup peak, child process 포함 여부를 함께 적는다. 평균 RSS와 peak RSS를 바꾸어 쓰지 말고, short-lived spike를 sampling profiler가 놓칠 수 있다는 점도 남긴다. `tsrs --extendedDiagnostics`의 `Memory used`와 `tsgo` 값은 정의가 다를 수 있으므로 process-level RSS와 같은 열에 섞지 않는다.[6]

```bash
set -euo pipefail

/usr/bin/time -v ./node_modules/.bin/tsc \
  -p tsconfig.json --noEmit --pretty false \
  > tsc.log 2> tsc.time
/usr/bin/time -v ./node_modules/.bin/tsrs \
  -p tsconfig.json --noEmit --pretty false --checkers 4 \
  --checkerAssignment go --noLazyMembers \
  > tsrs.log 2> tsrs.time
```

## 숫자를 읽는 순서

결과 표의 첫 열은 speedup이 아니라 parity 상태여야 한다. `diagnostics=match`, `exit=match`, `emit=not tested`처럼 범위를 먼저 적는다. 그다음 compiler revision과 worker 수, cold/warm mode, median wall time, peak RSS, sample 수를 놓는다. parity가 실패한 행의 speedup은 도입 근거로 집계하지 않고 조사 자료로만 보존한다.

Cloudflare의 최대 8배와 약 70% 메모리 절감은 가능성을 보여 주는 출발점이다. 발표는 동일 worker 조건이라고 명시하지만, 자체 프로젝트와 machine에서 같은 비율을 약속하지 않는다.[1] historical 공개 데이터에서도 프로젝트와 worker 수에 따라 배수가 크게 달라지고, default worker 비교는 equal-worker 비교보다 더 큰 숫자를 만들 수 있다.[8] 따라서 “Rust라서 8배”라고 원인을 단정하지 말고, “이 revision과 configuration에서 우리 workload가 몇 배였는가”라고 쓴다.

판정 기준도 실험 전에 정한다. 예를 들어 diagnostic·exit parity 100%, emit을 쓰는 package는 artifact hash 또는 허용된 차이 목록 100%, warm median 20% 이상 개선, peak RSS가 현재 한도 이하, 2주 shadow 동안 미분류 불일치 0건처럼 정의할 수 있다. 기준을 결과를 본 뒤 바꾸면 benchmark가 의사결정 도구가 아니라 원하는 결론을 꾸미는 장식이 된다.

## 지금의 현실적인 도입선

`tsrs`는 흥미로운 실험이고, 공개된 성능 자료와 conformance 증거도 구체적이다. 동시에 설치 버전은 `0.18.0-ts7.1.0-dev.20260929`처럼 0.x와 TypeScript dev snapshot을 함께 드러내며, stable TypeScript 7.1에 대한 100% conformance는 목표다.[2][4] unsupported command와 runtime별 binary 범위도 남아 있다.[6] 이 상태를 GA compiler처럼 취급하는 것도, experimental이라는 이유만으로 측정을 거부하는 것도 둘 다 과하다.

가장 안전한 순서는 명확하다. release artifact와 라이선스를 고정하고, 같은 upstream 계열의 기준 compiler를 선택하고, 타입 의미·진단·종료 코드·필요한 emit을 검증한다. 그 뒤에 fresh process, warm 반복, incremental edit, equal-worker scaling, default 경험을 각각 측정한다. 마지막으로 shadow CI의 실제 기록을 보고 blocking 범위를 결정한다.

결국 물어야 할 질문은 “TypeScript를 Rust로 옮기면 정말 8배 빨라지는가”가 아니다. **우리 코드에서 같은 답을 내는가, 그리고 같은 답을 낼 때 얼마나 빨라지는가**다. 첫 문장을 증명하지 못하면 두 번째 숫자는 아직 benchmark가 아니라 데모다.

## Sources

[1] https://blog.cloudflare.com/typescript-rust-port/

[2] https://github.com/oxc-project/tsrs/blob/d9e5b1f683f2826d93f24552fef9819d421150ba/README.md

[3] https://github.com/oxc-project/tsrs/blob/d9e5b1f683f2826d93f24552fef9819d421150ba/LICENSE

[4] https://registry.npmjs.org/tsrs/0.18.0-ts7.1.0-dev.20260929

[5] https://github.com/oxc-project/tsrs/blob/5f92808bc92bb97b06212153ab73d28d551c0b9b/LICENSE

[6] https://github.com/oxc-project/tsrs/blob/5f92808bc92bb97b06212153ab73d28d551c0b9b/docs/COMPATIBILITY.md

[7] https://registry.npmjs.org/typescript/7.1.0-dev.20260930.4

[8] https://github.com/oxc-project/tsrs/blob/d9e5b1f683f2826d93f24552fef9819d421150ba/bench/RESULTS.md

[9] https://github.com/oxc-project/tsrs/blob/d9e5b1f683f2826d93f24552fef9819d421150ba/bench/README.md
