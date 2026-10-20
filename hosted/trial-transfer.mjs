import { createHash } from 'node:crypto';

// Metadata only. Importing this module does not open a ledger, credentials,
// network connection, or filesystem. These bounds are the existing approval.
export const TRIAL_LIMIT_MICROS = 10_000_000;
export const TRIAL_APPROVED_UNTIL = 1792972074000; // 2026-10-26 08:47:54 JST
const fields = ['id','owner','feature','state','hold','cost','created','finished','request_hash'];
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function requireValue(valid, message) { if (!valid) throw Error(message); }

export function createTrialSnapshot(jobs, { limitMicros = TRIAL_LIMIT_MICROS,
  approvedUntil = TRIAL_APPROVED_UNTIL, now = Date.now() } = {}) {
  requireValue(limitMicros === TRIAL_LIMIT_MICROS && approvedUntil === TRIAL_APPROVED_UNTIL
    && integer(now) && now < approvedUntil, 'The existing USD 10 approval and original unexpired deadline are required');
  requireValue(Array.isArray(jobs) && jobs.length > 0 && jobs.length <= 10000, 'A complete metadata ledger is required');
  const normalized = jobs.map(job => {
    requireValue(exactKeys(job, fields), 'Unexpected or missing job metadata; prompts/results must not be exported');
    requireValue(typeof job.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(job.id)
      && sha(job.owner) && sha(job.request_hash) && ['chat','writing','pop','image'].includes(job.feature)
      && ['succeeded','unknown'].includes(job.state) && integer(job.hold) && job.hold > 0
      && job.hold <= limitMicros && (job.cost === null || integer(job.cost))
      && integer(job.created) && job.created > 0 && (job.finished === null || integer(job.finished))
      && (job.state !== 'succeeded' || (job.cost !== null && job.finished !== null)),
    'Unsettled sending jobs or invalid metadata cannot be transferred');
    return Object.fromEntries(fields.map(field => [field, job[field]]));
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  requireValue(new Set(normalized.map(job => job.id)).size === normalized.length, 'Duplicate operation IDs');
  const unknown = normalized.filter(job => job.state === 'unknown');
  requireValue(unknown.length === 3 && unknown.map(job => job.hold).sort((a,b) => a-b).join(',') === '50000,50000,350000',
    'The original three unknown operations and USD 0.45 holds must be preserved');
  const expected = normalized.reduce((total, job) => ({ count: total.count + 1,
    reserved: total.reserved + Math.max(job.hold, job.cost ?? job.hold),
    calculated: total.calculated + (job.cost ?? 0), uncertain: total.uncertain + (job.state === 'unknown' ? 1 : 0) }),
  { count: 0, reserved: 0, calculated: 0, uncertain: 0 });
  requireValue(Object.values(expected).every(integer) && expected.reserved <= limitMicros, 'Ledger exceeds the original budget');
  const snapshotHash = hash(JSON.stringify({ version: 1, limitMicros, approvedUntil, jobs: normalized }));
  return { version: 1, snapshotHash, limitMicros, approvedUntil, expected, jobs: normalized };
}

export function validateTrialSnapshot(snapshot, { now = Date.now() } = {}) {
  requireValue(exactKeys(snapshot, ['version','snapshotHash','limitMicros','approvedUntil','expected','jobs'])
    && snapshot.version === 1 && sha(snapshot.snapshotHash)
    && exactKeys(snapshot.expected, ['count','reserved','calculated','uncertain']), 'Invalid transfer manifest');
  const actual = createTrialSnapshot(snapshot.jobs, { limitMicros: snapshot.limitMicros, approvedUntil: snapshot.approvedUntil, now });
  requireValue(actual.snapshotHash === snapshot.snapshotHash
    && Object.keys(actual.expected).every(key => actual.expected[key] === snapshot.expected[key]),
  'Snapshot hash or totals differ; stop without resetting either ledger');
  return actual;
}

function readMetadata(db) {
  const budget = db.prepare('SELECT limit_micros FROM budget WHERE id=1').get();
  requireValue(budget?.limit_micros === TRIAL_LIMIT_MICROS, 'The source ledger must retain its existing USD 10 limit');
  return db.prepare(`SELECT ${fields.join(',')} FROM jobs ORDER BY id`).all().map(job => ({ ...job }));
}

// Operator must stop every old local process first. Older code cannot observe a
// newly introduced guard. No sending row is rewritten or automatically retried.
export function freezeLocalTrial(db, { now = Date.now() } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const snapshot = createTrialSnapshot(readMetadata(db), { now });
    db.exec('CREATE TABLE IF NOT EXISTS trial_cutover(id INTEGER PRIMARY KEY CHECK(id=1),snapshot_hash TEXT NOT NULL,approved_until INTEGER NOT NULL)');
    const previous = db.prepare('SELECT snapshot_hash,approved_until FROM trial_cutover WHERE id=1').get();
    requireValue(!previous || (previous.snapshot_hash === snapshot.snapshotHash
      && previous.approved_until === snapshot.approvedUntil), 'The existing cutover marker differs');
    db.prepare('INSERT OR IGNORE INTO trial_cutover VALUES(1,?,?)').run(snapshot.snapshotHash, snapshot.approvedUntil);
    db.exec('COMMIT');
    return snapshot;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function verifyFrozenLocalTrial(db, snapshot, { now = Date.now() } = {}) {
  const checked = validateTrialSnapshot(snapshot, { now });
  const current = createTrialSnapshot(readMetadata(db), { now });
  const marker = db.prepare('SELECT snapshot_hash,approved_until FROM trial_cutover WHERE id=1').get();
  requireValue(marker?.snapshot_hash === checked.snapshotHash && marker.approved_until === checked.approvedUntil
    && current.snapshotHash === checked.snapshotHash, 'The local ledger is not frozen at this exact snapshot');
  return checked;
}

// SQL is an administrator-only, transactional draft for the dedicated project.
// It has no credentials, login grants, runtime resume endpoint, or provider call.
// Existing mock tables and all business/public objects are left unchanged.
export function trialActivationSql(snapshot, { now = Date.now() } = {}) {
  const checked = validateTrialSnapshot(snapshot, { now });
  const json = JSON.stringify(checked).replaceAll("'", "''");
  return `-- PRIVATE METADATA: do not publish this generated SQL or snapshot.
-- Dedicated Supabase project yamadaya-ai-trial / pgcvetybmtvojpivfjdm only.
-- Verify the SQL Editor URL and name first; the label cannot prove project ID.
-- Local executors must remain stopped/frozen. Rollback never unfreezes them.
BEGIN;
SET LOCAL ROLE yamadaya_trial_owner;
DO $activation_guard$ BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'yamadaya_trial_owner'
    OR NOT EXISTS (SELECT 1 FROM yamadaya_trial.budget WHERE id=1
      AND limit_micros=10000000 AND imported=false AND paused=true AND approved_until=0)
    OR EXISTS (SELECT 1 FROM yamadaya_trial.jobs)
    OR (SELECT count(*) FROM yamadaya_trial.devices) NOT BETWEEN 1 AND 2
    OR EXISTS (SELECT 1 FROM yamadaya_trial.devices WHERE not_after<>${TRIAL_APPROVED_UNTIL})
    OR floor(extract(epoch FROM clock_timestamp())*1000)::bigint >= ${TRIAL_APPROVED_UNTIL} THEN
    RAISE EXCEPTION 'Dedicated empty trial, approved devices, or original deadline differ';
  END IF;
END $activation_guard$;
SELECT yamadaya_trial.import_snapshot('${json}'::jsonb) AS imported;
DO $activation_verify$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM yamadaya_trial.budget WHERE id=1 AND imported=true
    AND paused=false AND limit_micros=10000000 AND approved_until=${TRIAL_APPROVED_UNTIL}
    AND snapshot_hash='${checked.snapshotHash}') THEN
    RAISE EXCEPTION 'Imported snapshot verification failed';
  END IF;
END $activation_verify$;
RESET ROLE;
COMMIT;
`;
}
