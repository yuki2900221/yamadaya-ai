import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { FEATURES, validateJob, error as contractError } from '../shared/contracts.mjs';
import { reviewProposal } from '../shared/proposal-policy.js';
import { createDemoProvider } from '../server/demo.mjs';
import { stageImage, IMAGE_CHUNK_BYTES, digest } from './images.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const error = (...args) => Object.assign(contractError(...args), { publicMessage: true });
const safeCodes = new Set(['INVALID_REQUEST','GATEWAY_REQUIRED','INVALID_PATH','METHOD_REJECTED','ORIGIN_REJECTED','RANGE_REJECTED','BODY_TOO_LARGE','DEVICE_REVOKED','PROOF_REPLAYED','AUTH_STORE_UNAVAILABLE','NOT_IMPORTED','TRIAL_EXPIRED','SESSION_EXPIRED','DEVICE_REQUIRED','NOT_FOUND','ID_REUSED','UNCERTAIN_DUPLICATE','UNCERTAIN','BUSY','RATE_LIMIT','BUDGET_LIMIT','EXECUTOR_REQUIRED','LEASE_EXPIRED','ALREADY_FINISHED','LEDGER_UNAVAILABLE','FORBIDDEN','CSRF_REJECTED','IMAGE_MISMATCH','COST_UNCERTAIN','INVALID_IMAGE','STORAGE_UNAVAILABLE']);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const security = {
  'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const json = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...security, 'Content-Type': 'application/json; charset=utf-8', ...extra } });

export function hostedStopReason(usage, now) {
  if (usage.imported === false) return 'NOT_IMPORTED';
  if (Number.isFinite(usage.expires) && usage.expires <= now) return 'TRIAL_EXPIRED';
  if (usage.paused === true) return usage.pauseReason === 'COST_UNCERTAIN' ? 'COST_UNCERTAIN' : 'PAUSED';
  return null;
}

/** Hosted preparation ONLY: no live provider/key loading. All calls use a mock. */
export function createHostedApp({ ledger, verify, storage, publicOrigin, sessionSecret, staticRoot = path.resolve(import.meta.dirname, '../dist'), mockProvider = createDemoProvider(), now = () => Date.now(), sessionTtlMs = 15 * 60000 } = {}) {
  if (!ledger || typeof verify !== 'function' || !storage || typeof sessionSecret !== 'string' || Buffer.byteLength(sessionSecret) < 32 || !publicOrigin?.startsWith('https://') || sessionTtlMs > 15 * 60000 || sessionTtlMs < 1000) throw Error('Hosted configuration required');
  const cookieName = '__Host-yamadaya_trial';
  const cookie = value => `${cookieName}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/${value ? '' : '; Max-Age=0'}`;
  const csrfFor = (sid, deviceId) => createHmac('sha256', sessionSecret).update(`csrf:v2:${deviceId}:${sid}`).digest('hex');

  async function closeSession(owner, deviceId) {
    const keys = await ledger.listSessionImageKeys(owner, deviceId);
    await ledger.endSession(owner, deviceId);
    // Revocation happens first. A storage outage must not revive a session.
    // Result metadata is retained for cleanup if removing the object fails.
    for (const key of keys) { try { await storage.remove(key); await ledger.removeImageMetadata([key]); } catch { /* next private cleanup retries deletion only */ } }
  }

  async function jobResponse(record, owner, result) {
    let cached = result;
    if (record.state === 'succeeded' && !cached) {
      try { cached = await ledger.getResult(record.id, owner); } catch (e) { if (e.code !== 'NOT_FOUND') throw e; }
    }
    const value = cached?.value ?? cached;
    const safe = record.state === 'succeeded' ? value : null;
    return { id: record.id, state: record.state, result: safe || null, resultUnavailable: record.state === 'succeeded' && !safe,
      message: record.state === 'unknown' ? '結果または課金が未確定です。自動で再送しません。' : record.state === 'sending' ? '作成しています。' : !safe ? '処理は完了していますが、会話本文・提案は保存していません。同じ操作は再送しません。' : '', billing: 'モック・実API料金なし' };
  }

  return async function handle(request) {
    let dispatched = false;
    try {
      // There are no unauthenticated HTML, asset, API or health routes.
      const auth = await verify(request);
      const pathname = new URL(request.url).pathname;
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) throw error(405, '使用できない操作です。');
      if (!pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(request.method)) throw error(405, '使用できない操作です。');
        if (!(pathname === '/' || pathname === '/mark.svg' || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname))) throw error(404, '見つかりません。');
        const file = path.join(staticRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
        const bytes = await fs.readFile(file).catch(() => { throw error(404, '画面が準備できていません。'); });
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
        return new Response(request.method === 'HEAD' ? null : bytes, { headers: { ...security, 'Content-Type': types[path.extname(file)] || 'application/octet-stream' } });
      }
      if (!new RegExp(`^/api/(session|end|jobs(?:/${UUID})?|images/${UUID}/[0-4])$`).test(pathname)) throw error(403, '共用PCではこの機能を利用できません。', 'FORBIDDEN');
      const reqOrigin = request.headers.get('origin');
      if ((reqOrigin && reqOrigin !== publicOrigin) || (request.method === 'POST' && reqOrigin !== publicOrigin)) throw error(403, '送信元を確認できません。', 'ORIGIN_REJECTED');
      let sid = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-yamadaya_trial=([a-f0-9]{64})(?:;|$)/)?.[1];
      let owner = sid && hash(sid), session = owner && await ledger.getSession(owner, auth.deviceId, now());
      if (pathname === '/api/session' && request.method === 'GET') {
        // Legacy CSRF did not bind the device. Rotate only the session owned by
        // this authenticated device; getSession never returns another device's row.
        if (session && !equal(session.csrf_hash, hash(csrfFor(sid, auth.deviceId)))) {
          await closeSession(owner, auth.deviceId);
          session = null;
        }
        if (!session) {
          sid = randomBytes(32).toString('hex'); owner = hash(sid);
          await ledger.createSession(owner, auth.deviceId, hash(csrfFor(sid, auth.deviceId)), now() + sessionTtlMs);
        } else await ledger.touchSession(owner, auth.deviceId, now() + sessionTtlMs);
        const usage = await ledger.usage();
        return json(200, { csrf: csrfFor(sid, auth.deviceId), mode: 'demo', capabilities: FEATURES, connected: false, imageConnected: false, budgetRemainingUsd: null, idleMinutes: sessionTtlMs / 60000, searchEnabled: true, spendingPaused: usage.paused ?? usage.uncertain > 0, stopReason: hostedStopReason(usage, now()), oneTestId: null, oneTestFeature: null }, { 'Set-Cookie': cookie(sid) });
      }
      if (pathname === '/api/end' && request.method === 'POST') {
        const token = sid && csrfFor(sid, auth.deviceId);
        if (!sid || !equal(request.headers.get('x-csrf-token'), token) ||
            (session && !equal(session.csrf_hash, hash(token)))) throw error(403, '画面を更新してから操作してください。', 'CSRF_REJECTED');
        // getSession above still checks current device status/registration in
        // SQL. A device-bound token can acknowledge an expired or already closed
        // session without creating/touching a session or accepting another device.
        await closeSession(owner, auth.deviceId);
        return json(200, { ended: true }, { 'Set-Cookie': cookie('') });
      }
      if (!session) throw error(401, '利用時間が終了しました。画面を更新してください。', 'SESSION_EXPIRED');
      await ledger.touchSession(owner, auth.deviceId, now() + sessionTtlMs);
      const imageRoute = pathname.match(new RegExp(`^/api/images/(${UUID})/([0-4])$`));
      if (imageRoute && request.method === 'GET') {
        const saved = await ledger.getResult(imageRoute[1], owner), value = saved?.value ?? saved, image = value?.imageManifest;
        if (!image || now() >= image.expires || Number(imageRoute[2]) >= image.chunks) throw error(404, '画像の保存期限が終了しました。');
        const bytes = await storage.get(image.key);
        if (bytes.length !== image.size || digest(bytes) !== image.sha256) throw error(502, '画像の一致を確認できません。', 'IMAGE_MISMATCH');
        if (!(await ledger.getSession(owner, auth.deviceId, now())) || now() >= image.expires) throw error(401, '利用時間が終了しました。', 'SESSION_EXPIRED');
        const offset = Number(imageRoute[2]) * IMAGE_CHUNK_BYTES;
        return new Response(bytes.subarray(offset, offset + IMAGE_CHUNK_BYTES), { headers: { ...security, 'Content-Type': 'application/octet-stream' } });
      }
      const getJob = pathname.match(new RegExp(`^/api/jobs/(${UUID})$`));
      if (getJob && request.method === 'GET') {
        const record = await ledger.get(getJob[1], owner);
        if (!record) throw error(404, 'この操作は見つかりません。');
        return json(200, await jobResponse(record, owner));
      }
      if (!equal(request.headers.get('x-csrf-token'), csrfFor(sid, auth.deviceId)) || !equal(session.csrf_hash, hash(csrfFor(sid, auth.deviceId)))) throw error(403, '画面を更新してから操作してください。', 'CSRF_REJECTED');
      if (pathname !== '/api/jobs' || request.method !== 'POST') throw error(405, '使用できない操作です。');
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw error(415, 'JSONで送信してください。');
      if (auth.body.length > 3_000_000) throw error(413, '画像または入力が大きすぎます。');
      let body; try { body = validateJob(JSON.parse(new TextDecoder().decode(auth.body))); } catch (e) { throw e.status ? e : error(400, '入力を読み取れません。'); }
      const requestHash = hash(JSON.stringify({ feature: body.feature, input: body.input }));
      const reservation = await ledger.reserve({ id: body.id, owner, feature: body.feature, requestHash, search: body.input.search === true });
      if (reservation.duplicate) return json(200, await jobResponse(reservation.record, owner));
      dispatched = true;
      let staged, published = false;
      try {
        const generated = await mockProvider.run(body.feature, body.input);
        let value = generated.result;
        if (body.feature === 'pop') {
          const safe = reviewProposal({ info: body.input.prompt, atmosphere: '', paper: body.input.paper || 'a4p', mood: ({ '明るく': 'lively', '自然に': 'fresh', '落ち着いて': 'premium', 'やさしく': 'friendly' })[body.input.mood || '明るく'] }, { headlines: [value.headline, value.headline, value.headline], catchphrase: value.copy, direction: value.direction, confirmation_points: value.checks });
          value = { headline: safe.proposal.headlines[0], headlines: [...new Set(safe.proposal.headlines)], copy: safe.proposal.catchphrase, direction: safe.proposal.direction, checks: safe.proposal.confirmation_points, paper: safe.paper.code, adjusted: safe.adjusted, demo: true };
        }
        const costMicros = Number.isFinite(generated.cost) && generated.cost >= 0 ? Math.ceil(generated.cost * 1e6) : null;
        if (costMicros === null || costMicros > reservation.record.hold) throw error(409, '費用を確認できません。新しい送信を停止します。', 'COST_UNCERTAIN');
        if (body.feature === 'image') {
          staged = await stageImage(storage, value.image, { mock: true });
          value = { demo: true, paper: value.paper, imageManifest: { ...staged, expires: now() + sessionTtlMs, path: `/api/images/${body.id}/` } };
        }
        await ledger.finish({ id: body.id, owner, executorToken: reservation.executorToken, state: 'succeeded', costMicros });
        if (!(await ledger.getSession(owner, auth.deviceId, now()))) {
          if (staged) await storage.remove(staged.key);
          throw error(401, '利用時間が終了したため結果を破棄しました。処理記録は保持しています。', 'SESSION_EXPIRED');
        }
        // Text, input and conversations are never persisted. Only image pointers have TTL.
        if (staged) {
          await ledger.putResult(body.id, owner, value, value.imageManifest.expires);
          if (!(await ledger.getSession(owner, auth.deviceId, now()))) {
            await storage.remove(staged.key);
            throw error(401, '利用時間が終了したため結果を破棄しました。', 'SESSION_EXPIRED');
          }
        }
        published = true;
        return json(200, await jobResponse({ ...reservation.record, state: 'succeeded' }, owner, value));
      } catch (e) {
        if (staged && !published) { try { await storage.remove(staged.key); } catch { /* private inventory cleanup reaps orphan objects too */ } }
        if ((await ledger.get(body.id, owner))?.state === 'sending') await ledger.finish({ id: body.id, owner, executorToken: reservation.executorToken, state: 'unknown', costMicros: null });
        throw e;
      }
    } catch (e) {
      const code = safeCodes.has(e.code) ? e.code : 'HOSTED_UNAVAILABLE';
      return json(safeCodes.has(e.code) && [400,401,403,404,405,409,413,415,416,422,429,500,502,503,504].includes(e.status) ? e.status : 503, { error: e.publicMessage ? e.message : '接続状態を確認できません。自動で再送しません。', code, notDispatched: !dispatched });
    }
  };
}
