# Funder access evidence

A signed-in wallet asks for funder access in the app, the operator approves or rejects the request and revokes access on an admin page, and every grant and revocation of a role is written to an access log ([technical summary → Funder access](../technical-summary.md#funder-access)). This page records what has been checked so far: the unit tests, and one run through a local instance of the app. Nothing here touched the chain or the production database. The run on proofwork.online, and a revocation with real money in escrow, are listed as open at the end.

## Run 1: unit tests

Run: 2026-10-13 · `pnpm vitest run` on `tests/unit/access.test.ts` (87 tests), `tests/unit/role-grant-args.test.ts` (13) and `tests/unit/shell.test.ts` (17) · 117 tests pass. The whole suite last ran at commit `d583f95`, before the changes that review asked for: 612 tests in 30 files.

The service tests run on an in-process Postgres with every migration applied. The route and page tests call the real route handlers and server components with a signed session cookie; only the database connection and the escrow provider (the in-memory fake) are swapped.

That in-process Postgres has one connection. Where a row below says two calls were issued together, both promises were started before either was awaited and the database ran them one after the other, so these tests show the outcome of the second call, not a race. What holds under real concurrency is in the database and is asserted directly: the partial unique index on pending requests, the `UPDATE … WHERE status = 'pending'` that decides a request, and `INSERT … ON CONFLICT DO NOTHING` on the role's unique index. No test here runs two connections against each other.

| Scenario | What the tests assert |
|---|---|
| Request | A pending request is stored for the session wallet; `/campaigns` shows it as pending without the form; the admin overview lists it. The wallet comes from the session, and extra fields in the body are dropped |
| Second request | Refused with 409. Two requests issued together (run serialised, see above): one stored, the other 409. A second pending row for the same wallet is refused by the index when inserted directly |
| Already a funder | Refused with 409, nothing stored |
| Bad input | No team, a team name under 2 or over 80 characters, an empty note, a note over 500 characters, a non-string: 400, nothing stored. No session: 401 |
| Rate limit | The 6th request in an hour from one wallet answers 429, also when the wallet changes address every time. From one address with a fresh wallet per request, the 21st answers 429 and 20 requests are stored |
| Form fields | The form has exactly two fields, `team` and `note`, and no email or phone input |
| Approve | Request approved with the ops wallet and time; funder role granted; one `grant` entry naming the ops wallet and the request |
| Same session | A wallet is refused a campaign (403), asks, is approved, and posts the campaign again with the cookie it had before approval: 200, campaign stored under its wallet |
| Reject | Request rejected, no role, no log entry; the wallet can ask again |
| Revoke | Role removed, one `revoke` entry; create, deploy and fund answer 403; the wallet can ask again |
| Revoked with a funded campaign | The campaign page still renders and `/campaigns` lists the campaign; approve, release and close each answer 200 through the payouts route and the campaign ends closed with the payout released; the review log downloads. Against the in-memory escrow |
| Revoked, never funded | The campaign page is a not-found page. On a campaign that was deployed but not funded, approve, prepare release, prepare close and the submit of a close prepared before the revocation all answer 403; the campaign stays open and the close is never sent |
| Revoked with a fund already submitted | The fund transaction landed but its record stayed at `submitted`. After the revocation the owner's prepare-fund call reads the chain, confirms the op and marks the campaign funded; from then on the campaign page and the payouts route open. Deploy still answers 403, and so does another wallet on the same call |
| Revoked, no new money | A fund prepared but never submitted: prepare and submit answer 403. A fund that failed without landing: the chain is read, shows nothing and the op is rebuilt, and its submit answers 403. In both the escrow balance and `funded_at` are unchanged |
| Ownership still decides | Another wallet with the funder role gets 403 from approve, release and close on a campaign it does not own; signed out gets 401. A release and a close prepared by the owner and submitted by that other wallet: 403 from the route and from the service called directly, the payout still approved, the campaign still open |
| Decide twice | Approving or rejecting a request that is no longer pending: 409, nothing changes, no second entry. Two approvals issued together (run serialised): one wins, one grant, one entry |
| Not ops | A funder, a reviewer and the requester itself: every read and mutation is refused in the service (403 from the route with a valid body), the request stays pending, no role changes and no entry is written. The admin page is a not-found page for them. An `ops` grant scoped to one campaign does not count |
| Script path | Grant and revoke through the function the script calls: only the named role changes, each entry is marked `script` with no acting wallet |
| Script arguments | Wallet and role is a grant; `--revoke` after the role is a revocation of that role. A key that is not a Stellar public key, an unknown role, an unknown flag, a fourth argument and `--revoke` in any other place are refused. The database line the script prints holds the host and database name and no user, password or query |
| No-op change | Granting a role already held or revoking one not held returns "nothing changed" and writes no entry. Two identical grants issued together (run serialised) write one entry |
| A failed change writes no entry | With the log table made to refuse inserts: a grant is not kept, a revocation is not kept, and an approval leaves the request pending with no role. A grant refused by the database writes no entry |
| Admin page | For ops: pending requests with Approve and Reject, funders with Revoke, and the log newest first with wallet, role, action, the acting wallet or "script", and the time. An entry scoped to a campaign names the campaign. Signed out: the connect prompt and nothing else |
| Admin page limits | With 101 pending requests the page reads the 100 oldest and says more are waiting; with more than 200 log entries it reads the 200 newest and says so. Neither line shows when the lists fit |
| Admin rate limit | The 61st call to the admin route in ten minutes from one wallet answers 429; the operator's own count is separate |
| Access removed | A funder granted with the script and then revoked, with no request on record, sees "Funder access removed". After asking again it sees pending, and after a rejection "Request not approved". A revocation newer than an old rejection shows as removed |
| Reviewer on `/campaigns` | A reviewer without the funder role sees the request form, or its pending request, and a link to the review queue; it is not redirected. A reviewer that lost funder access sees its funded campaign, the removal and the link |
| Navigation | The Admin item appears for the ops wallet only. Every signed-in wallet has a `/campaigns` item: "Campaigns" for a funder and for a revoked funder that owns a funded campaign, "Run a campaign" otherwise. Signed out there is none |
| One place writes roles | A search of `src/` and `scripts/` finds an insert into or delete from `role_grant` only inside `changeRole`, an insert into `access_log` only there, and no update or delete of `access_log` anywhere |

## Run 2: local app

Run: 2026-10-13, 09:35 UTC · App: a local instance of this repository (`next dev`) with the code of commit `f29061c`, on a scratch Postgres 17 database with migrations 0000 to 0006 applied through `pnpm db:migrate`. Throwaway server keys; the Trustless Work and Horizon hosts pointed at a closed local port, so no request left the machine. Four fresh keypairs signed in with the wallet challenge. Wallets are shown truncated.

This run has not been repeated since. One output below changed afterwards: `pnpm role:grant` now prints a first line naming the database host and name before it changes anything. The behaviour added after the run is covered by Run 1 only: the address-only and admin rate limits, the limits on the two admin lists, the campaign scope in the log, the `/campaigns` navigation item, the reviewer no longer being redirected, "Funder access removed" for a script-granted funder, a revoked owner being refused on a deployed campaign it never funded, and the reconciliation of a fund submitted before a revocation.

| Name | Wallet | Starts with |
|---|---|---|
| Operator | `GAZD…PT5R` | no role |
| Team | `GAXJ…KPPH` | no role |
| Second team | `GCWQ…I725` | no role |
| Other | `GD7H…4ZU4` | no role |

The one-time operator grant, with the script:

| Command | Output |
|---|---|
| `pnpm role:grant <operator> ops` | `granted ops for GAZD…PT5R; access log entry written` |
| the same command again | `GAZD…PT5R already has ops; nothing changed, no log entry` |

Request, as the team wallet:

| Step | Answer | What the page showed |
|---|---|---|
| `GET /campaigns` | 200 | "Request funder access" with the form; no "New campaign" |
| `POST /api/campaigns` | 403, "requires funder role" | |
| `POST /api/access/requests` with a one-letter team and an empty note | 400, both fields named | |
| `POST /api/access/requests` without a session | 401 | |
| `POST /api/access/requests` (team "Lumen Labs" and a note) | 200, `status: pending` | |
| the same again | 409, "a request from this wallet is already pending" | |
| `GET /campaigns` | 200 | "Funder access requested", "Pending", the team name; no form |

Not the operator:

| Step | Answer |
|---|---|
| `GET /admin` as the team wallet | 404, with neither the log nor the request on the page |
| `GET /admin` signed out | 200, the connect prompt only |
| `POST /api/admin/access` approve, as the team wallet, with the real request ID | 403, "requires ops role" |
| `POST /api/admin/access` revoke, as the team wallet | 403 |
| `POST /api/admin/access` signed out | 401 |
| Database afterwards | The request still pending; the log still holds only the operator's own grant |

Approve, create, revoke:

| Step | Answer | What the page showed |
|---|---|---|
| `GET /admin` as the operator | 200 | "Pending requests" with Lumen Labs, Approve, Reject, and the access log |
| `POST /api/admin/access` approve | 200, `status: approved` | |
| approve again, then reject | 409 both times, "this request has already been decided" | |
| `POST /api/campaigns` as the team, with the cookie from before the approval | 200, campaign `launch-week-…` created | |
| `GET /campaigns` as the team | 200 | "New campaign" and the campaign; no form |
| `GET /campaigns/<slug>` as the team | 200 | The campaign with "Deploy escrow" |
| `POST /api/admin/access` revoke the team | 200, `changed: true` | |
| revoke again | 200, `changed: false` | |
| `POST /api/campaigns` as the team | 403, "requires funder role" | |
| `POST /api/campaigns/<id>/escrow` prepare deploy, then prepare fund | 403 both | |
| `GET /campaigns/<slug>` (never funded) | 404 | |
| `GET /campaigns` as the team | 200 | "Funder access removed" with the form; no "New campaign" |

A revoked funder and a funded campaign. No escrow provider was reachable in this run, so the campaign above was marked deployed and funded by hand in the scratch database (`escrow_contract_id` and `funded_at` set with SQL). This shows which gate applies, not a payout:

| Step | Answer | What the page showed |
|---|---|---|
| `GET /campaigns/<slug>` as the team | 200 | The campaign with "Submissions and payouts" |
| `GET /campaigns` as the team | 200 | "Campaigns you funded" with the campaign; no "New campaign" |
| `POST /api/campaigns/<id>/payouts` prepare release, as the team | 200, `ops: []` (nothing approved to release) | |
| the same as the operator, who does not own the campaign | 403, "not the funder of this campaign" | |
| `POST /api/campaigns/<id>/escrow` prepare fund, as the team | 403, "requires funder role" | |

Reject, then ask again:

| Step | Answer |
|---|---|
| `POST /api/access/requests` as the second team | 200, pending |
| `POST /api/admin/access` reject | 200, `status: rejected` |
| `GET /campaigns` as the second team | 200, "Request not approved" with the form |
| `POST /api/campaigns` as the second team | 403 |
| `POST /api/access/requests` as the second team, again | 200, pending |
| `POST /api/access/requests` as the revoked team | 200, pending |

The script, one role at a time, on the fourth wallet:

| Command | Output |
|---|---|
| `pnpm role:grant <other> funder` | `granted funder for GD7H…4ZU4; access log entry written` |
| `pnpm role:grant <other> reviewer` | `granted reviewer for GD7H…4ZU4; access log entry written` |
| `pnpm role:grant <other> reviewer --revoke` | `revoked reviewer for GD7H…4ZU4; access log entry written` |
| the same revoke again | `GD7H…4ZU4 does not have reviewer; nothing changed, no log entry` |
| `pnpm role:grant <other> admin` | exit 2, "role must be funder, reviewer or ops" |
| `pnpm role:grant GNOTAKEY funder` | exit 2, "not a Stellar public key (G...)" |

`role_grant` afterwards: the operator's `ops` and the fourth wallet's `funder`. The revoke removed the reviewer role only.

`access_log` at the end of the run, read with `psql`, oldest first:

| Time (UTC) | Wallet | Role | Action | Acting wallet | Via | Has a request |
|---|---|---|---|---|---|---|
| 09:35:22 | `GAZD…PT5R` | ops | grant | none | script | no |
| 09:35:24 | `GAXJ…KPPH` | funder | grant | `GAZD…PT5R` | admin | yes |
| 09:35:24 | `GAXJ…KPPH` | funder | revoke | `GAZD…PT5R` | admin | no |
| 09:35:27 | `GD7H…4ZU4` | funder | grant | none | script | no |
| 09:35:28 | `GD7H…4ZU4` | reviewer | grant | none | script | no |
| 09:35:29 | `GD7H…4ZU4` | reviewer | revoke | none | script | no |

Six changes, six rows. The refused calls, the two no-op script runs, the second revoke and the rejection left none.

`funder_request` at the end: Lumen Labs approved by the operator; Second Team rejected by the operator; one new pending request from each.

The admin page, as the operator, showed the same six entries newest first:

```
2026-10-13 09:35:29 UTC | GD7H…4ZU4 | reviewer | revoke | script
2026-10-13 09:35:28 UTC | GD7H…4ZU4 | reviewer | grant  | script
2026-10-13 09:35:27 UTC | GD7H…4ZU4 | funder   | grant  | script
2026-10-13 09:35:24 UTC | GAXJ…KPPH | funder   | revoke | GAZD…PT5R
2026-10-13 09:35:24 UTC | GAXJ…KPPH | funder   | grant  | GAZD…PT5R
2026-10-13 09:35:22 UTC | GAZD…PT5R | ops      | grant  | script
```

The pages were also opened in headless Chrome at 1280 and 390 pixels wide (request form, pending state, admin page). No screenshot is committed.

Build check on the same day: `pnpm build` succeeds and lists `/admin`, `/api/access/requests` and `/api/admin/access`.

## Not recorded yet

- **On proofwork.online.** Migration `0006` has not been applied to the preview or production database, and no wallet there holds `ops`. The run to record: grant `ops` with the script, request from a wallet that never had a role, approve on `/admin`, create a campaign, and read the log on the admin page.
- **Revocation with money in escrow.** Approve, release and close by a revoked funder have run against the in-memory escrow only. The local run set the funded state by hand and stopped at the gate. A testnet run would revoke a funder after funding and then release a payout and close the campaign, with the transaction hashes.
- **The buttons in a browser.** The local run posted to the routes directly with a session cookie. Approve, Reject and Revoke have not been clicked with a wallet extension signed in.
- **Two connections at once.** Every "issued together" case above ran on one connection, one call after the other. A double request, a double approval and a double grant from two real connections against Postgres have not been run.
- **Rate limit against Upstash.** The limit was checked with the in-memory limiter the tests and `next dev` use, not the Upstash one production uses.
