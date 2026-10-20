import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalFixture } from '../hosted/local-fixture.mjs';
import { hostedStopReason } from '../hosted/app.mjs';

test('an empty unimported hosted ledger reports preparation and rejects jobs before the mock provider', async t => {
  let calls = 0;
  const f = await createLocalFixture({ mockProvider: { async run() { calls++; throw Error('must not run'); } } });
  t.after(() => f.close());
  await f.db.exec("TRUNCATE yamadaya_trial.jobs CASCADE; UPDATE yamadaya_trial.budget SET imported=false,paused=true,approved_until=0,unknown_snapshot='[]';");
  const session = await f.gateway(f.request('/api/session'));
  const data = await session.json();
  assert.equal(data.spendingPaused, true); assert.equal(data.stopReason, 'NOT_IMPORTED');
  const response = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: { cookie: session.headers.get('set-cookie').split(';')[0], 'x-csrf-token': data.csrf, 'content-type': 'application/json' }, body: { id: randomUUID(), feature: 'chat', input: { prompt: 'ダミー' } } }));
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'NOT_IMPORTED');
  const usage = await f.ledger.usage(); assert.equal(usage.count, 0); assert.equal(usage.reserved, 0); assert.equal(calls, 0);
});

test('approved old unknowns remain usable and reason reporting does not mutate permission or ledger', async t => {
  const f = await createLocalFixture(); t.after(() => f.close());
  const before = await f.ledger.usage();
  const active = await (await f.gateway(f.request('/api/session'))).json();
  assert.equal(active.spendingPaused, false); assert.equal(active.stopReason, null); assert.equal(before.uncertain, 3);
  assert.deepEqual(await f.ledger.usage(), before);
  await f.db.exec('UPDATE yamadaya_trial.budget SET paused=true;');
  const paused = await (await f.gateway(f.request('/api/session'))).json();
  assert.equal(paused.spendingPaused, true); assert.equal(paused.stopReason, 'PAUSED');
  await f.db.exec('UPDATE yamadaya_trial.budget SET paused=false,approved_until=1;');
  const expired = await (await f.gateway(f.request('/api/session'))).json();
  assert.equal(expired.stopReason, 'TRIAL_EXPIRED'); assert.equal(expired.spendingPaused, false);
  assert.equal((await f.ledger.usage()).reserved, before.reserved);
});

test('cost uncertainty copy requires an explicit known cause, not merely an unresolved count', () => {
  const usage = { imported: true, expires: 2000, paused: true, uncertain: 3 };
  assert.equal(hostedStopReason(usage, 1000), 'PAUSED');
  assert.equal(hostedStopReason({ ...usage, pauseReason: 'COST_UNCERTAIN' }, 1000), 'COST_UNCERTAIN');
  assert.equal(hostedStopReason({ ...usage, paused: false }, 1000), null);
});
