/**
 * Real testnet values from docs/evidence/escrow-cycle.md (run 2026-09-23).
 * Copied, not imported, so the landing never reads repo docs at runtime.
 * tests/unit/landing.test.ts keeps these equal to the evidence file.
 */
export const SPIKE_CONTRACT = "CCDKBF7H5NOMNHBLYP7DFMAPBUA4YJ2DMOLETHIDNKKMLAX2PZC33WBF";

export const SPIKE_RECORD = {
  submission: "spike001",
  ledgerKey: "pw:spike001",
  canonicalJson:
    '{"v":1,"submission":"spike001","campaign":"spike","reviewer":"GCWGOELY7A55VZHJFRZBKR7ZMKURNYPUF2K3KL37ESBB2P7MJTZNCCC3","outcome":"PASS","reason":"R00_PASS","signals":{"account_genuine":true,"content_original":true,"task_done":true,"follows_brief":true,"single_account":true,"not_spam":true},"appealOf":null,"decidedAt":"2026-09-23T13:37:43.897Z"}',
  memoHash: "6a72919fdfbd4426a88b50a293779bede72201987328912e593acbffd721220f",
  txHash: "1be85aa3bc199d8643aefe9c17b1f0ed97d8e7c05b863bb94ed541ac3a72d19e",
} as const;

/** manage_data value from src/ledger/canonical.ts `ledgerValue`: the first 8 bytes of the hash, i.e. 16 hex chars. */
export const SPIKE_LEDGER_VALUE = `v1|PASS|R00_PASS|${SPIKE_RECORD.memoHash.slice(0, 16)}`;

export const SPIKE_FUND = { amount: "5", txHash: "9fe69bb62061c736e1ed6f885803a4488c78947ba5b59348ed8966da863894ba" } as const;

export const SPIKE_RELEASE = { amount: "1", txHash: "360d69ee23f843dbb237bd1d7533f14b891ac47bb83fdd9d25bb62eecf20658e" } as const;

export const EVIDENCE_TXS: ReadonlyArray<{ label: string; hash: string }> = [
  { label: "Deploy", hash: "31c9dd13adcad008bd8b82f1a16c3b3265005faf5024c730f7b065e5de5dcff4" },
  { label: "Fund", hash: SPIKE_FUND.txHash },
  { label: "Append milestone", hash: "a0a57d9368609f09b717235ea74b765ed68170f7a3df3a63f52b84f31608c8de" },
  { label: "Mark delivered", hash: "cc32e7c67cee231c0608f834515d789bdc2cfe88165dcf8c121fb4facf147fd1" },
  { label: "Approve", hash: "f746db8422f6bae8505cc54aa02c8b45a3347a94f82d60eb8d5b87ef9abc8919" },
  { label: "Release", hash: SPIKE_RELEASE.txHash },
  { label: "Dispute close", hash: "ae5fccb27c622d4797724e4928252be5b14d0f8e58a4350f5843285226121e77" },
  { label: "Return remainder", hash: "650cb074d28ee51bd5b58b37fcccf8ccb361449f6937c97bde6dd966c58935dd" },
  { label: "Decision pw:spike001", hash: SPIKE_RECORD.txHash },
];
