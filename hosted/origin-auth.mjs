// Hosting preparation only. Every origin route must run this verifier before
// reading a session, serving an asset, or dispatching work. Nothing is deployed.
export const PROOF_HEADER = 'x-yamadaya-gateway-proof';
export const TARGET_HEADER = 'x-yamadaya-original-target';
export const DEFAULT_BODY_LIMIT = 3_000_000;
export const FORWARDED_HEADERS = Object.freeze([
  'accept', 'accept-language', 'content-type', 'cookie', 'origin', 'x-csrf-token',
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const safeId = /^[a-zA-Z0-9_-]{1,80}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const noncePattern = /^[a-f0-9]{32}$/;

export function authError(status = 403, code = 'GATEWAY_REQUIRED') {
  return Object.assign(new Error('Gateway authentication failed.'), { status, code });
}

export function httpsOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A fixed HTTPS origin is required.'); }
  if (typeof value !== 'string' || url.protocol !== 'https:' || url.origin !== value ||
      url.username || url.password || url.port || !url.hostname.includes('.') ||
      url.hostname.endsWith('.') || url.hostname.includes(':') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
      url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
    throw new Error('A fixed public HTTPS origin without a port or path is required.');
  }
  return value;
}

export function fingerprint(value) {
  if (typeof value !== 'string' || !/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})$/.test(value)) {
    throw authError();
  }
  return value.replaceAll(':', '').toLowerCase();
}

export function checkedConfiguration({ publicOrigin, upstreamOrigin, secret, maxBodyBytes = DEFAULT_BODY_LIMIT }) {
  httpsOrigin(publicOrigin); httpsOrigin(upstreamOrigin);
  if (publicOrigin === upstreamOrigin) throw new Error('Gateway and upstream origins must differ.');
  const secretBytes = typeof secret === 'string' ? encoder.encode(secret) :
    secret instanceof Uint8Array ? new Uint8Array(secret) : null;
  if (!secretBytes || secretBytes.byteLength < 32) throw new Error('A dedicated gateway secret of at least 32 bytes is required.');
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > DEFAULT_BODY_LIMIT) {
    throw new Error('The body limit must be between 1 and 3000000 bytes.');
  }
  return {
    publicOrigin, upstreamOrigin, maxBodyBytes,
    key: crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
  };
}

// URL parsers normalize dot segments before exposing Request.url. Reject the
// remaining ambiguous forms, and sign exactly the path/query actually forwarded.
export function requestTarget(request, expectedOrigin, publicOrigin) {
  let url;
  try { url = new URL(request.url); } catch { throw authError(); }
  const host = request.headers.get('host');
  if (url.origin !== expectedOrigin || url.username || url.password || url.hash ||
      (host !== null && host !== url.host)) throw authError();
  const path = url.pathname;
  if (!/^\/[a-zA-Z0-9/_.~-]*$/.test(path) || path.includes('//') ||
      path.split('/').some(segment => segment === '.' || segment === '..')) throw authError(403, 'INVALID_PATH');
  // Current app needs no encoded query values. Reject encodings rather than
  // letting two layers disagree about what an encoded separator means.
  if (url.search && !/^\?[a-zA-Z0-9_.~=&-]+$/.test(url.search)) throw authError(403, 'INVALID_PATH');
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) throw authError(405, 'METHOD_REJECTED');
  const origin = request.headers.get('origin');
  if ((origin !== null && origin !== publicOrigin) ||
      (request.method === 'POST' && origin !== publicOrigin)) throw authError(403, 'ORIGIN_REJECTED');
  if (request.headers.has('range')) throw authError(416, 'RANGE_REJECTED');
  const target = `${path}${url.search}`;
  if (target.length > 2048) throw authError(414, 'TARGET_TOO_LONG');
  return target;
}

export function forwardedHeaders(request) {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      if (value.length > 16384 || /[\r\n\0]/.test(value)) throw authError();
      headers.set(name, value);
    }
  }
  return headers;
}

export async function readBoundedBody(request, maxBodyBytes) {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBodyBytes)) {
    throw authError(413, 'BODY_TOO_LARGE');
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel().catch(() => {});
        throw authError(413, 'BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  if ((request.method === 'GET' || request.method === 'HEAD') && length) throw authError();
  return body;
}

const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
export const sha256 = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
const signedHeaders = headers => JSON.stringify(FORWARDED_HEADERS.map(name => [name, headers.get(name)]));
function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decode(value) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value) || value.length % 4 === 1) throw authError();
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
  if (encode(bytes) !== value) throw authError();
  return bytes;
}

export async function issueProof({ configuration, request, body, deviceId, fingerprintSha256, issuedAt, nonce }) {
  const pathAndQuery = requestTarget(request, configuration.upstreamOrigin, configuration.publicOrigin);
  if (typeof deviceId !== 'string' || !safeId.test(deviceId) || typeof nonce !== 'string' || !noncePattern.test(nonce) || !Number.isSafeInteger(issuedAt)) throw authError();
  const claims = [1, issuedAt, nonce, deviceId, fingerprint(fingerprintSha256), configuration.publicOrigin,
    configuration.upstreamOrigin, request.method, pathAndQuery, await sha256(body), await sha256(encoder.encode(signedHeaders(forwardedHeaders(request))))];
  const payload = encoder.encode(JSON.stringify(claims));
  const signature = await crypto.subtle.sign('HMAC', await configuration.key, payload);
  return `${encode(payload)}.${hex(signature)}`;
}

/** consumeNonce must be a shared atomic insert-if-absent with expiry in ms.
 * authorizeDevice must read current device status on every verified request.
 * No in-memory fallback exists; missing/unavailable stores fail closed. */
export function createOriginVerifier({ consumeNonce, authorizeDevice, now = () => Date.now(),
  maxAgeMs = 30000, futureSkewMs = 5000, ...options } = {}) {
  const configuration = checkedConfiguration(options);
  if (typeof consumeNonce !== 'function' || typeof authorizeDevice !== 'function' || typeof now !== 'function' ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 60000 ||
      !Number.isSafeInteger(futureSkewMs) || futureSkewMs < 0 || futureSkewMs > 5000) {
    throw new Error('Shared atomic nonce storage and current device authorization are required.');
  }
  return async function verify(request) {
    const pathAndQuery = requestTarget(request, configuration.upstreamOrigin, configuration.publicOrigin);
    // Some hosts rewrite all requests to one function entry. Their adapter may
    // reconstruct Request.url from this *untrusted candidate* header, but must
    // execute only the target subsequently verified inside the signed proof.
    const originalTarget = request.headers.get(TARGET_HEADER);
    if (originalTarget !== null && originalTarget !== pathAndQuery) throw authError();
    const token = request.headers.get(PROOF_HEADER);
    if (!token || token.length > 4096 || !/^[a-zA-Z0-9_-]+\.[a-f0-9]{64}$/.test(token)) throw authError();
    const [encoded, signature] = token.split('.');
    let payload, claims;
    try { payload = decode(encoded); claims = JSON.parse(decoder.decode(payload)); } catch { throw authError(); }
    const signatureBytes = Uint8Array.from(signature.match(/../g), value => parseInt(value, 16));
    // WebCrypto's HMAC verification avoids JavaScript signature-string comparison.
    if (!await crypto.subtle.verify('HMAC', await configuration.key, signatureBytes, payload)) throw authError();
    if (!Array.isArray(claims) || claims.length !== 11) throw authError();
    const [version, issuedAt, nonce, deviceId, fingerprintSha256, publicOrigin, upstreamOrigin, method, target, bodyHash, headerHash] = claims;
    const currentProofTime = () => {
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(issuedAt) ||
          issuedAt - timestamp > futureSkewMs || timestamp - issuedAt > maxAgeMs) throw authError();
      return timestamp;
    };
    currentProofTime();
    if (version !== 1 ||
        typeof nonce !== 'string' || !noncePattern.test(nonce) || typeof deviceId !== 'string' || !safeId.test(deviceId) ||
        typeof fingerprintSha256 !== 'string' || !digestPattern.test(fingerprintSha256) ||
        publicOrigin !== configuration.publicOrigin || upstreamOrigin !== configuration.upstreamOrigin ||
        method !== request.method || target !== pathAndQuery ||
        typeof bodyHash !== 'string' || !digestPattern.test(bodyHash) ||
        typeof headerHash !== 'string' || !digestPattern.test(headerHash)) throw authError();
    const body = await readBoundedBody(request, configuration.maxBodyBytes);
    if (bodyHash !== await sha256(body) || headerHash !== await sha256(encoder.encode(signedHeaders(forwardedHeaders(request))))) throw authError();
    // A slow body must not extend a proof's lifetime. Read current device status
    // using the clock after buffering/hashing, not the request's arrival time.
    const timestamp = currentProofTime();
    try {
      if (await authorizeDevice({ deviceId, fingerprintSha256, now: timestamp }) !== true) throw authError(403, 'DEVICE_REVOKED');
      // Store latency cannot extend validity, even after a successful lookup or
      // nonce insert. An inserted nonce remains consumed if the final check fails.
      currentProofTime();
      if (await consumeNonce({ nonce, deviceId, expiresAt: issuedAt + maxAgeMs + futureSkewMs }) !== true) throw authError(403, 'PROOF_REPLAYED');
      currentProofTime();
    } catch (error) {
      if (error?.status === 403) throw error;
      throw authError(503, 'AUTH_STORE_UNAVAILABLE');
    }
    return Object.freeze({ deviceId, fingerprintSha256, body, publicOrigin, pathAndQuery, issuedAt });
  };
}
