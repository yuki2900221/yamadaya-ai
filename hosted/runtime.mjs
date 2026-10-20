import pg from 'pg';
import { X509Certificate } from 'node:crypto';
import { HostedLedger } from './ledger.mjs';
import { createOriginVerifier } from './origin-auth.mjs';
import { createHostedApp } from './app.mjs';
import { createPrivateStorage } from './images.mjs';
import { createHostedLiveProvider, HOSTED_LIVE_TARGET } from './live-provider.mjs';

// Only this new, isolated project's minimum-privilege DB login is permitted.
// No process environment is inspected until the operator configures the entry.
export function runtimeConfiguration(env) {
  const ref = env.HOSTED_PROJECT_REF;
  const live = env.HOSTED_MODE === 'live';
  if (!['mock', 'live'].includes(env.HOSTED_MODE) || !/^[a-z]{20}$/.test(ref || '')) throw Error('An isolated mock or live trial project is required');
  if (live && (ref !== HOSTED_LIVE_TARGET.ref || env.HOSTED_PUBLIC_ORIGIN !== HOSTED_LIVE_TARGET.publicOrigin ||
      env.HOSTED_UPSTREAM_ORIGIN !== HOSTED_LIVE_TARGET.upstreamOrigin || env.HOSTED_STORAGE_BUCKET !== HOSTED_LIVE_TARGET.bucket)) throw Error('The approved dedicated live trial target is required');
  const schema = live ? 'yamadaya_trial' : 'yamadaya_mock';
  const login = `${schema}_web`;
  const db = new URL(env.HOSTED_DATABASE_URL);
  const user = decodeURIComponent(db.username);
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.password || db.hash ||
      !(user === login || user === `${login}.${ref}`) ||
      !(db.hostname === `db.${ref}.supabase.co` || (db.hostname.endsWith('.pooler.supabase.com') && user.endsWith(`.${ref}`))) ||
      [...db.searchParams.keys()].some(key => !['sslmode'].includes(key)) ||
      (db.searchParams.has('sslmode') && db.searchParams.get('sslmode') !== 'verify-full')) throw Error('A dedicated verified-TLS database login is required');
  // Explicit pg SSL configuration must not be weakened by URL parameters.
  db.search = '';
  let databaseCa;
  if (env.HOSTED_DATABASE_CA !== undefined) {
    const value = env.HOSTED_DATABASE_CA;
    if (typeof value !== 'string' || !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----$/.test(value.trim())) throw Error('A valid database CA certificate PEM is required');
    try {
      if (!new X509Certificate(value.trim()).ca) throw Error();
    } catch { throw Error('A valid database CA certificate PEM is required'); }
    databaseCa = value.trim();
  }
  if (typeof env.HOSTED_GATEWAY_SECRET !== 'string' || Buffer.byteLength(env.HOSTED_GATEWAY_SECRET) < 32 ||
      typeof env.HOSTED_SESSION_SECRET !== 'string' || Buffer.byteLength(env.HOSTED_SESSION_SECRET) < 32 ||
      env.HOSTED_GATEWAY_SECRET === env.HOSTED_SESSION_SECRET) throw Error('Separate gateway and session secrets are required');
  return { mode: live ? 'live' : 'demo', schema, databaseUrl: db.href, databaseCa, ref, publicOrigin: env.HOSTED_PUBLIC_ORIGIN, upstreamOrigin: env.HOSTED_UPSTREAM_ORIGIN,
    gatewaySecret: env.HOSTED_GATEWAY_SECRET, sessionSecret: env.HOSTED_SESSION_SECRET,
    storageUrl: `https://${ref}.supabase.co`, bucket: env.HOSTED_STORAGE_BUCKET, serverKey: env.HOSTED_STORAGE_SERVER_KEY };
}

export function createConfiguredRuntime(env, { Pool = pg.Pool, fetcher = fetch } = {}) {
  const config = runtimeConfiguration(env);
  const pool = new Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: true, ...(config.databaseCa ? { ca: config.databaseCa } : {}) }, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true });
  const ledger = new HostedLedger(pool, { schema: config.schema });
  const verify = createOriginVerifier({ publicOrigin: config.publicOrigin, upstreamOrigin: config.upstreamOrigin, secret: config.gatewaySecret,
    consumeNonce: ({ nonce, expiresAt }) => ledger.claimNonce(nonce, expiresAt),
    authorizeDevice: async ({ deviceId, fingerprintSha256 }) => {
      const device = await ledger.getDevice(deviceId);
      // Database latency must not extend a device's registration period.
      const now = Date.now();
      return device?.status === 'active' && device.fingerprint_sha256 === fingerprintSha256 && device.not_before <= now && device.not_after > now;
    } });
  const storage = createPrivateStorage({ baseUrl: config.storageUrl, bucket: config.bucket, serverKey: config.serverKey, fetcher });
  // Mock mode never inspects the live credential variables, including when
  // secrets happen to exist in the operator's process environment.
  const provider = config.mode === 'live' ? createHostedLiveProvider(env, { fetcher }) : undefined;
  return { config, pool, ledger, storage, handle: createHostedApp({ ledger, verify, storage, mode: config.mode, provider,
    beforeDispatch: provider?.assertReady, publicOrigin: config.publicOrigin, sessionSecret: config.sessionSecret }) };
}
