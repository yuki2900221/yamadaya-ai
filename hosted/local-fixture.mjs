// Local dummy harness only. Never bundled/deployed, never opens the live ledger.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { HostedLedger } from './ledger.mjs';
import { createGateway } from './gateway.mjs';
import { createOriginVerifier } from './origin-auth.mjs';
import { createHostedApp } from './app.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export async function createLocalFixture({ mockProvider, staticRoot } = {}) {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; SET yamadaya_trial.migration_target='dedicated-project';");
  await db.exec(await readFile(new URL('./migrations/001-hosted.sql', import.meta.url), 'utf8'));
  const devices = [{ id: 'dummy-mac', fingerprintSha256: sha('dummy-mac-certificate') }, { id: 'dummy-windows', fingerprintSha256: sha('dummy-windows-certificate') }];
  const initialTime = Date.now();
  for (const device of devices) await db.query('INSERT INTO yamadaya_trial.devices VALUES($1,$2,\'active\',$3,$4)', [device.id, device.fingerprintSha256, initialTime - 1000, initialTime + 3600000]);
  // Invented metadata: these rows/amounts are NOT an export of the live budget.
  const jobs = [350000,50000,50000].map((hold, i) => ({ id: `dummy-unknown-${i}`, owner: sha(`old-owner-${i}`), feature: i ? 'chat' : 'image', state: 'unknown', hold, cost: null, created: initialTime - 60000, finished: null, request_hash: sha(`old-unknown-${i}`) }));
  await db.query('SELECT yamadaya_trial.import_snapshot($1::jsonb)', [JSON.stringify({ version: 1, snapshotHash: sha('dummy-fixture-only'), limitMicros: 10000000, approvedUntil: initialTime + 3600000, expected: { count: 3, reserved: 450000, calculated: 0, uncertain: 3 }, jobs })]);
  const objects = new Map(), created = new Map();
  const storage = { async put(key, bytes) { objects.set(key, Buffer.from(bytes)); created.set(key, Date.now()); }, async get(key) { if (!objects.has(key)) throw Error('Object unavailable'); return objects.get(key); }, async remove(key) { objects.delete(key); created.delete(key); }, async listExpiredKeys(now) { return [...created].filter(([,time]) => time <= now - 900000).map(([key]) => key); } };
  const ledger = new HostedLedger(db), secret = randomBytes(32).toString('hex'), sessionSecret = randomBytes(32).toString('hex');
  const publicOrigin = 'https://local-trial.example.test', upstreamOrigin = 'https://local-origin.example.test';
  const verify = createOriginVerifier({ publicOrigin, upstreamOrigin, secret,
    consumeNonce: ({ nonce, expiresAt }) => ledger.claimNonce(nonce, expiresAt),
    authorizeDevice: async ({ deviceId, fingerprintSha256, now }) => {
      const current = await ledger.getDevice(deviceId);
      return current?.status === 'active' && current.fingerprint_sha256 === fingerprintSha256 && current.not_before <= now && current.not_after > now;
    } });
  const makeApp = () => createHostedApp({ ledger: new HostedLedger(db), verify, storage, publicOrigin, sessionSecret, mockProvider, staticRoot });
  let active = makeApp();
  const gateway = createGateway({ publicOrigin, upstreamOrigin, secret, approvedDevices: devices, fetchImpl: request => active(request) });
  const request = (route, { method = 'GET', headers = {}, body, device = 0, registered = true } = {}) => {
    const result = new Request(`${publicOrigin}${route}`, { method, headers: { ...(method === 'POST' ? { Origin: publicOrigin } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    if (registered) Object.defineProperty(result, 'cf', { value: { tlsClientAuth: { certPresented: '1', certVerified: 'SUCCESS', certRevoked: '0', certFingerprintSHA256: devices[device].fingerprintSha256 } } });
    return result;
  };
  return { db, ledger, storage, objects, verify, gateway, devices, publicOrigin, upstreamOrigin, request,
    handle: request => active(request), restart() { active = makeApp(); }, async close() { await db.close(); } };
}
