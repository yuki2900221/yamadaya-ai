-- LOCAL PREPARATION ONLY. Never run in an existing business project.
-- An administrator must verify the dedicated project's identity, then explicitly:
-- SET yamadaya_trial.migration_target = 'dedicated-project';
-- Execute as a migration-only table owner. Do not use that login in the app.
-- This creates NO login/password and NO Supabase API service-role credential.
BEGIN;
DO $$ BEGIN
  IF current_setting('yamadaya_trial.migration_target', true) IS DISTINCT FROM 'dedicated-project' THEN
    RAISE EXCEPTION 'Dedicated-project migration confirmation is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yamadaya_trial_runtime') THEN
    CREATE ROLE yamadaya_trial_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA yamadaya_trial;
REVOKE ALL ON SCHEMA yamadaya_trial FROM PUBLIC;
CREATE TABLE yamadaya_trial.budget (
  id integer PRIMARY KEY CHECK (id = 1),
  limit_micros bigint NOT NULL CHECK (limit_micros BETWEEN 0 AND 10000000),
  approved_until bigint NOT NULL DEFAULT 0,
  imported boolean NOT NULL DEFAULT false,
  snapshot_hash text,
  paused boolean NOT NULL DEFAULT true,
  unknown_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[a-f0-9]{64}$')
);
INSERT INTO yamadaya_trial.budget (id, limit_micros) VALUES (1, 10000000);
CREATE TABLE yamadaya_trial.devices (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  fingerprint_sha256 text NOT NULL UNIQUE CHECK (fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'revoked' CHECK (status IN ('active','revoked')),
  not_before bigint NOT NULL,
  not_after bigint NOT NULL CHECK (not_after > not_before)
);
CREATE TABLE yamadaya_trial.sessions (
  hash text PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  device_id text NOT NULL REFERENCES yamadaya_trial.devices(id),
  csrf_hash text NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
  expires bigint NOT NULL
);
CREATE INDEX ON yamadaya_trial.sessions(expires);
CREATE TABLE yamadaya_trial.jobs (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  owner text NOT NULL CHECK (owner ~ '^[a-f0-9]{64}$'),
  feature text NOT NULL CHECK (feature IN ('chat', 'writing', 'pop', 'image')),
  state text NOT NULL CHECK (state IN ('sending', 'succeeded', 'unknown')),
  hold bigint NOT NULL CHECK (hold > 0 AND hold <= 10000000),
  cost bigint CHECK (cost >= 0),
  created bigint NOT NULL,
  finished bigint,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  executor_hash text CHECK (executor_hash ~ '^[a-f0-9]{64}$'),
  lease_expires bigint,
  baseline_unknown boolean NOT NULL DEFAULT false,
  CHECK (state <> 'sending' OR (executor_hash IS NOT NULL AND lease_expires IS NOT NULL)),
  CHECK (state <> 'succeeded' OR (cost IS NOT NULL AND finished IS NOT NULL))
);
CREATE INDEX ON yamadaya_trial.jobs(owner, created);
CREATE INDEX ON yamadaya_trial.jobs(state, request_hash);
CREATE TABLE yamadaya_trial.nonces (
  nonce text PRIMARY KEY CHECK (nonce ~ '^[A-Za-z0-9_-]{16,128}$'), expires bigint NOT NULL
);
CREATE INDEX ON yamadaya_trial.nonces(expires);
-- Only ephemeral outputs, never prompts/history/photos/keys. Chat is explicitly
-- excluded in runtime below. TTL denies reads immediately; purge removes rows.
CREATE TABLE yamadaya_trial.results (
  id text PRIMARY KEY REFERENCES yamadaya_trial.jobs(id),
  owner text NOT NULL,
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object' AND octet_length(value::text) <= 65536),
  expires bigint NOT NULL
);
CREATE INDEX ON yamadaya_trial.results(expires);
CREATE UNIQUE INDEX ON yamadaya_trial.results((value->'imageManifest'->>'key'));

-- No policies: browser roles and the runtime role have no direct row access.
-- SECURITY DEFINER functions are owned by the migration-only table owner and
-- bypass owner RLS; that owner must never be the deployed connection identity.
ALTER TABLE yamadaya_trial.budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE yamadaya_trial.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE yamadaya_trial.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yamadaya_trial.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE yamadaya_trial.nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE yamadaya_trial.results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA yamadaya_trial FROM PUBLIC, yamadaya_trial_runtime;
-- PostgreSQL grants PUBLIC EXECUTE globally by default. A per-schema REVOKE
-- cannot cancel that global grant. This owner-wide change is intentional ONLY
-- for this dedicated project/migration owner; never run it in a business DB.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA yamadaya_trial REVOKE ALL ON TABLES FROM PUBLIC;

-- Admin-only, one-time metadata import. There is deliberately no runtime resume,
-- reset, import, device registration, or budget/expiry editing endpoint.
-- snapshot format: {version:1,snapshotHash:<SHA256 source export>,limitMicros,
-- approvedUntil,expected:{count,reserved,calculated,uncertain},jobs:[{
-- id,owner,feature,state,hold,cost,created,finished,request_hash}]}
-- Hash provenance/completeness must be independently checked against the local
-- export before this SQL is run. A claimed hash cannot prove an export is true.
CREATE FUNCTION yamadaya_trial.import_snapshot(snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yamadaya_trial AS $$
DECLARE b yamadaya_trial.budget%ROWTYPE; item jsonb; n bigint; r bigint; c bigint; u bigint; uh bigint;
BEGIN
  SELECT * INTO b FROM yamadaya_trial.budget WHERE id = 1 FOR UPDATE;
  IF b.imported OR EXISTS (SELECT 1 FROM yamadaya_trial.jobs) THEN RAISE EXCEPTION 'Import already completed'; END IF;
  IF snapshot->>'version' IS DISTINCT FROM '1'
     OR jsonb_typeof(snapshot->'jobs') IS DISTINCT FROM 'array'
     OR snapshot->>'snapshotHash' IS NULL OR snapshot->>'snapshotHash' !~ '^[a-f0-9]{64}$'
     OR (snapshot->>'limitMicros')::bigint IS DISTINCT FROM b.limit_micros
     OR (snapshot->>'approvedUntil')::bigint IS NULL
     OR jsonb_typeof(snapshot->'expected') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid import manifest';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'jobs') LOOP
    IF item->>'state' NOT IN ('succeeded', 'unknown') OR item->>'state' IS NULL THEN
      RAISE EXCEPTION 'Resolve sending states explicitly; preserve uncertain states and costs';
    END IF;
    INSERT INTO yamadaya_trial.jobs(id,owner,feature,state,hold,cost,created,finished,request_hash,baseline_unknown)
    VALUES(item->>'id',item->>'owner',item->>'feature',item->>'state',(item->>'hold')::bigint,
      (item->>'cost')::bigint,(item->>'created')::bigint,(item->>'finished')::bigint,item->>'request_hash',item->>'state' = 'unknown');
  END LOOP;
  SELECT count(*), coalesce(sum(greatest(hold, coalesce(cost,hold))),0), coalesce(sum(cost),0),
    count(*) FILTER (WHERE state = 'unknown'), coalesce(sum(hold) FILTER (WHERE state = 'unknown'),0)
    INTO n,r,c,u,uh FROM yamadaya_trial.jobs;
  IF n IS DISTINCT FROM (snapshot->'expected'->>'count')::bigint
     OR r IS DISTINCT FROM (snapshot->'expected'->>'reserved')::bigint
     OR c IS DISTINCT FROM (snapshot->'expected'->>'calculated')::bigint
     OR u IS DISTINCT FROM (snapshot->'expected'->>'uncertain')::bigint
     OR u <> 3 OR uh <> 450000 OR r > b.limit_micros
     OR (SELECT count(*) FROM yamadaya_trial.jobs WHERE state='unknown' AND hold=350000) <> 1
     OR (SELECT count(*) FROM yamadaya_trial.jobs WHERE state='unknown' AND hold=50000) <> 2 THEN
    RAISE EXCEPTION 'Snapshot totals or the approved three unknown holds differ';
  END IF;
  UPDATE yamadaya_trial.budget SET imported = true, snapshot_hash = snapshot->>'snapshotHash',
    approved_until = (snapshot->>'approvedUntil')::bigint, paused = false,
    unknown_snapshot = (SELECT jsonb_agg(jsonb_build_object('id',id,'hold',hold,'request_hash',request_hash) ORDER BY id) FROM yamadaya_trial.jobs WHERE state='unknown') WHERE id = 1;
  RETURN jsonb_build_object('count',n,'reserved',r,'calculated',c,'uncertain',u);
END $$;

-- This is the only runtime entry point. No dynamic SQL; fixed action allowlist.
CREATE FUNCTION yamadaya_trial.runtime(action text, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yamadaya_trial AS $$
DECLARE
  t bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  b yamadaya_trial.budget%ROWTYPE; j yamadaya_trial.jobs%ROWTYPE;
  session_row yamadaya_trial.sessions%ROWTYPE; device_row yamadaya_trial.devices%ROWTYPE;
  v jsonb; hold_amount bigint; reserved_amount bigint; changed bigint; expires_at bigint;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST'); END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RETURN jsonb_build_object('ok',false,'code','ISOLATION_UNSUPPORTED'); END IF;
  -- One short shared lock orders budget/session/result mutations. No external IO
  -- happens under it. Re-read the clock AFTER waiting so expiry is never stale.
  SELECT * INTO b FROM yamadaya_trial.budget WHERE id=1 FOR UPDATE;
  t := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF action = 'device' THEN
    SELECT * INTO device_row FROM yamadaya_trial.devices WHERE id = p->>'id';
    v := CASE WHEN FOUND THEN jsonb_build_object('id',device_row.id,'fingerprint_sha256',device_row.fingerprint_sha256,'status',device_row.status,'not_before',device_row.not_before,'not_after',device_row.not_after) ELSE 'null'::jsonb END;
  ELSIF action = 'nonce' THEN
    expires_at := (p->>'expires')::bigint;
    IF expires_at IS NULL OR expires_at <= t OR expires_at > t + 120000 THEN
      RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST');
    END IF;
    INSERT INTO yamadaya_trial.nonces VALUES(p->>'nonce',expires_at) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS changed = ROW_COUNT;
    v := to_jsonb(changed = 1);
  ELSIF action IN ('session-create','session-get','session-touch','session-end') THEN
    IF action = 'session-end' THEN
      DELETE FROM yamadaya_trial.sessions WHERE hash = p->>'sessionHash' AND device_id = p->>'deviceId';
      GET DIAGNOSTICS changed = ROW_COUNT;
      -- Keep image pointers until Storage deletion succeeds, including when that
      -- deletion fails. The missing session immediately prevents all result reads.
      v := to_jsonb(changed > 0);
    ELSE
      SELECT * INTO device_row FROM yamadaya_trial.devices WHERE id = p->>'deviceId' AND status='active' AND not_before<=t AND not_after>t;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','DEVICE_REQUIRED'); END IF;
      IF action = 'session-create' THEN
        expires_at := (p->>'expires')::bigint;
        IF expires_at IS NULL OR expires_at <= t OR expires_at > t + 900000 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST'); END IF;
        INSERT INTO yamadaya_trial.sessions VALUES(p->>'sessionHash',p->>'deviceId',p->>'csrfHash',least(expires_at,device_row.not_after)) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS changed = ROW_COUNT;
        IF changed = 0 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST'); END IF;
      END IF;
      SELECT * INTO session_row FROM yamadaya_trial.sessions WHERE hash = p->>'sessionHash' AND device_id = p->>'deviceId' AND expires > t;
      IF NOT FOUND THEN v := 'null'::jsonb;
      ELSIF action = 'session-touch' THEN
        expires_at := (p->>'expires')::bigint;
        IF expires_at IS NULL OR expires_at <= t OR expires_at > t + 900000 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST'); END IF;
        UPDATE yamadaya_trial.sessions SET expires = least(expires_at,device_row.not_after) WHERE hash = session_row.hash RETURNING * INTO session_row;
        v := jsonb_build_object('session_hash',session_row.hash,'device_id',session_row.device_id,'csrf_hash',session_row.csrf_hash,'expires',session_row.expires);
      ELSIF action = 'session-get' AND (p->>'now')::bigint >= session_row.expires THEN v := 'null'::jsonb;
      ELSE v := jsonb_build_object('session_hash',session_row.hash,'device_id',session_row.device_id,'csrf_hash',session_row.csrf_hash,'expires',session_row.expires);
      END IF;
    END IF;
  ELSIF action IN ('usage','reserve','finish','get','purge') THEN
    -- Serialize budget decisions and completions across all deployment instances.
    -- Under READ COMMITTED, the following statements see the latest committed rows.
    IF action IN ('reserve','purge') THEN
      UPDATE yamadaya_trial.jobs SET state='unknown',finished=t WHERE state='sending' AND lease_expires <= t;
      GET DIAGNOSTICS changed = ROW_COUNT;
      IF changed > 0 THEN UPDATE yamadaya_trial.budget SET paused=true WHERE id=1; b.paused := true; END IF;
    END IF;
    IF action = 'usage' THEN
      SELECT jsonb_build_object('limit',b.limit_micros,'reserved',coalesce(sum(greatest(hold,coalesce(cost,hold))),0),
        'calculated',coalesce(sum(cost),0),'count',count(*),'uncertain',count(*) FILTER(WHERE state IN ('sending','unknown')),
        'imported',b.imported,'paused',b.paused,'expires',b.approved_until)
        INTO v FROM yamadaya_trial.jobs;
    ELSIF action = 'get' THEN
      SELECT to_jsonb(x) INTO v FROM (SELECT id,owner,feature,state,hold,cost,created,finished,request_hash,lease_expires
        FROM yamadaya_trial.jobs WHERE id=p->>'id' AND owner=p->>'owner') x;
    ELSIF action = 'purge' THEN
      -- Results must be removed only by image-remove-metadata after the caller
      -- successfully deletes the exact Storage keys. TTL crossing during cleanup
      -- must not orphan a newly expired object by silently deleting its pointer.
      DELETE FROM yamadaya_trial.sessions s WHERE s.expires <= t OR NOT EXISTS (
        SELECT 1 FROM yamadaya_trial.devices d WHERE d.id=s.device_id AND d.status='active' AND d.not_before<=t AND d.not_after>t);
      DELETE FROM yamadaya_trial.nonces WHERE expires <= t;
      v := jsonb_build_object('purged',true);
    ELSIF action = 'reserve' THEN
      IF NOT b.imported THEN RETURN jsonb_build_object('ok',false,'code','NOT_IMPORTED'); END IF;
      IF b.approved_until <= t THEN RETURN jsonb_build_object('ok',false,'code','TRIAL_EXPIRED'); END IF;
      SELECT * INTO session_row FROM yamadaya_trial.sessions WHERE hash=p->>'owner' AND expires > t;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','SESSION_EXPIRED'); END IF;
      IF NOT EXISTS (SELECT 1 FROM yamadaya_trial.devices WHERE id=session_row.device_id AND status='active' AND not_before<=t AND not_after>t) THEN RETURN jsonb_build_object('ok',false,'code','DEVICE_REQUIRED'); END IF;
      SELECT * INTO j FROM yamadaya_trial.jobs WHERE id=p->>'id';
      IF FOUND THEN
        IF j.owner <> p->>'owner' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
        IF j.request_hash <> p->>'requestHash' OR j.feature <> p->>'feature' THEN RETURN jsonb_build_object('ok',false,'code','ID_REUSED'); END IF;
        v := jsonb_build_object('record',to_jsonb(j)-'executor_hash'-'baseline_unknown','duplicate',true);
      ELSE
        IF EXISTS(SELECT 1 FROM yamadaya_trial.jobs WHERE state='unknown' AND request_hash=p->>'requestHash') THEN RETURN jsonb_build_object('ok',false,'code','UNCERTAIN_DUPLICATE'); END IF;
        IF b.paused OR b.unknown_snapshot IS DISTINCT FROM (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'hold',hold,'request_hash',request_hash) ORDER BY id),'[]'::jsonb) FROM yamadaya_trial.jobs WHERE state='unknown') THEN RETURN jsonb_build_object('ok',false,'code','UNCERTAIN'); END IF;
        IF EXISTS(SELECT 1 FROM yamadaya_trial.jobs WHERE state='sending') THEN RETURN jsonb_build_object('ok',false,'code','BUSY'); END IF;
        IF (SELECT count(*) FROM yamadaya_trial.jobs WHERE owner=p->>'owner' AND created>t-60000)>=6 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMIT'); END IF;
        hold_amount := CASE p->>'feature' WHEN 'chat' THEN CASE WHEN (p->>'search')::boolean THEN 50000 ELSE 15000 END
          WHEN 'writing' THEN 15000 WHEN 'pop' THEN 15000 WHEN 'image' THEN 350000 ELSE NULL END;
        IF hold_amount IS NULL OR (p->>'executorHash') !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST'); END IF;
        SELECT coalesce(sum(greatest(hold,coalesce(cost,hold))),0) INTO reserved_amount FROM yamadaya_trial.jobs;
        IF reserved_amount + hold_amount > b.limit_micros THEN RETURN jsonb_build_object('ok',false,'code','BUDGET_LIMIT'); END IF;
        INSERT INTO yamadaya_trial.jobs(id,owner,feature,state,hold,created,request_hash,executor_hash,lease_expires)
          VALUES(p->>'id',p->>'owner',p->>'feature','sending',hold_amount,t,p->>'requestHash',p->>'executorHash',t+300000) RETURNING * INTO j;
        v := jsonb_build_object('record',to_jsonb(j)-'executor_hash'-'baseline_unknown','duplicate',false);
      END IF;
    ELSE -- finish
      SELECT * INTO j FROM yamadaya_trial.jobs WHERE id=p->>'id';
      IF NOT FOUND OR j.owner <> p->>'owner' THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
      IF j.executor_hash IS NULL OR j.executor_hash IS DISTINCT FROM p->>'executorHash' THEN RETURN jsonb_build_object('ok',false,'code','EXECUTOR_REQUIRED'); END IF;
      IF j.state <> 'sending' THEN RETURN jsonb_build_object('ok',false,'code','ALREADY_FINISHED'); END IF;
      IF j.lease_expires <= t THEN
        UPDATE yamadaya_trial.jobs SET state='unknown',finished=t WHERE id=j.id;
        UPDATE yamadaya_trial.budget SET paused=true WHERE id=1;
        RETURN jsonb_build_object('ok',false,'code','LEASE_EXPIRED');
      END IF;
      IF p->>'state' NOT IN ('succeeded','unknown') OR p->>'state' IS NULL
        OR ((p->>'costMicros')::bigint IS NOT NULL AND (p->>'costMicros')::bigint < 0) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST'); END IF;
      UPDATE yamadaya_trial.jobs SET state=CASE WHEN p->>'state'='succeeded' AND (p->>'costMicros')::bigint IS NOT NULL AND (p->>'costMicros')::bigint<=hold THEN 'succeeded' ELSE 'unknown' END,
        cost=(p->>'costMicros')::bigint,finished=t WHERE id=j.id RETURNING * INTO j;
      IF j.state='unknown' THEN UPDATE yamadaya_trial.budget SET paused=true WHERE id=1; END IF;
      v := to_jsonb(j)-'executor_hash'-'baseline_unknown';
    END IF;
  ELSIF action IN ('result-put','result-get') THEN
    IF NOT EXISTS (SELECT 1 FROM yamadaya_trial.sessions s JOIN yamadaya_trial.devices d ON d.id=s.device_id
      WHERE s.hash=p->>'owner' AND s.expires>t AND d.status='active' AND d.not_before<=t AND d.not_after>t) THEN RETURN jsonb_build_object('ok',false,'code','SESSION_EXPIRED'); END IF;
    SELECT * INTO j FROM yamadaya_trial.jobs WHERE id=p->>'id' AND owner=p->>'owner' AND state='succeeded';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF action='result-put' THEN
      expires_at := (p->>'expires')::bigint;
      IF j.feature<>'image' OR expires_at IS NULL OR expires_at<=t OR expires_at>t+900000
        OR jsonb_typeof(p->'value') IS DISTINCT FROM 'object' OR octet_length((p->'value')::text)>65536
        OR ((p->'value') - ARRAY['demo','paper','imageManifest']) <> '{}'::jsonb
        OR jsonb_typeof(p->'value'->'demo') IS DISTINCT FROM 'boolean'
        OR p->'value'->>'paper' IS NULL OR p->'value'->>'paper' NOT IN ('a4p','a4l','a3p','a3l')
        OR jsonb_typeof(p->'value'->'imageManifest') IS DISTINCT FROM 'object'
        OR ((p->'value'->'imageManifest') - ARRAY['key','mime','size','sha256','chunks','expires','path']) <> '{}'::jsonb
        OR p->'value'->'imageManifest'->>'key' IS NULL
        OR p->'value'->'imageManifest'->>'key' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.bin$'
        OR p->'value'->'imageManifest'->>'mime' IS NULL
        OR p->'value'->'imageManifest'->>'mime' NOT IN ('image/png','image/jpeg','image/svg+xml')
        OR (p->'value'->'imageManifest'->>'mime'='image/svg+xml' AND p->'value'->>'demo'<>'true')
        OR (p->'value'->'imageManifest'->>'size')::bigint IS NULL
        OR (p->'value'->'imageManifest'->>'size')::bigint NOT BETWEEN 1 AND 10485760
        OR p->'value'->'imageManifest'->>'sha256' IS NULL OR p->'value'->'imageManifest'->>'sha256' !~ '^[a-f0-9]{64}$'
        OR (p->'value'->'imageManifest'->>'chunks')::integer IS NULL
        OR (p->'value'->'imageManifest'->>'chunks')::integer NOT BETWEEN 1 AND 5
        OR (p->'value'->'imageManifest'->>'expires')::bigint IS DISTINCT FROM expires_at
        OR p->'value'->'imageManifest'->>'path' IS DISTINCT FROM ('/api/images/' || j.id || '/')
        THEN RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST'); END IF;
      INSERT INTO yamadaya_trial.results VALUES(j.id,j.owner,p->'value',least(expires_at,(SELECT expires FROM yamadaya_trial.sessions WHERE hash=j.owner)))
        ON CONFLICT(id) DO NOTHING;
      GET DIAGNOSTICS changed = ROW_COUNT;
      v := to_jsonb(changed > 0);
    ELSE SELECT value INTO v FROM yamadaya_trial.results WHERE id=j.id AND owner=j.owner AND expires>t;
    END IF;
  ELSIF action='image-expired-keys' THEN
    SELECT coalesce(jsonb_agg(r.value->'imageManifest'->>'key'),'[]'::jsonb) INTO v FROM yamadaya_trial.results r
      WHERE r.expires<=t OR NOT EXISTS (SELECT 1 FROM yamadaya_trial.sessions s JOIN yamadaya_trial.devices d ON d.id=s.device_id
        WHERE s.hash=r.owner AND s.expires>t AND d.status='active' AND d.not_before<=t AND d.not_after>t);
  ELSIF action='image-session-keys' THEN
    SELECT coalesce(jsonb_agg(r.value->'imageManifest'->>'key'),'[]'::jsonb) INTO v FROM yamadaya_trial.results r
      WHERE r.owner=p->>'owner' AND EXISTS(SELECT 1 FROM yamadaya_trial.sessions s WHERE s.hash=r.owner AND s.device_id=p->>'deviceId');
  ELSIF action='image-remove-metadata' THEN
    IF jsonb_typeof(p->'keys') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'keys')>32 THEN
      RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST');
    END IF;
    DELETE FROM yamadaya_trial.results r WHERE r.value->'imageManifest'->>'key' IN (SELECT jsonb_array_elements_text(p->'keys'))
      AND (r.expires<=t OR NOT EXISTS(SELECT 1 FROM yamadaya_trial.sessions s JOIN yamadaya_trial.devices d ON d.id=s.device_id
        WHERE s.hash=r.owner AND s.expires>t AND d.status='active' AND d.not_before<=t AND d.not_after>t));
    GET DIAGNOSTICS changed = ROW_COUNT;
    v := to_jsonb(changed);
  ELSE RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST');
  END IF;
  RETURN jsonb_build_object('ok',true,'value',v);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA yamadaya_trial FROM PUBLIC, yamadaya_trial_runtime;
GRANT USAGE ON SCHEMA yamadaya_trial TO yamadaya_trial_runtime;
GRANT EXECUTE ON FUNCTION yamadaya_trial.runtime(text,jsonb) TO yamadaya_trial_runtime;
-- Supabase browser/service roles are explicitly denied too when present.
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA yamadaya_trial FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA yamadaya_trial FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA yamadaya_trial FROM %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
