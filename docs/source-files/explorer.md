# Explorer

The Explorer is your main interface for browsing and managing files in BluePLM.

## Interface Overview

The Explorer shows:
- **Connected Vaults** - Top-level containers you have access to
- **Folder Tree** - Navigate through directories
- **File List** - Files in the current location
- **Status Indicators** - Sync status, checkout state, modifications

## Connecting a Vault

Before you see files, you need to connect to a vault:

1. If no vaults are connected, you'll see the Welcome screen
2. Click **Connect** next to an available vault
3. BluePLM creates a local folder and syncs files

## File States

Files show different states based on their sync status:

| State | Meaning |
|-------|---------|
| Synced | Local and cloud versions match |
| Modified | Local changes not yet uploaded |
| Cloud Only | Exists on server, not downloaded locally |
| Outdated | Server has a newer version |
| Checked Out | Someone is actively editing |
| Moved | The file sits here on your disk, but the vault still records it at its old path |
| Moved Away | The vault still lists the file here, but on your disk it has moved elsewhere |

## Actions

### Download Files
Click the download button to fetch files that exist only in the cloud and are not yet on your
disk. It acts only on Cloud Only files, so a folder containing both Cloud Only and Outdated
files downloads just the ones you do not have.

### Get Latest
Click the update button, or choose **Get Latest** from the right-click menu, to replace files
you already have with a newer version from the server. It acts only on Outdated files.

### Resolve Moved Files
Moved and Moved Away are two views of the same file: one row where it actually is, one where the
vault still expects it. Choose **Resolve Moved Files…** from the right-click menu to pick which
side wins. **Update the Vault** writes the path on your disk to the server, and everyone else
picks up the new location on their next sync. **Restore Local Files** renames the files on your
disk back to the path the server already records, and writes nothing to the server.

Either direction skips files checked out by someone else unless you explicitly include them, and
skips any file whose destination is already occupied.

To check every one of these states across a whole vault at once, and fix the ones that are safe
to fix automatically, see **Re-align with Server** under [Organization Settings](/settings/organization).

### Check Out
Before editing a file, check it out to lock it:
- Others see who has it locked
- Prevents conflicting edits

Metadata edits (item number, description, revision) stay unsaved until you check the file in. If
your checkout is released before then — an admin forces a release, or you release it from another
machine — BluePLM warns you that those edits can no longer be checked in. Checking the file out
again lists the edits it would discard and asks first; cancel to keep them on screen and copy them
down. They are never restored automatically, because someone may have checked in newer values in
the meantime.

### Check In
When done editing, check in your changes:
- Uploads your modified file
- Releases the lock

### Multi-Select
Hold `Ctrl` (or `Cmd` on Mac) to select multiple files for batch operations.

### Generate and exports
Right-click a file and choose **Generate**:
- **On server** records outputs against the latest checked-in version, so everyone sees the same
  file: PDF (drawings), STEP (drawings export the model they show; parts and assemblies), and
  **Inspection report**, which lists your templates and shows the report already made from each.
- **Local** writes ordinary files: the export options (PDF, STEP, IGES, STL, DXF), and an
  inspection report workbook saved where you choose, recorded nowhere.

The **Outputs** column shows each drawing's PDF, STEP and newest inspection report: click one to
preview it, a faint one to generate it, and one with an amber mark (made from an older version) to
generate it for the latest version. **Generate** in the toolbar does the same for the PDFs and STEPs
that are missing or out of date in the selection, the folder, or the folder and its subfolders.

Under a file's chevron, **Exports** lists one line per kind, the released one first. Each export's
menu has **Regenerate at check-in** (on by default). Right-click the **Exports** header to generate
a kind the file does not have yet. An up-to-date export is never regenerated, and a released one
never changes. Under a drawing, **Parent** lists the part or assembly it shows, **Inspection
reports** lists its reports (regenerating one overwrites it for the same version) and **Received
inspections** the filled-in workbooks that came back, also listed in the Inspection tab's Received
view.

Click an export or report to preview it. `Ctrl`-click adds or removes one, `Shift`-click selects a
range; right-click the selection to save them all next to the file or delete them.

## Pinned Folders

Pin frequently-used folders for quick access:
1. Right-click a folder
2. Select **Pin**
3. It appears in the Pinned section at the top

Drag pinned folders to reorder them.

## Context Menu

Right-click files/folders for additional options:
- Open in Explorer/Finder
- Rename
- Copy/Move
- Delete
- View History

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `F5` | Refresh |
| `Delete` | Move to trash |
| `F2` | Rename |
| `Ctrl+C` | Copy |
| `Ctrl+V` | Paste |

