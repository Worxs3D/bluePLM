/**
 * Row-level security on solidworks_licenses (schema 106), run against real
 * Postgres (PGlite) with the license section of supabase/modules/40-integrations.sql
 * loaded verbatim. A non-admin must read only the licences assigned to them and
 * no other serial; an admin reads every licence in their own organization.
 *
 * The Supabase pieces the section depends on (auth.uid(), users, is_org_admin(),
 * pending_org_members, the authenticated role) are stubbed with the same
 * shapes. is_org_admin() is stubbed as the role column alone; the real one also
 * admits the Administrators team, which does not change what these policies do
 * with its answer.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002'
const BOB = '00000000-0000-0000-0000-000000000003'
const CAROL = '00000000-0000-0000-0000-000000000004'
const OTHER_ADMIN = '00000000-0000-0000-0000-000000000005'
const L_ALICE = '10000000-0000-0000-0000-000000000001'
const L_CAROL = '10000000-0000-0000-0000-000000000002'
const L_FREE = '10000000-0000-0000-0000-000000000003'
const A_ALICE = '20000000-0000-0000-0000-000000000001'
const A_CAROL = '20000000-0000-0000-0000-000000000002'

const STUBS = `
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE TABLE organizations (id uuid PRIMARY KEY);
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid REFERENCES organizations(id), email text, role text);
CREATE FUNCTION is_org_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') $$;
CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TABLE pending_org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, email text,
  invited_by uuid, claimed_at timestamptz
);
CREATE FUNCTION apply_pending_team_memberships(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`

/** The license section of module 40, minus the realtime publication block. */
function licenseSection(): string {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/modules/40-integrations.sql'), 'utf8')
  const start = sql.indexOf('-- SOLIDWORKS LICENSE MANAGEMENT')
  const end = sql.indexOf('-- CREDENTIAL STORE')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return sql
    .slice(start, end)
    .replace(/DO \$\$\s*BEGIN\s*BEGIN ALTER PUBLICATION[\s\S]*?END \$\$;/, '')
}

let db: PGlite

async function as(userId: string): Promise<void> {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${userId}', false); SET ROLE authenticated;`)
}

async function serials(): Promise<string[]> {
  const r = await db.query<{ serial_number: string }>(
    'SELECT serial_number FROM solidworks_licenses ORDER BY serial_number',
  )
  return r.rows.map((row) => row.serial_number)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUBS)
  await db.exec(licenseSection())
  await db.exec(`
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    INSERT INTO organizations VALUES ('${ORG_A}'), ('${ORG_B}');
    INSERT INTO users VALUES
      ('${ADMIN}', '${ORG_A}', 'admin@a', 'admin'),
      ('${ALICE}', '${ORG_A}', 'alice@a', 'engineer'),
      ('${BOB}', '${ORG_A}', 'bob@a', 'engineer'),
      ('${CAROL}', '${ORG_A}', 'carol@a', 'engineer'),
      ('${OTHER_ADMIN}', '${ORG_B}', 'admin@b', 'admin');
    INSERT INTO solidworks_licenses (id, org_id, serial_number) VALUES
      ('${L_ALICE}', '${ORG_A}', '9000 0000 0000 1111 AAAA BBBB'),
      ('${L_CAROL}', '${ORG_A}', '9000000000002222CCCCDDDD'),
      ('${L_FREE}', '${ORG_A}', '9000 0000 0000 3333 EEEE FFFF');
    INSERT INTO solidworks_license_assignments (id, license_id, user_id, assigned_by) VALUES
      ('${A_ALICE}', '${L_ALICE}', '${ALICE}', '${ADMIN}'),
      ('${A_CAROL}', '${L_CAROL}', '${CAROL}', '${ADMIN}');
  `)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('solidworks_licenses RLS (schema 106)', () => {
  it('an admin reads every licence and serial in their organization', async () => {
    await as(ADMIN)
    expect(await serials()).toHaveLength(3)
  })

  it('a non-admin reads only the licence assigned to them', async () => {
    await as(ALICE)
    expect(await serials()).toEqual(['9000 0000 0000 1111 AAAA BBBB'])
    const other = await db.query('SELECT serial_number FROM solidworks_licenses WHERE id = $1', [L_CAROL])
    expect(other.rows).toHaveLength(0)
  })

  it('a non-admin with no assignment reads no serial', async () => {
    await as(BOB)
    expect(await serials()).toEqual([])
  })

  it('a non-admin reads only their own assignment rows', async () => {
    await as(ALICE)
    const r = await db.query<{ id: string }>('SELECT id FROM solidworks_license_assignments')
    expect(r.rows.map((row) => row.id)).toEqual([A_ALICE])
  })

  it('a non-admin cannot repoint their assignment at another licence to read its serial', async () => {
    await as(ALICE)
    const upd = await db.query('UPDATE solidworks_license_assignments SET license_id = $1 WHERE id = $2', [
      L_CAROL,
      A_ALICE,
    ])
    expect(upd.affectedRows ?? 0).toBe(0)
    expect(await serials()).toEqual(['9000 0000 0000 1111 AAAA BBBB'])
  })

  it('a non-admin can still activate their own assignment through the RPC', async () => {
    await as(ALICE)
    const r = await db.query<{ result: { success: boolean } }>(
      "SELECT activate_solidworks_license($1, 'machine-1', 'PC') AS result",
      [A_ALICE],
    )
    expect(r.rows[0].result.success).toBe(true)
  })

  it('an admin reads every assignment in their organization', async () => {
    await as(ADMIN)
    const r = await db.query('SELECT id FROM solidworks_license_assignments')
    expect(r.rows).toHaveLength(2)
  })

  it('an admin of another organization reads none of these serials', async () => {
    await as(OTHER_ADMIN)
    expect(await serials()).toEqual([])
  })
})
