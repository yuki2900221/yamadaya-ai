import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_PROJECT_REF } from './prepare-hosted-db.mjs';
import { TRIAL_APPROVED_UNTIL } from '../hosted/trial-transfer.mjs';

// SQL text only. No password, source ledger, environment, or network is read.
// The operator must independently verify the SQL Editor's project URL/name:
// PostgreSQL has no general built-in that proves a Supabase project ref.
export function prepareHostedTrialLoginSql({ projectRef = TARGET_PROJECT_REF,
  approvedUntil = TRIAL_APPROVED_UNTIL } = {}) {
  if (projectRef !== TARGET_PROJECT_REF || approvedUntil !== TRIAL_APPROVED_UNTIL) throw Error('Only the approved dedicated project and original deadline are allowed');
  const until = new Date(approvedUntil).toISOString();
  return `-- ADMINISTRATOR SQL DRAFT: yamadaya-ai-trial / ${TARGET_PROJECT_REF} only.
-- Verify the SQL Editor project URL/name independently before execution.
-- No password literal is included. The SELECT returns a newly generated secret
-- once: capture privately without printing, then clear the result display.
-- Existing mock/data/roles are not changed. No ledger import or provider call.
BEGIN;
CREATE FUNCTION pg_temp.issue_yamadaya_trial_login(p_ref text, p_until bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $issue_trial_login$
DECLARE login_row pg_catalog.pg_roles%ROWTYPE; v_password text; v_runtime_oid oid; v_import_oid oid;
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' OR current_database() <> 'postgres'
    OR p_ref IS DISTINCT FROM '${TARGET_PROJECT_REF}' OR p_until IS DISTINCT FROM ${approvedUntil}
    OR current_setting('server_version_num')::integer < 160000
    OR floor(extract(epoch FROM clock_timestamp())*1000)::bigint >= p_until THEN
    RAISE EXCEPTION 'Dedicated trial login issuance refused';
  END IF;
  -- Serialize two approved administrators without sharing a secret-bearing row.
  PERFORM pg_advisory_xact_lock(hashtextextended('yamadaya-trial-login-20261020',0));
  SELECT * INTO login_row FROM pg_roles WHERE rolname='yamadaya_trial_web';
  IF NOT FOUND OR login_row.rolcanlogin OR login_row.rolsuper OR login_row.rolcreatedb
    OR login_row.rolcreaterole OR login_row.rolreplication OR login_row.rolbypassrls
    OR NOT login_row.rolinherit OR login_row.rolconnlimit<>4 OR login_row.rolvaliduntil IS NOT NULL THEN
    RAISE EXCEPTION 'New NOLOGIN trial web role required; never overwrite existing access';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='yamadaya_trial'
      AND nspowner='yamadaya_trial_owner'::regrole)
    OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('yamadaya_trial_owner','yamadaya_trial_runtime')
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls)<>2
    OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='yamadaya_trial' AND c.relkind IN ('r','p'))<>6
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='yamadaya_trial' AND c.relkind IN ('r','p')
        AND (c.relowner<>'yamadaya_trial_owner'::regrole OR NOT c.relrowsecurity
          OR has_table_privilege('yamadaya_trial_web',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
    OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='yamadaya_trial')<>2
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='yamadaya_trial' AND (p.proowner<>'yamadaya_trial_owner'::regrole OR NOT p.prosecdef
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, yamadaya_trial'])) THEN
    RAISE EXCEPTION 'Reviewed isolated trial namespace required';
  END IF;
  SELECT p.oid INTO v_runtime_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='yamadaya_trial' AND p.proname='runtime' AND p.proargtypes='25 3802'::oidvector;
  SELECT p.oid INTO v_import_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='yamadaya_trial' AND p.proname='import_snapshot' AND p.proargtypes='3802'::oidvector;
  IF v_runtime_oid IS NULL OR v_import_oid IS NULL
    OR (SELECT count(*) FROM pg_auth_members m WHERE m.member='yamadaya_trial_web'::regrole)<>1
    OR NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member='yamadaya_trial_web'::regrole
      AND m.roleid='yamadaya_trial_runtime'::regrole AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option)
    OR NOT has_schema_privilege('yamadaya_trial_web','yamadaya_trial','USAGE')
    OR has_schema_privilege('yamadaya_trial_web','yamadaya_trial','CREATE')
    OR NOT has_function_privilege('yamadaya_trial_web',v_runtime_oid,'EXECUTE')
    OR has_function_privilege('yamadaya_trial_web',v_import_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'Minimum trial runtime privileges required';
  END IF;
  -- The owner can read the guarded row; postgres membership has INHERIT FALSE.
  -- A narrowly scoped SET LOCAL ROLE is used only for non-secret state checks.
  EXECUTE 'SET LOCAL ROLE yamadaya_trial_owner';
  IF NOT EXISTS (SELECT 1 FROM yamadaya_trial.budget WHERE id=1 AND limit_micros=10000000
    AND imported=false AND paused=true AND approved_until=0)
    OR EXISTS (SELECT 1 FROM yamadaya_trial.jobs) THEN
    RAISE EXCEPTION 'An empty paused unimported trial is required';
  END IF;
  EXECUTE 'RESET ROLE';
  -- Three UUIDv4 values contain 366 random bits from PostgreSQL's CSPRNG.
  -- SHA-256 produces a 256-bit password without requiring a new extension.
  v_password := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text,'UTF8')),'hex');
  PERFORM set_config('password_encryption','scram-sha-256',true);
  BEGIN
    EXECUTE format('ALTER ROLE yamadaya_trial_web LOGIN CONNECTION LIMIT 2 PASSWORD %L VALID UNTIL %L',
      v_password,'${until}');
  EXCEPTION WHEN OTHERS THEN
    -- Avoid a dynamic ALTER ROLE containing a secret in an error response.
    RAISE EXCEPTION 'Trial login issuance failed; transaction must be rolled back';
  END;
  RETURN jsonb_build_object('role','yamadaya_trial_web','password',v_password,
    'projectRef','${TARGET_PROJECT_REF}','expires',${approvedUntil});
END $issue_trial_login$;
REVOKE ALL ON FUNCTION pg_temp.issue_yamadaya_trial_login(text,bigint) FROM PUBLIC;
SELECT pg_temp.issue_yamadaya_trial_login('${projectRef}',${approvedUntil}) AS trial_login_once;
COMMIT;
`;
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--output' || !isAbsolute(args[1]) || !args[1].endsWith('.sql')) throw Error('Require --output /absolute/private/trial-login.sql');
  const sql = prepareHostedTrialLoginSql();
  await writeFile(args[1], sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ targetProjectRef: TARGET_PROJECT_REF, role: 'yamadaya_trial_web',
    approvedUntil: TRIAL_APPROVED_UNTIL, sqlContainsPassword: false, remoteExecuted: false,
    sha256: createHash('sha256').update(sql).digest('hex') }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
  .catch(() => { console.error('Trial login SQL generation stopped without remote changes'); process.exitCode = 1; });
