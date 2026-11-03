-- =====================================================================
-- 0508_inspection_report_lineage.sql: inspection report lineage (schema 507 -> 508)
-- =====================================================================
-- A regenerated report names the report it replaces, so the file list shows the newest report of
-- a lineage instead of one more line per regeneration. Additive only: release 5.8.0 keeps working
-- (it neither reads nor writes the new column, and its reports supersede nothing).
--
--   inspection_report.supersedes_report_id  the report this one replaces, a report of the same
--                       drawing (file_id). NULL = it replaces nothing. Fixed at insert; it only
--                       goes away with the report it names (ON DELETE SET NULL). A report never
--                       supersedes itself.
--
-- No new table, policy or function callable by clients; server backups already export the table
-- whole (to_jsonb(row)), so the API is unchanged.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

ALTER TABLE inspection_report
  ADD COLUMN IF NOT EXISTS supersedes_report_id UUID REFERENCES inspection_report(id) ON DELETE SET NULL;

ALTER TABLE inspection_report DROP CONSTRAINT IF EXISTS inspection_report_supersedes_self_check;
ALTER TABLE inspection_report ADD CONSTRAINT inspection_report_supersedes_self_check
  CHECK (supersedes_report_id IS DISTINCT FROM id);

CREATE INDEX IF NOT EXISTS inspection_report_supersedes_report_id_idx
  ON inspection_report (supersedes_report_id) WHERE supersedes_report_id IS NOT NULL;

-- On insert the superseded report is a report of the same drawing. On update the link is kept
-- (as 0506 keeps the FAI baseline): it only goes away with the report it names, when ON DELETE
-- SET NULL runs this update after that row is gone; a client clearing or repointing it keeps the
-- recorded one. Not SECURITY DEFINER: the lookup goes through the caller's RLS, the vault rule
-- the report's own policies apply.
CREATE OR REPLACE FUNCTION trg_inspection_report_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.supersedes_report_id IS DISTINCT FROM OLD.supersedes_report_id
       AND NOT (NEW.supersedes_report_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM inspection_report r WHERE r.id = OLD.supersedes_report_id)) THEN
      NEW.supersedes_report_id := OLD.supersedes_report_id;
    END IF;
  ELSIF NEW.supersedes_report_id IS NOT NULL THEN
    IF NEW.supersedes_report_id = NEW.id THEN
      RAISE EXCEPTION 'A report cannot replace itself' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM inspection_report r
       WHERE r.id = NEW.supersedes_report_id AND r.file_id = NEW.file_id
    ) THEN
      RAISE EXCEPTION 'The replaced report is not a report of this drawing' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_report_lineage ON inspection_report;
CREATE TRIGGER trg_inspection_report_lineage
  BEFORE INSERT OR UPDATE ON inspection_report
  FOR EACH ROW EXECUTE FUNCTION trg_inspection_report_lineage();

-- Trigger functions run whoever fires them; nobody calls them.
REVOKE ALL ON FUNCTION trg_inspection_report_lineage() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'trg_inspection_report_lineage()', '15-inspection', NULL, 'supersedes_report_id', 508)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 508 $$;
-- Must equal VERSION_DESCRIPTIONS[508] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Inspection report lineage. inspection_report gains supersedes_report_id, the report of the '
  'same drawing that a regenerated report replaces; it is fixed once the report is issued and '
  'cleared only when the replaced report is deleted.'
$$;
