---
title: 'Go 1.27 HTTP/1 연결 재사용: 응답 본문을 읽지 않아도 되는가'
date: 2026-10-23 09:00:02 +0900
categories: ["개발/백엔드"]
description: 'Go 1.27 net/http의 제한적 비동기 response body drain을 Go 1.26과 비교하고, 로컬 TLS fixture로 응답 정확성·연결 수·재사용·handshake를 함께 검증한다.'
featured_image: 'https://picsum.photos/seed/go-127-http1-connection-reuse/1600/900'
tags: [go, go-1-27, net-http, http1, connection-reuse, keep-alive, httptest]
---

![먹구름 아래 햇빛이 비치는 해안에서 검푸른 파도가 검은 모래사장으로 밀려오는 모습](https://picsum.photos/seed/go-127-http1-connection-reuse/1600/900)

Go HTTP client 코드를 검토하다 보면 익숙한 정리 구문을 만난다.

```go
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()
```

여기에 오래 따라붙던 조언이 있다. HTTP/1 연결을 다시 쓰려면 `Close`만 하지 말고 본문을 EOF까지 읽어 버리라는 것이다. 상태 코드만 필요한 요청에서도 `io.Copy(io.Discard, resp.Body)`를 넣는 코드가 그래서 생겼다.

Go 1.27에서는 이 조언의 기본값이 달라졌다. `net/http.Transport`가 닫힌 HTTP/1 응답 본문의 남은 부분을 제한적으로 비동기 drain한다. 작은 본문을 읽지 않은 채 `Close`해도 연결을 재사용할 가능성이 커졌다.[1] 그렇다면 이제 응답 본문을 읽지도, 닫지도 않아도 되는가?

짧은 답은 **아니다**.

- 응답 내용이 필요하면 여전히 애플리케이션이 읽고 검증해야 한다.
- 내용이 필요 없어도 `Response.Body.Close()`는 반드시 호출해야 한다.
- Go 1.27의 자동 drain은 정확성 계약을 바꾼 것이 아니라, `Close` 뒤 HTTP/1 연결을 회수하는 최적화다.
- drain에는 시간과 크기 상한이 있으므로 모든 응답이 재사용으로 이어지는 것도 아니다.

핵심은 “본문을 읽지 않아도 된다”가 아니라 **“본문을 사용하지 않는 호출자가 올바르게 닫기만 해도, 작은 HTTP/1 응답 때문에 매번 새 연결을 만들 가능성이 줄었다”**에 가깝다.

## 왜 `Close`만으로는 연결을 다시 쓰지 못했나

HTTP/1.1 연결에서는 여러 응답이 한 TCP byte stream에 순서대로 놓인다. Client가 status line과 header를 읽으면 `http.Response`를 반환할 수 있지만, 그 뒤에는 아직 현재 응답의 body가 남아 있다. `Content-Length`만큼 읽거나 chunked body의 끝을 만나야 다음 응답이 시작될 위치를 알 수 있다.

Go 1.26까지는 호출자가 본문을 끝까지 읽지 않고 `Close`하면 Transport가 그 연결을 포기했다. 다음 요청은 새 TCP 연결을 열고, HTTPS라면 새 TLS handshake도 치러야 했다. `encoding/json.Decoder`로 JSON 객체 하나를 정상 decode했더라도 서버가 마지막에 붙인 newline 한 바이트가 남으면 같은 문제가 생길 수 있었다.[1]

이 동작은 response correctness와 connection reuse를 구분해서 봐야 한다. Status code와 header를 받은 요청은 애플리케이션 목적상 성공했을 수 있다. 그러나 body 경계를 끝까지 소비하지 못한 연결은 다음 HTTP/1 응답을 안전하게 읽는 통로로 되돌릴 수 없다. 요청 성공률만 보는 dashboard에서는 이 비용이 드러나지 않고, connection 수·TLS handshake·latency 쪽에서만 나타난다.

HTTP/2는 같은 문제를 그대로 갖지 않는다. 여러 request와 response가 하나의 TCP 연결 위에서 stream frame으로 multiplex되므로 한 stream의 읽지 않은 body가 다른 stream의 시작점을 byte 순서로 가리는 구조가 아니다.[1] 따라서 Go 1.27 변경을 “모든 HTTP 성능이 좋아졌다”거나 “HTTP/2도 같은 이유로 빨라졌다”고 일반화하면 안 된다.

## Go 1.27이 실제로 하는 일

Go 1.27 release note는 HTTP/1 `Response.Body`를 닫을 때 읽지 않은 내용을 보수적인 상한까지 자동 drain해 연결 재사용을 개선한다고 설명한다.[2] 공식 기술 글이 공개한 현재 상한은 둘 중 먼저 도달하는 값이다.[1]

- 시간: **50 ms**
- 읽을 양: **256 KiB**

Drain은 비동기로 진행된다. 작은 body가 제한 안에서 EOF에 도달하면 해당 연결은 idle pool로 돌아가 이후 요청에 쓰일 수 있다. 다음 요청이 drain보다 먼저 시작되면 Transport는 다른 연결을 열 수 있고, drain을 마친 기존 연결은 더 나중 요청에 쓰일 수 있다. 따라서 “Go 1.27이면 언제나 한 연결”은 계약이 아니다.

`Connection: close`가 온 응답은 drain해도 연결을 재사용할 수 없다. 구현은 이 경우 쓸모없는 drain을 건너뛴다. Body가 너무 크거나 천천히 도착해 256 KiB 또는 50 ms 경계에 닿는 경우에도 기존 연결을 살리겠다고 무한정 기다리지 않는다.[1] 이 상한은 느린 stream이나 끝나지 않는 응답 때문에 `Close` 경로가 자원 회수보다 더 큰 비용을 만드는 것을 피하기 위한 안전장치다.

Version-pinned `go1.27.0` 문서도 책임 경계를 분명히 한다. Client와 Transport는 connection cache라는 내부 상태를 가지므로 재사용해서 써야 하고, body는 호출자가 닫아야 한다. `Response.Body` 설명은 수동으로 EOF까지 읽는 일이 대부분의 경우 필요하지 않게 됐지만 `Close` 책임은 그대로라고 명시한다.[3][4]

이 변경을 도입한 commit도 256 KiB 또는 50 ms까지 남은 body를 drain한다고 기록한다.[5] 숫자를 application API의 영구 보장처럼 복사해서 제어 로직에 넣기보다는 현재 `go1.27.0` 구현의 보수적 경계로 봐야 한다. 공식 글 역시 후속 개선에 따라 동작이 진화할 수 있다고 밝힌다.[1]

## “읽지 않는다”는 “무시해도 된다”가 아니다

응답 body를 사용할지 여부는 먼저 protocol이 아니라 application correctness로 결정한다.

예를 들어 `204 No Content` 또는 health endpoint의 status만 계약으로 삼는 호출이라면 body를 읽지 않고 닫는 선택이 자연스럽다. 반면 API가 `200`과 함께 business result, pagination token, error detail, checksum을 body에 담는다면 status만 확인하고 버리는 코드는 Go 1.27에서도 잘못됐다. 자동 drain은 bytes를 검증해 주지 않고, JSON schema나 서명을 확인하지도 않는다.

다음 세 패턴은 목적이 다르다.

```go
// 1. Status만 계약인 경우: body는 사용하지 않지만 반드시 닫는다.
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()
return checkStatus(resp.StatusCode)
```

```go
// 2. Body가 계약인 경우: 필요한 제한과 decode 오류를 직접 처리한다.
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()

limited := io.LimitReader(resp.Body, 1<<20)
if err := json.NewDecoder(limited).Decode(&result); err != nil {
    return err
}
```

```go
// 3. 재사용을 끄려는 경우: body를 방치하지 말고 Transport 의도를 명시한다.
transport := &http.Transport{DisableKeepAlives: true}
client := &http.Client{Transport: transport}
```

세 번째 설정은 일반적인 “성능 문제 해결 옵션”이 아니다. Go 1.27 release note는 connection reuse 이점이 없는 드문 환경에서 과도한 idle connection이 남는다면 `DisableKeepAlives`를 고려할 수 있다고 설명한다. 특히 `MaxIdleConns`를 0으로 두거나 요청마다 다른 Client를 만들어 전체 idle connection 상한을 우회한 구성이 그런 문제를 드러낼 수 있다.[2] 먼저 장수하는 Client·Transport를 공유하고 pool 설정을 점검해야 한다.

수동 drain도 무조건 삭제할 대상은 아니다. 여러 Go 버전을 함께 지원하거나, Go 1.26에서 측정 가능한 재사용 문제가 있고, body 크기와 read deadline을 통제할 수 있다면 제한된 수동 drain이 호환 전략일 수 있다. 다만 `io.Copy(io.Discard, resp.Body)`를 상한과 deadline 없이 모든 endpoint에 붙이면 대용량·slow stream을 끝까지 읽느라 새 연결을 여는 것보다 더 오래 걸릴 수 있다. Go 1.27이 제한을 둔 이유를 애플리케이션 코드에서 다시 없애면 안 된다.

## 공식 “거의 5배”를 보편적 숫자로 읽지 않는다

Go 공식 글의 첫 예시는 `GODEBUG=http2client=0`으로 HTTP/1을 강제하고 `index.golang.org`에 status-only 요청을 100번 보냈다. 글 작성자의 machine에서 Go 1.26은 약 710 ms, Go 1.27은 약 150 ms로 측정됐다. 이 조건에서는 거의 5배 차이다.[1]

하지만 이 결과는 모든 workload가 5배 빨라진다는 benchmark가 아니다.

- 특정 외부 endpoint와 작성자 network·machine의 결과다.
- HTTP/1을 강제했다.
- 요청은 순차적이며 status만 사용한다.
- body 크기, TLS session, RTT, proxy, server keep-alive 정책에 따라 결과가 달라진다.
- 이미 EOF까지 읽는 코드는 같은 병목이 없다.
- HTTP/2를 쓰는 workload는 문제 구조가 다르다.

따라서 upgrade 검증은 latency 배수부터 재현하려 하기보다 **정확한 응답 수, 새 connection 수, reused request 수, TLS handshake 수**를 먼저 비교하는 편이 낫다. 원인이 확인된 뒤에 같은 host, protocol, concurrency, request count, warm-up 조건으로 latency distribution을 측정한다.

## 외부 network 없이 1.26과 1.27을 비교하는 fixture

다음 fixture는 production 주소나 credential을 사용하지 않는다. `httptest.NewUnstartedServer`를 local TLS server로 시작하고 HTTP/2를 명시적으로 끈다. 같은 작은 JSON 응답에 12번 순차 요청하면서 두 mode를 실행한다.

- `unread_close`: status·protocol·fixture header만 검증하고 body를 읽지 않은 채 닫는다.
- `read_to_eof`: body bytes까지 검증하고 EOF에 도달한 뒤 닫는다.

Server의 `ConnState`로 새 connection을 세고, client의 `httptrace.GotConn`으로 재사용을 센다. Local server의 모든 connection은 TLS이므로 이 fixture에서 새 connection 수와 TLS handshake 수는 같다. 5 ms sleep은 Go 1.27의 비동기 drain이 작은 local body를 EOF까지 처리할 기회를 주기 위한 fixture 조건이지 production tuning 값이 아니다.

```go
package main

import (
    "crypto/tls"
    "encoding/json"
    "fmt"
    "io"
    "net"
    "net/http"
    "net/http/httptest"
    "net/http/httptrace"
    "runtime"
    "sync/atomic"
    "time"
)

type result struct {
    Go             string `json:"go"`
    Mode           string `json:"mode"`
    Requests       int    `json:"requests"`
    Correct        int    `json:"correct_responses"`
    NewConnections int64  `json:"new_connections"`
    ReusedRequests int64  `json:"reused_requests"`
    TLSHandshakes  int64  `json:"tls_handshakes"`
    ElapsedMicros  int64  `json:"elapsed_us"`
}

func run(mode string) (result, error) {
    const requests = 12
    const body = `{"ok":true,"padding":"` +
        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" +
        `"}`

    var newConnections atomic.Int64
    server := httptest.NewUnstartedServer(http.HandlerFunc(
        func(w http.ResponseWriter, r *http.Request) {
            w.Header().Set("Content-Type", "application/json")
            w.Header().Set("X-Fixture", "go-http1-reuse-v1")
            w.Header().Set("Content-Length", fmt.Sprint(len(body)))
            w.WriteHeader(http.StatusOK)
            _, _ = io.WriteString(w, body)
        },
    ))
    server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
        if state == http.StateNew {
            newConnections.Add(1)
        }
    }
    server.StartTLS()
    defer server.Close()

    transport := server.Client().Transport.(*http.Transport).Clone()
    transport.ForceAttemptHTTP2 = false
    transport.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
    defer transport.CloseIdleConnections()
    client := &http.Client{Transport: transport, Timeout: 2 * time.Second}

    var reused atomic.Int64
    correct := 0
    started := time.Now()
    for i := 0; i < requests; i++ {
        req, err := http.NewRequest(http.MethodGet, server.URL, nil)
        if err != nil {
            return result{}, err
        }
        req = req.WithContext(httptrace.WithClientTrace(
            req.Context(),
            &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) {
                if info.Reused {
                    reused.Add(1)
                }
            }},
        ))
        resp, err := client.Do(req)
        if err != nil {
            return result{}, err
        }
        if resp.StatusCode == http.StatusOK && resp.ProtoMajor == 1 &&
            resp.Header.Get("X-Fixture") == "go-http1-reuse-v1" {
            correct++
        }
        if mode == "read_to_eof" {
            got, err := io.ReadAll(resp.Body)
            if err != nil || string(got) != body {
                return result{}, fmt.Errorf("body mismatch: err=%v len=%d", err, len(got))
            }
        }
        if err := resp.Body.Close(); err != nil {
            return result{}, err
        }
        time.Sleep(5 * time.Millisecond)
    }

    opened := newConnections.Load()
    return result{
        Go:             runtime.Version(),
        Mode:           mode,
        Requests:       requests,
        Correct:        correct,
        NewConnections: opened,
        ReusedRequests: reused.Load(),
        TLSHandshakes:  opened,
        ElapsedMicros:  time.Since(started).Microseconds(),
    }, nil
}

func main() {
    for _, mode := range []string{"unread_close", "read_to_eof"} {
        r, err := run(mode)
        if err != nil {
            panic(err)
        }
        b, _ := json.Marshal(r)
        fmt.Println(string(b))
    }
}
```

동일 파일을 version별 official image에서 실행한다.

```bash
set -euo pipefail

docker run --rm \
  -v "$PWD/go-http-reuse-fixture.go:/fixture.go:ro" \
  golang:1.26.4-bookworm \
  go run /fixture.go

docker run --rm \
  -v "$PWD/go-http-reuse-fixture.go:/fixture.go:ro" \
  golang:1.27.0-bookworm \
  go run /fixture.go
```

이 글을 검증한 local Docker 실행에서는 다음 결과가 나왔다.

| Go | Mode | Correct responses | New connections / TLS handshakes | Reused requests | Elapsed |
|---|---|---:|---:|---:|---:|
| 1.26.4 | `unread_close` | 12/12 | 12 | 0 | 102,095 µs |
| 1.26.4 | `read_to_eof` | 12/12 | 1 | 11 | 71,211 µs |
| 1.27.0 | `unread_close` | 12/12 | 1 | 11 | 71,952 µs |
| 1.27.0 | `read_to_eof` | 12/12 | 1 | 11 | 72,937 µs |

이 표에서 먼저 볼 것은 elapsed time이 아니다. Local scheduler와 container 상태 때문에 microsecond 값은 반복마다 흔들린다. 중요한 관찰은 모든 mode에서 12개 응답의 status·HTTP/1 protocol·fixture header가 정확했고, body를 읽지 않은 mode의 connection 수만 version에 따라 12에서 1로 바뀌었다는 점이다. EOF까지 읽은 baseline은 두 version 모두 한 연결을 재사용했다.

이 fixture가 증명하지 않는 것도 명확하다. 256 KiB보다 큰 body, 50 ms보다 느린 stream, chunked trailer, `Connection: close`, proxy, cancellation, concurrent request, custom `RoundTripper`, 실제 Internet RTT의 결과는 포함하지 않는다. 그런 조건은 별도 case로 추가하되 이 local 결과를 production latency 배수로 승격하지 않는다.

## Upgrade 때 확인할 항목

Go 1.27로 binary를 바꾼 뒤에는 application metric과 transport metric을 함께 본다.

1. **Correctness**: status만 계약인지, body decode까지 계약인지 endpoint별로 분류한다.
2. **Lifecycle**: 성공·오류·early return 경로 모두 `Response.Body.Close()`를 호출하는지 확인한다.
3. **Protocol cohort**: HTTP/1과 HTTP/2를 나눠 측정한다. 전체 평균 하나로 합치면 변경 효과가 흐려진다.
4. **Connection evidence**: `httptrace.GotConnInfo.Reused`, dial 수, TLS handshake 수를 같은 test run에 기록한다.
5. **Pool identity**: 요청마다 Client나 Transport를 새로 만들지 않는지 확인한다. 재사용할 pool 자체가 없으면 자동 drain의 이점도 없다.[3]
6. **Boundary cases**: 큰 body, slow response, server `Connection: close`, request cancellation을 별도 fixture로 둔다.
7. **Latency**: 같은 endpoint·protocol·concurrency·request 수에서 p50·p95·p99를 비교하고 connection count 변화와 연결한다.
8. **Rollback**: 연결 수나 idle pool이 예상과 다르면 binary version과 Transport 설정을 함께 되돌릴 수 있게 기록한다.

`GotConnInfo.Reused`만 보고 correctness를 판정해서도 안 된다. 재사용은 transport 최적화 신호다. 반대로 status와 JSON assertion만 통과했다고 connection churn이 없는 것도 아니다. 두 gate를 분리해야 “요청은 맞지만 handshake가 폭증하는” 회귀와 “연결은 재사용하지만 body 결과를 무시하는” 버그를 각각 잡을 수 있다.

## 결론

Go 1.27에서 작은 HTTP/1 응답을 사용하지 않는다면, 대부분은 `Response.Body.Close()`만 올바르게 호출해도 된다. Transport가 남은 body를 최대 50 ms 또는 256 KiB까지 비동기로 drain해 연결을 회수한다.[1][2] Go 1.26에서 connection reuse만을 위해 넣었던 무제한 수동 drain은 runtime 지원 범위와 endpoint 특성을 확인한 뒤 단순화할 수 있다.

하지만 세 가지는 그대로다. Body 내용이 application 계약이면 직접 읽고 검증해야 한다. Body를 사용하지 않아도 반드시 닫아야 한다. 그리고 큰 body·느린 stream·close 응답처럼 상한 안에 EOF가 오지 않는 경우 재사용은 보장되지 않는다.

공식 글의 약 710 ms 대 150 ms는 특정 작성자 환경에서 HTTP/1 status-only 요청 100회를 실행한 결과다.[1] Upgrade 판단을 “Go 1.27은 5배 빠르다”로 끝내지 말자. 같은 local fixture에서 correctness를 고정하고, 새 connection과 TLS handshake가 실제로 줄었는지 확인한 뒤, 자신의 workload 조건으로 latency를 측정해야 한다.

**Go 1.27의 변화는 `Close`를 생략할 권한이 아니라, 올바르게 닫은 HTTP/1 응답을 Transport가 더 잘 재사용할 수 있게 된 변화다.**

## Sources

[1] https://go.dev/blog/http-connection-reuse
[2] https://go.dev/doc/go1.27
[3] https://pkg.go.dev/net/http@go1.27.0
[4] https://github.com/golang/go/blob/go1.27.0/src/net/http/response.go
[5] https://github.com/golang/go/commit/11d5284363ed88b8cc8ec6e68db80a16b2f9e708
