# Organization Settings

Settings that affect your entire organization. Most require admin access.

## Vaults

Manage file storage containers. See [Vaults](/source-files/vaults) for details.

### Re-align with Server

Each connected vault has a **Re-align with Server** section that checks your local copy against
the server and reports how they disagree — files that moved on your disk but not in the vault,
files the server no longer has, files with a newer version on the server, and files that only
exist locally or have local edits the server hasn't seen. It's available to every user, not just
admins, since it only ever touches your own disk.

Opening the check is instant — it reads the same file list the Explorer already shows, so there's
no scan to wait for. What it finds is grouped into three kinds:

- **Can be fixed now** — moved files put back where the vault expects them, files the server no
  longer has moved to the Recycle Bin, and outdated files replaced with the server's current
  version. Each is a checkbox, on by default; untick any you'd rather handle yourself. Moved
  files default to keeping the server's path, but the list shows every one individually with its
  vault path and its disk path, so you can flip any file to keep its local path instead — useful
  when the rename on this machine is the one that should stick. A mixed choice can show more than
  one confirmation prompt while it runs; the dialog says so rather than leaving you looking at a
  spinner with no explanation.
- **Needs your decision** — local-only files and files with unsaved local edits. Re-align never
  touches these; it lists them so you can check them in or leave them as they are.
- **For information** — files only on the server (re-align doesn't download in bulk), files
  matching an ignore pattern, and files blocked by an active checkout, whether that checkout is
  someone else's or your own.

Running the fix reports what happened for each item you selected, and the check re-runs
immediately afterward so you see the vault's new state without reopening the dialog.

## Members & Teams

Manage users and access control.

### Users Tab

View all organization members:
- Name, email, avatar
- Role (admin/member)
- Teams they belong to
- Last sign-in time

**Actions:**
- Change user role
- Assign to teams
- Manage vault access
- Remove from organization

### Teams Tab

Teams group users for permission management.

**Default teams** (created automatically):
- Viewers - Read-only access
- Engineers - Standard access
- Administrators - Full access

**Create a team:**
1. Click **Create Team**
2. Enter name
3. Choose icon and color
4. Set permissions

### Roles Tab

Workflow roles for approval processes:
- Design Lead
- QA Manager
- etc.

Assign roles to users for workflow approvals.

### Titles Tab

Job titles for display purposes:
- Create titles (Engineer, Manager, etc.)
- Assign to users inline

## Company Profile

Set organization details:
- **Name** - Your company name
- **Logo** - Company logo for branding
- **Settings** - Organization-wide configuration

## Sign-In Methods

Control which authentication methods are available for your organization.

### Team Members

Configure sign-in options for your employees:
- **Google Account** - Sign in with Google OAuth
- **Email & Password** - Traditional email/password authentication
- **Phone Number (SMS)** - Sign in via SMS verification code

### Suppliers

Configure sign-in options for external suppliers and partners:
- **Google Account** - Sign in with Google OAuth
- **Email & Password** - Traditional email/password authentication
- **Phone Number (SMS)** - Sign in via SMS verification code

!!! note "Security"
    At least one sign-in method must remain enabled for each user type.
    Disabling a method prevents new sign-ins but doesn't affect existing sessions.

## Serialization

Configure part numbering:
- **Prefix** - e.g., "BR-"
- **Format** - Number pattern
- **Counter** - Current sequence number

## File Metadata

Define custom metadata columns for files:
- Part number
- Revision
- Description
- Custom fields

## RFQ Settings

Configure request-for-quote workflow:
- Email templates
- Approval workflow
- Supplier settings

## Backups

### Manual Backup
Export your organization's data:
- Files metadata
- User data
- Settings

### Scheduled Backups
Configure automatic backups (coming soon)

## Recovery Codes

Generate recovery codes for database access. Store these securely - they allow database recovery if you lose access.

