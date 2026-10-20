import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareHostedDatabase, TARGET_PROJECT_REF } from './prepare-hosted-db.mjs';

// Reuse the reviewed isolation/owner/RLS/transaction guard. The existing mock
// namespace may coexist; a collision with any new TRIAL schema/role stops it.
// This only returns SQL; it grants no usable login and never reads credentials.
export function prepareHostedTrialDatabase(source) {
  return prepareHostedDatabase(source)
    .replaceAll('yamadaya_mock', 'yamadaya_trial')
    .replace('-- MOCK namespace only. No real ledger import, device registrations, or keys.',
      '-- REAL TRIAL namespace only. Empty/paused; no ledger import, device registrations, or keys.')
    .replace('-- LOCAL SQL DRAFT ONLY. Never execute in an existing business project.',
      '-- LOCAL TRIAL SQL DRAFT ONLY. Never execute in an existing business project.');
}
async function main(args) {
  if (args.length !== 2 || args[0] !== '--output' || !isAbsolute(args[1]) || !args[1].endsWith('.sql')) throw Error('Require --output /absolute/private/trial-bootstrap.sql');
  const source = await readFile(new URL('../hosted/migrations/001-hosted.sql', import.meta.url), 'utf8');
  const sql = prepareHostedTrialDatabase(source);
  await writeFile(args[1], sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ targetProjectRef: TARGET_PROJECT_REF, mode: 'trial', roles: 3, loginRoles: 0,
    importedJobs: 0, registeredDevices: 0, sha256: createHash('sha256').update(sql).digest('hex') }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
  .catch(() => { console.error('Trial SQL draft generation stopped without remote changes'); process.exitCode = 1; });
