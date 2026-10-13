import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { canonicalJson, type DecisionRecord } from "@/ledger/canonical";
import { getDecision, reviewLog } from "@/services/review";

const MIGRATIONS = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));

interface Entry {
  idx: number;
  tag: string;
}

const journal = (JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as { entries: Entry[] }).entries;
/** The migration that adds `submission.post_id`, by its position in the journal. */
const POST_ID_MIGRATION = 5;

/** Runs one migration file the way drizzle does: statement by statement. */
async function apply(client: PGlite, entry: Entry): Promise<void> {
  for (const statement of readFileSync(`${MIGRATIONS}/${entry.tag}.sql`, "utf8").split("--> statement-breakpoint")) {
    await client.exec(statement);
  }
}

interface Row {
  id: string;
  work_url: string;
  post_id: string | null;
}

let client: PGlite;

/** A database as production had it before the post ID existed: every earlier migration, nothing later. */
beforeEach(async () => {
  client = new PGlite();
  for (const entry of journal.filter((e) => e.idx < POST_ID_MIGRATION)) await apply(client, entry);
  await client.exec(`
    INSERT INTO "campaign" ("id", "slug", "title", "brief", "reward_amount", "budget", "deadline_at", "funder_pubkey", "dispute_resolver_pubkey")
    VALUES ('cmp_1', 'camp-1', 'Campaign', 'A brief.', '5', '100', now(), 'G_FUNDER', 'G_DR');
  `);
});

afterEach(async () => {
  await client.close();
});

async function seed(rows: Array<[id: string, workUrl: string]>): Promise<void> {
  for (const [id, workUrl] of rows) {
    await client.query(
      `INSERT INTO "submission" ("id", "short_id", "campaign_id", "contributor_pubkey", "work_url", "status") VALUES ($1, $1, 'cmp_1', $1, $2, 'decided')`,
      [id, workUrl],
    );
  }
}

async function migrate(): Promise<void> {
  const entry = journal.find((e) => e.idx === POST_ID_MIGRATION);
  if (!entry) throw new Error("post ID migration is not in the journal");
  await apply(client, entry);
}

/** Every migration after it, so the app's own queries can read the database. */
async function migrateRest(): Promise<void> {
  for (const entry of journal.filter((e) => e.idx > POST_ID_MIGRATION)) await apply(client, entry);
}

const rows = async () => (await client.query<Row>(`SELECT "id", "work_url", "post_id" FROM "submission" ORDER BY "id"`)).rows;

describe("post ID migration on rows stored before it", () => {
  it("keeps every row and its link, and sets the post ID where no other row shares it", async () => {
    const before: Array<[string, string]> = [
      ["s1", "https://x.com/alice/status/1841200000000000001"],
      ["s2", "https://x.com/bob_2/status/42"],
      ["s3", "https://x.com/carol/status/9223372036854775807"],
    ];
    await seed(before);
    await migrate();

    expect(await rows()).toEqual([
      { id: "s1", work_url: before[0]?.[1], post_id: "1841200000000000001" },
      { id: "s2", work_url: before[1]?.[1], post_id: "42" },
      { id: "s3", work_url: before[2]?.[1], post_id: "9223372036854775807" },
    ]);
  });

  it("leaves the post ID empty on every row of a post stored under two handle spellings, and still migrates", async () => {
    await seed([
      ["s1", "https://x.com/alice/status/999"],
      ["s2", "https://x.com/ALICE_/status/999"],
      ["s3", "https://x.com/alice/status/1000"],
    ]);
    await migrate();

    expect(await rows()).toEqual([
      { id: "s1", work_url: "https://x.com/alice/status/999", post_id: null },
      { id: "s2", work_url: "https://x.com/ALICE_/status/999", post_id: null },
      { id: "s3", work_url: "https://x.com/alice/status/1000", post_id: "1000" },
    ]);
  });

  it("takes the ID from the end of the link only, and only in the spelling new submissions use", async () => {
    await seed([
      // One post ID is a prefix or suffix of the other: they are different posts.
      ["s1", "https://x.com/alice/status/123"],
      ["s2", "https://x.com/alice/status/1234"],
      ["s3", "https://x.com/status/status/5"],
      // IDs the tightened link rule no longer accepts get no post ID.
      ["s4", "https://x.com/alice/status/0999"],
      ["s5", `https://x.com/alice/status/${"9".repeat(20)}`],
    ]);
    await migrate();

    expect((await rows()).map((r) => r.post_id)).toEqual(["123", "1234", "5", null, null]);
  });

  it("leaves other columns of earlier rows as they were", async () => {
    await seed([["s1", "https://x.com/alice/status/7"]]);
    const before = (await client.query(`SELECT * FROM "submission"`)).rows[0] as Record<string, unknown>;
    await migrate();
    const after = (await client.query(`SELECT * FROM "submission"`)).rows[0] as Record<string, unknown>;
    expect(after).toEqual({ ...before, post_id: "7" });
  });

  it("migrates an empty table", async () => {
    await migrate();
    expect(await rows()).toEqual([]);
  });

  it("then holds one row per post ID, and any number of rows without one", async () => {
    await seed([
      ["s1", "https://x.com/alice/status/999"],
      ["s2", "https://x.com/ALICE_/status/999"],
      ["s3", "https://x.com/alice/status/7"],
    ]);
    await migrate();

    const insert = (id: string, postId: string) =>
      client.query(
        `INSERT INTO "submission" ("id", "short_id", "campaign_id", "contributor_pubkey", "work_url", "post_id") VALUES ($1, $1, 'cmp_1', $1, $2, $3)`,
        [id, `https://x.com/new_${id}/status/${postId}`, postId],
      );
    await expect(insert("n1", "7")).rejects.toMatchObject({ code: "23505" });
    await expect(insert("n2", "8")).resolves.toBeDefined();
  });

  it("leaves a decision made before it as it was: same row, same hash, signals and outcome on the verify read and in the review log", async () => {
    const record: DecisionRecord = {
      v: 1,
      submission: "s1",
      campaign: "camp-1",
      reviewer: "G_REV",
      outcome: "FAIL",
      reason: "R02_ORIGINAL",
      signals: { account_genuine: true, content_original: false, task_done: true, follows_brief: false, single_account: true, not_spam: false },
      appealOf: null,
      decidedAt: "2026-09-20T10:00:00.000Z",
    };
    const json = canonicalJson(record);
    const hash = createHash("sha256").update(json, "utf8").digest("hex");
    await seed([["s1", "https://x.com/alice/status/999"]]);
    await client.query(
      `INSERT INTO "decision" ("id", "submission_id", "reviewer_pubkey", "outcome", "reason_code", "signals", "note", "canonical_json", "decision_hash", "ledger_key", "tx_hash", "created_at")
       VALUES ('dec_1', 's1', 'G_REV', 'FAIL', 'R02_ORIGINAL', $1, 'copied', $2, $3, 'pw:s1', 'tx_1', $4)`,
      [JSON.stringify(record.signals), json, hash, record.decidedAt],
    );
    await client.exec(`INSERT INTO "role_grant" ("pubkey", "role") VALUES ('G_REV', 'reviewer')`);
    const decisionBefore = (await client.query(`SELECT * FROM "decision"`)).rows;

    await migrate();
    expect((await client.query(`SELECT * FROM "decision"`)).rows).toEqual(decisionBefore);

    await migrateRest();
    const conn = drizzle({ client, schema });
    // What /verify/<id> reads: the stored JSON still hashes to the stored hash.
    const found = await getDecision("dec_1", conn);
    expect(found?.d).toMatchObject({ canonicalJson: json, decisionHash: hash, outcome: "FAIL", reasonCode: "R02_ORIGINAL", signals: record.signals, txHash: "tx_1" });
    expect(createHash("sha256").update(found?.d.canonicalJson ?? "", "utf8").digest("hex")).toBe(hash);
    expect(found?.s).toMatchObject({ workUrl: "https://x.com/alice/status/999", postId: "999" });

    const { rows: log } = await reviewLog("cmp_1", { pubkey: "G_REV" }, conn);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      work_url: "https://x.com/alice/status/999",
      decision_id: "dec_1",
      outcome: "FAIL",
      reason_code: "R02_ORIGINAL",
      decision_hash: hash,
      tx_hash: "tx_1",
      signal_content_original: false,
      signal_task_done: true,
      pass_count: 3,
    });
    // The export has no post ID column: its shape is what it was.
    expect(Object.keys(log[0] ?? {})).not.toContain("post_id");
  });
});
