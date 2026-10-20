import { createGateway } from './gateway.mjs';

// Prepared locally only. workers.dev and preview URLs must be disabled on any
// later deployment, and mTLS/WAF must cover the entire selected subdomain.
export default {
  async fetch(request, env) {
    try {
      if (env.HOSTED_MODE !== 'mock') throw Error('Mock stage required');
      const handle = createGateway({ publicOrigin: env.HOSTED_PUBLIC_ORIGIN, upstreamOrigin: env.HOSTED_UPSTREAM_ORIGIN,
        secret: env.HOSTED_GATEWAY_SECRET, approvedDevices: JSON.parse(env.HOSTED_APPROVED_DEVICES) });
      return await handle(request);
    } catch {
      return Response.json({ error: '接続準備中です。', code: 'GATEWAY_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    }
  },
};
