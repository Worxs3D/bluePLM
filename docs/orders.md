# Orders

An order is what you send a supplier: a list of files, each pinned to a checked-in version, with a quantity and
the outputs that go with it (the drawing PDF, a STEP, and so on). It replaces the old habit of generating PDFs
and STEPs, copying them into a release folder, zipping it and emailing it.

Because each line pins a version, the parent file can move on while the order still points at exactly what was
quoted or bought. Once an order is marked sent, its lines freeze and BluePLM records the exact output files that
went out.

Orders is in the sidebar under Supply Chain, right after the Item Browser. It works on the desktop and on
BluePLM Web. Generating outputs and saving files into a folder need the desktop app.

## Making an order

There are three ways to start one.

- In the Orders list, press New order. You get an empty draft to fill in.
- In the file browser, right-click one or more files and choose Orders. Pick one of your recent drafts, or New
  order with these files.
- In a file's version history, press Order on a version row. This pins that exact version, even an older one.

When you add files from the context menu, BluePLM works out the lines for you:

- A drawing becomes a line for the model it shows, with the drawing attached. A drawing with no model becomes a
  drawing-only line.
- A part or assembly gets its drawing attached when there is one obvious drawing for it (the only one, or the
  one with the same name).
- For an assembly, Orders > With referenced parts adds the assembly and every part it uses, each as its own line,
  pinned to the versions the assembly was checked in with.

A line with a drawing sends PDF and STEP by default. A part or assembly without a drawing sends STEP. Adding a
file that is already on the order moves that line to the newer version and keeps its quantity and outputs.

A toast says what happened: how many lines were added or updated, and what was skipped and why (a file that was
never checked in, a folder, a vault you can't read).

## The order page

The top shows the order number, its status and the title, with the status buttons on the right.

Details holds the title, purpose (Quote or Purchase), supplier, due date and notes. The supplier is one of your
organization's suppliers from the Supplier Database, or Other with a typed name. Each field saves when you leave
it. The details can change until the order is closed or cancelled.

Lines lists what is on the order:

| Column | What it shows |
| --- | --- |
| Item | Part number (or file name), description and configuration |
| Rev, Version | The pinned revision and version. Update to vN appears when a newer version is checked in |
| Drawing | The drawing and its version, when the line has one |
| Qty | How many. Type a whole number |
| Outputs | One chip per output kind. Green is ready, amber is missing, a dashed chip is not included |
| Notes | A note for the supplier on that line |

While the order is a draft, click an output chip to include or leave out that kind, and use the bin button to
remove a line.

If some lines are in vaults you can't see, the page says how many. They are still part of the order for the
people who can see them. A line whose file was purged from the vault shows No longer in the vault. It keeps what
it recorded (name, part number, revision and version) and is skipped by Generate missing and Update.

## Outputs

- Generate missing (desktop) makes the outputs the lines include but do not have yet, through the same queue as
  check-in outputs. The chips update when the jobs finish.
- Export zip downloads one zip with every ready output, named by your organization's export file name pattern,
  plus `<order number>.csv` (one row per line) and `order.json` (the order, its lines and the file hashes).
- Save files to folder (desktop) writes the same files into a folder you pick.

Every downloaded file is checked against the hash the vault has for it. If one does not match, nothing is written.
Missing outputs are left out of the export and the toast says how many.

## Statuses

| Status | Meaning | Next |
| --- | --- | --- |
| Draft | Being put together. Lines and outputs can change | Mark sent, Cancel order |
| Sent | Gone to the supplier. Lines are frozen and the outputs that went out are recorded | Mark received, Reopen, Cancel order |
| Received | The parts or the quote came back | Close order, Cancel order |
| Closed | Done. Nothing changes any more | - |
| Cancelled | Called off | Restore to draft |

Mark sent checks the outputs first. If some are missing, it lists them and offers Generate missing (desktop) or
Send anyway, which records the order without them. A sent order always exports exactly what was recorded when it
was sent, even if newer outputs are generated later.

Reopen moves a sent order back to draft so the lines can change. It clears the record of what was sent, and the
order is recorded again the next time it is marked sent.

Under More (the ... button):

- Duplicate makes a new draft with the same lines and pinned versions. Lines in vaults you can't read are left out
  and the toast says how many.
- Cancel order.
- Delete order, for a draft or cancelled order, by the person who created it or an administrator.

## Numbers and access

Order numbers count up per organization, `ORD-0001`, `ORD-0002` and so on. The prefix comes from the
organization setting `orders.number_prefix`.

Orders are shared across the organization. Anyone whose team has access to the Orders module can create and edit
orders. Adding a file also needs read access to that file's vault.

## RFQs became quote orders

BluePLM used to have a separate RFQ screen with its own PDF and release ZIP. In 5.13.0 it was retired: a request
for quote is now an order with the purpose Quote, so it pins exact versions and exports the same way as any
other order. The upgrade to schema 515 turned every existing RFQ into a quote order. Its title starts with the
old RFQ number (`RFQ-0007 Brackets`), its supplier is the awarded supplier, and each item became a line pinned
to its file's newest checked-in version at the upgrade. An item with no file, or a file that was never checked
in, keeps a line with the item's details and no pinned version.

The Supplier Portal in the sidebar shows the quote orders: how many are drafts, awaiting a quote and quoted, and
the newest ones. Click one to open it in Orders.
