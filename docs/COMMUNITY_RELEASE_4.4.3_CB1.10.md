# BluePLM Community Build 4.4.3-CB1.10

Lokaler Windows-Release des Community-Clients auf Basis von BluePLM 4.4.3.
Dieser Build folgt auf CB1.9 und ergänzt die eingebettete eDrawings-Vorschau
für SolidWorks-Parts und -Baugruppen.

## Enthalten

- Direkter eDrawings-2026-ActiveX-Host in einem eigenen STA-Prozess.
- Borderloses, dem BluePLM-Hauptfenster gehörendes Overlay statt eines Chromium-
  Child-Fensters. Dadurch bleibt der eDrawings-GPU-Renderer sichtbar.
- Eingebettete Vorschau für `.sldprt`, `.sldasm`, `.slddrw`, `.step` und `.stp`,
  wenn in den SolidWorks-Einstellungen **Embedded eDrawings** gewählt ist.
- Der bestehende Thumbnail-Modus bleibt unverändert verfügbar.

## Verifikation

- eDrawings meldete für eine reale `.sldasm` erfolgreich
  `OnFinishedLoadingDocument`.
- Der automatisierte sichtbare Viewport-Test war grün: Modellbild statt
  einfarbig dunkler Fläche.
- Die Sichtprüfung im Electron-Test bestätigte die tatsächliche Vorschau.
- Renderer- und Electron-TypeScript-Prüfung sowie die nativen Windows-Builds
  waren erfolgreich.

## Technische Entscheidung

`SetParent` als Chromium-Child führt bei eDrawings 2026 trotz erfolgreichem
Dokumentimport zu einer dunklen, nicht gerenderten Fläche. Das Overlay bleibt
stattdessen ein eigenes, dem BluePLM-Fenster gehörendes Top-Level-Fenster und
wird über dessen Preview-Bereich positioniert. Diese Entscheidung wurde gegen
eine reale Baugruppe getestet; sie ist kein bloßes UI-Fallback.

## Nicht enthalten

Diese Notiz enthält keine Zugangsdaten. Der Community-Modus bleibt der
Supabase-freie PHP/MariaDB-Weg; der historische self-hosted-Supabase-Weg A
bleibt als getrennte Option dokumentiert.
