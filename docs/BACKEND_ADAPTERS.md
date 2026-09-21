# Backend adapters

Each BluePLM desktop installation has one active backend profile. The profile
is selected in the first-run setup screen and is stored separately from backend
credentials.

## Supported profiles

| Profile | Transport | Data backend | Client behavior |
| --- | --- | --- | --- |
| `supabase` | Supabase client | Supabase/Postgres/Storage | Supabase settings and features are available. |
| `community` | BluePLM HTTPS API | PHP/MariaDB with Network-vault or Google Drive Shared Drive revisions | Supabase configuration, backup control plane, and unsupported metadata features stay hidden and inactive. |

Selecting a profile is exclusive. Setup clears the other profile's credentials,
and runtime guards prevent a dormant adapter from making background requests.
Existing installations without a profile are migrated from their existing
configuration once, preserving their current backend.

## Adding another backend

Add a `BackendKind`, its first-run setup panel, and domain adapters for every
feature it supports. Do not add conditional calls to `getSupabaseClient()`.
The adapter must instead provide the appropriate behavior for authentication,
vault enumeration, file metadata, revision storage, permissions, and optional
integrations. Unsupported capabilities must be absent from the navigation and
must not start background work.

This is deliberate: choosing MariaDB is not a partial Supabase configuration;
it is a different runtime adapter.

For the MDB Google Drive vault model, setup and current test status, see the
[English guide](./mdb-google-drive.md) or the [German guide](./mdb-google-drive.de.md).
