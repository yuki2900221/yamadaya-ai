import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkerBundle } from '../scripts/build-cloudflare-worker.mjs';
import { createOriginVerifier, PROOF_HEADER } from '../hosted/origin-auth.mjs';

const bundle = createWorkerBundle();
const load = async () => import(`data:text/javascript;base64,${Buffer.from((await bundle).code).toString('base64')}`);
const env = { HOSTED_MODE: 'mock', HOSTED_PUBLIC_ORIGIN: 'https://mock.example.test',
  HOSTED_UPSTREAM_ORIGIN: 'https://origin.example.test', HOSTED_GATEWAY_SECRET: 'dummy-gateway-secret-for-local-tests-only',
  HOSTED_APPROVED_DEVICES: JSON.stringify([
    { id: 'test-mac', fingerprintSha256: 'a'.repeat(64) },
    { id: 'test-windows', fingerprintSha256: 'b'.repeat(64) },
  ]) };

test('Worker builds one ESM default export from only the three reviewed modules', async () => {
  const { code, manifest } = await bundle;
  assert.deepEqual(manifest.exports, ['default']);
  assert.equal(manifest.externalImports, 0);
  assert.equal(manifest.environmentValuesEmbedded, false);
  assert.equal(manifest.sources.length, 3);
  assert.equal(manifest.sha256, createHash('sha256').update(code).digest('hex'));
  for (const source of manifest.sources) {
    const original = await readFile(new URL(`../${source.path}`, import.meta.url), 'utf8');
    assert.equal(source.sha256, createHash('sha256').update(original).digest('hex'));
  }
  assert.ok(code.includes('HOSTED_GATEWAY_SECRET'), 'Secrets remain runtime bindings');
  assert.ok(!code.includes(env.HOSTED_GATEWAY_SECRET));
  assert.doesNotMatch(code, /\b(?:process|Buffer|require|__dirname|__filename)\b|node:/);
  const module = await load();
  assert.deepEqual(Object.keys(module), ['default']);
  assert.equal(typeof module.default.fetch, 'function');
});

test('bundled Worker denies missing TLS and invalid mode without fetching upstream', async () => {
  const module = await load(), originalFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw Error('Unexpected upstream request'); };
  try {
    assert.equal((await module.default.fetch(new Request(`${env.HOSTED_PUBLIC_ORIGIN}/`), env)).status, 403);
    assert.equal((await module.default.fetch(new Request(`${env.HOSTED_PUBLIC_ORIGIN}/`), { ...env, HOSTED_MODE: 'live' })).status, 503);
    assert.equal(fetched, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('bundled Worker keeps signed request binding compatible with the origin verifier', async () => {
  const module = await load(), originalFetch = globalThis.fetch;
  const verify = createOriginVerifier({ publicOrigin: env.HOSTED_PUBLIC_ORIGIN,
    upstreamOrigin: env.HOSTED_UPSTREAM_ORIGIN, secret: env.HOSTED_GATEWAY_SECRET,
    consumeNonce: async () => true,
    authorizeDevice: async ({ deviceId, fingerprintSha256 }) => deviceId === 'test-windows' && fingerprintSha256 === 'b'.repeat(64),
  });
  let identity;
  globalThis.fetch = async request => {
    assert.equal(request.url, `${env.HOSTED_UPSTREAM_ORIGIN}/api/session`);
    assert.notEqual(request.headers.get(PROOF_HEADER), 'client-forgery');
    assert.equal(request.headers.get('authorization'), null);
    identity = await verify(request);
    return new Response('local mock only');
  };
  try {
    const request = new Request(`${env.HOSTED_PUBLIC_ORIGIN}/api/session`, { headers: {
      [PROOF_HEADER]: 'client-forgery', authorization: 'Bearer client-forgery',
    } });
    Object.defineProperty(request, 'cf', { value: { tlsClientAuth: {
      certPresented: '1', certVerified: 'SUCCESS', certRevoked: '0', certFingerprintSHA256: 'b'.repeat(64),
    } } });
    const response = await module.default.fetch(request, env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'local mock only');
    assert.equal(identity.deviceId, 'test-windows');
    assert.equal(identity.pathAndQuery, '/api/session');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  } finally { globalThis.fetch = originalFetch; }
});

for (const [label, extra] of [
  ['Node built-in', "import 'node:fs';"],
  ['unreviewed file', "import './unexpected.mjs';"],
  ['dynamic import', "void import('./unexpected.mjs');"],
]) test(`Worker build refuses an added ${label} dependency`, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'yamadaya-worker-source-'));
  try {
    await mkdir(resolve(root, 'hosted'));
    for (const name of ['worker-entry.mjs', 'gateway.mjs', 'origin-auth.mjs']) {
      const code = await readFile(new URL(`../hosted/${name}`, import.meta.url), 'utf8');
      await writeFile(resolve(root, 'hosted', name), `${name === 'worker-entry.mjs' ? extra : ''}\n${code}`);
    }
    await assert.rejects(createWorkerBundle({ root }), /three reviewed source modules/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
