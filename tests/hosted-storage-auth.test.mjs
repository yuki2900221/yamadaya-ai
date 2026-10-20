import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPrivateStorage } from '../hosted/images.mjs';

const baseUrl = 'https://abcdefghijklmnopqrst.supabase.co';

for (const kind of ['opaque', 'legacy']) {
  test(`private Storage ${kind} credentials authenticate upload/read/delete/inventory without JWT confusion`, async () => {
    // Invented credentials only; the legacy shape is deliberately not a valid JWT.
    const serverKey = kind === 'opaque' ? 'sb_secret_dummy-only-storage-auth-test' : 'eyJ-dummy-header.legacy-dummy-payload.dummy-signature';
    const key = `${randomUUID()}.bin`, bytes = Buffer.from('dummy image'), requests = [];
    const store = createPrivateStorage({ baseUrl, bucket: 'trial-private', serverKey, fetcher: async (url, options) => {
      requests.push({ url, options });
      const headers = new Headers(options.headers);
      assert.equal(headers.get('apikey'), serverKey);
      // Emulate a gateway rejecting a non-JWT secret supplied as a Bearer token.
      assert.equal(headers.get('authorization'), kind === 'opaque' ? null : `Bearer ${serverKey}`);
      assert.equal(options.redirect, 'error');
      assert.equal(new URL(url).origin, baseUrl);
      assert.ok(!url.includes(serverKey));
      if (url.endsWith('/object/list/trial-private')) return Response.json([]);
      return options.method === 'GET' ? new Response(bytes) : Response.json({});
    } });

    await store.put(key, bytes, 'image/png');
    assert.deepEqual(await store.get(key), bytes);
    await store.remove(key);
    assert.deepEqual(await store.listExpiredKeys(), []);
    assert.deepEqual(requests.map(({ url, options }) => [options.method, new URL(url).pathname]), [
      ['POST', `/storage/v1/object/trial-private/${key}`],
      ['GET', `/storage/v1/object/trial-private/${key}`],
      ['DELETE', '/storage/v1/object/trial-private'],
      ['POST', '/storage/v1/object/list/trial-private'],
    ]);
    assert.equal(new Headers(requests[0].options.headers).get('content-type'), 'image/png');
    assert.equal(new Headers(requests[0].options.headers).get('x-upsert'), 'false');
    assert.deepEqual(JSON.parse(requests[2].options.body), { prefixes: [key] });
  });
}
