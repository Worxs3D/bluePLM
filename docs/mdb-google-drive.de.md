# Google-Drive-Shared-Drive-Vaults (BluePLM MDB)

> **Status: noch nicht produktiv getestet.** Der Google-Drive-Vault-Adapter
> besitzt automatisierte Typ- und Transferpfad-Tests, wurde aber noch nicht in
> einer echten Produktivorganisation validiert. Vor produktiven CAD-Daten immer
> zuerst eine getrennte Datenbank und einen Test-Shared-Drive verwenden.

BluePLM MDB kann die physischen, unveränderlichen Revisionsdateien entweder in
einem Windows-Netzwerk-Vault oder in einem Google-Workspace-Shared-Drive-Ordner
ablegen. Das MariaDB/PHP-Backend bleibt dabei immer zuständig für Metadaten,
Berechtigungen, Versionshistorie und den Verweis auf die physische Revision.

## macOS-Client

Ein Mac-Client kann sich mit einem vorhandenen BluePLM-MDB-Server per HTTPS
verbinden und einen Google-Drive-Shared-Drive-Vault verwenden. Das Desktop-
Paket enthält außerdem die geführte PHP/MariaDB-Bereitstellung; für den
optionalen FTP-/FTPS-Upload verwendet macOS sein systemeigenes `curl`.

Der Google-Drive-Vault-Workflow ist **noch nicht produktiv getestet**. Vor
produktiven CAD-Daten immer eine getrennte Datenbank und einen Test-Shared-Drive
verwenden. Netzwerk-/NAS-Zugangsdaten, SolidWorks, Document Manager und
eDrawings bleiben Windows-spezifisch.

## Empfohlenes Modell

Die Organisation erstellt einen eigenen Shared Drive und nimmt dort alle
berechtigten BluePLM-Anwender über die normale Google-Workspace-Mitgliedschaft
auf. Jeder Desktop-Client meldet sich mit seinem eigenen Google-Konto an.
BluePLM verteilt weder ein zentrales Google-Passwort noch ein Refresh-Token.

Pro Vault wird genau ein Speicheranbieter verwendet. So bleibt eine
Versionshistorie in genau einem kanonischen physischen Speicher. Später können
weitere Vaults angelegt werden – auch gemischt als Netzwerk- und Google-Drive-
Vaults.

## MDB-Ersteinrichtung

1. Im Desktop-Installer **MariaDB (MDB)** auswählen.
2. Das PHP-Paket bereitstellen, das Document Root der Domain auf `public/`
   setzen und die Server-Ersteinrichtung öffnen.
3. Dort für das primäre Vault **Google Drive Shared Drive folder** wählen,
   Vault-Namen und Zielordner-ID eintragen.
4. Eigentümerkonto fertigstellen. Der einmalige Bootstrap-Token wird entfernt
   und der Einrichtungsendpunkt dauerhaft gesperrt.
5. Auf jedem Client die Google-Drive-Integration öffnen und das jeweilige
   Google-Konto autorisieren. Dieses Konto muss Mitglied des Shared Drives sein
   und Dateien im Zielordner anlegen dürfen.

Die Ordner-ID ist die Kennung in der Google-Drive-Ordner-URL, nicht der sichtbare
Ordnername. Der Ordner gehört in den Shared Drive der Organisation, nicht in den
persönlichen Drive eines Mitarbeiters.

## Gespeicherte Daten

Bei jedem ersten Check-in und jedem geänderten Check-in erzeugt BluePLM eine
unveränderliche Drive-Datei. In der Datenbank steht ein Zeiger der Form
`gdrive:<file-id>`. Download und Rollback lösen genau diese Datei-ID auf; die
historischen Stände hängen somit nicht von einer manuell gepflegten
Ordnerstruktur ab.

Große CAD-Uploads und -Downloads werden im Electron-Hauptprozess in 8-MiB-
Blöcken übertragen. Sie gehen weder durch die PHP-API noch als vollständige
Datei in den Chromium-Arbeitsspeicher. Die Google-Drive-API unterstützt dafür
resumable Uploads; Downloads verwenden den Datei-Medienendpunkt.

Auch benutzerdefinierte Artikelbilder werden unterstützt; für die Anzeige gilt
eine getrennte Obergrenze von 3 MiB.

## Sicherheit und Betrieb

- Die Mitgliedschaft im Shared Drive ist die Berechtigungsgrenze für die
  physischen Dateien.
- Die BluePLM-MDB-Rollen bleiben die Berechtigungsgrenze der Anwendung. Beim
  Offboarding sowohl Drive-Mitgliedschaft als auch BluePLM-Zugang entfernen.
- Revisionsdateien nicht über die Google-Drive-Weboberfläche löschen, umbenennen
  oder verschieben. Sie sind per Datei-ID adressiert; ein Löschen macht die
  betreffende Revision nicht wiederherstellbar.
- Keinen Google-Drive-Desktop-Synchronisationsordner als zweiten Schreiber
  verwenden. Revisionsschreibzugriffe ausschließlich BluePLM überlassen.
- Nach Ablauf einer OAuth-Sitzung muss der Client Google Drive erneut verbinden.

## Vergleich zum Netzwerk-Vault

Das Netzwerk-Vault ist weiterhin die Standard- und produktiv erprobte Option
für BluePLM MDB. Es verwendet einen UNC-Pfad; SMB-Zugangsdaten können je
Windows-Benutzer im Windows-Anmeldeinformationsmanager hinterlegt werden.
Google Drive ist sinnvoll, wenn die Clients keinen stabilen gemeinsamen
LAN-/NAS-Pfad erreichen, sollte aber zuerst durch einen eigenen Testplan
abgenommen werden.

Details zur Google-API: [resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
und [Dateidownloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads).
