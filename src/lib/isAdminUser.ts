/**
 * The one definition of "administrator" for the renderer.
 *
 * A user is an administrator when `users.role` is 'admin' OR they are a member
 * of the Administrators team. This is the same rule `is_org_admin()` applies in
 * the database and `request.user.isAdmin` applies in the API. Testing the role
 * column alone refused every Administrators-team member whose role column said
 * 'engineer' or 'viewer': the team grants admin on the server, so the UI must
 * not hide admin features from them.
 *
 * Keep this file free of imports from the store or Supabase so it can be used
 * anywhere, including inside store slices.
 */

/** Name of the team whose members are administrators. Matches `is_org_admin()`. */
export const ADMINISTRATORS_TEAM_NAME = 'Administrators'

/** Anything with a `name`: the team shapes in the store and in team queries. */
export interface NamedTeam {
  name: string
}

/** True when any of the teams is the Administrators team. */
export function isInAdministratorsTeam(teams: ReadonlyArray<NamedTeam> | null | undefined): boolean {
  if (!teams) return false
  return teams.some((team) => team.name === ADMINISTRATORS_TEAM_NAME)
}

/**
 * Whether a user is an administrator.
 *
 * @param role - The user's `users.role` value, if known
 * @param teams - The teams the user belongs to, if loaded
 */
export function isAdminUser(
  role: string | null | undefined,
  teams: ReadonlyArray<NamedTeam> | null | undefined,
): boolean {
  return role === 'admin' || isInAdministratorsTeam(teams)
}
