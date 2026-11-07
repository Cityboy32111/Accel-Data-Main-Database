#!/usr/bin/env node
// Applies supabase/migrations/*.sql to the remote project through the Management API
// and records them in supabase_migrations.schema_migrations in the same format the
// Supabase CLI uses, so `supabase migration list` and `supabase db push` agree.
//
//   node scripts/apply-migrations.mjs            apply pending migrations
//   node scripts/apply-migrations.mjs --dry-run  list pending migrations only
//   node scripts/apply-migrations.mjs --seed     apply pending migrations, then supabase/seed.sql
//   node scripts/apply-migrations.mjs --status   show applied vs pending

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSql, sqlLiteral } from "./supabase-management.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../supabase/migrations");
const seedFile = path.resolve(here, "../supabase/seed.sql");
const args = new Set(process.argv.slice(2));

async function ensureMigrationTable() {
  await runSql(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
    alter table supabase_migrations.schema_migrations add column if not exists statements text[];
    alter table supabase_migrations.schema_migrations add column if not exists name text;
  `);
}

async function appliedVersions() {
  const rows = await runSql("select version, name from supabase_migrations.schema_migrations order by version;");
  return new Map(rows.map((r) => [r.version, r.name]));
}

async function localMigrations() {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  return files.map((file) => {
    const m = file.match(/^(\d{14})_(.+)\.sql$/);
    if (!m) throw new Error(`migration file name not in <14 digits>_<name>.sql form: ${file}`);
    return { file, version: m[1], name: m[2], fullPath: path.join(migrationsDir, file) };
  });
}

async function main() {
  await ensureMigrationTable();
  const applied = await appliedVersions();
  const local = await localMigrations();
  const pending = local.filter((m) => !applied.has(m.version));

  if (args.has("--status") || args.has("--dry-run")) {
    for (const m of local) {
      console.log(`${applied.has(m.version) ? "applied " : "pending "} ${m.version} ${m.name}`);
    }
    if (args.has("--status")) return;
    if (!args.has("--seed")) return;
  }

  for (const m of pending) {
    const sql = await readFile(m.fullPath, "utf8");
    process.stdout.write(`applying ${m.version} ${m.name} ... `);
    // One request: the migration body plus its bookkeeping row, in a single transaction.
    const wrapped = `
      begin;
      ${sql}
      insert into supabase_migrations.schema_migrations (version, name, statements)
      values (${sqlLiteral(m.version)}, ${sqlLiteral(m.name)}, array[${sqlLiteral(sql)}]);
      commit;
    `;
    try {
      await runSql(wrapped);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      // Make sure nothing is left open on the server side.
      await runSql("rollback;").catch(() => {});
      throw err;
    }
  }
  if (pending.length === 0) console.log("no pending migrations");

  if (args.has("--seed")) {
    const seed = await readFile(seedFile, "utf8");
    process.stdout.write("applying seed.sql ... ");
    await runSql(`begin; ${seed} commit;`);
    console.log("ok");
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
