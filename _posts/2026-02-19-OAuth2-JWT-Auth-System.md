---
title: 'OAuth 2.0과 JWT로 안전한 인증 시스템 구축하기: PKCE·Spring Security 통합 심화 가이드'
date: 2026-02-19 00:00:00
description: 'OAuth 2.0 Authorization Code·PKCE 플로우부터 JWT 구조, 리프레시 토큰, Spring Security 연동, 보안 베스트 프랙티스까지 안전한 인증 시스템 구현 단계를 실전 코드와 함께 분석합니다.'
featured_image: '/images/2026-02-19-OAuth2-JWT-Auth-System/cover.jpg'
---

![OAuth 2.0 인증 시스템 아키텍처](/images/2026-02-19-OAuth2-JWT-Auth-System/cover.jpg)

현대 웹 서비스에서 **인증(Authentication)**과 **인가(Authorization)**는 가장 기본이면서도 가장 실수하기 쉬운 영역입니다. OAuth 2.0은 업계 표준 인가 프레임워크로, Google, GitHub, Kakao 등 대부분의 플랫폼이 채택하고 있습니다. 이 글에서는 OAuth 2.0의 핵심 플로우부터 JWT 토큰 설계, 리프레시 토큰 전략, 그리고 **Spring Security와의 실전 연동**까지 체계적으로 살펴보겠습니다.

## OAuth 2.0 핵심 개념과 플로우 이해하기

OAuth 2.0은 사용자의 비밀번호를 직접 다루지 않고, **토큰 기반으로 리소스 접근 권한을 위임**하는 프레임워크입니다.

### OAuth 2.0의 4가지 역할

| 역할 | 설명 | 예시 |
|------|------|------|
| Resource Owner | 리소스 소유자(사용자) | 카카오 계정 사용자 |
| Client | 리소스 접근을 요청하는 애플리케이션 | 내 서비스 웹앱 |
| Authorization Server | 인증/인가를 처리하고 토큰 발급 | 카카오 인증 서버 |
| Resource Server | 보호된 리소스를 제공 | 카카오 API 서버 |

### Authorization Code Grant 플로우

가장 안전하고 널리 사용되는 방식입니다. 서버 사이드 애플리케이션에 적합합니다.

```
1. 사용자 → 클라이언트: "카카오로 로그인" 클릭
2. 클라이언트 → 인증 서버: 인가 코드 요청 (redirect)
   GET /oauth/authorize?
     response_type=code&
     client_id=YOUR_CLIENT_ID&
     redirect_uri=YOUR_CALLBACK_URL&
     scope=profile_nickname,account_email&
     state=random_csrf_token

3. 사용자 → 인증 서버: 로그인 및 권한 동의
4. 인증 서버 → 클라이언트: 인가 코드 전달 (redirect)
   GET /callback?code=AUTHORIZATION_CODE&state=random_csrf_token

5. 클라이언트 → 인증 서버: 인가 코드로 토큰 교환 (서버 간 통신)
   POST /oauth/token
     grant_type=authorization_code&
     code=AUTHORIZATION_CODE&
     client_id=YOUR_CLIENT_ID&
     client_secret=YOUR_CLIENT_SECRET&
     redirect_uri=YOUR_CALLBACK_URL

6. 인증 서버 → 클라이언트: Access Token + Refresh Token 발급
```

![OAuth 2.0 인가 코드 플로우 다이어그램](/images/2026-02-19-OAuth2-JWT-Auth-System/oauth-flow.jpg)

### PKCE(Proof Key for Code Exchange)란 무엇인가?

SPA(Single Page Application)나 모바일 앱처럼 **client_secret을 안전하게 보관할 수 없는 환경**에서는 PKCE가 필수입니다. OAuth 2.1에서는 모든 클라이언트에 PKCE 적용을 권장합니다.

```java
@Component
public class PkceGenerator {

    public String generateCodeVerifier() {
        byte[] randomBytes = new byte[32];
        new SecureRandom().nextBytes(randomBytes);
        return Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(randomBytes);
    }

    public String generateCodeChallenge(String codeVerifier) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(
                codeVerifier.getBytes(StandardCharsets.US_ASCII)
            );
            return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not supported", e);
        }
    }
}
```

PKCE 플로우의 핵심:
1. 클라이언트가 `code_verifier`(비밀값)를 생성하고 `code_challenge`(해시값)를 인증 서버에 전달
2. 토큰 교환 시 원본 `code_verifier`를 전송
3. 인증 서버가 `code_verifier`를 해싱하여 `code_challenge`와 비교 → 검증 완료

## JWT(JSON Web Token) 구조와 설계 전략

JWT는 자체적으로 정보를 담고 있는 **자기 포함형(self-contained) 토큰**입니다. 서버가 별도의 세션 저장소 없이 토큰만으로 사용자를 식별할 수 있습니다.

### JWT의 3가지 구성 요소

```
eyJhbGciOiJSUzI1NiJ9.          ← Header (알고리즘, 타입)
eyJzdWIiOiIxMjM0NTY3ODkwIn0.   ← Payload (클레임)
SflKxwRJSMeKKF2QT4fwpM...      ← Signature (서명)
```

```java
@Component
@RequiredArgsConstructor
public class JwtTokenProvider {

    @Value("${jwt.secret}")
    private String secretKey;

    @Value("${jwt.access-token-validity}")
    private long accessTokenValidity;

    @Value("${jwt.refresh-token-validity}")
    private long refreshTokenValidity;

    private Key key;

    @PostConstruct
    protected void init() {
        byte[] keyBytes = Decoders.BASE64.decode(secretKey);
        this.key = Keys.hmacShaKeyFor(keyBytes);
    }

    public String createAccessToken(UserPrincipal user) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + accessTokenValidity);

        return Jwts.builder()
            .setSubject(user.getId().toString())
            .claim("email", user.getEmail())
            .claim("roles", user.getRoles())
            .claim("type", "access")
            .setIssuedAt(now)
            .setExpiration(expiry)
            .signWith(key, SignatureAlgorithm.HS512)
            .compact();
    }

    public String createRefreshToken(Long userId) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + refreshTokenValidity);

        return Jwts.builder()
            .setSubject(userId.toString())
            .claim("type", "refresh")
            .setIssuedAt(now)
            .setExpiration(expiry)
            .signWith(key, SignatureAlgorithm.HS512)
            .compact();
    }

    public Claims validateAndGetClaims(String token) {
        return Jwts.parserBuilder()
            .setSigningKey(key)
            .build()
            .parseClaimsJws(token)
            .getBody();
    }

    public boolean isTokenValid(String token) {
        try {
            validateAndGetClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
}
```

### JWT 클레임 설계 시 주의사항

```java
// ❌ 나쁜 예: 민감 정보를 Payload에 넣기
Jwts.builder()
    .claim("password", user.getPassword())  // 절대 금지!
    .claim("ssn", user.getSsn())            // 개인정보 금지!

// ✅ 좋은 예: 최소한의 식별 정보만
Jwts.builder()
    .setSubject(user.getId().toString())
    .claim("roles", user.getRoles())
    .claim("type", "access")
```

**핵심 원칙**: JWT Payload는 Base64로 디코딩하면 누구나 읽을 수 있습니다. 서명은 **위변조 방지**를 위한 것이지, **암호화가 아닙니다**.

## 리프레시 토큰 전략: 안전한 토큰 갱신 설계

Access Token의 수명은 짧게(15~30분), Refresh Token은 길게(7~14일) 설정하는 것이 일반적입니다.

### RTR(Refresh Token Rotation) 패턴

리프레시 토큰 사용 시마다 새 토큰을 발급하고, 이전 토큰은 폐기하는 패턴입니다.

```java
@Service
@RequiredArgsConstructor
@Transactional
public class AuthService {

    private final JwtTokenProvider jwtTokenProvider;
    private final RefreshTokenRepository refreshTokenRepository;
    private final UserRepository userRepository;

    public TokenResponse login(LoginRequest request) {
        User user = userRepository.findByEmail(request.getEmail())
            .orElseThrow(() -> new AuthException("잘못된 이메일 또는 비밀번호"));

        if (!passwordEncoder.matches(request.getPassword(),
                                      user.getPassword())) {
            throw new AuthException("잘못된 이메일 또는 비밀번호");
        }

        UserPrincipal principal = UserPrincipal.from(user);
        String accessToken = jwtTokenProvider.createAccessToken(principal);
        String refreshToken = jwtTokenProvider.createRefreshToken(user.getId());

        refreshTokenRepository.save(RefreshToken.builder()
            .userId(user.getId())
            .tokenHash(hashToken(refreshToken))
            .expiresAt(Instant.now().plus(14, ChronoUnit.DAYS))
            .build());

        return new TokenResponse(accessToken, refreshToken);
    }

    public TokenResponse refresh(String refreshToken) {
        Claims claims = jwtTokenProvider.validateAndGetClaims(refreshToken);
        Long userId = Long.parseLong(claims.getSubject());

        String tokenHash = hashToken(refreshToken);
        RefreshToken stored = refreshTokenRepository
            .findByUserIdAndTokenHash(userId, tokenHash)
            .orElseThrow(() -> {
                // 탈취 감지: 이미 사용된 토큰으로 접근 시도
                refreshTokenRepository.deleteAllByUserId(userId);
                return new AuthException("토큰 재사용 감지 - 모든 세션 종료");
            });

        refreshTokenRepository.delete(stored);

        User user = userRepository.findById(userId).orElseThrow();
        UserPrincipal principal = UserPrincipal.from(user);
        String newAccessToken = jwtTokenProvider.createAccessToken(principal);
        String newRefreshToken = jwtTokenProvider.createRefreshToken(userId);

        refreshTokenRepository.save(RefreshToken.builder()
            .userId(userId)
            .tokenHash(hashToken(newRefreshToken))
            .expiresAt(Instant.now().plus(14, ChronoUnit.DAYS))
            .build());

        return new TokenResponse(newAccessToken, newRefreshToken);
    }

    public void logout(Long userId, String refreshToken) {
        String tokenHash = hashToken(refreshToken);
        refreshTokenRepository.deleteByUserIdAndTokenHash(userId, tokenHash);
    }

    private String hashToken(String token) {
        return DigestUtils.sha256Hex(token);
    }
}
```

### 토큰 블랙리스트 (Access Token 즉시 무효화)

JWT는 Stateless하므로 발급 후 서버에서 직접 무효화할 수 없습니다. 로그아웃이나 비밀번호 변경 시 기존 Access Token을 무효화하려면 **블랙리스트**가 필요합니다.

```java
@Service
@RequiredArgsConstructor
public class TokenBlacklistService {

    private final RedisTemplate<String, String> redisTemplate;
    private static final String BLACKLIST_PREFIX = "token:blacklist:";

    public void blacklist(String token, long remainingTtlMs) {
        String key = BLACKLIST_PREFIX + hashToken(token);
        redisTemplate.opsForValue().set(
            key, "1",
            Duration.ofMillis(remainingTtlMs)
        );
    }

    public boolean isBlacklisted(String token) {
        String key = BLACKLIST_PREFIX + hashToken(token);
        return Boolean.TRUE.equals(redisTemplate.hasKey(key));
    }

    private String hashToken(String token) {
        return DigestUtils.sha256Hex(token);
    }
}
```

## Spring Security와 OAuth 2.0 + JWT 통합하기

![Spring Security 인증 필터 체인](/images/2026-02-19-OAuth2-JWT-Auth-System/security.jpg)

### Security 설정

```java
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthFilter;
    private final OAuth2UserService oAuth2UserService;
    private final OAuth2SuccessHandler oAuth2SuccessHandler;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http)
            throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**", "/oauth2/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .oauth2Login(oauth2 -> oauth2
                .userInfoEndpoint(userInfo ->
                    userInfo.userService(oAuth2UserService))
                .successHandler(oAuth2SuccessHandler)
            )
            .addFilterBefore(jwtAuthFilter,
                UsernamePasswordAuthenticationFilter.class)
            .build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

### JWT 인증 필터

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider jwtTokenProvider;
    private final TokenBlacklistService blacklistService;
    private final UserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain)
            throws ServletException, IOException {

        String token = resolveToken(request);

        if (token != null && jwtTokenProvider.isTokenValid(token)
                && !blacklistService.isBlacklisted(token)) {

            Claims claims = jwtTokenProvider.validateAndGetClaims(token);
            String userId = claims.getSubject();

            UserDetails userDetails =
                userDetailsService.loadUserByUsername(userId);

            UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                    userDetails, null, userDetails.getAuthorities()
                );
            authentication.setDetails(
                new WebAuthenticationDetailsSource()
                    .buildDetails(request)
            );

            SecurityContextHolder.getContext()
                .setAuthentication(authentication);
        }

        filterChain.doFilter(request, response);
    }

    private String resolveToken(HttpServletRequest request) {
        String bearer = request.getHeader("Authorization");
        if (StringUtils.hasText(bearer) && bearer.startsWith("Bearer ")) {
            return bearer.substring(7);
        }
        return null;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getServletPath();
        return path.startsWith("/api/auth/")
            || path.startsWith("/oauth2/");
    }
}
```

### OAuth 2.0 소셜 로그인 처리

```java
@Service
@RequiredArgsConstructor
public class CustomOAuth2UserService
        extends DefaultOAuth2UserService {

    private final UserRepository userRepository;

    @Override
    public OAuth2User loadUser(OAuth2UserRequest request)
            throws OAuth2AuthenticationException {

        OAuth2User oAuth2User = super.loadUser(request);
        String provider = request.getClientRegistration()
            .getRegistrationId();

        OAuth2UserInfo userInfo =
            OAuth2UserInfoFactory.create(provider,
                oAuth2User.getAttributes());

        User user = userRepository
            .findByProviderAndProviderId(provider, userInfo.getId())
            .map(existing -> existing.updateProfile(
                userInfo.getName(), userInfo.getImageUrl()))
            .orElseGet(() -> userRepository.save(User.builder()
                .email(userInfo.getEmail())
                .name(userInfo.getName())
                .profileImage(userInfo.getImageUrl())
                .provider(provider)
                .providerId(userInfo.getId())
                .role(Role.USER)
                .build()));

        return UserPrincipal.create(user, oAuth2User.getAttributes());
    }
}

@Component
@RequiredArgsConstructor
public class OAuth2SuccessHandler
        extends SimpleUrlAuthenticationSuccessHandler {

    private final JwtTokenProvider jwtTokenProvider;
    private final AuthService authService;

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request,
                                         HttpServletResponse response,
                                         Authentication authentication)
            throws IOException {

        UserPrincipal principal =
            (UserPrincipal) authentication.getPrincipal();

        String accessToken =
            jwtTokenProvider.createAccessToken(principal);
        String refreshToken =
            jwtTokenProvider.createRefreshToken(principal.getId());

        authService.saveRefreshToken(principal.getId(), refreshToken);

        String targetUrl = UriComponentsBuilder
            .fromUriString("YOUR_FRONTEND_URL/oauth/callback")
            .queryParam("token", accessToken)
            .build().toUriString();

        getRedirectStrategy().sendRedirect(request, response, targetUrl);
    }
}
```

### application.yml OAuth 2.0 설정

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          google:
            client-id: ${GOOGLE_CLIENT_ID}
            client-secret: ${GOOGLE_CLIENT_SECRET}
            scope: profile, email
          kakao:
            client-id: ${KAKAO_CLIENT_ID}
            client-secret: ${KAKAO_CLIENT_SECRET}
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            authorization-grant-type: authorization_code
            client-authentication-method: client_secret_post
            scope: profile_nickname, account_email
          github:
            client-id: ${GITHUB_CLIENT_ID}
            client-secret: ${GITHUB_CLIENT_SECRET}
            scope: user:email, read:user
        provider:
          kakao:
            authorization-uri: https://kauth.kakao.com/oauth/authorize
            token-uri: https://kauth.kakao.com/oauth/token
            user-info-uri: https://kapi.kakao.com/v2/user/me
            user-name-attribute: id
```

## 보안 베스트 프랙티스: 실전 체크리스트

### 1. HTTPS 필수

모든 토큰 전송은 반드시 HTTPS 위에서 이루어져야 합니다. HTTP에서 토큰이 전송되면 중간자 공격(MITM)에 취약합니다.

### 2. 토큰 저장 위치

```javascript
// ❌ localStorage (XSS에 취약)
localStorage.setItem('accessToken', token);

// ✅ httpOnly, Secure 쿠키 (XSS로 접근 불가)
// 서버에서 설정
```

```java
public void setRefreshTokenCookie(HttpServletResponse response,
                                   String refreshToken) {
    ResponseCookie cookie = ResponseCookie.from("refreshToken", refreshToken)
        .httpOnly(true)
        .secure(true)
        .sameSite("Strict")
        .path("/api/auth")
        .maxAge(Duration.ofDays(14))
        .build();
    response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
}
```

### 3. CORS 설정

```java
@Bean
public CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOrigins(List.of("YOUR_FRONTEND_DOMAIN"));
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
    config.setAllowedHeaders(List.of("*"));
    config.setAllowCredentials(true);
    config.setMaxAge(3600L);

    UrlBasedCorsConfigurationSource source =
        new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", config);
    return source;
}
```

### 4. Rate Limiting으로 무차별 공격 방지

```java
@Component
@RequiredArgsConstructor
public class LoginRateLimiter {

    private final RedisTemplate<String, String> redisTemplate;
    private static final int MAX_ATTEMPTS = 5;
    private static final Duration WINDOW = Duration.ofMinutes(15);

    public void checkAndIncrement(String identifier) {
        String key = "login:attempts:" + identifier;
        Long attempts = redisTemplate.opsForValue().increment(key);

        if (attempts == 1) {
            redisTemplate.expire(key, WINDOW);
        }

        if (attempts > MAX_ATTEMPTS) {
            throw new TooManyRequestsException(
                "로그인 시도 횟수 초과. " +
                WINDOW.toMinutes() + "분 후 다시 시도해주세요."
            );
        }
    }

    public void resetAttempts(String identifier) {
        redisTemplate.delete("login:attempts:" + identifier);
    }
}
```

### 5. 보안 점검 체크리스트

| 항목 | 설명 |
|------|------|
| Access Token 만료 시간 | ≤ 30분 |
| Refresh Token 저장 | httpOnly 쿠키 |
| HTTPS | 모든 토큰 전송에 필수 |
| CORS | 허용 도메인 제한 |
| JWT Payload | 민감 정보 미포함 |
| 로그인 시도 제한 | Rate Limiting 적용 |
| RTR | Refresh Token Rotation 적용 |
| 블랙리스트 | 로그아웃 시 토큰 무효화 |
| PKCE | SPA/모바일에 필수 |
| state 파라미터 | CSRF 방지 |

## 마무리: OAuth 2.0과 JWT 인증 시스템 설계 요약

OAuth 2.0과 JWT를 활용한 인증 시스템은 올바르게 구현하면 확장 가능하고 안전한 구조를 만들 수 있습니다. 핵심을 정리하면:

1. **Authorization Code + PKCE**: 모든 클라이언트 유형에서 안전한 인가 플로우
2. **JWT 최소 정보 원칙**: Payload에는 식별 정보만, 민감 정보 절대 금지
3. **짧은 Access Token + RTR**: 보안과 사용성의 최적 균형
4. **httpOnly 쿠키**: XSS 공격으로부터 토큰 보호
5. **Redis 블랙리스트**: Stateless JWT의 즉시 무효화 보완
6. **Rate Limiting**: 무차별 대입 공격 차단

인증은 "한 번 만들면 끝"이 아닙니다. 보안 위협은 계속 진화하므로, 정기적인 보안 점검과 업데이트가 필수입니다.

---

## 참고 자료

- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [OAuth 2.1 Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-07)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [JWT RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)
- [Spring Security OAuth 2.0 공식 문서](https://docs.spring.io/spring-security/reference/servlet/oauth2/index.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
