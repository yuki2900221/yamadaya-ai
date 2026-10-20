import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, chmod, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger } from '../server/ledger.mjs';
import { createTrialSnapshot, validateTrialSnapshot, freezeLocalTrial, verifyFrozenLocalTrial,
  trialActivationSql, TRIAL_APPROVED_UNTIL } from '../hosted/trial-transfer.mjs';
import { runTransfer } from '../scripts/activate-hosted-trial.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const now = TRIAL_APPROVED_UNTIL - 3600000;
function jobs() {
  return [...[350000,50000,50000].map((hold,i) => ({ id: `dummy-unknown-${i}`, owner: sha(`old-${i}`),
    feature: i ? 'chat' : 'image', state: 'unknown', hold, cost: null,
    created: now - 60000, finished: null, request_hash: sha(`old-request-${i}`) })),
  { id: 'dummy-success', owner: sha('success-owner'), feature: 'writing', state: 'succeeded', hold: 15000,
    cost: 100, created: now - 1000, finished: now - 900, request_hash: sha('success-request') }];
}
function populated(file = ':memory:') {
  const ledger = new Ledger(file, { budgetUsd: 10, now: () => now });
  const insert = ledger.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)');
  for (const job of jobs()) insert.run(...Object.values(job));
  return ledger;
}

test('metadata snapshot is complete, deterministic, and retains conservative reservations and unknown hashes', () => {
  const snapshot = createTrialSnapshot(jobs(), { now });
  assert.deepEqual(snapshot.expected, { count: 4, reserved: 465000, calculated: 100, uncertain: 3 });
  assert.equal(snapshot.snapshotHash, createTrialSnapshot(jobs().reverse(), { now }).snapshotHash);
  assert.deepEqual(validateTrialSnapshot(snapshot, { now }), snapshot);
  assert.deepEqual(snapshot.jobs.filter(job => job.state === 'unknown').map(job => job.request_hash), jobs().slice(0,3).map(job => job.request_hash));
  assert.equal(/prompt|result|imageManifest|api_key/.test(JSON.stringify(snapshot)), false);
});

test('snapshot refuses sending, altered unknown holds, duplicate IDs, private content, changed budget, or extended deadline', () => {
  for (const mutate of [
    list => list[0].state = 'sending', list => list[1].hold = 49999,
    list => list.push({ ...list[0] }), list => list[0].prompt = 'must not escape',
    list => list.shift(), list => list[0].cost = 10000000,
  ]) {
    const list = jobs(); mutate(list);
    assert.throws(() => createTrialSnapshot(list, { now }));
  }
  assert.throws(() => createTrialSnapshot(jobs(), { now, limitMicros: 11000000 }));
  assert.throws(() => createTrialSnapshot(jobs(), { now, approvedUntil: TRIAL_APPROVED_UNTIL + 1 }));
  assert.throws(() => createTrialSnapshot(jobs(), { now: TRIAL_APPROVED_UNTIL }));
});

test('snapshot tampering fails hash/totals verification without opening any database', () => {
  for (const mutate of [s => s.expected.reserved--, s => s.jobs.pop(), s => s.jobs[0].request_hash = sha('new'),
    s => s.jobs[0].owner = sha('new'), s => s.snapshotHash = sha('claimed'), s => s.extra = 'hidden']) {
    const snapshot = createTrialSnapshot(jobs(), { now }); mutate(snapshot);
    assert.throws(() => validateTrialSnapshot(snapshot, { now }));
  }
});

test('freeze is atomic, does not rewrite historical metadata, and stops every local reservation on the same adapter', t => {
  const ledger = populated(); t.after(() => ledger.close());
  const before = ledger.db.prepare('SELECT * FROM jobs ORDER BY id').all();
  const snapshot = freezeLocalTrial(ledger.db, { now });
  assert.deepEqual(ledger.db.prepare('SELECT * FROM jobs ORDER BY id').all(), before);
  assert.deepEqual(freezeLocalTrial(ledger.db, { now }), snapshot);
  assert.deepEqual(verifyFrozenLocalTrial(ledger.db, snapshot, { now }), snapshot);
  assert.throws(() => ledger.reserve(randomUUID(), sha('new'), 'chat', false, sha('new')), e => e.code === 'TRIAL_MOVED');
  assert.equal(ledger.usage().reserved, 465000);
});

test('sending jobs refuse transfer and leave marker and history unchanged', t => {
  const ledger = populated(); t.after(() => ledger.close());
  ledger.db.prepare("UPDATE jobs SET state='sending' WHERE id='dummy-success'").run();
  const before = ledger.db.prepare('SELECT * FROM jobs ORDER BY id').all();
  assert.throws(() => freezeLocalTrial(ledger.db, { now }), /sending/);
  assert.deepEqual(ledger.db.prepare('SELECT * FROM jobs ORDER BY id').all(), before);
  assert.equal(ledger.db.prepare('SELECT count(*) n FROM trial_cutover').get().n, 0);
});

test('persisted cutover disables a reopened local executor and detects ledger changes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'yamadaya-dummy-transfer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'dummy.sqlite'), first = populated(file);
  const snapshot = freezeLocalTrial(first.db, { now }); first.close();
  const reopened = new Ledger(file, { budgetUsd: 10, now: () => now }); t.after(() => reopened.close());
  assert.throws(() => reopened.reserve(randomUUID(), sha('new'), 'chat', false, sha('new')), e => e.code === 'TRIAL_MOVED');
  reopened.db.prepare("UPDATE jobs SET cost=101 WHERE id='dummy-success'").run();
  assert.throws(() => verifyFrozenLocalTrial(reopened.db, snapshot, { now }), /exact snapshot/);
});

test('offline CLI exports only private metadata, refuses overwrite/unsafe mode, and never connects remotely', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'yamadaya-dummy-transfer-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'dummy.sqlite'), ledger = populated(file); ledger.close();
  const snapshot = path.join(directory, 'snapshot.json'), sql = path.join(directory, 'activate.sql');
  const args = ['--ledger', file, '--snapshot', snapshot, '--confirm-local-stopped'];
  const exported = await runTransfer(['export', ...args]);
  assert.equal(exported.providerCalls, 0); assert.equal(exported.remoteExecuted, false);
  assert.equal((await stat(snapshot)).mode & 0o777, 0o600);
  assert.equal((await runTransfer(['verify', ...args])).snapshotHash, exported.snapshotHash);
  const result = await runTransfer(['sql', ...args, '--output', sql]);
  assert.equal(result.mode, 'sql'); assert.equal((await stat(sql)).mode & 0o777, 0o600);
  assert.match(await readFile(sql, 'utf8'), /SET LOCAL ROLE yamadaya_trial_owner/);
  await assert.rejects(runTransfer(['export', ...args]));
  await chmod(snapshot, 0o644);
  await assert.rejects(runTransfer(['verify', ...args]), /0600/);
});

test('activation draft is a single administrator transaction with exact original bounds and no runtime grants', () => {
  const sql = trialActivationSql(createTrialSnapshot(jobs(), { now }), { now });
  assert.equal((sql.match(/\nBEGIN;/g) || []).length, 1);
  assert.equal((sql.match(/\nCOMMIT;/g) || []).length, 1);
  assert.match(sql, /imported=false AND paused=true AND approved_until=0/);
  assert.match(sql, /count\(\*\) FROM yamadaya_trial.devices\) NOT BETWEEN 1 AND 2/);
  assert.equal(/yamadaya_mock\.|GRANT |PASSWORD|DELETE FROM|TRUNCATE/.test(sql), false);
});
