-- =====================================================================
-- 0514_review_comment_notify.sql: review comments notify, per-vault resolve, nobody left (513 -> 514)
-- =====================================================================
-- Three gaps the 5.10.0 review redesign left (review UX audit F20 / S2, and two found since):
--
-- 1. A new comment or reply in a review notified nobody, so an author learned of markups only from
--    the decision. trg_file_comment_notify_review() (AFTER INSERT on file_comment, a comment with
--    review_id) writes a 'review_comment' notification, in the same transaction as the comment, to:
--      - the review's requester and the reviewers of its current round who are not withdrawn
--        (review_response.withdrawn_at IS NULL, schema 108): the people working on the review now;
--      - never the commenter (the insert policy pins file_comment.user_id to auth.uid(), so the
--        sender, from_user_id, is the caller as schema 112 requires of audit rows);
--      - only someone who can read the comment: a member of the review's organization with access
--        to the file's vault (can_user_access_vault()), as "file_comment: users read" requires;
--      - only while the review is open: 'pending' or 'kicked_back' (changes requested, the author's
--        move). A closed review (approved, rejected, cancelled) notifies nothing, as review_decision
--        is written only while the review is still open.
--    De-duplication: at most one 'review_comment' notification per recipient per review in a
--    rolling hour. A markup session writes several comments a minute (each pin, each reply), and
--    every one would toast the author and every other reviewer; the first tells them to look, and
--    the review's comment list is live from then on. The hour is the audit's (S2), and the shape is
--    review_notify_overdue()'s: deduplicated by type, entity and user over a window, not by a title.
--    A transaction-scoped advisory lock per review serialises concurrent comments on one review, so
--    the check sees rows a comment committing alongside it wrote.
--    Edits and resolves notify nothing: only an INSERT fires.
--    The row is entity_type 'review', entity_id the review, action_type 'open_review', as every
--    review notification is, so a 5.10.0 / 5.11.0 client shows it as an ordinary review toast
--    (title: message) whose Open opens the review. action_url says where the comment is:
--    'review/<review id>/item/<review item id>/comment/<thread id>' (the item part is left out when
--    the comment names no item; the thread is the root comment, the reply's parent).
--
-- 2. The client offered Resolve on a comment outside a review to anyone with explorer edit on any
--    vault, while file_comment_set_resolved() (512) checks explorer edit on the comment's vault, so
--    a member with edit elsewhere saw Resolve and was refused. file_comment_list_resolvable(ids)
--    returns the ids among p_comment_ids the caller may resolve or reopen, by exactly 512's rule:
--    readable (the file in the caller's organization, its vault one of my_accessible_vault_ids()),
--    then the author, an administrator, for a review comment the review's requester or a reviewer
--    never withdrawn from it, and for any other comment explorer edit on the file's vault.
--    src/lib/supabase/reviewComment514.test.ts checks the two agree on every comment and caller.
--
-- 3. review_list_queue() rows could not say that nobody is left to decide (every reviewer who owed
--    the open round was withdrawn). Package rows gain reviewers_owing (current-round reviewers
--    still pending and not withdrawn) and reviewers_withdrawn (current-round reviewers withdrawn);
--    gate rows carry both as NULL. Fields are only added: a 5.10.0 / 5.11.0 client ignores them.
--
-- Additive for the previous release: a new trigger, a new function, two new JSON fields.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Comment notifications
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_file_comment_notify_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r review%ROWTYPE;
  v_org_id UUID;
  v_vault_id UUID;
  v_file_name TEXT;
  v_name TEXT;
  v_text TEXT;
  v_title TEXT;
  v_url TEXT;
BEGIN
  IF NEW.review_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT rv.* INTO r FROM review rv WHERE rv.id = NEW.review_id;
  IF r.id IS NULL OR r.status NOT IN ('pending', 'kicked_back') THEN
    RETURN NULL;
  END IF;

  SELECT f.org_id, f.vault_id, f.file_name INTO v_org_id, v_vault_id, v_file_name
    FROM file f WHERE f.id = NEW.file_id;
  IF v_org_id IS DISTINCT FROM r.org_id THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) INTO v_name
    FROM app_user u WHERE u.id = NEW.user_id;

  v_title := COALESCE(v_name, 'Someone')
    || CASE WHEN NEW.parent_id IS NULL THEN ' commented on ' ELSE ' replied to a comment on ' END
    || COALESCE(v_file_name, review_get_display_title(r.id));
  v_text := regexp_replace(btrim(COALESCE(NEW.comment, '')), '\s+', ' ', 'g');
  IF length(v_text) > 140 THEN
    v_text := rtrim(left(v_text, 139)) || '…';
  END IF;
  v_url := 'review/' || r.id::text
    || CASE WHEN NEW.review_item_id IS NOT NULL THEN '/item/' || NEW.review_item_id::text ELSE '' END
    || '/comment/' || COALESCE(NEW.parent_id, NEW.id)::text;

  -- The de-duplication below cannot see a notification another open transaction wrote, so two
  -- comments on one review committed together would both notify. One lock per review serialises
  -- them until commit; the second then sees the first's rows.
  PERFORM pg_advisory_xact_lock(hashtext('trg_file_comment_notify_review'), hashtext(r.id::text));

  INSERT INTO notification (
    org_id, user_id, type, category, title, message, priority,
    entity_type, entity_id, from_user_id, action_type, action_url
  )
  SELECT r.org_id, u.id, 'review_comment', 'review', v_title, NULLIF(v_text, ''),
         COALESCE(r.priority, 'normal'), 'review', r.id, NEW.user_id, 'open_review', v_url
  FROM app_user u
  WHERE u.org_id = r.org_id
    AND u.id IS DISTINCT FROM NEW.user_id
    AND u.id IS DISTINCT FROM auth.uid()
    AND (u.id = r.requested_by
         OR EXISTS (SELECT 1 FROM review_response rr
                     WHERE rr.review_id = r.id AND rr.round_number = r.current_round
                       AND rr.reviewer_id = u.id AND rr.withdrawn_at IS NULL))
    AND can_user_access_vault(u.id, v_vault_id)
    AND NOT EXISTS (
      SELECT 1 FROM notification n
      WHERE n.entity_type = 'review' AND n.entity_id = r.id AND n.user_id = u.id
        AND n.type = 'review_comment' AND n.created_at > NOW() - INTERVAL '1 hour'
    );

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_file_comment_notify_review ON file_comment;
CREATE TRIGGER trg_file_comment_notify_review
  AFTER INSERT ON file_comment
  FOR EACH ROW EXECUTE FUNCTION trg_file_comment_notify_review();

REVOKE ALL ON FUNCTION trg_file_comment_notify_review() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION trg_file_comment_notify_review() IS
  'A new comment or reply in an open review notifies its requester and current-round reviewers who '
  'are not withdrawn and can read the file''s vault, never the commenter, at most once per recipient '
  'per review per hour (type review_comment).';

-- ---------------------------------------------------------------------------
-- 2. Which comments the caller may resolve
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION file_comment_list_resolvable(p_comment_ids UUID[])
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_admin BOOLEAN;
  v_ids UUID[];
BEGIN
  v_actor := my_actor_id();

  IF p_comment_ids IS NULL THEN
    RAISE EXCEPTION 'A list of comments is required'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_ARGUMENTS';
  END IF;
  IF cardinality(p_comment_ids) > 2000 THEN
    RAISE EXCEPTION 'At most 2000 comments at a time'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_ARGUMENTS';
  END IF;

  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  IF v_org_id IS NULL THEN
    RETURN '{}'::UUID[];
  END IF;
  v_admin := is_org_admin();

  -- file_comment_set_resolved() (512), one comment at a time: readable first, then who may.
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}'::UUID[]) INTO v_ids
  FROM file_comment c
  JOIN file f ON f.id = c.file_id
  WHERE c.id = ANY (p_comment_ids)
    AND f.org_id = v_org_id
    AND f.vault_id IS NOT NULL
    AND f.vault_id IN (SELECT my_accessible_vault_ids())
    AND (
      c.user_id = v_actor
      OR v_admin
      OR (c.review_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM review r
             WHERE r.id = c.review_id AND r.org_id = f.org_id
               AND (r.requested_by = v_actor
                    OR (EXISTS (SELECT 1 FROM review_response rr
                                 WHERE rr.review_id = r.id AND rr.reviewer_id = v_actor AND rr.withdrawn_at IS NULL)
                        AND NOT EXISTS (SELECT 1 FROM review_response rr
                                         WHERE rr.review_id = r.id AND rr.reviewer_id = v_actor AND rr.withdrawn_at IS NOT NULL)))))
      OR (c.review_id IS NULL AND has_team_permission('module:explorer', 'edit', f.vault_id))
    );

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION file_comment_list_resolvable(UUID[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION file_comment_list_resolvable(UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION file_comment_list_resolvable(UUID[]) IS
  'The ids among p_comment_ids the caller may resolve or reopen through file_comment_set_resolved(): '
  'readable comments whose author is the caller, any for an administrator, a review comment for the '
  'review''s requester and never-withdrawn reviewers, any other comment with explorer edit on its vault.';

-- ---------------------------------------------------------------------------
-- 3. The queue: who is left to decide
-- ---------------------------------------------------------------------------
-- 20-change-control.sql's definition with two fields added to package rows (reviewers_owing,
-- reviewers_withdrawn) and both as NULL on gate rows. Nothing else changes.
CREATE OR REPLACE FUNCTION review_list_queue(
  p_bucket TEXT DEFAULT 'awaiting_me',
  p_team_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_cursor TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org_id UUID;
  v_limit INTEGER;
  v_pattern TEXT;
  v_rows JSONB;
  v_count INTEGER;
  v_next TEXT;
BEGIN
  v_actor := my_actor_id();
  SELECT u.org_id INTO v_org_id FROM app_user u WHERE u.id = v_actor;
  PERFORM org_require_member(v_org_id);

  IF p_bucket IS NULL OR p_bucket NOT IN ('awaiting_me', 'requested_by_me', 'my_teams', 'done') THEN
    RAISE EXCEPTION 'Unknown queue bucket'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_BUCKET';
  END IF;

  IF p_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM team t WHERE t.id = p_team_id AND t.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Team not found in your organization'
      USING ERRCODE = 'insufficient_privilege', HINT = 'TEAM_NOT_FOUND';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_pattern := CASE WHEN NULLIF(btrim(p_search), '') IS NULL THEN NULL
                    ELSE '%' || like_pattern_escape(btrim(p_search)) || '%' END;

  WITH my_teams AS (
    SELECT tm.team_id
    FROM team_member tm
    JOIN team t ON t.id = tm.team_id AND t.org_id = v_org_id
    WHERE tm.user_id = v_actor
  ),
  owed AS (
    SELECT rri.review_id, count(*)::integer AS n
    FROM review r
    JOIN review_response rr
      ON rr.review_id = r.id AND rr.round_number = r.current_round AND rr.reviewer_id = v_actor
     AND rr.withdrawn_at IS NULL
    JOIN review_round_item rri
      ON rri.review_id = r.id AND rri.round_number = r.current_round
     AND NOT rri.is_carried_forward AND rri.outcome = 'pending'
    WHERE r.org_id = v_org_id
      AND r.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM review_decision d
        WHERE d.item_id = rri.item_id AND d.round_number = r.current_round AND d.reviewer_id = v_actor)
    GROUP BY rri.review_id
  ),
  pkg AS (
    SELECT r.*,
           COALESCE(o.n, 0) AS owed_n,
           (r.status IN ('pending', 'kicked_back') AND r.due_date IS NOT NULL AND r.due_date < current_date) AS overdue
    FROM review r
    LEFT JOIN owed o ON o.review_id = r.id
    WHERE r.org_id = v_org_id
      AND CASE p_bucket
            WHEN 'awaiting_me' THEN COALESCE(o.n, 0) > 0
            WHEN 'requested_by_me' THEN r.requested_by = v_actor AND r.status IN ('pending', 'kicked_back')
            WHEN 'my_teams' THEN r.status IN ('pending', 'kicked_back') AND (
                   r.team_id IN (SELECT mt.team_id FROM my_teams mt)
                   OR EXISTS (SELECT 1 FROM review_response rr
                              WHERE rr.review_id = r.id AND rr.via_team_id IN (SELECT mt.team_id FROM my_teams mt)))
            ELSE r.status IN ('approved', 'rejected', 'cancelled') AND (
                   r.requested_by = v_actor
                   OR EXISTS (SELECT 1 FROM review_response rr WHERE rr.review_id = r.id AND rr.reviewer_id = v_actor))
          END
      AND (p_team_id IS NULL
           OR r.team_id = p_team_id
           OR EXISTS (SELECT 1 FROM review_response rr WHERE rr.review_id = r.id AND rr.via_team_id = p_team_id))
      AND (v_pattern IS NULL
           OR r.title ILIKE v_pattern
           OR r.message ILIKE v_pattern
           OR EXISTS (SELECT 1 FROM app_user ru WHERE ru.id = r.requested_by
                        AND (ru.full_name ILIKE v_pattern OR ru.email ILIKE v_pattern))
           OR EXISTS (SELECT 1 FROM review_item i JOIN file f ON f.id = i.file_id
                      WHERE i.review_id = r.id
                        AND (f.file_name ILIKE v_pattern OR f.part_number ILIKE v_pattern
                             OR f.description ILIKE v_pattern)))
      -- Vault access: a review the caller is not part of is listed only when at
      -- least one of its items is in a vault they may see.
      AND (r.requested_by = v_actor
           OR COALESCE(o.n, 0) > 0
           OR EXISTS (SELECT 1 FROM review_response rr WHERE rr.review_id = r.id AND rr.reviewer_id = v_actor)
           OR EXISTS (SELECT 1 FROM review_item i WHERE i.review_id = r.id AND can_user_access_vault(v_actor, i.vault_id)))
  ),
  -- Sort keys only. The row payload (several subqueries per review) is built in
  -- `payloads` below for the page alone, not for every review in the bucket:
  -- the done bucket of a long-lived organization holds thousands.
  pkg_rows AS (
    SELECT
      CASE WHEN p_bucket = 'done' THEN
        lpad((253402300799999999
              - floor(extract(epoch FROM COALESCE(p.completed_at, p.cancelled_at, p.updated_at, p.requested_at, p.created_at)) * 1000000)::bigint)::text,
             18, '0') || p.id::text
      ELSE
        (CASE WHEN p.overdue THEN '0' ELSE '1' END)
        || review_priority_get_rank(p.priority)::text
        || to_char(COALESCE(p.due_date, DATE '9999-12-31'), 'YYYYMMDD')
        || to_char(COALESCE(p.requested_at, p.created_at, 'epoch'::timestamptz) AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS')
        || p.id::text
      END AS sort_key,
      'package'::text AS kind, p.id, p.owed_n, p.overdue
    FROM pkg p
  ),
  gate_rows AS (
    SELECT
      '1' || '2' || '99991231'
        || to_char(COALESCE(pr.requested_at, pr.created_at, 'epoch'::timestamptz) AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS')
        || pr.id::text AS sort_key,
      'gate'::text AS kind, pr.id, 1 AS owed_n, false AS overdue
    FROM workflow_gate_review pr
    JOIN file f ON f.id = pr.file_id
    JOIN workflow_gate wg ON wg.id = pr.gate_id
    WHERE p_bucket = 'awaiting_me'
      AND p_team_id IS NULL
      AND pr.org_id = v_org_id
      AND pr.id IN (SELECT gate_review_list_awaiting_ids(v_actor))
      AND (v_pattern IS NULL OR f.file_name ILIKE v_pattern OR wg.name ILIKE v_pattern)
  ),
  all_rows AS (
    SELECT sort_key, kind, id, owed_n, overdue FROM pkg_rows
    UNION ALL
    SELECT sort_key, kind, id, owed_n, overdue FROM gate_rows
  ),
  page AS (
    SELECT a.sort_key, a.kind, a.id, a.owed_n, a.overdue,
           row_number() OVER (ORDER BY a.sort_key COLLATE "C") AS rn
    FROM all_rows a
    WHERE p_cursor IS NULL OR a.sort_key COLLATE "C" > p_cursor COLLATE "C"
    ORDER BY a.sort_key COLLATE "C"
    LIMIT v_limit + 1
  ),
  payloads AS (
    SELECT pg.rn, pg.sort_key,
      CASE WHEN pg.kind = 'package' THEN (
        SELECT jsonb_build_object(
          'kind', 'package',
          'id', p.id,
          'title', review_get_display_title(p.id),
          'status', review_status_get_label(p.status),
          'priority', p.priority,
          'due_date', to_char(p.due_date, 'YYYY-MM-DD'),
          'overdue', pg.overdue,
          'mode', p.mode,
          'round', p.current_round,
          'requested_by', review_get_user_json(p.requested_by),
          'requested_at', p.requested_at,
          'completed_at', p.completed_at,
          'team_id', p.team_id,
          'item_count', (SELECT count(*) FROM review_item i WHERE i.review_id = p.id),
          'items_decided', (SELECT count(*) FROM review_round_item rri
                            WHERE rri.review_id = p.id AND rri.round_number = p.current_round
                              AND rri.outcome <> 'pending'),
          'items_owed_by_me', pg.owed_n,
          -- Schema 514: the current round's reviewers who still owe it, and those withdrawn from it.
          'reviewers_owing', (SELECT count(*) FROM review_response rr
                              WHERE rr.review_id = p.id AND rr.round_number = p.current_round
                                AND rr.status = 'pending' AND rr.withdrawn_at IS NULL),
          'reviewers_withdrawn', (SELECT count(*) FROM review_response rr
                                  WHERE rr.review_id = p.id AND rr.round_number = p.current_round
                                    AND rr.withdrawn_at IS NOT NULL),
          'preview', (SELECT jsonb_build_object(
                               'file_id', f.id, 'file_name', f.file_name, 'extension', f.extension,
                               'file_version_id', fv.id, 'version', fv.version, 'revision', fv.revision)
                      FROM review_item i
                      JOIN file f ON f.id = i.file_id
                      JOIN file_version fv ON fv.id = i.file_version_id
                      WHERE i.review_id = p.id
                      ORDER BY i.sort_order, f.file_name
                      LIMIT 1),
          'gate', NULL)
        FROM review p WHERE p.id = pg.id)
      ELSE (
        SELECT jsonb_build_object(
        'kind', 'gate',
        'id', pr.id,
        'title', f.file_name || ' - ' || wg.name,
        'status', 'open',
        'priority', 'normal',
        'due_date', NULL,
        'overdue', false,
        'mode', NULL,
        'round', NULL,
        'requested_by', review_get_user_json(pr.requested_by),
        'requested_at', pr.requested_at,
        'completed_at', NULL,
        'team_id', NULL,
        'item_count', 1,
        'items_decided', 0,
        'items_owed_by_me', 1,
        'reviewers_owing', NULL,
        'reviewers_withdrawn', NULL,
        'preview', jsonb_build_object('file_id', f.id, 'file_name', f.file_name, 'extension', f.extension,
                                      'file_version_id', NULL, 'version', f.version, 'revision', f.revision),
        'gate', jsonb_build_object(
          'pending_review_id', pr.id,
          'file_id', f.id,
          'file_name', f.file_name,
          'file_path', f.file_path,
          'gate_id', wg.id,
          'gate_name', wg.name,
          'gate_type', wg.gate_type,
          'transition_id', wt.id,
          'transition_name', wt.name,
          'from_state_name', fs.name,
          'to_state_name', ts.name,
          'checklist_items', wg.checklist_items))
        FROM workflow_gate_review pr
        JOIN file f ON f.id = pr.file_id
        JOIN workflow_gate wg ON wg.id = pr.gate_id
        JOIN workflow_transition wt ON wt.id = pr.transition_id
        LEFT JOIN workflow_state fs ON fs.id = wt.from_state_id
        LEFT JOIN workflow_state ts ON ts.id = wt.to_state_id
        WHERE pr.id = pg.id)
      END AS payload
    FROM page pg
    WHERE pg.rn <= v_limit
  )
  SELECT COALESCE((SELECT jsonb_agg(pl.payload || jsonb_build_object('cursor', pl.sort_key) ORDER BY pl.rn)
                   FROM payloads pl), '[]'::jsonb),
         (SELECT count(*)::integer FROM page),
         (SELECT max(pg.sort_key COLLATE "C") FILTER (WHERE pg.rn <= v_limit) FROM page pg)
    INTO v_rows, v_count, v_next;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'next_cursor', CASE WHEN v_count > v_limit THEN v_next END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

-- The requirements are identifiers: sql_strip_noise() drops string literals before matching.
INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('trg_file_comment_notify_review()', '20-change-control', 514),
  ('file_comment_list_resolvable(uuid[])', '20-change-control', 514)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'trg_file_comment_notify_review()', '20-change-control', NULL,
    'withdrawn_at && can_user_access_vault && current_round && action_url && from_user_id && pg_advisory_xact_lock', 514),
  ('function', 'file_comment_list_resolvable(uuid[])', '20-change-control', NULL,
    'my_actor_id && my_accessible_vault_ids && is_org_admin && withdrawn_at && has_team_permission', 514),
  ('function', 'review_list_queue(text,uuid,text,integer,text)', '20-change-control', NULL,
    'org_require_member && gate_review_list_awaiting_ids && withdrawn_at', 514)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 514 $$;
-- Must equal VERSION_DESCRIPTIONS[514] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Review comment notifications. A new comment or reply in an open review notifies its requester and '
  'current-round reviewers who are not withdrawn and can read the vault, never the commenter, at most '
  'once per recipient per review per hour (review_comment). file_comment_list_resolvable() returns the '
  'comments the caller may resolve, by file_comment_set_resolved()''s rule. review_list_queue() package '
  'rows add reviewers_owing and reviewers_withdrawn.'
$$;
