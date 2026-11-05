-- =====================================================================
-- 0511_inspection_template_folder.sql: inspection templates from a vault folder (schema 510 -> 511)
-- =====================================================================
-- An administrator can name a folder of a vault as the organization's inspection report templates
-- folder (`organization.settings.inspection_reports.templates_folder` = {"vault_id", "path"}, the
-- path relative to the vault root, as the SOLIDWORKS template folders are). Every checked-in .xlsx
-- in it (and in its subfolders) is an organization template: the workbook is versioned in the vault
-- like any other file, and the library follows it.
--
--   inspection_template.source_file_id   the vault file a template comes from (NULL = uploaded).
--   inspection_template.source_path      its vault path at the last sync; set on every template
--                                        from the folder, and kept when the file is hard-deleted,
--                                        so the template is still known to come from the folder.
--   inspection_template.source_version   the file version whose bytes the template holds.
--   inspection_template_sync_folder()    brings the library in step with the folder: a new file
--                                        adds a template, a newer version replaces the workbook
--                                        (revision + 1, analysis cleared), a file that left the
--                                        folder archives its template, and one that came back
--                                        restores it.
--
-- The folder owns the workbook and whether the template is live: storage_hash, file_size,
-- revision, original_filename, archived_at and the source columns of a folder template change only
-- through the sync (trg_inspection_template_source). Administrators still name it, describe it and
-- choose its types and defaults. The sync is SECURITY DEFINER and any member may run it (report
-- generation runs it first), because it only publishes what an administrator configured; it adds
-- or replaces workbooks only for a caller who can read the folder's vault, so
-- trg_inspection_template_stamp's can_claim_vault_object() check holds for the hashes it writes.
--
-- Additive: the previous release keeps working (its selects name their columns; it cannot replace or
-- archive a folder template, which it would not know to refuse). The backup list exports
-- inspection_template whole, after file, so the new columns travel with it.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

ALTER TABLE inspection_template
  ADD COLUMN IF NOT EXISTS source_file_id UUID REFERENCES file(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_path TEXT,
  ADD COLUMN IF NOT EXISTS source_version INTEGER;

ALTER TABLE inspection_template DROP CONSTRAINT IF EXISTS inspection_template_source_check;
ALTER TABLE inspection_template ADD CONSTRAINT inspection_template_source_check CHECK (
  (source_file_id IS NULL OR source_path IS NOT NULL)
  AND (source_path IS NULL OR btrim(source_path) <> '')
  AND (source_version IS NULL OR source_version >= 1)
);

-- One template per vault file.
CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_source_file_id_key
  ON inspection_template (source_file_id) WHERE source_file_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Clients cannot write what the folder owns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_inspection_template_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('blueplm.template_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_file_id IS NOT NULL OR NEW.source_path IS NOT NULL OR NEW.source_version IS NOT NULL THEN
      RAISE EXCEPTION 'A template from the templates folder is added only by the folder sync'
        USING ERRCODE = '42501', HINT = 'VAULT_TEMPLATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_file_id IS DISTINCT FROM OLD.source_file_id
     OR NEW.source_path IS DISTINCT FROM OLD.source_path
     OR NEW.source_version IS DISTINCT FROM OLD.source_version THEN
    RAISE EXCEPTION 'The source of a template is set only by the folder sync'
      USING ERRCODE = '42501', HINT = 'VAULT_TEMPLATE';
  END IF;
  IF OLD.source_path IS NOT NULL
     AND (NEW.storage_hash IS DISTINCT FROM OLD.storage_hash
          OR NEW.file_size IS DISTINCT FROM OLD.file_size
          OR NEW.revision IS DISTINCT FROM OLD.revision
          OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
          OR NEW.archived_at IS DISTINCT FROM OLD.archived_at) THEN
    RAISE EXCEPTION 'This template comes from the templates folder: change or remove the workbook in the vault'
      USING ERRCODE = '42501', HINT = 'VAULT_TEMPLATE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_template_source ON inspection_template;
CREATE TRIGGER trg_inspection_template_source
  BEFORE INSERT OR UPDATE ON inspection_template
  FOR EACH ROW EXECUTE FUNCTION trg_inspection_template_source();

REVOKE ALL ON FUNCTION trg_inspection_template_source() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The sync
-- ---------------------------------------------------------------------------

-- A live template name of the organization that no other live template has: the base name, else
-- `name (2)`, `name (3)`, ...
CREATE OR REPLACE FUNCTION inspection_template_free_name(p_org_id UUID, p_base TEXT, p_except UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base TEXT := COALESCE(NULLIF(btrim(p_base), ''), 'Template');
  v_name TEXT := v_base;
  v_n INTEGER := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM inspection_template t
                 WHERE t.org_id = p_org_id AND t.archived_at IS NULL
                   AND t.id IS DISTINCT FROM p_except
                   AND lower(btrim(t.name)) = lower(btrim(v_name))) LOOP
    v_n := v_n + 1;
    v_name := v_base || ' (' || v_n || ')';
  END LOOP;
  RETURN v_name;
END;
$$;

REVOKE ALL ON FUNCTION inspection_template_free_name(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION inspection_template_sync_folder()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_folder JSONB;
  v_vault UUID;
  v_path TEXT;
  v_prefix TEXT;
  v_skipped TEXT;
  v_created INTEGER := 0;
  v_updated INTEGER := 0;
  v_restored INTEGER := 0;
  v_archived INTEGER := 0;
  v_seen UUID[] := '{}';
  v_file RECORD;
  v_row inspection_template%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org FROM app_user u WHERE u.id = v_actor;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Not a member of an organization' USING ERRCODE = '42501';
  END IF;

  -- One sync per organization at a time: two members generating at once must not both add a file.
  PERFORM pg_advisory_xact_lock(hashtext('inspection_template_sync_folder'), hashtext(v_org::text));
  PERFORM set_config('blueplm.template_sync', 'on', true);

  SELECT o.settings -> 'inspection_reports' -> 'templates_folder' INTO v_folder
    FROM organization o WHERE o.id = v_org;
  IF jsonb_typeof(v_folder) = 'object' THEN
    BEGIN
      v_vault := NULLIF(v_folder ->> 'vault_id', '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_vault := NULL;
    END;
    v_path := trim(both '/' from replace(btrim(COALESCE(v_folder ->> 'path', '')), '\', '/'));
  END IF;

  IF v_vault IS NULL OR v_path IS NULL OR v_path = '' THEN
    v_skipped := 'NOT_CONFIGURED';
  ELSIF NOT EXISTS (SELECT 1 FROM vault v WHERE v.id = v_vault AND v.org_id = v_org) THEN
    v_skipped := 'VAULT_NOT_FOUND';
  ELSIF NOT is_org_admin() AND NOT (v_vault = ANY (ARRAY(SELECT my_accessible_vault_ids()))) THEN
    -- Without the vault the caller could not claim the workbooks: leave the library as it is.
    RETURN jsonb_build_object('configured', true, 'skipped', 'NO_VAULT_ACCESS',
      'created', 0, 'updated', 0, 'restored', 0, 'archived', 0);
  END IF;

  IF v_skipped IS NULL THEN
    v_prefix := lower(v_path) || '/';
    FOR v_file IN
      SELECT f.id, f.file_path, f.file_name, lv.version, lv.content_hash, COALESCE(lv.file_size, 0) AS file_size
        FROM file f
        JOIN LATERAL (SELECT fv.version, fv.content_hash, fv.file_size FROM file_version fv
                       WHERE fv.file_id = f.id ORDER BY fv.version DESC LIMIT 1) lv ON true
       WHERE f.org_id = v_org AND f.vault_id = v_vault AND f.deleted_at IS NULL
         AND lower(f.extension) = '.xlsx'
         AND left(lower(f.file_path), length(v_prefix)) = v_prefix
         AND f.file_name NOT LIKE '~$%'
         AND lv.content_hash ~ '^[0-9a-f]{64}$'
       ORDER BY f.file_path
    LOOP
      v_seen := v_seen || v_file.id;
      SELECT * INTO v_row FROM inspection_template t WHERE t.source_file_id = v_file.id FOR UPDATE;
      IF v_row.id IS NULL THEN
        INSERT INTO inspection_template (org_id, name, storage_hash, file_size, original_filename,
                                         source_file_id, source_path, source_version, layout)
        VALUES (v_org,
                inspection_template_free_name(v_org, regexp_replace(v_file.file_name, '\.xlsx$', '', 'i'), NULL),
                v_file.content_hash, v_file.file_size, v_file.file_name,
                v_file.id, v_file.file_path, v_file.version, '{}'::jsonb);
        v_created := v_created + 1;
      ELSE
        IF v_row.archived_at IS NOT NULL THEN
          UPDATE inspection_template
             SET archived_at = NULL, name = inspection_template_free_name(v_org, v_row.name, v_row.id)
           WHERE id = v_row.id;
          v_restored := v_restored + 1;
        END IF;
        IF v_row.storage_hash IS DISTINCT FROM v_file.content_hash THEN
          UPDATE inspection_template
             SET storage_hash = v_file.content_hash, file_size = v_file.file_size,
                 revision = v_row.revision + 1, layout = '{}'::jsonb,
                 original_filename = v_file.file_name, source_path = v_file.file_path,
                 source_version = v_file.version
           WHERE id = v_row.id;
          v_updated := v_updated + 1;
        ELSIF v_row.source_path IS DISTINCT FROM v_file.file_path
              OR v_row.original_filename IS DISTINCT FROM v_file.file_name
              OR v_row.source_version IS DISTINCT FROM v_file.version THEN
          -- Renamed or moved inside the folder, or checked in again with the same bytes.
          UPDATE inspection_template
             SET original_filename = v_file.file_name, source_path = v_file.file_path,
                 source_version = v_file.version
           WHERE id = v_row.id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Folder templates whose file left the folder (or the folder is no longer set): archived, not
  -- deleted, so reports keep naming them and the file coming back restores them.
  WITH gone AS (
    UPDATE inspection_template t
       SET archived_at = NOW(), is_default = false
     WHERE t.org_id = v_org AND t.source_path IS NOT NULL AND t.archived_at IS NULL
       AND (t.source_file_id IS NULL OR NOT (t.source_file_id = ANY (v_seen)))
    RETURNING 1
  )
  SELECT count(*) INTO v_archived FROM gone;

  RETURN jsonb_build_object('configured', v_skipped IS NULL OR v_skipped = 'VAULT_NOT_FOUND',
    'skipped', v_skipped, 'created', v_created, 'updated', v_updated,
    'restored', v_restored, 'archived', v_archived);
END;
$$;

REVOKE ALL ON FUNCTION inspection_template_sync_folder() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION inspection_template_sync_folder() TO authenticated, service_role;

COMMENT ON FUNCTION inspection_template_sync_folder() IS
  'Brings the organization''s inspection templates in step with its templates folder '
  '(organization.settings.inspection_reports.templates_folder): adds, replaces, archives and '
  'restores folder templates. Any member; workbooks only for a caller who can read the vault.';

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

-- The requirements are identifiers: sql_strip_noise() drops string literals before matching.
INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('inspection_template_sync_folder()', '15-inspection', 511)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'inspection_template_sync_folder()', '15-inspection', NULL,
    'my_actor_id && pg_advisory_xact_lock && set_config && my_accessible_vault_ids && is_org_admin && inspection_template_free_name', 511),
  ('function', 'inspection_template_free_name(uuid,text,uuid)', '15-inspection', NULL, NULL, 511),
  ('function', 'trg_inspection_template_source()', '15-inspection', NULL,
    'current_setting && source_path && storage_hash && archived_at', 511)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 511 $$;
-- Must equal VERSION_DESCRIPTIONS[511] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Inspection templates from a vault folder. inspection_template.source_file_id, source_path and '
  'source_version tie a template to a checked-in .xlsx of the organization''s templates folder; '
  'inspection_template_sync_folder() adds, replaces, archives and restores them, and only the sync '
  'changes a folder template''s workbook or archive state.'
$$;
