import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { prepareHostedDatabase, TARGET_PROJECT_REF, REVIEWED_AUTO_RLS_SHA256 } from '../scripts/prepare-hosted-db.mjs';
import { prepareHostedTrialDatabase } from '../scripts/prepare-hosted-trial-db.mjs';
import { createTrialSnapshot, trialActivationSql, TRIAL_APPROVED_UNTIL } from '../hosted/trial-transfer.mjs';
import { prepareHostedTrialLoginSql } from '../scripts/prepare-hosted-trial-login.mjs';

const source = await readFile(new URL('../hosted/migrations/001-hosted.sql', import.meta.url), 'utf8');
const sql = prepareHostedDatabase(source);
// Exact read-only pg_get_functiondef from the dedicated project (2026-10-19),
// not a rewritten approximation. Vendor feature documentation:
// https://supabase.com/docs/guides/database/postgres/event-triggers
const reviewedHelper = await readFile(new URL('./fixtures/supabase-reviewed-rls-auto-enable.sql', import.meta.url), 'utf8');

async function fixture() {
  const db = new PGlite();
  // Simulate managed Supabase: postgres owns the DB and can create roles but is
  // NOT superuser. The test driver remains bootstrap-superuser only for setup.
  try {
    await db.exec(`CREATE ROLE test_root SUPERUSER LOGIN;
      SET SESSION AUTHORIZATION test_root; ALTER ROLE postgres RENAME TO pglite_bootstrap;
      CREATE ROLE postgres LOGIN CREATEROLE SUPERUSER;
      ALTER DATABASE postgres OWNER TO postgres;
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      SET SESSION AUTHORIZATION postgres;`);
    // Supabase Supautils permits postgres to manage event triggers without
    // superuser. Emulate the pre-existing vendor trigger during fixture setup,
    // then remove SUPERUSER before executing any generated provisioning SQL.
    await db.exec(`${reviewedHelper}; CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') EXECUTE FUNCTION public.rls_auto_enable();
      SET SESSION AUTHORIZATION test_root; ALTER ROLE postgres NOSUPERUSER;
      SET SESSION AUTHORIZATION postgres;`);
  } catch (error) { await db.close(); throw error; }
  return db;
}

test('the draft provisions empty paused mock tables as a non-superuser, with no usable credentials', async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")).rows[0].rolsuper, false);
    assert.equal(createHash('sha256').update(reviewedHelper).digest('hex'), REVIEWED_AUTO_RLS_SHA256);
    await db.exec(sql);
    assert.equal((await db.query("SELECT pg_get_functiondef('public.rls_auto_enable()'::regprocedure) value")).rows[0].value, reviewedHelper);
    assert.equal((await db.query("SELECT evtenabled FROM pg_event_trigger WHERE evtname='ensure_rls'")).rows[0].evtenabled, 'O');
    assert.match(sql, new RegExp(TARGET_PROJECT_REF));
    const roles = (await db.query("SELECT rolname,rolcanlogin FROM pg_roles WHERE rolname LIKE 'yamadaya_mock_%' ORDER BY rolname")).rows;
    assert.equal(roles.length, 3);
    assert.equal(roles.some(r => r.rolcanlogin), false);
    await db.exec('SET ROLE yamadaya_mock_owner');
    assert.deepEqual((await db.query('SELECT imported,paused,approved_until FROM yamadaya_mock.budget')).rows,
      [{ imported: false, paused: true, approved_until: 0 }]);
    for (const table of ['devices','sessions','jobs','nonces','results']) {
      assert.equal((await db.query(`SELECT count(*)::int n FROM yamadaya_mock.${table}`)).rows[0].n, 0);
    }
    const def = (await db.query("SELECT n.nspowner::regrole::text owner FROM pg_namespace n WHERE n.nspname='yamadaya_mock'")).rows[0];
    assert.equal(def.owner, 'yamadaya_mock_owner');
    // New future administrative functions must not inherit PUBLIC EXECUTE.
    await db.exec("CREATE FUNCTION yamadaya_mock.future_admin_test() RETURNS boolean LANGUAGE sql AS 'SELECT true';");
    assert.equal((await db.query("SELECT has_function_privilege('yamadaya_mock_web','yamadaya_mock.future_admin_test()','EXECUTE') allowed")).rows[0].allowed, false);
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION test_root; SET SESSION AUTHORIZATION yamadaya_mock_web');
    const usage = (await db.query("SELECT yamadaya_mock.runtime('usage','{}') result")).rows[0].result;
    assert.equal(usage.ok, true);
    assert.equal(usage.value.imported, false);
    assert.equal(usage.value.paused, true);
    for (const statement of [
      'SELECT * FROM yamadaya_mock.budget',
      "SELECT yamadaya_mock.import_snapshot('{}')",
      'SET ROLE yamadaya_mock_owner', 'SET ROLE yamadaya_mock_runtime', 'SET ROLE postgres',
      'CREATE TABLE yamadaya_mock.unapproved(id int)',
    ]) await assert.rejects(db.exec(statement), e => e.code === '42501');
    await db.exec('SET SESSION AUTHORIZATION test_root; SET SESSION AUTHORIZATION anon');
    await assert.rejects(db.query("SELECT yamadaya_mock.runtime('usage','{}')"), e => e.code === '42501');
  } finally { await db.close(); }
});

test('collisions fail closed without changing existing roles, schemas, or application objects', async () => {
  for (const collision of [
    "CREATE ROLE yamadaya_mock_web LOGIN PASSWORD NULL SUPERUSER",
    'CREATE SCHEMA yamadaya_trial',
    'CREATE TABLE public.existing_business_data(id int)',
    "CREATE FUNCTION public.existing_business_function() RETURNS int LANGUAGE sql AS 'SELECT 1'",
  ]) {
    const db = await fixture();
    try {
      // Only the fixture driver can install the hostile existing superuser role.
      await db.exec('SET SESSION AUTHORIZATION test_root');
      await db.exec(collision);
      await db.exec('SET SESSION AUTHORIZATION postgres');
      await assert.rejects(db.exec(sql), /collision|Existing public application objects/);
      await db.exec('ROLLBACK');
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname='yamadaya_mock'")).rows[0].n, 0);
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='yamadaya_mock_owner'")).rows[0].n, 0);
    } finally { await db.close(); }
  }
});

test('draft generation refuses unexpected transaction boundaries rather than changing their meaning', () => {
  assert.throws(() => prepareHostedDatabase(source.replace('\nBEGIN;\n', '\n')), /transaction boundary/);
  assert.throws(() => prepareHostedDatabase(`${source}\nBEGIN;\nCOMMIT;\n`), /transaction boundary/);
  assert.throws(() => prepareHostedDatabase(source.replace(/COMMIT;\n$/, '')), /transaction boundary/);
});

test('only the exact existing RLS helper and unchanged trigger may pass the public-object guard', async () => {
  for (const tamper of [
    `CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS 'BEGIN RETURN; END'`,
    'ALTER FUNCTION public.rls_auto_enable() SECURITY INVOKER',
    "ALTER FUNCTION public.rls_auto_enable() SET search_path='public'",
    'ALTER FUNCTION public.rls_auto_enable() OWNER TO test_root',
    'ALTER EVENT TRIGGER ensure_rls DISABLE',
    'ALTER EVENT TRIGGER ensure_rls OWNER TO test_root',
    `DROP EVENT TRIGGER ensure_rls; CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.rls_auto_enable()`,
    `CREATE FUNCTION public.rls_auto_enable(extra integer) RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
  ]) {
    const db = await fixture();
    try {
      await db.exec('SET SESSION AUTHORIZATION test_root');
      await db.exec(tamper);
      await db.exec('SET SESSION AUTHORIZATION postgres');
      await assert.rejects(db.exec(sql), /Reviewed automatic-RLS helper or trigger differs|Existing public application objects/);
      await db.exec('ROLLBACK');
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='yamadaya_mock_owner'")).rows[0].n, 0);
    } finally { await db.close(); }
  }
});

async function asOwner(db, namespace, query, params) {
  await db.exec(`SET ROLE ${namespace}_owner`);
  try { return await db.query(query, params); } finally { await db.exec('RESET ROLE'); }
}

test('trial bootstrap coexists with the existing mock without altering mock rows or grants', async () => {
  const db = await fixture();
  try {
    await db.exec(sql);
    const mockBudget = (await asOwner(db, 'yamadaya_mock', 'SELECT * FROM yamadaya_mock.budget')).rows;
    const mockFunctions = (await db.query("SELECT p.proname,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='yamadaya_mock' ORDER BY p.proname")).rows;
    await db.exec(prepareHostedTrialDatabase(source));
    assert.deepEqual((await asOwner(db, 'yamadaya_mock', 'SELECT * FROM yamadaya_mock.budget')).rows, mockBudget);
    assert.deepEqual((await db.query("SELECT p.proname,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='yamadaya_mock' ORDER BY p.proname")).rows, mockFunctions);
    assert.deepEqual((await asOwner(db, 'yamadaya_trial', 'SELECT imported,paused,approved_until FROM yamadaya_trial.budget')).rows,
      [{ imported: false, paused: true, approved_until: 0 }]);
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('yamadaya_trial_owner','yamadaya_trial_runtime','yamadaya_trial_web') AND rolcanlogin")).rows[0].n, 0);
    assert.equal((await asOwner(db, 'yamadaya_trial', "SELECT has_function_privilege('yamadaya_trial_web','yamadaya_trial.runtime(text,jsonb)','EXECUTE') allowed")).rows[0].allowed, true);
    assert.equal((await asOwner(db, 'yamadaya_trial', "SELECT has_function_privilege('yamadaya_trial_web','yamadaya_trial.import_snapshot(jsonb)','EXECUTE') allowed")).rows[0].allowed, false);
    assert.equal((await db.query("SELECT has_schema_privilege('yamadaya_mock_web','yamadaya_trial','USAGE') allowed")).rows[0].allowed, false);
    await assert.rejects(db.exec(prepareHostedTrialDatabase(source)), /collision/);
    await db.exec('ROLLBACK');
    assert.deepEqual((await asOwner(db, 'yamadaya_mock', 'SELECT * FROM yamadaya_mock.budget')).rows, mockBudget);
  } finally { await db.close(); }
});

function trialSnapshot() {
  const sha = value => createHash('sha256').update(value).digest('hex');
  const jobs = [350000,50000,50000].map((hold, i) => ({ id: `dummy-import-${i}`, owner: sha(`owner-${i}`),
    feature: i ? 'chat' : 'image', state: 'unknown', hold, cost: null, created: Date.now() - 60000,
    finished: null, request_hash: sha(`request-${i}`) }));
  return createTrialSnapshot(jobs);
}

test('trial activation imports exact metadata once and denies runtime import, preserving the old mock', async () => {
  const db = await fixture();
  try {
    await db.exec(sql);
    await db.exec(prepareHostedTrialDatabase(source));
    await asOwner(db, 'yamadaya_trial', "INSERT INTO yamadaya_trial.devices VALUES('dummy-mac',$1,'active',$2,$3)",
      [createHash('sha256').update('dummy-mac').digest('hex'), Date.now() - 1000, TRIAL_APPROVED_UNTIL]);
    const snapshot = trialSnapshot();
    await db.exec(trialActivationSql(snapshot));
    assert.equal((await asOwner(db, 'yamadaya_trial', 'SELECT count(*)::int n FROM yamadaya_trial.jobs')).rows[0].n, 3);
    assert.equal((await asOwner(db, 'yamadaya_mock', 'SELECT count(*)::int n FROM yamadaya_mock.jobs')).rows[0].n, 0);
    assert.equal((await asOwner(db, 'yamadaya_mock', 'SELECT imported FROM yamadaya_mock.budget')).rows[0].imported, false);
    assert.deepEqual((await asOwner(db, 'yamadaya_trial', 'SELECT imported,paused,approved_until,snapshot_hash FROM yamadaya_trial.budget')).rows[0],
      { imported: true, paused: false, approved_until: TRIAL_APPROVED_UNTIL, snapshot_hash: snapshot.snapshotHash });
    await assert.rejects(db.exec(trialActivationSql(snapshot)), /Dedicated empty trial/);
    await db.exec('ROLLBACK');
    assert.equal((await asOwner(db, 'yamadaya_trial', 'SELECT count(*)::int n FROM yamadaya_trial.jobs')).rows[0].n, 3);
    await db.exec('SET SESSION AUTHORIZATION test_root; SET SESSION AUTHORIZATION yamadaya_trial_web');
    await assert.rejects(db.query('SELECT yamadaya_trial.import_snapshot($1::jsonb)', [JSON.stringify(snapshot)]), e => e.code === '42501');
  } finally { await db.close(); }
});

test('failed trial activation rolls back all imported jobs and never relaxes mock or device bounds', async () => {
  const db = await fixture();
  try {
    await db.exec(sql); await db.exec(prepareHostedTrialDatabase(source));
    await asOwner(db, 'yamadaya_trial', "INSERT INTO yamadaya_trial.devices VALUES('dummy-mac',$1,'active',$2,$3)",
      [createHash('sha256').update('dummy-mac').digest('hex'), Date.now() - 1000, TRIAL_APPROVED_UNTIL + 1]);
    await assert.rejects(db.exec(trialActivationSql(trialSnapshot())), /approved devices/);
    await db.exec('ROLLBACK');
    assert.equal((await asOwner(db, 'yamadaya_trial', 'SELECT count(*)::int n FROM yamadaya_trial.jobs')).rows[0].n, 0);
    assert.equal((await asOwner(db, 'yamadaya_trial', 'SELECT imported FROM yamadaya_trial.budget')).rows[0].imported, false);
    await asOwner(db, 'yamadaya_trial', 'UPDATE yamadaya_trial.devices SET not_after=$1', [TRIAL_APPROVED_UNTIL]);
    const snapshot = trialSnapshot();
    const badSql = trialActivationSql(snapshot).replace('"reserved":450000', '"reserved":450001');
    await assert.rejects(db.exec(badSql), /totals/);
    await db.exec('ROLLBACK');
    assert.equal((await asOwner(db, 'yamadaya_trial', 'SELECT count(*)::int n FROM yamadaya_trial.jobs')).rows[0].n, 0);
    assert.equal((await asOwner(db, 'yamadaya_trial', 'SELECT paused FROM yamadaya_trial.budget')).rows[0].paused, true);
    assert.equal((await asOwner(db, 'yamadaya_mock', 'SELECT imported FROM yamadaya_mock.budget')).rows[0].imported, false);
  } finally { await db.close(); }
});

test('trial login SQL generates the secret server-side once, with original expiry and no table/admin import access', async () => {
  const db = await fixture();
  try {
    await db.exec(sql); await db.exec(prepareHostedTrialDatabase(source));
    const draft = prepareHostedTrialLoginSql();
    const result = await db.exec(draft);
    const value = result.flatMap(item => item.rows || []).find(item => item.trial_login_once)?.trial_login_once;
    assert.equal(value.role, 'yamadaya_trial_web');
    assert.equal(value.expires, TRIAL_APPROVED_UNTIL); assert.match(value.password, /^[a-f0-9]{64}$/);
    assert.equal(draft.includes(value.password), false);
    const role = (await db.query("SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolconnlimit,extract(epoch FROM rolvaliduntil)*1000 expiry FROM pg_roles WHERE rolname='yamadaya_trial_web'")).rows[0];
    assert.equal(role.rolcanlogin, true); assert.equal(role.rolconnlimit, 2); assert.equal(Number(role.expiry), TRIAL_APPROVED_UNTIL);
    for (const flag of ['rolsuper','rolcreatedb','rolcreaterole','rolbypassrls']) assert.equal(role[flag], false);
    await assert.rejects(db.query('SELECT pg_temp.issue_yamadaya_trial_login($1,$2)', [TARGET_PROJECT_REF, TRIAL_APPROVED_UNTIL]), /never overwrite existing access/);
    assert.equal((await asOwner(db, 'yamadaya_trial', 'SELECT imported FROM yamadaya_trial.budget')).rows[0].imported, false);
    assert.equal((await asOwner(db, 'yamadaya_mock', 'SELECT imported FROM yamadaya_mock.budget')).rows[0].imported, false);
    const tempFunction = (await db.query("SELECT p.oid FROM pg_proc p WHERE p.proname='issue_yamadaya_trial_login'")).rows[0].oid;
    assert.equal((await db.query("SELECT has_function_privilege('yamadaya_trial_web',$1::oid,'EXECUTE') allowed", [tempFunction])).rows[0].allowed, false);
    await db.exec('SET SESSION AUTHORIZATION test_root; SET SESSION AUTHORIZATION yamadaya_trial_web');
    await assert.rejects(db.exec('SELECT * FROM yamadaya_trial.jobs'), e => e.code === '42501');
    await assert.rejects(db.exec("SELECT yamadaya_trial.import_snapshot('{}')"), e => e.code === '42501');
  } finally { await db.close(); }
});

test('trial login draft rejects another target, prior access, and namespace drift without issuing access', async () => {
  assert.throws(() => prepareHostedTrialLoginSql({ projectRef: 'different-project' }));
  assert.throws(() => prepareHostedTrialLoginSql({ approvedUntil: TRIAL_APPROVED_UNTIL + 1 }));
  for (const tamper of [
    "ALTER ROLE yamadaya_trial_web LOGIN",
    "ALTER ROLE yamadaya_trial_web VALID UNTIL '2026-10-26 00:00:00Z'",
    'CREATE TABLE yamadaya_trial.unreviewed_collision(id integer)',
  ]) {
    const db = await fixture();
    try {
      await db.exec(prepareHostedTrialDatabase(source));
      if (tamper.startsWith('CREATE TABLE')) { await db.exec('SET ROLE yamadaya_trial_owner'); await db.exec(tamper); await db.exec('RESET ROLE'); }
      else await db.exec(tamper);
      await assert.rejects(db.exec(prepareHostedTrialLoginSql()), /never overwrite|Reviewed isolated/);
      await db.exec('ROLLBACK');
      assert.equal((await db.query("SELECT rolconnlimit FROM pg_roles WHERE rolname='yamadaya_trial_web'")).rows[0].rolconnlimit, 4);
      assert.equal((await asOwner(db, 'yamadaya_trial', 'SELECT imported FROM yamadaya_trial.budget')).rows[0].imported, false);
    } finally { await db.close(); }
  }
});
