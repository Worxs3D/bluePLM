-- =====================================================================
-- 0512_comment_resolve.sql: resolving someone else's comment (schema 511 -> 512)
-- =====================================================================
-- The only UPDATE policy on file_comment is "file_comment: users update own" (user_id =
-- auth.uid()), so a drawing's author resolving a reviewer's markup was refused and the app rolled
-- the tick back. Resolving is a different act from editing: it closes a thread for everyone working
-- on the file, so it belongs to the people working on it, not only to whoever wrote the comment.
--
--   file_comment_set_resolved(p_comment_id, p_resolved)
--     resolves or reopens one comment (a root thread or a reply) and changes nothing else:
--     is_resolved, resolved_by (the caller, or NULL on reopen) and resolved_at (now, or NULL).
--
-- Who may:
--   - the comment's author;
--   - an organization administrator (is_org_admin(): the role or the Administrators team);
--   - for a comment made in a review (review_id set): the review's requester and its reviewers,
--     in any round and whether the review is open or closed. A reviewer the review has withdrawn
--     (review_response.withdrawn_at, schema 108: left the organization or lost the vault) is no
--     longer one of its reviewers;
--   - for any other comment: a member with module:explorer edit on the file's vault.
-- Everyone must be able to read the comment: the file is in the caller's organization and its
-- vault is one of my_accessible_vault_ids(), the rule "file_comment: users read" applies. A comment
-- that does not exist and one the caller cannot read are refused alike (COMMENT_NOT_FOUND).
-- Earlier-round comments may be resolved: trg_file_comment_link_review() freezes their text and
-- position only.
--
-- The UPDATE policy is not widened: the function is the only path for anyone but the author, and it
-- writes the resolve columns only. resolved_by records who resolved; there is no activity row,
-- because activity is the file's history and has no action for a comment.
--
-- Additive: the previous release keeps updating its own comments through the policy.
--
-- No BEGIN / COMMIT: the migration runner wraps this file in a transaction.
-- =====================================================================

CREATE OR REPLACE FUNCTION file_comment_set_resolved(p_comment_id UUID, p_resolved BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_comment file_comment%ROWTYPE;
  v_org_id UUID;
  v_vault_id UUID;
  v_review review%ROWTYPE;
  v_allowed BOOLEAN := false;
  v_changed BOOLEAN := false;
BEGIN
  v_actor := my_actor_id();

  IF p_comment_id IS NULL OR p_resolved IS NULL THEN
    RAISE EXCEPTION 'A comment and whether it is resolved are required'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'BAD_ARGUMENTS';
  END IF;

  SELECT c.* INTO v_comment FROM file_comment c WHERE c.id = p_comment_id;
  IF v_comment.id IS NOT NULL THEN
    SELECT f.org_id, f.vault_id INTO v_org_id, v_vault_id FROM file f WHERE f.id = v_comment.file_id;
  END IF;

  -- What "file_comment: users read" lets the caller see, inside the caller's organization.
  IF v_comment.id IS NULL OR v_org_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = v_actor AND u.org_id = v_org_id)
     OR v_vault_id IS NULL
     OR NOT (v_vault_id IN (SELECT my_accessible_vault_ids())) THEN
    RAISE EXCEPTION 'Comment not found'
      USING ERRCODE = 'insufficient_privilege', HINT = 'COMMENT_NOT_FOUND';
  END IF;

  IF v_comment.user_id = v_actor OR is_org_admin() THEN
    v_allowed := true;
  ELSIF v_comment.review_id IS NOT NULL THEN
    SELECT r.* INTO v_review FROM review r WHERE r.id = v_comment.review_id AND r.org_id = v_org_id;
    v_allowed := v_review.id IS NOT NULL AND (
      v_review.requested_by = v_actor
      OR (EXISTS (SELECT 1 FROM review_response rr
                   WHERE rr.review_id = v_review.id AND rr.reviewer_id = v_actor AND rr.withdrawn_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM review_response rr
                           WHERE rr.review_id = v_review.id AND rr.reviewer_id = v_actor AND rr.withdrawn_at IS NOT NULL))
    );
  ELSE
    -- Explorer edit on the file's vault (a grant for every vault, or one for this vault).
    v_allowed := has_team_permission('module:explorer', 'edit', v_vault_id);
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Only the comment''s author, the review''s requester and reviewers, or an administrator can resolve this comment'
      USING ERRCODE = 'insufficient_privilege', HINT = 'FORBIDDEN';
  END IF;

  SELECT c.* INTO v_comment FROM file_comment c WHERE c.id = p_comment_id FOR UPDATE;

  IF COALESCE(v_comment.is_resolved, false) IS DISTINCT FROM p_resolved THEN
    UPDATE file_comment
       SET is_resolved = p_resolved,
           resolved_by = CASE WHEN p_resolved THEN v_actor ELSE NULL END,
           resolved_at = CASE WHEN p_resolved THEN NOW() ELSE NULL END
     WHERE id = p_comment_id
    RETURNING * INTO v_comment;
    v_changed := true;
  END IF;

  RETURN jsonb_build_object(
    'id', v_comment.id,
    'file_id', v_comment.file_id,
    'is_resolved', COALESCE(v_comment.is_resolved, false),
    'resolved_by', v_comment.resolved_by,
    'resolved_at', v_comment.resolved_at,
    'changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION file_comment_set_resolved(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION file_comment_set_resolved(UUID, BOOLEAN) TO authenticated, service_role;

COMMENT ON FUNCTION file_comment_set_resolved(UUID, BOOLEAN) IS
  'Resolves or reopens a comment: its author, an administrator, the requester and reviewers of the '
  'review it was made in (withdrawn reviewers excluded), or for a comment outside a review a member '
  'with explorer edit. The file''s vault must be readable. Writes is_resolved, resolved_by and resolved_at only.';

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

-- The requirements are identifiers: sql_strip_noise() drops string literals before matching.
INSERT INTO schema_function_inventory (signature, module, release) VALUES
  ('file_comment_set_resolved(uuid, boolean)', '20-change-control', 512)
ON CONFLICT (signature) DO UPDATE SET module = EXCLUDED.module, release = EXCLUDED.release;

INSERT INTO schema_manifest_entry (kind, name, module, probe, requires, since_version) VALUES
  ('function', 'file_comment_set_resolved(uuid,boolean)', '20-change-control', NULL,
    'my_actor_id && my_accessible_vault_ids && is_org_admin && withdrawn_at && has_team_permission && resolved_by', 512)
ON CONFLICT (kind, name) DO UPDATE
  SET module = EXCLUDED.module, probe = EXCLUDED.probe, requires = EXCLUDED.requires,
      since_version = EXCLUDED.since_version;

-- ===========================================
-- Release
-- ===========================================
CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 512 $$;
-- Must equal VERSION_DESCRIPTIONS[512] in src/lib/schemaVersion.ts.
CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Resolving comments. file_comment_set_resolved() resolves or reopens a comment for its author, an '
  'administrator, the requester and reviewers of the review it was made in (not a withdrawn reviewer), '
  'or, outside a review, a member with explorer edit, on a file whose vault the caller can read. It '
  'writes only is_resolved, resolved_by and resolved_at; the comment update policy stays the author''s.'
$$;
