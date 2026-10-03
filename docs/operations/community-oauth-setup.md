# Community GitHub OAuth configuration

The community browser uses Supabase Auth’s GitHub provider with PKCE. Its boundaries are local Docker, hosted development, and production.

## Separate applications and credentials

Create a separate GitHub OAuth App for each boundary. Each has its own Client ID/Client Secret and callback; never share a production app or secret with local or development. Store each Client Secret only in that boundary’s Supabase Auth provider configuration (local secret injection for Docker; Dashboard for hosted projects).

The browser receives only the boundary’s Supabase project URL and **publishable key**. A publishable key is public. GitHub OAuth secrets, Supabase service-role/secret keys, database passwords, and user tokens are privileged and must not enter the browser bundle, repository, evidence, logs, Actions artifacts, or Pages artifact.

## Exact GitHub OAuth App callbacks

GitHub **Settings → Developer settings → OAuth Apps** uses the Supabase Auth endpoint as Authorization callback URL, not the community page callback.

| OAuth App | Homepage URL | Authorization callback URL |
|---|---|---|
| local Docker | `http://localhost:5173/community/` | `http://127.0.0.1:54321/auth/v1/callback` |
| hosted development | `http://localhost:5173/community/` | `https://${DEVELOPMENT_PROJECT_REF}.supabase.co/auth/v1/callback` |
| production | `https://www.breadlab.ai/community/` | `https://${PRODUCTION_PROJECT_REF}.supabase.co/auth/v1/callback` |

`${DEVELOPMENT_PROJECT_REF}` and `${PRODUCTION_PROJECT_REF}` denote operator environment variables; substitute their non-secret values in the dashboards. Validate that they are nonempty and distinct before configuration:

```bash
: "${DEVELOPMENT_PROJECT_REF:?set development project ref}"
: "${PRODUCTION_PROJECT_REF:?set production project ref}"
[ "$DEVELOPMENT_PROJECT_REF" != "$PRODUCTION_PROJECT_REF" ] || exit 1
```

## Exact Supabase redirect allow-lists

The Supabase Auth **Authentication → URL Configuration → Redirect URLs** allow-list controls the browser’s post-auth destination and is different from GitHub’s Authorization callback URL. Do not add wildcards, preview hosts, protocol-relative URLs, or another environment’s origin.

| Boundary | Site URL | Complete redirect allow-list |
|---|---|---|
| local Docker | `http://localhost:5173/community/` | `http://localhost:5173/community/auth/callback/` |
| hosted development | `http://localhost:5173/community/` | `http://localhost:5173/community/auth/callback/` |
| production | `https://www.breadlab.ai/community/` | `https://www.breadlab.ai/community/auth/callback/` |

For local Docker, keep equivalent values in `supabase/config.toml`; inject the local GitHub app credentials through the approved local secret mechanism. For hosted development and production, enter only that boundary’s OAuth app credentials and exact allow-list in its Dashboard.

## Verification

For each boundary independently:

1. Confirm the displayed project ref and OAuth App name before any change.
2. Start logged out and initiate GitHub login.
3. Confirm GitHub returns to that boundary’s Supabase `/auth/v1/callback` and Supabase returns to the exact community `/auth/callback/` allow-listed URL.
4. Confirm PKCE code exchange occurs once, the original same-origin community path/query is restored, and logout/session expiry preserves public reads and local drafts.
5. Confirm a disabled provider produces the expected user-facing message.
6. Confirm logs and evidence contain no OAuth code, access/refresh token, Client Secret, or callback body.
7. Use separate synthetic test identities; remove development test sessions/fixtures by exact recorded IDs.

OAuth/configuration change is a hosted mutation and requires a boundary-specific manual approval. `scripts/release-gate.mjs` never changes OAuth settings.

## Official references

- Supabase redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- GitHub OAuth Apps: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
