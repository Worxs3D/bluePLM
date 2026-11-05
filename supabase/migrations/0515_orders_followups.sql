-- =====================================================================
-- 0515_orders_followups.sql: orders follow-ups (schema 514 -> 515)
-- =====================================================================
-- Plan: .cursor/plans/orders-gaps-5.13-agents.plan.md (Contract, E). Four independent parts:
--
--   version_output_request   a request for an output a version does not have yet (pdf, step,
--                       iges, stl, dxf), made from the web or a machine without SOLIDWORKS. Any
--                       signed-in desktop with SOLIDWORKS whose user has explorer edit and the
--                       vault claims it (version_output_request_claim(), FOR UPDATE SKIP LOCKED,
--                       a claim older than 15 minutes can be taken again; a working claimer keeps
--                       it fresh with version_output_request_touch() or hands it back with
--                       _release(), and a fourth claim fails it with TOO_MANY_ATTEMPTS), generates the output
--                       through the normal path (file_version_output_record() /
--                       drawing_pdf_render_record()) and finishes it. Recording the matching output
--                       marks every open request for it done (trg_output_request_complete), so a
--                       request never outlives its output. Readable with the version's vault;
--                       written only by the version_output_request_* functions; in the realtime
--                       publication so workers wake up. Not in server backups on purpose: a request
--                       is transient work (pending for minutes, finished rows pruned after 30 days),
--                       and a restored request would ask a machine to redo work against restored
--                       content, so BACKUP_TABLES and the API are unchanged.
--   supply_order_count_hidden_lines(uuid)  per vault, how many lines of an order the caller cannot
--                       read (a line counts under each of its vaults the caller lacks), with the
--                       vault's name, which every member of the organization reads already.
--   trg_file_version_release_closure_guard  a version that a released version references, directly
--                       or through other versions (file_version_reference.child_version_id, exact or
--                       approximate), is never deleted while the released version's file is live and
--                       its organization exists (hint REFERENCED_BY_RELEASE; the message names the
--                       released file only to a caller who can read its vault). The deletion paths are
--                       all deletes of file_version rows: the client's version delete (policy
--                       "file_version: engineers manage"), a file purge (file delete, cascading),
--                       a vault delete (cascading through file) and an organization delete; the
--                       trigger runs on each. As for 0509's guard on the released version itself, a
--                       released version whose file is in the trash no longer protects its
--                       references, and deleting the vault or organization that holds the release
--                       removes it with them (its file row is gone by the time its references go).
--   RFQ import          every rfq + rfq_item becomes a quote order (supply_order.imported_from_rfq_id,
--                       numbered through the counter), each item a line pinned to its file's newest
--                       checked-in version, snapshot from the item. The rfq tables and their data
--                       stay. Idempotent; nothing to do on a database without RFQs.
--
-- Errors raise with HINT = the code, as in 0513: NOT_MEMBER, BAD_PATCH, BAD_KIND, BAD_STATUS,
-- NO_EDIT_PERMISSION, NOT_FOUND, NOT_CLAIMER, NO_OUTPUT, NO_MODULE_ACCESS, REFERENCED_BY_RELEASE.
--
-- Shared functions (can_read_vault_object, check_release_residue, backup_list_org_rows) are NOT
-- redefined here, so this file applies on top of whatever 0514 defines for them.
--
-- Additive only: release 5.12.0 never reads the new table or column.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Output requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS version_output_request (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  -- The version's vault when it was requested: the read rule.
  vault_id UUID NOT NULL REFERENCES vault(id) ON DELETE CASCADE,
  file_version_id UUID NOT NULL REFERENCES file_version(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CONSTRAINT version_output_request_kind_check CHECK (kind IN ('pdf', 'step', 'iges', 'stl', 'dxf')),
  -- NULL = the configuration the version was saved in (always NULL for a kind that takes none).
  configuration TEXT
    CONSTRAINT version_output_request_configuration_check
      CHECK (configuration IS NULL OR (btrim(configuration) <> '' AND length(configuration) <= 255)),
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT version_output_request_status_check
      CHECK (status IN ('pending', 'claimed', 'done', 'failed', 'cancelled')),
  requested_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  -- How many times the request was claimed. A fourth claim is refused: the request fails with
  -- TOO_MANY_ATTEMPTS instead (a version that crashes or hangs every machine that tries it).
  attempts INTEGER NOT NULL DEFAULT 0 CONSTRAINT version_output_request_attempts_check CHECK (attempts >= 0),
  finished_at TIMESTAMPTZ,
  error TEXT CONSTRAINT version_output_request_error_check CHECK (length(error) <= 2000),
  -- The order the request was made from, for context only.
  order_id UUID REFERENCES supply_order(id) ON DELETE SET NULL,
  CONSTRAINT version_output_request_claimed_at_check CHECK (status <> 'claimed' OR claimed_at IS NOT NULL)
);

-- One open request per version, kind and configuration.
CREATE UNIQUE INDEX IF NOT EXISTS version_output_request_file_version_id_kind_configuration_key
  ON version_output_request (file_version_id, kind, (COALESCE(configuration, '')))
  WHERE status IN ('pending', 'claimed');
CREATE INDEX IF NOT EXISTS version_output_request_org_id_status_idx
  ON version_output_request (org_id, status, requested_at);
CREATE INDEX IF NOT EXISTS version_output_request_file_version_id_idx ON version_output_request (file_version_id);
CREATE INDEX IF NOT EXISTS version_output_request_vault_id_idx ON version_output_request (vault_id);
CREATE INDEX IF NOT EXISTS version_output_request_requested_by_idx
  ON version_output_request (requested_by) WHERE requested_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS version_output_request_claimed_by_idx
  ON version_output_request (claimed_by) WHERE claimed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS version_output_request_order_id_idx
  ON version_output_request (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE version_output_request ENABLE ROW LEVEL SECURITY;

-- Written out in full, as in the baseline: anon holds nothing, clients only read.
REVOKE ALL ON TABLE version_output_request FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE version_output_request TO authenticated;
GRANT ALL ON TABLE version_output_request TO service_role;

-- A request follows its version's vault (schema 111's rule).
DROP POLICY IF EXISTS "version_output_request: users read" ON version_output_request;
CREATE POLICY "version_output_request: users read" ON version_output_request FOR SELECT
  TO authenticated
  USING (is_org_member(org_id) AND vault_id IN (SELECT my_accessible_vault_ids()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                        AND tablename = 'version_output_request') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE version_output_request;
  END IF;
END $$;

-- Whether a version has the output now: its drawing PDF, or the export of that kind in that
-- configuration (NULL = the saved one).
CREATE OR REPLACE FUNCTION has_version_output(p_file_version_id UUID, p_kind TEXT, p_configuration TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_kind = 'pdf'
    THEN EXISTS (SELECT 1 FROM drawing_pdf_render d WHERE d.file_version_id = p_file_version_id)
    ELSE EXISTS (SELECT 1 FROM file_version_output o
                  WHERE o.file_version_id = p_file_version_id AND o.kind = p_kind
                    AND COALESCE(o.configuration, '') = COALESCE(p_configuration, ''))
  END;
$$;

REVOKE ALL ON FUNCTION has_version_output(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Recording an output finishes every open request for it. SECURITY DEFINER: clients have no write
-- on the request table, and an output's writer may not be the request's claimer.
CREATE OR REPLACE FUNCTION trg_output_request_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row JSONB := to_jsonb(NEW);
  v_kind TEXT;
BEGIN
  v_kind := CASE WHEN TG_TABLE_NAME = 'drawing_pdf_render' THEN 'pdf' ELSE v_row ->> 'kind' END;
  UPDATE version_output_request r
     SET status = 'done', finished_at = NOW(), error = NULL
   WHERE r.file_version_id = NEW.file_version_id
     AND r.kind = v_kind
     AND COALESCE(r.configuration, '') = COALESCE(v_row ->> 'configuration', '')
     AND r.status IN ('pending', 'claimed');
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION trg_output_request_complete() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_file_version_output_complete_request ON file_version_output;
CREATE TRIGGER trg_file_version_output_complete_request
  AFTER INSERT ON file_version_output
  FOR EACH ROW EXECUTE FUNCTION trg_output_request_complete();

DROP TRIGGER IF EXISTS trg_drawing_pdf_render_complete_request ON drawing_pdf_render;
CREATE TRIGGER trg_drawing_pdf_render_complete_request
  AFTER INSERT ON drawing_pdf_render
  FOR EACH ROW EXECUTE FUNCTION trg_output_request_complete();

-- Requests outputs. Each item: {file_version_id, kind, configuration?, order_id?}. The kinds follow
-- the app's rules (outputKindsForPath / kindTakesConfiguration in src/lib/outputs/kinds.ts, which
-- supply_order_line_get_outputs() follows too): a drawing has pdf, dxf and step (no
-- configuration); a part or assembly step and stl (in a configuration) and iges (the saved one).
-- A configuration given for a kind that takes none is dropped. An item is skipped with a reason:
-- NOT_FOUND (no such version, a file in the trash or another organization), NO_VAULT_ACCESS,
-- BAD_KIND (the file cannot have that kind), EXISTS (the output is there). An open request for
-- the same output counts as existing. A malformed item, an unknown kind or an order_id that names
-- no order of the organization refuses the call (BAD_PATCH / BAD_KIND).
-- Returns {ok, created, existing, skipped: [{file_version_id, kind, reason}], requests: [rows]},
-- requests being the open request of every item that was created or already existed.
CREATE OR REPLACE FUNCTION version_output_request_create(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_kinds CONSTANT TEXT[] := ARRAY['pdf', 'step', 'iges', 'stl', 'dxf'];
  v_actor UUID;
  v_org_id UUID;
  v_el JSONB;
  v_kind TEXT;
  v_configuration TEXT;
  v_order_id UUID;
  v_fv_id UUID;
  v_fv file_version%ROWTYPE;
  v_file file%ROWTYPE;
  v_ext TEXT;
  v_reason TEXT;
  v_request version_output_request%ROWTYPE;
  v_created INTEGER := 0;
  v_existing INTEGER := 0;
  v_skipped JSONB := '[]'::jsonb;
  v_requests JSONB := '[]'::jsonb;
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of an organization'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_MEMBER';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'Items must be a list of at most 500 elements'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;

  -- Values are checked before anything is looked up, so a bad element refuses the whole call.
  FOR v_el IN SELECT e FROM jsonb_array_elements(p_items) e LOOP
    IF jsonb_typeof(v_el) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_el) k
                   WHERE k NOT IN ('file_version_id', 'kind', 'configuration', 'order_id')) THEN
      RAISE EXCEPTION 'An item is {file_version_id, kind, configuration, order_id}'
        USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
    END IF;
    IF jsonb_typeof(v_el -> 'kind') IS DISTINCT FROM 'string' OR NOT ((v_el ->> 'kind') = ANY (c_kinds)) THEN
      RAISE EXCEPTION 'An output kind is pdf, step, iges, stl or dxf'
        USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_KIND';
    END IF;
    PERFORM supply_order_validate_text(v_el -> 'configuration', 'Configuration', 255, false);
    IF v_el ? 'order_id' AND jsonb_typeof(v_el -> 'order_id') <> 'null' THEN
      BEGIN
        v_order_id := (v_el ->> 'order_id')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        v_order_id := NULL;
      END;
      IF jsonb_typeof(v_el -> 'order_id') <> 'string' OR v_order_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM supply_order o WHERE o.id = v_order_id AND o.org_id = v_org_id) THEN
        RAISE EXCEPTION 'order_id must name an order of your organization'
          USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
      END IF;
    END IF;
  END LOOP;

  FOR v_el IN SELECT e FROM jsonb_array_elements(p_items) e LOOP
    v_kind := v_el ->> 'kind';
    v_configuration := supply_order_validate_text(v_el -> 'configuration', 'Configuration', 255, false);
    v_order_id := CASE WHEN jsonb_typeof(v_el -> 'order_id') = 'string' THEN (v_el ->> 'order_id')::UUID END;
    v_reason := NULL;
    v_fv := NULL;
    v_file := NULL;
    BEGIN
      v_fv_id := (v_el ->> 'file_version_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_fv_id := NULL;
    END;

    IF v_fv_id IS NOT NULL THEN
      SELECT * INTO v_fv FROM file_version fv WHERE fv.id = v_fv_id;
      SELECT * INTO v_file FROM file f WHERE f.id = v_fv.file_id AND f.org_id = v_org_id AND f.deleted_at IS NULL;
    END IF;
    v_ext := lower(ltrim(COALESCE(v_file.extension, ''), '.'));
    IF v_fv.id IS NULL OR v_file.id IS NULL THEN
      v_reason := 'NOT_FOUND';
    ELSIF NOT (v_file.vault_id IN (SELECT my_accessible_vault_ids())) THEN
      v_reason := 'NO_VAULT_ACCESS';
    ELSIF NOT ((v_ext = 'slddrw' AND v_kind IN ('pdf', 'dxf', 'step'))
               OR (v_ext IN ('sldprt', 'sldasm') AND v_kind IN ('step', 'iges', 'stl'))) THEN
      v_reason := 'BAD_KIND';
    END IF;

    IF v_reason IS NULL THEN
      IF v_ext = 'slddrw' OR v_kind NOT IN ('step', 'stl') THEN
        v_configuration := NULL;
      END IF;
      IF has_version_output(v_fv.id, v_kind, v_configuration) THEN
        v_reason := 'EXISTS';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'file_version_id', v_el -> 'file_version_id', 'kind', v_kind, 'reason', v_reason));
      CONTINUE;
    END IF;

    v_request := NULL;
    INSERT INTO version_output_request (org_id, vault_id, file_version_id, kind, configuration, requested_by, order_id)
    VALUES (v_org_id, v_file.vault_id, v_fv.id, v_kind, v_configuration, v_actor, v_order_id)
    ON CONFLICT (file_version_id, kind, (COALESCE(configuration, ''))) WHERE status IN ('pending', 'claimed')
    DO NOTHING
    RETURNING * INTO v_request;

    IF v_request.id IS NOT NULL THEN
      v_created := v_created + 1;
    ELSE
      SELECT * INTO v_request FROM version_output_request r
       WHERE r.file_version_id = v_fv.id AND r.kind = v_kind
         AND COALESCE(r.configuration, '') = COALESCE(v_configuration, '')
         AND r.status IN ('pending', 'claimed');
      v_existing := v_existing + 1;
    END IF;
    IF NOT (v_requests @> jsonb_build_array(jsonb_build_object('id', v_request.id))) THEN
      v_requests := v_requests || jsonb_build_array(to_jsonb(v_request));
    END IF;
  END LOOP;

  -- Finished requests are kept for a while so the app can say what happened, then pruned.
  DELETE FROM version_output_request r
   WHERE r.org_id = v_org_id AND r.status IN ('done', 'failed', 'cancelled')
     AND r.finished_at < NOW() - INTERVAL '30 days';

  RETURN jsonb_build_object('ok', true, 'created', v_created, 'existing', v_existing,
                            'skipped', v_skipped, 'requests', v_requests);
END;
$$;

REVOKE ALL ON FUNCTION version_output_request_create(JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION version_output_request_create(JSONB) TO authenticated, service_role;

-- Claims up to p_limit (1 to 50) open requests of the caller's organization in vaults the caller
-- reads, oldest first: pending ones, and claims older than 15 minutes (a machine that stopped;
-- a working claimer keeps its claim fresh with version_output_request_touch()). Each claim counts
-- an attempt; a request that would be claimed a fourth time fails with TOO_MANY_ATTEMPTS instead.
-- Needs explorer edit, since the claimer records the outputs. Rows another claimer has locked are
-- skipped, so concurrent workers never claim the same request.
CREATE OR REPLACE FUNCTION version_output_request_claim(p_limit INTEGER DEFAULT 5)
RETURNS SETOF version_output_request
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_ids UUID[];
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of an organization'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_MEMBER';
  END IF;
  IF NOT has_team_permission('module:explorer', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to edit files'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NO_EDIT_PERMISSION';
  END IF;

  UPDATE version_output_request r
     SET status = 'failed', finished_at = NOW(), error = 'TOO_MANY_ATTEMPTS'
   WHERE r.id IN (
     SELECT x.id
       FROM version_output_request x
      WHERE x.org_id = v_org_id
        AND x.attempts >= 3
        AND (x.status = 'pending'
             OR (x.status = 'claimed' AND x.claimed_at < NOW() - INTERVAL '15 minutes'))
        AND x.vault_id IN (SELECT my_accessible_vault_ids())
        FOR UPDATE OF x SKIP LOCKED
   );

  SELECT COALESCE(array_agg(s.id), '{}'::UUID[]) INTO v_ids
    FROM (
      SELECT r.id
        FROM version_output_request r
       WHERE r.org_id = v_org_id
         AND r.attempts < 3
         AND (r.status = 'pending'
              OR (r.status = 'claimed' AND r.claimed_at < NOW() - INTERVAL '15 minutes'))
         AND r.vault_id IN (SELECT my_accessible_vault_ids())
       ORDER BY r.requested_at, r.id
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50)
         FOR UPDATE OF r SKIP LOCKED
    ) s;

  DELETE FROM version_output_request r
   WHERE r.org_id = v_org_id AND r.status IN ('done', 'failed', 'cancelled')
     AND r.finished_at < NOW() - INTERVAL '30 days';

  RETURN QUERY
    WITH claimed AS (
      UPDATE version_output_request r
         SET status = 'claimed', claimed_by = v_actor, claimed_at = NOW(), error = NULL,
             attempts = r.attempts + 1
       WHERE r.id = ANY (v_ids)
      RETURNING r.*
    )
    SELECT * FROM claimed c ORDER BY c.requested_at, c.id;
END;
$$;

REVOKE ALL ON FUNCTION version_output_request_claim(INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION version_output_request_claim(INTEGER) TO authenticated, service_role;

-- Keeps the caller's claim fresh while it works (a batch can outlast 15 minutes): claimed_at = now.
-- Only by its claimer (NOT_CLAIMER, also once a stale claim was taken over). A request of the
-- caller's that was finished or cancelled meanwhile is left as it is ({changed: false}), which
-- tells the worker to stop.
CREATE OR REPLACE FUNCTION version_output_request_touch(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_request version_output_request%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of an organization'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_MEMBER';
  END IF;
  SELECT * INTO v_request FROM version_output_request r
   WHERE r.id = p_id AND r.org_id = v_org_id
   FOR UPDATE;
  IF v_request.id IS NULL OR NOT (v_request.vault_id IN (SELECT my_accessible_vault_ids())) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  IF v_request.claimed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The request is not claimed by you'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NOT_CLAIMER';
  END IF;
  IF v_request.status <> 'claimed' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'request', to_jsonb(v_request));
  END IF;
  UPDATE version_output_request SET claimed_at = NOW() WHERE id = v_request.id
  RETURNING * INTO v_request;
  RETURN jsonb_build_object('ok', true, 'changed', true, 'request', to_jsonb(v_request));
END;
$$;

REVOKE ALL ON FUNCTION version_output_request_touch(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION version_output_request_touch(UUID) TO authenticated, service_role;

-- Hands a claimed request back (this machine cannot do it now): pending and unclaimed again, for
-- the next worker. The attempt it used still counts. Only by its claimer (NOT_CLAIMER); a request
-- of the caller's that was finished or cancelled meanwhile is left as it is ({changed: false}).
CREATE OR REPLACE FUNCTION version_output_request_release(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_request version_output_request%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of an organization'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_MEMBER';
  END IF;
  SELECT * INTO v_request FROM version_output_request r
   WHERE r.id = p_id AND r.org_id = v_org_id
   FOR UPDATE;
  IF v_request.id IS NULL OR NOT (v_request.vault_id IN (SELECT my_accessible_vault_ids())) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  IF v_request.claimed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The request is not claimed by you'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NOT_CLAIMER';
  END IF;
  IF v_request.status <> 'claimed' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'request', to_jsonb(v_request));
  END IF;
  UPDATE version_output_request
     SET status = 'pending', claimed_by = NULL, claimed_at = NULL
   WHERE id = v_request.id
  RETURNING * INTO v_request;
  RETURN jsonb_build_object('ok', true, 'changed', true, 'request', to_jsonb(v_request));
END;
$$;

REVOKE ALL ON FUNCTION version_output_request_release(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION version_output_request_release(UUID) TO authenticated, service_role;

-- Finishes a claimed request: done (only once the output is recorded, NO_OUTPUT otherwise; the
-- output's own trigger usually got there first) or failed with an error text. Only by its claimer
-- (NOT_CLAIMER, also when a stale claim was taken over). A request of the caller's that is
-- already finished or was cancelled is left as it is ({changed: false}).
CREATE OR REPLACE FUNCTION version_output_request_finish(p_id UUID, p_status TEXT, p_error TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_status TEXT;
  v_request version_output_request%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of an organization'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_MEMBER';
  END IF;
  v_status := lower(btrim(COALESCE(p_status, '')));
  IF v_status NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'A request finishes as done or failed'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_STATUS';
  END IF;

  SELECT * INTO v_request FROM version_output_request r
   WHERE r.id = p_id AND r.org_id = v_org_id
   FOR UPDATE;
  IF v_request.id IS NULL OR NOT (v_request.vault_id IN (SELECT my_accessible_vault_ids())) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  IF v_request.claimed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'The request is not claimed by you'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NOT_CLAIMER';
  END IF;
  IF v_request.status <> 'claimed' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'request', to_jsonb(v_request));
  END IF;
  IF v_status = 'done' AND NOT has_version_output(v_request.file_version_id, v_request.kind, v_request.configuration) THEN
    RAISE EXCEPTION 'The output is not recorded'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NO_OUTPUT';
  END IF;

  UPDATE version_output_request
     SET status = v_status, finished_at = NOW(),
         error = CASE WHEN v_status = 'failed' THEN left(NULLIF(btrim(COALESCE(p_error, '')), ''), 2000) END
   WHERE id = v_request.id
  RETURNING * INTO v_request;
  RETURN jsonb_build_object('ok', true, 'changed', true, 'request', to_jsonb(v_request));
END;
$$;

REVOKE ALL ON FUNCTION version_output_request_finish(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION version_output_request_finish(UUID, TEXT, TEXT) TO authenticated, service_role;

-- Cancels open (pending or claimed) requests of the caller's organization: the requester's own,
-- or any for an administrator. Other ids are left alone. Returns {ok, cancelled}.
CREATE OR REPLACE FUNCTION version_output_request_cancel(p_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_admin BOOLEAN;
  v_cancelled INTEGER;
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of an organization'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_MEMBER';
  END IF;
  v_admin := is_org_admin();

  UPDATE version_output_request r
     SET status = 'cancelled', finished_at = NOW()
   WHERE r.org_id = v_org_id
     AND r.id = ANY (COALESCE(p_ids, '{}'::UUID[]))
     AND r.status IN ('pending', 'claimed')
     AND (v_admin OR r.requested_by = v_actor);
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'cancelled', v_cancelled);
END;
$$;

REVOKE ALL ON FUNCTION version_output_request_cancel(UUID[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION version_output_request_cancel(UUID[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Hidden lines of an order
-- ---------------------------------------------------------------------------

-- [{vault_id, vault_name, count}] for the lines of an order the caller cannot read, per vault the
-- caller lacks (the line's vault, or its drawing's). A line missing both of its vaults counts under
-- each, so the counts may add up to more than the hidden lines. vault_name is NULL for a deleted
-- vault. A member with the orders module; an order of another organization is NOT_FOUND.
CREATE OR REPLACE FUNCTION supply_order_count_hidden_lines(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id UUID;
  v_result JSONB;
BEGIN
  v_org_id := supply_order_require_module();
  IF NOT EXISTS (SELECT 1 FROM supply_order o WHERE o.id = p_order_id AND o.org_id = v_org_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;

  WITH visible AS (SELECT my_accessible_vault_ids() AS id),
  hidden AS (
    SELECT l.id AS line_id, l.vault_id
      FROM supply_order_line l
     WHERE l.order_id = p_order_id AND NOT (l.vault_id IN (SELECT id FROM visible))
    UNION
    SELECT l.id, l.drawing_vault_id
      FROM supply_order_line l
     WHERE l.order_id = p_order_id AND l.drawing_vault_id IS NOT NULL
       AND NOT (l.drawing_vault_id IN (SELECT id FROM visible))
  ),
  per_vault AS (
    SELECT h.vault_id, count(*)::INTEGER AS n FROM hidden h GROUP BY h.vault_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('vault_id', p.vault_id, 'vault_name', v.name, 'count', p.n)
                            ORDER BY v.name NULLS LAST, p.vault_id), '[]'::jsonb)
    INTO v_result
    FROM per_vault p
    LEFT JOIN vault v ON v.id = p.vault_id AND v.org_id = v_org_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION supply_order_count_hidden_lines(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_count_hidden_lines(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A released version's references are kept
-- ---------------------------------------------------------------------------
-- Walks up from the version being deleted through file_version_reference (child -> parent) and
-- refuses when any version above it is released, other than itself, with its file live (not in
-- the trash) and its organization present. A cascade from deleting the released version's own
-- file, vault or organization finds that file (or organization) row gone and goes through.
-- SECURITY DEFINER so the walk sees every reference and version whatever the caller's RLS.
CREATE OR REPLACE FUNCTION trg_file_version_release_closure_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_release RECORD;
  v_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM file_version_reference e WHERE e.child_version_id = OLD.id) THEN
    RETURN OLD;
  END IF;

  WITH RECURSIVE above(version_id) AS (
    SELECT e.parent_version_id FROM file_version_reference e WHERE e.child_version_id = OLD.id
    UNION
    SELECT e.parent_version_id
      FROM file_version_reference e
      JOIN above a ON e.child_version_id = a.version_id
  )
  SELECT pv.version, pf.file_name, pf.vault_id INTO v_release
    FROM above a
    JOIN file_version pv ON pv.id = a.version_id
    JOIN file pf ON pf.id = pv.file_id AND pf.deleted_at IS NULL
    JOIN organization o ON o.id = pf.org_id
   WHERE pv.released_at IS NOT NULL AND pv.id <> OLD.id
   ORDER BY pv.released_at, pv.id
   LIMIT 1;

  IF FOUND THEN
    -- The message names the version being deleted, and the release only to a caller who can read
    -- its vault (an administrator reads every vault): never a file of a vault the caller lacks.
    SELECT f.file_name INTO v_name FROM file f WHERE f.id = OLD.file_id;
    IF v_release.vault_id IN (SELECT my_accessible_vault_ids()) THEN
      RAISE EXCEPTION 'Version % of % is referenced by released version % of %, and is kept',
        OLD.version, COALESCE(v_name, 'this file'), v_release.version, v_release.file_name
        USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'REFERENCED_BY_RELEASE';
    END IF;
    RAISE EXCEPTION 'Version % of % is referenced by a released version, and is kept',
      OLD.version, COALESCE(v_name, 'this file')
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'REFERENCED_BY_RELEASE';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION trg_file_version_release_closure_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_file_version_release_closure_guard ON file_version;
CREATE TRIGGER trg_file_version_release_closure_guard
  BEFORE DELETE ON file_version
  FOR EACH ROW EXECUTE FUNCTION trg_file_version_release_closure_guard();

-- ---------------------------------------------------------------------------
-- RFQs become quote orders
-- ---------------------------------------------------------------------------

ALTER TABLE supply_order
  ADD COLUMN IF NOT EXISTS imported_from_rfq_id UUID
    CONSTRAINT supply_order_imported_from_rfq_id_key UNIQUE;

-- Every RFQ not imported yet, oldest first per organization, numbered through
-- supply_order_create_row() (the counter). Status: draft / pending_files / generating / ready ->
-- draft; sent / awaiting_quote / quoted / awarded -> sent; completed -> closed; cancelled ->
-- cancelled. Title: "<rfq_number> <title>". Notes: the supplier notes only. The internal notes are
-- not copied, because an order's notes go to the supplier in its export (order.json); they stay on
-- the rfq row, which imported_from_rfq_id names. Supplier: the awarded supplier. Due date as is.
-- Each item, in its RFQ's order, becomes a line pinned to its file's newest version, with the
-- item's part number, description and revision as the snapshot (else the version's), its quantity,
-- and its notes, material, finish and unit as the line's notes. An item with no file, a file with
-- no version, or a second item of the same file keeps a snapshot-only line (no file or version, as
-- a purged line); one with no file takes the vault of the RFQ's first item with a file, else the
-- organization's oldest vault (an organization with no vault keeps such items on the RFQ only).
-- A draft (or cancelled) order's lines send the default kinds (a drawing pdf, a part or assembly
-- step, another file its source); a sent or closed order's lines record that BluePLM has no
-- outputs on file for them (no kinds, sent_outputs []). Each line's vault is its file's.
-- BEGIN RFQ IMPORT
DO $rfq_import$
DECLARE
  r RECORD;
  v_order supply_order%ROWTYPE;
  v_status TEXT;
  v_supplier_name TEXT;
  v_title TEXT;
  v_when TIMESTAMPTZ;
  v_vault UUID;
BEGIN
  FOR r IN
    SELECT q.*, q.status::TEXT AS status_text, s.id AS supplier_row_id, s.name AS supplier_row_name,
           u.id AS creator_id
      FROM rfq q
      LEFT JOIN supplier s ON s.id = q.awarded_supplier_id AND s.org_id = q.org_id
      LEFT JOIN app_user u ON u.id = q.created_by
     WHERE NOT EXISTS (SELECT 1 FROM supply_order o WHERE o.imported_from_rfq_id = q.id)
     ORDER BY q.org_id, q.created_at NULLS FIRST, q.rfq_number, q.id
  LOOP
    v_status := CASE
      WHEN r.status_text IN ('sent', 'awaiting_quote', 'quoted', 'awarded') THEN 'sent'
      WHEN r.status_text = 'completed' THEN 'closed'
      WHEN r.status_text = 'cancelled' THEN 'cancelled'
      ELSE 'draft'
    END;
    v_title := left(COALESCE(NULLIF(btrim(btrim(COALESCE(r.rfq_number, '')) || ' ' || btrim(COALESCE(r.title, ''))), ''), 'RFQ'), 200);
    v_supplier_name := left(r.supplier_row_name, 200);
    v_when := COALESCE(r.updated_at, r.created_at, NOW());

    v_order := supply_order_create_row(r.org_id, r.creator_id, v_title, 'quote', r.supplier_row_id,
                                       v_supplier_name, r.due_date,
                                       left(NULLIF(btrim(COALESCE(r.supplier_notes, '')), ''), 10000));

    UPDATE supply_order
       SET imported_from_rfq_id = r.id,
           status = v_status,
           created_at = COALESCE(r.created_at, created_at),
           sent_by = CASE WHEN v_status IN ('sent', 'closed') THEN r.creator_id END,
           sent_at = CASE WHEN v_status IN ('sent', 'closed')
                          THEN COALESCE((SELECT min(rs.sent_at) FROM rfq_supplier rs WHERE rs.rfq_id = r.id), v_when) END,
           closed_at = CASE WHEN v_status = 'closed' THEN v_when END,
           cancelled_at = CASE WHEN v_status = 'cancelled' THEN v_when END
     WHERE id = v_order.id;

    -- The vault for items with no file.
    SELECT f.vault_id INTO v_vault
      FROM rfq_item i JOIN file f ON f.id = i.file_id AND f.org_id = r.org_id
     WHERE i.rfq_id = r.id
     ORDER BY i.sort_order, i.line_number, i.id
     LIMIT 1;
    IF v_vault IS NULL THEN
      SELECT v.id INTO v_vault FROM vault v WHERE v.org_id = r.org_id ORDER BY v.created_at NULLS LAST, v.id LIMIT 1;
    END IF;

    INSERT INTO supply_order_line (order_id, org_id, position, vault_id, file_id, file_version_id, quantity,
                                   output_kinds, notes, file_name, part_number, description, revision, version,
                                   sent_outputs, missing_kinds, added_by, added_at)
    SELECT v_order.id, r.org_id, row_number() OVER (ORDER BY x.sort_order, x.line_number, x.id),
           COALESCE(x.f_vault, v_vault),
           CASE WHEN x.pinned THEN x.f_id END,
           CASE WHEN x.pinned THEN x.fv_id END,
           LEAST(GREATEST(COALESCE(x.quantity, 1), 1), 1000000000),
           CASE WHEN NOT x.pinned OR v_status IN ('sent', 'closed') THEN '{}'::TEXT[]
                WHEN x.f_ext = 'slddrw' THEN ARRAY['pdf']
                WHEN x.f_ext IN ('sldprt', 'sldasm') THEN ARRAY['step']
                ELSE ARRAY['source'] END,
           NULLIF(left(concat_ws(E'\n',
                                 NULLIF(btrim(COALESCE(x.notes, '')), ''),
                                 'Material: ' || NULLIF(btrim(COALESCE(x.material, '')), ''),
                                 'Finish: ' || NULLIF(btrim(COALESCE(x.finish, '')), ''),
                                 CASE WHEN lower(btrim(COALESCE(x.uom, ''))) NOT IN ('', 'each')
                                      THEN 'Unit: ' || btrim(x.uom) END), 2000), ''),
           left(COALESCE(x.f_name, NULLIF(btrim(COALESCE(x.part_number, '')), ''),
                         NULLIF(btrim(COALESCE(x.description, '')), ''), 'item-' || x.line_number), 255),
           COALESCE(NULLIF(btrim(COALESCE(x.part_number, '')), ''), CASE WHEN x.pinned THEN x.fv_part_number END),
           COALESCE(NULLIF(btrim(COALESCE(x.description, '')), ''), CASE WHEN x.pinned THEN x.fv_description END),
           COALESCE(NULLIF(btrim(COALESCE(x.revision, '')), ''), CASE WHEN x.pinned THEN x.fv_revision END),
           CASE WHEN x.pinned THEN x.fv_version END,
           CASE WHEN v_status IN ('sent', 'closed') THEN '[]'::jsonb END,
           CASE WHEN v_status IN ('sent', 'closed') THEN '{}'::TEXT[] END,
           r.creator_id,
           COALESCE(x.created_at, NOW())
      FROM (
        SELECT i.*, f.id AS f_id, f.vault_id AS f_vault, f.file_name AS f_name,
               lower(ltrim(COALESCE(f.extension, ''), '.')) AS f_ext,
               fv.id AS fv_id, fv.version AS fv_version, fv.revision AS fv_revision,
               COALESCE(fv.part_number, f.part_number) AS fv_part_number,
               COALESCE(fv.description, f.description) AS fv_description,
               fv.id IS NOT NULL
                 AND row_number() OVER (PARTITION BY f.id ORDER BY i.sort_order, i.line_number, i.id) = 1 AS pinned
          FROM rfq_item i
          LEFT JOIN file f ON f.id = i.file_id AND f.org_id = r.org_id
          LEFT JOIN LATERAL (
            SELECT v.* FROM file_version v WHERE v.file_id = f.id ORDER BY v.version DESC LIMIT 1
          ) fv ON true
         WHERE i.rfq_id = r.id
      ) x
     WHERE COALESCE(x.f_vault, v_vault) IS NOT NULL;
  END LOOP;
END
$rfq_import$;
-- END RFQ IMPORT

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
-- The helpers (has_version_output) are executable by no client and are not SECURITY DEFINER, so
-- only the manifest lists them. The requirements are identifiers: sql_strip_noise() drops string
-- literals before matching.
INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('version_output_request_create(jsonb)', '10-source-files', 515),
  ('version_output_request_claim(integer)', '10-source-files', 515),
  ('version_output_request_touch(uuid)', '10-source-files', 515),
  ('version_output_request_release(uuid)', '10-source-files', 515),
  ('version_output_request_finish(uuid, text, text)', '10-source-files', 515),
  ('version_output_request_cancel(uuid[])', '10-source-files', 515),
  ('trg_output_request_complete()', '10-source-files', 515),
  ('trg_file_version_release_closure_guard()', '10-source-files', 515),
  ('supply_order_count_hidden_lines(uuid)', '30-supply-chain', 515)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('table', 'version_output_request', '10-source-files', NULL, NULL, 515),
  ('function', 'has_version_output(uuid,text,text)', '10-source-files', NULL,
    'drawing_pdf_render && file_version_output', 515),
  ('function', 'trg_output_request_complete()', '10-source-files', NULL,
    'version_output_request && TG_TABLE_NAME', 515),
  ('function', 'version_output_request_create(jsonb)', '10-source-files', NULL,
    'my_actor_id && my_accessible_vault_ids && has_version_output && org_id && deleted_at', 515),
  ('function', 'version_output_request_claim(integer)', '10-source-files', NULL,
    'my_actor_id && has_team_permission && my_accessible_vault_ids && SKIP LOCKED && attempts && org_id', 515),
  ('function', 'version_output_request_touch(uuid)', '10-source-files', NULL,
    'my_actor_id && my_accessible_vault_ids && claimed_by && claimed_at && org_id', 515),
  ('function', 'version_output_request_release(uuid)', '10-source-files', NULL,
    'my_actor_id && my_accessible_vault_ids && claimed_by && org_id', 515),
  ('function', 'version_output_request_finish(uuid,text,text)', '10-source-files', NULL,
    'my_actor_id && my_accessible_vault_ids && has_version_output && claimed_by && org_id', 515),
  ('function', 'version_output_request_cancel(uuid[])', '10-source-files', NULL,
    'my_actor_id && is_org_admin && requested_by && org_id', 515),
  ('function', 'supply_order_count_hidden_lines(uuid)', '30-supply-chain', NULL,
    'supply_order_require_module && my_accessible_vault_ids && org_id', 515),
  ('function', 'trg_file_version_release_closure_guard()', '10-source-files', NULL,
    'file_version_reference && released_at && deleted_at && my_accessible_vault_ids', 515)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 515 $$;
-- Must equal VERSION_DESCRIPTIONS[515] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Orders follow-ups. version_output_request asks for an output a version lacks (pdf, step, iges, stl, '
  'dxf): version_output_request_create() requests the kinds the file can have, '
  'version_output_request_claim() hands them to a desktop with explorer edit and the vault (a claim '
  'older than 15 minutes is taken again; _touch() keeps it fresh, _release() hands it back, and a '
  'fourth claim fails it with TOO_MANY_ATTEMPTS), version_output_request_finish() and _cancel() close '
  'them, and recording the output marks its requests done. supply_order_count_hidden_lines() says per vault '
  'how many lines of an order the caller cannot read. A version a released version references is '
  'never deleted while that release is live (REFERENCED_BY_RELEASE). RFQs are imported as quote '
  'orders (supply_order.imported_from_rfq_id); the rfq tables stay.'
$$;
