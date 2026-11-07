# Proofwork

**Human-verified bounties, settled on Stellar.**

[![Live app](https://img.shields.io/badge/live-proofwork.online-0b7a4b)](https://proofwork.online)
![Network](https://img.shields.io/badge/network-Stellar%20testnet-1f2937)
![Escrow](https://img.shields.io/badge/escrow-Trustless%20Work%20v1-1f2937)
![Program](https://img.shields.io/badge/Stellar%20Instawards-T%C3%BCrkiye%20chapter-1f2937)

A project funds a campaign budget into a [Trustless Work](https://trustlesswork.com) escrow. Contributors complete a task on X and submit the link to their post. A human reviewer checks every submission against a written six-signal rubric, and each decision is written to the Stellar ledger with a reason code and a hash of the full record. Approved contributors are paid in USDC straight from the escrow, and what is left goes back to the funder when the campaign closes.

Proofwork never holds the funds and has no authority to release them.

---

## Contents

- [Status](#status)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Review rubric](#review-rubric)
- [On-chain evidence](#on-chain-evidence)
- [Verify a decision yourself](#verify-a-decision-yourself)
- [Customer development](#customer-development)
- [Security](#security)
- [Known limits](#known-limits)
- [Roadmap](#roadmap)
- [Getting started](#getting-started)
- [Deployment](#deployment)
- [Project layout](#project-layout)

---

## Status

Built during the Stellar Instawards sprint, Stellar Türkiye chapter. **Testnet only.** Live at **[proofwork.online](https://proofwork.online)**.

| Month | Scope | Status |
|---|---|---|
| 1 · Sep 2026 | Escrow and submission, review layer with on-chain decisions, one campaign run end to end by Proofwork | Delivered |
| 2 · Oct 1 – Nov 1, 2026 | Campaigns run by other teams: funder access approved in the app, X account verification, multi-account warnings, rubric v2, team interviews, a pilot campaign | Built and live since 2026-10-21; pilot campaign with SubRosa on testnet being scheduled |
| 3 | Campaigns on mainnet, run by Stellar teams | Planned |

**Month 2 at a glance**

- **Funder access without the operator.** A team connects a wallet and asks for funder access in the app. The operator approves or rejects the request on `/admin`. Every grant and revocation goes into an append-only access log. Each funder is capped on open campaigns and total budget, and its wallet's USDC trustline and balance are checked before it can fund.
- **X account verification.** Contributors connect X (OAuth 2.0 with PKCE, read-only scopes). The app accepts only a post written by the contributor's connected account, checked by post ID through the X API. The only thing it stores is the X account ID.
- **Multi-account warning.** The reviewer sees how many other submissions in the same campaign come from wallets first funded by the same Stellar account. Friendbot and other public faucets don't count.
- **End-to-end live run** on proofwork.online on 2026-10-29: new wallets, access request through payout, nothing done outside the app's pages ([below](#month-2--live-run-on-proofworkonline-2026-10-29)).

- **Rubric v2.** The six signals and the gate stay. v2 adds guidance where Month 2 changed what the app checks before a reviewer sees a post, and every decision now records the rubric it was scored under ([Review rubric](#review-rubric)).
- **Team pilot campaign.** Being scheduled with SubRosa: a campaign on testnet run with SubRosa's own wallet, from the access request to the remainder return, reviewed under rubric v2. The full path was first [rehearsed](#month-2--team-path-rehearsal-2026-10-13) with a funder wallet that never had a role.

---

## How it works

### Experimental: sealed dual review

With `SEALED_DUAL_REVIEW_ENABLED=true`, a campaign funder or operator can assign two authorized reviewer wallets to one pending submission. Their rubric v2 assessments are timelock-encrypted in a zero-escrow Sub Rosa `ReceiptOnly` round and remain absent from Proofwork's database until both reveals and the canonical receipt verify. An authorized reviewer then selects the final human decision, and only that decision enters Proofwork's existing Stellar decision ledger. Single-review campaigns, X ownership checks, Trustless Work escrow, funder approval, payouts, remainder return, and `/verify` URLs are unchanged. See [the integration guide and security boundary](docs/sub-rosa-sealed-dual-review.txt) and [real testnet evidence](docs/evidence/sub-rosa-sealed-dual-review-testnet.json).

| Step | Who signs | What happens on-chain |
|---|---|---|
| Request funder access | Team wallet (login only) | Nothing; the operator approves on `/admin`, and the grant is logged |
| Create campaign, deploy escrow | Funder wallet | Multi-release escrow deployed with a "campaign close" milestone |
| Fund budget | Funder wallet | USDC moves into the escrow contract |
| Connect X, submit work | Contributor wallet (login only) | Nothing; the link is stored only if X says the connected account wrote the post |
| Review | Reviewer wallet (login only) | One `manage_data` + `memo_hash` transaction per decision, sent from the decision ledger account |
| Re-review (once) | Contributor requests, reviewer decides | A second decision under ledger key `pw:<id>:a1`, linked to the first by hash |
| Approve for payout | Platform keys | One milestone per approved submission, marked delivered and approved |
| Release | Funder wallet | One transaction per milestone; USDC goes to the contributor |
| Close | Funder wallet, then dispute resolver | Close milestone disputed; the resolver returns the remainder to the funder, less the 0.3% protocol fee |

**Escrow roles.** The funder is the release signer. The platform keys hold the platform address (they append milestones) and the service provider and approver roles (they mark milestones delivered and approved). A separate key is the dispute resolver. Platform keys can never move money: the funder's release signature is the final approval.

---

## Architecture

```
                 ┌──────────────────────── Next.js app (proofwork.online) ────────────────────────┐
 Funder wallet ──┤ /campaigns        request access · create · deploy · fund · approve · release  │
 Contributor  ───┤ /c/<slug>         wallet · USDC trustline · connect X · submit own post URL     │
 Reviewer     ───┤ /review           blind queue · six signals · reason code · one re-review       │
 Anyone       ───┤ /verify/<id>      canonical record + SHA-256 recomputed in the browser          │
 Operator     ───┤ /admin            funder access: approve · reject · revoke · access log         │
                 │                                                                                │
                 │ services (zod at every boundary, role + ownership check on every mutation)     │
                 │   ├─ escrow-ops: intent → submitted → confirmed, idempotency key per write     │
                 │   ├─ EscrowPort ── TrustlessWorkAdapter ──► Trustless Work Core API v1         │
                 │   ├─ DecisionLedger ── @stellar/stellar-sdk ──► Horizon (classic tx)           │
                 │   └─ XPort ── X API v2 (Sign in with X, post-author lookup)                    │
                 │ Postgres: campaigns, submissions, decisions, payouts, escrow ops,              │
                 │   roles, access requests, access log, X accounts                               │
                 └────────────────────────────────────────────────────────────────────────────────┘
                                   │                                   │
                        Soroban escrow contract              decision ledger account
                        (USDC, multi-release)               (manage_data + memo_hash)
                                   └────────── Stellar testnet ────────┘
```

**Key design decisions**

- **One multi-release escrow per campaign.** It is deployed with a single close milestone (Trustless Work v1 needs at least one) and funded once with the whole budget. A reward milestone is appended for each approved submission after funding, which was verified on testnet in the Week 1 spike.
- **The server prepares, the wallet signs.** The server builds every wallet-signed operation (deploy, fund, release, close). It accepts the signed envelope only if it hashes to exactly what was prepared, so the Trustless Work API key can never submit an arbitrary transaction.
- **Money state comes from the chain.** Every escrow write moves from intent to submitted to confirmed under an idempotency key. It is confirmed only after the escrow is read back and shows the effect. Nothing is shown as paid because of a database write alone.
- **Remainder return.** Trustless Work has no time-based auto-return. At the deadline the funder closes the campaign, which disputes the close milestone. The dispute resolver then signs `withdraw-remaining-funds`, with the escrow's funder as the only destination. The 0.3% protocol fee is taken here too.
- **Decision record.** Each decision is one classic Stellar transaction. The canonical JSON is stored with the decision and shown on `/verify/<id>`, and its SHA-256 is written on-chain as the memo hash.

| Field | Content |
|---|---|
| `manage_data` key | `pw:<submission id>`; the one-shot re-review writes `pw:<id>:a1` |
| `manage_data` value | `v2\|<PASS or FAIL>\|<reason code>\|<first 16 hex of the record hash>`; decisions scored under rubric v1 start with `v1` |
| `memo_hash` | SHA-256 of the canonical decision JSON |

**Stack:** Next.js (App Router, TypeScript strict) · Postgres + Drizzle · Trustless Work Core API v1 · Stellar Wallets Kit (Freighter) · `@stellar/stellar-sdk` · X API v2 · Upstash Redis (rate limits) · Vercel + Neon.

---

## Review rubric

**Current version: v2.** Before any money moves, a human reviewer answers the same six yes/no questions for every submission. A submission **passes at 4 of 6**. With **3 or fewer** it fails. A pass only makes the submission eligible for a reward: the funder's approval is the final human check.

| # | Signal | What it asks | Fail code |
|---|---|---|---|
| 1 | Account genuine | Real, established account rather than a throwaway | `R01_ACCOUNT` |
| 2 | Content original | Written by this person, not shared with other submissions | `R02_ORIGINAL` |
| 3 | Task actually done | Shows the person really used the product | `R03_TASK` |
| 4 | Follows the brief | Contains everything the brief asked for | `R04_BRIEF` |
| 5 | Single-account check | One person submitting once | `R05_MULTI` |
| 6 | Not spam / farming | A genuine contribution, not reward farming | `R06_SPAM` |

A **PASS** always carries `R00_PASS`. A **FAIL** carries the code of the main failed signal, chosen by the reviewer from the signals that actually failed. Each decision also has a short written note for the contributor, which is not on-chain. A contributor can ask for **one re-review** of a rejected submission while the campaign is open. It is recorded under `pw:<id>:a1` and carries the hash of the first decision.

**Every decision records its rubric.** A new decision's canonical record carries `"v":2,"rubric":"v2"`, and its on-chain value starts with `v2`. Decisions made under v1 keep their record exactly as it was written, so their hashes still match; `/verify` shows which rubric a decision used, and the review log export has a `rubric_version` column.

### What changed in v2

Month 1 gave no basis for changing a signal: 2 decisions, both PASS, no FAIL and no planted fakes, so no signal can be shown to miss or over-reject anything. v2 therefore keeps every signal, question, fail text, reason code and the 4-of-6 gate. What changed in Month 2 is what the app checks before a submission reaches the reviewer, and v2 tells the reviewer so.

| Signal | Change | Reason |
|---|---|---|
| 1. Account genuine | Guidance added: authorship is already verified, judge only how established the account is | Since Month 2 a post is accepted only if X names the contributor's connected account as its author, and one X account is linked to one wallet. In v1 the reviewer could not tell who wrote a post |
| 2. Content original | Guidance added: the same post cannot come in twice, look across different posts | Since Month 2 a post ID is stored once, under any handle or host, so exact resubmission is refused before review |
| 5. Single-account check | Guidance added: how to weigh the shared-funding note, and what its absence does not prove | Since Month 2 the review card shows how many submissions share a wallet funding source. v1 said nothing about it, and a count alone must not decide an outcome |
| 3, 4, 6 | None | Nothing in Month 2 changed what the reviewer sees for them |

<details>
<summary><strong>Full reviewer guide (v2): pass and fail examples for each signal</strong></summary>

### 1. Account genuine · fail code `R01_ACCOUNT`
*Question: is this a real, established account rather than a throwaway?*

*Rubric v2: The app has already checked that the connected X account wrote this post, and that this X account is linked to no other wallet. Judge only whether the account itself is established.*

| Counts as pass | Counts as fail |
|---|---|
| Account has a history of its own posts from before the campaign. *E.g. two-year-old account posting regularly about dev tools.* | Created just before or during the campaign, no post history, default avatar or throwaway handle pattern. *E.g. account made yesterday, zero earlier posts, handle like `user84736291`.* |

### 2. Content original · fail code `R02_ORIGINAL`
*Question: did this person write this themselves?*

*Rubric v2: The same post cannot be submitted twice, under any handle or link. Look for near-duplicates across different posts.*

| Counts as pass | Counts as fail |
|---|---|
| Wording is the author's own, not shared with other submissions. *E.g. a post describing the setup in the author's own words.* | Near-duplicate of another submission, or visibly pasted template text. *E.g. same three sentences as another submission with one word swapped.* |

### 3. Task actually done · fail code `R03_TASK`
*Question: does the post show the person really used the product?*

| Counts as pass | Counts as fail |
|---|---|
| Contains specifics only someone who tried it would know. *E.g. "Funding took two wallet prompts; the release showed up in about 5 s."* | No specifics; could have been written without trying the product. *E.g. "Just tried it, amazing product, highly recommend!"* |

### 4. Follows the brief · fail code `R04_BRIEF`
*Question: does the post contain everything the campaign brief asked for?*

| Counts as pass | Counts as fail |
|---|---|
| Every required element of the brief is present. *E.g. brief asks for a screenshot and a link; both are there.* | A required element is missing: no product mention, wrong link or wrong format. *E.g. brief asks for a link to the docs; the post links somewhere else.* |

### 5. Single-account check · fail code `R05_MULTI`
*Question: is this one person submitting once, not one person behind several accounts?*

*Rubric v2: A shared-funding note means the wallets were first funded by the same account, or one funded the other: compare writing style and timing before failing on it. No note, or a funding source that was not checked, is not proof of independence; wallets activated from Friendbot never link.*

| Counts as pass | Counts as fail |
|---|---|
| Nothing links this account to another submission in the same campaign. *E.g. distinct voice, posted at an unrelated time, wallet funded independently.* | Writing style, timing pattern or wallet funding source links it to another submission. *E.g. two submissions minutes apart, same phrasing, wallets funded from the same source.* |

### 6. Not spam / farming · fail code `R06_SPAM`
*Question: is this a genuine contribution rather than reward farming?*

| Counts as pass | Counts as fail |
|---|---|
| Says something specific about the product. *E.g. names one thing that worked and one that did not.* | Generic praise with no detail, or phrasing that matches known farming patterns. *E.g. "Great project! To the moon! #airdrop"* |

</details>

---

## On-chain evidence

Every hash below opens on [stellar.expert](https://stellar.expert/explorer/testnet) (Stellar testnet).

### Month 2 · Live run on proofwork.online, 2026-10-29

The whole Month 2 path, run once in the app's own pages with three Freighter wallets: a team wallet and a contributor wallet created for the run, and the operator. No script or database change was used between the access request and the payout. The Month 2 demo video was recorded from this run.

| Time (UTC) | Who | Step | Result |
|---|---|---|---|
| 11:08 | Team | Requests funder access | Pending ([screenshot](docs/screenshots/live-01-request-pending.jpg)) |
| 11:13 | Operator | Approves on `/admin` | Grant shown in the access log ([screenshot](docs/screenshots/live-02-admin-approved.jpg)) |
| 11:15 | Team | Creates a campaign: 1 USDC reward, 3 USDC budget | Limits: 0 of 2 campaigns, 0 of 100 USDC ([screenshot](docs/screenshots/live-03-limits.jpg)) |
| 11:15–11:16 | Team | Readiness check, adds the USDC trustline in the app, checks again | Not ready → ready ([before](docs/screenshots/live-04-not-ready.jpg), [after](docs/screenshots/live-05-ready.jpg)) |
| 11:16–11:20 | Team | Deploys and funds the escrow | Balance 3 USDC, read from Stellar ([screenshot](docs/screenshots/live-06-funded.jpg)) |
| before 11:25 | Contributor | Connects X (`users.read tweet.read`) | "X account connected" ([screenshot](docs/screenshots/live-07-sign-in-with-x.jpg)) |
| 11:25 | Contributor | Submits a post written by another account | Refused, nothing stored ([screenshot](docs/screenshots/live-08-other-account-refused.jpg)) |
| 11:25 | Contributor | Submits a post written by the connected account | In review ([screenshot](docs/screenshots/live-09-own-post-accepted.jpg)) |
| 11:25–11:28 | Operator | Reviews: six signals pass, PASS recorded on-chain | Decision [`dec_rkKU9cVIsC-L1GJKPdmVDw`](https://proofwork.online/verify/dec_rkKU9cVIsC-L1GJKPdmVDw) ([screenshot](docs/screenshots/live-10-review.jpg)) |
| 11:28–11:29 | Team | Approves and releases the payout | Paid, 1 of 1 released ([screenshot](docs/screenshots/live-11-paid.jpg), [on-chain activity](docs/screenshots/live-12-on-chain-activity.jpg)) |

| Transaction | Hash |
|---|---|
| Escrow deployed | [53fe7061…](https://stellar.expert/explorer/testnet/tx/53fe70612b9de4a4d24f611843aaa6ecc4dae39f49d910646c47705360ab0c92) |
| Budget funded | [ec3205b8…](https://stellar.expert/explorer/testnet/tx/ec3205b82b0c6c588d00ca6bad46b7fef92aaf98cf09150a075eae68b9a69327) |
| Review decision written | [e2002f4f…](https://stellar.expert/explorer/testnet/tx/e2002f4f0fc9d098023095075a7eeb4d61a3a14548efa9d40b425dd25231281c) |
| Payout milestone added | [8985571d…](https://stellar.expert/explorer/testnet/tx/8985571d631d9941e7587a6410ebdeb6bbe9a7b47d78217ce34cae714d28eab1) |
| Payout marked delivered | [ac32b4b0…](https://stellar.expert/explorer/testnet/tx/ac32b4b0342175f103ac7d4927ccf7fbdef90697cb7e294b300d4b2e5fc26360) |
| Payout approved | [55ef924d…](https://stellar.expert/explorer/testnet/tx/55ef924ddb36faf1950a6bbdda756931cbd97760b465de04c290b13623e78573) |
| Payout released | [4367ab0a…](https://stellar.expert/explorer/testnet/tx/4367ab0aa588449ac6da294d6a60e8375e8f2417ee0240d56c0cbc16af67c852) |

The contributor received 0.997 USDC: the 1 USDC reward less the 0.3% Trustless Work fee. The team wallet was [`GCGPQPQ4…V544WAP2`](https://stellar.expert/explorer/testnet/account/GCGPQPQ4FHXLO2R6H3HIVSCVYFGQAULTDC7OO5NTLAVCW4GBV544WAP2). This run did not show a multi-account warning, because both new wallets were created by Friendbot, which the check leaves out.

### Month 2 · Team path rehearsal, 2026-10-13

The path a team takes, run on testnet with a funder wallet that never had a role: access request, approval, readiness, deploy, fund, the per-funder caps (third deploy refused at 2 of 2), abandoning an unfunded campaign, revocation after funding, close, and the remainder return.

| Step | Hash |
|---|---|
| Deploy (after the wallet went from not ready to ready) | [5e5759254e86…](https://stellar.expert/explorer/testnet/tx/5e5759254e86e8dc08f1f5e3bfa7d3daa80fea4364e67578935ee0eae143f535) |
| Fund | [aa5f5a7fabdc…](https://stellar.expert/explorer/testnet/tx/aa5f5a7fabdca1670c090aeb57dac7c1fbe825ebde71be2cb8a609a543518ce0) |
| Close: dispute the close milestone | [543b1fd6c5e7…](https://stellar.expert/explorer/testnet/tx/543b1fd6c5e7ee68170eea975c0c1acbbc6c404ac70bae07a8d2bf05af84bf67) |
| Remainder returned, 4.985 of 5 USDC after the 0.3% fee | [2df7fde33230…](https://stellar.expert/explorer/testnet/tx/2df7fde332303415e48ed3c53163a1c3e1b8e512a5a2c68facdd8a8e0286bbb1) |
| Remainder returned in the app, signed by the resolver's own wallet with no server key | [3b7a2b91a5f4…](https://stellar.expert/explorer/testnet/tx/3b7a2b91a5f4e4d0638f38b5ddd6c455f2456201a6dc15690c7c90ce7d9bc1dd) |

### Month 2 · Shared funding source, 2026-10-12

Four new wallets: P and D were activated by Friendbot, then P created B and C. The app read each wallet's creator back from Horizon with the same call that runs on every submission. B and C (same creator) and P and B (one created the other) each showed "1 other submission". P and D, both from Friendbot, showed none. Creation transactions: [P](https://stellar.expert/explorer/testnet/tx/64a28cb008a1d4c29d5fa394b91730437781381294e2fb0e629af9367bf4c095) · [D](https://stellar.expert/explorer/testnet/tx/36fbaa68c955861280238b3b551eabba5f8d51d4bf2476feffe156e77acf2421) · [B](https://stellar.expert/explorer/testnet/tx/0141a497d7d3d0c855cdd5bb2ee16f8842dbf9379676a734d6834355723b9733) · [C](https://stellar.expert/explorer/testnet/tx/7e8b9d1c4a6604203425c57a5e53cac09cc12ebbc68092f04b65bcd4a6fc5596).

### Month 1 · Escrow cycle, 2026-09-23

Run: 2026-09-23T13:37:47Z · Trustless Work v1 multi-release · Contract `CCDKBF7H5NOMNHBLYP7DFMAPBUA4YJ2DMOLETHIDNKKMLAX2PZC33WBF`

| Step | Tx hash | Note |
|---|---|---|
| 1 deploy | [31c9dd13adca…](https://stellar.expert/explorer/testnet/tx/31c9dd13adcad008bd8b82f1a16c3b3265005faf5024c730f7b065e5de5dcff4) | |
| 2 fund | [9fe69bb62061…](https://stellar.expert/explorer/testnet/tx/9fe69bb62061c736e1ed6f885803a4488c78947ba5b59348ed8966da863894ba) | 5 USDC |
| 3 append milestone after funding | [a0a57d936860…](https://stellar.expert/explorer/testnet/tx/a0a57d9368609f09b717235ea74b765ed68170f7a3df3a63f52b84f31608c8de) | |
| 4a mark delivered | [cc32e7c67cee…](https://stellar.expert/explorer/testnet/tx/cc32e7c67cee231c0608f834515d789bdc2cfe88165dcf8c121fb4facf147fd1) | |
| 4b approve | [f746db8422f6…](https://stellar.expert/explorer/testnet/tx/f746db8422f6bae8505cc54aa02c8b45a3347a94f82d60eb8d5b87ef9abc8919) | |
| 4c release | [360d69ee23f8…](https://stellar.expert/explorer/testnet/tx/360d69ee23f843dbb237bd1d7533f14b891ac47bb83fdd9d25bb62eecf20658e) | 1 USDC → contributor |
| 5a dispute close milestone | [ae5fccb27c62…](https://stellar.expert/explorer/testnet/tx/ae5fccb27c622d4797724e4928252be5b14d0f8e58a4350f5843285226121e77) | |
| 5b withdraw remaining → funder | [650cb074d28e…](https://stellar.expert/explorer/testnet/tx/650cb074d28ee51bd5b58b37fcccf8ccb361449f6937c97bde6dd966c58935dd) | 3.988 of 4 USDC after the fee |
| 6 decision ledger | [1be85aa3bc19…](https://stellar.expert/explorer/testnet/tx/1be85aa3bc199d8643aefe9c17b1f0ed97d8e7c05b863bb94ed541ac3a72d19e) | key=pw:spike001 hash=6a72919fdfbd4426… |

Canonical decision record of step 6. Its SHA-256 is the memo hash of that transaction:

```json
{"v":1,"submission":"spike001","campaign":"spike","reviewer":"GCWGOELY7A55VZHJFRZBKR7ZMKURNYPUF2K3KL37ESBB2P7MJTZNCCC3","outcome":"PASS","reason":"R00_PASS","signals":{"account_genuine":true,"content_original":true,"task_done":true,"follows_brief":true,"single_account":true,"not_spam":true},"appealOf":null,"decidedAt":"2026-09-23T13:37:43.897Z"}
```

**Contributor onboarding, 2026-09-26.** A new wallet went from "does not exist" to "can receive USDC", using the same browser code as the contributor page: Friendbot [8212c2e7d159…](https://stellar.expert/explorer/testnet/tx/8212c2e7d159796fd8b4330971d6f1e4fc36d2b284891b777d0f1495cf432e24), then the USDC trustline [4c6ea31c82be…](https://stellar.expert/explorer/testnet/tx/4c6ea31c82be7c2e6a2abae5de1d22a25204c8a9aa4228c8713770961603db44).

---

## Verify a decision yourself

You need no code, account or wallet.

1. Open [proofwork.online/verify/dec_rkKU9cVIsC-L1GJKPdmVDw](https://proofwork.online/verify/dec_rkKU9cVIsC-L1GJKPdmVDw), the decision from the live run. The page shows the canonical record and hashes it again in your browser. Wait for "Matches the recorded hash" and note the 64-character hash.
2. Click **Open transaction**. stellar.expert opens [e2002f4f…](https://stellar.expert/explorer/testnet/tx/e2002f4f0fc9d098023095075a7eeb4d61a3a14548efa9d40b425dd25231281c).
3. Check that the transaction's **memo** (type hash) equals the hash from step 1. Then check that the **manage data** value is `v1|PASS|R00_PASS|<first 16 characters of that hash>`.

If both match, the decision you saw in the app is the one written to Stellar when it was made, and it has not changed since.

**Worked example (Week 1 spike).** Tx [1be85aa3…](https://stellar.expert/explorer/testnet/tx/1be85aa3bc199d8643aefe9c17b1f0ed97d8e7c05b863bb94ed541ac3a72d19e) carries memo hash `6a72919fdfbd4426a88b50a293779bede72201987328912e593acbffd721220f`. Explorers that show it in base64 display `anKRn9+9RCaoi1Cik3eb7eciAZhzKJEuWTrL/9chIg8=`, which is the same bytes. Its manage data is `pw:spike001` = `v1|PASS|R00_PASS|6a72919fdfbd4426`. That hash is the SHA-256 of the canonical JSON above.

---

## Customer development

Conversations in Month 2 (October–November 2026). Teams are named; people are given by role only.

| Team | What was discussed | Next step |
|---|---|---|
| SubRosa | At which stage SubRosa can be integrated with Proofwork | Pilot partnership planned for Month 3 |
| SendAll | Paying every approved contributor of a campaign in one transaction through SendAll's multi-recipient payments | Possible partnership for batch payouts |
| SprintOS | Running a campaign on Proofwork | Agreed to be named as a pilot partner |
| Beaver402 | Running a campaign on Proofwork | Agreed to be named as a pilot partner |
| Stellar Türkiye chapter | Where Proofwork stands, and when to apply to the Stellar Community Fund | Apply after the third Instawards month, with integrations and users in place |

Website traffic, last 30 days to 2026-10-29 (Vercel Web Analytics): 77 visitors, 197 page views ([chart](docs/screenshots/traffic-30-days.jpg), [pages and referrers](docs/screenshots/traffic-pages-referrers.jpg)).

---

## Security

- **No custody.** Platform keys sign only operations that move no money. A release needs the funder's wallet, and the remainder return needs the dispute resolver.
- **Wallet login.** A single-use signed nonce with an expiry. The session cookie is httpOnly, Secure and SameSite=Lax, and logout revokes the session on the server.
- **Authorization** is checked in the service layer on every mutation, against the caller's wallet, role and campaign ownership. Roles change through one function only, which writes the access log in the same database transaction.
- **Input.** Every route and server action validates with zod. Submission links must be `https://x.com/<handle>/status/<id>` (or twitter.com), and the server never fetches them: it asks X's API on a fixed host about the numeric post ID only.
- **X data.** From Sign in with X only the account ID is kept. Tokens, codes, the PKCE verifier, handles and post text are never stored or logged.
- **Secrets** live only in the server environment. They are validated at startup, never logged and never in the client bundle.
- **Security headers** (CSP, HSTS, nosniff, Referrer-Policy, frame-ancestors none) are set on every response, and every public write endpoint is rate limited.
- **Blind review.** The queue shows no contributor identity beyond the post link. The multi-account warning shows a count, never an address.

---

## Known limits

- **Testnet only.** Testnet USDC has no value, and the server keys are sprint keys.
- **One release transaction per payout.** Trustless Work v1 builds one transaction per milestone, so N payouts need N funder signatures. v2 batch approve-and-release is on the roadmap.
- **The close is manual.** The remainder returns only after the funder closes and the resolver signs. There is no timer. The 0.3% protocol fee also applies to the remainder.
- **Small review sample.** One reviewer, and campaigns in the tens of submissions, so the review results are a first signal, not a fraud benchmark.
- **The funding warning is a hint.** It sees only the account that created a wallet. Wallets activated directly from Friendbot never link.
- **The author check says who posted, not what.** Whether a post is original work stays a rubric signal for the reviewer. Every submission depends on X being reachable.
- **A deploy whose reply is lost can deploy twice.** The second escrow stays on-chain, empty and unknown to the app. No budget is involved.
- **Signing late can fail.** A prepared transaction has a time bound. In the live run, a fund signed about three minutes after it was prepared was rejected, and pressing Fund again worked.

---

## Roadmap

- **Month 3:** campaigns on mainnet, run by Stellar teams through the funder flow, and the debrief interview afterwards.
- Rubric v3 from real campaign data: catch rate and false-positive rate per signal, once campaigns with planted submissions have run.
- Trustless Work v2 batch approve-and-release, so one signature pays every approved contributor.
- A Soroban contract for decision records that can be queried by submission ID.
- An in-app second-reviewer mode, to measure reviewer agreement on every campaign.

---

## Getting started

Requirements: Node.js 22, pnpm, Postgres, and a Trustless Work testnet API key.

```bash
pnpm install
cp .env.example .env          # fill in; every variable is described in the file
pnpm keys:gen                 # testnet server keys → paste into .env
pnpm accounts:prepare         # create the accounts on testnet, open USDC trustlines
pnpm db:migrate
pnpm dev
```

Grant the first operator and reviewer roles. After that, teams ask for funder access at `/campaigns` and the operator decides at `/admin`.

```bash
pnpm role:grant G...OPERATOR ops
pnpm role:grant G...REVIEWER reviewer
pnpm role:grant G...WALLET reviewer --revoke   # removes the one role named
```

Quality gate, enforced by the pre-commit hook and CI:

```bash
pnpm check                    # typecheck + lint + unit tests
```

**Operator scripts**

| Command | What it does |
|---|---|
| `pnpm spike` | Runs the full escrow cycle on testnet (deploy, fund, append, deliver, approve, release, dispute, remainder) and one decision record |
| `pnpm escrow:close <contract>` | Returns a closed campaign's remainder with the resolver key and records it on the campaign. `--no-record` signs only, and `--record <tx>` records a return made elsewhere |
| `pnpm evidence:dump <slug> [name]` | Writes every on-chain transaction and decision of a campaign, with explorer links, to a local report |
| `pnpm x:check <post id> <account id>` | Sends one post-author lookup to X for a known post, before a campaign takes submissions |

---

## Deployment

| What | Where |
|---|---|
| App | Vercel. `main` deploys to production, and every other branch gets a protected preview |
| Domain | [proofwork.online](https://proofwork.online) (`www` redirects to the apex) |
| Database | Neon Postgres, with separate `main` and `preview` branches |
| Rate limiting | Upstash Redis, one database per environment |
| Chain | Stellar testnet (Horizon, Soroban RPC), Trustless Work `dev.api.trustlesswork.com` |
| X | `x.com` (authorize redirect) and `api.x.com` (token, account and post lookup), fixed in code |
| CI | Typecheck, lint, unit tests, `pnpm audit`, repo hygiene and `next build` on every push and pull request |

- **Environment.** Values are set only in the Vercel dashboard, per scope, and none has the `NEXT_PUBLIC_` prefix. `src/config/env.ts` validates them on first use. Preview and production use separate keys, session secrets, databases and Upstash instances. `FUNDER_SECRET` and `DISPUTE_RESOLVER_SECRET` are never set on Vercel: they stay on the machine of whoever holds them.
- **X credentials** (`X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`, `X_BEARER_TOKEN`) are set all together or not at all. Without them the app runs but takes no submissions.
- **Funder caps.** `FUNDER_MAX_OPEN_CAMPAIGNS` (default 2) and `FUNDER_MAX_OPEN_BUDGET` (default 100 USDC).
- **Migrations** are run by hand, never in the build: preview branch first, then production, before the deploy that needs them. They are written to stay backward compatible, so a Vercel Instant Rollback is always safe. Neon point-in-time restore is the recovery path for the database.
- **On-chain state is never rolled back.** An escrow operation that was in flight is reconciled against the chain the next time it is prepared or submitted.

---

## Project layout

```
src/config     validated environment (server) and public constants
src/db         schema + migrations
src/domain     rubric, reason codes, submission URL rules, funding readiness, wallet signature check
src/escrow     EscrowPort + Trustless Work adapter + in-memory fake
src/ledger     canonical decision record + on-chain commit
src/services   auth, access, campaign, escrow-ops, submission, review, payout, remainder, x-account
src/x          XPort + X adapter (Sign in with X, post-author lookup) + in-memory fake
src/app        /campaigns (funder), /c/[slug] (contributor), /review, /verify/[id], /admin (operator)
src/wallet     browser wallet layer (Wallets Kit), account reads
scripts        keys, account prep, spike, escrow close, role grant, results, evidence dump, X lookup check
tests/unit     unit tests, no network
docs           screenshots from the live run
```
