import { pool, withTransaction } from "./pool";
import { runMigrations } from "./migrations";

async function main(): Promise<void> {
  try {
    await withTransaction(async (client) => runMigrations(client));
    console.log("PostgreSQL schema is ready.");
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
