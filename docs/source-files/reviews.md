# Drawing Reviews

A review asks one or more people to approve a package of drawings at exact versions. Reviewers
see the stored PDF of the pinned version, never someone's local copy.

## Requesting a review

1. Right-click a file or a selection and choose **Reviews > Start a review** (or **Add to draft**
   when a draft is open). From version history, **Add to draft** adds that one version. The
   top-bar right-pane button also opens the review pane whenever the right panel has nothing else
   to show; with no draft it lists **Waiting on you** and **Your requests** and offers to start a
   review from the selected files.
2. The draft lists each file pinned to its latest checked-in version. A row only speaks up when
   something needs attention: no PDF yet, an approximate reference list, a newer local copy.
3. Click **Generate PDFs** on a machine with SOLIDWORKS if a drawing has no PDF yet. Anyone with
   SOLIDWORKS can also generate it later; each version's PDF is made once and shared.
4. Find reviewers and teams in one search (arrow keys, Enter, Backspace), pick who decides
   (**Everyone** or **First to decide**), a priority, a due date, a title and a message, then
   **Request review** (Ctrl+Enter). If the server refuses, the pane says why and offers the fix,
   such as removing a missing file or a reviewer who cannot see the vault. **Discard** in the
   pane's menu can be undone.

## Changing an open review

Right-click files and use **Reviews > Add to open review >** or **Reviews > Remove from >**; the
lists show your open reviews (an admin also sees every open review holding the files). Adding asks
first and names the versions it will add.

- **Add** pins each file's latest checked-in version and adds it to the current round, so
  reviewers who had already finished owe a decision on the new files. Files can be added only
  while the review is waiting on its reviewers; a review sent back for changes takes newer
  versions through resubmit.
- **Remove** takes the files out with their decisions and markups. A review's last file cannot be
  removed: cancel the review instead. If the files removed were the only ones not yet approved,
  the review completes.

**Reviews > Show reviews of this file** opens the Reviews view on them.

## Reviewing

Open **Reviews** from the activity bar. The queue on the left has **Waiting on me**,
**My requests**, **My teams** and **Done**, each row saying whose move it is, with its due date
and priority. Arrow keys move through it, Enter opens a review, X selects rows for bulk approve
(which asks first, says how many files you have not opened, and leaves out workflow gates with
required checklist items). With no review open, the page shows what waits on you.

A review shows who still owes a decision, a banner only when the state needs one, and its files
grouped by what they need. For each file decide **Approve**, **Approve with comments**,
**Request changes** or **Reject**; a comment is required for everything except Approve. A decision
is held for 5 seconds with **Undo** before it is sent; moving on, closing the review or signing out
sends it. When you have decided everything you owe, **Next review** takes you on.

Comment on the drawing by dragging a box with **Comment** on (M). Comments are numbered on the
drawing and in the list beside it, can be replied to, and can be resolved and reopened by their
author, the requester and reviewers of the review, and admins. The top-bar right-pane button hides
and shows the comments.

| Key | Action |
|-----|--------|
| A | Approve |
| Shift+A | Approve with comments |
| C | Request changes |
| R | Reject |
| J / K | Next / previous file |
| M | Comment on the drawing |
| N | Next review |

**Download for SOLIDWORKS** saves the review's drawings with every part and assembly they
reference, at the versions the drawing used, in a folder that mirrors the vault. Files in the
package point at each other, so SOLIDWORKS opens the packaged parts, not your vault copies.
`manifest.json` and `manifest.csv` list the versions and anything that could not be packaged.

## Rounds

When changes are requested, the requester sees what to fix: which files, the reviewers' comments
and how many are still open, with **Show in vault** and **Check out** to start. After checking in
the fixes, **Resubmit** takes the files that need them at newer versions, with a note on what
changed that reviewers see in the next round; it says when a file has no newer version yet and
checks that the new versions have PDFs. Approved files carry forward and are not decided again.
Comments from earlier rounds stay visible under the new round, drawn on the version they were made
on.

## Reviews and file workflows

A workflow state marked **Review stage** (Edit State in the workflow editor) sends its files to a
review: moving a file into it puts the file in the review being built. The stage names where an
approval takes the files (**When approved, move to**; a stage with one exit uses it).

**Settings > File Workflows** (admins) decides what an approval does:

- **Mark them approved; the requester moves them** (default), or **Move them to the next stage**
  by themselves.
- For a package that comes back partly approved: **Move the package as one** once every file is
  approved (default), or **Move approved files ahead** one by one.

The review shows where its files stand. The requester or an admin can **Move approved files** (the
rest stay in review) or, once everything is approved, **Move package**. A file does not move if it
was checked in again after it was approved, is checked out, or its next stage has a gate of its
own; the review says which files stayed and why.

Turning **Use file workflows** off hides the Workflows view and every **Change State** entry, and
the server refuses state changes. Workflows and file states are kept for when it is turned back on.

## Releasing a drawing

A state with **Releases the version** (Edit State; the default workflow's Released) releases the
file's newest checked-in version when the file enters it. A drawing needs an approved review of that
exact version first. Without one, BluePLM warns that the release process is being bypassed; you can
still **Force release** with a reason, and the release is recorded as forced in the version
history and the History view.

A released version stays released while the file moves on: you can check out and keep working, and
the new versions are work in progress. Its exports (PDF, STEP, IGES, STL, DXF) and inspection
reports are frozen: nobody can replace, overwrite or delete them, and the released version cannot
be deleted. Version history marks it **Released**, and the item browser shows the released revision
and its exports first.

## When a reviewer can no longer answer

A reviewer who leaves the organization, or loses access to the vault of a file they still owe, is
withdrawn from the round. The round settles without them and the requester is told. When nobody
is left to decide, cancel the review and request it again. Permanently deleting a file in a review
re-settles it, and cancels it when no file is left.
