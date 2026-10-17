# 꼬리노트 앱 수익 실험 공식 출처 dossier

> 조사 기준: 2026-10-17 KST
> 목적: 꼬리노트 수익 실험 포스트에서 사용할 Apple 정책·출시 상태·수수료·구독 benchmark의 표현 경계를 고정한다. 이 문서는 포스트 초안이 아니라 **출처 검증 결과**다.

## 1. 결론

포스트의 외부 사실은 네 가지만 남기는 편이 안전하다.

1. 앱 안의 광고 제거, 다중 반려동물, 가족 공유, 리포트, 백업, AI 요약처럼 **앱 내부의 디지털 기능을 유료로 여는 설계**에는 App Review Guideline 3.1.1의 인앱결제 원칙을 적용한다. 다만 storefront·entitlement별 외부 결제 예외까지 없다고 일반화하지 않는다.[1]
2. Apple Developer Program 등록은 배포 도구와 App Store Connect를 사용할 자격을 얻는 단계이지, 앱을 심사에 제출했거나 승인·출시했다는 뜻이 아니다.[2][3][4]
3. App Store Small Business Program 수수료는 Apple Developer Program 등록만으로 자동 적용되는 기본 수수료가 아니라 별도 등록과 자격 판정을 전제로 한다. 공식 페이지가 직접 설명하는 일반 App Store 계약 범위에서는 자격을 갖춘 참여 개발자의 paid app과 Apple IAP에 15% reduced commission이 적용된다. 별도 storefront·계약·결제방식까지 같은 비율이라고 확대하지 않는다.[5]
4. RevenueCat의 Health & Fitness 수치는 광고형 반려동물 기록 앱 시장 전체의 예측치가 아니다. RevenueCat을 통합하고 활성 구독 매출 및 최소 설치·매출 기준을 충족한 앱 표본의 2025년 중심 집계다.[6]

따라서 포스트는 “출시했다”가 아니라 **“개발 중이며 Apple Developer 등록을 완료했고, 내부 테스트→심사 제출→승인→출시→유지율·광고·결제 전환 측정이 남았다”**고 써야 한다.[2][3][4]

RevenueCat 수치를 넣더라도 시장 전망이나 꼬리노트의 예상 매출이 아니라, 출시 후 측정할 funnel의 참고 benchmark로만 쓴다.[6]

## 2. 최종 URL 직접 검증

아래 URL은 2026-10-17에 브라우저 자동화가 아닌 HTTP GET으로 직접 요청하고 redirect 후 최종 URL과 HTML `rel="canonical"`을 확인했다. 모두 HTTP 200이었다.

| ID | 공식 자료 | 요청 URL | 최종 URL | canonical | HTTP |
|---|---|---|---|---|---:|
| 1 | Apple App Review Guidelines | `https://developer.apple.com/app-store/review/guidelines/` | 동일 | `https://developer.apple.com/app-store/review/guidelines/` | 200 [1] |
| 2 | Apple Developer Program 등록 | `https://developer.apple.com/programs/enroll/` | 동일 | `https://developer.apple.com/programs/enroll/` | 200 [2] |
| 3 | App Store Connect — 앱 제출 | `https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/` | 동일 | 동일 | 200 [3] |
| 4 | App Store Connect — 출시 옵션 | `https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/` | 동일 | 동일 | 200 [4] |
| 5 | App Store Small Business Program | `https://developer.apple.com/app-store/small-business-program/` | 동일 | `https://developer.apple.com/app-store/small-business-program/` | 200 [5] |
| 6 | RevenueCat State of Subscription Apps 2026 | `https://www.revenuecat.com/state-of-subscription-apps/` | `https://www.revenuecat.com/state-of-subscription-apps` | `https://www.revenuecat.com/state-of-subscription-apps/` | 200 [6] |

RevenueCat 보조 랜딩 페이지 `https://revenuecat.com/sosa-26-insights`도 HTTP 200으로 응답한 뒤 `https://www.revenuecat.com/sosa-26-insights`로 이동했고 canonical은 trailing slash가 있는 같은 `www` URL이었다. 그러나 필요한 방법론과 수치가 모두 본 보고서 페이지에 있으므로 최종 출처에는 중복 등록하지 않았다.

## 3. Apple App Review 경계

### 3.1 앱 내부 디지털 기능과 IAP

Guideline 3.1.1은 앱 안의 기능이나 콘텐츠를 잠금 해제하려면 인앱결제를 사용해야 하며, license key·QR code 같은 자체 해제 수단을 사용할 수 없다고 규정한다.[1]

**꼬리노트에 적용 가능한 정확한 해석**

- 광고 제거, 반려동물 슬롯 추가, 가족 공유, 장기 리포트, 클라우드 백업, AI 요약 credit가 iOS 앱 안에서 소비되는 디지털 기능이라면 3.1.1의 IAP 원칙에 맞춰 설계한다.[1]
- 일회성 광고 제거를 non-consumable로, 사용량을 차감하는 AI 기능을 consumable로 구성하는 것은 검토할 수 있는 **StoreKit 상품 설계 후보**다. Apple이 꼬리노트의 광고 제거와 AI 기능에 이 상품 유형을 확정해 준 것이 아니므로, 실제 기능·복원 필요성·entitlement 구조에 맞춰 출시 전에 상품 유형을 확정한다.[1]
- Guideline 3.1.1에 따라 **IAP로 구매한 모든 credit 또는 currency는 만료될 수 없다.** 별도 구매분뿐 아니라 구독을 통해 제공하더라도 실제 구현이 저장·차감되는 credit/currency 잔액이라면 이 비소멸 원칙을 적용하고, 출시 전에 당시 Apple 정책을 다시 확인한다.[1]
- 월간 구독 혜택은 저장되는 credit 잔액으로 표현하지 않고, 구독 기간에 지속 가치를 제공하는 별도 후보인 **기간별 서비스 사용 한도**로 설계한다. 이 한도와 IAP 구매 credit/currency 잔액은 상품·entitlement·원장에서 구분한다. 다만 명칭과 무관하게 실제 구현이 credit/currency 잔액이면 앞의 비소멸 원칙을 적용한다.[1]
- 지속적인 가치를 제공해야 하고 최소 기간이 7일이어야 한다는 조건은 **auto-renewable subscription**에 한정해 적는다. 단순히 초기 Pro 기능을 한 번 열어 주는 상품을 근거 없이 auto-renewable subscription으로 포장하지 않는다.[1]

포스트에서 쓸 수 있는 문장:

> 광고 제거를 non-consumable로, 사용량 기반 AI 기능을 consumable로 두는 방안은 현재의 StoreKit 상품 설계 후보일 뿐 Apple이 꼬리노트에 확정한 분류가 아니다. 월간 구독 혜택은 저장 credit이 아니라 기간별 서비스 사용 한도로 설계한다. 실제 구현이 IAP로 구매되는 credit/currency 잔액이라면 만료시키지 않고, 상품 유형과 당시 정책을 출시 전에 다시 확인한다. 지속 가치와 최소 7일 조건은 auto-renewable subscription에 한정해 적용한다.[1]

**claim boundary**

- “디지털 기능은 항상 전 세계에서 Apple IAP만 가능하다”고 쓰지 않는다. 현재 guideline에는 미국 storefront의 버튼·외부 링크 처리와 일부 지역 entitlement 등 예외가 함께 적혀 있다.[1]
- 반대로 예외가 있다는 이유로 꼬리노트가 자체 결제 링크를 바로 넣을 수 있다고 쓰지도 않는다. 대상 storefront, 앱 유형, entitlement 및 당시 계약을 출시 직전에 다시 확인해야 한다.[1]
- IAP 사용은 심사 통과 보장이 아니다. 상품이 완전하고 최신이며 심사자가 앱에서 찾고 작동시킬 수 있어야 한다.[1]

### 3.2 광고

Guideline 2.5.18의 확인된 경계는 다음과 같다.[1]

- display advertising은 main app binary로 제한되며 extension, App Clip, widget, notification, keyboard, watchOS app 등에 넣지 않는다.[1]
- 광고는 앱의 연령 등급에 맞아야 한다.[1]
- 사용자는 광고 targeting에 쓰인 정보를 앱을 떠나지 않고 볼 수 있어야 한다.[1]
- 건강·의료 데이터 같은 민감정보를 이용한 targeted/behavioral advertising은 허용되지 않는다.[1]
- interstitial은 광고임을 분명히 표시하고, 기만 클릭을 유도하지 않으며, 접근하기 쉬운 닫기/건너뛰기 버튼을 제공해야 한다.[1]
- 광고가 있는 앱은 부적절하거나 연령에 맞지 않는 광고를 신고하는 기능을 제공해야 한다.[1]

**꼬리노트 설계 문장과 정책 문장을 분리한다.** Apple guideline은 “모든 건강 기록 화면에 광고를 표시하면 안 된다”고 쓰지 않는다. 또한 이 조항이 반려동물 건강 기록을 사람의 HealthKit/의료 데이터와 동일하게 분류한다고 명시하지도 않는다.[1] 따라서 “투약·병원·증상 기록 흐름에는 광고를 넣지 않고 비민감 화면에만 제한한다”는 것은 Apple의 문구를 그대로 옮긴 의무가 아니라, 오용·오클릭·민감 맥락 결합을 줄이기 위한 **꼬리노트의 더 보수적인 제품 원칙**으로 표현한다.

포스트에서 쓸 수 있는 문장:

> 광고를 전면에 붙이기보다 타임라인 밖의 비민감 화면부터 제한적으로 시험하려 한다. Apple은 민감한 건강·의료 데이터를 이용한 타기팅 광고를 금지하고, 광고의 표시·닫기·신고 요건도 둔다.[1] 꼬리노트는 그 최소선보다 보수적으로 투약·병원 기록 흐름에서는 광고를 배제할 계획이다.

### 3.3 건강·의료 표현과 개인정보

Guideline 1.4.1의 실제 경계는 부정확한 데이터·정보를 제공하거나 환자의 진단·치료에 쓰일 수 있는 medical app을 더 엄격히 심사할 수 있다는 것이다. 건강 측정 정확도 주장에는 이를 뒷받침하는 데이터와 방법론을 명확히 공개해야 하며, 정확도나 방법론을 검증할 수 없으면 거절될 수 있다. 또한 medical app은 사용자가 의학적 결정을 하기 전에 의사와 확인하도록 안내해야 한다.[1] Guideline 5.1은 모든 앱에 접근 가능한 privacy policy, 수집·이용·제3자 공유·보존/삭제 설명, 동의와 철회 수단, 데이터 최소화를 요구한다. 제3자 AI와 개인 데이터를 공유하는 경우도 명확한 공개와 명시적 동의를 요구한다.[1]

**꼬리노트가 더 보수적으로 정한 제품 경계**

- 기능을 “기록·알림·수의사 상담 준비”로 한정하고 “진단”, “처방”, “질병 예측”을 제공하지 않으며, 검증하지 않은 건강 측정 정확도를 주장하지 않는다.
- AI 월간 요약은 원기록 요약과 질문 목록 작성에 한정한다. 진단 결과처럼 보이는 위험도 점수나 투약 변경 지시는 제공하지 않는다.
- 광고 SDK, analytics SDK, crash SDK, AI API가 실제로 받는 필드를 privacy policy와 App Store privacy 답변에 반영하고, 원문 기록을 제3자 AI로 보내기 전에 목적·전송 범위·보존을 공개하고 동의를 받는다.[1]

앞의 진단·처방·질병 예측, 위험도 점수, 투약 변경 지시 배제는 Apple이 모든 앱에 해당 기능을 일률적으로 금지했다고 옮긴 문장이 아니다. 1.4.1의 더 엄격한 심사·정확성 근거·의학적 결정 전 확인이라는 실제 경계와 별개로, 오판의 위해를 줄이기 위해 꼬리노트가 채택한 제품 범위다.[1]

**claim boundary**

- Apple의 1.4.1과 5.1.3은 사람의 환자·HealthKit·임상 연구를 중심으로 서술한다. 이 자료만으로 “반려동물 건강 기록은 Apple이 정의한 human health data와 법적으로 동일하다”고 단정할 수 없다.[1]
- 반대로 pet data이므로 민감하지 않다고 단정해서도 안 된다. 병원명, 보호자 메모, 위치, 가족 계정, 사진에는 사람의 개인정보가 섞일 수 있다. 이 문장은 Apple 분류의 인용이 아니라 제품 threat model이다.
- “의료 판단 금지”는 심사 통과를 보장하는 면책 문구가 아니다. 실제 기능·metadata·스크린샷·AI 출력이 같은 경계를 지켜야 한다.

## 4. Apple Developer 등록과 출시 상태

### 4.1 공식 단계

Apple Developer Program 등록은 신원·조직 정보를 검증한 뒤 계약에 동의하고 멤버십을 구입하는 절차다. 공식 페이지의 기준 가격은 연 99 USD이며 지역별 현지 통화 가격은 다를 수 있다.[2]

등록 뒤에도 앱 출시는 별도 단계다.[2][3][4]

1. 앱 version의 필수 metadata를 입력하고 제출할 build를 선택한다.[3]
2. `Add for Review`를 누르면 `Ready for Review`가 되지만 아직 App Review로 전송된 것은 아니다.[3]
3. `Submit for Review`를 눌러야 제출되며 review가 시작되면 `In Review`가 된다.[3]
4. 승인 뒤 자동 출시, 지정일 이후 자동 출시, 수동 출시 중 선택한 release option이 적용된다.[4]
5. 수동 출시를 선택했다면 승인 후 `Pending Developer Release`에서 `Release This Version`을 별도로 눌러야 하며, 이후 App Store 표시까지 최대 24시간 걸릴 수 있다.[4]

### 4.2 꼬리노트 상태에 허용되는 표현

**사용 가능**

- `꼬리노트는 MVP 개발 중이다.`
- `Apple Developer Program 등록을 완료했다.`
- `App Store 심사 제출·승인·출시는 아직 남아 있다.`
- `등록 → 내부 테스트 → metadata·build 준비 → 심사 제출 → 승인 → 출시 → 실제 유지율·광고·결제 전환 측정 순서로 검증한다.`

**사용 금지**

- `App Store 출시 준비를 마쳤다.` — build, metadata, privacy, IAP, review 준비 완료까지 입증하지 못한다.[1][3]
- `Apple 심사를 기다리고 있다.` — 실제 `Submit for Review` 전에는 거짓이다.[3]
- `Apple이 앱을 승인했다.` — program enrollment 승인과 app review 승인을 혼동한다.[2][3]
- `출시했다`, `다운로드가 발생했다`, `매출이 발생했다.` — 현재 공개 사실이 아니다.

포스트에서 쓸 수 있는 문장:

> 지금 완료한 것은 Apple Developer Program 등록까지다. 앱 version의 metadata와 build를 준비해 `Submit for Review`하는 절차, Apple의 심사, 승인 뒤 실제 release는 각각 별도 단계다.[2][3][4] 그래서 현재 상태는 ‘출시 완료’가 아니라 ‘MVP 개발 중·App Store 제출 전’으로 기록한다.

## 5. App Store Small Business Program

이 절의 정규화된 경계는 하나다. **App Store Small Business Program 공식 페이지가 직접 설명하는 일반 App Store 계약 범위에서**, 별도 등록을 완료하고 자격이 인정된 참여 개발자의 paid app과 Apple IAP에는 **15% reduced commission rate**가 적용된다. 이 문장을 별도 storefront·상품·계약·결제방식의 확정 수수료로 확대하지 않으며, 실제 적용 조건은 출시 직전에 다시 확인한다.[5]

자격·적용 조건은 다음처럼 보존한다.

- 기존 개발자는 모든 앱의 전년도 proceeds가 100만 USD 이하인 경우, 신규 App Store 개발자는 별도 조건에 따라 program 자격 대상이 될 수 있다.[5]
- 자격 계산은 단순 gross sales가 아니라 Apple commission과 일부 세금·조정을 뺀 `proceeds` 기준이다.[5]
- 본인 계정과 Associated Developer Accounts를 합쳐 이전 calendar year 안의 12 fiscal months proceeds가 100만 USD 이하여야 하고, current year proceeds도 100만 USD 이하여야 한다.[5]
- 가입 시 Account Holder여야 하고 최신 Paid Apps agreement를 수락하며 Associated Developer Accounts를 신고해야 한다.[5]
- 참여 중 current year threshold를 넘으면 future sales에 standard commission rate가 적용된다.[5]
- 실제 storefront·상품·계약·결제방식에 이 일반 프로그램 설명이 그대로 적용되는지는 출시 직전에 확인한다.[5]

**claim boundary**

- `Apple 수수료는 15%다`라고 전 세계·모든 계약에 일반화하지 않는다. 이 dossier에서 허용하는 문구는 위의 정규화된 경계뿐이며, 출시 직전에 storefront·상품·계약·결제방식을 다시 확인한다.[5]
- 이 공식 페이지는 threshold 초과 뒤 적용될 `standard commission rate`를 숫자로 적지 않는다. 이 dossier에서는 30%를 덧붙이지 않는다.[5]
- 15% commission만 빼서 “매출의 85%가 그대로 입금된다”고 계산하지 않는다. proceeds 정의에는 세금과 조정도 들어간다.[5]
- Apple Developer Program 등록 완료를 Small Business Program 등록 완료로 바꾸어 쓰지 않는다. 후자는 별도 enrollment다.[2][5]

포스트에서 쓸 수 있는 문장:

> 수수료도 아직 하나의 비율로 확정해 적지 않는다. App Store Small Business Program은 별도 등록과 자격 판정이 필요하며, 본인과 연관 개발자 계정의 proceeds 기준을 함께 본다. 공식 페이지가 설명하는 일반 App Store 계약 범위에서는 자격을 갖춘 참여 개발자의 paid app과 Apple IAP에 15% reduced commission이 적용된다. 출시 직전에 실제 storefront·상품·계약·결제방식을 다시 확인한다.[5]

## 6. RevenueCat State of Subscription Apps 2026

### 6.1 표본과 범위

보고서는 115,000개 초과 앱, 160억 USD 초과 매출, 10억 건 초과 transaction을 분석했다고 밝힌다.[6] 그러나 포함 조건은 RevenueCat으로 in-app subscription을 관리하고, active subscription revenue가 있으며, 통계적 의미를 위한 최소 install 또는 revenue threshold를 충족한 앱이다.[6]

- 주된 metric 기간은 2025년이다. annual subscription의 3차 renewal처럼 계산상 필요한 경우 이전 연도 데이터를 사용했다.[6]
- iOS, Android, web ecosystem을 포함한다.[6]
- 보고서의 `Health & Fitness` bucket은 store의 Health & Fitness와 Medical category를 묶는다. `Social & Lifestyle`은 Lifestyle, Social Networking, Social, Dating을 묶는다.[6]
- South Korea는 geographic user region 분류에서 Japan·Australia·New Zealand와 함께 Asia-Pacific에 들어간다. `Developer HQ`와 사용자의 `Geography`는 별도 segment다.[6]
- RPI는 total revenue를 total installs로 나눈 값이고, D35 download-to-paid는 설치 뒤 35일 안에 한 번 이상 유료 구독으로 전환된 install의 비율이다. D30 download-to-trial은 설치 뒤 30일 안에 free trial을 시작한 비율이며, **trial-based acquisition strategy를 사용하는 앱에 한해 계산된다.** trial-to-paid는 free trial start 중 paid subscription으로 전환한 비율이다.[6]

**핵심 경계:** 이 보고서는 App Store 전체 앱, 광고 수익 앱, 일회성 유료 앱, 아직 구독 매출이 없는 신규 앱의 무작위 표본이 아니다. 따라서 “반려동물 앱 시장의 평균”이나 “꼬리노트 예상 전환율”로 바꾸면 안 된다.[6]

### 6.2 포스트에 쓸 수 있는 정확한 category benchmark

RevenueCat의 qualifying Health & Fitness bucket 집계에서 다음 수치를 확인했다.[6]

| 지표 | Health & Fitness 수치 | 정확한 해석 |
|---|---:|---|
| D30 download-to-trial | median 6.9% | trial-based acquisition strategy를 사용하는 앱만을 대상으로 계산한, 설치 후 30일 안에 trial을 시작한 install 비율의 앱별 median |
| Trial-to-paid | median 37.7%; upper quartile 51.4% 초과 | trial start 중 paid subscription으로 전환한 비율 |
| D35 download-to-paid | median 2.9%; upper quartile 6.2% 초과 | 설치 후 35일 안에 한 번 이상 paid subscription이 된 install 비율 |
| D14 RPI | median $0.48 | 설치당 누적 매출의 Day 14 앱별 median |
| D60 RPI | median $0.66 | 설치당 누적 매출의 Day 60 앱별 median |

보고서에서 Health & Fitness는 D14와 D60 category RPI가 각각 $0.48과 $0.66으로 가장 높았고, D35 download-to-paid median도 2.9%로 category 중 가장 높았다.[6] 이 사실은 **해당 표본의 순위**이지, 꼬리노트가 Health & Fitness category로 분류되거나 같은 성과를 낸다는 뜻이 아니다.

보고서에는 Health & Fitness의 annual plan 선택 비중 68%와 annual plan revenue share 59%가 각각 별도 chart에 나온다.[6] 즉 `구매 건수/선택 mix`와 `매출 비중`을 섞어 “매출의 68%가 연간 구독”이라고 쓰면 안 된다. 본 포스트의 중심이 구독 duration 최적화가 아니므로 이 두 수치는 본문에서 생략하는 편이 낫다.

### 6.3 권장 인용 문장

수치를 하나만 쓴다면 다음 문장이 가장 안전하다.

> RevenueCat의 2026 보고서에서 Health & Fitness bucket의 D35 download-to-paid median은 2.9%였다. 다만 이는 2025년을 주된 기간으로, RevenueCat을 통합하고 활성 구독 매출과 최소 표본 기준을 충족한 앱을 집계한 값이다. 아직 출시 전인 꼬리노트의 예상 전환율이 아니라 출시 후 비교할 참고선으로만 사용한다.[6]

좀 더 짧게 쓰려면 수치를 빼고 다음처럼 쓴다.

> 공개 benchmark는 가설의 크기를 정하는 참고선일 뿐이다. 꼬리노트의 결제 전환은 출시 뒤 `install → retained recorder → paywall view → trial/IAP → paid`를 직접 측정해 판단한다.[6]

### 6.4 쓰면 안 되는 문장

- `건강 앱의 평균 결제 전환율은 2.9%다.` — median을 평균으로 바꾸고 표본 조건을 지운다.[6]
- `반려동물 건강 앱은 결제가 잘 된다.` — 보고서 bucket은 Health & Fitness와 Medical이며 pet app 하위 표본을 공개하지 않는다.[6]
- `100명이 설치하면 3명이 결제한다.` — app-level median을 개별 앱의 확정 확률로 바꾼다.[6]
- `D30 trial 6.9% × trial-to-paid 37.7% = 꼬리노트 유료 전환율` — 서로 다른 앱 분포의 median을 곱해 예측값을 만들면 안 된다.[6]
- `D60 설치당 $0.66를 벌 수 있다.` — category 표본의 median RPI를 제품 forecast로 바꾼다.[6]
- `RevenueCat이 광고+IAP 혼합 모델을 검증했다.` — 이 dataset의 중심은 subscription performance이며 광고 수익 benchmark가 아니다.[6]

## 7. OpenAI 가격 제외 결정

이 포스트에서 AI는 핵심 기능이 아니라 선택형 비용 기능 원칙만 설명하면 된다. 아직 사용할 model, input/output token budget, cache, 호출 빈도, 환율, 실패·재시도율이 정해지지 않았으므로 token 가격을 넣어도 꼬리노트의 단위경제를 검증하지 못한다.

따라서 **OpenAI 가격과 비용 계산은 본 source dossier와 포스트에서 제외**한다. 실제 AI 요약 prototype을 만들고 모델·prompt·월간 호출 상한을 고정한 뒤, 그 시점의 공식 가격으로 별도 cost ledger를 만드는 것이 맞다.

## 8. 포스트 작성용 최종 claim checklist

- [ ] `Apple Developer 등록 완료`와 `App Store 제출 전`을 한 문단에서 함께 쓴다.
- [ ] 등록, 제출, review, approval, release, store availability를 서로 다른 상태로 쓴다.[2][3][4]
- [ ] 광고 제거·Pro 기능·AI 기능을 앱 내부 디지털 기능으로 설명할 때 IAP 원칙을 인용한다.[1]
- [ ] 광고 제거=non-consumable, AI 기능=consumable은 Apple이 꼬리노트에 확정한 분류가 아니라 출시 전에 확정할 StoreKit 상품 설계 후보라고 쓴다.[1]
- [ ] IAP로 구매한 모든 credit/currency에는 만료를 두지 않는다. 구독 제공분도 실제 구현이 저장·차감되는 credit/currency 잔액이면 같은 비소멸 원칙을 적용하고 출시 전에 당시 Apple 정책을 다시 확인한다.[1]
- [ ] 월간 구독 혜택은 저장 credit 잔액이 아닌 `기간별 서비스 사용 한도`라는 별도 후보로 설계하고, IAP 구매 credit/currency와 상품·entitlement·원장에서 구분한다.[1]
- [ ] 지속 가치와 최소 7일 조건은 `auto-renewable subscription`에 한정해 쓴다.[1]
- [ ] 외부 결제 예외를 전 세계 공통 규칙처럼 확대하거나 삭제하지 않는다.[1]
- [ ] 건강 데이터 기반 targeted advertising 금지와 “민감 흐름에는 광고를 두지 않는다”는 자체 원칙을 구분한다.[1]
- [ ] pet health data가 Apple의 human health data와 법적으로 동일하다고 단정하지 않는다.[1]
- [ ] 1.4.1의 실제 경계(더 엄격한 심사, 정확성 근거·방법론, 의학적 결정 전 확인)와 꼬리노트의 더 보수적인 경계(진단·처방·질병 예측, 위험도 점수, 투약 변경 지시 배제)를 Apple의 일률적 금지처럼 섞지 않는다.[1]
- [ ] 제3자 AI·광고·analytics SDK로 보낼 데이터와 동의·삭제 경계를 실제 구현과 일치시킨다.[1]
- [ ] Small Business Program의 15%는 공식 페이지가 설명하는 일반 App Store 계약 범위로 한정하고, 출시 직전에 실제 storefront·상품·계약·결제방식을 다시 확인한다.[5]
- [ ] RevenueCat 수치에는 표본 조건, 2025년 중심 기간, metric denominator, median을 함께 보존한다. D30 download-to-trial에는 trial-based acquisition strategy 사용 앱만의 계산이라는 metric-specific 조건도 붙인다.[6]
- [ ] 꼬리노트의 store category가 확정되지 않은 상태에서 Health & Fitness benchmark를 제품 forecast로 쓰지 않는다.[6]
- [ ] eCPM, 광고 매출, 한국 사용자 전환율, 환율을 공식 관측값처럼 추가하지 않는다.
- [ ] OpenAI token 가격은 이번 글에서 제외한다.

## Sources

[1] https://developer.apple.com/app-store/review/guidelines/ — Apple App Review Guidelines
[2] https://developer.apple.com/programs/enroll/ — Apple Developer Program — Become a member
[3] https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/ — App Store Connect Help — Submit an app
[4] https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/ — App Store Connect Help — Select release option
[5] https://developer.apple.com/app-store/small-business-program/ — App Store Small Business Program
[6] https://www.revenuecat.com/state-of-subscription-apps/ — RevenueCat State of Subscription Apps 2026
