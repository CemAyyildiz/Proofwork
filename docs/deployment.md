# Deployment

Proofwork runs on the Stellar **testnet only**. There is no mainnet host and no staging environment beyond Vercel preview deployments.

## Hosts

| What | Where | Notes |
|---|---|---|
| Source | GitHub, public repository | CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, `pnpm audit`, repo hygiene and `next build` on every push to `main` and every pull request |
| App | Vercel, project linked to the repository | `main` deploys to production; any other branch gets a preview deployment |
| Domain | `https://proofwork.online` | Apex is the production domain; `www.proofwork.online` redirects to it (308) |
| Database | Neon Postgres | Branch `main` for production, a separate branch `preview` for previews |
| Rate limiting | Upstash Redis | One database for production, a separate one for previews |
| Chain | Stellar testnet (Horizon, Soroban RPC), Trustless Work `dev.api.trustlesswork.com` | Fixed hosts, also listed in the CSP `connect-src` |
| X | `x.com` (authorize page, reached by browser redirect), `api.x.com` (token, account lookup and post-author lookup, called by the server) | Fixed hosts in `src/x/api.ts`. Not in the CSP: the browser navigates to X and never fetches it |

Pick the Vercel function region next to the Neon region (for example `fra1` with `aws-eu-central-1`). Set the Vercel Node.js version to 22, the same as CI.

There is no Vercel cron job. Escrow operations are reconciled against chain state inside `prepare` and `submit` of each operation (see `src/services/escrow-ops.ts`), not by a background job.

## Environment variables

Values are entered in the Vercel dashboard only, per scope. None of them is ever committed, and none has the `NEXT_PUBLIC_` prefix. `src/config/env.ts` validates them on first use; a missing or malformed value fails the request instead of running with a bad config.

| Name | Production scope | Preview scope |
|---|---|---|
| `DATABASE_URL` | Neon `main` branch, **pooled** connection string | Neon `preview` branch, pooled connection string |
| `STELLAR_NETWORK` | `testnet` | `testnet` |
| `HORIZON_URL` | optional, defaults to Horizon testnet | same |
| `USDC_ISSUER` | optional, defaults to testnet USDC | same |
| `TW_BASE_URL` | `https://dev.api.trustlesswork.com` | same |
| `TW_API_KEY` | Trustless Work testnet key | same key or a second one |
| `PLATFORM_ADMIN_SECRET` | production server key | separate key from `pnpm keys:gen` |
| `PLATFORM_OPS_SECRET` | production server key | separate key from `pnpm keys:gen` |
| `DECISION_LEDGER_SECRET` | production server key | separate key from `pnpm keys:gen` |
| `SESSION_SECRET` | own value (`openssl rand -base64 48`) | different value |
| `UPSTASH_REDIS_REST_URL` | production Upstash database (see below) | preview Upstash database |
| `UPSTASH_REDIS_REST_TOKEN` | production Upstash database (see below) | preview Upstash database |
| `DEFAULT_DISPUTE_RESOLVER_PUBKEY` | optional, public key (`G...`) only | optional |
| `PUBLIC_FUNDING_SOURCES` | optional, comma-separated public keys (`G...`) of faucets besides Friendbot; wallets they created are not flagged for sharing a funding source | same |
| `X_CLIENT_ID` | OAuth 2.0 Client ID of the X app (see [Sign in with X](#sign-in-with-x)) | leave unset, or a second X app |
| `X_CLIENT_SECRET` | OAuth 2.0 Client Secret of the same X app | leave unset, or a second X app |
| `X_REDIRECT_URI` | `https://proofwork.online/api/x/callback` | leave unset, or the callback of a fixed preview domain |
| `X_BEARER_TOKEN` | app-only Bearer Token of the same X app (see [Post-author lookup](#post-author-lookup)) | leave unset, or the token of the second X app |

Never set on Vercel: `FUNDER_SECRET`, `DISPUTE_RESOLVER_SECRET`. They are used only by local scripts (`pnpm spike`, `pnpm escrow:close`) and must stay on the operator's machine.

When the Upstash database comes from the Vercel Marketplace integration, it injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` as sensitive variables, which cannot be read back to copy under the names above. `src/config/env.ts` falls back to that pair when neither `UPSTASH_REDIS_REST_*` value is set, so nothing needs to be duplicated.

The schema treats the two Upstash variables as optional, and nothing checks them at build time. A deployment without them **builds and goes live**. It then fails on the first rate-limited request: the limiter throws `Upstash rate limiting is required in production` and wallet login answers 500. The smoke test's wallet login is the check that catches it. Preview deployments also run with `NODE_ENV=production`, so they need their own Upstash values too.

After generating preview keys, run `pnpm accounts:prepare` with them in a local `.env` so the accounts exist on testnet and hold the USDC trustline.

No absolute site URL is configured: nothing in the code builds one, so `SITE_URL` is not needed.

## Sign in with X

A contributor connects an X account through an X developer app that Proofwork owns, and the server asks X who wrote each submitted post. The four `X_*` variables are optional as a set: with all four the Connect X step and submissions work; with none the campaign page shows the step as "Not available yet" with nothing to press, and **no campaign can take submissions**, because the server refuses a post whose author it cannot check. A partial or malformed set (one to three of the four, a redirect URI the config module refuses, or a bearer token with a space or line break in it) is not limited to the X step: the whole environment is rejected, so every route that reads it fails until the values are fixed or removed. A deployment that already has the three Sign in with X values is in that state until `X_BEARER_TOKEN` is added: set the token before deploying this release.

Migration `0004` (the `x_account` table) must be applied before this release is deployed, even with the X variables unset, because the campaign page reads `x_account` for every signed-in wallet. Migration `0005` (the `submission.post_id` column) must be applied first as well: every read of a submission selects that column.

Settings to enter on the X app, in its authentication settings in the X Developer Console (`console.x.com`):

| Setting | Value |
|---|---|
| OAuth 2.0 | enabled |
| Type of App | **Web App, Automated App or Bot**. That makes it a confidential client, which is the only kind that gets a Client Secret; the server authenticates to the token endpoint with it |
| Callback URL | `https://proofwork.online/api/x/callback`, plus `http://localhost:3000/api/x/callback` for local development. X compares the callback exactly, trailing slash included, so each one in use must be listed |
| App permissions | Read only, if the form asks. Permission levels belong to OAuth 1.0a; what this flow may do is set by the scopes below |

Then copy the **OAuth 2.0 Client ID and Client Secret** from the app's Keys and Tokens page into `X_CLIENT_ID` and `X_CLIENT_SECRET`. These are not the API Key and Secret on the same page, which belong to OAuth 1.0a and are not used. The Bearer Token on that page is used, for the post-author lookup only (next section). `X_REDIRECT_URI` must be exactly one of the callback URLs above. The config module refuses anything but `https://<host>/api/x/callback` (`http` only for `localhost` or `127.0.0.1`), with no query, fragment or credentials in it. Any other field the form requires, such as a website URL, takes `https://proofwork.online`.

Scopes are not a console setting. The app asks for `users.read tweet.read` in the authorize request, which is the least X accepts for looking up the signed-in account. It does not ask for `offline.access`, so X issues no refresh token.

Preview deployments get a new hostname each time, and X will not redirect to a callback that is not listed. Leave the four variables unset in the Preview scope unless a fixed preview domain is registered as a callback URL; if it is, use a second X app so the production secret and token stay in the Production scope. A preview without them cannot take submissions.

No CSP change is needed. The flow starts from a plain link to `/api/x/connect`, which answers with a redirect to X; `form-action 'self'` restricts form posts, not link navigation. Checked in headless Chrome against the dev server on 2026-10-13: the browser followed the redirect to `x.com` with no CSP violation.

## Post-author lookup

When a contributor submits, the server asks X who wrote the post: `GET https://api.x.com/2/tweets/<post id>?expansions=author_id`, authenticated with the app's own token, not the contributor's. A submission is accepted only when the author is the X account connected to the submitting wallet ([technical summary → Post author check](technical-summary.md#post-author-check)).

- `X_BEARER_TOKEN` is the **Bearer Token** (app-only) from the same X app's Keys and Tokens page. Paste the token alone, without the word `Bearer`. It is a secret like the Client Secret: Production scope only, never in a `NEXT_PUBLIC_` variable.
- The X app's plan must allow post lookup (`GET /2/tweets/:id`) with app-only access. Each submission that passes the earlier checks costs one lookup; nothing is cached or retried.
- When X answers 429, 5xx or not at all, or refuses the token, the contributor sees "couldn't check the post with X, try again" and nothing is stored. The server log has one line, `post author lookup failed`, with the HTTP status and, on a 429, `resetAt`: the Unix time at which X's limit resets. A 401 or 403 there means the token or the plan, not the contributor.
- The request shape was taken from X's OpenAPI document (v2.170, read 2026-10-13) and has not been sent to X yet. The first submission after the variables are set is the check: if it fails with status 400 or with reason `body`, the shape has changed and `src/x/api.ts` needs correcting before a campaign opens.

## Client IP and rate limits

Rate-limit keys combine the client IP (`clientIp` in `src/lib/http.ts`) with the wallet public key. On Vercel the `x-forwarded-for` header is set by the platform: Vercel overwrites any value the client sends and does not forward external IPs, and `x-real-ip` carries the same address ([Vercel request headers](https://vercel.com/docs/headers/request-headers#x-forwarded-for)). A client therefore cannot spoof its IP to escape the limit. Behind another proxy, or under bare `next start`, that no longer holds and the key must come from a header that the proxy in front sets.

The Trustless Work client limits itself to 50 requests per 60 s inside one server instance. Vercel can run several function instances at once, and each one counts on its own, so the combined rate can go over the provider's limit under load. For the Month 1 campaign (one hand-run campaign, a few operators) that is accepted: escrow calls come from the funder and the operator, not from contributors, and the client waits for `Retry-After` and retries once on HTTP 429.

## Database migrations

Migrations are run by hand, never during the build. Run them before the deployment that needs them, and write them so the currently deployed code keeps working on the new schema (add first, remove in a later release). That keeps an instant rollback safe.

1. Reset the Neon `preview` branch from `main` (or delete it and branch it again from `main`), so the migration is tested against the current production schema and data shape. Previews read the new data from then on.
2. Take the **direct** (non-pooled) connection string of the target Neon branch.
3. Preview first:
   ```bash
   read -rs DATABASE_URL && export DATABASE_URL   # paste; not stored in shell history
   pnpm db:migrate
   ```
4. Check the preview deployment, then repeat step 3 with the production branch string.
5. Merge to `main`; Vercel deploys production.

Migration `0005` adds the nullable column `submission.post_id` with a unique index and fills it for existing rows from the post ID at the end of their link. Rows that share a post ID (one post stored under two handle spellings) are left empty, so the index cannot fail on existing data. The deployed code keeps working on the new schema; a submission it stores between the migration and the new deployment has no post ID and is matched as a duplicate by its exact link only.

Role grants go to the same database the same way:

```bash
pnpm role:grant G...FUNDER funder
pnpm role:grant G...REVIEWER reviewer
```

`role:grant` runs with `node --env-file=.env`, so a `.env` file must exist in the repository root (Node refuses to start without it). A `DATABASE_URL` already exported in the shell takes precedence over the value in the file.

## Preview and production separation

- Previews use the Neon `preview` branch, their own server keys, their own session secret and their own Upstash database. A preview can never read or write the production database or sign with production keys.
- Production scope variables are set only in Vercel's Production scope.
- Vercel Deployment Protection (Vercel Authentication) is turned on for preview deployments. Previews sign testnet transactions with the preview keys, so only the project's own Vercel team may open them.
- Wallet sessions do not cross over: cookies are host-only and signed with a different `SESSION_SECRET`.

## Rollback

Use Vercel Instant Rollback on the project's Deployments page to put the previous production deployment back on `proofwork.online`. It does not rebuild and does not touch the database, which is why migrations must stay backward-compatible. After a rollback Vercel stops assigning the domain to new `main` deployments until the rollback is undone or a deployment is promoted.

The database recovery path is Neon point-in-time restore: restore the `main` branch to a moment before the bad migration or write, or branch from that moment and point `DATABASE_URL` at the new branch.

On-chain state is never rolled back. Any escrow operation in flight is reconciled against chain state the next time it is prepared or submitted.

## Checks

Before the first push, and before making the repository public, scan the full history:

```bash
# Stellar secret seeds, private keys, credentials in URLs, secret assignments with a value
git rev-list --all | xargs git grep -nE '(^|[^A-Z2-7])S[A-Z2-7]{55}([^A-Z2-7]|$)'
git rev-list --all | xargs git grep -nE 'BEGIN [A-Z ]*PRIVATE KEY'
git rev-list --all | xargs sh -c 'git grep -nE "postgres(ql)?://[^:/@ ]+:[^@ ]+@" "$@" -- ":(exclude,glob)**/.env.example"' _ | grep -v '@localhost/'
git rev-list --all | xargs sh -c 'git grep -nE "(TW_API_KEY|SESSION_SECRET|UPSTASH_REDIS_REST_TOKEN|X_CLIENT_SECRET|X_BEARER_TOKEN)=[^ \$\`]+" "$@" -- ":(exclude,glob)**/.env.example"' _
# commit messages
git log --all --format=%B | grep -nE '(^|[^A-Z2-7])S[A-Z2-7]{55}([^A-Z2-7]|$)|BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?://[^:/@ ]+:[^@ ]+@|(TW_API_KEY|SESSION_SECRET|UPSTASH_REDIS_REST_TOKEN|X_CLIENT_SECRET|X_BEARER_TOKEN)=[^ ]+'
# .env files ever tracked, except .env.example at any depth
git log --all --name-only --pretty=format: | sort -u | grep -E '(^|/)\.env' | grep -vE '(^|/)\.env\.example$'
```

Every command must print nothing. The credentials-in-URL check drops `@localhost/` hosts, because the unit tests use a dummy `postgres://u:p@localhost/db`. `xargs` splits the revision list so a long history does not overflow the argument list; the `sh -c` wrapper keeps the revisions in front of `--`, so the `.env.example` exclusion (at any depth) applies to paths, not revisions.

After each production deployment, check the security headers:

```bash
curl -sI https://proofwork.online | grep -iE 'content-security-policy|strict-transport-security|x-content-type-options|referrer-policy|x-frame-options|permissions-policy|cross-origin-opener-policy'
curl -sI https://proofwork.online | grep -i 'content-security-policy' | grep -c "unsafe-eval"   # must print 0
curl -sI https://www.proofwork.online | grep -iE '^(HTTP|location)'                        # 308, location https://proofwork.online/
```

All seven headers must be present, and the CSP must contain `frame-ancestors 'none'` and no `'unsafe-eval'`. Then log in with a wallet on a campaign page.

The production smoke run (login, create and fund a small campaign, connect X and submit an own post, decide, appeal, approve, release, close, return the remainder) will create `docs/evidence/production-smoke.md` with its transaction hashes; the file does not exist until that run.
