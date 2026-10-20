import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConfiguredRuntime } from '../hosted/runtime.mjs';
import { createGateway } from '../hosted/gateway.mjs';

// Exercise the actual runtime wiring with an injected, in-memory query adapter.
// No process environment, real credentials, database or network is accessed.
const instant = 1800000000000;
const publicOrigin = 'https://trial.example.test';
const upstreamOrigin = 'https://trial-origin.example.test';
const digest = () => randomBytes(32).toString('hex');

function fixture(t, period = {}) {
  let currentTime = instant;
  t.mock.method(Date, 'now', () => currentTime);
  const secret = digest(), calls = [], nonces = new Set();
  const device = { id: 'mac-trial', fingerprint_sha256: digest(), status: 'active',
    not_before: instant - 1000, not_after: instant + 60000, ...period };
  let fetches = 0;
  class Pool {
    async query(sql, [action, payload]) {
      assert.equal(sql, 'SELECT yamadaya_mock.runtime($1::text, $2::jsonb) AS value');
      const input = JSON.parse(payload); calls.push(action);
      let value;
      if (action === 'device') value = input.id === device.id ? { ...device } : null;
      else if (action === 'nonce') {
        value = !nonces.has(input.nonce); nonces.add(input.nonce);
      } else if (action === 'session-create') value = true;
      else if (action === 'usage') value = { imported: false, paused: true, uncertain: 0 };
      else throw Error(`Unexpected database action: ${action}`);
      return { rows: [{ value: { ok: true, value } }] };
    }
  }
  const runtime = createConfiguredRuntime({ HOSTED_MODE: 'mock', HOSTED_PROJECT_REF: 'abcdefghijklmnopqrst',
    HOSTED_DATABASE_URL: 'postgresql://yamadaya_mock_web:dummy-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=verify-full',
    HOSTED_PUBLIC_ORIGIN: publicOrigin, HOSTED_UPSTREAM_ORIGIN: upstreamOrigin,
    HOSTED_GATEWAY_SECRET: secret, HOSTED_SESSION_SECRET: digest(),
    HOSTED_STORAGE_BUCKET: 'trial-private', HOSTED_STORAGE_SERVER_KEY: 'dummy-server-credential',
  }, { Pool, fetcher: async () => { fetches++; throw Error('Network is forbidden in this fixture'); } });

  async function signedRequest(fingerprintSha256 = device.fingerprint_sha256) {
    let captured;
    const gateway = createGateway({ publicOrigin, upstreamOrigin, secret,
      approvedDevices: [{ id: device.id, fingerprintSha256 }], now: () => instant,
      fetchImpl: async request => { captured = request; return new Response(null); },
    });
    const request = new Request(`${publicOrigin}/api/session`);
    Object.defineProperty(request, 'cf', { value: { tlsClientAuth: {
      certPresented: '1', certVerified: 'SUCCESS', certRevoked: '0', certFingerprintSHA256: fingerprintSha256,
    } } });
    assert.equal((await gateway(request)).status, 200);
    assert.ok(captured);
    return captured;
  }
  return { runtime, signedRequest, device, calls, nonces, advance(ms) { currentTime += ms; }, get fetches() { return fetches; } };
}

for (const [label, period, allowed] of [
  ['at not_before', { not_before: instant }, true],
  ['one millisecond before not_before', { not_before: instant + 1 }, false],
  ['at not_after', { not_after: instant }, false],
  ['one millisecond before not_after', { not_after: instant + 1 }, true],
]) {
  test(`configured runtime checks device registration ${label}`, async t => {
    const f = fixture(t, period);
    const response = await f.runtime.handle(await f.signedRequest());
    const result = await response.json();
    assert.equal(response.status, allowed ? 200 : 403);
    if (allowed) {
      assert.equal(result.mode, 'demo');
      assert.equal(result.stopReason, 'NOT_IMPORTED');
      assert.deepEqual(f.calls, ['device', 'nonce', 'session-create', 'usage']);
    } else {
      assert.equal(result.code, 'DEVICE_REVOKED');
      assert.deepEqual(f.calls, ['device']);
    }
    assert.equal(f.nonces.size, allowed ? 1 : 0);
    assert.equal(f.fetches, 0);
  });
}

test('configured runtime rejects an outstanding old fingerprint proof after rotation under the same device ID', async t => {
  const f = fixture(t);
  const originalId = f.device.id, oldFingerprint = f.device.fingerprint_sha256;
  const oldProof = await f.signedRequest(oldFingerprint);
  f.device.fingerprint_sha256 = digest();
  const denied = await f.runtime.handle(oldProof);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'DEVICE_REVOKED');
  assert.deepEqual(f.calls, ['device']);
  assert.equal(f.nonces.size, 0);

  const accepted = await f.runtime.handle(await f.signedRequest());
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).mode, 'demo');
  assert.equal(f.device.id, originalId);
  assert.notEqual(f.device.fingerprint_sha256, oldFingerprint);
  assert.deepEqual(f.calls, ['device', 'device', 'nonce', 'session-create', 'usage']);
  assert.equal(f.nonces.size, 1);
  assert.equal(f.fetches, 0);
});

test('device registration expiring during its database lookup is rejected before nonce or session creation', async t => {
  const f = fixture(t, { not_after: instant + 1 });
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const query = f.runtime.pool.query.bind(f.runtime.pool);
  f.runtime.pool.query = async (sql, params) => {
    const result = await query(sql, params);
    if (params[0] === 'device') { started(); await waiting; }
    return result;
  };
  const pending = f.runtime.handle(await f.signedRequest());
  await entered;
  f.advance(1); release(); // Exactly not_after; the proof itself is still fresh.
  const response = await pending;
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'DEVICE_REVOKED');
  assert.deepEqual(f.calls, ['device']); // One lookup; no retry loop or writes.
  assert.equal(f.nonces.size, 0);
  assert.equal(f.fetches, 0);
});
