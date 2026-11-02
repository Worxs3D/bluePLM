type EDrawingsPreviewApi = NonNullable<Window['electronAPI']>
export type EDrawingsPreviewErrorCode = Extract<
  Awaited<ReturnType<EDrawingsPreviewApi['createEDrawingsPreview']>>,
  { success: false }
>['errorCode']

/**
 * What the embedded preview can report: an error code from the main process, or
 * `file-not-downloaded`, which the renderer decides on its own before asking. The two "not
 * local" cases need different words: a cloud-only file is fixed by downloading it, while a file
 * in a vault on a network share is already there and can only be opened in eDrawings itself.
 */
export type EDrawingsPreviewMessageCode = EDrawingsPreviewErrorCode | 'file-not-downloaded'

export const PREVIEW_MESSAGE_KEYS: Record<EDrawingsPreviewMessageCode, string> = {
  'file-not-downloaded': 'solidworksSettings.previewNotLocal',
  'preview-service-unavailable': 'solidworksSettings.previewServiceUnavailable',
  'preview-session-not-active': 'solidworksSettings.previewSessionUnavailable',
  'preview-request-not-from-window': 'solidworksSettings.previewSessionUnavailable',
  'preview-module-unavailable': 'solidworksSettings.previewUnavailable',
  'preview-host-unavailable': 'solidworksSettings.previewHostUnavailable',
  'preview-host-handshake-failed': 'solidworksSettings.previewHostUnavailable',
  'preview-host-timeout': 'solidworksSettings.previewHostTimeout',
  'preview-host-exited': 'solidworksSettings.previewHostUnavailable',
  'preview-document-load-failed': 'solidworksSettings.previewDocumentLoadFailed',
  'preview-file-invalid': 'solidworksSettings.previewFileUnavailable',
  'preview-vault-unavailable': 'solidworksSettings.previewFileUnavailable',
  'preview-vault-not-local': 'solidworksSettings.previewVaultOnNetwork',
  'preview-file-not-allowed': 'solidworksSettings.previewFileUnavailable',
  'preview-file-type-unsupported': 'solidworksSettings.previewFileUnavailable',
  'preview-file-not-available': 'solidworksSettings.previewFileUnavailable',
  'preview-file-outside-vault': 'solidworksSettings.previewFileUnavailable',
  'preview-bounds-invalid': 'solidworksSettings.previewBoundsUnavailable',
  'preview-operation-failed': 'solidworksSettings.previewStartFailed',
}
