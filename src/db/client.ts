import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";
import * as schema from "./schema";

/**
 * One connection pool per server process. Works unchanged against local
 * Postgres and Neon (pooled connection string) — no vendor driver.
 */
const client = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === "production" ? 5 : 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle({ client, schema });
export type Db = typeof db;
