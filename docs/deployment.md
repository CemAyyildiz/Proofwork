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
| `UPSTASH_REDIS_REST_URL` | production Upstash database | preview Upstash database |
| `UPSTASH_REDIS_REST_TOKEN` | production Upstash database | preview Upstash database |
| `DEFAULT_DISPUTE_RESOLVER_PUBKEY` | optional, public key only | optional |

Never set on Vercel: `FUNDER_SECRET`, `DISPUTE_RESOLVER_SECRET`. They are used only by local scripts (`pnpm spike`, `pnpm escrow:close`) and must stay on the operator's machine.

Preview deployments also run with `NODE_ENV=production`, so they need Upstash too. Without Upstash the rate limiter throws `Upstash rate limiting is required in production` on the first rate-limited request (wallet login is one), so a missing value shows up in the smoke test at once.

After generating preview keys, run `pnpm accounts:prepare` with them in a local `.env` so the accounts exist on testnet and hold the USDC trustline.

No absolute site URL is configured: nothing in the code builds one, so `SITE_URL` is not needed.

## Client IP and rate limits

Rate-limit keys combine the client IP (`clientIp` in `src/lib/http.ts`) with the wallet public key. On Vercel the `x-forwarded-for` header is set by the platform: Vercel overwrites any value the client sends and does not forward external IPs, and `x-real-ip` carries the same address ([Vercel request headers](https://vercel.com/docs/headers/request-headers#x-forwarded-for)). A client therefore cannot spoof its IP to escape the limit. Behind another proxy, or under bare `next start`, that no longer holds and the key must come from a header that the proxy in front sets.

The Trustless Work client limits itself to 50 requests per 60 s inside one server instance. Vercel can run several function instances at once, and each one counts on its own, so the combined rate can go over the provider's limit under load. For the Month 1 campaign (one hand-run campaign, a few operators) that is accepted: escrow calls come from the funder and the operator, not from contributors, and the client waits for `Retry-After` and retries once on HTTP 429.

## Database migrations

Migrations are run by hand, never during the build. Run them before the deployment that needs them, and write them so the currently deployed code keeps working on the new schema (add first, remove in a later release). That keeps an instant rollback safe.

1. Take the **direct** (non-pooled) connection string of the target Neon branch.
2. Preview first:
   ```bash
   read -rs DATABASE_URL && export DATABASE_URL   # paste; not stored in shell history
   pnpm db:migrate
   ```
3. Check the preview deployment, then repeat step 2 with the production branch string.
4. Merge to `main`; Vercel deploys production.

Role grants go to the same database the same way:

```bash
pnpm role:grant G...FUNDER funder
pnpm role:grant G...REVIEWER reviewer
```

`role:grant` loads `.env` with `node --env-file`, and a `DATABASE_URL` already exported in the shell takes precedence over the file.

## Preview and production separation

- Previews use the Neon `preview` branch, their own server keys, their own session secret and their own Upstash database. A preview can never read or write the production database or sign with production keys.
- Production scope variables are set only in Vercel's Production scope.
- Wallet sessions do not cross over: cookies are host-only and signed with a different `SESSION_SECRET`.

## Rollback

Use Vercel Instant Rollback on the project's Deployments page to put the previous production deployment back on `proofwork.online`. It does not rebuild and does not touch the database, which is why migrations must stay backward-compatible. After a rollback Vercel stops assigning the domain to new `main` deployments until the rollback is undone or a deployment is promoted.

On-chain state is never rolled back. Any escrow operation in flight is reconciled against chain state the next time it is prepared or submitted.

## Checks

Before the first push, and before making the repository public, scan the full history:

```bash
git grep -nE '\bS[A-Z2-7]{55}\b' $(git rev-list --all)
git grep -nE 'BEGIN [A-Z ]*PRIVATE KEY' $(git rev-list --all)
git log --all --name-only --pretty=format: | sort -u | grep -E '(^|/)\.env' | grep -v '^\.env\.example$'
```

All three must print nothing.

After each production deployment, check the security headers:

```bash
curl -sI https://proofwork.online | grep -iE 'content-security-policy|strict-transport-security|x-content-type-options|referrer-policy|x-frame-options'
```

The CSP must contain `frame-ancestors 'none'`. Then log in with a wallet on a campaign page.

The production smoke run (login, create and fund a small campaign, submit, decide, appeal, approve, release, close, return the remainder) records its transaction hashes in `docs/evidence/production-smoke.md`.
