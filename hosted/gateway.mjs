// Cloudflare Worker handler prepared locally. It trusts only Cloudflare runtime
// mTLS metadata; ordinary HTTP headers never establish device identity.
import {
  PROOF_HEADER, TARGET_HEADER, checkedConfiguration, fingerprint, requestTarget, forwardedHeaders,
  readBoundedBody, issueProof, authError,
} from './origin-auth.mjs';

function failure(status, code) {
  return Response.json({ error: '接続を確認できませんでした。自動では再送しません。', code }, {
    status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export function createGateway({ approvedDevices, fetchImpl = globalThis.fetch, now = () => Date.now(),
  timeoutMs = 180000, ...options } = {}) {
  const configuration = checkedConfiguration(options);
  if (!Array.isArray(approvedDevices) || approvedDevices.length < 1 || approvedDevices.length > 3 || typeof fetchImpl !== 'function' ||
      typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 240000) {
    throw new Error('One to three approved devices and bounded upstream transport are required.');
  }
  const devices = new Map(), ids = new Set();
  for (const device of approvedDevices) {
    if (!device || !/^[a-zA-Z0-9_-]{1,80}$/.test(device.id)) throw new Error('Invalid device configuration.');
    const digest = fingerprint(device.fingerprintSha256);
    if (devices.has(digest) || ids.has(device.id)) throw new Error('Device entries must be unique.');
    devices.set(digest, device.id); ids.add(device.id);
  }
  return async function handle(request) {
    try {
      const pathAndQuery = requestTarget(request, configuration.publicOrigin, configuration.publicOrigin);
      const tls = request.cf?.tlsClientAuth;
      if (!tls || tls.certPresented !== '1' || tls.certVerified !== 'SUCCESS' || tls.certRevoked !== '0') throw authError();
      const fingerprintSha256 = fingerprint(tls.certFingerprintSHA256);
      const deviceId = devices.get(fingerprintSha256);
      if (!deviceId) throw authError(403, 'DEVICE_NOT_APPROVED');
      const body = await readBoundedBody(request, configuration.maxBodyBytes);
      const headers = forwardedHeaders(request);
      // Building a fresh header set strips any client proof, forwarding headers,
      // Access token, mTLS claims, and arbitrary client identity headers.
      const upstream = new Request(`${configuration.upstreamOrigin}${pathAndQuery}`, {
        method: request.method, headers, redirect: 'manual',
        ...(request.method === 'POST' ? { body } : {}),
      });
      upstream.headers.set(TARGET_HEADER, pathAndQuery);
      const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      upstream.headers.set(PROOF_HEADER, await issueProof({ configuration, request: upstream, body,
        deviceId, fingerprintSha256, issuedAt: now(), nonce }));
      const controller = new AbortController(); let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(authError(504, 'UPSTREAM_UNCERTAIN')); }, timeoutMs);
        });
        // Never retry. A timeout/502 does not establish that an AI call was absent.
        const response = await Promise.race([fetchImpl(upstream, { signal: controller.signal, redirect: 'manual', cache: 'no-store' }), timeout]);
        if (response.status >= 300 && response.status < 400) throw authError(502, 'UPSTREAM_REDIRECT_REJECTED');
        const responseHeaders = new Headers(response.headers);
        for (const name of [...responseHeaders.keys()]) {
          if (name.startsWith('x-yamadaya-') || ['connection', 'keep-alive', 'transfer-encoding', 'proxy-authenticate', 'proxy-authorization'].includes(name)) responseHeaders.delete(name);
        }
        responseHeaders.set('Cache-Control', 'private, no-store');
        responseHeaders.set('CDN-Cache-Control', 'no-store');
        responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store');
        responseHeaders.set('X-Content-Type-Options', 'nosniff');
        return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
      } catch (error) {
        throw error?.status ? error : authError(502, 'UPSTREAM_UNCERTAIN');
      } finally { clearTimeout(timer); }
    } catch (error) {
      return failure(error?.status || 503, error?.code || 'GATEWAY_UNAVAILABLE');
    }
  };
}
