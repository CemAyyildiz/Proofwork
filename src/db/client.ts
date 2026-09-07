import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/config/env";
import * as schema from "./schema";

const sql = neon(env.DATABASE_URL);

export const db = drizzle({ client: sql, schema });
export type Db = typeof db;
