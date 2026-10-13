# X account connection evidence

A signed-in wallet connects its X account with Sign in with X, and the app binds the wallet to that account's numeric ID, one to one ([technical summary → X account connection](../technical-summary.md#x-account-connection)). A submission is then accepted only for a post that account wrote: the server asks X for the post's author by post ID ([technical summary → Post author check](../technical-summary.md#post-author-check)). This page records what has been checked so far. Neither part has been run against X yet: that needs an X developer app, and the run is listed as open at the end. Everything below ran against the in-memory fake, a fetch stub, or a local app that never contacted X.

## Run 1: unit tests against the fake and the fetch stub

Run: 2026-10-13 · `pnpm vitest run` on the five files named in the table (`x-api`, `x-account`, `x-routes`, `env`, `public-states`) · 157 tests pass.

X sits behind a port (`src/x/port.ts`). The service and route tests use the in-memory fake (`src/x/fake.ts`) and an in-process Postgres with every migration applied; the adapter tests give the real adapter (`src/x/api.ts`) a stubbed `fetch`.

This run was made before the post-author check existed. Two rows read differently now and are covered by Run 3: the X settings are a set of four (`X_BEARER_TOKEN` was added), and the step shown without them also says that submissions are not possible.

| Scenario | What the tests assert | Where |
|---|---|---|
| Connect | Row `(wallet, 111)` with a timestamp; the callback returns to `/c/<slug>?x=connected#submit` | `tests/unit/x-account.test.ts`, `tests/unit/x-routes.test.ts` |
| Same pair again | Success, still one row | `x-account.test.ts` |
| X account taken | Second wallet gets `taken`; nothing stored for it. Two wallets racing for one account: exactly one wins | `x-account.test.ts` |
| Wallet already bound | Outcome `wallet_bound`; the first account stays | `x-account.test.ts` |
| Denied on X | `error=access_denied` gives `cancelled`; nothing stored, X not called | `x-account.test.ts`, `x-routes.test.ts` |
| Bad state | State missing, different, expired at 10 minutes, or issued to another wallet; cookie missing, edited or signed with the session key: nothing stored, X not called, `retry` | `x-account.test.ts`, `x-routes.test.ts` |
| Not signed in | Start and callback, each without a session and with a session revoked by logout: no redirect to X, nothing stored, `signin` | `x-account.test.ts`, `x-routes.test.ts` |
| X fails | Token exchange or account lookup times out, cannot connect, answers non-200, answers non-JSON or an unexpected body: typed error, nothing stored, `x_failed` | `tests/unit/x-api.test.ts`, `x-account.test.ts` |
| Not configured | No X values: no adapter is wired, the page step is muted with no link, and a start request does not redirect to X (`unavailable`). One or two of the three values, or a redirect URI that is not `https://<host>/api/x/callback` (http only on localhost; no query, fragment or credentials): the config refuses to load | `x-account.test.ts`, `x-routes.test.ts`, `tests/unit/env.test.ts`, `tests/unit/public-states.test.ts` |
| Callback opened twice | The callback clears the flow cookie, so the second request from that browser finds none, binds nothing and X is called once in total. Not covered, because the server keeps no used-flow record: a replay that still carries the cookie would reach X and rely on X refusing the spent code | `x-routes.test.ts` |
| No flow cookie | As when X sends the contributor back to another browser: nothing bound, X not called, redirect to `/explore?x=retry` (or `signin` without a session), one warning line with no request data | `x-routes.test.ts`, `public-states.test.ts` |
| Something breaks | A failing database on either route, or a start request without a valid slug: a redirect, never JSON (`x_failed` on the campaign page when the slug is known, the campaign list otherwise), and one log line with the error's kind and no request data | `x-routes.test.ts` |
| X account ID format | Only 1 to 19 digits with no leading zero is accepted from X or stored | `x-api.test.ts`, `x-account.test.ts` |
| Request shape | Authorize URL: `x.com/i/oauth2/authorize`, `response_type=code`, PKCE `S256`, scope `users.read tweet.read`, no `offline.access`, no client secret. Token call: `POST api.x.com/2/oauth2/token`, form-encoded, HTTP Basic, no `client_id` in the body. Lookup: `GET api.x.com/2/users/me` with the bearer token. Redirects are refused on both | `x-api.test.ts` |
| Only the ID leaves the adapter | With a handle and display name in X's reply, the adapter returns exactly `{ xUserId }` | `x-api.test.ts` |
| Nothing else is stored | `x_account` has the columns `pubkey`, `x_user_id`, `connected_at`; no table has a column for a token, handle, name or verifier | `x-account.test.ts` |
| Logs | On the failure paths, run through the real adapter with X echoing the code, the token and a handle in its error replies, captured stdout and stderr hold one line with the failed step and HTTP status and no authorization code, access token, verifier, state, client secret or handle. The thrown errors carry none either. A bind, or a refused bind, leaves one line with the wallet and the outcome and never the X account ID; an authorize error from X is logged only as one of the OAuth error codes or `other` | `x-api.test.ts`, `x-account.test.ts`, `x-routes.test.ts` |
| Rate limit | The 11th start, and the 11th callback, inside 10 minutes from one address and wallet returns `rate_limited`; X is not called | `x-routes.test.ts` |

## Run 2: local app, X never contacted

Run: 2026-10-13, about 08:00 UTC · App: a local instance of this repository (`next dev`) on a scratch Postgres 17 database with migrations 0000 to 0004 applied, throwaway server keys, one open campaign inserted by hand. Fresh keypairs signed in with the wallet challenge. No request reached X in any step.

This run was made at commit `d3f5ad2` and has not been repeated. Four answers changed afterwards and are covered by Run 1 only: return paths now end in `#submit`; a start request with a bad slug redirects to `/explore?x=retry` instead of answering 400; a callback without a flow cookie goes to `/explore?x=<outcome>` instead of bare `/explore`; and without the `X_*` variables the page shows the step as "Not available yet" with no link. The tables below are what was observed at the time.

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

## Run 3: post-author check, unit tests against the fake and the fetch stub

Run: 2026-10-13 · commit `6815f13` · `pnpm vitest run` on the seven files named in the table (`x-api` 57, `submission-create` 53, `public-states` 38, `env` 34, `funding-link` 31, `post-id-backfill` 7, `submission-url` 6) · 226 tests pass. The whole suite, `pnpm test --maxWorkers=2`: 538 tests pass.

The service tests run `createSubmission` on an in-process Postgres with every migration applied, with wallets bound to X accounts in `x_account` and the post-author lookup injected: the in-memory fake, or the real adapter over a stubbed `fetch`.

| Scenario | What the tests assert | Where |
|---|---|---|
| Own post | A wallet bound to account 111 submits a post X says 111 wrote: one row, with the post ID and the link as typed. X is asked once, about the numeric post ID alone, whatever host, handle, query or fragment the link carried | `tests/unit/submission-create.test.ts` |
| Someone else's post | X names another account: 403 "this post was written by another X account", no row. The handle in the link changes nothing in either direction | `submission-create.test.ts` |
| No X account | 409 "connect your X account first"; neither X nor Horizon is asked, no row | `submission-create.test.ts` |
| Post not found | The adapter answers "not found" for a 200 whose `errors` hold a `resource-not-found` problem, a 404 with that problem as its body or under `errors`, a `not-authorized-for-resource` problem (a protected account) on a 200 or 403, and the same problem named on the older `api.twitter.com` host. The service answers 404 "this post could not be found on X, it must be public", no row | `tests/unit/x-api.test.ts`, `submission-create.test.ts` |
| X cannot answer | Timeout, request that cannot be made, 400, 401, 403 without that problem, 404 without it, 429, 500, 502, 503, a body that is not JSON, a post without a usable author ID, and a deployment with no X values (the default lookup over an environment without them): 502 "couldn't check the post with X, try again", no row. A 5xx carrying a not-found problem is still a failure, not an answer | `x-api.test.ts`, `submission-create.test.ts` |
| Same post, other handle | After `x.com/alice/status/999` is stored, `x.com/ALICE_/status/999`, `twitter.com/bob/status/999`, the link with a tracking tail and the same link are each refused as already submitted, in the same campaign and in another one, and X is not asked again | `submission-create.test.ts` |
| Concurrent duplicate | Two wallets held at the lookup until both have passed every check, then released: one row, and the other request gets "this post has already been submitted" from the unique index. One wallet sending two posts at once keeps one and gets "you already submitted to this campaign" for the other | `submission-create.test.ts` |
| Earlier rows | On a database built from the migrations before `0005` and holding rows: every row and link survives; a post ID no other row shares is set; two rows for one post under two handle spellings both stay empty and the migration still succeeds; an ID with a leading zero or 20 digits stays empty; the index then refuses a second row for a post ID and allows any number of rows without one. An earlier row counts as a duplicate by its post ID under any handle, or by its exact link when it has none | `tests/unit/post-id-backfill.test.ts`, `submission-create.test.ts` |
| Earlier decisions | A decision stored before the migration is the same row afterwards; read as `/verify` reads it, its canonical JSON still hashes to the stored hash and its signals and outcome are unchanged; its review log row is unchanged and the export has no post ID column | `post-id-backfill.test.ts`, `tests/unit/funding-link.test.ts` |
| Request shape | `GET https://api.x.com/2/tweets/<id>?expansions=author_id` and no other parameter, `Authorization: Bearer <app token>`, no body, redirects refused, the client secret not sent. A value that is not a post ID (empty, letters, a leading zero, 20 digits, a path or query smuggled in) never produces a request | `x-api.test.ts` |
| Only the author ID leaves the adapter | With the post text, the handle and the display name in X's reply (`data.text`, `data.username`, `includes.users`), the adapter returns exactly `{ found: true, authorId }`. Run through the service with the real adapter: an accepted submission writes no log line, and neither the returned row nor the table holds the text, the handle, the name, the token or the author ID | `x-api.test.ts`, `submission-create.test.ts` |
| Logs | A failed lookup leaves one line holding the time, level, message, campaign, wallet, step, reason and HTTP status, plus the reset time on a 429, and nothing else. With X echoing the post text, a handle and the token in its error replies, none of them appears in the captured stdout and stderr or in the thrown error, and the contributor's error carries no detail of the failure. Refusals that are not lookup failures write no line | `x-api.test.ts`, `submission-create.test.ts` |
| Quota | X is not asked for a campaign that is closing, a duplicate, a wallet without an X account or a wallet without a USDC trustline; the funding source is not read for a post the check refuses | `submission-create.test.ts` |
| Post ID format | 1 to 19 digits with no leading zero; a leading zero or a 20th digit fails the link check, in the form and on the server alike | `tests/unit/submission-url.test.ts` |
| Configuration | All four X values or none; any partial set, the three Sign in with X values without the token included, and a token with a space, line break or non-ASCII character are refused | `tests/unit/env.test.ts` |
| Page | The X step says, before connecting, that submitting needs the connection and a post written by that account, and afterwards that a post from another account is refused. Without X values it says submissions are not possible, connected or not, with nothing to press. The form's link field is disabled while locked | `tests/unit/public-states.test.ts` |

After review, commit `1983eb5` changed four things. The two test files that cover them were run again on 2026-10-13 (`submission-create` now 55 tests, `tests/unit/onboarding.test.ts` 34, all pass):

- An earlier row without a post ID counts under any handle or host: it is matched by the ID that ends its stored link, not only by its exact link. Tested with two such rows for one post and a third and fourth spelling of the link; a longer ID ending in the same digits is not taken for the same post.
- Whether the form is open is decided in one place, `onboardingView` in `src/components/contributor-state.ts`: the wallet can receive USDC, has an X account, and X is configured. Tested for a ready wallet without an X account, a connected wallet on a deployment without X credentials, neither, and an X account on a wallet without a trustline.
- The lookup-failure log line names its fields (step, reason, status, reset time); the assertions on the line's exact content are unchanged and pass.
- `POST /api/submissions` is also rate limited by wallet alone, so a wallet changing IPs cannot spend the X lookup quota. This is a route change with no unit test.

## Run 4: migration and local app, X never contacted

Run: 2026-10-13, about 08:50 UTC · commit `6815f13` · a scratch Postgres 17.5 database and a local instance of this repository (`next dev`) with throwaway server keys. Contributor wallets were fresh keypairs, activated with Friendbot on testnet, given a USDC trustline where noted and signed in with the wallet challenge; they were discarded after the run. No request reached X in any step.

**Migration `0005` on existing rows.** Migrations `0000` to `0004` were applied, then these rows were inserted by hand, one of them with a decision, and `pnpm db:migrate` applied `0005`:

| Link stored before | `post_id` after | Why |
|---|---|---|
| `https://x.com/alice/status/1841200000000000999` | `1841200000000000999` | no other row has this post |
| `https://x.com/bob/status/555` | empty | shares post 555 with the next row |
| `https://x.com/BOB/status/555` | empty | shares post 555 with the previous row |
| `https://x.com/carol/status/0777` | empty | not a post ID in the one accepted spelling |

All four rows and their links were unchanged, the `decision` table had the same checksum before and after, and `submission` had both `submission_work_url_idx` and the new `submission_post_id_idx`.

**Submissions without the four `X_*` variables**, to an open campaign inserted by hand, from one wallet with a USDC trustline:

| Request | Answer |
|---|---|
| `GET /c/<slug>`, wallet not X-connected | "Connect your X account. Not available yet. Submissions aren't possible until Proofwork can check with X who wrote a post." No link to press |
| `POST /api/submissions`, wallet not X-connected | 409 `CONFLICT` "connect your X account first" |
| `GET /c/<slug>` after an `x_account` row was inserted for the wallet by hand | "X account connected. Not available yet. Submissions aren't possible until Proofwork can check with X who wrote a post." |
| `POST` with `https://twitter.com/Someone_Else/status/1841200000000000999?s=20`, the backfilled post under another host and handle | 409 `CONFLICT` "this post has already been submitted" |
| `POST` with a new post | 502 `X` "couldn't check the post with X, try again", no detail in the body. Server log: one line `post author lookup failed` with campaign, wallet, `step: post`, `reason: not_configured` |
| `POST` with a leading-zero post ID, and with a 20-digit one | 400 `VALIDATION` each |

The `submission` table held the same four rows after these requests.

**The page with placeholder strings in the four variables** (not the credentials of any X app). The only submission sent in this mode came from a wallet without a trustline and was refused there, 409 "wallet needs a USDC trustline", before the lookup.

| State | Observed |
|---|---|
| Server HTML, wallet not X-connected | "Connect your X account. Sign in with X to tie this wallet to the account you post from. You can submit once it is connected, and only a post written by that account is accepted. …" with the Connect X link |
| Server HTML, wallet X-connected | "X account connected. Submit a post written by this account. Proofwork asks X who wrote it, and a post from another account is refused." No link |
| Headless Chrome, wallet with a trustline and no X account, after the wallet check finished | Link field disabled, Submit disabled |
| Headless Chrome, wallet with a trustline and an X account, after the wallet check finished | Link field enabled; Submit disabled until a valid link was typed, then enabled |

**Client bundle.** 2026-10-13, commit `1983eb5`: `pnpm build` with a distinct marker string in each of the four `X_*` variables. None of the 41 files under `.next/static` contained a marker value, a variable name (`X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`, `X_BEARER_TOKEN`), `/2/tweets`, `api.x.com`, `/2/oauth2` or the flow cookie's name. A string the client does ship, "Link to your post on X", was found by the same scan, so it was reading the bundle. The marker values appeared nowhere in `.next` or in the build output; the variable names and API paths are in the server output only.

## Run 5: live, against X

Not recorded yet. It needs an X developer app with an OAuth 2.0 client and a plan that includes post lookup ([deployment → Sign in with X](../deployment.md#sign-in-with-x), [Post-author lookup](../deployment.md#post-author-lookup)).

| Live row | Result |
|---|---|
| Connect an X account to a wallet | not recorded yet |
| Own post accepted | not recorded yet |
| Another account's post rejected | not recorded yet |

Steps, once the four variables are set and migrations 0004 and 0005 are applied:

1. On an open campaign, sign in with wallet A and press Connect X; approve on X with a test account. Record the date, the return to `?x=connected`, and the `x_account` row (wallet truncated, the fact that the ID is numeric, the timestamp).
2. Sign in with wallet B and connect the same X account. Record the return to `?x=taken` and that the table still has one row.
3. With wallet A, connect a second X account. Record `?x=wallet_bound` and that the row is unchanged.
4. With a third wallet, press Cancel on X's consent page. Record `?x=cancelled`.
5. Open a completed callback URL a second time. Record that nothing changes.
6. On X, under the test account's connected apps, record the access the app was granted (read only, no posting).
7. Search the deployment's application logs for the run and record that no handle, token or code appears in the app's own log lines.
8. With wallet A, which has a USDC trustline, submit a public post written by its connected account. Record the date, that the submission was accepted, its short ID, and that the row's `post_id` is the number in the link. This is also the first request the app sends to X's post lookup: record that it answered as `src/x/api.ts` expects.
9. With wallet A on a second open campaign, or with another connected wallet, submit a post written by a different X account. Record the 403 "this post was written by another X account" and that no row was added.
10. Submit the post from step 8 again from another connected wallet, as a `twitter.com` link with a different handle. Record the 409 "this post has already been submitted".
11. Submit a link to a deleted post or to a post of a protected account. Record the 404 "this post could not be found on X, it must be public".
12. Search the application logs for the run and record that no post text, handle or author ID appears in the app's own log lines.
13. Reposts, not confirmed either way: from the connected test account, repost a public post written by another account, take the repost's own post ID (not the original's), and submit a link with that ID from a connected wallet that has not submitted to the campaign. Record what X answered for that ID (found, and whether the author is the reposting account or the original one, or not found) and what the app did with the submission. If X names the reposting account, the submission is accepted and the limit in the technical summary stands as written; record that here.
