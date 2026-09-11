import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";
import * as schema from "./schema";

/**
 * One connection pool per server process. Works unchanged against local
 * Postgres and Neon (pooled connection string) — no vendor driver.
 */
type Client = ReturnType<typeof drizzle<typeof schema>>;
let instance: Client | undefined;

function create(): Client {
  const client = postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === "production" ? 5 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return drizzle({ client, schema });
}

/** Created on first query so `next build` can import server modules without a database. */
export const db: Client = new Proxy({} as Client, {
  get(_t, prop: string | symbol) {
    instance ??= create();
    const value = instance[prop as keyof Client];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(instance) : value;
  },
});
export type Db = Client;
