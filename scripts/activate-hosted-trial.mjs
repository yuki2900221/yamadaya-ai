import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeLocalTrial, verifyFrozenLocalTrial, trialActivationSql } from '../hosted/trial-transfer.mjs';

// Offline only. This CLI never loads .env, connects to PostgreSQL/OpenAI, or
// applies SQL. Only the operator-approved local ledger is opened explicitly.
async function privateInput(file) {
  if (!isAbsolute(file || '')) throw Error('An absolute private input path is required');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw Error('Private input must be an owned 0600 regular file');
}
async function savePrivate(file, text) {
  if (!isAbsolute(file || '')) throw Error('An absolute private output path is required');
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
}
function argumentsFor(args) {
  const command = args.shift(), flags = new Map();
  if (!['export','sql','verify'].includes(command)) throw Error('Use export, sql, or verify');
  while (args.length) {
    const name = args.shift();
    if (!['--ledger','--snapshot','--output','--confirm-local-stopped'].includes(name) || flags.has(name)) throw Error('Unknown or duplicate option');
    flags.set(name, name === '--confirm-local-stopped' ? true : args.shift());
  }
  if (!flags.get('--ledger') || !flags.get('--snapshot') || flags.get('--confirm-local-stopped') !== true
    || (command === 'sql') !== flags.has('--output')) throw Error('Require --ledger /absolute/jobs.sqlite --snapshot /absolute/snapshot.json --confirm-local-stopped; sql also requires --output /absolute/activation.sql');
  return { command, flags };
}
export async function runTransfer(args) {
  const { command, flags } = argumentsFor([...args]);
  await privateInput(flags.get('--ledger'));
  if (command !== 'export') await privateInput(flags.get('--snapshot'));
  const db = new DatabaseSync(flags.get('--ledger'), { readOnly: command !== 'export' });
  let snapshot;
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (command === 'export') {
      snapshot = freezeLocalTrial(db);
      // If saving fails, the source remains frozen. Retrying export is safe;
      // automatically removing the guard could enable two budget executors.
      await savePrivate(flags.get('--snapshot'), `${JSON.stringify(snapshot, null, 2)}\n`);
    } else {
      const handle = await open(flags.get('--snapshot'), constants.O_RDONLY | constants.O_NOFOLLOW);
      let parsed;
      try { parsed = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
      snapshot = verifyFrozenLocalTrial(db, parsed);
      if (command === 'sql') await savePrivate(flags.get('--output'), trialActivationSql(snapshot));
    }
  } finally { db.close(); }
  return { mode: command, localFrozen: true, snapshotHash: snapshot.snapshotHash,
    ...snapshot.expected, limitMicros: snapshot.limitMicros, approvedUntil: snapshot.approvedUntil,
    remoteExecuted: false, providerCalls: 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTransfer(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Transfer stopped. Keep the local executor stopped; review private paths, original approval, and metadata. No remote SQL or provider call was executed.'); process.exitCode = 1; });
}
