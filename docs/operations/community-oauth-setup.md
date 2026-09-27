# GitHub OAuth 운영 설정

커뮤니티 브라우저 앱은 Supabase Auth의 GitHub 공급자와 PKCE 흐름을 사용합니다. 브라우저에는 Supabase **publishable key**만 배포하며, GitHub Client Secret이나 Supabase service-role key를 넣지 않습니다.

## 1. GitHub OAuth App

GitHub의 **Settings → Developer settings → OAuth Apps**에서 OAuth App을 만들고 다음 값을 설정합니다.

- Homepage URL: 운영 사이트 URL (예: `https://www.breadlab.ai/community/`)
- Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`

GitHub에 등록하는 callback은 커뮤니티 페이지가 아니라 **Supabase Auth endpoint**입니다. `<project-ref>`는 실제 Supabase 프로젝트 ref로 바꿉니다.

GitHub OAuth App의 Client ID와 Client Secret은 Supabase Dashboard의 **Authentication → Providers → GitHub**에만 저장하고 GitHub 공급자를 활성화합니다. 저장소, 정적 사이트, `.env` 브라우저 변수에 secret을 기록하지 않습니다.

## 2. Supabase URL Configuration

Supabase Dashboard의 **Authentication → URL Configuration**에서 Site URL을 운영 origin으로 설정하고 Redirect URLs allowlist에 앱 callback을 정확히 등록합니다.

- 운영: `https://www.breadlab.ai/community/auth/callback/`
- 스테이징: `https://<staging-host>/community/auth/callback/`
- 로컬 개발: `http://localhost:5173/community/auth/callback/`

실제로 사용하는 스테이징 host와 로컬 Vite 포트만 허용합니다. 광범위한 wildcard, 외부 origin, protocol-relative URL은 추가하지 않습니다. GitHub OAuth App의 callback(`https://<project-ref>.supabase.co/auth/v1/callback`)과 이 Supabase redirect allowlist는 서로 다른 설정입니다.

## 3. 브라우저 환경 변수

정적 앱에는 다음 공개 값만 제공합니다.

- Supabase project URL
- Supabase publishable key

GitHub Client Secret과 service-role key는 브라우저 번들에 절대 포함하지 않습니다. 앱은 `flowType: 'pkce'`, session persistence, 자동 refresh를 사용하고 `/community/auth/callback/`에서 authorization code를 한 번만 교환합니다.

## 4. 점검

1. 로그아웃 상태에서 GitHub 로그인을 시작합니다.
2. GitHub 승인 후 같은 origin의 `/community/auth/callback/`으로 돌아오는지 확인합니다.
3. 로그인 전 커뮤니티 상세 경로와 query가 로그인 후 복원되는지 확인합니다.
4. GitHub 공급자를 비활성화했을 때 한국어 안내가 표시되는지 확인합니다.
5. 세션 만료 또는 로그아웃 후 읽기는 계속 가능하고, 브라우저의 작성 draft가 유지되는지 확인합니다.
6. 애플리케이션 로그와 관측 도구에 OAuth code, access/refresh token, callback 전체 body를 기록하지 않는지 확인합니다.
