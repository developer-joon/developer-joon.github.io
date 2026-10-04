# 개발 Supabase Dashboard SQL 부트스트랩

이 절차는 **한 번만**, 비어 있는 개발 프로젝트에 사용한다.

> **프로덕션 프로젝트에서는 실행 금지.** Dashboard 상단의 프로젝트 이름이 `breadlab-community-development`이고 Project ref가 `giuxonxvuqrdnmjwvhvt`로 끝나는지 직접 확인한다. SQL 자체로 Project ref를 암호학적으로 확인할 수 없다.

## 실행 전

```bash
node scripts/generate-development-bootstrap.mjs
node scripts/generate-development-bootstrap.mjs --check
```

실행 파일은 `supabase/bootstrap/development-dashboard.sql`이다. 이 파일에는 키, 비밀번호, 접속 URL이 없다.

## Dashboard 실행

1. Supabase Dashboard에서 `breadlab-community-development`를 연다.
2. **Project Settings → General**에서 Project ref가 `giuxonxvuqrdnmjwvhvt`인지 다시 확인한다.
3. 왼쪽 메뉴에서 **SQL Editor**를 클릭하고 **New query(새 쿼리)**를 클릭한다.
4. `supabase/bootstrap/development-dashboard.sql` 전체를 편집기에 붙여 넣는다.
5. `DASHBOARD RUN SECTION 01 OF 20` 블록만 선택하고 **Run**을 클릭한다. `FRESH PROJECT PREFLIGHT PASSED` notice를 확인한다.
6. 같은 방법으로 **SECTION 02부터 SECTION 10까지** 한 블록씩 번호 순서대로 실행한다.
7. **SECTION 11만 두 번 나누어 실행한다.** 먼저 source line 9-12의 `CREATE INDEX CONCURRENTLY ...;` 문 하나만 선택해 실행(11A)한다. 성공 후 source line 14의 `DO $$`부터 마지막 `commit;`까지 선택해 실행(11B)한다. SECTION 11 전체를 한 번에 보내지 않는다.
8. **SECTION 12부터 SECTION 20까지** 다시 한 블록씩 실행한다. 각 블록은 다음 구분선 직전까지 선택한다.
9. 마지막에 다음 notice가 보이면 완료다.

```text
BOOTSTRAP VERIFIED: 17 migrations, Google-only provisioning, provenance, and 5 seed tags
```

**파일 전체를 한 번에 실행 금지.** `202609270005_unbounded_public_listing.sql`의 top-level `CREATE INDEX CONCURRENTLY`는 Dashboard가 여러 문장을 하나의 query로 보낼 때 implicit transaction 안에 들어가 실패한다. 따라서 11A의 concurrent index 한 문장과 11B의 나머지 문장을 별도 query로 보내야 migration의 top-level 의미가 유지된다.

SECTION 19는 개발에 필요한 태그 5개만 seed하고 migration history의 17개 version/name을 기록한다. `statements`는 실제 실행문을 꾸며 내지 않고 빈 배열로 기록한다. Supabase CLI는 적용 여부를 version으로 판단하므로 이후 `supabase db push`가 같은 migration을 재실행하지 않는다. 로컬 CLI 2.118.0 reset에서 실제 history 구조(`version text`, `statements text[]`, `name text`)와 동작을 확인했다.

## 실패 시

- 어떤 SECTION에서든 오류가 나면 즉시 중단하고 다음 SECTION을 실행하지 않는다.
- 이 bundle은 전체 transaction이 아니므로 앞 SECTION의 변경은 남을 수 있다. 같은 프로젝트에서 임의로 재실행하거나 수동 수정하지 않는다.
- 오류 전문과 실패한 SECTION 번호를 보존한 뒤, 일회용 fresh 개발 프로젝트를 다시 비우거나 재생성하고 원인을 수정한 새 artifact로 SECTION 01부터 다시 시작한다.
- fresh preflight가 실패하면 기존 스키마가 있는 프로젝트다. 우회하지 말고 대상 프로젝트를 다시 확인한다.
- 어떠한 실패 상황에서도 프로덕션 프로젝트로 전환하지 않는다.
