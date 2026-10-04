# Community Google OAuth configuration

The community browser uses Supabase Auth’s Google provider with PKCE. Google is the only enabled community OAuth provider for the current release. Kakao and GitHub remain disabled, future providers behind the existing provider-neutral application boundary; do not configure or enable them for this release. The three operational boundaries are local Docker, hosted development, and production.

## Separate applications and credentials

Create a separate Google OAuth 2.0 web client for each boundary. Each client has its own Client ID and Client Secret; never share the production client or secret with local or development. Store each Client Secret only in that boundary’s Supabase Auth Google provider configuration (local secret injection for Docker; Dashboard for hosted projects).

The browser receives only the boundary’s Supabase project URL and **publishable key**. A publishable key is public. Google OAuth client secrets, Supabase service-role/secret keys, database passwords, provider access/refresh tokens, and user session tokens are privileged and must not enter the browser bundle, repository, evidence, logs, Actions artifacts, or Pages artifact.

## Exact Google callbacks via Supabase

In the Google Cloud Console, configure each OAuth 2.0 web client’s **Authorized redirect URI** to the corresponding Supabase Auth callback. Google returns to Supabase, not directly to the community page.

| Google OAuth client | Authorized redirect URI |
|---|---|
| local Docker | `http://127.0.0.1:54321/auth/v1/callback` |
| hosted development | `https://${DEVELOPMENT_PROJECT_REF}.supabase.co/auth/v1/callback` |
| production | `https://${PRODUCTION_PROJECT_REF}.supabase.co/auth/v1/callback` |

`${DEVELOPMENT_PROJECT_REF}` and `${PRODUCTION_PROJECT_REF}` denote operator environment variables; substitute their non-secret values in the consoles. Validate that they are nonempty and distinct before configuration:

```bash
: "${DEVELOPMENT_PROJECT_REF:?set development project ref}"
: "${PRODUCTION_PROJECT_REF:?set production project ref}"
[ "$DEVELOPMENT_PROJECT_REF" != "$PRODUCTION_PROJECT_REF" ] || exit 1
```

## Exact Supabase application callback allow-lists

The Supabase Auth **Authentication → URL Configuration → Redirect URLs** allow-list controls the browser’s post-auth application callback and is different from Google’s Authorized redirect URI. Do not add wildcards, preview hosts, protocol-relative URLs, or another environment’s origin.

| Boundary | Site URL | Complete redirect allow-list |
|---|---|---|
| local Docker | `http://localhost:5173/community/` | `http://localhost:5173/community/auth/callback/` |
| hosted development | `http://localhost:5173/community/` | `http://localhost:5173/community/auth/callback/` |
| production | `https://www.breadlab.ai/community/` | `https://www.breadlab.ai/community/auth/callback/` |

For local Docker, keep equivalent values in `supabase/config.toml`; inject local Google client credentials through the approved local secret mechanism. For hosted development and production, enable only Google in Supabase Auth, enter only that boundary’s Google client credentials, and set its exact allow-list. Confirm Kakao and GitHub remain disabled.

## Verification

For each boundary independently:

1. Confirm the displayed project ref and Google OAuth client name before any change.
2. Confirm Google is the only enabled community OAuth provider and Kakao/GitHub are disabled.
3. Start logged out and initiate Google login.
4. Confirm Google returns to that boundary’s Supabase `/auth/v1/callback`, then Supabase returns to the exact community `/auth/callback/` allow-listed URL.
5. Confirm PKCE code exchange occurs once, the original same-origin community path/query is restored, and logout/session expiry preserves public reads and local drafts.
6. Confirm a disabled provider cannot reach Supabase and produces the expected user-facing message.
7. Confirm logs and evidence contain no OAuth code, access/refresh token, Client Secret, or callback body.
8. Use separate synthetic test identities; remove development test sessions/fixtures by exact recorded IDs.

OAuth/configuration change is a hosted mutation and requires a boundary-specific manual approval. `scripts/release-gate.mjs` never changes OAuth settings.

## Official references

- Supabase Google Auth: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Google OAuth 2.0 web server applications: https://developers.google.com/identity/protocols/oauth2/web-server
