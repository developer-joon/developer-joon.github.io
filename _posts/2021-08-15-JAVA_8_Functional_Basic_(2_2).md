---
title: '[JAVA 8] Functional Basic (2/2)'
date: 2021-08-15 00:00:00
description: '자바에서 제공하는 기본 함수형 인터페이스 외에 새로 함수형 인터페이스를 추가할 때는 명시적으로 FunctionalInterface 어노테이션을 적용하는 것이 좋다. 자바에서 기본적으로 제공하는 많은 함수형 인터페이스가 있지만 주된 패턴의 내용을 정리해본다.'
featured_image: '/images/trend-trendy-lifestlye-urban-style-concept.jpg'
---

![](/images/mockup-copy-space-blank-screen-concept.jpg)

## 개요

자바에서 제공하는 기본 함수형 인터페이스 외에 새로 함수형 인터페이스를 추가할 때는 명시적으로 FunctionalInterface 어노테이션을 적용하는 것이 좋다. 자바에서 기본적으로 제공하는 많은 함수형 인터페이스가 있지만 주된 패턴의 내용을 정리해본다.

![/images/java/java-1.png](/images/java/java-1.png)

## Consumer

람다 함수를 파라미터로 전달하여 소비하도록 한다.

사용 예시)

```jsx
public class ConsumerExample {
	
	public static void executeConsumer(List<String> nameList, Consumer<String> consumer) {
			for (String name : nameList) {
				consumer.accept(name);
			}
	}
	public static void main(String[] args) {
		List<String> nameList = new ArrayList<>();
		nameList.add("정수빈");
		nameList.add("김재호");
		nameList.add("오재원");
		nameList.add("이영하");
		ConsumerExample.executeConsumer(nameList, (String name) ->System.out.println(name));
	} 
}
```

## Function

람다 함수를 파라미터로 전달하여 후 리턴을 받는다.

사용 예시)

```jsx
public class FunctionExample {
	public static int executeFuntion(String context, Function<String, Integer> function) {
		return function.apply(context);
	}

	public static void main(String[] args) {
		int length = FunctionExample.executeFunction("Hello!", (String context) -> context.length());
		System.out.println(length);
	}

}
```

## Predicate

해당 인터페이스는 "예언" 혹은 "예측"이라는 뜻을 가지고 있어서 우리나라 개발들이 이름으로 추론해서 사용하기 어려운 인터페이스이다. 기본 데이터 타입인 int, double 등은 해당 타입에 맞는 래퍼 클래스를 이용하면 오토박싱이 적용되어 객체로 리턴된다. 

```jsx
public class PredicateExample {

		public static boolean isValid(String name, Predicate<String> predicate) {
			return predicate.test(name);
		}
		
		public sstatic void main(String[] args) {
			PredicateExample.isValid("", (String name) -> !name.isEmpty());
		}
}
```

## Supplier

공급자로 해석 할 수 있는데 앞서 살펴본 consumer 인터페이스와 반대 되는 경우이다.

```jsx
public class SupplierExample {
	public static String executeSupplier(Supplier<String> supplier) {
		return supplier.get();
	}
	
	public static void main(String[] args) {
		String version = "java";
		SupplierExample.executeSupplier(() -> {return version;})

	}
}
```

### 기본형 데이터를 위한 인터페이스

자바에서의 데이터 타입은 기본형과 객체형으로 구분되어 있다. 기본형 데이터를 객체형으로 변환하는 것을 박싱(boxing)이라고 하고 반대로 객체형을 기본형으로 변환하는것을 언박싱(un-boxing)이라고 한다. 개발자가 직접 코딩하는 과정을 없애 주어서 편리하지만, 반대로 자바 가상 머신 입장에서는 굉장한 비용이 많이 드는 작업으로, 소프트웨어의 성능에 악영향을 준다.

![/images/java/java-2.png](/images/java/java-2.png)

### Operator 인터페이스

java.util.function 패키지에는 앞서 살펴본 4개의 주요 함수형 인터페이스 외에도 Operator 인터페이스를 기본 함수형 인터페이스로 제공하고 있다. Operator 인터페이스는 항상 이름 앞에 접두어를 붙여서 어떤 데이터를 처리하는지 명확하게 지정하도록 하고 있다.

![/images/java/java-3.png](/images/java/java-3.png)


UnaryOperator 사용 예제

```jsx
public class UnaryOperatorExample {
	
	public static void main(String[] args) {
		UnaryOperator<Integer> operatorA = (Integer t) -> t * 2;
		System.out.println(operatorA.apply(1));
		System.out.println(operatorA.apply(2));
		System.out.println(operatorA.apply(3));
	}
}
```

BinaryOperator 사용 예제

```jsx
public class BinaryOperatorExample {
	public static void main(String[] args) {
		BinaryOperator<Integer> operatorA = (Integer a, Integer b) -> a + b;
		System.out.println(operatorA.apply(1, 2));
		System.out.println(operatorA.apply(2, 3));
		System.out.println(operatorA.apply(3, 4));
	}
}
```

### 메서드 참조

람다 표현식 구문

```jsx
(String name) -> System.out.println(name);
```

메서드 참조 구문

```jsx
System.out::println
```

메서드 참조 변환

```jsx
list.stream().forEach(name -> system.out.println(name));
//or
list.stream().forEach(System.out::println);
```

한정적 메서드 참조

```jsx
list.stream().forEach(MethodReferenceExample.of()::toUpperCase);
```

비한정적 메서스 참조

```jsx
list.tream().map(string:toUpperCase).forEach(System.out::println);
```

자바 8에 새롭게 추가된 구문으로, 클래스와 메서드를 구분하는 키워드(::)를 이용하며 참조할 내용을 저ㅗㅇ의한 실제 메서드를 호출하는 것이 아니라 이름만 참조하는 것이기 때문에 메서드 뒤에 괄호와 입력 파라미터는 생략한다. 이러한 메서드 참조는 세 가지로 구분할 수 있다.

**정적 메서드 참조**

static으로 정의한 메서드를 참조할 때 사용한다. 가장 이해하기 쉽고 사용하기 편리하다.

ex) Integer::parseInt

**비한정적 메서드 참조**

public 혹은 proteced로 정의한 메서드를 참조할 때 사용하며 static 메서드를 호출하는 것과 유사하다. 스크림에서 필터와 매핑용도로 많이 사용한다. 스트림에 포함된 항목과 참조하고자 하는 객체가 반드시 일치해야 한다. 그리고 참조하기 위한 변수를 지정하지 않는다.

ex) String::toUpperCase, String::compareTo

**한정적 메서드 참조**

이미 외부에서 선언된 객체의 메서드를 호출하거나, 객체를 직접 생성해서 메서드를 참조할 때 사용한다. 한정적 메서드 참조는 외부에서 정의한 객체의 메서드를 참조할 때 사용하며, 비한정적 메서드 참조는 람다 표현식 내부에서 생성한 객체의 메서드를 참조할 때 사용한다는 점이다.

ex) Calendar.getInstance()::getTime

주의

메서드 참조가 실제로 메서드가 실행된 결과를 리턴한다고 생각하는 것이다. 람다 표현식도 마찬가지지만, 메서드 참조 역시 코드 자체를 전달하는 것이지 실행 결과를 전달하는 것은 아니다. 전달된 코드가 함수형 인터페이스 내부에서 실행될 때 비로소 의미 있는 데이터 결과가 나온다.

### 생성자 참조

람다 표현식과 메서드 참조는 주어진 객체의 메서드를 호출해서 변경된 결괏값을 리턴하는 구조다. 하지만 새로운 객체를 생성해서 리턴해야 하는 경우도 많은데 이런 경우에 생성자 참조를 유용하게 사용할 수 있다.

```jsx
// 람다 표현식
list.stream().map((String name) -> new ConstructorReferenceExample(name)).forEach((ConstructorReferenceExample data) -> System.out.println(data));

// 생성자 참조
list.stream().map(ConstructorReferenceExample::new).forEach((ConstructorReferenceExample data) -> System.out.println(data));

// 생성자 참조, 메서드 참조
list.stream().map(ConstructorReferenceExample::new).forEach(System.out::println);
```

### 람다 표현식 조합

**Consumer 조합**

accept 메서드 외에 추가적으로  andThen 메서드를 제공하고 있다.

![/images/java/java-4.png](/images/java/java-4.png)


```jsx
public class AndThenExample {
	public static void main(String[] args) {
		Consumer<String> consumer = (String text) -> System.out.println("Hello : " + text);
		Consumer<String> consumerAndThen = (String text) -> System.out.println("Text Length is " + text.length());
		consumer.andThen(consumerAndThen).accept("Java");
	}
}

// output
Hello : Java
Text Length is4
```

**Predicate 조합**

test 메서드 외에도 추가적인 메서드를 제공하고 있다.

![/images/java/java-5.png](/images/java/java-5.png)

```jsx
public static void main(String[] args) {
	Predicate<Person> predicateA = PredicateAndExample.isMale();
	Predicate<Person> predicateB = PrediacteAndExample.isAdult();

	// predicate 객체 조합
	Predicate<Person> predicateAB = predicateA.and(predicateB);
	
	Person person = new Person();
	person.setName("David Chang");
	System.out.println("result : " + predicateAB.test(person))
}
```

**Function 조합**

![/images/java/java-6.png](/images/java/java-6.png)

```jsx
public class FunctionAndThenExample {
	public static void main(String[] args) {
		Function<String, Integer> parseIntFunction = (String str) -> Integer.parseInt(str) + 1;
		Function<Integer, String) intToStrFunction = (Integer i) -> "String : " + Intger.toString(i);
		System.out.println(parseIntFunction.andThen(intToStrFunction).apply("1000"));
	}
}
```

## 정리

- 람다 포현식은 익명 클래스 생성을 대신하며 반복적이고 불필요한 코드를 최소화하고 실행 관점에서 코드를 작성한다.
- 람다 포현식은 기능적으로 새로운 것을 구현할 수 있는 것은 아니다.
- public 메서드가 하나만 있는 인터페이스를 함수형 인터페이스라고 한다.
- 자바에서 기본 제공하는 대표적인 함수형 인터페이스는 Consumer, Function, Predicate, Suplier이다.
- 메서드 참조는 메서드 참조와 생성자 참조로 나눌 수 있고, 람다 표현식을 한단계 더 함축시킬 수 있다.
- 함수형 인터페이스의 조합 기능을 통해 람다 포현식의 결과를 결합할 수 있다.