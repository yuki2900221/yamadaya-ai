import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockMigration } from '../hosted/mock-migration.mjs';

export const TARGET_PROJECT_REF = 'pgcvetybmtvojpivfjdm';
// Reviewed read-only on this new project, 2026-10-19. Supabase dashboard's
// automatic-RLS helper; preserve it, do not replace it with the docs example.
// https://supabase.com/docs/guides/database/postgres/event-triggers
export const REVIEWED_AUTO_RLS_SHA256 = 'b21d88816c445d14cef5032c3cd4abaebc1db2001fcb3435022ab6b496182ca4';
const owner = 'yamadaya_mock_owner';
const runtime = 'yamadaya_mock_runtime';
const web = 'yamadaya_mock_web';

const reviewedHelperGuard = `
  SELECT p.oid INTO reviewed_auto_rls
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND p.proname='rls_auto_enable' AND p.pronargs=0 AND p.prokind='f'
      AND p.prorettype='event_trigger'::regtype AND p.proowner='postgres'::regrole
      AND l.lanname='plpgsql' AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog']
      AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='${REVIEWED_AUTO_RLS_SHA256}';
  IF reviewed_auto_rls IS NULL OR
    (SELECT count(*) FROM pg_event_trigger WHERE evtfoid=reviewed_auto_rls) <> 1 OR
    (SELECT count(*) FROM pg_event_trigger WHERE evtname='ensure_rls' AND evtfoid=reviewed_auto_rls
      AND evtowner='postgres'::regrole AND evtevent='ddl_command_end' AND evtenabled='O'
      AND evttags=ARRAY['CREATE TABLE','CREATE TABLE AS','SELECT INTO']) <> 1 THEN
    RAISE EXCEPTION 'Reviewed automatic-RLS helper or trigger differs: stop without changing it';
  END IF;
`;

// Returns SQL text only. It neither connects to a database nor opens credentials.
export function prepareHostedDatabase(source) {
  const mapped = mockMigration(source);
  const start = '\nBEGIN;\n', end = 'COMMIT;\n';
  if (mapped.indexOf(start) < 0 || mapped.indexOf(start) !== mapped.lastIndexOf(start) ||
      !mapped.endsWith(end) || mapped.indexOf('\nCOMMIT;\n') !== mapped.lastIndexOf('\nCOMMIT;\n')) {
    throw Error('The reviewed migration must have exactly one transaction boundary');
  }
  const body = mapped.replace(start, '\n').slice(0, -end.length);
  const migrationHash = createHash('sha256').update(source).digest('hex');
  return `-- LOCAL SQL DRAFT ONLY. Never execute in an existing business project.
-- Dashboard target: yamadaya-ai-trial / ${TARGET_PROJECT_REF}
-- Verify the SQL Editor project URL and displayed name before any execution.
-- This project label is a human guard, not SQL proof of the hosted project ID.
-- Source migration SHA-256: ${migrationHash}
-- Existing public.rls_auto_enable() is the sole reviewed non-extension helper.
-- Its exact definition SHA-256: ${REVIEWED_AUTO_RLS_SHA256}
-- Its definition/owner/search_path and ensure_rls trigger are checked twice,
-- never modified. Every other public application object remains forbidden.
-- MOCK namespace only. No real ledger import, device registrations, or keys.
-- All three new roles are NOLOGIN, with no password. Credentials need a later
-- separately authorized step. No deploy or external API call occurs here.
-- Storage: create a PRIVATE bucket separately through Dashboard/Storage API.
-- Do not INSERT/UPDATE/DELETE managed storage schema metadata with this SQL.
-- PUBLIC/system privileges outside this namespace still need a hosted audit;
-- NOINHERIT is not a denial of PUBLIC privileges. Do not revoke DB CONNECT
-- from PUBLIC: managed Supabase services depend on that grant.
BEGIN;
DO $bootstrap_guard$ DECLARE reviewed_auto_rls oid; BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Use the dedicated project SQL Editor as postgres';
  END IF;
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'PostgreSQL 16 or newer membership options must be reviewed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('yamadaya_mock','yamadaya_trial'))
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('${owner}','${runtime}','${web}','yamadaya_trial_runtime')) THEN
    RAISE EXCEPTION 'Schema or role collision: stop and review, never reset existing data';
  END IF;
${reviewedHelperGuard}
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.oid <> reviewed_auto_rls
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
  ) THEN RAISE EXCEPTION 'Existing public application objects require dedicated-project review'; END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) <> 3 THEN
    RAISE EXCEPTION 'Expected Supabase roles are missing';
  END IF;
END $bootstrap_guard$;

CREATE ROLE ${owner} NOLOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ${runtime} NOLOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ${web} NOLOGIN PASSWORD NULL INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
GRANT ${owner} TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON DATABASE postgres TO ${owner};
SET LOCAL ROLE ${owner};
SET LOCAL yamadaya_mock.migration_target = 'dedicated-project';
${body}
RESET ROLE;
REVOKE CREATE ON DATABASE postgres FROM ${owner};
GRANT CONNECT ON DATABASE postgres TO ${web};
GRANT ${runtime} TO ${web} WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;

SET LOCAL ROLE ${owner};
DO $bootstrap_verify$ DECLARE r text; reviewed_auto_rls oid; BEGIN
${reviewedHelperGuard}
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('${owner}','${runtime}','${web}')
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unsafe new role attributes';
  END IF;
  IF NOT has_schema_privilege('${web}','yamadaya_mock','USAGE')
    OR has_schema_privilege('${web}','yamadaya_mock','CREATE')
    OR NOT has_function_privilege('${web}','yamadaya_mock.runtime(text,jsonb)','EXECUTE')
    OR has_function_privilege('${web}','yamadaya_mock.import_snapshot(jsonb)','EXECUTE')
    OR pg_has_role('${web}','${owner}','MEMBER')
    OR pg_has_role('${web}','postgres','MEMBER') THEN
    RAISE EXCEPTION 'Runtime privilege boundary differs';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
    WHERE child.rolname='${web}' AND (parent.rolname<>'${runtime}' OR m.admin_option OR m.set_option OR NOT m.inherit_option)) THEN
    RAISE EXCEPTION 'Unexpected runtime role membership';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='yamadaya_mock' AND (c.relowner <> current_user::regrole OR
      (c.relkind IN ('r','p') AND (NOT c.relrowsecurity OR has_table_privilege('${web}',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))))) THEN
    RAISE EXCEPTION 'Unexpected owner, RLS, or direct table grant';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='yamadaya_mock' AND (p.proowner <> current_user::regrole OR NOT p.prosecdef
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, yamadaya_mock'])) THEN
    RAISE EXCEPTION 'Function owner or fixed search_path differs';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(r,'yamadaya_mock','USAGE,CREATE')
      OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='yamadaya_mock' AND has_function_privilege(r,p.oid,'EXECUTE')) THEN
      RAISE EXCEPTION 'Browser/service role can access private namespace';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole=current_user::regrole AND defaclnamespace=0 AND defaclobjtype='f')
    OR EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole=current_user::regrole AND d.defaclnamespace=0 AND d.defaclobjtype='f'
        AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'Future owner functions would expose PUBLIC execute';
  END IF;
  IF (SELECT count(*) FROM yamadaya_mock.budget WHERE id=1 AND imported=false AND paused=true AND approved_until=0) <> 1
    OR EXISTS (SELECT 1 FROM yamadaya_mock.jobs) OR EXISTS (SELECT 1 FROM yamadaya_mock.devices)
    OR EXISTS (SELECT 1 FROM yamadaya_mock.sessions) OR EXISTS (SELECT 1 FROM yamadaya_mock.nonces)
    OR EXISTS (SELECT 1 FROM yamadaya_mock.results) THEN
    RAISE EXCEPTION 'Bootstrap must remain empty, unimported, and paused';
  END IF;
END $bootstrap_verify$;
RESET ROLE;
COMMIT;
`;
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--output' || !isAbsolute(args[1]) || !args[1].endsWith('.sql')) {
    throw Error('Usage: node scripts/prepare-hosted-db.mjs --output /absolute/path/draft.sql');
  }
  const source = await readFile(new URL('../hosted/migrations/001-hosted.sql', import.meta.url), 'utf8');
  const sql = prepareHostedDatabase(source);
  // Refuse accidental replacement of an earlier reviewed draft.
  await writeFile(args[1], sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ targetProjectRef: TARGET_PROJECT_REF, mode: 'mock', roles: 3, loginRoles: 0,
    passwords: 0, importedJobs: 0, registeredDevices: 0, output: args[1],
    sha256: createHash('sha256').update(sql).digest('hex') }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
