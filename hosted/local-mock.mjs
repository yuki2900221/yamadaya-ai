// Explicit synthetic device transport for browser UX testing on THIS Mac only.
// It is not a certificate/WARP test and must never be deployed or LAN-bound.
import http from 'node:http';
import { createLocalFixture } from './local-fixture.mjs';
import { cleanupImages } from './maintenance.mjs';
const port = Number(process.env.HOSTED_MOCK_PORT || 4182);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local mock port');
const fixture = await createLocalFixture();
const localOrigin = `http://127.0.0.1:${port}`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}` || !['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)) throw Error('Loopback only');
    if (req.headers.origin && req.headers.origin !== localOrigin) throw Error('Origin mismatch');
    const headers = new Headers();
    for (const name of ['accept','accept-language','content-type','cookie','x-csrf-token']) if (req.headers[name]) headers.set(name, req.headers[name]);
    if (req.headers.origin) headers.set('origin', fixture.publicOrigin);
    const request = new Request(`${fixture.publicOrigin}${req.url}`, { method: req.method, headers,
      ...(!['GET','HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}) });
    Object.defineProperty(request, 'cf', { value: { tlsClientAuth: { certPresented: '1', certVerified: 'SUCCESS', certRevoked: '0', certFingerprintSHA256: fixture.devices[0].fingerprintSha256 } } });
    const response = await fixture.gateway(request);
    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name, value);
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch { res.statusCode = 503; res.end('ローカルモックの接続を確認してください。'); }
});
const cleanup = setInterval(() => void cleanupImages(fixture.ledger, fixture.storage).catch(() => {}), 30000); cleanup.unref();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
console.log(`Hosted preparation MOCK only: ${localOrigin} (synthetic device, in-memory dummy DB, no real AI)`);
const shutdown = async () => { clearInterval(cleanup); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fixture.close(); process.exit(0); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
