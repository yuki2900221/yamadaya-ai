import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHostedLiveProvider, HOSTED_TRIAL_DEADLINE, HOSTED_LIVE_TARGET } from '../hosted/live-provider.mjs';
import { createConfiguredRuntime, runtimeConfiguration } from '../hosted/runtime.mjs';
import { createHostedApp } from '../hosted/app.mjs';
import { createLocalFixture } from '../hosted/local-fixture.mjs';
import { hydrateImageResult } from '../shared/image-transport.mjs';
import { error } from '../shared/contracts.mjs';

// All credentials, responses, images and ledger rows below are invented.
// No process environment, private files, remote database or paid API is read.
const environment = () => ({ HOSTED_MODE: 'live', HOSTED_PROJECT_REF: HOSTED_LIVE_TARGET.ref,
  HOSTED_PUBLIC_ORIGIN: HOSTED_LIVE_TARGET.publicOrigin, HOSTED_UPSTREAM_ORIGIN: HOSTED_LIVE_TARGET.upstreamOrigin,
  HOSTED_STORAGE_BUCKET: HOSTED_LIVE_TARGET.bucket,
  HOSTED_DATABASE_URL: `postgresql://yamadaya_trial_web:dummy-password@db.${HOSTED_LIVE_TARGET.ref}.supabase.co:5432/postgres?sslmode=verify-full`,
  HOSTED_GATEWAY_SECRET: 'g'.repeat(40), HOSTED_SESSION_SECRET: 's'.repeat(40), HOSTED_STORAGE_SERVER_KEY: 'dummy-private-storage-credential',
  HOSTED_OPENAI_TEXT_KEY: 'dummy-text-credential-for-hosted-trial', HOSTED_OPENAI_IMAGE_KEY: 'dummy-image-credential-for-hosted-trial',
  HOSTED_OPENAI_PROJECT: 'proj_dummy_hosted_trial', HOSTED_TRIAL_EXPIRES_AT: String(HOSTED_TRIAL_DEADLINE), HOSTED_ENABLE_SEARCH: 'true',
});
const usage = { input_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 100, total_tokens: 200 };
const textResponse = text => ({ model: 'gpt-6-luna', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: structuredClone(usage) });
const image = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const imageResponse = () => ({ data: [{ b64_json: image.toString('base64') }], usage: {
  input_tokens: 100, input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 100,
  output_tokens_details: { text_tokens: 0, image_tokens: 100 },
} });
const job = (feature, input = {}) => ({ id: randomUUID(), feature, input: { prompt: `ダミー商品・${randomUUID()}`, ...input } });
async function session(f) {
  const response = await f.gateway(f.request('/api/session')), value = await response.json();
  return { value, headers: { cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': value.csrf, 'content-type': 'application/json' } };
}

test('live mode binds the dedicated trial database login, schema, origins and private bucket', () => {
  const env = environment(), config = runtimeConfiguration(env);
  assert.equal(config.mode, 'live'); assert.equal(config.schema, 'yamadaya_trial');
  assert.equal(new URL(config.databaseUrl).username, 'yamadaya_trial_web');
  for (const change of [
    { HOSTED_PROJECT_REF: 'abcdefghijklmnopqrst' },
    { HOSTED_PUBLIC_ORIGIN: 'https://other.example.test' },
    { HOSTED_UPSTREAM_ORIGIN: 'https://other.vercel.app' },
    { HOSTED_STORAGE_BUCKET: 'yamadaya-mock-images' },
    { HOSTED_DATABASE_URL: env.HOSTED_DATABASE_URL.replace('yamadaya_trial_web', 'yamadaya_mock_web') },
    { HOSTED_DATABASE_URL: env.HOSTED_DATABASE_URL.replace('yamadaya_trial_web', 'postgres') },
  ]) assert.throws(() => runtimeConfiguration({ ...env, ...change }), /dedicated/);
});

test('mock runtime never reads live keys and cannot reuse the live database login', () => {
  const env = { ...environment(), HOSTED_MODE: 'mock', HOSTED_DATABASE_URL: environment().HOSTED_DATABASE_URL.replace('yamadaya_trial_web', 'yamadaya_mock_web') };
  for (const key of ['HOSTED_OPENAI_TEXT_KEY','HOSTED_OPENAI_IMAGE_KEY','HOSTED_OPENAI_PROJECT','HOSTED_TRIAL_EXPIRES_AT','HOSTED_ENABLE_SEARCH']) {
    Object.defineProperty(env, key, { get() { throw Error('Mock mode read a live configuration variable'); } });
  }
  class Pool { query() { throw Error('This configuration test must not query'); } }
  const runtime = createConfiguredRuntime(env, { Pool, fetcher() { throw Error('This configuration test must not fetch'); } });
  assert.equal(runtime.ledger.schema, 'yamadaya_mock'); assert.equal(runtime.config.mode, 'demo');
  assert.throws(() => runtimeConfiguration({ ...environment(), HOSTED_MODE: 'mock' }), /dedicated/);
});

test('missing, malformed or extended API approval fails before any provider request', async () => {
  const fixedNow = () => HOSTED_TRIAL_DEADLINE - 1000;
  for (const change of [
    { HOSTED_OPENAI_TEXT_KEY: '' }, { HOSTED_OPENAI_IMAGE_KEY: '' }, { HOSTED_OPENAI_PROJECT: '' },
    { HOSTED_OPENAI_TEXT_KEY: 'bad credential containing spaces' },
    { HOSTED_TRIAL_EXPIRES_AT: '' }, { HOSTED_TRIAL_EXPIRES_AT: String(HOSTED_TRIAL_DEADLINE + 1) },
    { HOSTED_TRIAL_EXPIRES_AT: HOSTED_TRIAL_DEADLINE },
  ]) {
    let calls = 0;
    const provider = createHostedLiveProvider({ ...environment(), ...change }, { now: fixedNow, fetcher() { calls++; throw Error('Must not send'); } });
    assert.deepEqual(provider.status(), { connected: false, imageConnected: false, searchEnabled: false, stopReason: 'NOT_CONFIGURED' });
    await assert.rejects(provider.run('chat', { prompt: 'dummy' }), e => e.code === 'NOT_CONFIGURED');
    assert.equal(calls, 0);
  }
});

test('the deadline is checked for each dispatch, including exactly at expiry', async () => {
  let current = HOSTED_TRIAL_DEADLINE - 1, calls = 0;
  const provider = createHostedLiveProvider(environment(), { now: () => current, fetcher: async () => { calls++; return new Response(JSON.stringify(textResponse('ダミー回答'))); } });
  assert.equal(provider.status().connected, true);
  provider.assertReady('chat', { prompt: 'dummy' });
  current++; // A database wait cannot extend the earlier ready check.
  await assert.rejects(provider.run('chat', { prompt: 'dummy' }), e => e.code === 'TRIAL_EXPIRED');
  assert.equal(provider.status().stopReason, 'TRIAL_EXPIRED'); assert.equal(calls, 0);
});

test('search is explicit and unknown features cannot be dispatched', async () => {
  let calls = 0;
  const provider = createHostedLiveProvider({ ...environment(), HOSTED_ENABLE_SEARCH: 'false' }, { now: () => HOSTED_TRIAL_DEADLINE - 1, fetcher() { calls++; throw Error('Must not send'); } });
  await assert.rejects(provider.run('chat', { prompt: 'dummy', search: true }), e => e.code === 'SEARCH_DISABLED');
  await assert.rejects(provider.run('admin', { prompt: 'dummy' }), e => e.code === 'FORBIDDEN');
  assert.equal(calls, 0); assert.equal(provider.status().searchEnabled, false);
  assert.throws(() => createHostedApp({ ledger: {}, verify() {}, storage: {}, sessionSecret: 's'.repeat(40), publicOrigin: 'https://trial.example.test', mode: 'live' }), /Explicit hosted provider/);
});

test('hosted live four-feature flow reserves before each fake API call, protects images and never persists text or keys', async () => {
  let f, calls = 0;
  const kinds = [];
  const provider = createHostedLiveProvider(environment(), { fetcher: async (url, init) => {
    calls++;
    const sending = (await f.db.query("SELECT state FROM yamadaya_trial.jobs WHERE state='sending'")).rows;
    assert.equal(sending.length, 1, 'one durable reservation must precede every API dispatch');
    assert.equal(init.redirect, 'error');
    if (url.endsWith('/responses')) {
      const body = JSON.parse(init.body); assert.equal(body.store, false); assert.equal(body.model, 'gpt-6-luna');
      assert.equal(init.headers['OpenAI-Project'], environment().HOSTED_OPENAI_PROJECT);
      assert.ok(!init.body.includes('dummy-text-credential'));
      if (body.text) {
        kinds.push('pop');
        return new Response(JSON.stringify(textResponse(JSON.stringify({ headline: 'ダミーりんご', copy: '', direction: '明るい配色と中央の商品写真', checks: [] }))));
      }
      const response = textResponse('日本語・空白  と改行\nダミー回答');
      if (body.tools.length) {
        kinds.push('search'); assert.equal(body.max_tool_calls, 1);
        response.output.push({ type: 'web_search_call', status: 'completed', action: { type: 'search' } });
      } else kinds.push('text');
      return new Response(JSON.stringify(response));
    }
    assert.ok(url === 'https://api.openai.com/v1/images/generations' || url === 'https://api.openai.com/v1/images/edits');
    kinds.push(url.endsWith('/edits') ? 'edit' : 'image');
    if (init.body instanceof FormData) assert.equal(init.body.get('image').type, 'image/jpeg');
    else { const body = JSON.parse(init.body); assert.equal(body.n, 1); assert.equal(body.model, 'gpt-image-2.5-flare-2026-09-08'); }
    return new Response(JSON.stringify(imageResponse()));
  } });
  f = await createLocalFixture({ mode: 'live', provider, beforeDispatch: provider.assertReady });
  try {
    const s = await session(f);
    assert.equal(s.value.mode, 'live'); assert.equal(s.value.connected, true); assert.equal(s.value.imageConnected, true);
    assert.equal(s.value.searchEnabled, true); assert.equal(s.value.spendingPaused, false); assert.equal(s.value.budgetRemainingUsd, 9.55);
    const jobs = [job('chat'), job('writing', { purpose: 'お知らせ' }), job('pop', { prompt: 'ダミーりんご\n198円（税込）', paper: 'a4l' }),
      job('image', { action: 'pop', confirmed: true, paper: 'a4l' }),
      job('image', { action: 'edit', reference: 'data:image/jpeg;base64,/9j/2Q==', confirmed: true }), job('chat', { search: true })];
    for (const [i, value] of jobs.entries()) {
      const response = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: s.headers, body: value })), result = await response.json();
      assert.equal(response.status, 200, JSON.stringify({ index: i, feature: value.feature, result })); assert.equal(result.state, 'succeeded');
      assert.equal(result.billing, 'usage計算・請求未照合');
      if (value.feature === 'pop') { assert.equal(result.result.demo, false); assert.equal(result.result.paper, 'a4l'); assert.equal(result.result.copy, ''); }
      if (value.feature === 'image') {
        assert.equal(result.result.demo, false); assert.equal(result.result.imageManifest.mime, 'image/png');
        const hydrated = await hydrateImageResult(result.result, { fetcher: route => f.gateway(f.request(route, { headers: { cookie: s.headers.cookie } })) });
        assert.deepEqual(Buffer.from(hydrated.image.split(',')[1], 'base64'), image);
      }
      assert.equal(calls, i + 1);
    }
    assert.deepEqual(kinds, ['text','text','pop','image','edit','search']);
    const duplicate = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: s.headers, body: jobs[0] }));
    assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).resultUnavailable, true); assert.equal(calls, 6);
    const records = JSON.stringify((await f.db.query('SELECT * FROM yamadaya_trial.jobs')).rows);
    for (const forbidden of [jobs[0].input.prompt, 'ダミー回答', 'dummy-text-credential', 'dummy-image-credential', '/9j/2Q==']) assert.ok(!records.includes(forbidden));
    const stored = (await f.db.query('SELECT value FROM yamadaya_trial.results')).rows;
    assert.equal(stored.length, 2); assert.ok(stored.every(row => row.value.demo === false && !row.value.image));
    const settled = await f.ledger.usage();
    assert.equal(settled.uncertain, 3);
    assert.equal(settled.reserved, 450000 + settled.calculated, 'completed fake API usage replaces successful holds; original unknown holds remain');
    const refreshedSession = await f.gateway(f.request('/api/session', { headers: { cookie: s.headers.cookie } }));
    assert.equal((await refreshedSession.json()).budgetRemainingUsd, (10000000 - settled.reserved) / 1000000);
    assert.equal((await f.gateway(f.request('/api/end', { method: 'POST', headers: s.headers }))).status, 200);
    assert.equal(f.objects.size, 0);
  } finally { await f.close(); }
});

test('unconfigured hosted live requests create no reservation and no fake API call', async () => {
  let calls = 0;
  const provider = createHostedLiveProvider({ ...environment(), HOSTED_OPENAI_IMAGE_KEY: '' }, { fetcher() { calls++; throw Error('Must not send'); } });
  const f = await createLocalFixture({ mode: 'live', provider, beforeDispatch: provider.assertReady });
  try {
    const s = await session(f), before = await f.ledger.usage();
    assert.equal(s.value.spendingPaused, true); assert.equal(s.value.stopReason, 'NOT_CONFIGURED');
    const response = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: s.headers, body: job('chat') }));
    assert.equal(response.status, 503); assert.equal((await response.json()).notDispatched, true);
    assert.deepEqual(await f.ledger.usage(), before); assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('unknown API cost preserves all original holds, stops both devices and never retries', async () => {
  let calls = 0;
  const provider = createHostedLiveProvider(environment(), { fetcher: async () => {
    calls++; const response = textResponse('ダミー回答'); response.usage.input_tokens_details.unknown_meter = 1;
    return new Response(JSON.stringify(response));
  } });
  const f = await createLocalFixture({ mode: 'live', provider, beforeDispatch: provider.assertReady });
  try {
    const s = await session(f), original = await f.ledger.usage();
    const failed = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: s.headers, body: job('chat') }));
    assert.equal(failed.status, 409); assert.equal((await failed.json()).code, 'COST_UNCERTAIN');
    const after = await f.ledger.usage(); assert.equal(after.reserved, original.reserved + 15000); assert.equal(after.uncertain, 4); assert.equal(after.paused, true);
    const windows = await f.gateway(f.request('/api/session', { device: 1 })), windowsValue = await windows.json();
    const denied = await f.gateway(f.request('/api/jobs', { device: 1, method: 'POST', headers: { cookie: windows.headers.get('set-cookie').split(';')[0], 'x-csrf-token': windowsValue.csrf, 'content-type': 'application/json' }, body: job('writing') }));
    assert.equal(denied.status, 409); assert.equal((await denied.json()).notDispatched, true); assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('a measured cost exceeding its hold remains unknown and is counted at its full amount', async () => {
  const provider = { status: () => ({ connected: true, imageConnected: true, searchEnabled: false }), run: async () => ({ result: { text: 'ダミー' }, cost: .025 }) };
  const f = await createLocalFixture({ mode: 'live', provider, beforeDispatch() {} });
  try {
    const s = await session(f), value = job('chat');
    const response = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: s.headers, body: value }));
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'COST_UNCERTAIN');
    const row = (await f.db.query('SELECT state,hold,cost FROM yamadaya_trial.jobs WHERE id=$1', [value.id])).rows[0];
    assert.deepEqual(row, { state: 'unknown', hold: 15000, cost: 25000 });
    assert.equal((await f.ledger.usage()).reserved, 475000); assert.equal((await f.ledger.usage()).paused, true);
  } finally { await f.close(); }
});

test('an asynchronous pre-dispatch refusal cannot create a paid reservation', async () => {
  let calls = 0;
  const provider = { status: () => ({ connected: true, imageConnected: true }), async run() { calls++; throw Error('Must not send'); } };
  const f = await createLocalFixture({ mode: 'live', provider, async beforeDispatch() {
    await Promise.resolve(); throw error(503, '準備中', 'NOT_CONFIGURED');
  } });
  try {
    const s = await session(f), before = await f.ledger.usage();
    const response = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: s.headers, body: job('chat') }));
    assert.equal(response.status, 503); assert.equal((await response.json()).notDispatched, true);
    assert.equal(calls, 0); assert.deepEqual(await f.ledger.usage(), before);
  } finally { await f.close(); }
});

test('live mode never publishes an injected SVG mock result as a real generated image', async () => {
  const provider = { status: () => ({ connected: true, imageConnected: true }), async run() {
    return { result: { image: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`, paper: 'a4p' }, cost: .001 };
  } };
  const f = await createLocalFixture({ mode: 'live', provider, beforeDispatch() {} });
  try {
    const s = await session(f), value = job('image', { confirmed: true });
    const response = await f.gateway(f.request('/api/jobs', { method: 'POST', headers: s.headers, body: value }));
    assert.equal(response.status, 502); assert.equal((await response.json()).code, 'INVALID_IMAGE'); assert.equal(f.objects.size, 0);
    const row = (await f.db.query('SELECT state,cost FROM yamadaya_trial.jobs WHERE id=$1', [value.id])).rows[0];
    assert.deepEqual(row, { state: 'unknown', cost: 1000 }); assert.equal((await f.ledger.usage()).paused, true);
  } finally { await f.close(); }
});
