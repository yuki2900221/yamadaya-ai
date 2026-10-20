import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const providerFiles = ['functions/app.func/hosted/live-provider.mjs', 'functions/app.func/server/provider.mjs'];
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/,
  /cfast_[A-Za-z0-9_-]{20,}/, /eyJhIjoi[A-Za-z0-9_+\/=-]{40,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /proj_[A-Za-z0-9]{20,}/, /key_[A-Za-z0-9]{12,}/,
];
const textFile = /\.(?:mjs|cjs|js|json|html|css|md|txt|svg|yaml|yml|map|ts|tsx)$/i;

/** Inspect only a generated bundle. Never load .env or execute its handler. */
export async function checkHostedBundle(output = path.join(root, '.vercel/output'), { allowLiveProvider = false } = {}) {
  assert.ok(path.isAbsolute(output), 'An absolute bundle output path is required');
  assert.equal(typeof allowLiveProvider, 'boolean', 'Live provider allowance must be explicit');
  const stat = await fs.lstat(output);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Bundle output must be a regular directory');
  const config = JSON.parse(await fs.readFile(path.join(output, 'config.json'), 'utf8'));
  assert.deepEqual(config, { version: 3, routes: [{ src: '/(.*)', dest: '/app' }] });
  await assert.rejects(fs.lstat(path.join(output, 'static')), { code: 'ENOENT' });
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Bundle must not follow external files');
      if (entry.isDirectory()) await walk(full);
      else { assert.ok(entry.isFile(), 'Bundle may contain only regular files'); files.push(path.relative(output, full)); }
    }
  }
  await walk(output);
  const liveFiles = files.filter(file => providerFiles.includes(file));
  assert.ok(!liveFiles.length || allowLiveProvider, 'Live provider code requires --allow-live-provider');
  assert.ok(liveFiles.length === 0 || liveFiles.length === providerFiles.length, 'Live provider bundle is incomplete');
  for (const file of files) {
    assert.ok(!/(?:^|\/)(?:\.env[^/]*|\.runtime|\.git|results|photos|audit|diagnostics|migrations|scripts|local-fixture\.mjs|local-mock\.mjs|local-[^/]*harness[^/]*|trial-transfer\.mjs|jobs\.sqlite[^/]*|pglite)(?:\/|$)/i.test(file)
      && !/\.(?:sql|sqlite(?:-wal|-shm)?|db|pem|key|p12|pfx|crt|cer)$/i.test(file)
      && !/^functions\/app\.func\/server\/(?:index|ledger|dev)\.mjs$/.test(file), `Private or administrative file in bundle: ${file}`);
    assert.ok(!/(?:^|\/)provider\.mjs$/.test(file) || providerFiles.includes(file), `Unexpected provider file: ${file}`);
    if (textFile.test(file)) {
      const text = await fs.readFile(path.join(output, file), 'utf8');
      assert.ok(!secretPatterns.some(pattern => pattern.test(text)), `Possible secret in bundle: ${file}`);
    }
  }
  // Importing the adapter must be inert: its request handler alone configures
  // the runtime. No request, provider call or environment pull occurs here.
  const entry = await import(pathToFileURL(path.join(output, 'functions/app.func/entry.mjs')));
  assert.equal(typeof entry.default, 'function');
  return { bundleFiles: files.length, publicStaticFiles: 0, realProviderIncluded: liveFiles.length > 0,
    liveProviderAllowed: allowLiveProvider, localHarnessIncluded: false, secretFindings: 0, entryImport: 'passed' };
}

function argumentsFor(args) {
  let output = path.join(root, '.vercel/output'), allowLiveProvider = false, seenOutput = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--allow-live-provider' && !allowLiveProvider) allowLiveProvider = true;
    else if (flag === '--output' && !seenOutput) {
      output = args.shift(); seenOutput = true;
      assert.ok(typeof output === 'string' && path.isAbsolute(output), 'Use --output /absolute/bundle/path');
    } else throw Error('Use optional --output /absolute/bundle/path and --allow-live-provider');
  }
  return { output, allowLiveProvider };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = argumentsFor(process.argv.slice(2));
  const result = await checkHostedBundle(options.output, { allowLiveProvider: options.allowLiveProvider });
  console.log(JSON.stringify(result));
}
