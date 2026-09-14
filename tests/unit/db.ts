import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

const MIGRATIONS = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));

/** Fresh in-process Postgres with every migration applied. One per test keeps state isolated. */
export async function makeTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
