-- EXISTING DEDICATED TRIAL ONLY: yamadaya-ai-trial / pgcvetybmtvojpivfjdm.
-- Verify the SQL Editor project URL/name independently. This SQL cannot prove
-- the hosted project reference. Do not run 001-hosted.sql or re-import a ledger.
-- Only the existing runtime function's two accounting expressions are replaced.
-- No application rows, grants, roles, schema, limit, expiry or device changes.
-- Prior to execution, explicitly SET yamadaya_trial.settlement_target =
-- 'pgcvetybmtvojpivfjdm:release-success-holds-v1'; this is a review guard only.
-- Stop on error; do not retry by weakening guards or deleting metadata.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '15s';
SET LOCAL ROLE yamadaya_trial_owner;
SET LOCAL search_path = pg_catalog, yamadaya_trial;
DO $settle_successful_reservations$
DECLARE
  original_budget yamadaya_trial.budget%ROWTYPE;
  runtime_id oid := 'yamadaya_trial.runtime(text,jsonb)'::regprocedure;
  before_definition text;
  after_definition text;
  expected_definition text;
  before_metadata jsonb;
  before_schema jsonb;
  before_functions jsonb;
  before_rows jsonb;
  after_rows jsonb;
  old_expression constant text := 'greatest(hold,coalesce(cost,hold))';
  new_expression constant text := 'CASE WHEN state=''succeeded'' AND cost IS NOT NULL THEN cost ELSE greatest(hold,coalesce(cost,hold)) END';
  original_expiry constant bigint := 1792972074000;
BEGIN
  IF current_setting('yamadaya_trial.settlement_target',true)
       IS DISTINCT FROM 'pgcvetybmtvojpivfjdm:release-success-holds-v1'
     OR current_user IS DISTINCT FROM 'yamadaya_trial_owner'
     OR current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Dedicated trial settlement target/owner differs; stop';
  END IF;
  SELECT to_jsonb(n) INTO before_schema FROM pg_namespace n WHERE n.nspname='yamadaya_trial';
  IF (SELECT n.nspowner::regrole::text FROM pg_namespace n WHERE n.nspname='yamadaya_trial')
       IS DISTINCT FROM 'yamadaya_trial_owner' THEN
    RAISE EXCEPTION 'Dedicated trial schema owner differs; stop';
  END IF;
  SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_proc p WHERE p.oid=runtime_id;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=runtime_id
       AND p.proowner='yamadaya_trial_owner'::regrole AND p.prosecdef
       AND p.proconfig=ARRAY['search_path=pg_catalog, yamadaya_trial']
       AND p.prorettype='jsonb'::regtype AND p.prokind='f') THEN
    RAISE EXCEPTION 'Existing runtime ownership/security/search_path differs; stop';
  END IF;
  before_definition := pg_get_functiondef(runtime_id);
  IF encode(sha256(convert_to(before_definition,'UTF8')),'hex')
       IS DISTINCT FROM '4e1d233124d1ac48278b51382aa1825182ed09690836ca3ac5bd48fea7f9cc57'
     OR (length(before_definition)-length(replace(before_definition,old_expression,'')))/length(old_expression) <> 2 THEN
    RAISE EXCEPTION 'Reviewed runtime definition or two old expressions differ; stop';
  END IF;
  SELECT jsonb_agg(CASE WHEN p.oid=runtime_id THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid)
    INTO before_functions FROM pg_proc p WHERE p.pronamespace='yamadaya_trial'::regnamespace;
  -- Match runtime's budget-first lock order. Shared table locks stop concurrent
  -- row writes briefly while all-column invariants are checked. No external IO.
  SELECT * INTO original_budget FROM yamadaya_trial.budget WHERE id=1 FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM yamadaya_trial.budget) <> 1
     OR original_budget.limit_micros IS DISTINCT FROM 10000000
     OR original_budget.imported IS DISTINCT FROM true
     OR original_budget.approved_until IS DISTINCT FROM original_expiry
     OR floor(extract(epoch FROM clock_timestamp())*1000)::bigint >= original_expiry THEN
    RAISE EXCEPTION 'Original USD 10 budget/import/deadline differs or expired; stop';
  END IF;
  LOCK TABLE yamadaya_trial.jobs, yamadaya_trial.devices, yamadaya_trial.sessions,
    yamadaya_trial.nonces, yamadaya_trial.results IN SHARE MODE;
  IF EXISTS (SELECT 1 FROM yamadaya_trial.jobs WHERE state='sending') THEN
    RAISE EXCEPTION 'An operation is in flight; stop without changing accounting';
  END IF;
  IF (SELECT count(*) FROM yamadaya_trial.devices) <> 3
     OR EXISTS (SELECT 1 FROM yamadaya_trial.devices
       WHERE id NOT IN ('trial-mac','trial-windows','trial-windows2')
          OR status IS DISTINCT FROM 'active' OR not_after IS DISTINCT FROM original_expiry) THEN
    RAISE EXCEPTION 'The original three approved device rows differ; stop';
  END IF;
  IF jsonb_typeof(original_budget.unknown_snapshot) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Original unknown snapshot is not an array; stop';
  END IF;
  IF jsonb_array_length(original_budget.unknown_snapshot) <> 3
     OR (SELECT coalesce(sum((x->>'hold')::bigint),0) FROM jsonb_array_elements(original_budget.unknown_snapshot) x) <> 450000
     OR (SELECT count(*) FROM yamadaya_trial.jobs WHERE state='unknown') <> 3
     OR (SELECT count(*) FROM yamadaya_trial.jobs WHERE baseline_unknown AND state='unknown') <> 3
     OR (SELECT coalesce(sum(hold),0) FROM yamadaya_trial.jobs WHERE baseline_unknown AND state='unknown') <> 450000
     OR original_budget.unknown_snapshot IS DISTINCT FROM (
       SELECT jsonb_agg(jsonb_build_object('id',id,'hold',hold,'request_hash',request_hash) ORDER BY id)
       FROM yamadaya_trial.jobs WHERE baseline_unknown AND state='unknown')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(original_budget.unknown_snapshot) x
       LEFT JOIN yamadaya_trial.jobs j ON j.id=x->>'id'
       WHERE j.id IS NULL OR NOT j.baseline_unknown OR j.state IS DISTINCT FROM 'unknown'
          OR j.hold IS DISTINCT FROM (x->>'hold')::bigint OR j.request_hash IS DISTINCT FROM x->>'request_hash') THEN
    RAISE EXCEPTION 'Original three unresolved holds totaling USD 0.45 differ; stop';
  END IF;
  SELECT jsonb_build_object(
    'budget',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM yamadaya_trial.budget b),
    'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.id),'[]'::jsonb) FROM yamadaya_trial.jobs j),
    'devices',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM yamadaya_trial.devices d),
    'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.hash),'[]'::jsonb) FROM yamadaya_trial.sessions s),
    'nonces',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.nonce),'[]'::jsonb) FROM yamadaya_trial.nonces n),
    'results',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM yamadaya_trial.results r)
  ) INTO before_rows;
  expected_definition := replace(before_definition,old_expression,new_expression);
  -- DDL is built solely from the exact hash-checked existing definition. This
  -- preserves every other line, including previously reviewed cleanup logic.
  EXECUTE expected_definition;
  after_definition := pg_get_functiondef(runtime_id);
  SELECT jsonb_build_object(
    'budget',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM yamadaya_trial.budget b),
    'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.id),'[]'::jsonb) FROM yamadaya_trial.jobs j),
    'devices',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM yamadaya_trial.devices d),
    'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.hash),'[]'::jsonb) FROM yamadaya_trial.sessions s),
    'nonces',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.nonce),'[]'::jsonb) FROM yamadaya_trial.nonces n),
    'results',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM yamadaya_trial.results r)
  ) INTO after_rows;
  IF after_definition IS DISTINCT FROM expected_definition
     OR encode(sha256(convert_to(after_definition,'UTF8')),'hex')
       IS DISTINCT FROM '79ee94dcdf19d9d887e1353eedb0593d941f155b3710ce206e7c9a4139d29451'
     OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=runtime_id) IS DISTINCT FROM before_metadata
     OR (SELECT jsonb_agg(CASE WHEN p.oid=runtime_id THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid)
         FROM pg_proc p WHERE p.pronamespace='yamadaya_trial'::regnamespace) IS DISTINCT FROM before_functions
     OR (SELECT to_jsonb(n) FROM pg_namespace n WHERE n.nspname='yamadaya_trial') IS DISTINCT FROM before_schema
     OR after_rows IS DISTINCT FROM before_rows THEN
    RAISE EXCEPTION 'Settlement after-check failed; function permissions or metadata changed; rollback';
  END IF;
END
$settle_successful_reservations$;
-- Only safe budget aggregates are returned. No job IDs, inputs, device
-- fingerprints, sessions, credentials or complete rows leave the database.
SELECT yamadaya_trial.runtime('usage','{}'::jsonb) AS reservation_settlement;
COMMIT;
