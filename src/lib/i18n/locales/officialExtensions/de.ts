import type { OfficialExtensionsDict } from './index'

export const de: OfficialExtensionsDict = {
  reviewsName: 'Prüfungen',
  reviewsDescription:
    'Zeichnungen und Modelle zur Prüfung senden, je Datei entscheiden und Kommentare bis zur Entscheidung verfolgen.',
  reviewsAddsView: 'Prüfpakete in der Ansicht Prüfungen',
  reviewsAddsMenu: 'das Untermenü Prüfungen im Kontextmenü',
  reviewsAddsPane: 'den Prüfungsbereich',
  reviewsAddsStages: 'Prüfstufen in Datei-Workflows',
  reviewsEffectRelease: 'Zeichnungen werden ohne genehmigte Prüfung freigegeben.',
  reviewsEffectStages: 'Prüfstufen in Datei-Workflows verhalten sich wie normale Zustände.',
  reviewsEffectGates: 'Die Ansicht Prüfungen zeigt nur noch Workflow-Freigaben.',
  inspectionName: 'Inspektion',
  inspectionDescription:
    'Zeichnungen mit Ballons versehen, Prüftabellen je Version führen und Excel-Prüfberichte ausfüllen.',
  inspectionAddsTab: 'den Reiter Inspektion bei Zeichnungen',
  inspectionAddsReports: 'Prüfberichte unter Zeichnungen',
  inspectionAddsTemplates: 'Einstellungen > Prüfvorlagen',
  inspectionEffectWorkingCopies:
    'Berichte einer ausgecheckten Zeichnung bleiben bei der alten Version, bis Inspektion wieder installiert ist.',
  ordersName: 'Bestellungen',
  ordersDescription: 'Versionsgebundene PDF-, STEP- und andere Ausgaben zu Bestellungen für Lieferanten bündeln.',
  ordersAddsView: 'die Ansicht Bestellungen',
  ordersAddsMenu: 'das Untermenü Bestellungen im Kontextmenü',
  ordersAddsHistory: '„Zur Bestellung hinzufügen“ im Versionsverlauf',

  core_explorer: 'Datei-Explorer',
  core_versions: 'Versionen',
  core_workflows: 'Datei-Workflows',
  core_solidworks: 'SOLIDWORKS',

  sectionTitle: 'BluePLM-Erweiterungen',
  sectionIntro:
    'In BluePLM eingebaute Funktionen. Installieren oder Deinstallieren ändert sie für alle in Ihrer Organisation.',
  sectionIntroMember: 'Nur ein Administrator kann sie installieren oder deinstallieren.',
  statusInstalled: 'Installiert',
  statusNotInstalled: 'Nicht installiert',
  version: 'Version {{version}}',
  adds: 'Fügt hinzu',
  needs: 'Benötigt',
  neededBy: 'Benötigt von',
  worksWith: 'Arbeitet mit',
  none: 'Nichts',
  install: 'Installieren',
  uninstall: 'Deinstallieren',
  listSeparator: ', ',

  uninstallTitle: '{{name}} deinstallieren?',
  uninstallBody: '{{name}} verschwindet für alle in {{org}}: {{surfaces}}.',
  uninstallKeeps:
    'Es wird nichts gelöscht. Die Daten bleiben in Ihrer Datenbank und in den Sicherungen, und eine erneute Installation bringt alles zurück.',
  uninstallBlocked: '{{names}} benötigt {{name}}. Deinstallieren Sie es zuerst.',
  integrationsDark: 'Arbeitet nicht mehr mit {{names}}.',
  installTitle: '{{name}} installieren?',
  installBody: '{{name}} kommt für alle in {{org}} zurück: {{surfaces}}.',
  installAlso: 'Installiert auch {{names}}, das {{name}} benötigt.',
  integrationsLight: 'Arbeitet mit {{names}}.',
  yourOrganization: 'Ihrer Organisation',

  installed: '{{name}} ist für Ihre Organisation installiert.',
  uninstalled: '{{name}} ist deinstalliert. Sie können es hier jederzeit wieder installieren.',
  failed: '{{name}} konnte nicht geändert werden: {{message}}',
  notInstalled:
    '{{name}} ist für Ihre Organisation nicht installiert. Ein Administrator kann es unter Einstellungen > Erweiterungen installieren.',
  error_NOT_ADMIN: 'Nur ein Administrator kann Erweiterungen installieren oder deinstallieren.',
  error_UNKNOWN_EXTENSION: 'BluePLM kennt diese Erweiterung nicht. Aktualisieren Sie die App oder die Datenbank.',
  error_DEPENDENCY_INSTALLED: 'Eine andere installierte Erweiterung benötigt sie.',
  error_DEPENDENCY_MISSING: 'Eine benötigte Erweiterung ist nicht installiert.',
  error_NEEDS_UPGRADE:
    'Die Datenbank ist älter als diese App. Aktualisieren Sie sie zuerst unter Einstellungen > Verbindung.',
}
