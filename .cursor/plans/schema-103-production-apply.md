# Schema 103: production apply (2026-10-28)

Applied by Claude at the owner's request through the Supabase Management API (`database/query`),
from the files on origin/main at 50048968. Production went from 102 to 103.

## Scope and audit

- Production recorded 102 and `schema_release_version()` returned 102. Since 102 shipped (5d8a96dd,
  v4.7.1), `supabase/` changed only by a8d5a0c4: six nullable `ADD COLUMN IF NOT EXISTS ... TEXT`
  on `inspection_characteristics` / `inspection_characteristic_versions`, `checkin_file` copying
  them into snapshots (inspection hash unchanged), and the version bump.
- Top-level statements that change or remove data, checked read-only against production first:
  the legacy workflow `DROP TABLE IF EXISTS ... CASCADE` (10-source-files.sql:241-259) matched no
  table; `DELETE FROM customer_categories WHERE category = 'reseller_distributor'` matched 0 rows;
  the `UPDATE`s only backfill NULLs.
- Independent review (separate agent, not shown the audit): APPLY. Its one note: run module 15
  straight after 10 (a check-in between them fails with a missing column and rolls back).
- Safety net: daily backup of 2026-10-28 10:42 UTC completed (no PITR). Saved locally before the
  apply: all 193 public function definitions and every row of both inspection tables.

## Apply

core.sql, modules 10, 15, 20, 30, 40, 50, 60, each one request, all succeeded; then
`tools/verify-schema.sql` passed and stamped 103 (106 tables, 193 functions, 269 policies).

## After

- Inspection rows: 8 and 16, identical to before apart from the new columns (all NULL).
- files 36,967, users 31, folders 2,610: unchanged. file_versions +4 and activity +18 were live
  check-ins during the apply. Functions 193 and policies 269 unchanged; columns +6.
- Function bodies (ignoring CR line endings): changed only `schema_release_version`,
  `schema_release_description`, `checkin_file`, and `claim_pending_membership`.

## Drift found: `claim_pending_membership`

core.sql defines it; 40-integrations.sql redefines it to also call
`apply_pending_license_assignments` (SolidWorks licences pre-assigned on an invitation). Production
had core's version, so an earlier apply ran core.sql after module 40. The in-order apply restored
the module-40 version. Three invitations claimed on 2026-01-26/27 each had one pre-assigned
licence and none of those users holds it now. Not repaired automatically: the seats may have been
reassigned since. The owner can assign them in Settings if they are still owed.

Lesson: run the files in order (core, then 10..60), every time, or a later core.sql silently
undoes module redefinitions.
