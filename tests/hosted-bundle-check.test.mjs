import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkHostedBundle } from '../scripts/check-hosted-bundle.mjs';

async function fixture(t, files = {}) {
  const output = await mkdtemp(path.join(tmpdir(), 'yamadaya-dummy-bundle-check-'));
  t.after(() => rm(output, { force: true, recursive: true }));
  const source = { 'config.json': JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/app' }] }),
    'functions/app.func/entry.mjs': 'export default async function handler() {}\n', ...files };
  for (const [name, text] of Object.entries(source)) { const file = path.join(output, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); }
  return output;
}
const liveFiles = { 'functions/app.func/hosted/live-provider.mjs': 'export const dummy = true;\n',
  'functions/app.func/server/provider.mjs': 'export const dummy = true;\n' };

test('mock bundle reports provider absence without silently allowing future live code', async t => {
  const output = await fixture(t);
  const result = await checkHostedBundle(output);
  assert.equal(result.realProviderIncluded, false); assert.equal(result.liveProviderAllowed, false);
  assert.equal(result.entryImport, 'passed'); assert.equal(result.secretFindings, 0);
});

test('complete live provider requires an explicit allowance and reports its actual inclusion', async t => {
  const output = await fixture(t, liveFiles);
  await assert.rejects(checkHostedBundle(output), /requires --allow-live-provider/);
  const result = await checkHostedBundle(output, { allowLiveProvider: true });
  assert.equal(result.realProviderIncluded, true); assert.equal(result.liveProviderAllowed, true);
  assert.equal(result.localHarnessIncluded, false); assert.equal(result.secretFindings, 0);
  const empty = await fixture(t);
  assert.equal((await checkHostedBundle(empty, { allowLiveProvider: true })).realProviderIncluded, false);
});

test('partial or unexpected provider files are rejected even with live allowance', async t => {
  const partial = await fixture(t, { 'functions/app.func/server/provider.mjs': liveFiles['functions/app.func/server/provider.mjs'] });
  await assert.rejects(checkHostedBundle(partial, { allowLiveProvider: true }), /incomplete/);
  const unexpected = await fixture(t, { ...liveFiles, 'functions/app.func/other/provider.mjs': 'export default {};\n' });
  await assert.rejects(checkHostedBundle(unexpected, { allowLiveProvider: true }), /Unexpected provider/);
});

test('live allowance cannot include credentials, local ledger, harness or administrator SQL', async t => {
  for (const name of ['functions/app.func/.env.production', 'functions/app.func/.runtime/keys.json',
    'functions/app.func/jobs.sqlite-wal', 'functions/app.func/server/ledger.mjs',
    'functions/app.func/hosted/local-fixture.mjs', 'functions/app.func/hosted/trial-transfer.mjs',
    'functions/app.func/scripts/activate-hosted-trial.mjs', 'functions/app.func/activate.sql',
    'functions/app.func/client.key', 'functions/app.func/photos/dummy.jpg']) {
    const output = await fixture(t, { ...liveFiles, [name]: 'dummy-only' });
    await assert.rejects(checkHostedBundle(output, { allowLiveProvider: true }), /Private or administrative/);
  }
});

test('secret-like content is refused without placing the value in the failure message', async t => {
  const credential = 'sk-' + 'A'.repeat(35), output = await fixture(t, { ...liveFiles, 'functions/app.func/config.json': JSON.stringify({ credential }) });
  await assert.rejects(checkHostedBundle(output, { allowLiveProvider: true }), e => {
    assert.match(e.message, /Possible secret/); assert.ok(!e.message.includes(credential)); return true;
  });
});

test('public static bypasses, symlinks and non-handler entrypoints remain rejected', async t => {
  const publicOutput = await fixture(t, { 'static/bypass.html': '<html/>' });
  await assert.rejects(checkHostedBundle(publicOutput));
  const linked = await fixture(t); await symlink(path.join(linked, 'config.json'), path.join(linked, 'unexpected-link.json'));
  await assert.rejects(checkHostedBundle(linked), /external files/);
  const noHandler = await fixture(t, { 'functions/app.func/entry.mjs': 'export default {};\n' });
  await assert.rejects(checkHostedBundle(noHandler));
});

test('CLI accepts only explicit live allowance and an absolute inspected output path', async t => {
  const output = await fixture(t, liveFiles), script = new URL('../scripts/check-hosted-bundle.mjs', import.meta.url);
  const run = args => spawnSync(process.execPath, [fileURLToPath(script), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.notEqual(run(['--output', output]).status, 0);
  const allowed = run(['--output', output, '--allow-live-provider']); assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).realProviderIncluded, true);
  for (const args of [['--output', 'relative/path'], ['--allow-live-provider','--allow-live-provider'], ['--anything']]) assert.notEqual(run(args).status, 0);
});
