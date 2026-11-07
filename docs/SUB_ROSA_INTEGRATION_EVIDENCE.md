# Proofwork × Sub Rosa integration evidence

Status: implemented on [Proofwork PR #1](https://github.com/CemAyyildiz/Proofwork/pull/1), awaiting founder review and merge. This is testnet integration evidence, not production adoption, mainnet deployment, financial volume, or final acceptance.

## Scope and partner context

Proofwork founder Cem authorized a PR for a second-reviewer integration, then reviewed the first implementation and required a Proofwork-specific authority model. The revised workflow fixes the reviewer pair to Cem's configured external wallet plus the original campaign creator. The creator opens the round; both reviewers independently seal the existing rubric-v2 assessment; only Cem can select the authoritative final result and initiate the compatible reward flow.

The integration uses `@sub-rosa/sdk@0.3.2`, Stellar testnet, Core v2 ReceiptOnly mode, zero Sub Rosa escrow, Drand-timed reveal, canonical receipt verification, immutable campaign/submission/reviewer bindings, and transaction-hash replay protection. No assessment plaintext is stored by Proofwork before a verified reveal.

## Reproducible testnet proof

Run:

```sh
corepack pnpm test:sealed-review:testnet
```

The revised fixed-pair run completed on 2026-11-07:

- Network: Stellar testnet
- Core v2 contract: `CCOVGOQQZJKZ2R55GRWBLTJTGBAMSHXZVN3ICPG3WRVMLMM6RHISC5OV`
- Round: `44`, final status `Settled`
- Receipt SHA-256: `f7e49d4979110dd2034e36311bbf6a65f0eb91a5dcca7dd8c89d5da8657b0186`
- Receipt verification: valid, no issues
- Create: `4b493d5f835177b429f57af2cd297443d03daad54b87e15dc3c2c188ba793d6b`
- Founder commit/reveal: `d07b3f170cdac051acb5fb72c9c7577ed7f2225c03371b995234e7db1726faa5` / `d095b52d2725b7a92a5d712cffe09a5c330c103bb837513a93303c953da9a9a6`
- Creator commit/reveal: `2504e671d8b92f5d42922978469a503c9d9976541c201689fba02a18b236256b` / `17696f56176597fa700f5ec8656e3d643dad5d25b3f1046bcee2da47eb7ecf8d`
- Open reveal / clear: `64c64e9ca2c023bd5771686c8287768f925432bbd5ec8a68f4596a5e794ee284` / `38311dfee2f1df0092e8e5fb39dc3413564f17b2ed68938f557e8a00c003c67b`

The run verified distinct founder/creator wallets, creator-opened round, absence of plaintext before reveal, rejection of an outsider commit, both reviewer bindings, the Proofwork submission binding, and zero Sub Rosa escrow. Machine-readable evidence is in `docs/evidence/sub-rosa-sealed-dual-review-testnet.json`.

## Reward authority and limitations

For newly created founder-sealed campaigns, Proofwork deploys Trustless Work with the original creator as funder/remainder recipient, platform ops as approver, and Cem's external wallet as release signer. The backend stores only Cem's public key and rejects configurations that reuse a backend signing key. Owner and unrelated reward requests are denied; the ordinary review endpoint cannot bypass the sealed finalization path; and a direct owner release attempt fails in the escrow authorization test before the founder release succeeds. Existing funded escrows are not rewritten, and legacy single-review campaigns retain their prior authority model.

The Sub Rosa proof above is live testnet evidence. A fresh live Trustless Work authorization cycle was not executed in this revision because this worktree has no Trustless Work API key or funded testnet-USDC account. The exact role mapping and unauthorized-release behavior are covered by the Trustless Work adapter plus service/escrow tests; no production escrow or real funds were used.

Validation at revision time: TypeScript and ESLint passed, the Next.js production build passed, and all 993 unit/integration tests passed. PR #1 remains open and unmerged pending Cem's review.
