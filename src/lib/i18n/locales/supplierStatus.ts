/** Exact RFQ status labels used by the MDB supplier portal. */
type SupplierStatusTranslations = Record<string, string>

export const supplierStatusTranslations: Record<string, SupplierStatusTranslations> = {
  en: {
    draft: 'Draft', pendingFiles: 'Pending Files', generating: 'Generating', ready: 'Ready',
    sent: 'Sent', awaitingQuote: 'Awaiting', quoted: 'Quoted', awarded: 'Awarded',
    cancelled: 'Cancelled', completed: 'Completed',
  },
  de: {
    draft: 'Entwurf', pendingFiles: 'Dateien ausstehend', generating: 'Wird erstellt', ready: 'Bereit',
    sent: 'Gesendet', awaitingQuote: 'Ausstehend', quoted: 'Angebot erhalten', awarded: 'Beauftragt',
    cancelled: 'Abgebrochen', completed: 'Abgeschlossen',
  },
  fr: {
    draft: 'Brouillon', pendingFiles: 'Fichiers en attente', generating: 'Génération', ready: 'Prête',
    sent: 'Envoyée', awaitingQuote: 'En attente', quoted: 'Devis reçu', awarded: 'Attribuée',
    cancelled: 'Annulée', completed: 'Terminée',
  },
  es: {
    draft: 'Borrador', pendingFiles: 'Archivos pendientes', generating: 'Generando', ready: 'Listo',
    sent: 'Enviado', awaitingQuote: 'En espera', quoted: 'Cotizado', awarded: 'Adjudicado',
    cancelled: 'Cancelado', completed: 'Completado',
  },
  pt: {
    draft: 'Rascunho', pendingFiles: 'Ficheiros pendentes', generating: 'A gerar', ready: 'Pronto',
    sent: 'Enviado', awaitingQuote: 'Pendente', quoted: 'Orçamentado', awarded: 'Atribuído',
    cancelled: 'Cancelado', completed: 'Concluído',
  },
  'zh-CN': {
    draft: '草稿', pendingFiles: '文件待处理', generating: '生成中', ready: '就绪', sent: '已发送',
    awaitingQuote: '等待报价', quoted: '已报价', awarded: '已授予', cancelled: '已取消', completed: '已完成',
  },
  'zh-TW': {
    draft: '草稿', pendingFiles: '檔案待處理', generating: '產生中', ready: '就緒', sent: '已傳送',
    awaitingQuote: '等待報價', quoted: '已報價', awarded: '已授予', cancelled: '已取消', completed: '已完成',
  },
}
