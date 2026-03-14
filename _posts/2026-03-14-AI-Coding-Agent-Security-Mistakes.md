---
title: 'AI 코딩 에이전트가 반복하는 10년 된 보안 실수'
date: 2026-03-14 00:00:00
description: 'AI 코딩 에이전트가 생성하는 코드의 보안 취약점 패턴 분석. SQL 인젝션, XSS, 하드코딩된 시크릿 등 AI가 반복하는 보안 실수와 개발자가 확인해야 할 체크리스트, AI 코드 보안을 높이는 실전 팁을 제공합니다.'
featured_image: '/images/2026-03-14-AI-Coding-Agent-Security-Mistakes/cover.jpg'
---

![AI 보안](/images/2026-03-14-AI-Coding-Agent-Security-Mistakes/cover.jpg)

2026년 3월 13일, Help Net Security는 충격적인 보고서를 발표했습니다. **"AI 코딩 에이전트가 10년 전 보안 실수를 반복하고 있다"**는 내용입니다. Cursor, Windsurf, GitHub Copilot 등 **AI 코딩 도구**가 개발 생산성을 2~3배 향상시키는 동안, 이들이 생성한 코드의 **보안 취약점**은 간과되고 있었습니다. 오늘은 AI 코딩 에이전트가 반복하는 보안 실수와 개발자가 반드시 확인해야 할 체크리스트, 그리고 AI 코드 보안을 높이는 실전 팁을 알아봅니다.

## 🚨 AI가 반복하는 대표 보안 실수

### 1. SQL 인젝션 — 가장 오래되고 위험한 취약점

SQL 인젝션은 **OWASP Top 10**에서 20년 넘게 1~3위를 차지한 고전적 취약점입니다. 하지만 AI 코딩 에이전트는 여전히 이 실수를 반복합니다.

**AI가 생성한 취약한 코드:**

```python
def get_user(username):
    query = f"SELECT * FROM users WHERE username = '{username}'"
    cursor.execute(query)
    return cursor.fetchone()
```

이 코드는 사용자 입력을 직접 SQL 쿼리에 삽입합니다. 공격자가 `username`에 `admin' OR '1'='1`을 입력하면 모든 사용자 정보가 노출됩니다.

**안전한 코드:**

```python
def get_user(username):
    query = "SELECT * FROM users WHERE username = ?"
    cursor.execute(query, (username,))
    return cursor.fetchone()
```

파라미터화된 쿼리(Parameterized Query)를 사용하면 사용자 입력이 SQL 명령어로 해석되지 않습니다.

### 2. XSS (Cross-Site Scripting) — 웹 앱의 고질병

XSS는 사용자 입력을 HTML에 직접 삽입하여 악성 스크립트를 실행하는 공격입니다. AI는 특히 **React, Vue 등 프론트엔드 프레임워크**에서 이 실수를 자주 범합니다.

**AI가 생성한 취약한 코드:**

```javascript
function displayMessage(userInput) {
  document.getElementById('message').innerHTML = userInput;
}
```

공격자가 `<script>alert('XSS')</script>`를 입력하면 즉시 실행됩니다.

**안전한 코드:**

```javascript
function displayMessage(userInput) {
  document.getElementById('message').textContent = userInput;
}
```

`textContent`는 입력을 텍스트로만 처리하여 스크립트 실행을 방지합니다.

### 3. 하드코딩된 시크릿 — API 키, 비밀번호 노출

AI는 예시 코드를 작성할 때 **API 키나 비밀번호를 하드코딩**하는 경향이 있습니다. 이는 GitHub에 푸시되는 순간 전 세계에 노출됩니다.

**AI가 생성한 취약한 코드:**

```python
API_KEY = "sk-1234567890abcdef"
DATABASE_PASSWORD = "admin123"

def connect_db():
    conn = psycopg2.connect(
        host="db.example.com",
        user="admin",
        password="admin123"
    )
    return conn
```

**안전한 코드:**

```python
import os

API_KEY = os.environ.get("API_KEY")
DATABASE_PASSWORD = os.environ.get("DATABASE_PASSWORD")

def connect_db():
    conn = psycopg2.connect(
        host=os.environ.get("DB_HOST"),
        user=os.environ.get("DB_USER"),
        password=DATABASE_PASSWORD
    )
    return conn
```

환경 변수나 AWS Secrets Manager, HashiCorp Vault 등을 사용해야 합니다.

### 4. 안전하지 않은 직렬화 (Insecure Deserialization)

Python의 `pickle`, Node.js의 `eval()` 등 직렬화 함수는 **임의 코드 실행(RCE)** 위험이 있습니다. AI는 이를 편의성 때문에 자주 사용합니다.

**AI가 생성한 취약한 코드:**

```python
import pickle

def load_user_session(session_data):
    return pickle.loads(session_data)
```

공격자가 악성 객체를 직렬화하여 전달하면 서버에서 임의 코드가 실행됩니다.

**안전한 코드:**

```python
import json

def load_user_session(session_data):
    return json.loads(session_data)
```

JSON은 데이터만 포함하며 코드를 포함할 수 없습니다.

### 5. 인증/인가 누락 — "일단 작동하게 만들자"

AI는 기능 구현에 집중하다 보니 **인증(Authentication)**과 **인가(Authorization)**를 누락하는 경우가 많습니다.

**AI가 생성한 취약한 코드:**

```python
@app.route('/admin/delete-user', methods=['POST'])
def delete_user():
    user_id = request.form['user_id']
    db.delete_user(user_id)
    return "User deleted"
```

누구나 이 엔드포인트를 호출하여 사용자를 삭제할 수 있습니다.

**안전한 코드:**

```python
@app.route('/admin/delete-user', methods=['POST'])
@login_required
@admin_only
def delete_user():
    user_id = request.form['user_id']
    db.delete_user(user_id)
    return "User deleted"
```

로그인 및 관리자 권한 확인을 추가해야 합니다.

## 🤔 왜 AI가 이런 실수를 하는가?

### 학습 데이터의 한계

AI 모델은 **GitHub, StackOverflow 등 공개 코드**를 학습합니다. 하지만 이 코드의 상당수는:

- **튜토리얼/예제 코드**: 빠른 이해를 위해 보안을 생략
- **레거시 코드**: 10년 전 보안 기준으로 작성됨
- **프로토타입 코드**: 보안보다 기능 검증이 목적

결과적으로 AI는 "작동하지만 안전하지 않은 코드"를 학습하게 됩니다.

### 보안 컨텍스트 부재

AI는 현재 코드가 **프로덕션 환경**인지 **로컬 테스트**인지 구분하지 못합니다. 예를 들어:

- 로컬 테스트에서는 `localhost`에 하드코딩된 비밀번호가 괜찮지만
- 프로덕션에서는 치명적입니다

AI는 이런 맥락을 이해하지 못하고 "일단 작동하는 코드"를 제안합니다.

### "편의성 > 보안" 우선순위

AI는 사용자가 빠르게 결과를 얻기를 원한다고 가정합니다. 따라서:

- 파라미터화된 쿼리보다 간단한 문자열 포매팅을 선호
- 환경 변수보다 하드코딩을 선호
- 복잡한 인증 로직보다 간단한 구현을 선호

개발자가 명시적으로 보안을 요구하지 않으면, AI는 편의성을 우선합니다.

## ✅ 개발자를 위한 AI 코드 리뷰 체크리스트

AI가 생성한 코드를 병합하기 전에 **반드시 확인**해야 할 항목들입니다.

### 입력 검증 (Input Validation)

- [ ] 사용자 입력이 직접 SQL 쿼리에 삽입되지 않는가?
- [ ] 사용자 입력이 HTML에 직접 삽입되지 않는가?
- [ ] 파일 업로드 시 확장자/크기 검증이 있는가?
- [ ] 입력값의 타입/범위가 검증되는가?

### 인증 및 인가 (Authentication & Authorization)

- [ ] API 엔드포인트마다 인증이 적용되어 있는가?
- [ ] 관리자 전용 기능에 권한 검증이 있는가?
- [ ] 세션/토큰 만료 처리가 구현되어 있는가?
- [ ] CSRF 토큰이 적용되어 있는가?

### 시크릿 관리 (Secrets Management)

- [ ] API 키, 비밀번호가 하드코딩되지 않았는가?
- [ ] 환경 변수 또는 시크릿 관리 도구를 사용하는가?
- [ ] 시크릿이 로그에 출력되지 않는가?
- [ ] `.env` 파일이 `.gitignore`에 포함되어 있는가?

### 암호화 및 해싱 (Encryption & Hashing)

- [ ] 비밀번호가 평문 저장되지 않는가? (bcrypt, argon2 사용)
- [ ] HTTPS가 적용되어 있는가?
- [ ] 민감한 데이터가 암호화되어 저장되는가?

### 에러 처리 (Error Handling)

- [ ] 에러 메시지에 내부 구조 정보가 노출되지 않는가?
- [ ] 스택 트레이스가 프로덕션에서 노출되지 않는가?
- [ ] 에러 발생 시 안전한 기본값으로 처리되는가?

### 의존성 보안 (Dependency Security)

- [ ] 사용하는 라이브러리에 알려진 취약점이 없는가?
- [ ] `npm audit`, `pip-audit` 등으로 검사했는가?
- [ ] 의존성 버전이 고정되어 있는가?

## 🛡️ AI 코드 보안을 높이는 실전 팁

### 1. 프롬프트 엔지니어링으로 보안 강화

AI에게 코드를 요청할 때 **보안 요구사항을 명시**하면 더 안전한 코드를 생성합니다.

**Before (일반 프롬프트):**
```
사용자 로그인 API를 만들어줘.
```

**After (보안 강화 프롬프트):**
```
사용자 로그인 API를 만들어줘. 다음 요구사항을 반드시 포함:
- 비밀번호는 bcrypt로 해싱
- SQL 인젝션 방지 (파라미터화된 쿼리)
- 로그인 실패 시 계정 잠금 (5회 실패 시 30분 잠금)
- JWT 토큰 발급 (만료 시간 1시간)
- 환경 변수로 시크릿 관리
```

이렇게 요청하면 AI는 보안 요구사항을 고려한 코드를 생성합니다.

### 2. SAST 도구 연동

**SAST (Static Application Security Testing)** 도구는 코드를 실행하지 않고 취약점을 찾습니다.

| 언어 | 추천 도구 | 특징 |
|------|-----------|------|
| Python | Bandit | 일반적인 보안 패턴 검사 |
| JavaScript | ESLint Security | XSS, 위험한 함수 검출 |
| Java | SpotBugs | 널 참조, 리소스 누수 검출 |
| Go | gosec | Go 특화 보안 이슈 검출 |
| 다중 언어 | SonarQube | 상용급 정적 분석 |

**CI/CD 파이프라인에 통합:**

```yaml
# .github/workflows/security.yml
name: Security Scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Bandit
        run: |
          pip install bandit
          bandit -r . -f json -o bandit-report.json
      - name: Upload report
        uses: actions/upload-artifact@v2
        with:
          name: bandit-report
          path: bandit-report.json
```

### 3. 린터와 보안 규칙 적용

ESLint, Pylint 등 린터에 보안 규칙을 추가하면 AI 코드를 자동으로 검증할 수 있습니다.

**ESLint 보안 플러그인 예시:**

```javascript
// .eslintrc.js
module.exports = {
  plugins: ['security'],
  extends: ['plugin:security/recommended'],
  rules: {
    'security/detect-eval-with-expression': 'error',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-unsafe-regex': 'error'
  }
};
```

### 4. AI 코드에 보안 주석 추가 요청

AI에게 **보안 관련 주석**을 함께 생성하도록 요청하면, 나중에 리뷰할 때 보안 포인트를 쉽게 파악할 수 있습니다.

**프롬프트 예시:**
```
사용자 등록 API를 만들어줘. 각 보안 관련 코드에 주석을 추가해서 왜 그렇게 구현했는지 설명해줘.
```

**AI 생성 코드:**

```python
@app.route('/register', methods=['POST'])
def register():
    username = request.form['username']
    password = request.form['password']
    
    # 보안: SQL 인젝션 방지를 위해 파라미터화된 쿼리 사용
    cursor.execute(
        "SELECT * FROM users WHERE username = ?",
        (username,)
    )
    
    if cursor.fetchone():
        return "Username already exists", 400
    
    # 보안: 비밀번호를 평문 저장하지 않고 bcrypt로 해싱
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
    
    # 보안: 파라미터화된 쿼리로 삽입
    cursor.execute(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        (username, hashed)
    )
    
    return "Registration successful"
```

### 5. 코드 리뷰에 보안 전문가 포함

AI가 생성한 코드는 **반드시 인간 리뷰**를 거쳐야 합니다. 특히:

- **결제/인증 관련 코드**: 보안팀 리뷰 필수
- **데이터베이스 접근 코드**: SQL 인젝션 검증
- **외부 API 연동 코드**: 시크릿 관리 확인

GitHub에서는 **CODEOWNERS** 파일로 특정 경로에 대한 리뷰어를 지정할 수 있습니다:

```
# CODEOWNERS
/auth/*          @security-team
/payment/*       @security-team @finance-team
/api/admin/*     @security-team @lead-developers
```

## 📊 AI 코딩 도구별 보안 기능 비교

2026년 3월 기준 주요 AI 코딩 도구의 보안 기능을 비교했습니다.

| 도구 | 보안 스캔 | 취약점 경고 | SAST 연동 | 보안 프롬프트 |
|------|-----------|-------------|-----------|---------------|
| **Windsurf** | ⭐⭐⭐ | ✅ | ✅ (SonarQube) | ⭐⭐⭐ |
| **Cursor** | ⭐⭐ | ✅ | ✅ (ESLint) | ⭐⭐ |
| **Claude Code** | ⭐⭐⭐ | ✅ | ❌ | ⭐⭐⭐ |
| **GitHub Copilot** | ⭐ | ✅ | ✅ (CodeQL) | ⭐ |
| **VS Code AI** | ⭐⭐ | ⚠️ (제한적) | ✅ (확장으로) | ⭐ |

- **보안 스캔**: AI가 생성한 코드를 즉시 스캔하는 기능
- **취약점 경고**: 알려진 취약점 패턴을 감지하여 경고
- **SAST 연동**: 정적 분석 도구와의 통합 지원
- **보안 프롬프트**: 보안 요구사항을 프롬프트로 전달했을 때 반영 정도

**Windsurf**와 **Claude Code**가 보안 측면에서 가장 강력하며, **GitHub Copilot**은 CodeQL 연동으로 엔터프라이즈 환경에서 유리합니다.

## 🎯 마무리: AI 코드는 "초안"이지 "완성본"이 아니다

AI 코딩 에이전트가 생성한 코드는 **생산성 향상 도구**이지, **보안 검증이 완료된 코드**가 아닙니다. 개발자는 AI 코드를:

1. **항상 리뷰**해야 하며
2. **보안 체크리스트**로 검증하고
3. **SAST 도구**로 스캔하고
4. **인간 리뷰어**의 승인을 받아야 합니다

AI 코딩 도구는 "코드를 대신 작성하는 도구"가 아니라 **"초안을 빠르게 작성해주는 보조 도구"**로 접근해야 합니다. 최종 책임은 언제나 개발자에게 있습니다.

### 실천 가이드

**오늘부터 시작할 수 있는 3가지:**

1. **CI/CD에 SAST 도구 추가** — 5분이면 설정 가능
2. **AI 프롬프트에 보안 요구사항 명시** — 즉시 적용 가능
3. **주간 코드 리뷰에 보안 항목 추가** — 체크리스트 활용

**다음 달까지 구축할 것:**

1. GitHub CODEOWNERS로 보안 관련 경로에 리뷰어 지정
2. 팀 내 보안 가이드라인 문서 작성 (AI 코드 리뷰 기준 포함)
3. 의존성 취약점 자동 스캔 (Dependabot, Snyk 등)

AI 코딩 도구의 시대, 보안은 선택이 아닌 **필수**입니다.

---

**참고 자료:**
- [Help Net Security — AI Coding Agents Keep Repeating Decade-Old Security Mistakes](https://helpnetsecurity.com) (2026-03-13)
- [OWASP Top 10 2025](https://owasp.org/www-project-top-ten/)
- [NIST Secure Software Development Framework](https://csrc.nist.gov/projects/ssdf)
