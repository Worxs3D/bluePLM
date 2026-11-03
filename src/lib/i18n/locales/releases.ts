/** One namespace: keys to strings. */
type NamespaceDict = Record<string, string>

/**
 * `releases.*` (5.9.0, schema 509): released versions in the workflow UI. The forced-release
 * warning of Change State, the Released badge in version history, forced releases in the History
 * view, the released / WIP split in the item browser, and the "Releases the version" toggle of the
 * workflow state editor. Spread into each locale as `releases`; `releasesKeys.test.ts` checks every
 * key in every locale.
 */

const en: NamespaceDict = {
  forceTitle: 'Release without an approved review?',
  forceBody:
    'Version {{version}} of {{name}} has no approved review. Releasing it now bypasses the release process. The release is recorded as forced, with your reason, in the vault history.',
  forceBodyMany:
    '{{count}} drawings have no approved review of their current version. Releasing them now bypasses the release process. Each release is recorded as forced, with your reason, in the vault history.',
  reasonLabel: 'Reason (required)',
  reasonPlaceholder: 'Why this release cannot wait for a review',
  forceConfirm: 'Force release',
  cancel: 'Cancel',
  forcedDone: 'Released {{name}} (forced)',
  forcedDoneMany: 'Released {{count}} drawings (forced)',
  forceFailed: 'Could not force the release of {{name}}: {{error}}',
  noReleaseTransition: '{{name}} has no single transition to that state, so its release was not forced.',
  badgeReleased: 'Released',
  badgeReleasedForced: 'Released (forced)',
  badgeTitle: 'Released {{date}}',
  badgeTitleForced: 'Released {{date}} without an approved review. Reason: {{reason}}',
  badgeTitleForcedNoReason: 'Released {{date}} without an approved review',
  checkedInAt: 'Checked in at {{state}}',
  historyForced: 'Forced release',
  historyForcedDetail: 'Version {{version}}, revision {{revision}}, released without an approved review',
  historyReason: 'Reason: {{reason}}',
  itemReleasedState: 'Released',
  itemWip: 'WIP v{{version}}',
  itemWipTitle: 'Work in progress: version {{version}}, revision {{revision}}, {{state}}. Released: version {{released}}.',
  itemReleasedExports: 'Released exports (v{{version}})',
  itemNoReleasedExports: 'No exports of the released version yet',
  stateReleasesToggle: 'Releases the version',
  stateReleasesHint:
    "Entering this state releases the file's newest checked-in version and freezes its exports. A drawing needs an approved review of that version, or a forced release.",
}

const de: NamespaceDict = {
  forceTitle: 'Ohne genehmigte Prüfung freigeben?',
  forceBody:
    'Version {{version}} von {{name}} hat keine genehmigte Prüfung. Eine Freigabe jetzt umgeht den Freigabeprozess. Die Freigabe wird mit Ihrer Begründung als erzwungen im Tresorverlauf festgehalten.',
  forceBodyMany:
    '{{count}} Zeichnungen haben keine genehmigte Prüfung ihrer aktuellen Version. Eine Freigabe jetzt umgeht den Freigabeprozess. Jede Freigabe wird mit Ihrer Begründung als erzwungen im Tresorverlauf festgehalten.',
  reasonLabel: 'Begründung (erforderlich)',
  reasonPlaceholder: 'Warum diese Freigabe nicht auf eine Prüfung warten kann',
  forceConfirm: 'Freigabe erzwingen',
  cancel: 'Abbrechen',
  forcedDone: '{{name}} freigegeben (erzwungen)',
  forcedDoneMany: '{{count}} Zeichnungen freigegeben (erzwungen)',
  forceFailed: 'Die Freigabe von {{name}} konnte nicht erzwungen werden: {{error}}',
  noReleaseTransition: '{{name}} hat keinen eindeutigen Übergang in diesen Status, daher wurde die Freigabe nicht erzwungen.',
  badgeReleased: 'Freigegeben',
  badgeReleasedForced: 'Freigegeben (erzwungen)',
  badgeTitle: 'Freigegeben {{date}}',
  badgeTitleForced: 'Freigegeben {{date}} ohne genehmigte Prüfung. Begründung: {{reason}}',
  badgeTitleForcedNoReason: 'Freigegeben {{date}} ohne genehmigte Prüfung',
  checkedInAt: 'Eingecheckt in {{state}}',
  historyForced: 'Erzwungene Freigabe',
  historyForcedDetail: 'Version {{version}}, Revision {{revision}}, ohne genehmigte Prüfung freigegeben',
  historyReason: 'Begründung: {{reason}}',
  itemReleasedState: 'Freigegeben',
  itemWip: 'In Arbeit v{{version}}',
  itemWipTitle: 'In Arbeit: Version {{version}}, Revision {{revision}}, {{state}}. Freigegeben: Version {{released}}.',
  itemReleasedExports: 'Freigegebene Exporte (v{{version}})',
  itemNoReleasedExports: 'Noch keine Exporte der freigegebenen Version',
  stateReleasesToggle: 'Gibt die Version frei',
  stateReleasesHint:
    'Beim Eintritt in diesen Status wird die neueste eingecheckte Version der Datei freigegeben und ihre Exporte werden eingefroren. Eine Zeichnung braucht eine genehmigte Prüfung dieser Version oder eine erzwungene Freigabe.',
}

const es: NamespaceDict = {
  forceTitle: '¿Liberar sin una revisión aprobada?',
  forceBody:
    'La versión {{version}} de {{name}} no tiene una revisión aprobada. Liberarla ahora omite el proceso de liberación. La liberación se registra como forzada, con su motivo, en el historial del almacén.',
  forceBodyMany:
    '{{count}} planos no tienen una revisión aprobada de su versión actual. Liberarlos ahora omite el proceso de liberación. Cada liberación se registra como forzada, con su motivo, en el historial del almacén.',
  reasonLabel: 'Motivo (obligatorio)',
  reasonPlaceholder: 'Por qué esta liberación no puede esperar a una revisión',
  forceConfirm: 'Forzar liberación',
  cancel: 'Cancelar',
  forcedDone: '{{name}} liberado (forzado)',
  forcedDoneMany: '{{count}} planos liberados (forzado)',
  forceFailed: 'No se pudo forzar la liberación de {{name}}: {{error}}',
  noReleaseTransition: '{{name}} no tiene una única transición a ese estado, así que su liberación no se forzó.',
  badgeReleased: 'Liberado',
  badgeReleasedForced: 'Liberado (forzado)',
  badgeTitle: 'Liberado {{date}}',
  badgeTitleForced: 'Liberado {{date}} sin una revisión aprobada. Motivo: {{reason}}',
  badgeTitleForcedNoReason: 'Liberado {{date}} sin una revisión aprobada',
  checkedInAt: 'Registrado en {{state}}',
  historyForced: 'Liberación forzada',
  historyForcedDetail: 'Versión {{version}}, revisión {{revision}}, liberada sin una revisión aprobada',
  historyReason: 'Motivo: {{reason}}',
  itemReleasedState: 'Liberado',
  itemWip: 'En curso v{{version}}',
  itemWipTitle: 'En curso: versión {{version}}, revisión {{revision}}, {{state}}. Liberada: versión {{released}}.',
  itemReleasedExports: 'Exportaciones liberadas (v{{version}})',
  itemNoReleasedExports: 'Aún no hay exportaciones de la versión liberada',
  stateReleasesToggle: 'Libera la versión',
  stateReleasesHint:
    'Al entrar en este estado se libera la versión registrada más reciente del archivo y se congelan sus exportaciones. Un plano necesita una revisión aprobada de esa versión o una liberación forzada.',
}

const fr: NamespaceDict = {
  forceTitle: 'Publier sans revue approuvée ?',
  forceBody:
    "La version {{version}} de {{name}} n'a pas de revue approuvée. La publier maintenant contourne le processus de publication. La publication est enregistrée comme forcée, avec votre motif, dans l'historique du coffre.",
  forceBodyMany:
    "{{count}} dessins n'ont pas de revue approuvée de leur version actuelle. Les publier maintenant contourne le processus de publication. Chaque publication est enregistrée comme forcée, avec votre motif, dans l'historique du coffre.",
  reasonLabel: 'Motif (obligatoire)',
  reasonPlaceholder: 'Pourquoi cette publication ne peut pas attendre une revue',
  forceConfirm: 'Forcer la publication',
  cancel: 'Annuler',
  forcedDone: '{{name}} publié (forcé)',
  forcedDoneMany: '{{count}} dessins publiés (forcé)',
  forceFailed: "Impossible de forcer la publication de {{name}} : {{error}}",
  noReleaseTransition: "{{name}} n'a pas de transition unique vers cet état, sa publication n'a donc pas été forcée.",
  badgeReleased: 'Publié',
  badgeReleasedForced: 'Publié (forcé)',
  badgeTitle: 'Publié {{date}}',
  badgeTitleForced: 'Publié {{date}} sans revue approuvée. Motif : {{reason}}',
  badgeTitleForcedNoReason: 'Publié {{date}} sans revue approuvée',
  checkedInAt: 'Archivé à l’état {{state}}',
  historyForced: 'Publication forcée',
  historyForcedDetail: 'Version {{version}}, révision {{revision}}, publiée sans revue approuvée',
  historyReason: 'Motif : {{reason}}',
  itemReleasedState: 'Publié',
  itemWip: 'En cours v{{version}}',
  itemWipTitle: 'En cours : version {{version}}, révision {{revision}}, {{state}}. Publiée : version {{released}}.',
  itemReleasedExports: 'Exports publiés (v{{version}})',
  itemNoReleasedExports: 'Aucun export de la version publiée pour le moment',
  stateReleasesToggle: 'Publie la version',
  stateReleasesHint:
    "L'entrée dans cet état publie la dernière version archivée du fichier et fige ses exports. Un dessin a besoin d'une revue approuvée de cette version, ou d'une publication forcée.",
}

const pt: NamespaceDict = {
  forceTitle: 'Liberar sem uma revisão aprovada?',
  forceBody:
    'A versão {{version}} de {{name}} não tem revisão aprovada. Liberá-la agora contorna o processo de liberação. A liberação é registrada como forçada, com o seu motivo, no histórico do cofre.',
  forceBodyMany:
    '{{count}} desenhos não têm revisão aprovada da versão atual. Liberá-los agora contorna o processo de liberação. Cada liberação é registrada como forçada, com o seu motivo, no histórico do cofre.',
  reasonLabel: 'Motivo (obrigatório)',
  reasonPlaceholder: 'Por que esta liberação não pode esperar por uma revisão',
  forceConfirm: 'Forçar liberação',
  cancel: 'Cancelar',
  forcedDone: '{{name}} liberado (forçado)',
  forcedDoneMany: '{{count}} desenhos liberados (forçado)',
  forceFailed: 'Não foi possível forçar a liberação de {{name}}: {{error}}',
  noReleaseTransition: '{{name}} não tem uma única transição para esse estado, então a liberação não foi forçada.',
  badgeReleased: 'Liberado',
  badgeReleasedForced: 'Liberado (forçado)',
  badgeTitle: 'Liberado {{date}}',
  badgeTitleForced: 'Liberado {{date}} sem revisão aprovada. Motivo: {{reason}}',
  badgeTitleForcedNoReason: 'Liberado {{date}} sem revisão aprovada',
  checkedInAt: 'Registrado em {{state}}',
  historyForced: 'Liberação forçada',
  historyForcedDetail: 'Versão {{version}}, revisão {{revision}}, liberada sem revisão aprovada',
  historyReason: 'Motivo: {{reason}}',
  itemReleasedState: 'Liberado',
  itemWip: 'Em andamento v{{version}}',
  itemWipTitle: 'Em andamento: versão {{version}}, revisão {{revision}}, {{state}}. Liberada: versão {{released}}.',
  itemReleasedExports: 'Exportações liberadas (v{{version}})',
  itemNoReleasedExports: 'Ainda não há exportações da versão liberada',
  stateReleasesToggle: 'Libera a versão',
  stateReleasesHint:
    'Entrar neste estado libera a versão registrada mais recente do arquivo e congela as suas exportações. Um desenho precisa de uma revisão aprovada dessa versão ou de uma liberação forçada.',
}

const zhCN: NamespaceDict = {
  forceTitle: '在没有已批准评审的情况下发布？',
  forceBody: '{{name}} 的版本 {{version}} 没有已批准的评审。现在发布将绕过发布流程。此次发布将连同您的原因作为强制发布记录在保险库历史中。',
  forceBodyMany: '{{count}} 个工程图的当前版本没有已批准的评审。现在发布将绕过发布流程。每次发布都将连同您的原因作为强制发布记录在保险库历史中。',
  reasonLabel: '原因（必填）',
  reasonPlaceholder: '为什么此次发布不能等待评审',
  forceConfirm: '强制发布',
  cancel: '取消',
  forcedDone: '已发布 {{name}}（强制）',
  forcedDoneMany: '已发布 {{count}} 个工程图（强制）',
  forceFailed: '无法强制发布 {{name}}：{{error}}',
  noReleaseTransition: '{{name}} 没有到该状态的唯一转换，因此未强制发布。',
  badgeReleased: '已发布',
  badgeReleasedForced: '已发布（强制）',
  badgeTitle: '发布于 {{date}}',
  badgeTitleForced: '发布于 {{date}}，没有已批准的评审。原因：{{reason}}',
  badgeTitleForcedNoReason: '发布于 {{date}}，没有已批准的评审',
  checkedInAt: '签入时状态：{{state}}',
  historyForced: '强制发布',
  historyForcedDetail: '版本 {{version}}，修订 {{revision}}，在没有已批准评审的情况下发布',
  historyReason: '原因：{{reason}}',
  itemReleasedState: '已发布',
  itemWip: '进行中 v{{version}}',
  itemWipTitle: '进行中：版本 {{version}}，修订 {{revision}}，{{state}}。已发布：版本 {{released}}。',
  itemReleasedExports: '已发布的导出（v{{version}}）',
  itemNoReleasedExports: '已发布版本尚无导出',
  stateReleasesToggle: '发布版本',
  stateReleasesHint: '进入此状态会发布文件最新签入的版本并冻结其导出。工程图需要该版本的已批准评审，或强制发布。',
}

const zhTW: NamespaceDict = {
  forceTitle: '在沒有已核准審查的情況下發行？',
  forceBody: '{{name}} 的版本 {{version}} 沒有已核准的審查。現在發行將略過發行流程。此次發行將連同您的原因以強制發行記錄在保管庫歷程中。',
  forceBodyMany: '{{count}} 個工程圖的目前版本沒有已核准的審查。現在發行將略過發行流程。每次發行都將連同您的原因以強制發行記錄在保管庫歷程中。',
  reasonLabel: '原因（必填）',
  reasonPlaceholder: '為什麼此次發行不能等待審查',
  forceConfirm: '強制發行',
  cancel: '取消',
  forcedDone: '已發行 {{name}}（強制）',
  forcedDoneMany: '已發行 {{count}} 個工程圖（強制）',
  forceFailed: '無法強制發行 {{name}}：{{error}}',
  noReleaseTransition: '{{name}} 沒有到該狀態的唯一轉換，因此未強制發行。',
  badgeReleased: '已發行',
  badgeReleasedForced: '已發行（強制）',
  badgeTitle: '發行於 {{date}}',
  badgeTitleForced: '發行於 {{date}}，沒有已核准的審查。原因：{{reason}}',
  badgeTitleForcedNoReason: '發行於 {{date}}，沒有已核准的審查',
  checkedInAt: '簽入時狀態：{{state}}',
  historyForced: '強制發行',
  historyForcedDetail: '版本 {{version}}，修訂 {{revision}}，在沒有已核准審查的情況下發行',
  historyReason: '原因：{{reason}}',
  itemReleasedState: '已發行',
  itemWip: '進行中 v{{version}}',
  itemWipTitle: '進行中：版本 {{version}}，修訂 {{revision}}，{{state}}。已發行：版本 {{released}}。',
  itemReleasedExports: '已發行的匯出（v{{version}}）',
  itemNoReleasedExports: '已發行版本尚無匯出',
  stateReleasesToggle: '發行版本',
  stateReleasesHint: '進入此狀態會發行檔案最新簽入的版本並凍結其匯出。工程圖需要該版本的已核准審查，或強制發行。',
}

export const releasesStrings = { en, de, es, fr, pt, zhCN, zhTW }
