import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.vercel/output');
const bundle = path.join(output, 'functions/app.func');
const built = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) throw Error('Frontend build failed');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(bundle, { recursive: true });
const copy = async (from, to) => { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.cp(from, to, { recursive: true, dereference: false }); };
// Strict application allowlist: no credentials, ledger files or reference photos.
// The explicit live mode alone can instantiate the server-only API adapter.
for (const file of ['app.mjs','images.mjs','ledger.mjs','live-provider.mjs','maintenance.mjs','node-entry.mjs','origin-auth.mjs','runtime.mjs']) await copy(path.join(root, 'hosted', file), path.join(bundle, 'hosted', file));
for (const file of ['contracts.mjs','pdf.mjs','proposal-policy.js','proposal-contract.js','image-transport.mjs']) await copy(path.join(root, 'shared', file), path.join(bundle, 'shared', file));
for (const file of ['demo.mjs','provider.mjs','contracts.mjs']) await copy(path.join(root, 'server', file), path.join(bundle, 'server', file));
await copy(path.join(root, 'dist'), path.join(bundle, 'dist'));
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const [name, spec] of Object.entries(lock.packages)) if (name.startsWith('node_modules/') && !spec.dev) await copy(path.join(root, name), path.join(bundle, name));
await fs.writeFile(path.join(bundle, 'package.json'), JSON.stringify({ type: 'module', private: true }));
await fs.writeFile(path.join(bundle, 'entry.mjs'), "export { default } from './hosted/node-entry.mjs';\n");
await fs.writeFile(path.join(bundle, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs24.x', handler: 'entry.mjs', launcherType: 'Nodejs', maxDuration: 300 }));
await fs.writeFile(path.join(output, 'config.json'), JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/app' }] }, null, 2));
// No output/static directory: HTML/CSS/JS/images also require the same verifier.
console.log('Hosted trial bundle prepared locally. No deployment or AI call performed.');
