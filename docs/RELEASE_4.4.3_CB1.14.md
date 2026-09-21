# BluePLM 4.4.3-CB1.14

BluePLM 4.4.3-CB1.14 is the current BluePLM MDB fork release. It retains the
upstream Supabase option and adds a guided PHP/MariaDB backend path. Select the
backend once during first-run setup; inactive backend-specific controls and
requests stay disabled.

## Highlights

- Guided MariaDB/PHP installation: FTP/FTPS deployment, document-root check,
  private server secrets, database migration, owner account and optional TOTP
  authenticator protection.
- One-time setup hardening: the bootstrap token is retired automatically when
  the private environment file is writable; the setup endpoint is locked after
  the first owner is created in every case.
- Physical revision storage per vault:
  - Windows network/NAS vaults with client-local SMB credentials in Windows
    Credential Manager.
  - Google Workspace Shared Drive vaults with per-user Google OAuth and Drive
    membership as the physical-file access boundary.
- Google Drive revisions use immutable Drive file IDs and native chunked 8 MiB
  upload/download transfers. Large CAD files bypass PHP and Chromium's complete
  file buffer.
- Network and Google Drive vaults can coexist in an organization, but each
  individual vault uses exactly one provider so its revision history has one
  canonical physical store.
- Google Drive item-image overrides are supported with a 3 MiB display limit.

> Google Drive is **not production-tested**. Validate it first with a separate
> database and a test Shared Drive. See the [English guide](mdb-google-drive.md)
> or [German guide](mdb-google-drive.de.md).

## Bug fixes and reliability changes

- Fixed Community/MDB downloads failing with `Community storage path is missing`
  when a revision is available through its selected provider.
- Fixed Community/MDB check-in and first check-in rejecting Google Drive vaults.
- Added immutable revision restore support for Google Drive version rollbacks.
- Fixed large-file upload instability by keeping upload streams in the Electron
  main process instead of serializing whole files through the renderer.
- Restored SolidWorks Document Manager license controls independently of the
  selected backend; they are not a Supabase feature.
- Improved eDrawings preview detection and embedded-preview fallback behavior.
- Made backend selection exclusive so MariaDB users do not see or trigger
  Supabase-only configuration paths.
- Improved MariaDB setup validation, lower-case company-slug guidance, named
  setup-secret explanations, and initial NAS folder selection.
- Added schema-version compatibility handling for older MDB databases.

## Verification

- Electron renderer and main-process TypeScript checks passed.
- Community first-check-in, storage-pointer and rollback-related unit tests
  passed.
- PHP/MariaDB Docker integration test passed: one-time setup lock, automatic
  bootstrap-token handling, network-vault metadata, Google Drive setup fields,
  and TOTP administrator login.
- Production Windows installer built successfully:
  `BluePLM-4.4.3-CB1.14-win.exe`

## Upgrade notes

- Existing installations retain their configured backend profile.
- MDB upgrades must deploy the matching PHP package, run migrations, and keep
  the server `.env` outside the web document root.
- For a Google Drive vault, do not move or delete revision files in the Drive
  UI. BluePLM stores the immutable revision pointer by Drive file ID.
