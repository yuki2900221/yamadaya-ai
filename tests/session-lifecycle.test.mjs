import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLifecycle, END_PENDING_KEY, PENDING_JOB_KEY, pauseMessage } from '../src/session-lifecycle.js';
import * as api from '../src/api.js';

function storageFixture() {
  const values = new Map([[PENDING_JOB_KEY, '00000000-0000-4000-8000-000000000001']]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('a rejected close immediately invalidates old work and retains only closure flag and operation ID', async () => {
  const storage = storageFixture(); let calls = 0;
  const life = createSessionLifecycle({ storage, session: async () => { throw Error('unexpected session'); }, end: async () => { calls++; throw Object.assign(Error('revoked'), { status: 403 }); } });
  const old = life.capture();
  life.beginEnd();
  assert.equal(life.canPublish(old), false);
  assert.equal(life.canPublish(life.capture()), false);
  await assert.rejects(life.confirmEnd('existing-csrf'), { status: 403 });
  await Promise.resolve();
  assert.equal(calls, 1); // No retry loop.
  assert.equal(life.isEnding(), true);
  assert.deepEqual([...storage.values], [[PENDING_JOB_KEY, '00000000-0000-4000-8000-000000000001'], [END_PENDING_KEY, '1']]);
});

for (const name of ['QuotaExceededError', 'SecurityError']) {
  test(`${name} while saving the closure flag still permits immediate clearing and retains the operation ID until confirmed`, async () => {
    const storage = storageFixture(), confirmed = deferred(); let calls = 0;
    storage.setItem = () => { throw Object.assign(Error('storage unavailable'), { name }); };
    const life = createSessionLifecycle({ storage, session: async () => { throw Error('unexpected session'); }, end: async () => {
      if (++calls === 1) throw Error('response lost');
      await confirmed.promise;
    } });
    const old = life.capture(); let localContent = ['draft', 'conversation', 'image'];
    const persisted = life.beginEnd();
    localContent = []; // Same synchronous sequence as closeLocally in the UI.
    assert.equal(persisted, false);
    assert.deepEqual(localContent, []);
    assert.equal(life.isEnding(), true);
    assert.equal(life.canPublish(old), false);
    assert.equal(life.canPublish(life.capture()), false);
    await assert.rejects(life.confirmEnd('existing-csrf'), /response lost/);
    await Promise.resolve();
    assert.equal(calls, 1); // Failure never resends a job or loops the close request.
    assert.equal(life.isEnding(), true);
    assert.deepEqual([...storage.values], [[PENDING_JOB_KEY, '00000000-0000-4000-8000-000000000001']]);
    const retry = life.confirmEnd('existing-csrf');
    assert.ok(storage.getItem(PENDING_JOB_KEY));
    confirmed.resolve(); await retry;
    assert.equal(calls, 2);
    assert.equal(storage.values.size, 0);
    assert.equal(life.isEnding(), false);
    assert.equal(life.canPublish(old), false);
  });
}

test('late result and session refresh cannot republish after a successful end and fresh flow', async () => {
  const storage = storageFixture(), result = deferred(), refresh = deferred();
  const life = createSessionLifecycle({ storage, session: async () => ({ csrf: 'unused' }), end: async () => {} });
  const ticket = life.capture(), published = [];
  const watchers = [result, refresh].map(d => d.promise.then(value => { if (life.canPublish(ticket)) published.push(value); }));
  life.beginEnd(); await life.confirmEnd('old-csrf');
  result.resolve('old generated image'); refresh.resolve({ csrf: 'old-csrf' }); await Promise.all(watchers);
  assert.deepEqual(published, []);
  assert.equal(life.canPublish(life.capture()), true);
  assert.equal(storage.getItem(END_PENDING_KEY), null);
  assert.equal(storage.getItem(PENDING_JOB_KEY), null);
});

test('reload closes the cookie session before a new flow and preserves the ID until confirmation', async () => {
  const storage = storageFixture(), ending = deferred(), events = [];
  storage.setItem(END_PENDING_KEY, '1');
  const life = createSessionLifecycle({ storage, session: async () => { events.push('session'); return { csrf: 'cookie-csrf' }; }, end: async token => { events.push(['end', token]); await ending.promise; } });
  assert.equal(life.canPublish(life.capture()), false);
  const closing = life.confirmEnd(); await Promise.resolve();
  assert.deepEqual(events, ['session', ['end', 'cookie-csrf']]);
  assert.ok(storage.getItem(PENDING_JOB_KEY));
  ending.resolve(); await closing;
  assert.equal(life.isEnding(), false);
  assert.equal(storage.values.size, 0);
});

test('lost end response stays locked until a deliberate retry; overlapping retries make one request', async () => {
  const storage = storageFixture(), retry = deferred(); let calls = 0, sessions = 0;
  const life = createSessionLifecycle({ storage, session: async () => { sessions++; return { csrf: 'retry-csrf' }; }, end: async () => { if (++calls === 1) throw Error('response lost'); await retry.promise; } });
  life.beginEnd(); await assert.rejects(life.confirmEnd('old-csrf'));
  assert.equal(life.isEnding(), true); assert.ok(storage.getItem(PENDING_JOB_KEY));
  const first = life.confirmEnd(), second = life.confirmEnd();
  assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 2); assert.equal(sessions, 1);
  retry.resolve(); await first;
  assert.equal(life.isEnding(), false);
});

test('failed authentication on reload never attempts result recovery or starts a new flow', async () => {
  const storage = storageFixture(); storage.setItem(END_PENDING_KEY, '1'); let ends = 0, sessions = 0;
  const life = createSessionLifecycle({ storage, session: async () => { sessions++; throw Object.assign(Error('revoked'), { code: 'DEVICE_REVOKED' }); }, end: async () => { ends++; } });
  await assert.rejects(life.confirmEnd(), { code: 'DEVICE_REVOKED' });
  assert.equal(sessions, 1); assert.equal(ends, 0); assert.equal(life.canPublish(life.capture()), false); assert.ok(storage.getItem(PENDING_JOB_KEY));
});

test('pause copy distinguishes setup, expiry, confirmed cost uncertainty and unspecified pauses', () => {
  assert.match(pauseMessage({ spendingPaused: true, stopReason: 'NOT_IMPORTED' }), /接続準備中/);
  assert.match(pauseMessage({ spendingPaused: false, stopReason: 'TRIAL_EXPIRED' }), /許可期限/);
  assert.match(pauseMessage({ spendingPaused: true, stopReason: 'COST_UNCERTAIN' }), /費用が未確定/);
  for (const reason of [undefined, 'PAUSED', 'future-code']) assert.doesNotMatch(pauseMessage({ spendingPaused: true, stopReason: reason }), /費用が未確定/);
  assert.equal(pauseMessage({ spendingPaused: false, stopReason: null, uncertain: 3 }), '');
});

test('session errors retain status, code and definite non-dispatch without exposing response objects', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: '端末は停止中です', code: 'DEVICE_REVOKED', notDispatched: true }), { status: 403 }));
  await assert.rejects(api.session(), e => e.status === 403 && e.code === 'DEVICE_REVOKED' && e.notDispatched === true && e.message === '端末は停止中です');
});

test('non-JSON gateway denial retains the HTTP status needed to clear local sensitive content', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>denied</html>', { status: 403 }));
  await assert.rejects(api.session(), e => e.status === 403 && e.notDispatched === false);
  await assert.rejects(api.end('dummy'), e => e.status === 403 && e.notDispatched === false);
});

test('HTTP success without an explicit ended acknowledgement cannot release the closure lock', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
  const storage = storageFixture();
  const life = createSessionLifecycle({ storage, session: api.session, end: api.end });
  life.beginEnd();
  await assert.rejects(life.confirmEnd('dummy'), { code: 'END_UNCONFIRMED' });
  assert.equal(life.isEnding(), true); assert.ok(storage.getItem(PENDING_JOB_KEY));
});
