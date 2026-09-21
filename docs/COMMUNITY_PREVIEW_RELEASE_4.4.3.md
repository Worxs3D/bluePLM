# BluePLM Community Preview 4.4.3

Erstes lokal erzeugtes Windows-Releaseartefakt für den MariaDB-Community-Weg.

## Artefakt

- `release/BluePLM-4.4.3-win.exe`
- SHA-256: `071f1bb2a5aee1b0e82c32d100f82ce2b63c7c2664cbcc02ae868d7b15d7c24c`
- Electron-Updater-Metadaten: `release/latest.yml`

## Verifiziert

- Electron-Renderer: 2.130 Tests in 136 Testdateien erfolgreich
- Electron TypeScript-Prüfung erfolgreich
- Community-Node-Backend: Tests und Produktionsbuild erfolgreich
- PHP-Adapter: Syntaxprüfung erfolgreich
- MariaDB-Integrationstest deckt Vault, Revisionen, Workflows, Lieferanten,
  Abweichungen, Berechtigungen und Kontolöschung ab.

## Betrieb

1. Die Community-API gegen MariaDB migrieren (`blueplm-community-backend` oder
   `blueplm-community-php/bin/migrate.php`).
2. In BluePLM den Community-Server konfigurieren und ein Konto per Bootstrap
   einrichten.
3. Netzwerk-Vaults ausschließlich von den Desktop-Clients einbinden; der
   Backend-Dienst speichert keine SMB-Zugangsdaten.

## Preview-Grenze

Dies ist ein lokales Preview-Artefakt, kein GitHub-Release. Einige nicht zum
Community-Kern portierte Upstream-Integrationen behalten noch Supabase-Fallbacks.
Sie dürfen im Community-Modus nicht als produktiv verifiziert gelten, bevor
ihre jeweiligen Backend-Pfade umgesetzt und getestet sind.
