/** One namespace: keys to strings, or one level of groups (`reason.*`). */
type NamespaceDict = Record<string, string | Record<string, string>>

/**
 * `reviewPackage.*`: the review package download and drawing PDF generation
 * (`src/lib/reviewPackage`, `src/lib/commands/handlers/reviewPackage.ts`). Kept in its own file
 * and spread into each locale as `reviewPackage`, so the locale files only gain one line each.
 * `reviewPackageKeys.test.ts` checks every key in every locale.
 */

const en: NamespaceDict = {
  selectFolderTitle: 'Choose where to save the review package',
  validationOffline: 'Review packages need a connection to the server.',
  validationNotSignedIn: 'Sign in to an organization first.',
  validationDesktopOnly: 'Review packages need the desktop app.',
  validationNoReview: 'No review was chosen.',
  validationNoDestination: 'Choose a folder for the package.',
  validationNoVersions: 'No file versions were chosen.',
  progressDownload: 'Downloading review package "{{title}}"',
  progressResolving: 'Resolving references...',
  progressRetargeting: 'Pointing the files at each other...',
  progressFinishing: 'Writing the manifest...',
  noItems: 'Nothing to download: none of the chosen items are in this review.',
  downloadDone: 'Review package saved to {{folder}}. Files: {{count}}.',
  downloadPartial:
    'Review package saved to {{folder}}, but {{failed}} of {{count}} files could not be downloaded.',
  missingReferences:
    'Not in the package (outside the vault or no version found): {{count}}. See manifest.csv.',
  versionConflicts:
    'Files needed at two different versions: {{count}}. One version was kept; see manifest.json.',
  approximate:
    'Some versions are approximate: they were checked in before version references were recorded.',
  retargetNotRun:
    'References were not pointed inside the package because the SOLIDWORKS service is not running or is older than {{version}}. SOLIDWORKS may open files from your vault instead.',
  retargetFailed: 'Files that could not be pointed inside the package: {{count}}.',
  openFresh:
    'Open the package from a fresh SOLIDWORKS session with no vault files open, so SOLIDWORKS loads the packaged versions.',
  manifestFailed: 'The manifest could not be written: {{error}}',
  cancelled: 'Download cancelled. Run it again to resume; files already downloaded are kept.',
  failed: 'Review package download failed: {{error}}',
  progressPdf: 'Generating drawing PDFs',
  pdfDone: 'Drawing PDFs generated: {{generated}}. Already stored: {{cached}}.',
  pdfNeedsSolidworks:
    'PDFs need SOLIDWORKS on this computer ({{reason}}). Anyone with SOLIDWORKS can generate them later.',
  pdfFailed: 'Drawing PDFs that failed: {{count}}. {{details}}',
  pdfNotDrawing: 'Skipped, not drawings: {{count}}.',
  pdfSameNameOpen:
    'Close these documents in SOLIDWORKS first, or SOLIDWORKS would use them instead of the reviewed versions: {{files}}',
  pdfPending: 'PDF pending',
  pdfPendingHint:
    'No PDF has been generated for this version yet. Anyone with SOLIDWORKS can generate it.',
  previewUnsupported: 'There is no preview for this file type.',
  reason: {
    service_offline: 'the SOLIDWORKS service is not running',
    service_outdated: 'the SOLIDWORKS service is older than {{version}}',
    solidworks_not_installed: 'only Document Manager is installed, not SOLIDWORKS',
  },
}

const de: NamespaceDict = {
  selectFolderTitle: 'Speicherort für das Prüfpaket wählen',
  validationOffline: 'Prüfpakete benötigen eine Verbindung zum Server.',
  validationNotSignedIn: 'Melden Sie sich zuerst bei einer Organisation an.',
  validationDesktopOnly: 'Prüfpakete benötigen die Desktop-App.',
  validationNoReview: 'Es wurde keine Prüfung ausgewählt.',
  validationNoDestination: 'Wählen Sie einen Ordner für das Paket.',
  validationNoVersions: 'Es wurden keine Dateiversionen ausgewählt.',
  progressDownload: 'Prüfpaket „{{title}}“ wird heruntergeladen',
  progressResolving: 'Referenzen werden aufgelöst...',
  progressRetargeting: 'Dateien werden aufeinander verwiesen...',
  progressFinishing: 'Manifest wird geschrieben...',
  noItems: 'Nichts herunterzuladen: Keines der gewählten Elemente gehört zu dieser Prüfung.',
  downloadDone: 'Prüfpaket gespeichert unter {{folder}}. Dateien: {{count}}.',
  downloadPartial:
    'Prüfpaket gespeichert unter {{folder}}, aber {{failed}} von {{count}} Dateien konnten nicht heruntergeladen werden.',
  missingReferences:
    'Nicht im Paket (außerhalb des Tresors oder keine Version gefunden): {{count}}. Siehe manifest.csv.',
  versionConflicts:
    'Dateien, die in zwei verschiedenen Versionen benötigt werden: {{count}}. Eine Version wurde behalten; siehe manifest.json.',
  approximate:
    'Einige Versionen sind ungefähr: Sie wurden eingecheckt, bevor Versionsreferenzen aufgezeichnet wurden.',
  retargetNotRun:
    'Die Referenzen wurden nicht auf das Paket umgestellt, weil der SOLIDWORKS-Dienst nicht läuft oder älter als {{version}} ist. SOLIDWORKS öffnet möglicherweise stattdessen Dateien aus Ihrem Tresor.',
  retargetFailed: 'Dateien, die nicht auf das Paket umgestellt werden konnten: {{count}}.',
  openFresh:
    'Öffnen Sie das Paket in einer frisch gestarteten SOLIDWORKS-Sitzung ohne geöffnete Tresordateien, damit SOLIDWORKS die Paketversionen lädt.',
  manifestFailed: 'Das Manifest konnte nicht geschrieben werden: {{error}}',
  cancelled:
    'Download abgebrochen. Erneut ausführen, um fortzusetzen; bereits heruntergeladene Dateien bleiben erhalten.',
  failed: 'Download des Prüfpakets fehlgeschlagen: {{error}}',
  progressPdf: 'Zeichnungs-PDFs werden erzeugt',
  pdfDone: 'Erzeugte Zeichnungs-PDFs: {{generated}}. Bereits gespeichert: {{cached}}.',
  pdfNeedsSolidworks:
    'PDFs benötigen SOLIDWORKS auf diesem Computer ({{reason}}). Jeder mit SOLIDWORKS kann sie später erzeugen.',
  pdfFailed: 'Fehlgeschlagene Zeichnungs-PDFs: {{count}}. {{details}}',
  pdfNotDrawing: 'Übersprungen, keine Zeichnungen: {{count}}.',
  pdfSameNameOpen:
    'Schließen Sie zuerst diese Dokumente in SOLIDWORKS, sonst verwendet SOLIDWORKS sie anstelle der geprüften Versionen: {{files}}',
  pdfPending: 'PDF ausstehend',
  pdfPendingHint:
    'Für diese Version wurde noch kein PDF erzeugt. Jeder mit SOLIDWORKS kann es erzeugen.',
  previewUnsupported: 'Für diesen Dateityp gibt es keine Vorschau.',
  reason: {
    service_offline: 'der SOLIDWORKS-Dienst läuft nicht',
    service_outdated: 'der SOLIDWORKS-Dienst ist älter als {{version}}',
    solidworks_not_installed: 'nur Document Manager ist installiert, nicht SOLIDWORKS',
  },
}

const es: NamespaceDict = {
  selectFolderTitle: 'Elija dónde guardar el paquete de revisión',
  validationOffline: 'Los paquetes de revisión necesitan conexión con el servidor.',
  validationNotSignedIn: 'Inicie sesión en una organización primero.',
  validationDesktopOnly: 'Los paquetes de revisión necesitan la aplicación de escritorio.',
  validationNoReview: 'No se eligió ninguna revisión.',
  validationNoDestination: 'Elija una carpeta para el paquete.',
  validationNoVersions: 'No se eligió ninguna versión de archivo.',
  progressDownload: 'Descargando el paquete de revisión "{{title}}"',
  progressResolving: 'Resolviendo referencias...',
  progressRetargeting: 'Haciendo que los archivos se referencien entre sí...',
  progressFinishing: 'Escribiendo el manifiesto...',
  noItems: 'Nada que descargar: ninguno de los elementos elegidos está en esta revisión.',
  downloadDone: 'Paquete de revisión guardado en {{folder}}. Archivos: {{count}}.',
  downloadPartial:
    'Paquete de revisión guardado en {{folder}}, pero no se pudieron descargar {{failed}} de {{count}} archivos.',
  missingReferences:
    'Fuera del paquete (fuera del almacén o sin versión encontrada): {{count}}. Consulte manifest.csv.',
  versionConflicts:
    'Archivos necesarios en dos versiones distintas: {{count}}. Se conservó una versión; consulte manifest.json.',
  approximate:
    'Algunas versiones son aproximadas: se registraron antes de que se guardaran las referencias por versión.',
  retargetNotRun:
    'Las referencias no se redirigieron al paquete porque el servicio de SOLIDWORKS no está en ejecución o es anterior a {{version}}. SOLIDWORKS podría abrir archivos de su almacén.',
  retargetFailed: 'Archivos que no se pudieron redirigir al paquete: {{count}}.',
  openFresh:
    'Abra el paquete en una sesión nueva de SOLIDWORKS sin archivos del almacén abiertos, para que SOLIDWORKS cargue las versiones del paquete.',
  manifestFailed: 'No se pudo escribir el manifiesto: {{error}}',
  cancelled:
    'Descarga cancelada. Ejecútela de nuevo para reanudar; los archivos ya descargados se conservan.',
  failed: 'Error al descargar el paquete de revisión: {{error}}',
  progressPdf: 'Generando PDF de planos',
  pdfDone: 'PDF de planos generados: {{generated}}. Ya almacenados: {{cached}}.',
  pdfNeedsSolidworks:
    'Los PDF necesitan SOLIDWORKS en este equipo ({{reason}}). Cualquiera con SOLIDWORKS puede generarlos más tarde.',
  pdfFailed: 'PDF de planos con error: {{count}}. {{details}}',
  pdfNotDrawing: 'Omitidos, no son planos: {{count}}.',
  pdfSameNameOpen:
    'Cierre primero estos documentos en SOLIDWORKS, o SOLIDWORKS los usaría en lugar de las versiones revisadas: {{files}}',
  pdfPending: 'PDF pendiente',
  pdfPendingHint:
    'Aún no se ha generado un PDF para esta versión. Cualquiera con SOLIDWORKS puede generarlo.',
  previewUnsupported: 'No hay vista previa para este tipo de archivo.',
  reason: {
    service_offline: 'el servicio de SOLIDWORKS no está en ejecución',
    service_outdated: 'el servicio de SOLIDWORKS es anterior a {{version}}',
    solidworks_not_installed: 'solo está instalado Document Manager, no SOLIDWORKS',
  },
}

const fr: NamespaceDict = {
  selectFolderTitle: 'Choisir où enregistrer le paquet de revue',
  validationOffline: 'Les paquets de revue nécessitent une connexion au serveur.',
  validationNotSignedIn: 'Connectez-vous d’abord à une organisation.',
  validationDesktopOnly: 'Les paquets de revue nécessitent l’application de bureau.',
  validationNoReview: 'Aucune revue n’a été choisie.',
  validationNoDestination: 'Choisissez un dossier pour le paquet.',
  validationNoVersions: 'Aucune version de fichier n’a été choisie.',
  progressDownload: 'Téléchargement du paquet de revue « {{title}} »',
  progressResolving: 'Résolution des références...',
  progressRetargeting: 'Redirection des fichiers les uns vers les autres...',
  progressFinishing: 'Écriture du manifeste...',
  noItems: 'Rien à télécharger : aucun des éléments choisis ne fait partie de cette revue.',
  downloadDone: 'Paquet de revue enregistré dans {{folder}}. Fichiers : {{count}}.',
  downloadPartial:
    'Paquet de revue enregistré dans {{folder}}, mais {{failed}} fichiers sur {{count}} n’ont pas pu être téléchargés.',
  missingReferences:
    'Absents du paquet (hors du coffre ou aucune version trouvée) : {{count}}. Voir manifest.csv.',
  versionConflicts:
    'Fichiers requis dans deux versions différentes : {{count}}. Une version a été conservée ; voir manifest.json.',
  approximate:
    'Certaines versions sont approximatives : elles ont été archivées avant l’enregistrement des références par version.',
  retargetNotRun:
    'Les références n’ont pas été redirigées vers le paquet, car le service SOLIDWORKS n’est pas lancé ou est antérieur à {{version}}. SOLIDWORKS risque d’ouvrir des fichiers de votre coffre.',
  retargetFailed: 'Fichiers qui n’ont pas pu être redirigés vers le paquet : {{count}}.',
  openFresh:
    'Ouvrez le paquet dans une nouvelle session SOLIDWORKS, sans fichier du coffre ouvert, pour que SOLIDWORKS charge les versions du paquet.',
  manifestFailed: 'Le manifeste n’a pas pu être écrit : {{error}}',
  cancelled:
    'Téléchargement annulé. Relancez-le pour reprendre ; les fichiers déjà téléchargés sont conservés.',
  failed: 'Échec du téléchargement du paquet de revue : {{error}}',
  progressPdf: 'Génération des PDF de mises en plan',
  pdfDone: 'PDF de mises en plan générés : {{generated}}. Déjà enregistrés : {{cached}}.',
  pdfNeedsSolidworks:
    'Les PDF nécessitent SOLIDWORKS sur cet ordinateur ({{reason}}). Toute personne disposant de SOLIDWORKS pourra les générer plus tard.',
  pdfFailed: 'PDF de mises en plan en échec : {{count}}. {{details}}',
  pdfNotDrawing: 'Ignorés, pas des mises en plan : {{count}}.',
  pdfSameNameOpen:
    'Fermez d’abord ces documents dans SOLIDWORKS, sinon SOLIDWORKS les utiliserait à la place des versions revues : {{files}}',
  pdfPending: 'PDF en attente',
  pdfPendingHint:
    'Aucun PDF n’a encore été généré pour cette version. Toute personne disposant de SOLIDWORKS peut le générer.',
  previewUnsupported: 'Aucun aperçu pour ce type de fichier.',
  reason: {
    service_offline: 'le service SOLIDWORKS n’est pas lancé',
    service_outdated: 'le service SOLIDWORKS est antérieur à {{version}}',
    solidworks_not_installed: 'seul Document Manager est installé, pas SOLIDWORKS',
  },
}

const pt: NamespaceDict = {
  selectFolderTitle: 'Escolha onde salvar o pacote de revisão',
  validationOffline: 'Os pacotes de revisão precisam de conexão com o servidor.',
  validationNotSignedIn: 'Entre em uma organização primeiro.',
  validationDesktopOnly: 'Os pacotes de revisão precisam do aplicativo de desktop.',
  validationNoReview: 'Nenhuma revisão foi escolhida.',
  validationNoDestination: 'Escolha uma pasta para o pacote.',
  validationNoVersions: 'Nenhuma versão de arquivo foi escolhida.',
  progressDownload: 'Baixando o pacote de revisão "{{title}}"',
  progressResolving: 'Resolvendo referências...',
  progressRetargeting: 'Fazendo os arquivos apontarem uns para os outros...',
  progressFinishing: 'Gravando o manifesto...',
  noItems: 'Nada para baixar: nenhum dos itens escolhidos está nesta revisão.',
  downloadDone: 'Pacote de revisão salvo em {{folder}}. Arquivos: {{count}}.',
  downloadPartial:
    'Pacote de revisão salvo em {{folder}}, mas {{failed}} de {{count}} arquivos não puderam ser baixados.',
  missingReferences:
    'Fora do pacote (fora do cofre ou sem versão encontrada): {{count}}. Veja manifest.csv.',
  versionConflicts:
    'Arquivos necessários em duas versões diferentes: {{count}}. Uma versão foi mantida; veja manifest.json.',
  approximate:
    'Algumas versões são aproximadas: foram registradas antes de as referências por versão serem gravadas.',
  retargetNotRun:
    'As referências não foram apontadas para dentro do pacote porque o serviço do SOLIDWORKS não está em execução ou é anterior a {{version}}. O SOLIDWORKS pode abrir arquivos do seu cofre.',
  retargetFailed: 'Arquivos que não puderam ser apontados para dentro do pacote: {{count}}.',
  openFresh:
    'Abra o pacote em uma nova sessão do SOLIDWORKS, sem arquivos do cofre abertos, para que o SOLIDWORKS carregue as versões do pacote.',
  manifestFailed: 'Não foi possível gravar o manifesto: {{error}}',
  cancelled:
    'Download cancelado. Execute novamente para retomar; os arquivos já baixados são mantidos.',
  failed: 'Falha ao baixar o pacote de revisão: {{error}}',
  progressPdf: 'Gerando PDFs de desenhos',
  pdfDone: 'PDFs de desenhos gerados: {{generated}}. Já armazenados: {{cached}}.',
  pdfNeedsSolidworks:
    'Os PDFs precisam do SOLIDWORKS neste computador ({{reason}}). Qualquer pessoa com SOLIDWORKS pode gerá-los depois.',
  pdfFailed: 'PDFs de desenhos com falha: {{count}}. {{details}}',
  pdfNotDrawing: 'Ignorados, não são desenhos: {{count}}.',
  pdfSameNameOpen:
    'Feche primeiro estes documentos no SOLIDWORKS, ou o SOLIDWORKS os usaria no lugar das versões revisadas: {{files}}',
  pdfPending: 'PDF pendente',
  pdfPendingHint:
    'Ainda não foi gerado um PDF para esta versão. Qualquer pessoa com SOLIDWORKS pode gerá-lo.',
  previewUnsupported: 'Não há visualização para este tipo de arquivo.',
  reason: {
    service_offline: 'o serviço do SOLIDWORKS não está em execução',
    service_outdated: 'o serviço do SOLIDWORKS é anterior a {{version}}',
    solidworks_not_installed: 'só o Document Manager está instalado, não o SOLIDWORKS',
  },
}

const zhCN: NamespaceDict = {
  selectFolderTitle: '选择审阅包的保存位置',
  validationOffline: '审阅包需要连接服务器。',
  validationNotSignedIn: '请先登录组织。',
  validationDesktopOnly: '审阅包需要桌面应用。',
  validationNoReview: '未选择审阅。',
  validationNoDestination: '请为审阅包选择文件夹。',
  validationNoVersions: '未选择文件版本。',
  progressDownload: '正在下载审阅包“{{title}}”',
  progressResolving: '正在解析引用...',
  progressRetargeting: '正在让文件相互引用...',
  progressFinishing: '正在写入清单...',
  noItems: '没有可下载的内容：所选项目都不在此审阅中。',
  downloadDone: '审阅包已保存到 {{folder}}。文件数：{{count}}。',
  downloadPartial: '审阅包已保存到 {{folder}}，但 {{count}} 个文件中有 {{failed}} 个无法下载。',
  missingReferences: '未包含在审阅包中（在库外或找不到版本）：{{count}}。请参阅 manifest.csv。',
  versionConflicts: '需要两个不同版本的文件：{{count}}。已保留其中一个版本；请参阅 manifest.json。',
  approximate: '部分版本为近似版本：它们在记录版本引用之前已检入。',
  retargetNotRun:
    '引用未指向审阅包内部，因为 SOLIDWORKS 服务未运行或版本低于 {{version}}。SOLIDWORKS 可能会改为打开库中的文件。',
  retargetFailed: '无法指向审阅包内部的文件：{{count}}。',
  openFresh:
    '请在新启动且未打开库文件的 SOLIDWORKS 会话中打开审阅包，以便 SOLIDWORKS 加载包内的版本。',
  manifestFailed: '无法写入清单：{{error}}',
  cancelled: '下载已取消。再次运行即可继续；已下载的文件会保留。',
  failed: '审阅包下载失败：{{error}}',
  progressPdf: '正在生成工程图 PDF',
  pdfDone: '已生成工程图 PDF：{{generated}}。已存储：{{cached}}。',
  pdfNeedsSolidworks:
    '生成 PDF 需要本机安装 SOLIDWORKS（{{reason}}）。任何拥有 SOLIDWORKS 的人都可以稍后生成。',
  pdfFailed: '生成失败的工程图 PDF：{{count}}。{{details}}',
  pdfNotDrawing: '已跳过（非工程图）：{{count}}。',
  pdfSameNameOpen:
    '请先在 SOLIDWORKS 中关闭这些文档，否则 SOLIDWORKS 会使用它们而不是被审阅的版本：{{files}}',
  pdfPending: 'PDF 待生成',
  pdfPendingHint: '此版本尚未生成 PDF。任何拥有 SOLIDWORKS 的人都可以生成。',
  previewUnsupported: '此文件类型没有预览。',
  reason: {
    service_offline: 'SOLIDWORKS 服务未运行',
    service_outdated: 'SOLIDWORKS 服务版本低于 {{version}}',
    solidworks_not_installed: '仅安装了 Document Manager，未安装 SOLIDWORKS',
  },
}

const zhTW: NamespaceDict = {
  selectFolderTitle: '選擇審閱包的儲存位置',
  validationOffline: '審閱包需要連線到伺服器。',
  validationNotSignedIn: '請先登入組織。',
  validationDesktopOnly: '審閱包需要桌面應用程式。',
  validationNoReview: '未選擇審閱。',
  validationNoDestination: '請為審閱包選擇資料夾。',
  validationNoVersions: '未選擇檔案版本。',
  progressDownload: '正在下載審閱包「{{title}}」',
  progressResolving: '正在解析參考...',
  progressRetargeting: '正在讓檔案相互參考...',
  progressFinishing: '正在寫入清單...',
  noItems: '沒有可下載的內容：所選項目都不在此審閱中。',
  downloadDone: '審閱包已儲存到 {{folder}}。檔案數：{{count}}。',
  downloadPartial: '審閱包已儲存到 {{folder}}，但 {{count}} 個檔案中有 {{failed}} 個無法下載。',
  missingReferences: '未包含在審閱包中（在庫外或找不到版本）：{{count}}。請參閱 manifest.csv。',
  versionConflicts: '需要兩個不同版本的檔案：{{count}}。已保留其中一個版本；請參閱 manifest.json。',
  approximate: '部分版本為近似版本：它們在記錄版本參考之前已簽入。',
  retargetNotRun:
    '參考未指向審閱包內部，因為 SOLIDWORKS 服務未執行或版本低於 {{version}}。SOLIDWORKS 可能會改為開啟庫中的檔案。',
  retargetFailed: '無法指向審閱包內部的檔案：{{count}}。',
  openFresh:
    '請在新啟動且未開啟庫檔案的 SOLIDWORKS 工作階段中開啟審閱包，讓 SOLIDWORKS 載入包內的版本。',
  manifestFailed: '無法寫入清單：{{error}}',
  cancelled: '下載已取消。再次執行即可繼續；已下載的檔案會保留。',
  failed: '審閱包下載失敗：{{error}}',
  progressPdf: '正在產生工程圖 PDF',
  pdfDone: '已產生工程圖 PDF：{{generated}}。已儲存：{{cached}}。',
  pdfNeedsSolidworks:
    '產生 PDF 需要本機安裝 SOLIDWORKS（{{reason}}）。任何擁有 SOLIDWORKS 的人都可以稍後產生。',
  pdfFailed: '產生失敗的工程圖 PDF：{{count}}。{{details}}',
  pdfNotDrawing: '已略過（非工程圖）：{{count}}。',
  pdfSameNameOpen:
    '請先在 SOLIDWORKS 中關閉這些文件，否則 SOLIDWORKS 會使用它們而非被審閱的版本：{{files}}',
  pdfPending: 'PDF 待產生',
  pdfPendingHint: '此版本尚未產生 PDF。任何擁有 SOLIDWORKS 的人都可以產生。',
  previewUnsupported: '此檔案類型沒有預覽。',
  reason: {
    service_offline: 'SOLIDWORKS 服務未執行',
    service_outdated: 'SOLIDWORKS 服務版本低於 {{version}}',
    solidworks_not_installed: '僅安裝了 Document Manager，未安裝 SOLIDWORKS',
  },
}

export const reviewPackageStrings = { en, de, es, fr, pt, zhCN, zhTW }
