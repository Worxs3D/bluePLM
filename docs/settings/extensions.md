# Extensions

Settings → Extensions. Some BluePLM features are extensions: your organization installs the ones it uses. The
page has two parts.

## BluePLM extensions

Reviews, Inspection and Orders are built into BluePLM. Each is installed for every organization until an admin
uninstalls it, so nothing changes on an upgrade. Each row says what the extension adds, what it needs and what it
works with. The three are independent: none needs another.

Only an admin can install or uninstall one, and the change applies to everyone in the organization, on the desktop
app and on BluePLM Web. Before it happens, BluePLM says what will appear or disappear.

Uninstalling never deletes anything. The data stays in your database and in your backups, and installing the
extension again brings it all back. While an extension is uninstalled, the server refuses changes to its data, so an
older app or a script cannot add to it either.

| Extension | Without it |
| --- | --- |
| Reviews | No review packages: no Reviews submenu, no review pane, nothing added to a review from version history or a review stage. Drawings release without an approved review, and review stages in file workflows act as plain states. The Reviews view stays, with workflow approvals only. |
| Inspection | No Inspection tab on drawings, no inspection reports under drawings or in the Outputs column, no Settings → Inspection templates. Reports of a drawing that is checked out stay on the old version until Inspection is installed again. |
| Orders | No Orders view, no Orders submenu, no "Add to order" in version history. |

## Organization extensions

Packages (`.bpx`) an admin installs for the organization, such as a private extension made for your company. They
run with full access on every computer and on the API server, so install only packages you trust. This part needs
the desktop app.
