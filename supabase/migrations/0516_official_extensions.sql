-- =====================================================================
-- 0516_official_extensions.sql: official extensions (schema 515 -> 516)
-- =====================================================================
-- Reviews, Inspection and Orders become official extensions: built into the app, installed or
-- uninstalled per organization from Settings > Extensions, and independent of each other. Plan and
-- coupling map: .cursor/plans/official-extensions.plan.md.
--
--   organization.settings.extensions   { "<id>": { installed, changed_at, changed_by } }. Only an
--                       explicit installed = false uninstalls, so every organization before this
--                       release and every new one has all three installed.
--   is_org_extension_installed(org, id) reads it (for definer functions only; clients read their
--                       own organization row).
--   org_extension_set_installed(id, installed)  the only writer: an admin, a known id, the
--                       dependency rules (none between the three today), one key changed in place.
--   trg_official_extension_guard        refuses a write to an uninstalled extension's tables
--                       (hint EXTENSION_NOT_INSTALLED) when a signed-in caller makes it directly: a
--                       client statement or an RPC body (pg_trigger_depth() = 1). Writes that come
--                       from other triggers (lost-reviewer withdrawal, the re-settle when a file
--                       is purged, FK cascades, counters) and server callers (no auth.uid(): a
--                       restore, pg_cron, the SQL editor) pass, so core flows never break.
--                       Deletes are never refused. Nothing is dropped: reinstalling brings it all
--                       back. inspection_characteristic_version is not guarded: check-in copies
--                       the live rows into it, and they cannot change while Inspection is out.
--   can_access_module()                 answers false for the module of an uninstalled extension
--                       (orders), admins included, so Orders' RLS and RPCs agree with the hidden
--                       module. The Reviews view is not Reviews': workflow gate approvals (core)
--                       are decided there too.
--   workflow_transition_execute()/apply()  the drawing release gate (509) is Reviews': without
--                       Reviews a drawing releases with no review, and is never recorded as forced.
--
-- Backups are unchanged on purpose: an uninstalled extension's rows stay, so a backup keeps them
-- and a restore plus a reinstall is complete (no API change).

-- ===========================================
-- 1. The install state
-- ===========================================

CREATE OR REPLACE FUNCTION is_org_extension_installed(p_org_id UUID, p_extension_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
             WHEN jsonb_typeof(o.settings -> 'extensions' -> p_extension_id -> 'installed') = 'boolean'
             THEN (o.settings -> 'extensions' -> p_extension_id ->> 'installed')::boolean
           END
    FROM organization o WHERE o.id = p_org_id
  ), true);
$$;

-- Only the definer functions in this file call it; a client reads its own organization row.
REVOKE ALL ON FUNCTION is_org_extension_installed(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- The extensions the server knows, and the ones each needs (hard dependencies). Keep in step with
-- OFFICIAL_EXTENSIONS in src/lib/officialExtensions/manifest.ts.
CREATE OR REPLACE FUNCTION official_extension_list_dependencies()
RETURNS TABLE (extension_id TEXT, needs TEXT[])
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  VALUES ('blueplm.reviews'::text, ARRAY[]::text[]),
         ('blueplm.inspection'::text, ARRAY[]::text[]),
         ('blueplm.orders'::text, ARRAY[]::text[]);
$$;

REVOKE ALL ON FUNCTION official_extension_list_dependencies() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION org_extension_set_installed(p_extension_id TEXT, p_installed BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_settings JSONB;
  v_blocker TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_ADMIN',
      'error_message', 'You must be signed in');
  END IF;

  SELECT org_id INTO v_org_id FROM app_user WHERE id = v_user_id;
  IF v_org_id IS NULL OR NOT is_org_admin() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_ADMIN',
      'error_message', 'Only an admin can install or uninstall extensions');
  END IF;

  IF p_installed IS NULL OR NOT EXISTS (
    SELECT 1 FROM official_extension_list_dependencies() d WHERE d.extension_id = p_extension_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNKNOWN_EXTENSION',
      'error_message', format('Unknown extension %s', p_extension_id));
  END IF;

  -- One settings write at a time for the organization, so two admins cannot pass each other's
  -- dependency checks.
  PERFORM 1 FROM organization WHERE id = v_org_id FOR UPDATE;

  IF p_installed THEN
    SELECT n INTO v_blocker
      FROM official_extension_list_dependencies() d, unnest(d.needs) AS n
     WHERE d.extension_id = p_extension_id AND NOT is_org_extension_installed(v_org_id, n)
     LIMIT 1;
    IF v_blocker IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'DEPENDENCY_MISSING',
        'error_message', format('%s needs %s', p_extension_id, v_blocker), 'extension_id', v_blocker);
    END IF;
  ELSE
    SELECT d.extension_id INTO v_blocker
      FROM official_extension_list_dependencies() d
     WHERE p_extension_id = ANY (d.needs) AND is_org_extension_installed(v_org_id, d.extension_id)
     LIMIT 1;
    IF v_blocker IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'DEPENDENCY_INSTALLED',
        'error_message', format('%s needs %s', v_blocker, p_extension_id), 'extension_id', v_blocker);
    END IF;
  END IF;

  UPDATE organization o
     SET settings = jsonb_set(
           COALESCE(o.settings, '{}'::jsonb),
           '{extensions}',
           CASE WHEN jsonb_typeof(o.settings -> 'extensions') = 'object' THEN o.settings -> 'extensions'
                ELSE '{}'::jsonb END
             || jsonb_build_object(p_extension_id, jsonb_build_object(
                  'installed', p_installed, 'changed_at', now(), 'changed_by', v_user_id)),
           true)
   WHERE o.id = v_org_id
  RETURNING o.settings INTO v_settings;

  RETURN jsonb_build_object('success', true, 'settings', v_settings);
END;
$$;

REVOKE ALL ON FUNCTION org_extension_set_installed(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION org_extension_set_installed(TEXT, BOOLEAN) TO authenticated;

-- ===========================================
-- 2. Writes to an uninstalled extension are refused
-- ===========================================
-- TG_ARGV[0] is the extension id. A file_comment is Reviews' only when it names a review, and only
-- a new link is refused: an old review comment can still be edited or resolved.

CREATE OR REPLACE FUNCTION trg_official_extension_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_extension TEXT := TG_ARGV[0];
  v_org_id UUID;
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'file_comment' THEN
    IF NEW.review_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.review_id IS NOT DISTINCT FROM NEW.review_id) THEN
      RETURN NEW;
    END IF;
    SELECT r.org_id INTO v_org_id FROM review r WHERE r.id = NEW.review_id;
  ELSE
    v_org_id := NEW.org_id;
  END IF;

  IF v_org_id IS NOT NULL AND NOT is_org_extension_installed(v_org_id, v_extension) THEN
    RAISE EXCEPTION '% is not installed for this organization', v_extension
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'EXTENSION_NOT_INSTALLED';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION trg_official_extension_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_review_extension_guard ON review;
CREATE TRIGGER trg_review_extension_guard BEFORE INSERT OR UPDATE ON review
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.reviews');
DROP TRIGGER IF EXISTS trg_review_item_extension_guard ON review_item;
CREATE TRIGGER trg_review_item_extension_guard BEFORE INSERT OR UPDATE ON review_item
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.reviews');
DROP TRIGGER IF EXISTS trg_review_round_extension_guard ON review_round;
CREATE TRIGGER trg_review_round_extension_guard BEFORE INSERT OR UPDATE ON review_round
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.reviews');
DROP TRIGGER IF EXISTS trg_review_round_item_extension_guard ON review_round_item;
CREATE TRIGGER trg_review_round_item_extension_guard BEFORE INSERT OR UPDATE ON review_round_item
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.reviews');
DROP TRIGGER IF EXISTS trg_review_response_extension_guard ON review_response;
CREATE TRIGGER trg_review_response_extension_guard BEFORE INSERT OR UPDATE ON review_response
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.reviews');
DROP TRIGGER IF EXISTS trg_review_decision_extension_guard ON review_decision;
CREATE TRIGGER trg_review_decision_extension_guard BEFORE INSERT OR UPDATE ON review_decision
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.reviews');
DROP TRIGGER IF EXISTS trg_file_comment_extension_guard ON file_comment;
CREATE TRIGGER trg_file_comment_extension_guard BEFORE INSERT OR UPDATE ON file_comment
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.reviews');

DROP TRIGGER IF EXISTS trg_inspection_characteristic_extension_guard ON inspection_characteristic;
CREATE TRIGGER trg_inspection_characteristic_extension_guard BEFORE INSERT OR UPDATE ON inspection_characteristic
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.inspection');
DROP TRIGGER IF EXISTS trg_inspection_report_extension_guard ON inspection_report;
CREATE TRIGGER trg_inspection_report_extension_guard BEFORE INSERT OR UPDATE ON inspection_report
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.inspection');
DROP TRIGGER IF EXISTS trg_inspection_template_extension_guard ON inspection_template;
CREATE TRIGGER trg_inspection_template_extension_guard BEFORE INSERT OR UPDATE ON inspection_template
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.inspection');

DROP TRIGGER IF EXISTS trg_supply_order_extension_guard ON supply_order;
CREATE TRIGGER trg_supply_order_extension_guard BEFORE INSERT OR UPDATE ON supply_order
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.orders');
DROP TRIGGER IF EXISTS trg_supply_order_line_extension_guard ON supply_order_line;
CREATE TRIGGER trg_supply_order_line_extension_guard BEFORE INSERT OR UPDATE ON supply_order_line
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.orders');
DROP TRIGGER IF EXISTS trg_supply_order_number_counter_extension_guard ON supply_order_number_counter;
CREATE TRIGGER trg_supply_order_number_counter_extension_guard BEFORE INSERT OR UPDATE ON supply_order_number_counter
  FOR EACH ROW EXECUTE FUNCTION trg_official_extension_guard('blueplm.orders');

-- ===========================================
-- 3. can_access_module(): an uninstalled extension's module is closed
-- ===========================================
-- Migration 502's function with the extension check before the admin shortcut.

CREATE OR REPLACE FUNCTION can_access_module(
  p_module_id TEXT,
  p_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_extension TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'can_access_module answers for the calling user only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT org_id INTO v_org_id FROM app_user WHERE id = v_user_id;
  IF v_org_id IS NULL THEN
    RETURN false;
  END IF;

  -- Schema 516: the modules official extensions add (manifest `contributes.modules`).
  -- Not 'reviews': the Reviews view also holds workflow gate approvals, which are core.
  v_extension := CASE p_module_id
    WHEN 'orders' THEN 'blueplm.orders'
  END;
  IF v_extension IS NOT NULL AND NOT is_org_extension_installed(v_org_id, v_extension) THEN
    RETURN false;
  END IF;

  IF is_org_admin(v_user_id) THEN
    RETURN true;
  END IF;

  -- Unrestricted until an admin adds a subject
  IF NOT EXISTS (
    SELECT 1 FROM module_access ma
    WHERE ma.org_id = v_org_id AND ma.module_id = p_module_id
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM module_access ma
    WHERE ma.org_id = v_org_id
      AND ma.module_id = p_module_id
      AND ma.user_id = v_user_id
  ) OR EXISTS (
    SELECT 1 FROM module_access ma
    JOIN team_member tm ON tm.team_id = ma.team_id
    WHERE ma.org_id = v_org_id
      AND ma.module_id = p_module_id
      AND tm.user_id = v_user_id
  );
END;
$$;

-- ===========================================
-- 4. The drawing release gate is Reviews'
-- ===========================================
-- Migration 509's functions, changed only where marked "Schema 516". CREATE OR REPLACE keeps their
-- grants.

CREATE OR REPLACE FUNCTION workflow_transition_apply(
  p_file_id UUID,
  p_transition_id UUID,
  p_comment TEXT,
  p_approvals JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_file file%ROWTYPE;
  v_transition workflow_transition%ROWTYPE;
  v_from_state workflow_state%ROWTYPE;
  v_to_state workflow_state%ROWTYPE;
  v_workflow_name TEXT;
  v_user_email TEXT;
  v_scheme revision_scheme;
  v_new_revision TEXT;
  v_legacy_state TEXT;
  v_actor UUID;
  v_org_id UUID;
  v_attempt workflow_gate_review%ROWTYPE;
  v_version file_version%ROWTYPE;
  v_releaser UUID;
  v_mode TEXT;
  v_comment TEXT;
  v_note TEXT;
  v_review_id UUID;
  v_released_id UUID;
  v_forced BOOLEAN := false;
  v_approvals JSONB;
BEGIN
  v_actor := my_actor_id();
  v_org_id := file_require_access(p_file_id);

  -- Schema 509: the row lock check-in also takes, held to the end of the transaction.
  SELECT * INTO v_file FROM file WHERE id = p_file_id FOR UPDATE;

  -- The transition has to belong to a workflow of the file's own organization (module 10).
  SELECT wt.* INTO v_transition
  FROM workflow_transition wt
  JOIN workflow_template wtpl ON wtpl.id = wt.workflow_id
  WHERE wt.id = p_transition_id AND wtpl.org_id = v_org_id;

  SELECT * INTO v_to_state FROM workflow_state WHERE id = v_transition.to_state_id;
  SELECT * INTO v_from_state FROM workflow_state WHERE id = v_transition.from_state_id;
  SELECT name INTO v_workflow_name FROM workflow_template WHERE id = v_transition.workflow_id;
  SELECT email INTO v_user_email FROM app_user WHERE id = v_actor;

  IF v_transition.id IS NULL OR v_to_state.id IS NULL THEN
    RAISE EXCEPTION 'Transition not found'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_new_revision := v_file.revision;
  IF COALESCE(v_to_state.is_revision_auto_incremented, false) THEN
    SELECT COALESCE(revision_scheme, 'letter') INTO v_scheme
    FROM organization WHERE id = v_file.org_id;
    v_new_revision := revision_get_next(v_file.revision, COALESCE(v_scheme, 'letter'));
  END IF;

  v_approvals := p_approvals;

  IF COALESCE(v_to_state.releases_version, false) THEN
    IF jsonb_typeof(p_approvals) = 'object' AND p_approvals ? 'attempt_id' THEN
      SELECT g.* INTO v_attempt FROM workflow_gate_review g
       WHERE g.attempt_id = (p_approvals ->> 'attempt_id')::uuid
         AND g.file_id = p_file_id AND g.transition_id = p_transition_id AND g.org_id = v_org_id
       ORDER BY g.requested_at
       LIMIT 1;
    END IF;

    IF v_attempt.release_mode IS NOT NULL THEN
      SELECT fv.* INTO v_version FROM file_version fv
       WHERE fv.id = v_attempt.release_file_version_id AND fv.file_id = p_file_id
       FOR SHARE;
      v_releaser := v_attempt.requested_by;
      v_mode := v_attempt.release_mode;
      v_comment := v_attempt.release_comment;
    ELSE
      SELECT fv.* INTO v_version FROM file_version fv
       WHERE fv.file_id = p_file_id
       ORDER BY fv.version DESC
       LIMIT 1
       FOR SHARE;
      v_releaser := v_actor;
      v_mode := CASE WHEN current_setting('blueplm.release_legacy', true) = 'on' THEN 'legacy' END;
      v_comment := p_comment;
    END IF;

    IF v_version.id IS NOT NULL AND v_version.released_at IS NULL THEN
      SELECT ri.review_id INTO v_review_id
        FROM review_item ri JOIN review r ON r.id = ri.review_id
       WHERE ri.file_version_id = v_version.id AND ri.outcome = 'approved'
         AND r.status <> 'cancelled' AND r.org_id = v_org_id
       ORDER BY (r.status = 'approved') DESC, r.completed_at DESC NULLS LAST, r.created_at DESC
       LIMIT 1;

      -- Schema 516: a drawing released without a review is forced only while Reviews is installed.
      v_forced := v_review_id IS NULL AND lower(ltrim(COALESCE(v_file.extension, ''), '.')) = 'slddrw'
                  AND is_org_extension_installed(v_org_id, 'blueplm.reviews');
      v_note := NULLIF(btrim(COALESCE(v_comment, '')), '');
      IF v_forced AND v_mode = 'legacy' THEN
        v_note := 'Released by a client without the release check' || COALESCE(': ' || v_note, '');
      END IF;

      PERFORM set_config('blueplm.release_write', 'on', true);
      UPDATE file_version
         SET released_at = NOW(),
             released_by = v_releaser,
             release_forced = v_forced,
             release_review_id = v_review_id,
             release_note = v_note,
             release_revision = v_new_revision
       WHERE id = v_version.id AND released_at IS NULL;
      PERFORM set_config('blueplm.release_write', 'off', true);
      v_released_id := v_version.id;

      IF v_forced THEN
        v_approvals := CASE
          WHEN p_approvals IS NULL THEN jsonb_build_object('forced_release', true)
          WHEN jsonb_typeof(p_approvals) = 'object' THEN p_approvals || jsonb_build_object('forced_release', true)
          ELSE jsonb_build_object('forced_release', true, 'approvals', p_approvals)
        END;
      END IF;
    END IF;
  END IF;

  v_legacy_state := file_get_legacy_state(v_to_state.name);

  UPDATE file_workflow_assignment
  SET current_state_id = v_to_state.id
  WHERE file_id = p_file_id;

  UPDATE file
  SET workflow_state_id = v_to_state.id,
      state = COALESCE(v_legacy_state, state),
      revision = v_new_revision,
      state_changed_at = NOW(),
      state_changed_by = v_actor,
      updated_at = NOW(),
      updated_by = v_actor
  WHERE id = p_file_id;

  UPDATE file_state_entry
  SET exited_at = NOW(), exited_by = v_actor,
      duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - entered_at))::integer)
  WHERE file_id = p_file_id AND exited_at IS NULL;

  INSERT INTO file_state_entry (file_id, state_id, entered_by)
  VALUES (p_file_id, v_to_state.id, v_actor);

  INSERT INTO workflow_history (
    org_id, file_id, file_path, file_name,
    workflow_id, workflow_name,
    from_state_id, from_state_name, to_state_id, to_state_name,
    transition_id, transition_name,
    performed_by, performed_by_email, comment,
    revision_before, revision_after, approvals_data
  ) VALUES (
    v_file.org_id, p_file_id, v_file.file_path, v_file.file_name,
    v_transition.workflow_id, COALESCE(v_workflow_name, ''),
    v_from_state.id, COALESCE(v_from_state.name, ''), v_to_state.id, COALESCE(v_to_state.name, ''),
    p_transition_id, v_transition.name,
    v_actor, COALESCE(v_user_email, ''), p_comment,
    v_file.revision, v_new_revision, v_approvals
  );

  -- A forced release is said in the vault history too (the History view reads activity). The
  -- row is the acting user's (auth.uid()); details name who asked for the release.
  IF v_forced THEN
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (v_file.org_id, p_file_id, v_actor, COALESCE(v_user_email, ''), 'state_change',
            jsonb_build_object(
              'forced_release', true,
              'file_version_id', v_version.id,
              'version', v_version.version,
              'revision', v_new_revision,
              'old_state', v_from_state.name,
              'new_state', v_to_state.name,
              'released_by', v_releaser,
              'legacy_client', v_mode = 'legacy',
              'reason', v_note));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'requires_review', false,
    'new_state_id', v_to_state.id,
    'new_state_name', v_to_state.name,
    'new_revision', v_new_revision,
    'released_file_version_id', v_released_id,
    'release_forced', v_forced
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION workflow_transition_execute(
  p_file_id UUID,
  p_transition_id UUID,
  p_comment TEXT,
  p_force_release BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_file file%ROWTYPE;
  v_transition workflow_transition%ROWTYPE;
  v_current_state_id UUID;
  v_to_state workflow_state%ROWTYPE;
  v_gate workflow_gate%ROWTYPE;
  v_blocking_count INTEGER := 0;
  v_attempt_id UUID;
  v_gate_users UUID[];
  v_version file_version%ROWTYPE;
  v_mode TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_AUTHENTICATED',
      'error_message', 'You must be signed in to run a transition');
  END IF;

  SELECT * INTO v_file FROM file WHERE id = p_file_id AND deleted_at IS NULL;
  IF v_file.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FILE_NOT_FOUND',
      'error_message', 'File not found');
  END IF;

  IF NOT is_org_member(v_file.org_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN',
      'error_message', 'File belongs to another organization');
  END IF;

  IF NOT can_access_vault(v_file.vault_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN',
      'error_message', 'No access to this file''s vault');
  END IF;

  IF NOT is_org_file_workflows_enabled(v_file.org_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOWS_DISABLED',
      'error_message', 'File workflows are turned off for this organization');
  END IF;

  SELECT wt.* INTO v_transition
  FROM workflow_transition wt
  JOIN workflow_template wtpl ON wtpl.id = wt.workflow_id
  WHERE wt.id = p_transition_id AND wtpl.org_id = v_file.org_id;

  IF v_transition.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'TRANSITION_NOT_FOUND',
      'error_message', 'Transition not found');
  END IF;

  -- Serialize transitions of one file (module 10), and hold the file row (schema 509) so the
  -- checks below and the release read one state of the file.
  SELECT current_state_id INTO v_current_state_id
  FROM file_workflow_assignment WHERE file_id = p_file_id FOR UPDATE;
  SELECT * INTO v_file FROM file WHERE id = p_file_id AND org_id = v_file.org_id FOR UPDATE;

  IF v_current_state_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NO_WORKFLOW',
      'error_message', 'This file is not assigned to a workflow');
  END IF;

  IF v_transition.from_state_id <> v_current_state_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WRONG_STATE',
      'error_message', 'The file is no longer in this transition''s starting state');
  END IF;

  IF NOT can_run_transition(v_user_id, p_transition_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ROLE_REQUIRED',
      'error_message', 'You do not hold a workflow role that allows this transition');
  END IF;

  SELECT * INTO v_to_state FROM workflow_state WHERE id = v_transition.to_state_id;

  IF COALESCE(v_to_state.is_checkout_required, false) AND v_file.checked_out_by IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CHECKOUT_REQUIRED',
      'error_message', 'Check the file out before moving it to this state');
  END IF;

  IF NOT COALESCE(v_to_state.is_checkout_required, false) AND v_file.checked_out_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CHECKED_OUT',
      'error_message', 'Check the file in before moving it to this state');
  END IF;

  -- Schema 509: the release this transition asks for, and the drawing release gate.
  IF COALESCE(v_to_state.releases_version, false) THEN
    v_mode := CASE
      WHEN current_setting('blueplm.release_legacy', true) = 'on' THEN 'legacy'
      WHEN COALESCE(p_force_release, false) THEN 'force'
      ELSE 'check'
    END;
    SELECT fv.* INTO v_version FROM file_version fv
     WHERE fv.file_id = p_file_id
     ORDER BY fv.version DESC
     LIMIT 1
     FOR SHARE;
    -- Schema 516: the gate is Reviews'; without it a drawing releases with no review.
    IF v_mode = 'check'
       AND is_org_extension_installed(v_file.org_id, 'blueplm.reviews')
       AND lower(ltrim(COALESCE(v_file.extension, ''), '.')) = 'slddrw'
       AND v_version.id IS NOT NULL AND v_version.released_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM review_item ri JOIN review r ON r.id = ri.review_id
          WHERE ri.file_version_id = v_version.id AND ri.outcome = 'approved'
            AND r.status <> 'cancelled' AND r.org_id = v_file.org_id
       ) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'RELEASE_NOT_REVIEWED',
        'error_message', 'This drawing version has no approved review',
        'file_version_id', v_version.id, 'version', v_version.version);
    END IF;
  END IF;

  -- Re-running a gated transition must not pile up duplicate reviews.
  IF EXISTS (
    SELECT 1 FROM workflow_gate_review pr
    WHERE pr.file_id = p_file_id AND pr.transition_id = p_transition_id AND pr.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'requires_review', true,
      'error_code', 'REVIEW_PENDING',
      'error_message', 'This transition is already waiting on a review');
  END IF;

  -- One attempt id for every row this run creates (schema 107); per-reviewer rows (module 10);
  -- the release pinned on every row (schema 509).
  v_attempt_id := gen_random_uuid();

  FOR v_gate IN
    SELECT * FROM workflow_gate
    WHERE transition_id = p_transition_id AND COALESCE(is_blocking, true)
    ORDER BY sort_order
  LOOP
    v_gate_users := ARRAY(SELECT gate_reviewer_list_user_ids(v_gate.id, v_file.org_id));

    IF cardinality(v_gate_users) > 0 THEN
      INSERT INTO workflow_gate_review (org_id, file_id, transition_id, gate_id, requested_by, status, assignee_id, attempt_id,
                                        release_file_version_id, release_mode, release_comment)
      SELECT v_file.org_id, p_file_id, p_transition_id, v_gate.id, v_user_id, 'pending', u, v_attempt_id,
             v_version.id, v_mode, CASE WHEN v_mode IS NOT NULL THEN p_comment END
      FROM unnest(v_gate_users) AS u;
    ELSE
      INSERT INTO workflow_gate_review (org_id, file_id, transition_id, gate_id, requested_by, status, attempt_id,
                                        release_file_version_id, release_mode, release_comment)
      SELECT v_file.org_id, p_file_id, p_transition_id, v_gate.id, v_user_id, 'pending', v_attempt_id,
             v_version.id, v_mode, CASE WHEN v_mode IS NOT NULL THEN p_comment END
      FROM generate_series(1, GREATEST(1, COALESCE(v_gate.required_approvals, 1)));
    END IF;
    v_blocking_count := v_blocking_count + 1;
  END LOOP;

  IF v_blocking_count > 0 THEN
    RETURN jsonb_build_object('success', true, 'requires_review', true,
      'new_state_id', NULL, 'new_state_name', NULL);
  END IF;

  RETURN workflow_transition_apply(p_file_id, p_transition_id, p_comment, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- ===========================================
-- Registration
-- ===========================================
-- The requirements are identifiers: sql_strip_noise() drops string literals before matching.
INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('is_org_extension_installed(uuid, text)', 'core', 516),
  ('org_extension_set_installed(text, boolean)', 'core', 516),
  ('trg_official_extension_guard()', 'core', 516)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'is_org_extension_installed(uuid,text)', 'core', NULL, 'organization && settings', 516),
  ('function', 'official_extension_list_dependencies()', 'core', NULL, NULL, 516),
  ('function', 'org_extension_set_installed(text,boolean)', 'core', NULL,
    'is_org_admin && official_extension_list_dependencies && is_org_extension_installed', 516),
  ('function', 'trg_official_extension_guard()', 'core', NULL, 'pg_trigger_depth && is_org_extension_installed', 516),
  ('function', 'can_access_module(text,uuid)', 'core', NULL, 'is_org_extension_installed && module_access', 516),
  ('function', 'workflow_transition_execute(uuid,uuid,text,boolean)', '10-source-files', NULL,
    'is_org_extension_installed && review_item', 516),
  ('function', 'workflow_transition_apply(uuid,uuid,text,jsonb)', '10-source-files', NULL,
    'is_org_extension_installed && release_forced', 516)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 516 $$;
-- Must equal VERSION_DESCRIPTIONS[516] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Official extensions. Reviews, Inspection and Orders are installed or uninstalled per organization '
  '(organization.settings.extensions; unset = installed) through org_extension_set_installed(), admins '
  'only. While one is uninstalled, a signed-in caller''s direct writes to its tables are refused '
  '(EXTENSION_NOT_INSTALLED) and can_access_module() closes its module; nothing is deleted. Without '
  'Reviews a drawing releases with no review.'
$$;
