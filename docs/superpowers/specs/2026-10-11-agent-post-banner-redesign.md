# 2026-10-11 AI 에이전트 포스트 배너 재설계

## 목표

오늘 게시한 AI 에이전트 운영 포스트 10편의 배너를 교체한다. 기존 이미지는 동일한 추상 템플릿에 색과 노드 위치만 바꿔 글의 주제를 전달하지 못하고, 오른쪽 사각형이 로딩 실패 또는 검열된 콘텐츠처럼 보인다.

새 배너는 각 글을 목록에서 즉시 구분할 수 있고, 전문 기술 블로그의 에디토리얼 인포그래픽처럼 보여야 한다.

## 범위

- 기존 PNG 10개를 같은 경로에서 교체한다.
- 각 이미지는 1600×900 RGB PNG다.
- 포스트 front matter와 본문 이미지 경로는 변경하지 않는다.
- 외부 사진·일러스트를 사용하지 않는다.
- 배포용 파일에는 생성 도구나 임시 폰트를 포함하지 않는다.

## 시각 시스템

- 배경: 짙은 네이비 계열의 저채도 그라디언트
- 텍스트: 흰색·회색, 주제별 accent 한 색
- 상단: `AI AGENT OPERATIONS · 01/10` 형식의 시리즈 표시
- 좌측: 두 줄 이내의 한국어 제목과 한 줄 부제
- 우측: 글의 고유 논지를 나타내는 구조도
- 하단: `breadlab.ai · 2026` 식별자와 짧은 키워드
- 제목과 핵심 도식은 중앙 80% 안전 영역에 배치해 카드·모바일 크롭에 견딘다.
- 장식보다 위계와 의미 전달을 우선한다. 광택, 과도한 네온, 의미 없는 노드는 사용하지 않는다.

## 포스트별 시각 은유

1. **개발자 설문과 프로덕션 신뢰 격차**
   - `73%`와 `19.9%` 막대, 그 사이의 승인 게이트
2. **에이전트 샌드박스 4계층 경계**
   - 중첩된 네 개의 보안 경계와 차단된 egress
3. **Dogwood Temporal Policy**
   - 시간축 위의 요청 이벤트와 정책 체크포인트
4. **Postman Agent Mode의 Context·Tool Budget**
   - Context 입력과 Tool 호출이 제한된 예산 게이지로 수렴
5. **AI Agent Token Identity Propagation**
   - 사용자 identity가 AgentCore·Lambda·STS·데이터 계층을 통과하는 경로
6. **Draft PR과 리뷰 수용량 병목**
   - 다수 PR이 제한 게이트와 reviewer queue에서 병목되는 흐름
7. **AI Software Factory 작업 분해**
   - Issue에서 Reproduce·Implement·Backport·Merge로 이어지는 작업 lane
8. **AI-native Platform Engineering**
   - Actor·Accelerator·Autonomy를 연결하는 platform control plane
9. **Cloud/Local Model Routing**
   - Policy router가 민감도와 가역성에 따라 Cloud·Local로 분기
10. **Solo Organization**
    - 한 명의 운영자가 여러 agent를 조정하되 승인 게이트를 유지하는 허브 구조

## 제작 방식

- Python/Pillow 기반 결정론적 raster generator를 임시 작업공간에서 사용한다.
- 한국어는 OFL 라이선스의 Noto Sans KR을 사용한다.
- 모든 도형과 도식은 직접 생성한다.
- 생성 결과만 저장소의 기존 PNG 경로에 반영한다.

## 검증

1. 기존 배너와 새 배너의 perceptual 차이를 확인한다.
2. 10개 이미지를 contact sheet로 만들어 한 번에 비교한다.
3. 각 이미지를 개별 시각 검수한다.
4. 크기 1600×900, PNG/RGB, 파일별 해시 차이, 완전 중복 부재를 검사한다.
5. 제목이 파일별 기대 문자열과 일치하고 안전 영역을 벗어나지 않는지 generator assertion으로 확인한다.
6. 포스트의 `featured_image`와 첫 본문 이미지가 기존 경로를 유지하는지 검사한다.
7. Docker 기반 Jekyll build와 artifact verifier를 실행한다.
8. 변경 브랜치를 push하고 PR을 만든 뒤 merge한다.
9. GitHub Pages 배포 완료 후 운영 이미지의 해시와 화면을 다시 검증한다.

## 완료 기준

- 10개 배너가 동일 placeholder 템플릿으로 보이지 않는다.
- 각 배너만 보고도 대응하는 글의 주제를 구분할 수 있다.
- 오른쪽의 의미 없는 검은 카드와 로딩 스켈레톤 인상이 사라진다.
- 로컬·빌드 artifact·운영 이미지가 동일한 새 PNG를 제공한다.
- 작업용 서버와 임시 프로세스는 종료된다.
