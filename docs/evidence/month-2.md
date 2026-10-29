# Evidence index, Month 2

Proofwork · Stellar Instawards, Stellar Türkiye chapter · Month 2 sprint, Oct 1 to Nov 1, 2026 · Stellar testnet only.

Month 1 ran one campaign that Proofwork set up and operated itself; its evidence is in the [Month 1 index](README.md). Month 2 is about a team other than Proofwork running its own campaign. This page maps every deliverable row of the Month 2 Statement of Work, and every evidence row of the Customer Development Plan, to what shows it: a document, a link or a transaction hash. A row that has nothing yet is marked **open**, with who provides it. Every transaction hash opens on [stellar.expert](https://stellar.expert/explorer/testnet).

Last updated 2026-10-29. The code for all three deliverables is on proofwork.online since 2026-10-21. The team conversations are summarised in [customer-development/](customer-development/README.md). Two rows move out of Month 2, each with its reason below: the rubric revision, which has no testnet data to rest on, and the pilot campaign, which moves to Month 3 on mainnet.

| Shared evidence | Where |
|---|---|
| GitHub repo | [README](../../README.md) · the repository is meant to be published, and everything on this page is written to be read by anyone · public URL: **open** · Cem |
| Demo video, Month 2 | **open** · Cem |
| Live app | [proofwork.online](https://proofwork.online) (Stellar testnet) |
| External-funder rehearsal, every step and transaction | [external-funder-rehearsal.md](external-funder-rehearsal.md) · what the app recorded for its campaign: [rehearsal-campaign.md](rehearsal-campaign.md) |
| Pilot campaign | Moved to Month 3 on mainnet: [customer-development → Pilot campaign](customer-development/README.md#pilot-campaign) |
| Customer development | [customer-development/](customer-development/README.md) |
| Technical summary | [technical-summary.md](../technical-summary.md) · how a team-run campaign differs: [Team-run campaigns](../technical-summary.md#team-run-campaigns) |
| Review rubric | [rubric.md](../rubric.md), v1 today |
| Hosting, deployment and operator commands | [deployment.md](../deployment.md) |

## Deliverable 1: funder access without the operator

*A team connects a wallet, asks for funder access in the app and is approved or rejected by the operator on an admin page. Every grant and revocation is logged, each funder is capped, and the wallet is checked before it funds.*

| SOW row | Evidence | Status |
|---|---|---|
| Team connects a wallet and requests funder access | [funder-access.md](funder-access.md): request form, pending state, second request refused, rate limit · on testnet wallets: [rehearsal → Request to approval](external-funder-rehearsal.md#request-to-approval) · code: `src/services/access.ts`, `src/app/api/access/requests/route.ts` | recorded, on a local instance |
| Operator approves or rejects on an admin page | [funder-access.md](funder-access.md): approve, reject, revoke, the `ops` gate · [rehearsal → Request to approval](external-funder-rehearsal.md#request-to-approval) and [Revoked after funding](external-funder-rehearsal.md#revoked-after-funding) · code: `src/app/(workspace)/admin/`, `src/app/api/admin/access/route.ts` | recorded, on a local instance |
| Every grant and revocation is logged | Access log read back after each run: [funder-access.md → Run 2](funder-access.md#run-2-local-app) (six changes, six rows) and [rehearsal → Revoked after funding](external-funder-rehearsal.md#revoked-after-funding) (three changes, three rows) · one function writes roles and the log together: [technical summary → Funder access](../technical-summary.md#funder-access) | recorded, on a local instance |
| Cap on open campaigns and on budget per funder | [funder-readiness.md](funder-readiness.md): both caps, at create, at deploy and at submit · on a real escrow: [rehearsal → Limits and abandon](external-funder-rehearsal.md#limits-and-abandon) (2 of 2 reached, third deploy refused, abandon frees the place) | recorded, on testnet |
| Readiness check before funding (USDC trustline and balance) | [funder-readiness.md → Run 2](funder-readiness.md#run-2-one-testnet-read-per-wallet-state): one testnet read per wallet state · one wallet going from not ready to ready and then deploying and funding: [rehearsal → Not ready, then ready](external-funder-rehearsal.md#not-ready-then-ready) · deploy [5e5759254e86…](https://stellar.expert/explorer/testnet/tx/5e5759254e86e8dc08f1f5e3bfa7d3daa80fea4364e67578935ee0eae143f535), fund [aa5f5a7fabdc…](https://stellar.expert/explorer/testnet/tx/aa5f5a7fabdca1670c090aeb57dac7c1fbe825ebde71be2cb8a609a543518ce0) | recorded, on testnet |
| Evidence: demo video | Request, approve, create and fund sections of the Month 2 demo video | **open** · Cem |
| Evidence: repo | [README](../../README.md) and the code paths in the rows above | recorded |
| Evidence: screenshots | Request form, pending state, admin page, readiness panel, funded campaign | **open** · Cem |
| Evidence: grant visible in the access log | From the rehearsal, the funder grant by the operator's wallet at 15:37:01 UTC on 2026-10-13: [rehearsal → Revoked after funding](external-funder-rehearsal.md#revoked-after-funding) | rehearsal recorded · on proofwork.online with the first team in Month 3 |

On proofwork.online, migrations `0003` to `0006` were applied and the operator's `ops` grant was made on 2026-10-21. No team has requested funder access there yet: the first teams come with the Month 3 campaigns.

What the readiness check covers, and what it does not: it asks for 1 XLM free above the reserves, which is for the deploy and the fund only. The team's wallet also signs one release for each approved submission and the close. The close cost 0.0014066 XLM in the rehearsal. No release signed by a funder other than the operator has been run, so its fee has not been measured, and nothing checks the wallet's XLM before a release or a close.

## Deliverable 2: rubric v2, X account verification, multi-account warnings

*The rubric is revised from the Month 1 results. A contributor connects an X account and can submit only a post that account wrote. The reviewer is warned when wallets in one campaign share a funding source. Month 1 contributors are asked for feedback.*

| SOW row | Evidence | Status |
|---|---|---|
| Revise the rubric from the Month 1 results table, reason for each change | Deferred. The Month 1 campaign closed with two decisions, both passes, and no planted fakes, so a results table would measure nothing to revise the rubric from. The rubric stays v1 ([rubric.md](../rubric.md)) until real campaigns produce review data | deferred |
| Follows from changing the rubric: each decision records the rubric version it was scored under, and v1 decisions stay verifiable | Built together with rubric v2 | deferred, with rubric v2 |
| Contributors connect X (Sign in with X) before submitting | [x-connect.md](x-connect.md): tests and local runs against a fake X · [technical summary → X account connection](../technical-summary.md#x-account-connection) | built and tested · X app credentials set on proofwork.online on 2026-10-21 · a live sign-in not yet recorded |
| Post author looked up by post ID through the X API and must match; another account's post is rejected | [x-connect.md](x-connect.md) · [technical summary → Post author check](../technical-summary.md#post-author-check) · operator check of the lookup: [`pnpm x:check`](../deployment.md#checking-the-lookup) | built and tested · lookup checked live against X on 2026-10-19 with `pnpm x:check`: own post matches, another account's post does not |
| One X account linked to only one wallet | [x-connect.md](x-connect.md): the second wallet is refused, and the database holds the rule in two unique keys | built and tested |
| Only the X account ID is stored; post text is not read | [technical summary → X account connection](../technical-summary.md#x-account-connection), "What is stored" · [Post author check](../technical-summary.md#post-author-check), "What X returns and what is kept" · the bundle scan in [x-connect.md](x-connect.md) | built and tested |
| Follows from the author check: one post is submitted once, whatever handle or host its link carries | [x-connect.md](x-connect.md): the post ID under a unique index, and the backfill of earlier rows | built and tested |
| Warnings in the review queue: wallets that received first funds from the same Stellar account, excluding Friendbot and faucets | [funding-source.md](funding-source.md): four testnet wallets, their creating transactions and the count each review card shows · [technical summary → Shared funding source warning](../technical-summary.md#shared-funding-source-warning) | recorded, on testnet |
| Short feedback from Month 1 contributors | A short summary in [customer-development/](customer-development/README.md) | **open** · Cem |
| Evidence: rubric v2 doc | [rubric.md](../rubric.md), v1 | deferred, as the first row |
| Evidence: repo | [README](../../README.md) and `src/x/`, `src/services/x-account.ts`, `src/services/submission.ts`, `src/services/review.ts` | recorded |
| Evidence: screenshots | Connect X step, an accepted and a rejected submission, a review card with a warning | **open** · Cem |
| Evidence: demo of connect, accept and reject | Month 2 demo video, on a deployment with the X credentials set | **open** · Cem |
| Evidence: warnings | [funding-source.md](funding-source.md) · a review card with a warning in the demo video | testnet read recorded · on video **open** · Cem |
| Evidence: feedback summary | As the feedback row above | **open** · Cem |

## Deliverable 3: team conversations and a pilot campaign

*Stellar teams are interviewed. One team runs a campaign through Deliverable 1, approves and releases its payouts, gets its remainder back, and is interviewed afterwards.*

| SOW row | Evidence | Status |
|---|---|---|
| Interview Stellar teams | [customer-development/](customer-development/README.md): Rise In, SubRosa and SendAll, and the Stellar Türkiye chapter | 3 teams |
| One campaign created and funded by a team through Deliverable 1 | Moved to Month 3 on mainnet, with the reason: [customer-development → Pilot campaign](customer-development/README.md#pilot-campaign) · the same path run on testnet with a wallet that never had a role: [external-funder-rehearsal.md](external-funder-rehearsal.md), deploy [5e5759254e86…](https://stellar.expert/explorer/testnet/tx/5e5759254e86e8dc08f1f5e3bfa7d3daa80fea4364e67578935ee0eae143f535), fund [aa5f5a7fabdc…](https://stellar.expert/explorer/testnet/tx/aa5f5a7fabdca1670c090aeb57dac7c1fbe825ebde71be2cb8a609a543518ce0) | rehearsal recorded · pilot in Month 3 |
| Team gives final approval and releases the payouts | Releasing exactly the payouts the funder selected, on testnet: [selected-release.md](selected-release.md) | recorded, on testnet · by a team in Month 3 |
| Remainder returns to the team at the deadline | Rehearsed with a funder that is not the operator: dispute [543b1fd6c5e7…](https://stellar.expert/explorer/testnet/tx/543b1fd6c5e7ee68170eea975c0c1acbbc6c404ac70bae07a8d2bf05af84bf67), withdrawal [2df7fde33230…](https://stellar.expert/explorer/testnet/tx/2df7fde332303415e48ed3c53163a1c3e1b8e512a5a2c68facdd8a8e0286bbb1), 4.985 of 5 USDC back to the funding wallet after the 0.3% protocol fee ([rehearsal → Close and remainder](external-funder-rehearsal.md#close-and-remainder)) · returned in the app by the resolver's own wallet, no server key: [in-app-remainder.md](in-app-remainder.md), return [3b7a2b91a5f4…](https://stellar.expert/explorer/testnet/tx/3b7a2b91a5f4e4d0638f38b5ddd6c455f2456201a6dc15690c7c90ce7d9bc1dd) | recorded, on testnet · by a team in Month 3 |
| Debrief interview | After the first team campaign | Month 3 |
| Evidence: interview summaries | [customer-development/](customer-development/README.md) | recorded |

## Customer Development Plan evidence rows

| Row | Evidence | Status |
|---|---|---|
| Loom recording of a product demo with a potential customer | | **open** · Cem |
| User testing recording or UX session video | | **open** · Cem |
| Website traffic report | Vercel Web Analytics for proofwork.online, last 30 days to 2026-10-29: 77 visitors, 197 page views ([chart](screenshots/traffic-30-days.jpg), [pages, referrers, countries](screenshots/traffic-pages-referrers.jpg)) | recorded |
| Customer interview summary or feedback documentation | [customer-development/](customer-development/README.md) | recorded |
| Other: live campaign and on-chain evidence | Month 1: the [Month 1 index](README.md) · the rehearsal: [external-funder-rehearsal.md](external-funder-rehearsal.md) · selected release: [selected-release.md](selected-release.md) · in-app return: [in-app-remainder.md](in-app-remainder.md) | recorded |

## Privacy

The repository is meant to be published, so every page here is written as public. Customer development records name teams that agreed to be named and never a person: no name, contact detail, handle or wallet of an individual. Screenshots show the testnet badge and contain no secrets, emails or private data; contributor wallets appear truncated. A funding team's wallet is shown in full, because it is the evidence that the team funded its own campaign; the team is asked for that before its campaign. No list of planted submissions is in the app database or in this repository.
