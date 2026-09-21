# BluePLM 4.4.3-CB1.15

CB1.15 is the public release of the BluePLM MDB fork. It contains the complete
CB1.14 feature set and corrects the release update target so installed clients
check the Worxs3D fork releases rather than the BlueRobotics upstream releases.

## Included features

- First-run backend choice: upstream Supabase or guided BluePLM MDB
  (PHP/MariaDB).
- Guided MDB deployment with FTP/FTPS, schema migration, secure one-time
  bootstrap, owner account creation and optional TOTP authenticator protection.
- Per-vault physical revision storage: Network/NAS or Google Workspace Shared
  Drive.
- Native, chunked Google Drive transfers for large CAD revisions; download,
  check-in, first check-in, rollback, and item image paths use the selected
  vault provider.
- Network-vault credentials stay per Windows user in Credential Manager.
- eDrawings embedded-preview improvements and SolidWorks Document Manager
  license settings independent of the selected backend.
- Backend-specific settings are exclusive: MariaDB users do not trigger or see
  Supabase-only operations.

## Fixes

- Corrected Community/MDB missing-storage-path download failures.
- Corrected Google Drive vault check-in and rollback support.
- Prevented renderer-sized buffering from destabilizing large file uploads.
- Corrected bootstrap-token retirement and setup lock handling.
- Corrected release auto-update metadata to target this fork.

## Validation and status

- Electron TypeScript checks and Community storage unit tests passed.
- PHP/MariaDB Docker integration test passed for setup lock, bootstrap-token
  handling, NAS metadata, Google Drive setup fields and TOTP login.
- Windows installer built successfully.

> Google Drive support is **not production-tested**. Start with a separate MDB
> database and a test Shared Drive. Read the
> [English guide](mdb-google-drive.md) or [German guide](mdb-google-drive.de.md).
