import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { createConfiguredRuntime, runtimeConfiguration } from '../hosted/runtime.mjs';

const ref = 'abcdefghijklmnopqrst';
const configuration = () => ({ HOSTED_MODE: 'mock', HOSTED_PROJECT_REF: ref,
  HOSTED_DATABASE_URL: `postgresql://yamadaya_mock_web.${ref}:dummy-password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
  HOSTED_GATEWAY_SECRET: 'g'.repeat(40), HOSTED_SESSION_SECRET: 's'.repeat(40),
  HOSTED_PUBLIC_ORIGIN: 'https://trial.example.test', HOSTED_UPSTREAM_ORIGIN: 'https://trial-origin.example.test',
  HOSTED_STORAGE_BUCKET: 'trial-private', HOSTED_STORAGE_SERVER_KEY: 'dummy-server-credential' });

function capturePool(env) {
  let options;
  class Pool {
    constructor(value) { options = value; }
    query() { throw Error('A configuration test must not connect or query'); }
  }
  createConfiguredRuntime(env, { Pool, fetcher: () => { throw Error('A configuration test must not fetch'); } });
  return options;
}

test('database uses strict system trust when a project CA has not been configured', () => {
  const options = capturePool(configuration());
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(options.connectionString).search, '');
  assert.equal(options.max, 2);
});

test('project CA PEM reaches the injected pool while certificate and default hostname verification remain enabled', () => {
  // Node's public trust store provides a non-secret, valid CA test fixture.
  const ca = rootCertificates[0];
  const env = { ...configuration(), HOSTED_DATABASE_CA: `\n${ca}\n` };
  assert.equal(runtimeConfiguration(env).databaseCa, ca.trim());
  const options = capturePool(env);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, ca: ca.trim() });
  assert.equal(Object.hasOwn(options.ssl, 'checkServerIdentity'), false);
  assert.equal(new URL(options.connectionString).hostname, 'aws-0-ap-northeast-1.pooler.supabase.com');
  assert.equal(new URL(options.connectionString).search, '');
});

test('explicit empty, malformed or non-certificate CA values fail closed before pool construction', () => {
  for (const ca of ['', '  ', null, 1, {}, 'not a certificate',
    '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----',
    `${rootCertificates[0]}\nunexpected trailing data`,
    rootCertificates[0].replaceAll('\n', '\\n'),
  ]) {
    let constructed = false;
    assert.throws(() => createConfiguredRuntime({ ...configuration(), HOSTED_DATABASE_CA: ca }, {
      Pool: class { constructor() { constructed = true; } },
    }), /valid database CA certificate PEM/);
    assert.equal(constructed, false);
  }
});

test('CA configuration cannot enable weaker SSL modes or URL overrides of explicit TLS options', () => {
  const env = { ...configuration(), HOSTED_DATABASE_CA: rootCertificates[0] };
  for (const query of ['sslmode=require', 'sslmode=disable', 'sslmode=verify-ca', 'sslrootcert=somewhere', 'sslmode=verify-full&sslcert=somewhere']) {
    assert.throws(() => capturePool({ ...env, HOSTED_DATABASE_URL: env.HOSTED_DATABASE_URL.replace('sslmode=verify-full', query) }), /dedicated verified-TLS/);
  }
});
