import type { TranslationValue } from '../types'

const common = {
  statusCurrent: 'Current', statusUpdateAvailable: 'Update available', statusUnknown: 'Unknown', statusUpdating: 'Updating', statusRollback: 'Rolled back', statusFailure: 'Update failed', packagedDigest: 'Packaged digest', deployedDigest: 'Deployed digest', version: 'Bundle version', fileCount: 'Files', credentialsTitle: 'Deployment credentials', credentialsDescription: 'FTPS credentials upload PHP files. The maintenance token authorizes database migrations only.', ftpUrl: 'FTPS server URL', ftpSecurity: 'FTPS security', ftpRemotePath: 'Remote server path', ftpUsername: 'FTPS username', ftpPassword: 'FTPS password', maintenanceToken: 'Maintenance token', explicitTls: 'Explicit TLS', implicitTls: 'Implicit TLS', passwordPlaceholder: 'Enter to save or replace', tokenPlaceholder: 'Enter to save or replace', saveCredentials: 'Save credentials', clearCredentials: 'Delete saved credentials', credentialsStored: 'Credentials are stored securely by the operating system.', credentialsMissing: 'Deployment credentials are not saved.', encryptionUnavailable: 'Secure credential storage is unavailable on this device.', recheck: 'Check now', update: 'Update server', confirmUpdate: 'Update the MDB server now? Database migrations cannot be undone by restoring files.', maintenanceNote: 'Every update requires explicit confirmation. Your BluePLM session token alone cannot deploy files.', statusLabel: 'Status', resultSuccess: 'MDB server updated successfully.', updateAvailableNotification: 'A new MDB server update is available.', unauthorized: 'Only an organization owner or administrator can update the MDB server.', invalidMaintenanceToken: 'The maintenance token was rejected.', missingCredentials: 'Save the FTPS profile, password, and maintenance token before updating.', healthMismatch: 'The updated server did not report the expected bundle.', genericFailure: 'The MDB server update could not be completed.',
} as const

const statusWords = {
  de: { statusCurrent: 'Aktuell', statusUpdateAvailable: 'Update verfügbar', statusUnknown: 'Unbekannt', statusUpdating: 'Wird aktualisiert', statusRollback: 'Zurückgesetzt', statusFailure: 'Update fehlgeschlagen' },
  es: { statusCurrent: 'Actual', statusUpdateAvailable: 'Actualización disponible', statusUnknown: 'Desconocido', statusUpdating: 'Actualizando', statusRollback: 'Revertido', statusFailure: 'Actualización fallida' },
  fr: { statusCurrent: 'À jour', statusUpdateAvailable: 'Mise à jour disponible', statusUnknown: 'Inconnu', statusUpdating: 'Mise à jour', statusRollback: 'Rétabli', statusFailure: 'Échec de la mise à jour' },
  pt: { statusCurrent: 'Atual', statusUpdateAvailable: 'Atualização disponível', statusUnknown: 'Desconhecido', statusUpdating: 'Atualizando', statusRollback: 'Revertido', statusFailure: 'Falha na atualização' },
  'zh-CN': { statusCurrent: '当前', statusUpdateAvailable: '有可用更新', statusUnknown: '未知', statusUpdating: '更新中', statusRollback: '已回滚', statusFailure: '更新失败' },
  'zh-TW': { statusCurrent: '目前', statusUpdateAvailable: '有可用更新', statusUnknown: '未知', statusUpdating: '更新中', statusRollback: '已復原', statusFailure: '更新失敗' },
}

export const settingsMdbServerTranslations: Record<string, TranslationValue> = {
  en: { ...common, title: 'MDB Server', description: 'Check and explicitly update the deployed MDB server bundle.' },
  de: { ...common, ...statusWords.de, title: 'MDB-Server', description: 'Das bereitgestellte MDB-Serverpaket prüfen und ausdrücklich aktualisieren.' },
  es: { ...common, ...statusWords.es, title: 'Servidor MDB', description: 'Comprobar y actualizar explícitamente el paquete del servidor MDB desplegado.' },
  fr: { ...common, ...statusWords.fr, title: 'Serveur MDB', description: 'Vérifier et mettre explicitement à jour le paquet du serveur MDB déployé.' },
  pt: { ...common, ...statusWords.pt, title: 'Servidor MDB', description: 'Verifique e atualize explicitamente o pacote do servidor MDB implantado.' },
  'zh-CN': { ...common, ...statusWords['zh-CN'], title: 'MDB 服务器', description: '检查并明确更新已部署的 MDB 服务器软件包。' },
  'zh-TW': { ...common, ...statusWords['zh-TW'], title: 'MDB 伺服器', description: '檢查並明確更新已部署的 MDB 伺服器套件。' },
}
