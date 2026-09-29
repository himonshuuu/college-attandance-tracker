import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { runMigrations } from "../db/migrations";

type Row = Record<string, unknown>;
type Report = {
  source: string;
  dryRun: boolean;
  startedAt: string;
  completedAt?: string;
  sourceCounts: Record<string, number>;
  importedCounts: Record<string, number>;
  targetCounts?: Record<string, number>;
};

const TABLES = [
  "users", "subscriptions", "sessions", "college_sessions", "monitor_state",
  "password_resets", "rank_snapshots", "friendships", "user_badges", "attendance_cache",
] as const;

interface SQLiteSource {
  path: string;
  cleanup: () => void;
}
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_]+$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

function queryAll(db: SQLiteSource, sql: string): Row[] {
  const output = execFileSync("sqlite3", ["-json", db.path, sql], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return output.trim() ? JSON.parse(output) as Row[] : [];
}

function tableExists(db: SQLiteSource, table: string): boolean {
  return queryAll(db, `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length > 0;
}

function rows(db: SQLiteSource, table: string): Row[] {
  return queryAll(db, `SELECT * FROM ${quoteIdentifier(table)}`);
}

function countRows(db: SQLiteSource, table: string): number {
  const result = queryAll(db, `SELECT count(*) AS count FROM ${quoteIdentifier(table)}`);
  return Number(result[0]?.count ?? 0);
}

function stringValue(value: unknown, fallback = ""): string {
  return value == null ? fallback : String(value);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function dateValue(value: unknown, field = "unknown"): string | null {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp in source field ${field}: ${String(value)}`);
  return date.toISOString();
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try { return JSON.parse(value); } catch { return value; }
}

function userRows(db: SQLiteSource): Row[] {
  const sourceUsers = tableExists(db, "users") ? rows(db, "users") : [];
  return sourceUsers.map((row) => ({
      id: Number(row.id),
      email: stringValue(row.email),
      password_hash: stringValue(row.password_hash),
      enrollment_id: stringValue(row.enrollment_id),
      name: stringValue(row.name),
      class_name: stringValue(row.class_name),
      stream: stringValue(row.stream),
      roll_number: stringValue(row.roll_number),
      profile_photo_url: stringValue(row.profile_photo_url),
      active: booleanValue(row.active ?? 1),
      created_at: dateValue(row.created_at, "users.created_at") ?? new Date(0).toISOString(),
      updated_at: dateValue(row.updated_at ?? row.created_at, "users.updated_at") ?? new Date(0).toISOString(),
    }));
}

function mapRow(table: string, source: Row): Row {
  switch (table) {
    case "users": return {
      id: Number(source.id), email: stringValue(source.email), password_hash: stringValue(source.password_hash), enrollment_id: stringValue(source.enrollment_id),
      name: stringValue(source.name), class_name: stringValue(source.class_name), stream: stringValue(source.stream), roll_number: stringValue(source.roll_number), profile_photo_url: stringValue(source.profile_photo_url),
      active: booleanValue(source.active), created_at: dateValue(source.created_at, "users.created_at") ?? new Date(0).toISOString(), updated_at: dateValue(source.updated_at ?? source.created_at, "users.updated_at") ?? new Date(0).toISOString(),
    };
    case "subscriptions": return { id: Number(source.id), enrollment_id: stringValue(source.enrollment_id), method: stringValue(source.method), email: source.email == null ? null : stringValue(source.email), push_subscription: source.push_subscription == null ? null : stringValue(source.push_subscription), created_at: dateValue(source.created_at, "subscriptions.created_at") ?? new Date(0).toISOString() };
    case "sessions": return { token: stringValue(source.token), user_id: Number(source.user_id), email: stringValue(source.email), enrollment_id: stringValue(source.enrollment_id), expires_at: dateValue(source.expires_at, "sessions.expires_at"), created_at: dateValue(source.created_at, "sessions.created_at") ?? new Date(0).toISOString() };
    case "college_sessions": return { enrollment_id: stringValue(source.enrollment_id), session_id: stringValue(source.session_id), obtained_at: Number(source.obtained_at) };
    case "monitor_state": return { key: stringValue(source.key), value: stringValue(source.value) };
    case "password_resets": return { id: Number(source.id), user_id: Number(source.user_id), email: stringValue(source.email), token_hash: stringValue(source.token_hash), expires_at: dateValue(source.expires_at, "password_resets.expires_at"), used_at: dateValue(source.used_at, "password_resets.used_at"), created_at: dateValue(source.created_at, "password_resets.created_at") ?? new Date(0).toISOString() };
    case "rank_snapshots": return { enrollment_id: stringValue(source.enrollment_id), month: stringValue(source.month), rank: Number(source.rank), pct: Number(source.pct), updated_at: dateValue(source.updated_at, "rank_snapshots.updated_at") ?? new Date(0).toISOString(), total: Number(source.total ?? 0), present: Number(source.present ?? 0), absent: Number(source.absent ?? 0) };
    case "friendships": return { id: Number(source.id), user_id: Number(source.user_id), friend_user_id: Number(source.friend_user_id), status: stringValue(source.status, "pending"), created_at: dateValue(source.created_at, "friendships.created_at") ?? new Date(0).toISOString() };
    case "user_badges": return { user_id: Number(source.user_id), badge: stringValue(source.badge), awarded_at: dateValue(source.awarded_at, "user_badges.awarded_at") ?? new Date(0).toISOString() };
    case "attendance_cache": return { enrollment_id: stringValue(source.enrollment_id), year: Number(source.year), month: stringValue(source.month), payload: jsonValue(source.payload), fetched_at: dateValue(source.fetched_at, "attendance_cache.fetched_at") ?? new Date(0).toISOString() };
    default: throw new Error(`Unsupported table ${table}`);
  }
}

function keyColumns(table: string): string[] {
  if (table === "sessions" || table === "monitor_state") return [table === "sessions" ? "token" : "key"];
  if (table === "college_sessions") return ["enrollment_id"];
  if (table === "rank_snapshots" || table === "attendance_cache") return table === "rank_snapshots" ? ["enrollment_id", "month"] : ["enrollment_id", "year", "month"];
  if (table === "user_badges") return ["user_id", "badge"];
  return ["id"];
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  return value;
}

function looksLikeTimestamp(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value);
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}

function equivalent(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  const left = comparable(a);
  const right = comparable(b);
  if (typeof left === "object" || typeof right === "object") return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
  if (looksLikeTimestamp(left) || looksLikeTimestamp(right)) return dateValue(left, "comparison") === dateValue(right, "comparison");
  return String(left) === String(right);
}

type SqlClient = { query: pg.PoolClient["query"] };

async function copyRows(client: SqlClient, table: string, sourceRows: Row[], importedCounts: Record<string, number>): Promise<void> {
  if (!sourceRows.length) return;
  const mapped = sourceRows.map((row) => mapRow(table, row));
  const targetColumns = Object.keys(mapped[0]);
  const key = keyColumns(table);
  const columnsSql = targetColumns.map(quoteIdentifier).join(", ");
  const placeholders = targetColumns.map((_, index) => `$${index + 1}`).join(", ");
  const keySql = key.map(quoteIdentifier).join(", ");
  const selectSql = `SELECT ${columnsSql} FROM ${quoteIdentifier(table)} WHERE ${key.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(" AND ")}`;
  for (const row of mapped) {
    const values = targetColumns.map((column) => {
      if (table === "attendance_cache" && column === "payload") return JSON.stringify(row[column]);
      return row[column];
    });
    const keyValues = key.map((column) => row[column]);
    let insert: { rowCount: number | null };
    let existing: { rows: Row[] };
    try {
      insert = await client.query(`INSERT INTO ${quoteIdentifier(table)} (${columnsSql}) VALUES (${placeholders}) ON CONFLICT (${keySql}) DO NOTHING`, values);
      existing = await client.query<Row>(selectSql, keyValues);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed importing ${table} (${key.map((column) => `${column}=${String(row[column])}`).join(", ")}): ${message}`);
    }
    if (!existing.rows[0]) throw new Error(`Verification failed: ${table} row is missing after insert`);
    for (const column of targetColumns) {
      if (!equivalent(row[column], existing.rows[0][column])) throw new Error(`Conflict in ${table} ${key.map((columnName) => `${columnName}=${String(row[columnName])}`).join(", ")} at column ${column}`);
    }
    if (insert.rowCount) importedCounts[table] = (importedCounts[table] ?? 0) + 1;
  }
}

async function countTarget(client: SqlClient, table: string): Promise<number> {
  const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${quoteIdentifier(table)}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function resetSequences(client: SqlClient): Promise<void> {
  for (const table of ["users", "subscriptions", "password_resets", "friendships", "migration_runs"]) {
    const sequence = await client.query<{ sequence_name: string | null }>(
      "SELECT pg_get_serial_sequence($1, 'id') AS sequence_name",
      [table],
    );
    const sequenceName = sequence.rows[0]?.sequence_name;
    if (!sequenceName) continue;
    await client.query(
      `SELECT setval($1::regclass, COALESCE((SELECT max(id) FROM ${quoteIdentifier(table)}), 1), true)`,
      [sequenceName],
    );
  }
}

async function main(): Promise<void> {
  const sourcePath = argument("source");
  const targetUrl = argument("target") ?? process.env.DATABASE_URL;
  const dryRun = hasFlag("dry-run");
  const reportPath = argument("report");
  if (!sourcePath || !targetUrl) throw new Error("Usage: migrate:d1 --source source.sqlite --target DATABASE_URL [--dry-run] [--report file]");
  if (!fs.existsSync(path.resolve(sourcePath))) throw new Error(`Source SQLite file does not exist: ${sourcePath}`);

  const startedAt = new Date().toISOString();
  const sourceBytes = fs.readFileSync(path.resolve(sourcePath));
  const sourceIsDatabase = sourceBytes.subarray(0, 15).toString("utf8") === "SQLite format 3";
  const temporaryDirectory = sourceIsDatabase ? null : fs.mkdtempSync(path.join(os.tmpdir(), "d1-import-"));
  const sourceDatabasePath = sourceIsDatabase ? path.resolve(sourcePath) : path.join(temporaryDirectory!, "source.sqlite");
  if (!sourceIsDatabase) {
    execFileSync("sqlite3", [sourceDatabasePath], {
      input: sourceBytes,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
  const source: SQLiteSource = {
    path: sourceDatabasePath,
    cleanup: () => {
      if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    },
  };
  const sourceCounts: Record<string, number> = {};
  for (const table of TABLES) sourceCounts[table] = tableExists(source, table) ? countRows(source, table) : 0;
  const normalizedUsers = userRows(source);
  const report: Report = { source: path.resolve(sourcePath), dryRun, startedAt, sourceCounts, importedCounts: {} };

  if (dryRun) {
    for (const table of TABLES.filter((table) => table !== "users")) {
      if (tableExists(source, table)) rows(source, table).forEach((row) => mapRow(table, row));
    }
    console.log(JSON.stringify({ ...report, message: "Dry run complete. PostgreSQL was not changed." }, null, 2));
    source.cleanup();
    return;
  }

  const client = new pg.Client({ connectionString: targetUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await runMigrations(client);
    const run = await client.query<{ id: number }>("INSERT INTO migration_runs (source_path, started_at, status, source_counts) VALUES ($1, $2, 'running', $3) RETURNING id", [path.resolve(sourcePath), startedAt, sourceCounts]);
    const runId = run.rows[0].id;
    await copyRows(client, "users", normalizedUsers, report.importedCounts);
    for (const table of TABLES.filter((table) => table !== "users")) {
      if (!tableExists(source, table)) continue;
      await copyRows(client, table, rows(source, table), report.importedCounts);
    }
    await resetSequences(client);
    const targetCounts: Record<string, number> = {};
    for (const table of TABLES) targetCounts[table] = await countTarget(client, table);
    report.targetCounts = targetCounts;
    report.completedAt = new Date().toISOString();
    await client.query("UPDATE migration_runs SET completed_at = $1, status = 'completed', target_counts = $2 WHERE id = $3", [report.completedAt, targetCounts, runId]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ ...report, message: "Migration completed and every imported row was verified." }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
    source.cleanup();
  }
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "d1-migration-failed", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
