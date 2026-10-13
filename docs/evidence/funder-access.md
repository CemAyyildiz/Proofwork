# Funder access evidence

A signed-in wallet asks for funder access in the app, the operator approves or rejects the request and revokes access on an admin page, and every grant and revocation of a role is written to an access log ([technical summary → Funder access](../technical-summary.md#funder-access)). This page records what has been checked so far: the unit tests, and one run through a local instance of the app. Nothing here touched the chain or the production database. The run on proofwork.online, and a revocation with real money in escrow, are listed as open at the end.

## Run 1: unit tests

Run: 2026-10-13 · `pnpm vitest run tests/unit/access.test.ts` · 66 tests pass. The whole suite (`pnpm test --maxWorkers=2`) passes with 612 tests in 30 files.

The service tests run on an in-process Postgres with every migration applied. The route and page tests call the real route handlers and server components with a signed session cookie; only the database connection and the escrow provider (the in-memory fake) are swapped.

| Scenario | What the tests assert |
|---|---|
| Request | A pending request is stored for the session wallet; `/campaigns` shows it as pending without the form; the admin overview lists it. The wallet comes from the session, and extra fields in the body are dropped |
| Second request | Refused with 409. Two requests sent at once: one stored, the other 409. The one-pending rule holds in the database itself |
| Already a funder | Refused with 409, nothing stored |
| Bad input | No team, a team name under 2 or over 80 characters, an empty note, a note over 500 characters, a non-string: 400, nothing stored. No session: 401 |
| Rate limit | The 6th request in an hour from one wallet answers 429, also when the wallet changes address every time |
| Form fields | The form has exactly two fields, `team` and `note`, and no email or phone input |
| Approve | Request approved with the ops wallet and time; funder role granted; one `grant` entry naming the ops wallet and the request |
| Same session | A wallet is refused a campaign (403), asks, is approved, and posts the campaign again with the cookie it had before approval: 200, campaign stored under its wallet |
| Reject | Request rejected, no role, no log entry; the wallet can ask again |
| Revoke | Role removed, one `revoke` entry; create, deploy and fund answer 403; the wallet can ask again |
| Revoked with a funded campaign | The campaign page still renders and `/campaigns` lists the campaign; approve, release and close each answer 200 through the payouts route and the campaign ends closed with the payout released; the review log downloads. Against the in-memory escrow |
| Revoked, never funded | The campaign page is a not-found page |
| Ownership still decides | Another wallet with the funder role gets 403 from approve, release and close on a campaign it does not own; signed out gets 401 |
| Decide twice | Approving or rejecting a request that is no longer pending: 409, nothing changes, no second entry. Two approvals at once: one wins, one grant, one entry |
| Not ops | A funder, a reviewer and the requester itself: every read and mutation is refused in the service (403 from the route with a valid body), the request stays pending, no role changes and no entry is written. The admin page is a not-found page for them. An `ops` grant scoped to one campaign does not count |
| Script path | Grant and revoke through the function the script calls: only the named role changes, each entry is marked `script` with no acting wallet |
| No-op change | Granting a role already held or revoking one not held returns "nothing changed" and writes no entry. Two identical grants at once write one entry |
| A failed change writes no entry | With the log table made to refuse inserts: a grant is not kept, a revocation is not kept, and an approval leaves the request pending with no role. A grant refused by the database writes no entry |
| Admin page | For ops: pending requests with Approve and Reject, funders with Revoke, and every log entry newest first with wallet, role, action, the acting wallet or "script", and the time. Signed out: the connect prompt and nothing else |
| Navigation | The Admin item appears for the ops wallet only |
| One place writes roles | A search of `src/` and `scripts/` finds an insert into or delete from `role_grant` only inside `changeRole`, an insert into `access_log` only there, and no update or delete of `access_log` anywhere |

## Run 2: local app

Run: 2026-10-13, 09:35 UTC · App: a local instance of this repository (`next dev`) at commit `b469be2` plus this change, on a scratch Postgres 17 database with migrations 0000 to 0006 applied through `pnpm db:migrate`. Throwaway server keys; the Trustless Work and Horizon hosts pointed at a closed local port, so no request left the machine. Four fresh keypairs signed in with the wallet challenge. Wallets are shown truncated.

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
- **Rate limit against Upstash.** The limit was checked with the in-memory limiter the tests and `next dev` use, not the Upstash one production uses.
