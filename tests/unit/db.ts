import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

const MIGRATIONS = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));

/** Migrated data directory, built once per test file and copied into each database. */
let template: Promise<File | Blob> | undefined;

async function migratedTemplate(): Promise<File | Blob> {
  const client = new PGlite();
  await migrate(drizzle({ client, schema }), { migrationsFolder: MIGRATIONS });
  const dump = await client.dumpDataDir("none");
  await client.close();
  return dump;
}

/** Fresh in-process Postgres with every migration applied. One per test keeps state isolated. */
export async function makeTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  template ??= migratedTemplate();
  const client = new PGlite({ loadDataDir: await template });
  return { db: drizzle({ client, schema }), close: () => client.close() };
}
