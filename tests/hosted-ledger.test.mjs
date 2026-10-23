import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { HostedLedger } from '../hosted/ledger.mjs';

// Actual local PostgreSQL/WASM SQL, no remote database, provider, or live ledger.
// PGlite serializes queries in one engine: independent-connection network/locking
// behaviour still requires a dedicated hosted PostgreSQL acceptance test.
const sha = value => createHash('sha256').update(String(value)).digest('hex');
const owner = sha('fixture-session'), otherOwner = sha('fixture-other-session');
const device = 'fixture-mac', otherDevice = 'fixture-windows';
let db, ledger, ddl;
function fixture({ expired = false, reserved = 2035000 } = {}) {
  const t = Date.now();
  const jobs = Array.from({ length: 14 }, (_, i) => ({
    id: `fixture-done-${i}`, owner: sha(`old-session-${i}`), feature: 'chat', state: 'succeeded',
    hold: i === 13 ? reserved - 450000 - 1300000 : 100000, cost: 100,
    created: t - 3600000, finished: t - 3500000, request_hash: sha(`old-request-${i}`),
  }));
  for (const [i, hold] of [350000, 50000, 50000].entries()) jobs.push({
    id: `fixture-unknown-${i}`, owner: sha(`uncertain-owner-${i}`), feature: i ? 'chat' : 'image', state: 'unknown',
    hold, cost: null, created: t - 3600000, finished: null, request_hash: sha(`uncertain-request-${i}`),
  });
  return { version: 1, snapshotHash: sha('dummy-export-not-the-live-ledger'), limitMicros: 10000000,
    approvedUntil: expired ? t - 1 : t + 3600000,
    expected: { count: 17, reserved, calculated: 1400, uncertain: 3 }, jobs };
}
async function imported(options) {
  const snapshot = fixture(options);
  await db.query('SELECT yamadaya_trial.import_snapshot($1::jsonb)', [JSON.stringify(snapshot)]);
  return snapshot;
}
async function session(hash = owner, id = device) {
  return ledger.createSession(hash, id, sha(`csrf-${hash}`), Date.now() + 600000);
}
function request(overrides = {}) {
  return { id: randomUUID(), owner, feature: 'chat', requestHash: sha(randomUUID()), ...overrides };
}
async function success(job) {
  const r = await ledger.reserve(job);
  await ledger.finish({ id: job.id, owner: job.owner, executorToken: r.executorToken, state: 'succeeded', costMicros: 10 });
  return r;
}
function manifest(id, expires) {
  return { demo: true, paper: 'a4p', imageManifest: { key: `${randomUUID()}.bin`, mime: 'image/png', size: 500,
    sha256: sha('dummy-image-bytes'), chunks: 1, expires, path: `/api/images/${id}/` } };
}
const rejectsCode = (operation, code) => assert.rejects(operation, error => error.code === code);

before(async () => {
  db = new PGlite();
  ddl = await readFile(new URL('../hosted/migrations/001-hosted.sql', import.meta.url), 'utf8');
  await assert.rejects(db.exec(ddl), /Dedicated-project migration confirmation/);
  await db.exec('ROLLBACK');
  await db.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;");
  await db.exec("SET yamadaya_trial.migration_target='dedicated-project';");
  await db.exec(ddl);
});
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE yamadaya_trial.results,yamadaya_trial.jobs,yamadaya_trial.sessions,yamadaya_trial.nonces,yamadaya_trial.devices CASCADE;');
  await db.exec("UPDATE yamadaya_trial.budget SET imported=false,snapshot_hash=NULL,paused=true,approved_until=0,unknown_snapshot='[]';");
  const t = Date.now();
  await db.query('INSERT INTO yamadaya_trial.devices VALUES($1,$2,\'active\',$3,$4),($5,$6,\'active\',$3,$4)',
    [device, sha('fixture-cert-mac'), t - 1000, t + 7200000, otherDevice, sha('fixture-cert-windows')]);
  ledger = new HostedLedger(db);
});
after(async () => { await db?.close(); });

test('constructor performs no database IO or startup state rewrite', () => {
  let calls = 0;
  new HostedLedger({ query() { calls++; } });
  assert.equal(calls, 0);
  assert.throws(() => new HostedLedger(null), /pg-compatible/);
});

test('unimported database refuses budget use; importing conserves 17 metadata jobs and three holds', async () => {
  await session();
  await rejectsCode(ledger.reserve(request()), 'NOT_IMPORTED');
  assert.equal((await ledger.usage()).imported, false);
  await imported();
  assert.deepEqual(await ledger.usage(), { limit: 10000000, reserved: 451400, calculated: 1400,
    count: 17, uncertain: 3, imported: true, paused: false, expires: (await db.query('SELECT approved_until FROM yamadaya_trial.budget')).rows[0].approved_until * 1 });
  await assert.rejects(imported(), /Import already completed/);
});

test('invalid snapshot totals roll back every imported row', async () => {
  const s = fixture(); s.expected.reserved++;
  await assert.rejects(db.query('SELECT yamadaya_trial.import_snapshot($1::jsonb)', [JSON.stringify(s)]), /totals/);
  assert.equal((await ledger.usage()).count, 0);
  assert.equal((await ledger.usage()).imported, false);
});

test('missing or altered unknown hold cannot be imported as a fresh trial', async () => {
  for (const mutate of [s => s.jobs.pop(), s => s.jobs.at(-1).hold = 40000, s => s.jobs.at(-1).state = 'sending']) {
    const s = fixture(); mutate(s);
    await assert.rejects(db.query('SELECT yamadaya_trial.import_snapshot($1::jsonb)', [JSON.stringify(s)]));
    assert.equal((await ledger.usage()).count, 0);
  }
});

test('the original approved deadline is checked by the database server', async () => {
  await imported({ expired: true }); await session();
  await rejectsCode(ledger.reserve(request()), 'TRIAL_EXPIRED');
  assert.equal((await ledger.usage()).count, 17);
});

test('two adapter instances cannot execute the same operation twice', async () => {
  await imported(); await session();
  const other = new HostedLedger(db), job = request();
  const results = await Promise.all([ledger.reserve(job), other.reserve(job)]);
  assert.deepEqual(results.map(r => r.duplicate).sort(), [false, true]);
  assert.equal(results.filter(r => r.executorToken).length, 1);
  assert.equal((await ledger.usage()).count, 18);
  assert.equal((await ledger.usage()).reserved, 466400);
  const record = await ledger.get(job.id, owner);
  assert.equal('executor_hash' in record, false);
  assert.equal('executorToken' in record, false);
});

test('same id with altered hash or another owner cannot be acquired', async () => {
  await imported(); await session(); await session(otherOwner, otherDevice);
  const job = request(); await ledger.reserve(job);
  await rejectsCode(ledger.reserve({ ...job, requestHash: sha('changed') }), 'ID_REUSED');
  await rejectsCode(ledger.reserve({ ...job, owner: otherOwner }), 'NOT_FOUND');
  assert.equal(await ledger.get(job.id, otherOwner), null);
});

test('old unknown payload hashes cannot be resent even with a new id/session', async () => {
  await imported(); await session();
  for (let i = 0; i < 3; i++) await rejectsCode(ledger.reserve(request({ requestHash: sha(`uncertain-request-${i}`) })), 'UNCERTAIN_DUPLICATE');
  assert.equal((await ledger.usage()).reserved, 451400);
});

test('existing unknown id/hold snapshot must remain an exact set', async () => {
  await imported(); await session();
  await db.exec("UPDATE yamadaya_trial.jobs SET hold=50001 WHERE id='fixture-unknown-1';");
  await rejectsCode(ledger.reserve(request()), 'UNCERTAIN');
  await db.exec("UPDATE yamadaya_trial.jobs SET hold=50000,state='succeeded',cost=10,finished=1 WHERE id='fixture-unknown-1';");
  await rejectsCode(ledger.reserve(request()), 'UNCERTAIN');
});

test('global active-job limit applies across instances', async () => {
  await imported(); await session();
  const a = request(), b = request();
  const outcomes = await Promise.allSettled([ledger.reserve(a), new HostedLedger(db).reserve(b)]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.code, 'BUSY');
});

test('import validates historical holds but runtime settles imported successes to known costs', async () => {
  await imported({ reserved: 9800000 }); await session();
  assert.equal((await ledger.usage()).reserved, 451400);
  await success(request());
  assert.equal((await ledger.usage()).reserved, 451410);
});

test('settled costs and all unknown holds still enforce the global USD 10 limit', async () => {
  await imported({ reserved: 9800000 }); await session();
  // Adjust invented completed costs within each original hold so actual costs
  // plus the three unchanged unknown holds are exactly USD 9.8.
  await db.exec("UPDATE yamadaya_trial.jobs SET cost=hold WHERE state='succeeded';");
  assert.equal((await ledger.usage()).reserved, 9800000);
  await rejectsCode(ledger.reserve(request({ feature: 'image' })), 'BUDGET_LIMIT');
  await success(request());
  assert.equal((await ledger.usage()).reserved, 9800010);
});

test('successful completion requires matching executor capability and owner', async () => {
  await imported(); await session();
  const job = request(), r = await ledger.reserve(job);
  await rejectsCode(ledger.finish({ id: job.id, owner, executorToken: sha('not-the-executor'), state: 'succeeded', costMicros: 12 }), 'EXECUTOR_REQUIRED');
  await rejectsCode(ledger.finish({ id: job.id, owner: otherOwner, executorToken: r.executorToken, state: 'succeeded', costMicros: 12 }), 'NOT_FOUND');
  await ledger.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'succeeded', costMicros: 12 });
  await rejectsCode(ledger.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'unknown' }), 'ALREADY_FINISHED');
  assert.equal((await ledger.get(job.id, owner)).cost, 12);
  assert.equal((await ledger.usage()).paused, false);
});

test('success releases only unused hold across adapters; a repeated finish cannot release twice', async () => {
  await imported(); await session();
  const other = new HostedLedger(db), before = await ledger.usage();
  const budgetBefore = (await db.query('SELECT * FROM yamadaya_trial.budget')).rows;
  const unknownBefore = (await db.query("SELECT * FROM yamadaya_trial.jobs WHERE baseline_unknown ORDER BY id")).rows;
  const job = request({ feature: 'image' }), r = await ledger.reserve(job);
  assert.equal((await other.usage()).reserved, before.reserved + 350000);
  await ledger.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'succeeded', costMicros: 20000 });
  const settled = await other.usage();
  assert.equal(settled.reserved, before.reserved + 20000);
  assert.equal(settled.calculated, before.calculated + 20000);
  assert.equal((await ledger.get(job.id, owner)).hold, 350000, 'original reservation remains auditable');
  await rejectsCode(other.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'succeeded', costMicros: 0 }), 'ALREADY_FINISHED');
  assert.deepEqual(await ledger.usage(), settled);
  assert.deepEqual((await db.query('SELECT * FROM yamadaya_trial.budget')).rows, budgetBefore);
  assert.deepEqual((await db.query("SELECT * FROM yamadaya_trial.jobs WHERE baseline_unknown ORDER BY id")).rows, unknownBefore);
});

test('released success capacity is shared but simultaneous new operations still dispatch only once', async () => {
  await imported({ reserved: 10000000 }); await session();
  await db.exec("UPDATE yamadaya_trial.jobs SET cost=hold WHERE state='succeeded'; UPDATE yamadaya_trial.jobs SET cost=cost-15000 WHERE id='fixture-done-0';");
  assert.equal((await ledger.usage()).reserved, 9985000);
  const other = new HostedLedger(db), first = request(), second = request();
  const results = await Promise.allSettled([ledger.reserve(first), other.reserve(second)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'BUSY');
  const index = results.findIndex(r => r.status === 'fulfilled'), granted = results[index].value;
  const grantedJob = index ? second : first;
  await ledger.finish({ id: grantedJob.id, owner, executorToken: granted.executorToken, state: 'succeeded', costMicros: 0 });
  assert.equal((await other.usage()).reserved, 9985000);
  const third = request(), reservation = await other.reserve(third);
  assert.equal((await ledger.usage()).reserved, 10000000);
  await other.finish({ id: third.id, owner, executorToken: reservation.executorToken, state: 'succeeded', costMicros: 15000 });
  await rejectsCode(ledger.reserve(request()), 'BUDGET_LIMIT');
});

test('unknown completion retains its full hold even when a smaller calculated cost is available', async () => {
  await imported(); await session();
  const before = await ledger.usage(), job = request(), r = await ledger.reserve(job);
  await ledger.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'unknown', costMicros: 10 });
  const value = await ledger.usage();
  assert.equal(value.reserved, before.reserved + 15000);
  assert.equal(value.calculated, before.calculated + 10);
  assert.equal(value.paused, true);
});

test('a completion without calculated cost remains unknown and does not release the hold', async () => {
  await imported(); await session();
  const before = await ledger.usage(), job = request(), r = await ledger.reserve(job);
  const result = await ledger.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'succeeded' });
  assert.equal(result.state, 'unknown'); assert.equal(result.cost, null);
  assert.equal((await ledger.usage()).reserved, before.reserved + 15000);
  assert.equal((await ledger.usage()).paused, true);
});

test('new unknown keeps its hold and stops subsequent new operations', async () => {
  await imported(); await session();
  const job = request({ feature: 'image' }), r = await ledger.reserve(job);
  await ledger.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'unknown' });
  const u = await ledger.usage();
  assert.equal(u.reserved, 801400); assert.equal(u.uncertain, 4); assert.equal(u.paused, true);
  assert.equal((await ledger.get(job.id, owner)).cost, null);
  await rejectsCode(ledger.reserve(request()), 'UNCERTAIN');
  assert.equal((await ledger.reserve(job)).duplicate, true);
});

test('absent or over-reservation cost becomes unknown instead of a false success', async () => {
  await imported(); await session();
  const job = request(), r = await ledger.reserve(job);
  const result = await ledger.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'succeeded', costMicros: 15001 });
  assert.equal(result.state, 'unknown'); assert.equal(result.cost, 15001);
  assert.equal((await ledger.usage()).reserved, 466401);
  await rejectsCode(ledger.reserve(request()), 'UNCERTAIN');
});

test('constructing another adapter leaves a healthy sending job untouched', async () => {
  await imported(); await session();
  const job = request(); await ledger.reserve(job);
  const second = new HostedLedger(db);
  assert.equal((await second.get(job.id, owner)).state, 'sending');
  assert.equal((await second.usage()).paused, false);
});

test('expired executor lease is retained as unknown and cannot be reclaimed', async () => {
  await imported(); await session();
  const job = request(), r = await ledger.reserve(job);
  await db.query('UPDATE yamadaya_trial.jobs SET lease_expires=$1 WHERE id=$2', [Date.now() - 1, job.id]);
  await rejectsCode(ledger.finish({ id: job.id, owner, executorToken: r.executorToken, state: 'succeeded', costMicros: 20 }), 'LEASE_EXPIRED');
  assert.equal((await ledger.get(job.id, owner)).state, 'unknown');
  assert.equal((await ledger.usage()).paused, true);
  await rejectsCode(ledger.reserve(request()), 'UNCERTAIN');
  assert.equal((await ledger.reserve(job)).executorToken, undefined);
});

test('a new reserve sweeps abandoned leases before deciding whether dispatch is allowed', async () => {
  await imported(); await session();
  const job = request(); await ledger.reserve(job);
  await db.query('UPDATE yamadaya_trial.jobs SET lease_expires=$1 WHERE id=$2', [Date.now() - 1, job.id]);
  await rejectsCode(ledger.reserve(request()), 'UNCERTAIN');
  assert.equal((await ledger.get(job.id, owner)).state, 'unknown');
  assert.equal((await ledger.usage()).reserved, 466400);
});

test('session reads and reservation are bound to the approved device', async () => {
  await imported(); const s = await session();
  assert.equal(s.session_hash, owner); assert.equal(s.device_id, device); assert.equal(s.csrf_hash, sha(`csrf-${owner}`));
  assert.equal(await ledger.getSession(owner, otherDevice), null);
  const d = await ledger.getDevice(device);
  assert.equal(d.status, 'active'); assert.equal(d.fingerprint_sha256, sha('fixture-cert-mac'));
  await db.query("UPDATE yamadaya_trial.devices SET status='revoked' WHERE id=$1", [device]);
  await rejectsCode(ledger.getSession(owner, device), 'DEVICE_REQUIRED');
  await rejectsCode(ledger.reserve(request()), 'DEVICE_REQUIRED');
});

test('expired sessions cannot be revived; idle extension has a bounded server-side TTL', async () => {
  await imported(); await session();
  const extended = Date.now() + 800000;
  assert.equal((await ledger.touchSession(owner, device, extended)).expires, extended);
  await rejectsCode(ledger.touchSession(owner, device, Date.now() + 910000), 'INVALID_REQUEST');
  await db.query('UPDATE yamadaya_trial.sessions SET expires=$1 WHERE hash=$2', [Date.now() - 1, owner]);
  assert.equal(await ledger.getSession(owner, device, 1), null);
  assert.equal(await ledger.touchSession(owner, device, Date.now() + 600000), null);
  await rejectsCode(ledger.reserve(request()), 'SESSION_EXPIRED');
});

test('shared nonce store rejects replay across adapter instances', async () => {
  const nonce = sha('nonce');
  const outcomes = await Promise.all([ledger.claimNonce(nonce, Date.now() + 60000), new HostedLedger(db).claimNonce(nonce, Date.now() + 60000)]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  await rejectsCode(ledger.claimNonce(sha('expired'), Date.now() - 1), 'INVALID_REQUEST');
  await rejectsCode(ledger.claimNonce(sha('too-long'), Date.now() + 130000), 'INVALID_REQUEST');
});

test('only a small image manifest is recoverable; prompts/text/chat cannot be persisted', async () => {
  await imported(); await session();
  const image = request({ feature: 'image' }); await success(image);
  const expires = Date.now() + 500000, value = manifest(image.id, expires);
  assert.equal(await ledger.putResult(image.id, owner, value, expires), true);
  assert.equal(await ledger.putResult(image.id, owner, manifest(image.id, expires), expires), false);
  assert.deepEqual(await ledger.getResult(image.id, owner), value);
  const chat = request(); await success(chat);
  await rejectsCode(ledger.putResult(chat.id, owner, { text: 'should never enter the database' }, expires), 'INVALID_REQUEST');
  assert.equal(await ledger.getResult(chat.id, owner), null);
  const anotherImage = request({ feature: 'image' }); await success(anotherImage);
  for (const bad of [ { ...manifest(anotherImage.id, expires), prompt: 'private' },
    { ...manifest(anotherImage.id, expires), imageManifest: { ...manifest(anotherImage.id, expires).imageManifest, key: '../outside' } } ]) {
    await rejectsCode(ledger.putResult(anotherImage.id, owner, bad, expires), 'INVALID_REQUEST');
  }
  const rows = await db.query('SELECT value FROM yamadaya_trial.results');
  assert.equal(rows.rows.length, 1);
  assert.equal(JSON.stringify(rows.rows).includes('should never'), false);
});

test('ending a session blocks results and retains cleanup pointers until storage deletion succeeds', async () => {
  await imported(); await session();
  const image = request({ feature: 'image' }); await success(image);
  const expires = Date.now() + 500000, value = manifest(image.id, expires);
  await ledger.putResult(image.id, owner, value, expires);
  assert.deepEqual(await ledger.listSessionImageKeys(owner, otherDevice), []);
  assert.deepEqual(await ledger.listSessionImageKeys(owner, device), [value.imageManifest.key]);
  assert.equal(await ledger.endSession(owner, otherDevice), false);
  assert.equal(await ledger.endSession(owner, device), true);
  await rejectsCode(ledger.getResult(image.id, owner), 'SESSION_EXPIRED');
  await rejectsCode(ledger.putResult(image.id, owner, value, expires), 'SESSION_EXPIRED');
  assert.deepEqual(await ledger.listExpiredImageKeys(), [value.imageManifest.key]);
  await ledger.purgeExpired();
  assert.deepEqual(await ledger.listExpiredImageKeys(), [value.imageManifest.key]);
  assert.equal((await db.query('SELECT count(*)::int n FROM yamadaya_trial.results')).rows[0].n, 1);
  // A failed Storage delete leaves the pointer. Only an explicit confirmed key
  // removes metadata, so a future cleanup run can retry Storage deletion safely.
  assert.equal(await ledger.removeImageMetadata([value.imageManifest.key]), 1);
  assert.equal((await db.query('SELECT count(*)::int n FROM yamadaya_trial.results')).rows[0].n, 0);
  assert.equal((await ledger.usage()).count, 18);
});

test('cleanup lists only expired image keys and never trusts a browser-supplied future clock', async () => {
  await imported(); await session();
  const image = request({ feature: 'image' }); await success(image);
  const expires = Date.now() + 500000, value = manifest(image.id, expires);
  await ledger.putResult(image.id, owner, value, expires);
  assert.deepEqual(await ledger.listExpiredImageKeys(Date.now() + 100000000), []);
  await db.query('UPDATE yamadaya_trial.results SET expires=$1', [Date.now() - 1]);
  assert.equal(await ledger.getResult(image.id, owner), null);
  assert.deepEqual(await ledger.listExpiredImageKeys(), [value.imageManifest.key]);
  await ledger.purgeExpired();
  assert.deepEqual(await ledger.listExpiredImageKeys(), [value.imageManifest.key]);
  await ledger.removeImageMetadata([value.imageManifest.key]);
  assert.deepEqual(await ledger.listExpiredImageKeys(), []);
  assert.equal((await ledger.usage()).count, 18);
});

test('revocation denies result access and makes its storage key available for cleanup', async () => {
  await imported(); await session();
  const image = request({ feature: 'image' }); await success(image);
  const expires = Date.now() + 500000, value = manifest(image.id, expires);
  await ledger.putResult(image.id, owner, value, expires);
  await db.query("UPDATE yamadaya_trial.devices SET status='revoked' WHERE id=$1", [device]);
  await rejectsCode(ledger.getResult(image.id, owner), 'SESSION_EXPIRED');
  assert.deepEqual(await ledger.listExpiredImageKeys(), [value.imageManifest.key]);
  await ledger.purgeExpired();
  assert.equal((await db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions')).rows[0].n, 0);
  assert.deepEqual(await ledger.listExpiredImageKeys(), [value.imageManifest.key]);
  assert.equal(await ledger.removeImageMetadata([value.imageManifest.key]), 1);
  assert.equal((await ledger.usage()).count, 18);
});

test('metadata cleanup cannot remove a still-active image or another newly expired image', async () => {
  await imported(); await session();
  const first = request({ feature: 'image' }), second = request({ feature: 'image' });
  const expires = Date.now() + 500000;
  await success(first); const a = manifest(first.id, expires); await ledger.putResult(first.id, owner, a, expires);
  await success(second); const b = manifest(second.id, expires); await ledger.putResult(second.id, owner, b, expires);
  assert.equal(await ledger.removeImageMetadata([a.imageManifest.key]), 0);
  await db.query('UPDATE yamadaya_trial.results SET expires=$1 WHERE id=$2', [Date.now() - 1, first.id]);
  const listed = await ledger.listExpiredImageKeys(); assert.deepEqual(listed, [a.imageManifest.key]);
  // During Storage IO a second image expires. Purge must retain its pointer.
  await db.query('UPDATE yamadaya_trial.results SET expires=$1 WHERE id=$2', [Date.now() - 1, second.id]);
  await ledger.removeImageMetadata(listed); await ledger.purgeExpired();
  assert.deepEqual(await ledger.listExpiredImageKeys(), [b.imageManifest.key]);
});

test('unexpected isolation cannot make a stale budget decision', async () => {
  await imported(); await session();
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try { await rejectsCode(ledger.reserve(request()), 'ISOLATION_UNSUPPORTED'); }
  finally { await db.exec('ROLLBACK'); }
  assert.equal((await ledger.usage()).count, 17);
});

test('browser roles cannot query private tables or execute runtime/import functions', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT * FROM yamadaya_trial.jobs'), /permission denied/);
    await assert.rejects(db.query("SELECT yamadaya_trial.runtime('usage','{}')"), /permission denied/);
    await assert.rejects(db.query("SELECT yamadaya_trial.import_snapshot('{}')"), /permission denied/);
    await db.exec('RESET ROLE');
  }
});

test('runtime role can use only the bounded function surface, not alter budgets/devices or import', async () => {
  await imported(); await session();
  await db.exec('SET ROLE yamadaya_trial_runtime');
  try {
    assert.equal((await ledger.usage()).reserved, 451400);
    const r = await ledger.reserve(request()); assert.equal(r.duplicate, false);
    for (const sql of ["UPDATE yamadaya_trial.budget SET limit_micros=100000000", 'SELECT * FROM yamadaya_trial.sessions',
      "UPDATE yamadaya_trial.devices SET status='active'", "SELECT yamadaya_trial.import_snapshot('{}')"]) {
      await assert.rejects(db.query(sql), /permission denied/);
    }
    await rejectsCode(ledger.call('reset-budget'), 'INVALID_REQUEST');
  } finally { await db.exec('RESET ROLE'); }
});

test('future admin functions created by the migration owner do not inherit PUBLIC execute', async () => {
  await db.exec("CREATE FUNCTION yamadaya_trial.future_admin_probe() RETURNS boolean LANGUAGE sql AS 'SELECT true';");
  try {
    const privileges = await db.query("SELECT has_function_privilege('yamadaya_trial_runtime','yamadaya_trial.future_admin_probe()','EXECUTE') AS allowed");
    assert.equal(privileges.rows[0].allowed, false);
    await db.exec('SET ROLE yamadaya_trial_runtime');
    await assert.rejects(db.query('SELECT yamadaya_trial.future_admin_probe()'), /permission denied/);
  } finally {
    await db.exec('RESET ROLE');
    await db.exec('DROP FUNCTION yamadaya_trial.future_admin_probe()');
  }
});

test('invalid local adapter inputs fail before a SQL statement', async () => {
  let calls = 0;
  const local = new HostedLedger({ query() { calls++; } });
  assert.throws(() => local.get('id', 'raw-session-cookie'), /操作/);
  await rejectsCode(local.reserve(request({ owner: 'raw-session-cookie' })), 'INVALID_REQUEST');
  assert.throws(() => local.finish({ id: 'id', owner, executorToken: sha('x'), state: 'succeeded', costMicros: 0.1 }), /操作/);
  assert.equal(calls, 0);
});
