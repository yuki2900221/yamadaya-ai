import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createLocalFixture } from '../hosted/local-fixture.mjs';
import { createHostedApp } from '../hosted/app.mjs';
import { createGateway } from '../hosted/gateway.mjs';
import { createOriginVerifier } from '../hosted/origin-auth.mjs';

// Disposable PGlite, in-memory Storage and generated dummy secrets only.
// No HTTP transport, real credentials, real ledger or external provider.
const sha = value => createHash('sha256').update(value).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3e0AAAAASUVORK5CYII=', 'base64');
async function setup(t) {
  const f = await createLocalFixture(); t.after(() => f.close());
  const secret = randomBytes(32).toString('hex'), sessionSecret = randomBytes(32).toString('hex');
  let providerCalls = 0;
  const verify = createOriginVerifier({ publicOrigin: f.publicOrigin, upstreamOrigin: f.upstreamOrigin, secret,
    consumeNonce: ({ nonce, expiresAt }) => f.ledger.claimNonce(nonce, expiresAt),
    authorizeDevice: async ({ deviceId, fingerprintSha256, now }) => {
      const row = await f.ledger.getDevice(deviceId);
      return row?.status === 'active' && row.fingerprint_sha256 === fingerprintSha256 && row.not_before <= now && row.not_after > now;
    } });
  const handle = createHostedApp({ ledger: f.ledger, storage: f.storage, verify, publicOrigin: f.publicOrigin, sessionSecret,
    mockProvider: { async run() { providerCalls++; return { result: { image: `data:image/png;base64,${png.toString('base64')}`, paper: 'a4p' }, cost: 0 }; } } });
  const gateway = createGateway({ publicOrigin: f.publicOrigin, upstreamOrigin: f.upstreamOrigin, secret,
    approvedDevices: f.devices, fetchImpl: handle });
  const send = (route, options) => gateway(f.request(route, options));
  async function open(device = 0, cookie) {
    const response = await send('/api/session', { device, headers: cookie ? { cookie } : {} });
    assert.equal(response.status, 200);
    const data = await response.json(), nextCookie = response.headers.get('set-cookie').split(';')[0];
    const sid = nextCookie.split('=')[1];
    return { device, cookie: nextCookie, csrf: data.csrf, sid, owner: sha(sid) };
  }
  const headers = session => ({ cookie: session.cookie, 'x-csrf-token': session.csrf, 'content-type': 'application/json' });
  const end = (session, overrides = {}) => send('/api/end', { device: session.device, method: 'POST', headers: headers(session), ...overrides });
  async function image(session) {
    const response = await send('/api/jobs', { device: session.device, method: 'POST', headers: headers(session),
      body: { id: randomUUID(), feature: 'image', input: { prompt: `ダミー${randomUUID()}`, confirmed: true, paper: 'a4p' } } });
    assert.equal(response.status, 200);
    return (await response.json()).result.imageManifest;
  }
  async function snapshot() {
    return { jobs: (await f.db.query('SELECT * FROM yamadaya_trial.jobs ORDER BY id')).rows,
      budget: (await f.db.query('SELECT * FROM yamadaya_trial.budget')).rows };
  }
  return { f, send, open, headers, end, image, snapshot, sessionSecret, get providerCalls() { return providerCalls; } };
}

test('an expired session can end and retry while removing private images and retaining all job costs and unknown holds', async t => {
  const c = await setup(t), session = await c.open(), image = await c.image(session);
  const before = await c.snapshot();
  assert.equal(before.jobs.filter(job => job.state === 'unknown').reduce((n, job) => n + Number(job.hold), 0), 450000);
  await c.f.db.query('UPDATE yamadaya_trial.sessions SET expires=1 WHERE hash=$1', [session.owner]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await c.end(session);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ended: true });
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  }
  assert.equal((await c.f.db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions')).rows[0].n, 0);
  assert.equal((await c.f.db.query('SELECT count(*)::int n FROM yamadaya_trial.results')).rows[0].n, 0);
  assert.equal(c.f.objects.has(image.key), false);
  const oldImage = await c.send(`${image.path}0`, { headers: { cookie: session.cookie } });
  assert.equal(oldImage.status, 401);
  assert.equal(c.providerCalls, 1);
  assert.deepEqual(await c.snapshot(), before);
});

for (const state of ['active', 'expired', 'ended']) {
  test(`another approved device cannot end a copied cookie/CSRF for an ${state} session`, async t => {
    const c = await setup(t), owner = await c.open(), other = await c.open(1);
    if (state === 'expired') await c.f.db.query('UPDATE yamadaya_trial.sessions SET expires=1 WHERE hash=$1', [owner.owner]);
    if (state === 'ended') assert.equal((await c.end(owner)).status, 200);
    const before = (await c.f.db.query('SELECT * FROM yamadaya_trial.sessions ORDER BY hash')).rows;
    const response = await c.end(owner, { device: 1 });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'CSRF_REJECTED');
    assert.deepEqual((await c.f.db.query('SELECT * FROM yamadaya_trial.sessions ORDER BY hash')).rows, before);
    assert.ok(before.some(row => row.hash === other.owner));
    assert.equal(c.providerCalls, 0);
  });
}

for (const [label, update] of [
  ['revoked', "status='revoked'"],
  ['expired registration', 'not_before=1,not_after=2'],
  ['future registration', 'not_before=4102444800000,not_after=4102444800001'],
]) {
  test(`end does not acknowledge a device with ${label}`, async t => {
    const c = await setup(t), session = await c.open();
    await c.f.db.query(`UPDATE yamadaya_trial.devices SET ${update} WHERE id=$1`, [c.f.devices[0].id]);
    const response = await c.end(session);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'DEVICE_REVOKED');
    assert.equal((await c.f.db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions WHERE hash=$1', [session.owner])).rows[0].n, 1);
    assert.equal(c.providerCalls, 0);
  });
}

test('SQL device authorization is still checked if the device changes after gateway verification', async t => {
  const c = await setup(t), session = await c.open(), original = c.f.ledger.getSession.bind(c.f.ledger);
  c.f.ledger.getSession = async (...args) => {
    await c.f.db.query("UPDATE yamadaya_trial.devices SET status='revoked' WHERE id=$1", [c.f.devices[0].id]);
    return original(...args);
  };
  const response = await c.end(session);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'DEVICE_REQUIRED');
  assert.equal((await c.f.db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions')).rows[0].n, 1);
});

test('expired-session end rejects wrong or absent Origin, cookie and CSRF without changing sessions or costs', async t => {
  const c = await setup(t), session = await c.open(), valid = c.headers(session);
  await c.f.db.query('UPDATE yamadaya_trial.sessions SET expires=1 WHERE hash=$1', [session.owner]);
  const before = await c.snapshot();
  for (const headers of [
    { ...valid, origin: 'https://evil.example.test' }, { ...valid, origin: '' },
    { ...valid, cookie: '' }, { ...valid, cookie: '__Host-yamadaya_trial=malformed' },
    { ...valid, cookie: `__Host-yamadaya_trial=${randomBytes(32).toString('hex')}` },
    { ...valid, 'x-csrf-token': '' }, { ...valid, 'x-csrf-token': '0'.repeat(64) },
  ]) {
    const response = await c.end(session, { headers });
    assert.equal(response.status, 403);
    assert.notEqual((await response.json()).ended, true);
  }
  assert.equal((await c.f.db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions')).rows[0].n, 1);
  assert.deepEqual(await c.snapshot(), before);
  assert.equal(c.providerCalls, 0);
});

test('active-session end still requires the stored CSRF hash as well as its valid device-bound HMAC', async t => {
  const c = await setup(t), session = await c.open();
  await c.f.db.query('UPDATE yamadaya_trial.sessions SET csrf_hash=$1 WHERE hash=$2', [sha('different-token'), session.owner]);
  const response = await c.end(session);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'CSRF_REJECTED');
  assert.equal((await c.f.db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions')).rows[0].n, 1);
});

test('GET session migrates only its own legacy CSRF session, deletes its image and issues a fresh device-bound token', async t => {
  const c = await setup(t), mac = await c.open(), windows = await c.open(1);
  const macImage = await c.image(mac), windowsImage = await c.image(windows);
  const legacy = session => createHmac('sha256', c.sessionSecret).update(`csrf:${session.sid}`).digest('hex');
  for (const session of [mac, windows]) await c.f.db.query('UPDATE yamadaya_trial.sessions SET csrf_hash=$1 WHERE hash=$2', [sha(legacy(session)), session.owner]);
  const windowsBefore = (await c.f.db.query('SELECT * FROM yamadaya_trial.sessions WHERE hash=$1', [windows.owner])).rows;
  const before = await c.snapshot();

  // A copied old cookie on another device must not migrate/delete the owner's row.
  await c.open(1, mac.cookie);
  assert.equal((await c.f.db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions WHERE hash=$1', [mac.owner])).rows[0].n, 1);
  assert.equal(c.f.objects.has(macImage.key), true);
  const replacement = await c.open(0, mac.cookie);
  assert.notEqual(replacement.sid, mac.sid);
  assert.notEqual(replacement.csrf, legacy(mac));
  const expected = createHmac('sha256', c.sessionSecret).update(`csrf:v2:${c.f.devices[0].id}:${replacement.sid}`).digest('hex');
  assert.equal(replacement.csrf, expected);
  const newRow = (await c.f.db.query('SELECT * FROM yamadaya_trial.sessions WHERE hash=$1', [replacement.owner])).rows[0];
  assert.equal(newRow.csrf_hash, sha(replacement.csrf));
  assert.equal((await c.f.db.query('SELECT count(*)::int n FROM yamadaya_trial.sessions WHERE hash=$1', [mac.owner])).rows[0].n, 0);
  assert.equal(c.f.objects.has(macImage.key), false);
  assert.equal(c.f.objects.has(windowsImage.key), true);
  assert.deepEqual((await c.f.db.query('SELECT * FROM yamadaya_trial.sessions WHERE hash=$1', [windows.owner])).rows, windowsBefore);
  assert.equal((await c.end({ ...mac, csrf: legacy(mac) })).status, 403);
  assert.equal((await c.end(replacement)).status, 200);
  assert.equal(c.providerCalls, 2);
  assert.deepEqual(await c.snapshot(), before);
});

test('a storage deletion failure cannot revive the expired session and its pointer remains available for cleanup', async t => {
  const c = await setup(t), session = await c.open(), image = await c.image(session);
  await c.f.db.query('UPDATE yamadaya_trial.sessions SET expires=1 WHERE hash=$1', [session.owner]);
  c.f.storage.remove = async () => { throw Error('injected storage outage'); };
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await c.end(session)).status, 200);
  assert.equal(await c.f.ledger.getSession(session.owner, c.f.devices[0].id), null);
  assert.deepEqual(await c.f.ledger.listExpiredImageKeys(), [image.key]);
  assert.equal((await c.send(`${image.path}0`, { headers: { cookie: session.cookie } })).status, 401);
  assert.equal(c.f.objects.has(image.key), true);
  assert.equal(c.providerCalls, 1);
});
