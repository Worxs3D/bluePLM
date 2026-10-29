# Drawing Reviews

A review asks one or more people to approve a package of drawings at exact versions. Reviewers
see the stored PDF of the pinned version, never someone's local copy.

## Requesting a review

1. Right-click a file, a selection, or a version in version history and choose **Request review**
   (or **Add to review package** to collect files first).
2. The package builder opens in the right panel. Each file is pinned to its latest checked-in
   version and shows how many files it depends on and whether its PDF exists.
3. Click **Generate PDFs** on a machine with SOLIDWORKS if a drawing has no PDF yet. Anyone with
   SOLIDWORKS can also generate it later; each version's PDF is made once and shared.
4. Pick reviewers (people or teams), the rule (**all must sign** or **first one decides**), a
   priority, a due date, a title and a message, then send.

## Reviewing

Open **Reviews** from the activity bar. **Awaiting me** lists what you still owe, overdue first,
then by priority, due date and age; **Requested by me**, **My teams** and **Done** follow.

For each file, decide **Approve**, **Approve with comments**, **Request changes** or **Reject**.
A comment is required for everything except Approve. Draw markups on the PDF; they are saved
with the review, the round and the file.

| Key | Action |
|-----|--------|
| A | Approve |
| Shift+A | Approve with comments |
| C | Request changes |
| R | Reject |
| J / K | Next / previous file |

**Download for SOLIDWORKS** saves the review's drawings with every part and assembly they
reference, at the versions the drawing used, in a folder that mirrors the vault. Files in the
package point at each other, so SOLIDWORKS opens the packaged parts, not your vault copies.
`manifest.json` and `manifest.csv` list the versions and anything that could not be packaged.

## Rounds

When changes are requested, the requester resubmits only the files that need them, at newer
versions. Approved files carry forward. Earlier rounds stay readable, and their markups are drawn
on the version they were made on.

## When a reviewer can no longer answer

A reviewer who leaves the organization, or loses access to the vault of a file they still owe, is
withdrawn from the round. The round settles without them and the requester is told. When nobody
is left to decide, cancel the review and request it again. Permanently deleting a file in a review
re-settles it, and cancels it when no file is left.
