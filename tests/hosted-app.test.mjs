import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalFixture } from '../hosted/local-fixture.mjs';
import { hydrateImageResult } from '../shared/image-transport.mjs';
import { cleanupImages } from '../hosted/maintenance.mjs';
import { createDemoProvider } from '../server/demo.mjs';
import { IMAGE_CHUNK_BYTES } from '../hosted/images.mjs';

let fixture, calls = 0, cookie, csrf;
let blocker, started;
const image = Buffer.alloc(IMAGE_CHUNK_BYTES * 2 + 31, 4); Buffer.from([137,80,78,71,13,10,26,10]).copy(image);
const body = (feature, input = {}) => ({ id: randomUUID(), feature, input: { prompt: `ダミー商品・${randomUUID()}`, ...input } });
const headers = () => ({ cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' });
const send = (route, options) => fixture.gateway(fixture.request(route, options));
before(async () => {
  const demo = createDemoProvider();
  fixture = await createLocalFixture({ mockProvider: { async run(feature, input) {
    calls++; if (blocker) { started?.(); await blocker; }
    if (input.prompt === 'dummy-failure') throw Error('private provider diagnostic');
    if (feature === 'image') return { result: { image: `data:image/png;base64,${image.toString('base64')}`, paper: input.paper || 'a4p' }, cost: 0 };
    return demo.run(feature, input);
  } } });
  const response = await send('/api/session'); csrf = (await response.json()).csrf; cookie = response.headers.get('set-cookie').split(';')[0];
});
after(async () => fixture?.close());

test('hosted session is device-bound and survives a fresh server instance', async () => {
  fixture.restart();
  const response = await send('/api/session', { headers: { cookie } });
  assert.equal(response.status, 200); assert.equal((await response.json()).csrf, csrf);
  const other = await send('/api/session', { headers: { cookie }, device: 1 });
  assert.notEqual((await other.json()).csrf, csrf);
  const u = await fixture.ledger.usage(); assert.equal(u.reserved, 450000); assert.equal(u.paused, false);
});

test('direct origin, unregistered device, admin routes and CSRF spoofing fail before provider', async () => {
  for (const route of ['/', '/assets/index.js', '/api/session', '/api/jobs', '/api/images/00000000-0000-4000-8000-000000000001/0']) {
    assert.equal((await fixture.handle(new Request(`${fixture.upstreamOrigin}${route}`))).status, 403);
    assert.equal((await send(route, { registered: false })).status, 403);
  }
  assert.equal((await send('/api/admin', { headers: { cookie } })).status, 403);
  assert.equal((await send('/api/jobs', { method: 'POST', headers: { ...headers(), 'x-csrf-token': 'é'.repeat(64) }, body: body('chat') })).status, 403);
  assert.equal(calls, 0);
});

test('text is returned once without storing prompts or output in the shared database', async () => {
  const job = body('chat');
  const response = await send('/api/jobs', { method: 'POST', headers: headers(), body: job });
  assert.equal(response.status, 200); assert.match((await response.json()).result.text, /操作見本/);
  fixture.restart();
  const duplicate = await send('/api/jobs', { method: 'POST', headers: headers(), body: job });
  const recovered = await duplicate.json(); assert.equal(recovered.resultUnavailable, true); assert.equal(calls, 1);
  assert.equal((await fixture.db.query('SELECT count(*) FROM yamadaya_trial.results')).rows[0].count, 0);
  const rows = JSON.stringify((await fixture.db.query('SELECT * FROM yamadaya_trial.jobs')).rows);
  assert.ok(!rows.includes(job.input.prompt));
});

test('large images use small protected chunks and reassemble to identical bytes', async () => {
  const job = body('image', { confirmed: true, paper: 'a4l' });
  const response = await send('/api/jobs', { method: 'POST', headers: headers(), body: job });
  const raw = await response.text(); assert.ok(raw.length < 2000);
  assert.equal(response.status, 200, raw);
  const result = JSON.parse(raw).result;
  fixture.restart();
  const recovered = await (await send(`/api/jobs/${job.id}`, { headers: { cookie } })).json();
  const hydrated = await hydrateImageResult(recovered.result, { fetcher: route => send(route, { headers: { cookie } }) });
  assert.deepEqual(Buffer.from(hydrated.image.split(',')[1], 'base64'), image);
  assert.equal(result.imageManifest.chunks, 3);
  const wrong = await send(`${result.imageManifest.path}0`, { headers: { cookie }, device: 1 });
  assert.equal(wrong.status, 401);
});

test('same image operation is not executed twice while the first request is running', async () => {
  let release, notify; blocker = new Promise(resolve => release = resolve); const ready = new Promise(resolve => notify = resolve); started = notify;
  const job = body('image', { confirmed: true });
  const initial = send('/api/jobs', { method: 'POST', headers: headers(), body: job }); await ready;
  const duplicate = await send('/api/jobs', { method: 'POST', headers: headers(), body: job });
  assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).state, 'sending');
  release(); blocker = null; started = null; assert.equal((await initial).status, 200);
  assert.equal(calls, 3);
});

test('ending a session deletes private images and denies their old links', async () => {
  const response = await send('/api/end', { method: 'POST', headers: headers() });
  assert.equal(response.status, 200); assert.equal(fixture.objects.size, 0);
  assert.equal((await send('/api/jobs/00000000-0000-4000-8000-000000000001', { headers: { cookie } })).status, 401);
  await cleanupImages(fixture.ledger, fixture.storage);
});

test('a new unknown operation conserves all old holds and stops new requests', async () => {
  const response = await send('/api/session'); cookie = response.headers.get('set-cookie').split(';')[0]; csrf = (await response.json()).csrf;
  const fail = body('chat', { prompt: 'dummy-failure' });
  const before = (await fixture.ledger.usage()).reserved;
  const failed = await send('/api/jobs', { method: 'POST', headers: headers(), body: fail });
  assert.equal(failed.status, 503); assert.equal((await failed.json()).notDispatched, false);
  const u = await fixture.ledger.usage(); assert.equal(u.reserved, before + 15000); assert.equal(u.uncertain, 4); assert.equal(u.paused, true);
  const blocked = await send('/api/jobs', { method: 'POST', headers: headers(), body: body('chat') });
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).notDispatched, true); assert.equal(calls, 4);
});

test('client refuses external manifests and corrupted image chunks', async () => {
  const sha = createHash('sha256').update(Buffer.from([1])).digest('hex');
  const m = { path: `/api/images/${randomUUID()}/`, mime: 'image/png', size: 1, chunks: 1, sha256: sha };
  await assert.rejects(hydrateImageResult({ imageManifest: { ...m, path: 'https://outside.example/image' } }));
  await assert.rejects(hydrateImageResult({ imageManifest: m }, { fetcher: async () => new Response(Uint8Array.from([2])) }), /一致/);
});

test('ending a session during a slow image read prevents returning its bytes', async () => {
  const f = await createLocalFixture({ mockProvider: { async run() { return { result: { image: `data:image/png;base64,${image.toString('base64')}`, paper: 'a4p' }, cost: 0 }; } } });
  try {
    const initial = await f.gateway(f.request('/api/session')), data = await initial.json();
    const h = { cookie: initial.headers.get('set-cookie').split(';')[0], 'x-csrf-token': data.csrf, 'content-type': 'application/json' };
    const made = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: h, body: body('image', { confirmed: true }) }));
    const m = (await made.json()).result.imageManifest;
    let release, notify; const gate = new Promise(r => release = r), reading = new Promise(r => notify = r);
    const original = f.storage.get;
    f.storage.get = async key => { const bytes = await original(key); notify(); await gate; return bytes; };
    const read = f.gateway(f.request(`${m.path}0`, { headers: { cookie: h.cookie } })); await reading;
    assert.equal((await f.gateway(f.request('/api/end', { method: 'POST', headers: h }))).status, 200);
    release(); const response = await read; assert.equal(response.status, 401);
    assert.doesNotMatch(response.headers.get('content-type'), /octet-stream/);
  } finally { await f.close(); }
});

test('a failed ledger completion and failed immediate deletion are recovered by independent inventory', async () => {
  const f = await createLocalFixture({ mockProvider: { async run() { return { result: { image: `data:image/png;base64,${image.toString('base64')}`, paper: 'a4p' }, cost: 0 }; } } });
  try {
    const initial = await f.gateway(f.request('/api/session')), data = await initial.json();
    const h = { cookie: initial.headers.get('set-cookie').split(';')[0], 'x-csrf-token': data.csrf, 'content-type': 'application/json' };
    const query = f.db.query.bind(f.db), remove = f.storage.remove;
    f.db.query = async (sql, args) => {
      if (args?.[0] === 'finish' && JSON.parse(args[1]).state === 'succeeded') throw Error('dummy database transport failure');
      return query(sql, args);
    };
    f.storage.remove = async () => { throw Error('dummy storage deletion failure'); };
    const response = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: h, body: body('image', { confirmed: true }) }));
    assert.equal(response.status, 503); assert.equal(f.objects.size, 1);
    assert.equal((await f.db.query('SELECT count(*) FROM yamadaya_trial.results')).rows[0].count, 0);
    f.storage.remove = remove;
    // Simulate the storage server listing this orphan after the 15-minute TTL.
    f.storage.listExpiredKeys = async () => [...f.objects.keys()];
    assert.equal((await cleanupImages(f.ledger, f.storage)).deleted, 1);
    assert.equal(f.objects.size, 0); assert.equal((await f.ledger.usage()).uncertain, 4);
  } finally { await f.close(); }
});
