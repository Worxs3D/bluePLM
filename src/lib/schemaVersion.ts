/**
 * Schema Version Checking
 *
 * Detects mismatches between the app's expected database schema version
 * and the actual schema version in the database. This helps users understand
 * when their organization's database needs to be updated.
 *
 * DATABASE SCHEMA LOCATION:
 * The schema is now modular - see supabase/README.md for details:
 * - supabase/core.sql - Foundation (orgs, users, teams, permissions)
 * - supabase/modules/*.sql - Feature modules (source files, change control, etc.)
 *
 * WHAT THE NUMBER IN THE DATABASE MEANS (schema 89 onwards):
 * schema_version.version is written by one thing only - verify_and_stamp_schema(),
 * called from supabase/tools/verify-schema.sql - and only after it has confirmed
 * that the objects the release requires are actually present. Running a file no
 * longer stamps anything. Before 89 both core.sql and each module stamped the
 * head unconditionally, so applying one module to an old database recorded a
 * version the database was not at and this check reported "up to date" over a
 * half-applied schema. The comparison below is worth acting on because the number
 * it reads can now only be reached by verification.
 *
 * Version 0 is the value core.sql seeds and means "never verified", which is not
 * the same as "old" - see the dbVersion === 0 branch below.
 *
 * When making schema changes:
 * 1. Increment EXPECTED_SCHEMA_VERSION here
 * 2. Update the appropriate module file in supabase/ (core.sql or modules/*.sql)
 * 3. Bump schema_release_version() in supabase/core.sql to match, and add any
 *    new object to schema_release_manifest() there so verification can see it
 * 4. Add entry to VERSION_DESCRIPTIONS below
 * 5. This file and schema_release_version() in supabase/core.sql must agree
 */

import { supabase } from './supabase'

// The schema version this app version expects
// Increment this when releasing app updates that require schema changes
export const EXPECTED_SCHEMA_VERSION = 509

// 5.0 renamed the schema (supabase/rename-map-5.0.json), so no 5.x app can run against a 4.x
// database at all: anything below this is a hard block (src/features/dbUpgrade), never a warning.
// A database newer than the app is fine unless client_min_version() says otherwise, because
// migrations after 500 are additive for the app versions they leave allowed.
export const MINIMUM_COMPATIBLE_VERSION = EXPECTED_SCHEMA_VERSION

// Human-readable descriptions for each version
// What the app shows for the schema it expects. The 1-112 history lives in git and in
// supabase/legacy-4.10; no 5.x client can meet a database below 500.
export const VERSION_DESCRIPTIONS: Record<number, string> = {
  500:
    'BluePLM 5.0: one clean schema with consistent names (singular tables such as organization, app_user, file and file_version; org_ prefixes; <entity>_<verb> functions), upgraded from 112 in place by migrations/0500_from_4x.sql. From 5.0 on, the desktop app applies the database SQL itself: an organization admin gives the database connection once, the app runs the numbered migrations in supabase/migrations under an advisory lock, each in its own transaction, records them in schema_migration with a checksum, and verifies. client_min_version() names the oldest app allowed to connect; older 5.x apps update before they continue.',
  501:
    "Server-run backups. backup_config.run_location chooses who runs scheduled and requested backups: the designated desktop machine (restic over its local vault copy, as before) or the API backup worker, which backs up the whole vault bucket and the organization's rows with no computer on. last_scheduled_slot_at lets a missed slot be caught up once; verify_requested_at and verify_mode request a test of the backup; server_worker_seen_at shows the worker is alive. backup_history gains kind (backup or verify), trigger, runner and report. backup_list_org_rows() and backup_list_vault_objects() are callable by service_role only.",
  502:
    'Security hardening and monitoring. can_access_module answers for the caller only. Realtime sends no DELETE events (they bypass RLS); deletes arrive as realtime_tombstone inserts under RLS. organization.email_domains: one organization per domain, no public mail domains, and an admin adds only the domain of their own verified address. The stamp refuses unregistered exposed functions. security_monitor_run() (pg_cron) notifies admins of new administrators, email-domain joins, delete spikes, auth request spikes, backup failures and schema drift. A Before User Created auth hook refuses sign-ups with no invitation, organization domain or supplier contact; org_create_with_founder() creates an organization with its founding admin invitation.',
  503:
    "Damaged and missing vault content. vault_object_issue keeps one row per content hash whose stored bytes do not match their name (damaged) or that a file version names with nothing in storage (missing), recorded by server backups and tests through backup_issue_record() (service_role), with status open, repaired, unrecoverable or accepted, and vault_object_issue_event logs every finding and action. Admins read them through vault_object_issue_list() and decide with vault_object_issue_resolve(); the API repairs through backup_issue_record_repair() after re-hashing; downloads ask vault_object_blocked() for content marked unrecoverable.",
  504:
    "Inspection reports. inspection_characteristic and its snapshots gain tolerance_source (drawing or general), copied by file_checkin() and kept out of inspection_hash. inspection_template is the organization's library of Excel report templates (members read, administrators write, one default). inspection_report attaches a generated report to one drawing version, with its workbook, embedded drawing PDF and returned workbook in the vault bucket; it follows the file's vault, writing needs explorer edit, and the actor columns are set by the database. can_read_vault_object() reads report and template content; server backups export both tables.",
  505:
    "Version outputs. file_version_output keeps the STEP, IGES, STL and DXF exports of a checked-in file version (per configuration) in the vault bucket; it follows the file's vault, clients only read it, and file_version_output_record() writes it (explorer edit, the file's vault, content the caller uploaded or can read; replacing a recorded output is for administrators). can_read_vault_object() reads output content; check_release_residue() covers the table; server backups export it. inspection_report gains sequence, the report's number within its naming scope.",
  506:
    "Inspection report types. inspection_report gains report_type (first article, production, receiving, re-inspection; none on older reports), the FAI scope, reason and baseline version, the lot, lot size, sampling plan (100 percent or a fixed sample) and sample columns, purchase order and supplier, the NCR reference, and the characteristics the report includes; all are fixed once the report is issued, and results on a typed report must be in the 5.6 format. inspection_template gains the report types it serves and the types it is the default for (one default per type per organization; archiving ends them).",
  507:
    "Deleting version outputs. drawing_pdf_render_delete() and file_version_output_delete() delete a version's drawing PDF or export (the file's vault; an administrator, or the user who generated it with explorer edit). A drawing PDF of a version in an open review is kept. The content stays in the vault bucket.",
  508:
    'Inspection report lineage. inspection_report gains supersedes_report_id, the report of the same drawing that a regenerated report replaces; it is fixed once the report is issued and cleared only when the replaced report is deleted.',
  509:
    "Released versions. file_version records its release (when, by whom, the approved review or a forced release, the note and the revision), written only by a transition into a state that releases (workflow_state.releases_version). A drawing is released through an approved review of that version or forced with workflow_transition_execute(..., p_force_release), which is logged. A released version's exports and inspection reports cannot be replaced or deleted. inspection_report_overwrite() regenerates a report of the same version in place; file_set_auto_output() sets which exports a file keeps up to date at check-in; the default workflow is WIP, In Review, Released, Obsolete.",
}

export interface SchemaVersionInfo {
  version: number
  description: string | null
  appliedAt: Date | null
  appliedBy: string | null
}

export interface SchemaCheckResult {
  status: 'current' | 'outdated' | 'incompatible' | 'unknown' | 'missing'
  dbVersion: number | null
  expectedVersion: number
  message: string
  details?: string
}

/**
 * Fetch the current schema version from the database
 */
export async function getSchemaVersion(): Promise<SchemaVersionInfo | null> {
  try {
    const { data, error } = await supabase
      .from('schema_version')
      .select('version, description, applied_at, applied_by')
      .single()

    if (error) {
      // Table might not exist yet (pre-schema-versioning database)
      return null
    }

    // Type assertion needed because supabase client uses @ts-nocheck
    const row = data as {
      version: number
      description: string | null
      applied_at: string | null
      applied_by: string | null
    }

    return {
      version: row.version,
      description: row.description,
      appliedAt: row.applied_at ? new Date(row.applied_at) : null,
      appliedBy: row.applied_by,
    }
  } catch {
    return null
  }
}

/**
 * Check if the database schema is compatible with this app version
 */
export async function checkSchemaCompatibility(): Promise<SchemaCheckResult> {
  const versionInfo = await getSchemaVersion()

  // The version could not be read (no table, or the read failed)
  if (versionInfo === null) {
    return {
      status: 'missing',
      dbVersion: null,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'Database schema version unknown',
      details:
        'The database did not report its schema version. An organization admin can set it up or ' +
        'upgrade it from the BluePLM desktop app (Database upgrade required).',
    }
  }

  const { version: dbVersion } = versionInfo

  // Version 0 is what core.sql seeds. It does not mean an old database - it
  // means verify-schema.sql has never completed against this one, which is the
  // state of every database in the ten minutes after it is created. Reported as
  // 'incompatible' it produced a permanent error toast telling the admin their
  // brand-new database was "too old", with a minimum version it already
  // exceeded. It is missing a version, not behind on one.
  if (dbVersion === 0) {
    return {
      status: 'missing',
      dbVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'Database not verified yet',
      details:
        'This database has never been verified. An organization admin finishes the setup from the ' +
        `BluePLM desktop app, which verifies it and records the version (v${EXPECTED_SCHEMA_VERSION}).`,
    }
  }

  // Perfect match
  if (dbVersion === EXPECTED_SCHEMA_VERSION) {
    return {
      status: 'current',
      dbVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'Database schema is up to date',
    }
  }

  // Database is newer than app (user should update app)
  if (dbVersion > EXPECTED_SCHEMA_VERSION) {
    return {
      status: 'outdated',
      dbVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'App update available',
      details:
        `Your database (v${dbVersion}) is newer than this app expects (v${EXPECTED_SCHEMA_VERSION}). ` +
        'Please update BluePLM to the latest version for the best experience.',
    }
  }

  // Database is older than app expects: always a hard block since 5.0 (no soft mode).
  if (dbVersion < MINIMUM_COMPATIBLE_VERSION) {
    return {
      status: 'incompatible',
      dbVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'Database schema update required',
      details:
        `Your organization's database (v${dbVersion}) is too old for this app version. ` +
        `Required: v${MINIMUM_COMPATIBLE_VERSION}+. An organization admin upgrades it from the ` +
        'BluePLM desktop app (Database upgrade required).',
    }
  }

  // Unreachable while MINIMUM_COMPATIBLE_VERSION === EXPECTED_SCHEMA_VERSION; kept as the
  // exhaustive answer for any version the branches above did not take.
  return {
    status: 'incompatible',
    dbVersion,
    expectedVersion: EXPECTED_SCHEMA_VERSION,
    message: 'Database schema update required',
    details: `Your organization's database (v${dbVersion}) must be upgraded to v${EXPECTED_SCHEMA_VERSION}.`,
  }
}

/** True when this app cannot run against the database at all (5.0: anything below 500). */
export function requiresDatabaseUpgrade(dbVersion: number | null): boolean {
  return dbVersion === null || dbVersion < MINIMUM_COMPATIBLE_VERSION
}
