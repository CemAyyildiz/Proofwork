# X account connection evidence

A signed-in wallet connects its X account with Sign in with X, and the app binds the wallet to that account's numeric ID, one to one ([technical summary → X account connection](../technical-summary.md#x-account-connection)). This page records what has been checked so far. The flow has **not** been run against X yet: that needs an X developer app, and the run is listed as open at the end. Everything below ran against the in-memory fake, a fetch stub, or a local app that never contacted X.

## Run 1: unit tests against the fake and the fetch stub

Run: 2026-10-13 · `pnpm test --maxWorkers=2` · 412 tests in 28 files pass, 96 of them for this feature.

X sits behind a port (`src/x/port.ts`). The service and route tests use the in-memory fake (`src/x/fake.ts`) and an in-process Postgres with every migration applied; the adapter tests give the real adapter (`src/x/api.ts`) a stubbed `fetch`.

| Scenario | What the tests assert | Where |
|---|---|---|
| Connect | Row `(wallet, 111)` with a timestamp; the callback returns to `/c/<slug>?x=connected` | `tests/unit/x-account.test.ts`, `tests/unit/x-routes.test.ts` |
| Same pair again | Success, still one row | `x-account.test.ts` |
| X account taken | Second wallet gets `taken`; nothing stored for it. Two wallets racing for one account: exactly one wins | `x-account.test.ts` |
| Wallet already bound | Outcome `wallet_bound`; the first account stays | `x-account.test.ts` |
| Denied on X | `error=access_denied` gives `cancelled`; nothing stored, X not called | `x-account.test.ts`, `x-routes.test.ts` |
| Bad state | State missing, different, expired at 10 minutes, or issued to another wallet; cookie missing, edited or signed with the session key: nothing stored, X not called, `retry` | `x-account.test.ts`, `x-routes.test.ts` |
| Not signed in | Start and callback without a session, or with a session revoked by logout: no redirect to X, nothing stored, `signin` | `x-account.test.ts`, `x-routes.test.ts` |
| X fails | Token exchange or account lookup times out, cannot connect, answers non-200, answers non-JSON or an unexpected body: typed error, nothing stored, `x_failed` | `tests/unit/x-api.test.ts`, `x-account.test.ts` |
| Not configured | No X values: start does not redirect to X, `unavailable`. One or two of the three values: the config refuses to load | `x-account.test.ts`, `x-routes.test.ts`, `tests/unit/env.test.ts` |
| Callback opened twice | The second request finds no flow cookie, binds nothing and X is called once in total | `x-routes.test.ts` |
| Request shape | Authorize URL: `x.com/i/oauth2/authorize`, `response_type=code`, PKCE `S256`, scope `users.read tweet.read`, no `offline.access`, no client secret. Token call: `POST api.x.com/2/oauth2/token`, form-encoded, HTTP Basic, no `client_id` in the body. Lookup: `GET api.x.com/2/users/me` with the bearer token. Redirects are refused on both | `x-api.test.ts` |
| Only the ID leaves the adapter | With a handle and display name in X's reply, the adapter returns exactly `{ xUserId }` | `x-api.test.ts` |
| Nothing else is stored | `x_account` has the columns `pubkey`, `x_user_id`, `connected_at`; no table has a column for a token, handle, name or verifier | `x-account.test.ts` |
| Logs | On the failure paths, run through the real adapter with X echoing the code, the token and a handle in its error replies, captured stdout and stderr hold the failed step and HTTP status and no authorization code, access token, verifier, state, client secret or handle. The thrown errors carry none either | `x-api.test.ts`, `x-account.test.ts`, `x-routes.test.ts` |
| Rate limit | The 11th start, and the 11th callback, inside 10 minutes from one address and wallet returns `rate_limited`; X is not called | `x-routes.test.ts` |

## Run 2: local app, X never contacted

Run: 2026-10-13, about 08:00 UTC · App: a local instance of this repository (`next dev`) on a scratch Postgres 17 database with migrations 0000 to 0004 applied, throwaway server keys, one open campaign inserted by hand. Fresh keypairs signed in with the wallet challenge. No request reached X in any step.

Without the three `X_*` variables:

| Request | Answer | What the page showed |
|---|---|---|
| `GET /c/<slug>`, signed in | 200 | "Connect your X account" with the Connect X link, above the wallet check and the submit form |
| `GET /api/x/connect?slug=<slug>`, signed in | 307 to `/c/<slug>?x=unavailable`, no cookie set | "X sign-in is not available right now." |
| `GET /api/x/connect?slug=<slug>`, signed out | 307 to `/c/<slug>?x=signin`, no cookie set | "Connect your wallet first, then connect your X account." |
| `GET /api/x/connect?slug=https://evil.test` | 400, no `Location` | none |
| `GET /api/x/callback?state=a&code=b`, no flow cookie | 307 to `/explore`; flow cookie cleared | campaign list |

With placeholder strings in the three variables (not the credentials of any X app), to see what the app sends the browser to and what it does with a callback:

| Step | Observed |
|---|---|
| `GET /api/x/connect?slug=<slug>`, signed in | 307 to `https://x.com/i/oauth2/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `scope=users.read%20tweet.read`, a 43-character `state`, a 43-character `code_challenge` and `code_challenge_method=S256`; `Cache-Control: no-store` |
| Flow cookie set by that answer | `pw_x_flow`, `Path=/api/x`, `HttpOnly`, `SameSite=lax`. Chrome held it for `/api/x/callback` and did not send it to the campaign page |
| Callback with that state and `error=access_denied` | 307 to `/c/<slug>?x=cancelled`; cookie cleared; page: "The X connection was cancelled. Nothing was saved." |
| Callback with another state | 307 to `/c/<slug>?x=retry`; cookie cleared |
| The denied callback URL again, without the cleared cookie | 307 to `/explore`; nothing bound |
| Headless Chrome, campaign page under its CSP, click on Connect X (`x.com` mapped to a closed local port) | The browser requested `/api/x/connect`, followed the 307 and requested `https://x.com/i/oauth2/authorize?…`. No CSP violation was reported: `form-action 'self'` does not apply to a link |

Build check on the same day: `pnpm build` succeeds with no `X_*` variable set. Built once more with marker strings in the three variables, no file under `.next/static` contained a variable name, a marker value, `api.x.com`, an OAuth path or the flow cookie's name, and the marker values appeared nowhere in the build output.

## Run 3: live, against X

Not recorded yet. It needs an X developer app with an OAuth 2.0 client ([deployment → Sign in with X](../deployment.md#sign-in-with-x)). Steps, once the three variables are set and migration 0004 is applied:

1. On an open campaign, sign in with wallet A and press Connect X; approve on X with a test account. Record the date, the return to `?x=connected`, and the `x_account` row (wallet truncated, the fact that the ID is numeric, the timestamp).
2. Sign in with wallet B and connect the same X account. Record the return to `?x=taken` and that the table still has one row.
3. With wallet A, connect a second X account. Record `?x=wallet_bound` and that the row is unchanged.
4. With a third wallet, press Cancel on X's consent page. Record `?x=cancelled`.
5. Open a completed callback URL a second time. Record that nothing changes.
6. On X, under the test account's connected apps, record the access the app was granted (read only, no posting).
7. Search the deployment's application logs for the run and record that no handle, token or code appears in the app's own log lines.
