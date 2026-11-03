-- =====================================================================
-- 0504_inspection_tables.sql: inspection templates and reports (schema 503 -> 504)
-- =====================================================================
-- Inspection reports for drawings (5.4.0). Additive only: release 5.3.4 keeps working.
--
--   inspection_characteristic.tolerance_source and inspection_characteristic_version.tolerance_source
--                       'drawing' (the drawing gives the tolerance), 'general' (filled in from the
--                       title block's general tolerances) or NULL. file_checkin() copies it into
--                       the snapshot like the source columns, and like them it stays out of
--                       inspection_hash, so no drawing gets a new version for it alone.
--   inspection_template the organization's library of Excel report templates (.xlsx bytes in the
--                       vault bucket by SHA-256). Members read; administrators (is_org_admin())
--                       write. At most one live default per organization (setting a default
--                       clears the previous one), names unique among live templates.
--   inspection_report   a filled-in report attached to one checked-in drawing version: the
--                       generated workbook, the drawing PDF it embeds and the workbook a supplier
--                       returned are vault objects by SHA-256. It follows its file's vault
--                       (my_accessible_vault_ids()); writing needs module:explorer edit; deleting
--                       is for its creator or an administrator.
--
-- Who did what is the database's answer, never the client's: created_by, updated_by and
-- returned_by are set to auth.uid() by trigger, and the identity columns cannot be changed.
-- can_read_vault_object() lets a member read a report's objects through a readable report and a
-- template's workbook as a member of its organization. Server backups export both tables.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Tolerance source on the inspection rows
-- ---------------------------------------------------------------------------

ALTER TABLE inspection_characteristic
  ADD COLUMN IF NOT EXISTS tolerance_source TEXT
    CONSTRAINT inspection_characteristic_tolerance_source_check CHECK (tolerance_source IN ('drawing', 'general'));

ALTER TABLE inspection_characteristic_version
  ADD COLUMN IF NOT EXISTS tolerance_source TEXT
    CONSTRAINT inspection_characteristic_version_tolerance_source_check CHECK (tolerance_source IN ('drawing', 'general'));

-- module 10's file_checkin(), verbatim except that the snapshot copies tolerance_source.
CREATE OR REPLACE FUNCTION file_checkin(
  p_file_id UUID,
  p_new_content_hash TEXT DEFAULT NULL,
  p_new_file_size BIGINT DEFAULT NULL,
  p_comment TEXT DEFAULT NULL,
  -- Metadata fields (if any provided, triggers version increment)
  p_part_number TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_revision TEXT DEFAULT NULL,
  -- For version rollback detection
  p_local_active_version INT DEFAULT NULL,
  -- For config_tabs, config_descriptions, etc.
  p_custom_properties JSONB DEFAULT NULL,
  -- Path/name updates (previously required separate UPDATE query)
  p_new_file_path TEXT DEFAULT NULL,
  p_new_file_name TEXT DEFAULT NULL,
  -- Inspection table fingerprint (drawings); change triggers a version increment
  p_inspection_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_file RECORD;
  v_new_version INT;
  v_new_file_version_id UUID;
  v_content_changed BOOLEAN;
  v_metadata_changed BOOLEAN;
  v_inspection_changed BOOLEAN;
  v_current_inspection_hash TEXT;
  v_version_switched BOOLEAN;
  v_path_changed BOOLEAN;
  v_should_increment BOOLEAN;
  v_restoring_exact_version BOOLEAN;
  v_target_version_hash TEXT;
  v_max_version INT;
  v_result JSONB;
  v_user_email TEXT;
  v_merged_custom_props JSONB;
  v_versions_created_during_checkout INT;
  v_actor UUID;
BEGIN
  -- The acting user comes from the JWT; it decides both whose checkout is
  -- honoured and whose name goes on the new version.
  v_actor := my_actor_id();

  -- The gate is the only statement in this block, and it must stay that way.
  -- The handler below turns a refusal into a JSON result, which is what these
  -- RPCs need - but it will do that for anything raised in here, so a second
  -- check added after this line would have its RAISE swallowed and the function
  -- would carry on and answer. New checks go before the BEGIN.
  BEGIN
    PERFORM file_require_access(p_file_id);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END;

  -- Schema 112: the same permission the files UPDATE policy asks for. This
  -- function writes files as definer, so the policy never sees the write.
  IF NOT has_team_permission('module:explorer', 'edit') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to edit files');
  END IF;

  -- Lock and verify ownership
  SELECT * INTO v_file
  FROM file
  WHERE id = p_file_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END IF;
  
  IF v_file.checked_out_by IS NULL OR v_file.checked_out_by != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have this file checked out');
  END IF;
  
  -- Check for path conflict when file is being renamed/moved
  IF p_new_file_path IS NOT NULL AND LOWER(p_new_file_path) != LOWER(v_file.file_path) THEN
    IF EXISTS (
      SELECT 1 FROM file 
      WHERE vault_id = v_file.vault_id 
        AND LOWER(file_path) = LOWER(p_new_file_path)
        AND id != p_file_id 
        AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 
        'Cannot rename: another file already exists at "' || p_new_file_path || '". Delete or rename the existing file first.');
    END IF;
  END IF;
  
  -- Determine what changed
  v_content_changed := (p_new_content_hash IS NOT NULL AND p_new_content_hash != COALESCE(v_file.content_hash, ''));
  
  v_metadata_changed := (
    (p_part_number IS NOT NULL AND p_part_number IS DISTINCT FROM v_file.part_number) OR
    (p_description IS NOT NULL AND p_description IS DISTINCT FROM v_file.description) OR
    (p_revision IS NOT NULL AND p_revision IS DISTINCT FROM v_file.revision) OR
    (p_custom_properties IS NOT NULL)  -- custom_properties change triggers version
  );
  
  -- Inspection table edits trigger a version increment (no binary re-upload required).
  -- The authoritative fingerprint is computed server-side from the live inspection rows so
  -- any edit made during the checkout session is detected automatically at check-in. A
  -- caller may still override it via p_inspection_hash. NULL means "no inspection table".
  -- source_key / source_sheet / source_view (schema 103) are deliberately NOT in the hash:
  -- adding them would change every existing table's fingerprint and bump every drawing's
  -- version on its next check-in. They only bind rows to drawing annotations; the live row
  -- keeps them and the snapshot below still copies them, so a key-only change loses nothing.
  SELECT md5(string_agg(
    coalesce(sort_order::text, '') || '|' ||
    coalesce(balloon_number, '') || '|' ||
    coalesce(char_id, '') || '|' ||
    coalesce(zone, '') || '|' ||
    coalesce(char_type, '') || '|' ||
    coalesce(sub_type, '') || '|' ||
    coalesce(nominal_value, '') || '|' ||
    coalesce(unit, '') || '|' ||
    coalesce(plus_tolerance, '') || '|' ||
    coalesce(minus_tolerance, '') || '|' ||
    coalesce(upper_limit, '') || '|' ||
    coalesce(lower_limit, '') || '|' ||
    coalesce(classification, '') || '|' ||
    coalesce(inspection_method, '') || '|' ||
    coalesce(operation, '') || '|' ||
    coalesce(aql, '') || '|' ||
    coalesce(sample_size::text, '') || '|' ||
    coalesce(supplier_inspection_rate::text, '') || '|' ||
    coalesce(internal_inspection_rate::text, '') || '|' ||
    coalesce(reference, '') || '|' ||
    coalesce(comments, ''),
    chr(10) ORDER BY sort_order, id))
  INTO v_current_inspection_hash
  FROM inspection_characteristic
  WHERE file_id = p_file_id;
  
  v_current_inspection_hash := COALESCE(p_inspection_hash, v_current_inspection_hash);
  v_inspection_changed := (v_current_inspection_hash IS DISTINCT FROM v_file.inspection_hash);
  
  -- Path/name changes now handled in RPC (eliminates separate UPDATE query)
  v_path_changed := (
    (p_new_file_path IS NOT NULL AND p_new_file_path IS DISTINCT FROM v_file.file_path) OR
    (p_new_file_name IS NOT NULL AND p_new_file_name IS DISTINCT FROM v_file.file_name)
  );
  
  -- Version switch detection (user rolled back to different version locally)
  v_version_switched := (p_local_active_version IS NOT NULL AND p_local_active_version != v_file.version);
  
  -- Handle rollback/roll-forward: check if content matches the target version
  -- If user rolled to a different version and content matches that version exactly,
  -- just move the pointer instead of creating a new version
  v_restoring_exact_version := FALSE;
  IF v_version_switched THEN
    SELECT content_hash INTO v_target_version_hash
    FROM file_version 
    WHERE file_id = p_file_id AND version = p_local_active_version;
    
    -- If content matches the rolled-back version exactly, just move the pointer
    IF p_new_content_hash IS NOT NULL AND p_new_content_hash = v_target_version_hash THEN
      v_restoring_exact_version := TRUE;
      v_new_version := p_local_active_version;  -- Move pointer, don't increment
    END IF;
  END IF;
  
  -- Check if a version was already created during this checkout session
  -- If so, skip version creation to avoid double increment
  SELECT COUNT(*) INTO v_versions_created_during_checkout
  FROM file_version
  WHERE file_id = p_file_id 
    AND created_at > v_file.checked_out_at;
  
  -- Only increment version if:
  -- 1. There are actual changes (content, metadata, or version switch)
  -- 2. We're not restoring an exact previous version
  -- 3. No version was already created during this checkout session
  v_should_increment := (v_content_changed OR v_metadata_changed OR v_inspection_changed OR v_version_switched) 
                        AND NOT v_restoring_exact_version
                        AND v_versions_created_during_checkout = 0;
  
  -- Merge custom properties if provided. Scalar keys are replaced; the reserved
  -- per-configuration maps are merged entry by entry so a partial patch cannot erase the
  -- configurations it does not mention. See custom_properties_merge.
  IF p_custom_properties IS NOT NULL THEN
    v_merged_custom_props := custom_properties_merge(v_file.custom_properties, p_custom_properties);
  ELSE
    v_merged_custom_props := v_file.custom_properties;
  END IF;
  
  -- Calculate new version only if needed
  -- Note: v_new_version may already be set if v_restoring_exact_version is TRUE
  IF v_should_increment THEN
    SELECT COALESCE(MAX(version), v_file.version) + 1 INTO v_new_version
    FROM file_version WHERE file_id = p_file_id;
  ELSIF NOT v_restoring_exact_version THEN
    -- Only set to current version if we're not restoring an exact version
    -- (v_new_version was already set to p_local_active_version above)
    v_new_version := v_file.version;
  END IF;
  
  -- Update file (now includes path/name in single atomic update)
  UPDATE file SET
    checked_out_by = NULL,
    checked_out_at = NULL,
    lock_message = NULL,
    checked_out_by_machine_id = NULL,
    checked_out_by_machine_name = NULL,
    checked_out_file_path = NULL,
    checked_out_file_name = NULL,
    content_hash = COALESCE(p_new_content_hash, content_hash),
    file_size = COALESCE(p_new_file_size, file_size),
    part_number = COALESCE(p_part_number, part_number),
    description = COALESCE(p_description, description),
    revision = COALESCE(p_revision, revision),
    inspection_hash = v_current_inspection_hash,
    custom_properties = v_merged_custom_props,
    version = v_new_version,
    file_path = COALESCE(p_new_file_path, file_path),
    file_name = COALESCE(p_new_file_name, file_name),
    updated_by = v_actor,
    updated_at = NOW()
  WHERE id = p_file_id;
  
  -- Create version record ONLY if version incremented
  IF v_should_increment THEN
    INSERT INTO file_version (file_id, version, revision, content_hash, file_size, workflow_state_id, state, created_by, comment, part_number, description, inspection_hash)
    SELECT p_file_id, v_new_version, 
           COALESCE(p_revision, v_file.revision),
           COALESCE(p_new_content_hash, v_file.content_hash),
           COALESCE(p_new_file_size, v_file.file_size),
           v_file.workflow_state_id,
           COALESCE(v_file.state, 'not_tracked'), 
           v_actor, 
           p_comment,
           COALESCE(p_part_number, v_file.part_number),  -- Snapshot current or new part_number
           COALESCE(p_description, v_file.description),  -- Snapshot current or new description
           v_current_inspection_hash  -- Snapshot inspection fingerprint
    RETURNING id INTO v_new_file_version_id;

    -- Snapshot the live inspection table into the immutable per-version table so the
    -- inspection characteristics can be reconstructed exactly as they were at this version.
    INSERT INTO inspection_characteristic_version (
      file_version_id, org_id, sort_order, balloon_number, char_id, zone,
      char_type, sub_type, nominal_value, unit, plus_tolerance, minus_tolerance,
      upper_limit, lower_limit, classification, inspection_method, operation,
      aql, sample_size, supplier_inspection_rate, internal_inspection_rate, reference, comments,
      source_key, source_sheet, source_view, tolerance_source
    )
    SELECT
      v_new_file_version_id, org_id, sort_order, balloon_number, char_id, zone,
      char_type, sub_type, nominal_value, unit, plus_tolerance, minus_tolerance,
      upper_limit, lower_limit, classification, inspection_method, operation,
      aql, sample_size, supplier_inspection_rate, internal_inspection_rate, reference, comments,
      source_key, source_sheet, source_view, tolerance_source
    FROM inspection_characteristic
    WHERE file_id = p_file_id;
  END IF;
  
  -- Log activity
  SELECT email INTO v_user_email FROM app_user WHERE id = v_actor;
  
  INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
  VALUES (
    v_file.org_id, 
    p_file_id, 
    v_actor, 
    COALESCE(v_user_email, 'unknown'),
    'checkin',
    jsonb_build_object(
      'content_changed', v_content_changed,
      'metadata_changed', v_metadata_changed,
      'inspection_changed', v_inspection_changed,
      'version_incremented', v_should_increment,
      'version_restored', v_restoring_exact_version,
      'old_version', v_file.version,
      'new_version', v_new_version,
      'comment', p_comment,
      'version_already_created_during_checkout', v_versions_created_during_checkout > 0
    )
  );
  
  -- Log revision change separately if revision changed
  IF p_revision IS NOT NULL AND p_revision IS DISTINCT FROM v_file.revision THEN
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (
      v_file.org_id, 
      p_file_id, 
      v_actor, 
      COALESCE(v_user_email, 'unknown'),
      'revision_change',
      jsonb_build_object('from', v_file.revision, 'to', p_revision)
    );
  END IF;
  
  -- Return result
  SELECT jsonb_build_object(
    'success', true, 
    'file', row_to_json(f.*), 
    'new_version', v_new_version,
    'content_changed', v_content_changed,
    'metadata_changed', v_metadata_changed,
    'inspection_changed', v_inspection_changed,
    'version_incremented', v_should_increment
  )
  INTO v_result
  FROM file f WHERE f.id = p_file_id;
  
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inspection_template (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL CONSTRAINT inspection_template_name_check CHECK (btrim(name) <> ''),
  description TEXT,
  -- SHA-256 (hex) of the .xlsx, stored in the vault bucket under <org>/<hh>/<hash>.
  storage_hash TEXT NOT NULL CONSTRAINT inspection_template_storage_hash_check CHECK (storage_hash ~ '^[0-9a-f]{64}$'),
  file_size BIGINT NOT NULL CONSTRAINT inspection_template_file_size_check CHECK (file_size >= 0),
  original_filename TEXT,
  -- Raised by the app each time the workbook is replaced.
  revision INTEGER NOT NULL DEFAULT 1 CONSTRAINT inspection_template_revision_check CHECK (revision >= 1),
  is_default BOOLEAN NOT NULL DEFAULT false,
  -- What analyzeTemplate() found in the workbook (src/lib/inspection/excel).
  layout JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- An archived template is never the default.
  CONSTRAINT inspection_template_is_default_check CHECK (NOT (is_default AND archived_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS inspection_template_org_id_idx ON inspection_template (org_id);
CREATE INDEX IF NOT EXISTS inspection_template_storage_hash_idx ON inspection_template (storage_hash);
-- One default per organization.
CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_org_id_default_key
  ON inspection_template (org_id) WHERE is_default;
-- Live template names are unique per organization, ignoring case; archived ones may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_org_id_name_key
  ON inspection_template (org_id, lower(btrim(name))) WHERE archived_at IS NULL;

-- Stamps who and when from the JWT, keeps the identity columns, and makes a new default the only
-- one: the previous default of the organization is cleared in the same statement, so "set as
-- default" is one update instead of two that the unique index would refuse in the wrong order.
-- Not SECURITY DEFINER: clearing the old default goes through the same RLS as the update itself.
CREATE OR REPLACE FUNCTION trg_inspection_template_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(v_actor, NEW.created_by);
    NEW.created_at := NOW();
  ELSE
    NEW.id := OLD.id;
    NEW.org_id := OLD.org_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_by := COALESCE(v_actor, NEW.updated_by);
  NEW.updated_at := NOW();

  -- A template may only name content its writer uploaded or can already read: otherwise naming
  -- another vault's hash would hand its bytes to every member (can_read_vault_object).
  IF v_actor IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.storage_hash IS DISTINCT FROM OLD.storage_hash)
     AND NOT can_claim_vault_object(NEW.storage_hash) THEN
    RAISE EXCEPTION 'The template workbook was not uploaded by you' USING ERRCODE = '42501';
  END IF;

  IF NEW.is_default AND (TG_OP = 'INSERT' OR NOT OLD.is_default) THEN
    UPDATE inspection_template SET is_default = false
     WHERE org_id = NEW.org_id AND id <> NEW.id AND is_default;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_template_stamp ON inspection_template;
CREATE TRIGGER trg_inspection_template_stamp
  BEFORE INSERT OR UPDATE ON inspection_template
  FOR EACH ROW EXECUTE FUNCTION trg_inspection_template_stamp();

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inspection_report (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  -- The checked-in drawing version the report was generated from; a version of file_id
  -- (trg_inspection_report_stamp checks it).
  file_version_id UUID NOT NULL REFERENCES file_version(id) ON DELETE CASCADE,
  template_id UUID REFERENCES inspection_template(id) ON DELETE SET NULL,
  -- The template as it was when the report was generated (it may be renamed, replaced or deleted).
  template_name TEXT,
  template_hash TEXT CONSTRAINT inspection_report_template_hash_check CHECK (template_hash ~ '^[0-9a-f]{64}$'),
  report_number TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'issued'
    CONSTRAINT inspection_report_status_check CHECK (status IN ('issued', 'sent', 'returned', 'accepted', 'rejected')),
  -- The generated workbook.
  storage_hash TEXT NOT NULL CONSTRAINT inspection_report_storage_hash_check CHECK (storage_hash ~ '^[0-9a-f]{64}$'),
  file_size BIGINT NOT NULL CONSTRAINT inspection_report_file_size_check CHECK (file_size >= 0),
  characteristic_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT inspection_report_characteristic_count_check CHECK (characteristic_count >= 0),
  -- The drawing PDF embedded in the workbook (drawing_pdf_render.storage_hash of that version).
  drawing_pdf_hash TEXT CONSTRAINT inspection_report_drawing_pdf_hash_check CHECK (drawing_pdf_hash ~ '^[0-9a-f]{64}$'),
  -- The workbook the supplier sent back, and who imported it when (set by trigger).
  returned_hash TEXT CONSTRAINT inspection_report_returned_hash_check CHECK (returned_hash ~ '^[0-9a-f]{64}$'),
  returned_at TIMESTAMPTZ,
  returned_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  -- Measured values read from the returned workbook, and their tally {total, pass, fail, blank}.
  results JSONB,
  results_summary JSONB,
  notes TEXT,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspection_report_org_id_idx ON inspection_report (org_id);
CREATE INDEX IF NOT EXISTS inspection_report_file_id_idx ON inspection_report (file_id);
CREATE INDEX IF NOT EXISTS inspection_report_file_version_id_idx ON inspection_report (file_version_id);
CREATE INDEX IF NOT EXISTS inspection_report_template_id_idx ON inspection_report (template_id);
CREATE INDEX IF NOT EXISTS inspection_report_storage_hash_idx ON inspection_report (storage_hash);
CREATE INDEX IF NOT EXISTS inspection_report_returned_hash_idx ON inspection_report (returned_hash) WHERE returned_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS inspection_report_drawing_pdf_hash_idx ON inspection_report (drawing_pdf_hash) WHERE drawing_pdf_hash IS NOT NULL;
-- A report number is used once per drawing; the app retries with the next number on a conflict.
CREATE UNIQUE INDEX IF NOT EXISTS inspection_report_file_id_report_number_key
  ON inspection_report (file_id, report_number) WHERE report_number IS NOT NULL;

-- Stamps who and when from the JWT and keeps what a report is about. On insert the version must
-- belong to the file and the file to the organization; on update the organization, file, version
-- and creation columns keep their values. A new returned workbook is stamped with who imported it.
-- Not SECURITY DEFINER: the version lookup goes through the caller's own RLS, which is the same
-- vault rule the report's policies apply.
CREATE OR REPLACE FUNCTION trg_inspection_report_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM file_version fv JOIN file f ON f.id = fv.file_id
       WHERE fv.id = NEW.file_version_id AND fv.file_id = NEW.file_id AND f.org_id = NEW.org_id
    ) THEN
      RAISE EXCEPTION 'The drawing version does not belong to this file' USING ERRCODE = '23514';
    END IF;
    NEW.created_by := COALESCE(v_actor, NEW.created_by);
    NEW.created_at := NOW();
    IF NEW.returned_hash IS NOT NULL THEN
      NEW.returned_by := COALESCE(v_actor, NEW.returned_by);
      NEW.returned_at := COALESCE(NEW.returned_at, NOW());
    ELSE
      NEW.returned_by := NULL;
      NEW.returned_at := NULL;
    END IF;
  ELSE
    NEW.id := OLD.id;
    NEW.org_id := OLD.org_id;
    NEW.file_id := OLD.file_id;
    NEW.file_version_id := OLD.file_version_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.returned_hash IS NULL THEN
      NEW.returned_by := NULL;
      NEW.returned_at := NULL;
    ELSIF NEW.returned_hash IS DISTINCT FROM OLD.returned_hash THEN
      NEW.returned_by := COALESCE(v_actor, NEW.returned_by);
      NEW.returned_at := NOW();
    ELSE
      NEW.returned_by := OLD.returned_by;
      NEW.returned_at := OLD.returned_at;
    END IF;
  END IF;
  NEW.updated_by := COALESCE(v_actor, NEW.updated_by);
  NEW.updated_at := NOW();

  -- The hashes a report names become readable to everyone who can read the report
  -- (can_read_vault_object), so a client may only name content it uploaded or can already read,
  -- and the drawing PDF must be the stored PDF of the report's own version. Otherwise a report on
  -- a drawing in one vault could name, and so hand out, a file of a vault its readers cannot see.
  IF v_actor IS NOT NULL THEN
    IF (TG_OP = 'INSERT' OR NEW.storage_hash IS DISTINCT FROM OLD.storage_hash)
       AND NOT can_claim_vault_object(NEW.storage_hash) THEN
      RAISE EXCEPTION 'The report workbook was not uploaded by you' USING ERRCODE = '42501';
    END IF;
    IF NEW.returned_hash IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.returned_hash IS DISTINCT FROM OLD.returned_hash)
       AND NOT can_claim_vault_object(NEW.returned_hash) THEN
      RAISE EXCEPTION 'The returned workbook was not uploaded by you' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.drawing_pdf_hash IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.drawing_pdf_hash IS DISTINCT FROM OLD.drawing_pdf_hash)
     AND NOT EXISTS (SELECT 1 FROM drawing_pdf_render d
                      WHERE d.file_version_id = NEW.file_version_id AND d.storage_hash = NEW.drawing_pdf_hash) THEN
    RAISE EXCEPTION 'The drawing PDF is not the stored PDF of this drawing version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_report_stamp ON inspection_report;
CREATE TRIGGER trg_inspection_report_stamp
  BEFORE INSERT OR UPDATE ON inspection_report
  FOR EACH ROW EXECUTE FUNCTION trg_inspection_report_stamp();

-- Trigger functions run whoever fires them; nobody calls them.
REVOKE ALL ON FUNCTION trg_inspection_template_stamp(), trg_inspection_report_stamp() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------

ALTER TABLE inspection_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_report ENABLE ROW LEVEL SECURITY;

-- Written out in full, as in the baseline: anon holds nothing.
REVOKE ALL ON TABLE inspection_template, inspection_report FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inspection_template, inspection_report TO authenticated;
GRANT ALL ON TABLE inspection_template, inspection_report TO service_role;

DROP POLICY IF EXISTS "inspection_template: users read" ON inspection_template;
CREATE POLICY "inspection_template: users read" ON inspection_template FOR SELECT
  USING (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "inspection_template: admins insert" ON inspection_template;
CREATE POLICY "inspection_template: admins insert" ON inspection_template FOR INSERT
  WITH CHECK (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid())) AND (SELECT is_org_admin()));

DROP POLICY IF EXISTS "inspection_template: admins update" ON inspection_template;
CREATE POLICY "inspection_template: admins update" ON inspection_template FOR UPDATE
  USING (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid())) AND (SELECT is_org_admin()))
  WITH CHECK (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid())) AND (SELECT is_org_admin()));

DROP POLICY IF EXISTS "inspection_template: admins delete" ON inspection_template;
CREATE POLICY "inspection_template: admins delete" ON inspection_template FOR DELETE
  USING (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid())) AND (SELECT is_org_admin()));

-- Reports follow their file's vault (schema 111's rule, as inspection_characteristic does).
DROP POLICY IF EXISTS "inspection_report: users read" ON inspection_report;
CREATE POLICY "inspection_report: users read" ON inspection_report FOR SELECT
  USING (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid()))
         AND file_id IN (SELECT f.id FROM file f WHERE f.vault_id IN (SELECT my_accessible_vault_ids())));

DROP POLICY IF EXISTS "inspection_report: engineers insert" ON inspection_report;
CREATE POLICY "inspection_report: engineers insert" ON inspection_report FOR INSERT
  WITH CHECK (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid()))
              AND file_id IN (SELECT f.id FROM file f WHERE f.vault_id IN (SELECT my_accessible_vault_ids()))
              AND has_team_permission('module:explorer', 'edit'));

DROP POLICY IF EXISTS "inspection_report: engineers update" ON inspection_report;
CREATE POLICY "inspection_report: engineers update" ON inspection_report FOR UPDATE
  USING (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid()))
         AND file_id IN (SELECT f.id FROM file f WHERE f.vault_id IN (SELECT my_accessible_vault_ids()))
         AND has_team_permission('module:explorer', 'edit'))
  WITH CHECK (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid()))
              AND file_id IN (SELECT f.id FROM file f WHERE f.vault_id IN (SELECT my_accessible_vault_ids()))
              AND has_team_permission('module:explorer', 'edit'));

DROP POLICY IF EXISTS "inspection_report: creators delete" ON inspection_report;
CREATE POLICY "inspection_report: creators delete" ON inspection_report FOR DELETE
  USING (org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid()))
         AND file_id IN (SELECT f.id FROM file f WHERE f.vault_id IN (SELECT my_accessible_vault_ids()))
         AND (created_by = (SELECT auth.uid()) OR (SELECT is_org_admin())));

-- ---------------------------------------------------------------------------
-- Reading report and template content from the vault bucket
-- ---------------------------------------------------------------------------
-- module 10's can_read_vault_object(), with two more ways in: an object a readable report names
-- (its workbook, the drawing PDF it embeds, the returned workbook), through the report's file's
-- vault; and a template's workbook, for any member of the template's organization.
CREATE OR REPLACE FUNCTION can_read_vault_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH obj AS (
    SELECT u.org_id,
           substring(p_name FROM '/([0-9a-f]{64})$') AS hash,
           CASE
             WHEN split_part(p_name, '/', 2) = 'inspection-previews'
              AND left(split_part(p_name, '/', 3), 36) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN left(split_part(p_name, '/', 3), 36)::uuid
           END AS preview_file_id
      FROM app_user u
     WHERE u.id = auth.uid()
       AND u.org_id IS NOT NULL
       AND split_part(p_name, '/', 1) = u.org_id::text
  ),
  visible AS (SELECT my_accessible_vault_ids() AS id)
  SELECT EXISTS (
    SELECT 1 FROM obj
     WHERE EXISTS (SELECT 1 FROM file f
                    WHERE f.content_hash = obj.hash AND f.org_id = obj.org_id
                      AND f.vault_id IN (SELECT id FROM visible))
        OR EXISTS (SELECT 1 FROM file_version fv JOIN file f ON f.id = fv.file_id
                    WHERE fv.content_hash = obj.hash AND f.org_id = obj.org_id
                      AND f.vault_id IN (SELECT id FROM visible))
        OR EXISTS (SELECT 1 FROM drawing_pdf_render d JOIN file f ON f.id = d.file_id
                    WHERE d.storage_hash = obj.hash AND f.org_id = obj.org_id
                      AND f.vault_id IN (SELECT id FROM visible))
        OR EXISTS (SELECT 1 FROM file f
                    WHERE f.id = obj.preview_file_id AND f.org_id = obj.org_id
                      AND f.vault_id IN (SELECT id FROM visible))
        OR EXISTS (SELECT 1 FROM inspection_report r JOIN file f ON f.id = r.file_id
                    WHERE r.storage_hash = obj.hash AND r.org_id = obj.org_id AND f.org_id = obj.org_id
                      AND f.vault_id IN (SELECT id FROM visible))
        OR EXISTS (SELECT 1 FROM inspection_report r JOIN file f ON f.id = r.file_id
                    WHERE r.returned_hash = obj.hash AND r.org_id = obj.org_id AND f.org_id = obj.org_id
                      AND f.vault_id IN (SELECT id FROM visible))
        OR EXISTS (SELECT 1 FROM inspection_report r JOIN file f ON f.id = r.file_id
                    WHERE r.drawing_pdf_hash = obj.hash AND r.org_id = obj.org_id AND f.org_id = obj.org_id
                      AND f.vault_id IN (SELECT id FROM visible))
        OR EXISTS (SELECT 1 FROM inspection_template t
                    WHERE t.storage_hash = obj.hash AND t.org_id = obj.org_id)
  );
$$;

-- Whether the caller may name this content hash on a report or template: an administrator (who
-- reads every object of the organization through the bucket policy), the uploader of the object
-- under the caller's organization prefix, or someone who can already read it. Called by the two
-- stamp triggers before a hash is stored, because can_read_vault_object() then serves the object to
-- every reader of the row. SECURITY DEFINER for the storage.objects owner lookup; it answers for
-- auth.uid() only and takes no entity argument.
CREATE OR REPLACE FUNCTION can_claim_vault_object(p_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID;
  v_names TEXT[];
BEGIN
  IF auth.uid() IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  SELECT u.org_id INTO v_org FROM app_user u WHERE u.id = auth.uid();
  IF v_org IS NULL THEN
    RETURN false;
  END IF;
  IF is_org_admin() THEN
    RETURN true;
  END IF;
  v_names := ARRAY[v_org::text || '/' || left(p_hash, 2) || '/' || p_hash, v_org::text || '/' || p_hash];
  RETURN EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'vault' AND o.name = ANY (v_names) AND o.owner_id = auth.uid()::text)
      OR can_read_vault_object(v_names[1])
      OR can_read_vault_object(v_names[2]);
END;
$$;

REVOKE ALL ON FUNCTION can_claim_vault_object(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_claim_vault_object(TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Server backups export the two tables
-- ---------------------------------------------------------------------------
-- 0501's backup_list_org_rows(), verbatim except the two inspection tables. The worker's list
-- (BACKUP_TABLES in api/src/backup/source.ts) may name them once this release is applied.
CREATE OR REPLACE FUNCTION backup_list_org_rows(p_org_id UUID, p_table TEXT, p_after UUID, p_limit INT)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_scope TEXT;
  v_rows JSONB;
BEGIN
  v_scope := CASE p_table
    WHEN 'organization' THEN 'id = $1'
    WHEN 'app_user' THEN 'org_id = $1'
    WHEN 'team' THEN 'org_id = $1'
    WHEN 'team_member' THEN 'team_id IN (SELECT id FROM team WHERE org_id = $1)'
    WHEN 'team_permission' THEN 'team_id IN (SELECT id FROM team WHERE org_id = $1)'
    WHEN 'user_permission' THEN 'user_id IN (SELECT id FROM app_user WHERE org_id = $1)'
    WHEN 'module_access' THEN 'org_id = $1'
    WHEN 'vault' THEN 'org_id = $1'
    WHEN 'vault_access' THEN 'vault_id IN (SELECT id FROM vault WHERE org_id = $1)'
    WHEN 'team_vault_access' THEN 'vault_id IN (SELECT id FROM vault WHERE org_id = $1)'
    WHEN 'workflow_template' THEN 'org_id = $1'
    WHEN 'workflow_role' THEN 'org_id = $1'
    WHEN 'workflow_state' THEN 'workflow_id IN (SELECT id FROM workflow_template WHERE org_id = $1)'
    WHEN 'workflow_transition' THEN 'workflow_id IN (SELECT id FROM workflow_template WHERE org_id = $1)'
    WHEN 'workflow_gate' THEN 'transition_id IN (SELECT t.id FROM workflow_transition t'
      ' JOIN workflow_template w ON w.id = t.workflow_id WHERE w.org_id = $1)'
    WHEN 'user_workflow_role' THEN 'user_id IN (SELECT id FROM app_user WHERE org_id = $1)'
    WHEN 'folder' THEN 'org_id = $1'
    WHEN 'file' THEN 'org_id = $1'
    WHEN 'file_version' THEN 'file_id IN (SELECT id FROM file WHERE org_id = $1)'
    WHEN 'file_reference' THEN 'org_id = $1'
    WHEN 'file_version_reference' THEN 'org_id = $1'
    WHEN 'drawing_pdf_render' THEN 'org_id = $1'
    WHEN 'release_file' THEN 'org_id = $1'
    WHEN 'file_metadata_column' THEN 'org_id = $1'
    WHEN 'file_comment' THEN 'file_id IN (SELECT id FROM file WHERE org_id = $1)'
    WHEN 'file_watcher' THEN 'org_id = $1'
    WHEN 'file_workflow_assignment' THEN 'file_id IN (SELECT id FROM file WHERE org_id = $1)'
    WHEN 'file_state_entry' THEN 'file_id IN (SELECT id FROM file WHERE org_id = $1)'
    WHEN 'workflow_history' THEN 'org_id = $1'
    WHEN 'workflow_gate_review' THEN 'org_id = $1'
    WHEN 'review' THEN 'org_id = $1'
    WHEN 'review_item' THEN 'org_id = $1'
    WHEN 'review_round' THEN 'org_id = $1'
    WHEN 'review_response' THEN 'review_id IN (SELECT id FROM review WHERE org_id = $1)'
    WHEN 'eco' THEN 'org_id = $1'
    WHEN 'file_eco' THEN 'file_id IN (SELECT id FROM file WHERE org_id = $1)'
    WHEN 'deviation' THEN 'org_id = $1'
    WHEN 'file_deviation' THEN 'file_id IN (SELECT id FROM file WHERE org_id = $1)'
    WHEN 'item_designation' THEN 'org_id = $1'
    WHEN 'item_designation_assignment' THEN 'org_id = $1'
    WHEN 'inspection_characteristic' THEN 'org_id = $1'
    WHEN 'inspection_characteristic_version' THEN 'org_id = $1'
    WHEN 'inspection_template' THEN 'org_id = $1'
    WHEN 'inspection_report' THEN 'org_id = $1'
    WHEN 'supplier' THEN 'org_id = $1'
    WHEN 'part_supplier' THEN 'org_id = $1'
    WHEN 'activity' THEN 'org_id = $1'
    WHEN 'backup_history' THEN 'org_id = $1'
    ELSE NULL
  END;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'backup_list_org_rows: unknown table %', p_table USING ERRCODE = '22023';
  END IF;
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN
    RETURN jsonb_build_object('missing', true, 'rows', '[]'::jsonb);
  END IF;
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), ''[]''::jsonb) FROM ('
    '  SELECT * FROM %I WHERE (%s) AND ($2::uuid IS NULL OR id > $2) ORDER BY id LIMIT $3'
    ') t', p_table, v_scope)
    INTO v_rows USING p_org_id, p_after, LEAST(GREATEST(p_limit, 1), 5000);
  RETURN jsonb_build_object('missing', false, 'rows', v_rows);
END;
$$;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
-- file_checkin, can_read_vault_object and backup_list_org_rows are registered already (500 /
-- 501); CREATE OR REPLACE keeps their grants. The trigger functions are executable by nobody, so
-- the function inventory does not need them; the manifest pins their bodies. can_claim_vault_object
-- is new and executable by signed-in users, so it is registered.

INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('can_claim_vault_object(text)', '15-inspection', 504)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('table', 'inspection_template', '15-inspection', NULL, NULL, 504),
  ('table', 'inspection_report', '15-inspection', NULL, NULL, 504),
  ('function', 'trg_inspection_template_stamp()', '15-inspection', NULL, 'auth.uid && is_default && can_claim_vault_object', 504),
  ('function', 'trg_inspection_report_stamp()', '15-inspection', NULL, 'auth.uid && file_version && returned_by && can_claim_vault_object && drawing_pdf_render', 504),
  ('function', 'can_claim_vault_object(text)', '15-inspection', NULL, 'auth.uid && storage.objects && owner_id && can_read_vault_object && is_org_admin', 504),
  ('function', 'file_checkin(uuid,text,bigint,text,text,text,text,integer,jsonb,text,text,text)', '10-source-files', NULL,
    'custom_properties_merge && checked_out_file_path && tolerance_source', 504),
  ('function', 'can_read_vault_object(text)', '10-source-files', NULL,
    'my_accessible_vault_ids && file_version && drawing_pdf_render && inspection_report && inspection_template', 504)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 504 $$;
-- Must equal VERSION_DESCRIPTIONS[504] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Inspection reports. inspection_characteristic and its snapshots gain tolerance_source '
  '(drawing or general), copied by file_checkin() and kept out of inspection_hash. '
  'inspection_template is the organization''s library of Excel report templates (members '
  'read, administrators write, one default). inspection_report attaches a generated report to '
  'one drawing version, with its workbook, embedded drawing PDF and returned workbook in the '
  'vault bucket; it follows the file''s vault, writing needs explorer edit, and the actor '
  'columns are set by the database. can_read_vault_object() reads report and template '
  'content; server backups export both tables.'
$$;
