# Community OAuth Provider Abstraction Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the GitHub-only SPA authentication API with a provider-neutral boundary, enable Google only, and verify a real Google login against the dedicated development Supabase project.

**Architecture:** A typed provider registry owns labels and the enabled-provider allowlist. The auth helper and React context accept only enabled provider IDs, while page consumers use one shared default provider instead of naming Google directly. Existing PKCE callback, safe return-path storage, session ordering, draft persistence, and `auth.uid()` authorization remain unchanged.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 5, Testing Library, Supabase JS 2.117, hosted Supabase Auth with Google OAuth.

**Design:** `docs/superpowers/specs/2026-10-04-community-oauth-provider-abstraction-design.md`

---

### Task 1: Add the typed provider registry and fail-closed OAuth helper

**Objective:** Establish one provider-neutral model in which Google is the only enabled provider and unsupported providers cannot reach Supabase.

**Files:**
- Create: `community-app/src/auth/providers.ts`
- Create: `community-app/src/auth/providers.test.ts`
- Modify: `community-app/src/auth/auth.ts`
- Modify: `community-app/src/auth/auth.test.ts`

**Step 1: Write failing provider-registry tests**

Add tests that assert exact metadata for all future-known providers and the initial enabled set:

```ts
import { describe, expect, it } from 'vitest'
import {
  AUTH_PROVIDER_DEFINITIONS,
  DEFAULT_AUTH_PROVIDER,
  ENABLED_AUTH_PROVIDERS,
  isEnabledAuthProvider,
} from './providers'

describe('community OAuth providers', () => {
  it('enables only Google for the initial release', () => {
    expect(ENABLED_AUTH_PROVIDERS).toEqual(['google'])
    expect(DEFAULT_AUTH_PROVIDER).toBe('google')
    expect(isEnabledAuthProvider('google')).toBe(true)
    expect(isEnabledAuthProvider('kakao')).toBe(false)
    expect(isEnabledAuthProvider('github')).toBe(false)
  })

  it('owns exact Korean product copy in one registry', () => {
    expect(AUTH_PROVIDER_DEFINITIONS.google).toEqual({
      id: 'google',
      loginLabel: 'Google로 로그인',
      buttonLabel: 'Google 로그인',
      pendingLabel: 'Google 연결 중',
      unavailableMessage: 'Google 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
    })
  })
})
```

**Step 2: Write failing OAuth-helper tests**

Replace the GitHub-specific expectations in `auth.test.ts` with:

```ts
await startOAuthSignIn(
  { signInWithOAuth },
  'google',
  '/community/post/?id=123',
  'https://www.breadlab.ai',
  storage,
)

expect(signInWithOAuth).toHaveBeenCalledWith({
  provider: 'google',
  options: { redirectTo: 'https://www.breadlab.ai/community/auth/callback/' },
})
```

Add a rejection test proving `kakao`, `github`, and arbitrary runtime strings cannot invoke the client:

```ts
await expect(startOAuthSignIn(client, 'kakao', '/community/', origin, storage))
  .rejects.toThrow(/not enabled/i)
expect(signInWithOAuth).not.toHaveBeenCalled()
```

Retain all existing safe and hostile return-path cases.

**Step 3: Run focused tests and verify RED**

Run:

```bash
npm run test -- --run src/auth/providers.test.ts src/auth/auth.test.ts
```

Expected: FAIL because `providers.ts` and `startOAuthSignIn` do not exist and the client type accepts only GitHub.

**Step 4: Implement the minimal registry**

Create `providers.ts`:

```ts
export type CommunityOAuthProvider = 'google' | 'kakao' | 'github'

export interface CommunityOAuthProviderDefinition {
  id: CommunityOAuthProvider
  loginLabel: string
  buttonLabel: string
  pendingLabel: string
  unavailableMessage: string
}

export const AUTH_PROVIDER_DEFINITIONS = Object.freeze({
  google: Object.freeze({
    id: 'google',
    loginLabel: 'Google로 로그인',
    buttonLabel: 'Google 로그인',
    pendingLabel: 'Google 연결 중',
    unavailableMessage: 'Google 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
  }),
  kakao: Object.freeze({
    id: 'kakao',
    loginLabel: '카카오로 로그인',
    buttonLabel: '카카오 로그인',
    pendingLabel: '카카오 연결 중',
    unavailableMessage: '카카오 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
  }),
  github: Object.freeze({
    id: 'github',
    loginLabel: 'GitHub로 로그인',
    buttonLabel: 'GitHub 로그인',
    pendingLabel: 'GitHub 연결 중',
    unavailableMessage: 'GitHub 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
  }),
} satisfies Record<CommunityOAuthProvider, CommunityOAuthProviderDefinition>)

export const ENABLED_AUTH_PROVIDERS = Object.freeze(['google'] as const)
export const DEFAULT_AUTH_PROVIDER = 'google' as const

export function isEnabledAuthProvider(value: unknown): value is typeof ENABLED_AUTH_PROVIDERS[number] {
  return typeof value === 'string'
    && ENABLED_AUTH_PROVIDERS.some(provider => provider === value)
}
```

**Step 5: Generalize the low-level helper**

In `auth.ts`:

- import the provider type and enablement check;
- change the client provider type to `CommunityOAuthProvider`;
- replace `signInWithGitHub` with `startOAuthSignIn`;
- reject disabled providers before storing navigation state or calling Supabase;
- pass the provider into `authErrorMessage` so disabled-provider copy comes from the registry;
- keep fixed generic Korean errors and never render raw provider text.

Target signature:

```ts
export async function startOAuthSignIn(
  client: OAuthClient,
  provider: CommunityOAuthProvider,
  returnPath: unknown,
  origin: string,
  storage: StorageLike,
): Promise<void>
```

**Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm run test -- --run src/auth/providers.test.ts src/auth/auth.test.ts
```

Expected: all focused tests pass.

**Step 7: Commit**

```bash
git add community-app/src/auth/providers.ts \
  community-app/src/auth/providers.test.ts \
  community-app/src/auth/auth.ts \
  community-app/src/auth/auth.test.ts
git commit -m "feat: add community oauth provider registry"
```

---

### Task 2: Generalize the React authentication context

**Objective:** Expose `signIn(provider, returnPath)` while preserving session ordering, logout, error, and unmount behavior.

**Files:**
- Modify: `community-app/src/auth/AuthProvider.tsx`
- Modify: `community-app/src/auth/AuthProvider.test.tsx`

**Step 1: Write failing context tests**

Change the harness to call:

```tsx
<button onClick={() => void auth.signIn('google', '/community/write/')}>login</button>
```

Assert:

```ts
expect(signInWithOAuth).toHaveBeenCalledWith({
  provider: 'google',
  options: { redirectTo: 'https://www.breadlab.ai/community/auth/callback/' },
})
```

Add a test that attempts a disabled provider through the typed/runtime boundary and confirms:

- no SDK invocation;
- `pending` returns to false;
- a fixed Korean error is exposed;
- raw SDK/provider text is absent.

Keep the existing auth-event ordering, initialization, logout, and unmount tests unchanged except for the context method shape.

**Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- --run src/auth/AuthProvider.test.tsx
```

Expected: FAIL because `AuthContextValue.signIn` does not exist.

**Step 3: Implement the context API**

Change the contract to:

```ts
signIn(provider: CommunityOAuthProvider, returnPath?: string): Promise<void>
```

Use a callback with explicit provider:

```ts
const login = useCallback(async (
  provider: CommunityOAuthProvider,
  returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`,
) => {
  // existing pending/error lifecycle
  await startOAuthSignIn(authClient, provider, returnPath, callbackOrigin, returnStorage)
}, [authClient, callbackOrigin, returnStorage])
```

Do not alter the `onAuthStateChange` versus `getSession()` ordering.

**Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm run test -- --run src/auth/AuthProvider.test.tsx
```

Expected: all context tests pass.

**Step 5: Commit**

```bash
git add community-app/src/auth/AuthProvider.tsx community-app/src/auth/AuthProvider.test.tsx
git commit -m "refactor: generalize community auth context"
```

---

### Task 3: Render Google from the registry and migrate page consumers

**Objective:** Remove visible GitHub-only behavior while keeping one shared default provider for every protected action.

**Files:**
- Modify: `community-app/src/components/AppHeader.tsx`
- Modify: `community-app/src/components/AppHeader.test.tsx`
- Modify: `community-app/src/pages/WritePostPage.tsx`
- Modify: `community-app/src/pages/EditPostPage.tsx`
- Modify: `community-app/src/pages/PostDetailPage.tsx`
- Modify: `community-app/src/pages/AdminReportsPage.tsx`
- Modify tests and fixtures that construct `AuthContextValue`:
  - `community-app/src/App.test.tsx`
  - `community-app/src/pages/PostEditorPages.test.tsx`
  - `community-app/src/pages/PostDetailPage.test.tsx`
  - `community-app/src/pages/EditPostImageUploads.test.tsx`
  - `community-app/src/pages/AdminReportsPage.test.tsx`
  - any additional files returned by an exact `signInWithGitHub` search

**Step 1: Write failing header tests**

Change expectations to:

```ts
const button = await screen.findByRole('button', { name: 'Google로 로그인' })
fireEvent.click(button)
expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }))
```

Assert the pending accessible name and visible text both use `Google 연결 중`.

Add an assertion that no GitHub or Kakao login control is rendered.

**Step 2: Write failing protected-action tests**

Update auth stubs to expose `signIn`. Assert every anonymous protected action calls:

```ts
expect(auth.signIn).toHaveBeenCalledWith('google', expectedReturnPath)
```

For the admin gate, expect `Google로 관리자 로그인` and the exact preserved path.

**Step 3: Run the affected tests and verify RED**

Run:

```bash
npm run test -- --run \
  src/components/AppHeader.test.tsx \
  src/pages/PostEditorPages.test.tsx \
  src/pages/PostDetailPage.test.tsx \
  src/pages/EditPostImageUploads.test.tsx \
  src/pages/AdminReportsPage.test.tsx \
  src/App.test.tsx
```

Expected: FAIL because production components still call `signInWithGitHub` and render GitHub copy.

**Step 4: Implement registry-driven UI and default-provider calls**

In the header:

```ts
const provider = AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER]
```

Render exact registry labels and call:

```tsx
onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER)}
```

For protected page actions call:

```ts
void auth.signIn(DEFAULT_AUTH_PROVIDER, currentPath)
```

Replace `GitHub 사용자` fallback with provider-neutral `커뮤니티 사용자`.

**Step 5: Run affected tests and verify GREEN**

Run the command from Step 3.

Expected: all affected tests pass.

**Step 6: Search for stale GitHub-only APIs and visible copy**

Use `search_files` over `community-app/src` for these patterns:

```text
signInWithGitHub
GitHub로 관리자 로그인
GitHub 로그인이
GitHub 연결 중
```

Expected: no matches outside disabled provider registry metadata and deliberate provider-registry tests. Confirm no page or context imports a provider-specific sign-in function.

**Step 7: Commit**

```bash
git add community-app/src
git commit -m "feat: switch community login to Google"
```

---

### Task 4: Preserve callback, draft, and responsive security contracts

**Objective:** Prove the provider refactor did not regress static callback replay protection, local drafts, or narrow-layout auth controls.

**Files:**
- Modify only if a failing regression requires it:
  - `community-app/src/pages/AuthCallbackPage.test.tsx`
  - `community-app/src/auth/AuthProvider.test.tsx`
  - `community-app/src/components/AppHeader.test.tsx`
  - existing draft/page tests

**Step 1: Add or tighten regression assertions**

Confirm tests cover:

- one `exchangeCodeForSession` call under rerender/Strict Mode;
- callback error does not expose raw `error_description`;
- pending return path is consumed once;
- write/edit drafts remain after login redirect initiation or OAuth start failure;
- long hostile-looking identity remains text, is ellipsized by the existing class, and logout/write controls remain present;
- provider tokens are never read or persisted.

Do not add CSS changes unless a real regression is demonstrated.

**Step 2: Run the security-focused tests**

Run:

```bash
npm run test -- --run \
  src/pages/AuthCallbackPage.test.tsx \
  src/auth/AuthProvider.test.tsx \
  src/components/AppHeader.test.tsx \
  src/pages/PostEditorPages.test.tsx
```

Expected: all tests pass. If a new test fails, make the smallest production fix and rerun until GREEN.

**Step 3: Commit only if files changed**

```bash
git add community-app/src
git commit -m "test: preserve community oauth security contracts"
```

---

### Task 5: Run the complete local gate and static artifact checks

**Objective:** Establish a fresh local proof before contacting hosted development.

**Files:**
- No expected source changes.

**Step 1: Run the full application gate**

Run:

```bash
npm run test -- --run
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

Expected:

- every test file passes with zero failures;
- TypeScript exits 0;
- ESLint exits 0;
- Vite build exits 0 and includes `dist/auth/callback/index.html`;
- production dependency audit reports zero known vulnerabilities.

**Step 2: Scan the source and artifact**

Run a bounded scan for:

- Google/GitHub client secrets;
- service-role or secret-key patterns;
- database passwords and connection strings;
- OAuth codes, access tokens, refresh tokens, provider tokens;
- production project URL or publishable key in the development artifact.

Expected: no privileged material and no production project configuration.

**Step 3: Verify repository state**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -5
```

Expected: clean worktree with only the intended feature commits.

---

### Task 6: Verify real Google OAuth against hosted development

**Objective:** Prove the configured Google provider issues and restores a Supabase development session without touching production.

**Files:**
- Create locally but never commit: `community-app/.env.local`

**Step 1: Create untracked browser-safe development configuration**

Write only:

```dotenv
VITE_SUPABASE_URL=https://<development-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<provided development publishable key>
```

Verify `.env.local` is ignored and contains no secret/provider credential.

**Step 2: Start the development server**

Run:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Verify readiness at:

```text
http://localhost:5173/community/
```

**Step 3: Exercise the OAuth redirect**

Open the local community, select `Google로 로그인`, and verify the redirect chain targets:

```text
https://<development-project-ref>.supabase.co/auth/v1/authorize
Google account selection/consent
https://<development-project-ref>.supabase.co/auth/v1/callback
http://localhost:5173/community/auth/callback/
```

The operator completes Google account selection and consent directly. Do not request or accept Google credentials in chat.

**Step 4: Verify session behavior**

After callback:

- confirm the header shows the authenticated identity;
- confirm the final location matches the preserved return path;
- reload and confirm the session persists;
- confirm exactly one application profile is available through the existing authorized path;
- sign out and confirm protected actions return to signed-out behavior.

Do not create posts, comments, attachments, or production fixtures in this task unless a separately approved integration test requires them.

**Step 5: Verify isolation and cleanup**

Inspect network destinations and confirm no request targets:

```text
uoexlthefwuawlbzxwik.supabase.co
```

Stop the Vite server, verify port 5173 is released, and retain only non-secret pass/fail evidence.

---

### Task 7: Independent review and integration readiness

**Objective:** Obtain fresh spec/security and code/UI approval before merging or production work.

**Files:**
- No expected changes unless reviewers find a blocker.

**Step 1: Request spec and security review**

Reviewer verifies:

- exact design acceptance criteria;
- only Google enabled;
- disabled providers cannot reach Supabase;
- redirect and return-path grammar;
- callback replay/session ordering;
- draft preservation;
- no secret or production configuration leakage;
- hosted verification contacted only development.

**Step 2: Request code quality and UI review**

Reviewer verifies:

- registry/context/page boundaries are minimal and understandable;
- no unnecessary provider framework or One Tap code;
- accessible labels and pending copy match;
- narrow layouts retain all actions;
- tests verify behavior rather than mocks alone.

**Step 3: Fix only blocking findings with RED-GREEN evidence**

For each Critical or Important finding:

1. add a minimal failing regression;
2. run it and record the expected RED;
3. implement the smallest fix;
4. rerun focused and full gates;
5. request a delta review.

**Step 4: Report state separately**

Report:

- local verification;
- hosted development verification;
- reviewer verdicts;
- commit state;
- merge state;
- push/deployment state;
- production status.

Do not merge, push, configure production, or deploy without a separate user approval.
