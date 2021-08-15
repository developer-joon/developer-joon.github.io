---
title: '[JAVA 8] Functional Basic (1/2)'
date: 2021-08-14 00:00:00
description: '자바에서 역사상 큰 변화는 바로 함수형 프로그래밍을 도입한 것이다. 왜 함수형 프로그래밍이 필요한지 알아본다. '
featured_image: '/images/trend-trendy-lifestlye-urban-style-concept.jpg'
---

![](/images/mockup-copy-space-blank-screen-concept.jpg)

## 개요

자바에서 역사상 큰 변화는 바로 함수형 프로그래밍을 도입한 것이다. 왜 함수형 프로그래밍이 필요한지 알아본다. 

## funtional interface

검색 조건에 맞는 기능을 정의해야되며, 메서드 또는 파라미터가 증가 된다. 코드를 재사용을 할 수 없다.

```jsx
... (생략)

// 국가 정보에 기반해서 여행 상품을 조회한다.
public List<TravelInfo> searchTravelInfo(String country) {
  List<TravelInfo> returnValue = new ArrayList<>();
  for (TravelInfo travelInfo : travelInfoList) {
		if (country.equals(travelInfo.getCountry())) {
			returnValue.add(travelInfo);
    }
  }
	return returnValue;
}
```

인터페이스에 하나의 메서드만 선언한 것을 함수형 인터페이스이다.

```jsx
@FuntionalInterface // 명시적 함수형 인터페이스 어노테이션 선언
public interface TravelInfoFilter {
	public boolean isMatched(TravelInfoVO travelInfo);
}
```

파라미터를 인터페이스로 정의하고, isMatched 메서드의 결과로 조회조건을 외부로 분리한다.

```jsx
...(생략)

public List<TravelInfo> searchTravelInfo(TravelInfoFilter searchCondition) {
  List<TravelInfo> returnValue = new ArrayList<>();
  for (TravelInfo travelInfo : travelInfoList) {
		if (searchCondition.isMatched(travelInfo)) {
			returnValue.add(travelInfo);
    }
  }
	return returnValue;
}
```

메서드가 하나인 인터페이스를 인스턴스 new 키워드를 사용하여 조회 조건을 정의를 조회한다.

```jsx
List<TravelInfo> searchTravel = searchTravelInfo(new TravelInfoFilter(){
	@Override
	public boolean isMatched(TravelInfoVO travelInfo) {
		if (travelInfo.getCountry().equals("vietnam")) {
			return true;
		} else {
			return false;
		}
	}
});
```

아래 코드처럼 람다 표현식으로 코드 함축하여 사용할 수 있다.

```jsx
List<TravelInfo> searchTravel = searchTravelInfo((TravelInfoVO travelInfo) -> travelInfo.getCountry().equals("vietnam"));
or
// 타입까지 형식 추론하여 생략 가능하다.
List<TravelInfo> searchTravel = searchTravelInfo((travelInfo) -> travelInfo.getCountry().equals("vietnam"));
```

별도의 클래스 또는 동일 클래스에 머서드를 미리 조회 조건에 대해 정의 해둔다.

```jsx
public class FuntionSearchingTravel {
	public static boolean isVietnam(TravelInfoVO travelInfo) {
		if (travelInfo.getCountry().equals("vietnam")) {
			return true;
		} else {
			return false;
		}
	}
}
```

메서드 참조를하여 조건을 전달 할 수 있다.

```jsx
List<TravelInfo> searchTravel = searchTravelInfo(FuntionSearchingTravel::isVietnam);
```

## 정리

- 특정 조건의 기능을 추가/변경하기 위해 메서드를 추가하거나 인수를 추가하는 방법 외에도 인터페이스를 이용해서 구현을 분리하는 방법이 있다.
- 인터페이스로 분리하면 익명 클래스 사용 빈도가 높아지게 되고 결과적을 ㅗ중복 코드와 컴파일된 클래스가 늘어나는 단점이 있다.
- 익명 클래스의 단점을 해결하기 위해 람다 표현식을 사용한다.
- 람다 포현식을 재활용하고 단점을 보완하기 위해 메서드 참조 기능을 사용한다.
- 오직 하나의 public  메서드만 정의해 놓은 인터페이스를 특별히 함수형 인터페이스라고 한다.