#!/usr/bin/env node
// Runs the pgTAP suite in supabase/tests against the remote project through the
// Management API. Each test file defines functions in schema `tests`; the runner
// installs pgtap, loads the files, runs `runtests('tests', '^test_')` (every test
// runs inside a savepoint that is rolled back), prints the TAP output, drops the
// `tests` schema, and exits non-zero on any failure.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSql } from "./supabase-management.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(here, "../supabase/tests");

async function main() {
  const files = (await readdir(testsDir)).filter((f) => f.endsWith(".sql")).sort();
  const bodies = [];
  for (const f of files) bodies.push(await readFile(path.join(testsDir, f), "utf8"));

  await runSql("create extension if not exists pgtap with schema extensions;");
  await runSql("drop schema if exists tests cascade; create schema tests;");
  try {
    for (const [i, body] of bodies.entries()) {
      process.stdout.write(`loading ${files[i]} ... `);
      await runSql(body);
      console.log("ok");
    }
    // Tests impersonate authenticated users, who must still be able to call the helpers.
    await runSql(
      "grant usage on schema tests to authenticated; grant execute on all functions in schema tests to authenticated;",
    );
    const rows = await runSql("select * from extensions.runtests('tests'::name, '^test_');");
    const lines = rows.map((r) => Object.values(r)[0]);
    let failures = 0;
    let passes = 0;
    for (const line of lines) {
      if (/^not ok/.test(line)) failures++;
      else if (/^ok/.test(line)) passes++;
      console.log(line);
    }
    console.log(`\n${passes} passed, ${failures} failed`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await runSql("drop schema if exists tests cascade;").catch(() => {});
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
