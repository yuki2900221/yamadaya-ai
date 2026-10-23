import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalFixture } from '../hosted/local-fixture.mjs';
import { cleanupImages } from '../hosted/maintenance.mjs';

// Disposable PGlite, invented devices/holds, injected TLS metadata and a fixed
// mock PNG only. These are HTTP-handler integration tests, not real-device E2E.
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3e0AAAAASUVORK5CYII=', 'base64');
const sha = value => createHash('sha256').update(value).digest('hex');

async function setup(t) {
  let calls = 0;
  const fixture = await createLocalFixture({ mockProvider: { async run(feature, input) {
    calls++;
    if (feature === 'image') return { result: { image: `data:image/png;base64,${image.toString('base64')}`, paper: input.paper }, cost: 0 };
    if (feature === 'chat') return { result: { text: `ダミー応答・${input.prompt}`, sources: [] }, cost: 0 };
    throw Error('Unexpected mock feature');
  } } });
  t.after(() => fixture.close());
  const baseline = {
    unknown: (await fixture.db.query("SELECT * FROM yamadaya_trial.jobs WHERE state='unknown' ORDER BY id")).rows,
    budget: (await fixture.db.query('SELECT * FROM yamadaya_trial.budget')).rows,
  };
  const sessions = [];
  for (const device of [0, 1]) {
    const response = await fixture.gateway(fixture.request('/api/session', { device }));
    assert.equal(response.status, 200);
    const data = await response.json();
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const sid = cookie.match(/^__Host-yamadaya_trial=([a-f0-9]{64})$/)?.[1];
    assert.ok(sid);
    sessions.push({ device, cookie, csrf: data.csrf, owner: sha(sid),
      headers: { cookie, 'x-csrf-token': data.csrf, 'content-type': 'application/json' } });
  }
  assert.notEqual(sessions[0].cookie, sessions[1].cookie);
  assert.notEqual(sessions[0].csrf, sessions[1].csrf);
  const send = (session, route, { method = 'GET', body } = {}) => fixture.gateway(fixture.request(route, {
    device: session.device, method, headers: method === 'POST' ? session.headers : { cookie: session.cookie }, body,
  }));
  async function create(session, feature) {
    const job = { id: randomUUID(), feature, input: {
      prompt: `ダミー端末${session.device}・${randomUUID()}`,
      ...(feature === 'image' ? { confirmed: true, paper: 'a4p' } : {}),
    } };
    const response = await send(session, '/api/jobs', { method: 'POST', body: job });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.state, 'succeeded');
    assert.equal(data.id, job.id);
    return { job, data };
  }
  return { fixture, baseline, sessions, send, create, calls: () => calls };
}

async function assertHoldsUnchanged(context, newJobCount) {
  const { fixture, baseline } = context;
  assert.equal(baseline.unknown.length, 3);
  assert.equal(baseline.unknown.reduce((sum, job) => sum + Number(job.hold), 0), 450000);
  assert.deepEqual((await fixture.db.query("SELECT * FROM yamadaya_trial.jobs WHERE state='unknown' ORDER BY id")).rows, baseline.unknown);
  assert.deepEqual((await fixture.db.query('SELECT * FROM yamadaya_trial.budget')).rows, baseline.budget);
  const usage = await fixture.ledger.usage();
  assert.equal(usage.reserved, 450000, 'zero-cost completed mock jobs release only their unused reservations');
  assert.equal(usage.count, 3 + newJobCount);
  assert.equal(usage.uncertain, 3);
  assert.equal(usage.calculated, 0);
  assert.equal(usage.paused, false);
}

async function assertImage(context, session, created) {
  const manifest = created.data.result.imageManifest;
  const recovered = await context.send(session, `/api/jobs/${created.job.id}`);
  assert.equal(recovered.status, 200);
  assert.deepEqual((await recovered.json()).result.imageManifest, manifest);
  const response = await context.send(session, `${manifest.path}0`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
}

test('two normal device sessions cannot read or replay each other\'s jobs with their own valid CSRF', async t => {
  const context = await setup(t);
  const jobs = [];
  for (const session of context.sessions) jobs.push(await context.create(session, 'chat'));
  assert.equal(context.calls(), 2);
  for (const [index, attacker] of context.sessions.entries()) {
    const own = await context.send(attacker, `/api/jobs/${jobs[index].job.id}`);
    assert.equal(own.status, 200);
    assert.equal((await own.json()).id, jobs[index].job.id);
    const victim = jobs[1 - index];
    const read = await context.send(attacker, `/api/jobs/${victim.job.id}`);
    assert.equal(read.status, 404);
    assert.equal((await read.json()).result, undefined);
    const replay = await context.send(attacker, '/api/jobs', { method: 'POST', body: victim.job });
    assert.equal(replay.status, 404);
    const refused = await replay.json();
    assert.equal(refused.code, 'NOT_FOUND');
    assert.equal(refused.notDispatched, true);
  }
  assert.equal(context.calls(), 2, 'Cross-device requests must not execute the mock provider');
  await assertHoldsUnchanged(context, 2);
});

test('two normal device sessions cannot recover opponent image manifests or read image chunks', async t => {
  const context = await setup(t);
  const images = [];
  for (const session of context.sessions) images.push(await context.create(session, 'image'));
  assert.notEqual(images[0].data.result.imageManifest.key, images[1].data.result.imageManifest.key);
  for (const [index, session] of context.sessions.entries()) {
    await assertImage(context, session, images[index]);
    const victim = images[1 - index];
    for (const route of [`/api/jobs/${victim.job.id}`, `${victim.data.result.imageManifest.path}0`]) {
      const response = await context.send(session, route);
      assert.equal(response.status, 404);
      assert.match(response.headers.get('content-type'), /application\/json/);
      const text = await response.text();
      assert.ok(!text.includes(victim.data.result.imageManifest.key));
      assert.equal(JSON.parse(text).result, undefined);
    }
  }
  assert.equal(context.calls(), 2);
  await assertHoldsUnchanged(context, 2);
});

for (const revokedDevice of [0, 1]) test(`revoking only device ${revokedDevice} leaves the other session, image and new jobs usable through cleanup`, async t => {
  const context = await setup(t);
  const images = [];
  for (const session of context.sessions) images.push(await context.create(session, 'image'));
  const stopped = context.sessions[revokedDevice], live = context.sessions[1 - revokedDevice];
  const stoppedImage = images[revokedDevice], liveImage = images[1 - revokedDevice];
  await context.fixture.db.query("UPDATE yamadaya_trial.devices SET status='revoked' WHERE id=$1", [context.fixture.devices[revokedDevice].id]);

  for (const [route, options] of [
    ['/api/session', {}],
    [`/api/jobs/${stoppedImage.job.id}`, {}],
    [`${stoppedImage.data.result.imageManifest.path}0`, {}],
    ['/api/jobs', { method: 'POST', body: { id: randomUUID(), feature: 'chat', input: { prompt: '停止端末からのダミー送信' } } }],
    ['/api/end', { method: 'POST' }],
  ]) {
    const response = await context.send(stopped, route, options);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'DEVICE_REVOKED');
  }
  assert.equal(context.calls(), 2);
  assert.equal((await context.fixture.db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions')).rows[0].n, 2);
  const continued = await context.send(live, '/api/session');
  assert.equal(continued.status, 200);
  assert.equal(continued.headers.get('set-cookie').split(';')[0], live.cookie);
  assert.equal((await continued.json()).csrf, live.csrf);
  await assertImage(context, live, liveImage);
  await context.create(live, 'chat');
  assert.equal(context.calls(), 3);

  assert.deepEqual(await context.fixture.ledger.listExpiredImageKeys(), [stoppedImage.data.result.imageManifest.key]);
  assert.deepEqual(await cleanupImages(context.fixture.ledger, context.fixture.storage), { deleted: 1 });
  assert.equal(context.fixture.objects.has(stoppedImage.data.result.imageManifest.key), false);
  assert.equal(context.fixture.objects.has(liveImage.data.result.imageManifest.key), true);
  assert.deepEqual((await context.fixture.db.query('SELECT hash FROM yamadaya_trial.sessions')).rows, [{ hash: live.owner }]);
  assert.equal((await context.fixture.db.query('SELECT count(*)::int n FROM yamadaya_trial.results')).rows[0].n, 1);
  await assertImage(context, live, liveImage);
  assert.equal((await context.send(stopped, '/api/session')).status, 403);
  await assertHoldsUnchanged(context, 3);
});
