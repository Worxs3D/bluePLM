-- =====================================================================
-- 0510_inspection_working_copy_reports.sql: reports of a checked-out drawing (schema 509 -> 510)
-- =====================================================================
-- A user who has a drawing checked out, and has extracted or ballooned it since its latest
-- version, generates an inspection report without checking it in first. The report is recorded
-- under the drawing at once, built from the live inspection table and the local drawing, and
-- becomes a report of the version the check-in makes.
--
--   inspection_report.working_copy  true = built from created_by's checked-out copy, based on
--                       file_version_id (the latest checked-in version when it was generated);
--                       characteristic_ids name live inspection_characteristic rows. Inserted only
--                       by the user who has the drawing checked out. No returned workbook and no
--                       stored drawing PDF while true. Release freezes do not apply to it.
--   inspection_report_pin()  after the check-in, the creator (or an admin) points the report at
--                       the first version the creator checked in after the base version (the base
--                       version itself when the check-in made none), with the workbook rebuilt for
--                       that version and its snapshot rows. The only way file_version_id changes.
--
-- Additive: release 5.9.x keeps working (it never writes working_copy, so its reports are false).
-- No new table, so server backups (to_jsonb(row)) and the API are unchanged.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

ALTER TABLE inspection_report
  ADD COLUMN IF NOT EXISTS working_copy BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE inspection_report DROP CONSTRAINT IF EXISTS inspection_report_working_copy_check;
ALTER TABLE inspection_report ADD CONSTRAINT inspection_report_working_copy_check
  CHECK (NOT working_copy OR (returned_hash IS NULL AND drawing_pdf_hash IS NULL));

CREATE INDEX IF NOT EXISTS inspection_report_working_copy_idx
  ON inspection_report (file_id) WHERE working_copy;

-- ---------------------------------------------------------------------------
-- Triggers (0504 stamp, 0506 type, 0509 freeze) with the working copy added
-- ---------------------------------------------------------------------------

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
    -- A report of a checked-out copy is made by the user who has the drawing checked out.
    IF NEW.working_copy AND NOT EXISTS (
      SELECT 1 FROM file f WHERE f.id = NEW.file_id AND f.checked_out_by = v_actor
    ) THEN
      RAISE EXCEPTION 'A report of a checked-out copy needs the drawing checked out by you'
        USING ERRCODE = '23514', HINT = 'NOT_CHECKED_OUT';
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
    -- The version is fixed, except when inspection_report_pin() turns a report of a checked-out
    -- copy into a report of the version its check-in made.
    IF NOT (OLD.working_copy AND NOT NEW.working_copy
            AND COALESCE(current_setting('blueplm.report_pin', true), '') = OLD.id::text) THEN
      NEW.file_version_id := OLD.file_version_id;
      NEW.working_copy := OLD.working_copy;
    END IF;
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

CREATE OR REPLACE FUNCTION trg_inspection_report_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.report_type := OLD.report_type;
    NEW.fai_scope := OLD.fai_scope;
    NEW.fai_reason := OLD.fai_reason;
    NEW.lot_number := OLD.lot_number;
    NEW.lot_size := OLD.lot_size;
    NEW.sampling := OLD.sampling;
    NEW.po_number := OLD.po_number;
    NEW.supplier_name := OLD.supplier_name;
    NEW.ncr_reference := OLD.ncr_reference;
    -- inspection_report_pin() maps the live rows a checked-out copy's report names to the
    -- snapshot rows of the version its check-in made (and checks them).
    IF current_setting('blueplm.report_pin', true) IS DISTINCT FROM OLD.id::text THEN
      NEW.characteristic_ids := OLD.characteristic_ids;
    END IF;
    NEW.sample_columns := OLD.sample_columns;
    -- The baseline only goes away with its version (ON DELETE SET NULL runs this update after the
    -- version row is gone); a client clearing or repointing it keeps the recorded one.
    IF NEW.fai_baseline_version_id IS DISTINCT FROM OLD.fai_baseline_version_id
       AND NOT (NEW.fai_baseline_version_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM file_version v WHERE v.id = OLD.fai_baseline_version_id)) THEN
      NEW.fai_baseline_version_id := OLD.fai_baseline_version_id;
    END IF;
  ELSE
    IF NEW.fai_scope = 'partial' AND NEW.fai_baseline_version_id IS NULL THEN
      RAISE EXCEPTION 'A partial FAI needs the version of the FAI it builds on' USING ERRCODE = '23514';
    END IF;
    IF NEW.fai_baseline_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM file_version b JOIN file_version t ON t.file_id = b.file_id
       WHERE b.id = NEW.fai_baseline_version_id AND t.id = NEW.file_version_id
         AND b.file_id = NEW.file_id AND b.version <= t.version
    ) THEN
      RAISE EXCEPTION 'The FAI baseline is not an earlier version of this drawing' USING ERRCODE = '23514';
    END IF;
    IF NEW.characteristic_ids IS NOT NULL THEN
      IF (SELECT count(DISTINCT x) FROM unnest(NEW.characteristic_ids) x) <> cardinality(NEW.characteristic_ids) THEN
        RAISE EXCEPTION 'A characteristic is listed twice' USING ERRCODE = '23514';
      END IF;
      IF NEW.working_copy THEN
        -- A checked-out copy's report names rows of the drawing's live inspection table.
        IF (SELECT count(*) FROM inspection_characteristic c
             WHERE c.id = ANY (NEW.characteristic_ids) AND c.file_id = NEW.file_id) <> cardinality(NEW.characteristic_ids) THEN
          RAISE EXCEPTION 'The characteristics are not inspection rows of this drawing' USING ERRCODE = '23514';
        END IF;
      ELSIF (SELECT count(*) FROM inspection_characteristic_version cv JOIN file_version fv ON fv.id = cv.file_version_id
           WHERE cv.id = ANY (NEW.characteristic_ids) AND fv.file_id = NEW.file_id) <> cardinality(NEW.characteristic_ids) THEN
        RAISE EXCEPTION 'The characteristics are not inspection rows of this drawing' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.report_type IS NOT NULL AND NEW.results IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.results IS DISTINCT FROM OLD.results)
     AND COALESCE(NEW.results->>'format', '') <> 'blueplm-inspection-results/2' THEN
    RAISE EXCEPTION 'Results of this report need BluePLM 5.6 or later (they cover only its own characteristics)'
      USING ERRCODE = '23514', HINT = 'TYPED_RESULTS_FORMAT';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_inspection_report_freeze()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A report of a checked-out copy is not a report of the version it is based on.
  IF OLD.working_copy THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
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


-- ---------------------------------------------------------------------------
-- inspection_report_pin(): a checked-out copy's report becomes a report of its version
-- ---------------------------------------------------------------------------
-- The caller rebuilds the workbook for the version first (snapshot row ids in its _blueplm sheet)
-- and uploads it; the workbook must be the caller's upload or content they can read, and a drawing
-- PDF it names the stored PDF of that version (trg_inspection_report_stamp checks both again).
CREATE OR REPLACE FUNCTION inspection_report_pin(
  p_report_id UUID,
  p_file_version_id UUID,
  p_characteristic_ids UUID[],
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
  v_base INTEGER;
  v_expected UUID;
  v_template_hash TEXT;
BEGIN
  v_actor := my_actor_id();
  v_hash := lower(btrim(COALESCE(p_storage_hash, '')));
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
  IF NOT v_row.working_copy THEN
    RAISE EXCEPTION 'This report is already a report of a checked-in version'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NOT_WORKING_COPY';
  END IF;
  IF v_row.created_by IS DISTINCT FROM v_actor AND NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only the user who generated this report can attach it to a version'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_CREATOR';
  END IF;
  IF NOT has_team_permission('module:explorer', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to edit files'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NO_EDIT_PERMISSION';
  END IF;

  -- The version the copy became: the first one its creator checked in after the base version,
  -- else the base version once the creator no longer has the drawing checked out.
  SELECT fv.version INTO v_base FROM file_version fv WHERE fv.id = v_row.file_version_id;
  SELECT fv.id INTO v_expected FROM file_version fv
   WHERE fv.file_id = v_row.file_id AND fv.version > v_base AND fv.created_by = v_row.created_by
   ORDER BY fv.version LIMIT 1;
  IF v_expected IS NULL AND NOT EXISTS (
    SELECT 1 FROM file f WHERE f.id = v_row.file_id AND f.checked_out_by = v_row.created_by
  ) THEN
    v_expected := v_row.file_version_id;
  END IF;
  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'The drawing is still checked out; check it in first'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NOT_CHECKED_IN';
  END IF;
  IF p_file_version_id IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'The report belongs to another version of this drawing'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'WRONG_VERSION';
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
  IF p_characteristic_ids IS NOT NULL AND (
       (SELECT count(DISTINCT x) FROM unnest(p_characteristic_ids) x) <> cardinality(p_characteristic_ids)
       OR (SELECT count(*) FROM inspection_characteristic_version cv
            WHERE cv.id = ANY (p_characteristic_ids) AND cv.file_version_id = v_expected)
          <> cardinality(p_characteristic_ids)) THEN
    RAISE EXCEPTION 'The characteristics are not inspection rows of this version'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_CHARACTERISTICS';
  END IF;

  IF p_template_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM inspection_template t WHERE t.id = p_template_id AND t.org_id = v_org_id) THEN
    RAISE EXCEPTION 'Template not found'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'TEMPLATE_NOT_FOUND';
  END IF;

  PERFORM set_config('blueplm.report_pin', v_row.id::text, true);
  UPDATE inspection_report
     SET file_version_id = v_expected,
         working_copy = false,
         characteristic_ids = p_characteristic_ids,
         storage_hash = v_hash,
         file_size = p_file_size,
         characteristic_count = p_characteristic_count,
         drawing_pdf_hash = NULLIF(lower(btrim(COALESCE(p_drawing_pdf_hash, ''))), ''),
         template_id = p_template_id,
         template_name = NULLIF(btrim(COALESCE(p_template_name, '')), ''),
         template_hash = v_template_hash
   WHERE id = v_row.id;
  PERFORM set_config('blueplm.report_pin', '', true);

  RETURN jsonb_build_object('pinned', true, 'id', v_row.id, 'file_version_id', v_expected);
END;
$$;

REVOKE ALL ON FUNCTION inspection_report_pin(uuid, uuid, uuid[], text, bigint, integer, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION inspection_report_pin(uuid, uuid, uuid[], text, bigint, integer, text, uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('inspection_report_pin(uuid, uuid, uuid[], text, bigint, integer, text, uuid, text, text)', '15-inspection', 510)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'inspection_report_pin(uuid,uuid,uuid[],text,bigint,integer,text,uuid,text,text)', '15-inspection', NULL,
    'file_require_access && has_team_permission && can_claim_vault_object && working_copy && set_config', 510),
  ('function', 'trg_inspection_report_stamp()', '15-inspection', NULL,
    'auth.uid && file_version && returned_by && can_claim_vault_object && drawing_pdf_render && working_copy && current_setting', 510),
  ('function', 'trg_inspection_report_freeze()', '15-inspection', NULL, 'released_at && working_copy', 510)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 510 $$;
-- Must equal VERSION_DESCRIPTIONS[510] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Reports of a checked-out drawing. inspection_report.working_copy marks a report generated from '
  'the creator''s checked-out copy (live inspection table, local drawing) before check-in; '
  'inspection_report_pin() makes it a report of the version the check-in created. Release freezes '
  'do not apply to a working-copy report.'
$$;
