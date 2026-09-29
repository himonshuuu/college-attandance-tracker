import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";

const migrationsDirectory = path.resolve(__dirname, "../../migrations");

export async function runMigrations(client: Pick<PoolClient, "query">): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = (await fs.readdir(migrationsDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(migrationsDirectory, file), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    console.log(`Applied migration ${file}`);
  }
}
