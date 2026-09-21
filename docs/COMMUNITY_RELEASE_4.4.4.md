# BluePLM Community 4.4.4

## Backend selection

Setup records one active backend per Windows client. Choosing **MariaDB Community**
removes the local Supabase configuration, disables Supabase client creation, and
hides Supabase-only settings. Choosing Supabase does the inverse. This profile is
an adapter boundary: further backend implementations can be added without mixing
their configuration or requests into an existing installation.

## Community changes

- First file import stages immutable content in the network vault under
  `.blueplm/objects/<sha256-prefix>/<sha256>`, verifies its hash, and only then
  creates the MariaDB record.
- File-delta and vault-count reads use the Community PHP API rather than Supabase
  RPCs.
- Community administrators can create accounts and change a member's name, email
  address, or password. A credential change revokes that member's sessions.
- Community member and team administration loads users, teams, and vault access
  through the PHP API. Supabase-only roles, titles, invitations, permissions,
  and reviewer controls are not rendered in this backend mode.
- Community Settings uses an adapter allow-list and redirects a stale former
  Supabase tab to Vaults, preventing hidden legacy tabs from being reopened.
- The SolidWorks helper is compiled and copied into each Windows package during
  `npm run build`.

## Verification

- 2,146 renderer/unit tests passed.
- PHP/MariaDB integration test passed, including account updates, revoked tokens,
  vault import, check-in revision, and Community CLI checkout.
- SolidWorks service test suite passed: 208 passed; 29 fixture-dependent tests
  skipped on this computer.

The repository-wide ESLint job still reports pre-existing issues outside the
Community release paths. The changed client files pass targeted ESLint.
