import { readFile, writeFile, mkdir, chmod, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const projectRoot = resolve(import.meta.dirname, '..');
const sourceFiles = Object.freeze(['hosted/worker-entry.mjs', 'hosted/gateway.mjs', 'hosted/origin-auth.mjs']);
const sha256 = value => createHash('sha256').update(value).digest('hex');

// Use the existing lockfile-pinned Vite/Rolldown dependency directly. No Vite
// configuration, environment loader, define replacement, or text concatenation.
export async function createWorkerBundle({ root = projectRoot } = {}) {
  const sources = new Map(await Promise.all(sourceFiles.map(async name => [resolve(root, name), await readFile(resolve(root, name), 'utf8')])));
  const entry = resolve(root, sourceFiles[0]);
  const generated = await build({
    cwd: root, input: entry, platform: 'browser', write: false,
    preserveEntrySignatures: 'strict',
    plugins: [{
      name: 'only-reviewed-worker-modules',
      resolveId(source, importer) {
        const target = importer ? resolve(dirname(importer), source) : source;
        if ((importer && (!sources.has(importer) || !source.startsWith('./'))) || !sources.has(target)) {
          throw Error('Worker imports must stay within the three reviewed source modules');
        }
        return target;
      },
      load(id) {
        if (!sources.has(id)) throw Error('Unreviewed Worker module');
        return sources.get(id);
      },
    }],
    onLog(level, log) { if (level !== 'debug') throw Error(`Worker bundling failed: ${log.code}`); },
    output: { format: 'esm', codeSplitting: false, sourcemap: false, minify: false },
  });
  if (generated.output.length !== 1) throw Error('A single Worker module is required');
  const chunk = generated.output[0];
  if (chunk.type !== 'chunk' || !chunk.isEntry || chunk.imports.length || chunk.dynamicImports.length ||
      chunk.exports.length !== 1 || chunk.exports[0] !== 'default' ||
      chunk.moduleIds.length !== sources.size || chunk.moduleIds.some(id => !sources.has(id))) {
    throw Error('Worker output must retain its default ESM export without external imports');
  }
  // These are browser/Worker-only source modules; do not polyfill Node globals.
  if (/\b(?:process|Buffer|require|__dirname|__filename)\b|node:/.test(chunk.code)) {
    throw Error('Worker output must use Web APIs only');
  }
  return { code: chunk.code, manifest: {
    format: 'esm', entry: sourceFiles[0], exports: chunk.exports,
    sources: sourceFiles.map(name => ({ path: name, sha256: sha256(sources.get(resolve(root, name))) })),
    sha256: sha256(chunk.code), bytes: Buffer.byteLength(chunk.code), externalImports: 0,
    environmentValuesEmbedded: false,
  } };
}

async function main() {
  if (process.argv.length !== 2) throw Error('Usage: node scripts/build-cloudflare-worker.mjs');
  const { code, manifest } = await createWorkerBundle();
  const directory = resolve(projectRoot, '.runtime/hosted-mock');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw Error('A private output directory is required');
  await chmod(directory, 0o700);
  const output = resolve(directory, 'cloudflare-worker.mjs');
  // Refuse symlink destinations; no credentials are read or embedded.
  const existing = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing && !existing.isFile()) throw Error('Worker output must be an ordinary file');
  await writeFile(output, code, { mode: 0o600 });
  await chmod(output, 0o600);
  console.log(JSON.stringify({ ...manifest, output, deployed: false }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
