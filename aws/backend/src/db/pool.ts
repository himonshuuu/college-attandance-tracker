import pg from "pg";
import { env } from "../config/env";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  maxUses: 10_000,
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (error) => {
  console.error(JSON.stringify({ event: "postgres-pool-error", error: error.message }));
});

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
