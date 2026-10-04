# Community OAuth provider abstraction design

## Status

Approved direction: replace the GitHub-only authentication API with a provider-neutral OAuth boundary, enable Google for the first release, and preserve a narrow path for later Kakao and GitHub integration.

## Goals

- Make Google the only visible and callable login provider in the current release.
- Remove GitHub-specific function names, types, copy, and tests from the application authentication boundary.
- Keep the existing static-SPA PKCE callback, safe return-path handling, session ordering, draft preservation, and `auth.uid()` authorization model.
- Permit later Kakao and GitHub enablement without changing page-level authentication APIs.
- Verify the complete Google login and logout flow against the dedicated hosted development Supabase project before production work.

## Non-goals

- Google One Tap, automatic sign-in, or third-party Google UI scripts.
- Kakao or GitHub provider configuration in this change.
- Manual identity linking or unlinking UI.
- Email/password, magic-link, anonymous, or phone authentication.
- Production Supabase writes, production login probes, deployment, or migration changes.
- Storing Google provider access or refresh tokens.

## Environment boundaries

| Boundary | Project ref | Purpose |
| --- | --- | --- |
| Local browser | none | Unit, component, callback, and build verification with synthetic auth clients |
| Hosted development | `<development-project-ref>` | Real Google OAuth redirect, Supabase session, profile, RLS, and logout verification |
| Production | `uoexlthefwuawlbzxwik` | Explicitly excluded from this implementation and verification cycle |

The browser receives only the development project URL and publishable key. Google Client Secret, Supabase access tokens, database passwords, service-role keys, and provider tokens must not enter the repository, browser artifact, logs, screenshots, or test evidence.

Development browser configuration remains untracked in `community-app/.env.local`:

```dotenv
VITE_SUPABASE_URL=https://<development-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<development browser-safe publishable key>
```

## Provider model

The application owns a deliberately small provider union:

```ts
export type CommunityOAuthProvider = 'google' | 'kakao' | 'github'
```

A registry is the sole source of provider-specific product copy:

```ts
interface CommunityOAuthProviderDefinition {
  id: CommunityOAuthProvider
  loginLabel: string
  pendingLabel: string
  unavailableMessage: string
}
```

The initial enabled set is compile-time and immutable:

```ts
export const ENABLED_AUTH_PROVIDERS = ['google'] as const
```

This release does not add a browser environment variable for provider enablement. A provider must not become visible merely because an environment variable changed; source review, provider configuration, tests, and deployment remain one deliberate change.

Registry entries may exist for Google, Kakao, and GitHub so page code never needs provider-specific branching. Only entries in `ENABLED_AUTH_PROVIDERS` may be rendered or passed to the sign-in operation.

## Application API

The authentication context changes from the GitHub-specific method:

```ts
signInWithGitHub(returnPath?: string): Promise<void>
```

to the provider-neutral method:

```ts
signIn(provider: CommunityOAuthProvider, returnPath?: string): Promise<void>
```

The low-level helper follows the same contract:

```ts
startOAuthSignIn(client, provider, returnPath, origin, storage)
```

Before calling Supabase it must:

1. reject a provider not present in `ENABLED_AUTH_PROVIDERS`;
2. normalize and store only a canonical application-relative return path under `/community/`;
3. construct the same-origin callback URL `/community/auth/callback/`;
4. call `signInWithOAuth` with the validated provider and callback;
5. map provider failures to fixed Korean product copy without displaying raw provider text.

The provider identifier is selected by trusted application code, not query parameters or arbitrary user input.

## UI behavior

The header renders login controls by mapping `ENABLED_AUTH_PROVIDERS`. With the initial one-element set, users see one button:

```text
Google로 로그인
```

Pending state:

```text
Google 연결 중
```

Authenticated identity display and logout behavior stay unchanged. Page-level login requirements call `auth.signIn('google', currentPath)` through a shared default-provider helper rather than importing Google-specific functions.

The first implementation must preserve narrow-layout behavior: long authenticated emails remain ellipsized and login/logout/write actions remain reachable at 320px and 390px widths.

## OAuth and callback flow

1. The user selects `Google로 로그인`.
2. The application stores the validated current community path in session storage.
3. Supabase redirects to Google using the provider configuration stored in the development project.
4. Google returns to `https://<development-project-ref>.supabase.co/auth/v1/callback`.
5. Supabase returns to `http://localhost:5173/community/auth/callback/`.
6. The static callback page exchanges the authorization code once.
7. The application consumes and removes the pending return path and navigates with replacement semantics.
8. A newer auth-state event remains authoritative over a late `getSession()` response.

Callback replay, missing code, provider denial, storage failure, and unmount during asynchronous work remain fail-closed and use fixed Korean errors.

## Identity and profile semantics

Authorization continues to derive identity exclusively from the Supabase session and PostgreSQL `auth.uid()`. No provider user ID, email, or browser-supplied owner ID becomes an authorization key.

Supabase may automatically link verified identities that share an email. That behavior is not treated as a complete future account-linking design: Kakao or GitHub can omit email or return a different address. When another provider is enabled, a separate reviewed feature must cover explicit `linkIdentity()` UX, conflicts, unlinking, and prevention of removing the final usable identity.

The Google integration check must confirm that the existing profile provisioning path creates or exposes exactly one profile for the authenticated Supabase user without broadening RLS.

## Error handling

- Unsupported or disabled provider: provider-specific fixed Korean message.
- OAuth start failure: fixed Korean retry message; raw SDK/provider errors are not rendered.
- Callback failure: existing safe callback error and fallback navigation behavior.
- Session initialization or logout failure: existing generic Korean messages.
- Hosted development unavailable or paused: stop with recovery guidance; never retry against production.

No error evidence may contain OAuth codes, access tokens, refresh tokens, provider tokens, publishable keys, email bodies, or raw provider responses.

## Testing strategy

### Unit and component tests

Tests are written before implementation and must prove:

- the provider registry contains exact metadata and only Google is enabled;
- unsupported providers cannot reach `signInWithOAuth`;
- Google invokes Supabase with `provider: 'google'` and the canonical callback URL;
- safe return paths survive OAuth while external, encoded, protocol-relative, backslash, control-character, and overlong values fall back safely;
- disabled-provider and generic failures produce Google-specific fixed Korean copy without raw error leakage;
- callback exchange is single-use under React Strict Mode and replay;
- session-event ordering, unmount safety, logout, and draft preservation remain intact;
- the header exposes one accessible Google control and a matching pending label;
- authenticated long identities do not remove required actions at narrow widths;
- no GitHub-only function names or user-facing GitHub login copy remain.

### Static verification

Run:

```text
npm run test -- --run
npm run typecheck
npm run lint
npm run build
```

Verify the built callback shell exists and scan the static artifact for privileged credentials and provider secrets.

### Hosted development verification

Against only `<development-project-ref>`:

1. start Vite on `http://localhost:5173` with untracked public development configuration;
2. confirm the login action redirects through the development Supabase project and Google;
3. have the operator complete Google account selection and consent without sharing credentials;
4. confirm return to the exact community callback path;
5. confirm a Supabase session and stable `auth.uid()` exist;
6. confirm one profile is available through the existing authorized application path;
7. reload and confirm session restoration;
8. sign out and confirm protected actions return to signed-out behavior;
9. inspect browser/network/build evidence for absence of secrets;
10. stop the development server and verify its port is released.

A production URL, key, project ref, or fallback must cause the development verification to stop rather than continue.

## Rollout

1. Commit this design independently from the existing release-operations work.
2. Implement provider abstraction with strict TDD in the isolated feature worktree.
3. Complete local verification.
4. Complete hosted development Google OAuth verification.
5. Obtain independent security and UI/code-quality reviews.
6. Integrate only after reviews pass.
7. Configure and test production Google OAuth in a later explicitly approved production step.

## Acceptance criteria

- Google is the only enabled and visible provider.
- No GitHub-only authentication API or visible GitHub login control remains; disabled registry metadata is allowed for the future provider contract.
- Existing callback, return-path, session, draft, and RLS security contracts remain green.
- Full local test, typecheck, lint, and build commands pass.
- A real development Google login issues a Supabase session and survives reload.
- Logout succeeds and protected UI returns to signed-out state.
- No production network request or mutation occurs.
- No secret enters source control, browser artifacts, logs, screenshots, or evidence.
