import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../hosted/gateway.mjs';
import { createOriginVerifier, PROOF_HEADER, TARGET_HEADER } from '../hosted/origin-auth.mjs';
import { createWorkerBundle } from '../scripts/build-cloudflare-worker.mjs';

// Every test creates fresh in-memory dummy keys/certificate fingerprints. These
// exercise injected runtime metadata and stores; they are not Cloudflare E2E.
const digest = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const publicOrigin = 'https://trial.example.test';
const upstreamOrigin = 'https://trial-origin.example.test';
function fixture(options = {}) {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const approvedDevices = (options.deviceIds ?? ['mac-trial', 'windows-trial'])
    .map(id => ({ id, fingerprintSha256: digest() }));
  const live = new Set(approvedDevices.map(device => device.id)), nonces = new Set(), captured = [];
  let currentTime = 1800000000000, calls = 0;
  const config = { publicOrigin, upstreamOrigin, secret };
  const verify = createOriginVerifier({ ...config, now: () => currentTime,
    authorizeDevice: async ({ deviceId, fingerprintSha256 }) => live.has(deviceId) && approvedDevices.some(device => device.id === deviceId && device.fingerprintSha256 === fingerprintSha256),
    consumeNonce: async ({ nonce }) => { if (nonces.has(nonce)) return false; nonces.add(nonce); return true; },
    ...options.verifier,
  });
  const gateway = createGateway({ ...config, approvedDevices, now: () => currentTime,
    fetchImpl: async (request, transport) => {
      calls++; captured.push(request.clone());
      if (options.captureOnly) return new Response('captured', { headers: { 'Cache-Control': 'public, max-age=86400' } });
      if (options.fetchImpl) return options.fetchImpl(request, transport);
      const identity = await verify(request);
      return Response.json({ deviceId: identity.deviceId, body: new TextDecoder().decode(identity.body), target: identity.pathAndQuery }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    }, ...options.gateway,
  });
  function request(path = '/', { method = 'GET', body, headers = {}, device = 0, tls = {}, withCf = true } = {}) {
    const request = new Request(`${publicOrigin}${path}`, { method, headers: { ...(method === 'POST' ? { origin: publicOrigin } : {}), ...headers }, ...(body !== undefined ? { body } : {}) });
    if (withCf) Object.defineProperty(request, 'cf', { value: { tlsClientAuth: {
      certPresented: '1', certVerified: 'SUCCESS', certRevoked: '0', certFingerprintSHA256: approvedDevices[device].fingerprintSha256, ...tls,
    } } });
    return request;
  }
  return { config, gateway, verify, request, captured, approvedDevices, live, nonces,
    get calls() { return calls; }, advance(ms) { currentTime += ms; }, now: () => currentTime };
}

for (const path of ['/', '/mark.svg', '/assets/index-abc.js', '/assets/index-abc.css', '/api/session', '/api/jobs/1234-abcd']) {
  test(`every page/asset/API is protected through the same boundary: ${path}`, async () => {
    const f = fixture();
    const response = await f.gateway(f.request(path));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deviceId, 'mac-trial');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
    await assert.rejects(f.verify(new Request(`${upstreamOrigin}${path}`)), { status: 403 });
  });
}

test('Windows and Mac are distinct allowed certificate identities without employee credentials', async () => {
  const f = fixture();
  assert.equal((await (await f.gateway(f.request('/', { device: 1 }))).json()).deviceId, 'windows-trial');
  assert.equal((await (await f.gateway(f.request('/'))).json()).deviceId, 'mac-trial');
  assert.equal(f.calls, 2);
});

for (const count of [1, 2, 3]) {
  test(`${count} approved devices each retain their own signed origin identity without employee credentials`, async () => {
    const deviceIds = ['mac-trial', 'windows-trial', 'windows-second-trial'].slice(0, count);
    const f = fixture({ deviceIds });
    for (let device = 0; device < count; device++) {
      const response = await f.gateway(f.request('/api/session', { device }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).deviceId, deviceIds[device]);
    }
    assert.equal(f.calls, count);
    assert.equal(f.nonces.size, count);
  });
}

test('three-device enrollment still rejects unknown, absent, invalid and revoked TLS identities before upstream', async () => {
  const f = fixture({ deviceIds: ['mac-trial', 'windows-trial', 'windows-second-trial'] });
  for (const options of [
    { tls: { certFingerprintSHA256: digest() } }, { withCf: false },
    { tls: { certPresented: '0' } }, { tls: { certVerified: 'FAILED' } },
    { tls: { certRevoked: '1' } },
  ]) {
    const response = await f.gateway(f.request('/api/session', { device: 2, ...options }));
    assert.equal(response.status, 403);
  }
  assert.equal(f.calls, 0, 'Rejected identities must never reach the origin');
  for (const device of [0, 1, 2]) assert.equal((await f.gateway(f.request('/', { device }))).status, 200);
  assert.equal(f.calls, 3);
});

test('revoking the third device at the origin denies its next request while the original two stay usable', async () => {
  const f = fixture({ deviceIds: ['mac-trial', 'windows-trial', 'windows-second-trial'] });
  assert.equal((await f.gateway(f.request('/api/session', { device: 2 }))).status, 200);
  f.live.delete('windows-second-trial');
  const revoked = await f.gateway(f.request('/api/session', { device: 2 }));
  assert.equal(revoked.status, 403);
  assert.equal((await revoked.json()).code, 'DEVICE_REVOKED');
  for (const device of [0, 1]) {
    const response = await f.gateway(f.request('/api/session', { device }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deviceId, f.approvedDevices[device].id);
  }
  assert.equal(f.calls, 4);
  assert.equal(f.nonces.size, 3, 'Revocation must deny access before consuming a proof nonce');
});

test('in-memory Worker bundle accepts only the three configured device fingerprints and refuses a fourth configuration', async () => {
  const { code } = await createWorkerBundle();
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  const f = fixture({ deviceIds: ['mac-trial', 'windows-trial', 'windows-second-trial'] });
  const env = { HOSTED_MODE: 'mock', HOSTED_PUBLIC_ORIGIN: publicOrigin,
    HOSTED_UPSTREAM_ORIGIN: upstreamOrigin, HOSTED_GATEWAY_SECRET: 'local-three-device-test-secret-not-a-credential',
    HOSTED_APPROVED_DEVICES: JSON.stringify(f.approvedDevices) };
  const identities = [];
  const verify = createOriginVerifier({ publicOrigin, upstreamOrigin, secret: env.HOSTED_GATEWAY_SECRET,
    authorizeDevice: async ({ deviceId, fingerprintSha256 }) => f.approvedDevices.some(device => device.id === deviceId && device.fingerprintSha256 === fingerprintSha256),
    consumeNonce: async () => true,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async request => {
    identities.push((await verify(request)).deviceId);
    return new Response('local mock only');
  };
  try {
    for (const device of [0, 1, 2]) assert.equal((await worker.fetch(f.request('/api/session', { device }), env)).status, 200);
    assert.deepEqual(identities, f.approvedDevices.map(device => device.id));
    assert.equal((await worker.fetch(f.request('/', { tls: { certFingerprintSHA256: digest() } }), env)).status, 403);
    const invalid = { ...env, HOSTED_APPROVED_DEVICES: JSON.stringify([...f.approvedDevices, { id: 'fourth-trial', fingerprintSha256: digest() }]) };
    assert.equal((await worker.fetch(f.request('/'), invalid)).status, 503);
    assert.equal(identities.length, 3, 'Unknown fingerprints and over-limit configurations must not fetch upstream');
  } finally { globalThis.fetch = originalFetch; }
});

test('Mac-only enrollment allows that certificate and rejects Windows or unknown certificates before upstream', async () => {
  const f = fixture();
  let calls = 0;
  const gateway = createGateway({ ...f.config, approvedDevices: [f.approvedDevices[0]], now: f.now,
    fetchImpl: async request => { calls++; return Response.json(await f.verify(request)); },
  });
  const mac = await gateway(f.request('/api/session'));
  assert.equal(mac.status, 200);
  assert.equal((await mac.json()).deviceId, 'mac-trial');
  assert.equal(calls, 1);
  for (const request of [f.request('/', { device: 1 }), f.request('/', { tls: { certFingerprintSHA256: digest() } })]) {
    const response = await gateway(request);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'DEVICE_NOT_APPROVED');
  }
  assert.equal(calls, 1, 'Unenrolled certificates must not reach the origin');
});

test('POST is bound to body, public Origin, cookie, content type and CSRF header', async () => {
  const f = fixture();
  const response = await f.gateway(f.request('/api/jobs', { method: 'POST', body: '{"id":"dummy","prompt":"ダミー・テスト"}', headers: {
    'content-type': 'application/json', cookie: 'dummy_session=abc', 'x-csrf-token': 'dummy-csrf',
  } }));
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.match(value.body, /ダミー・テスト/);
  assert.equal(value.target, '/api/jobs');
  assert.equal(f.captured[0].headers.get('cookie'), 'dummy_session=abc');
  assert.equal(f.captured[0].headers.get('x-csrf-token'), 'dummy-csrf');
});

for (const tls of [{ certPresented: '0' }, { certVerified: 'FAILED' }, { certVerified: 'EXPIRED' }, { certRevoked: '1' }, { certFingerprintSHA256: digest() }]) {
  test(`missing/invalid/unapproved mTLS is denied before upstream: ${JSON.stringify(Object.keys(tls))}`, async () => {
    const f = fixture();
    const response = await f.gateway(f.request('/', { tls }));
    assert.equal(response.status, 403); assert.equal(f.calls, 0);
  });
}

test('HTTP mTLS and Access headers cannot substitute trusted Cloudflare runtime metadata', async () => {
  const f = fixture();
  const response = await f.gateway(f.request('/', { withCf: false, headers: {
    'cf-access-client-id': 'pretend', 'cf-access-jwt-assertion': 'pretend',
    'x-client-cert-verified': 'SUCCESS', 'x-client-fingerprint': f.approvedDevices[0].fingerprintSha256,
    [PROOF_HEADER]: 'pretend', 'x-yamadaya-device': 'mac-trial',
  } }));
  assert.equal(response.status, 403); assert.equal(f.calls, 0);
});

test('client spoofed gateway/forwarding/Access headers are stripped and proof is freshly issued', async () => {
  const f = fixture();
  const response = await f.gateway(f.request('/', { headers: {
    [PROOF_HEADER]: 'attacker', [TARGET_HEADER]: '/api/admin', 'x-yamadaya-device': 'windows-trial',
    'cf-access-jwt-assertion': 'attacker', 'x-forwarded-host': 'evil.example.test',
    'forwarded': 'host=evil.example.test', 'authorization': 'Bearer attacker',
  } }));
  assert.equal(response.status, 200);
  const headers = f.captured[0].headers;
  for (const name of ['x-yamadaya-device', 'cf-access-jwt-assertion', 'x-forwarded-host', 'forwarded', 'authorization']) assert.equal(headers.get(name), null);
  assert.notEqual(headers.get(PROOF_HEADER), 'attacker');
  assert.equal(headers.get(TARGET_HEADER), '/');
});

test('proof replay is rejected atomically across verifier instances sharing the nonce store', async () => {
  const f = fixture({ captureOnly: true });
  await f.gateway(f.request('/'));
  const request = f.captured[0];
  const secondVerifier = createOriginVerifier({ ...f.config, now: f.now,
    authorizeDevice: async () => true,
    consumeNonce: async ({ nonce }) => { if (f.nonces.has(nonce)) return false; f.nonces.add(nonce); return true; },
  });
  const results = await Promise.allSettled([f.verify(request.clone()), secondVerifier(request.clone())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'PROOF_REPLAYED').length, 1);
});

for (const [label, alter] of [
  ['method', request => new Request(request.url, { method: 'HEAD', headers: request.headers })],
  ['path', request => new Request(`${upstreamOrigin}/api/session`, { headers: request.headers })],
  ['query', request => new Request(`${request.url}?v=2`, { headers: request.headers })],
  ['upstream host', request => new Request('https://other.example.test/', { headers: request.headers })],
  ['Host header', request => { const headers = new Headers(request.headers); headers.set('host', 'other.example.test'); return new Request(request.url, { headers }); }],
  ['cookie', request => { const headers = new Headers(request.headers); headers.set('cookie', 'other-session=1'); return new Request(request.url, { headers }); }],
  ['CSRF', request => { const headers = new Headers(request.headers); headers.set('x-csrf-token', 'changed'); return new Request(request.url, { headers }); }],
  ['Origin', request => { const headers = new Headers(request.headers); headers.set('origin', 'https://evil.example.test'); return new Request(request.url, { headers }); }],
  ['original target header', request => { const headers = new Headers(request.headers); headers.set(TARGET_HEADER, '/api/admin'); return new Request(request.url, { headers }); }],
]) {
  test(`a copied proof cannot authorize altered ${label}`, async () => {
    const f = fixture({ captureOnly: true }); await f.gateway(f.request('/'));
    await assert.rejects(f.verify(alter(f.captured[0])), { status: 403 });
  });
}

test('POST body and content type cannot be changed while reusing a proof', async () => {
  const f = fixture({ captureOnly: true });
  await f.gateway(f.request('/api/jobs', { method: 'POST', body: '{"dummy":1}', headers: { 'content-type': 'application/json' } }));
  const request = f.captured[0];
  await assert.rejects(f.verify(new Request(request.url, { method: 'POST', headers: request.headers, body: '{"dummy":2}' })), { status: 403 });
  const headers = new Headers(request.headers); headers.set('content-type', 'text/plain');
  await assert.rejects(f.verify(new Request(request.url, { method: 'POST', headers, body: '{"dummy":1}' })), { status: 403 });
});

test('host rewrite target is only a candidate until it matches the signed target', async () => {
  const f = fixture({ captureOnly: true }); await f.gateway(f.request('/api/session'));
  const request = f.captured[0];
  // A real host adapter substitutes the signed candidate for its internal /app.
  assert.equal((await f.verify(new Request(`${upstreamOrigin}${request.headers.get(TARGET_HEADER)}`, { headers: request.headers }))).pathAndQuery, '/api/session');
  const forged = new Headers(request.headers); forged.set(TARGET_HEADER, '/api/admin');
  await assert.rejects(f.verify(new Request(`${upstreamOrigin}/api/admin`, { headers: forged })), { status: 403 });
  await assert.rejects(f.verify(new Request(`${upstreamOrigin}/app`, { headers: request.headers })), { status: 403 });
});

test('expired and too-far-future proofs are rejected without claiming an API was unsent', async () => {
  for (const advance of [30001, -5001]) {
    const f = fixture({ captureOnly: true }); await f.gateway(f.request('/')); f.advance(advance);
    await assert.rejects(f.verify(f.captured[0]), { status: 403 });
  }
});

for (const advance of [30000, -5000]) {
  test(`proof age/skew boundary remains inclusive at ${advance}ms`, async () => {
    const f = fixture({ captureOnly: true });
    await f.gateway(f.request('/')); f.advance(advance);
    assert.equal((await f.verify(f.captured[0])).deviceId, 'mac-trial');
    assert.equal(f.nonces.size, 1);
  });
}

for (const stage of ['authorizeDevice', 'consumeNonce']) {
  test(`waiting for ${stage} cannot extend the proof lifetime`, async () => {
    let release, started, nonceCalls = 0;
    const waiting = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    const f = fixture({ captureOnly: true, verifier: {
      authorizeDevice: async () => {
        if (stage === 'authorizeDevice') { started(); await waiting; }
        return true;
      },
      consumeNonce: async ({ nonce }) => {
        nonceCalls++; f.nonces.add(nonce);
        if (stage === 'consumeNonce') { started(); await waiting; }
        return true;
      },
    } });
    await f.gateway(f.request('/'));
    const verifying = f.verify(f.captured[0]);
    const denied = assert.rejects(verifying, { status: 403, code: 'GATEWAY_REQUIRED' });
    await entered;
    f.advance(30001); release();
    await denied;
    assert.equal(nonceCalls, stage === 'authorizeDevice' ? 0 : 1);
    // Already consumed nonces stay consumed; failing authentication does not
    // roll back replay protection or retry a request.
    assert.equal(f.nonces.size, nonceCalls);
  });
}

test('slow POST body cannot extend the proof lifetime', async () => {
  const f = fixture({ captureOnly: true });
  await f.gateway(f.request('/api/jobs', { method: 'POST', body: '{}' }));
  const captured = f.captured[0];
  const body = new ReadableStream({
    async pull(controller) { f.advance(30001); controller.enqueue(new TextEncoder().encode('{}')); controller.close(); },
  });
  await assert.rejects(f.verify(new Request(captured.url, { method: 'POST', headers: captured.headers, body, duplex: 'half' })), { status: 403 });
  assert.equal(f.nonces.size, 0);
});

test('revocation is re-read at the origin even when Worker allowlist still contains the device', async () => {
  const f = fixture({ captureOnly: true }); await f.gateway(f.request('/'));
  f.live.delete('mac-trial');
  await assert.rejects(f.verify(f.captured[0]), { code: 'DEVICE_REVOKED' });
  assert.equal(f.nonces.size, 0);
});

test('shared authorization or nonce store failure denies access; no memory fallback', async () => {
  for (const verifier of [
    { authorizeDevice: async () => { throw new Error('sensitive store details'); } },
    { consumeNonce: async () => { throw new Error('sensitive store details'); } },
  ]) {
    const f = fixture({ captureOnly: true, verifier }); await f.gateway(f.request('/'));
    await assert.rejects(f.verify(f.captured[0]), { status: 503, code: 'AUTH_STORE_UNAVAILABLE' });
  }
});

test('invalid signatures and a different gateway secret are rejected', async () => {
  const f = fixture({ captureOnly: true }); await f.gateway(f.request('/'));
  const request = f.captured[0], headers = new Headers(request.headers);
  const token = headers.get(PROOF_HEADER); headers.set(PROOF_HEADER, `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`);
  await assert.rejects(f.verify(new Request(request.url, { headers })), { status: 403 });
  const other = createOriginVerifier({ ...f.config, secret: crypto.getRandomValues(new Uint8Array(32)), authorizeDevice: async () => true, consumeNonce: async () => true, now: f.now });
  await assert.rejects(other(request), { status: 403 });
});

for (const path of ['/a%2fb', '/%2Eabc', '/a//b', '/a%5Cb', '/a?next=https%3A%2F%2Fevil.test', '/a#fragment']) {
  test(`ambiguous request target is rejected: ${path}`, async () => {
    const f = fixture(); const response = await f.gateway(f.request(path));
    assert.equal(response.status, 403); assert.equal(f.calls, 0);
  });
}

test('canonical query bytes are bound without reordering', async () => {
  const f = fixture({ captureOnly: true }); await f.gateway(f.request('/api/session?v=1&z=2'));
  const request = f.captured[0];
  await assert.rejects(f.verify(new Request(`${upstreamOrigin}/api/session?z=2&v=1`, { headers: request.headers })), { status: 403 });
  assert.equal((await f.verify(request)).pathAndQuery, '/api/session?v=1&z=2');
});

test('cross-origin or absent-Origin POST, unsupported methods, range and incorrect public Host never reach upstream', async () => {
  const f = fixture();
  for (const request of [
    f.request('/api/jobs', { method: 'POST', headers: { origin: 'https://evil.example.test' } }),
    f.request('/api/jobs', { method: 'POST', headers: { origin: '' } }),
    f.request('/', { method: 'DELETE' }),
    f.request('/', { headers: { range: 'bytes=0-4' } }),
    f.request('/', { headers: { host: 'evil.example.test' } }),
  ]) assert.ok((await f.gateway(request)).status >= 400);
  assert.equal(f.calls, 0);
});

test('request body is bounded by actual streamed bytes and Content-Length', async () => {
  const f = fixture({ gateway: { maxBodyBytes: 5 } });
  for (const options of [{ body: '123456' }, { body: '1', headers: { 'content-length': '6' } }]) {
    const response = await f.gateway(f.request('/api/jobs', { method: 'POST', ...options }));
    assert.equal(response.status, 413);
  }
  assert.equal(f.calls, 0);
});

test('upstream redirects are never followed or exposed as an open proxy', async () => {
  const f = fixture({ fetchImpl: async (_, transport) => {
    assert.equal(transport.redirect, 'manual'); assert.equal(transport.cache, 'no-store');
    return new Response(null, { status: 302, headers: { location: 'https://evil.example.test/' } });
  } });
  const response = await f.gateway(f.request('/'));
  assert.equal(response.status, 502); assert.equal(f.calls, 1);
  assert.equal(response.headers.get('location'), null);
});

test('upstream failure and timeout do not retry or falsely say the AI was not dispatched', async () => {
  for (const fetchImpl of [async () => { throw new Error('raw secret details'); }, async () => new Promise(() => {})]) {
    const f = fixture({ fetchImpl, gateway: { timeoutMs: 5 } });
    const response = await f.gateway(f.request('/api/jobs', { method: 'POST', body: '{}' }));
    assert.ok([502, 504].includes(response.status)); assert.equal(f.calls, 1);
    const json = await response.json();
    assert.equal(json.notDispatched, undefined); assert.equal(json.code, 'UPSTREAM_UNCERTAIN');
    assert.doesNotMatch(JSON.stringify(json), /raw secret/);
  }
});

test('HEAD remains protected and returns no response body', async () => {
  const f = fixture(); const response = await f.gateway(f.request('/', { method: 'HEAD' }));
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
});

test('missing secrets, stores, malformed origins, extra devices and duplicate devices fail closed at setup', () => {
  const f = fixture();
  for (const options of [
    { secret: '' }, { secret: crypto.getRandomValues(new Uint8Array(31)) },
    { publicOrigin: 'http://trial.example.test' }, { upstreamOrigin: 'https://127.0.0.1' },
    { upstreamOrigin: `${upstreamOrigin}/` }, { upstreamOrigin: publicOrigin },
    { publicOrigin: 'https://user:pass@trial.example.test' }, { maxBodyBytes: 3000001 },
  ]) assert.throws(() => createGateway({ ...f.config, approvedDevices: f.approvedDevices, ...options }));
  for (const approvedDevices of [
    [],
    [...f.approvedDevices, { id: 'third', fingerprintSha256: digest() }, { id: 'fourth', fingerprintSha256: digest() }],
    [...f.approvedDevices, { id: 'third', fingerprintSha256: digest() }, { id: 'fourth', fingerprintSha256: digest() }, { id: 'fifth', fingerprintSha256: digest() }],
    [f.approvedDevices[0], f.approvedDevices[0]],
    [f.approvedDevices[0], { id: f.approvedDevices[0].id, fingerprintSha256: digest() }],
    [f.approvedDevices[0], { id: 'other-id', fingerprintSha256: f.approvedDevices[0].fingerprintSha256 }],
    [...f.approvedDevices, { id: f.approvedDevices[0].id, fingerprintSha256: digest() }],
    [...f.approvedDevices, { id: 'third', fingerprintSha256: f.approvedDevices[0].fingerprintSha256 }],
  ]) {
    assert.throws(() => createGateway({ ...f.config, approvedDevices }));
  }
  assert.throws(() => createOriginVerifier({ ...f.config }));
  assert.throws(() => createOriginVerifier({ ...f.config, consumeNonce: async () => true }));
});
