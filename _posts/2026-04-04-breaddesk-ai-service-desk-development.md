---
title: 'AI 에이전트와 9시간 만에 만든 AI 문의·업무관리 시스템 — BreadDesk 개발기'
date: 2026-04-04 00:00:00
description: 'Spring Boot 3.5 + Next.js 15 + PostgreSQL + K8s로 구축한 AI 네이티브 서비스데스크 BreadDesk 개발 과정을 공개합니다. AI 에이전트 협업 개발, 브라우저 테스트 주도 방법론, 9.5시간 만에 30개 기능을 구현한 비결을 정리합니다.'
featured_image: '/images/2026-04-04-breaddesk-ai-service-desk-development/cover.jpg'
tags: breaddesk, ai-agent, spring-boot, nextjs, kubernetes, project
---

![BreadDesk 개발기](/images/2026-04-04-breaddesk-ai-service-desk-development/cover.jpg)

"AI 에이전트가 코딩을 대신 해준다면, 개발자는 무엇을 해야 할까?"

이 질문에 대한 답을 찾기 위해, 저는 AI 에이전트와 함께 **9.5시간** 만에 풀스택 웹 애플리케이션을 개발하는 실험을 진행했습니다. 그 결과물이 바로 **BreadDesk** — AI 네이티브 고객지원 및 업무관리 통합 시스템입니다.

이 글에서는 BreadDesk를 어떻게 설계하고 구현했는지, AI 에이전트와의 협업 방식, 그리고 9시간 만에 30개 기능을 완성한 비결을 공유합니다.

## 왜 BreadDesk를 만들었나?

### 배경: AI 네이티브 고객지원의 필요성

기존 고객지원 시스템(Zendesk, Freshdesk 등)은 대부분 **사람 중심 워크플로우**로 설계되어 있습니다. AI 자동응답은 있지만, 실제로는 사람이 개입해야 제대로 작동합니다.

저는 반대로 접근했습니다: **AI가 먼저 대응하고, 사람은 필요할 때만 개입하는 구조**. 이렇게 하면:
- 고객은 24시간 즉시 답변 받음
- 담당자는 AI가 해결 못한 복잡한 케이스만 처리
- 반복 질문은 AI가 학습해 자동화

여기에 **업무관리(Issue Tracking)** 기능까지 통합하면, 고객 문의가 곧바로 내부 태스크로 전환되는 시스템이 완성됩니다.

## 기술 스택

BreadDesk는 **모던 풀스택 아키텍처**로 구축했습니다.

### 백엔드
- **Spring Boot 3.5**: Java 21 기반, REST API + WebSocket
- **PostgreSQL 16**: 관계형 데이터 저장
- **pgvector**: AI 답변 검색을 위한 벡터 임베딩 저장
- **OpenAI API**: gpt-4o-mini로 자동응답 생성
- **Redis**: 세션 저장 및 캐싱

### 프론트엔드
- **Next.js 15**: React 19 기반, App Router
- **TypeScript**: 타입 안정성
- **Tailwind CSS**: 유틸리티 기반 스타일링
- **Radix UI**: 접근성 높은 컴포넌트 라이브러리

### 인프라
- **Kubernetes**: 컨테이너 오케스트레이션
- **Docker**: 컨테이너 빌드
- **Nginx**: 리버스 프록시
- **Let's Encrypt**: HTTPS 인증서

## AI 에이전트 협업 개발 방식

### 역할 분담: 오케스트레이터 vs 개발자

BreadDesk는 **2계층 AI 에이전트 구조**로 개발했습니다.

1. **오케스트레이터 (Brad)**: Claude Opus 4.6 기반
   - 전체 아키텍처 설계
   - 기능 우선순위 결정
   - 서브에이전트에게 개발 작업 할당
   - 브라우저 테스트 수행 및 피드백

2. **개발자 (Sonnet 서브에이전트)**:
   - 백엔드 API 구현
   - 프론트엔드 UI 컴포넌트 작성
   - 데이터베이스 스키마 변경
   - 단위 테스트 작성

### 핵심 개발 방법: 브라우저 테스트 주도 (Browser-Driven Development)

일반적인 TDD(Test-Driven Development)처럼, **브라우저 테스트를 먼저 정의하고 에이전트가 구현하는 방식**을 사용했습니다.

#### 워크플로우
1. **Brad(오케스트레이터)가 요구사항 정의**: "티켓 목록에 상태 필터 추가"
2. **Sonnet(개발자)이 구현**: Spring Boot 컨트롤러 + Next.js 컴포넌트 작성
3. **Brad가 브라우저 검증**: `browser` 도구로 실제 웹사이트 접속 후 필터 작동 확인
4. **피드백 반복**: 버그 발견 시 Sonnet에게 수정 지시
5. **통과 후 다음 기능 진행**

예시 (실제 대화 요약):
```
Brad: "티켓 목록 페이지에서 'Open', 'In Progress', 'Closed' 상태 필터 버튼을 추가해줘."
Sonnet: [코드 구현 완료]
Brad: [브라우저 테스트] "필터가 작동하지만, 'Closed' 클릭 시 UI가 깨짐."
Sonnet: [CSS 수정]
Brad: [재테스트] "통과! 다음 기능으로."
```

이 방식의 장점:
- **실제 사용자 관점 검증**: 단위 테스트로 놓칠 수 있는 UI/UX 문제 조기 발견
- **빠른 피드백 루프**: 브라우저 스냅샷을 통해 즉시 시각적 확인
- **자동화 없이도 품질 보장**: E2E 테스트 스크립트 없이도 실제 동작 검증

## 9.5시간 성과: 30개 기능, 20회 배포, 5000줄+ 코드

### 타임라인
- **0~2시간**: 프로젝트 초기화, DB 스키마 설계, 인증 시스템 구축
- **2~4시간**: 티켓 CRUD API, 웹챗 위젯 개발
- **4~6시간**: AI 자동응답 통합, 사용자 대시보드
- **6~8시간**: 자동화 규칙 엔진, SSE 실시간 알림
- **8~9.5시간**: 칸반 보드, SLA 추적, 최종 버그 수정

### 주요 기능 (30개)

#### 고객지원 기능
1. 웹챗 위젯 (실시간 채팅)
2. AI 자동응답 (gpt-4o-mini)
3. 티켓 생성/수정/삭제
4. 티켓 상태 워크플로우
5. 파일 첨부 (최대 10MB)
6. 내부 노트 작성
7. SLA 추적 (응답/해결 시간)
8. 고객 만족도 평가

#### 업무관리 기능
9. 칸반 보드 (드래그 앤 드롭)
10. 담당자 할당
11. 우선순위 설정 (Low/Medium/High/Urgent)
12. 태그 시스템
13. 전체 검색 (티켓 제목/내용)
14. 필터링 (상태/담당자/우선순위)

#### 자동화
15. 자동화 규칙 엔진 (조건 + 액션)
16. 자동 할당 (라운드로빈)
17. 자동 태그 추가
18. 이메일 알림
19. Slack 웹훅 통합

#### 관리자 기능
20. 사용자 관리
21. 팀 관리
22. 권한 설정 (RBAC)
23. 대시보드 (통계)
24. 활동 로그
25. API 키 관리

#### 시스템
26. JWT 인증
27. SSE 실시간 알림
28. WebSocket 채팅
29. Rate Limiting
30. 헬스체크 엔드포인트

### 코드 구조 (예시)

백엔드 컨트롤러 구조:
```java
@RestController
@RequestMapping("/api/tickets")
public class TicketController {
    
    private final TicketService ticketService;
    private final AIService aiService;
    
    @PostMapping
    public ResponseEntity<TicketDto> createTicket(@RequestBody CreateTicketRequest req) {
        // 티켓 생성 로직
        Ticket ticket = ticketService.create(req);
        
        // AI 자동응답 생성 (비동기)
        aiService.generateAutoResponse(ticket.getId());
        
        return ResponseEntity.ok(TicketDto.from(ticket));
    }
    
    @GetMapping
    public Page<TicketDto> listTickets(
        @RequestParam(required = false) TicketStatus status,
        Pageable pageable
    ) {
        // 필터링 + 페이징 조회
        return ticketService.findAll(status, pageable)
            .map(TicketDto::from);
    }
}
```

프론트엔드 컴포넌트 구조:
```typescript
// app/tickets/page.tsx
export default async function TicketsPage() {
  const tickets = await fetchTickets();
  
  return (
    <div>
      <TicketFilters />
      <TicketList tickets={tickets} />
    </div>
  );
}

// components/TicketList.tsx
'use client';
export function TicketList({ tickets }: { tickets: Ticket[] }) {
  return (
    <div className="space-y-4">
      {tickets.map(ticket => (
        <TicketCard key={ticket.id} ticket={ticket} />
      ))}
    </div>
  );
}
```

**참고**: 위 코드는 구조 설명용이며, 실제 비즈니스 로직과 AI 통합 세부 구현은 생략했습니다.

## 교훈: 에이전트만으로는 품질 보장 불가

### AI 에이전트의 한계

9.5시간 동안 AI 에이전트와 협업하며 깨달은 점:

1. **에이전트는 요구사항을 정확히 이해하지 못함**: "필터 추가"라고 하면 UI만 추가하고 백엔드 API는 안 건드는 경우 발생
2. **테스트 코드를 작성해도 실제 동작은 다름**: 단위 테스트는 통과하지만 통합 시 깨지는 경우 다수
3. **UI/UX 센스 부족**: 기능은 작동하지만 사용성이 떨어지는 UI 생성

### 브라우저 검증이 핵심

**AI 에이전트가 작성한 코드를 믿지 말고, 직접 브라우저로 확인하라.**

- `browser` 도구로 실제 웹사이트 접속
- 스냅샷 캡처로 시각적 확인
- 버튼 클릭, 폼 입력 등 실제 사용자 시나리오 테스트

이 과정에서 발견한 버그의 80%는 단위 테스트로는 잡을 수 없었던 **통합 이슈**였습니다.

### 인간의 역할: 아키텍트 + QA

AI 에이전트 시대에 개발자의 역할:
1. **아키텍처 설계**: 전체 시스템 구조를 설계하고 에이전트에게 모듈 단위로 할당
2. **품질 관리**: 브라우저 테스트로 실제 동작 검증 및 피드백
3. **최종 판단**: 에이전트가 제시한 여러 옵션 중 최선의 선택

코드 작성은 에이전트가, **의사결정은 인간이** 하는 구조가 가장 효율적이었습니다.

## 보안 및 프라이버시

### 보안 고려사항

- **인증/인가**: JWT 기반 인증, RBAC 권한 관리
- **API 키 관리**: 환경변수로 분리, 절대 코드에 하드코딩 금지
- **Rate Limiting**: 티켓 생성 API는 IP당 분당 10회 제한
- **XSS 방지**: 사용자 입력은 모두 sanitize 처리

**중요**: 이 글에서는 **실제 서버 정보, API 키, 도메인 등을 절대 공개하지 않습니다**. 예시는 모두 플레이스홀더입니다.

## 다음 단계

BreadDesk는 현재 **내부 테스트 단계**이며, 다음 기능들을 추가할 계획입니다:

- [ ] 다국어 지원 (i18n)
- [ ] 모바일 앱 (React Native)
- [ ] AI 답변 학습 (사용자 피드백 기반)
- [ ] Jira/GitHub 연동
- [ ] 음성 티켓 생성 (Whisper API)

또한 [Spring Boot 4 마이그레이션](/blog/spring-boot-4-spring-framework-7-whats-new)도 진행 예정입니다.

## 마무리

AI 에이전트는 **생산성을 10배 높여주는 도구**이지만, **품질을 보장하는 주체는 여전히 인간**입니다.

BreadDesk 개발을 통해 얻은 가장 큰 교훈은:
> "AI에게 코드를 맡기되, 브라우저로 직접 확인하라. 그리고 끊임없이 피드백하라."

9.5시간 만에 30개 기능을 만들 수 있었던 건, AI가 코딩을 대신 해줬기 때문이 아니라, **제가 올바른 방향을 제시하고 품질을 검증했기 때문**입니다.

AI 에이전트와의 협업, 여러분도 한번 시도해보세요. 생각보다 훨씬 더 많은 것을 만들어낼 수 있을 겁니다! 🚀
