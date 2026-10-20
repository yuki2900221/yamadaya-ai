import { createHash, randomBytes } from 'node:crypto';
import { error } from '../shared/contracts.mjs';

// No connection, DDL, import, startup recovery, or provider call occurs here.
// Each mutation is one database function call, so pg.Pool.query is safe too.
const hash = value => createHash('sha256').update(value).digest('hex');
const messages = {
  NOT_IMPORTED: [503, '既存の費用台帳の移行確認が完了していません。'],
  TRIAL_EXPIRED: [403, '試用の許可期限が終了しました。'],
  SESSION_EXPIRED: [401, '利用時間が終了しました。画面を更新してください。'],
  DEVICE_REQUIRED: [403, 'この端末は利用を許可されていません。'],
  NOT_FOUND: [404, 'この操作は見つかりません。'],
  ID_REUSED: [409, '同じ操作IDで内容を変更できません。'],
  UNCERTAIN_DUPLICATE: [409, '未確定の操作と同じ内容は再送できません。'],
  UNCERTAIN: [409, '課金が未確定です。管理者が確認するまで送信を停止します。'],
  BUSY: [429, '別の処理を作成中です。完了してから操作してください。'],
  RATE_LIMIT: [429, '少し待ってから操作してください。'],
  BUDGET_LIMIT: [409, '試用の費用上限に達しました。'],
  EXECUTOR_REQUIRED: [403, 'この処理を完了する権限がありません。'],
  LEASE_EXPIRED: [409, '処理期限を過ぎたため未確定として保留しました。'],
  ALREADY_FINISHED: [409, 'この処理は既に完了しています。'],
  ISOLATION_UNSUPPORTED: [503, '費用台帳の接続設定を確認してください。'],
  INVALID_REQUEST: [400, '操作を確認してください。'],
};
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validTime = value => Number.isSafeInteger(value) && value > 0;
function requireValue(condition) { if (!condition) throw error(400, '操作を確認してください。', 'INVALID_REQUEST'); }

export class HostedLedger {
  constructor(db, { schema = 'yamadaya_trial' } = {}) {
    if (!db || typeof db.query !== 'function') throw new TypeError('A server-only pg-compatible query adapter is required.');
    if (!['yamadaya_trial','yamadaya_mock'].includes(schema)) throw new TypeError('An isolated trial or mock schema is required.');
    this.db = db;
    this.schema = schema;
  }
  async call(action, payload = {}) {
    const response = await this.db.query(`SELECT ${this.schema}.runtime($1::text, $2::jsonb) AS value`, [action, JSON.stringify(payload)]);
    const value = response.rows?.[0]?.value;
    if (!value || typeof value !== 'object') throw error(503, '費用台帳へ接続できません。', 'LEDGER_UNAVAILABLE');
    if (!value.ok) {
      const code = Object.hasOwn(messages, value.code) ? value.code : 'INVALID_REQUEST';
      const [status, message] = messages[code];
      throw error(status, message, code);
    }
    return value.value;
  }
  usage() { return this.call('usage'); }
  async reserve({ id, owner, feature, requestHash, search = false }) {
    requireValue(validId(id) && validHash(owner) && validHash(requestHash)
      && ['chat', 'writing', 'pop', 'image'].includes(feature) && typeof search === 'boolean');
    const executorToken = randomBytes(32).toString('hex');
    const result = await this.call('reserve', { id, owner, feature, requestHash, search, executorHash: hash(executorToken) });
    return result.duplicate ? result : { ...result, executorToken };
  }
  finish({ id, owner, executorToken, state, costMicros = null }) {
    requireValue(validId(id) && validHash(owner) && validHash(executorToken)
      && ['succeeded', 'unknown'].includes(state)
      && (costMicros === null || (Number.isSafeInteger(costMicros) && costMicros >= 0)));
    return this.call('finish', { id, owner, executorHash: hash(executorToken), state, costMicros });
  }
  get(id, owner) {
    requireValue(validId(id) && validHash(owner));
    return this.call('get', { id, owner });
  }
  getDevice(id) {
    requireValue(validId(id));
    return this.call('device', { id });
  }
  claimNonce(nonce, expires) {
    requireValue(typeof nonce === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(nonce) && validTime(expires));
    return this.call('nonce', { nonce, expires });
  }
  createSession(sessionHash, deviceId, csrfHash, expires) {
    requireValue(validHash(sessionHash) && validId(deviceId) && validHash(csrfHash) && validTime(expires));
    return this.call('session-create', { sessionHash, deviceId, csrfHash, expires });
  }
  getSession(sessionHash, deviceId, now = Date.now()) {
    requireValue(validHash(sessionHash) && validId(deviceId) && validTime(now));
    return this.call('session-get', { sessionHash, deviceId, now });
  }
  touchSession(sessionHash, deviceId, expires) {
    requireValue(validHash(sessionHash) && validId(deviceId) && validTime(expires));
    return this.call('session-touch', { sessionHash, deviceId, expires });
  }
  endSession(sessionHash, deviceId) {
    requireValue(validHash(sessionHash) && validId(deviceId));
    return this.call('session-end', { sessionHash, deviceId });
  }
  putResult(id, owner, value, expires) {
    requireValue(validId(id) && validHash(owner) && validTime(expires)
      && value && typeof value === 'object' && !Array.isArray(value)
      && Buffer.byteLength(JSON.stringify(value), 'utf8') <= 65536);
    return this.call('result-put', { id, owner, value, expires });
  }
  getResult(id, owner) {
    requireValue(validId(id) && validHash(owner));
    return this.call('result-get', { id, owner });
  }
  listExpiredImageKeys(now = Date.now()) {
    requireValue(validTime(now));
    return this.call('image-expired-keys', { now });
  }
  listSessionImageKeys(owner, deviceId) {
    requireValue(validHash(owner) && validId(deviceId));
    return this.call('image-session-keys', { owner, deviceId });
  }
  removeImageMetadata(keys) {
    requireValue(Array.isArray(keys) && keys.length <= 32 && keys.every(key => typeof key === 'string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.bin$/.test(key)));
    return this.call('image-remove-metadata', { keys });
  }
  purgeExpired(now = Date.now()) {
    requireValue(validTime(now));
    // SQL uses its own clock. A caller cannot expire another executor early.
    return this.call('purge', { now });
  }
}
