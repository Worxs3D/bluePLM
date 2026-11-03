-- =====================================================================
-- 0505_version_outputs.sql: version outputs and report sequence numbers (schema 504 -> 505)
-- =====================================================================
-- Outputs of checked-in versions (5.5.0). Additive only: release 5.4.0 keeps working.
--
--   inspection_report.sequence   the report's number within its naming scope (the n of an
--                       organization's report number pattern such as {partNumber}_Rev{rev}_IRv{n}).
--                       NULL on reports from before 505; the app reads their number instead.
--   file_version_output a STEP, IGES, STL or DXF export of one checked-in file version (one
--                       configuration, or the active one when configuration is NULL), generated
--                       from that version's staged closure and stored content-addressed in the
--                       vault bucket. Drawing PDFs stay in drawing_pdf_render. It follows its
--                       file's vault (my_accessible_vault_ids()); clients only read it, and
--                       file_version_output_record() is its only writer: it needs explorer edit
--                       and the file's vault, the content must be the caller's upload or already
--                       readable (can_claim_vault_object()), and a recorded output is replaced
--                       only by an administrator, as drawing_pdf_render_record() does for PDFs.
--
-- can_read_vault_object() reads an output's content through a readable output row.
-- check_release_residue() refuses a client read policy on file_version_output (and
-- inspection_report) that skips the vault rule, and any client write policy on
-- file_version_output. Server backups export the table.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Report sequence numbers
-- ---------------------------------------------------------------------------

ALTER TABLE inspection_report
  ADD COLUMN IF NOT EXISTS sequence INTEGER
    CONSTRAINT inspection_report_sequence_check CHECK (sequence >= 1);

CREATE INDEX IF NOT EXISTS inspection_report_file_id_sequence_idx
  ON inspection_report (file_id, sequence) WHERE sequence IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Version outputs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS file_version_output (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  file_version_id UUID NOT NULL REFERENCES file_version(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CONSTRAINT file_version_output_kind_check CHECK (kind IN ('step', 'iges', 'stl', 'dxf')),
  -- The configuration exported; NULL = the configuration the version was saved in.
  configuration TEXT
    CONSTRAINT file_version_output_configuration_check CHECK (configuration IS NULL OR btrim(configuration) <> ''),
  -- SHA-256 (hex) of the exported file, stored in the vault bucket under <org>/<hh>/<hash>.
  storage_hash TEXT NOT NULL
    CONSTRAINT file_version_output_storage_hash_check CHECK (storage_hash ~ '^[0-9a-f]{64}$'),
  file_size BIGINT NOT NULL CONSTRAINT file_version_output_file_size_check CHECK (file_size > 0),
  -- The name the export was written under (no folder); a saved copy is named by the app.
  file_name TEXT NOT NULL
    CONSTRAINT file_version_output_file_name_check
      CHECK (btrim(file_name) <> '' AND length(file_name) <= 255 AND file_name !~ '[/\\]'),
  -- Whether the references the version was exported against were all exact versions. NULL when
  -- the generator did not say.
  is_closure_exact BOOLEAN,
  generated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS file_version_output_org_id_idx ON file_version_output (org_id);
CREATE INDEX IF NOT EXISTS file_version_output_file_id_idx ON file_version_output (file_id);
CREATE INDEX IF NOT EXISTS file_version_output_storage_hash_idx ON file_version_output (storage_hash);
-- One output per version, kind and configuration.
CREATE UNIQUE INDEX IF NOT EXISTS file_version_output_version_kind_configuration_key
  ON file_version_output (file_version_id, kind, (COALESCE(configuration, '')));

ALTER TABLE file_version_output ENABLE ROW LEVEL SECURITY;

-- Written out in full, as in the baseline: anon holds nothing, clients only read.
REVOKE ALL ON TABLE file_version_output FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE file_version_output TO authenticated;
GRANT ALL ON TABLE file_version_output TO service_role;

-- Outputs follow their file's vault (schema 111's rule, as drawing_pdf_render does).
DROP POLICY IF EXISTS "file_version_output: users read" ON file_version_output;
CREATE POLICY "file_version_output: users read" ON file_version_output FOR SELECT
  TO authenticated
  USING (is_org_member(org_id) AND file_id IN (SELECT f.id FROM file f WHERE f.vault_id IN (SELECT my_accessible_vault_ids())));

-- Record the output exported from a file version. The file itself is uploaded first,
-- content-addressed, to the vault bucket; this records which hash it is.
--
-- First write wins, as for drawing PDFs: recording the same hash again is a no-op (a retry), and a
-- different hash for a version, kind and configuration that already has one is refused unless the
-- caller is an administrator, so the STEP a supplier was sent does not change under them. Writing
-- needs explorer edit and the file's vault (file_require_access()); the hash must be the caller's
-- upload or content the caller can already read (can_claim_vault_object()), because every reader
-- of the row can then read the object (can_read_vault_object()).
CREATE OR REPLACE FUNCTION file_version_output_record(
  p_file_version_id UUID,
  p_kind TEXT,
  p_configuration TEXT,
  p_storage_hash TEXT,
  p_file_size BIGINT,
  p_file_name TEXT,
  p_closure_exact BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_file_id UUID;
  v_org_id UUID;
  v_hash TEXT;
  v_kind TEXT;
  v_configuration TEXT;
  v_name TEXT;
  v_existing file_version_output%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  v_hash := lower(btrim(COALESCE(p_storage_hash, '')));
  v_kind := lower(btrim(COALESCE(p_kind, '')));
  v_configuration := NULLIF(btrim(COALESCE(p_configuration, '')), '');
  v_name := btrim(COALESCE(p_file_name, ''));

  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Storage hash must be a SHA-256 hex digest'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_file_size IS NULL OR p_file_size <= 0 THEN
    RAISE EXCEPTION 'File size must be positive'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_kind NOT IN ('step', 'iges', 'stl', 'dxf') THEN
    RAISE EXCEPTION 'Unknown output kind %', p_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_name = '' OR length(v_name) > 255 OR v_name ~ '[/\\]' THEN
    RAISE EXCEPTION 'The output file name must be a plain file name'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT fv.file_id INTO v_file_id FROM file_version fv WHERE fv.id = p_file_version_id;
  IF v_file_id IS NULL THEN
    RAISE EXCEPTION 'File version not found'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_org_id := file_require_access(v_file_id);

  IF NOT has_team_permission('module:explorer', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to edit files'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NO_EDIT_PERMISSION';
  END IF;
  IF NOT can_claim_vault_object(v_hash) THEN
    RAISE EXCEPTION 'The output file was not uploaded by you'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_UPLOADER';
  END IF;

  SELECT * INTO v_existing FROM file_version_output o
  WHERE o.file_version_id = p_file_version_id AND o.org_id = v_org_id
    AND o.kind = v_kind AND COALESCE(o.configuration, '') = COALESCE(v_configuration, '')
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.storage_hash = v_hash THEN
      RETURN jsonb_build_object('recorded', false, 'replaced', false, 'storage_hash', v_hash, 'id', v_existing.id);
    END IF;
    IF NOT is_org_admin() THEN
      RAISE EXCEPTION 'An output is already recorded for this version'
        USING ERRCODE = 'unique_violation', HINT = 'OUTPUT_EXISTS';
    END IF;
    UPDATE file_version_output
    SET storage_hash = v_hash, file_size = p_file_size, file_name = v_name,
        is_closure_exact = p_closure_exact, generated_by = v_actor, generated_at = NOW()
    WHERE id = v_existing.id;
    RETURN jsonb_build_object('recorded', true, 'replaced', true, 'storage_hash', v_hash, 'id', v_existing.id);
  END IF;

  INSERT INTO file_version_output (org_id, file_id, file_version_id, kind, configuration, storage_hash,
                                   file_size, file_name, is_closure_exact, generated_by)
  VALUES (v_org_id, v_file_id, p_file_version_id, v_kind, v_configuration, v_hash,
          p_file_size, v_name, p_closure_exact, v_actor)
  ON CONFLICT (file_version_id, kind, (COALESCE(configuration, ''))) DO NOTHING
  RETURNING * INTO v_existing;

  -- Lost a race with another first write: report what is stored, never "recorded" for a hash
  -- that is not the one kept.
  IF v_existing.id IS NULL THEN
    SELECT * INTO v_existing FROM file_version_output o
    WHERE o.file_version_id = p_file_version_id AND o.kind = v_kind
      AND COALESCE(o.configuration, '') = COALESCE(v_configuration, '');
    IF v_existing.storage_hash = v_hash THEN
      RETURN jsonb_build_object('recorded', false, 'replaced', false, 'storage_hash', v_hash, 'id', v_existing.id);
    END IF;
    RAISE EXCEPTION 'An output is already recorded for this version'
      USING ERRCODE = 'unique_violation', HINT = 'OUTPUT_EXISTS';
  END IF;

  RETURN jsonb_build_object('recorded', true, 'replaced', false, 'storage_hash', v_hash, 'id', v_existing.id);
END;
$$;

REVOKE ALL ON FUNCTION file_version_output_record(uuid, text, text, text, bigint, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION file_version_output_record(uuid, text, text, text, bigint, text, boolean)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading output content from the vault bucket
-- ---------------------------------------------------------------------------
-- 0504's can_read_vault_object(), with one more way in: an object a readable version output
-- names, through the output's file's vault.
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
        OR EXISTS (SELECT 1 FROM file_version_output o JOIN file f ON f.id = o.file_id
                    WHERE o.storage_hash = obj.hash AND o.org_id = obj.org_id AND f.org_id = obj.org_id
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

-- ---------------------------------------------------------------------------
-- What the data must no longer contain
-- ---------------------------------------------------------------------------
-- The baseline's check_release_residue() (supabase/core.sql), verbatim except two table lists:
-- the vault rule now covers file_version_output and inspection_report, and file_version_output
-- joins the tables no client write policy may name (file_version_output_record() is its writer).
CREATE OR REPLACE FUNCTION check_release_residue()
RETURNS TABLE (residue TEXT, identity TEXT, detail TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r RECORD;
  color_swatches_scope_columns BOOLEAN;
  color_swatches_scope_controls BOOLEAN;
  color_swatches_realtime BOOLEAN;
  sw_licence_policy RECORD;
  review_write_policy RECORD;
  vault_policy RECORD;
BEGIN
  -- ---------------------------------------------------------------------
  -- Share links handing out a file in an organization somebody involved is not
  -- part of.
  --
  -- Three different rows match and all three are live cross-tenant credentials:
  -- one minted through the hole; one minted in good faith for a file that later
  -- moved organizations; and one whose link and file agree because both were
  -- rewritten together over the UPDATE policy, which carried no WITH CHECK
  -- until this release. The third is the one an org_id-only match cannot see,
  -- so the creator's membership is a term of the query here and not only of the
  -- prose - it must be, or this reports clean over a row
  -- file_share_link_remediate_cross_tenant() is about to deactivate, and the two
  -- halves of the release stop agreeing.
  --
  -- The detail says which shape it looks like, so an operator restoring a link
  -- they judge legitimate can tell them apart. None is left active, because
  -- under this release file_share_link_validate() resolves the organization from the
  -- file, so all three hand out a file to somebody with no claim on it.
  -- ---------------------------------------------------------------------
  IF to_regclass('public.file_share_link') IS NOT NULL
     AND to_regclass('public.file') IS NOT NULL THEN
    FOR r IN
      SELECT l.id, l.token, l.org_id AS link_org, f.org_id AS file_org,
             l.created_by, l.created_at, cu.org_id AS creator_org
      FROM file_share_link l
      JOIN file f ON f.id = l.file_id
      LEFT JOIN app_user cu ON cu.id = l.created_by
      WHERE (l.org_id IS DISTINCT FROM f.org_id
             OR cu.org_id IS DISTINCT FROM f.org_id)
        AND COALESCE(l.is_active, false)
      ORDER BY l.created_at
    LOOP
      residue := 'cross_tenant_share_link';
      -- The token's first eight characters as well as the row id, because the
      -- way an operator meets this is somebody telling them a link stopped
      -- working, and what they have is the URL. Eight characters of a
      -- 128-bit token identify the row without being the credential, and the
      -- credential is about to be deactivated in any case.
      identity := 'file_share_link.id = ' || r.id
               || ' (token ' || left(r.token, 8) || '...)';
      detail := 'is active and grants access to a file in organization '
             || r.file_org || ', while the link itself was minted for '
             || COALESCE(r.link_org::TEXT, 'no organization') || '. Created by '
             || r.created_by || ' on ' || r.created_at || ', who is '
             || CASE
                  WHEN r.link_org IS NOT DISTINCT FROM r.file_org
                    THEN 'NOT a member of the file''s organization even though '
                         || 'the link names it correctly - the shape an UPDATE '
                         || 'with no WITH CHECK produced by rewriting file_id '
                         || 'and org_id together, or a creator who has since '
                         || 'left the organization'
                  WHEN r.creator_org IS NOT DISTINCT FROM r.file_org
                    THEN 'a member of the file''s organization, so this is most '
                         || 'likely a file that moved after the link was minted '
                         || 'in good faith'
                  ELSE 'NOT a member of the file''s organization, which is the '
                       || 'shape file_share_link_create produced before this '
                       || 'release resolved the organization from the file' END
             || '. Deactivate it: SELECT file_share_link_remediate_cross_tenant();';
      RETURN NEXT;
    END LOOP;
  END IF;

  -- ---------------------------------------------------------------------
  -- Workflow history naming another organization's workflow.
  --
  -- Asked through the foreign keys rather than through the names. A name join
  -- would report every history row of two tenants who both called a workflow
  -- 'Standard Release', which is not a finding and would make the stamp
  -- unobtainable for a reason nobody could act on.
  -- ---------------------------------------------------------------------
  IF to_regclass('public.workflow_history') IS NOT NULL
     AND to_regclass('public.workflow_template') IS NOT NULL THEN
    FOR r IN
      SELECT h.id, h.org_id, h.file_id, h.workflow_name, h.performed_at
      FROM workflow_history h
      WHERE EXISTS (SELECT 1 FROM workflow_template t
                     WHERE t.id = h.workflow_id AND t.org_id <> h.org_id)
         OR EXISTS (SELECT 1 FROM workflow_transition tr
                     JOIN workflow_template t2 ON t2.id = tr.workflow_id
                    WHERE tr.id = h.transition_id AND t2.org_id <> h.org_id)
         OR EXISTS (SELECT 1 FROM workflow_state s
                     JOIN workflow_template t3 ON t3.id = s.workflow_id
                    WHERE s.id IN (h.from_state_id, h.to_state_id)
                      AND t3.org_id <> h.org_id)
      ORDER BY h.performed_at
    LOOP
      residue := 'cross_tenant_workflow_history';
      identity := 'workflow_history.id = ' || r.id;
      detail := 'is filed under organization ' || r.org_id || ' and names a '
             || 'workflow, transition or state belonging to another one. The '
             || 'names copied into it are readable by every member of '
             || r.org_id || ' through their own history. Redact it: '
             || 'SELECT workflow_history_remediate_cross_tenant();';
      RETURN NEXT;
    END LOOP;
  END IF;

  -- ---------------------------------------------------------------------
  -- A file left sitting in another organization's workflow state.
  --
  -- The same attack rewrote this row. It discloses no names by itself, and it
  -- decides which transitions the file offers, so leaving it is leaving the
  -- file driven by a workflow its organization does not own.
  -- ---------------------------------------------------------------------
  IF to_regclass('public.file_workflow_assignment') IS NOT NULL
     AND to_regclass('public.workflow_template') IS NOT NULL
     AND to_regclass('public.file') IS NOT NULL THEN
    FOR r IN
      SELECT a.file_id, f.org_id AS file_org, wt.org_id AS workflow_org, wt.id AS workflow_id
      FROM file_workflow_assignment a
      JOIN file f ON f.id = a.file_id
      JOIN workflow_template wt ON wt.id = a.workflow_id
      WHERE wt.org_id <> f.org_id
      ORDER BY a.file_id
    LOOP
      residue := 'cross_tenant_workflow_assignment';
      identity := 'file_workflow_assignment.file_id = ' || r.file_id;
      detail := 'assigns a file in organization ' || r.file_org
             || ' to workflow ' || r.workflow_id || ', which belongs to '
             || r.workflow_org || '. Clear it: '
             || 'SELECT workflow_history_remediate_cross_tenant();';
      RETURN NEXT;
    END LOOP;
  END IF;

  -- ---------------------------------------------------------------------
  -- Two active rows in `folder` spelling one path two ways.
  --
  -- folder_vault_id_folder_path_idx is unique on (vault_id, LOWER(folder_path))
  -- WHERE deleted_at IS NULL and forbids this by construction, and
  -- folder_remediate_case_collisions() ran once, at v99, clearing every group
  -- that existed then - so on a database that still carries the index this
  -- clause finds nothing, every time. It travels here anyway, per this file's
  -- own doctrine a few hundred lines up: a remediation and a residue check
  -- travel together, or a database that skipped the remediation - or lost the
  -- index afterwards, since nothing stops an operator from dropping and
  -- rebuilding it without UNIQUE - verifies clean while carrying the exact
  -- defect v99 closed.
  -- ---------------------------------------------------------------------
  IF to_regclass('public.folder') IS NOT NULL THEN
    FOR r IN
      SELECT f.vault_id, LOWER(f.folder_path) AS folder_key,
             count(*) AS row_count,
             array_agg(DISTINCT f.folder_path ORDER BY f.folder_path) AS spellings,
             array_agg(f.id ORDER BY f.created_at, f.id) AS ids
        FROM folder f
       WHERE f.deleted_at IS NULL
       GROUP BY f.vault_id, LOWER(f.folder_path)
      HAVING count(*) > 1
       ORDER BY f.vault_id, LOWER(f.folder_path)
    LOOP
      residue := 'case_colliding_folders';
      identity := 'folder.vault_id = ' || r.vault_id
                || ', LOWER(folder_path) = ''' || r.folder_key || '''';
      detail := r.row_count || ' active row(s) - ids ' || array_to_string(r.ids, ', ')
             || ' - spell one folder ' || array_to_string(r.spellings, ' / ')
             || ' in vault ' || r.vault_id || '. folder_vault_id_folder_path_idx should make '
             || 'this impossible; if it is missing or was rebuilt without UNIQUE, restore '
             || 'it and run: SELECT folder_remediate_case_collisions();';
      RETURN NEXT;
    END LOOP;
  END IF;

  -- ---------------------------------------------------------------------
  -- `folder` missing from the realtime publication, or missing REPLICA
  -- IDENTITY FULL - the two v101 statements that make a folder deletion
  -- reach another client at all.
  --
  -- Neither is a table nor a function, so schema_get_release_manifest() cannot
  -- see either one, and the thirteen tables that got the same two
  -- statements in the same DO block of 10-source-files.sql are equally
  -- unverified there. This clause exists anyway, for the reason v101 is the
  -- first of the fourteen to get one instead of joining that silence: it
  -- changes what the database must look like for the reported bug to stay
  -- fixed, and this file's own doctrine a few hundred lines up is that a
  -- release which does that should not be stampable while the database does
  -- not look like that yet. Guarded on to_regclass so a database without
  -- module 10 - which is where `folder` is created - is never asked about
  -- a table it does not have.
  -- ---------------------------------------------------------------------
  IF to_regclass('public.folder') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'folder'
    ) THEN
      residue := 'folders_not_published';
      identity := 'publication supabase_realtime';
      detail := 'folder is not a member of the supabase_realtime publication, so a '
             || 'folder deletion never reaches another client. Run: '
             || 'ALTER PUBLICATION supabase_realtime ADD TABLE folder;';
      RETURN NEXT;
    END IF;

    IF (SELECT relreplident FROM pg_class WHERE oid = 'public.folder'::regclass) <> 'f' THEN
      residue := 'folders_not_replica_identity_full';
      identity := 'pg_class.relreplident for public.folder';
      detail := 'folder does not have REPLICA IDENTITY FULL, so an UPDATE''s old '
             || 'record on the wire carries only the primary key and a deleted_at '
             || 'null-to-set transition is undetectable. Run: '
             || 'ALTER TABLE folder REPLICA IDENTITY FULL;';
      RETURN NEXT;
    END IF;
  END IF;

  -- Organization color swatches require both scope columns and a nullable
  -- personal owner. Without them the desktop can render the shared-palette UI
  -- but every organization query or insert fails at runtime.
  IF to_regclass('public.color_swatch') IS NOT NULL THEN
    SELECT
      COUNT(*) FILTER (WHERE column_name IN ('org_id', 'created_by')) = 2
      AND BOOL_OR(column_name = 'user_id' AND is_nullable = 'YES')
      INTO color_swatches_scope_columns
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'color_swatch';

    IF NOT COALESCE(color_swatches_scope_columns, false) THEN
      residue := 'color_swatches_scope_columns_missing';
      identity := 'public.color_swatch';
      detail := 'Organization color swatches require nullable user_id plus org_id and '
             || 'created_by columns. Re-run supabase/core.sql before verifying this release.';
      RETURN NEXT;
    END IF;

    SELECT
      EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.color_swatch'::regclass
           AND conname = 'color_swatch_scope_check'
      )
      AND EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgrelid = 'public.color_swatch'::regclass
           AND tgname = 'trg_color_swatch_set_creator'
           AND NOT tgisinternal
      )
      AND (
        SELECT COUNT(*) = 2
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'color_swatch'
           AND policyname IN (
             'color_swatch: users read',
             'color_swatch: users manage'
           )
      )
      INTO color_swatches_scope_controls;

    IF NOT COALESCE(color_swatches_scope_controls, false) THEN
      residue := 'color_swatches_scope_controls_missing';
      identity := 'public.color_swatch';
      detail := 'Organization color swatches require the scope constraint, creator trigger, '
             || 'and both access policies. Re-run supabase/core.sql before verifying this release.';
      RETURN NEXT;
    END IF;

    -- Shared palette changes reach other clients (schema 109). The renderer's
    -- DELETE subscription filters on org_id, which only matches when the old
    -- record carries every column, so publication membership alone is not enough.
    SELECT EXISTS (
             SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime'
                AND schemaname = 'public'
                AND tablename = 'color_swatch'
           )
       AND (SELECT relreplident FROM pg_class WHERE oid = 'public.color_swatch'::regclass) = 'f'
      INTO color_swatches_realtime;

    IF NOT COALESCE(color_swatches_realtime, false) THEN
      residue := 'color_swatches_not_realtime';
      identity := 'publication supabase_realtime';
      detail := 'color_swatch must be in the supabase_realtime publication with REPLICA '
             || 'IDENTITY FULL, or a shared palette change (a DELETE''s old record carries '
             || 'only the primary key, so the org_id filter never matches) never reaches '
             || 'another client. Run: ALTER TABLE color_swatch REPLICA IDENTITY FULL; '
             || 'ALTER PUBLICATION supabase_realtime ADD TABLE color_swatch;';
      RETURN NEXT;
    END IF;
  END IF;

  -- SOLIDWORKS serial numbers are readable by admins and by the licence's own
  -- assignee only (schema 106). A SELECT policy on solidworks_license with no
  -- is_org_admin() arm is a leftover such as the pre-106 "Org members can view"
  -- policy, which handed every member every serial; an assignment UPDATE policy without is_org_admin() lets a user repoint their
  -- assignment's license_id at somebody else's licence and read its serial.
  -- Policies are OR-ed, so one stale permissive policy undoes the release.
  IF to_regclass('public.solidworks_license') IS NOT NULL THEN
    FOR sw_licence_policy IN
      SELECT p.tablename, p.policyname
        FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND (
           (p.tablename = 'solidworks_license'
             AND p.cmd IN ('SELECT', 'ALL')
             AND p.permissive = 'PERMISSIVE'
             AND COALESCE(p.qual, '') NOT LIKE '%is_org_admin()%')
           OR
           (p.tablename = 'solidworks_license_assignment'
             AND p.cmd IN ('SELECT', 'UPDATE', 'ALL')
             AND p.permissive = 'PERMISSIVE'
             AND COALESCE(p.qual, '') NOT LIKE '%is_org_admin()%')
         )
    LOOP
      residue := 'solidworks_license_policy_too_broad';
      identity := 'public.' || sw_licence_policy.tablename || ' / ' || sw_licence_policy.policyname;
      detail := 'This policy lets a non-admin read another user''s SOLIDWORKS serial number. '
             || 'Re-run supabase/modules/40-integrations.sql, which drops it.';
      RETURN NEXT;
    END LOOP;
  END IF;

  -- File data follows vault access (schema 111). Every permissive policy that
  -- lets a client read these tables (SELECT, or ALL, which includes it) must
  -- apply my_accessible_vault_ids(), directly or through the files subquery that
  -- names it. A leftover such as the pre-111 "Users can view org files" hands
  -- every member every file of the organization, and policies are OR-ed.
  FOR vault_policy IN
    SELECT p.tablename, p.policyname
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename IN ('file', 'file_version', 'folder', 'file_reference',
                           'file_version_reference', 'drawing_pdf_render', 'release_file',
                           'file_comment', 'file_watcher', 'file_share_link',
                           'file_state_entry', 'file_workflow_assignment', 'workflow_history',
                           'workflow_review_history', 'activity', 'inspection_characteristic',
                           'inspection_characteristic_version', 'file_eco', 'file_deviation',
                           'inspection_report', 'file_version_output')
       AND p.cmd IN ('SELECT', 'ALL')
       AND p.permissive = 'PERMISSIVE'
       AND COALESCE(p.qual, '') NOT LIKE '%my_accessible_vault_ids()%'
  LOOP
    residue := 'file_policy_ignores_vault_access';
    identity := 'public.' || vault_policy.tablename || ' / ' || vault_policy.policyname;
    detail := 'This policy lets a member read file data in a vault they have no access to. '
           || 'Re-run supabase/modules/10-source-files.sql, 15-inspection.sql and '
           || '20-change-control.sql, which replace it, then drop it if it is still listed.';
    RETURN NEXT;
  END LOOP;

  -- Cross-tenant reads and the email forge (schema 111). organizations, users and
  -- vaults are readable inside the caller's organization only, and no client
  -- UPDATE on users may change email, which invitations, domain joins and blocks
  -- used to trust.
  FOR vault_policy IN
    SELECT p.tablename, p.policyname, p.cmd
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.permissive = 'PERMISSIVE'
       AND (
         (p.tablename IN ('organization', 'app_user', 'vault')
           AND p.cmd IN ('SELECT', 'ALL')
           AND btrim(COALESCE(p.qual, 'true')) IN ('true', '(true)'))
         OR
         (p.tablename = 'app_user'
           AND p.cmd IN ('UPDATE', 'ALL')
           AND COALESCE(p.with_check, p.qual, '') NOT LIKE '%email%')
       )
  LOOP
    residue := 'org_or_user_policy_too_broad';
    identity := 'public.' || vault_policy.tablename || ' / ' || vault_policy.policyname;
    detail := 'This ' || vault_policy.cmd || ' policy lets an account read another organization''s '
           || 'rows or rewrite its own email address. Re-run supabase/core.sql and '
           || 'modules/10-source-files.sql, which replace it.';
    RETURN NEXT;
  END LOOP;

  -- Secrets and logs that are admin-only (schema 112): the backup bucket keys and
  -- restic password, webhook signing secrets and their delivery log. A SELECT or
  -- ALL policy without is_org_admin() hands them to every member; any client write
  -- policy on webhook_delivery is a leftover of the TRUE "Service" policies.
  FOR vault_policy IN
    SELECT p.tablename, p.policyname, p.cmd
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.permissive = 'PERMISSIVE'
       AND (
         (p.tablename IN ('backup_config', 'webhook', 'webhook_delivery')
           AND p.cmd IN ('SELECT', 'ALL')
           AND COALESCE(p.qual, '') NOT LIKE '%is_org_admin()%')
         OR (p.tablename = 'webhook_delivery' AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE'))
       )
  LOOP
    residue := 'secret_table_policy_too_broad';
    identity := 'public.' || vault_policy.tablename || ' / ' || vault_policy.policyname;
    detail := 'This ' || vault_policy.cmd || ' policy exposes or lets clients write an admin-only '
           || 'table. Re-run supabase/modules/10-source-files.sql and 40-integrations.sql.';
    RETURN NEXT;
  END LOOP;

  -- Storage (schema 111). The application's buckets are vault (module 10's four
  -- policies) and org-extensions (module 50's four). Module 10 drops every other
  -- policy on storage.objects; one that remains - such as the dashboard-made
  -- "Allow authenticated access" policies granting `true` on every bucket - can
  -- hand any account any organization's files.
  IF to_regclass('storage.objects') IS NOT NULL THEN
    FOR vault_policy IN
      SELECT p.tablename, p.policyname
        FROM pg_policies p
       WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
         AND p.policyname NOT IN ('Vault: read readable objects', 'Vault: upload to own organization',
                                  'Vault: update own or org assets', 'Vault: delete own or as admin',
                                  'Org members read their org extension packages',
                                  'Org admins upload extension packages',
                                  'Org admins update extension packages',
                                  'Org admins delete extension packages')
    LOOP
      residue := 'storage_policy_unmanaged';
      identity := 'storage.objects / ' || vault_policy.policyname;
      detail := 'A storage policy outside the managed set can admit reads or writes of any '
             || 'organization''s files. Re-run supabase/modules/10-source-files.sql, which drops it.';
      RETURN NEXT;
    END LOOP;
  END IF;

  -- Review and gate-review tables take no client writes (schema 107). Any
  -- INSERT, UPDATE, DELETE or ALL policy on them is a leftover such as the
  -- pre-107 "Reviewers can respond", which let a requester approve on behalf of
  -- every reviewer, or "Users can update pending reviews", which let a member
  -- approve a gate around gate_review_complete(). Policies are OR-ed, so one
  -- stale permissive policy undoes the release.
  FOR review_write_policy IN
    SELECT p.tablename, p.policyname, p.cmd
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename IN ('review', 'review_response', 'review_item', 'review_round',
                           'review_round_item', 'review_decision', 'workflow_gate_review',
                           'workflow_review_history', 'file_version_reference',
                           'drawing_pdf_render', 'file_version_output')
       AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    residue := 'review_client_write_policy';
    identity := 'public.' || review_write_policy.tablename || ' / ' || review_write_policy.policyname;
    detail := 'A ' || review_write_policy.cmd || ' policy lets clients write this table, which only '
           || 'the review RPCs may write. Re-run supabase/modules/10-source-files.sql and '
           || '20-change-control.sql, which drop it.';
    RETURN NEXT;
  END LOOP;

  -- The rest of the review migration (schema 107), checked on its data.
  IF to_regclass('public.workflow_gate_review') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'workflow_gate_review'
         AND column_name = 'attempt_id' AND is_nullable = 'NO'
    ) THEN
      residue := 'pending_reviews_attempt_id_missing';
      identity := 'public.workflow_gate_review.attempt_id';
      detail := 'Gate approvals are counted per attempt and need a NOT NULL attempt_id. '
             || 'Re-run supabase/modules/10-source-files.sql.';
      RETURN NEXT;
    END IF;
  END IF;

  IF to_regclass('public.review_response') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint con
       WHERE con.conrelid = 'public.review_response'::regclass
         AND con.contype = 'u'
         AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                FROM unnest(con.conkey) AS k(attnum)
                JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum)
             = ARRAY['review_id', 'reviewer_id']
    ) THEN
      residue := 'review_responses_legacy_key';
      identity := 'public.review_response';
      detail := 'A unique key on (review_id, reviewer_id) refuses every second review round. '
             || 'Re-run supabase/modules/20-change-control.sql.';
      RETURN NEXT;
    END IF;
  END IF;

  IF to_regclass('public.review_item') IS NOT NULL THEN
    FOR review_write_policy IN
      SELECT rv.id::text AS tablename, NULL::text AS policyname, NULL::text AS cmd
        FROM review rv
       WHERE rv.file_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM review_item i WHERE i.review_id = rv.id)
         AND EXISTS (SELECT 1 FROM file_version fv WHERE fv.file_id = rv.file_id)
       ORDER BY rv.created_at
       LIMIT 20
    LOOP
      residue := 'review_not_migrated';
      identity := 'review.id = ' || review_write_policy.tablename;
      detail := 'A pre-107 review whose file has a version was not migrated into a package. '
             || 'Re-run supabase/modules/20-change-control.sql.';
      RETURN NEXT;
    END LOOP;
  END IF;
  -- Review upkeep (schema 108). The triggers are what keep a departed reviewer
  -- or a deleted file from holding an open review forever; the manifest sees
  -- only their functions, so their presence is checked here.
  IF to_regclass('public.review_response') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'review_response'
         AND column_name = 'withdrawn_at'
    ) THEN
      residue := 'review_withdrawn_column_missing';
      identity := 'public.review_response.withdrawn_at';
      detail := 'Re-run supabase/modules/20-change-control.sql.';
      RETURN NEXT;
    END IF;

    FOR r IN
      SELECT x.tbl, x.tg
        FROM (VALUES
          ('app_user', 'trg_app_user_withdraw_lost_reviewers'),
          ('team_member', 'trg_team_member_withdraw_lost_reviewers'),
          ('vault_access', 'trg_vault_access_withdraw_lost_reviewers'),
          ('team_vault_access', 'trg_team_vault_access_withdraw_lost_reviewers'),
          ('review_item', 'trg_review_item_resettle_on_delete')
        ) AS x(tbl, tg)
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = to_regclass('public.' || x.tbl)
            AND t.tgname = x.tg
            AND NOT t.tgisinternal)
    LOOP
      residue := 'review_upkeep_trigger_missing';
      identity := 'public.' || r.tbl || ' / ' || r.tg;
      detail := 'Without this trigger an open review can wait forever on a reviewer who left or a '
             || 'file that was deleted. Re-run supabase/modules/20-change-control.sql.';
      RETURN NEXT;
    END LOOP;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Server backups export the table
-- ---------------------------------------------------------------------------
-- 0504's backup_list_org_rows(), verbatim except file_version_output. The worker's list
-- (BACKUP_TABLES in api/src/backup/source.ts) may name it once this release is applied.
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
    WHEN 'file_version_output' THEN 'org_id = $1'
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
-- can_read_vault_object, check_release_residue and backup_list_org_rows are registered already;
-- CREATE OR REPLACE keeps their grants. check_release_residue()'s manifest entry stays as it is:
-- its new table names are string literals, which the manifest's body probe does not read.
-- file_version_output_record is new and executable by signed-in users, so it is registered.

INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('file_version_output_record(uuid, text, text, text, bigint, text, boolean)', '10-source-files', 505)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('table', 'file_version_output', '10-source-files', NULL, NULL, 505),
  ('function', 'file_version_output_record(uuid,text,text,text,bigint,text,boolean)', '10-source-files', NULL,
    'file_require_access && has_team_permission && can_claim_vault_object && is_org_admin', 505),
  ('function', 'can_read_vault_object(text)', '10-source-files', NULL,
    'my_accessible_vault_ids && file_version && drawing_pdf_render && file_version_output && inspection_report && inspection_template', 505)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 505 $$;
-- Must equal VERSION_DESCRIPTIONS[505] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Version outputs. file_version_output keeps the STEP, IGES, STL and DXF exports of a checked-in '
  'file version (per configuration) in the vault bucket; it follows the file''s vault, clients only '
  'read it, and file_version_output_record() writes it (explorer edit, the file''s vault, content '
  'the caller uploaded or can read; replacing a recorded output is for administrators). '
  'can_read_vault_object() reads output content; check_release_residue() covers the table; '
  'server backups export it. inspection_report gains sequence, the report''s number within its '
  'naming scope.'
$$;
