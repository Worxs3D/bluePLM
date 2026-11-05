/**
 * `versionOpen.*` (5.13.0): the assembly reference freeze on the desktop. "Open with references"
 * in version history and its progress and result toasts, the "References frozen" mark of a
 * released version, the warning before releasing an assembly or drawing whose references are
 * approximate, and the refused delete of a version a release references. Spread into each locale
 * as `versionOpen`; `versionOpenKeys.test.ts` checks every key in every locale. `t()` has no
 * plural rules, so counted strings come in `One` / `Many` pairs.
 */

const en = {
  // Version history
  openWithReferences: 'Open with references',
  openWithReferencesTitle:
    'Open version {{version}} in SOLIDWORKS with the exact versions it references, from a read-only copy',
  opening: 'Opening…',

  // Progress
  progressTitle: 'Opening {{name}} version {{version}} with its references',
  progressResolving: 'Finding the referenced versions…',
  progressChecking: 'Checking the saved copy…',
  progressDownloading: 'Downloading the referenced versions…',
  progressRetargeting: 'Pointing the references at the downloaded versions…',
  progressOpening: 'Opening in SOLIDWORKS…',

  // Results
  opened: 'Opened {{name}} version {{version}} with the versions it references. The copy is read-only.',
  openedApproximate:
    'Opened {{name}} version {{version}}, but this version predates exact reference tracking: some references are today’s versions, not the ones it was checked in with.',
  missingOne: '1 reference is not in the vault and was left out.',
  missingMany: '{{count}} references are not in the vault and were left out.',
  conflictsOne: '1 file is referenced at two versions; only one could be used.',
  conflictsMany: '{{count}} files are referenced at two versions; only one of each could be used.',
  retargetFailedOne: '1 file could not be pointed at the downloaded versions and may load today’s vault files.',
  retargetFailedMany:
    '{{count}} files could not be pointed at the downloaded versions and may load today’s vault files.',
  sameNameOpen:
    'Close {{files}} in SOLIDWORKS first. SOLIDWORKS would use the open document instead of the version you asked for.',
  needsServiceOffline:
    'Start the BluePLM SOLIDWORKS service first. It points the references at the downloaded versions.',
  needsServiceOutdated:
    'Update the BluePLM SOLIDWORKS service to {{version}} or later. It points the references at the downloaded versions.',
  unsupported: 'Only parts, assemblies and drawings open with their references.',
  cancelled: 'Opening was cancelled.',
  failed: 'Could not open {{name}} version {{version}}: {{error}}',

  // Released version mark
  frozen: 'References frozen',
  frozenTitle:
    'Every reference of this released version is the exact version it was checked in with, and those versions cannot be deleted.',
  approximate: 'References approximate',
  approximateTitle:
    'This released version predates exact reference tracking, so its references follow today’s files instead of being frozen.',
  missing: 'References outside the vault',
  missingTitle:
    'This released version references files that are not in the vault, so those references are not frozen.',

  // Before a release
  releaseTitle: 'Release without frozen references?',
  releaseBodyOne:
    'Version {{version}} of {{name}} predates exact reference tracking. Releasing it will not freeze the versions it references: opening it later follows today’s references.',
  releaseBodyMany:
    '{{count}} of the files being released have versions that predate exact reference tracking. Releasing them will not freeze the versions they reference.',
  releaseHint: 'A version checked in from now on records its exact references and freezes them when released.',
  releaseConfirm: 'Release anyway',
  releaseCancel: 'Cancel',

  // Deleting
  deleteReferencedByRelease:
    '{{name}} was not deleted: a released assembly or drawing still references one of its versions.',
}

export type VersionOpenKey = keyof typeof en
type Dict = Record<VersionOpenKey, string>

const de: Dict = {
  openWithReferences: 'Mit Referenzen öffnen',
  openWithReferencesTitle:
    'Version {{version}} in SOLIDWORKS mit genau den referenzierten Versionen öffnen, aus einer schreibgeschützten Kopie',
  opening: 'Wird geöffnet…',
  progressTitle: '{{name}} Version {{version}} wird mit ihren Referenzen geöffnet',
  progressResolving: 'Referenzierte Versionen werden ermittelt…',
  progressChecking: 'Gespeicherte Kopie wird geprüft…',
  progressDownloading: 'Referenzierte Versionen werden heruntergeladen…',
  progressRetargeting: 'Referenzen werden auf die heruntergeladenen Versionen umgestellt…',
  progressOpening: 'Wird in SOLIDWORKS geöffnet…',
  opened: '{{name}} Version {{version}} wurde mit den referenzierten Versionen geöffnet. Die Kopie ist schreibgeschützt.',
  openedApproximate:
    '{{name}} Version {{version}} wurde geöffnet, aber diese Version stammt aus der Zeit vor der exakten Referenzerfassung: Einige Referenzen sind die heutigen Versionen, nicht die beim Einchecken.',
  missingOne: '1 Referenz liegt nicht im Tresor und wurde ausgelassen.',
  missingMany: '{{count}} Referenzen liegen nicht im Tresor und wurden ausgelassen.',
  conflictsOne: '1 Datei wird in zwei Versionen referenziert; nur eine konnte verwendet werden.',
  conflictsMany: '{{count}} Dateien werden in zwei Versionen referenziert; jeweils nur eine konnte verwendet werden.',
  retargetFailedOne:
    '1 Datei konnte nicht auf die heruntergeladenen Versionen umgestellt werden und lädt eventuell die heutigen Tresordateien.',
  retargetFailedMany:
    '{{count}} Dateien konnten nicht auf die heruntergeladenen Versionen umgestellt werden und laden eventuell die heutigen Tresordateien.',
  sameNameOpen:
    'Schließen Sie zuerst {{files}} in SOLIDWORKS. SOLIDWORKS würde das geöffnete Dokument statt der gewünschten Version verwenden.',
  needsServiceOffline:
    'Starten Sie zuerst den BluePLM-SOLIDWORKS-Dienst. Er stellt die Referenzen auf die heruntergeladenen Versionen um.',
  needsServiceOutdated:
    'Aktualisieren Sie den BluePLM-SOLIDWORKS-Dienst auf {{version}} oder neuer. Er stellt die Referenzen auf die heruntergeladenen Versionen um.',
  unsupported: 'Nur Teile, Baugruppen und Zeichnungen lassen sich mit ihren Referenzen öffnen.',
  cancelled: 'Das Öffnen wurde abgebrochen.',
  failed: '{{name}} Version {{version}} konnte nicht geöffnet werden: {{error}}',
  frozen: 'Referenzen eingefroren',
  frozenTitle:
    'Jede Referenz dieser freigegebenen Version ist genau die Version beim Einchecken, und diese Versionen können nicht gelöscht werden.',
  approximate: 'Referenzen ungefähr',
  approximateTitle:
    'Diese freigegebene Version stammt aus der Zeit vor der exakten Referenzerfassung; ihre Referenzen folgen den heutigen Dateien statt eingefroren zu sein.',
  missing: 'Referenzen außerhalb des Tresors',
  missingTitle:
    'Diese freigegebene Version referenziert Dateien, die nicht im Tresor liegen; diese Referenzen sind nicht eingefroren.',
  releaseTitle: 'Ohne eingefrorene Referenzen freigeben?',
  releaseBodyOne:
    'Version {{version}} von {{name}} stammt aus der Zeit vor der exakten Referenzerfassung. Die Freigabe friert die referenzierten Versionen nicht ein: Später öffnet sie die heutigen Referenzen.',
  releaseBodyMany:
    '{{count}} der freizugebenden Dateien haben Versionen aus der Zeit vor der exakten Referenzerfassung. Die Freigabe friert die referenzierten Versionen nicht ein.',
  releaseHint:
    'Eine ab jetzt eingecheckte Version erfasst ihre exakten Referenzen und friert sie bei der Freigabe ein.',
  releaseConfirm: 'Trotzdem freigeben',
  releaseCancel: 'Abbrechen',
  deleteReferencedByRelease:
    '{{name}} wurde nicht gelöscht: Eine freigegebene Baugruppe oder Zeichnung referenziert noch eine ihrer Versionen.',
}

const es: Dict = {
  openWithReferences: 'Abrir con referencias',
  openWithReferencesTitle:
    'Abrir la versión {{version}} en SOLIDWORKS con las versiones exactas que referencia, desde una copia de solo lectura',
  opening: 'Abriendo…',
  progressTitle: 'Abriendo {{name}} versión {{version}} con sus referencias',
  progressResolving: 'Buscando las versiones referenciadas…',
  progressChecking: 'Comprobando la copia guardada…',
  progressDownloading: 'Descargando las versiones referenciadas…',
  progressRetargeting: 'Apuntando las referencias a las versiones descargadas…',
  progressOpening: 'Abriendo en SOLIDWORKS…',
  opened: 'Se abrió {{name}} versión {{version}} con las versiones que referencia. La copia es de solo lectura.',
  openedApproximate:
    'Se abrió {{name}} versión {{version}}, pero esta versión es anterior al seguimiento exacto de referencias: algunas referencias son las versiones de hoy, no las de su registro.',
  missingOne: '1 referencia no está en el almacén y se omitió.',
  missingMany: '{{count}} referencias no están en el almacén y se omitieron.',
  conflictsOne: '1 archivo se referencia en dos versiones; solo se pudo usar una.',
  conflictsMany: '{{count}} archivos se referencian en dos versiones; solo se pudo usar una de cada uno.',
  retargetFailedOne:
    '1 archivo no se pudo apuntar a las versiones descargadas y puede cargar los archivos actuales del almacén.',
  retargetFailedMany:
    '{{count}} archivos no se pudieron apuntar a las versiones descargadas y pueden cargar los archivos actuales del almacén.',
  sameNameOpen:
    'Cierre primero {{files}} en SOLIDWORKS. SOLIDWORKS usaría el documento abierto en lugar de la versión solicitada.',
  needsServiceOffline:
    'Inicie primero el servicio BluePLM de SOLIDWORKS. Apunta las referencias a las versiones descargadas.',
  needsServiceOutdated:
    'Actualice el servicio BluePLM de SOLIDWORKS a {{version}} o posterior. Apunta las referencias a las versiones descargadas.',
  unsupported: 'Solo las piezas, ensamblajes y dibujos se abren con sus referencias.',
  cancelled: 'Se canceló la apertura.',
  failed: 'No se pudo abrir {{name}} versión {{version}}: {{error}}',
  frozen: 'Referencias congeladas',
  frozenTitle:
    'Cada referencia de esta versión liberada es la versión exacta de su registro, y esas versiones no se pueden eliminar.',
  approximate: 'Referencias aproximadas',
  approximateTitle:
    'Esta versión liberada es anterior al seguimiento exacto de referencias, así que sus referencias siguen los archivos de hoy en lugar de estar congeladas.',
  missing: 'Referencias fuera del almacén',
  missingTitle:
    'Esta versión liberada referencia archivos que no están en el almacén, así que esas referencias no están congeladas.',
  releaseTitle: '¿Liberar sin referencias congeladas?',
  releaseBodyOne:
    'La versión {{version}} de {{name}} es anterior al seguimiento exacto de referencias. Liberarla no congelará las versiones que referencia: al abrirla más tarde seguirá las referencias de hoy.',
  releaseBodyMany:
    '{{count}} de los archivos que se liberan tienen versiones anteriores al seguimiento exacto de referencias. Liberarlos no congelará las versiones que referencian.',
  releaseHint: 'Una versión registrada a partir de ahora guarda sus referencias exactas y las congela al liberarse.',
  releaseConfirm: 'Liberar de todos modos',
  releaseCancel: 'Cancelar',
  deleteReferencedByRelease:
    '{{name}} no se eliminó: un ensamblaje o dibujo liberado todavía referencia una de sus versiones.',
}

const fr: Dict = {
  openWithReferences: 'Ouvrir avec les références',
  openWithReferencesTitle:
    'Ouvrir la version {{version}} dans SOLIDWORKS avec les versions exactes qu’elle référence, depuis une copie en lecture seule',
  opening: 'Ouverture…',
  progressTitle: 'Ouverture de {{name}} version {{version}} avec ses références',
  progressResolving: 'Recherche des versions référencées…',
  progressChecking: 'Vérification de la copie enregistrée…',
  progressDownloading: 'Téléchargement des versions référencées…',
  progressRetargeting: 'Redirection des références vers les versions téléchargées…',
  progressOpening: 'Ouverture dans SOLIDWORKS…',
  opened: '{{name}} version {{version}} est ouvert avec les versions qu’il référence. La copie est en lecture seule.',
  openedApproximate:
    '{{name}} version {{version}} est ouvert, mais cette version précède le suivi exact des références : certaines références sont les versions actuelles, pas celles de son archivage.',
  missingOne: '1 référence n’est pas dans le coffre et a été laissée de côté.',
  missingMany: '{{count}} références ne sont pas dans le coffre et ont été laissées de côté.',
  conflictsOne: '1 fichier est référencé dans deux versions ; une seule a pu être utilisée.',
  conflictsMany: '{{count}} fichiers sont référencés dans deux versions ; une seule de chacun a pu être utilisée.',
  retargetFailedOne:
    '1 fichier n’a pas pu être redirigé vers les versions téléchargées et peut charger les fichiers actuels du coffre.',
  retargetFailedMany:
    '{{count}} fichiers n’ont pas pu être redirigés vers les versions téléchargées et peuvent charger les fichiers actuels du coffre.',
  sameNameOpen:
    'Fermez d’abord {{files}} dans SOLIDWORKS. SOLIDWORKS utiliserait le document ouvert au lieu de la version demandée.',
  needsServiceOffline:
    'Démarrez d’abord le service SOLIDWORKS de BluePLM. Il redirige les références vers les versions téléchargées.',
  needsServiceOutdated:
    'Mettez à jour le service SOLIDWORKS de BluePLM vers {{version}} ou plus récent. Il redirige les références vers les versions téléchargées.',
  unsupported: 'Seuls les pièces, assemblages et mises en plan s’ouvrent avec leurs références.',
  cancelled: 'L’ouverture a été annulée.',
  failed: 'Impossible d’ouvrir {{name}} version {{version}} : {{error}}',
  frozen: 'Références figées',
  frozenTitle:
    'Chaque référence de cette version publiée est la version exacte de son archivage, et ces versions ne peuvent pas être supprimées.',
  approximate: 'Références approximatives',
  approximateTitle:
    'Cette version publiée précède le suivi exact des références ; ses références suivent les fichiers actuels au lieu d’être figées.',
  missing: 'Références hors du coffre',
  missingTitle:
    'Cette version publiée référence des fichiers qui ne sont pas dans le coffre ; ces références ne sont pas figées.',
  releaseTitle: 'Publier sans références figées ?',
  releaseBodyOne:
    'La version {{version}} de {{name}} précède le suivi exact des références. La publier ne figera pas les versions qu’elle référence : l’ouvrir plus tard suivra les références actuelles.',
  releaseBodyMany:
    '{{count}} des fichiers publiés ont des versions antérieures au suivi exact des références. Les publier ne figera pas les versions qu’ils référencent.',
  releaseHint:
    'Une version archivée à partir de maintenant enregistre ses références exactes et les fige à la publication.',
  releaseConfirm: 'Publier quand même',
  releaseCancel: 'Annuler',
  deleteReferencedByRelease:
    '{{name}} n’a pas été supprimé : un assemblage ou une mise en plan publié référence encore une de ses versions.',
}

const pt: Dict = {
  openWithReferences: 'Abrir com referências',
  openWithReferencesTitle:
    'Abrir a versão {{version}} no SOLIDWORKS com as versões exatas que referencia, a partir de uma cópia somente leitura',
  opening: 'Abrindo…',
  progressTitle: 'Abrindo {{name}} versão {{version}} com suas referências',
  progressResolving: 'Encontrando as versões referenciadas…',
  progressChecking: 'Verificando a cópia salva…',
  progressDownloading: 'Baixando as versões referenciadas…',
  progressRetargeting: 'Apontando as referências para as versões baixadas…',
  progressOpening: 'Abrindo no SOLIDWORKS…',
  opened: '{{name}} versão {{version}} foi aberto com as versões que referencia. A cópia é somente leitura.',
  openedApproximate:
    '{{name}} versão {{version}} foi aberto, mas esta versão é anterior ao rastreamento exato de referências: algumas referências são as versões de hoje, não as do check-in.',
  missingOne: '1 referência não está no cofre e foi deixada de fora.',
  missingMany: '{{count}} referências não estão no cofre e foram deixadas de fora.',
  conflictsOne: '1 arquivo é referenciado em duas versões; só uma pôde ser usada.',
  conflictsMany: '{{count}} arquivos são referenciados em duas versões; só uma de cada pôde ser usada.',
  retargetFailedOne:
    '1 arquivo não pôde ser apontado para as versões baixadas e pode carregar os arquivos atuais do cofre.',
  retargetFailedMany:
    '{{count}} arquivos não puderam ser apontados para as versões baixadas e podem carregar os arquivos atuais do cofre.',
  sameNameOpen:
    'Feche primeiro {{files}} no SOLIDWORKS. O SOLIDWORKS usaria o documento aberto em vez da versão pedida.',
  needsServiceOffline:
    'Inicie primeiro o serviço SOLIDWORKS do BluePLM. Ele aponta as referências para as versões baixadas.',
  needsServiceOutdated:
    'Atualize o serviço SOLIDWORKS do BluePLM para {{version}} ou posterior. Ele aponta as referências para as versões baixadas.',
  unsupported: 'Só peças, montagens e desenhos abrem com suas referências.',
  cancelled: 'A abertura foi cancelada.',
  failed: 'Não foi possível abrir {{name}} versão {{version}}: {{error}}',
  frozen: 'Referências congeladas',
  frozenTitle:
    'Cada referência desta versão liberada é a versão exata do check-in, e essas versões não podem ser excluídas.',
  approximate: 'Referências aproximadas',
  approximateTitle:
    'Esta versão liberada é anterior ao rastreamento exato de referências; suas referências seguem os arquivos de hoje em vez de estarem congeladas.',
  missing: 'Referências fora do cofre',
  missingTitle:
    'Esta versão liberada referencia arquivos que não estão no cofre; essas referências não estão congeladas.',
  releaseTitle: 'Liberar sem referências congeladas?',
  releaseBodyOne:
    'A versão {{version}} de {{name}} é anterior ao rastreamento exato de referências. Liberá-la não congelará as versões que referencia: abri-la depois segue as referências de hoje.',
  releaseBodyMany:
    '{{count}} dos arquivos sendo liberados têm versões anteriores ao rastreamento exato de referências. Liberá-los não congelará as versões que referenciam.',
  releaseHint: 'Uma versão com check-in a partir de agora registra suas referências exatas e as congela ao ser liberada.',
  releaseConfirm: 'Liberar mesmo assim',
  releaseCancel: 'Cancelar',
  deleteReferencedByRelease:
    '{{name}} não foi excluído: uma montagem ou desenho liberado ainda referencia uma de suas versões.',
}

const zhCN: Dict = {
  openWithReferences: '连同引用打开',
  openWithReferencesTitle: '在 SOLIDWORKS 中打开版本 {{version}} 及其引用的确切版本（只读副本）',
  opening: '正在打开…',
  progressTitle: '正在打开 {{name}} 版本 {{version}} 及其引用',
  progressResolving: '正在查找引用的版本…',
  progressChecking: '正在检查已保存的副本…',
  progressDownloading: '正在下载引用的版本…',
  progressRetargeting: '正在将引用指向已下载的版本…',
  progressOpening: '正在 SOLIDWORKS 中打开…',
  opened: '已打开 {{name}} 版本 {{version}} 及其引用的版本。该副本为只读。',
  openedApproximate:
    '已打开 {{name}} 版本 {{version}}，但此版本早于精确引用跟踪：部分引用是当前版本，而不是签入时的版本。',
  missingOne: '1 个引用不在库中，已略过。',
  missingMany: '{{count}} 个引用不在库中，已略过。',
  conflictsOne: '1 个文件被引用了两个版本；只能使用其中一个。',
  conflictsMany: '{{count}} 个文件被引用了两个版本；每个只能使用其中一个。',
  retargetFailedOne: '1 个文件无法指向已下载的版本，可能会加载库中的当前文件。',
  retargetFailedMany: '{{count}} 个文件无法指向已下载的版本，可能会加载库中的当前文件。',
  sameNameOpen: '请先在 SOLIDWORKS 中关闭 {{files}}。否则 SOLIDWORKS 会使用已打开的文档，而不是所请求的版本。',
  needsServiceOffline: '请先启动 BluePLM SOLIDWORKS 服务。它会将引用指向已下载的版本。',
  needsServiceOutdated: '请将 BluePLM SOLIDWORKS 服务更新到 {{version}} 或更高版本。它会将引用指向已下载的版本。',
  unsupported: '只有零件、装配体和工程图可以连同引用打开。',
  cancelled: '已取消打开。',
  failed: '无法打开 {{name}} 版本 {{version}}：{{error}}',
  frozen: '引用已冻结',
  frozenTitle: '此已发布版本的每个引用都是签入时的确切版本，且这些版本无法删除。',
  approximate: '引用为近似',
  approximateTitle: '此已发布版本早于精确引用跟踪，因此其引用跟随当前文件，而没有被冻结。',
  missing: '引用在库外',
  missingTitle: '此已发布版本引用了不在库中的文件，这些引用没有被冻结。',
  releaseTitle: '在引用未冻结的情况下发布？',
  releaseBodyOne:
    '{{name}} 的版本 {{version}} 早于精确引用跟踪。发布它不会冻结其引用的版本：以后打开时会跟随当前的引用。',
  releaseBodyMany: '要发布的文件中有 {{count}} 个的版本早于精确引用跟踪。发布它们不会冻结其引用的版本。',
  releaseHint: '从现在起签入的版本会记录其确切引用，并在发布时将其冻结。',
  releaseConfirm: '仍然发布',
  releaseCancel: '取消',
  deleteReferencedByRelease: '未删除 {{name}}：仍有已发布的装配体或工程图引用其某个版本。',
}

const zhTW: Dict = {
  openWithReferences: '連同參考開啟',
  openWithReferencesTitle: '在 SOLIDWORKS 中開啟版本 {{version}} 及其參考的確切版本（唯讀副本）',
  opening: '正在開啟…',
  progressTitle: '正在開啟 {{name}} 版本 {{version}} 及其參考',
  progressResolving: '正在尋找參考的版本…',
  progressChecking: '正在檢查已儲存的副本…',
  progressDownloading: '正在下載參考的版本…',
  progressRetargeting: '正在將參考指向已下載的版本…',
  progressOpening: '正在 SOLIDWORKS 中開啟…',
  opened: '已開啟 {{name}} 版本 {{version}} 及其參考的版本。此副本為唯讀。',
  openedApproximate:
    '已開啟 {{name}} 版本 {{version}}，但此版本早於精確參考追蹤：部分參考是目前的版本，而不是簽入時的版本。',
  missingOne: '1 個參考不在庫中，已略過。',
  missingMany: '{{count}} 個參考不在庫中，已略過。',
  conflictsOne: '1 個檔案被參考了兩個版本；只能使用其中一個。',
  conflictsMany: '{{count}} 個檔案被參考了兩個版本；每個只能使用其中一個。',
  retargetFailedOne: '1 個檔案無法指向已下載的版本，可能會載入庫中的目前檔案。',
  retargetFailedMany: '{{count}} 個檔案無法指向已下載的版本，可能會載入庫中的目前檔案。',
  sameNameOpen: '請先在 SOLIDWORKS 中關閉 {{files}}。否則 SOLIDWORKS 會使用已開啟的文件，而不是所要求的版本。',
  needsServiceOffline: '請先啟動 BluePLM SOLIDWORKS 服務。它會將參考指向已下載的版本。',
  needsServiceOutdated: '請將 BluePLM SOLIDWORKS 服務更新到 {{version}} 或更新版本。它會將參考指向已下載的版本。',
  unsupported: '只有零件、組合件和工程圖可以連同參考開啟。',
  cancelled: '已取消開啟。',
  failed: '無法開啟 {{name}} 版本 {{version}}：{{error}}',
  frozen: '參考已凍結',
  frozenTitle: '此已發行版本的每個參考都是簽入時的確切版本，且這些版本無法刪除。',
  approximate: '參考為近似',
  approximateTitle: '此已發行版本早於精確參考追蹤，因此其參考跟隨目前的檔案，而沒有被凍結。',
  missing: '參考在庫外',
  missingTitle: '此已發行版本參考了不在庫中的檔案，這些參考沒有被凍結。',
  releaseTitle: '在參考未凍結的情況下發行？',
  releaseBodyOne:
    '{{name}} 的版本 {{version}} 早於精確參考追蹤。發行它不會凍結其參考的版本：日後開啟時會跟隨目前的參考。',
  releaseBodyMany: '要發行的檔案中有 {{count}} 個的版本早於精確參考追蹤。發行它們不會凍結其參考的版本。',
  releaseHint: '從現在起簽入的版本會記錄其確切參考，並在發行時將其凍結。',
  releaseConfirm: '仍然發行',
  releaseCancel: '取消',
  deleteReferencedByRelease: '未刪除 {{name}}：仍有已發行的組合件或工程圖參考其某個版本。',
}

export const versionOpenStrings: Record<'en' | 'de' | 'es' | 'fr' | 'pt' | 'zhCN' | 'zhTW', Dict> = {
  en,
  de,
  es,
  fr,
  pt,
  zhCN,
  zhTW,
}
