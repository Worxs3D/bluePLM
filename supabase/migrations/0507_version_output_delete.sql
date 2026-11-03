-- =====================================================================
-- 0507_version_output_delete.sql: deleting a version output (schema 506 -> 507)
-- =====================================================================
-- A version's PDF or export can be deleted from the file list (5.8.0), so a bad one can be
-- generated again by anyone allowed to generate it (only an administrator may replace one).
-- Additive only: release 5.7.0 keeps working.
--
--   drawing_pdf_render_delete(id)   deletes a drawing version's PDF.
--   file_version_output_delete(id)  deletes a STEP, IGES, STL or DXF export.
--
-- Both need the file's vault (file_require_access()), and either an administrator or the user who
-- generated the output with explorer edit. A drawing PDF of a version in an open review is kept:
-- reviewers read that PDF. The content stays in the vault bucket (it is content-addressed and an
-- inspection report may embed the same bytes); only the row goes, and with it the read path
-- through that row. Clients still have no write policy on either table.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

CREATE OR REPLACE FUNCTION drawing_pdf_render_delete(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_row drawing_pdf_render%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  SELECT * INTO v_row FROM drawing_pdf_render d WHERE d.id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Output not found'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;

  PERFORM file_require_access(v_row.file_id);

  IF NOT is_org_admin()
     AND NOT (v_row.generated_by = v_actor AND has_team_permission('module:explorer', 'edit')) THEN
    RAISE EXCEPTION 'Only an administrator or the user who generated it may delete this output'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_GENERATOR';
  END IF;

  IF EXISTS (
    SELECT 1 FROM review_item ri JOIN review r ON r.id = ri.review_id
     WHERE ri.file_version_id = v_row.file_version_id
       AND r.status NOT IN ('approved', 'rejected', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'This drawing version is in an open review, whose reviewers read this PDF'
      USING ERRCODE = 'object_in_use', HINT = 'IN_REVIEW';
  END IF;

  DELETE FROM drawing_pdf_render WHERE id = v_row.id;
  RETURN jsonb_build_object('deleted', true, 'id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION drawing_pdf_render_delete(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION drawing_pdf_render_delete(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION file_version_output_delete(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_row file_version_output%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  SELECT * INTO v_row FROM file_version_output o WHERE o.id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Output not found'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;

  PERFORM file_require_access(v_row.file_id);

  IF NOT is_org_admin()
     AND NOT (v_row.generated_by = v_actor AND has_team_permission('module:explorer', 'edit')) THEN
    RAISE EXCEPTION 'Only an administrator or the user who generated it may delete this output'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_GENERATOR';
  END IF;

  DELETE FROM file_version_output WHERE id = v_row.id;
  RETURN jsonb_build_object('deleted', true, 'id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION file_version_output_delete(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION file_version_output_delete(uuid) TO authenticated, service_role;

INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('drawing_pdf_render_delete(uuid)', '10-source-files', 507),
  ('file_version_output_delete(uuid)', '10-source-files', 507)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'drawing_pdf_render_delete(uuid)', '10-source-files', NULL,
    'file_require_access && is_org_admin && has_team_permission && review_item', 507),
  ('function', 'file_version_output_delete(uuid)', '10-source-files', NULL,
    'file_require_access && is_org_admin && has_team_permission', 507)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 507 $$;
-- Must equal VERSION_DESCRIPTIONS[507] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Deleting version outputs. drawing_pdf_render_delete() and file_version_output_delete() delete '
  'a version''s drawing PDF or export (the file''s vault; an administrator, or the user who '
  'generated it with explorer edit). A drawing PDF of a version in an open review is kept. The '
  'content stays in the vault bucket.'
$$;
