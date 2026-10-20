import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrivateStorage } from '../hosted/images.mjs';
import { cleanupImages } from '../hosted/maintenance.mjs';
import { runtimeConfiguration } from '../hosted/runtime.mjs';
import { mockMigration } from '../hosted/mock-migration.mjs';
import { HostedLedger } from '../hosted/ledger.mjs';
import { createLocalFixture } from '../hosted/local-fixture.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const ref = 'abcdefghijklmnopqrst';
const configuration = () => ({ HOSTED_MODE: 'mock', HOSTED_PROJECT_REF: ref,
  HOSTED_DATABASE_URL: `postgresql://yamadaya_mock_web:dummy-password@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,
  HOSTED_GATEWAY_SECRET: 'g'.repeat(40), HOSTED_SESSION_SECRET: 's'.repeat(40) });

test('runtime accepts only mock mode, dedicated project login, verified TLS and separate secrets', () => {
  const env = configuration(); assert.match(runtimeConfiguration(env).databaseUrl, /yamadaya_mock_web/);
  for (const changed of [
    { HOSTED_MODE: 'live' }, { HOSTED_PROJECT_REF: 'different' }, { HOSTED_GATEWAY_SECRET: 'short' },
    { HOSTED_SESSION_SECRET: env.HOSTED_GATEWAY_SECRET },
    { HOSTED_DATABASE_URL: env.HOSTED_DATABASE_URL.replace('yamadaya_mock_web', 'postgres') },
    { HOSTED_DATABASE_URL: env.HOSTED_DATABASE_URL.replace('verify-full', 'disable') },
    { HOSTED_DATABASE_URL: env.HOSTED_DATABASE_URL.replace(`db.${ref}.supabase.co`, 'other.example.test') },
  ]) assert.throws(() => runtimeConfiguration({ ...env, ...changed }));
});

test('mock namespace cannot execute the real trial ledger or an arbitrary SQL identifier', async () => {
  let sql;
  const ledger = new HostedLedger({ async query(query) { sql = query; return { rows: [{ value: { ok: true, value: {} } }] }; } }, { schema: 'yamadaya_mock' });
  await ledger.usage(); assert.match(sql, /SELECT yamadaya_mock\.runtime/);
  assert.throws(() => new HostedLedger({ query() {} }, { schema: 'public; DROP SCHEMA' }));
  assert.equal(mockMigration('CREATE SCHEMA yamadaya_trial; -- yamadaya_trial_runtime'), 'CREATE SCHEMA yamadaya_mock; -- yamadaya_mock_runtime');
});

test('private Storage upload/download/delete use only the pinned project and never signed URLs', async () => {
  const captured = [], key = `${randomUUID()}.bin`, bytes = Buffer.from('dummy image');
  const store = createPrivateStorage({ baseUrl: `https://${ref}.supabase.co`, bucket: 'trial-private', serverKey: 'dummy-server-credential', fetcher: async (url, options) => {
    captured.push({ url, options });
    return options.method === 'GET' ? new Response(bytes) : new Response('{}');
  } });
  await store.put(key, bytes, 'image/png'); assert.deepEqual(await store.get(key), bytes); await store.remove(key);
  assert.deepEqual(captured.map(x => x.options.method), ['POST','GET','DELETE']);
  assert.equal(captured[2].url, `https://${ref}.supabase.co/storage/v1/object/trial-private`);
  assert.deepEqual(JSON.parse(captured[2].options.body), { prefixes: [key] });
  for (const {url,options} of captured) { assert.ok(!url.includes('sign')); assert.equal(options.redirect, 'error'); }
  await assert.rejects(store.get('../business-data'));
});

test('independent inventory finds an old orphan without a database result pointer', async () => {
  const now = Date.now(), oldKey = `${randomUUID()}.bin`, freshKey = `${randomUUID()}.bin`;
  const store = createPrivateStorage({ baseUrl: `https://${ref}.supabase.co`, bucket: 'trial-private', serverKey: 'dummy-server-credential', fetcher: async () => Response.json([
    { name: oldKey, created_at: new Date(now - 900001).toISOString() },
    { name: freshKey, created_at: new Date(now).toISOString() },
    { name: '../outside', created_at: new Date(now - 900001).toISOString() },
  ]) });
  assert.deepEqual(await store.listExpiredKeys(now), [oldKey]);
  const events = [];
  const ledger = { async listExpiredImageKeys() { return []; }, async removeImageMetadata(keys) { events.push(['metadata', keys]); }, async purgeExpired() { events.push(['purge']); } };
  const result = await cleanupImages(ledger, { listExpiredKeys: store.listExpiredKeys, async remove(key) { events.push(['bytes', key]); } }, now);
  assert.equal(result.deleted, 1); assert.deepEqual(events, [['bytes',oldKey],['metadata',[oldKey]],['purge']]);
});

test('storage deletion failure preserves cleanup metadata and never reports deletion success', async () => {
  let purges = 0;
  const ledger = { async listExpiredImageKeys() { return ['old']; }, async removeImageMetadata() { purges++; }, async purgeExpired() { purges++; } };
  await assert.rejects(cleanupImages(ledger, { async listExpiredKeys() { return []; }, async remove() { throw Error('storage unavailable'); } }));
  assert.equal(purges, 0);
});

test('mock DDL and spending use a different schema without changing the trial ledger', async () => {
  const f = await createLocalFixture();
  try {
    const before = await f.ledger.usage();
    const source = await readFile(new URL('../hosted/migrations/001-hosted.sql', import.meta.url), 'utf8');
    await f.db.exec("SET yamadaya_mock.migration_target='dedicated-project';");
    await f.db.exec(mockMigration(source));
    const mock = new HostedLedger(f.db, { schema: 'yamadaya_mock' });
    assert.equal((await mock.usage()).imported, false);
    const rows = (await f.db.query('SELECT id,owner,feature,state,hold,cost,created,finished,request_hash FROM yamadaya_trial.jobs')).rows;
    const sha = value => createHash('sha256').update(value).digest('hex');
    const until = Date.now() + 600000;
    await f.db.query('SELECT yamadaya_mock.import_snapshot($1::jsonb)', [JSON.stringify({ version: 1, snapshotHash: sha('independent-dummy-snapshot'), limitMicros: 10000000, approvedUntil: until, expected: { count: 3, reserved: 450000, calculated: 0, uncertain: 3 }, jobs: rows })]);
    await f.db.exec('INSERT INTO yamadaya_mock.devices SELECT * FROM yamadaya_trial.devices');
    const owner = sha('independent-mock-session');
    await mock.createSession(owner, 'dummy-mac', sha('dummy-csrf'), until);
    await mock.reserve({ id: randomUUID(), owner, feature: 'chat', requestHash: sha('independent-mock-request') });
    assert.equal((await mock.usage()).reserved, 465000);
    assert.deepEqual(await f.ledger.usage(), before);
  } finally { await f.close(); }
});
