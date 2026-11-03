-- =====================================================================
-- 0506_inspection_report_types.sql: inspection report types (schema 505 -> 506)
-- =====================================================================
-- Report types (5.6.0). Additive only: release 5.5.0 keeps working (it neither reads nor writes
-- the new columns, and its reports stay valid as "legacy" reports with no type).
--
--   inspection_report.report_type  'fai' (first article, SAE AS9102), 'production' (lot
--                       inspection), 'receiving' (incoming inspection of a received lot) or
--                       'reinspection' (after a nonconformance). NULL = a report from before 506.
--     fai_scope         'full' | 'partial' (FAI only). A partial (delta) FAI re-verifies the
--                       characteristics changed since fai_baseline_version_id, the version of
--                       the drawing whose FAI it builds on (a version of the same file).
--     fai_reason        why the FAI is done (AS9102: new part, design change, process, source,
--                       tooling or location change, a lapse in production, a natural or
--                       man-made event, corrective action, other).
--     lot_number, lot_size, sampling   production and receiving: the lot and its sampling plan
--                       ({"plan": "100"} = every part, {"plan": "fixed", "n": <int>} = n parts).
--                       ANSI/ASQ Z1.4 plans are not offered: no plan without its published tables.
--     po_number, supplier_name         receiving only.
--     ncr_reference     re-inspection only: the nonconformance it follows.
--     characteristic_ids  the snapshot rows (inspection_characteristic_version ids) the report
--                       includes, so a returned workbook is checked against that set. NULL = every
--                       row of the version (legacy, full FAI). Its length is characteristic_count;
--                       no duplicates, and every id is a snapshot row of the report's drawing.
--     sample_columns    lot reports: the most parts laid out as result columns of the template
--                       (min of its result columns and 10); a characteristic measured on more
--                       parts gets one row per part. The import lays the workbook out the same way.
--   Everything above describes what the generated workbook printed, so it is fixed at insert
--   (trg_inspection_report_type keeps it on update, as 0504 keeps the file and version). A partial
--   FAI names its baseline at insert; the baseline only goes away with its version.
--   results written on a typed report must be in the 5.6 format (results.format
--   'blueplm-inspection-results/2'): a 5.5.0 client would grade the whole version instead of the
--   report's own characteristics, so its import into a typed report is refused.
--
--   inspection_template.report_types  the types a template serves; empty = any type.
--   inspection_template.default_for   the types it is the organization's default for. One default
--                       per type per organization: claiming a type takes it from the template that
--                       had it (trg_inspection_template_defaults, under an advisory lock per
--                       organization). is_default stays the default for any type without one.
--
-- No new table, policy or function callable by clients; server backups already export both
-- tables whole (to_jsonb(row)), so the API is unchanged.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Report columns
-- ---------------------------------------------------------------------------

ALTER TABLE inspection_report
  ADD COLUMN IF NOT EXISTS report_type TEXT
    CONSTRAINT inspection_report_report_type_check
      CHECK (report_type IN ('fai', 'production', 'receiving', 'reinspection')),
  ADD COLUMN IF NOT EXISTS fai_scope TEXT
    CONSTRAINT inspection_report_fai_scope_check CHECK (fai_scope IN ('full', 'partial')),
  ADD COLUMN IF NOT EXISTS fai_reason TEXT
    CONSTRAINT inspection_report_fai_reason_check CHECK (fai_reason IN (
      'new_part', 'design_change', 'process_change', 'source_change', 'tooling_change',
      'location_change', 'production_lapse', 'natural_event', 'corrective_action', 'other')),
  ADD COLUMN IF NOT EXISTS fai_baseline_version_id UUID REFERENCES file_version(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_number TEXT
    CONSTRAINT inspection_report_lot_number_check CHECK (btrim(lot_number) <> '' AND length(lot_number) <= 100),
  ADD COLUMN IF NOT EXISTS lot_size INTEGER
    CONSTRAINT inspection_report_lot_size_check CHECK (lot_size >= 1),
  ADD COLUMN IF NOT EXISTS sampling JSONB
    CONSTRAINT inspection_report_sampling_check CHECK (
      jsonb_typeof(sampling) = 'object'
      AND sampling->>'plan' IN ('100', 'fixed')
      AND (sampling->>'plan' <> 'fixed'
           OR COALESCE(jsonb_typeof(sampling->'n') = 'number' AND (sampling->>'n')::numeric >= 1
                       AND (sampling->>'n')::numeric = trunc((sampling->>'n')::numeric), false))),
  ADD COLUMN IF NOT EXISTS po_number TEXT
    CONSTRAINT inspection_report_po_number_check CHECK (btrim(po_number) <> '' AND length(po_number) <= 100),
  ADD COLUMN IF NOT EXISTS supplier_name TEXT
    CONSTRAINT inspection_report_supplier_name_check CHECK (btrim(supplier_name) <> '' AND length(supplier_name) <= 200),
  ADD COLUMN IF NOT EXISTS ncr_reference TEXT
    CONSTRAINT inspection_report_ncr_reference_check CHECK (btrim(ncr_reference) <> '' AND length(ncr_reference) <= 100),
  ADD COLUMN IF NOT EXISTS characteristic_ids UUID[],
  ADD COLUMN IF NOT EXISTS sample_columns INTEGER
    CONSTRAINT inspection_report_sample_columns_check CHECK (sample_columns BETWEEN 1 AND 50);

-- Which columns a type may carry. A legacy report (no type) carries none of them (COALESCE: a
-- NULL type must fail the type tests, not make them unknown, which a CHECK lets through).
ALTER TABLE inspection_report DROP CONSTRAINT IF EXISTS inspection_report_type_fields_check;
ALTER TABLE inspection_report ADD CONSTRAINT inspection_report_type_fields_check CHECK (
  -- FAI: a scope; a partial FAI names its characteristics.
  (CASE WHEN report_type = 'fai'
        THEN fai_scope IS NOT NULL AND (fai_scope = 'full' OR characteristic_ids IS NOT NULL)
        ELSE fai_scope IS NULL AND fai_reason IS NULL AND fai_baseline_version_id IS NULL END)
  -- Lots: production and receiving only; a fixed sample is not larger than its lot.
  AND (COALESCE(report_type, '') IN ('production', 'receiving')
       OR (lot_number IS NULL AND lot_size IS NULL AND sampling IS NULL AND sample_columns IS NULL))
  AND (lot_size IS NULL OR sampling IS NULL OR sampling->>'plan' <> 'fixed'
       OR (sampling->>'n')::numeric <= lot_size)
  -- Purchase order and supplier: receiving only.
  AND (COALESCE(report_type, '') = 'receiving' OR (po_number IS NULL AND supplier_name IS NULL))
  -- Re-inspection: names the characteristics it re-inspects; the NCR is re-inspection only.
  AND (CASE WHEN report_type = 'reinspection' THEN characteristic_ids IS NOT NULL
            ELSE ncr_reference IS NULL END)
  -- The included set is what the workbook holds.
  AND (characteristic_ids IS NULL OR cardinality(characteristic_ids) = characteristic_count)
);

-- {n} may count per type (a pattern with {type}).
CREATE INDEX IF NOT EXISTS inspection_report_file_id_type_sequence_idx
  ON inspection_report (file_id, report_type, sequence) WHERE sequence IS NOT NULL;
CREATE INDEX IF NOT EXISTS inspection_report_fai_baseline_version_id_idx
  ON inspection_report (fai_baseline_version_id) WHERE fai_baseline_version_id IS NOT NULL;

-- The type columns describe the workbook that was generated, so they never change after insert.
-- On insert a partial FAI names its baseline, an earlier (or the same) version of the report's own
-- file, and the included characteristics are distinct snapshot rows of that file. Results on a
-- typed report must be in the 5.6 format (see the header). Not SECURITY DEFINER: the lookups go
-- through the caller's RLS, the vault rule the report's own policies apply.
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
    NEW.characteristic_ids := OLD.characteristic_ids;
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
      IF (SELECT count(*) FROM inspection_characteristic_version cv JOIN file_version fv ON fv.id = cv.file_version_id
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

DROP TRIGGER IF EXISTS trg_inspection_report_type ON inspection_report;
CREATE TRIGGER trg_inspection_report_type
  BEFORE INSERT OR UPDATE ON inspection_report
  FOR EACH ROW EXECUTE FUNCTION trg_inspection_report_type();

-- ---------------------------------------------------------------------------
-- Template columns
-- ---------------------------------------------------------------------------

ALTER TABLE inspection_template
  ADD COLUMN IF NOT EXISTS report_types TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT inspection_template_report_types_check
      CHECK (report_types <@ ARRAY['fai', 'production', 'receiving', 'reinspection']::TEXT[]),
  ADD COLUMN IF NOT EXISTS default_for TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT inspection_template_default_for_check
      CHECK (default_for <@ ARRAY['fai', 'production', 'receiving', 'reinspection']::TEXT[]);

-- A template is the default only for types it serves, and an archived template for none.
ALTER TABLE inspection_template DROP CONSTRAINT IF EXISTS inspection_template_default_for_serves_check;
ALTER TABLE inspection_template ADD CONSTRAINT inspection_template_default_for_serves_check CHECK (
  (cardinality(report_types) = 0 OR default_for <@ report_types)
  AND (archived_at IS NULL OR cardinality(default_for) = 0)
);

-- One default per type per organization. Claiming a type takes it from the template that had it,
-- in the same statement (as 0504's trigger does for is_default). The advisory lock serializes two
-- administrators claiming types at once, so the second sees the first's claim. Archiving a template
-- ends its defaults (a 5.5.0 client archives without knowing default_for), and narrowing its types
-- keeps only the defaults it still serves. Not SECURITY DEFINER: the update of the other template
-- goes through the same RLS as the caller's own.
CREATE OR REPLACE FUNCTION trg_inspection_template_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.report_types := ARRAY(SELECT DISTINCT unnest(NEW.report_types) ORDER BY 1);
  NEW.default_for := ARRAY(SELECT DISTINCT unnest(NEW.default_for) ORDER BY 1);
  IF NEW.archived_at IS NOT NULL THEN
    NEW.default_for := '{}';
  ELSIF cardinality(NEW.report_types) > 0 THEN
    NEW.default_for := ARRAY(SELECT unnest(NEW.default_for) INTERSECT SELECT unnest(NEW.report_types) ORDER BY 1);
  END IF;
  IF cardinality(NEW.default_for) > 0
     AND (TG_OP = 'INSERT' OR NEW.default_for IS DISTINCT FROM OLD.default_for) THEN
    PERFORM pg_advisory_xact_lock(hashtext('inspection_template_default_for'), hashtext(NEW.org_id::text));
    UPDATE inspection_template t
       SET default_for = ARRAY(SELECT unnest(t.default_for) EXCEPT SELECT unnest(NEW.default_for) ORDER BY 1)
     WHERE t.org_id = NEW.org_id AND t.id <> NEW.id AND t.default_for && NEW.default_for;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_template_defaults ON inspection_template;
CREATE TRIGGER trg_inspection_template_defaults
  BEFORE INSERT OR UPDATE ON inspection_template
  FOR EACH ROW EXECUTE FUNCTION trg_inspection_template_defaults();

-- Trigger functions run whoever fires them; nobody calls them.
REVOKE ALL ON FUNCTION trg_inspection_report_type(), trg_inspection_template_defaults()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'trg_inspection_report_type()', '15-inspection', NULL,
    'file_version && fai_baseline_version_id && characteristic_ids && inspection_characteristic_version && results', 506),
  ('function', 'trg_inspection_template_defaults()', '15-inspection', NULL, 'pg_advisory_xact_lock && default_for', 506)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 506 $$;
-- Must equal VERSION_DESCRIPTIONS[506] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Inspection report types. inspection_report gains report_type (first article, production, '
  'receiving, re-inspection; none on older reports), the FAI scope, reason and baseline version, '
  'the lot, lot size, sampling plan (100 percent or a fixed sample) and sample columns, purchase '
  'order and supplier, the NCR reference, and the characteristics the report includes; all are '
  'fixed once the report is issued, and results on a typed report must be in the 5.6 format. '
  'inspection_template gains the report types it serves and the types it is the default for (one '
  'default per type per organization; archiving ends them).'
$$;
