---
title: '[JAVA 8~9] interface default, static, private'
date: 2021-08-13 00:00:00
description: '자바8 버전에서 인터페이스에 default, static, private 메서드가 추가 되었으며, 사용방법에 대해 알아본다.'
featured_image: '/images/trend-java-interface.jpg'
---

![](/images/mockup-copy-space-blank-screen-concept.jpg)

## 개요

자바 버전 8에서는 인터페이스에 default, static, private 메서드가 추가 되었으며, 사용방법에 대해 알아본다.

## default

기존 HouseAddress 인터페이스에 국가코드를 추가할 경우 인터페이스에는 선언만 가능하였기 떄문에 상속받은 모든 클래스에선 국가코드 전부 메소드 정의를 해야되었다. lib 배포 또는 국가코드 사용안하는 비지니스 로직 등에선 불필요한 작업이 발생할 수 있다. 아래 코드 처럼 인터페이스 default로 인터페이스에 메소드를 정의를 할 수 있다.  

```jsx
public interface HouseAddress {
	public static final String DefaultCountry = "Korea";
  
  // 우편번호를 리턴한다.
  public String getPoseCode();
  
  // 주소 정보를 리턴한다.
  public String getAddress();
  
  // 상세 정보를 리턴한다.
  public String getDetailAddress();

  **// 국가 코드를 리턴한다.**
  default public String getCountryCode() {
    return HouseAddress.DefaultCountry;
  }
}
```

주의사항

1. 클래스가 인터페이스에 대해 우선순위를 가진다. 동일한 메서드가 인터페이스와 클래스에 둘다 있으면 클래스가 먼저 호출된다.
2. 위의 조건을 제외하고 상속 관계에 있을 경우에는 하위 클래스/인터페이스가 상위 클래스/인퍼테이스보다 우선 호출된다.
3. 위의 두 가지 경우를 제외하고 메서드 호출 시 어떤 메서드를 호출해야할지 모호할 경우 컴파일 에러가 발생할 수 있으며, 반드시 호출하고자 하는 클래스 혹은 인터페이스를 명확하게 지정해야 한다.

## static

인터페이스에 static 예약어를 사용할 수 있다. 멤버변수 또는 메서드로 사용가능하다.

```jsx
public interface Sample {
    static String no = "no";
    static boolean of(){
        return true;
    }   
}
```

## private

private 메서드는 자바9에서 사용가능하다. 내부 코드를 재사용하기 위해 도입되었다고 한다.

```jsx
private void sub(int a, int b) {
        System.out.print("Answer by Private method = ");
        System.out.println(a - b);
    }
```

## 정리

- 자바 버전 업그레이드에 따라 인터페이스에 정의할 수 있는 항목들이 늘어 났다.
- 인터페이스에 default 메서드, static 메서드, private 메서드를 추가할 수 있다.
- 제한적이긴 하지만 다중 상속 및 다이아몬드 상속이 발생할 수 있으므로 인터페이스와 클래스 간의 상속 관계와 호출 관계에 대해 명확하게 이해해야 한다.
- 다중 삭속으로 인해 메서드 호출이 모호해지지 않도록 super 키워드르 이용해서 호출할 인터페이스의 default 메서드를 명시적으로 지정해야 한다.