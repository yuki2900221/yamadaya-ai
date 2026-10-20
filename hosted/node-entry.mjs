import { createConfiguredRuntime } from './runtime.mjs';
import { TARGET_HEADER } from './origin-auth.mjs';

/** A tiny Node/Vercel adapter. It exposes no fallback static server. */
export function nodeHandler({ handle, upstreamOrigin }) {
  const expected = new URL(upstreamOrigin);
  return async (req, res) => {
    try {
      if (req.headers.host !== expected.host) throw Error('Host mismatch');
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) throw Error('Duplicate header');
        if (value !== undefined) headers.set(name, value);
      }
      // A rewrite may change req.url. This is an untrusted routing candidate,
      // authenticated against the HMAC's target by handle(), before any route.
      const target = headers.get(TARGET_HEADER) || req.url;
      if (typeof target !== 'string' || target.length > 2048 || !target.startsWith('/') || target.startsWith('//') || /[\\\r\n#]/.test(target)) throw Error('Invalid target');
      const request = new Request(`${upstreamOrigin}${target}`, { method: req.method, headers,
        ...(!['GET','HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}) });
      const response = await handle(request);
      res.statusCode = response.status;
      for (const [name, value] of response.headers) res.setHeader(name, value);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch {
      res.statusCode = 503; res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '接続準備中です。自動で再送しません。', code: 'HOSTED_UNAVAILABLE', notDispatched: false }));
    }
  };
}

let runtime, handler;
export default async function entry(req, res) {
  // Unconfigured deployments fail closed; real AI is not loaded in this stage.
  if (!handler) {
    try { runtime = createConfiguredRuntime(process.env); handler = nodeHandler({ handle: runtime.handle, upstreamOrigin: runtime.config.upstreamOrigin }); }
    catch { res.statusCode = 503; res.setHeader('Cache-Control', 'private, no-store'); res.end('接続準備中です。'); return; }
  }
  return handler(req, res);
}
