import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Entirely invented local PostgreSQL/WASM data. No real ledger, credentials,
// browser, Supabase connection or paid provider is read or contacted.
const sha = value => createHash('sha256').update(String(value)).digest('hex');
const expiry = 1792972074000;
const oldExpression = 'greatest(hold,coalesce(cost,hold))';
const newExpression = "CASE WHEN state='succeeded' AND cost IS NOT NULL THEN cost ELSE greatest(hold,coalesce(cost,hold)) END";
const beforeHash = '4e1d233124d1ac48278b51382aa1825182ed09690836ca3ac5bd48fea7f9cc57';
const afterHash = '79ee94dcdf19d9d887e1353eedb0593d941f155b3710ce206e7c9a4139d29451';
const migration = await readFile(new URL('../hosted/migrations/002-settle-successful-reservations.sql', import.meta.url), 'utf8');
const initial = await readFile(new URL('../hosted/migrations/001-hosted.sql', import.meta.url), 'utf8');
const accountingComment = /      -- Settle only a recorded success with a known calculated cost\. Uncertain\n      -- and in-flight jobs keep their hold \(or a higher known amount\)\. The same\n      -- expression below makes displayed usage and admission use one budget\.\n/;
const previousInitial = initial.replace(accountingComment, '').replaceAll(newExpression, oldExpression);

async function setup(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("CREATE ROLE yamadaya_trial_owner NOLOGIN; CREATE ROLE yamadaya_trial_runtime NOLOGIN; GRANT CREATE ON DATABASE postgres TO yamadaya_trial_owner; SET ROLE yamadaya_trial_owner; SET yamadaya_trial.migration_target='dedicated-project';");
  await db.exec(previousInitial);
  const now = Date.now(), jobs = [350000,50000,50000].map((hold, i) => ({ id: `dummy-unknown-${i}`, owner: sha(`old-${i}`), feature: i ? 'chat' : 'image', state: 'unknown', hold, cost: null, created: now - 10000, finished: null, request_hash: sha(`old-request-${i}`) }));
  jobs.push({ id: 'dummy-done', owner: sha('old-success'), feature: 'image', state: 'succeeded', hold: 350000, cost: 20000, created: now - 10000, finished: now - 9000, request_hash: sha('done-request') });
  await db.query('SELECT yamadaya_trial.import_snapshot($1::jsonb)', [JSON.stringify({ version: 1, snapshotHash: sha('entirely-invented-snapshot'), limitMicros: 10000000, approvedUntil: expiry, expected: { count: 4, reserved: 800000, calculated: 20000, uncertain: 3 }, jobs })]);
  for (const id of ['trial-mac','trial-windows','trial-windows2']) await db.query("INSERT INTO yamadaya_trial.devices VALUES($1,$2,'active',$3,$4)", [id, sha(`dummy-${id}`), now - 10000, expiry]);
  await db.exec("RESET ROLE; SET yamadaya_trial.settlement_target='pgcvetybmtvojpivfjdm:release-success-holds-v1';");
  return db;
}
async function definition(db) {
  return (await db.query("SELECT pg_get_functiondef('yamadaya_trial.runtime(text,jsonb)'::regprocedure) AS value")).rows[0].value;
}
async function rows(db) {
  const result = {};
  for (const [table, order] of [['budget','id'],['jobs','id'],['devices','id'],['sessions','hash'],['nonces','nonce'],['results','id']]) {
    result[table] = (await db.query(`SELECT * FROM yamadaya_trial.${table} ORDER BY ${order}`)).rows;
  }
  return result;
}
async function rejected(db, source, expected) {
  await assert.rejects(db.exec(source), expected);
  await db.exec('ROLLBACK; RESET ROLE;');
}

test('existing-trial migration replaces exactly two sums and preserves every row and function metadata', async t => {
  const db = await setup(t), before = await rows(db), source = await definition(db);
  assert.equal(sha(source), beforeHash);
  const catalogBefore = (await db.query("SELECT to_jsonb(p)-'prosrc' AS value FROM pg_proc p WHERE p.oid='yamadaya_trial.runtime(text,jsonb)'::regprocedure")).rows[0].value;
  const schemaBefore = (await db.query("SELECT * FROM pg_namespace WHERE nspname='yamadaya_trial'")).rows;
  const importBefore = (await db.query("SELECT pg_get_functiondef('yamadaya_trial.import_snapshot(jsonb)'::regprocedure) AS value")).rows[0].value;
  const result = await db.exec(migration);
  const usage = result.find(r => r.rows?.[0]?.reservation_settlement)?.rows[0].reservation_settlement.value;
  assert.equal(usage.reserved, 470000); assert.equal(usage.calculated, 20000);
  assert.equal(usage.uncertain, 3); assert.equal(usage.limit, 10000000); assert.equal(usage.expires, expiry);
  assert.deepEqual(await rows(db), before);
  const updated = await definition(db);
  assert.equal(updated, source.replaceAll(oldExpression, newExpression)); assert.equal(sha(updated), afterHash);
  assert.deepEqual((await db.query("SELECT to_jsonb(p)-'prosrc' AS value FROM pg_proc p WHERE p.oid='yamadaya_trial.runtime(text,jsonb)'::regprocedure")).rows[0].value, catalogBefore);
  assert.deepEqual((await db.query("SELECT * FROM pg_namespace WHERE nspname='yamadaya_trial'")).rows, schemaBefore);
  assert.equal((await db.query("SELECT pg_get_functiondef('yamadaya_trial.import_snapshot(jsonb)'::regprocedure) AS value")).rows[0].value, importBefore);
});

test('migration refuses accidental rerun without changing the settled function or rows', async t => {
  const db = await setup(t); await db.exec(migration);
  const before = await rows(db), source = await definition(db);
  await rejected(db, migration, /Reviewed runtime definition/);
  assert.equal(await definition(db), source); assert.deepEqual(await rows(db), before);
});

test('migration refuses missing dedicated-project confirmation', async t => {
  const db = await setup(t); await db.exec('RESET yamadaya_trial.settlement_target;');
  await rejected(db, migration, /target\/owner/);
  assert.equal(sha(await definition(db)), beforeHash);
});

test('migration refuses a runtime changed since the reviewed snapshot', async t => {
  const db = await setup(t), original = await definition(db);
  await db.exec(original.replace('BEGIN\n', 'BEGIN\n  -- unreviewed local-only edit\n'));
  const changed = await definition(db);
  await rejected(db, migration, /Reviewed runtime definition/);
  assert.equal(await definition(db), changed);
});

test('migration refuses a different function security/search_path setting', async t => {
  const db = await setup(t); await db.exec('ALTER FUNCTION yamadaya_trial.runtime(text,jsonb) SECURITY INVOKER;');
  await rejected(db, migration, /ownership\/security\/search_path/);
});

test('migration refuses changed budget/import/expiry without resetting anything', async t => {
  const db = await setup(t);
  for (const update of ["limit_micros=9000000", "imported=false", `approved_until=${expiry + 1}`]) {
    await db.exec(`UPDATE yamadaya_trial.budget SET ${update};`);
    const before = await rows(db);
    await rejected(db, migration, /budget\/import\/deadline/);
    assert.deepEqual(await rows(db), before);
    await db.exec(`UPDATE yamadaya_trial.budget SET limit_micros=10000000,imported=true,approved_until=${expiry};`);
  }
});

test('migration refuses a changed original unknown hold or snapshot', async t => {
  const db = await setup(t); await db.exec("UPDATE yamadaya_trial.jobs SET hold=50001 WHERE id='dummy-unknown-1';");
  const before = await rows(db);
  await rejected(db, migration, /three unresolved holds/);
  assert.deepEqual(await rows(db), before);
});

test('migration refuses a duplicate snapshot identity even when its count and hold total match', async t => {
  const db = await setup(t);
  await db.exec("UPDATE yamadaya_trial.budget SET unknown_snapshot=jsonb_set(unknown_snapshot,'{2}',unknown_snapshot->1);");
  const before = await rows(db);
  await rejected(db, migration, /three unresolved holds/);
  assert.deepEqual(await rows(db), before);
});

test('migration refuses a new unknown rather than resetting the pause or releasing any uncertain hold', async t => {
  const db = await setup(t);
  await db.query("INSERT INTO yamadaya_trial.jobs(id,owner,feature,state,hold,cost,created,finished,request_hash) VALUES('new-unknown',$1,'chat','unknown',15000,NULL,$2,NULL,$3)", [sha('new-owner'), Date.now(), sha('new-request')]);
  await db.exec('UPDATE yamadaya_trial.budget SET paused=true;');
  const before = await rows(db);
  await rejected(db, migration, /three unresolved holds/);
  assert.deepEqual(await rows(db), before);
});

test('migration refuses a missing, revoked or extra approved device', async t => {
  const db = await setup(t); await db.exec("UPDATE yamadaya_trial.devices SET status='revoked' WHERE id='trial-windows2';");
  await rejected(db, migration, /three approved device/);
  await db.exec("UPDATE yamadaya_trial.devices SET status='active' WHERE id='trial-windows2';");
  await db.query("INSERT INTO yamadaya_trial.devices VALUES('fourth',$1,'active',$2,$3)", [sha('fourth'), Date.now() - 10000, expiry]);
  await rejected(db, migration, /three approved device/);
});

test('migration refuses an in-flight operation and leaves its state untouched', async t => {
  const db = await setup(t), now = Date.now();
  await db.query("INSERT INTO yamadaya_trial.jobs(id,owner,feature,state,hold,created,request_hash,executor_hash,lease_expires) VALUES('sending',$1,'chat','sending',15000,$2,$3,$4,$5)", [sha('sending-owner'), now, sha('sending-request'), sha('executor'), now + 300000]);
  const before = await rows(db);
  await rejected(db, migration, /in flight/);
  assert.deepEqual(await rows(db), before);
});

test('any event-trigger row side effect rolls back both replacement and metadata', async t => {
  const db = await setup(t);
  // Simulate an unexpected DDL hook in a disposable engine, not the live DB.
  await db.exec("CREATE FUNCTION public.dummy_mutation() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN UPDATE yamadaya_trial.budget SET paused=true; END $$; CREATE EVENT TRIGGER dummy_mutation ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION public.dummy_mutation();");
  const before = await rows(db);
  await rejected(db, migration, /Settlement after-check failed/);
  assert.deepEqual(await rows(db), before); assert.equal(sha(await definition(db)), beforeHash);
});

test('inverse exact-two replacement restores old accounting while preserving rows', async t => {
  const db = await setup(t); await db.exec(migration);
  const before = await rows(db);
  // Apply the same guarded transaction in reverse. Swapping markers prevents
  // touching the nested old expression inside the new expression literal.
  const reverse = migration
    .replace("old_expression constant text := 'greatest(hold,coalesce(cost,hold))';", "old_expression constant text := '__REVERSE_FROM__';")
    .replace("new_expression constant text := 'CASE WHEN state=''succeeded'' AND cost IS NOT NULL THEN cost ELSE greatest(hold,coalesce(cost,hold)) END';", "new_expression constant text := 'greatest(hold,coalesce(cost,hold))';")
    .replace('__REVERSE_FROM__', "CASE WHEN state=''succeeded'' AND cost IS NOT NULL THEN cost ELSE greatest(hold,coalesce(cost,hold)) END")
    .replaceAll(beforeHash, '__HASH_SWAP__').replaceAll(afterHash, beforeHash).replaceAll('__HASH_SWAP__', afterHash);
  await db.exec(reverse);
  assert.equal(sha(await definition(db)), beforeHash); assert.deepEqual(await rows(db), before);
  assert.equal((await db.query("SELECT yamadaya_trial.runtime('usage','{}') AS value")).rows[0].value.value.reserved, 800000);
});
