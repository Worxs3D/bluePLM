# Google Drive Shared Drive vaults (BluePLM MDB)

> **Status: not production-tested.** The Google Drive vault adapter has automated
> type and transfer-path tests, but it has not yet been validated in a real
> production organization. Use a separate database and a test Shared Drive
> before storing production CAD data.

BluePLM MDB can use either a Windows network vault or a Google Workspace Shared
Drive folder as the physical, immutable revision store. The MariaDB/PHP backend
always stores the metadata, access rules, revision history, and the pointer to
the physical revision.

## Recommended model

Create a Shared Drive owned by the organization. Add each authorized BluePLM
user to that Drive using normal Google Workspace membership. Each Windows
client signs in with its own Google account; BluePLM does not distribute a
central Google password or refresh token.

Use one storage provider per vault. This keeps each revision history in one
canonical physical store. An organization can create additional vaults later,
including a mix of Network and Google Drive vaults.

## Initial MDB setup

1. Select **MariaDB (MDB)** in the desktop first-run installer.
2. Deploy the PHP package, configure the domain document root to `public/`, and
   complete the server setup page.
3. On the server setup page choose **Google Drive Shared Drive folder** for the
   primary vault, enter a vault name, and enter the destination folder ID.
4. Finish the owner account setup. The one-time bootstrap token is retired and
   the setup endpoint is locked.
5. On every client, open the Google Drive integration and authorize that user's
   Google account. Verify that the account is a member of the selected Shared
   Drive and can create files in the destination folder.

The folder ID is the identifier in a Google Drive folder URL, not its display
name. Keep the folder inside the organization-owned Shared Drive. Do not use a
personal employee drive for the central vault.

## What BluePLM stores

Each first check-in and each changed check-in creates an immutable Drive file.
The database revision stores a `gdrive:<file-id>` pointer. Downloads and
rollbacks resolve that exact file ID, so historical file states do not depend
on a human-maintained folder hierarchy.

Large CAD uploads and downloads are streamed in the Electron main process in
8 MiB chunks. They do not pass through the PHP API and are not buffered as a
whole in the Chromium renderer. Google Drive resumable uploads are designed for
large or interrupted uploads; downloads use the Drive file-media endpoint.

Item-image overrides are supported too, with a separate 3 MiB display cap.

## Security and operations

- Shared Drive membership is the physical-file authorization boundary.
- BluePLM MDB roles remain the application authorization boundary. Remove a
  user's Drive membership as well as their BluePLM access when offboarding.
- Do not delete, rename, or move revision files through Drive's web UI. They
  are addressed by file ID, but removing them makes the corresponding revision
  unrecoverable.
- Do not use a Google Drive desktop-sync folder as a second writer. Let
  BluePLM perform the revision writes.
- The client must reconnect to Google Drive when its OAuth session expires.

## Network vault comparison

Network vaults are still the default, production-proven option for BluePLM MDB.
They use a UNC path and each Windows client can save SMB credentials in Windows
Credential Manager. Google Drive is useful when clients cannot share a reliable
LAN/NAS path, but it should first be accepted through your own test plan.

For Google API behavior, see [resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
and [file downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads).
