-- =====================================================================
-- 0509_release_versions.sql: released file versions (schema 508 -> 509)
-- =====================================================================
-- A file version is released when its file enters a workflow state that releases
-- (workflow_state.releases_version). The release is recorded on the version itself and the file
-- keeps changing afterwards: later versions are work in progress. A released version's exports
-- and inspection reports are frozen. Additive only: release 5.8.0 keeps working (it calls the
-- 3-argument workflow_transition_execute, which still exists, and reads none of the new columns).
-- Plan: .cursor/plans/release-versions-5.9.plan.md (decisions 2-6, 8, 9).
--
--   file_version.released_at / released_by / release_forced / release_review_id / release_note /
--                       release_revision  the release of this version. Written only by
--                       workflow_transition_apply() (trg_file_version_release_guard refuses every
--                       other write), once: entering a releasing state again keeps the first
--                       record. release_revision is the file's revision after the transition (a
--                       releasing state may auto-increment it), which file_version.revision, the
--                       revision at check-in, does not show. A released version is not deleted
--                       while its file is live.
--   workflow_state.releases_version  entering the state releases the file's newest checked-in
--                       version. Backfilled for non-editable states named Released.
--   workflow_transition_execute(uuid, uuid, text, boolean)  the release gate: a drawing (.slddrw)
--                       enters a releasing state only with an approved review of that exact
--                       version (RELEASE_NOT_REVIEWED otherwise), unless p_force_release; the
--                       release is then recorded as forced, workflow_history.approvals_data gets
--                       forced_release and an activity row says so. Parts and assemblies are not
--                       gated. The 3-argument function (5.8.0, and the REST path through
--                       workflow_transition_execute_to_legacy_state) has no force option: it
--                       releases an unreviewed drawing as forced, with a note saying so. A
--                       releasing transition with gates pins its version, mode, requester and
--                       comment on the gate attempt (workflow_gate_review.release_*), and that
--                       version is what the completed attempt releases.
--   Freeze              a released version's drawing PDF and exports cannot be replaced or deleted
--                       (trg_drawing_pdf_render_freeze / trg_file_version_output_freeze, hint
--                       RELEASED, so drawing_pdf_render_record(), file_version_output_record() and
--                       the 0507 delete functions refuse); its inspection reports cannot be deleted
--                       or have their generated workbook changed (trg_inspection_report_freeze). A
--                       missing export may still be added, and a returned workbook still imported.
--   inspection_report_overwrite(...)  regenerating a report of the same version in place.
--   file.auto_outputs_off, file_set_auto_output()  export kinds not regenerated at check-in.
--   workflow_create_default(uuid)  WIP -> In Review (review stage) -> Released -> Obsolete.
--   workflow_import_graph(uuid, jsonb)  imports a state's releases_version.
--
-- Which review releases: an approved review of a version is a review_item of that exact
-- file_version with outcome 'approved', in a review that was not cancelled. The item's own
-- outcome decides, not the package status, because a review stage with the 'approved_only'
-- package policy (schema 110) moves an approved file while the rest of its package is still open
-- or was turned down; requiring review.status = 'approved' would record that file as forced.
-- workflow_transition_apply() looks the review up itself (no transaction setting is passed from
-- review_advance_items(), which is unchanged), so every path into a releasing state (a direct
-- transition, a gate review completing, an approved review stage) records the same review id,
-- and a drawing released without one is recorded as forced whatever the path.
--
-- No new table: file_version, file and workflow_state are already exported whole by server
-- backups (to_jsonb(row)), so the API is unchanged.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE file_version
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_forced BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS release_review_id UUID REFERENCES review(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_note TEXT,
  ADD COLUMN IF NOT EXISTS release_revision TEXT;

CREATE INDEX IF NOT EXISTS file_version_file_id_released_at_idx
  ON file_version (file_id) WHERE released_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS file_version_release_review_id_idx
  ON file_version (release_review_id) WHERE release_review_id IS NOT NULL;

ALTER TABLE workflow_state
  ADD COLUMN IF NOT EXISTS releases_version BOOLEAN NOT NULL DEFAULT false;

-- Existing templates are not rewritten, except that a non-editable state named Released now
-- releases, which is what such a state has always meant.
UPDATE workflow_state
   SET releases_version = true
 WHERE lower(btrim(name)) = 'released' AND is_editable IS FALSE AND releases_version = false;

ALTER TABLE file
  ADD COLUMN IF NOT EXISTS auto_outputs_off TEXT[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- The release columns are written by workflow_transition_apply() only
-- ---------------------------------------------------------------------------
-- workflow_transition_apply() sets the transaction-local setting blueplm.release_write to 'on'
-- around its one UPDATE and back to 'off' after it. Any other insert or update that sets or
-- changes a release column is refused, except the foreign keys' own ON DELETE SET NULL (the
-- releasing user or the review is gone). A released version is not deleted while its file is
-- live; deleting the file (or a file in the trash) still removes it. SECURITY DEFINER so the
-- existence tests see the review, user and file rows whatever the caller's RLS.
CREATE OR REPLACE FUNCTION trg_file_version_release_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.released_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM file f JOIN organization o ON o.id = f.org_id
                    WHERE f.id = OLD.file_id AND f.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Version % is released and is kept', OLD.version
        USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'RELEASED';
    END IF;
    RETURN OLD;
  END IF;

  IF current_setting('blueplm.release_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.released_at IS NOT NULL OR NEW.released_by IS NOT NULL OR NEW.release_forced
       OR NEW.release_review_id IS NOT NULL OR NEW.release_note IS NOT NULL
       OR NEW.release_revision IS NOT NULL THEN
      RAISE EXCEPTION 'A version is released by a workflow transition only'
        USING ERRCODE = 'insufficient_privilege', HINT = 'RELEASE_COLUMNS';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.released_at IS DISTINCT FROM OLD.released_at
     OR NEW.release_forced IS DISTINCT FROM OLD.release_forced
     OR NEW.release_note IS DISTINCT FROM OLD.release_note
     OR NEW.release_revision IS DISTINCT FROM OLD.release_revision
     OR (NEW.released_by IS DISTINCT FROM OLD.released_by
         AND NOT (NEW.released_by IS NULL
                  AND NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = OLD.released_by)))
     OR (NEW.release_review_id IS DISTINCT FROM OLD.release_review_id
         AND NOT (NEW.release_review_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM review r WHERE r.id = OLD.release_review_id))) THEN
    RAISE EXCEPTION 'A version is released by a workflow transition only'
      USING ERRCODE = 'insufficient_privilege', HINT = 'RELEASE_COLUMNS';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_file_version_release_guard ON file_version;
CREATE TRIGGER trg_file_version_release_guard
  BEFORE INSERT OR UPDATE OR DELETE ON file_version
  FOR EACH ROW EXECUTE FUNCTION trg_file_version_release_guard();

-- ---------------------------------------------------------------------------
-- Freeze: a released version's exports and reports
-- ---------------------------------------------------------------------------
-- drawing_pdf_render and file_version_output have no client write policy; their writers are the
-- record functions (an administrator's replace is an UPDATE of storage_hash) and the 0507 delete
-- functions. A trigger refuses both for a released version, so every writer refuses with the
-- same hint and a later writer cannot forget it. An insert (a missing export of the released
-- version, generated from that version) stays allowed. A delete that cascades from the version
-- or the file, or from deleting the organization, finds that row gone and goes through. Not SECURITY DEFINER: the writers are
-- definer functions, and a cascade runs as the table owner.
CREATE OR REPLACE FUNCTION trg_version_output_freeze()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.storage_hash IS NOT DISTINCT FROM OLD.storage_hash THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM file_version fv JOIN file f ON f.id = fv.file_id JOIN organization o ON o.id = f.org_id
     WHERE fv.id = OLD.file_version_id AND fv.released_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This version is released; its outputs are kept as they are'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'RELEASED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_drawing_pdf_render_freeze ON drawing_pdf_render;
CREATE TRIGGER trg_drawing_pdf_render_freeze
  BEFORE UPDATE OR DELETE ON drawing_pdf_render
  FOR EACH ROW EXECUTE FUNCTION trg_version_output_freeze();

DROP TRIGGER IF EXISTS trg_file_version_output_freeze ON file_version_output;
CREATE TRIGGER trg_file_version_output_freeze
  BEFORE UPDATE OR DELETE ON file_version_output
  FOR EACH ROW EXECUTE FUNCTION trg_version_output_freeze();

-- Reports are written by clients under their own policies (0504), so the freeze is a trigger
-- on the table: a report of a released version is not deleted, and the workbook it was
-- generated as (content, size, count, embedded PDF, template, number) does not change. Its
-- status, notes and returned workbook do: receiving inspection goes on after release. The
-- template's ON DELETE SET NULL goes through, as do deletes cascading from the version, the
-- file or the organization. Not SECURITY DEFINER: a client reaching the row passed the report's vault policy,
-- which is the vault rule file_version's own read policy applies.
CREATE OR REPLACE FUNCTION trg_inspection_report_freeze()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.storage_hash IS NOT DISTINCT FROM OLD.storage_hash
     AND NEW.file_size IS NOT DISTINCT FROM OLD.file_size
     AND NEW.characteristic_count IS NOT DISTINCT FROM OLD.characteristic_count
     AND NEW.drawing_pdf_hash IS NOT DISTINCT FROM OLD.drawing_pdf_hash
     AND NEW.template_name IS NOT DISTINCT FROM OLD.template_name
     AND NEW.template_hash IS NOT DISTINCT FROM OLD.template_hash
     AND NEW.report_number IS NOT DISTINCT FROM OLD.report_number
     AND NEW.sequence IS NOT DISTINCT FROM OLD.sequence
     AND (NEW.template_id IS NOT DISTINCT FROM OLD.template_id OR NEW.template_id IS NULL) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM file_version fv JOIN file f ON f.id = fv.file_id JOIN organization o ON o.id = f.org_id
     WHERE fv.id = OLD.file_version_id AND fv.released_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This drawing version is released; its inspection reports are kept as they are'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'RELEASED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_report_freeze ON inspection_report;
CREATE TRIGGER trg_inspection_report_freeze
  BEFORE UPDATE OR DELETE ON inspection_report
  FOR EACH ROW EXECUTE FUNCTION trg_inspection_report_freeze();

-- Trigger functions run whoever fires them; nobody calls them.
REVOKE ALL ON FUNCTION trg_file_version_release_guard(), trg_version_output_freeze(), trg_inspection_report_freeze()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The release a gated transition asks for, pinned on its gate attempt
-- ---------------------------------------------------------------------------
-- A releasing transition with blocking gates is decided later, by other people. What it releases
-- is fixed when it is requested: the version that was newest then (release_file_version_id), how
-- it was asked for (release_mode: 'check' = with the drawing release gate, 'force' = forced by a
-- 5.9 client, 'legacy' = through the 3-argument entry point of 5.8.0, which has no force option)
-- and the requester's comment (release_comment). Every row of the attempt carries the same
-- values. NULL on rows from before 509 and on transitions that do not release. Clients only read
-- workflow_gate_review (module 10 has no client write policy); workflow_transition_execute()
-- writes these.
ALTER TABLE workflow_gate_review
  ADD COLUMN IF NOT EXISTS release_file_version_id UUID REFERENCES file_version(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_mode TEXT
    CONSTRAINT workflow_gate_review_release_mode_check CHECK (release_mode IN ('check', 'force', 'legacy')),
  ADD COLUMN IF NOT EXISTS release_comment TEXT;

CREATE INDEX IF NOT EXISTS workflow_gate_review_release_file_version_id_idx
  ON workflow_gate_review (release_file_version_id) WHERE release_file_version_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- workflow_transition_apply(): records the release
-- ---------------------------------------------------------------------------
-- Module 10's function, with the file row locked first and the release block added.
--
-- What is released:
--   * a gated attempt (p_approvals names its attempt_id, which gate_review_complete() below
--     passes): the version pinned on the attempt, released_by its requester, the note its
--     comment;
--   * otherwise (a direct transition, an approved review stage): the newest version, read under
--     the file row lock that workflow_transition_execute() also holds, so a check-in cannot land
--     between the review check and the release (check-in updates the same row).
-- Released once: a version released before keeps its first record. The review is the newest
-- approved review item of that exact version in a review that was not cancelled; a drawing
-- released without one is recorded as forced. A forced release asked for through the 5.8.0 entry
-- point ('legacy', from the attempt or blueplm.release_legacy) says so in its note.
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

      v_forced := v_review_id IS NULL AND lower(ltrim(COALESCE(v_file.extension, ''), '.')) = 'slddrw';
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

-- ---------------------------------------------------------------------------
-- workflow_transition_execute(): the drawing release gate
-- ---------------------------------------------------------------------------
-- Module 10's 3-argument function with p_force_release and the gate. The assignment and file rows
-- are locked before the state and checkout checks (module 10 read them unlocked), so the state,
-- the checkout and the newest version cannot change under the checks: check-in and checkout
-- update the same file row. The gate (p_force_release false, a drawing, a releasing target, the
-- newest version unreleased and without an approved review) refuses RELEASE_NOT_REVIEWED before any
-- gate review is raised. A releasing transition that raises gates pins its release on the attempt
-- (see workflow_gate_review above).
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
    IF v_mode = 'check'
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

REVOKE ALL ON FUNCTION workflow_transition_execute(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION workflow_transition_execute(uuid, uuid, text, boolean) TO authenticated, service_role;

-- The 5.8.0 entry point (and the REST path, workflow_transition_execute_to_legacy_state()). 5.8.0
-- has no way to force a release, so refusing would leave its users unable to release a drawing
-- at all: it releases an unreviewed drawing as a forced release, whose note says it came through a
-- client without the release check (blueplm.release_legacy, read by the 4-argument function and
-- by workflow_transition_apply(), and set back to 'off' after the call). SECURITY INVOKER, so the
-- 4-argument function does every check as the caller would; CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE FUNCTION workflow_transition_execute(
  p_file_id UUID,
  p_transition_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM set_config('blueplm.release_legacy', 'on', true);
  v_result := workflow_transition_execute(p_file_id, p_transition_id, p_comment, true);
  PERFORM set_config('blueplm.release_legacy', 'off', true);
  RETURN v_result;
END;
$$;


-- ---------------------------------------------------------------------------
-- gate_review_complete(): names the attempt it completes
-- ---------------------------------------------------------------------------
-- Module 10's function, unchanged except that the approvals it hands workflow_transition_apply()
-- carry the attempt id, so apply releases the version pinned on that attempt.
CREATE OR REPLACE FUNCTION gate_review_complete(
  p_pending_review_id UUID,
  p_decision review_status,
  p_comment TEXT DEFAULT NULL,
  p_checklist_responses JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_review workflow_gate_review%ROWTYPE;
  v_gate workflow_gate%ROWTYPE;
  v_file file%ROWTYPE;
  v_transition workflow_transition%ROWTYPE;
  v_workflow_name TEXT;
  v_from_state_name TEXT;
  v_to_state_name TEXT;
  v_requested_by_email TEXT;
  v_reviewer_email TEXT;
  v_approvals INTEGER;
  v_rejections INTEGER;
  v_reviewers INTEGER;
  v_needed INTEGER;
  v_requested_by UUID;
  v_still_open INTEGER;
  v_attempt_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_AUTHENTICATED',
      'error_message', 'You must be signed in to review');
  END IF;

  IF p_decision NOT IN ('approved', 'rejected', 'kicked_back') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'BAD_DECISION',
      'error_message', 'A review decision must be approved, rejected or kicked_back');
  END IF;

  -- Read the attempt first, unlocked, then lock every row of the attempt in id
  -- order (schema 107). Locking only this row let two reviewers approving the last
  -- two gates of a transition at the same moment each see the other's row still
  -- pending, so neither applied the transition. Locking this row first and the
  -- rest afterwards would deadlock two such callers instead.
  SELECT pr.attempt_id, pr.org_id INTO v_attempt_id, v_org_id
  FROM workflow_gate_review pr WHERE pr.id = p_pending_review_id;
  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'REVIEW_NOT_FOUND',
      'error_message', 'Review not found');
  END IF;

  -- NULL-unsafe in the same way as workflow_transition_execute above.
  IF NOT is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN',
      'error_message', 'Review belongs to another organization');
  END IF;

  -- Schema 111: a reviewer must be able to see the file's vault. Without this
  -- the decision would be recorded and the transition it completes would then
  -- be refused by file_require_access(), rolling the whole call back.
  IF NOT can_access_vault((SELECT f.vault_id FROM workflow_gate_review pr JOIN file f ON f.id = pr.file_id
                            WHERE pr.id = p_pending_review_id)) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NO_VAULT_ACCESS',
      'error_message', 'You do not have access to this file''s vault');
  END IF;

  PERFORM 1 FROM workflow_gate_review pr
  WHERE pr.attempt_id = v_attempt_id
  ORDER BY pr.id
  FOR UPDATE;

  SELECT * INTO v_review FROM workflow_gate_review WHERE id = p_pending_review_id;

  IF v_review.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_DECIDED',
      'error_message', 'This review has already been decided');
  END IF;

  -- One person, one vote per gate per attempt: a second unassigned slot, or an
  -- administrator standing in twice, must not count the same reviewer again.
  IF EXISTS (
    SELECT 1 FROM workflow_gate_review d
    WHERE d.attempt_id = v_review.attempt_id
      AND d.gate_id = v_review.gate_id
      AND d.reviewed_by = v_user_id
      AND d.status IN ('approved', 'rejected', 'kicked_back')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_REVIEWED',
      'error_message', 'You have already decided this gate');
  END IF;

  -- Assigned: the assignee, or an administrator standing in for them.
  -- Unassigned: whoever the gate's own reviewer rules admit. Before this
  -- release the unassigned branch did not exist and any member could approve.
  IF v_review.assignee_id IS NOT NULL THEN
    IF v_review.assignee_id <> v_user_id AND NOT is_org_admin(v_user_id) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_ASSIGNED',
        'error_message', 'This review is assigned to someone else');
    END IF;
  ELSIF NOT can_review_gate(v_review.gate_id, v_user_id)
        AND NOT is_org_admin(v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_A_REVIEWER',
      'error_message', 'You are not a reviewer for this gate');
  END IF;

  SELECT * INTO v_gate FROM workflow_gate WHERE id = v_review.gate_id;
  SELECT * INTO v_file FROM file WHERE id = v_review.file_id;
  SELECT * INTO v_transition FROM workflow_transition WHERE id = v_review.transition_id;
  SELECT name INTO v_workflow_name FROM workflow_template WHERE id = v_transition.workflow_id;
  SELECT name INTO v_from_state_name FROM workflow_state WHERE id = v_transition.from_state_id;
  SELECT name INTO v_to_state_name FROM workflow_state WHERE id = v_transition.to_state_id;
  SELECT email INTO v_requested_by_email FROM app_user WHERE id = v_review.requested_by;
  SELECT email INTO v_reviewer_email FROM app_user WHERE id = v_user_id;

  UPDATE workflow_gate_review
  SET status = p_decision,
      reviewed_by = v_user_id,
      reviewed_at = NOW(),
      review_comment = p_comment,
      checklist_responses = COALESCE(p_checklist_responses, '{}'::jsonb)
  WHERE id = p_pending_review_id;

  INSERT INTO workflow_review_history (
    org_id, file_id, file_path, file_name,
    workflow_id, workflow_name, transition_id,
    from_state_name, to_state_name, gate_id, gate_name,
    requested_by, requested_by_email, requested_at,
    reviewed_by, reviewed_by_email, reviewed_at,
    decision, comment, checklist_responses
  ) VALUES (
    v_review.org_id, v_review.file_id, COALESCE(v_file.file_path, ''), COALESCE(v_file.file_name, ''),
    v_transition.workflow_id, COALESCE(v_workflow_name, ''), v_review.transition_id,
    COALESCE(v_from_state_name, ''), COALESCE(v_to_state_name, ''), v_review.gate_id, COALESCE(v_gate.name, ''),
    v_review.requested_by, COALESCE(v_requested_by_email, ''), v_review.requested_at,
    v_user_id, COALESCE(v_reviewer_email, ''), NOW(),
    p_decision::text, p_comment, COALESCE(p_checklist_responses, '{}'::jsonb)
  );

  -- A rejection is a veto and ends the attempt: cancel the rest of this attempt's
  -- rows so the requester can resubmit rather than being stuck behind reviews
  -- nobody can action. Scoped to the attempt (schema 107) - earlier attempts are
  -- history and are left as they are.
  IF p_decision IN ('rejected', 'kicked_back') THEN
    UPDATE workflow_gate_review
    SET status = 'cancelled'
    WHERE attempt_id = v_review.attempt_id
      AND status = 'pending';

    RETURN jsonb_build_object('success', true, 'requires_review', false,
      'rejected', true);
  END IF;

  -- Has this gate collected the approvals its mode calls for? Counted over this
  -- attempt's rows of this gate only, one row per reviewer (or per unassigned slot).
  SELECT count(*) FILTER (WHERE status = 'approved'),
         count(*) FILTER (WHERE status IN ('rejected', 'kicked_back')),
         count(*)
    INTO v_approvals, v_rejections, v_reviewers
  FROM workflow_gate_review
  WHERE attempt_id = v_review.attempt_id
    AND gate_id = v_review.gate_id;

  -- 'any' asks for required_approvals, capped at the number of reviewers the gate
  -- actually has, so a gate asking for three approvals from two named people is
  -- satisfiable rather than a permanent lock.
  v_needed := CASE COALESCE(v_gate.approval_mode, 'any')
    WHEN 'all' THEN v_reviewers
    WHEN 'majority' THEN (v_reviewers / 2) + 1
    ELSE LEAST(v_reviewers, GREATEST(1, COALESCE(v_gate.required_approvals, 1)))
  END;

  IF v_approvals < v_needed THEN
    RETURN jsonb_build_object('success', true, 'requires_review', true,
      'approvals', v_approvals, 'approvals_needed', v_needed);
  END IF;

  -- This gate is satisfied: the slots nobody needs to fill any more are closed,
  -- so they stop appearing in queues and stop holding the transition open.
  UPDATE workflow_gate_review
  SET status = 'cancelled'
  WHERE attempt_id = v_review.attempt_id
    AND gate_id = v_review.gate_id
    AND status = 'pending';

  -- The transition still waits on any other gate of this attempt.
  SELECT count(*) INTO v_still_open
  FROM workflow_gate_review
  WHERE attempt_id = v_review.attempt_id
    AND status = 'pending';

  IF v_still_open > 0 THEN
    RETURN jsonb_build_object('success', true, 'requires_review', true,
      'approvals', v_approvals, 'approvals_needed', v_needed);
  END IF;

  SELECT requested_by INTO v_requested_by
  FROM workflow_gate_review
  WHERE attempt_id = v_review.attempt_id
  ORDER BY requested_at LIMIT 1;

  RETURN workflow_transition_apply(
    v_review.file_id,
    v_review.transition_id,
    p_comment,
    jsonb_build_object('approved_by', v_user_id, 'approvals', v_approvals, 'attempt_id', v_review.attempt_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ---------------------------------------------------------------------------
-- inspection_report_overwrite(): regenerating a report of the same version
-- ---------------------------------------------------------------------------
-- Same row, number, sequence and version; the workbook, its size and count, the embedded PDF and
-- the template change. Refused for a report of a released version (RELEASED) and for one a
-- filled-in workbook came back for (HAS_RETURN): regenerating those makes a new report that
-- supersedes it (0508). Needs the file's vault and explorer edit, as the report update policy
-- does; the workbook must be the caller's upload or content they can read
-- (can_claim_vault_object()), which trg_inspection_report_stamp checks again on the UPDATE, along
-- with the embedded PDF being the stored PDF of the report's version. The template must be one of
-- the report's organization.
CREATE OR REPLACE FUNCTION inspection_report_overwrite(
  p_report_id UUID,
  p_storage_hash TEXT,
  p_file_size BIGINT,
  p_characteristic_count INTEGER,
  p_drawing_pdf_hash TEXT,
  p_template_id UUID,
  p_template_name TEXT,
  p_template_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_row inspection_report%ROWTYPE;
  v_hash TEXT;
  v_pdf TEXT;
  v_template_hash TEXT;
BEGIN
  v_actor := my_actor_id();
  v_hash := lower(btrim(COALESCE(p_storage_hash, '')));
  v_pdf := NULLIF(lower(btrim(COALESCE(p_drawing_pdf_hash, ''))), '');
  v_template_hash := NULLIF(lower(btrim(COALESCE(p_template_hash, ''))), '');

  SELECT * INTO v_row FROM inspection_report r WHERE r.id = p_report_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Report not found'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;

  v_org_id := file_require_access(v_row.file_id);
  IF v_row.org_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'Report not found'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;

  IF NOT has_team_permission('module:explorer', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to edit files'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NO_EDIT_PERMISSION';
  END IF;

  IF EXISTS (SELECT 1 FROM file_version fv WHERE fv.id = v_row.file_version_id AND fv.released_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This drawing version is released; regenerate the report as a new one'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'RELEASED';
  END IF;
  IF v_row.returned_hash IS NOT NULL THEN
    RAISE EXCEPTION 'A filled-in workbook came back for this report; regenerate it as a new one'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'HAS_RETURN';
  END IF;

  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Storage hash must be a SHA-256 hex digest'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_file_size IS NULL OR p_file_size < 0 THEN
    RAISE EXCEPTION 'File size must not be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_characteristic_count IS NULL OR p_characteristic_count < 0 THEN
    RAISE EXCEPTION 'Characteristic count must not be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT can_claim_vault_object(v_hash) THEN
    RAISE EXCEPTION 'The report workbook was not uploaded by you'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_UPLOADER';
  END IF;
  IF p_template_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM inspection_template t WHERE t.id = p_template_id AND t.org_id = v_org_id) THEN
    RAISE EXCEPTION 'Template not found'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'TEMPLATE_NOT_FOUND';
  END IF;

  UPDATE inspection_report
     SET storage_hash = v_hash,
         file_size = p_file_size,
         characteristic_count = p_characteristic_count,
         drawing_pdf_hash = v_pdf,
         template_id = p_template_id,
         template_name = NULLIF(btrim(COALESCE(p_template_name, '')), ''),
         template_hash = v_template_hash
   WHERE id = v_row.id;

  RETURN jsonb_build_object('overwritten', true, 'id', v_row.id, 'storage_hash', v_hash);
END;
$$;

REVOKE ALL ON FUNCTION inspection_report_overwrite(uuid, text, bigint, integer, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION inspection_report_overwrite(uuid, text, bigint, integer, text, uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- file_set_auto_output(): keep an export kind up to date at check-in, or not
-- ---------------------------------------------------------------------------
-- file.auto_outputs_off lists the kinds the check-in queue does not regenerate for this file.
-- p_enabled = false adds the kind, true removes it; either is idempotent. Needs the file's vault
-- and explorer edit, not a checkout: it is a setting about the file's exports, not its content.
CREATE OR REPLACE FUNCTION file_set_auto_output(p_file_id UUID, p_kind TEXT, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_kind TEXT;
  v_off TEXT[];
BEGIN
  v_actor := my_actor_id();
  v_org_id := file_require_access(p_file_id);

  IF NOT has_team_permission('module:explorer', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to edit files'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NO_EDIT_PERMISSION';
  END IF;

  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('pdf', 'step', 'iges', 'stl', 'dxf') THEN
    RAISE EXCEPTION 'Unknown output kind %', p_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'Say whether the output is kept up to date'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE file f
     SET auto_outputs_off = CASE
           WHEN p_enabled THEN array_remove(f.auto_outputs_off, v_kind)
           ELSE ARRAY(SELECT DISTINCT k FROM unnest(f.auto_outputs_off || v_kind) AS k ORDER BY k)
         END
   WHERE f.id = p_file_id AND f.org_id = v_org_id
  RETURNING f.auto_outputs_off INTO v_off;

  RETURN jsonb_build_object('file_id', p_file_id, 'auto_outputs_off', to_jsonb(COALESCE(v_off, '{}'::text[])));
END;
$$;

REVOKE ALL ON FUNCTION file_set_auto_output(uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION file_set_auto_output(uuid, text, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- workflow_create_default(): the 5.9 default workflow
-- ---------------------------------------------------------------------------
-- WIP (editable, checkout required) -> In Review (a review stage whose approval moves files to
-- Released) -> Released (releases the version, not editable, revision auto-increment) ->
-- Obsolete. Same signature, admin check and is_default as module 10.
CREATE OR REPLACE FUNCTION workflow_create_default(p_org_id UUID)
RETURNS UUID AS $$
DECLARE
  v_workflow_id UUID;
  v_created_by UUID;
  v_wip_state_id UUID;
  v_review_state_id UUID;
  v_released_state_id UUID;
  v_obsolete_state_id UUID;
BEGIN
  PERFORM org_require_member(p_org_id);

  IF NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only admins can create workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_created_by := my_actor_id();

  INSERT INTO workflow_template (org_id, name, description, is_default, created_by)
  VALUES (p_org_id, 'Standard Release Process', 'Default workflow for releasing engineering files', true, v_created_by)
  RETURNING id INTO v_workflow_id;

  INSERT INTO workflow_state (workflow_id, name, label, color, icon, position_x, position_y, is_editable, is_checkout_required, sort_order)
  VALUES (v_workflow_id, 'WIP', 'Work In Progress', '#EAB308', 'pencil', 100, 200, true, true, 1)
  RETURNING id INTO v_wip_state_id;

  INSERT INTO workflow_state (workflow_id, name, label, color, icon, position_x, position_y, is_editable, is_checkout_required, is_review_stage, sort_order)
  VALUES (v_workflow_id, 'In Review', 'In Review', '#3B82F6', 'eye', 350, 200, false, false, true, 2)
  RETURNING id INTO v_review_state_id;

  INSERT INTO workflow_state (workflow_id, name, label, color, icon, position_x, position_y, is_editable, is_checkout_required, is_revision_auto_incremented, releases_version, sort_order)
  VALUES (v_workflow_id, 'Released', 'Released', '#22C55E', 'check-circle', 600, 200, false, false, true, true, 3)
  RETURNING id INTO v_released_state_id;

  INSERT INTO workflow_state (workflow_id, name, label, color, icon, position_x, position_y, is_editable, is_checkout_required, sort_order)
  VALUES (v_workflow_id, 'Obsolete', 'Obsolete', '#6B7280', 'archive', 850, 200, false, false, 4)
  RETURNING id INTO v_obsolete_state_id;

  -- Schema 110: the review stage names where an approval sends its files.
  UPDATE workflow_state SET review_approved_state_id = v_released_state_id WHERE id = v_review_state_id;

  INSERT INTO workflow_transition (workflow_id, from_state_id, to_state_id, name, line_style) VALUES
    (v_workflow_id, v_wip_state_id, v_review_state_id, 'Submit for review', 'solid'),
    (v_workflow_id, v_review_state_id, v_wip_state_id, 'Return to WIP', 'dashed'),
    (v_workflow_id, v_review_state_id, v_released_state_id, 'Release', 'solid'),
    (v_workflow_id, v_wip_state_id, v_released_state_id, 'Release directly', 'dotted'),
    (v_workflow_id, v_released_state_id, v_wip_state_id, 'Revise', 'dashed'),
    (v_workflow_id, v_released_state_id, v_obsolete_state_id, 'Obsolete', 'dotted'),
    (v_workflow_id, v_obsolete_state_id, v_wip_state_id, 'Reinstate', 'dashed');

  RETURN v_workflow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- workflow_import_graph(): imports releases_version
-- ---------------------------------------------------------------------------
-- Module 10's function, unchanged except that a state's releases_version (the key the 5.9
-- workflow export writes) is imported; a payload without it imports a state that does not
-- release, as before.
CREATE OR REPLACE FUNCTION workflow_import_graph(p_workflow_id UUID, p_payload JSONB)
RETURNS JSONB AS $$
DECLARE
  v_org_id UUID;
  v_state JSONB;
  v_transition JSONB;
  v_gate JSONB;
  v_key_map JSONB := '{}'::jsonb;
  v_state_id UUID;
  v_transition_id UUID;
  v_from_id UUID;
  v_to_id UUID;
  v_state_count INTEGER := 0;
  v_transition_count INTEGER := 0;
  v_gate_count INTEGER := 0;
BEGIN
  SELECT org_id INTO v_org_id FROM workflow_template WHERE id = p_workflow_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Workflow not found';
  END IF;

  -- `v_org_id <> (SELECT org_id FROM users WHERE id = auth.uid())` is NULL when
  -- the caller has no organization, so the OR fell through to is_org_admin(),
  -- which is false for such a user - safe, but only by accident of the
  -- neighbouring condition. Made sound on its own.
  IF NOT is_org_member(v_org_id) OR NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only organization admins can import a workflow';
  END IF;

  IF jsonb_typeof(p_payload->'states') <> 'array' THEN
    RAISE EXCEPTION 'Payload is missing a states array';
  END IF;

  DELETE FROM workflow_transition WHERE workflow_id = p_workflow_id;
  DELETE FROM workflow_state WHERE workflow_id = p_workflow_id;

  FOR v_state IN SELECT * FROM jsonb_array_elements(p_payload->'states') LOOP
    INSERT INTO workflow_state (
      workflow_id, state_type, shape, name, label, description,
      color, fill_opacity, border_color, border_opacity, border_thickness, corner_radius,
      icon, position_x, position_y, width, height,
      is_editable, is_checkout_required, is_revision_auto_incremented,
      required_workflow_roles, is_review_stage, releases_version, sort_order
    ) VALUES (
      p_workflow_id,
      COALESCE((v_state->>'state_type')::state_type, 'state'),
      COALESCE((v_state->>'shape')::state_shape, 'rectangle'),
      v_state->>'name',
      v_state->>'label',
      v_state->>'description',
      COALESCE(v_state->>'color', '#6B7280'),
      COALESCE((v_state->>'fill_opacity')::decimal, 1.0),
      v_state->>'border_color',
      COALESCE((v_state->>'border_opacity')::decimal, 1.0),
      COALESCE((v_state->>'border_thickness')::integer, 2),
      COALESCE((v_state->>'corner_radius')::integer, 8),
      COALESCE(v_state->>'icon', 'circle'),
      COALESCE((v_state->>'position_x')::integer, 0),
      COALESCE((v_state->>'position_y')::integer, 0),
      COALESCE((v_state->>'width')::integer, 120),
      COALESCE((v_state->>'height')::integer, 60),
      COALESCE((v_state->>'is_editable')::boolean, true),
      COALESCE((v_state->>'is_checkout_required')::boolean, (v_state->>'requires_checkout')::boolean, true),
      COALESCE((v_state->>'is_revision_auto_incremented')::boolean, (v_state->>'auto_increment_revision')::boolean, false),
      '{}',
      COALESCE((v_state->>'is_review_stage')::boolean, (v_state->>'triggers_review')::boolean, false),
      COALESCE((v_state->>'releases_version')::boolean, false),
      COALESCE((v_state->>'sort_order')::integer, v_state_count)
    ) RETURNING id INTO v_state_id;

    v_key_map := v_key_map || jsonb_build_object(v_state->>'key', v_state_id::text);
    v_state_count := v_state_count + 1;
  END LOOP;

  -- A review stage names, by key, where an approval moves files (schema 110). Resolved once
  -- every state has its new id; a key that is not in the payload leaves it unset.
  UPDATE workflow_state ws
  SET review_approved_state_id = (v_key_map->>(x.st->>'review_approved'))::uuid
  FROM jsonb_array_elements(p_payload->'states') AS x(st)
  WHERE ws.id = (v_key_map->>(x.st->>'key'))::uuid
    AND x.st->>'review_approved' IS NOT NULL
    AND v_key_map ? (x.st->>'review_approved');

  IF jsonb_typeof(p_payload->'transitions') = 'array' THEN
    FOR v_transition IN SELECT * FROM jsonb_array_elements(p_payload->'transitions') LOOP
      v_from_id := (v_key_map->>(v_transition->>'from'))::uuid;
      v_to_id := (v_key_map->>(v_transition->>'to'))::uuid;

      IF v_from_id IS NULL OR v_to_id IS NULL THEN
        RAISE EXCEPTION 'Transition references a state that is not in the payload';
      END IF;

      INSERT INTO workflow_transition (
        workflow_id, from_state_id, to_state_id, name, description,
        line_style, line_color, line_path_type, line_arrow_head, line_thickness,
        auto_conditions,
        start_edge, start_fraction, end_edge, end_fraction, waypoints, label_offset, label_pinned
      ) VALUES (
        p_workflow_id, v_from_id, v_to_id,
        v_transition->>'name',
        v_transition->>'description',
        COALESCE((v_transition->>'line_style')::transition_line_style, 'solid'),
        v_transition->>'line_color',
        COALESCE((v_transition->>'line_path_type')::transition_path_type, 'spline'),
        COALESCE((v_transition->>'line_arrow_head')::transition_arrow_head, 'end'),
        COALESCE((v_transition->>'line_thickness')::integer, 2),
        v_transition->'auto_conditions',
        (v_transition->>'start_edge')::transition_edge,
        (v_transition->>'start_fraction')::decimal,
        (v_transition->>'end_edge')::transition_edge,
        (v_transition->>'end_fraction')::decimal,
        COALESCE(v_transition->'waypoints', '[]'::jsonb),
        v_transition->'label_offset',
        v_transition->'label_pinned'
      ) RETURNING id INTO v_transition_id;

      v_transition_count := v_transition_count + 1;

      IF jsonb_typeof(v_transition->'gates') = 'array' THEN
        FOR v_gate IN SELECT * FROM jsonb_array_elements(v_transition->'gates') LOOP
          INSERT INTO workflow_gate (
            transition_id, name, description, gate_type, required_approvals,
            approval_mode, checklist_items, conditions, is_blocking, can_be_skipped_by, sort_order
          ) VALUES (
            v_transition_id,
            v_gate->>'name',
            v_gate->>'description',
            COALESCE((v_gate->>'gate_type')::gate_type, 'approval'),
            COALESCE((v_gate->>'required_approvals')::integer, 1),
            COALESCE((v_gate->>'approval_mode')::approval_mode, 'any'),
            COALESCE(v_gate->'checklist_items', '[]'::jsonb),
            v_gate->'conditions',
            COALESCE((v_gate->>'is_blocking')::boolean, true),
            COALESCE(
              ARRAY(SELECT jsonb_array_elements_text(v_gate->'can_be_skipped_by'))::user_role[],
              '{}'::user_role[]
            ),
            COALESCE((v_gate->>'sort_order')::integer, v_gate_count)
          );

          v_gate_count := v_gate_count + 1;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'state_count', v_state_count,
    'transition_count', v_transition_count,
    'gate_count', v_gate_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
-- workflow_transition_apply, the 3-argument workflow_transition_execute and
-- workflow_create_default are registered already; CREATE OR REPLACE keeps their grants. The
-- 3-argument function's manifest entry now names the function it delegates to, and the
-- 4-argument one carries the checks the 3-argument one used to.

INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('workflow_transition_execute(uuid, uuid, text, boolean)', '10-source-files', 509),
  ('inspection_report_overwrite(uuid, text, bigint, integer, text, uuid, text, text)', '15-inspection', 509),
  ('file_set_auto_output(uuid, text, boolean)', '10-source-files', 509),
  ('trg_file_version_release_guard()', '10-source-files', 509)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'workflow_transition_execute(uuid,uuid,text,boolean)', '10-source-files', NULL,
    'is_org_member && wtpl.org_id = v_file.org_id && gate_reviewer_list_user_ids && v_attempt_id && is_org_file_workflows_enabled && releases_version && review_item && release_mode', 509),
  ('function', 'workflow_transition_execute(uuid,uuid,text)', '10-source-files', NULL,
    'set_config && workflow_transition_execute', 509),
  ('function', 'workflow_transition_apply(uuid,uuid,text,jsonb)', '10-source-files', NULL,
    'file_require_access && wtpl.org_id = v_org_id && releases_version && set_config && release_file_version_id', 509),
  ('function', 'workflow_create_default(uuid)', '10-source-files', NULL,
    'org_require_member && is_org_admin && my_actor_id && releases_version && review_approved_state_id', 509),
  ('function', 'gate_review_complete(uuid,review_status,text,jsonb)', '10-source-files', NULL,
    'is_org_member && can_review_gate && v_attempt_id && workflow_transition_apply', 509),
  ('function', 'workflow_import_graph(uuid,jsonb)', '10-source-files', NULL,
    'is_org_member && is_org_admin && releases_version', 509),
  ('function', 'inspection_report_overwrite(uuid,text,bigint,integer,text,uuid,text,text)', '15-inspection', NULL,
    'file_require_access && has_team_permission && can_claim_vault_object && released_at && returned_hash', 509),
  ('function', 'file_set_auto_output(uuid,text,boolean)', '10-source-files', NULL,
    'file_require_access && has_team_permission && auto_outputs_off', 509),
  ('function', 'trg_file_version_release_guard()', '10-source-files', NULL, 'current_setting && released_at', 509),
  ('function', 'trg_version_output_freeze()', '10-source-files', NULL, 'released_at', 509),
  ('function', 'trg_inspection_report_freeze()', '15-inspection', NULL, 'released_at', 509)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 509 $$;
-- Must equal VERSION_DESCRIPTIONS[509] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Released versions. file_version records its release (when, by whom, the approved review or a '
  'forced release, the note and the revision), written only by a transition into a state that '
  'releases (workflow_state.releases_version). A drawing is released through an approved review of '
  'that version or forced with workflow_transition_execute(..., p_force_release), which is logged. '
  'A released version''s exports and inspection reports cannot be replaced or deleted. '
  'inspection_report_overwrite() regenerates a report of the same version in place; '
  'file_set_auto_output() sets which exports a file keeps up to date at check-in; the default '
  'workflow is WIP, In Review, Released, Obsolete.'
$$;
