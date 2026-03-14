---
title: '에이전트 팀으로 리듬게임을 하루만에 만든 이야기'
date: 2026-03-14 00:00:00
description: 'Claude Code 에이전트 팀(아키텍트, 백엔드, 프론트엔드, DevOps, QA 등 8개 역할)을 구성해서 웹 리듬게임 "Bread Rhythm"을 24시간 만에 개발하고 배포한 실제 경험을 공유합니다. React + Go + K8s 풀스택 개발 과정과 에이전트 협업 노하우를 담았습니다.'
featured_image: '/images/2026-03-14-Agent-Team-Rhythm-Game-One-Day/cover.jpg'
---

![에이전트 팀 협업](/images/2026-03-14-Agent-Team-Rhythm-Game-One-Day/cover.jpg)

## 하루만에 리듬게임? 가능합니다

"하루만에 웹 게임을 만들 수 있을까?" 이 질문에 대한 답을 찾기 위해 독특한 실험을 진행했습니다. 바로 **AI 에이전트 팀**을 구성해서 협업하는 방식이었죠. Claude Code를 활용해 8개 역할의 전문 에이전트를 배치하고, 마치 실제 스타트업 팀처럼 리듬게임 프로젝트를 진행했습니다.

결과는 성공적이었습니다. 24시간 만에 **"Bread Rhythm"** 이라는 웹 리듬게임이 탄생했고, 실제로 [rhythm.k6s.app](https://rhythm.k6s.app)에 배포되어 동작하고 있습니다. 이 글에서는 에이전트 팀을 어떻게 구성했는지, 어떤 과정을 거쳤는지, 그리고 어떤 교훈을 얻었는지 공유하려 합니다.

## 에이전트 팀 구성 전략

### 역할 분담이 핵심

전통적인 개발팀처럼 역할을 세분화했습니다. 각 에이전트는 명확한 책임 영역을 가지고 있었습니다:

**1. Solution Architect (솔루션 아키텍트)**
- 전체 시스템 설계 및 기술 스택 결정
- 프론트엔드-백엔드 인터페이스 설계
- 성능 및 확장성 고려사항 정리

**2. Backend Engineer (백엔드 엔지니어)**
- Go + Gin 프레임워크 기반 REST API 개발
- PostgreSQL 데이터 모델링
- Redis 캐싱 레이어 구현

**3. Frontend Engineer (프론트엔드 엔지니어)**
- React 19 + TypeScript 게임 UI 구현
- Canvas 기반 노트 렌더링 엔진
- Web Audio API를 이용한 오디오 싱크

**4. Game Developer (게임 개발자)**
- 판정 시스템 (Perfect/Great/Good/Miss)
- 콤보 및 스코어 계산 로직
- 비트맵 포맷 설계

**5. DevOps Engineer (데브옵스 엔지니어)**
- Kubernetes 매니페스트 작성
- CI/CD 파이프라인 구축 (GitHub Actions)
- Cilium Ingress 설정

**6. QA Engineer (QA 엔지니어)**
- 테스트 전략 수립 (Unit/Integration/E2E)
- Vitest, Playwright 테스트 작성
- 버그 리포트 및 리그레션 검증

**7. Tech Writer (기술 문서 작성자)**
- README, API 문서, 아키텍처 다이어그램
- 개발 가이드, 비트맵 차팅 가이드

**8. Project Manager (프로젝트 매니저)**
- 마일스톤 관리 및 우선순위 조율
- 브랜치 전략, 커밋 컨벤션 정립
- 팀 간 커뮤니케이션 조율

![아키텍처 설계](/images/2026-03-14-Agent-Team-Rhythm-Game-One-Day/architecture.jpg)

### 에이전트 팀의 장점

**병렬 작업이 가능합니다.**  
프론트엔드 개발과 백엔드 API 작성을 동시에 진행할 수 있습니다. 한 사람이 모든 걸 하는 것보다 훨씬 빠릅니다.

**전문성을 집중할 수 있습니다.**  
각 에이전트는 자기 영역에만 집중하므로, 컨텍스트 스위칭이 적고 코드 퀄리티가 높아집니다.

**24시간 작업이 가능합니다.**  
사람은 쉬어야 하지만, 에이전트는 잠들지 않습니다. 밤새도록 빌드-테스트-배포를 반복할 수 있죠.

## 프로젝트 타임라인: 24시간의 기록

### Hour 0-3: 설계 및 스캐폴딩

**Solution Architect**가 먼저 전체 시스템을 설계했습니다:
- 프론트엔드: React 19 + TypeScript + Vite
- 백엔드: Go 1.24 + Gin
- 데이터베이스: PostgreSQL 17 (유저, 비트맵, 스코어)
- 캐시: Redis 7 (리더보드)
- 배포: Kubernetes (openclaw 네임스페이스)

**Tech Writer**가 프로젝트 구조를 문서화했고, **Backend Engineer**와 **Frontend Engineer**가 동시에 스캐폴딩을 시작했습니다.

```bash
# 프로젝트 구조 (실제와 유사하게 추상화)
bread-rhythm/
├── cmd/server/          # Go 서버 엔트리포인트
├── internal/            # 백엔드 비즈니스 로직
│   ├── handler/         # HTTP 핸들러
│   ├── model/           # 데이터 모델
│   ├── repository/      # DB 레이어
│   └── service/         # 비즈니스 로직
├── frontend/            # React 프론트엔드
│   ├── src/game/        # 게임 엔진
│   └── src/components/  # UI 컴포넌트
└── deploy/              # K8s 매니페스트
```

### Hour 3-8: 코어 기능 개발

**Game Developer**가 판정 시스템과 스코어 계산 로직을 구현했습니다. 핵심은 타이밍 정확도에 따른 판정 구분이었습니다:

```typescript
// 판정 시스템 (구조만 표시, 세부 로직 생략)
enum Judgment {
  PERFECT = 'PERFECT',
  GREAT = 'GREAT',
  GOOD = 'GOOD',
  MISS = 'MISS'
}

interface JudgmentWindow {
  perfect: number;  // ±30ms
  great: number;    // ±60ms
  good: number;     // ±100ms
}

function calculateJudgment(timeDiff: number): Judgment {
  // 타이밍 차이에 따른 판정 계산 (세부 구현 생략)
}

function calculateScore(judgment: Judgment, combo: number): number {
  // 판정과 콤보에 따른 점수 계산 (세부 구현 생략)
}
```

**Frontend Engineer**는 Canvas 기반 노트 렌더링 엔진을 개발했습니다. 60fps 렌더링과 Web Audio API 동기화가 핵심이었죠.

**Backend Engineer**는 REST API 엔드포인트를 구현했습니다:
- `POST /api/auth/signup` - 회원가입
- `POST /api/auth/login` - 로그인 (JWT 발급)
- `GET /api/beatmaps` - 비트맵 목록
- `POST /api/scores` - 점수 제출
- `GET /api/leaderboard/:beatmapId` - 리더보드 조회

![게임플레이 화면](/images/2026-03-14-Agent-Team-Rhythm-Game-One-Day/gameplay.jpg)

### Hour 8-12: 테스트 및 디버깅

**QA Engineer**가 테스트 전략을 수립하고 Vitest 유닛 테스트를 작성했습니다:

```typescript
// 판정 시스템 테스트 예시 (구조만)
describe('Judgment System', () => {
  it('should return PERFECT for timing within ±30ms', () => {
    // 테스트 로직 (세부 구현 생략)
  });

  it('should reset combo on MISS', () => {
    // 테스트 로직 (세부 구현 생략)
  });
});
```

Playwright로 E2E 테스트도 작성했습니다:
- 게임 시작부터 노트 판정까지 전체 플레이 시나리오
- 롱노트(hold) 시나리오
- 콤보 리셋 검증

### Hour 12-18: 폴리싱 및 기능 추가

**Frontend Engineer**가 사용자 경험 개선에 집중했습니다:
- 난이도 3단계 (Easy/Normal/Hard)
- 히트 이펙트 애니메이션
- 모바일 터치 대응
- Safari 브라우저 호환성

**Backend Engineer**는 Redis 기반 리더보드 캐싱을 추가해 성능을 최적화했습니다.

### Hour 18-24: 배포 및 최종 점검

**DevOps Engineer**가 Kubernetes 배포를 진행했습니다:

```yaml
# 배포 설정 예시 (추상화, 실제 값 숨김)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bread-rhythm
  namespace: openclaw
spec:
  replicas: 2
  selector:
    matchLabels:
      app: bread-rhythm
  template:
    spec:
      containers:
      - name: app
        image: <REGISTRY>/bread-rhythm:latest
        ports:
        - containerPort: 8080
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: bread-rhythm-secrets
              key: db-url
```

Cilium Ingress를 통해 도메인 연결:
```yaml
# Ingress 설정 (추상화)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: bread-rhythm-ingress
spec:
  ingressClassName: cilium
  rules:
  - host: rhythm.k6s.app
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: bread-rhythm
            port:
              number: 80
```

![배포 인프라](/images/2026-03-14-Agent-Team-Rhythm-Game-One-Day/deployment.jpg)

## 현재 상태: v0.2.0

24시간 후, **Bread Rhythm v0.2.0**이 완성되었습니다:

### 주요 기능
- ✅ 4/6/8키 선택 가능
- ✅ 일반 노트(tap) + 롱노트(hold)
- ✅ 난이도 3단계 (Easy/Normal/Hard)
- ✅ 정밀 판정 시스템 (Perfect ±30ms / Great ±60ms / Good ±100ms)
- ✅ 콤보 시스템 및 스코어 계산
- ✅ 리더보드 (Redis 캐싱)
- ✅ 모바일 터치 지원
- ✅ Safari 브라우저 대응

### 기술 스택
- **Frontend:** React 19, TypeScript, Canvas, Web Audio API
- **Backend:** Go 1.24, Gin
- **Database:** PostgreSQL 17, Redis 7
- **Infra:** Kubernetes, Cilium Ingress
- **Testing:** Vitest, Playwright

### 배포
- URL: [rhythm.k6s.app](https://rhythm.k6s.app)
- 인프라: Kubernetes 클러스터 (고가용성 구성)
- CI/CD: GitHub Actions → 자동 배포

## 얻은 교훈

### 1. 명확한 역할 분담이 속도를 만든다

에이전트 팀의 가장 큰 장점은 **병렬 작업**입니다. 각자 맡은 영역에만 집중하므로 컨텍스트 스위칭이 줄어들고, 전문성이 높아집니다. 혼자 개발할 때보다 3~4배 빠른 속도를 낼 수 있었습니다.

### 2. 인터페이스 설계가 협업의 핵심

프론트엔드와 백엔드가 동시에 작업하려면, **API 계약**이 먼저 명확해야 합니다. Solution Architect가 초기에 OpenAPI 스펙을 작성한 덕분에, 두 팀이 독립적으로 작업할 수 있었습니다.

### 3. 테스트가 없으면 디버깅 지옥

QA Engineer가 초기부터 테스트를 작성한 덕분에, 리팩토링할 때 자신감이 생겼습니다. 특히 판정 시스템 같은 핵심 로직은 Vitest 유닛 테스트로 꼼꼼히 검증했습니다.

### 4. DevOps는 선택이 아니라 필수

배포 자동화가 없었다면 24시간 안에 끝내지 못했을 겁니다. Kubernetes + CI/CD 파이프라인 덕분에 코드 푸시 즉시 배포되어 테스트할 수 있었습니다.

### 5. 에이전트도 커뮤니케이션이 중요하다

Project Manager 역할이 각 에이전트 간 충돌을 조율했습니다. 예를 들어, Frontend가 필요한 API가 Backend에서 아직 구현 안 됐을 때, 우선순위를 조정해주는 역할이었죠.

## 한계와 개선점

### 현재 한계
- 비트맵(악보) 자동 생성 기능 없음 → 수동으로 JSON 작성 필요
- 멀티플레이 미지원
- 커스텀 스킨 기능 없음
- 모바일 환경에서 레이턴시 최적화 부족

### 다음 목표 (v0.3.0)
- AI 기반 비트맵 자동 생성 (오디오 분석 → 노트 배치)
- WebRTC 기반 실시간 대전 모드
- 커뮤니티 비트맵 업로드 및 공유
- 성능 최적화 (모바일 60fps 보장)

## 마치며

에이전트 팀으로 하루만에 리듬게임을 만든 경험은 정말 흥미로웠습니다. 혼자서는 절대 불가능했을 속도로 프로젝트가 진행되었고, 각 역할이 유기적으로 협업하는 모습을 보며 미래의 개발 방식을 엿본 것 같습니다.

물론 아직 완벽하지는 않습니다. 코드 퀄리티, 성능 최적화, 사용자 경험 등 개선할 점이 많습니다. 하지만 **"AI 에이전트 팀과 협업하면 무엇이 가능한가?"**라는 질문에 대한 답은 찾았습니다.

앞으로도 이 프로젝트를 계속 발전시켜 나갈 계획입니다. 여러분도 [rhythm.k6s.app](https://rhythm.k6s.app)에서 직접 플레이해보시고, 피드백을 주시면 감사하겠습니다!

## 참고 자료
- [Bread Rhythm 소스코드](https://github.com/developer-joon/bread-rhythm) (비공개)
- [Kubernetes 공식 문서](https://kubernetes.io/docs/)
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [React 19 릴리즈 노트](https://react.dev/blog/2024/12/05/react-19)
