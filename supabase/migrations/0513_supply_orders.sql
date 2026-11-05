-- =====================================================================
-- 0513_supply_orders.sql: supply orders (schema 512 -> 513)
-- =====================================================================
-- An order is a named group of lines sent to a supplier (a quote request or a purchase). Each line
-- pins one checked-in model version (part, assembly, or a lone drawing) and configuration, and
-- optionally the drawing version whose PDF goes with it, with a quantity and the output kinds to
-- send. Plan: .cursor/plans/orders-5.11-agents.plan.md (Decisions, Contract).
--
--   supply_order        the order: number (per-organization sequence and the organization's
--                       prefix), title, purpose (quote / purchase), status, supplier (a supplier
--                       row or free text), due date, notes, and line_count, which a trigger keeps,
--                       so the app can say how many lines sit in vaults the reader cannot see.
--                       Orders are organization-wide: every member with the orders module reads
--                       them.
--   supply_order_line   one pinned file version. It snapshots the file name, part number,
--                       description, revision and version (and the drawing's name and version),
--                       so an order stays readable after its files move on, and records the vault
--                       of the file and of the drawing at pin time: a line is readable only with
--                       both vaults (my_accessible_vault_ids()), and stays readable when its file
--                       is later purged (file and version references are set NULL, never
--                       cascaded, so a sent order keeps its lines). The vault ids are plain
--                       columns, not foreign keys: a deleted vault leaves its lines unreadable to
--                       everyone (no vault to grant), never readable without it, and line_count
--                       still counts them. A line that had a drawing keeps drawing_vault_id when the
--                       drawing is purged, so it is never read as drawing-less.
--   supply_order_number_counter  the last order number handed out per organization. Numbers only
--                       go up: deleting the newest order never hands its number out again. Server
--                       backups export it with the orders, so a restore keeps it too.
--
-- Status: draft -> sent -> received -> closed; draft, sent and received -> cancelled;
-- cancelled -> draft; sent -> draft (reopen). Lines and kinds change only in draft; the header
-- changes unless the order is closed or cancelled. Entering draft clears what sending recorded.
-- Sending computes, per line, the outputs that went out (sent_outputs: kind, storage_hash,
-- file_size, file_name) from the real rows, by the app's rules (supply_order_line_get_outputs()):
-- pdf and dxf from the drawing version (or the line's own when it is a drawing), step/iges/stl from
-- the model version (step and stl in the line's configuration, iges the saved one; a drawing line's
-- step from its own version), source from the version's own bytes - and the kinds that had none
-- (missing_kinds). It
-- refuses MISSING_OUTPUTS unless p_allow_missing. A sent order's export uses sent_outputs, so
-- can_read_vault_object() also reads a hash a readable sent line names: an output an administrator
-- later replaced or deleted (0507, the content stays in the bucket) still downloads for that order.
--
-- Writes go through the SECURITY DEFINER functions below only; clients read. Access is the module
-- allowlist only (module_access through can_access_module); there is no team permission resource
-- for orders. Every function needs an organization member with can_access_module('orders') (unrestricted until an administrator
-- lists subjects for the module, so members have it by default). Pinning a version also needs read
-- access to its vault (administrators read every vault). Errors raise with HINT = the error code
-- (NOT_FOUND, NOT_MEMBER, NO_MODULE_ACCESS, NOT_DRAFT, FROZEN, BAD_TRANSITION, EMPTY_ORDER,
-- MISSING_OUTPUTS, NOT_ALLOWED, BAD_PATCH, BAD_KIND, BAD_QUANTITY, NO_VAULT_ACCESS);
-- MISSING_OUTPUTS carries the missing kinds per line as JSON in DETAIL.
--
-- Both tables are in the realtime publication; deleting an order writes a realtime_tombstone
-- (0502), and a line change updates its order's line_count and updated_at. check_release_residue()
-- holds the line table to the vault rule and refuses client write policies on both tables. Server
-- backups export the three tables (API 4.2.3).
--
-- Additive only: release 5.10.0 never reads these tables.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supply_order (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  -- The order's number within its organization; order_number is prefix || lpad(sequence, 4, '0').
  sequence INTEGER NOT NULL CONSTRAINT supply_order_sequence_check CHECK (sequence >= 1),
  order_number TEXT NOT NULL
    CONSTRAINT supply_order_order_number_check CHECK (btrim(order_number) <> '' AND length(order_number) <= 80),
  title TEXT NOT NULL
    CONSTRAINT supply_order_title_check CHECK (btrim(title) <> '' AND length(title) <= 200),
  purpose TEXT NOT NULL DEFAULT 'purchase'
    CONSTRAINT supply_order_purpose_check CHECK (purpose IN ('quote', 'purchase')),
  status TEXT NOT NULL DEFAULT 'draft'
    CONSTRAINT supply_order_status_check CHECK (status IN ('draft', 'sent', 'received', 'closed', 'cancelled')),
  supplier_id UUID REFERENCES supplier(id) ON DELETE SET NULL,
  -- Free text, or the supplier row's name when the order was given one (kept if the row goes).
  supplier_name TEXT CONSTRAINT supply_order_supplier_name_check CHECK (length(supplier_name) <= 200),
  due_date DATE,
  notes TEXT CONSTRAINT supply_order_notes_check CHECK (length(notes) <= 10000),
  -- Every line of the order, readable or not (trg_supply_order_line_count).
  line_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT supply_order_org_id_sequence_key UNIQUE (org_id, sequence)
);

CREATE INDEX IF NOT EXISTS supply_order_org_id_status_idx ON supply_order (org_id, status);

-- The last order sequence handed out per organization (supply_order_create_row()). An id column so
-- server backups can page it like every other table.
CREATE TABLE IF NOT EXISTS supply_order_number_counter (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  last_sequence INTEGER NOT NULL DEFAULT 0
    CONSTRAINT supply_order_number_counter_last_sequence_check CHECK (last_sequence >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supply_order_number_counter_org_id_key UNIQUE (org_id)
);

-- No policies on purpose, as rfq_number_counter: clients never read or write it; the SECURITY
-- DEFINER create functions bypass RLS, and RLS with no policy denies everyone else.
ALTER TABLE supply_order_number_counter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE supply_order_number_counter FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE supply_order_number_counter TO service_role;
CREATE INDEX IF NOT EXISTS supply_order_supplier_id_idx ON supply_order (supplier_id) WHERE supplier_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS supply_order_line (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES supply_order(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  -- The line's place in the order (1-based; removing lines leaves gaps).
  position INTEGER NOT NULL CONSTRAINT supply_order_line_position_check CHECK (position >= 1),
  -- The vault of the pinned file, and of the pinned drawing, at pin time: the read rule. Plain
  -- columns on purpose (no foreign key, so nothing ever sets them NULL): a deleted vault makes the
  -- line unreadable rather than readable without it.
  vault_id UUID NOT NULL,
  drawing_vault_id UUID,
  -- NULL once the file or version is purged; the snapshot columns keep the line readable.
  file_id UUID REFERENCES file(id) ON DELETE SET NULL,
  file_version_id UUID REFERENCES file_version(id) ON DELETE SET NULL,
  -- The configuration ordered; NULL = the configuration the version was saved in.
  configuration TEXT
    CONSTRAINT supply_order_line_configuration_check CHECK (configuration IS NULL OR btrim(configuration) <> ''),
  drawing_file_id UUID REFERENCES file(id) ON DELETE SET NULL,
  drawing_version_id UUID REFERENCES file_version(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1
    CONSTRAINT supply_order_line_quantity_check CHECK (quantity >= 1 AND quantity <= 1000000000),
  output_kinds TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT supply_order_line_output_kinds_check
      CHECK (output_kinds <@ ARRAY['pdf', 'step', 'iges', 'stl', 'dxf', 'source']::TEXT[]),
  notes TEXT CONSTRAINT supply_order_line_notes_check CHECK (length(notes) <= 2000),
  -- Snapshot at pin time.
  file_name TEXT NOT NULL,
  part_number TEXT,
  description TEXT,
  revision TEXT,
  version INTEGER,
  drawing_file_name TEXT,
  drawing_version INTEGER,
  -- Set when the order is sent: [{kind, storage_hash, file_size, file_name}], and the kinds that had
  -- no output. NULL while the order is a draft.
  sent_outputs JSONB,
  missing_kinds TEXT[],
  added_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One line per file and configuration in an order.
CREATE UNIQUE INDEX IF NOT EXISTS supply_order_line_order_id_file_id_configuration_key
  ON supply_order_line (order_id, file_id, (COALESCE(configuration, '')));
CREATE INDEX IF NOT EXISTS supply_order_line_order_id_idx ON supply_order_line (order_id);
CREATE INDEX IF NOT EXISTS supply_order_line_org_id_idx ON supply_order_line (org_id);
CREATE INDEX IF NOT EXISTS supply_order_line_vault_id_idx ON supply_order_line (vault_id);
CREATE INDEX IF NOT EXISTS supply_order_line_drawing_vault_id_idx
  ON supply_order_line (drawing_vault_id) WHERE drawing_vault_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS supply_order_line_file_id_idx ON supply_order_line (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS supply_order_line_file_version_id_idx
  ON supply_order_line (file_version_id) WHERE file_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS supply_order_line_drawing_file_id_idx
  ON supply_order_line (drawing_file_id) WHERE drawing_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS supply_order_line_drawing_version_id_idx
  ON supply_order_line (drawing_version_id) WHERE drawing_version_id IS NOT NULL;
-- can_read_vault_object() looks a hash up in sent_outputs by containment.
CREATE INDEX IF NOT EXISTS supply_order_line_sent_outputs_idx
  ON supply_order_line USING gin (sent_outputs jsonb_path_ops);

ALTER TABLE supply_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_order_line ENABLE ROW LEVEL SECURITY;

-- Written out in full, as in the baseline: anon holds nothing, clients only read.
REVOKE ALL ON TABLE supply_order, supply_order_line FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE supply_order, supply_order_line TO authenticated;
GRANT ALL ON TABLE supply_order, supply_order_line TO service_role;

DROP POLICY IF EXISTS "supply_order: users read" ON supply_order;
CREATE POLICY "supply_order: users read" ON supply_order FOR SELECT
  TO authenticated
  USING (
    org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid()))
    AND (SELECT can_access_module('orders'))
  );

-- A line follows the vaults of its file and its drawing (schema 111's rule).
DROP POLICY IF EXISTS "supply_order_line: users read" ON supply_order_line;
CREATE POLICY "supply_order_line: users read" ON supply_order_line FOR SELECT
  TO authenticated
  USING (
    org_id IN (SELECT u.org_id FROM app_user u WHERE u.id = (SELECT auth.uid()))
    AND (SELECT can_access_module('orders'))
    AND vault_id IN (SELECT my_accessible_vault_ids())
    AND (drawing_vault_id IS NULL OR drawing_vault_id IN (SELECT my_accessible_vault_ids()))
  );

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_supply_order_set_updated_at ON supply_order;
CREATE TRIGGER trg_supply_order_set_updated_at
  BEFORE UPDATE ON supply_order
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_supply_order_line_set_updated_at ON supply_order_line;
CREATE TRIGGER trg_supply_order_line_set_updated_at
  BEFORE UPDATE ON supply_order_line
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Every line counts, readable or not. The UPDATE also tells realtime subscribers of the order that
-- its lines changed (a deleted line publishes nothing itself).
CREATE OR REPLACE FUNCTION trg_supply_order_line_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  UPDATE supply_order o
     SET line_count = (SELECT count(*) FROM supply_order_line l WHERE l.order_id = v_order_id)
   WHERE o.id = v_order_id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION trg_supply_order_line_count() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_supply_order_line_count ON supply_order_line;
CREATE TRIGGER trg_supply_order_line_count
  AFTER INSERT OR DELETE ON supply_order_line
  FOR EACH ROW EXECUTE FUNCTION trg_supply_order_line_count();

-- A deleted order reaches other clients as a realtime_tombstone insert (0502).
DROP TRIGGER IF EXISTS trg_supply_order_realtime_tombstone ON supply_order;
CREATE TRIGGER trg_supply_order_realtime_tombstone
  AFTER DELETE ON supply_order REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_realtime_tombstone_write();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'supply_order') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE supply_order;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'supply_order_line') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE supply_order_line;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Internal helpers (no client may execute them; the RPCs below call them as the owner)
-- ---------------------------------------------------------------------------

-- The caller's organization, or a refusal: signed in, a member, and the orders module.
CREATE OR REPLACE FUNCTION supply_order_require_module()
RETURNS UUID
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of an organization'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_MEMBER';
  END IF;
  IF NOT can_access_module('orders') THEN
    RAISE EXCEPTION 'You do not have access to orders'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NO_MODULE_ACCESS';
  END IF;
  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION supply_order_require_module() FROM PUBLIC, anon, authenticated, service_role;

-- A JSON array of output kinds, de-duplicated, in the canonical order; BAD_KIND otherwise.
CREATE OR REPLACE FUNCTION supply_order_validate_kinds(p_value JSONB)
RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  c_kinds CONSTANT TEXT[] := ARRAY['pdf', 'step', 'iges', 'stl', 'dxf', 'source'];
  v_kinds TEXT[];
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) e
                 WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY (c_kinds))) THEN
    RAISE EXCEPTION 'Output kinds must be a list of pdf, step, iges, stl, dxf and source'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_KIND';
  END IF;
  SELECT COALESCE(array_agg(k ORDER BY array_position(c_kinds, k)), '{}'::TEXT[]) INTO v_kinds
    FROM (SELECT DISTINCT e #>> '{}' AS k FROM jsonb_array_elements(p_value) e) s;
  RETURN v_kinds;
END;
$$;

REVOKE ALL ON FUNCTION supply_order_validate_kinds(JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- A whole number from 1 to 1,000,000,000; BAD_QUANTITY otherwise.
CREATE OR REPLACE FUNCTION supply_order_validate_quantity(p_value JSONB)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_number NUMERIC;
BEGIN
  IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'number' THEN
    v_number := (p_value #>> '{}')::NUMERIC;
    IF v_number = trunc(v_number) AND v_number >= 1 AND v_number <= 1000000000 THEN
      RETURN v_number::INTEGER;
    END IF;
  END IF;
  RAISE EXCEPTION 'Quantity must be a whole number of at least 1'
    USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_QUANTITY';
END;
$$;

REVOKE ALL ON FUNCTION supply_order_validate_quantity(JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- A text field of a patch: a string (trimmed; empty is NULL unless p_required) or JSON null.
CREATE OR REPLACE FUNCTION supply_order_validate_text(p_value JSONB, p_field TEXT, p_max INTEGER, p_required BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    v_text := NULL;
  ELSIF jsonb_typeof(p_value) = 'string' THEN
    v_text := NULLIF(btrim(p_value #>> '{}'), '');
  ELSE
    RAISE EXCEPTION '% must be text', p_field USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;
  IF p_required AND v_text IS NULL THEN
    RAISE EXCEPTION '% is required', p_field USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;
  IF length(v_text) > p_max THEN
    RAISE EXCEPTION '% is longer than % characters', p_field, p_max
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;
  RETURN v_text;
END;
$$;

REVOKE ALL ON FUNCTION supply_order_validate_text(JSONB, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;

-- A supplier of the organization (its id and name), or BAD_PATCH.
CREATE OR REPLACE FUNCTION supply_order_validate_supplier(p_org_id UUID, p_supplier_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT s.name INTO v_name FROM supplier s WHERE s.id = p_supplier_id AND s.org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found' USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;
  RETURN left(v_name, 200);
END;
$$;

REVOKE ALL ON FUNCTION supply_order_validate_supplier(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- A new draft order with the next number of the organization. The counter row's lock serializes
-- numbering per organization, and it only goes up, so a deleted order's number is never reused.
-- It never falls below the orders that exist (a restore, or rows written by the owner), and the
-- unique (org_id, sequence) key is the backstop.
CREATE OR REPLACE FUNCTION supply_order_create_row(
  p_org_id UUID,
  p_actor UUID,
  p_title TEXT,
  p_purpose TEXT,
  p_supplier_id UUID,
  p_supplier_name TEXT,
  p_due_date DATE,
  p_notes TEXT
)
RETURNS supply_order
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefix TEXT;
  v_sequence INTEGER;
  v_order supply_order%ROWTYPE;
BEGIN
  INSERT INTO supply_order_number_counter AS c (org_id, last_sequence)
  VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE SET last_sequence = c.last_sequence + 1, updated_at = NOW()
  RETURNING c.last_sequence INTO v_sequence;
  -- Above every order that exists, whatever the counter says.
  SELECT GREATEST(v_sequence, COALESCE(max(o.sequence), 0) + 1) INTO v_sequence
    FROM supply_order o WHERE o.org_id = p_org_id;
  UPDATE supply_order_number_counter SET last_sequence = v_sequence WHERE org_id = p_org_id;
  SELECT left(COALESCE(NULLIF(btrim(org.settings -> 'orders' ->> 'number_prefix'), ''), 'ORD-'), 40)
    INTO v_prefix FROM organization org WHERE org.id = p_org_id;
  INSERT INTO supply_order (org_id, sequence, order_number, title, purpose, supplier_id, supplier_name,
                            due_date, notes, created_by, updated_by)
  VALUES (p_org_id, v_sequence,
          COALESCE(v_prefix, 'ORD-') || CASE WHEN length(v_sequence::text) >= 4 THEN v_sequence::text
                                             ELSE lpad(v_sequence::text, 4, '0') END,
          p_title, p_purpose, p_supplier_id, p_supplier_name, p_due_date, p_notes, p_actor, p_actor)
  RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION supply_order_create_row(UUID, UUID, TEXT, TEXT, UUID, TEXT, DATE, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- What a line sends: the outputs its pinned versions have now, and the kinds with none. Each kind
-- comes from where the app's resolver takes it (lineKindSource in src/lib/orders/outputs.ts, with
-- kindTakesConfiguration in src/lib/outputs/kinds.ts):
--   pdf, dxf          the drawing version (its drawing_pdf_render; its dxf output), else the line's
--                     own version when the line is a drawing; configuration NULL.
--   step, iges, stl   the model version; step and stl in the line's configuration, iges the saved
--                     one (NULL). A drawing line has step only, from its own version with
--                     configuration NULL (the model its views show); no iges or stl.
--   source            the line version's own file bytes (the model's, never the drawing's).
-- A line is a drawing by its snapshot file name, as the app decides it, so a purged line still says.
CREATE OR REPLACE FUNCTION supply_order_line_get_outputs(p_line supply_order_line)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind TEXT;
  v_is_drawing BOOLEAN;
  v_own UUID;
  v_drawing UUID;
  v_from UUID;
  v_configuration TEXT;
  v_hash TEXT;
  v_size BIGINT;
  v_name TEXT;
  v_outputs JSONB := '[]'::jsonb;
  v_missing TEXT[] := '{}'::TEXT[];
BEGIN
  v_is_drawing := p_line.file_name ~* '\.slddrw$';
  v_own := CASE WHEN p_line.file_id IS NOT NULL THEN p_line.file_version_id END;
  v_drawing := CASE WHEN p_line.drawing_file_id IS NOT NULL THEN p_line.drawing_version_id END;

  FOREACH v_kind IN ARRAY COALESCE(p_line.output_kinds, '{}'::TEXT[]) LOOP
    v_hash := NULL;
    v_size := NULL;
    v_name := NULL;
    v_configuration := NULL;
    v_from := CASE
      WHEN v_kind IN ('pdf', 'dxf') THEN COALESCE(v_drawing, CASE WHEN v_is_drawing THEN v_own END)
      WHEN v_kind = 'step' THEN v_own
      WHEN v_kind IN ('iges', 'stl') THEN CASE WHEN v_is_drawing THEN NULL ELSE v_own END
      WHEN v_kind = 'source' THEN v_own
    END;
    IF v_kind IN ('step', 'stl') AND NOT v_is_drawing THEN
      v_configuration := p_line.configuration;
    END IF;

    IF v_from IS NULL THEN
      NULL;
    ELSIF v_kind = 'pdf' THEN
      SELECT d.storage_hash, d.file_size INTO v_hash, v_size
        FROM drawing_pdf_render d
       WHERE d.org_id = p_line.org_id AND d.file_version_id = v_from;
      v_name := regexp_replace(CASE WHEN v_from = v_drawing THEN p_line.drawing_file_name ELSE p_line.file_name END,
                               '\.[^.]*$', '') || '.pdf';
    ELSIF v_kind = 'source' THEN
      SELECT fv.content_hash, COALESCE(fv.file_size, 0) INTO v_hash, v_size
        FROM file_version fv WHERE fv.id = v_from;
      v_name := p_line.file_name;
    ELSE
      SELECT o.storage_hash, o.file_size, o.file_name INTO v_hash, v_size, v_name
        FROM file_version_output o
       WHERE o.org_id = p_line.org_id AND o.file_version_id = v_from AND o.kind = v_kind
         AND COALESCE(o.configuration, '') = COALESCE(v_configuration, '');
    END IF;

    IF v_hash IS NULL THEN
      v_missing := v_missing || v_kind;
    ELSE
      v_outputs := v_outputs || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'storage_hash', v_hash, 'file_size', v_size, 'file_name', v_name));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('outputs', v_outputs, 'missing', to_jsonb(v_missing));
END;
$$;

REVOKE ALL ON FUNCTION supply_order_line_get_outputs(supply_order_line) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION supply_order_create(
  p_title TEXT,
  p_purpose TEXT DEFAULT 'purchase',
  p_supplier_id UUID DEFAULT NULL,
  p_supplier_name TEXT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_title TEXT;
  v_purpose TEXT;
  v_supplier_name TEXT;
  v_notes TEXT;
  v_order supply_order%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  v_org_id := supply_order_require_module();

  v_title := supply_order_validate_text(to_jsonb(p_title), 'Title', 200, true);
  v_purpose := COALESCE(NULLIF(btrim(COALESCE(p_purpose, '')), ''), 'purchase');
  IF v_purpose NOT IN ('quote', 'purchase') THEN
    RAISE EXCEPTION 'Purpose must be quote or purchase' USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;
  v_supplier_name := supply_order_validate_text(to_jsonb(p_supplier_name), 'Supplier name', 200, false);
  IF p_supplier_id IS NOT NULL THEN
    v_supplier_name := COALESCE(v_supplier_name, supply_order_validate_supplier(v_org_id, p_supplier_id));
  END IF;
  v_notes := supply_order_validate_text(to_jsonb(p_notes), 'Notes', 10000, false);

  v_order := supply_order_create_row(v_org_id, v_actor, v_title, v_purpose, p_supplier_id, v_supplier_name,
                                     p_due_date, v_notes);
  RETURN jsonb_build_object('ok', true, 'order', to_jsonb(v_order));
END;
$$;

REVOKE ALL ON FUNCTION supply_order_create(TEXT, TEXT, UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_create(TEXT, TEXT, UUID, TEXT, DATE, TEXT) TO authenticated, service_role;

-- The header: title, purpose, supplier_id, supplier_name, due_date, notes. Any status but closed and
-- cancelled (FROZEN). Naming a supplier row without a supplier_name takes the row's name.
CREATE OR REPLACE FUNCTION supply_order_update(p_order_id UUID, p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_order supply_order%ROWTYPE;
  v_supplier_id UUID;
  v_due_date DATE;
BEGIN
  v_actor := my_actor_id();
  v_org_id := supply_order_require_module();

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k
                 WHERE k NOT IN ('title', 'purpose', 'supplier_id', 'supplier_name', 'due_date', 'notes')) THEN
    RAISE EXCEPTION 'The patch may change title, purpose, supplier_id, supplier_name, due_date and notes only'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;

  SELECT * INTO v_order FROM supply_order o WHERE o.id = p_order_id AND o.org_id = v_org_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  IF v_order.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'A % order cannot be changed', v_order.status
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'FROZEN';
  END IF;

  IF p_patch ? 'title' THEN
    v_order.title := supply_order_validate_text(p_patch -> 'title', 'Title', 200, true);
  END IF;
  IF p_patch ? 'purpose' THEN
    IF jsonb_typeof(p_patch -> 'purpose') <> 'string' OR (p_patch ->> 'purpose') NOT IN ('quote', 'purchase') THEN
      RAISE EXCEPTION 'Purpose must be quote or purchase' USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
    END IF;
    v_order.purpose := p_patch ->> 'purpose';
  END IF;
  IF p_patch ? 'supplier_name' THEN
    v_order.supplier_name := supply_order_validate_text(p_patch -> 'supplier_name', 'Supplier name', 200, false);
  END IF;
  IF p_patch ? 'supplier_id' THEN
    IF jsonb_typeof(p_patch -> 'supplier_id') = 'null' THEN
      v_order.supplier_id := NULL;
    ELSE
      BEGIN
        v_supplier_id := (p_patch ->> 'supplier_id')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'supplier_id must be a supplier id' USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
      END;
      IF jsonb_typeof(p_patch -> 'supplier_id') <> 'string' THEN
        RAISE EXCEPTION 'supplier_id must be a supplier id' USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
      END IF;
      v_order.supplier_id := v_supplier_id;
      IF NOT (p_patch ? 'supplier_name') THEN
        v_order.supplier_name := supply_order_validate_supplier(v_org_id, v_supplier_id);
      ELSE
        PERFORM supply_order_validate_supplier(v_org_id, v_supplier_id);
      END IF;
    END IF;
  END IF;
  IF p_patch ? 'due_date' THEN
    IF jsonb_typeof(p_patch -> 'due_date') = 'null' THEN
      v_order.due_date := NULL;
    ELSIF jsonb_typeof(p_patch -> 'due_date') = 'string' THEN
      BEGIN
        v_due_date := (p_patch ->> 'due_date')::DATE;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'due_date must be a date (YYYY-MM-DD)' USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
      END;
      v_order.due_date := v_due_date;
    ELSE
      RAISE EXCEPTION 'due_date must be a date (YYYY-MM-DD)' USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
    END IF;
  END IF;
  IF p_patch ? 'notes' THEN
    v_order.notes := supply_order_validate_text(p_patch -> 'notes', 'Notes', 10000, false);
  END IF;

  UPDATE supply_order
     SET title = v_order.title, purpose = v_order.purpose, supplier_id = v_order.supplier_id,
         supplier_name = v_order.supplier_name, due_date = v_order.due_date, notes = v_order.notes,
         updated_by = v_actor
   WHERE id = v_order.id
  RETURNING * INTO v_order;
  RETURN jsonb_build_object('ok', true, 'order', to_jsonb(v_order));
END;
$$;

REVOKE ALL ON FUNCTION supply_order_update(UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_update(UUID, JSONB) TO authenticated, service_role;

-- Pins versions to a draft order. Each element: {file_version_id, configuration?, drawing_version_id?,
-- quantity?, output_kinds?}. A (file, configuration) already in the order is re-pinned to the given
-- version and keeps its quantity, kinds and drawing unless they are given. A drawing version pairs a
-- drawing with a model line; a line whose own file is a drawing has no drawing pin. Elements the
-- caller may not pin are skipped with a reason (NOT_FOUND: no such version, a deleted file, or one in
-- another organization; NO_VAULT_ACCESS; NOT_A_DRAWING); a bad kind or quantity refuses the call.
CREATE OR REPLACE FUNCTION supply_order_add_lines(p_order_id UUID, p_lines JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_order supply_order%ROWTYPE;
  v_el JSONB;
  v_fv_id UUID;
  v_dv_id UUID;
  v_fv file_version%ROWTYPE;
  v_file file%ROWTYPE;
  v_dv file_version%ROWTYPE;
  v_dfile file%ROWTYPE;
  v_configuration TEXT;
  v_is_drawing BOOLEAN;
  v_has_drawing_key BOOLEAN;
  v_quantity INTEGER;
  v_kinds TEXT[];
  v_existing supply_order_line%ROWTYPE;
  v_position INTEGER;
  v_added INTEGER := 0;
  v_updated INTEGER := 0;
  v_skipped JSONB := '[]'::jsonb;
  v_reason TEXT;
BEGIN
  v_actor := my_actor_id();
  v_org_id := supply_order_require_module();

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) > 2000 THEN
    RAISE EXCEPTION 'Lines must be a list of at most 2000 elements'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;

  SELECT * INTO v_order FROM supply_order o WHERE o.id = p_order_id AND o.org_id = v_org_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Lines change only while the order is a draft'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NOT_DRAFT';
  END IF;

  FOR v_el IN SELECT e FROM jsonb_array_elements(p_lines) e LOOP
    IF jsonb_typeof(v_el) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_el) k
                   WHERE k NOT IN ('file_version_id', 'configuration', 'drawing_version_id', 'quantity', 'output_kinds')) THEN
      RAISE EXCEPTION 'A line is {file_version_id, configuration, drawing_version_id, quantity, output_kinds}'
        USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
    END IF;
    -- Values are checked before anything is looked up, so a bad element refuses the whole call.
    v_quantity := CASE WHEN v_el ? 'quantity' THEN supply_order_validate_quantity(v_el -> 'quantity') END;
    v_kinds := CASE WHEN v_el ? 'output_kinds' THEN supply_order_validate_kinds(v_el -> 'output_kinds') END;
    v_configuration := supply_order_validate_text(v_el -> 'configuration', 'Configuration', 255, false);
    v_has_drawing_key := v_el ? 'drawing_version_id';

    v_reason := NULL;
    v_fv_id := NULL;
    v_dv_id := NULL;
    v_fv := NULL;
    v_file := NULL;
    v_dv := NULL;
    v_dfile := NULL;
    BEGIN
      v_fv_id := (v_el ->> 'file_version_id')::UUID;
      IF v_has_drawing_key AND jsonb_typeof(v_el -> 'drawing_version_id') <> 'null' THEN
        v_dv_id := (v_el ->> 'drawing_version_id')::UUID;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      v_reason := 'NOT_FOUND';
    END;

    IF v_reason IS NULL THEN
      SELECT * INTO v_fv FROM file_version fv WHERE fv.id = v_fv_id;
      SELECT * INTO v_file FROM file f WHERE f.id = v_fv.file_id AND f.org_id = v_org_id AND f.deleted_at IS NULL;
      IF v_fv.id IS NULL OR v_file.id IS NULL THEN
        v_reason := 'NOT_FOUND';
      ELSIF NOT (v_file.vault_id IN (SELECT my_accessible_vault_ids())) THEN
        v_reason := 'NO_VAULT_ACCESS';
      END IF;
    END IF;

    v_is_drawing := lower(ltrim(COALESCE(v_file.extension, ''), '.')) = 'slddrw';

    IF v_reason IS NULL AND v_dv_id IS NOT NULL AND NOT v_is_drawing THEN
      SELECT * INTO v_dv FROM file_version fv WHERE fv.id = v_dv_id;
      SELECT * INTO v_dfile FROM file f WHERE f.id = v_dv.file_id AND f.org_id = v_org_id AND f.deleted_at IS NULL;
      IF v_dv.id IS NULL OR v_dfile.id IS NULL THEN
        v_reason := 'NOT_FOUND';
      ELSIF lower(ltrim(COALESCE(v_dfile.extension, ''), '.')) <> 'slddrw' THEN
        v_reason := 'NOT_A_DRAWING';
      ELSIF NOT (v_dfile.vault_id IN (SELECT my_accessible_vault_ids())) THEN
        v_reason := 'NO_VAULT_ACCESS';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'file_version_id', v_el -> 'file_version_id', 'reason', v_reason));
      CONTINUE;
    END IF;

    SELECT * INTO v_existing FROM supply_order_line l
     WHERE l.order_id = v_order.id AND l.file_id = v_file.id
       AND COALESCE(l.configuration, '') = COALESCE(v_configuration, '')
    FOR UPDATE;

    IF v_existing.id IS NOT NULL THEN
      UPDATE supply_order_line
         SET file_version_id = v_fv.id,
             vault_id = v_file.vault_id,
             file_name = v_file.file_name,
             part_number = COALESCE(v_fv.part_number, v_file.part_number),
             description = COALESCE(v_fv.description, v_file.description),
             revision = v_fv.revision,
             version = v_fv.version,
             drawing_file_id = CASE WHEN v_is_drawing THEN NULL WHEN v_has_drawing_key THEN v_dfile.id ELSE drawing_file_id END,
             drawing_version_id = CASE WHEN v_is_drawing THEN NULL WHEN v_has_drawing_key THEN v_dv.id ELSE drawing_version_id END,
             drawing_vault_id = CASE WHEN v_is_drawing THEN NULL WHEN v_has_drawing_key THEN v_dfile.vault_id ELSE drawing_vault_id END,
             drawing_file_name = CASE WHEN v_is_drawing THEN NULL WHEN v_has_drawing_key THEN v_dfile.file_name ELSE drawing_file_name END,
             drawing_version = CASE WHEN v_is_drawing THEN NULL WHEN v_has_drawing_key THEN v_dv.version ELSE drawing_version END,
             quantity = COALESCE(v_quantity, quantity),
             output_kinds = COALESCE(v_kinds, output_kinds)
       WHERE id = v_existing.id;
      v_updated := v_updated + 1;
    ELSE
      SELECT COALESCE(max(l.position), 0) + 1 INTO v_position FROM supply_order_line l WHERE l.order_id = v_order.id;
      INSERT INTO supply_order_line (order_id, org_id, position, vault_id, drawing_vault_id, file_id, file_version_id,
                                     configuration, drawing_file_id, drawing_version_id, quantity, output_kinds,
                                     file_name, part_number, description, revision, version,
                                     drawing_file_name, drawing_version, added_by)
      VALUES (v_order.id, v_org_id, v_position, v_file.vault_id, v_dfile.vault_id, v_file.id, v_fv.id,
              v_configuration, v_dfile.id, v_dv.id, COALESCE(v_quantity, 1),
              COALESCE(v_kinds, CASE WHEN v_is_drawing THEN ARRAY['pdf']
                                     WHEN v_dv.id IS NOT NULL THEN ARRAY['pdf', 'step']
                                     ELSE ARRAY['step'] END),
              v_file.file_name, COALESCE(v_fv.part_number, v_file.part_number),
              COALESCE(v_fv.description, v_file.description), v_fv.revision, v_fv.version,
              v_dfile.file_name, v_dv.version, v_actor);
      v_added := v_added + 1;
    END IF;
  END LOOP;

  UPDATE supply_order SET updated_by = v_actor WHERE id = v_order.id;
  RETURN jsonb_build_object('ok', true, 'added', v_added, 'updated', v_updated, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION supply_order_add_lines(UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_add_lines(UUID, JSONB) TO authenticated, service_role;

-- One line of a draft order: quantity, output_kinds, notes, file_version_id (another version of the
-- same file), drawing_version_id (a drawing's version, or null). A line the caller cannot read is
-- NOT_FOUND.
CREATE OR REPLACE FUNCTION supply_order_update_line(p_line_id UUID, p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_line supply_order_line%ROWTYPE;
  v_order supply_order%ROWTYPE;
  v_id UUID;
  v_fv file_version%ROWTYPE;
  v_file file%ROWTYPE;
  v_dv file_version%ROWTYPE;
  v_dfile file%ROWTYPE;
  v_is_drawing BOOLEAN;
BEGIN
  v_actor := my_actor_id();
  v_org_id := supply_order_require_module();

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k
                 WHERE k NOT IN ('quantity', 'output_kinds', 'notes', 'file_version_id', 'drawing_version_id')) THEN
    RAISE EXCEPTION 'The patch may change quantity, output_kinds, notes, file_version_id and drawing_version_id only'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
  END IF;

  SELECT * INTO v_line FROM supply_order_line l WHERE l.id = p_line_id AND l.org_id = v_org_id;
  IF v_line.id IS NULL
     OR NOT (v_line.vault_id IN (SELECT my_accessible_vault_ids()))
     OR (v_line.drawing_vault_id IS NOT NULL AND NOT (v_line.drawing_vault_id IN (SELECT my_accessible_vault_ids()))) THEN
    RAISE EXCEPTION 'Line not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  SELECT * INTO v_order FROM supply_order o WHERE o.id = v_line.order_id AND o.org_id = v_org_id FOR UPDATE;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Lines change only while the order is a draft'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NOT_DRAFT';
  END IF;
  SELECT * INTO v_line FROM supply_order_line l WHERE l.id = p_line_id FOR UPDATE;

  IF p_patch ? 'quantity' THEN
    v_line.quantity := supply_order_validate_quantity(p_patch -> 'quantity');
  END IF;
  IF p_patch ? 'output_kinds' THEN
    v_line.output_kinds := supply_order_validate_kinds(p_patch -> 'output_kinds');
  END IF;
  IF p_patch ? 'notes' THEN
    v_line.notes := supply_order_validate_text(p_patch -> 'notes', 'Notes', 2000, false);
  END IF;

  SELECT * INTO v_file FROM file f WHERE f.id = v_line.file_id;
  v_is_drawing := CASE WHEN v_file.id IS NULL THEN lower(v_line.file_name) LIKE '%.slddrw'
                       ELSE lower(ltrim(COALESCE(v_file.extension, ''), '.')) = 'slddrw' END;

  IF p_patch ? 'file_version_id' THEN
    BEGIN
      v_id := (p_patch ->> 'file_version_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_id := NULL;
    END;
    SELECT * INTO v_fv FROM file_version fv WHERE fv.id = v_id;
    IF v_id IS NULL OR v_fv.id IS NULL OR v_file.id IS NULL OR v_fv.file_id <> v_file.id THEN
      RAISE EXCEPTION 'file_version_id must be a version of the line''s file'
        USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
    END IF;
    -- A file in the trash is not pinned, as in supply_order_add_lines().
    IF v_file.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'The line''s file is in the trash' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
    END IF;
    v_line.file_version_id := v_fv.id;
    v_line.file_name := v_file.file_name;
    v_line.part_number := COALESCE(v_fv.part_number, v_file.part_number);
    v_line.description := COALESCE(v_fv.description, v_file.description);
    v_line.revision := v_fv.revision;
    v_line.version := v_fv.version;
  END IF;

  IF p_patch ? 'drawing_version_id' THEN
    IF jsonb_typeof(p_patch -> 'drawing_version_id') = 'null' THEN
      v_line.drawing_file_id := NULL;
      v_line.drawing_version_id := NULL;
      v_line.drawing_vault_id := NULL;
      v_line.drawing_file_name := NULL;
      v_line.drawing_version := NULL;
    ELSE
      IF v_is_drawing THEN
        RAISE EXCEPTION 'A drawing''s own line has no drawing pin'
          USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
      END IF;
      BEGIN
        v_id := (p_patch ->> 'drawing_version_id')::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        v_id := NULL;
      END;
      SELECT * INTO v_dv FROM file_version fv WHERE fv.id = v_id;
      SELECT * INTO v_dfile FROM file f WHERE f.id = v_dv.file_id AND f.org_id = v_org_id AND f.deleted_at IS NULL;
      IF v_dv.id IS NULL OR v_dfile.id IS NULL THEN
        RAISE EXCEPTION 'Drawing version not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
      END IF;
      IF lower(ltrim(COALESCE(v_dfile.extension, ''), '.')) <> 'slddrw' THEN
        RAISE EXCEPTION 'drawing_version_id must be a version of a drawing'
          USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_PATCH';
      END IF;
      IF NOT (v_dfile.vault_id IN (SELECT my_accessible_vault_ids())) THEN
        RAISE EXCEPTION 'You do not have access to the drawing''s vault'
          USING ERRCODE = 'insufficient_privilege', HINT = 'NO_VAULT_ACCESS';
      END IF;
      v_line.drawing_file_id := v_dfile.id;
      v_line.drawing_version_id := v_dv.id;
      v_line.drawing_vault_id := v_dfile.vault_id;
      v_line.drawing_file_name := v_dfile.file_name;
      v_line.drawing_version := v_dv.version;
    END IF;
  END IF;

  UPDATE supply_order_line
     SET quantity = v_line.quantity, output_kinds = v_line.output_kinds, notes = v_line.notes,
         file_version_id = v_line.file_version_id, file_name = v_line.file_name,
         part_number = v_line.part_number, description = v_line.description,
         revision = v_line.revision, version = v_line.version,
         drawing_file_id = v_line.drawing_file_id, drawing_version_id = v_line.drawing_version_id,
         drawing_vault_id = v_line.drawing_vault_id, drawing_file_name = v_line.drawing_file_name,
         drawing_version = v_line.drawing_version
   WHERE id = v_line.id
  RETURNING * INTO v_line;
  UPDATE supply_order SET updated_by = v_actor WHERE id = v_order.id;
  RETURN jsonb_build_object('ok', true, 'line', to_jsonb(v_line));
END;
$$;

REVOKE ALL ON FUNCTION supply_order_update_line(UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_update_line(UUID, JSONB) TO authenticated, service_role;

-- Removes lines of a draft order. Lines the caller cannot read are left alone.
CREATE OR REPLACE FUNCTION supply_order_remove_lines(p_order_id UUID, p_line_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_order supply_order%ROWTYPE;
  v_removed INTEGER;
BEGIN
  v_actor := my_actor_id();
  v_org_id := supply_order_require_module();

  SELECT * INTO v_order FROM supply_order o WHERE o.id = p_order_id AND o.org_id = v_org_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Lines change only while the order is a draft'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'NOT_DRAFT';
  END IF;

  DELETE FROM supply_order_line l
   WHERE l.order_id = v_order.id
     AND l.id = ANY (COALESCE(p_line_ids, '{}'::UUID[]))
     AND l.vault_id IN (SELECT my_accessible_vault_ids())
     AND (l.drawing_vault_id IS NULL OR l.drawing_vault_id IN (SELECT my_accessible_vault_ids()));
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  IF v_removed > 0 THEN
    UPDATE supply_order SET updated_by = v_actor WHERE id = v_order.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION supply_order_remove_lines(UUID, UUID[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_remove_lines(UUID, UUID[]) TO authenticated, service_role;

-- Moves an order along draft -> sent -> received -> closed; draft, sent, received -> cancelled;
-- cancelled -> draft; sent -> draft. Sending records each line's outputs (every line, readable by
-- the caller or not) and refuses MISSING_OUTPUTS unless p_allow_missing; entering draft clears them.
CREATE OR REPLACE FUNCTION supply_order_set_status(p_order_id UUID, p_status TEXT, p_allow_missing BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_order supply_order%ROWTYPE;
  v_line supply_order_line%ROWTYPE;
  v_status TEXT;
  v_result JSONB;
  v_missing JSONB := '[]'::jsonb;
BEGIN
  v_actor := my_actor_id();
  v_org_id := supply_order_require_module();
  v_status := lower(btrim(COALESCE(p_status, '')));

  SELECT * INTO v_order FROM supply_order o WHERE o.id = p_order_id AND o.org_id = v_org_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;

  IF NOT ((v_order.status, v_status) IN (
      ('draft', 'sent'), ('sent', 'received'), ('received', 'closed'),
      ('draft', 'cancelled'), ('sent', 'cancelled'), ('received', 'cancelled'),
      ('cancelled', 'draft'), ('sent', 'draft'))) THEN
    RAISE EXCEPTION 'An order cannot go from % to %', v_order.status, COALESCE(p_status, 'nothing')
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'BAD_TRANSITION';
  END IF;

  IF v_status = 'sent' THEN
    IF NOT EXISTS (SELECT 1 FROM supply_order_line l WHERE l.order_id = v_order.id) THEN
      RAISE EXCEPTION 'An order with no lines cannot be sent'
        USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'EMPTY_ORDER';
    END IF;
    FOR v_line IN SELECT * FROM supply_order_line l WHERE l.order_id = v_order.id ORDER BY l.position FOR UPDATE LOOP
      v_result := supply_order_line_get_outputs(v_line);
      IF jsonb_array_length(v_result -> 'missing') > 0 THEN
        v_missing := v_missing || jsonb_build_array(jsonb_build_object('line_id', v_line.id, 'kinds', v_result -> 'missing'));
      END IF;
      UPDATE supply_order_line
         SET sent_outputs = v_result -> 'outputs',
             missing_kinds = ARRAY(SELECT jsonb_array_elements_text(v_result -> 'missing'))
       WHERE id = v_line.id;
    END LOOP;
    IF jsonb_array_length(v_missing) > 0 AND NOT COALESCE(p_allow_missing, false) THEN
      RAISE EXCEPTION 'Some lines have no output for a kind they send'
        USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'MISSING_OUTPUTS', DETAIL = v_missing::text;
    END IF;
    UPDATE supply_order SET status = 'sent', sent_by = v_actor, sent_at = NOW(), updated_by = v_actor
     WHERE id = v_order.id RETURNING * INTO v_order;
  ELSIF v_status = 'draft' THEN
    UPDATE supply_order_line SET sent_outputs = NULL, missing_kinds = NULL
     WHERE order_id = v_order.id AND (sent_outputs IS NOT NULL OR missing_kinds IS NOT NULL);
    UPDATE supply_order
       SET status = 'draft', sent_by = NULL, sent_at = NULL, received_at = NULL, closed_at = NULL,
           cancelled_at = NULL, updated_by = v_actor
     WHERE id = v_order.id RETURNING * INTO v_order;
  ELSE
    UPDATE supply_order
       SET status = v_status,
           received_at = CASE WHEN v_status = 'received' THEN NOW() ELSE received_at END,
           closed_at = CASE WHEN v_status = 'closed' THEN NOW() ELSE closed_at END,
           cancelled_at = CASE WHEN v_status = 'cancelled' THEN NOW() ELSE cancelled_at END,
           updated_by = v_actor
     WHERE id = v_order.id RETURNING * INTO v_order;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order', to_jsonb(v_order), 'missing', v_missing);
END;
$$;

REVOKE ALL ON FUNCTION supply_order_set_status(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_set_status(UUID, TEXT, BOOLEAN) TO authenticated, service_role;

-- A new draft with the same purpose, supplier, notes and lines (same pinned versions, quantities,
-- kinds and notes) under the next number. Skipped and counted: lines the caller cannot read, lines
-- whose file is in the trash or whose version was purged, and lines whose drawing is in the trash or
-- was purged (copying one without its drawing would drop the PDF silently).
CREATE OR REPLACE FUNCTION supply_order_duplicate(p_order_id UUID, p_title TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_source supply_order%ROWTYPE;
  v_order supply_order%ROWTYPE;
  v_title TEXT;
  v_copied INTEGER;
BEGIN
  v_actor := my_actor_id();
  v_org_id := supply_order_require_module();

  SELECT * INTO v_source FROM supply_order o WHERE o.id = p_order_id AND o.org_id = v_org_id;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  v_title := COALESCE(supply_order_validate_text(to_jsonb(p_title), 'Title', 200, false), v_source.title);

  v_order := supply_order_create_row(v_org_id, v_actor, v_title, v_source.purpose, v_source.supplier_id,
                                     v_source.supplier_name, NULL, v_source.notes);

  INSERT INTO supply_order_line (order_id, org_id, position, vault_id, drawing_vault_id, file_id, file_version_id,
                                 configuration, drawing_file_id, drawing_version_id, quantity, output_kinds, notes,
                                 file_name, part_number, description, revision, version,
                                 drawing_file_name, drawing_version, added_by)
  SELECT v_order.id, v_org_id, row_number() OVER (ORDER BY l.position, l.id), l.vault_id,
         l.drawing_vault_id, l.file_id, l.file_version_id, l.configuration,
         l.drawing_file_id, l.drawing_version_id, l.quantity, l.output_kinds, l.notes,
         l.file_name, l.part_number, l.description, l.revision, l.version,
         l.drawing_file_name, l.drawing_version,
         v_actor
    FROM supply_order_line l
    JOIN file f ON f.id = l.file_id AND f.deleted_at IS NULL
   WHERE l.order_id = v_source.id
     AND l.file_version_id IS NOT NULL
     AND l.vault_id IN (SELECT my_accessible_vault_ids())
     AND (l.drawing_vault_id IS NULL OR l.drawing_vault_id IN (SELECT my_accessible_vault_ids()))
     AND (l.drawing_vault_id IS NULL
          OR (l.drawing_version_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM file df WHERE df.id = l.drawing_file_id AND df.deleted_at IS NULL)));
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  SELECT * INTO v_order FROM supply_order o WHERE o.id = v_order.id;
  RETURN jsonb_build_object('ok', true, 'order', to_jsonb(v_order),
                            'skipped', v_source.line_count - v_copied);
END;
$$;

REVOKE ALL ON FUNCTION supply_order_duplicate(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_duplicate(UUID, TEXT) TO authenticated, service_role;

-- Deletes a draft or cancelled order: its creator or an administrator.
CREATE OR REPLACE FUNCTION supply_order_delete(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_order supply_order%ROWTYPE;
BEGIN
  v_actor := my_actor_id();
  v_org_id := supply_order_require_module();

  SELECT * INTO v_order FROM supply_order o WHERE o.id = p_order_id AND o.org_id = v_org_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_FOUND';
  END IF;
  IF v_order.status NOT IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'Only a draft or cancelled order can be deleted'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_ALLOWED';
  END IF;
  IF v_order.created_by IS DISTINCT FROM v_actor AND NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only the order''s creator or an administrator can delete it'
      USING ERRCODE = 'insufficient_privilege', HINT = 'NOT_ALLOWED';
  END IF;

  DELETE FROM supply_order WHERE id = v_order.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION supply_order_delete(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION supply_order_delete(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading sent output content from the vault bucket
-- ---------------------------------------------------------------------------
-- 0505's can_read_vault_object(), with one more way in: a hash a readable sent order line names
-- (the orders module and both of the line's vaults, as the line's read policy). Those hashes come only from output, render and version rows of the
-- same vaults, written by supply_order_set_status(), so this admits nothing a reader could not read
-- when the order was sent.
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
        OR EXISTS (SELECT 1 FROM supply_order_line l
                    WHERE l.sent_outputs @> jsonb_build_array(jsonb_build_object('storage_hash', obj.hash))
                      AND l.org_id = obj.org_id
                      AND can_access_module('orders')
                      AND l.vault_id IN (SELECT id FROM visible)
                      AND (l.drawing_vault_id IS NULL OR l.drawing_vault_id IN (SELECT id FROM visible)))
        OR EXISTS (SELECT 1 FROM inspection_template t
                    WHERE t.storage_hash = obj.hash AND t.org_id = obj.org_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- What the data must no longer contain
-- ---------------------------------------------------------------------------
-- 0505's check_release_residue(), verbatim except two table lists: the vault rule covers
-- supply_order_line, and supply_order and supply_order_line join the tables no client write policy
-- may name (the supply_order_* functions are their writers).
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
                           'inspection_report', 'file_version_output', 'supply_order_line')
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
                           'drawing_pdf_render', 'file_version_output',
                           'supply_order', 'supply_order_line')
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
-- Server backups export the tables
-- ---------------------------------------------------------------------------
-- 0505's backup_list_org_rows(), verbatim except supply_order, supply_order_line and
-- supply_order_number_counter (after supplier and file, which they reference). The counter travels
-- with the orders so a restored organization never hands out a number twice. BACKUP_TABLES in api/src/backup/source.ts names them from API 4.2.3.
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
    WHEN 'supply_order' THEN 'org_id = $1'
    WHEN 'supply_order_line' THEN 'org_id = $1'
    WHEN 'supply_order_number_counter' THEN 'org_id = $1'
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
-- CREATE OR REPLACE keeps their grants. The helpers above are executable by no client and are not
-- SECURITY DEFINER, so only the manifest lists them.

-- The requirements are identifiers: sql_strip_noise() drops string literals before matching.
INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('supply_order_create(text, text, uuid, text, date, text)', '30-supply-chain', 513),
  ('supply_order_update(uuid, jsonb)', '30-supply-chain', 513),
  ('supply_order_add_lines(uuid, jsonb)', '30-supply-chain', 513),
  ('supply_order_update_line(uuid, jsonb)', '30-supply-chain', 513),
  ('supply_order_remove_lines(uuid, uuid[])', '30-supply-chain', 513),
  ('supply_order_set_status(uuid, text, boolean)', '30-supply-chain', 513),
  ('supply_order_duplicate(uuid, text)', '30-supply-chain', 513),
  ('supply_order_delete(uuid)', '30-supply-chain', 513)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('table', 'supply_order', '30-supply-chain', NULL, NULL, 513),
  ('table', 'supply_order_line', '30-supply-chain', NULL, NULL, 513),
  ('table', 'supply_order_number_counter', '30-supply-chain', NULL, NULL, 513),
  ('function', 'trg_supply_order_line_count()', '30-supply-chain', NULL, 'line_count', 513),
  ('function', 'supply_order_require_module()', '30-supply-chain', NULL, 'my_actor_id && can_access_module', 513),
  ('function', 'supply_order_validate_kinds(jsonb)', '30-supply-chain', NULL, NULL, 513),
  ('function', 'supply_order_validate_quantity(jsonb)', '30-supply-chain', NULL, NULL, 513),
  ('function', 'supply_order_validate_text(jsonb,text,integer,boolean)', '30-supply-chain', NULL, NULL, 513),
  ('function', 'supply_order_validate_supplier(uuid,uuid)', '30-supply-chain', NULL, 'org_id', 513),
  ('function', 'supply_order_create_row(uuid,uuid,text,text,uuid,text,date,text)', '30-supply-chain', NULL,
    'supply_order_number_counter && last_sequence && settings', 513),
  ('function', 'supply_order_line_get_outputs(supply_order_line)', '30-supply-chain', NULL,
    'drawing_pdf_render && file_version_output && content_hash', 513),
  ('function', 'supply_order_create(text,text,uuid,text,date,text)', '30-supply-chain', NULL,
    'my_actor_id && supply_order_require_module && supply_order_create_row', 513),
  ('function', 'supply_order_update(uuid,jsonb)', '30-supply-chain', NULL,
    'supply_order_require_module && org_id', 513),
  ('function', 'supply_order_add_lines(uuid,jsonb)', '30-supply-chain', NULL,
    'supply_order_require_module && my_accessible_vault_ids && org_id', 513),
  ('function', 'supply_order_update_line(uuid,jsonb)', '30-supply-chain', NULL,
    'supply_order_require_module && my_accessible_vault_ids && org_id', 513),
  ('function', 'supply_order_remove_lines(uuid,uuid[])', '30-supply-chain', NULL,
    'supply_order_require_module && my_accessible_vault_ids && org_id', 513),
  ('function', 'supply_order_set_status(uuid,text,boolean)', '30-supply-chain', NULL,
    'supply_order_require_module && supply_order_line_get_outputs && org_id', 513),
  ('function', 'supply_order_duplicate(uuid,text)', '30-supply-chain', NULL,
    'supply_order_require_module && my_accessible_vault_ids && supply_order_create_row && org_id', 513),
  ('function', 'supply_order_delete(uuid)', '30-supply-chain', NULL,
    'supply_order_require_module && is_org_admin && org_id', 513),
  ('function', 'can_read_vault_object(text)', '10-source-files', NULL,
    'my_accessible_vault_ids && file_version && drawing_pdf_render && file_version_output && inspection_report && inspection_template && supply_order_line && can_access_module', 513)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 513 $$;
-- Must equal VERSION_DESCRIPTIONS[513] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Supply orders. supply_order is a numbered order (quote or purchase) for a supplier row or a named '
  'supplier; supply_order_line pins a checked-in file version and configuration, optionally its drawing '
  'version, with a quantity and the output kinds to send, and snapshots the file''s name, part number, '
  'description, revision and version. Orders are readable by members with the orders module; a line '
  'only with its vaults, and line_count counts every line. The supply_order_* functions are the only '
  'writers: lines change in draft only, and sending records the outputs that went out (or refuses '
  'MISSING_OUTPUTS). can_read_vault_object() reads a sent line''s outputs; check_release_residue() '
  'covers both tables; server backups export them and supply_order_number_counter, which only goes up.'
$$;
