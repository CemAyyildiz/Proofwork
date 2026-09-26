# Evidence index

Proofwork · Stellar Instawards, Stellar Türkiye chapter · Stellar testnet only.

This page maps each deliverable in the Statement of Work (§6.1 and the §6.2 verification checklist) to the evidence that shows it. Nothing here requires reading code: every transaction hash opens on [stellar.expert](https://stellar.expert/explorer/testnet), and every decision can be checked in the browser (see [Verify it yourself](../../README.md#verify-it-yourself)).

| Shared evidence | Link |
|---|---|
| GitHub repo | [README](../../README.md) · public URL: _to be added by Cem_ |
| Demo video (3–5 min: create → fund → submit → review → on-chain → re-review → payout → close → results) | _to be added by Cem_ |
| Live app | [proofwork.online](https://proofwork.online) (Stellar testnet) |
| Live campaign, every on-chain transaction | [campaign.md](campaign.md) (`pnpm evidence:dump <slug>`) · _generated after the live campaign_ |
| Week 1 escrow cycle, every transaction | [escrow-cycle.md](escrow-cycle.md) |
| Technical summary | [technical-summary.md](../technical-summary.md) |
| Review rubric | [rubric.md](../rubric.md) |
| Results table | [results.md](../results.md) · _generated after the live campaign_ |
| Hosting and deployment | [deployment.md](../deployment.md) |

## Deliverable 1 — Escrow and submission

*A project creates a campaign and funds its budget into a Trustless Work escrow on testnet, a contributor connects a wallet and submits their work, and the unreleased remainder returns to the funder at the deadline. The platform never holds the funds.*

| Evidence | Where |
|---|---|
| Repo | Escrow client and adapter: `src/escrow/`; campaign, fund and close flow: `src/services/campaign.ts`, `src/services/payout.ts`; wallet onboarding: `src/wallet/` |
| Demo video | Create, fund, submit and close sections of the demo video (link above) |
| Screenshots (_to be added_) | [Campaign create](../screenshots/01-campaign-create.png) · [Fund](../screenshots/02-fund.png) · [Contributor onboarding](../screenshots/03-contributor-onboarding.png) · [Submit](../screenshots/04-submit.png) · [Close and remainder](../screenshots/09-close-remainder.png) |
| Tx hash: escrow deploy | [campaign.md → Deploy escrow](campaign.md#deploy-escrow) (_generated after the live campaign_) · spike: [escrow-cycle.md step 1](escrow-cycle.md) |
| Tx hash: fund | [campaign.md → Fund budget](campaign.md#fund-budget) (_generated after the live campaign_) · spike: [step 2](escrow-cycle.md) |
| Tx hash: remainder returned to funder | [campaign.md → Withdraw remainder to funder](campaign.md#withdraw-remainder-to-funder) (_generated after the live campaign_) · spike: [step 5b](escrow-cycle.md) |
| Tx hash: new wallet onboarded (Friendbot + USDC trustline) | [onboarding.md](onboarding.md) |
| Who could move the money | Escrow roles and why the platform cannot release funds: [technical summary → Escrow shape](../technical-summary.md#escrow-shape-ad-2-ad-3) |

## Deliverable 2 — Review layer

*The review queue in use: submissions checked against the six-signal rubric, approve and reject decisions each with a written reason, the one-shot re-review used at least once, and each decision's outcome and reason code written on-chain with a tx hash.*

| Evidence | Where |
|---|---|
| Repo | Rubric: `src/domain/rubric.ts`; review queue and decisions: `src/services/review.ts`; on-chain record: `src/ledger/` |
| Demo video | Review, on-chain and re-review sections of the demo video (link above) |
| Screenshots (_to be added_) | [Review card](../screenshots/05-review-card.png) · [Decision on-chain](../screenshots/06-decision-on-chain.png) · [Verify page](../screenshots/07-verify-page.png) |
| Review log export | _to be attached by Cem_ (CSV exported from the closed campaign's page) |
| Tx hash per decision | [campaign.md → Decision records](campaign.md#decision-records) (_generated after the live campaign_): ledger key, outcome, reason code, tx and verify link for every decision |
| One-shot re-review used | Rows marked `re-review` (ledger key ending in `:a1`) in [campaign.md → Decision records](campaign.md#decision-records) (_generated after the live campaign_) |
| Rubric | [rubric.md](../rubric.md): the six signals, pass/fail examples, reason codes |
| Decision record format | [technical summary → Decision record](../technical-summary.md#decision-record-ad-5) |

## Deliverable 3 — Live campaign

*The full campaign from open to payout, and what it produced: genuine and planted submission counts, catch rate, false-positive rate, sample size, and which rubric signals were weak. The README explains how to run and verify the MVP without help.*

| Evidence | Where |
|---|---|
| Demo video | Full demo video (link above), ending on the results table |
| Repo | [README](../../README.md) |
| README (run and verify without help) | [Run locally](../../README.md#run-locally) · [Verify it yourself](../../README.md#verify-it-yourself) |
| Technical summary | [technical-summary.md](../technical-summary.md), including known limits |
| Screenshots (_to be added_) | [Payout](../screenshots/08-payout.png) · [Close and remainder](../screenshots/09-close-remainder.png) · all of D1 and D2 above |
| Results table | [results.md](../results.md) (_generated after the live campaign_): counts and rates, sample size, weak signals, limits |
| Tx hash: payouts | [campaign.md → Release reward (per contributor)](campaign.md#release-reward-per-contributor) (_generated after the live campaign_): one release tx per paid contributor |
| Tx hash: whole campaign | [campaign.md](campaign.md) (_generated after the live campaign_): deploy, fund, milestones, releases, close, remainder, decisions |

## Privacy

Screenshots show the testnet badge and contain no secrets, emails or private data; contributor wallets appear truncated (`GABC…WXYZ`). The list of planted submissions is not in the app database or in this repository; only the aggregate results are published.
