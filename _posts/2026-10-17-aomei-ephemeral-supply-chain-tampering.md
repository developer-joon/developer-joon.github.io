---
title: '5분만 열리는 공급망 공격: 사후 URL 검사가 정상이어도 안전하지 않은 이유'
date: 2026-10-17 07:30:00 +0900
categories: ["보안"]
description: 'AOMEI 업데이트 인프라의 2026년 4~7월 단기 변조 사례를 통해 현재 URL의 정상 응답과 과거 endpoint 실행 증거를 구분하고, 안전한 헌팅·복구·운영 비용을 설계한다.'
featured_image: 'https://picsum.photos/seed/aomei-ephemeral-supply-chain-tampering/1600/900'
tags: [aomei, supply-chain-security, incident-response, endpoint-forensics, threat-hunting, software-update]
---

![짧은 공급망 변조 창과 과거 실행 증거](https://picsum.photos/seed/aomei-ephemeral-supply-chain-tampering/1600/900)

소프트웨어 공급망 사고를 조사할 때 가장 쉬운 확인은 문제가 된 URL을 지금 다시 여는 것이다.
응답 파일이 정상이고 평판 서비스도 깨끗하면 안심하고 싶어진다.
그러나 서버 설정이 몇 분만 바뀌었다가 원래 내용으로 돌아왔다면 현재 응답은 과거 다운로드를 설명하지 못한다.
**현재 URL의 정상 상태와 과거 endpoint가 실제로 받은 바이트는 서로 다른 증거**다.

Google Threat Intelligence Group과 Mandiant는 2026년 10월 15일 AOMEI Technology의 업데이트 인프라를 겨냥한 단기 공급망 변조 조사를 공개했다.[1]
공개일은 10월이지만 보고서가 다루는 관측 기간은 2026년 4월부터 7월까지다.[1]
이 둘을 섞어 “10월에 공격이 시작됐다”고 쓰면 사건 시간축이 틀린다.
보고서가 직접 확인한 서버 변조 창은 5월 28일 10분, 7월 16일 6분, 7월 20일 5분이었다.[1]
공격자는 각 창이 끝나면 `down_html.ini`와 `Notifycfg.ini`를 정상 내용으로 되돌렸다.[1]

이 사건은 “AOMEI 다운로드 사이트가 몇 달 내내 악성 파일을 배포했다”는 주장이 아니다.
짧은 창에 업데이트를 확인한 클라이언트만 악성 지시를 받을 수 있는 확률적 전달 모델이었다.
GTIG는 추가 변조가 관측 범위 밖에서 발생했을 가능성을 언급했지만 확인되지 않은 창의 수를 제시하지 않았다.[1]
따라서 이 글도 피해 조직이나 endpoint 규모를 추정하지 않는다.
직접 식별된 조직 목록을 전체 피해 규모로 확대하지도 않는다.

핵심 문제는 SBOM에 항목을 더 넣는 것으로 해결되지 않는다.
소스 코드나 정식 릴리스가 바뀌지 않고 원격 설정과 배포 목적지만 잠깐 바뀔 수 있기 때문이다.
또한 이 사건은 MCP 도구 metadata가 나중에 변하는 문제와도 다르다.
여기서 방어의 중심은 **어느 endpoint가 어느 시각에 어떤 원격 응답을 받고 어떤 process·network·persistence 결과를 남겼는지** 복원하는 일이다.

## 정상 업데이트 경로와 변조 지점

AOMEI Backupper는 백업·복제·복구 제품이고 AnyViewer는 원격 데스크톱 제품이다.[1]
보고서에 따르면 ABMarket 흐름과 `Backupper.exe`, `ABNotify.exe` 같은 background service가 HTTPS로 업데이트 알림과 프로모션 설정을 확인한다.[1]
정상 경로에서 `down_html.ini`는 버전, 예상 update package의 MD5, `upgrade-now.zip` 다운로드 URL을 담는다.[1]
`Notifycfg.ini`는 표시할 알림과 로컬 제품 디렉터리에서 실행할 command 또는 program을 지정할 수 있다.[1]
정상 상태에서는 이 설정이 AOMEI의 공식 배포 도메인에 있는 파일을 가리킨다.[1]

위협 행위자는 정식 installer 전체를 장기간 교체하는 대신 이 두 설정 파일을 짧게 바꿨다.
`down_html.ini`의 URL, minor build 값과 예상 MD5를 함께 바꿔 클라이언트가 공격자 쪽 ZIP을 정상 업데이트처럼 받게 했다.[1]
`Notifycfg.ini`도 변조해 다운로드된 파일을 로컬에서 실행시키는 경로를 악용했다.[1]
즉 MD5 값이 설정과 일치했다는 사실은 패키지가 vendor가 의도한 정품이라는 보장이 아니었다.
공격자가 다운로드 위치와 기대 hash를 같은 신뢰 경계에서 함께 바꿀 수 있었기 때문이다.

이 메커니즘은 source tree나 build pipeline을 영구 변조하는 유형과 다르다.
정식 release artifact를 나중에 다시 내려받아 비교해도 당시 클라이언트가 받은 파일이 아닐 수 있다.
현재 `down_html.ini`를 열어 정상 도메인을 확인해도 5~10분 창의 응답은 복원되지 않는다.
현재 악성 도메인이 내려갔거나 무해한 응답을 준다는 사실도 과거 실행 여부를 지우지 않는다.
사후 URL 검사만으로 안전을 결론 내리는 순간 조사 시점과 사건 시점이 뒤섞인다.

## 관측된 시간축을 그대로 보존하라

GTIG와 Mandiant는 관련 악성 sample이 4월 말부터 관측됐고, 직접 확인한 여러 설정 변조 창은 5월과 7월에 있었다고 설명한다.[1]
ManageEngine Threat Analysis Lab은 2026년 10월 16일 별도 분석을 공개했으며, 자체 EDR 관측 시점을 5월 28일과 7월 16일로 적고 AOMEI Backupper `8.3.0`에서 실행 사슬을 재구성했다.[2]
이 값은 관측된 버전이지 영향 버전의 하한이 아니다.
자산 범위는 버전과 무관하게 2026년 4~7월 Backupper·AnyViewer 설치·실행 이력으로 정하고, polling 시각과 실행 흔적으로 개별 endpoint를 판정해야 한다.

직접 확인된 세 창은 다음과 같다.[1]

| 날짜 | UTC 창 | 지속 시간 | 증거 경계 |
|---|---|---:|---|
| 2026-05-28 | 05:40–05:50 | 10분 | GTIG가 직접 관측한 설정 변조 창 |
| 2026-07-16 | 08:33–08:39 | 6분 | `down_html.ini`와 `Notifycfg.ini` 동시 변조 관측 |
| 2026-07-20 | 10:35–10:40 | 5분 | Cloud Storage를 초기 전달에 사용한 변조 관측 |

시간대 변환은 조사 시스템에서 자동으로 하되 원본 UTC를 버리지 않는다.
Endpoint event가 현지 시간만 기록한다면 daylight saving과 clock skew를 함께 기록한다.
`05:50`에 창이 닫혔다는 값도 네트워크 지연과 client clock 오차를 고려한 검색 여유를 필요로 한다.
그러나 검색 여유를 실제 변조 창 자체로 다시 발표해서는 안 된다.
관측 사실과 조사 편의를 위한 확장 구간을 별도 필드에 둔다.

보고서 공개일도 사건 시간축의 한 점이다.
Mandiant는 7월 17일 AOMEI에 관측 내용을 알렸고 AOMEI는 7월 29일 배포 서버 보안 조치를 취했다고 회신했다.[1]
이 서버 측 조치는 이후 배포 경로를 보호하는 사실이다.
이미 악성 파일을 받은 endpoint를 자동으로 소독했다는 의미는 아니다.
GTIG도 서버 측 remediation이 과거 창에 감염된 endpoint를 정리하지 않는다고 명시한다.[1]

## 위협 모델: 확률적 전달과 정상 기능의 악용

이 캠페인은 UNC7017로 추적되며 CROSSROAD downloader와 SHINYROAD backdoor를 포함한 다단계 payload chain을 전달했다.[1]
이 글은 payload 실행법이나 공격 재현 절차를 다루지 않는다.
방어 관점에서는 악성 구성과 payload가 오래 공개돼 있지 않았다는 점이 중요하다.
주기적으로 URL을 수집하는 scanner가 다섯 분 창을 놓치면 계속 정상 파일만 저장할 수 있다.

Polling 주기가 길수록 한 endpoint가 특정 창에 걸릴 확률은 낮을 수 있다.
그러나 fleet가 크고 polling이 서로 다른 시각에 일어나면 누군가는 창에 걸릴 수 있다.
이 문장은 피해 규모를 계산한 것이 아니라 노출 모델의 성질을 설명한다.
실제 감염 수를 구하려면 endpoint별 polling·download·execution 증거가 필요하다.
그 증거가 없으면 숫자를 만들지 않는 것이 맞다.

공격자는 전달 인프라도 바꿨다.
초기 단계에는 Alibaba Cloud Object Storage가 관측됐고, 7월 초에는 `storage-data.com` 계열 domain이 쓰였으며, 7월 20일에는 Google Cloud Storage bucket이 초기 다운로드에 사용됐다.[1]
평판이 좋은 cloud domain 전체를 허용하거나 새 domain만 차단하는 정책은 이 이동을 충분히 설명하지 못한다.
도메인 평판보다 updater process가 평소와 다른 host·path로 연결했는지를 보는 편이 강하다.

7월 20일에는 `Notifycfg.ini`의 원격 `file://` WebDAV 경로로 endpoint가 actor-controlled IP에 NetNTLMv2 인증 정보를 보내도록 유도하는 별도 경로도 관측됐다.[1]
따라서 binary execution 흔적이 없다는 이유로 credential exposure 가능성까지 닫을 수 없다.
Payload가 실행 guardrail에서 중단됐더라도 notification path의 network authentication은 별도로 조사해야 한다.
이중 경로는 endpoint triage를 process execution 하나에만 묶지 말아야 하는 이유다.

## 현재 URL과 historical endpoint evidence를 분리하는 법

조사 표의 첫 열에는 `current_server_state`를 둔다.
여기에는 현재 `down_html.ini`와 `Notifycfg.ini`의 응답, TLS 정보, resolved IP, 응답 hash와 수집 시각을 기록한다.
이 자료는 지금 배포 경로가 무엇을 제공하는지 보여 준다.
과거 5~10분 창의 응답을 직접 증명하지는 않는다.

두 번째 열에는 `historical_network_evidence`를 둔다.
Proxy, DNS, firewall, NetFlow, TLS inspection과 packet capture에서 endpoint별 목적지, path, byte 수와 시각을 찾는다.
특히 updater process가 AOMEI 공식 domain이 아닌 목적지나 보고서에 나온 cloud storage path에 연결했는지 본다.
목적지 indicator가 없더라도 평소 updater baseline에서 벗어난 연결을 찾는다.
공격 인프라가 바뀌었으므로 알려진 domain 목록만으로 hunt를 끝내지 않는다.

세 번째 열에는 `historical_endpoint_evidence`를 둔다.
EDR process tree, image load, file create, archive extraction, scheduled task 생성, service 설치와 user profile 경로 변경을 시간순으로 배치한다.
GTIG가 설명한 chain은 `upgrade-now.exe`, `%LOCALAPPDATA%\Radmin\` 아래 파일, `RadminComponentRuntime` scheduled task와 후속 component를 포함했다.[1]
이 이름들은 탐색 단서이지 단독 확정 판정이 아니다.
합법적인 Radmin 사용이 있을 수 있으므로 parent process, 서명, path, 생성 시각과 network destination을 함께 본다.

네 번째 열에는 `artifact_identity`를 둔다.
남아 있는 ZIP·EXE·DLL의 cryptographic hash, digital signature, 생성·수정 시각과 수집 경로를 기록한다.
보고서는 CROSSROAD가 local 설정을 정상 URL로 되돌리고 자체 삭제를 시도한 행위도 설명한다.[1]
따라서 파일이 없다는 결과도 감염 부재를 증명하지 않는다.
Prefetch, Amcache, scheduled task, EDR와 network history처럼 삭제 뒤에도 남을 수 있는 증거를 결합한다.

다섯 번째 열에는 `credential_exposure`를 둔다.
WebDAV·SMB 관련 outbound authentication, actor-controlled IP 접속, Windows credential material 사용 가능성과 후속 인증을 확인한다.
비밀번호가 실제로 복원됐는지 알 수 없더라도 NetNTLMv2 전송 증거가 있으면 회전 범위를 검토한다.
Binary 감염 복구와 credential 대응을 하나의 yes/no로 합치지 않는다.

## 안전한 판별 실습

이 실습은 보고서의 악성 파일이나 URL을 실행하지 않는다.
재다운로드로 sample을 확보하려는 시도도 하지 않는다.
조직이 이미 보유한 EDR, proxy, DNS와 endpoint artifact만 읽는다.
필요한 sample 처리는 격리된 malware analysis 절차와 담당자에게 넘긴다.

먼저 대상 집합을 만든다.
2026년 4월 1일부터 7월 31일까지 AOMEI Backupper 또는 AnyViewer가 설치됐거나 실행된 Windows endpoint를 찾는다.
이 날짜 범위는 보고서의 캠페인 관측 기간을 보수적으로 포함하는 조사 창이다.[1]
정확한 감염 기간을 새로 주장하는 값이 아니다.
설치 이력과 제거 이력을 모두 포함해 현재 프로그램이 없는 endpoint도 놓치지 않는다.

다음으로 세 개의 직접 관측 창 주변에서 updater process의 network event를 찾는다.
검색 범위에는 clock skew와 수집 지연을 위한 별도 여유를 두고 원래 UTC 창도 함께 표시한다.
`Backupper.exe`와 `ABNotify.exe`의 child process, archive write와 configuration file 접근을 연결한다.
사용자 browser가 같은 domain에 접속한 사건과 updater가 background에서 접속한 사건을 구분한다.

그다음에는 기간 전체의 persistence evidence를 찾는다.
`RadminComponentRuntime`과 `NitroRuntime` scheduled task, `%LOCALAPPDATA%\Radmin\` 및 관련 비정상 실행 경로를 확인한다.[1]
Signed executable이 존재해도 같은 디렉터리의 unsigned DLL load와 parent-child 관계를 검토한다.
GTIG는 legitimate Radmin binary를 이용한 DLL search-order hijacking과 이후 Adaptix 계열 activity를 보고했다.[1]
서명된 host process만 보고 허용하면 sideloaded component를 놓칠 수 있다.

Network hunt는 알려진 IP와 domain을 시작점으로 삼되 거기서 끝내지 않는다.
Updater가 official AOMEI host 대신 새로운 host에서 ZIP을 받았는지, 다운로드 뒤 짧은 시간에 별도 egress가 생겼는지 본다.
DNS가 없고 direct IP 접속만 있는 경우도 포함한다.
Cloud Storage를 전면 악성으로 분류하지 말고 object path, referrer가 아닌 initiating process, 시각을 결합한다.

판정은 최소 다섯 상태로 나누는 것이 안전하다.
`confirmed_observed_chain`은 서로 맞물리는 delivery·execution·persistence 증거가 있는 상태다.
`probable_historical_exposure`는 관측 창의 updater network evidence와 일부 endpoint 흔적이 있지만 chain 전체가 없는 상태다.
`credential_path_only`는 WebDAV·NTLM 경로 증거가 있으나 binary chain은 확인되지 않은 상태다.
`no_evidence_found`는 확보한 telemetry에서 찾지 못한 상태다.
`insufficient_telemetry`는 보존 기간이나 sensor coverage 때문에 결론을 내릴 수 없는 상태다.
이 이름은 GTIG의 공식 분류가 아니라 조사를 위해 제안하는 운영 상태다.

## 성능과 운영 비용: 더 자주 수집한다고 자동으로 해결되지는 않는다

5분 변조 창을 잡겠다고 모든 외부 URL을 매초 수집하는 방식은 비용이 크고 효과도 불확실하다.
공격자는 client별 응답, cache 계층, 지역 또는 조건부 전달을 사용할 수 있다.
중앙 crawler의 응답이 endpoint가 받은 응답과 같다는 보장도 없다.
수집 빈도보다 **client-side receipt와 execution을 증명하는 telemetry**가 중요하다.

운영 비용은 보존과 상관분석에서 발생한다.
DNS·proxy·EDR를 90일 이상 보존하면 storage와 query 비용이 늘어난다.
그러나 마지막 직접 관측 창보다 약 석 달 뒤 공개된 이 사례에서는 짧은 보존 기간이 직접적인 조사 공백이 된다.
조직은 updater·package manager·remote administration tool 같은 고위험 process의 telemetry를 일반 desktop보다 길게 보존할 수 있다.
그 선택은 법무·privacy·비용 정책과 함께 결정해야 한다.

탐지 성능은 indicator match 수가 아니라 복원 가능성으로 측정한다.
임의의 endpoint에 대해 process identity, network destination, downloaded artifact hash와 후속 persistence를 하나의 시간축으로 연결할 수 있는지 시험한다.
Sensor 간 clock 오차, hostname 재사용, NAT와 device reimage가 correlation을 얼마나 깨뜨리는지 기록한다.
False positive는 합법적 Radmin 배포, backup maintenance, 일반 cloud storage 접근을 fixture로 포함해 측정한다.

Google의 별도 공급망 완화 지침은 distribution point hardening, signature·hash 검증, egress baseline과 endpoint detection을 권고한다.[3]
이 원칙은 유용하지만 이 사건에서는 vendor가 제공한 원격 hash 값까지 함께 바뀔 수 있었다.
그래서 같은 origin의 설정이 제공한 hash만 확인하는 구조보다 독립 서명, 투명성 기록, allowlisted artifact identity가 더 강한 목표가 된다.
클라이언트가 실제 받은 응답과 artifact identity를 append-only 형태로 남기면 사후 조사 비용도 낮아진다.

비용표에는 감염 조사 인력만 넣지 않는다.
Endpoint 격리로 인한 사용자 중단, backup·remote support 기능 정지, credential 회전, reimage, 법무·고객 통지 판단과 장기 모니터링을 포함한다.
현재 URL 하나를 확인하고 티켓을 닫는 방식은 싸 보이지만 불확실성을 다른 팀과 미래 시점으로 넘긴다.
`insufficient_telemetry` 수와 해당 endpoint의 business criticality를 잔여 위험으로 보고해야 한다.

## 보안 설계: 순간 상태가 아니라 전달 영수증을 남겨라

첫 번째 통제는 updater egress의 목적지 제한이다.
업데이트 process가 접속할 수 있는 scheme, host, path와 certificate 조건을 최소화한다.
그러나 legitimate cloud storage를 잠깐 악용한 사례 때문에 domain allowlist 하나만으로 충분하다고 보지 않는다.[1]
정식 package의 독립 digital signature와 signer 정책을 실행 직전에 검증해야 한다.

두 번째 통제는 원격 설정과 실행 권한을 분리하는 것이다.
알림 configuration이 local command 실행이나 원격 `file://` resource rendering을 지시할 수 있다면 표시 기능보다 큰 권한을 가진다.
프로모션 UI와 software update, local execution을 서로 다른 process·token·policy 경계로 나누는 것이 바람직하다.
이것은 사건 보고서에 나온 제품 구현을 대신 고친다는 주장이 아니라 유사 updater를 설계할 때의 방어 원칙이다.

세 번째 통제는 endpoint-side receipt logging이다.
Updater가 받은 configuration의 hash, resolved final URL, package hash, signer, decision과 실행 결과를 중앙 로그로 보낸다.
로그에는 secret이나 사용자 콘텐츠를 넣지 않고 조사에 필요한 최소 metadata를 정의한다.
서버가 나중에 정상 상태로 돌아가도 endpoint가 받은 응답의 identity는 남아야 한다.

네 번째 통제는 외부 보존이다.
Endpoint가 침해되면 local 로그를 지우거나 설정을 되돌릴 수 있다.
EDR와 proxy event를 변경이 어려운 중앙 저장소로 전송하고 수집 실패도 경보로 만든다.
로그가 없다는 사실이 정상 동작 때문인지 sensor 중단 때문인지 구분할 수 있어야 한다.

다섯 번째 통제는 credential path 차단이다.
Internet으로 향하는 SMB·WebDAV 인증과 NTLM 사용을 필요한 범위로 제한한다.
Updater·notification process가 UNC path를 열거나 background 인증을 시도하면 높은 우선순위로 조사한다.
Binary allowlisting과 별개로 강제 인증 경로를 negative test에 포함한다.

## 복구와 실패 모드

서버가 정상화됐다는 공지만으로 endpoint incident를 닫는 것이 첫 번째 실패다.
과거 창에 받은 payload와 persistence는 origin의 현재 상태와 독립적으로 남을 수 있다.[1]
영향 가능 endpoint를 별도 inventory로 유지하고 evidence 기반으로 해제한다.

현재 URL을 다시 받아 hash가 정상이라는 이유로 과거 파일도 같았다고 결론 내리는 것이 두 번째 실패다.
파일 이름과 URL은 identity가 아니다.
수집 시각, 실제 bytes의 hash, signer와 endpoint execution context가 identity를 구성한다.
과거 bytes를 보존하지 못했다면 그 공백을 그대로 기록한다.

IOC 목록에 없는 목적지는 안전하다고 보는 것이 세 번째 실패다.
UNC7017은 campaign 동안 cloud provider, 전용 domain과 다른 cloud storage로 staging을 이동했다.[1]
행위 기반 탐지는 updater의 새로운 목적지, unsigned child, archive extraction과 scheduled task를 함께 본다.
IOC match는 조사 시작점이지 종료 조건이 아니다.

파일이 삭제됐으니 감염도 사라졌다고 보는 것이 네 번째 실패다.
보고된 downloader는 자체 삭제와 local configuration 복원을 시도했고 후속 persistence를 만들었다.[1]
Reimage 여부는 실행 chain, persistence, credential exposure와 business risk를 바탕으로 결정한다.
개별 파일 삭제만으로 신뢰 복구를 선언하지 않는다.

백업 제품이므로 reimage 전에 해당 endpoint의 backup을 그대로 복원하는 것이 다섯 번째 실패다.
복원 지점에 악성 persistence나 변조 artifact가 포함됐는지 확인해야 한다.
복구용 image와 credential이 사건 기간의 endpoint에서 생성됐다면 별도 신뢰 검증이 필요하다.
깨끗한 gold image, 필요한 데이터의 검증된 복원, key·credential 회전과 후속 모니터링을 하나의 runbook으로 묶는다.

Binary chain이 없으니 credential 회전을 생략하는 것이 여섯 번째 실패다.
WebDAV NTLM coercion은 payload 실행과 별도 경로였다.[1]
해당 egress가 확인되면 노출된 계정의 권한, 사용처와 후속 인증을 조사한다.
회전 뒤에는 기존 session, token과 service dependency가 실제로 폐기됐는지 확인한다.

## 이 공급망 조사 모델의 적용 대상과 한계

**적합한 경우**

AOMEI Backupper나 AnyViewer를 2026년 4~7월에 운용한 조직은 이 조사 모델의 직접 대상이다.
EDR, proxy, DNS와 Windows artifact를 90일 이상 보존한 조직은 과거 전달 chain을 더 잘 복원할 수 있다.
소프트웨어 updater를 많이 허용하는 기업은 이 사례를 일반적인 point-in-time 검사 한계의 tabletop fixture로 활용할 수 있다.
백업·원격지원 제품이 높은 권한으로 실행되는 환경에도 유용하다.

**부적합한 경우**

해당 제품을 한 번도 사용하지 않았고 설치·실행 이력으로 그 사실을 증명할 수 있는 조직에는 대규모 endpoint hunt가 우선순위가 아닐 수 있다.
현재 URL의 content만 볼 수 있고 과거 endpoint telemetry가 전혀 없는 팀은 `safe` 판정을 내려서는 안 된다.
그 경우 결론은 `insufficient_telemetry`이며 asset criticality에 따라 reimage나 credential 회전 같은 보수적 조치를 결정해야 한다.
공개 보고서만으로 특정 조직의 피해 여부나 전체 피해 규모를 계산하려는 분석에도 이 글의 방법은 맞지 않는다.

장기적으로는 모든 다운로드를 영구 보존할 필요가 없다.
고위험 updater의 응답 hash, final URL, signer, process lineage와 execution decision을 보존하는 것만으로도 조사력을 크게 높일 수 있다.
원본 artifact 보존이 필요할 때는 access control, retention과 privacy를 별도로 설계한다.
데이터를 최대한 많이 모으기보다 과거 실행 결정을 재구성할 최소 증거를 잃지 않는 데 목표를 둔다.

## 결론: 지금 깨끗하다는 사실은 그때 깨끗했다는 증거가 아니다

AOMEI 사례의 공개일은 2026년 10월 15일이고 관측된 campaign 기간은 2026년 4월부터 7월까지다.[1]
직접 확인된 origin configuration 변조는 10분, 6분, 5분의 짧은 창이었다.[1]
이 시간 경계를 보존해야 사건을 장기 상시 변조로 과장하지도, 현재 정상 응답으로 축소하지도 않는다.
피해 규모를 알 수 없는 상태에서 임의의 감염 수를 추정하지 않는 것도 같은 이유다.

사후 URL 평판, 현재 설정 파일과 재다운로드한 정식 package는 **현재 상태**의 증거다.
과거 endpoint의 network history, process tree, file identity, scheduled task와 credential authentication은 **historical execution**의 증거다.
두 묶음은 서로 보완하지만 대체하지 않는다.
현재 URL이 정상이어도 과거 endpoint evidence가 악성 chain을 가리키면 endpoint를 복구해야 한다.
반대로 알려진 IOC가 없더라도 telemetry가 부족하면 안전을 확정할 수 없다.

공급망 방어의 다음 산출물은 SBOM 한 장이나 URL allowlist 하나가 아니다.
Updater가 실제로 받은 응답과 package identity, 실행 결정을 시간과 함께 남기는 전달 영수증이다.
그 영수증을 endpoint 밖에 보존해야 서버와 로컬 설정이 몇 분 뒤 원상복구돼도 사건을 재구성할 수 있다.
5분짜리 공격에 필요한 것은 5분마다 URL을 보는 감시만이 아니라 과거를 증명할 수 있는 기록이다.

## Sources

[1] https://cloud.google.com/blog/topics/threat-intelligence/investigating-ephemeral-supply-chain-tampering — GTIG/Mandiant, Investigating Ephemeral Supply Chain Tampering
[2] https://www.manageengine.com/threat-analysis-lab/aomei-backupper-supply-chain-compromise.html — METAL, AOMEI Backupper supply-chain compromise
[3] https://cloud.google.com/blog/topics/threat-intelligence/mitigation-guidance-for-supply-chain-compromise — GTIG/Mandiant, Mitigation Guidance for Supply Chain Compromise
