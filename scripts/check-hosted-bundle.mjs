import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, '.vercel/output');
const config = JSON.parse(await fs.readFile(path.join(output, 'config.json'), 'utf8'));
assert.deepEqual(config, { version: 3, routes: [{ src: '/(.*)', dest: '/app' }] });
await assert.rejects(fs.stat(path.join(output, 'static')), { code: 'ENOENT' });
const files = [];
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Bundle must not follow external files');
    if (entry.isDirectory()) await walk(full); else files.push(path.relative(output, full));
  }
}
await walk(output);
assert.ok(!files.some(file => /(?:^|\/)(?:\.env[^/]*|\.runtime|results|photos|migrations|local-fixture\.mjs|local-mock\.mjs|provider\.mjs|jobs\.sqlite[^/]*|pglite)(?:\/|$)/i.test(file)));
const entry = await import(pathToFileURL(path.join(output, 'functions/app.func/entry.mjs')));
assert.equal(typeof entry.default, 'function');
console.log(JSON.stringify({ bundleFiles: files.length, publicStaticFiles: 0, realProviderIncluded: false, localHarnessIncluded: false, entryImport: 'passed' }));
